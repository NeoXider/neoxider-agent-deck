const test = require("node:test");
const assert = require("node:assert/strict");
const { createExternalLinkOpener, parseExternalUrl } = require("../src/external-links.cjs");

test("only browser-safe external protocols are accepted", () => {
  assert.equal(parseExternalUrl("https://example.com/a b"), "https://example.com/a%20b");
  assert.equal(parseExternalUrl("http://example.com"), "http://example.com/");
  assert.equal(parseExternalUrl("mailto:dev@example.com"), "mailto:dev@example.com");

  for (const value of ["javascript:alert(1)", "data:text/html,test", "file:///tmp/a", "/relative", null]) {
    assert.equal(parseExternalUrl(value), null);
  }
});

test("the opener delegates normalized safe links and ignores rejected values", () => {
  const opened = [];
  const openExternalUrl = createExternalLinkOpener({ openExternal: (url) => opened.push(url) });

  assert.equal(openExternalUrl("https://example.com/a b"), true);
  assert.equal(openExternalUrl("javascript:alert(1)"), false);
  assert.deepEqual(opened, ["https://example.com/a%20b"]);
});

test("the opener requires an explicit browser adapter", () => {
  assert.throws(() => createExternalLinkOpener({}), /openExternal must be a function/);
});
