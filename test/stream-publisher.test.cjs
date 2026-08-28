const test = require("node:test");
const assert = require("node:assert/strict");
const { createStreamPublisher, textFromContent } = require("../src/stream-publisher.cjs");

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

test("live publisher bounds TODOs and exposes the durable steering handoff", () => {
  const sent = [];
  const { publishLiveEvent } = createStreamPublisher({ queueSnapshots: new Map(), send: (channel, value) => sent.push({ channel, value }) });
  assert.equal(publishLiveEvent({ sessionId: "s1", event: { type: "todo/write", seq: 1, data: { todos: [{ content: "Do it", status: "in_progress" }] } } }), true);
  assert.equal(publishLiveEvent({ sessionId: "s1", event: { type: "user/message", seq: 2, data: { id: "m1", source: { kind: "user" }, content: [{ type: "text", text: "steer me" }] } } }), true);
  assert.deepEqual(sent[0].value.event.data.todos, [{ content: "Do it", status: "in_progress" }]);
  assert.deepEqual(sent[1].value.event.data, { messageId: "m1", sourceKind: "user", text: "steer me" });
  assert.equal(publishLiveEvent({ sessionId: "s1", event: { type: "unknown", seq: 3 } }), false);
});

test("user content flattening is safe and bounded", () => {
  assert.equal(textFromContent([{ type: "image" }, { type: "text", text: "hello" }]), "hello");
  assert.equal(textFromContent([{ type: "text", text: "x".repeat(5000) }]).length, 4000);
  assert.equal(textFromContent(null), "");
});
