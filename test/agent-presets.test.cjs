const test = require("node:test");
const assert = require("node:assert/strict");
const { listAgentPresets, sessionCreateOptions } = require("../src/agent-presets.cjs");

test("the roster is read from agentPresets/list and normalized for the picker", async () => {
  const calls = [];
  const api = {
    ensureRemote: async () => ({
      call: async (endpoint, args, timeout) => {
        calls.push({ endpoint, args, timeout });
        return {
          presets: [
            { id: "standard", isDefault: true },
            { id: "smart", name: " Умный ", description: " Thinks carefully. ", isDefault: false },
            { id: "old", isDefault: false, broken: "tool-subagent-list-agents: never started" },
            { name: "no id" },
            null,
          ],
        };
      },
    }),
  };
  assert.deepEqual(await listAgentPresets(api), [
    { id: "standard", name: null, description: "", isDefault: true },
    { id: "smart", name: "Умный", description: "Thinks carefully.", isDefault: false },
    { id: "old", name: null, description: "", isDefault: false, broken: "tool-subagent-list-agents: never started" },
  ]);
  assert.deepEqual(calls, [{ endpoint: "agentPresets/list", args: {}, timeout: 15000 }]);
});

test("the legacy generation has no roster", async () => {
  assert.deepEqual(await listAgentPresets({ ensureRemote: async () => null }), []);
});

test("a new session carries only a named preset", () => {
  assert.deepEqual(sessionCreateOptions({ workspaceId: "w", agentPreset: " smart " }), { workspaceId: "w", agentPreset: "smart" });
  assert.deepEqual(sessionCreateOptions({ workspaceId: "w", agentPreset: "" }), { workspaceId: "w" });
  assert.deepEqual(sessionCreateOptions({ agentPreset: 42 }), {});
  assert.deepEqual(sessionCreateOptions(), {});
});
