const path = require("node:path");
const { mkdirSync, readFileSync, statSync, writeFileSync } = require("node:fs");
const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, screen, shell, Tray } = require("electron");
const { HarnessApi } = require("./harness-api.cjs");
const { harnessSessionUrl } = require("./harness-url.cjs");
const { renderMarkdown } = require("./markdown.cjs");
const { clamp, moveCompactBounds, snapCompactBounds } = require("./window-geometry.cjs");

const HARNESS_URL = process.env.DSH_WIDGET_URL || "http://127.0.0.1:3080";
if (process.env.WIDGET_SCREENSHOT_PATH) {
  const smokeRoot = path.join(app.getPath("temp"), "deepseek-harness-widget-smoke", String(process.pid));
  app.setPath("sessionData", path.join(smokeRoot, "session"));
  app.setPath("userData", path.join(smokeRoot, "user-data"));
}
const api = new HarnessApi(HARNESS_URL);
const SIZE_PRESETS = {
  compact: [380, 520],
  standard: [420, 640],
  large: [500, 760],
};
// The transparent margin prevents the animated bloom around the pet from being clipped.
const ORB_SIZE = 128;
const ORB_QUICK_WIDTH = 172;
const ORB_STATUS_WIDTH = 400;
// Keep enough transparent space for the edge glow to fade out naturally.
// The visible handle is still flush with the screen edge.
const EDGE_WIDTH = 88;
const EDGE_HEIGHT = 132;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
]);
const VIDEO_TYPES = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi", ".wmv"]);

let windowRef;
let tray;
let windowMode = "full";
let fullBounds;
let preferences = { opacity: 0.96, size: "standard", alwaysOnTop: true, compactSide: "right" };
let compactStatus = { active: false, label: "Ready", text: "" };
let compactDragOrigin = null;
let fullDragOrigin = null;
let compactDragTrace = [];
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) app.quit();

function traceCompactDrag(stage, details = {}) {
  compactDragTrace.push({ stage, at: Date.now(), ...details });
  compactDragTrace = compactDragTrace.slice(-24);
}

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

async function prepareFile(filePath) {
  const resolved = path.resolve(String(filePath));
  const info = statSync(resolved);
  if (!info.isFile()) throw new Error(`Not a file: ${resolved}`);
  const extension = path.extname(resolved).toLowerCase();
  const mediaType = IMAGE_TYPES.get(extension);
  if (!mediaType) {
    if (VIDEO_TYPES.has(extension)) {
      let thumbnailData = "";
      try {
        const thumbnail = await nativeImage.createThumbnailFromPath(resolved, { width: 160, height: 100 });
        if (!thumbnail.isEmpty()) thumbnailData = thumbnail.toPNG().toString("base64");
      } catch {}
      return {
        kind: "reference",
        previewKind: "video",
        thumbnailData,
        thumbnailMediaType: thumbnailData ? "image/png" : "",
        path: resolved,
        name: path.basename(resolved),
      };
    }
    return { kind: "reference", previewKind: "file", path: resolved, name: path.basename(resolved) };
  }
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

async function prepareFiles(filePaths) {
  return Promise.all([...new Set((filePaths || []).map((value) => path.resolve(String(value))))]
    .slice(0, 12)
    .map(prepareFile));
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
    const orbWidth = compactStatus.active ? ORB_STATUS_WIDTH : ORB_QUICK_WIDTH;
    windowRef.setResizable(false);
    windowRef.setSkipTaskbar(true);
    const preferredX = preferences.compactSide === "left"
      ? display.x + 8
      : display.x + display.width - orbWidth - 8;
    windowRef.setBounds({
      x: preferredX,
      y: clamp(source.y, display.y, display.y + display.height - ORB_SIZE),
      width: orbWidth,
      height: ORB_SIZE,
    }, true);
  } else {
    const source = fullBounds || windowRef.getBounds();
    const display = screen.getDisplayMatching(source).workArea;
    windowRef.setResizable(false);
    windowRef.setSkipTaskbar(true);
    windowRef.setBounds({
      x: preferences.compactSide === "left" ? display.x : display.x + display.width - EDGE_WIDTH,
      y: clamp(source.y + Math.round((source.height - EDGE_HEIGHT) / 2), display.y, display.y + display.height - EDGE_HEIGHT),
      width: EDGE_WIDTH,
      height: EDGE_HEIGHT,
    }, true);
  }

  windowRef.setAlwaysOnTop(nextMode === "full" ? preferences.alwaysOnTop : true, "floating");
  if (nextMode === "full") windowRef.show();
  else windowRef.showInactive();
  windowRef.webContents.send("window-mode", windowMode);
  windowRef.webContents.send("compact-side", preferences.compactSide);
}

