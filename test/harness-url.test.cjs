const test = require("node:test");
const assert = require("node:assert/strict");
const { harnessSessionUrl } = require("../src/harness-url.cjs");

test("Harness session deep links use the installed frontend sessionId contract", () => {
  assert.equal(
    harnessSessionUrl("http://127.0.0.1:3080", "session-a/b"),
    "http://127.0.0.1:3080/?sessionId=session-a%2Fb",
  );
});

test("Harness root still opens when no session is selected", () => {
  assert.equal(harnessSessionUrl("http://127.0.0.1:3080", ""), "http://127.0.0.1:3080/");
});
