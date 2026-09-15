const test = require("node:test");
const assert = require("node:assert/strict");

const {
  HISTORY_PREVIEW_BYTES_BUDGET,
  adaptQueueAction,
  boundedHistoryCacheEntries,
  boundedHistoryEntries,
  historyRevision,
  messagesFromHistory,
  positiveInteger,
  readableToolValue,
  reasoningFromBlocks,
  textFromBlocks,
  titleFromSession,
  toolMessagesFromHistory,
  toolResultFromBlocks,
  userContentFromBlocks,
} = require("../src/history-model.cjs");

test("adaptQueueAction wraps edit text into content blocks", () => {
  const action = { kind: "edit", text: "hello", path: "a.txt" };
  const result = adaptQueueAction(action);
  assert.deepEqual(result.content, [{ type: "text", text: "hello" }]);
  assert.equal(result.text, undefined);
  assert.equal(result.path, "a.txt");
});

test("adaptQueueAction passes non-edit actions through", () => {
  const action = { kind: "submit", text: "hi" };
  assert.equal(adaptQueueAction(action), action);
  assert.equal(adaptQueueAction(null), null);
  assert.equal(adaptQueueAction(undefined), undefined);
});

test("textFromBlocks joins text blocks", () => {
  assert.equal(textFromBlocks([{ type: "text", text: "a" }, { type: "text", text: "b" }]), "a\nb");
  assert.equal(textFromBlocks(null), "");
  assert.equal(textFromBlocks([{ type: "reasoning", text: "skip" }]), "");
});

test("reasoningFromBlocks extracts reasoning text", () => {
  assert.equal(reasoningFromBlocks([{ type: "reasoning", text: "think" }]), "think");
  assert.equal(reasoningFromBlocks([{ type: "text", text: "nope" }]), "");
  assert.equal(reasoningFromBlocks(null), "");
});

test("userContentFromBlocks extracts images and file references", () => {
  const result = userContentFromBlocks([
    { type: "text", text: "hello" },
    { type: "image", mediaType: "image/png", data: "AAAA", name: "pic.png" },
    { type: "text", text: "@C:\\Users\\test\\file.txt" },
  ]);
  assert.equal(result.text, "hello");
  assert.equal(result.attachments.length, 2);
  assert.equal(result.attachments[0].kind, "image");
  assert.equal(result.attachments[1].kind, "reference");
});

test("readableToolValue stringifies values", () => {
  assert.equal(readableToolValue(null), "");
  assert.equal(readableToolValue(""), "");
  assert.equal(readableToolValue('{"a":1}'), "{\n  \"a\": 1\n}");
  assert.equal(readableToolValue("plain text"), "plain text");
});

test("toolResultFromBlocks joins text/image blocks", () => {
  assert.equal(toolResultFromBlocks([{ type: "text", text: "ok" }]), "ok");
  assert.equal(toolResultFromBlocks([{ type: "image" }]), "[Image result]");
  assert.equal(toolResultFromBlocks(null), "");
});

test("titleFromSession extracts title from projections", () => {
  assert.equal(titleFromSession({ projections: { values: { title: "My Title" } } }), "My Title");
  assert.equal(titleFromSession({ projections: { values: { sessionTitle: "S" } } }), "S");
  assert.equal(titleFromSession({ cwd: "/foo/bar" }), "bar");
  assert.equal(titleFromSession({ cwd: "C:\\Users\\test\\" }), "test");
  assert.equal(titleFromSession({}), "New session");
});

test("historyRevision is stable for same input", () => {
  const entries = [{ event: { type: "a" } }, { event: { type: "b" } }];
  assert.equal(historyRevision(entries), historyRevision(entries));
  assert.match(historyRevision(entries), /^sha256:/);
});

test("boundedHistoryEntries strips image data over budget", () => {
  const bigData = "A".repeat(2000);
  const entries = [
    { event: { data: { content: [{ type: "image", mediaType: "image/png", data: bigData }] } } },
    { event: { data: { content: [{ type: "text", text: "hello" }] } } },
  ];
  const bounded = boundedHistoryEntries(entries, 100);
  assert.equal(bounded[0].event.data.content[0].data, undefined);
  assert.equal(bounded[1].event.data.content[0].text, "hello");
});

test("boundedHistoryCacheEntries limits events by count and bytes", () => {
  const entries = Array.from({ length: 10 }, (_, i) => ({ id: i }));
  const result = boundedHistoryCacheEntries(entries, { maxEvents: 3, maxBytes: 999999 });
  assert.equal(result.entries.length, 3);
  assert.ok(result.truncated);
});

test("positiveInteger returns fallback for non-positive values", () => {
  assert.equal(positiveInteger(5, 10), 5);
  assert.equal(positiveInteger(0, 10), 10);
  assert.equal(positiveInteger(-1, 10), 10);
  assert.equal(positiveInteger("abc", 10), 10);
});

test("messagesFromHistory maps events to roles", () => {
  const entries = [
    { event: { type: "user/message", data: { source: { kind: "user" }, content: [{ type: "text", text: "hi" }] }, time: 1, seq: 1 } },
    { event: { type: "assistant/message", data: { message: { content: [{ type: "text", text: "reply" }] } }, time: 2, seq: 2 } },
    { event: { type: "turn/end", data: { reason: { kind: "error", error: { message: "boom" } } }, time: 3, seq: 3 } },
  ];
  const msgs = messagesFromHistory(entries);
  assert.equal(msgs.length, 3);
  assert.equal(msgs[0].role, "user");
  assert.equal(msgs[1].role, "assistant");
  assert.equal(msgs[2].role, "error");
});

test("messagesFromHistory hides permission commands", () => {
  const entries = [
    { event: { type: "command/run", data: { name: "permission", args: "danger-full-access", source: { kind: "user" }, commandId: "c1" }, time: 1, seq: 1 } },
    { event: { type: "command/done", data: { text: "done", commandId: "c1" }, time: 2, seq: 2 } },
  ];
  const msgs = messagesFromHistory(entries);
  assert.equal(msgs.length, 0);
});

test("toolMessagesFromHistory extracts tool calls with results", () => {
  const entries = [
    { event: { type: "tool/call", data: { callId: "t1", name: "read", arguments: '{"path":"a"}' }, time: 1, seq: 1 } },
    { event: { type: "tool/result", data: { message: { source: { callId: "t1" }, content: [{ type: "tool-result", content: [{ type: "text", text: "file contents" }] }] } }, time: 2, seq: 2 } },
  ];
  const tools = toolMessagesFromHistory(entries);
  assert.equal(tools.length, 1);
  assert.equal(tools[0].callId, "t1");
  assert.equal(tools[0].name, "read");
  assert.equal(tools[0].result, "file contents");
  assert.equal(tools[0].status, "done");
  assert.ok(typeof tools[0].durationMs === "number");
});

test("toolMessagesFromHistory handles running tools", () => {
  const entries = [
    { event: { type: "tool/call", data: { callId: "t2", name: "exec", arguments: "" }, time: 1, seq: 1 } },
  ];
  const tools = toolMessagesFromHistory(entries);
  assert.equal(tools.length, 1);
  assert.equal(tools[0].status, "running");
});

test("toolMessagesFromHistory deduplicates by callId", () => {
  const entries = [
    { event: { type: "tool/call", data: { callId: "t3", name: "a" }, time: 1, seq: 1 } },
    { event: { type: "tool/call", data: { callId: "t3", name: "a" }, time: 2, seq: 2 } },
  ];
  assert.equal(toolMessagesFromHistory(entries).length, 1);
});
