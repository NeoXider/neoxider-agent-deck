const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createFullscreenGuard, setFocusableQuietly, startNotificationWatcher, watcherScript, FULLSCREEN_STATES } = require("../src/fullscreen-guard.cjs");

// A BrowserWindow as far as the guard uses one, with every call written down in order.
function fakeWindow({ focused = false, visible = true } = {}) {
  const events = new EventEmitter();
  const calls = [];
  const state = { focused, visible, focusable: true, destroyed: false };
  return Object.assign(events, {
    calls, state,
    isDestroyed: () => state.destroyed,
    isFocused: () => state.focused,
    isVisible: () => state.visible,
    hide() { calls.push("hide"); state.visible = false; },
    show() { calls.push("show"); state.visible = true; },
    showInactive() { calls.push("showInactive"); state.visible = true; },
    setFocusable(value) { calls.push(`setFocusable(${value})`); state.focusable = value; },
    focus() { calls.push("focus"); if (state.focusable) state.focused = true; },
  });
}

function fakeWatcher() {
  const control = { started: 0, stopped: 0, hooks: null };
  control.start = (hooks) => { control.started += 1; control.hooks = hooks; return { stop() { control.stopped += 1; } }; };
  return control;
}

test("the switch is made while the window is hidden, so the foreground is left alone", () => {
  const visible = fakeWindow();
  setFocusableQuietly(visible, false);
  assert.deepEqual(visible.calls, ["hide", "setFocusable(false)", "showInactive"]);
  const hidden = fakeWindow({ visible: false });
  setFocusableQuietly(hidden, true);
  assert.deepEqual(hidden.calls, ["setFocusable(true)"], "a hidden window stays hidden");
});

test("a fullscreen application in front makes the widget non-focusable, and its going puts it back", () => {
  const windowRef = fakeWindow();
  const watcher = fakeWatcher();
  const taskbar = [];
  const guard = createFullscreenGuard({ platform: "win32", getWindow: () => windowRef, getLayer: () => "game", restoreTaskbar: () => taskbar.push("restored"), startWatcher: watcher.start });
  assert.equal(guard.attach(windowRef), true);
  assert.equal(watcher.started, 1);
  assert.equal(guard.isGuarding(), false);
  watcher.hooks.onState(5); // the desktop
  assert.equal(guard.isGuarding(), false);
  assert.deepEqual(windowRef.calls, []);
  for (const state of FULLSCREEN_STATES) assert.ok([2, 3, 4].includes(state));
  watcher.hooks.onState(2); // a fullscreen application
  assert.equal(guard.isGuarding(), true);
  assert.deepEqual(windowRef.calls, ["hide", "setFocusable(false)", "showInactive"]);
  assert.deepEqual(taskbar, ["restored"]);
  watcher.hooks.onState(2);
  assert.equal(windowRef.calls.length, 3, "the same answer changes nothing");
  watcher.hooks.onState(5);
  assert.equal(guard.isGuarding(), false);
  assert.deepEqual(windowRef.calls.slice(3), ["hide", "setFocusable(true)", "showInactive"]);
});

test("a widget that holds the focus is never made non-focusable under the user's hands", () => {
  const windowRef = fakeWindow({ focused: true });
  const watcher = fakeWatcher();
  const guard = createFullscreenGuard({ platform: "win32", getWindow: () => windowRef, getLayer: () => "above", startWatcher: watcher.start });
  guard.attach(windowRef);
  watcher.hooks.onState(2);
  assert.equal(guard.isGuarding(), false);
  // The user goes back to the game: the widget blurs with the game still fullscreen.
  windowRef.state.focused = false;
  windowRef.emit("blur");
  assert.equal(guard.isGuarding(), true);
});

test("asking for the keyboard makes the window ordinary again and focuses it", () => {
  const windowRef = fakeWindow();
  const watcher = fakeWatcher();
  const guard = createFullscreenGuard({ platform: "win32", getWindow: () => windowRef, getLayer: () => "game", startWatcher: watcher.start });
  guard.attach(windowRef);
  watcher.hooks.onState(3);
  windowRef.calls.length = 0;
  assert.equal(guard.takeFocus(), true);
  assert.deepEqual(windowRef.calls, ["hide", "setFocusable(true)", "showInactive", "show", "focus"]);
  assert.equal(guard.isGuarding(), false);
  assert.equal(windowRef.state.focused, true);
  // Without a guard in force it is just a focus.
  windowRef.calls.length = 0;
  guard.takeFocus();
  assert.deepEqual(windowRef.calls, ["show", "focus"]);
});

