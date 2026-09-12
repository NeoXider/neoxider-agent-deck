const test = require("node:test");
const assert = require("node:assert/strict");
const { renderMarkdown, createMarkdownCache } = require("../src/markdown.cjs");

test("markdown renders the structures used in agent replies", () => {
  const html = renderMarkdown("## Result\n\n- one\n- **two**\n\n```js\nconst ok = true;\n```");
  assert.match(html, /<h2>Result<\/h2>/);
  assert.match(html, /<ul>/);
  assert.match(html, /<strong>two<\/strong>/);
  assert.match(html, /<pre><code class="language-js">|<pre><code>/);
});

test("fenced code receives Highlight.js token classes", () => {
  const html = renderMarkdown('```js\nconst answer = "safe"; // highlighted\n```');
  assert.match(html, /<code class="language-js">/);
  assert.match(html, /class="hljs-keyword"/);
  assert.match(html, /class="hljs-string"/);
  assert.match(html, /class="hljs-comment"/);
});

test("code without a known language uses safe automatic highlighting", () => {
  const html = renderMarkdown('```unknown-language\n{"enabled": true, "count": 2}\n```');
  assert.match(html, /<pre><code class="language-unknown-language">/);
  assert.match(html, /class="hljs-(?:attr|literal|number|string)"/);
  assert.doesNotMatch(html, /style=|on\w+=/i);
});

test("markdown removes executable HTML and unsafe links", () => {
  const html = renderMarkdown('<script>alert(1)</script> <span class="hljs-keyword unsafe" onclick="alert(1)">raw</span> [bad](javascript:alert(1)) [safe](https://example.com)');
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /<span/i);
  assert.doesNotMatch(html, /<[^>]+(?:onclick=|class="unsafe")/i);
  assert.doesNotMatch(html, /href=["']javascript:/i);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;span class=/);
  assert.match(html, /href="https:\/\/example\.com"/);
  assert.match(html, /rel="noopener noreferrer"/);
});

test("fence metadata cannot inject attributes or non-highlight classes", () => {
  const html = renderMarkdown('```js" onclick="alert(1)\nconst safe = true;\n```');
  assert.doesNotMatch(html, /onclick=|<script|class="[^"]*unsafe/i);
  assert.match(html, /<pre><code/);
  assert.match(html, /class="hljs-(?:keyword|literal)"/);
});

test("large code fences preserve all content without expensive highlighting", () => {
  const code = 'const value = "<safe>";\n'.repeat(2000);
  for (const language of ["js", "unknown-language"]) {
    const html = renderMarkdown(`\`\`\`${language}\n${code}\`\`\``);
    assert.doesNotMatch(html, /hljs-/);
    assert.equal((html.match(/&lt;safe&gt;/g) || []).length, 2000);
    assert.match(html, /<\/code><\/pre>/);
  }
});

test("markdown cache is LRU and bounded by both entries and retained string bytes", () => {
  const calls = [];
  const render = (text) => { calls.push(text); return text; };
  const cached = createMarkdownCache({ maxEntries: 2, maxBytes: 16, render });
  cached("a"); cached("b"); cached("a"); cached("c"); cached("b");
  assert.deepEqual(calls, ["a", "b", "c", "b"]);
  cached("12345"); cached("12345"); // Too large for cache; does not evict b.
  cached("b");
  assert.deepEqual(calls, ["a", "b", "c", "b", "12345", "12345"]);
  cached("1234"); cached("b"); // Fits alone, evicting both smaller entries.
  assert.deepEqual(calls.slice(-2), ["1234", "b"]);
});
