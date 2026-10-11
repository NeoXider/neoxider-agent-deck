const test = require("node:test"), assert = require("node:assert/strict");
const { configure, LFM_ID } = require("../scripts/configure-lfm-local.cjs");
test("LFM has its real vision context, no invented thinking levels, and idempotent native policies", () => {
  const other = { id: "keep", contextWindow: 100000, maxTokens: 70000 };
  const rows = [{ id: "llm-pi-ai", config: { providers: { openai: { models: [other] } } } },
    { id: "preset", config: { plugins: [{ id: "compaction-basic", config: {} }] } }];
  configure(rows);
  const model = rows[0].config.providers.lmstudio.models.find(m => m.id === LFM_ID);
  assert.equal(model.contextWindow, 32768); assert.equal(model.maxTokens, 8192);
  assert.deepEqual(model.input, ["text", "image"]); assert.equal(model.reasoningEfforts, false);
  assert.deepEqual(other, { id: "keep", contextWindow: 100000, maxTokens: 70000 });
  const before = JSON.stringify(rows); configure(rows); assert.equal(JSON.stringify(rows), before);
});
test("Mercury leaves input and compaction headroom instead of reserving its entire context for output", () => {
  const mercury = { id: "agentmercury-qwen3.5-4b", contextWindow: 30160, maxTokens: 30001 };
  const rows = [{ id: "llm-pi-ai", config: { providers: { lmstudio: { models: [mercury] } } } },
    { id: "compaction-basic", config: { modelPolicies: [] } }];
  configure(rows); assert.equal(mercury.contextWindow, 60000); assert.equal(mercury.maxTokens, 16384);
  for (const p of rows[1].config.modelPolicies) {
    const m = rows[0].config.providers.lmstudio.models.find(m => m.id === p.model);
    assert.ok(m.contextWindow - m.maxTokens - p.headroomTokens > 0);
  }
});
test("local Mercury can use 32K without lowering the other-PC model context", () => {
  const rows = [{ id: "llm-pi-ai", config: { providers: {
    lmstudio: { models: [{ id: "agentmercury-qwen3.5-4b", name: "Mercury 60k [Этот ПК]" }] },
    openai: { models: [{ id: "agentmercury-qwen3.5-4b", name: "Mercury 60k [Второй ПК]" }] },
  } } }];
  configure(rows, { mercuryContext: 32768 });
  assert.equal(rows[0].config.providers.lmstudio.models[0].contextWindow, 32768);
  assert.equal(rows[0].config.providers.lmstudio.models[0].maxTokens, 8192);
  assert.match(rows[0].config.providers.lmstudio.models[0].name, /32k/);
  assert.equal(rows[0].config.providers.openai.models[0].contextWindow, 60000);
});
