const { Worker } = require("node:worker_threads");
const path = require("node:path");

// Keep network JSON parsing, hashing and tool/result derivation together off the
// main loop. Only the final display model crosses back from the worker.
function createHistoryReader(baseUrl, options = {}) {
  let worker = null;
  let sequence = 0;
  const pending = new Map();
  function getWorker() {
    if (worker) return worker;
    const current = new Worker(path.join(__dirname, "history-reader.worker.cjs"), { workerData: { baseUrl, options } });
    worker = current;
    const fail = (error) => {
      if (worker !== current) return;
      worker = null;
      for (const request of pending.values()) request.reject(error);
      pending.clear();
    };
    current.on("message", ({ id, value, error }) => {
      const request = pending.get(id);
      if (!request) return;
      pending.delete(id);
      if (error) request.reject(new Error(error));
      else request.resolve(value);
      if (!pending.size) current.unref();
    });
    current.on("error", fail);
    current.on("exit", (code) => fail(new Error(`History worker exited (${code})`)));
    current.unref();
    return current;
  }
  function request(method, sessionId) {
    return new Promise((resolve, reject) => {
      const current = getWorker();
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      current.ref();
      try { current.postMessage({ id, method, sessionId }); }
      catch (error) {
        pending.delete(id);
        if (!pending.size) current.unref();
        reject(error);
      }
    });
  }
  return {
    ping: () => request("ping"),
    read: (sessionId) => request("read", sessionId),
    forget: (sessionId) => { if (worker) void request("forget", sessionId).catch(() => {}); },
  };
}

module.exports = { createHistoryReader };
