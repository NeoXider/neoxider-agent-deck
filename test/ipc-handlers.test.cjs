const test = require("node:test");
const assert = require("node:assert/strict");
const {
  registerIpcHandlers,
  denyAllPermissions,
  UNTRUSTED_SENDER_CODE,
} = require("../src/ipc-handlers.cjs");
const { createAttachmentRegistry } = require("../src/attachment-registry.cjs");

// A fake ipcMain that records what was registered and lets a test invoke a channel with
// any sender it likes, which is the whole point: the guard has to run before the handler.
function fakeIpcMain() {
  const handlers = new Map();
  const listeners = new Map();
  return {
    handle: (channel, handler) => handlers.set(channel, handler),
    on: (channel, listener) => listeners.set(channel, listener),
    invoke: (channel, event, ...args) => handlers.get(channel)(event, ...args),
    emit: (channel, event, ...args) => listeners.get(channel)(event, ...args),
    handled: () => [...handlers.keys()],
    listened: () => [...listeners.keys()],
  };
}

function fakeWindow() {
  const webContents = { send: () => {}, id: 1 };
  return { webContents, isDestroyed: () => false, getBounds: () => ({ x: 0, y: 0, width: 420, height: 640 }) };
}

function register(overrides = {}) {
  const ipcMain = fakeIpcMain();
  const window = fakeWindow();
  const attachmentRegistry = overrides.attachmentRegistry || createAttachmentRegistry();
  const registration = registerIpcHandlers({
    ipcMain,
    session: null,
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    openExternal: () => true,
    getAppVersion: () => "0.0.0-test",
    api: new Proxy({}, { get: () => async () => ({}) }),
    queueSnapshots: new Map(),
    prepareFiles: async () => ({ attachments: [], failures: [] }),
    attachmentRegistry,
    selectedFiles: { remember: () => "selected-file:test", prepare: async () => ({ attachments: [], failures: [] }) },
    parseExternalUrl: (value) => String(value),
    harnessUrl: "http://127.0.0.1:3080",
    repositoryUrl: "https://example.invalid/repo",
    productName: "Test Deck",
    platformCapabilities: { programmaticPosition: true, edgeMode: "supported" },
    sizePresets: { compact: [380, 400], standard: [420, 640], large: [500, 760] },
    getWindow: () => window,
    getWindowMode: () => "full",
    getPreferences: () => ({ opacity: 1, glowIntensity: 0.8, size: "standard", windowLayer: "above", compactSide: "right", windowState: { mode: "full" } }),
    getFullBounds: () => ({ x: 0, y: 0, width: 420, height: 640 }),
    setFullBounds: () => {},
    getCompactStatus: () => ({ active: false, expanded: false, label: "Ready", text: "" }),
    setCompactStatus: () => {},
    getCompactDragOrigin: () => null,
    setCompactDragOrigin: () => {},
    getFullDragOrigin: () => null,
    setFullDragOrigin: () => {},
    getCompactStatusResizePending: () => false,
    setCompactStatusResizePending: () => {},
    getHotkeyRegistrationError: () => null,
    setHotkeyRegistrationError: () => {},
    getAutoStartController: () => ({ available: false, getEnabled: () => false, setEnabled: () => false }),
    getHarnessLauncher: () => ({ start: async () => ({ ok: true }) }),
    getHotkeyManager: () => ({ current: () => ({}), apply: () => ({}), reset: () => ({}) }),
    getEdgeHitTracker: () => ({ setPointerActive: () => {} }),
    getScreenshotService: () => ({ capture: async () => ({}) }),
    getUpdateState: () => ({ status: "idle" }),
    getUpdateService: () => ({ snapshot: () => ({ status: "idle" }), check: async () => ({}), download: async () => ({}), install: async () => ({}) }),
    checkForUpdates: async () => ({}),
    applyWindowMode: () => {},
    applyEdgePointerHit: () => {},
    captureFullBounds: () => {},
    captureWindowBounds: () => {},
    savePreferences: () => {},
    schedulePreferenceSave: () => {},
    snapCompactWindow: () => ({ x: 0, y: 0, side: "right" }),
    moveWithinNearestDisplay: (_bounds, candidate) => candidate,
    traceCompactDrag: () => {},
    setWindowLayer: () => "above",
    captureScreenshot: async () => ({}),
    cleanupSentCaptureFiles: () => {},
    autoStartPreference: () => ({ enabled: false, available: false }),
    hotkeyErrorView: () => null,
    sendToRenderer: () => {},
    ...overrides,
  });
  return { ipcMain, window, registration, attachmentRegistry };
}

