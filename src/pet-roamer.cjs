// The avatar as a desktop pet. It clings to its screen edge, climbs it, drops to the floor
// (the top of the taskbar), hops about, sits, looks around, naps, and climbs back home.
//
// The model is Shimeji's: when an action ends, the next one is a weighted random pick among
// the behaviours its surface allows, and falling, being dragged and being looked at outrank
// everything chosen. The numbers are Shimeji's and eSheep's, slowed down so that it rests far
// more than it moves (about one tenth of the time).
//
// Main only moves the window, and only while the pet travels (60 Hz). Every pose, squash and
// bubble is CSS in the renderer, which hears what the pet is doing through `send`. It never
// sets off while the renderer says the pointer is on it, a notification or the panel is open,
// an agent is working or waiting on the user, motion is reduced, or it is being dragged.
//
// Its territory is its own edge and the floor from that edge to a little past the middle of
// the screen: the side the panel opens toward is the side of its edge, and must not change
// under a walk.
const { COMPACT_VISUALS } = require("./window-geometry.cjs");
const { COMPACT_SIZES } = require("./compact-window.cjs");

const AVATAR_INSET = COMPACT_VISUALS.orb.margin + COMPACT_VISUALS.orb.size / 2; // 64: outer side to centre
const EDGE_MARGIN = 8; // compactMargin("orb"): where a docked avatar's window stops
const SPEED = { walk: 40, scoot: 110, climb: 22 }; // px/s
const GRAVITY = 1500; // px/s²
const MAX_FALL_SPEED = 900;
const HOP_LENGTH = 20; // one hop of the walk, two per second
const MAX_REACH = 600; // farthest along the floor from its own edge
const SLEEP_AFTER_MS = 90_000;
const HOME_AFTER_MS = 10 * 60_000;
const FRAME_MS = 16;
// Let go this close to a screen side, the pet takes hold of that side; anywhere else it
// drops where it was let go and lands on the taskbar.
const RELEASE_WALL_DISTANCE = 110;
// Thrown: the pointer's speed over its last ~100 ms of the drag becomes the pet's.
const THROW_SAMPLE_MS = 100;
const THROW_MIN_SPEED = 350;
const THROW_MAX_SPEED = 2600;
const AIR_DRAG = 0.35; // per second, sideways
const WALL_SPLAT_SPEED = 520; // slower than this it just takes hold of the wall
const WALL_REACH = 38; // a docked window's slime is this far from its edge (the wall pose closes it)

// [name, weight, minimum ms, maximum ms]; a travel's length comes from its distance.
const WALL_BEHAVIOURS = [
  ["cling", 100, 4000, 10000],
  ["climb", 40],
  ["drop", 50],
];
const FLOOR_BEHAVIOURS = [
  ["rest", 300, 6000, 15000],
  ["sit", 150, 15000, 40000],
  ["look", 100, 3000, 5000],
  ["walk", 150],
  ["scoot", 20],
  ["bighop", 15],
  ["climb-home", 30],
];

function pickWeighted(list, random = Math.random) {
  const total = list.reduce((sum, entry) => sum + entry[1], 0);
  let roll = random() * total;
  for (const entry of list) {
    roll -= entry[1];
    if (roll < 0) return entry;
  }
  return list[list.length - 1];
}

function between(min, max, random = Math.random) {
  return min + (max - min) * random();
}

// Window positions (top-left) for the pet's surfaces. A docked avatar's window stops 8 px
// inside its edge; the transparent margin above and below the circle may hang off the work
// area, which is what puts its feet on the taskbar.
function petGeometry(bounds, side, workArea) {
  const { width, height } = bounds;
  const insetY = Math.max(0, Math.round((height - COMPACT_VISUALS.orb.size) / 2));
  const wallX = side === "left" ? workArea.x + EDGE_MARGIN : workArea.x + workArea.width - width - EDGE_MARGIN;
  const reach = Math.max(0, Math.min(MAX_REACH, workArea.width / 2 - 40));
  return {
    width,
    height,
    wallX,
    floorY: workArea.y + workArea.height - height + insetY,
    ceilingY: workArea.y - insetY,
    minX: side === "left" ? wallX : wallX - reach,
    maxX: side === "left" ? wallX + reach : wallX,
    screenLeft: workArea.x,
    screenRight: workArea.x + workArea.width,
  };
}

