const test = require("node:test");
const assert = require("node:assert/strict");
const { Worker } = require("node:worker_threads");
const { once } = require("node:events");
const path = require("node:path");

test("worker returns rendering errors without losing the next request", async () => {
  const worker = new Worker(path.join(__dirname, "../src/markdown.worker.cjs"));
  try {
    worker.postMessage({ id: 1, texts: null });
    const [failure] = await once(worker, "message");
    assert.equal(failure.id, 1);
    assert.equal(typeof failure.error, "string");
    worker.postMessage({ id: 2, texts: ["**recovered**"] });
    const [success] = await once(worker, "message");
    assert.equal(success.id, 2);
    assert.match(success.html[0], /<strong>recovered<\/strong>/);
  } finally {
    await worker.terminate();
  }
});
