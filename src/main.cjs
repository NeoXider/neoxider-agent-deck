const path = require("node:path");
const { mkdirSync, readFileSync, statSync, writeFileSync } = require("node:fs");
const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, screen, shell, Tray } = require("electron");
const { HarnessApi } = require("./harness-api.cjs");

const HARNESS_URL = process.env.DSH_WIDGET_URL || "http://127.0.0.1:3080";
const api = new HarnessApi(HARNESS_URL);
const SIZE_PRESETS = {
  compact: [380, 520],
  standard: [420, 640],
  large: [500, 760],
};
const ORB_SIZE = 76;
const EDGE_WIDTH = 22;
const EDGE_HEIGHT = 132;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
]);

let windowRef;
let tray;
let windowMode = "full";
let fullBounds;
let preferences = { opacity: 0.96, size: "standard", alwaysOnTop: true };

function settingsPath() {
  return path.join(app.getPath("userData"), "widget-settings.json");
}

function loadPreferences() {
  try {
    preferences = { ...preferences, ...JSON.parse(readFileSync(settingsPath(), "utf8")) };
  } catch {}
}

function savePreferences() {
  mkdirSync(path.dirname(settingsPath()), { recursive: true });
  writeFileSync(settingsPath(), `${JSON.stringify(preferences, null, 2)}\n`, "utf8");
}

