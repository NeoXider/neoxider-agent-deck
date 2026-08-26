function edgeHandleContains(point, bounds, side, { lineWidth = 8, lineHeight = 76, padding = 5 } = {}) {
  if (!point || !bounds) return false;
  const x = side === "left" ? bounds.x : bounds.x + bounds.width - lineWidth;
  const y = bounds.y + Math.round((bounds.height - lineHeight) / 2);
  return point.x >= x - padding
    && point.x <= x + lineWidth + padding
    && point.y >= y - padding
    && point.y <= y + lineHeight + padding;
}

function createEdgeHitTracker({
  screen,
  getWindow,
  getMode,
  getSide,
  isDragging = () => false,
  setActive,
  interval = 50,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
} = {}) {
  let timer = null;
  let active = false;

  function publish(next) {
    if (active === next) return;
    active = next;
    setActive(next);
  }

  function tick() {
    const window = getWindow?.();
    if (getMode?.() !== "edge" || !window || window.isDestroyed?.()) {
      publish(false);
      return false;
    }
    if (isDragging()) {
      publish(true);
      return true;
    }
    const hit = edgeHandleContains(screen.getCursorScreenPoint(), window.getBounds(), getSide?.());
    publish(hit);
    return hit;
  }

  function sync() {
    if (getMode?.() !== "edge") {
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

module.exports = { createEdgeHitTracker, edgeHandleContains };
