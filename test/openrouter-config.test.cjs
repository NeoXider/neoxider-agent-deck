const test = require("node:test"), assert = require("node:assert/strict");
const { freeModels, configure, rankModels } = require("../scripts/configure-openrouter-free.cjs");
test("intelligence order uses measured models, leaves unscored models explicit and router last", () => {
  const models = [{ id: "openrouter/free", name: "Router" }, { id: "thinkingmachines/inkling:free", name: "Inkling" },
    { id: "inclusionai/ling-3.1-flash", name: "Ling" }, { id: "unknown:free", name: "New" }];
  const sorted = rankModels(models);
  assert.equal(sorted[0].id, "inclusionai/ling-3.1-flash"); assert.match(sorted[0].name, /^01\./);
  assert.match(sorted[1].name, /^02\./); assert.match(sorted[2].name, /Без общей оценки/);
  assert.equal(sorted.at(-1).id, "openrouter/free"); assert.equal(models[0].name, "Router");
});
test("OpenRouter includes only explicit free tool-capable models and real modalities", () => {
  const base = { name: "Test", pricing: { prompt: "0", completion: "0" }, supported_parameters: ["tools"], architecture: { input_modalities: ["text", "image", "audio"] }, context_length: 32768 };
  const models = freeModels([{ ...base, id: "test:free" }, { ...base, id: "other-nonsuffix" }, { ...base, id: "paid:free", pricing: { prompt: "1", completion: "0" } }, { ...base, id: "safety:free", supported_parameters: [] }]);
  assert.equal(models.length, 1); assert.deepEqual(models[0].input, ["text", "image"]);
  assert.match(models[0].name, /^👁 /);
  assert.equal(models[0].maxTokens, 8192);
});
test("Ling uses its current zero-priced id rather than an unavailable :free alias", () => {
  const ling = { id: "inclusionai/ling-3.1-flash", name: "Ling", pricing: { prompt: "0", completion: "0" }, supported_parameters: ["tools"], architecture: { input_modalities: ["text"] }, context_length: 262144 };
  assert.equal(freeModels([ling]).length, 1);
  assert.equal(freeModels([{ ...ling, pricing: { prompt: "0.001", completion: "0" } }]).length, 0);
});
test("OpenRouter preserves local providers and disables only direct DeepSeek routes", () => {
  const local = { models: [{ id: "local" }] };
  const rows = [{ id: "llm-pi-ai", config: { providers: { lmstudio: local } } }, { id: "deepseek-llm-api-extensions", config: { keep: true } }];
  configure(rows, [{ id: "test:free" }]);
  assert.strictEqual(rows[0].config.providers.lmstudio, local);
  assert.equal(rows[1].disabled, undefined);
  assert.equal(rows.find(r => r.id === "llm-deepseek").disabled, true);
  const before = JSON.stringify(rows); configure(rows, [{ id: "test:free" }]); assert.equal(JSON.stringify(rows), before);
  assert.throws(() => configure(rows, [])); assert.throws(() => configure(rows, [{ id: "paid" }]));
});