test("every registered channel refuses a foreign sender before running", async () => {
  const { ipcMain, registration } = register();
  const foreign = { sender: { id: 99, send: () => {} }, senderFrame: null };

  assert.ok(registration.channels.length >= 40, `only ${registration.channels.length} channels registered`);

  // Electron's own guidance is that sender validation should be the default, because all
  // web frames can in theory reach ipcMain. A guard applied per handler is a guard someone
  // eventually forgets, so this asserts the whole surface rather than a sample.
  const escaped = [];
  for (const channel of ipcMain.handled()) {
    try {
      await ipcMain.invoke(channel, foreign);
      escaped.push(channel);
    } catch (error) {
      if (error?.code !== UNTRUSTED_SENDER_CODE) escaped.push(`${channel} (${error?.message})`);
    }
  }
  assert.deepEqual(escaped, [], `these channels accepted a foreign sender: ${escaped.join(", ")}`);
});

test("fire-and-forget channels also refuse a foreign sender", () => {
  const { ipcMain } = register();
  const refused = [];
  const foreign = { sender: { id: 99 }, senderFrame: null };
  for (const channel of ipcMain.listened()) {
    // ipcMain.on has no return path, so a refusal is silent — it must simply not act.
    assert.doesNotThrow(() => ipcMain.emit(channel, foreign), `${channel} threw instead of ignoring`);
    refused.push(channel);
  }
  assert.ok(refused.length > 0, "no ipcMain.on channels were registered");
});

test("the real window is accepted", async () => {
  const { ipcMain, window } = register();
  const legitimate = { sender: window.webContents, senderFrame: { parent: null } };
  const info = await ipcMain.invoke("app-info", legitimate);
  assert.equal(info.version, "0.0.0-test");
});

test("live Think visibility is returned and persisted through the preferences contract", async () => {
  const preferences = { opacity: 1, glowIntensity: 0.8, showThinking: true, size: "standard", windowLayer: "above", compactSide: "right", windowState: { mode: "full" } };
  let scheduledSaves = 0;
  const { ipcMain, window } = register({
    getPreferences: () => preferences,
    getScreenshotService: () => ({ capabilities: () => ({}) }),
    schedulePreferenceSave: () => { scheduledSaves += 1; },
  });
  const legitimate = { sender: window.webContents, senderFrame: { parent: null } };

  assert.equal(await ipcMain.invoke("set-show-thinking", legitimate, false), false);
  assert.equal(preferences.showThinking, false);
  assert.equal(scheduledSaves, 1);
  assert.equal((await ipcMain.invoke("get-preferences", legitimate)).showThinking, false);
});

test("manual update checks use the shared check-and-stage path", async () => {
  let calls = 0;
  const expected = { status: "ready", latestVersion: "1.1.0" };
  const { ipcMain, window } = register({
    checkForUpdates: async () => {
      calls += 1;
      return expected;
    },
    getUpdateService: () => ({
      getState: () => ({ status: "idle" }),
      check: () => { throw new Error("raw check must not be called"); },
      install: async () => ({}),
    }),
  });
  const event = { sender: window.webContents, senderFrame: { parent: null } };
  assert.deepEqual(await ipcMain.invoke("check-for-updates", event), expected);
  assert.equal(calls, 1);
});

