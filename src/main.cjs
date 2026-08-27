const path = require("node:path");
const { app, BrowserWindow, desktopCapturer, dialog, globalShortcut, ipcMain, Menu, nativeImage, screen, session, shell, Tray } = require("electron");
const { HarnessApi } = require("./harness-api.cjs");
const { registerIpcHandlers } = require("./ipc-handlers.cjs");
const { createAutoStartController } = require("./auto-start.cjs");
const { createHarnessLauncher } = require("./harness-launcher.cjs");
const { createGameLayerKeeper } = require("./game-layer-keeper.cjs");
const { createEdgeHitTracker } = require("./edge-hit-tracker.cjs");
const { createHotkeyManager } = require("./hotkey-manager.cjs");
const { createQuitCoordinator } = require("./quit-coordinator.cjs");
const { createRegionSelector } = require("./region-selector.cjs");
const { createScreenshotCaptureGate, createScreenshotService } = require("./screenshot-service.cjs");
const { createInstalledUpdateService } = require("./installed-update-service.cjs");
const { createUpdateService } = require("./update-service.cjs");
const {
  applyPlatformOpacity,
  applyPlatformWindowLayer,
  detectPlatformCapabilities,
  normalizeWindowLayer,
  setPlatformBounds,
  setPlatformSkipTaskbar,
} = require("./platform-capabilities.cjs");
const { APP_ID, PRODUCT_NAME, REPOSITORY_URL } = require("./product.cjs");
const { createAttachmentReader } = require("./attachments.cjs");
const { queueItemView } = require("./queue-view.cjs");
const { createMuxClient } = require("./mux-client.cjs");
const { createSettingsStore, DEFAULT_PREFERENCES } = require("./settings-store.cjs");
const { configureProductUserData } = require("./user-data-migration.cjs");
const { moveCompactBounds, snapCompactBounds } = require("./window-geometry.cjs");
const { captureModeBounds, fitFullBounds, resizeCompactAnchor, restoreCompactBounds } = require("./window-state.cjs");

const HARNESS_URL = process.env.DSH_WIDGET_URL || "http://127.0.0.1:3080";
const SCREENSHOT_MODE = Boolean(process.env.WIDGET_SCREENSHOT_PATH);
const PACKAGED_SMOKE_PATH = process.env.WIDGET_PACKAGED_SMOKE_PATH || "";
const ISOLATED_SMOKE_MODE = SCREENSHOT_MODE || Boolean(PACKAGED_SMOKE_PATH);
const PLATFORM_CAPABILITIES = detectPlatformCapabilities();
app.setName(PRODUCT_NAME);
configureProductUserData({ app });
const api = new HarnessApi(HARNESS_URL);
// nativeImage is the only Electron dependency attachment reading has, so it is passed
// in rather than reached for, which keeps the rules unit-testable.
const { prepareFiles } = createAttachmentReader({
  async makeThumbnail(filePath) {
    const thumbnail = await nativeImage.createThumbnailFromPath(filePath, { width: 160, height: 100 });
    return thumbnail.isEmpty() ? "" : thumbnail.toPNG().toString("base64");
  },
});
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

let windowRef;
let tray;
let windowMode = "full";
let fullBounds;
let preferences = DEFAULT_PREFERENCES;
let settingsStore;
let autoStartController;
let harnessLauncher;
let gameLayerKeeper;
let edgeHitTracker;
let hotkeyManager;
let quitCoordinator;
let screenshotService;
let updateService;
let selectRegion;
let hotkeyRegistrationError = null;
let preferenceSaveTimer = null;
let compactStatus = { active: false, expanded: false, label: "Ready", text: "" };
let compactDragOrigin = null;
let compactStatusResizePending = false;
let fullDragOrigin = null;
let compactDragTrace = [];
const queueSnapshots = new Map();
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

function cleanupApplication() {
  clearTimeout(preferenceSaveTimer);
  preferenceSaveTimer = null;
  if (windowRef && !windowRef.isDestroyed()) captureWindowBounds(windowMode, windowRef.getBounds());
  if (settingsStore) savePreferences();
  muxClient.stop();
  gameLayerKeeper?.stop();
  edgeHitTracker?.stop();
  hotkeyManager?.dispose();
  selectRegion?.dispose();
  screenshotService?.cleanupCaptures({ maxAgeMs: 0, maxFiles: 0 });
  tray?.destroy();
  tray = null;
}

quitCoordinator = createQuitCoordinator({
  app,
  cleanup: cleanupApplication,
  onCleanupError: (error) => console.error("Application cleanup failed", error),
});
const screenshotCaptureGate = createScreenshotCaptureGate();

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

