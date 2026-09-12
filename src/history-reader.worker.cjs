const { parentPort, workerData } = require("node:worker_threads");
const { HarnessApi } = require("./harness-api.cjs");
const api = new HarnessApi(workerData.baseUrl, globalThis.fetch, { ...workerData.options, historyWorker: false });
const sessions = new Map();
async function respond({ id, method, sessionId }) {
  try {
    const value = method === "ping" ? true : method === "forget" ? api.forgetSession(sessionId) : await api.history(sessionId);
    parentPort.postMessage({ id, value });
  } catch (error) {
    parentPort.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
}
parentPort.on("message", (request) => {
  if (request.method === "ping") { void respond(request); return; }
  // Reads and invalidation for one session must preserve arrival order: an old
  // in-flight read must not repopulate the cache after forget has completed.
  const key = String(request.sessionId || "");
  const previous = sessions.get(key) || Promise.resolve();
  const next = previous.then(() => respond(request));
  sessions.set(key, next);
  void next.finally(() => { if (sessions.get(key) === next) sessions.delete(key); });
});