test("slash command IPC forwards image payloads through the widget command boundary", async () => {
  const calls = [];
  const api = {
    executeWidgetCommand: async (...args) => {
      calls.push(args);
      return { result: { kind: "success", text: "done" } };
    },
  };
  const { ipcMain, window } = register({ api });
  const event = { sender: window.webContents, senderFrame: { parent: null } };
  const images = [{ kind: "image", mediaType: "image/png", data: "AA==", name: "slash.png" }];

  const result = await ipcMain.invoke("execute-command", event, {
    sessionId: "session-command",
    line: "/goal inspect this screenshot",
    images,
  });
  await assert.rejects(ipcMain.invoke("execute-command", event, {
    sessionId: "session-command",
    line: "/goal no images",
    images: { not: "an array" },
  }), /Attachments must be an array/);

  assert.deepEqual(result, { result: { kind: "success", text: "done" } });
  assert.deepEqual(calls, [
    ["session-command", "/goal inspect this screenshot", [{ ...images[0], bytes: 1 }]],
  ]);
});

test("send validates attachments before privileged Harness calls", async () => {
  const calls = [];
  const api = {
    createSession: async () => "created",
    ensureFullAccess: async () => {},
    selectModel: async () => {},
    prompt: async (...args) => calls.push(args),
  };
  const { ipcMain, window, attachmentRegistry } = register({ api });
  const event = { sender: window.webContents, senderFrame: { parent: null } };
  const prepared = attachmentRegistry.register({
    kind: "reference", path: "C:\\docs\\notes.txt", name: "notes.txt",
  });
  await ipcMain.invoke("send", event, {
    sessionId: "session-send",
    text: "inspect",
    attachments: [
      { ...prepared, path: "C:\\Windows\\win.ini", name: "spoofed.txt", extra: "discard" },
      { kind: "image", mediaType: "image/png", data: "AA==", name: "shot.png", path: "clipboard:aabbccdd" },
    ],
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], "inspect\n\n@C:\\docs\\notes.txt");
  assert.deepEqual(calls[0][3], [{
    kind: "image", mediaType: "image/png", data: "AA==", name: "shot.png", bytes: 1, path: "clipboard:aabbccdd",
  }]);

  await assert.rejects(ipcMain.invoke("send", event, {
    sessionId: "session-send", text: "unsafe", attachments: [{ kind: "reference", path: "C:\\Windows\\win.ini", name: "win.ini" }],
  }), /unsupported attachment kind/);
  assert.equal(calls.length, 1, "invalid payload must not reach Harness");
});

// Edge no longer freezes x for the whole drag. Freezing it did stop the cumulative
// rightward drift, but it also made the opposite screen edge unreachable, which is what a
// user hit first: the line could only slide up and down the side it started on. Edge drags
// now take their own pointer-following path, which keeps the line flush to a side while
// letting that side change.
test("compact dragging uses the native cursor and Edge follows the pointer across sides", () => {
  let dragOrigin = null;
  let cursor = { x: 1000, y: 300 };
  let mode = "edge";
  const moveCalls = [];
  const edgeCalls = [];
  const { ipcMain, window } = register({
    getWindowMode: () => mode,
    getCursorScreenPoint: () => cursor,
    getCompactDragOrigin: () => dragOrigin,
    setCompactDragOrigin: (value) => { dragOrigin = value; },
    moveWithinNearestDisplay: (_bounds, candidate) => {
      moveCalls.push(candidate);
      return candidate;
    },
    moveEdgeDragToPointer: (_bounds, pointer) => {
      edgeCalls.push(pointer);
      const side = pointer.x < 960 ? "left" : "right";
      return { x: side === "left" ? 0 : 1832, y: pointer.y, side };
    },
  });
  const event = { sender: window.webContents, senderFrame: { parent: null } };

  ipcMain.emit("begin-compact-drag", event, { x: -500, y: -500 });
  assert.deepEqual({ x: dragOrigin.screenX, y: dragOrigin.screenY }, cursor);

  // An edge drag hands the raw pointer to the edge path, not a delta-derived candidate.
  cursor = { x: 1350, y: 360 };
  ipcMain.emit("move-compact-drag", event, { x: 9000, y: 9000 });
  assert.deepEqual(edgeCalls.at(-1), { x: 1350, y: 360 });
  assert.equal(moveCalls.length, 0, "edge drags must not go through the generic mover");

  // Crossing the middle of the display must be able to reach the other edge.
  cursor = { x: 300, y: 400 };
  ipcMain.emit("move-compact-drag", event, { x: 9000, y: 9000 });
  assert.deepEqual(edgeCalls.at(-1), { x: 300, y: 400 });

  mode = "orb";
  dragOrigin = null;
  cursor = { x: 200, y: 150 };
  ipcMain.emit("begin-compact-drag", event, { x: 0, y: 0 });
  cursor = { x: 235, y: 190 };
  ipcMain.emit("move-compact-drag", event, { x: 9000, y: 9000 });
  assert.deepEqual(moveCalls.at(-1), { x: 35, y: 40 });
});

