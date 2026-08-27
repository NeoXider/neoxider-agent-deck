const test = require("node:test");
const assert = require("node:assert/strict");

const {
  HOTKEY_ACTIONS,
  createHotkeyManager,
  normalizeAccelerator,
  normalizeHotkeyBindings,
} = require("../src/hotkey-manager.cjs");

function disabledBindings(overrides = {}) {
  return Object.fromEntries(HOTKEY_ACTIONS.map((action) => [action, overrides[action] || false]));
}

function fakeGlobalShortcut(external = []) {
  const externalKeys = new Set(external.map((value) => value.toLowerCase()));
  const registered = new Map();
  const calls = [];
  return {
    calls,
    registered,
    register(accelerator, callback) {
      calls.push(["register", accelerator]);
      const key = accelerator.toLowerCase();
      if (externalKeys.has(key) || registered.has(key)) return false;
      registered.set(key, { accelerator, callback });
      return true;
    },
    unregister(accelerator) {
      calls.push(["unregister", accelerator]);
      registered.delete(accelerator.toLowerCase());
    },
    fire(accelerator) {
      registered.get(accelerator.toLowerCase())?.callback();
    },
  };
}

test("accelerators are normalized and printable keys require a modifier", () => {
  assert.equal(normalizeAccelerator("shift + ctrl + n"), "Control+Shift+N");
  assert.equal(normalizeAccelerator("F12"), "F12");
  assert.throws(() => normalizeAccelerator("N"), { code: "modifier-required" });
  assert.throws(() => normalizeAccelerator("Ctrl+Shift"), { code: "invalid-key-count" });
  assert.throws(() => normalizeAccelerator("Ctrl+Moon"), { code: "unsupported-key" });
});

test("duplicate bindings fail validation before Electron registrations are touched", () => {
  const shortcuts = fakeGlobalShortcut();
  const handlers = Object.fromEntries(HOTKEY_ACTIONS.map((action) => [action, () => {}]));
  const manager = createHotkeyManager({ globalShortcut: shortcuts, handlers });
  assert.throws(() => manager.apply(disabledBindings({
    showRestore: "Ctrl+Alt+Space",
    newSession: "alt+ctrl+space",
  })), { code: "duplicate-accelerator" });
  assert.deepEqual(shortcuts.calls, []);
});

test("all eight actions register and dispatch their own handlers", async () => {
  const shortcuts = fakeGlobalShortcut();
  const invoked = [];
  const handlers = Object.fromEntries(HOTKEY_ACTIONS.map((action) => [action, () => invoked.push(action)]));
  const manager = createHotkeyManager({ globalShortcut: shortcuts, handlers });
  const bindings = normalizeHotkeyBindings();
  manager.apply(bindings);
  for (const binding of Object.values(bindings)) shortcuts.fire(binding.accelerator);
  await Promise.resolve();
  assert.deepEqual(invoked, HOTKEY_ACTIONS);
  assert.equal(shortcuts.registered.size, 8);
});

test("a conflicting update rolls back every prior binding without unregistering the external owner", () => {
  const conflict = "Control+Alt+X";
  const shortcuts = fakeGlobalShortcut([conflict]);
  const handlers = Object.fromEntries(HOTKEY_ACTIONS.map((action) => [action, () => {}]));
  const manager = createHotkeyManager({ globalShortcut: shortcuts, handlers });
  const previous = disabledBindings({
    showRestore: "Ctrl+Alt+Space",
    newSession: "Ctrl+Alt+N",
  });
  manager.apply(previous);

  assert.throws(() => manager.apply(disabledBindings({
    showRestore: "Ctrl+Alt+Y",
    newSession: conflict,
  })), { code: "registration-conflict" });

  assert.deepEqual(manager.getBindings(), normalizeHotkeyBindings(previous));
  assert.deepEqual([...shortcuts.registered.values()].map((item) => item.accelerator).sort(), ["Control+Alt+N", "Control+Alt+Space"]);
  assert.equal(shortcuts.calls.some(([kind, accelerator]) => kind === "unregister" && accelerator === conflict), false);
});

