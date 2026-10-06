// Generate version-matched profile overrides without editing bundled app code.
const fs = require("node:fs"), path = require("node:path"), asar = require("@electron/asar");
const yaml = require("C:/Users/victor/AppData/Local/NeoXider/DeepSeek Harness Runtime/node_modules/js-yaml");
class JsExpression { constructor(value) { this.value = value; } }
const schema = yaml.DEFAULT_SCHEMA.extend(new yaml.Type("tag:yaml.org,2002:js", { kind: "scalar", construct: value => new JsExpression(value), instanceOf: JsExpression, represent: value => value.value }));
const desktop = process.argv.includes("--desktop");
const home = desktop ? path.join(process.env.APPDATA, "dsh-desktop", "harness") : path.join(process.env.USERPROFILE, ".dsh");
const runtime = path.join(process.env.LOCALAPPDATA, "NeoXider", "DeepSeek Harness Runtime", "node_modules", "@deepseek-ai");
const archive = path.join(process.env.LOCALAPPDATA, "Programs", "DSH Desktop", "resources", "app.asar");
const maintenance = path.join(home, "maintenance");
fs.mkdirSync(maintenance, { recursive: true });
fs.copyFileSync(path.join(__dirname, "../integrations/dsh-lmstudio-budget/compaction.mjs"), path.join(maintenance, "agent-deck-compaction-factory.mjs"));
const base = desktop ? path.join(archive, "node_modules", "@deepseek-ai", "dsh-compaction-basic", "lib", "index.js") : path.join(runtime, "dsh-compaction-basic", "lib", "index.js");
const toUrl = value => "file:///" + value.replace(/\\/g, "/").replace(/ /g, "%20");
const engineFile = path.join(maintenance, "agent-deck-compaction.mjs");
fs.writeFileSync(engineFile, `import Base from ${JSON.stringify(toUrl(base))};\nimport { createCompactionEngine } from "./agent-deck-compaction-factory.mjs";\nexport default createCompactionEngine(Base);\n`);
const file = path.join(home, "profiles", "web", "cordis.patch.yml");
let source = fs.readFileSync(file, "utf8");
const entries = yaml.load(source, { schema });
const provider = entries.find(row => row.id === "llm-pi-ai").config.providers.openai;
const policies = provider.models.map(model => ({ provider: "openai", model: model.id, thresholdRatio: 0.20, retainRatio: 0.08, headroomTokens: 4096, maxTokens: 16384 }));
const overrides = [];
for (const mode of ["standard", "ptc", "minimal"]) {
  const relative = path.join("node_modules", "@deepseek-ai", "dsh-web-app", "presets", `${mode}.patch.yml`);
  const text = desktop ? asar.extractFile(archive, relative).toString() : fs.readFileSync(path.join(runtime, "dsh-web-app", "presets", `${mode}.patch.yml`), "utf8");
  const rows = yaml.load(text, { schema });
  const preset = rows.flatMap(row => row.insert || []).find(row => row.config?.id === mode);
  if (!preset) throw new Error(`Native ${mode} preset is missing`);
  let found = false;
  function visit(rows) {
    for (const row of rows) {
      if (row.id === "compaction-basic") { found = true; row.name = toUrl(engineFile); row.config = { ...row.config, modelPolicies: policies, auto: true }; }
      if (Array.isArray(row.config)) visit(row.config);
    }
  }
  visit(preset.config.plugins);
  if (!found) preset.config.plugins.push({ id: "local-compaction", name: "cordis:group", group: true, isolate: { compaction: true, toolResultPruner: true }, config: [
    { id: "compaction-basic", name: toUrl(engineFile), config: { modelPolicies: policies, auto: true } },
    { id: "command-compact", name: "@deepseek-ai/dsh-command-compact" },
  ] });
  overrides.push({ id: preset.id, config: preset.config });
}
const marker = "# Agent Deck version-matched local compaction overrides";
if (source.includes(marker)) throw new Error("Compaction overrides already exist; review before replacing them");
fs.copyFileSync(file, file + `.before-local-compaction-${Date.now()}.bak`);
fs.writeFileSync(file, source.trimEnd() + "\n\n" + marker + "\n" + yaml.dump(overrides, { schema, lineWidth: -1 }));
console.log(JSON.stringify({ desktop, modes: ["standard", "ptc", "minimal"], localModels: provider.models.length, engine: engineFile }));