test("full drag preserves both origin dimensions when native bounds drift", async () => {
  let dragOrigin = null;
  let nativeBounds = { x: 310, y: 270, width: 420, height: 640 };
  const fullBounds = [];
  const capturedBounds = [];
  const moveCalls = [];
  const { ipcMain, window } = register({
    getWindow: () => ({
      ...window,
      getBounds: () => nativeBounds,
    }),
    getFullDragOrigin: () => dragOrigin,
    setFullDragOrigin: (value) => { dragOrigin = value; },
    setFullBounds: (value) => fullBounds.push(value),
    captureWindowBounds: (...args) => capturedBounds.push(args),
    moveWithinNearestDisplay: (...args) => {
      moveCalls.push(args);
      return { ...args[1], width: 999, height: 1000 };
    },
  });
  const event = { sender: window.webContents, senderFrame: { parent: null } };

  ipcMain.emit("begin-full-drag", event, { x: 100, y: 120 });
  assert.deepEqual(dragOrigin.bounds, nativeBounds);

  nativeBounds = { x: 335, y: 305, width: 777, height: 888 };
  ipcMain.emit("move-full-drag", event, { x: 125, y: 155 });
  assert.equal(moveCalls.at(-1)[2], true);
  assert.deepEqual(fullBounds.at(-1), { x: 335, y: 305, width: 420, height: 640 });
  assert.deepEqual(dragOrigin.latestBounds, { x: 335, y: 305, width: 420, height: 640 });

  const ended = await ipcMain.invoke("end-full-drag", event);
  assert.deepEqual(ended, { x: 335, y: 305, width: 420, height: 640 });
  assert.deepEqual(capturedBounds.at(-1), ["full", ended, "right"]);
  assert.equal(dragOrigin, null);
});

test("a destroyed window is not a trusted sender", async () => {
  const window = fakeWindow();
  let destroyed = false;
  const { ipcMain } = register({ getWindow: () => (destroyed ? { ...window, isDestroyed: () => true } : window) });
  destroyed = true;
  // The fake invoke throws synchronously, exactly as the guard does before any await.
  await assert.rejects(
    async () => ipcMain.invoke("app-info", { sender: window.webContents, senderFrame: { parent: null } }),
    (error) => error.code === UNTRUSTED_SENDER_CODE,
  );
});

test("permissions are denied by default, request and check alike", () => {
  const denied = [];
  const session = {
    setPermissionRequestHandler: (handler) => session._request = handler,
    setPermissionCheckHandler: (handler) => session._check = handler,
  };
  assert.equal(denyAllPermissions(session, (permission, kind) => denied.push(`${kind}:${permission}`)), true);

  let answered = null;
  session._request({}, "media", (allowed) => { answered = allowed; });
  assert.equal(answered, false, "a permission request must be refused");
  assert.equal(session._check({}, "geolocation"), false, "a permission check must be refused");
  assert.deepEqual(denied, ["request:media", "check:geolocation"]);
});

test("a missing session is reported rather than silently skipped", () => {
  assert.equal(denyAllPermissions(null), false);
});
