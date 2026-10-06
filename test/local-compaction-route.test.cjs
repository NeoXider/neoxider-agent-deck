const test = require("node:test");
const assert = require("node:assert/strict");
const { repairRows } = require("../scripts/repair-local-compaction-route.cjs");

test("local summary routes are pinned across presets without changing cloud policies", () => {
  const cloud = { provider: "deepseek", model: "cloud", summarizationProvider: "deepseek", summarizationModel: "summary" };
  const rows = [
    { id: "llm-pi-ai", config: { providers: { openai: { models: [{ id: "local" }] } } } },
    ...["standard", "ptc", "minimal"].map(mode => ({ id: `preset-${mode}`, config: { plugins: [
      { id: "compaction-basic", config: { modelPolicies: [{ provider: "openai", model: "local" }, { ...cloud }] } },
    ] } })),
  ];
  assert.deepEqual(repairRows(rows, { hasBillionContext: true }), { models: 1, policies: 3, interceptorDisabled: true });
  for (const row of rows.slice(1, 4)) {
    assert.deepEqual(row.config.plugins[0].config.modelPolicies, [
      { provider: "openai", model: "local", summarizationProvider: "openai", summarizationModel: "local" }, cloud,
    ]);
  }
  assert.deepEqual(rows.at(-1), { id: "bili-native", disabled: true });
  const after = JSON.stringify(rows);
  repairRows(rows, { hasBillionContext: true });
  assert.equal(JSON.stringify(rows), after, "repair is idempotent");
});

test("profiles without the conflicting interceptor receive no phantom plugin override", () => {
  const rows = [{ id: "other", config: { preserved: true } }];
  assert.deepEqual(repairRows(rows), { models: 0, policies: 0, interceptorDisabled: false });
  assert.deepEqual(rows, [{ id: "other", config: { preserved: true } }]);
});
