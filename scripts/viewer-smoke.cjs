// Opens the real viewer window on a Markdown document, a code file at a line, and an image,
// checks what each page drew, and saves a screenshot of each to tmp/viewer-smoke/.
// Run with: npm run test:viewer
const { app, BrowserWindow, clipboard, ipcMain, nativeImage, screen, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { createViewer } = require("../src/viewer-window.cjs");

const root = path.join(__dirname, "..");
const output = path.join(root, "tmp", "viewer-smoke");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  const viewer = createViewer({ BrowserWindow, ipcMain, screen, shell, clipboard, nativeImage, app, getWindowLayer: () => "normal" });
  const failures = [];
  const capture = async (name, check) => {
    await wait(700);
    const window = viewer.window();
    const state = await window.webContents.executeJavaScript(`(${check})()`);
    const image = await window.webContents.capturePage();
    fs.writeFileSync(path.join(output, `${name}.png`), image.toPNG());
    process.stdout.write(`${state.ok ? "✓" : "✗"} ${name} ${JSON.stringify(state)}\n`);
    if (!state.ok) failures.push(name);
  };
  try {
    await viewer.openPath("CHANGELOG.md", { cwd: root });
    await capture("markdown", `() => {
      const doc = document.querySelector(".doc");
      return { ok: Boolean(doc && doc.querySelector("h1, h2") && document.querySelector('.segmented [aria-pressed="true"]')?.textContent === "Preview"), headings: doc?.querySelectorAll("h2").length || 0 };
    }`);
    await viewer.openPath("src/viewer-content.cjs:60", { cwd: root });
    await capture("code", `() => {
      const lines = document.querySelector(".gutter")?.textContent.split("\\n").length || 0;
      return { ok: lines > 100 && Boolean(document.querySelector(".hljs-keyword")) && Boolean(document.querySelector(".line-mark")) && document.querySelector("#stage").scrollTop > 0, lines };
    }`);
    await viewer.openPath(path.join(root, "src", "renderer", "assets", "neoxider-github.png"));
    await capture("image", `() => {
      const image = document.querySelector(".image-stage img");
      return { ok: Boolean(image?.complete && image.naturalWidth > 0) && /^\\d+%$/.test(document.querySelector(".zoom-value")?.textContent || "") && document.querySelector("#itemMeta").textContent.startsWith("1254 × 1254"), width: image?.naturalWidth || 0 };
    }`);
    await viewer.openPath("no/such/file.md", { cwd: root });
    await capture("missing", `() => ({ ok: document.querySelector(".empty-card b")?.textContent === "File not found" })`);
  } catch (error) {
    failures.push(String(error?.stack || error));
  }
  viewer.close();
  if (failures.length) {
    process.stderr.write(`Viewer smoke failed: ${failures.join(", ")}\n`);
    app.exit(1);
  } else {
    app.exit(0);
  }
});
