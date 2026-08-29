const test = require("node:test");
const assert = require("node:assert/strict");
const { activityFromHistory, sessionStateFromHistory, turnTimingFromHistory } = require("../src/session-activity.cjs");

const entry = (type, time, data = {}) => ({ event: { type, time, data } });

test("an open turn reports what the agent is doing", () => {
  assert.equal(activityFromHistory([entry("turn/start", 1)]).kind, "working");
  assert.equal(activityFromHistory([
    entry("turn/start", 1),
    entry("assistant/chunk", 2, { chunk: { type: "reasoning-delta", text: "weighing options" } }),
  ]).kind, "thinking");
  assert.equal(activityFromHistory([
    entry("turn/start", 1),
    entry("tool/call", 2, { callId: "c1", name: "read_file" }),
  ]).text, "read_file");
  assert.equal(activityFromHistory([entry("turn/start", 1), entry("turn/end", 3)]), null);
});

test("elapsed time comes from the open turn, in either timestamp format", () => {
  assert.deepEqual(
    turnTimingFromHistory([entry("turn/start", 1000), entry("tool/call", 1200, {})]),
    { runningSince: 1000, lastRunMs: null },
  );
  assert.deepEqual(
    turnTimingFromHistory([entry("turn/start", "2026-08-29T10:00:00.000Z")]).runningSince,
    Date.parse("2026-08-29T10:00:00.000Z"),
  );
});

test("a finished turn reports how long it took and stops the clock", () => {
  const timing = turnTimingFromHistory([
    entry("turn/start", 1000),
    entry("turn/end", 4500),
  ]);
  assert.deepEqual(timing, { runningSince: null, lastRunMs: 3500 });
});

test("the newest turn wins and a resumed turn restarts the clock", () => {
  const timing = turnTimingFromHistory([
    entry("turn/start", 1000),
    entry("turn/end", 2000),
    entry("turn/start", 9000),
  ]);
  assert.deepEqual(timing, { runningSince: 9000, lastRunMs: 1000 }, "still running, with the previous duration kept");
});

// Harness has been seen to emit a turn/end with no matching start after a reconnect, and a
// clock that reads "1978 years" is worse than no clock at all.
test("unusable timestamps produce no duration rather than a nonsense one", () => {
  assert.deepEqual(turnTimingFromHistory([entry("turn/end", 4000)]), { runningSince: null, lastRunMs: null });
  assert.deepEqual(turnTimingFromHistory([entry("turn/start", 5000), entry("turn/end", 1000)]).lastRunMs, null);
  assert.deepEqual(turnTimingFromHistory([entry("turn/start", "not a date")]).runningSince, null);
  assert.deepEqual(turnTimingFromHistory(null), { runningSince: null, lastRunMs: null });
  assert.deepEqual(turnTimingFromHistory([{}, { event: null }]), { runningSince: null, lastRunMs: null });
});

test("session state follows the last completed turn", () => {
  assert.equal(sessionStateFromHistory([entry("turn/end", 2, { reason: { kind: "error" } })]), "error");
  assert.equal(sessionStateFromHistory([entry("turn/end", 2, { reason: { kind: "done" } })]), "idle");
  assert.equal(sessionStateFromHistory([entry("turn/end", 2, { reason: { kind: "error" } })], true), "working");
  assert.equal(sessionStateFromHistory([]), "idle");
});
