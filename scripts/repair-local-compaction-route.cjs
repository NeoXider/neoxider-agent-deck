// Explicit repair for profiles using native compaction with LM Studio. The
// billion-context fetch interceptor and native checkpoints must not own the
// same conversation. Disable the interceptor (retain its installed files),
// pin local summary routes, and require a restart to release its fetch patch.
const fs = require("node:fs");
const path = require("node:path");

function repairRows(rows, { hasBillionContext = false } = {}) {
  const models = rows.find(row => row.id === "llm-pi-ai")?.config?.providers?.openai?.models || [];
  const ids = new Set(models.map(model => model.id));
  let policies = 0;
  function visit(value) {
    if (!value || typeof value !== "object") return;
    if (value.id === "compaction-basic") {
      for (const policy of value.config?.modelPolicies || []) {
        if (policy.provider !== "openai" || !ids.has(policy.model)) continue;
        policy.summarizationProvider = "openai";
        policy.summarizationModel = policy.model;
        policies++;
      }
    }
    for (const child of Object.values(value)) visit(child);
  }
  visit(rows);
  if (hasBillionContext) {
    let entry = rows.find(row => row.id === "bili-native");
    if (!entry) rows.push(entry = { id: "bili-native" });
    entry.disabled = true;
  }
  return { models: ids.size, policies, interceptorDisabled: hasBillionContext };
}

function main() {
  const yaml = require("C:/Users/victor/AppData/Local/NeoXider/DeepSeek Harness Runtime/node_modules/js-yaml");
  class JsExpression { constructor(value) { this.value = value; } }
  const schema = yaml.DEFAULT_SCHEMA.extend(new yaml.Type("tag:yaml.org,2002:js", {
    kind: "scalar", construct: value => new JsExpression(value),
    instanceOf: JsExpression, represent: value => value.value,
  }));
  for (const home of [path.join(process.env.USERPROFILE, ".dsh"), path.join(process.env.APPDATA, "dsh-desktop", "harness")]) {
    const profile = path.join(home, "profiles", "web");
    const file = path.join(profile, "cordis.patch.yml");
    const manifest = JSON.parse(fs.readFileSync(path.join(profile, "package.json"), "utf8"));
    const original = fs.readFileSync(file, "utf8");
    const rows = yaml.load(original, { schema });
    const result = repairRows(rows, { hasBillionContext: manifest.dsh?.profile?.bundles?.includes("billion-context") });
    const updated = yaml.dump(rows, { schema, lineWidth: -1 });
    if (updated !== original) {
      fs.copyFileSync(file, file + `.before-compaction-route-${Date.now()}.bak`);
      fs.writeFileSync(file, updated);
    }
    console.log(JSON.stringify({ home, ...result, restartRequired: result.interceptorDisabled }));
  }
}

module.exports = { repairRows };
if (require.main === module) main();
