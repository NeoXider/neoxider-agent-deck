const test = require("node:test");
const assert = require("node:assert/strict");
const { FLOOR_BEHAVIOURS, WALL_BEHAVIOURS, avatarCentreX, createPetRoamer, petGeometry, pickWeighted } = require("../src/pet-roamer.cjs");
const { restoreCompactBounds, captureModeBounds } = require("../src/window-state.cjs");

const workArea = { x: 0, y: 0, width: 1920, height: 1032 };
const ORB = { width: 172, height: 128 };

// A fake clock, timers and window: frames advance when the test says so.
function harness({ bounds = { x: 1920 - 172 - 8, y: 400, ...ORB }, side = "right", rolls = [] } = {}) {
  let clock = 0;
  let timers = [];
  let id = 0;
  const window = { bounds: { ...bounds }, isDestroyed: () => false, getBounds() { return { ...this.bounds }; } };
  const sent = [];
  const rests = [];
  let roll = 0;
  const roamer = createPetRoamer({
    getWindow: () => window,
    getWorkArea: () => workArea,
    getSide: () => side,
    isActive: () => true,
    place: (x, y) => { window.bounds.x = x; window.bounds.y = y; },
    onRest: (value) => rests.push(value),
    send: (value) => sent.push(value),
    random: () => (roll < rolls.length ? rolls[roll++] : 0.5),
    now: () => clock,
    setTimer: (fn, ms) => { const timer = { id: ++id, at: clock + ms, fn }; timers.push(timer); return timer.id; },
    clearTimer: (timerId) => { timers = timers.filter((timer) => timer.id !== timerId); },
  });
  // Runs every timer due within `ms`, in order, moving the clock as it goes.
  function advance(ms) {
    const end = clock + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > end) break;
      timers.shift();
      clock = next.at;
      next.fn();
    }
    clock = end;
  }
  return { roamer, window, sent, rests, advance, actions: () => sent.map((entry) => entry.action) };
}

test("behaviours are picked by weight, and resting outweighs moving", () => {
  assert.equal(pickWeighted([["a", 1], ["b", 3]], () => 0.1)[0], "a");
  assert.equal(pickWeighted([["a", 1], ["b", 3]], () => 0.9)[0], "b");
  const weight = (list, names) => list.filter(([name]) => names.includes(name)).reduce((sum, entry) => sum + entry[1], 0);
  assert.ok(weight(FLOOR_BEHAVIOURS, ["rest", "sit", "look"]) > 2 * weight(FLOOR_BEHAVIOURS, ["walk", "scoot", "bighop", "climb-home"]));
  assert.ok(weight(WALL_BEHAVIOURS, ["cling"]) >= weight(WALL_BEHAVIOURS, ["climb"]));
});

test("the floor is the top of the taskbar and the territory is its own half of the screen", () => {
  const right = petGeometry(ORB, "right", workArea);
  assert.equal(right.wallX, 1920 - 172 - 8, "docked like any avatar");
  assert.equal(right.floorY, 1032 - 128 + 30, "the transparent margin under the circle hangs over the taskbar");
  assert.equal(right.maxX, right.wallX);
  assert.ok(right.minX >= right.wallX - 600, "no farther than 600 px from its edge");
  assert.ok(avatarCentreX({ x: right.minX, width: 172 }, "right") >= workArea.width / 2, "never past the middle, so its side never changes");
  const left = petGeometry(ORB, "left", workArea);
  assert.equal(left.wallX, 8);
  assert.ok(avatarCentreX({ x: left.maxX, width: 172 }, "left") <= workArea.width / 2);
});

test("a pet on its edge drops to the floor under gravity and lands squashed", () => {
  // rolls: the first pause, then the pick: cling 100, climb 40, drop 50, so 0.9 is a drop.
  const h = harness({ rolls: [0.5, 0.9] });
  h.roamer.setContext({});
  h.advance(4000);
  assert.ok(h.actions().includes("fall"), h.actions().join());
  h.advance(3000);
  const land = h.sent.find((entry) => entry.action === "land");
  assert.ok(land, "it lands");
  assert.equal(land.surface, "floor");
  assert.ok(land.impact > 0.5, "a fall of ~500 px hits hard");
  assert.equal(h.window.bounds.y, petGeometry(ORB, "right", workArea).floorY);
  assert.equal(h.rests.at(-1).free, false, "it is still at its own edge's x");
});

test("walking away saves a free spot by the avatar's centre, and a notification keeps it there", () => {
  const g = petGeometry(ORB, "right", workArea);
  // rolls: the first pause, "walk" (550..700 of 765), seven hops, leftward.
  const h = harness({ bounds: { x: g.wallX, y: g.floorY, ...ORB }, rolls: [0.5, 0.8, 0.5, 0.0] });
  h.roamer.setContext({});
  h.advance(10_000);
  const rest = h.rests.at(-1);
  assert.ok(rest.free, "it walked away from its edge");
  assert.ok(h.window.bounds.x < g.wallX && h.window.bounds.x >= g.minX);
  assert.equal(rest.ax, avatarCentreX(h.window.bounds, "right"));
  // The saved spot survives a round trip and a status widening keeps the circle in place.
  const saved = captureModeBounds({}, "orb", rest, "right").orb;
  const widened = restoreCompactBounds(saved, null, workArea, { mode: "orb", width: 340, height: 128, side: "right" });
  assert.equal(avatarCentreX(widened, "right"), rest.ax);
  assert.equal(widened.y, rest.y);
  // An edge-docked spot still docks.
  const docked = restoreCompactBounds({ x: 3, y: 400, side: "right" }, null, workArea, { mode: "orb", width: 172, height: 128, side: "right" });
  assert.equal(docked.x, g.wallX);
});

