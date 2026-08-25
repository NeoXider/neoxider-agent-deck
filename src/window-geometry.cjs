function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function moveCompactBounds(bounds, requested, workArea) {
  const requestedX = Number(requested?.x);
  const requestedY = Number(requested?.y);
  const candidateX = Number.isFinite(requestedX) ? requestedX : bounds.x;
  const candidateY = Number.isFinite(requestedY) ? requestedY : bounds.y;
  return {
    ...bounds,
    x: clamp(Math.round(candidateX), workArea.x, workArea.x + workArea.width - bounds.width),
    y: clamp(Math.round(candidateY), workArea.y, workArea.y + workArea.height - bounds.height),
  };
}

function snapCompactBounds(bounds, workArea, mode) {
  const side = bounds.x + bounds.width / 2 < workArea.x + workArea.width / 2 ? "left" : "right";
  const margin = mode === "orb" ? 8 : 0;
  return {
    ...bounds,
    side,
    x: side === "left" ? workArea.x + margin : workArea.x + workArea.width - bounds.width - margin,
    y: clamp(bounds.y, workArea.y, workArea.y + workArea.height - bounds.height),
  };
}

module.exports = { clamp, moveCompactBounds, snapCompactBounds };
