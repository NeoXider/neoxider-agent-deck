const path = require("node:path");
const { app, BrowserWindow, desktopCapturer, dialog, globalShortcut, ipcMain, Menu, nativeImage, screen, session, shell, Tray } = require("electron");
const { HarnessApi } = require("./harness-api.cjs");
const { registerIpcHandlers } = require("./ipc-handlers.cjs");
const { createAutoStartController } = require("./auto-start.cjs");
const { createHarnessLauncher } = require("./harness-launcher.cjs");
const { createGameLayerKeeper } = require("./game-layer-keeper.cjs");
const { createGameBarController, createSharedDashboardReader } = require("./gamebar-controller.cjs");
const { createCompactHitTracker } = require("./compact-hit-tracker.cjs");
const { createHotkeyManager } = require("./hotkey-manager.cjs");
const { createQuitCoordinator } = require("./quit-coordinator.cjs");
const { createRegionSelector } = require("./region-selector.cjs");
const { createRendererRecoveryController } = require("./renderer-recovery.cjs");
const { createScreenshotCaptureGate, createScreenshotService } = require("./screenshot-service.cjs");
const { createInstalledUpdateService } = require("./installed-update-service.cjs");
const { createUpdateOrchestrator } = require("./update-orchestrator.cjs");
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
const { renderMarkdown } = require("./markdown.cjs");
const { createAttachmentReader, MAX_IMAGE_BYTES } = require("./attachments.cjs");
const { createAttachmentRegistry } = require("./attachment-registry.cjs");
const { createFileSelectionBroker } = require("./file-selection-broker.cjs");
const { createBase64Encoder } = require("./base64-encoder.cjs");
const { createExternalLinkOpener, parseExternalUrl } = require("./external-links.cjs");
const { createMuxClient } = require("./mux-client.cjs");
const { createStreamPublisher } = require("./stream-publisher.cjs");
const { createSettingsStore, DEFAULT_PREFERENCES } = require("./settings-store.cjs");
const { configureProductUserData } = require("./user-data-migration.cjs");
const {
  compactVisibleInset,
  edgeDragBounds,
  moveCompactBounds,
  snapCompactBounds,
} = require("./window-geometry.cjs");
const { captureModeBounds, fitFullBounds, resizeCompactAnchor } = require("./window-state.cjs");
const { COMPACT_SIZES, compactTargetBounds, compactWindowSize } = require("./compact-window.cjs");

const HARNESS_URL = process.env.DSH_WIDGET_URL || "http://127.0.0.1:3080";
const SCREENSHOT_MODE = Boolean(process.env.WIDGET_SCREENSHOT_PATH);
const PACKAGED_SMOKE_PATH = process.env.WIDGET_PACKAGED_SMOKE_PATH || "";
const ISOLATED_SMOKE_MODE = SCREENSHOT_MODE || Boolean(PACKAGED_SMOKE_PATH);
const PLATFORM_CAPABILITIES = detectPlatformCapabilities();
app.setName(PRODUCT_NAME);
configureProductUserData({ app });
const api = new HarnessApi(HARNESS_URL);
const dashboardReader = createSharedDashboardReader({ api });
// nativeImage is the only Electron dependency attachment reading has, so it is injected
// rather than reached for. So is base64 encoding: base64-encoder.cjs owns that decision.
const imageEncoder = createBase64Encoder({ strategy: process.env.DSH_WIDGET_B64_STRATEGY });
const { prepareFiles: prepareFilesFromDisk } = createAttachmentReader({
  encodeImage: (filePath) => imageEncoder.encodeFile(filePath, MAX_IMAGE_BYTES),
  async makeThumbnail(filePath) {
    const thumbnail = await nativeImage.createThumbnailFromPath(filePath, { width: 160, height: 100 });
    return thumbnail.isEmpty() ? "" : thumbnail.toPNG().toString("base64");
  },
});
const attachmentRegistry = createAttachmentRegistry();
async function prepareFiles(filePaths) {
  return attachmentRegistry.registerPrepared(await prepareFilesFromDisk(filePaths));
}
const selectedFiles = createFileSelectionBroker({
  getPathForFile: (filePath) => filePath,
  preparePaths: prepareFiles,
  allowFixturePaths: SCREENSHOT_MODE,
});
const SIZE_PRESETS = {
  compact: [380, 400],
  standard: [420, 640],
  large: [500, 760],
};
const FULL_MIN_WIDTH = 360;
const FULL_MIN_HEIGHT = 360;
// The transparent margin prevents the animated bloom around the pet from being clipped.
// Every compact size now lives in compact-window.cjs, next to the placement rules that
// depend on it.
const ORB_SIZE = COMPACT_SIZES.orb.height;
const ORB_EXPANDED_HEIGHT = COMPACT_SIZES.orbPanel.height;
const openExternalUrl = createExternalLinkOpener({ openExternal: (url) => shell.openExternal(url) });

