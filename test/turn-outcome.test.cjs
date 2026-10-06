const test = require("node:test");
const assert = require("node:assert/strict");
const { turnOutcome, publicTurnReason } = require("../src/turn-outcome.cjs");

test("output cutoff requires attention rather than successful completion", () => {
  assert.equal(turnOutcome({ kind: "max-tokens" }).code, "output-token-limit");
  assert.match(turnOutcome({ kind: "max-tokens" }).text, /continue/);
  assert.equal(turnOutcome({ kind: "stop" }), null);
});

test("the public terminal frame retains the error message but no request secrets", () => {
  assert.deepEqual(publicTurnReason({ kind: "error", error: { message: "provider unavailable", apiKey: "not-public" } }), { kind: "error", error: { message: "provider unavailable" } });
  assert.deepEqual(publicTurnReason({ kind: "max-tokens" }), { kind: "max-tokens" });
});
