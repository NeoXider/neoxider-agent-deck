const test = require("node:test");
const assert = require("node:assert/strict");
const { harnessNeedsAuth, startHarnessConnection } = require("../src/harness-connection.cjs");

test("authentication classification separates access failures from ordinary network failures", () => {
  for (const text of ["Harness launch URL is unknown", "token exchange returned 401", "unauthorized", "no session cookie"]) {
    assert.equal(harnessNeedsAuth(new Error(text)), true, text);
  }
  for (const text of ["fetch failed", "This operation was aborted", "session read failed"]) {
    assert.equal(harnessNeedsAuth(text), false, text);
  }
});

test("a refused Start is reported without pretending connection state changed", async () => {
  let invalidations = 0;
  const result = await startHarnessConnection({
    api: { reconnect: async () => { throw new Error("not responding"); } },
    launcher: { start: async () => ({ ok: false, reason: "token-required" }) },
    persistCapturedLaunchUrl() {},
    invalidateDashboard() { invalidations += 1; },
  });
  assert.deepEqual(result, { ok: false, reason: "token-required" });
  assert.equal(invalidations, 0);
});
