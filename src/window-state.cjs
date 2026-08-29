const { clamp, compactMargin, compactVisibleInset } = require("./window-geometry.cjs");

function finite(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric) : fallback;
}

function fitFullBounds(saved, fallback, workArea, constraints = {}) {
  const source = saved && typeof saved === "object" ? saved : fallback;
  const maximumWidth = Math.max(1, finite(workArea?.width, 1));
  const maximumHeight = Math.max(1, finite(workArea?.height, 1));
  const minimumWidth = Math.min(maximumWidth, finite(constraints.minWidth, 360));
  const minimumHeight = Math.min(maximumHeight, finite(constraints.minHeight, 500));
  const width = clamp(finite(source?.width, finite(fallback?.width, minimumWidth)), minimumWidth, maximumWidth);
  const height = clamp(finite(source?.height, finite(fallback?.height, minimumHeight)), minimumHeight, maximumHeight);
  const x = clamp(
    finite(source?.x, finite(fallback?.x, workArea.x)),
    workArea.x,
    workArea.x + workArea.width - width,
  );
  const y = clamp(
    finite(source?.y, finite(fallback?.y, workArea.y)),
    workArea.y,
    workArea.y + workArea.height - height,
  );
  return { x, y, width, height };
}

function restoreCompactBounds(saved, fallback, workArea, options = {}) {
  const mode = options.mode === "edge" ? "edge" : "orb";
  const width = Math.max(1, finite(options.width, fallback?.width || 1));
  const height = Math.max(1, finite(options.height, fallback?.height || 1));
  const side = [saved?.side, options.side, fallback?.side].find((value) => value === "left" || value === "right") || "right";
  const margin = compactMargin(mode);
  // Clamped by the VISIBLE rectangle, not the window: the transparent margin around the
  // circle and the line is allowed to hang off the screen, which is what lets the user
  // park either of them flush against the top or bottom edge.
  const inset = compactVisibleInset(mode, side, { width, height });
  const y = clamp(
    finite(saved?.y, finite(fallback?.y, workArea.y)),
    workArea.y - inset.top,
    workArea.y + workArea.height - height + inset.bottom,
  );
  return {
    x: side === "left" ? workArea.x + margin : workArea.x + workArea.width - width - margin,
    y,
    width,
    height,
    side,
  };
}

function captureModeBounds(state, mode, bounds, side) {
  const current = state && typeof state === "object" ? state : {};
  const next = {
    version: 1,
    mode: ["full", "orb", "edge"].includes(mode) ? mode : "full",
    full: current.full || null,
    orb: current.orb || null,
    edge: current.edge || null,
  };
  if (mode === "full") {
    next.full = {
      x: finite(bounds?.x, 0),
      y: finite(bounds?.y, 0),
      width: Math.max(1, finite(bounds?.width, 1)),
      height: Math.max(1, finite(bounds?.height, 1)),
    };
  } else if (mode === "orb" || mode === "edge") {
    next[mode] = {
      x: finite(bounds?.x, 0),
      y: finite(bounds?.y, 0),
      side: side === "left" ? "left" : "right",
    };
  }
  return next;
}

function resizeCompactAnchor(position, fromHeight, toHeight) {
  if (!position || typeof position !== "object") return position;
  const sourceHeight = Math.max(1, finite(fromHeight, 1));
  const targetHeight = Math.max(1, finite(toHeight, sourceHeight));
  return {
    ...position,
    y: finite(position.y, 0) + Math.round((sourceHeight - targetHeight) / 2),
  };
}

module.exports = { captureModeBounds, fitFullBounds, resizeCompactAnchor, restoreCompactBounds };
