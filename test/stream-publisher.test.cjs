const test = require("node:test");
const assert = require("node:assert/strict");
const { createStreamPublisher, textFromContent } = require("../src/stream-publisher.cjs");

test("job counts track only active work and clear when all jobs settle", () => {
  const backgroundJobs = new Map();
  const sent = [];
  const publisher = createStreamPublisher({ queueSnapshots: new Map(), backgroundJobs, send: (...args) => sent.push(args) });
  publisher.publishJobs("s1", [{ status: "running" }, { status: "stopping" }, { status: "completed" }, { status: "failed" }]);
  assert.equal(backgroundJobs.get("s1"), 2);
  assert.equal(sent[0][1].event.data.count, 2);
  publisher.publishJobs("s1", []);
  assert.equal(backgroundJobs.has("s1"), false);
  assert.equal(sent[1][1].event.data.count, 0);
});

test("queue snapshots preserve queued and steering placements with monotonic revisions", () => {
  const snapshots = new Map();
  const sent = [];
  const publisher = createStreamPublisher({ queueSnapshots: snapshots, send: (channel, value) => sent.push({ channel, value }) });
  const first = publisher.publishQueue("s1", [
    { id: "q", placement: "queued", message: { content: [{ type: "text", text: "later" }] } },
    { id: "s", placement: "steering", message: { content: [{ type: "text", text: "now" }] } },
    { id: "c", placement: "context", message: { content: [{ type: "text", text: "hidden" }] } },
  ]);
  const second = publisher.publishQueue("s1", []);
  assert.equal(first.revision, 1);
  assert.deepEqual(first.items.map((item) => item.placement), ["queued", "steering"]);
  assert.deepEqual(second, { revision: 2, items: [] });
  assert.deepEqual(snapshots.get("s1"), second);
  assert.deepEqual(sent.map((entry) => entry.value.revision), [1, 2]);
});

test("durable queued images receive cached bounded previews", async () => {
  const snapshots = new Map();
  const sent = [];
  let reads = 0;
  const publisher = createStreamPublisher({
    queueSnapshots: snapshots,
    send: (_channel, value) => sent.push(value),
    readAttachment: async () => { reads += 1; return { attachment: { mediaType: "image/png" }, data: "AA==" }; },
  });
  const raw = [{ id: "q", placement: "queued", message: { content: [{ type: "image", attachment: {
    attachmentId: "a1", mediaType: "image/png", name: "shot.png", bytes: 1,
  } }] } }];
  publisher.publishQueue("s1", raw);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(snapshots.get("s1").items[0].attachments[0].data, "AA==");
  publisher.publishQueue("s1", raw);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(reads, 1);
});

test("queue preview cache is session scoped and retains no oversized response", async () => {
  const snapshots = new Map();
  const reads = [];
  const publisher = createStreamPublisher({
    queueSnapshots: snapshots,
    send: () => {},
    readAttachment: async (sessionId) => {
      reads.push(sessionId);
      return sessionId === "large"
        ? { attachment: { mediaType: "image/png" }, data: Buffer.alloc(1024 * 1024 + 1).toString("base64") }
        : { attachment: { mediaType: "image/png" }, data: sessionId === "a" ? "AA==" : "AQ==" };
    },
  });
  const raw = [{ id: "q", placement: "queued", message: { content: [{ type: "image", attachment: {
    attachmentId: "same-id", mediaType: "image/png", name: "shot.png", bytes: 1,
  } }] } }];
  publisher.publishQueue("a", raw); publisher.publishQueue("b", raw); publisher.publishQueue("large", raw);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(snapshots.get("a").items[0].attachments[0].data, "AA==");
  assert.equal(snapshots.get("b").items[0].attachments[0].data, "AQ==");
  assert.equal(snapshots.get("large").items[0].attachments[0].data, undefined);
  publisher.publishQueue("large", raw);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(reads, ["a", "b", "large"], "the small negative sentinel avoids retaining or re-fetching oversized bytes");
});

test("live publisher bounds TODOs and exposes the durable steering handoff", () => {
  const sent = [];
  const { publishLiveEvent } = createStreamPublisher({ queueSnapshots: new Map(), send: (channel, value) => sent.push({ channel, value }) });
  assert.equal(publishLiveEvent({ sessionId: "s1", event: { type: "todo/write", seq: 1, data: { todos: [{ content: "Do it", status: "in_progress" }] } } }), true);
  assert.equal(publishLiveEvent({ sessionId: "s1", event: { type: "user/message", seq: 2, data: { id: "m1", source: { kind: "user" }, content: [{ type: "text", text: "steer me" }] } } }), true);
  assert.deepEqual(sent[0].value.event.data.todos, [{ content: "Do it", status: "in_progress" }]);
  assert.deepEqual(sent[1].value.event.data, { messageId: "m1", sourceKind: "user", text: "steer me" });
  assert.equal(publishLiveEvent({ sessionId: "s1", event: { type: "unknown", seq: 3 } }), false);
});

test("live publisher exposes nested Code Mode tool starts and completions without raw payloads", () => {
  const sent = [];
  const publisher = createStreamPublisher({ queueSnapshots: new Map(), send: (channel, value) => sent.push([channel, value]) });
  assert.equal(publisher.publishLiveEvent({
    sessionId: "session-1",
    event: { type: "tool/code-dispatch-start", seq: 8, data: { subCallId: "root:code:1", name: "read", arguments: { path: "secret" } } },
  }), true);
  assert.equal(publisher.publishLiveEvent({
    sessionId: "session-1",
    event: { type: "tool/code-dispatch", seq: 9, data: { subCallId: "root:code:1", isError: false, content: [{ type: "text", text: "private result" }] } },
  }), true);
  assert.deepEqual(sent, [
    ["live-event", { sessionId: "session-1", event: { type: "tool/code-dispatch-start", seq: 8, data: { name: "read", callId: "root:code:1" } } }],
    ["live-event", { sessionId: "session-1", event: { type: "tool/code-dispatch", seq: 9, data: { callId: "root:code:1", isError: false } } }],
  ]);
});

test("user content flattening is safe and bounded", () => {
  assert.equal(textFromContent([{ type: "image" }, { type: "text", text: "hello" }]), "hello");
  assert.equal(textFromContent([{ type: "text", text: "x".repeat(5000) }]).length, 4000);
  assert.equal(textFromContent(null), "");
});