let windowRef;
let tray;
let windowMode = "full";
let fullBounds;
let preferences = DEFAULT_PREFERENCES;
let settingsStore;
let autoStartController;
let harnessLauncher;
let gameLayerKeeper;
let compactHitTracker;
let hotkeyManager;
let quitCoordinator;
let screenshotService;
let updateService;
let updateOrchestrator;
let selectRegion;
let hotkeyRegistrationError = null;
let preferenceSaveTimer = null;
let compactStatus = { active: false, expanded: false, label: "Ready", text: "" };
let compactDragOrigin = null;
let compactStatusResizePending = false;
// Window-relative rectangles the renderer has measured for the parts of the orb that draw
// something. Empty means "not measured yet", which keeps the whole window interactive.
let compactHitAreas = [];
let fullDragOrigin = null;
let compactDragTrace = [];
const queueSnapshots = new Map();
let rendererRecovery;
let gameBarController;
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
  rendererRecovery?.dispose();
  gameBarController?.dispose();
  if (windowRef && !windowRef.isDestroyed()) captureWindowBounds(windowMode, windowRef.getBounds());
  if (settingsStore) savePreferences({ retryOnFailure: false });
  muxClient.stop();
  gameLayerKeeper?.stop();
  compactHitTracker?.stop();
  hotkeyManager?.dispose();
  selectRegion?.dispose();
  screenshotService?.cleanupCaptures({ maxAgeMs: 0, maxFiles: 0 });
  attachmentRegistry.clear();
  updateOrchestrator?.stop();
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
function writePreferences(options) {
  try {
    preferences = settingsStore.save(preferences, options);
  } catch (error) {
    console.error("Failed to persist preferences", error, settingsStore.getStatus());
  }
}

function savePreferences(options) {
  clearTimeout(preferenceSaveTimer);
  preferenceSaveTimer = null;
  writePreferences(options);
}
function schedulePreferenceSave() {
  clearTimeout(preferenceSaveTimer);
  preferenceSaveTimer = setTimeout(() => {
    preferenceSaveTimer = null;
    writePreferences();
  }, 180);
}

