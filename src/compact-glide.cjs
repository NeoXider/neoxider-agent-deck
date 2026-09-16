// The short flight a compact window takes to the screen edge when a drag is released.
//
// Dropping the avatar anywhere but on an edge snaps it to the nearest side, which is
// deliberate: a floating orb in the middle of the screen covers work. But the snap was a
// single setBounds, so a drop near the centre threw the window up to ~950 px sideways in one
// frame, and that is exactly what "the avatar flies away" looked like. The same distance
// covered in a few eased frames reads as the magnet it is.
//
// Nothing here touches Electron: the caller supplies how to move the window and how to wait,
// so the motion is testable and a destroyed window can simply stop being moved.
const GLIDE_DURATION_MS = 170;
const GLIDE_FRAME_MS = 16;

function easeOutCubic(t) {
  const clamped = Math.max(0, Math.min(1, t));
  return 1 - (1 - clamped) ** 3;
}

// Integer positions for each frame, ending exactly on the target.
function glideSteps(from, to, frames) {
  const count = Math.max(1, Math.round(Number(frames) || 1));
  const steps = [];
  for (let index = 1; index <= count; index += 1) {
    const progress = easeOutCubic(index / count);
    steps.push({
      x: Math.round(from.x + (to.x - from.x) * progress),
      y: Math.round(from.y + (to.y - from.y) * progress),
    });
  }
  steps[steps.length - 1] = { x: Math.round(to.x), y: Math.round(to.y) };
  return steps;
}

function createCompactGlide({
  setPosition,
  schedule = setTimeout,
  cancel = clearTimeout,
  durationMs = GLIDE_DURATION_MS,
  frameMs = GLIDE_FRAME_MS,
} = {}) {
  let timer = null;
  let finish = null;

  // A new drag, a mode change or a second release must not fight a flight in progress.
  // The pending completion still runs, so the window always ends up exactly placed.
  function stop() {
    if (timer !== null) cancel(timer);
    timer = null;
    const done = finish;
    finish = null;
    done?.();
  }

  function glide(from, to, onDone = () => {}) {
    stop();
    const distance = Math.hypot((to.x - from.x) || 0, (to.y - from.y) || 0);
    const frames = durationMs > 0 && distance >= 2 ? Math.max(1, Math.round(durationMs / frameMs)) : 1;
    const steps = glideSteps(from, to, frames);
    let index = 0;
    finish = onDone;
    const tick = () => {
      timer = null;
      const point = steps[index];
      index += 1;
      if (setPosition(point.x, point.y) === false) {
        finish = null;
        return;
      }
      if (index < steps.length) {
        timer = schedule(tick, frameMs);
        timer?.unref?.();
        return;
      }
      const done = finish;
      finish = null;
      done?.();
    };
    tick();
  }

  return {
    glide,
    stop,
    get active() { return timer !== null; },
  };
}

module.exports = { GLIDE_DURATION_MS, createCompactGlide, easeOutCubic, glideSteps };
