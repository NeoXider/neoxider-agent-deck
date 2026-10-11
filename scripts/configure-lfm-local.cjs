const fs = require("node:fs");
const path = require("node:path");
const LFM_ID = "lfm2.5-vl-3b";
function configure(rows, { mercuryContext = 60000 } = {}) {
  const providers = rows.find(row => row.id === "llm-pi-ai")?.config?.providers;
  if (!providers) throw new Error("Configured provider service is missing");
  const local = providers.lmstudio ||= { api: "openai-completions", baseURL: "http://127.0.0.1:1234/v1", apiKeyEnv: "LMSTUDIO_API_KEY", models: [] };
  local.models ||= [];
  const definition = { id: LFM_ID, name: "LFM 2.5 VL 3B 👁 32k [Этот ПК]", contextWindow: 32768, maxTokens: 8192,
    input: ["text", "image"], reasoningEfforts: false,
    compat: { supportsDeveloperRole: false, supportsReasoningEffort: false, supportsStrictMode: false, maxTokensField: "max_tokens" } };
  const existing = local.models.find(model => model.id === LFM_ID);
  if (existing) Object.assign(existing, definition); else local.models.push(definition);
  // A 60K context cannot also reserve 60K for output. Keep meaningful input
  // headroom without changing the selected model or other model budgets.
  for (const [id, provider] of Object.entries(providers)) for (const model of provider.models || []) {
    if (model.id === "agentmercury-qwen3.5-4b") {
      const context = id === "lmstudio" ? mercuryContext : 60000;
      Object.assign(model, { contextWindow: context, maxTokens: context >= 60000 ? 16384 : Math.floor(context / 4) });
      if (id === "lmstudio" && model.name) model.name = model.name.replace(/\d+k/, `${Math.floor(context / 1024)}k`);
    }
  }
  function visit(value) {
    if (!value || typeof value !== "object") return;
    if (value.id === "compaction-basic") {
      const policies = (value.config ||= {}).modelPolicies ||= [];
      for (const [provider, model, tokens] of [["lmstudio", LFM_ID, 2048], ...Object.entries(providers)
        .filter(([, p]) => p.models?.some(m => m.id === "agentmercury-qwen3.5-4b"))
        .map(([id]) => [id, "agentmercury-qwen3.5-4b", 4096])]) {
        let policy = policies.find(p => p.provider === provider && p.model === model);
        if (!policy) policies.push(policy = { provider, model });
        delete policy.retainTokens;
        Object.assign(policy, { thresholdRatio: 0.6, retainRatio: 0.08, headroomTokens: 2048,
          summarizationProvider: provider, summarizationModel: model, maxTokens: tokens });
      }
    }
    if (value.id === "lmstudio-output-budget" && value.config?.models?.["agentmercury-qwen3.5-4b"] !== undefined) {
      value.config.models["agentmercury-qwen3.5-4b"] = 16384;
    }
    for (const child of Object.values(value)) visit(child);
  }
  visit(rows);
  return rows;
}
function main() {
  const yaml = require(path.join(process.env.LOCALAPPDATA, "NeoXider", "DeepSeek Harness Runtime", "node_modules", "js-yaml"));
  class JsExpression { constructor(value) { this.value = value; } }
  const schema = yaml.DEFAULT_SCHEMA.extend(new yaml.Type("tag:yaml.org,2002:js", { kind: "scalar", construct: value => new JsExpression(value), instanceOf: JsExpression, represent: value => value.value }));
  for (const home of [path.join(process.env.USERPROFILE, ".dsh"), path.join(process.env.APPDATA, "dsh-desktop", "harness")]) {
    const file = path.join(home, "profiles", "web", "cordis.patch.yml");
    const original = fs.readFileSync(file, "utf8");
    const requestedContext = Number(process.argv[process.argv.indexOf("--mercury-context") + 1]);
    const mercuryContext = process.argv.includes("--mercury-context") ? requestedContext : 60000;
    if (!Number.isSafeInteger(mercuryContext) || mercuryContext < 16384) throw new Error("Invalid Mercury context");
    const rows = configure(yaml.load(original, { schema }), { mercuryContext });
    fs.copyFileSync(file, file + `.before-lfm-${Date.now()}.bak`);
    fs.writeFileSync(file, yaml.dump(rows, { schema, lineWidth: -1 }));
    fs.copyFileSync(path.join(__dirname, "../integrations/dsh-lmstudio-budget/compaction.mjs"), path.join(home, "maintenance", "agent-deck-compaction-factory.mjs"));
    console.log(JSON.stringify({ home, added: LFM_ID, context: 32768, output: 8192, vision: true }));
  }
}
module.exports = { configure, LFM_ID };
if (require.main === module) main();
