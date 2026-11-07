const test = require("node:test");
const assert = require("node:assert/strict");
const { goalActivation } = require("../src/goal-activation.cjs");

function apiAnswering(view) {
  const calls = [];
  return {
    calls,
    api: { ensureRemote: async () => ({ call: async (endpoint, args, timeout) => { calls.push({ endpoint, args, timeout }); return view; } }) },
  };
}

test("the live goal view says whether the goal may continue on its own", async () => {
  const armed = apiAnswering({ id: "g1", phase: "active", activation: "armed" });
  assert.equal(await goalActivation(armed.api, "s1"), "armed");
  assert.deepEqual(armed.calls, [{ endpoint: "goals/get", args: { agentId: "s1" }, timeout: 8000 }]);
  assert.equal(await goalActivation(apiAnswering({ phase: "active", activation: "disarmed" }).api, "s1"), "disarmed");
});

test("no goal, an unknown activation or the legacy generation answer nothing", async () => {
  assert.equal(await goalActivation(apiAnswering(undefined).api, "s1"), null);
  assert.equal(await goalActivation(apiAnswering({ activation: "sometimes" }).api, "s1"), null);
  assert.equal(await goalActivation({ ensureRemote: async () => null }, "s1"), null);
});
