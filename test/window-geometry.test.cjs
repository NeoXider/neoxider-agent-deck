const test = require("node:test");
const assert = require("node:assert/strict");
const { edgeDragBounds, moveCompactBounds, snapCompactBounds } = require("../src/window-geometry.cjs");

const workArea = { x: 0, y: 20, width: 1920, height: 1040 };

test("compact drag is clamped to the usable display", () => {
  const result = moveCompactBounds({ x: 100, y: 100, width: 190, height: 76 }, { x: -500, y: 5000 }, workArea);
  assert.deepEqual(result, { x: 0, y: 984, width: 190, height: 76 });
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
