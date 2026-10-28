const test = require("node:test");
const assert = require("node:assert/strict");
const { MAX_ENTRIES, catalogLabels, childrenByParent, subagentTree } = require("../src/subagent-tree.cjs");

const now = Date.parse("2026-10-21T10:00:00Z");
const rows = [
  { sessionId: "parent", running: true, updatedAt: now, projections: { kind: "sequenced", asOfSeq: 9, values: { subagentCatalog: [
    { id: "child-a", createdAt: now - 9000, mode: "one-shot", label: "Read the parser" },
    { id: "child-b", createdAt: now - 8000, mode: "continuable", label: "Write tests" },
  ] } } },
  { sessionId: "child-a", origin: "subagent", parentSessionId: "parent", running: false, updatedAt: now - 5000,
    projections: { values: { subagentTiming: { settledMs: 42000, lastTurnCompleted: true } } } },
  { sessionId: "child-b", origin: "subagent", parentSessionId: "parent", running: true, updatedAt: now - 6000,
    projections: { values: { subagent: { mode: "continuable", label: "Write the tests", seq: 3 }, subagentTiming: { settledMs: 0, active: { since: now - 30000, through: now } } } } },
  { sessionId: "grandchild", origin: "subagent", parentSessionId: "child-b", running: false, updatedAt: now - 7000,
    projections: { values: { subagentTiming: { settledMs: 1000, lastTurnCompleted: false } } } },
  { sessionId: "other", running: false, updatedAt: now - 100 },
];

test("children are found by their parent's id in the session list itself", () => {
  const map = childrenByParent(rows);
  assert.deepEqual([...map.keys()].sort(), ["child-b", "parent"]);
  assert.deepEqual(map.get("parent").map((row) => row.sessionId), ["child-a", "child-b"]);
  assert.deepEqual([...catalogLabels(rows[0]).entries()], [["child-a", "Read the parser"], ["child-b", "Write tests"]]);
});

test("the tree is flat and depth-first, running children first, with labels, timing and outcome", () => {
  const tree = subagentTree("parent", childrenByParent(rows), rows[0]);
  assert.deepEqual(tree.map((entry) => [entry.sessionId, entry.depth]), [["child-b", 1], ["grandchild", 2], ["child-a", 1]]);
  const [writer, grandchild, reader] = tree;
  assert.equal(writer.title, "Write the tests", "the child's own descriptor outranks the parent's catalog label");
  assert.equal(writer.activity, "running");
  assert.equal(writer.runningSince, now - 30000);
  assert.equal(writer.childCount, 1);
  assert.equal(writer.kind, "child");
  assert.equal(reader.title, "Read the parser", "the parent's catalog label");
  assert.equal(reader.outcome, "done");
  assert.equal(reader.workedMs, 42000);
  assert.equal(grandchild.outcome, "failed");
  assert.equal(grandchild.title, "Subagent", "nothing to name it by");
  assert.equal(grandchild.parentSessionId, "child-b");
});

test("a session without children has an empty tree, and a cycle or a fan-out cannot run away", () => {
  assert.deepEqual(subagentTree("other", childrenByParent(rows)), []);
  const cyclic = childrenByParent([
    { sessionId: "x", parentSessionId: "y" },
    { sessionId: "y", parentSessionId: "x" },
  ]);
  assert.equal(subagentTree("x", cyclic).length, 1, "y once, and never x again under it");
  const many = Array.from({ length: 200 }, (_, index) => ({ sessionId: `c${index}`, parentSessionId: "p", updatedAt: index }));
  assert.equal(subagentTree("p", childrenByParent(many)).length, MAX_ENTRIES);
});

test("finished subagents are ordered by when they answered, the newest first, below the ones at work", () => {
  const at = (minutes) => new Date(now - minutes * 60000).toISOString();
  const child = (sessionId, running, updatedAt, settledMs) => ({ sessionId, origin: "subagent", parentSessionId: "lead", running, updatedAt,
    projections: { values: { subagentTiming: { settledMs } } } });
  const map = childrenByParent([
    // Started first but worked for 40 minutes: it answered last of the finished ones.
    child("long", false, at(50), 40 * 60000),
    child("quick", false, at(30), 60000),
    child("working", true, at(5), 0),
    child("seen", false, at(45), 1000),
  ]);
  const observed = new Map([["seen", now - 60000]]);
  const order = subagentTree("lead", map, null, { observedAnswer: (id) => observed.get(id) }).map((entry) => entry.sessionId);
  assert.deepEqual(order, ["working", "seen", "long", "quick"], "at work first, then the one seen answering a minute ago, then by prompt + work time");
});
