const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { matchScore, rankEntries, findMessageHits, stepSession } = require("../src/renderer/quick-nav.js");

const source = fs.readFileSync(path.join(__dirname, "..", "src", "renderer", "quick-nav.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "..", "src", "renderer", "index.html"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "..", "src", "renderer", "deck.css"), "utf8");

const chats = [
  { title: "Unity gameplay pass", detail: "Play Mode checks completed" },
  { title: "Release verification", detail: "unity build failed on the runner" },
  { title: "Capability Hub", detail: "Dynamic MCP routing is ready" },
  { title: "Build review", detail: "Windows package passed" },
];

test("an empty query keeps every entry in the order it came", () => {
  assert.deepEqual(rankEntries(chats, "").map((entry) => entry.title), chats.map((entry) => entry.title));
  assert.deepEqual(rankEntries(chats, "   ", 2).length, 2);
});

test("a title match outranks a match in the secondary line, and every word must match", () => {
  assert.deepEqual(rankEntries(chats, "unity").map((entry) => entry.title), ["Unity gameplay pass", "Release verification"]);
  assert.deepEqual(rankEntries(chats, "BUILD").map((entry) => entry.title), ["Build review", "Release verification"]);
  assert.deepEqual(rankEntries(chats, "hub ready").map((entry) => entry.title), ["Capability Hub"]);
  assert.deepEqual(rankEntries(chats, "unity hub"), []);
  assert.ok(matchScore(chats[0], "uni") > matchScore(chats[0], "game"), "the start of the title scores above a later word");
  assert.ok(matchScore(chats[0], "game") > matchScore(chats[0], "ame"), "the start of a word scores above its middle");
  assert.equal(matchScore({ title: undefined, detail: null }, "x"), 0);
});

test("find reports the messages that hold the text, by index, whatever the case", () => {
  const messages = [
    { role: "user", text: "Check the Release notes" },
    { role: "tool", name: "read", result: "release everywhere in a payload" },
    { role: "assistant", text: "The release is ready." },
    { role: "assistant", text: "Nothing else." },
    null,
  ];
  assert.deepEqual(findMessageHits(messages, "release"), [0, 2]);
  assert.deepEqual(findMessageHits(messages, "  RELEASE  "), [0, 2]);
  assert.deepEqual(findMessageHits(messages, "absent"), []);
  assert.deepEqual(findMessageHits(messages, ""), []);
  assert.deepEqual(findMessageHits(undefined, "x"), []);
});

test("stepping through chats wraps at both ends and starts somewhere sensible", () => {
  const ids = ["a", "b", "c"];
  assert.equal(stepSession(ids, "a", 1), "b");
  assert.equal(stepSession(ids, "c", 1), "a");
  assert.equal(stepSession(ids, "a", -1), "c");
  assert.equal(stepSession(ids, "gone", 1), "a");
  assert.equal(stepSession(ids, null, -1), "c");
  assert.equal(stepSession(["only"], "only", 1), null, "one chat has nowhere to step to");
  assert.equal(stepSession([], "a", 1), null);
});

test("the switcher, find and chat stepping are wired to their keys and their markup", () => {
  // The module loads before app.js (which must stay last) and waits for the page to wire up.
  assert.match(html, /<script src="quick-nav\.js"><\/script>\s*<script src="engine-crash\.js"><\/script>/);
  assert.match(source, /document\.addEventListener\("DOMContentLoaded", \(\) => \{/);
  for (const id of ["quickNav", "quickNavInput", "quickNavList", "findBar", "findInput", "findCount", "findPrev", "findNext", "findClose"]) assert.ok(html.includes(`id="${id}"`), `#${id} exists`);
  assert.match(html, /<symbol id="icon-search"/);
  // Ctrl+K, Ctrl+F and Ctrl+Tab, taken ahead of the page's own key handling; Escape closes
  // these layers before anything under them.
  assert.match(source, /if \(key === "k" && !event\.shiftKey\)/);
  assert.match(source, /else if \(key === "f" && !event\.shiftKey\)/);
  assert.match(source, /else if \(event\.key === "Tab"\)/);
  assert.match(source, /if \(closeNav\(\) \|\| \(findBar\.contains\(document\.activeElement\) && closeFind\(\)\)\)/);
  assert.match(source, /\}, true\);\s*\n\s*globalThis\.quickNavView/);
  // Only the full widget answers: a compact window has no room for either layer.
  assert.match(source, /const usable = \(\) => state\.windowMode === "full"/);
  // Matches are painted with the Highlight API, so the transcript's own nodes are untouched.
  assert.match(source, /highlights\.set\("deck-find", new Highlight\(\.\.\.all\)\)/);
  assert.match(css, /::highlight\(deck-find-current\) \{ background-color:var\(--warning\)/);
  assert.match(css, /\.quick-nav\[hidden\] \{ display:none; \}/);
  assert.match(css, /\.find-bar\[hidden\] \{ display:none; \}/);
});
