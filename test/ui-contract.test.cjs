const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = readFileSync(path.join(root, "src", "renderer", "index.html"), "utf8");
const renderer = readFileSync(path.join(root, "src", "renderer", "app.js"), "utf8");
const main = readFileSync(path.join(root, "src", "main.cjs"), "utf8");

test("visible widget copy is English and required controls are present", () => {
  assert.doesNotMatch(`${html}\n${renderer}`, /[\u0400-\u04ff]/);
  for (const id of [
    "contextMeter",
    "modelSelect",
    "reasoningSelect",
    "commandsButton",
    "workspaceSelect",
    "modeSelect",
    "attachButton",
    "orbMode",
    "edgeMode",
  ]) assert.match(html, new RegExp(`id="${id}"`));
});

test("window contract has no close control and supports avatar and edge modes", () => {
  assert.doesNotMatch(html, /id="(?:close|hide)Button"/);
  assert.match(main, /\["full", "orb", "edge"\]\.includes\(nextMode\)/);
  assert.match(main, /nextMode === "orb"/);
  assert.match(main, /event\.preventDefault\(\);\s*applyWindowMode\("edge"\)/);
});