test("startup conflicts disable only the runtime registration and preserve enabled user intent", () => {
  const conflict = "Control+Alt+Space";
  const requested = disabledBindings({
    showRestore: conflict,
    newSession: "Control+Alt+N",
  });
  const handlers = Object.fromEntries(HOTKEY_ACTIONS.map((action) => [action, () => {}]));
  const blockedShortcuts = fakeGlobalShortcut([conflict]);
  const blockedManager = createHotkeyManager({ globalShortcut: blockedShortcuts, handlers });

  const firstLaunch = blockedManager.applyAvailable(requested);
  assert.equal(firstLaunch.requested.showRestore.enabled, true);
  assert.equal(firstLaunch.active.showRestore.enabled, false);
  assert.equal(firstLaunch.active.newSession.enabled, true);
  assert.deepEqual(firstLaunch.conflicts.map((error) => error.action), ["showRestore"]);

  const availableManager = createHotkeyManager({ globalShortcut: fakeGlobalShortcut(), handlers });
  const nextLaunch = availableManager.applyAvailable(firstLaunch.requested);
  assert.equal(nextLaunch.active.showRestore.enabled, true);
  assert.equal(nextLaunch.conflicts.length, 0);
});

test("missing handlers are rejected without replacing the active mapping", () => {
  const shortcuts = fakeGlobalShortcut();
  const manager = createHotkeyManager({ globalShortcut: shortcuts, handlers: { showRestore() {} } });
  manager.apply(disabledBindings({ showRestore: "Ctrl+Alt+Space" }));
  assert.throws(() => manager.apply(disabledBindings({ newSession: "Ctrl+Alt+N" })), { code: "missing-handler" });
  assert.equal(shortcuts.registered.has("control+alt+space"), true);
});

test("one action can be rebound or disabled and defaults can be restored as normalized persistence data", () => {
  const shortcuts = fakeGlobalShortcut();
  const handlers = Object.fromEntries(HOTKEY_ACTIONS.map((action) => [action, () => {}]));
  const manager = createHotkeyManager({ globalShortcut: shortcuts, handlers });
  manager.resetDefaults();
  manager.update("captureRegion", { enabled: true, accelerator: "Shift+Ctrl+R" });
  assert.deepEqual(manager.getBindings().captureRegion, { enabled: true, accelerator: "Control+Shift+R" });
  manager.update("captureRegion", false);
  assert.equal(manager.getBindings().captureRegion.enabled, false);
  assert.equal(shortcuts.registered.has("control+shift+r"), false);
  assert.deepEqual(manager.resetDefaults(), normalizeHotkeyBindings());
});

test("an invalid per-action rebind leaves the prior normalized binding intact", () => {
  const shortcuts = fakeGlobalShortcut();
  const handlers = Object.fromEntries(HOTKEY_ACTIONS.map((action) => [action, () => {}]));
  const manager = createHotkeyManager({ globalShortcut: shortcuts, handlers });
  manager.apply(disabledBindings({ showRestore: "Ctrl+Alt+Space" }));
  assert.throws(() => manager.update("showRestore", "plain words"), { code: "unsupported-key" });
  assert.deepEqual(manager.getBindings().showRestore, { enabled: true, accelerator: "Control+Alt+Space" });
  assert.equal(shortcuts.registered.has("control+alt+space"), true);
});

test("will-quit unregisters only shortcuts owned by the manager and dispose is idempotent", () => {
  const shortcuts = fakeGlobalShortcut();
  let quitListener;
  const app = {
    once(name, listener) { assert.equal(name, "will-quit"); quitListener = listener; },
    off() {},
  };
  const manager = createHotkeyManager({ globalShortcut: shortcuts, handlers: { showRestore() {} }, app });
  manager.apply(disabledBindings({ showRestore: "Ctrl+Alt+Space" }));
  quitListener();
  manager.dispose();
  assert.equal(shortcuts.registered.size, 0);
  assert.equal(shortcuts.calls.filter(([kind]) => kind === "unregister").length, 1);
});
