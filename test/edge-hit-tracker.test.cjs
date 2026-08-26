const test = require("node:test");
const assert = require("node:assert/strict");
const { createEdgeHitTracker, edgeHandleContains } = require("../src/edge-hit-tracker.cjs");

test("only the visible right or left edge line plus five pixels is interactive", () => {
  const bounds = { x: 100, y: 200, width: 88, height: 132 };
  assert.equal(edgeHandleContains({ x: 180, y: 266 }, bounds, "right"), true);
  assert.equal(edgeHandleContains({ x: 174, y: 266 }, bounds, "right"), false);
  assert.equal(edgeHandleContains({ x: 104, y: 266 }, bounds, "left"), true);
  assert.equal(edgeHandleContains({ x: 114, y: 266 }, bounds, "left"), false);
  assert.equal(edgeHandleContains({ x: 104, y: 220 }, bounds, "left"), false);
});

test("tracker polls outside the transparent renderer and publishes only state changes", () => {
  let point = { x: 20, y: 20 };
  let callback;
  const published = [];
  const tracker = createEdgeHitTracker({
    screen: { getCursorScreenPoint: () => point },
    getWindow: () => ({ isDestroyed: () => false, getBounds: () => ({ x: 0, y: 0, width: 88, height: 132 }) }),
    getMode: () => "edge",
    getSide: () => "right",
    setActive: (active) => published.push(active),
    setIntervalFn: (next) => { callback = next; return 7; },
    clearIntervalFn() {},
  });
  tracker.sync();
  assert.deepEqual(published, []);
  point = { x: 84, y: 66 };
  callback();
  callback();
  point = { x: 20, y: 20 };
  callback();
  assert.deepEqual(published, [true, false]);
});

test("dragging keeps the handle active until the drag ends", () => {
  let dragging = true;
  const published = [];
  const tracker = createEdgeHitTracker({
    screen: { getCursorScreenPoint: () => ({ x: -100, y: -100 }) },
    getWindow: () => ({ isDestroyed: () => false, getBounds: () => ({ x: 0, y: 0, width: 88, height: 132 }) }),
    getMode: () => "edge",
    getSide: () => "right",
    isDragging: () => dragging,
    setActive: (active) => published.push(active),
    setIntervalFn: () => 1,
    clearIntervalFn() {},
  });
  tracker.sync();
  dragging = false;
  tracker.tick();
  assert.deepEqual(published, [true, false]);
});
