const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Most renderer tests read app.js as text or run pieces of it, so a script that no longer
// parses could pass them all and still leave the widget blank. Every page script must parse.
const rendererDir = path.join(__dirname, "..", "src", "renderer");
const html = fs.readFileSync(path.join(rendererDir, "index.html"), "utf8");
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((match) => match[1]);

test("every script the widget page loads exists and parses", () => {
  assert.ok(scripts.includes("app.js"));
  assert.ok(scripts.indexOf("app.js") === scripts.length - 1, "app.js loads last, after the modules it calls");
  for (const name of scripts) {
    const source = fs.readFileSync(path.join(rendererDir, name), "utf8");
    assert.doesNotThrow(() => new vm.Script(source, { filename: name }), `${name} parses`);
  }
});

test("every stylesheet the widget page links exists", () => {
  for (const [, href] of html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)) {
    assert.ok(fs.existsSync(path.join(rendererDir, href)), `${href} exists`);
  }
});
