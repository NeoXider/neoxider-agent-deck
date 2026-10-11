const fs = require("node:fs"), path = require("node:path");

function freeModels(catalog) {
  return catalog.filter(m => isFreeId(m.id) && Number(m.pricing?.prompt) === 0 &&
    Number(m.pricing?.completion) === 0 && m.supported_parameters?.includes("tools") &&
    m.architecture?.input_modalities?.includes("text") && m.context_length > 0).map(m => ({
    id: m.id, name: `${m.name}${m.architecture.input_modalities.includes("image") ? " 👁" : ""} · Free`,
    contextWindow: m.context_length,
    maxTokens: Math.min(m.top_provider?.max_completion_tokens || 16384, 16384, Math.floor(m.context_length / 4)),
    input: m.architecture.input_modalities.filter(x => ["text", "image"].includes(x)),
    compat: { supportsDeveloperRole: false, supportsStrictMode: false, supportsStore: false },
  }));
}
function isFreeId(id) {
  // Ling's current zero-priced route has no :free suffix; the old alias returns 404.
  return id?.endsWith(":free") || id === "inclusionai/ling-3.1-flash" || id === "openrouter/free";
}
function configure(rows, models) {
  if (!models.length || models.some(m => !isFreeId(m.id))) throw new Error("Explicit free models required");
  const service = rows.find(row => row.id === "llm-pi-ai");
  if (!service?.config?.providers) throw new Error("Provider configuration is missing");
  service.config.providers.openrouter = { displayName: "OpenRouter · Free", api: "openai-completions",
    baseURL: "https://openrouter.ai/api/v1", apiKeyEnv: "OPENROUTER_API_KEY", models };
  for (const id of ["llm-deepseek", "llm-deepseek-account"]) {
    let row = rows.find(row => row.id === id);
    if (!row) rows.push(row = { id });
    row.disabled = true;
  }
  return rows;
}
async function main() {
  const response = await fetch("https://openrouter.ai/api/v1/models");
  if (!response.ok) throw new Error(`Catalog HTTP ${response.status}`);
  const models = freeModels((await response.json()).data);
  const yaml = require(path.join(process.env.LOCALAPPDATA, "NeoXider", "DeepSeek Harness Runtime", "node_modules", "js-yaml"));
  class JsExpression { constructor(value) { this.value = value; } }
  const schema = yaml.DEFAULT_SCHEMA.extend(new yaml.Type("tag:yaml.org,2002:js", { kind: "scalar", construct: v => new JsExpression(v), instanceOf: JsExpression, represent: v => v.value }));
  // Credentials remain outside the repository; copy only the requested reference.
  const source = yaml.load(fs.readFileSync(path.join(process.env.USERPROFILE, ".dsh", ".credentials.yaml"), "utf8"));
  if (!source.refs?.OPENROUTER_API_KEY) throw new Error("Store OPENROUTER_API_KEY in DSH credentials first");
  const desktopCredentials = path.join(process.env.APPDATA, "dsh-desktop", "harness", ".credentials.yaml");
  const desktop = yaml.load(fs.readFileSync(desktopCredentials, "utf8"));
  if (desktop.refs?.OPENROUTER_API_KEY !== source.refs.OPENROUTER_API_KEY) {
    fs.copyFileSync(desktopCredentials, desktopCredentials + `.before-openrouter-${Date.now()}.bak`);
    (desktop.refs ||= {}).OPENROUTER_API_KEY = source.refs.OPENROUTER_API_KEY;
    fs.writeFileSync(desktopCredentials, yaml.dump(desktop, { lineWidth: -1 }));
  }
  for (const home of [path.join(process.env.USERPROFILE, ".dsh"), path.join(process.env.APPDATA, "dsh-desktop", "harness")]) {
    const file = path.join(home, "profiles", "web", "cordis.patch.yml");
    const rows = configure(yaml.load(fs.readFileSync(file, "utf8"), { schema }), models);
    fs.copyFileSync(file, file + `.before-openrouter-${Date.now()}.bak`);
    fs.writeFileSync(file, yaml.dump(rows, { schema, lineWidth: -1 }));
    console.log(JSON.stringify({ home, freeModels: models.length, directDeepSeekDisabled: true }));
  }
}
module.exports = { freeModels, configure };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