test("the watcher runs only on Windows, above other windows, with the preference on", () => {
  const cases = [
    [{ platform: "linux", layer: "game", enabled: true }, false],
    [{ platform: "darwin", layer: "game", enabled: true }, false],
    [{ platform: "win32", layer: "normal", enabled: true }, false],
    [{ platform: "win32", layer: "above", enabled: false }, false],
    [{ platform: "win32", layer: "above", enabled: true }, true],
    [{ platform: "win32", layer: "private", enabled: true }, true],
  ];
  for (const [{ platform, layer, enabled }, expected] of cases) {
    const watcher = fakeWatcher();
    const windowRef = fakeWindow();
    const guard = createFullscreenGuard({ platform, getWindow: () => windowRef, getLayer: () => layer, isEnabled: () => enabled, startWatcher: watcher.start });
    assert.equal(guard.attach(windowRef), expected, JSON.stringify({ platform, layer, enabled }));
    assert.equal(watcher.started, expected ? 1 : 0);
  }
});

test("turning the preference off stops the watcher and releases the window", () => {
  const windowRef = fakeWindow();
  const watcher = fakeWatcher();
  let enabled = true;
  const guard = createFullscreenGuard({ platform: "win32", getWindow: () => windowRef, getLayer: () => "game", isEnabled: () => enabled, startWatcher: watcher.start });
  guard.attach(windowRef);
  watcher.hooks.onState(2);
  assert.equal(guard.isGuarding(), true);
  enabled = false;
  assert.equal(guard.sync(), false);
  assert.equal(watcher.stopped, 1);
  assert.equal(guard.isGuarding(), false);
  assert.equal(windowRef.state.focusable, true);
  // A late line from the stopped watcher is ignored.
  watcher.hooks.onState(2);
  assert.equal(guard.isGuarding(), false);
});

test("a watcher that dies releases the window and is started again on the next sync", () => {
  const windowRef = fakeWindow();
  const watcher = fakeWatcher();
  const guard = createFullscreenGuard({ platform: "win32", getWindow: () => windowRef, getLayer: () => "game", startWatcher: watcher.start });
  guard.attach(windowRef);
  watcher.hooks.onState(2);
  watcher.hooks.onExit();
  assert.equal(guard.isGuarding(), false);
  assert.equal(guard.sync(), true);
  assert.equal(watcher.started, 2);
});

test("the watcher script asks Windows and follows its owner; its output is read line by line", () => {
  const script = watcherScript(4321);
  assert.match(script, /SHQueryUserNotificationState/);
  assert.match(script, /\$owner = 4321/);
  assert.match(script, /Get-Process -Id \$owner/);
  const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), killed: 0, kill() { this.killed += 1; } });
  const spawned = [];
  const states = [];
  let exits = 0;
  const watcher = startNotificationWatcher({
    spawn: (file, args, options) => { spawned.push({ file, args, options }); return child; },
    env: { SystemRoot: "C:\\Windows" }, pid: 7, onState: (state) => states.push(state), onExit: () => { exits += 1; },
  });
  assert.match(spawned[0].file, /System32\\WindowsPowerShell\\v1\.0\\powershell\.exe$/);
  assert.ok(spawned[0].args.includes("-EncodedCommand"));
  assert.equal(spawned[0].options.windowsHide, true);
  assert.match(Buffer.from(spawned[0].args.at(-1), "base64").toString("utf16le"), /\$owner = 7/);
  child.stdout.emit("data", "5\r\n2");
  child.stdout.emit("data", "\r\nnoise\r\n3\r\n");
  assert.deepEqual(states, [5, 2, 3]);
  watcher.stop();
  assert.equal(child.killed, 1);
  child.emit("exit");
  assert.equal(exits, 0, "a watcher stopped on purpose does not report an exit");
  // PowerShell that cannot start is not an error: the guard just never engages.
  let failed = 0;
  const none = startNotificationWatcher({ spawn: () => { throw new Error("no powershell"); }, onExit: () => { failed += 1; } });
  assert.equal(failed, 1);
  none.stop();
});
