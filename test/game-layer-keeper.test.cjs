const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { canRaiseWindow, createGameLayerKeeper } = require("../src/game-layer-keeper.cjs");

function fakeWindow() {
  const windowRef = new EventEmitter();
  windowRef.calls = [];
  windowRef.destroyed = false;
  windowRef.visible = true;
  windowRef.minimized = false;
  windowRef.isDestroyed = () => windowRef.destroyed;
  windowRef.isVisible = () => windowRef.visible;
  windowRef.isMinimized = () => windowRef.minimized;
  windowRef.setAlwaysOnTop = (...args) => windowRef.calls.push(["top", ...args]);
  windowRef.setVisibleOnAllWorkspaces = (...args) => windowRef.calls.push(["spaces", ...args]);
  windowRef.moveTop = () => windowRef.calls.push(["moveTop"]);
  return windowRef;
}

function fakeTimers() {
  const timeouts = new Map();
  const intervals = new Map();
  let nextId = 1;
  const handle = (id) => ({ id, unref() {} });
  return {
    timeouts,
    intervals,
    setTimeoutFn(callback, delay) {
      const result = handle(nextId++);
      timeouts.set(result, { callback, delay });
      return result;
    },
    clearTimeoutFn(timer) { timeouts.delete(timer); },
    setIntervalFn(callback, delay) {
      const result = handle(nextId++);
      intervals.set(result, { callback, delay });
      return result;
    },
    clearIntervalFn(timer) { intervals.delete(timer); },
    runTimeouts() {
      const scheduled = [...timeouts.values()];
      timeouts.clear();
      for (const item of scheduled) item.callback();
    },
  };
}

function createKeeper(windowRef, enabledRef, timers, overrides = {}) {
  return createGameLayerKeeper({
    getWindow: () => windowRef,
    isEnabled: () => enabledRef.value,
    getMode: () => "edge",
    capabilities: {
      layerLevels: true,
      gameLayer: true,
      visibleOnFullScreen: false,
    },
    burstDelays: [50, 200],
    ...timers,
    ...overrides,
  });
}

test("Game layer reassertion raises Z-order without activating or showing the window", () => {
  const windowRef = fakeWindow();
  const timers = fakeTimers();
  const keeper = createKeeper(windowRef, { value: true }, timers);

  assert.equal(keeper.reassert(), true);
  assert.deepEqual(windowRef.calls, [
    ["top", true, "screen-saver"],
    ["moveTop"],
  ]);
  assert.equal(windowRef.calls.some(([name]) => ["focus", "show", "restore"].includes(name)), false);
});

test("blur starts an immediate and bounded retry burst while heartbeat keeps Game layer alive", () => {
  const windowRef = fakeWindow();
  const enabled = { value: true };
  const timers = fakeTimers();
  const keeper = createKeeper(windowRef, enabled, timers);

  keeper.attach();
  assert.equal(timers.intervals.size, 1);
  windowRef.calls.length = 0;
  windowRef.emit("blur");
  assert.deepEqual(windowRef.calls, [["top", true, "screen-saver"], ["moveTop"]]);
  assert.deepEqual([...timers.timeouts.values()].map(({ delay }) => delay), [50, 200]);

  timers.runTimeouts();
  assert.equal(windowRef.calls.filter(([name]) => name === "moveTop").length, 3);
  [...timers.intervals.values()][0].callback();
  assert.equal(windowRef.calls.filter(([name]) => name === "moveTop").length, 4);
  keeper.stop();
  assert.equal(timers.intervals.size, 0);
  assert.equal(windowRef.listenerCount("blur"), 0);
});

test("sync stops all retries immediately after Game layer is disabled", () => {
  const windowRef = fakeWindow();
  const enabled = { value: true };
  const timers = fakeTimers();
  const keeper = createKeeper(windowRef, enabled, timers);

  keeper.attach();
  windowRef.emit("blur");
  assert.equal(timers.timeouts.size, 2);
  enabled.value = false;
  assert.equal(keeper.sync(), false);
  assert.equal(timers.timeouts.size, 0);
  assert.equal(timers.intervals.size, 0);
  windowRef.calls.length = 0;
  windowRef.emit("blur");
  assert.deepEqual(windowRef.calls, []);
});

test("an external loss of the topmost flag is repaired without duplicating heartbeat timers", () => {
  const windowRef = fakeWindow();
  const timers = fakeTimers();
  const keeper = createKeeper(windowRef, { value: true }, timers);

  keeper.attach();
  keeper.sync();
  assert.equal(timers.intervals.size, 1);
  windowRef.calls.length = 0;
  windowRef.emit("always-on-top-changed", {}, false);
  assert.deepEqual(windowRef.calls, [["top", true, "screen-saver"], ["moveTop"]]);
  assert.equal(timers.timeouts.size, 2);

  windowRef.calls.length = 0;
  windowRef.emit("always-on-top-changed", {}, true);
  assert.deepEqual(windowRef.calls, []);
});

test("hidden, minimized, or destroyed windows are never surfaced as a side effect", () => {
  const windowRef = fakeWindow();
  const timers = fakeTimers();
  const keeper = createKeeper(windowRef, { value: true }, timers);

  windowRef.visible = false;
  assert.equal(keeper.reassert(), false);
  windowRef.visible = true;
  windowRef.minimized = true;
  assert.equal(keeper.reassert(), false);
  windowRef.minimized = false;
  windowRef.destroyed = true;
  assert.equal(keeper.reassert(), false);
  assert.deepEqual(windowRef.calls, []);
});

test("macOS Game layer is restored on fullscreen spaces before moving to the top", () => {
  const windowRef = fakeWindow();
  const timers = fakeTimers();
  const keeper = createKeeper(windowRef, { value: true }, timers, {
    capabilities: {
      layerLevels: true,
      gameLayer: true,
      visibleOnFullScreen: true,
    },
  });

  keeper.reassert();
  assert.deepEqual(windowRef.calls, [
    ["top", true, "screen-saver"],
    ["spaces", true, { visibleOnFullScreen: true }],
    ["moveTop"],
  ]);
});

test("closed window detaches listeners and cancels pending work", () => {
  const windowRef = fakeWindow();
  const timers = fakeTimers();
  const keeper = createKeeper(windowRef, { value: true }, timers);

  keeper.attach();
  windowRef.emit("blur");
  windowRef.emit("closed");
  assert.equal(timers.timeouts.size, 0);
  assert.equal(timers.intervals.size, 0);
  assert.equal(windowRef.listenerCount("show"), 0);
});

test("window eligibility is conservative when optional Electron state APIs are absent", () => {
  assert.equal(canRaiseWindow({ isDestroyed: () => false }), true);
  assert.equal(canRaiseWindow({ isDestroyed: () => true }), false);
  assert.equal(canRaiseWindow(null), false);
});
