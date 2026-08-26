const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const { createRegionSelector, parseSelection } = require("../src/region-selector.cjs");

class WebContentsMock extends EventEmitter {}

class BrowserWindowMock extends EventEmitter {
  static instances = [];

  constructor(options) {
    super();
    this.options = options;
    this.webContents = new WebContentsMock();
    this.calls = [];
    this.destroyed = false;
    BrowserWindowMock.instances.push(this);
  }

  loadURL(url) { this.url = url; return Promise.resolve(); }
  setBounds(bounds, animate) { this.calls.push(["setBounds", bounds, animate]); }
  setAlwaysOnTop(...args) { this.calls.push(["setAlwaysOnTop", ...args]); }
  setVisibleOnAllWorkspaces(...args) { this.calls.push(["setVisibleOnAllWorkspaces", ...args]); }
  show() { this.calls.push(["show"]); }
  focus() { this.calls.push(["focus"]); }
  destroy() { this.destroyed = true; this.calls.push(["destroy"]); }
  isDestroyed() { return this.destroyed; }
}

const displays = [
  { id: 11, bounds: { x: -1280, y: -120, width: 1280, height: 1024 }, scaleFactor: 2 },
  { id: 22, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 },
];

function fixture({ cursor = { x: -500, y: 200 }, platform = "win32", Window = BrowserWindowMock, availableDisplays = displays } = {}) {
  BrowserWindowMock.instances = [];
  const screen = {
    getAllDisplays: () => availableDisplays,
    getCursorScreenPoint: () => cursor,
    getDisplayNearestPoint: (point) => point.x < 0 ? displays[0] : displays[1],
    getPrimaryDisplay: () => displays[1],
  };
  return createRegionSelector({ BrowserWindow: Window, screen, platform });
}

function navigate(window, url) {
  let prevented = false;
  window.webContents.emit("will-navigate", { preventDefault: () => { prevented = true; } }, url);
  return prevented;
}

test("selection overlay covers exactly the cursor display in Electron DIP coordinates", async () => {
  const selectRegion = fixture();
  const promise = selectRegion({ displays, coordinateSpace: "dip", constrainToDisplay: true });
  const window = BrowserWindowMock.instances[0];
  assert.deepEqual(
    { x: window.options.x, y: window.options.y, width: window.options.width, height: window.options.height },
    displays[0].bounds,
  );
  assert.equal(window.options.transparent, true);
  assert.equal(window.options.webPreferences.nodeIntegration, false);
  assert.equal(window.options.webPreferences.contextIsolation, true);
  window.emit("ready-to-show");
  assert.deepEqual(window.calls.slice(0, 5), [
    ["setBounds", displays[0].bounds, false],
    ["setAlwaysOnTop", true, "screen-saver"],
    ["setVisibleOnAllWorkspaces", true, { visibleOnFullScreen: true }],
    ["show"],
    ["focus"],
  ]);
  assert.equal(navigate(window, "neoxider-region://select/?x=80&y=100&width=200&height=150"), true);
  assert.deepEqual(await promise, {
    displayId: 11,
    bounds: { x: -1200, y: -20, width: 200, height: 150 },
  });
  assert.equal(window.destroyed, true);
});

test("selection is clamped to one display and never crosses a neighboring monitor", () => {
  assert.deepEqual(
    parseSelection("neoxider-region://select/?x=1200&y=900&width=500&height=500", displays[0]),
    { displayId: 11, bounds: { x: -80, y: 780, width: 80, height: 124 } },
  );
  assert.equal(parseSelection("neoxider-region://select/?x=1280&y=0&width=20&height=20", displays[0]), null);
});

test("Escape cancels, destroys the overlay, and removes every listener", async () => {
  const selectRegion = fixture();
  const promise = selectRegion({ displays });
  const window = BrowserWindowMock.instances[0];
  window.webContents.emit("before-input-event", {}, { type: "keyDown", key: "Escape" });
  assert.deepEqual(await promise, { canceled: true, reason: "canceled" });
  assert.equal(window.destroyed, true);
  assert.equal(window.listenerCount("ready-to-show"), 0);
  assert.equal(window.listenerCount("closed"), 0);
  assert.equal(window.webContents.listenerCount("will-navigate"), 0);
  assert.equal(window.webContents.listenerCount("before-input-event"), 0);
  assert.equal(selectRegion.isActive(), false);
});

test("renderer cancel and external dispose settle once without leaked windows", async () => {
  const selectRegion = fixture({ cursor: { x: 500, y: 200 } });
  const first = selectRegion({ displays });
  const window = BrowserWindowMock.instances[0];
  const second = await selectRegion({ displays });
  assert.deepEqual(second, { canceled: true, reason: "selection-already-active" });
  assert.equal(navigate(window, "neoxider-region://cancel/"), true);
  assert.deepEqual(await first, { canceled: true, reason: "canceled" });

  const third = selectRegion({ displays });
  const nextWindow = BrowserWindowMock.instances[1];
  selectRegion.dispose();
  nextWindow.emit("closed");
  assert.deepEqual(await third, { canceled: true, reason: "disposed" });
  assert.equal(nextWindow.destroyed, true);
});

test("overlay load failure is an explicit cancellation with complete cleanup", async () => {
  class BrokenWindow extends BrowserWindowMock {
    loadURL() { return Promise.reject(new Error("load failed")); }
  }
  BrokenWindow.instances = BrowserWindowMock.instances;
  const selectRegion = fixture({ Window: BrokenWindow });
  const promise = selectRegion({ displays });
  const window = BrowserWindowMock.instances[0];
  assert.deepEqual(await promise, { canceled: true, reason: "overlay-load-failed" });
  assert.equal(window.destroyed, true);
  assert.equal(window.webContents.listenerCount("will-navigate"), 0);
});

test("a synchronous overlay load failure also destroys the window", async () => {
  class ThrowingWindow extends BrowserWindowMock {
    loadURL() { throw new Error("load failed"); }
  }
  const selectRegion = fixture({ Window: ThrowingWindow });
  const result = await selectRegion({ displays });
  const window = BrowserWindowMock.instances[0];
  assert.deepEqual(result, { canceled: true, reason: "overlay-load-failed" });
  assert.equal(window.destroyed, true);
  assert.equal(selectRegion.isActive(), false);
});

test("unsupported platforms and missing displays degrade without creating a window", async () => {
  const unsupported = fixture({ platform: "darwin" });
  assert.deepEqual(await unsupported({ displays }), {
    canceled: true,
    reason: "region-selection-unsupported-on-platform",
  });
  assert.equal(BrowserWindowMock.instances.length, 0);

  const noDisplays = fixture({ availableDisplays: [] });
  assert.deepEqual(await noDisplays({ displays: [] }), {
    canceled: true,
    reason: "no-displays",
  });
});
