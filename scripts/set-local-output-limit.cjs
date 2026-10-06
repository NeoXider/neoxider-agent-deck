// Mechanical update of only the configured local provider and its pressure
// policies. Other providers, prompts, sessions and credentials are retained.
const fs = require("node:fs"), path = require("node:path");
const yaml = require("C:/Users/victor/AppData/Local/NeoXider/DeepSeek Harness Runtime/node_modules/js-yaml");
class JsExpression { constructor(value) { this.value = value; } }
const schema = yaml.DEFAULT_SCHEMA.extend(new yaml.Type("tag:yaml.org,2002:js", { kind: "scalar", construct: value => new JsExpression(value), instanceOf: JsExpression, represent: value => value.value }));
const tokens = Number(process.argv[2]);
if (!Number.isSafeInteger(tokens) || tokens < 128) throw new Error("Provide a positive output limit of at least 128 tokens");
for (const home of [path.join(process.env.USERPROFILE, ".dsh"), path.join(process.env.APPDATA, "dsh-desktop", "harness")]) {
  const file = path.join(home, "profiles", "web", "cordis.patch.yml");
  const original = fs.readFileSync(file, "utf8");
  const rows = yaml.load(original, { schema });
  const models = rows.find(row => row.id === "llm-pi-ai").config.providers.openai.models;
  for (const model of models) {
    if (model.contextWindow <= tokens + 4096) throw new Error(`${model.id}: output limit leaves no input budget`);
    model.maxTokens = tokens;
  }
  const ids = new Set(models.map(model => model.id));
  function visit(value) {
    if (!value || typeof value !== "object" || value instanceof JsExpression) return;
    if (value.id === "lmstudio-output-budget") for (const id of Object.keys(value.config.models)) if (ids.has(id)) value.config.models[id] = tokens;
    if (value.id === "compaction-basic") {
      value.name = "file:///" + path.join(home, "maintenance", "agent-deck-compaction.mjs").replace(/\\/g, "/");
      value.config ||= {};
      value.config.modelPolicies ||= [];
      for (const id of ids) {
        let policy = value.config.modelPolicies.find(p => (p.provider || p.target?.provider) === "openai" && (p.model || p.target?.model) === id);
        if (!policy) value.config.modelPolicies.push(policy = { provider: "openai", model: id });
        policy.provider = "openai";
        policy.model = id;
        policy.summarizationProvider = "openai";
        policy.summarizationModel = id;
        delete policy.target;
        Object.assign(policy, { thresholdRatio: 0.20, retainRatio: 0.08, headroomTokens: 4096, maxTokens: 16384 });
      }
    }
    for (const child of Object.values(value)) visit(child);
  }
  visit(rows);
  fs.copyFileSync(file, file + `.before-output-${tokens}-${Date.now()}.bak`);
  fs.writeFileSync(file, yaml.dump(rows, { schema, lineWidth: -1 }));
  console.log(JSON.stringify({ home, models: models.length, outputLimit: tokens, pressureRatio: 0.20, retentionRatio: 0.08 }));
}
