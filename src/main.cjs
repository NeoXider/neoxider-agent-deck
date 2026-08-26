const path = require("node:path");
const { mkdirSync, writeFileSync } = require("node:fs");
const fsPromises = require("node:fs/promises");
const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, screen, shell, Tray } = require("electron");
const { HarnessApi } = require("./harness-api.cjs");
const { createAutoStartController } = require("./auto-start.cjs");
const { createHarnessLauncher } = require("./harness-launcher.cjs");
const { harnessSessionUrl } = require("./harness-url.cjs");
const {
  applyPlatformOpacity,
  applyPlatformWindowLayer,
  detectPlatformCapabilities,
  normalizeWindowLayer,
  setPlatformBounds,
  setPlatformSkipTaskbar,
} = require("./platform-capabilities.cjs");
const { APP_ID, PRODUCT_NAME, REPOSITORY_URL } = require("./product.cjs");
const { renderMarkdown } = require("./markdown.cjs");
const { createSettingsStore, DEFAULT_PREFERENCES } = require("./settings-store.cjs");
const { configureProductUserData } = require("./user-data-migration.cjs");
const { moveCompactBounds, snapCompactBounds } = require("./window-geometry.cjs");
const { captureModeBounds, fitFullBounds, resizeCompactAnchor, restoreCompactBounds } = require("./window-state.cjs");