// The screen x of the avatar's centre, which is what a free (walked-away) position is saved
// as, so the panel and notifications can widen the window around it.
function avatarCentreX(bounds, side) {
  return side === "left" ? bounds.x + AVATAR_INSET : bounds.x + bounds.width - AVATAR_INSET;
}

function createPetRoamer({
  getWindow,
  getWorkArea,
  getSide,
  isActive,
  place,
  onRest,
  send,
  random = Math.random,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  let enabled = true;
  let context = {};
  let surface = null; // "wall" | "floor" | "air"
  let pos = null; // window top-left, unrounded
  let home = null;
  let motion = null;
  let decisionTimer = null;
  let frameTimer = null;
  let lastStimulusAt = now();
  let awaySince = null;
  let asleep = false;
  let lastSent = "";
  let dragSamples = [];

  const liveWindow = () => { const window = getWindow(); return window && !window.isDestroyed() ? window : null; };
  const geometry = () => {
    const window = liveWindow();
    if (!window) return null;
    const bounds = window.getBounds();
    return petGeometry(bounds, getSide(), getWorkArea(bounds));
  };
  const held = () => !enabled || !isActive() || Boolean(context.dragging);
  // Only the bare avatar travels; a notification or the panel widens the window first.
  const collapsed = (g) => Math.abs(g.width - COMPACT_SIZES.orb.width) <= 3 && Math.abs(g.height - COMPACT_SIZES.orb.height) <= 3;
  const paused = () => held() || Boolean(context.hovered || context.statusOpen || context.busy || context.attention || context.reducedMotion);

  let pulse = 0;
  function emit(action, extra = {}) {
    // One-off moves carry a counter so that the same move twice in a row still plays twice.
    const payload = { surface, action, ...extra, ...(["land", "bighop", "wake"].includes(action) ? { pulse: ++pulse } : {}) };
    const signature = JSON.stringify(payload);
    if (signature === lastSent) return;
    lastSent = signature;
    send(payload);
  }

  function schedule(ms) {
    clearTimer(decisionTimer);
    decisionTimer = setTimer(decide, Math.max(0, Math.round(ms)));
  }

  function stopMotion() {
    clearTimer(frameTimer);
    frameTimer = null;
    motion = null;
  }

  function persist() {
    const g = geometry();
    if (!g || !pos) return;
    const bounds = { x: Math.round(pos.x), y: Math.round(pos.y), width: g.width, height: g.height };
    onRest({ ...bounds, free: Math.abs(bounds.x - g.wallX) > 2, ax: avatarCentreX(bounds, getSide()) });
  }

  function settle(action, ms) {
    stopMotion();
    emit(action);
    persist();
    schedule(ms);
  }

  // Where the pet is when it (re)starts: on the floor, on its edge, or in the air.
  function locate() {
    const window = liveWindow();
    const g = geometry();
    if (!window || !g) return false;
    const bounds = window.getBounds();
    pos = { x: bounds.x, y: bounds.y };
    surface = Math.abs(bounds.y - g.floorY) <= 2 ? "floor" : Math.abs(bounds.x - g.wallX) <= 2 ? "wall" : "air";
    if (!home) home = { x: g.wallX, y: surface === "wall" ? bounds.y : g.floorY };
    return true;
  }

  function startMotion(kind, fields, onArrive) {
    stopMotion();
    motion = { kind, last: now(), onArrive, ...fields };
    frameTimer = setTimer(frame, FRAME_MS);
  }

  function travel(kind, target, speed, action, onArrive) {
    const dir = Math.sign((target.x ?? pos.x) - pos.x) || Math.sign((target.y ?? pos.y) - pos.y) || 1;
    emit(action, { dir: kind === "climb" ? 0 : dir, speed });
    startMotion(kind, { target, speed }, onArrive);
  }

  // Ballistic flight: dropped (no speed) or thrown. It lands on the floor, takes hold of or
  // splats against its own wall, bounces off the ceiling and off the far side.
  function startFall(vx = 0, vy = 0) {
    surface = "air";
    emit("fall");
    startMotion("fall", { vx, vy }, (hit) => {
      const round = (value) => Math.round(value * 100) / 100;
      if (hit.wall) {
        surface = "wall";
        emit(hit.speed >= WALL_SPLAT_SPEED ? "splat-wall" : "cling", { impact: round(Math.min(1, hit.speed / 1800)) });
      } else {
        surface = "floor";
        // How high a plain drop would have to be to hit this hard: the renderer splats by it.
        emit("land", { impact: round(Math.min(1, hit.speed / MAX_FALL_SPEED)), drop: Math.round((hit.speed * hit.speed) / (2 * GRAVITY)) });
      }
      persist();
      schedule(between(4000, 8000, random));
    });
  }

  function frame() {
    frameTimer = null;
    if (!motion) return;
    const g = geometry();
    // A fall finishes even under the pointer; only a drag, the switch or a mode change stop it.
    if (!g || held() || !collapsed(g) || (motion.kind !== "fall" && paused())) {
      const wasFalling = motion?.kind === "fall";
      stopMotion();
      persist();
      if (!held()) emit(surface === "wall" ? "cling" : wasFalling ? "fall" : "rest");
      pos = null; // Read back from the window when it sets off again.
      return;
    }
    const at = now();
    const dt = Math.min(0.05, Math.max(0, (at - motion.last) / 1000));
    motion.last = at;
    let arrived = false;
    if (motion.kind === "fall") {
      const side = getSide();
      const toward = side === "left" ? -1 : 1;
      motion.vy = Math.min(THROW_MAX_SPEED, motion.vy + GRAVITY * dt);
      motion.vx *= Math.exp(-AIR_DRAG * dt);
      pos.x += motion.vx * dt;
      pos.y += motion.vy * dt;
      if (pos.y < g.ceilingY) { pos.y = g.ceilingY; motion.vy = Math.abs(motion.vy) * 0.3; }
      // The far side: the avatar stays on the screen and bounces off it.
      const centre = avatarCentreX({ x: pos.x, width: g.width }, side);
      const farEdge = side === "left" ? g.screenRight - 26 : g.screenLeft + 26;
      if ((side === "left" && centre > farEdge) || (side !== "left" && centre < farEdge)) {
        pos.x += farEdge - centre;
        motion.vx = -motion.vx * 0.4;
      }
      const wallContact = g.wallX + toward * WALL_REACH;
      if (toward * (pos.x - wallContact) >= 0) {
        motion.hit = { wall: true, speed: Math.abs(motion.vx) };
        pos.x = g.wallX;
        arrived = true;
      } else if (pos.y >= g.floorY) {
        motion.hit = { wall: false, speed: Math.abs(motion.vy) };
        pos.y = g.floorY;
        arrived = true;
      }
    } else {
      const step = motion.speed * dt;
      for (const axis of ["x", "y"]) {
        if (motion.target[axis] === undefined) continue;
        const remaining = motion.target[axis] - pos[axis];
        pos[axis] += Math.sign(remaining) * Math.min(Math.abs(remaining), step);
      }
      arrived = ["x", "y"].every((axis) => motion.target[axis] === undefined || Math.abs(motion.target[axis] - pos[axis]) < 0.5);
    }
    place(Math.round(pos.x), Math.round(pos.y));
    if (arrived) {
      const { onArrive, hit } = motion;
      stopMotion();
      onArrive?.(hit);
      return;
    }
    frameTimer = setTimer(frame, FRAME_MS);
  }

  // Walks along the floor to its edge and takes hold of it, then climbs to `y`.
  function goUpTheWall(g, y) {
    const climb = () => {
      surface = "wall";
      const targetY = Math.max(g.ceilingY + 20, Math.min(g.floorY, y));
      travel("climb", { y: targetY }, SPEED.climb, "climb", () => {
        if (Math.abs(targetY - home.y) < 4) awaySince = null;
        settle("cling", between(4000, 10000, random));
      });
    };
    if (Math.abs(pos.x - g.wallX) > 0.5) travel("walk", { x: g.wallX }, SPEED.walk, "walk", climb);
    else climb();
  }

  function decide() {
    decisionTimer = null;
    if (paused()) return;
    if (!pos && !locate()) return;
    const g = geometry();
    if (!g) return;
    if (!collapsed(g)) return schedule(2000);
    if (surface === "air") return startFall();
    const at = now();
    if (asleep) return schedule(60_000);
    if (at - lastStimulusAt > SLEEP_AFTER_MS) {
      asleep = true;
      return settle("sleep", 60_000);
    }
    const awayFromHome = surface === "floor" || Math.abs(pos.y - home.y) > 40;
    if (awayFromHome && awaySince === null) awaySince = at;
    if (!awayFromHome) awaySince = null;
    if (awaySince !== null && at - awaySince > HOME_AFTER_MS) return goUpTheWall(g, home.y);

    if (surface === "wall") {
      const [name, , min, max] = pickWeighted(WALL_BEHAVIOURS, random);
      if (name === "cling") return settle("cling", between(min, max, random));
      if (name === "drop") return startFall();
      const distance = between(60, 260, random);
      const up = random() < 0.5;
      let y = pos.y + (up ? -distance : distance);
      if (y < g.ceilingY + 20 || y > g.floorY) y = pos.y + (up ? distance : -distance);
      y = Math.max(g.ceilingY + 20, Math.min(g.floorY, y));
      return travel("climb", { y }, SPEED.climb, "climb", () => {
        // Climbing down to the floor sets it on its feet in the corner.
        if (pos.y >= g.floorY - 0.5) surface = "floor";
        settle(surface === "wall" ? "cling" : "rest", between(3000, 7000, random));
      });
    }

    const [name, , min, max] = pickWeighted(FLOOR_BEHAVIOURS, random);
    if (["rest", "sit", "look"].includes(name)) return settle(name, between(min, max, random));
    if (name === "bighop") {
      emit("bighop");
      return schedule(between(2500, 5000, random));
    }
    if (name === "climb-home") return goUpTheWall(g, between(g.ceilingY + 40, g.floorY - 80, random));
    const speed = name === "scoot" ? SPEED.scoot : SPEED.walk;
    const distance = name === "scoot" ? speed * between(1, 2, random) : HOP_LENGTH * Math.round(between(3, 10, random));
    let dir = random() < 0.5 ? -1 : 1;
    if (pos.x + dir * distance < g.minX || pos.x + dir * distance > g.maxX) dir = -dir;
    const x = Math.max(g.minX, Math.min(g.maxX, pos.x + dir * distance));
    if (Math.abs(x - pos.x) < HOP_LENGTH) return settle("rest", between(2000, 5000, random));
    return travel(name, { x }, speed, name, () => settle("rest", between(2000, 6000, random)));
  }

  function wake() {
    lastStimulusAt = now();
    if (!asleep) return false;
    asleep = false;
    emit("wake");
    return true;
  }

  return {
    // What the renderer knows: pointer on the pet, notification or panel open, an agent
    // working or waiting, reduced motion, a drag. `stimulus` is a one-off nudge (petting).
    setContext(next = {}) {
      const previous = context;
      context = { ...next };
      const roused = ["hovered", "statusOpen", "busy", "attention"].some((key) => context[key] && !previous[key]) || next.stimulus;
      if (roused && wake()) schedule(1200);
      if (paused()) {
        clearTimer(decisionTimer);
        decisionTimer = null;
        if (!motion && pos) pos = null; // Read back from the window when it sets off again.
        return;
      }
      if (!motion && !decisionTimer) schedule(between(1500, 4000, random));
    },
    // Before main resizes the window for a notification or the panel: stop where it is and
    // save that spot, so the resize keeps the avatar in place instead of restoring an old one.
    hold() {
      if (!motion && !pos) return;
      stopMotion();
      persist();
      pos = null;
    },
    // Where the pointer has been during a drag, for the speed of a throw.
    trackDrag(x, y) {
      const at = now();
      dragSamples = [...dragSamples.filter((sample) => at - sample.at <= THROW_SAMPLE_MS * 2), { x, y, at }].slice(-12);
    },
    // A drag was let go. Thrown, it flies toward the side it was thrown at; let go gently near
    // a side, the usual flight to that edge follows (null); anywhere else it drops where it
    // is. The window is put where the avatar stays exactly where the pointer left it.
    release(bounds, workArea, side) {
      if (!enabled) return null;
      const at = now();
      const recent = dragSamples.filter((sample) => at - sample.at <= THROW_SAMPLE_MS);
      dragSamples = [];
      const first = recent[0];
      const last = recent.at(-1);
      const span = first && last ? (last.at - first.at) / 1000 : 0;
      let vx = span > 0.01 ? (last.x - first.x) / span : 0;
      let vy = span > 0.01 ? (last.y - first.y) / span : 0;
      const speed = Math.hypot(vx, vy);
      if (speed > THROW_MAX_SPEED) { vx *= THROW_MAX_SPEED / speed; vy *= THROW_MAX_SPEED / speed; }
      const thrown = speed >= THROW_MIN_SPEED;
      const centre = avatarCentreX(bounds, side);
      const half = centre < workArea.x + workArea.width / 2 ? "left" : "right";
      const nextSide = thrown && Math.abs(vx) > 150 ? (vx < 0 ? "left" : "right") : half;
      const fromSide = nextSide === "left" ? centre - workArea.x : workArea.x + workArea.width - centre;
      if (!thrown && fromSide <= RELEASE_WALL_DISTANCE) return null;
      const g = petGeometry(bounds, nextSide, workArea);
      const x = nextSide === "left" ? centre - AVATAR_INSET : centre - (bounds.width - AVATAR_INSET);
      return { side: nextSide, x: Math.round(x), y: Math.round(Math.min(bounds.y, g.floorY)), vx: thrown ? Math.round(vx) : 0, vy: thrown ? Math.round(vy) : 0 };
    },
    // Falls, or flies, from where it was let go.
    fallFrom(drop) {
      stopMotion();
      clearTimer(decisionTimer);
      decisionTimer = null;
      pos = { x: drop.x, y: drop.y };
      awaySince = now();
      wake();
      startFall(drop.vx || 0, drop.vy || 0);
    },
    // A drag ended and the avatar flew to its edge: that is home now.
    landed(bounds) {
      stopMotion();
      pos = { x: bounds.x, y: bounds.y };
      surface = "wall";
      home = { x: bounds.x, y: bounds.y };
      awaySince = null;
      wake();
      emit("cling");
      if (!paused()) schedule(between(4000, 8000, random));
    },
    modeChanged(mode) {
      stopMotion();
      clearTimer(decisionTimer);
      decisionTimer = null;
      pos = null;
      lastSent = "";
      if (mode === "orb" && enabled) schedule(1500);
    },
    setEnabled(value) {
      enabled = value !== false;
      stopMotion();
      clearTimer(decisionTimer);
      decisionTimer = null;
      pos = null;
      lastSent = "";
      if (!enabled) send({ surface: null, action: "off" });
      else schedule(1500);
    },
    snapshot: () => ({ surface, pos: pos && { ...pos }, home: home && { ...home }, motion: motion?.kind || null, asleep, enabled }),
    dispose() {
      stopMotion();
      clearTimer(decisionTimer);
      decisionTimer = null;
    },
  };
}

module.exports = { FLOOR_BEHAVIOURS, WALL_BEHAVIOURS, avatarCentreX, createPetRoamer, petGeometry, pickWeighted };
