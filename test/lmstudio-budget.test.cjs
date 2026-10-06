const test = require("node:test"), assert = require("node:assert/strict");

test("local resume uses its declared budget while other providers and explicit caps are retained", async () => {
  const { apply } = await import("../integrations/dsh-lmstudio-budget/index.mjs");
  let handler;
  apply({ on: (name, callback) => { assert.equal(name, "agent/request"); handler = callback; } }, { models: { local: 32768 } });
  for (const cap of [undefined, 1]) assert.equal((await handler({}, async () => ({ provider: "openai", model: "local", maxTokens: cap }))).maxTokens, 32768);
  assert.equal((await handler({}, async () => ({ provider: "openai", model: "local", maxTokens: 128 }))).maxTokens, 128);
  assert.equal((await handler({}, async () => ({ provider: "other", model: "local" }))).maxTokens, undefined);
});
