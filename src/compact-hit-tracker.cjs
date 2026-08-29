// Which pixels of a compact window belong to the user, and which belong to whatever is
// behind it.
//
// Both compact windows are far larger than the thing they draw. Edge is an 88x132 window
// for an 8x76 line, and the orb is a 172x128 window — up to 460 wide with its panel open —
// for a 68 px circle. Edge already forwarded the mouse through its empty space; the orb did
// not, so a 172x128 transparent rectangle sat over the desktop eating clicks, and the whole
// of it started a drag. The complaint was exact: the avatar takes up an ENORMOUS area, only
// the buttons and the circle should be interactive, and it should only be draggable by the
// circle.
//
// So the tracker is no longer edge-specific. It polls the cursor and turns mouse forwarding
// off only while the pointer is over an area that actually draws something.
//
// Edge areas are computed here from the CSS constants. Orb areas cannot be: the buttons move
// with the docked side and the panel changes size, so the renderer measures its own live
// layout and reports it. Until it does, `getAreas` returns null and the window stays fully
// interactive — the old behaviour, which is the safe direction to fail in.
const { COMPACT_VISUALS, compactVisibleInset } = require("./window-geometry.cjs");

// A few pixels of slack: aiming at an 8 px line with a mouse is otherwise unpleasant, and
// the pointer is only sampled every 50 ms, so a fast approach can land just outside.
const HIT_PADDING = 5;

function rectContains(point, rect, padding = 0) {
  if (!point || !rect) return false;
  const x = Number(rect.x);
  const y = Number(rect.y);
  const width = Number(rect.width);
  const height = Number(rect.height);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return false;
  return point.x >= x - padding
    && point.x <= x + width + padding
    && point.y >= y - padding
    && point.y <= y + height + padding;
}

// Areas arrive window-relative, because that is the only frame the renderer can measure in
// and the only one that survives the window being moved between two samples.
function containsPoint(point, bounds, areas, padding = HIT_PADDING) {
  if (!point || !bounds || !Array.isArray(areas)) return false;
  return areas.some((area) => rectContains(point, {
    x: bounds.x + Number(area?.x || 0),
    y: bounds.y + Number(area?.y || 0),
    width: area?.width,
    height: area?.height,
  }, padding));
}

function edgeHandleArea(bounds, side) {
  const inset = compactVisibleInset("edge", side, bounds);
  return {
    x: side === "left" ? 0 : Math.max(0, bounds.width - COMPACT_VISUALS.edge.width),
    y: inset.top,
    width: COMPACT_VISUALS.edge.width,
    height: COMPACT_VISUALS.edge.height,
  };
}

function edgeHandleContains(point, bounds, side, { padding = HIT_PADDING } = {}) {
  return containsPoint(point, bounds, [edgeHandleArea(bounds, side)], padding);
}

function createCompactHitTracker({
  screen,
  getWindow,
  getMode,
  getSide,
  getAreas = () => null,
  isDragging = () => false,
  setActive,
  interval = 50,
  padding = HIT_PADDING,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
} = {}) {
  let timer = null;
  let active = false;

  function tracked() {
    const mode = getMode?.();
    return mode === "edge" || mode === "orb";
  }

  function publish(next) {
    if (active === next) return;
    active = next;
    setActive(next);
  }

  function tick() {
    const window = getWindow?.();
    if (!tracked() || !window || window.isDestroyed?.()) {
      publish(false);
      return false;
    }
    // A drag that started on the handle must not be cancelled the moment the pointer
    // outruns it.
    if (isDragging()) {
      publish(true);
      return true;
    }
    const mode = getMode?.();
    const bounds = window.getBounds();
    const reported = getAreas?.();
    const areas = Array.isArray(reported) && reported.length
      ? reported
      : (mode === "edge" ? [edgeHandleArea(bounds, getSide?.())] : null);
    // No measurement yet: keep every pixel live rather than swallow the user's clicks.
    if (!areas) {
      publish(true);
      return true;
    }
    const hit = containsPoint(screen.getCursorScreenPoint(), bounds, areas, padding);
    publish(hit);
    return hit;
  }

  function sync() {
    if (!tracked()) {
      stop();
      return;
    }
    if (!timer) timer = setIntervalFn(tick, interval);
    tick();
  }

  function stop() {
    if (timer) clearIntervalFn(timer);
    timer = null;
    publish(false);
  }

  return { isActive: () => active, stop, sync, tick };
}

module.exports = {
  HIT_PADDING,
  containsPoint,
  createCompactHitTracker,
  edgeHandleArea,
  edgeHandleContains,
  rectContains,
};
