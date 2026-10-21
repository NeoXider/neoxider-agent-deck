const fs = require("node:fs");
const path = require("node:path");
const { itemFromBuffer, readViewerItem, resolveViewerPath, stripLineSuffix } = require("./viewer-content.cjs");
const { parseExternalUrl } = require("./external-links.cjs");
const { highlightCode, renderMarkdown: renderChatMarkdown } = require("./markdown.cjs");
const { normalizeWindowLayer } = require("./platform-capabilities.cjs");

// The viewer: one extra window for what the chat points at - an attached or sent image, a
// file an agent names, a Markdown document - at a size the widget never has. It is reused:
// opening something else replaces what it shows and brings it forward.
//
// It holds the item it shows in main. The page gets what it needs to draw it, and asks main
// for everything else (open with the system, show in the folder, copy, follow a link), so a
// path or a byte the page never received cannot be opened from it.

const DATA_IMAGE = /^data:(image\/(?:png|jpeg|gif|webp|bmp|avif|x-icon|svg\+xml));base64,([A-Za-z0-9+/]+={0,2})$/;
const MAX_DATA_URL = Math.ceil((40 * 1024 * 1024 * 4) / 3) + 64;

// The viewer follows the widget's layer: above everything when the widget is, and out of
// screen captures when the widget is a private overlay - what it shows came from that chat.
function viewerLayerFor(windowLayer, capabilities = {}) {
  const layer = normalizeWindowLayer(windowLayer, capabilities);
  return {
    alwaysOnTop: layer !== "normal",
    level: capabilities.layerLevels && (layer === "game" || layer === "private") ? "screen-saver" : "floating",
    contentProtection: Boolean(capabilities.captureExclusion) && layer === "private",
  };
}

