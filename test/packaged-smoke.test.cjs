const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { reportPackagedReadiness } = require("../src/packaged-smoke.cjs");

test("packaged readiness waits for a functioning Markdown worker and requests exit", async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "agent-deck-readiness-"));
  try {
    const markerPath = path.join(folder, "receipt.json");
    let quit;
    const exited = new Promise((resolve) => { quit = resolve; });
    await reportPackagedReadiness({ markerPath, version: "test-version", requestQuit: quit });
    assert.deepEqual(JSON.parse(fs.readFileSync(markerPath, "utf8")), {
      ready: true, markdownWorker: true, historyWorker: true, version: "test-version",
    });
    assert.equal(await exited, "packaged-smoke");
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
