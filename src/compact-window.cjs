// Where a compact window goes and how big it is.
//
// This was two nearly identical branches inside `applyWindowMode`, which is how the orb
// grew a saved-anchor rule that the edge never got. Both modes now go through one function,
// so a fix to one is a fix to both, and the arithmetic can be tested without an Electron
// window.
const { resizeCompactAnchor, restoreCompactBounds } = require("./window-state.cjs");

// The orb has three widths because it holds three different things: the circle alone, the
// circle plus a one-line status, and the circle plus the session panel. Only the panel is
// taller — a status line fits beside the avatar.
const COMPACT_SIZES = {
  orb: { width: 172, height: 128 },
  orbStatus: { width: 400, height: 128 },
  orbPanel: { width: 460, height: 158 },
  // Wide enough for the edge glow to fade out; the line itself is still flush with the
  // screen edge.
  edge: { width: 88, height: 132 },
};

function compactWindowSize(mode, status = {}) {
  if (mode === "edge") return COMPACT_SIZES.edge;
  if (status.expanded) return COMPACT_SIZES.orbPanel;
  if (status.active) return COMPACT_SIZES.orbStatus;
  return COMPACT_SIZES.orb;
}

// The saved anchor is stored in collapsed coordinates so that opening and closing the panel
// keeps the circle where the user put it instead of walking it up the screen.
function compactAnchor(mode, status, position) {
  if (mode !== "orb" || !status?.expanded) return position;
  return resizeCompactAnchor(position, COMPACT_SIZES.orb.height, COMPACT_SIZES.orbPanel.height);
}

function compactTargetBounds({ mode, status = {}, saved, source, side, getWorkArea }) {
  const compactMode = mode === "edge" ? "edge" : "orb";
  const { width, height } = compactWindowSize(compactMode, status);
  const anchor = compactAnchor(compactMode, status, saved);
  const fallbackPosition = compactMode === "edge"
    ? { x: source.x, y: source.y + Math.round((source.height - height) / 2), side }
    : compactAnchor(compactMode, status, { x: source.x, y: source.y, side });
  const fallback = { ...fallbackPosition, width, height };
  // Match the display against where the window is going, not where it came from: restoring
  // an orb saved on a second monitor must not clamp it to the primary one first.
  const probe = anchor ? { ...fallback, x: anchor.x, y: anchor.y } : source;
  return restoreCompactBounds(anchor, fallback, getWorkArea(probe), {
    mode: compactMode,
    width,
    height,
    side,
  });
}

module.exports = { COMPACT_SIZES, compactAnchor, compactTargetBounds, compactWindowSize };
