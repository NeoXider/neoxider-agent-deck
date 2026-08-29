const test = require("node:test");
const assert = require("node:assert/strict");
const {
  compactVisibleInset,
  compactVisibleRect,
  edgeDragBounds,
  moveCompactBounds,
  snapCompactBounds,
} = require("../src/window-geometry.cjs");

const workArea = { x: 0, y: 20, width: 1920, height: 1040 };
const ORB = { width: 172, height: 128 };
const ORB_PANEL = { width: 460, height: 158 };
const EDGE = { width: 88, height: 132 };

test("compact drag is clamped to the usable display", () => {
  const result = moveCompactBounds({ x: 100, y: 100, width: 190, height: 76 }, { x: -500, y: 5000 }, workArea);
  assert.deepEqual(result, { x: 0, y: 984, width: 190, height: 76 });
});

// The reported symptom was "the avatar and the line are strongly limited in height". They
// were: both windows are mostly transparent, and clamping the WINDOW to the work area
// stopped the visible circle 30 px short of the top and the line 28 px short.
test("the visible circle and line can reach the very top and bottom of the screen", () => {
  const orb = { ...ORB, x: 1740, y: 400 };
  const inset = compactVisibleInset("orb", "right", orb);
  assert.deepEqual(inset, { top: 30, right: 30, bottom: 30, left: 74 }, "68px circle, 30px margin, docked right");

  const top = moveCompactBounds(orb, { x: orb.x, y: -9999 }, workArea, inset);
  const bottom = moveCompactBounds(orb, { x: orb.x, y: 9999 }, workArea, inset);
  assert.equal(compactVisibleRect(top, inset).y, workArea.y, "the circle touches the top of the work area");
  assert.equal(
    compactVisibleRect(bottom, inset).y + 68,
    workArea.y + workArea.height,
    "and the bottom, with the transparent margin hanging off the screen",
  );
  // Without the inset the same drag stops a full margin short at both ends.
  assert.equal(moveCompactBounds(orb, { x: orb.x, y: -9999 }, workArea).y, workArea.y);
  assert.equal(compactVisibleRect(moveCompactBounds(orb, { x: orb.x, y: -9999 }, workArea), inset).y - workArea.y, 30);

  const edge = { ...EDGE, x: 1832, y: 400 };
  const edgeInset = compactVisibleInset("edge", "right", edge);
  assert.deepEqual(edgeInset, { top: 28, right: 0, bottom: 28, left: 80 });
  const edgeTop = moveCompactBounds(edge, { x: edge.x, y: -9999 }, workArea, edgeInset);
  assert.equal(compactVisibleRect(edgeTop, edgeInset).y, workArea.y);
});

test("the visible inset follows the docked side", () => {
  assert.deepEqual(compactVisibleInset("orb", "left", ORB), { top: 30, right: 74, bottom: 30, left: 30 });
  assert.deepEqual(compactVisibleInset("edge", "left", EDGE), { top: 28, right: 80, bottom: 28, left: 0 });
});

// "The avatar moves to the right on its own." With the panel open the window is 460 px wide
// and the circle sits at one end of it, so a drop that plainly ended on the left half was
// judged by a window centre still sitting on the right, and snapped back.
test("the snapped side is decided by the circle, not by the window around it", () => {
  // Docked left with the panel open, the circle sits at the left end of a 460 px window, so
  // it is 166 px left of the centre the old rule measured.
  const panel = { ...ORB_PANEL, x: 800, y: 400 };
  const inset = compactVisibleInset("orb", "left", panel);
  const rect = compactVisibleRect(panel, inset);
  const middle = workArea.x + workArea.width / 2;
  assert.ok(rect.x + rect.width / 2 < middle, "the circle was dropped on the left half");
  assert.ok(panel.x + panel.width / 2 > middle, "while the window centre is still on the right");

  assert.equal(snapCompactBounds(panel, workArea, "orb", inset).side, "left", "follows the circle");
  assert.equal(snapCompactBounds(panel, workArea, "orb").side, "right", "the old rule flung it to the right edge");
});

