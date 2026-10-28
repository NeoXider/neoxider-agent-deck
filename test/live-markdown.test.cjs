const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../src/renderer/app.js"), "utf8");
const body = source.slice(source.indexOf("function liveStableBoundary(text) {"), source.indexOf("function liveMarkdownNodes(html) {"));
const context = vm.createContext({});
vm.runInContext(body, context);
const boundary = (text) => context.liveStableBoundary(text);

test("a streaming answer is split before the newest top-level block", () => {
  const text = "## Plan\n\nFirst paragraph.\n\nSecond paragraph, still being writ";
  assert.equal(text.slice(boundary(text)), "First paragraph.\n\nSecond paragraph, still being writ", "a block whose first line is not finished cannot start the split");
  const done = "## Plan\n\nFirst paragraph.\n\nSecond paragraph.\nmore";
  assert.equal(done.slice(boundary(done)), "Second paragraph.\nmore");
  assert.equal(boundary("one line only"), 0);
});

test("a blank line inside a code fence never splits the answer", () => {
  const open = "Intro.\n\n```js\nconst a = 1;\n\nconst b = 2;\n";
  assert.equal(open.slice(boundary(open)), "```js\nconst a = 1;\n\nconst b = 2;\n", "the open fence and everything in it is the tail");
  const closed = "Intro.\n\n~~~\ncode\n\nmore code\n~~~\n\nAfter the block.\n";
  assert.equal(closed.slice(boundary(closed)), "After the block.\n");
  const mixed = "```\nnot closed by tildes\n~~~\n\nstill code\n";
  assert.equal(mixed.slice(boundary(mixed)), mixed, "only the same fence character closes a fence");
});

test("an indented line after a blank one still belongs to the block above it", () => {
  const list = "- first item\n\n  continued paragraph of the first item\n";
  assert.equal(boundary(list), 0);
  const quote = "> quoted\n\n    indented code\nnext\n";
  assert.equal(boundary(quote), 0, "an indented block cannot start the stable split");
  const later = "- item\n\n  more\n\nA new paragraph.\n";
  assert.equal(later.slice(boundary(later)), "A new paragraph.\n");
});
