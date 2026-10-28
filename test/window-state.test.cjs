const test = require("node:test");
const assert = require("node:assert/strict");
const {
  captureModeBounds,
  devicePixelStep,
  fitFullBounds,
  resizeCompactAnchor,
  restoreCompactBounds,
  showShortcutTarget,
} = require("../src/window-state.cjs");

test("full, orb, and edge keep independent bounds", () => {
  let state = captureModeBounds(null, "full", { x: 240, y: 120, width: 420, height: 640 });
  state = captureModeBounds(state, "orb", { x: 1740, y: 510, width: 172, height: 128 }, "right");
  state = captureModeBounds(state, "edge", { x: 1832, y: 780, width: 88, height: 132 }, "right");

  assert.deepEqual(state, {
    version: 1,
    mode: "edge",
    full: { x: 240, y: 120, width: 420, height: 640 },
    orb: { x: 1740, y: 510, side: "right" },
    edge: { x: 1832, y: 780, side: "right" },
  });

  const fullAgain = captureModeBounds(state, "full", state.full);
  assert.deepEqual(fullAgain.orb, state.orb);
  assert.deepEqual(fullAgain.edge, state.edge);
});

test("full bounds remain unchanged on a negative-coordinate monitor", () => {
  const workArea = { x: -1920, y: 40, width: 1920, height: 1040 };
  const saved = { x: -1700, y: 140, width: 420, height: 640 };
  assert.deepEqual(fitFullBounds(saved, null, workArea), saved);
});

test("full bounds from a removed display are clamped into the current work area", () => {
  const workArea = { x: 0, y: 40, width: 1920, height: 1040 };
  const restored = fitFullBounds(
    { x: -1700, y: 1500, width: 420, height: 640 },
    { x: 100, y: 100, width: 420, height: 640 },
    workArea,
  );
  assert.deepEqual(restored, { x: 0, y: 440, width: 420, height: 640 });
});

test("full bounds honor workArea offsets and fit a smaller display", () => {
  const workArea = { x: 80, y: 60, width: 320, height: 420 };
  const restored = fitFullBounds(
    { x: -500, y: -500, width: 900, height: 1200 },
    { x: 80, y: 60, width: 420, height: 640 },
    workArea,
  );
  assert.deepEqual(restored, { x: 80, y: 60, width: 320, height: 420 });
});

test("full bounds land on the device-pixel grid so re-applying them cannot grow the window", () => {
  assert.deepEqual([1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 3].map(devicePixelStep), [1, 4, 2, 4, 1, 4, 2, 1]);
  assert.equal(devicePixelStep(undefined), 1);
  // A user's real 125 % laptop: y 42 is 52.5 device pixels, and Electron's round trip grew
  // this window 647 -> 649 -> 650 -> ... -> 657 on repeated shortcut presses.
  const pixels = { scaleFactor: 1.25, bounds: { x: 0, y: 0, width: 1536, height: 864 } };
  const workArea = { x: 0, y: 0, width: 1536, height: 816 };
  const placed = fitFullBounds({ x: 1136, y: 42, width: 400, height: 647 }, null, workArea, { minWidth: 360, minHeight: 360, pixels });
  assert.deepEqual(placed, { x: 1136, y: 44, width: 400, height: 648 });
  for (const value of Object.values(placed)) assert.equal(Number.isInteger(value * 1.25), true);
  assert.deepEqual(fitFullBounds(placed, null, workArea, { minWidth: 360, minHeight: 360, pixels }), placed, "stable once on the grid");
  // A second display at 150 %, to the right of the first: the grid counts from its own origin.
  const right = { scaleFactor: 1.5, bounds: { x: 1536, y: 0, width: 1280, height: 1080 } };
  const second = fitFullBounds({ x: 1601, y: 101, width: 421, height: 641 }, null, { x: 1536, y: 0, width: 1280, height: 1040 }, { minWidth: 360, minHeight: 360, pixels: right });
  assert.deepEqual(second, { x: 1602, y: 102, width: 422, height: 642 });
  // Without a display the bounds are kept exactly as before.
  assert.deepEqual(fitFullBounds({ x: 1136, y: 42, width: 400, height: 647 }, null, workArea, { minWidth: 360, minHeight: 360 }), { x: 1136, y: 42, width: 400, height: 647 });
});