function captureFullBounds() {
  if (windowRef && windowMode === "full") fullBounds = windowRef.getBounds();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function prepareFile(filePath) {
  const resolved = path.resolve(String(filePath));
  const info = statSync(resolved);
  if (!info.isFile()) throw new Error(`Not a file: ${resolved}`);
  const mediaType = IMAGE_TYPES.get(path.extname(resolved).toLowerCase());
  if (!mediaType) return { kind: "reference", path: resolved, name: path.basename(resolved) };
  if (info.size > MAX_IMAGE_BYTES) throw new Error(`${path.basename(resolved)} exceeds the 8 MB image limit`);
  return {
    kind: "image",
    mediaType,
    data: readFileSync(resolved).toString("base64"),
    name: path.basename(resolved),
    path: resolved,
    bytes: info.size,
  };
}

function prepareFiles(filePaths) {
  return [...new Set((filePaths || []).map((value) => path.resolve(String(value))))]
    .slice(0, 12)
    .map(prepareFile);
}

function applyWindowMode(nextMode) {
  if (!windowRef || windowRef.isDestroyed() || !["full", "orb", "edge"].includes(nextMode)) return;
  if (windowMode === "full" && nextMode !== "full") captureFullBounds();
  windowMode = nextMode;
  windowRef.setMinimumSize(1, 1);

  if (nextMode === "full") {
    const fallbackSize = SIZE_PRESETS[preferences.size] || SIZE_PRESETS.standard;
    const target = fullBounds || { ...windowRef.getBounds(), width: fallbackSize[0], height: fallbackSize[1] };
    const display = screen.getDisplayMatching(target).workArea;
    const width = Math.max(360, target.width);
    const height = Math.max(500, target.height);
    windowRef.setResizable(true);
    windowRef.setSkipTaskbar(false);
    windowRef.setBounds({
      width,
      height,
      x: clamp(target.x, display.x, display.x + display.width - width),
      y: clamp(target.y, display.y, display.y + display.height - height),
    }, true);
    windowRef.setMinimumSize(360, 500);
  } else if (nextMode === "orb") {
    const source = fullBounds || windowRef.getBounds();
    const display = screen.getDisplayMatching(source).workArea;
    windowRef.setResizable(false);
    windowRef.setSkipTaskbar(true);
    windowRef.setBounds({
      x: clamp(source.x + source.width - ORB_SIZE, display.x, display.x + display.width - ORB_SIZE),
      y: clamp(source.y, display.y, display.y + display.height - ORB_SIZE),
      width: ORB_SIZE,
      height: ORB_SIZE,
    }, true);
  } else {
    const source = fullBounds || windowRef.getBounds();
    const display = screen.getDisplayMatching(source).workArea;
    windowRef.setResizable(false);
    windowRef.setSkipTaskbar(true);
    windowRef.setBounds({
      x: display.x + display.width - EDGE_WIDTH,
      y: clamp(source.y + Math.round((source.height - EDGE_HEIGHT) / 2), display.y, display.y + display.height - EDGE_HEIGHT),
      width: EDGE_WIDTH,
      height: EDGE_HEIGHT,
    }, true);
  }

  windowRef.setAlwaysOnTop(nextMode === "full" ? preferences.alwaysOnTop : true, "floating");
  if (nextMode === "full") windowRef.show();
  else windowRef.showInactive();
  windowRef.webContents.send("window-mode", windowMode);
}

function createWindow() {
  const [width, height] = SIZE_PRESETS[preferences.size] || SIZE_PRESETS.standard;
  windowRef = new BrowserWindow({
    width,
    height,
    minWidth: 360,
    minHeight: 500,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: preferences.alwaysOnTop,
    hasShadow: false,
    roundedCorners: false,
    resizable: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  windowRef.setOpacity(Math.max(0.65, Math.min(1, Number(preferences.opacity) || 0.96)));
  const screenshotTab = process.env.WIDGET_SCREENSHOT_TAB || "";
  windowRef.loadFile(path.join(__dirname, "renderer", "index.html"), {
    query: screenshotTab ? { screenshotTab } : {},
  });
  windowRef.once("ready-to-show", () => {
    fullBounds = windowRef.getBounds();
    windowRef.show();
  });
  windowRef.on("close", (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      applyWindowMode("edge");
    }
  });
  windowRef.on("resize", () => captureFullBounds());
  windowRef.on("move", () => captureFullBounds());

  const screenshotPath = process.env.WIDGET_SCREENSHOT_PATH;
  if (screenshotPath) {
    windowRef.webContents.once("did-finish-load", () => {
      const requestedMode = process.env.WIDGET_SCREENSHOT_MODE;
      if (["orb", "edge"].includes(requestedMode)) {
        setTimeout(() => applyWindowMode(requestedMode), 3500);
      }
      setTimeout(async () => {
        const image = await windowRef.webContents.capturePage();
        mkdirSync(path.dirname(screenshotPath), { recursive: true });
        writeFileSync(screenshotPath, image.toPNG());
        app.isQuitting = true;
        app.quit();
      }, 5000);
    });
  }
}

ipcMain.handle("dashboard", async () => {
  try {
    const dashboard = await api.dashboard();
    return { ok: true, harness: true, ...dashboard };
  } catch (error) {
    return { ok: false, harness: false, error: error instanceof Error ? error.message : String(error), sessions: [] };
  }
});
ipcMain.handle("history", async (_event, sessionId) => api.history(sessionId));
ipcMain.handle("models", async (_event, sessionId) => api.models(sessionId || undefined));
ipcMain.handle("commands", async (_event, sessionId) => api.commands(sessionId));
ipcMain.handle("execute-command", async (_event, payload) => api.executeCommand(payload.sessionId, payload.line));
ipcMain.handle("workspaces", async () => api.workspaces());
ipcMain.handle("pick-workspace", async () => {
  const result = await dialog.showOpenDialog(windowRef, { properties: ["openDirectory", "createDirectory"] });
  if (result.canceled || !result.filePaths[0]) return null;
  return api.createWorkspace(result.filePaths[0]);
});
ipcMain.handle("pick-files", async () => {
  const result = await dialog.showOpenDialog(windowRef, { properties: ["openFile", "multiSelections"] });
  return result.canceled ? [] : prepareFiles(result.filePaths);
});
ipcMain.handle("prepare-files", async (_event, filePaths) => prepareFiles(filePaths));
ipcMain.handle("create-session", async (_event, options) => ({ sessionId: await api.createSession(options || {}) }));
ipcMain.handle("select-model", async (_event, payload) => api.selectModel(payload.sessionId, payload.selection));
ipcMain.handle("send", async (_event, payload) => {
  const text = String(payload && payload.text || "").trim();
  const attachments = Array.isArray(payload && payload.attachments) ? payload.attachments : [];
  if (!text && !attachments.length) throw new Error("Message is empty");
  const sessionId = payload && payload.sessionId ? payload.sessionId : await api.createSession();
  if (payload && payload.selection) await api.selectModel(sessionId, payload.selection);
  const references = attachments.filter((item) => item.kind === "reference").map((item) => `@${item.path}`);
  const promptText = [text, ...references].filter(Boolean).join("\n\n");
  const images = attachments.filter((item) => item.kind === "image");
  await api.prompt(sessionId, promptText, payload && payload.timeZone, images);
  return { sessionId };
});
ipcMain.handle("cancel", async (_event, sessionId) => api.cancel(sessionId));
ipcMain.handle("open-harness", async () => shell.openExternal(HARNESS_URL));
ipcMain.handle("start-harness", async () => shell.openPath(path.join(app.getPath("desktop"), "Запустить DeepSeek Harness.bat")));
ipcMain.handle("set-always-on-top", (_event, enabled) => {
  preferences.alwaysOnTop = Boolean(enabled);
  if (windowMode === "full") windowRef.setAlwaysOnTop(preferences.alwaysOnTop);
  savePreferences();
  return preferences.alwaysOnTop;
});
ipcMain.handle("set-opacity", (_event, value) => {
  preferences.opacity = Math.max(0.65, Math.min(1, Number(value) || 0.96));
  windowRef.setOpacity(preferences.opacity);
  savePreferences();
  return preferences.opacity;
});
ipcMain.handle("set-size", (_event, preset) => {
  const size = SIZE_PRESETS[preset] || SIZE_PRESETS.standard;
  preferences.size = SIZE_PRESETS[preset] ? preset : "standard";
  if (windowMode === "full") windowRef.setSize(size[0], size[1], true);
  fullBounds = { ...(fullBounds || windowRef.getBounds()), width: size[0], height: size[1] };
  savePreferences();
  return preferences.size;
});
ipcMain.handle("set-auto-start", (_event, enabled) => {
  app.setLoginItemSettings({ openAtLogin: Boolean(enabled), path: process.execPath });
  return app.getLoginItemSettings().openAtLogin;
});
ipcMain.handle("get-preferences", () => ({
  alwaysOnTop: windowRef.isAlwaysOnTop(),
  autoStart: app.getLoginItemSettings().openAtLogin,
  opacity: preferences.opacity,
  size: preferences.size,
  windowMode,
}));
ipcMain.handle("set-window-mode", (_event, mode) => {
  applyWindowMode(mode);
  return windowMode;
});
ipcMain.on("agent-complete", () => {
  if (windowMode === "edge") windowRef.webContents.send("edge-bounce");
});

app.whenReady().then(() => {
  loadPreferences();
  createWindow();
  const iconPath = path.join(__dirname, "renderer", "assets", "neoxider-github.png");
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 32, height: 32 });
  tray = new Tray(icon);
  tray.setToolTip("DeepSeek Harness Widget");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Show widget", click: () => applyWindowMode("full") },
    { label: "Open Harness", click: () => shell.openExternal(HARNESS_URL) },
    { type: "separator" },
    { label: "Quit", click: () => { app.isQuitting = true; app.quit(); } },
  ]));
  tray.on("double-click", () => applyWindowMode(windowMode === "full" ? "edge" : "full"));
});

app.on("activate", () => windowRef ? applyWindowMode("full") : createWindow());
app.on("window-all-closed", (event) => event.preventDefault());