function sendToRenderer(channel, value) {
  if (!windowRef || windowRef.isDestroyed()) return false;
  windowRef.webContents.send(channel, value);
  return true;
}

function createApplicationUpdateService() {
  const shared = {
    currentVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    openExternal: (url) => shell.openExternal(url),
    onState: (state) => sendToRenderer("update-state", state),
  };
  if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_FILE) {
    return createUpdateService({
      ...shared,
      requestQuit: (reason) => quitCoordinator.requestQuit(reason),
    });
  }
  let updater = null;
  try {
    ({ autoUpdater: updater } = require("electron-updater"));
  } catch (error) {
    console.error("Installed updater is unavailable", error);
  }
  return createInstalledUpdateService({
    ...shared,
    updater,
    isMas: Boolean(process.mas),
    isWindowsStore: Boolean(process.windowsStore),
    isMacSigned: false,
  });
}

function screenshotDisplayPoint() {
  if (!windowRef || windowRef.isDestroyed()) return undefined;
  const bounds = windowRef.getBounds();
  return { x: bounds.x + Math.round(bounds.width / 2), y: bounds.y + Math.round(bounds.height / 2) };
}

async function captureScreenshotForChat(kind) {
  if (!screenshotService || !["display", "region"].includes(kind)) {
    return { ok: false, canceled: false, reason: "screenshot-service-unavailable" };
  }
  return screenshotCaptureGate.run(async () => {
    const previousMode = windowMode;
    let restoredToFull = false;
    if (windowRef && !windowRef.isDestroyed()) windowRef.hide();
    await new Promise((resolve) => setTimeout(resolve, 100));
    try {
      const result = kind === "display"
        ? await screenshotService.captureDisplay({ point: screenshotDisplayPoint() })
        : await screenshotService.captureRegion();
      if (!result.ok) return result;
      let prepared;
      try {
        prepared = await prepareFiles([result.path]);
      } finally {
        try {
          await screenshotService.removeCapture(result.path);
        } catch (error) {
          console.warn("Failed to remove prepared screenshot", error);
        }
      }
      applyWindowMode("full");
      restoredToFull = true;
      return { ...result, prepared };
    } finally {
      if (!restoredToFull && windowRef && !windowRef.isDestroyed()) {
        applyWindowMode(previousMode, { captureCurrent: false, persist: false });
      }
    }
  });
}

async function captureScreenshotFromHotkey(kind) {
  try {
    const result = await captureScreenshotForChat(kind);
    sendToRenderer("screenshot-captured", result);
  } catch (error) {
    sendToRenderer("screenshot-captured", { ok: false, canceled: false, reason: error?.code || "capture-failed", error: String(error?.message || error) });
  }
}

function hotkeyErrorView(error) {
  return {
    code: String(error?.code || "hotkey-error"),
    message: String(error?.message || error),
    action: error?.action ? String(error.action) : "",
    conflictingAction: error?.conflictingAction ? String(error.conflictingAction) : "",
    accelerator: error?.accelerator ? String(error.accelerator) : "",
  };
}

function registerConfiguredHotkeys(bindings) {
  const registration = hotkeyManager.applyAvailable(bindings);
  const conflict = registration.conflicts.at(-1);
  if (conflict) {
    hotkeyRegistrationError = {
      ...hotkeyErrorView(conflict),
      message: `${conflict.accelerator} could not be registered because another app uses it; the shortcut remains enabled and will be retried next launch`,
    };
  }
  return registration.active;
}