test("a snapped compact window keeps the visible element on screen", () => {
  for (const mode of ["orb", "edge"]) {
    const bounds = mode === "orb" ? { ...ORB, x: 40, y: -400 } : { ...EDGE, x: 40, y: 4000 };
    const inset = compactVisibleInset(mode, "left", bounds);
    const snapped = snapCompactBounds(bounds, workArea, mode, inset);
    const rect = compactVisibleRect(snapped, inset);
    assert.ok(rect.y >= workArea.y, `${mode} top ${rect.y} is on screen`);
    assert.ok(rect.y + rect.height <= workArea.y + workArea.height, `${mode} bottom is on screen`);
  }
});

test("avatar mode magnetizes to the nearest edge with an eight pixel margin", () => {
  const left = snapCompactBounds({ x: 200, y: 120, width: 190, height: 76 }, workArea, "orb");
  const right = snapCompactBounds({ x: 1600, y: 120, width: 190, height: 76 }, workArea, "orb");
  assert.equal(left.side, "left");
  assert.equal(left.x, 8);
  assert.equal(right.side, "right");
  assert.equal(right.x, 1722);
});

test("edge handle snaps flush and preserves a safe vertical position", () => {
  const result = snapCompactBounds({ x: 1860, y: -50, width: 56, height: 132 }, workArea, "edge");
  assert.equal(result.side, "right");
  assert.equal(result.x, 1864);
  assert.equal(result.y, 20);
});

test("a released edge handle can only occupy the physical left or right display edge", () => {
  const displays = [
    workArea,
    { x: -1920, y: 40, width: 1920, height: 1040 },
  ];
  for (const display of displays) {
    const width = 88;
    const legalX = new Set([display.x, display.x + display.width - width]);
    for (const x of [display.x - 500, display.x, display.x + 100, display.x + 900, display.x + display.width + 500]) {
      const snapped = snapCompactBounds({ x, y: display.y + 200, width, height: 132 }, display, "edge");
      assert.ok(legalX.has(snapped.x), `edge x=${snapped.x} must be flush with ${[...legalX].join(" or ")}`);
      assert.equal(snapped.x, snapped.side === "left" ? display.x : display.x + display.width - width);
    }
  }
});

// The 0.6.4 fix for cumulative rightward drift froze x for the whole edge drag, which
// also made the opposite screen edge unreachable: the line could only slide up and down
// the side it started on. The side must follow the pointer across the middle instead.
test("an edge drag can cross to the other side of the display", () => {
  const bounds = { x: 1832, y: 300, width: 88, height: 132 };

  const stillRight = edgeDragBounds(bounds, { x: 1500, y: 300 }, workArea);
  assert.equal(stillRight.side, "right");
  assert.equal(stillRight.x, 1832, "flush against the right edge");

  const crossed = edgeDragBounds(bounds, { x: 400, y: 300 }, workArea);
  assert.equal(crossed.side, "left", "crossing the middle moves the line to the left edge");
  assert.equal(crossed.x, 0, "flush against the left edge, not floating mid-screen");

  // Exactly on the midpoint resolves to one side deterministically rather than flickering.
  assert.equal(edgeDragBounds(bounds, { x: 960, y: 300 }, workArea).side, "right");

  // A pointer with no usable x must not silently teleport the line.
  assert.equal(edgeDragBounds(bounds, { x: Number.NaN, y: 300 }, workArea).side, "right");
});

test("an edge drag stays flush on a display that does not start at zero", () => {
  const second = { x: 1920, y: 0, width: 1280, height: 1024 };
  const bounds = { x: 1920, y: 100, width: 88, height: 132 };
  assert.deepEqual(edgeDragBounds(bounds, { x: 3100, y: 100 }, second), { ...bounds, side: "right", x: 3112 });
  assert.deepEqual(edgeDragBounds(bounds, { x: 2000, y: 100 }, second), { ...bounds, side: "left", x: 1920 });
});