function autoStartPreference() {
  try { return { enabled: Boolean(autoStartController?.getEnabled()), available: Boolean(autoStartController?.available) }; }
  catch { return { enabled: false, available: false }; }
}
function sendToRenderer(channel, value) { return rendererRecovery?.send(channel, value) || false; }
async function openGameBarSession(sessionId) {
  applyWindowMode("full");
  windowRef?.focus();
  if (!sendToRenderer("gamebar-select-session", sessionId)) throw new Error("Renderer unavailable");
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
const { publishLiveEvent, publishQueue } = createStreamPublisher({ queueSnapshots, send: sendToRenderer });

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

// Both compact modes forward the mouse through their empty space now. The orb window is up
// to 460x158 for a 68 px circle, and all of that emptiness used to swallow clicks meant for
// the desktop behind it.
function applyCompactPointerHit(active = false) {
  if (!windowRef || windowRef.isDestroyed()) return;
  if (!PLATFORM_CAPABILITIES.edgeMouseForwarding) {
    windowRef.setIgnoreMouseEvents(false);
    return;
  }
  const compact = windowMode === "edge" || windowMode === "orb";
  const ignore = compact && !active && !compactDragOrigin;
  if (ignore) windowRef.setIgnoreMouseEvents(true, { forward: true });
  else windowRef.setIgnoreMouseEvents(false);
}

// The inset is read from the window's CURRENT size, never from a size captured when a drag
// began: a status change that resizes the orb mid-drag would otherwise clamp against a
// width the window no longer has, and push the circle off the screen.
function currentCompactInset(bounds = windowRef?.getBounds()) {
  return compactVisibleInset(windowMode, preferences.compactSide, bounds || { width: 1, height: 1 });
}

function moveWindowWithinNearestDisplay(bounds, candidate, preserveSize = false) {
  if (!PLATFORM_CAPABILITIES.programmaticPosition) return bounds;
  const display = screen.getDisplayNearestPoint({ x: Math.round(candidate.x), y: Math.round(candidate.y) }).workArea;
  const compact = windowMode !== "full";
  const size = compact ? windowRef.getBounds() : bounds;
  const live = { ...bounds, width: size.width, height: size.height };
  const moved = moveCompactBounds(live, candidate, display, compact ? currentCompactInset(live) : null);
  if (preserveSize) setPlatformBounds(windowRef, moved, false, PLATFORM_CAPABILITIES); else windowRef.setPosition(moved.x, moved.y, false);
  return moved;
}

// The display is chosen from the POINTER, not from the window, so dragging the line onto
// another monitor moves it there instead of pinning it to the edge of the one it left.
function moveEdgeWindowToPointer(bounds, pointer) {
  if (!PLATFORM_CAPABILITIES.programmaticPosition) return bounds;
  const display = screen.getDisplayNearestPoint({ x: Math.round(pointer.x), y: Math.round(pointer.y) }).workArea;
  const flush = edgeDragBounds(bounds, pointer, display);
  // Clamped by the visible line, so the pointer can carry it right up to the top or bottom
  // of the screen instead of stopping 28 px short on the window's transparent padding.
  const inset = compactVisibleInset("edge", flush.side, flush);
  const moved = moveCompactBounds(flush, { x: flush.x, y: pointer.y - bounds.height / 2 }, display, inset);
  windowRef.setPosition(moved.x, moved.y, false);
  if (flush.side !== preferences.compactSide) {
    preferences.compactSide = flush.side;
    sendToRenderer("compact-side", flush.side);
  }
  return { ...moved, side: flush.side };
}

function snapCurrentCompactWindow({ traceEnd = false } = {}) {
  if (!windowRef || windowMode === "full") return windowRef?.getBounds();
  const bounds = windowRef.getBounds();
  if (!PLATFORM_CAPABILITIES.programmaticPosition) return { ...bounds, side: preferences.compactSide };
  const display = screen.getDisplayMatching(bounds).workArea;
  // The side is decided by where the CIRCLE was dropped, not by the window's centre. With
  // the panel open the circle sits ~300 px from that centre, so a drag that ended plainly
  // on the left used to snap back to the right — the orb "moving on its own".
  const snapped = snapCompactBounds(bounds, display, windowMode, currentCompactInset(bounds));
  if (traceEnd) traceCompactDrag("end", { before: bounds, snapped });
  preferences.compactSide = snapped.side;
  setPlatformBounds(windowRef, { x: snapped.x, y: snapped.y, width: snapped.width, height: snapped.height }, true, PLATFORM_CAPABILITIES);
  captureWindowBounds(windowMode, snapped, snapped.side);
  savePreferences();
  sendToRenderer("compact-side", preferences.compactSide);
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
  } else {
    const restored = compactTargetBounds({
      mode: nextMode,
      status: compactStatus,
      saved: preferences.windowState[nextMode],
      source: fullBounds || windowRef.getBounds(),
      side: preferences.compactSide,
      getWorkArea: (probe) => screen.getDisplayMatching(probe).workArea,
    });
    windowRef.setResizable(false);
    setPlatformSkipTaskbar(windowRef, true, PLATFORM_CAPABILITIES);
    preferences.compactSide = restored.side;
    setPlatformBounds(windowRef, { x: restored.x, y: restored.y, width: restored.width, height: restored.height }, true, PLATFORM_CAPABILITIES);
    captureWindowBounds(nextMode, restored, restored.side);
    if (preservedOrbPosition) preferences.windowState.orb = preservedOrbPosition;
  }

  if (persist) savePreferences();
  applyWindowLayer(nextMode);
  applyCompactPointerHit(false);
  compactHitTracker?.sync();
  if (nextMode === "full") windowRef.show();
  else windowRef.showInactive();
  gameLayerKeeper?.trigger();
  sendToRenderer("window-mode", windowMode);
  sendToRenderer("compact-side", preferences.compactSide);
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
  windowRef.webContents.on("did-finish-load", () => rendererRecovery.loaded());
  windowRef.webContents.on("did-fail-load", (_event, code, description, _url, isMainFrame) => {
    if (isMainFrame !== false && code !== -3) rendererRecovery.failed(`load-${code || description || "failed"}`);
  });
  windowRef.on("unresponsive", () => rendererRecovery.failed("unresponsive", true));
  windowRef.webContents.on("render-process-gone", (_event, details) => {
    console.error("Renderer gone", details.reason);
    quitCoordinator.handleRendererGone(details, () => rendererRecovery.failed(details.reason || "gone"));
  });
  windowRef.loadFile(path.join(__dirname, "renderer", "index.html"), {
    query: {
      ...(screenshotTab ? { screenshotTab } : {}),
      ...(screenshotFixture ? { screenshotFixture } : {}),
      ...(screenshotFiles ? { screenshotFiles } : {}),
      ...(screenshotBackdrop ? { screenshotBackdrop } : {}),
      ...(process.env.WIDGET_SCREENSHOT_PATH ? { screenshotStatic: "1" } : {}),
    },
  });
  windowRef.once("ready-to-show", () => {
    windowRef.once("show", () => sendToRenderer("first-visible-entry"));
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
    if (windowMode !== "full" || fullDragOrigin) return;
    captureFullBounds();
    schedulePreferenceSave();
  });
  windowRef.on("move", () => {
    if (windowMode !== "full" || fullDragOrigin) return;
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
    attachmentRegistry,
    selectedFiles,
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
    setCompactHitAreas: (areas) => { compactHitAreas = areas; },
    getHotkeyRegistrationError: () => hotkeyRegistrationError,
    setHotkeyRegistrationError: (value) => { hotkeyRegistrationError = value; },
    getAutoStartController: () => autoStartController,
    getHarnessLauncher: () => harnessLauncher,
    getHotkeyManager: () => hotkeyManager,
    getCompactHitTracker: () => compactHitTracker,
    getScreenshotService: () => screenshotService,
    getUpdateService: () => updateService,
    checkForUpdates: () => updateOrchestrator?.checkAndStage() || null,
    getGameBarController: () => gameBarController,
    getCursorScreenPoint: () => screen.getCursorScreenPoint(),
    readDashboard: dashboardReader.read,
    invalidateDashboard: dashboardReader.invalidate,
    applyWindowMode,
    applyCompactPointerHit,
    captureFullBounds,
    captureWindowBounds,
    savePreferences,
    schedulePreferenceSave,
    snapCompactWindow: snapCurrentCompactWindow,
    moveWithinNearestDisplay: moveWindowWithinNearestDisplay,
    moveEdgeDragToPointer: moveEdgeWindowToPointer,
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
    compactHitTracker = createCompactHitTracker({
      screen,
      getWindow: () => windowRef,
      getMode: () => windowMode,
      getSide: () => preferences.compactSide,
      // Orb hit areas are measured by the renderer, because the buttons move with the
      // docked side and the panel changes size. Edge falls back to its own constants.
      getAreas: () => (windowMode === "orb" ? compactHitAreas : null),
      isDragging: () => Boolean(compactDragOrigin),
      setActive: applyCompactPointerHit,
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
  updateOrchestrator = createUpdateOrchestrator({
    getService: () => updateService,
    onError: (error) => console.error("Update check failed", error),
  });
  hotkeyManager = createHotkeyManager({
    app,
    globalShortcut,
    handlers: {
      showRestore: () => applyWindowMode("full"),
      toggleFocusChat: () => { applyWindowMode("full"); sendToRenderer("hotkey-action", "toggleFocusChat"); },
      collapseAvatar: () => applyWindowMode("orb"),
      collapseEdge: () => applyWindowMode("edge"),
      newSession: () => {
        applyWindowMode("full");
        sendToRenderer("hotkey-action", "newSession");
      },
      openHarness: () => shell.openExternal(HARNESS_URL),
      captureDisplay: () => captureScreenshotFromHotkey("display"),
      captureRegion: () => captureScreenshotFromHotkey("region"),
    },
    onError: (error) => {
      hotkeyRegistrationError = hotkeyErrorView(error);
      sendToRenderer("hotkey-error", hotkeyRegistrationError);
    },
  });
  rendererRecovery = createRendererRecoveryController({
    getWindow: () => windowRef,
    isQuitting: () => quitCoordinator.isQuitting(),
    requestQuit: (reason) => quitCoordinator.requestQuit(reason),
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
  gameBarController = createGameBarController({
    platform: process.platform, smokeMode: ISOLATED_SMOKE_MODE, isPackaged: app.isPackaged,
    appPath: app.getAppPath(), resourcesPath: process.resourcesPath, version: app.getVersion(), api,
    readDashboard: dashboardReader.read, onOpenSession: openGameBarSession,
  });
  gameBarController.start();
  if (!ISOLATED_SMOKE_MODE) updateOrchestrator.start();
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

app.on("before-quit", () => { imageEncoder.shutdown(); quitCoordinator.beforeQuit(); });

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
