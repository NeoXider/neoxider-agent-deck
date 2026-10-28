const test = require("node:test");
const assert = require("node:assert/strict");
const { createSubagentRegistry } = require("../src/subagent-registry.cjs");
const { childrenByParent } = require("../src/subagent-tree.cjs");

const row = (sessionId, running, mode) => ({ sessionId, origin: "subagent", parentSessionId: "lead", running,
  ...(mode ? { projections: { values: { subagent: { mode } } } } : {}) });

test("a subagent is addressed under its parent with the mode it was started in", () => {
  const registry = createSubagentRegistry();
  const items = [row("helper", true, "continuable"), { sessionId: "lead", running: true }];
  registry.update(childrenByParent(items), items);
  assert.deepEqual(registry.of("helper"), { parentSessionId: "lead", mode: "continuable" });
  assert.deepEqual(registry.address("helper"), { kind: "subagent", parentSessionId: "lead", childSessionId: "helper", mode: "unknown" });
  assert.deepEqual(registry.address("lead"), { kind: "session", sessionId: "lead" });
  assert.equal(registry.of("lead"), null);
});

test("the poll that first sees a subagent idle stands for its answer, and only listed children are kept", () => {
  let now = 1000;
  const registry = createSubagentRegistry({ now: () => now });
  const poll = (items) => registry.update(childrenByParent(items), items);
  poll([row("a", true), row("b", false), { sessionId: "lead", running: true }]);
  assert.equal(registry.answeredAt("a"), undefined, "nothing was seen finishing yet");
  now = 5000;
  poll([row("a", false), row("b", false)]);
  assert.equal(registry.answeredAt("a"), 5000);
  assert.equal(registry.answeredAt("b"), undefined, "a child already idle when first seen has no observed answer");
  now = 9000;
  poll([row("a", true)]);
  assert.equal(registry.answeredAt("a"), undefined, "working again: its last answer no longer orders it");
  poll([]);
  now = 12000;
  poll([row("a", false)]);
  assert.equal(registry.answeredAt("a"), undefined, "a child that left the list was forgotten, running state included");
  registry.clear();
  assert.equal(registry.of("a"), null);
});
