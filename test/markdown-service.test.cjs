const test = require("node:test");
const assert = require("node:assert/strict");
const { renderMarkdown } = require("../src/markdown.cjs");

test("worker markdown keeps main-loop timers responsive and matches sanitized rendering", async () => {
  const { renderMarkdownBatch, renderMarkdownAsync } = require("../src/markdown-service.cjs");
  const texts = Array.from({ length: 160 }, (_, index) => `## Reply ${index}\n\n${'A <safe> paragraph.\n'.repeat(40)}`);
  let ticked = false;
  setImmediate(() => { ticked = true; });
  const result = await renderMarkdownBatch(texts);
  assert.equal(ticked, true);
  assert.equal(result.length, texts.length);
  assert.equal(result[159], renderMarkdown(texts[159]));
  const dangerous = '[bad](javascript:alert(1)) <script>alert(1)</script>';
  assert.equal(await renderMarkdownAsync(dangerous), renderMarkdown(dangerous));
});
