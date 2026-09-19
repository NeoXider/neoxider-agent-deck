const assert = require("node:assert/strict");
const test = require("node:test");
const { messagesFromHistory } = require("../src/history-model.cjs");

const entry = (type, seq, data) => ({ event: { type, seq, time: seq * 1000, data } });
const human = (seq, text) => entry("user/message", seq, { source: { kind: "user" }, content: [{ type: "text", text }] });
const summary = (seq, compactionId = "compact-a", shadowedTokenCount = 100000) => entry("compaction/summary", seq, {
  compactionId, shadowedTokenCount, summary: [{ type: "text", text: "Summary" }], usage: { inputTokens: 99999, outputTokens: 500 },
});
const checkpoint = (seq, compactionId = "compact-a", content = [{ type: "text", text: "x".repeat(87968) }]) => entry("user/message", seq, {
  source: { kind: "plugin", plugin: "compact", compactionId }, content,
});

test("landed compaction stays at its checkpoint position with estimated replaced-context counts", () => {
  const history = [human(1, "Before"), summary(2), checkpoint(3), human(4, "After")];
  const messages = messagesFromHistory(history);
  assert.deepEqual(messages.map(({ role, seq }) => [role, seq]), [["user", 1], ["compaction", 3], ["user", 4]]);
  assert.equal(messages[1].beforeTokens, 100000);
  assert.equal(messages[1].afterTokens, 22000);
  assert.equal(messages[1].estimated, true);
  assert.equal(messages[1].countScope, "fragment");
  assert.equal(messages[1].time, 3000);
  assert.match(messages[1].text, /100000 → 22000/);
  assert.equal(messages[1].text.includes("xxxxx"), false, "internal checkpoint instructions never render");
  assert.deepEqual(messagesFromHistory(JSON.parse(JSON.stringify(history))), messages, "reload preserves counts and position");
});

function anchoredCompaction() {
  const anchor = entry("assistant/message", 10, {
    usage: { inputTokens: 20000, cacheReadTokens: 60000, cacheWriteTokens: 1000 },
    message: { content: [{ type: "text", text: "Done" }] },
  });
  anchor.event.surfaceOp = "append";
  const compact = summary(11, "compact-a", 42000);
  compact.event.data.shadowedRange = { start: 1, end: 7 };
  const landed = checkpoint(12, "compact-a", [{ type: "text", text: "x".repeat(3968) }]);
  landed.event.surfaceOp = { op: "replace", startSeq: 1, endSeq: 7 };
  return [anchor, compact, landed];
}

test("compaction includes retained context and cached prompt tokens, not the summarizer's usage", () => {
  const marker = messagesFromHistory(anchoredCompaction()).at(-1);
  assert.equal(marker.countScope, "context");
  assert.equal(marker.beforeTokens, 81009);
  assert.equal(marker.afterTokens, 40009);
  assert.match(marker.text, /full context/);
});

test("uncertain anchors and mismatched replacement ranges fall back to explicitly scoped fragments", () => {
  for (const mutate of [
    (h) => { delete h[0].event.data.usage; },
    (h) => { h[0].event.data.usage.inputTokens = "20000"; },
    (h) => { h[0].event.data.usage.inputTokens = 0; h[0].event.data.usage.cacheReadTokens = 0; },
    (h) => { h[0].event.seq = 8; },
    (h) => { h[2].event.surfaceOp.startSeq = 2; },
    (h) => { h[0].event.data.message.content = [{ type: "image", data: "unknown" }]; },
  ]) {
    const history = anchoredCompaction();
    mutate(history);
    const marker = messagesFromHistory(history).at(-1);
    assert.equal(marker.countScope, "fragment");
    assert.equal(marker.beforeTokens, 42000);
    assert.equal(marker.afterTokens, 1000);
  }
});

test("intervening tool results add pressure while request changes invalidate the old anchor", () => {
  for (const changedHeader of [false, true]) {
    const history = anchoredCompaction();
    history[1].event.seq = 12;
    history[2].event.seq = 13;
    const middle = changedHeader ? entry("request/header", 11, { header: { tools: [] } })
      : entry("tool/result", 11, { message: { content: [{ type: "tool-result", content: [{ type: "text", text: "abcdefgh" }] }] } });
    if (!changedHeader) middle.event.surfaceOp = "append";
    history.splice(1, 0, middle);
    const marker = messagesFromHistory(history).at(-1);
    assert.equal(marker.countScope, changedHeader ? "fragment" : "context");
    if (!changedHeader) assert.equal(marker.beforeTokens, 81023);
  }
});

test("summary/start/end events alone do not claim a successful compaction", () => {
  assert.deepEqual(messagesFromHistory([
    entry("compaction/start", 1, { compactionId: "compact-a" }), summary(2),
    entry("compaction/end", 3, { compactionId: "compact-a", error: "failed" }),
  ]), []);
});

test("missing or mismatched summary counts stay unknown, never borrowed from unrelated usage", () => {
  for (const history of [
    [checkpoint(3)],
    [summary(2, "another-transaction"), checkpoint(3)],
    [summary(1), checkpoint(3)],
    [summary(2, "compact-a", -10), checkpoint(3)],
    [summary(2, "compact-a", "100000"), checkpoint(3)],
  ]) {
    const [marker] = messagesFromHistory(history);
    assert.equal(marker.text, "Context compacted");
    assert.equal(marker.beforeTokens, null);
    assert.equal(marker.afterTokens, null);
  }
});

test("non-text replacement has no fabricated after count; later compactions stay distinct", () => {
  const messages = messagesFromHistory([
    summary(2), checkpoint(3, "compact-a", [{ type: "image", mediaType: "image/png" }]),
    summary(4, "compact-b", 0), checkpoint(5, "compact-b", []),
  ]);
  assert.equal(messages[0].afterTokens, null);
  assert.equal(messages[0].text, "Context compacted");
  assert.equal(messages[1].beforeTokens, 0);
  assert.equal(messages[1].afterTokens, 4);
  assert.notEqual(messages[0].compactionId, messages[1].compactionId);
});
