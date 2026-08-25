const test = require("node:test");
const assert = require("node:assert/strict");
const { renderMarkdown } = require("../src/markdown.cjs");

test("markdown renders the structures used in agent replies", () => {
  const html = renderMarkdown("## Result\n\n- one\n- **two**\n\n```js\nconst ok = true;\n```");
  assert.match(html, /<h2>Result<\/h2>/);
  assert.match(html, /<ul>/);
  assert.match(html, /<strong>two<\/strong>/);
  assert.match(html, /<pre><code class="language-js">|<pre><code>/);
});

test("markdown removes executable HTML and unsafe links", () => {
  const html = renderMarkdown('<script>alert(1)</script> [bad](javascript:alert(1)) [safe](https://example.com)');
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /href=["']javascript:/i);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /href="https:\/\/example\.com"/);
  assert.match(html, /rel="noopener noreferrer"/);
});
