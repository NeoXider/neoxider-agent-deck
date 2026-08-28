// Every IPC channel the renderer can reach, and the single guard that protects all of
// them.
//
// This module exists for two reasons that turned out to be the same reason. All 45
// handlers lived inline in main.cjs, and only six of them checked who sent the message.
// Electron's security checklist is explicit that sender validation should be the
// *default*, because any web frame in the process can address ipcMain. A guard that has
// to be pasted into each handler is a guard someone eventually forgets, so it is applied
// once here, at the registration point: a handler is validated because of how it is
// registered, not because its author remembered. Extracting the handlers is what created
// that registration point.
//
// Nothing in here reaches for Electron. ipcMain, the session, the dialog and the
// external-link opener all arrive as parameters, which is what lets the whole IPC
// surface be tested against fakes without booting a browser.
//
// Every piece of mutable main.cjs state arrives as an accessor, never as a value.
// main.cjs reassigns windowRef, preferences, windowMode, fullBounds, both drag origins,
// the compact status and six lazily created services; a value captured at registration
// time would be a snapshot that goes stale the first time the window moves — and unit
// tests against fakes would still pass while the real app quietly broke. The screenshot
// harness already paid for that lesson once (see scripts/screenshot-harness.cjs).
const { harnessSessionUrl } = require("./harness-url.cjs");
const { renderMarkdown } = require("./markdown.cjs");
const { applyPlatformOpacity } = require("./platform-capabilities.cjs");

const UNTRUSTED_SENDER_CODE = "untrusted-sender";

class UntrustedSenderError extends Error {
  constructor(channel) {
    super(`Refused an IPC message on "${channel}" from an untrusted sender`);
    this.name = "UntrustedSenderError";
    this.code = UNTRUSTED_SENDER_CODE;
    this.channel = channel;
  }
}

// The widget is one window showing one local file, so the only legitimate sender is that
// window's top frame. A second window, a subframe, a webview that slipped past
// will-attach-webview, or a frame that has already been disposed are all refused before
// the handler body runs.
function createSenderCheck(getWindow) {
  return function isTrustedSender(event) {
    const target = typeof getWindow === "function" ? getWindow() : null;
    if (!target || target.isDestroyed?.()) return false;
    const contents = target.webContents;
    if (!contents || !event || event.sender !== contents) return false;
    let frame = null;
    try {
      frame = event.senderFrame;
    } catch {
      // Electron throws when the render frame is already gone. A message from a dead
      // frame cannot be attributed to anyone, so it is not trusted either.
      return false;
    }
    return !frame || !contents.mainFrame || frame === contents.mainFrame;
  };
}

// Deny by default. The renderer loads local files under `default-src 'none'` and asks for
// no web permission at all, so every request is either a bug or an injection attempt.
// The checklist's position is that this handler exists before something needs it.
function denyAllPermissions(session, onDenied = () => {}) {
  if (!session) return false;
  session.setPermissionRequestHandler?.((_contents, permission, callback) => {
    onDenied(permission, "request");
    callback(false);
  });
  session.setPermissionCheckHandler?.((_contents, permission) => {
    onDenied(permission, "check");
    return false;
  });
  return true;
}

// Session ids come from the renderer on many channels, so they are checked once here
// instead of reaching Harness as undefined and surfacing as a TypeError.
function requireSessionId(value) {
  const sessionId = String(value ?? "").trim();
  if (!sessionId) throw new Error("A session id is required");
  return sessionId;
}

