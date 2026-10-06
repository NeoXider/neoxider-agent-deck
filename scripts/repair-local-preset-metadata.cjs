const fs = require("node:fs"), path = require("node:path"), asar = require("@electron/asar");
const yaml = require("C:/Users/victor/AppData/Local/NeoXider/DeepSeek Harness Runtime/node_modules/js-yaml");
class JsExpression { constructor(value) { this.value = value; } }
const schema = yaml.DEFAULT_SCHEMA.extend(new yaml.Type("tag:yaml.org,2002:js", { kind: "scalar", construct: value => new JsExpression(value), instanceOf: JsExpression, represent: value => value.value }));
for (const desktop of [false, true]) {
  const home = desktop ? path.join(process.env.APPDATA, "dsh-desktop", "harness") : path.join(process.env.USERPROFILE, ".dsh");
  const file = path.join(home, "profiles", "web", "cordis.patch.yml");
  const rows = yaml.load(fs.readFileSync(file, "utf8"), { schema });
  const archive = path.join(process.env.LOCALAPPDATA, "Programs", "DSH Desktop", "resources", "app.asar");
  for (const mode of ["standard", "ptc", "minimal"]) {
    const relative = path.join("node_modules", "@deepseek-ai", "dsh-web-app", "presets", `${mode}.patch.yml`);
    const content = desktop ? asar.extractFile(archive, relative).toString() : fs.readFileSync(path.join(process.env.LOCALAPPDATA, "NeoXider", "DeepSeek Harness Runtime", relative), "utf8");
    const native = yaml.load(content, { schema }).flatMap(row => row.insert || []).find(row => row.config?.id === mode);
    for (const row of rows.filter(row => row.id === native.id)) row.config = { ...native.config, plugins: row.config.plugins };
  }
  fs.copyFileSync(file, file + `.before-preset-metadata-${Date.now()}.bak`);
  fs.writeFileSync(file, yaml.dump(rows, { schema, lineWidth: -1 }));
  console.log(JSON.stringify({ desktop, restoredPresetIds: ["standard", "ptc", "minimal"] }));
}
