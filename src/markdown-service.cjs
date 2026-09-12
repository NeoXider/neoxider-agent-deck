const { Worker } = require("node:worker_threads");
const path = require("node:path");

// Parsing, sanitizing and highlighting long replies must not block Electron's main
// event loop (window input, IPC and Harness traffic all share it).
let worker = null;
let nextId = 0;
const pending = new Map();

function getWorker() {
  if (worker) return worker;
  const current = new Worker(path.join(__dirname, "markdown.worker.cjs"));
  worker = current;
  const fail = (error) => {
    if (worker !== current) return;
    worker = null;
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  current.on("message", ({ id, html, error }) => {
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    if (error) request.reject(new Error(error));
    else request.resolve(html);
    if (!pending.size) current.unref();
  });
  current.on("error", fail);
  current.on("exit", (code) => fail(new Error(`Markdown worker exited (${code})`)));
  current.unref();
  return current;
}

function renderMarkdownBatch(texts) {
  if (!texts.length) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const current = getWorker();
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    current.ref();
    try { current.postMessage({ id, texts }); }
    catch (error) {
      pending.delete(id);
      if (!pending.size) current.unref();
      reject(error);
    }
  });
}

async function renderMarkdownAsync(text) {
  return (await renderMarkdownBatch([text]))[0];
}

module.exports = { renderMarkdownBatch, renderMarkdownAsync };