function createViewer({
  BrowserWindow,
  ipcMain,
  screen,
  shell,
  clipboard,
  nativeImage,
  app,
  renderMarkdown = renderChatMarkdown,
  highlight = highlightCode,
  windowOptions = {},
  // The widget's window: the viewer opens on its display.
  getAnchor = () => null,
  getWindowLayer = () => "normal",
  capabilities = {},
  fileSystem = fs,
  platform = process.platform,
}) {
  let windowRef = null;
  let current = null;
  let loaded = null;

  const alive = () => windowRef && !windowRef.isDestroyed();
  const isViewerSender = (event) => alive() && event?.sender === windowRef.webContents;

  function placement(item) {
    const anchorWindow = getAnchor();
    const anchor = anchorWindow && !anchorWindow.isDestroyed?.() ? anchorWindow.getBounds() : null;
    const display = anchor ? screen.getDisplayMatching(anchor) : screen.getPrimaryDisplay();
    const area = display.workArea;
    let width = 900;
    let height = 720;
    if (item.kind === "image" && item.dataUrl) {
      const size = nativeImage.createFromDataURL(item.dataUrl).getSize();
      if (size.width > 0 && size.height > 0) {
        width = Math.max(520, size.width + 48);
        height = Math.max(400, size.height + 112);
      }
    } else if (["missing", "folder", "unknown"].includes(item.kind)) {
      width = 560;
      height = 380;
    }
    width = Math.min(width, Math.round(area.width * 0.86));
    height = Math.min(height, Math.round(area.height * 0.88));
    return { x: Math.round(area.x + (area.width - width) / 2), y: Math.round(area.y + (area.height - height) / 2), width, height };
  }

  // Above the widget when the widget stays above everything, and out of screen captures when
  // the widget is a private overlay: what it shows came from the same chat.
  function applyLayer() {
    if (!alive()) return;
    const layer = viewerLayerFor(getWindowLayer(), capabilities);
    if (layer.alwaysOnTop) windowRef.setAlwaysOnTop(true, layer.level || "floating");
    else windowRef.setAlwaysOnTop(false);
    windowRef.setContentProtection?.(Boolean(layer.contentProtection));
  }

  function ensureWindow(item) {
    if (alive()) return windowRef;
    windowRef = new BrowserWindow({
      ...windowOptions,
      ...placement(item),
      minWidth: 380,
      minHeight: 280,
      show: false,
      backgroundColor: "#0e1116",
      titleBarStyle: "hidden",
      ...(platform === "darwin" ? { trafficLightPosition: { x: 14, y: 14 } } : { titleBarOverlay: { color: "#00000000", symbolColor: "#c9d1db", height: 44 } }),
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, "viewer-preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
      },
    });
    windowRef.setMenu?.(null);
    windowRef.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    windowRef.webContents.on("will-navigate", (event) => event.preventDefault());
    windowRef.on("closed", () => {
      windowRef = null;
      current = null;
      loaded = null;
    });
    loaded = windowRef.loadFile(path.join(__dirname, "renderer", "viewer.html"), { query: { platform } }).catch(() => {});
    windowRef.once("ready-to-show", () => {
      applyLayer();
      if (alive()) windowRef.show();
    });
    return windowRef;
  }

  async function show(item) {
    const fresh = !alive();
    ensureWindow(item);
    current = item;
    await loaded;
    if (!alive()) return { ok: false };
    windowRef.setTitle(item.name || "Viewer");
    windowRef.webContents.send("viewer:item", publicItem(item));
    if (!fresh) {
      applyLayer();
      if (windowRef.isMinimized()) windowRef.restore();
      windowRef.show();
      windowRef.moveTop?.();
      windowRef.focus();
    }
    return { ok: true, kind: item.kind };
  }

  // What the page needs to draw it; bytes kept for "Open with" stay in main.
  function publicItem(item) {
    const { bytes, ...rest } = item;
    return { ...rest, canReveal: Boolean(item.path) && item.kind !== "missing", canOpenExternally: Boolean(item.path || item.bytes) && item.kind !== "missing" };
  }

  function read(filePath, line = null) {
    return readViewerItem(filePath, { fileSystem, renderMarkdown, highlight, line });
  }

  // A path from the chat: relative ones resolve against the session's folder.
  function openPath(value, { cwd = "" } = {}) {
    const { file, line } = stripLineSuffix(String(value || ""));
    const resolved = resolveViewerPath(file, { cwd, platform });
    if (!resolved) throw new Error(cwd ? `Not a file path: ${value}` : `Deck does not know this chat's folder, so it cannot find ${value}`);
    return show(read(resolved, line));
  }

  function openImage({ name, dataUrl }) {
    const value = String(dataUrl || "");
    if (value.length > MAX_DATA_URL || !DATA_IMAGE.test(value)) throw new Error("Not an image Deck can show");
    return show({ kind: "image", name: String(name || "Image").slice(0, 200), path: "", dataUrl: value });
  }

  // An attachment read back from Harness: its bytes, its name and media type.
  function openBytes({ name, mediaType, data }) {
    const text = String(data || "");
    if (!text || text.length > MAX_DATA_URL || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) throw new Error("The attachment could not be read");
    const buffer = Buffer.from(text, "base64");
    const item = itemFromBuffer({ name: String(name || "Attachment").slice(0, 200), buffer, mediaType, renderMarkdown, highlight });
    return show({ ...item, bytes: buffer });
  }

  // Bytes without a path (an attachment) open with the system through a copy in temp.
  function temporaryCopy(item) {
    const directory = path.join(app.getPath("temp"), "NeoXider Agent Deck", "viewer");
    fileSystem.mkdirSync(directory, { recursive: true });
    const safeName = path.basename(item.name || "attachment").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_") || "attachment";
    const target = path.join(directory, safeName);
    fileSystem.writeFileSync(target, item.bytes);
    return target;
  }

  const handlers = {
    "viewer:get-item": () => (current ? publicItem(current) : null),
    "viewer:open-externally": async () => {
      if (!current) return { ok: false };
      const target = current.path || (current.bytes ? temporaryCopy(current) : "");
      if (!target) return { ok: false };
      const error = await shell.openPath(target);
      return error ? { ok: false, error } : { ok: true };
    },
    "viewer:reveal": () => {
      if (!current?.path) return { ok: false };
      shell.showItemInFolder(current.path);
      return { ok: true };
    },
    "viewer:copy": () => {
      if (!current) return { ok: false };
      if (current.kind === "image" && current.dataUrl) {
        const image = nativeImage.createFromDataURL(current.dataUrl);
        if (image.isEmpty()) return { ok: false };
        clipboard.writeImage(image);
        return { ok: true, what: "image" };
      }
      if (typeof current.text === "string") {
        clipboard.writeText(current.text);
        return { ok: true, what: "text" };
      }
      if (current.path) {
        clipboard.writeText(current.path);
        return { ok: true, what: "path" };
      }
      return { ok: false };
    },
    // A link inside a shown document: the web goes to the browser, a file opens here,
    // relative to the document that links to it.
    "viewer:open-link": async (_event, value) => {
      const href = String(value || "");
      const url = parseExternalUrl(href);
      if (url) {
        await shell.openExternal(url);
        return { ok: true };
      }
      const base = current?.path ? path.dirname(current.path) : "";
      await openPath(href, { cwd: base });
      return { ok: true };
    },
    "viewer:close": () => {
      if (alive()) windowRef.close();
      return { ok: true };
    },
  };
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, async (event, ...args) => {
      if (!isViewerSender(event)) throw new Error("Untrusted sender");
      return handler(event, ...args);
    });
  }

  return {
    openPath,
    openImage,
    openBytes,
    applyLayer,
    window: () => (alive() ? windowRef : null),
    close() {
      if (alive()) windowRef.close();
    },
  };
}

module.exports = { createViewer, viewerLayerFor };