test("it holds still while looked at, busy, or showing a notification, and wakes when touched", () => {
  const h = harness({ rolls: [0.5, 0.9] });
  h.roamer.setContext({ hovered: true });
  h.advance(60_000);
  assert.deepEqual(h.actions(), [], "nothing chosen while the pointer is on it");
  h.roamer.setContext({ busy: true });
  h.advance(60_000);
  assert.deepEqual(h.actions(), [], "nor while an agent works");
  h.roamer.setContext({});
  h.advance(5000);
  assert.ok(h.actions().length > 0, "free again, it carries on");
});

test("left alone it falls asleep, and the pointer wakes it", () => {
  const h = harness({ rolls: Array(40).fill(0.05) }); // always "cling"
  h.roamer.setContext({});
  h.advance(120_000);
  assert.ok(h.actions().includes("sleep"));
  const asleepAt = h.sent.length;
  h.advance(120_000);
  assert.equal(h.sent.length, asleepAt, "a sleeping pet does nothing");
  h.roamer.setContext({ hovered: true });
  assert.equal(h.sent.at(-1).action, "wake");
});

test("a drag that lands on an edge makes that spot home, and switching it off stops everything", () => {
  const h = harness();
  h.roamer.landed({ x: 8, y: 200, ...ORB });
  assert.equal(h.roamer.snapshot().surface, "wall");
  assert.deepEqual(h.roamer.snapshot().home, { x: 8, y: 200 });
  h.roamer.setEnabled(false);
  assert.equal(h.sent.at(-1).action, "off");
  h.advance(120_000);
  assert.equal(h.sent.at(-1).action, "off", "nothing more once it is off");
});

test("before a notification widens the window it stops and saves where it is", () => {
  const g = petGeometry(ORB, "right", workArea);
  const h = harness({ bounds: { x: g.wallX, y: g.floorY, ...ORB }, rolls: [0.5, 0.8, 1, 0.5] });
  h.roamer.setContext({});
  h.advance(4000);
  assert.equal(h.roamer.snapshot().motion, "walk");
  h.advance(500);
  h.roamer.hold();
  assert.equal(h.roamer.snapshot().motion, null);
  assert.equal(h.rests.at(-1).x, h.window.bounds.x, "saved exactly where it stopped");
});

test("let go near a side it takes that edge; let go in the open it falls to the taskbar right there", () => {
  const h = harness();
  const nearRight = { x: 1920 - 172 - 30, y: 300, ...ORB };
  assert.equal(h.roamer.release(nearRight, workArea, "right"), null, "the usual flight to the edge");
  const middleLeft = { x: 500, y: 300, ...ORB };
  const drop = h.roamer.release(middleLeft, workArea, "right");
  assert.equal(drop.side, "left", "the panel opens toward the room from the left half");
  assert.equal(avatarCentreX({ ...middleLeft, x: drop.x }, "left"), avatarCentreX(middleLeft, "right"), "the avatar stays exactly where it was let go");
  h.window.bounds.x = drop.x;
  h.roamer.fallFrom(drop);
  h.advance(3000);
  const land = h.sent.find((entry) => entry.action === "land");
  assert.ok(land && land.surface === "floor");
  assert.equal(h.window.bounds.y, petGeometry(ORB, "left", workArea).floorY);
  assert.equal(h.rests.at(-1).free, true, "saved as a free spot on the floor");
});

test("thrown hard at its wall it splats against it; thrown softly it takes hold; a short drop barely lands", () => {
  const throwAt = (speed) => {
    const h = harness();
    const start = { x: 900, y: 300, ...ORB };
    h.window.bounds = { ...start };
    // The pointer sped toward the right over the last 80 ms of the drag.
    for (let step = 0; step <= 4; step += 1) {
      h.roamer.trackDrag(1000 + step * speed * 0.02, 350);
      h.advance(20);
    }
    const drop = h.roamer.release(start, workArea, "left");
    assert.equal(drop.side, "right", "thrown right, its wall is the right one");
    assert.ok(drop.vx > 0);
    h.window.bounds.x = drop.x;
    h.roamer.fallFrom(drop);
    h.advance(4000);
    return h;
  };
  const hard = throwAt(2400);
  assert.ok(hard.sent.some((entry) => entry.action === "splat-wall" && entry.surface === "wall"), hard.actions().join());
  assert.equal(hard.window.bounds.x, petGeometry(ORB, "right", workArea).wallX, "it ends on its wall");
  const soft = throwAt(600);
  assert.ok(!soft.sent.some((entry) => entry.action === "splat-wall"));
  assert.ok(soft.sent.some((entry) => ["cling", "land"].includes(entry.action)), soft.actions().join());

  const low = harness();
  const g = petGeometry(ORB, "right", workArea);
  const near = { x: 600, y: g.floorY - 40, ...ORB };
  low.window.bounds = { ...near };
  const drop = low.roamer.release(near, workArea, "right");
  low.window.bounds.x = drop.x;
  low.roamer.fallFrom(drop);
  low.advance(2000);
  const land = low.sent.find((entry) => entry.action === "land");
  assert.ok(land.drop < 120, `a 40 px drop lands softly (drop ${land.drop})`);
});
