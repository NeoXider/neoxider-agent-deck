const fs = require("node:fs");
const path = require("node:path");
const { renderMarkdownAsync } = require("./markdown-service.cjs");
const { createHistoryReader } = require("./history-reader.cjs");

async function reportPackagedReadiness({ markerPath, version, requestQuit }) {
  try {
    const html = await renderMarkdownAsync("**Packaged worker ready**");
    if (!html.includes("<strong>Packaged worker ready</strong>")) throw new Error("Packaged Markdown worker failed");
    const historyWorker = await createHistoryReader("http://127.0.0.1:1").ping();
    if (historyWorker !== true) throw new Error("Packaged history worker failed");
    fs.mkdirSync(path.dirname(markerPath), { recursive: true });
    fs.writeFileSync(markerPath, JSON.stringify({ ready: true, markdownWorker: true, historyWorker, version }));
    setTimeout(() => requestQuit("packaged-smoke"), 100);
  } catch (error) {
    console.error(error);
    requestQuit("packaged-smoke-failed");
  }
}

module.exports = { reportPackagedReadiness };
