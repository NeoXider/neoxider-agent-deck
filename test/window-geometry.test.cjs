const test = require("node:test");
const assert = require("node:assert/strict");
const { moveCompactBounds, snapCompactBounds } = require("../src/window-geometry.cjs");

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