function registerIpcHandlers({
  // Transport and platform, injected so this module never imports Electron.
  ipcMain,
  session = null,
  dialog,
  openExternal,
  getAppVersion = () => "",
  // Values that genuinely never change.
  api,
  queueSnapshots,
  prepareFiles,
  attachmentRegistry,
  selectedFiles,
  parseExternalUrl,
  harnessUrl,
  repositoryUrl,
  productName,
  platformCapabilities,
  sizePresets,
  // Live state. main.cjs reassigns all of these, so they are read through accessors and
  // written back through setters. Passing the current value instead would capture a
  // snapshot that silently goes stale at runtime.
  getWindow,
  getWindowMode,
  getPreferences,
  getFullBounds,
  setFullBounds,
  getCompactStatus,
  setCompactStatus,
  getCompactDragOrigin,
  setCompactDragOrigin,
  getFullDragOrigin,
  setFullDragOrigin,
  getCompactStatusResizePending,
  setCompactStatusResizePending,
  getHotkeyRegistrationError,
  setHotkeyRegistrationError,
  getAutoStartController,
  getHarnessLauncher,
  getHotkeyManager,
  getEdgeHitTracker,
  getScreenshotService,
  getUpdateService,
  checkForUpdates = () => getUpdateService()?.check() || null,
  getGameBarController = () => null,
  getCursorScreenPoint = () => null,
  readDashboard,
  // Window-manager behaviour that stays in main.cjs, where the window state lives.
  applyWindowMode,
  applyEdgePointerHit,
  captureFullBounds,
  captureWindowBounds,
  savePreferences,
  schedulePreferenceSave,
  snapCompactWindow,
  moveWithinNearestDisplay,
  moveEdgeDragToPointer,
  traceCompactDrag,
  setWindowLayer,
  captureScreenshot,
  cleanupSentCaptureFiles,
  autoStartPreference,
  hotkeyErrorView,
  sendToRenderer,
  // Forensics: a refused message is a security event, not a shrug.
  onUntrustedSender = () => {},
  onPermissionDenied = () => {},
}) {
  const isTrustedSender = createSenderCheck(getWindow);
  const channels = [];

  // The two functions below are the whole point of this module. Nothing registers a
  // channel any other way, so no handler can be added without its guard.
  function handle(channel, handler) {
    channels.push(channel);
    ipcMain.handle(channel, (event, ...args) => {
      if (!isTrustedSender(event)) {
        onUntrustedSender(channel, event);
        throw new UntrustedSenderError(channel);
      }
      return handler(event, ...args);
    });
  }

  function on(channel, listener) {
    channels.push(channel);
    ipcMain.on(channel, (event, ...args) => {
      if (!isTrustedSender(event)) {
        onUntrustedSender(channel, event);
        return;
      }
      listener(event, ...args);
    });
  }

  function compactPointer(value) {
    const native = getCursorScreenPoint();
    const nativeX = Number(native?.x);
    const nativeY = Number(native?.y);
    if (Number.isFinite(nativeX) && Number.isFinite(nativeY)) return { x: nativeX, y: nativeY };
    return { x: Number(value?.x), y: Number(value?.y) };
  }

  handle("dashboard", async () => {
    try {
      // Through the shared reader, not api.dashboard(): the Game Bar widget reads the same
      // snapshot, and two independent readers would poll Harness twice for one answer.
      const dashboard = await readDashboard();
      return { ok: true, harness: true, ...dashboard };
    } catch (error) {
      return { ok: false, harness: false, error: error instanceof Error ? error.message : String(error), sessions: [] };
    }
  });
  handle("history", async (_event, sessionId) => {
    const view = await api.history(sessionId);
    return {
      ...view,
      messages: view.messages.map((message) => typeof message.text === "string"
        ? { ...message, html: renderMarkdown(message.text) }
        : message),
    };
  });
  handle("models", async (_event, sessionId) => api.models(sessionId || undefined));
  handle("commands", async (_event, sessionId) => api.commands(sessionId));
  handle("execute-command", async (_event, payload) => {
    const images = attachmentRegistry.resolvePayload(payload?.images, { imagesOnly: true });
    const result = await api.executeWidgetCommand(payload?.sessionId, payload?.line, images);
    attachmentRegistry.releasePayload(payload?.images);
    return result;
  });
  handle("workspaces", async () => api.workspaces());
  handle("pick-workspace", async () => {
    const result = await dialog.showOpenDialog(getWindow(), { properties: ["openDirectory", "createDirectory"] });
    if (result.canceled || !result.filePaths[0]) return null;
    return api.createWorkspace(result.filePaths[0]);
  });
  handle("pick-files", async () => {
    const result = await dialog.showOpenDialog(getWindow(), { properties: ["openFile", "multiSelections"] });
    return result.canceled ? { attachments: [], failures: [] } : prepareFiles(result.filePaths);
  });
  on("register-selected-file", (event, filePath) => {
    event.returnValue = selectedFiles.remember(filePath);
  });
  handle("prepare-files", async (_event, fileHandles) => selectedFiles.prepare(fileHandles));
  handle("capture-screenshot", async (_event, kind) => captureScreenshot(String(kind || "")));
  handle("create-session", async (_event, options) => {
    const sessionId = await api.createSession(options || {});
    await api.ensureFullAccess(sessionId);
    return { sessionId };
  });
  handle("select-model", async (_event, payload) => {
    return api.selectModel(requireSessionId(payload?.sessionId), payload?.selection);
  });
  handle("send", async (_event, payload) => {
    const text = String(payload && payload.text || "").trim();
    const attachments = attachmentRegistry.resolvePayload(payload?.attachments);
    if (!text && !attachments.length) throw new Error("Message is empty");
    const sessionId = payload && payload.sessionId ? payload.sessionId : await api.createSession();
    await api.ensureFullAccess(sessionId);
    if (payload && payload.selection) await api.selectModel(sessionId, payload.selection);
    const references = attachments.filter((item) => item.kind === "reference").map((item) => `@${item.path}`);
    const promptText = [text, ...references].filter(Boolean).join("\n\n");
    const images = attachments.filter((item) => item.kind === "image");
    await api.prompt(sessionId, promptText, payload && payload.timeZone, images);
    await cleanupSentCaptureFiles(attachments);
    attachmentRegistry.releasePayload(payload?.attachments);
    return { sessionId };
  });
  handle("cancel", async (_event, sessionId) => api.cancel(sessionId));
  handle("get-queue", (_event, sessionId) => queueSnapshots.get(String(sessionId || "")) || { revision: 0, items: [] });
  handle("update-queue", async (_event, payload) => {
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
  handle("open-harness", async () => openExternal(harnessUrl));
  handle("open-harness-session", async (_event, sessionId) => openExternal(harnessSessionUrl(harnessUrl, sessionId)));
  handle("open-project", async () => openExternal(repositoryUrl));
  handle("open-external", async (_event, value) => {
    const url = parseExternalUrl(value);
    if (!url) throw new Error("Unsupported external link protocol");
    return openExternal(url);
  });
  handle("start-harness", async () => getHarnessLauncher().start());
  handle("set-window-layer", (_event, value) => {
    return setWindowLayer(value);
  });
  handle("set-opacity", (_event, value) => {
    const preferences = getPreferences();
    preferences.opacity = Math.max(0.65, Math.min(1, Number(value) || 0.96));
    applyPlatformOpacity(getWindow(), preferences.opacity, platformCapabilities);
    // Dragging a slider fires continuously; a full synchronous rewrite per tick would
    // stall the main process, so the write is debounced like resize and move already are.
    schedulePreferenceSave();
    return preferences.opacity;
  });
  handle("set-glow-intensity", (_event, value) => {
    const preferences = getPreferences();
    const numeric = Number(value);
    preferences.glowIntensity = Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : 0.82;
    schedulePreferenceSave();
    return preferences.glowIntensity;
  });
  handle("set-show-thinking", (_event, value) => {
    const preferences = getPreferences();
    preferences.showThinking = Boolean(value);
    schedulePreferenceSave();
    return preferences.showThinking;
  });
  handle("set-size", (_event, preset) => {
    const preferences = getPreferences();
    const window = getWindow();
    const size = sizePresets[preset] || sizePresets.standard;
    preferences.size = sizePresets[preset] ? preset : "standard";
    if (getWindowMode() === "full") window.setSize(size[0], size[1], true);
    setFullBounds({ ...(getFullBounds() || window.getBounds()), width: size[0], height: size[1] });
    captureWindowBounds("full", getFullBounds(), preferences.compactSide, getWindowMode() === "full");
    savePreferences();
    return preferences.size;
  });
  handle("set-auto-start", (_event, enabled) => {
    return getAutoStartController().setEnabled(enabled);
  });
  handle("set-hotkeys", (_event, bindings) => {
    const hotkeyManager = getHotkeyManager();
    try {
      const hotkeys = hotkeyManager.apply(bindings);
      getPreferences().hotkeys = hotkeys;
      setHotkeyRegistrationError(null);
      savePreferences();
      return { ok: true, hotkeys };
    } catch (error) {
      setHotkeyRegistrationError(hotkeyErrorView(error));
      return { ok: false, hotkeys: hotkeyManager.getBindings(), error: getHotkeyRegistrationError() };
    }
  });
  handle("reset-hotkeys", () => {
    const hotkeyManager = getHotkeyManager();
    try {
      const hotkeys = hotkeyManager.resetDefaults();
      getPreferences().hotkeys = hotkeys;
      setHotkeyRegistrationError(null);
      savePreferences();
      return { ok: true, hotkeys };
    } catch (error) {
      setHotkeyRegistrationError(hotkeyErrorView(error));
      return { ok: false, hotkeys: hotkeyManager.getBindings(), error: getHotkeyRegistrationError() };
    }
  });
  handle("get-preferences", () => {
    const preferences = getPreferences();
    const autoStart = autoStartPreference();
    return {
      alwaysOnTop: preferences.windowLayer !== "normal",
      windowLayer: preferences.windowLayer,
      autoStart: autoStart.enabled,
      autoStartAvailable: autoStart.available,
      opacity: preferences.opacity,
      glowIntensity: preferences.glowIntensity,
      showThinking: preferences.showThinking !== false,
      size: preferences.size,
      windowMode: getWindowMode(),
      compactSide: preferences.compactSide,
      hotkeys: preferences.hotkeys,
      hotkeyError: getHotkeyRegistrationError(),
      screenshotCapabilities: getScreenshotService()?.capabilities() || {},
      platformCapabilities,
    };
  });
  handle("app-info", () => ({ version: getAppVersion(), repository: repositoryUrl, productName }));
  handle("get-update-state", () => getUpdateService()?.getState() || null);
  handle("check-for-updates", () => checkForUpdates());
  handle("install-update", () => getUpdateService()?.install() || null);
  handle("set-window-mode", (_event, mode) => {
    applyWindowMode(mode);
    return getWindowMode();
  });
  handle("set-compact-status", (_event, value) => {
    const previous = getCompactStatus();
    const wasActive = previous.active;
    const wasExpanded = previous.expanded;
    const compactStatus = {
      active: Boolean(value && value.active),
      expanded: Boolean(value && value.expanded),
      label: String(value && value.label || "Ready").slice(0, 80),
      text: String(value && value.text || "").slice(0, 180),
    };
    setCompactStatus(compactStatus);
    const changed = wasActive !== compactStatus.active || wasExpanded !== compactStatus.expanded;
    if (getWindowMode() === "orb" && changed && !getCompactDragOrigin()) {
      applyWindowMode("orb", { captureCurrent: false, persist: false, preserveCompactPosition: true });
    } else if (getWindowMode() === "orb" && changed) {
      setCompactStatusResizePending(true);
    }
    return compactStatus;
  });
  // The sender checks these five used to carry inline are now the registration guard's
  // job, and the guard also refuses a destroyed window, so only the mode and gesture
  // preconditions are left here.
  on("set-edge-pointer-active", (_event, active) => {
    const edgeHitTracker = getEdgeHitTracker();
    if (edgeHitTracker) edgeHitTracker.tick();
    else applyEdgePointerHit(Boolean(active));
  });
  on("move-full-drag", (_event, value) => {
    const fullDragOrigin = getFullDragOrigin();
    if (getWindowMode() !== "full" || !fullDragOrigin) return;
    const screenX = Number(value?.x);
    const screenY = Number(value?.y);
    if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return;
    const candidate = {
      x: fullDragOrigin.bounds.x + screenX - fullDragOrigin.screenX,
      y: fullDragOrigin.bounds.y + screenY - fullDragOrigin.screenY,
    };
    const moved = moveWithinNearestDisplay(fullDragOrigin.bounds, candidate, true);
    const stableBounds = {
      x: moved.x,
      y: moved.y,
      width: fullDragOrigin.bounds.width,
      height: fullDragOrigin.bounds.height,
    };
    setFullBounds(stableBounds);
    setFullDragOrigin({ ...fullDragOrigin, latestBounds: stableBounds });
  });
  handle("end-full-drag", () => {
    const fullDragOrigin = getFullDragOrigin();
    const stableBounds = fullDragOrigin?.latestBounds || fullDragOrigin?.bounds;
    setFullDragOrigin(null);
    if (stableBounds) {
      setFullBounds(stableBounds);
      captureWindowBounds("full", stableBounds, getPreferences().compactSide);
    } else {
      captureFullBounds();
    }
    savePreferences();
    return stableBounds || getWindow()?.getBounds();
  });
  on("begin-compact-drag", (_event, value) => {
    if (getWindowMode() === "full") return;
    const { x: screenX, y: screenY } = compactPointer(value);
    if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return;
    applyEdgePointerHit(true);
    getEdgeHitTracker()?.sync?.();
    const origin = { screenX, screenY, bounds: getWindow().getBounds() };
    setCompactDragOrigin(origin);
    traceCompactDrag("begin", { screenX, screenY, bounds: origin.bounds });
  });
  on("begin-full-drag", (_event, value) => {
    if (getWindowMode() !== "full") return;
    const screenX = Number(value?.x);
    const screenY = Number(value?.y);
    if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return;
    setFullDragOrigin({ screenX, screenY, bounds: getWindow().getBounds() });
  });
  handle("end-compact-drag", () => {
    setCompactDragOrigin(null);
    let result = snapCompactWindow({ traceEnd: true });
    if (getWindowMode() === "orb" && getCompactStatusResizePending()) {
      setCompactStatusResizePending(false);
      applyWindowMode("orb", { captureCurrent: false, persist: false, preserveCompactPosition: true });
      result = { ...getWindow().getBounds(), side: getPreferences().compactSide };
    }
    getEdgeHitTracker()?.sync?.();
    return result;
  });
  on("move-compact-drag", (_event, value) => {
    const compactDragOrigin = getCompactDragOrigin();
    if (getWindowMode() === "full" || !compactDragOrigin) return;
    const { x: screenX, y: screenY } = compactPointer(value);
    if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return;
    // Edge keeps the line flush to a screen side while the SIDE follows the pointer, so
    // crossing the middle of the display moves it to the other edge. Freezing x here
    // instead did stop the drift it was aimed at, but it also left the opposite edge
    // unreachable: the line could only ever slide up and down the side it started on.
    if (getWindowMode() === "edge") {
      const moved = moveEdgeDragToPointer(compactDragOrigin.bounds, { x: screenX, y: screenY });
      traceCompactDrag("move", { screenX, screenY, x: moved.x, y: moved.y, side: moved.side });
      return;
    }
    const candidate = {
      x: compactDragOrigin.bounds.x + screenX - compactDragOrigin.screenX,
      y: compactDragOrigin.bounds.y + screenY - compactDragOrigin.screenY,
    };
    const moved = moveWithinNearestDisplay(compactDragOrigin.bounds, candidate);
    traceCompactDrag("move", { screenX, screenY, x: moved.x, y: moved.y });
  });
  on("gamebar-selected-session", (_event, sessionId) => {
    getGameBarController()?.setSelectedSessionId(sessionId);
  });
  on("agent-complete", () => {
    if (getWindowMode() !== "edge") return;
    sendToRenderer("edge-bounce");
  });

  return {
    channels,
    isTrustedSender,
    permissionsDenied: denyAllPermissions(session, onPermissionDenied),
  };
}

module.exports = {
  registerIpcHandlers,
  denyAllPermissions,
  requireSessionId,
  UntrustedSenderError,
  UNTRUSTED_SENDER_CODE,
};
