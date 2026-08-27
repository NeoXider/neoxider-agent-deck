const test = require("node:test");
const assert = require("node:assert/strict");
const {
  registerIpcHandlers,
  denyAllPermissions,
  UNTRUSTED_SENDER_CODE,
} = require("../src/ipc-handlers.cjs");

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
  const registration = registerIpcHandlers({
    ipcMain,
    session: null,
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    openExternal: () => true,
    getAppVersion: () => "0.0.0-test",
    api: new Proxy({}, { get: () => async () => ({}) }),
    queueSnapshots: new Map(),
    prepareFiles: async () => ({ attachments: [], failures: [] }),
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
  return { ipcMain, window, registration };
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
