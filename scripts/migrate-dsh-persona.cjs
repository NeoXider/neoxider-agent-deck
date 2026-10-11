const fs = require("node:fs"), path = require("node:path");
function migrate(rows) {
  let changed = 0;
  function visit(value) {
    if (!value || typeof value !== "object") return;
    if (value.id === "persona" && value.config) for (const field of ["prefix", "suffix"]) {
      const text = value.config[field];
      if (typeof text !== "string" || !/\{\{\s*cwd\s*\}\}/.test(text)) continue;
      value.config[field] = text.replace(/Your working directory is \{\{\s*cwd\s*\}\}\./g, "Tools use the current session workspace.")
        .replace(/\{\{\s*cwd\s*\}\}/g, "the current session workspace");
      changed++;
    }
    for (const child of Object.values(value)) visit(child);
  }
  visit(rows); return changed;
}
function main() {
  const yaml = require(path.join(process.env.LOCALAPPDATA, "NeoXider", "DeepSeek Harness Runtime", "node_modules", "js-yaml"));
  class JsExpression { constructor(value) { this.value = value; } }
  const schema = yaml.DEFAULT_SCHEMA.extend(new yaml.Type("tag:yaml.org,2002:js", { kind: "scalar", construct: value => new JsExpression(value), instanceOf: JsExpression, represent: value => value.value }));
  const home = path.join(process.env.USERPROFILE, ".dsh");
  const files = [path.join(home, "profiles", "web", "cordis.patch.yml")];
  const presets = path.join(home, ".agent-presets");
  for (const entry of fs.readdirSync(presets, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const file = path.join(presets, entry.name, "agent.cordis.yml");
      if (fs.existsSync(file)) files.push(file);
    }
  }
  let changed = 0;
  for (const file of files) {
    const original = fs.readFileSync(file, "utf8"), rows = yaml.load(original, { schema });
    const count = migrate(rows);
    if (!count) continue;
    fs.copyFileSync(file, file + `.before-alpha2-persona-${Date.now()}.bak`);
    fs.writeFileSync(file, yaml.dump(rows, { schema, lineWidth: -1 }));
    changed += count;
  }
  console.log(JSON.stringify({ changed, preservedSupportedVariables: ["provider", "model"] }));
}
module.exports = { migrate };
if (require.main === module) main();