function createWindow() {
  const [presetWidth, presetHeight] = SIZE_PRESETS[preferences.size] || SIZE_PRESETS.standard;
  const requestedWidth = Number(process.env.WIDGET_SCREENSHOT_WIDTH);
  const requestedHeight = Number(process.env.WIDGET_SCREENSHOT_HEIGHT);
  const width = Number.isFinite(requestedWidth) && requestedWidth >= 360 ? requestedWidth : presetWidth;
  const height = Number.isFinite(requestedHeight) && requestedHeight >= 500 ? requestedHeight : presetHeight;
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
  const screenshotFixture = process.env.WIDGET_SCREENSHOT_FIXTURE || "";
  const screenshotFiles = process.env.WIDGET_SCREENSHOT_FILES || "";
  windowRef.loadFile(path.join(__dirname, "renderer", "index.html"), {
    query: {
      ...(screenshotTab ? { screenshotTab } : {}),
      ...(screenshotFixture ? { screenshotFixture } : {}),
      ...(screenshotFiles ? { screenshotFiles } : {}),
      ...(process.env.WIDGET_SCREENSHOT_PATH ? { screenshotStatic: "1" } : {}),
    },
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
      const requestedDelay = Number(process.env.WIDGET_SCREENSHOT_DELAY);
      const captureDelay = Number.isFinite(requestedDelay) && requestedDelay >= 1200 ? requestedDelay : 5000;
      const requestedMode = process.env.WIDGET_SCREENSHOT_MODE;
      if (["orb", "edge"].includes(requestedMode)) {
        setTimeout(() => applyWindowMode(requestedMode), Math.min(3500, captureDelay - 650));
      }
      setTimeout(async () => {
        const auditPath = process.env.WIDGET_UI_AUDIT_PATH;
        if (auditPath) {
          const audit = await windowRef.webContents.executeJavaScript(`(() => {
            const selectors = ['.widget-shell','.titlebar','.tabs','.panel.active','.chat-heading','.agent-controls','.activity-card.has-activity','.messages','.tool-group','.tool-call','.attachment-bar.has-items','.composer','.picker.open .picker-menu','.orb-mode','.orb-status','.orb-history-button','.edge-mode'];
            const boxes = selectors.flatMap((selector) => [...document.querySelectorAll(selector)].map((element) => {
              const rect = element.getBoundingClientRect();
              const visible = rect.width > 0 && rect.height > 0 && getComputedStyle(element).display !== 'none';
              return { selector, visible, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
            })).filter((item) => item.visible);
            const tolerance = 1;
            const offenders = boxes.filter((box) => box.left < -tolerance || box.top < -tolerance || box.right > innerWidth + tolerance || box.bottom > innerHeight + tolerance);
            const semantic = {
              toolGroups: document.querySelectorAll('.tool-group').length,
              toolCalls: document.querySelectorAll('.tool-call').length,
              historicalReasoning: document.querySelectorAll('.reasoning-bubble').length,
              markdownLists: document.querySelectorAll('#messages ul, #messages ol').length,
              footer: document.querySelectorAll('footer').length,
              titlebarTabs: document.querySelectorAll('.titlebar > .tabs').length,
              setupInToolbar: document.querySelector('#agentControls')?.parentElement?.classList.contains('chat-heading') || false,
              focusMode: document.body.classList.contains('focus-chat'),
              focusChromeHidden: ['.titlebar','.chat-heading','.activity-card','.command-menu','.settings-panel'].every((selector) => getComputedStyle(document.querySelector(selector)).display === 'none'),
              agentWorking: document.querySelectorAll('.session-card.state-working').length,
              agentIdle: document.querySelectorAll('.session-card.state-idle').length,
              agentError: document.querySelectorAll('.session-card.state-error').length,
              orbUtilityButtons: document.querySelectorAll('#orbMode > button:not(#orbRestore):not(#orbStatus)').length,
              orbNotification: document.body.classList.contains('orb-has-notification'),
            };
            return { viewport: { width: innerWidth, height: innerHeight }, scroll: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }, boxes, offenders, semantic };
          })()`);
          audit.compactDragTrace = compactDragTrace;
          audit.windowBounds = windowRef.getBounds();
          mkdirSync(path.dirname(auditPath), { recursive: true });
          writeFileSync(auditPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
        }
        const image = await windowRef.webContents.capturePage();
        mkdirSync(path.dirname(screenshotPath), { recursive: true });
        writeFileSync(screenshotPath, image.toPNG());
        app.isQuitting = true;
        app.quit();
      }, captureDelay);
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
ipcMain.handle("history", async (_event, sessionId) => {
  const view = await api.history(sessionId);
  return {
    ...view,
    messages: view.messages.map((message) => typeof message.text === "string"
      ? { ...message, html: renderMarkdown(message.text) }
      : message),
  };
});
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
ipcMain.handle("create-session", async (_event, options) => {
  const sessionId = await api.createSession(options || {});
  await api.ensureFullAccess(sessionId);
  return { sessionId };
});
ipcMain.handle("select-model", async (_event, payload) => api.selectModel(payload.sessionId, payload.selection));
ipcMain.handle("send", async (_event, payload) => {
  const text = String(payload && payload.text || "").trim();
  const attachments = Array.isArray(payload && payload.attachments) ? payload.attachments : [];
  if (!text && !attachments.length) throw new Error("Message is empty");
  const sessionId = payload && payload.sessionId ? payload.sessionId : await api.createSession();
  await api.ensureFullAccess(sessionId);
  if (payload && payload.selection) await api.selectModel(sessionId, payload.selection);
  const references = attachments.filter((item) => item.kind === "reference").map((item) => `@${item.path}`);
  const promptText = [text, ...references].filter(Boolean).join("\n\n");
  const images = attachments.filter((item) => item.kind === "image");
  await api.prompt(sessionId, promptText, payload && payload.timeZone, images);
  return { sessionId };
});
ipcMain.handle("cancel", async (_event, sessionId) => api.cancel(sessionId));
ipcMain.handle("open-harness", async () => shell.openExternal(HARNESS_URL));
ipcMain.handle("open-harness-session", async (_event, sessionId) => shell.openExternal(harnessSessionUrl(HARNESS_URL, sessionId)));
ipcMain.handle("open-project", async () => shell.openExternal("https://github.com/NeoXider/deepseek-harness-widget"));
ipcMain.handle("open-external", async (_event, value) => {
  const url = new URL(String(value));
  if (!new Set(["http:", "https:", "mailto:"]).has(url.protocol)) throw new Error("Unsupported external link protocol");
  return shell.openExternal(url.href);
});
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
  compactSide: preferences.compactSide,
}));
ipcMain.handle("app-info", () => ({ version: app.getVersion(), repository: "https://github.com/NeoXider/deepseek-harness-widget" }));
ipcMain.handle("set-window-mode", (_event, mode) => {
  applyWindowMode(mode);
  return windowMode;
});
ipcMain.handle("set-compact-status", (_event, value) => {
  const wasActive = compactStatus.active;
  compactStatus = {
    active: Boolean(value && value.active),
    label: String(value && value.label || "Ready").slice(0, 80),
    text: String(value && value.text || "").slice(0, 180),
  };
  if (windowMode === "orb" && wasActive !== compactStatus.active && !compactDragOrigin) applyWindowMode("orb");
  return compactStatus;
});
ipcMain.handle("window-bounds", () => windowRef.getBounds());
ipcMain.on("begin-full-drag", (event, value) => {
  if (!windowRef || windowMode !== "full" || event.sender !== windowRef.webContents) return;
  const screenX = Number(value?.x);
  const screenY = Number(value?.y);
  if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return;
  fullDragOrigin = { screenX, screenY, bounds: windowRef.getBounds() };
});
ipcMain.on("move-full-drag", (event, value) => {
  if (!windowRef || windowMode !== "full" || !fullDragOrigin || event.sender !== windowRef.webContents) return;
  const screenX = Number(value?.x);
  const screenY = Number(value?.y);
  if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return;
  const candidate = {
    x: fullDragOrigin.bounds.x + screenX - fullDragOrigin.screenX,
    y: fullDragOrigin.bounds.y + screenY - fullDragOrigin.screenY,
  };
  const display = screen.getDisplayNearestPoint({ x: Math.round(candidate.x), y: Math.round(candidate.y) }).workArea;
  const moved = moveCompactBounds(fullDragOrigin.bounds, candidate, display);
  windowRef.setPosition(moved.x, moved.y, false);
  fullBounds = { ...windowRef.getBounds() };
});
ipcMain.handle("end-full-drag", () => {
  fullDragOrigin = null;
  captureFullBounds();
  return windowRef?.getBounds();
});
ipcMain.on("begin-compact-drag", (event, value) => {
  if (!windowRef || windowMode === "full" || event.sender !== windowRef.webContents) return;
  const screenX = Number(value?.x);
  const screenY = Number(value?.y);
  if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return;
  compactDragOrigin = { screenX, screenY, bounds: windowRef.getBounds() };
  traceCompactDrag("begin", { screenX, screenY, bounds: compactDragOrigin.bounds });
});
ipcMain.on("move-compact-drag", (event, value) => {
  if (!windowRef || windowMode === "full" || !compactDragOrigin || event.sender !== windowRef.webContents) return;
  const screenX = Number(value?.x);
  const screenY = Number(value?.y);
  if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return;
  const candidate = {
    x: compactDragOrigin.bounds.x + screenX - compactDragOrigin.screenX,
    y: compactDragOrigin.bounds.y + screenY - compactDragOrigin.screenY,
  };
  const display = screen.getDisplayNearestPoint({ x: Math.round(candidate.x), y: Math.round(candidate.y) }).workArea;
  const moved = moveCompactBounds(compactDragOrigin.bounds, candidate, display);
  windowRef.setPosition(moved.x, moved.y, false);
  traceCompactDrag("move", { screenX, screenY, x: moved.x, y: moved.y });
});
ipcMain.handle("move-compact-window", (_event, value) => {
  if (!windowRef || windowMode === "full") return windowRef?.getBounds();
  const bounds = windowRef.getBounds();
  const requestedX = Number(value?.x);
  const requestedY = Number(value?.y);
  const candidateX = Number.isFinite(requestedX) ? requestedX : bounds.x;
  const candidateY = Number.isFinite(requestedY) ? requestedY : bounds.y;
  const display = screen.getDisplayNearestPoint({ x: Math.round(candidateX), y: Math.round(candidateY) }).workArea;
  const moved = moveCompactBounds(bounds, { x: candidateX, y: candidateY }, display);
  windowRef.setPosition(moved.x, moved.y, false);
  if (fullBounds) {
    fullBounds.y = moved.y;
    fullBounds.x = clamp(moved.x + bounds.width - fullBounds.width, display.x, display.x + display.width - fullBounds.width);
  }
  return windowRef.getBounds();
});
ipcMain.handle("snap-compact-window", () => {
  if (!windowRef || windowMode === "full") return windowRef?.getBounds();
  const bounds = windowRef.getBounds();
  const display = screen.getDisplayMatching(bounds).workArea;
  const snapped = snapCompactBounds(bounds, display, windowMode);
  preferences.compactSide = snapped.side;
  windowRef.setBounds({ x: snapped.x, y: snapped.y, width: snapped.width, height: snapped.height }, true);
  savePreferences();
  windowRef.webContents.send("compact-side", preferences.compactSide);
  return { ...windowRef.getBounds(), side: preferences.compactSide };
});
ipcMain.handle("end-compact-drag", () => {
  compactDragOrigin = null;
  if (!windowRef || windowMode === "full") return windowRef?.getBounds();
  const bounds = windowRef.getBounds();
  const display = screen.getDisplayMatching(bounds).workArea;
  const snapped = snapCompactBounds(bounds, display, windowMode);
  traceCompactDrag("end", { before: bounds, snapped });
  preferences.compactSide = snapped.side;
  windowRef.setBounds({ x: snapped.x, y: snapped.y, width: snapped.width, height: snapped.height }, true);
  savePreferences();
  windowRef.webContents.send("compact-side", preferences.compactSide);
  if (fullBounds) fullBounds.y = snapped.y;
  return { ...windowRef.getBounds(), side: preferences.compactSide };
});
ipcMain.on("agent-complete", () => {
  if (windowMode === "edge") windowRef.webContents.send("edge-bounce");
});

app.on("second-instance", () => {
  if (!windowRef || windowRef.isDestroyed()) return;
  if (windowRef.isMinimized()) windowRef.restore();
  windowRef.show();
  windowRef.focus();
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