async function cleanupSentCaptureFiles(attachments) {
  if (!screenshotService) return;
  const paths = [...new Set((attachments || [])
    .map((item) => item?.path)
    .filter((filePath) => screenshotService.ownsCapture(filePath)))].slice(0, 12);
  await Promise.all(paths.map(async (filePath) => {
    try {
      await screenshotService.removeCapture(filePath);
    } catch (error) {
      console.warn("Failed to remove sent screenshot", error);
    }
  }));
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

// Reconnect and silence handling live in mux-client.cjs: that logic only becomes
// testable once the socket and the clock are injected, and an untested version of it
// is how live events once died quietly while the rest of the UI looked healthy.
const muxClient = createMuxClient({
  harnessUrl: HARNESS_URL,
  onQueue: publishQueue,
  onLiveEvent: publishLiveEvent,
  // A resubscribe means Harness reset its queue for that session, so a snapshot we
  // still hold is stale and must be cleared rather than left on screen.
  onSubscribed: (sessionId) => {
    if (queueSnapshots.has(sessionId)) publishQueue(sessionId, []);
  },
});

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
  gameLayerKeeper?.sync();
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
  edgeHitTracker?.sync();
  if (nextMode === "full") windowRef.show();
  else windowRef.showInactive();
  gameLayerKeeper?.trigger();
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
    quitCoordinator.handleRendererGone(details, () => {
      if (rendererRecoveryCount >= MAX_RENDERER_RECOVERIES) {
        quitCoordinator.requestQuit("renderer-recovery-limit");
        return;
      }
      rendererRecoveryCount += 1;
      windowRef.webContents.reload();
    });
  });
  windowRef.once("ready-to-show", () => {
    if (screenshotPath) applyWindowMode("full", { captureCurrent: false, persist: false });
    else applyWindowMode(preferences.windowState.mode, { captureCurrent: false, persist: false });
    if (PACKAGED_SMOKE_PATH) {
      const { mkdirSync, writeFileSync } = require("node:fs");
      mkdirSync(path.dirname(PACKAGED_SMOKE_PATH), { recursive: true });
      writeFileSync(PACKAGED_SMOKE_PATH, JSON.stringify({ ready: true, version: app.getVersion() }));
      setTimeout(() => quitCoordinator.requestQuit("packaged-smoke"), 100);
    }
  });
  windowRef.on("close", (event) => {
    quitCoordinator.handleWindowClose(event, () => applyWindowMode("edge"));
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
  gameLayerKeeper?.attach(windowRef);

  if (screenshotPath) {
    const { attachScreenshotHarness } = require("../scripts/screenshot-harness.cjs");
    attachScreenshotHarness({
      window: windowRef,
      app,
      applyWindowMode,
      screenshotPath,
      getDragTrace: () => compactDragTrace,
      setCompactSide: (side) => { preferences.compactSide = side; },
    });
  }
}

// The handlers themselves live in ipc-handlers.cjs, behind one shared sender guard.
//
// Every mutable binding below is handed over as an accessor, never as a value: this file
// reassigns windowRef, preferences, windowMode, fullBounds, both drag origins, the
// compact status, the pending-resize flag, the hotkey error and six lazily created
// services. A value captured here would be a snapshot frozen at startup — services would
// still be undefined, and the window would still be the one from before the last mode
// change. That failure is invisible to unit tests and only shows up in a real run, which
// is exactly how the screenshot harness earned its own accessors.
function registerWidgetIpc() {
  registerIpcHandlers({
    ipcMain,
    // Deny-by-default permissions belong on the session the renderer actually uses.
    session: session.defaultSession,
    dialog,
    openExternal: (url) => shell.openExternal(url),
    getAppVersion: () => app.getVersion(),
    api,
    queueSnapshots,
    prepareFiles,
    parseExternalUrl,
    harnessUrl: HARNESS_URL,
    repositoryUrl: REPOSITORY_URL,
    productName: PRODUCT_NAME,
    platformCapabilities: PLATFORM_CAPABILITIES,
    sizePresets: SIZE_PRESETS,
    getWindow: () => windowRef,
    getWindowMode: () => windowMode,
    getPreferences: () => preferences,
    getFullBounds: () => fullBounds,
    setFullBounds: (value) => { fullBounds = value; },
    getCompactStatus: () => compactStatus,
    setCompactStatus: (value) => { compactStatus = value; },
    getCompactDragOrigin: () => compactDragOrigin,
    setCompactDragOrigin: (value) => { compactDragOrigin = value; },
    getFullDragOrigin: () => fullDragOrigin,
    setFullDragOrigin: (value) => { fullDragOrigin = value; },
    getCompactStatusResizePending: () => compactStatusResizePending,
    setCompactStatusResizePending: (value) => { compactStatusResizePending = value; },
    getHotkeyRegistrationError: () => hotkeyRegistrationError,
    setHotkeyRegistrationError: (value) => { hotkeyRegistrationError = value; },
    getAutoStartController: () => autoStartController,
    getHarnessLauncher: () => harnessLauncher,
    getHotkeyManager: () => hotkeyManager,
    getEdgeHitTracker: () => edgeHitTracker,
    getScreenshotService: () => screenshotService,
    getUpdateService: () => updateService,
    applyWindowMode,
    applyEdgePointerHit,
    captureFullBounds,
    captureWindowBounds,
    savePreferences,
    schedulePreferenceSave,
    snapCompactWindow: snapCurrentCompactWindow,
    moveWithinNearestDisplay: moveWindowWithinNearestDisplay,
    traceCompactDrag,
    setWindowLayer: setWindowLayerPreference,
    captureScreenshot: captureScreenshotForChat,
    cleanupSentCaptureFiles,
    autoStartPreference,
    hotkeyErrorView,
    sendToRenderer,
    onUntrustedSender: (channel) => console.warn("Refused IPC from an untrusted sender", channel),
    onPermissionDenied: (permission, kind) => console.warn("Denied a renderer permission", kind, permission),
  });
}

app.on("second-instance", () => {
  quitCoordinator.handleActivation(() => {
    if (!windowRef || windowRef.isDestroyed()) return;
    if (windowRef.isMinimized()) windowRef.restore();
    windowRef.show();
    windowRef.focus();
  });
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
  if (!ISOLATED_SMOKE_MODE) autoStartController.migrateLegacy();
  harnessLauncher = createHarnessLauncher({
    harnessUrl: HARNESS_URL,
    desktopPath: app.getPath("desktop"),
    workingDirectory: path.join(app.getPath("userData"), "harness-workspace"),
    openPath: (filePath) => shell.openPath(filePath),
  });
  gameLayerKeeper = createGameLayerKeeper({
    getWindow: () => windowRef,
    isEnabled: () => preferences.windowLayer === "game",
    getMode: () => windowMode,
    capabilities: PLATFORM_CAPABILITIES,
  });
  if (PLATFORM_CAPABILITIES.edgeMouseForwarding) {
    edgeHitTracker = createEdgeHitTracker({
      screen,
      getWindow: () => windowRef,
      getMode: () => windowMode,
      getSide: () => preferences.compactSide,
      isDragging: () => Boolean(compactDragOrigin),
      setActive: applyEdgePointerHit,
    });
  }
  selectRegion = createRegionSelector({ BrowserWindow, screen, platform: process.platform });
  screenshotService = createScreenshotService({
    desktopCapturer,
    screen,
    platform: process.platform,
    tempRoot: app.getPath("temp"),
    selectRegion,
  });
  screenshotService.cleanupCaptures();
  updateService = createApplicationUpdateService();
  hotkeyManager = createHotkeyManager({
    app,
    globalShortcut,
    handlers: {
      showRestore: () => applyWindowMode("full"),
      collapseAvatar: () => applyWindowMode("orb"),
      collapseEdge: () => applyWindowMode("edge"),
      newSession: () => {
        applyWindowMode("full");
        sendToRenderer("hotkey-action", "newSession");
      },
      captureDisplay: () => captureScreenshotFromHotkey("display"),
      captureRegion: () => captureScreenshotFromHotkey("region"),
    },
    onError: (error) => {
      hotkeyRegistrationError = hotkeyErrorView(error);
      sendToRenderer("hotkey-error", hotkeyRegistrationError);
    },
  });
  if (!ISOLATED_SMOKE_MODE) {
    try {
      registerConfiguredHotkeys(preferences.hotkeys);
    } catch (error) {
      hotkeyRegistrationError = hotkeyErrorView(error);
      console.error("Failed to register hotkeys", error);
    }
  }
  registerWidgetIpc();
  createWindow();
  if (!ISOLATED_SMOKE_MODE) {
    const updateCheckTimer = setTimeout(() => updateService.check().catch((error) => console.error("Update check failed", error)), 4000);
    updateCheckTimer.unref?.();
  }
  // A screenshot run must capture a fixture, not whatever a live Harness pushes.
  if (!ISOLATED_SMOKE_MODE) {
    muxClient.connect();
    const iconPath = path.join(__dirname, "renderer", "assets", "neoxider-github.png");
    const icon = nativeImage.createFromPath(iconPath).resize({ width: 32, height: 32 });
    tray = new Tray(icon);
    tray.setToolTip(PRODUCT_NAME);
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "Show widget", click: () => applyWindowMode("full") },
      { label: "Open Harness", click: () => shell.openExternal(HARNESS_URL) },
      { type: "separator" },
      { label: "Quit", click: () => quitCoordinator.requestQuit("tray") },
    ]));
    tray.on("double-click", () => applyWindowMode(windowMode === "full" ? "edge" : "full"));
  }
});

app.on("before-quit", () => quitCoordinator.beforeQuit());

// Unplugging a monitor or changing resolution can leave the widget off-screen, and
// nothing re-clamped it until the next mode switch. Re-apply the current mode so the
// existing bounds are fitted into the work area that actually exists now.
function reclampToCurrentDisplays() {
  if (!windowRef || windowRef.isDestroyed()) return;
  applyWindowMode(windowMode, { captureCurrent: false, persist: false });
}
app.on("activate", () => quitCoordinator.handleActivation(() => (
  windowRef && !windowRef.isDestroyed() ? applyWindowMode("full") : createWindow()
)));
app.on("window-all-closed", (event) => {
  if (!quitCoordinator.isQuitting()) event.preventDefault();
});
