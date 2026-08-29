// Compact windows are mostly empty. The orb window is 172x128 for a 68x68 circle, and the
// edge window is 88x132 for an 8x76 line: the rest is transparent room for the bloom.
//
// Every rule here used to be applied to the WINDOW rectangle, and all three of the bugs
// that follow came from that one decision:
//   * clamping the window to the work area stopped the visible circle 30 px short of the
//     top and bottom of the screen, and the line 28 px short — travel the user could see
//     was missing but could not explain;
//   * choosing the docked side from the window's centre sent the orb to the far edge after
//     a drag that had clearly ended near the other one, because with the status panel open
//     the circle sits up to 300 px away from the centre it was being judged by;
//   * the transparent margin swallowed clicks meant for whatever was underneath.
//
// So the visible rectangle is the unit of measurement. `compactVisibleInset` says where the
// visible pixels sit inside the window, and clamping, snapping and hit testing all work on
// `compactVisibleRect` instead of the window itself.
//
// The numbers below mirror styles.css and are asserted against it by ui-contract, so a
// change to one that is not made in the other fails the suite rather than drifting.
const COMPACT_VISUALS = {
  // .orb-avatar — 68 px circle with a 30 px margin, vertically centred in the window.
  orb: { size: 68, margin: 30 },
  // .edge-line — 8x76, flush against the docked side and vertically centred.
  edge: { width: 8, height: 76 },
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function compactMargin(mode) {
  return mode === "orb" ? 8 : 0;
}

function centred(available, visible) {
  return Math.max(0, Math.round((available - visible) / 2));
}

// The inset is side-dependent: the circle and the line both live at the docked end of the
// window, so which side is "away" flips with `side`.
function compactVisibleInset(mode, side, bounds) {
  const height = Math.max(1, Number(bounds?.height) || 1);
  const width = Math.max(1, Number(bounds?.width) || 1);
  const near = side === "left" ? "left" : "right";
  const far = near === "left" ? "right" : "left";
  if (mode === "edge") {
    const vertical = centred(height, COMPACT_VISUALS.edge.height);
    return {
      top: vertical,
      bottom: vertical,
      [near]: 0,
      [far]: Math.max(0, width - COMPACT_VISUALS.edge.width),
    };
  }
  const { size, margin } = COMPACT_VISUALS.orb;
  return {
    top: centred(height, size),
    bottom: centred(height, size),
    [near]: margin,
    [far]: Math.max(0, width - size - margin),
  };
}

const NO_INSET = { top: 0, right: 0, bottom: 0, left: 0 };

function readInset(inset) {
  if (!inset || typeof inset !== "object") return NO_INSET;
  const read = (key) => {
    const value = Number(inset[key]);
    return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
  };
  return { top: read("top"), right: read("right"), bottom: read("bottom"), left: read("left") };
}

function compactVisibleRect(bounds, inset) {
  const visible = readInset(inset);
  return {
    x: bounds.x + visible.left,
    y: bounds.y + visible.top,
    width: Math.max(1, bounds.width - visible.left - visible.right),
    height: Math.max(1, bounds.height - visible.top - visible.bottom),
  };
}

// The window may hang off the screen by exactly as much as it is transparent there. What
// may never leave is the part the user can see.
function moveCompactBounds(bounds, requested, workArea, inset) {
  const visible = readInset(inset);
  const requestedX = Number(requested?.x);
  const requestedY = Number(requested?.y);
  const candidateX = Number.isFinite(requestedX) ? requestedX : bounds.x;
  const candidateY = Number.isFinite(requestedY) ? requestedY : bounds.y;
  return {
    ...bounds,
    x: clamp(
      Math.round(candidateX),
      workArea.x - visible.left,
      workArea.x + workArea.width - bounds.width + visible.right,
    ),
    y: clamp(
      Math.round(candidateY),
      workArea.y - visible.top,
      workArea.y + workArea.height - bounds.height + visible.bottom,
    ),
  };
}

// Edge mode is a thin line flush against a screen side, so a drag cannot simply follow the
// pointer — the line would float in the middle of the screen and look broken. An earlier
// fix froze x for the whole drag instead. That stopped the drift it was aimed at, but it
// also made the opposite edge unreachable, because the side could then never change.
//
// So the line stays flush and the SIDE follows the pointer: cross the middle of the
// display and it moves to the other edge at once. x is derived from the pointer on every
// move rather than accumulated, so the drift has nothing to build up from.
function edgeDragBounds(bounds, pointer, workArea) {
  const pointerX = Number(pointer?.x);
  const middle = workArea.x + workArea.width / 2;
  const side = Number.isFinite(pointerX) && pointerX < middle ? "left" : "right";
  return {
    ...bounds,
    side,
    x: side === "left" ? workArea.x : workArea.x + workArea.width - bounds.width,
  };
}

// `inset` describes where the visible element is RIGHT NOW, which is what makes the side
// answer the question the user actually asked: where did I just drop the circle?
function snapCompactBounds(bounds, workArea, mode, inset) {
  const visible = readInset(inset);
  const rect = compactVisibleRect(bounds, visible);
  const side = rect.x + rect.width / 2 < workArea.x + workArea.width / 2 ? "left" : "right";
  const margin = compactMargin(mode);
  return {
    ...bounds,
    side,
    x: side === "left" ? workArea.x + margin : workArea.x + workArea.width - bounds.width - margin,
    y: clamp(
      bounds.y,
      workArea.y - visible.top,
      workArea.y + workArea.height - bounds.height + visible.bottom,
    ),
  };
}

module.exports = {
  COMPACT_VISUALS,
  clamp,
  compactMargin,
  compactVisibleInset,
  compactVisibleRect,
  edgeDragBounds,
  moveCompactBounds,
  snapCompactBounds,
};
