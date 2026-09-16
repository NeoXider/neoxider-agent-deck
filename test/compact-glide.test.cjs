const test = require("node:test");
const assert = require("node:assert/strict");

const { createCompactGlide, easeOutCubic, glideSteps } = require("../src/compact-glide.cjs");

function manualClock() {
  const queue = [];
  return {
    schedule: (callback) => { queue.push(callback); return queue.length; },
    cancel: () => { queue.length = 0; },
    runAll() { while (queue.length) queue.shift()(); },
    pending: () => queue.length,
  };
}

test("the easing starts fast and lands exactly", () => {
  assert.equal(easeOutCubic(0), 0);
  assert.equal(easeOutCubic(1), 1);
  assert.ok(easeOutCubic(0.5) > 0.5, "ease-out covers most of the distance early");
  assert.equal(easeOutCubic(-3), 0);
  assert.equal(easeOutCubic(7), 1);
});

test("glide steps move monotonically and end on the target", () => {
  const steps = glideSteps({ x: 900, y: 400 }, { x: 12, y: 380 }, 10);
  assert.equal(steps.length, 10);
  assert.deepEqual(steps.at(-1), { x: 12, y: 380 });
  for (let index = 1; index < steps.length; index += 1) {
    assert.ok(steps[index].x <= steps[index - 1].x, "never overshoots back");
  }
  assert.deepEqual(glideSteps({ x: 1, y: 1 }, { x: 5, y: 5 }, 0), [{ x: 5, y: 5 }]);
});

// The snap used to be one setBounds: a drop near the middle threw the avatar ~950 px in a
// single frame, which is what "it flies away" looked like.
test("a release glides across several frames instead of teleporting", () => {
  const clock = manualClock();
  const positions = [];
  let done = 0;
  const glide = createCompactGlide({ setPosition: (x, y) => { positions.push([x, y]); }, schedule: clock.schedule, cancel: clock.cancel, durationMs: 160, frameMs: 16 });
  glide.glide({ x: 900, y: 300 }, { x: 12, y: 300 }, () => { done += 1; });
  assert.equal(positions.length, 1, "the first frame moves at once");
  assert.equal(glide.active, true);
  clock.runAll();
  assert.equal(positions.length, 10);
  assert.deepEqual(positions.at(-1), [12, 300]);
  assert.equal(done, 1);
  assert.equal(glide.active, false);
});

test("a tiny correction does not bother animating", () => {
  const clock = manualClock();
  const positions = [];
  const glide = createCompactGlide({ setPosition: (x, y) => { positions.push([x, y]); }, schedule: clock.schedule, cancel: clock.cancel });
  glide.glide({ x: 12, y: 300 }, { x: 13, y: 300 });
  assert.deepEqual(positions, [[13, 300]]);
  assert.equal(clock.pending(), 0);
});

// A new drag or a mode change must not fight a flight in progress, and the flight's own
// completion still runs so the window always ends up exactly placed.
test("stopping a flight still completes its placement once", () => {
  const clock = manualClock();
  let done = 0;
  const glide = createCompactGlide({ setPosition: () => {}, schedule: clock.schedule, cancel: clock.cancel, durationMs: 160, frameMs: 16 });
  glide.glide({ x: 900, y: 300 }, { x: 12, y: 300 }, () => { done += 1; });
  glide.stop();
  assert.equal(done, 1);
  assert.equal(glide.active, false);
  assert.equal(clock.pending(), 0);
  glide.stop();
  assert.equal(done, 1, "a second stop has nothing left to finish");
});

test("a window that can no longer be moved ends the flight without completing it", () => {
  const clock = manualClock();
  let done = 0;
  let frames = 0;
  const glide = createCompactGlide({ setPosition: () => { frames += 1; return frames < 3; }, schedule: clock.schedule, cancel: clock.cancel, durationMs: 160, frameMs: 16 });
  glide.glide({ x: 900, y: 300 }, { x: 12, y: 300 }, () => { done += 1; });
  clock.runAll();
  assert.equal(frames, 3);
  assert.equal(done, 0);
  assert.equal(glide.active, false);
});
