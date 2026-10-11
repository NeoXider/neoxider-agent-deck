const test = require("node:test"), assert = require("node:assert/strict");
const { migrate } = require("../scripts/migrate-dsh-persona.cjs");
test("alpha2 persona migration removes deployment-only cwd placeholders without touching other prompts", () => {
  const rows = [{ config: { plugins: [{ id: "persona", config: { prefix: "Powered by {{model}} in {{ cwd }}", suffix: "Your working directory is {{cwd}}." } }] } },
    { id: "other", config: { prompt: "{{cwd}}", secret: "keep" } }];
  assert.equal(migrate(rows), 2);
  assert.match(rows[0].config.plugins[0].config.prefix, /\{\{model\}\}/);
  assert.doesNotMatch(JSON.stringify(rows[0]), /\{\{\s*cwd/);
  assert.deepEqual(rows[1].config, { prompt: "{{cwd}}", secret: "keep" });
  assert.equal(migrate(rows), 0);
});
