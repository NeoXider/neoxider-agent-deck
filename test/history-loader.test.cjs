const test = require("node:test");
const assert = require("node:assert/strict");
const { HarnessApi } = require("../src/harness-api.cjs");
const { createAttachmentCache, mergeEntries } = require("../src/history-loader.cjs");

const legacyFetch = async () => ({ ok: true, status: 200 });
const png = (byte) => Buffer.alloc(64, byte).toString("base64");
const userText = (seq, text = `message-${seq}`) => ({ event: { type: "user/message", seq, data: { source: { kind: "user" }, content: [{ type: "text", text }] } } });

test("merging keeps one copy of each sequenced event, the newest version, in order", () => {
  const merged = mergeEntries(
    [userText(1), userText(3, "old three"), { event: { type: "note" } }],
    [userText(3, "new three"), userText(2), { event: { type: "fresh-note" } }],
  );
  assert.deepEqual(merged.map((entry) => entry.event.seq ?? entry.event.type), [1, 2, 3, "note", "fresh-note"]);
  assert.equal(merged[2].event.data.content[0].text, "new three");
});

test("the attachment cache is least-recently-used and bounded by decoded bytes", () => {
  const cache = createAttachmentCache(150);
  cache.set("a", png(1));
  cache.set("b", png(2));
  assert.equal(cache.get("a"), png(1));
  cache.set("c", png(3));
  assert.equal(cache.get("b"), undefined, "the least recently read image goes first");
  assert.equal(cache.get("a"), png(1));
  cache.set("huge", Buffer.alloc(400, 1).toString("base64"));
  assert.equal(cache.get("huge"), undefined, "an image larger than the whole cache is not kept");
  cache.set("junk", "not base64!");
  assert.equal(cache.size, 2);
});

test("a chat's image previews are fetched once, not on every refresh", async () => {
  const api = new HarnessApi(undefined, legacyFetch, { historyWorker: false });
  let attachmentReads = 0;
  api.rpc = async (method) => {
    if (method === "session.attachment") { attachmentReads += 1; return { data: png(7) }; }
    return { events: [{ event: { type: "user/message", seq: 1, data: { source: { kind: "user" }, content: [
      { type: "image", attachment: { attachmentId: "shot", mediaType: "image/png", bytes: 64, name: "shot.png" } },
    ] } } }], hasMore: false };
  };
  for (let read = 0; read < 3; read += 1) {
    const view = await api.history("chat");
    assert.equal(view.messages[0].attachments[0].data, png(7));
  }
  assert.equal(attachmentReads, 1);
});

test("a refresh that starts while an older page loads cannot drop that page", async () => {
  const api = new HarnessApi(undefined, legacyFetch, { historyWorker: false });
  let releaseOlder;
  const olderHeld = new Promise((resolve) => { releaseOlder = resolve; });
  api.rpc = async (_method, payload) => {
    if (payload.beforeSeq) { await olderHeld; return { events: [userText(1), userText(2)], hasMore: false }; }
    return { events: [userText(3), userText(4)], hasMore: true };
  };
  await api.history("chat");
  const older = api.history("chat", { older: true });
  const refresh = api.history("chat");
  releaseOlder();
  assert.equal((await older).messages.length, 4);
  const refreshed = await refresh;
  assert.deepEqual(refreshed.messages.map(({ text }) => text), ["message-1", "message-2", "message-3", "message-4"]);
  assert.equal(refreshed.hasOlder, false);
});