const HARNESS_URL = process.env.DSH_WIDGET_URL || "http://127.0.0.1:3080";
const SCREENSHOT_MODE = Boolean(process.env.WIDGET_SCREENSHOT_PATH);
const PLATFORM_CAPABILITIES = detectPlatformCapabilities();
app.setName(PRODUCT_NAME);
configureProductUserData({ app });
const api = new HarnessApi(HARNESS_URL);
const SIZE_PRESETS = {
  compact: [380, 400],
  standard: [420, 640],
  large: [500, 760],
};
const FULL_MIN_WIDTH = 360;
const FULL_MIN_HEIGHT = 360;
// The transparent margin prevents the animated bloom around the pet from being clipped.
const ORB_SIZE = 128;
const ORB_EXPANDED_HEIGHT = 158;
const ORB_QUICK_WIDTH = 172;
const ORB_STATUS_WIDTH = 400;
const ORB_EXPANDED_WIDTH = 460;
// Keep enough transparent space for the edge glow to fade out naturally.
// The visible handle is still flush with the screen edge.
const EDGE_WIDTH = 88;
const EDGE_HEIGHT = 132;
const EXTERNAL_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
// Model output can contain arbitrary links, so every URL that leaves the widget is
// re-parsed and protocol-checked instead of being trusted as a string.
function parseExternalUrl(value) {
  try {
    const url = new URL(String(value));
    return EXTERNAL_LINK_PROTOCOLS.has(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function openExternalUrl(value) {
  const url = parseExternalUrl(value);
  if (url) shell.openExternal(url);
  return Boolean(url);
}

// Every channel that takes a session id gets it from the renderer, so it is checked
// once here instead of reaching Harness as undefined and surfacing as a TypeError.
function requireSessionId(value) {
  const sessionId = String(value ?? "").trim();
  if (!sessionId) throw new Error("A session id is required");
  return sessionId;
}

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
let preferences = DEFAULT_PREFERENCES;
let settingsStore;
let autoStartController;
let harnessLauncher;
let preferenceSaveTimer = null;
let compactStatus = { active: false, expanded: false, label: "Ready", text: "" };
let compactDragOrigin = null;
let fullDragOrigin = null;
let compactDragTrace = [];
const queueSnapshots = new Map();
let muxSocket = null;
let muxReconnectTimer = null;
let muxStopped = false;
let muxSilenceTimer = null;
let muxReconnectDelay = 1500;
const MUX_RECONNECT_MIN = 1500;
const MUX_RECONNECT_MAX = 30000;
// Harness pushes frames continuously while a session is live; a full minute of
// silence means the socket is dead even if the OS never told us.
const MUX_SILENCE_TIMEOUT = 60000;
let rendererRecoveryCount = 0;
const MAX_RENDERER_RECOVERIES = 3;
const hasSingleInstanceLock = app.requestSingleInstanceLock();

// Without the return the losing instance keeps running the whole module: it would
// register all IPC handlers and could still build a window, tray and mux socket
// before the queued quit actually lands.
if (!hasSingleInstanceLock) {
  app.quit();
  return;
}

function traceCompactDrag(stage, details = {}) {
  compactDragTrace.push({ stage, at: Date.now(), ...details });
  compactDragTrace = compactDragTrace.slice(-24);
}

function settingsPath() {
  return path.join(app.getPath("userData"), "widget-settings.json");
}

function loadPreferences() {
  settingsStore = createSettingsStore({ filePath: settingsPath() });
  preferences = settingsStore.load();
  preferences.windowLayer = normalizeWindowLayer(preferences.windowLayer, PLATFORM_CAPABILITIES);
  windowMode = preferences.windowState.mode;
  if (windowMode === "edge" && PLATFORM_CAPABILITIES.edgeMode === "unavailable") {
    windowMode = "orb";
    preferences.windowState.mode = "orb";
  }
  preferences.compactSide = preferences.windowState[windowMode]?.side || preferences.compactSide;
  fullBounds = preferences.windowState.full;
}

// Settings live in AppData, where a virus scanner or sync client can hold the file
// for a moment. A transient EPERM must never reach the top level: an exception from
// the save timer would be an uncaught exception in main and Electron would kill the app.
function writePreferences() {
  try {
    preferences = settingsStore.save(preferences);
  } catch (error) {
    console.error("Failed to persist preferences", error);
  }
}

function savePreferences() {
  clearTimeout(preferenceSaveTimer);
  preferenceSaveTimer = null;
  writePreferences();
}

function schedulePreferenceSave() {
  clearTimeout(preferenceSaveTimer);
  preferenceSaveTimer = setTimeout(() => {
    preferenceSaveTimer = null;
    writePreferences();
  }, 180);
}

function autoStartPreference() {
  try {
    return { enabled: Boolean(autoStartController?.getEnabled()), available: Boolean(autoStartController?.available) };
  } catch {
    return { enabled: false, available: false };
  }
}

function queueItemView(item) {
  const content = Array.isArray(item?.message?.content) ? item.message.content : [];
  const textBlocks = content.filter((block) => block?.type === "text" && typeof block.text === "string");
  const text = textBlocks.map((block) => block.text).join("\n").trim();
  const editableText = content.length > 0 && content.every((block) => block?.type === "text") ? text : null;
  return {
    id: String(item?.id || item?.message?.id || ""),
    placement: String(item?.placement || "queued"),
    text: editableText,
    preview: String(text || (content.length ? `${content.length} attachment${content.length === 1 ? "" : "s"}` : "Queued message")).replace(/\s+/g, " ").slice(0, 240),
  };
}

function publishQueue(sessionId, items) {
  const safeItems = (Array.isArray(items) ? items : []).map(queueItemView).filter((item) => item.id && item.placement === "queued");
  if (safeItems.length) queueSnapshots.set(sessionId, safeItems);
  else queueSnapshots.delete(sessionId);
  if (windowRef && !windowRef.isDestroyed()) windowRef.webContents.send("queue-update", { sessionId, items: safeItems });
}

function publishLiveEvent(frame) {
  if (!windowRef || windowRef.isDestroyed() || !frame?.sessionId || !frame?.event) return;
  const event = frame.event;
  let data = {};
  if (event.type === "assistant/chunk") {
    const chunk = event.data?.chunk || {};
    data = { chunk: {
      type: String(chunk.type || ""),
      index: Number(chunk.index) || 0,
      blockType: String(chunk.blockType || chunk.block?.type || ""),
      text: typeof chunk.text === "string" ? chunk.text : "",
      name: typeof chunk.name === "string" ? chunk.name : "",
    } };
  } else if (event.type === "tool/call") {
    data = { name: String(event.data?.name || "tool"), callId: String(event.data?.callId || "") };
  } else if (event.type === "tool/result") {
    data = { callId: String(event.data?.callId || event.data?.toolCallId || "") };
  } else if (event.type === "turn/end") {
    data = { reason: { kind: String(event.data?.reason?.kind || "stop") } };
  } else if (!["turn/start", "assistant/message"].includes(event.type)) {
    return;
  }
  windowRef.webContents.send("live-event", { sessionId: frame.sessionId, event: { type: event.type, seq: event.seq, data } });
}

function muxUrl() {
  const url = new URL("/api/events.mux", HARNESS_URL);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
}

function connectQueueMux() {
  if (muxStopped || process.env.WIDGET_SCREENSHOT_PATH || muxSocket) return;
  const socket = new WebSocket(muxUrl());
  muxSocket = socket;

  // A half-open TCP connection (laptop sleep, VPN or Wi-Fi switch) never delivers
  // onclose, so without this watchdog the socket stays truthy forever, the guard
  // above returns early on every retry, and live events stop arriving for good —
  // while HTTP polling keeps the rest of the UI looking perfectly healthy.
  const noteTraffic = () => {
    clearTimeout(muxSilenceTimer);
    muxSilenceTimer = setTimeout(() => {
      if (muxSocket === socket) socket.close();
    }, MUX_SILENCE_TIMEOUT);
  };

  socket.onopen = () => {
    muxReconnectDelay = MUX_RECONNECT_MIN;
    noteTraffic();
  };
  socket.onmessage = (event) => {
    noteTraffic();
    try {
      const envelope = JSON.parse(String(event.data));
      const frame = envelope?.payload;
      if (frame?.type === "session/subscribed" && queueSnapshots.has(frame.sessionId)) publishQueue(frame.sessionId, []);
      else if (frame?.type === "session/queue" && frame.sessionId) publishQueue(frame.sessionId, frame.items);
      else if (frame?.type === "session/event") publishLiveEvent(frame);
    } catch {}
  };
  const reconnect = () => {
    clearTimeout(muxSilenceTimer);
    muxSilenceTimer = null;
    if (muxSocket === socket) muxSocket = null;
    if (!muxStopped && !muxReconnectTimer) {
      const delay = muxReconnectDelay;
      // Back off so an offline Harness is not hammered every 1.5s indefinitely.
      muxReconnectDelay = Math.min(muxReconnectDelay * 2, MUX_RECONNECT_MAX);
      muxReconnectTimer = setTimeout(() => {
        muxReconnectTimer = null;
        connectQueueMux();
      }, delay);
    }
  };
  socket.onclose = reconnect;
  socket.onerror = () => {
    // onerror does not always imply onclose; force the socket through one path.
    if (muxSocket === socket && socket.readyState !== WebSocket.CLOSED) socket.close();
  };
  noteTraffic();
}

function captureWindowBounds(mode, bounds, side = preferences.compactSide, setLastMode = true) {
  const previousMode = preferences.windowState.mode;
  const canonicalBounds = mode === "orb" && compactStatus.expanded
    ? resizeCompactAnchor(bounds, ORB_EXPANDED_HEIGHT, ORB_SIZE)
    : bounds;
  const windowState = captureModeBounds(preferences.windowState, mode, canonicalBounds, side);
  if (!setLastMode) windowState.mode = previousMode;
  preferences = { ...preferences, windowState };
  if (mode === "full") fullBounds = windowState.full;
}

function captureFullBounds() {
  if (!windowRef || windowRef.isDestroyed() || windowMode !== "full") return;
  captureWindowBounds("full", windowRef.getBounds());
}

function applyWindowLayer(mode = windowMode) {
  return applyPlatformWindowLayer(windowRef, {
    layer: preferences.windowLayer,
    mode,
    capabilities: PLATFORM_CAPABILITIES,
  });
}

function setWindowLayerPreference(value) {
  preferences.windowLayer = normalizeWindowLayer(value, PLATFORM_CAPABILITIES);
  applyWindowLayer();
  savePreferences();
  return preferences.windowLayer;
}

function applyEdgePointerHit(active = false) {
  if (!windowRef || windowRef.isDestroyed()) return;
  if (!PLATFORM_CAPABILITIES.edgeMouseForwarding) {
    windowRef.setIgnoreMouseEvents(false);
    return;
  }
  const ignore = windowMode === "edge" && !active && !compactDragOrigin;
  if (ignore) windowRef.setIgnoreMouseEvents(true, { forward: true });
  else windowRef.setIgnoreMouseEvents(false);
}

function moveWindowWithinNearestDisplay(bounds, candidate) {
  if (!PLATFORM_CAPABILITIES.programmaticPosition) return bounds;
  const display = screen.getDisplayNearestPoint({ x: Math.round(candidate.x), y: Math.round(candidate.y) }).workArea;
  const moved = moveCompactBounds(bounds, candidate, display);
  windowRef.setPosition(moved.x, moved.y, false);
  return moved;
}

function snapCurrentCompactWindow({ traceEnd = false } = {}) {
  if (!windowRef || windowMode === "full") return windowRef?.getBounds();
  const bounds = windowRef.getBounds();
  if (!PLATFORM_CAPABILITIES.programmaticPosition) return { ...bounds, side: preferences.compactSide };
  const display = screen.getDisplayMatching(bounds).workArea;
  const snapped = snapCompactBounds(bounds, display, windowMode);
  if (traceEnd) traceCompactDrag("end", { before: bounds, snapped });
  preferences.compactSide = snapped.side;
  setPlatformBounds(windowRef, { x: snapped.x, y: snapped.y, width: snapped.width, height: snapped.height }, true, PLATFORM_CAPABILITIES);
  captureWindowBounds(windowMode, snapped, snapped.side);
  savePreferences();
  windowRef.webContents.send("compact-side", preferences.compactSide);
  return { ...windowRef.getBounds(), side: preferences.compactSide };
}

async function prepareFile(filePath) {
  const resolved = path.resolve(String(filePath));
  // Asynchronous on purpose: the main process is single-threaded, and reading plus
  // base64-encoding up to twelve 8 MB files synchronously froze the window, the tray
  // and every IPC handler for seconds while Windows painted "Not responding".
  const info = await fsPromises.stat(resolved);
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
    data: (await fsPromises.readFile(resolved)).toString("base64"),
    name: path.basename(resolved),
    path: resolved,
    bytes: info.size,
  };
}

async function prepareFiles(filePaths) {
  const resolved = [...new Set((filePaths || []).map((value) => path.resolve(String(value))))].slice(0, 12);
  const settled = await Promise.allSettled(resolved.map(prepareFile));
  // One unreadable or oversized file used to reject the whole batch, so the user got
  // nothing back and no way to tell which file was at fault. Report per file instead.
  const attachments = [];
  const failures = [];
  settled.forEach((entry, index) => {
    if (entry.status === "fulfilled") attachments.push(entry.value);
    else {
      failures.push({
        name: path.basename(resolved[index]),
        error: entry.reason instanceof Error ? entry.reason.message : String(entry.reason),
      });
    }
  });
  return { attachments, failures };
}

function applyWindowMode(nextMode, { captureCurrent = true, persist = true, preserveCompactPosition = false } = {}) {
  if (!windowRef || windowRef.isDestroyed() || !["full", "orb", "edge"].includes(nextMode)) return;
  if (nextMode === "edge" && PLATFORM_CAPABILITIES.edgeMode === "unavailable") nextMode = "orb";
  const preservedOrbPosition = preserveCompactPosition && nextMode === "orb" ? preferences.windowState.orb : null;
  if (captureCurrent) captureWindowBounds(windowMode, windowRef.getBounds());
  windowMode = nextMode;
  preferences.windowState.mode = nextMode;
  windowRef.setMinimumSize(1, 1);

  if (nextMode === "full") {
    const fallbackSize = SIZE_PRESETS[preferences.size] || SIZE_PRESETS.standard;
    const fallback = { ...windowRef.getBounds(), width: fallbackSize[0], height: fallbackSize[1] };
    const target = preferences.windowState.full || fullBounds || fallback;
    const display = screen.getDisplayMatching(target).workArea;
    const restored = fitFullBounds(target, fallback, display, {
      minWidth: SCREENSHOT_MODE ? 1 : FULL_MIN_WIDTH,
      minHeight: SCREENSHOT_MODE ? 1 : FULL_MIN_HEIGHT,
    });
    windowRef.setResizable(true);
    setPlatformSkipTaskbar(windowRef, false, PLATFORM_CAPABILITIES);
    setPlatformBounds(windowRef, restored, true, PLATFORM_CAPABILITIES);
    windowRef.setMinimumSize(
      SCREENSHOT_MODE ? 1 : Math.min(FULL_MIN_WIDTH, display.width),
      SCREENSHOT_MODE ? 1 : Math.min(FULL_MIN_HEIGHT, display.height),
    );
    captureWindowBounds("full", restored);
  } else if (nextMode === "orb") {
    const source = fullBounds || windowRef.getBounds();
    const orbWidth = compactStatus.expanded ? ORB_EXPANDED_WIDTH : compactStatus.active ? ORB_STATUS_WIDTH : ORB_QUICK_WIDTH;
    const orbHeight = compactStatus.expanded ? ORB_EXPANDED_HEIGHT : ORB_SIZE;
    const saved = compactStatus.expanded
      ? resizeCompactAnchor(preferences.windowState.orb, ORB_SIZE, ORB_EXPANDED_HEIGHT)
      : preferences.windowState.orb;
    const fallbackAnchor = { x: source.x, y: source.y, side: preferences.compactSide };
    const runtimeFallback = compactStatus.expanded
      ? resizeCompactAnchor(fallbackAnchor, ORB_SIZE, ORB_EXPANDED_HEIGHT)
      : fallbackAnchor;
    const fallback = { ...runtimeFallback, width: orbWidth, height: orbHeight };
    const display = screen.getDisplayMatching(saved ? { ...fallback, x: saved.x, y: saved.y } : source).workArea;
    const restored = restoreCompactBounds(saved, fallback, display, {
      mode: "orb",
      width: orbWidth,
      height: orbHeight,
      side: preferences.compactSide,
    });
    windowRef.setResizable(false);
    setPlatformSkipTaskbar(windowRef, true, PLATFORM_CAPABILITIES);
    preferences.compactSide = restored.side;
    setPlatformBounds(windowRef, { x: restored.x, y: restored.y, width: restored.width, height: restored.height }, true, PLATFORM_CAPABILITIES);
    captureWindowBounds("orb", restored, restored.side);
    if (preservedOrbPosition) preferences.windowState.orb = preservedOrbPosition;
  } else {
    const source = fullBounds || windowRef.getBounds();
    const saved = preferences.windowState.edge;
    const fallback = {
      x: source.x,
      y: source.y + Math.round((source.height - EDGE_HEIGHT) / 2),
      width: EDGE_WIDTH,
      height: EDGE_HEIGHT,
      side: preferences.compactSide,
    };
    const display = screen.getDisplayMatching(saved ? { ...fallback, x: saved.x, y: saved.y } : source).workArea;
    const restored = restoreCompactBounds(saved, fallback, display, {
      mode: "edge",
      width: EDGE_WIDTH,
      height: EDGE_HEIGHT,
      side: preferences.compactSide,
    });
    windowRef.setResizable(false);
    setPlatformSkipTaskbar(windowRef, true, PLATFORM_CAPABILITIES);
    preferences.compactSide = restored.side;
    setPlatformBounds(windowRef, { x: restored.x, y: restored.y, width: restored.width, height: restored.height }, true, PLATFORM_CAPABILITIES);
    captureWindowBounds("edge", restored, restored.side);
  }

  if (persist) savePreferences();
  applyWindowLayer(nextMode);
  applyEdgePointerHit(false);
  if (nextMode === "full") windowRef.show();
  else windowRef.showInactive();
  windowRef.webContents.send("window-mode", windowMode);
  windowRef.webContents.send("compact-side", preferences.compactSide);
}

function createWindow() {
  const screenshotPath = process.env.WIDGET_SCREENSHOT_PATH;
  const [presetWidth, presetHeight] = SIZE_PRESETS[preferences.size] || SIZE_PRESETS.standard;
  const requestedWidth = Number(process.env.WIDGET_SCREENSHOT_WIDTH);
  const requestedHeight = Number(process.env.WIDGET_SCREENSHOT_HEIGHT);
  const width = Number.isFinite(requestedWidth) && requestedWidth >= 280 ? requestedWidth : presetWidth;
  const height = Number.isFinite(requestedHeight) && requestedHeight >= 280 ? requestedHeight : presetHeight;
  windowRef = new BrowserWindow({
    width,
    height,
    minWidth: screenshotPath ? 1 : FULL_MIN_WIDTH,
    minHeight: screenshotPath ? 1 : FULL_MIN_HEIGHT,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: preferences.windowLayer !== "normal",
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
  const initialFallback = windowRef.getBounds();
  // Visual smoke requests must be deterministic even when the real app has a
  // different full-window size saved in user preferences.
  const initialTarget = screenshotPath ? initialFallback : (preferences.windowState.full || initialFallback);
  const initialDisplay = screen.getDisplayMatching(initialTarget).workArea;
  fullBounds = fitFullBounds(initialTarget, initialFallback, initialDisplay, {
    minWidth: screenshotPath ? 1 : FULL_MIN_WIDTH,
    minHeight: screenshotPath ? 1 : FULL_MIN_HEIGHT,
  });
  setPlatformBounds(windowRef, fullBounds, false, PLATFORM_CAPABILITIES);
  captureWindowBounds("full", fullBounds, preferences.compactSide, false);
  applyWindowLayer("full");
  applyPlatformOpacity(windowRef, preferences.opacity, PLATFORM_CAPABILITIES);
  const screenshotTab = process.env.WIDGET_SCREENSHOT_TAB || "";
  const screenshotFixture = process.env.WIDGET_SCREENSHOT_FIXTURE || "";
  const screenshotFiles = process.env.WIDGET_SCREENSHOT_FILES || "";
  const screenshotBackdrop = process.env.WIDGET_SCREENSHOT_BACKDROP || "";
  windowRef.loadFile(path.join(__dirname, "renderer", "index.html"), {
    query: {
      ...(screenshotTab ? { screenshotTab } : {}),
      ...(screenshotFixture ? { screenshotFixture } : {}),
      ...(screenshotFiles ? { screenshotFiles } : {}),
      ...(screenshotBackdrop ? { screenshotBackdrop } : {}),
      ...(process.env.WIDGET_SCREENSHOT_PATH ? { screenshotStatic: "1" } : {}),
    },
  });
  // The renderer only ever shows local files. Anything that tries to replace the
  // widget with remote content, or to spawn a second Electron window, is a bug or
  // an injection attempt: refuse it and hand safe links to the real browser.
  windowRef.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url);
    return { action: "deny" };
  });
  windowRef.webContents.on("will-navigate", (event, url) => {
    if (url === windowRef.webContents.getURL()) return;
    event.preventDefault();
    openExternalUrl(url);
  });
  windowRef.webContents.on("will-attach-webview", (event) => event.preventDefault());
  // A frameless transparent window that loses its renderer stays on screen as a dead
  // click-through shape the user cannot close except from the task manager. Reload it,
  // but give up after a few attempts so a reproducible crash cannot become a loop.
  windowRef.webContents.on("render-process-gone", (_event, details) => {
    console.error("Renderer gone", details.reason);
    if (app.isQuitting || details.reason === "clean-exit") return;
    if (rendererRecoveryCount >= MAX_RENDERER_RECOVERIES) {
      app.isQuitting = true;
      app.quit();
      return;
    }
    rendererRecoveryCount += 1;
    windowRef.webContents.reload();
  });
  windowRef.once("ready-to-show", () => {
    if (screenshotPath) applyWindowMode("full", { captureCurrent: false, persist: false });
    else applyWindowMode(preferences.windowState.mode, { captureCurrent: false, persist: false });
  });
  windowRef.on("close", (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      applyWindowMode("edge");
    }
  });
  windowRef.on("resize", () => {
    if (windowMode !== "full") return;
    captureFullBounds();
    schedulePreferenceSave();
  });
  windowRef.on("move", () => {
    if (windowMode !== "full") return;
    captureFullBounds();
    schedulePreferenceSave();
  });

  if (screenshotPath) {
    windowRef.webContents.once("did-finish-load", () => {
      const requestedDelay = Number(process.env.WIDGET_SCREENSHOT_DELAY);
      const captureDelay = Number.isFinite(requestedDelay) && requestedDelay >= 1200 ? requestedDelay : 5000;
      const requestedMode = process.env.WIDGET_SCREENSHOT_MODE;
      const requestedSide = process.env.WIDGET_SCREENSHOT_SIDE;
      if (["orb", "edge"].includes(requestedMode)) {
        setTimeout(() => {
          if (["left", "right"].includes(requestedSide)) preferences.compactSide = requestedSide;
          applyWindowMode(requestedMode);
        }, Math.min(3500, captureDelay - 650));
      }
      setTimeout(async () => {
        const auditPath = process.env.WIDGET_UI_AUDIT_PATH;
        let audit = null;
        if (auditPath) {
          audit = await windowRef.webContents.executeJavaScript(`(() => {
            const selectors = ['.widget-shell','.titlebar','.tabs','.panel.active','.chat-heading','.agent-controls','.activity-card.has-activity','.messages','.model-setup-card','.model-picker-status','.tool-group','.tool-call','.queue-dock.has-items','.attachment-bar.has-items','.command-menu.open','.scroll-latest:not([hidden])','.composer','.picker.open .picker-menu','.settings-panel.open','.orb-mode','.orb-status','.orb-session-row','.orb-reply-form','.orb-history-button','.edge-mode'];
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
              focusChromeHidden: ['.titlebar','.chat-heading','.activity-card','.settings-panel'].every((selector) => getComputedStyle(document.querySelector(selector)).display === 'none'),
              commandRows: document.querySelectorAll('.command-row').length,
              commandAboveComposer: !document.querySelector('.command-menu.open') || document.querySelector('.command-menu.open').getBoundingClientRect().bottom <= document.querySelector('.composer').getBoundingClientRect().top + 1,
              commandFitsWidth: !document.querySelector('.command-menu.open') || document.querySelector('.command-menu.open').scrollWidth <= document.querySelector('.command-menu.open').clientWidth + 1,
              queueRows: document.querySelectorAll('.queue-row').length,
              queueActions: document.querySelectorAll('.queue-action').length,
              queueSingleLine: [...document.querySelectorAll('.queue-row')].every((row) => row.getBoundingClientRect().height <= 40),
              queueAboveComposer: !document.querySelector('.queue-dock.has-items') || document.querySelector('.queue-dock.has-items').getBoundingClientRect().bottom <= document.querySelector('.composer').getBoundingClientRect().top + 1,
              attachmentChips: document.querySelectorAll('.attachment-chip').length,
              attachmentsAboveComposer: !document.querySelector('.attachment-bar.has-items') || document.querySelector('.attachment-bar.has-items').getBoundingClientRect().bottom <= document.querySelector('.composer').getBoundingClientRect().top + 1,
              liveBubbles: document.querySelectorAll('.live-assistant').length,
               offlineBanners: document.querySelectorAll('.offline-banner.show').length,
               startHarnessButtons: document.querySelectorAll('#offlineBanner.show #startHarnessButton').length,
               startHarnessText: document.querySelector('#startHarnessButton')?.textContent?.trim() || '',
               startHarnessButtonVisible: (() => {
                 const button = document.querySelector('#startHarnessButton');
                 const rect = button?.getBoundingClientRect();
                 const style = button && getComputedStyle(button);
                 return Boolean(rect && rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility === 'visible' && Number(style.opacity) > 0);
               })(),
               startHarnessButtonDisabled: Boolean(document.querySelector('#startHarnessButton')?.disabled),
               startHarnessTextPainted: (() => {
                 const style = getComputedStyle(document.querySelector('#startHarnessButton'));
                 const alpha = (color) => {
                   if (!color || color === 'transparent') return 0;
                   return color.endsWith(', 0)') ? 0 : 1;
                 };
                 return Number(style.opacity) > 0 && alpha(style.color) > 0 && alpha(style.webkitTextFillColor || style.color) > 0;
               })(),
               startHarnessTextWidth: (() => {
                 const button = document.querySelector('#startHarnessButton');
                 const range = document.createRange();
                 range.selectNodeContents(button);
                 return Math.round(range.getBoundingClientRect().width * 100) / 100;
               })(),
               startHarnessButtonRect: (() => {
                 const rect = document.querySelector('#startHarnessButton').getBoundingClientRect();
                 return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
               })(),
               headerStateText: document.querySelector('#avatarState')?.textContent || '',
              scrollLatestVisible: Boolean(document.querySelector('.scroll-latest:not([hidden])')),
              glowControl: document.querySelectorAll('#glowRange').length,
              glowIntensity: getComputedStyle(document.documentElement).getPropertyValue('--chat-glow-intensity').trim(),
              windowLayerOptions: document.querySelectorAll('#windowLayerSwitch [data-layer]').length,
              agentWorking: document.querySelectorAll('.session-card.state-working').length,
              agentIdle: document.querySelectorAll('.session-card.state-idle').length,
              agentError: document.querySelectorAll('.session-card.state-error').length,
              orbUtilityButtons: document.querySelectorAll('#orbMode > button:not(#orbRestore):not(#orbStatus)').length,
              orbNotification: document.body.classList.contains('orb-has-notification'),
              orbStatusShadow: getComputedStyle(document.querySelector('#orbStatus')).boxShadow,
              orbReplyShadow: getComputedStyle(document.querySelector('#orbHistoryButton')).boxShadow,
              orbRecentRows: document.querySelectorAll('.orb-session-row').length,
              orbRecentUniqueSessions: new Set([...document.querySelectorAll('.orb-session-row .orb-session-open')].map((button) => button.getAttribute('aria-label'))).size,
              orbHistoryOpen: document.body.classList.contains('orb-history-open'),
              orbQuickReplyOpen: document.body.classList.contains('orb-reply-open'),
              orbReplyTarget: document.querySelector('#orbReplyTitle')?.textContent || '',
              orbReplyInputVisible: (() => {
                const input = document.querySelector('#orbReplyInput');
                const rect = input?.getBoundingClientRect();
                return Boolean(rect && rect.width > 0 && rect.height > 0 && !input.closest('[hidden]'));
              })(),
              orbPanelClipped: (() => {
                const panel = document.querySelector('#orbStatus');
                const rect = panel?.getBoundingClientRect();
                return Boolean(rect && (rect.left < -1 || rect.top < -1 || rect.right > innerWidth + 1 || rect.bottom > innerHeight + 1));
              })(),
              compactSide: document.body.classList.contains('side-left') ? 'left' : 'right',
              edgeHitActive: document.querySelector('#edgeMode')?.classList.contains('edge-hit-active') || false,
              edgeLineWidth: Math.round(document.querySelector('.edge-line')?.getBoundingClientRect().width || 0),
              edgeHaloOpacity: getComputedStyle(document.querySelector('.edge-line'), '::before').opacity,
              edgePrimary: getComputedStyle(document.body).getPropertyValue('--edge-primary').trim(),
              edgeState: document.body.classList.contains('activity-thinking') ? 'thinking'
                : document.body.classList.contains('activity-writing') ? 'writing'
                  : document.body.classList.contains('activity-tool') ? 'tool'
                    : document.body.classList.contains('state-error') ? 'error'
                      : document.body.classList.contains('state-done') ? 'done'
                        : document.body.classList.contains('state-waiting') ? 'waiting' : 'idle',
              brandUserSelect: getComputedStyle(document.querySelector('.brand')).userSelect,
              composerUtilitiesStacked: (() => {
                const attach = document.querySelector('#attachButton').getBoundingClientRect();
                const commands = document.querySelector('#commandsButton').getBoundingClientRect();
                return Math.abs((attach.left + attach.right - commands.left - commands.right) / 2) <= 1 && attach.bottom <= commands.top + 1;
              })(),
              contextRingSize: Math.round(document.querySelector('#contextMeter svg').getBoundingClientRect().width),
              contextUnavailable: document.querySelector('#contextMeter').classList.contains('unavailable'),
              composerTextareaWidth: Math.round(document.querySelector('#messageInput').getBoundingClientRect().width),
              composerInputHeight: Math.round(document.querySelector('#messageInput').getBoundingClientRect().height),
              composerHeight: Math.round(document.querySelector('#chatForm').getBoundingClientRect().height),
              composerUtilityHeight: Math.round(document.querySelector('.composer-utility-stack').getBoundingClientRect().height),
              composerInputScrollable: document.querySelector('#messageInput').scrollHeight > document.querySelector('#messageInput').clientHeight + 1,
              composerInputMaxDelta: Math.round(Math.abs(document.querySelector('#messageInput').getBoundingClientRect().height - innerHeight / 3) * 100) / 100,
              conversationBubbles: document.querySelectorAll('#messages .bubble').length,
              shortMessageVisible: (() => {
                const bubble = document.querySelector('#messages .bubble');
                const viewport = document.querySelector('#messages');
                if (!bubble || !viewport) return false;
                const bubbleRect = bubble.getBoundingClientRect();
                const viewportRect = viewport.getBoundingClientRect();
                return bubbleRect.width > 0 && bubbleRect.height > 0 && bubbleRect.top >= viewportRect.top - 1 && bubbleRect.bottom <= viewportRect.bottom + 1;
              })(),
              sendWidth: Math.round(document.querySelector('#sendButton').getBoundingClientRect().width),
              sendHeight: Math.round(document.querySelector('#sendButton').getBoundingClientRect().height),
              modelControlLabel: document.querySelector('.model-button-copy small')?.textContent || '',
              modelControlText: document.querySelector('#modelButtonText')?.textContent || '',
              closedModelLabel: document.querySelector('#controlsPrimary')?.textContent || '',
              closedModelVisible: (() => {
                const label = document.querySelector('#controlsPrimary')?.getBoundingClientRect();
                const summary = document.querySelector('#agentControls > summary')?.getBoundingClientRect();
                return Boolean(label && summary && label.width > 0 && label.left >= summary.left && label.right <= summary.right);
              })(),
              closedModelUnclipped: (() => {
                const label = document.querySelector('#controlsPrimary');
                return Boolean(label && label.clientWidth > 0 && label.scrollWidth <= label.clientWidth + 1);
              })(),
              modelPickerActions: document.querySelectorAll('.model-picker-actions button').length,
              modelSetupCards: document.querySelectorAll('.model-setup-card').length,
              modelSetupActions: document.querySelectorAll('.model-setup-actions button').length,
              autoStartHydrated: !document.querySelector('#autoStartToggle').disabled,
              autoStartStatus: document.querySelector('#autoStartStatus').textContent,
              offlineSessionText: document.querySelector('#sessions .empty-state')?.textContent || '',
              liveCaretDisplay: getComputedStyle(document.querySelector('.live-assistant') || document.body, '::after').display,
              contextCenterDelta: (() => {
                const meter = document.querySelector('#contextMeter').getBoundingClientRect();
                const value = document.querySelector('#contextValue').getBoundingClientRect();
                return Math.round(Math.max(
                  Math.abs((meter.left + meter.right - value.left - value.right) / 2),
                  Math.abs((meter.top + meter.bottom - value.top - value.bottom) / 2),
                ) * 100) / 100;
              })(),
            };
            return { viewport: { width: innerWidth, height: innerHeight }, scroll: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }, boxes, offenders, semantic };
          })()`);
          audit.compactDragTrace = compactDragTrace;
          audit.windowBounds = windowRef.getBounds();
        }
        const image = await windowRef.webContents.capturePage();
        if (auditPath) {
          const rect = audit.semantic.startHarnessButtonRect;
          let brightPixels = 0;
          if (rect?.width > 0 && rect?.height > 0) {
            const size = image.getSize();
            const x = Math.max(0, Math.min(size.width - 1, Math.floor(rect.x)));
            const y = Math.max(0, Math.min(size.height - 1, Math.floor(rect.y)));
            const width = Math.max(1, Math.min(size.width - x, Math.ceil(rect.width)));
            const height = Math.max(1, Math.min(size.height - y, Math.ceil(rect.height)));
            const bitmap = image.crop({ x, y, width, height }).toBitmap();
            for (let offset = 0; offset + 3 < bitmap.length; offset += 4) {
              if (bitmap[offset] >= 205 && bitmap[offset + 1] >= 205 && bitmap[offset + 2] >= 205 && bitmap[offset + 3] >= 205) brightPixels += 1;
            }
          }
          audit.semantic.startHarnessBrightPixels = brightPixels;
          mkdirSync(path.dirname(auditPath), { recursive: true });
          writeFileSync(auditPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
        }
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
  return result.canceled ? { attachments: [], failures: [] } : prepareFiles(result.filePaths);
});
ipcMain.handle("prepare-files", async (_event, filePaths) => prepareFiles(filePaths));
ipcMain.handle("create-session", async (_event, options) => {
  const sessionId = await api.createSession(options || {});
  await api.ensureFullAccess(sessionId);
  return { sessionId };
});
ipcMain.handle("select-model", async (_event, payload) => {
  return api.selectModel(requireSessionId(payload?.sessionId), payload?.selection);
});
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
ipcMain.handle("get-queue", (_event, sessionId) => queueSnapshots.get(String(sessionId || "")) || []);
ipcMain.handle("update-queue", async (_event, payload) => {
  const sessionId = String(payload?.sessionId || "");
  const itemId = String(payload?.itemId || "");
  const kind = String(payload?.action?.kind || "");
  if (!sessionId || !itemId || !["remove", "steer", "edit"].includes(kind)) throw new Error("Invalid queue action");
  const action = kind === "edit"
    ? { kind, content: [{ type: "text", text: String(payload?.action?.text || "").trim() }] }
    : { kind };
  if (kind === "edit" && !action.content[0].text) throw new Error("Queued message is empty");
  return api.updateQueue(sessionId, itemId, action);
});
ipcMain.handle("open-harness", async () => shell.openExternal(HARNESS_URL));
ipcMain.handle("open-harness-session", async (_event, sessionId) => shell.openExternal(harnessSessionUrl(HARNESS_URL, sessionId)));
ipcMain.handle("open-project", async () => shell.openExternal(REPOSITORY_URL));
ipcMain.handle("open-external", async (_event, value) => {
  const url = parseExternalUrl(value);
  if (!url) throw new Error("Unsupported external link protocol");
  return shell.openExternal(url);
});
ipcMain.handle("start-harness", async () => harnessLauncher.start());
ipcMain.handle("set-window-layer", (_event, value) => {
  return setWindowLayerPreference(value);
});
ipcMain.handle("set-opacity", (_event, value) => {
  preferences.opacity = Math.max(0.65, Math.min(1, Number(value) || 0.96));
  applyPlatformOpacity(windowRef, preferences.opacity, PLATFORM_CAPABILITIES);
  // Dragging a slider fires continuously; a full synchronous rewrite per tick would
  // stall the main process, so the write is debounced like resize and move already are.
  schedulePreferenceSave();
  return preferences.opacity;
});
ipcMain.handle("set-glow-intensity", (_event, value) => {
  const numeric = Number(value);
  preferences.glowIntensity = Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : 0.82;
  schedulePreferenceSave();
  return preferences.glowIntensity;
});
ipcMain.handle("set-size", (_event, preset) => {
  const size = SIZE_PRESETS[preset] || SIZE_PRESETS.standard;
  preferences.size = SIZE_PRESETS[preset] ? preset : "standard";
  if (windowMode === "full") windowRef.setSize(size[0], size[1], true);
  fullBounds = { ...(fullBounds || windowRef.getBounds()), width: size[0], height: size[1] };
  captureWindowBounds("full", fullBounds, preferences.compactSide, windowMode === "full");
  savePreferences();
  return preferences.size;
});
ipcMain.handle("set-auto-start", (_event, enabled) => {
  return autoStartController.setEnabled(enabled);
});
ipcMain.handle("get-preferences", () => {
  const autoStart = autoStartPreference();
  return {
    alwaysOnTop: preferences.windowLayer !== "normal",
    windowLayer: preferences.windowLayer,
    autoStart: autoStart.enabled,
    autoStartAvailable: autoStart.available,
    opacity: preferences.opacity,
    glowIntensity: preferences.glowIntensity,
    size: preferences.size,
    windowMode,
    compactSide: preferences.compactSide,
    platformCapabilities: PLATFORM_CAPABILITIES,
  };
});
ipcMain.handle("app-info", () => ({ version: app.getVersion(), repository: REPOSITORY_URL, productName: PRODUCT_NAME }));
ipcMain.handle("set-window-mode", (_event, mode) => {
  applyWindowMode(mode);
  return windowMode;
});
ipcMain.handle("set-compact-status", (_event, value) => {
  const wasActive = compactStatus.active;
  const wasExpanded = compactStatus.expanded;
  compactStatus = {
    active: Boolean(value && value.active),
    expanded: Boolean(value && value.expanded),
    label: String(value && value.label || "Ready").slice(0, 80),
    text: String(value && value.text || "").slice(0, 180),
  };
  if (windowMode === "orb" && (wasActive !== compactStatus.active || wasExpanded !== compactStatus.expanded) && !compactDragOrigin) {
    applyWindowMode("orb", { captureCurrent: false, persist: false, preserveCompactPosition: true });
  }
  return compactStatus;
});
ipcMain.on("set-edge-pointer-active", (event, active) => {
  if (!windowRef || windowRef.isDestroyed() || event.sender !== windowRef.webContents) return;
  applyEdgePointerHit(Boolean(active));
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
  moveWindowWithinNearestDisplay(fullDragOrigin.bounds, candidate);
  fullBounds = { ...windowRef.getBounds() };
});
ipcMain.handle("end-full-drag", () => {
  fullDragOrigin = null;
  captureFullBounds();
  savePreferences();
  return windowRef?.getBounds();
});
ipcMain.on("begin-compact-drag", (event, value) => {
  if (!windowRef || windowMode === "full" || event.sender !== windowRef.webContents) return;
  const screenX = Number(value?.x);
  const screenY = Number(value?.y);
  if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return;
  applyEdgePointerHit(true);
  compactDragOrigin = { screenX, screenY, bounds: windowRef.getBounds() };
  traceCompactDrag("begin", { screenX, screenY, bounds: compactDragOrigin.bounds });
});
ipcMain.on("begin-full-drag", (event, value) => {
  if (!windowRef || windowMode !== "full" || event.sender !== windowRef.webContents) return;
  const screenX = Number(value?.x);
  const screenY = Number(value?.y);
  if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return;
  fullDragOrigin = { screenX, screenY, bounds: windowRef.getBounds() };
});
ipcMain.handle("end-compact-drag", () => {
  compactDragOrigin = null;
  return snapCurrentCompactWindow({ traceEnd: true });
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
  const moved = moveWindowWithinNearestDisplay(compactDragOrigin.bounds, candidate);
  traceCompactDrag("move", { screenX, screenY, x: moved.x, y: moved.y });
});
ipcMain.on("agent-complete", () => {
  if (windowMode !== "edge" || !windowRef || windowRef.isDestroyed()) return;
  windowRef.webContents.send("edge-bounce");
});

app.on("second-instance", () => {
  if (!windowRef || windowRef.isDestroyed()) return;
  if (windowRef.isMinimized()) windowRef.restore();
  windowRef.show();
  windowRef.focus();
});

app.whenReady().then(() => {
  if (process.platform === "win32") app.setAppUserModelId(APP_ID);
  // The screen module is unavailable until the app is ready, so these are attached
  // here rather than at module scope.
  screen.on("display-metrics-changed", reclampToCurrentDisplays);
  screen.on("display-removed", reclampToCurrentDisplays);
  screen.on("display-added", reclampToCurrentDisplays);
  loadPreferences();
  autoStartController = createAutoStartController({ app });
  autoStartController.migrateLegacy();
  harnessLauncher = createHarnessLauncher({
    harnessUrl: HARNESS_URL,
    desktopPath: app.getPath("desktop"),
    workingDirectory: path.join(app.getPath("userData"), "harness-workspace"),
    openPath: (filePath) => shell.openPath(filePath),
  });
  createWindow();
  connectQueueMux();
  const iconPath = path.join(__dirname, "renderer", "assets", "neoxider-github.png");
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 32, height: 32 });
  tray = new Tray(icon);
  tray.setToolTip(PRODUCT_NAME);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Show widget", click: () => applyWindowMode("full") },
    { label: "Open Harness", click: () => shell.openExternal(HARNESS_URL) },
    { type: "separator" },
    { label: "Quit", click: () => { app.isQuitting = true; app.quit(); } },
  ]));
  tray.on("double-click", () => applyWindowMode(windowMode === "full" ? "edge" : "full"));
});

app.on("before-quit", () => {
  app.isQuitting = true;
  if (windowRef && !windowRef.isDestroyed()) captureWindowBounds(windowMode, windowRef.getBounds());
  if (settingsStore) savePreferences();
  muxStopped = true;
  clearTimeout(muxReconnectTimer);
  muxReconnectTimer = null;
  clearTimeout(muxSilenceTimer);
  muxSilenceTimer = null;
  muxSocket?.close();
  muxSocket = null;
  // An undestroyed tray icon can survive as a ghost in the Windows notification area.
  tray?.destroy();
  tray = null;
});

// Unplugging a monitor or changing resolution can leave the widget off-screen, and
// nothing re-clamped it until the next mode switch. Re-apply the current mode so the
// existing bounds are fitted into the work area that actually exists now.
function reclampToCurrentDisplays() {
  if (!windowRef || windowRef.isDestroyed()) return;
  applyWindowMode(windowMode, { captureCurrent: false, persist: false });
}
app.on("activate", () => (windowRef && !windowRef.isDestroyed() ? applyWindowMode("full") : createWindow()));
app.on("window-all-closed", (event) => event.preventDefault());
