const test = require("node:test");
const assert = require("node:assert/strict");
const { Worker } = require("node:worker_threads");
const { once } = require("node:events");


test("history worker reports request failures and accepts cache invalidation afterward", async () => {
  const worker = new Worker(require.resolve("../src/history-reader.worker.cjs"), {
    workerData: { baseUrl: "invalid-url", options: {} },
  });
  try {
    worker.postMessage({ id: 1, method: "read", sessionId: "chat" });
    const [failure] = await once(worker, "message");
    assert.equal(failure.id, 1);
    assert.equal(typeof failure.error, "string");
    worker.postMessage({ id: 2, method: "forget", sessionId: "chat" });
    const [success] = await once(worker, "message");
    assert.equal(success.id, 2);
    assert.equal(success.error, undefined);
    worker.postMessage({ id: 3, method: "ping" });
    const [health] = await once(worker, "message");
    assert.equal(health.value, true);
  } finally {
    await worker.terminate();
  }
});
