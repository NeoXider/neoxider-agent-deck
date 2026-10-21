const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createViewer, viewerLayerFor } = require("../src/viewer-window.cjs");

function fakeElectron() {
  const handlers = new Map();
  const sent = [];
  const windows = [];
  class FakeWindow {
    constructor(options) {
      this.options = options;
      this.destroyed = false;
      this.listeners = new Map();
      this.layer = null;
      this.webContents = {
        send: (channel, value) => sent.push({ channel, value }),
        setWindowOpenHandler: (handler) => { this.openHandler = handler; },
        on: () => {},
      };
      windows.push(this);
    }
    isDestroyed() { return this.destroyed; }
    loadFile(file, options) { this.loaded = { file, options }; return Promise.resolve(); }
    once(event, listener) { this.listeners.set(event, listener); }
    on(event, listener) { this.listeners.set(event, listener); }
    setMenu() {}
    setTitle(title) { this.title = title; }
    setAlwaysOnTop(value, level) { this.layer = { value, level }; }
    setContentProtection(value) { this.protected = value; }
    isMinimized() { return false; }
    show() { this.shown = true; }
    moveTop() {}
    focus() { this.focused = true; }
    close() { this.destroyed = true; this.listeners.get("closed")?.(); }
  }
  const opened = [];
  const electron = {
    BrowserWindow: FakeWindow,
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    screen: {
      getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }),
      getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }),
    },
    shell: { openExternal: async (url) => opened.push(["external", url]), openPath: async (target) => { opened.push(["path", target]); return ""; }, showItemInFolder: (target) => opened.push(["reveal", target]) },
    clipboard: { writeText: (text) => opened.push(["text", text]), writeImage: () => opened.push(["image"]) },
    nativeImage: { createFromDataURL: () => ({ getSize: () => ({ width: 800, height: 600 }), isEmpty: () => false }) },
    app: { getPath: () => os.tmpdir() },
  };
  return { electron, handlers, sent, windows, opened };
}

function tempFiles() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deck-viewer-"));
  fs.mkdirSync(path.join(root, "docs"));
  fs.writeFileSync(path.join(root, "docs", "plan.md"), "# Plan\n\nSee [notes](notes.md).\n");
  fs.writeFileSync(path.join(root, "docs", "notes.md"), "Notes\n");
  return root;
}

test("a file the chat names opens in one viewer window, reused for the next one", async () => {
  const { electron, sent, windows } = fakeElectron();
  const root = tempFiles();
  const viewer = createViewer({ ...electron, getWindowLayer: () => "game", capabilities: { layerLevels: true, captureExclusion: true, gameLayer: true } });
  const first = viewer.openPath("docs/plan.md", { cwd: root });
  windows[0]?.listeners.get("ready-to-show")?.();
  assert.deepEqual(await first, { ok: true, kind: "markdown" });
  assert.equal(windows.length, 1);
  assert.equal(windows[0].options.webPreferences.sandbox, true);
  assert.equal(windows[0].options.webPreferences.contextIsolation, true);
  assert.equal(windows[0].openHandler().action, "deny", "the viewer never opens windows of its own");
  assert.deepEqual(windows[0].layer, { value: true, level: "screen-saver" }, "above everything, like the widget");
  assert.equal(sent.at(-1).channel, "viewer:item");
  assert.equal(sent.at(-1).value.name, "plan.md");
  assert.equal(sent.at(-1).value.canReveal, true);
  await viewer.openPath(path.join(root, "docs", "notes.md:1"));
  assert.equal(windows.length, 1, "the same window shows the next file");
  assert.equal(windows[0].title, "notes.md");
  fs.rmSync(root, { recursive: true, force: true });
});

test("only the viewer page can use its channels, and links leave it the right way", async () => {
  const { electron, handlers, windows, opened } = fakeElectron();
  const root = tempFiles();
  const viewer = createViewer({ ...electron });
  await viewer.openPath(path.join(root, "docs", "plan.md"));
  const page = { sender: windows[0].webContents };
  await assert.rejects(handlers.get("viewer:reveal")({ sender: {} }), /Untrusted sender/);
  assert.equal((await handlers.get("viewer:get-item")(page)).kind, "markdown");
  await handlers.get("viewer:open-link")(page, "https://example.com/x");
  assert.deepEqual(opened.at(-1), ["external", "https://example.com/x"]);
  await handlers.get("viewer:open-link")(page, "notes.md");
  assert.equal((await handlers.get("viewer:get-item")(page)).name, "notes.md", "a relative link opens next to the document");
  await handlers.get("viewer:reveal")(page);
  assert.deepEqual(opened.at(-1), ["reveal", path.join(root, "docs", "notes.md")]);
  await handlers.get("viewer:copy")(page);
  assert.deepEqual(opened.at(-1), ["text", "Notes\n"]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("an image needs to be an image, and an attachment opens with the system through a temp copy", async () => {
  const { electron, handlers, windows, opened } = fakeElectron();
  const viewer = createViewer({ ...electron });
  assert.throws(() => viewer.openImage({ name: "x", dataUrl: "data:text/html;base64,PGI+" }), /Not an image/);
  assert.throws(() => viewer.openImage({ name: "x", dataUrl: "javascript:alert(1)" }), /Not an image/);
  await viewer.openImage({ name: "shot.png", dataUrl: "data:image/png;base64,iVBORw0KGgo=" });
  const page = { sender: windows[0].webContents };
  const item = await handlers.get("viewer:get-item")(page);
  assert.equal(item.kind, "image");
  assert.equal(item.canReveal, false);
  await viewer.openBytes({ name: "report.pdf", mediaType: "application/pdf", data: Buffer.from("%PDF-1.7\u0000\u0001").toString("base64") });
  const shown = await handlers.get("viewer:get-item")(page);
  assert.equal(shown.kind, "unknown");
  assert.equal(shown.canOpenExternally, true);
  assert.equal("bytes" in shown, false, "the bytes stay in main");
  await handlers.get("viewer:open-externally")(page);
  assert.equal(opened.at(-1)[0], "path");
  assert.equal(path.basename(opened.at(-1)[1]), "report.pdf");
});

test("the viewer follows the widget's layer", () => {
  const capabilities = { layerLevels: true, captureExclusion: true };
  assert.deepEqual(viewerLayerFor("normal", capabilities), { alwaysOnTop: false, level: "floating", contentProtection: false });
  assert.deepEqual(viewerLayerFor("above", capabilities), { alwaysOnTop: true, level: "floating", contentProtection: false });
  assert.deepEqual(viewerLayerFor("private", capabilities), { alwaysOnTop: true, level: "screen-saver", contentProtection: true });
});

test("every channel the viewer page invokes is one the viewer handles", () => {
  const { electron, handlers } = fakeElectron();
  createViewer({ ...electron });
  const preload = fs.readFileSync(path.join(__dirname, "..", "src", "viewer-preload.cjs"), "utf8");
  const invoked = [...preload.matchAll(/invoke\("([^"]+)"/g)].map((match) => match[1]);
  assert.ok(invoked.length >= 6);
  for (const channel of invoked) assert.ok(handlers.has(channel), `${channel} is handled`);
});
