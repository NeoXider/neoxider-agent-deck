const { parentPort } = require("node:worker_threads");
const { createMarkdownCache } = require("./markdown.cjs");
const render = createMarkdownCache();

parentPort.on("message", async ({ id, texts }) => {
  try {
    const html = [];
    for (let index = 0; index < texts.length; index += 1) {
      html.push(render(texts[index]));
      // A live answer can be formatted between history chunks.
      if (index % 16 === 15) await new Promise((resolve) => setImmediate(resolve));
    }
    parentPort.postMessage({ id, html });
  } catch (error) {
    parentPort.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
});