test("the show shortcut opens the widget, brings it forward, then collapses it back", () => {
  assert.equal(showShortcutTarget({ mode: "orb", visible: true, focused: false, lastCompact: "orb" }), "full");
  assert.equal(showShortcutTarget({ mode: "edge", visible: true, focused: true, lastCompact: "edge" }), "full");
  assert.equal(showShortcutTarget({ mode: "full", visible: false, focused: false }), "full", "a hidden widget is shown");
  assert.equal(showShortcutTarget({ mode: "full", visible: true, focused: false, lastCompact: "orb" }), "focus", "behind another app it only comes forward");
  assert.equal(showShortcutTarget({ mode: "full", visible: true, focused: true, lastCompact: "orb" }), "orb");
  assert.equal(showShortcutTarget({ mode: "full", visible: true, focused: true, lastCompact: "edge" }), "edge");
  assert.equal(showShortcutTarget({ mode: "full", visible: true, focused: true }), "orb", "a widget that started full collapses to the avatar");
});

test("orb restore uses runtime width while preserving the saved edge and y", () => {
  const workArea = { x: -1920, y: 40, width: 1920, height: 1040 };
  const saved = { x: -408, y: 610, side: "right" };

  const status = restoreCompactBounds(saved, null, workArea, { mode: "orb", width: 400, height: 128 });
  const quick = restoreCompactBounds(saved, null, workArea, { mode: "orb", width: 172, height: 128 });

  assert.deepEqual(status, { x: -408, y: 610, width: 400, height: 128, side: "right" });
  assert.deepEqual(quick, { x: -180, y: 610, width: 172, height: 128, side: "right" });
});

test("orb and edge restore their own vertical positions and margins", () => {
  const workArea = { x: 0, y: 40, width: 1920, height: 1040 };
  const orb = restoreCompactBounds(
    { x: 8, y: 260, side: "left" },
    null,
    workArea,
    { mode: "orb", width: 172, height: 128 },
  );
  const edge = restoreCompactBounds(
    { x: 0, y: 740, side: "left" },
    null,
    workArea,
    { mode: "edge", width: 88, height: 132 },
  );

  assert.equal(orb.x, 8);
  assert.equal(orb.y, 260);
  assert.equal(edge.x, 0);
  assert.equal(edge.y, 740);
});

test("expanded orb keeps the visible pet anchored and round-trips canonical left and right positions", () => {
  const workArea = { x: 0, y: 40, width: 1920, height: 1040 };
  for (const side of ["left", "right"]) {
    const canonical = { x: side === "left" ? 8 : 1740, y: 510, side };
    const base = restoreCompactBounds(canonical, null, workArea, { mode: "orb", width: 172, height: 128, side });
    const expandedAnchor = resizeCompactAnchor(canonical, 128, 158);
    const expanded = restoreCompactBounds(expandedAnchor, null, workArea, { mode: "orb", width: 460, height: 158, side });
    const capturedCanonical = resizeCompactAnchor(expanded, 158, 128);
    const restored = restoreCompactBounds(capturedCanonical, null, workArea, { mode: "orb", width: 172, height: 128, side });
    const petCenterX = (bounds) => side === "left" ? bounds.x + 64 : bounds.x + bounds.width - 64;

    assert.equal(expanded.y + 79, base.y + 64);
    assert.equal(petCenterX(expanded), petCenterX(base));
    assert.equal(restored.y, base.y);
    assert.equal(restored.x, base.x);
    assert.equal(restored.side, side);
  }
});

test("pending compact expansion cannot shift saved avatar position on repeated captures", () => {
  const vm = require("node:vm");
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "../src/main.cjs"), "utf8");
  const body = source.slice(source.indexOf("function captureWindowBounds("), source.indexOf("function captureFullBounds("));
  const context = vm.createContext({ preferences: { compactSide: "right", windowState: captureModeBounds(null, "orb", { x: 1700, y: 500, width: 172, height: 128 }, "right") }, compactStatus: { expanded: true }, resizeCompactAnchor, captureModeBounds, ORB_SIZE: 128 });
  vm.runInContext(body, context);
  for (let cycle = 0; cycle < 50; cycle++) {
    vm.runInContext('captureWindowBounds("orb", { x:1700, y:500, width:400, height:128 })', context);
    assert.equal(context.preferences.windowState.orb.y, 500);
    vm.runInContext('captureWindowBounds("orb", { x:1700, y:485, width:460, height:158 })', context);
    assert.equal(context.preferences.windowState.orb.y, 500);
  }
});
