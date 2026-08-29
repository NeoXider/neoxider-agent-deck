const test = require("node:test");
const assert = require("node:assert/strict");
const { COMPACT_SIZES, compactAnchor, compactTargetBounds, compactWindowSize } = require("../src/compact-window.cjs");
const { compactVisibleInset, compactVisibleRect } = require("../src/window-geometry.cjs");

const workArea = { x: 0, y: 20, width: 1920, height: 1040 };
const getWorkArea = () => workArea;
const source = { x: 500, y: 300, width: 420, height: 640 };

test("the orb has one size per thing it is showing", () => {
  assert.deepEqual(compactWindowSize("orb", {}), COMPACT_SIZES.orb);
  assert.deepEqual(compactWindowSize("orb", { active: true }), COMPACT_SIZES.orbStatus);
  assert.deepEqual(compactWindowSize("orb", { active: true, expanded: true }), COMPACT_SIZES.orbPanel);
  assert.deepEqual(compactWindowSize("orb", { expanded: true }), COMPACT_SIZES.orbPanel);
  // Edge is one line whatever the status says.
  assert.deepEqual(compactWindowSize("edge", { expanded: true }), COMPACT_SIZES.edge);
});

test("the saved anchor is kept in collapsed coordinates", () => {
  const saved = { x: 10, y: 400, side: "right" };
  assert.equal(compactAnchor("orb", {}, saved).y, 400, "collapsed is the stored frame");
  assert.equal(compactAnchor("orb", { expanded: true }, saved).y, 385, "expanding grows both ways from the circle");
  assert.equal(compactAnchor("edge", { expanded: true }, saved).y, 400, "edge never changes height");
  assert.equal(compactAnchor("orb", { expanded: true }, null), null);
});

test("both compact modes dock flush to the saved side", () => {
  const right = compactTargetBounds({ mode: "orb", status: {}, saved: { x: 0, y: 500, side: "right" }, source, side: "right", getWorkArea });
  assert.equal(right.side, "right");
  assert.equal(right.x, workArea.width - COMPACT_SIZES.orb.width - 8, "8 px margin in avatar mode");

  const left = compactTargetBounds({ mode: "edge", status: {}, saved: { x: 0, y: 500, side: "left" }, source, side: "left", getWorkArea });
  assert.equal(left.side, "left");
  assert.equal(left.x, workArea.x, "the edge line is flush with no margin");
});

// Opening and closing the panel must not walk the circle up or down the screen, and must
// never push it off the bottom: it grows by 30 px and the anchor compensates by 15.
test("opening the panel keeps the circle where the user parked it", () => {
  const saved = { x: 0, y: 600, side: "right" };
  const collapsed = compactTargetBounds({ mode: "orb", status: {}, saved, source, side: "right", getWorkArea });
  const expanded = compactTargetBounds({ mode: "orb", status: { active: true, expanded: true }, saved, source, side: "right", getWorkArea });
  const centre = (bounds) => bounds.y + bounds.height / 2;
  assert.equal(centre(collapsed), centre(expanded), "the circle stays on the same line");
});

test("a compact window restored at the extremes keeps its visible part on screen", () => {
  for (const mode of ["orb", "edge"]) {
    for (const y of [-5000, 5000]) {
      for (const side of ["left", "right"]) {
        const status = mode === "orb" ? { active: true, expanded: true } : {};
        const bounds = compactTargetBounds({ mode, status, saved: { x: 0, y, side }, source, side, getWorkArea });
        const rect = compactVisibleRect(bounds, compactVisibleInset(mode, side, bounds));
        assert.ok(rect.x >= workArea.x, `${mode}/${side} left edge`);
        assert.ok(rect.x + rect.width <= workArea.x + workArea.width, `${mode}/${side} right edge`);
        assert.ok(rect.y >= workArea.y, `${mode}/${side}/${y} top edge`);
        assert.ok(rect.y + rect.height <= workArea.y + workArea.height, `${mode}/${side}/${y} bottom edge`);
      }
    }
  }
});

test("with no saved position the window is placed from the full window it collapsed out of", () => {
  const orb = compactTargetBounds({ mode: "orb", status: {}, saved: null, source, side: "right", getWorkArea });
  assert.equal(orb.y, source.y, "the orb keeps the top of the window it came from");
  const edge = compactTargetBounds({ mode: "edge", status: {}, saved: null, source, side: "right", getWorkArea });
  assert.equal(edge.y, source.y + Math.round((source.height - COMPACT_SIZES.edge.height) / 2), "the line centres on it");
});

test("the display is chosen from where the window is going, not from where it came", () => {
  const second = { x: 1920, y: 0, width: 1280, height: 1024 };
  const probes = [];
  const bounds = compactTargetBounds({
    mode: "orb",
    status: {},
    saved: { x: 3000, y: 200, side: "right" },
    source,
    side: "right",
    getWorkArea: (probe) => {
      probes.push(probe);
      return probe.x >= second.x ? second : workArea;
    },
  });
  assert.equal(probes.length, 1);
  assert.equal(probes[0].x, 3000, "probed with the saved position, not the source window");
  assert.equal(bounds.x, second.x + second.width - COMPACT_SIZES.orb.width - 8, "docked on the second monitor");
});
