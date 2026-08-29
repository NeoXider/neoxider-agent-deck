const test = require("node:test");
const assert = require("node:assert/strict");
const { containsPoint, createCompactHitTracker, edgeHandleContains } = require("../src/compact-hit-tracker.cjs");

const orbWindow = (bounds) => ({ isDestroyed: () => false, getBounds: () => bounds });

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
  const tracker = createCompactHitTracker({
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

// The complaint was that the avatar "takes up an ENORMOUS area and gets in the way": a
// 172x128 transparent window over the desktop, all of it swallowing clicks, for a 68 px
// circle. Only the reported rectangles may take the mouse now.
test("in avatar mode only the measured controls are interactive", () => {
  let point = { x: 0, y: 0 };
  const published = [];
  const bounds = { x: 1000, y: 400, width: 172, height: 128 };
  // Window-relative: the circle at the right end, and the small utility button beside it.
  const areas = [{ x: 74, y: 30, width: 68, height: 68 }, { x: 22, y: 41, width: 38, height: 46 }];
  const tracker = createCompactHitTracker({
    screen: { getCursorScreenPoint: () => point },
    getWindow: () => orbWindow(bounds),
    getMode: () => "orb",
    getSide: () => "right",
    getAreas: () => areas,
    setActive: (active) => published.push(active),
    setIntervalFn: () => 1,
    clearIntervalFn() {},
  });

  point = { x: 1010, y: 410 };
  tracker.tick();
  assert.equal(tracker.isActive(), false, "the transparent corner belongs to whatever is behind it");

  point = { x: 1108, y: 464 };
  tracker.tick();
  assert.equal(tracker.isActive(), true, "the circle takes the mouse");

  point = { x: 1041, y: 464 };
  tracker.tick();
  assert.equal(tracker.isActive(), true, "so does the utility button");

  point = { x: 1000, y: 520 };
  tracker.tick();
  assert.equal(tracker.isActive(), false);
  assert.deepEqual(published, [true, false], "only state changes are published");
});

// Failing towards "everything is clickable" is the safe direction: a swallowed click is
// recoverable, a widget that cannot be clicked at all is not.
test("an orb that has not reported its layout yet stays fully interactive", () => {
  const tracker = createCompactHitTracker({
    screen: { getCursorScreenPoint: () => ({ x: -500, y: -500 }) },
    getWindow: () => orbWindow({ x: 0, y: 0, width: 172, height: 128 }),
    getMode: () => "orb",
    getSide: () => "right",
    getAreas: () => [],
    setActive: () => {},
    setIntervalFn: () => 1,
    clearIntervalFn() {},
  });
  assert.equal(tracker.tick(), true);
});

test("areas are window relative so a moved window needs no re-measurement", () => {
  const area = [{ x: 74, y: 30, width: 68, height: 68 }];
  assert.equal(containsPoint({ x: 108, y: 64 }, { x: 0, y: 0 }, area, 0), true);
  assert.equal(containsPoint({ x: 108, y: 64 }, { x: 900, y: 500 }, area, 0), false);
  assert.equal(containsPoint({ x: 1008, y: 564 }, { x: 900, y: 500 }, area, 0), true);
  assert.equal(containsPoint({ x: 1008, y: 564 }, { x: 900, y: 500 }, [{ x: 0, y: 0, width: 0, height: 0 }], 0), false);
});

test("dragging keeps the handle active until the drag ends", () => {
  let dragging = true;
  const published = [];
  const tracker = createCompactHitTracker({
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
