const test = require("node:test");
const assert = require("node:assert/strict");
const { createRendererRecoveryController } = require("../src/renderer-recovery.cjs");

function createFakeClock() {
  let now = 0;
  let nextId = 1;
  const tasks = new Map();
  return {
    clearTimer(id) { tasks.delete(id); },
    pending: () => tasks.size,
    setTimer(callback, delay) {
      const id = nextId;
      nextId += 1;
      tasks.set(id, { at: now + Math.max(0, Number(delay) || 0), callback });
      return id;
    },
    tick(duration) {
      const end = now + duration;
      while (true) {
        const due = [...tasks.entries()]
          .filter(([, task]) => task.at <= end)
          .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0];
        if (!due) break;
        const [id, task] = due;
        tasks.delete(id);
        now = task.at;
        task.callback();
      }
      now = end;
    },
  };
}

function fixture({ throwOnReload = false, throwOnSend = false } = {}) {
  const clock = createFakeClock();
  const sent = [];
  let reloads = 0;
  let quitting = false;
  let loading = false;
  let destroyed = false;
  const webContents = {
    isDestroyed: () => destroyed,
    isLoading: () => loading,
    reload: () => {
      reloads += 1;
      if (throwOnReload) throw new Error("reload unavailable");
      loading = true;
    },
    send: (channel, value) => {
      if (throwOnSend) throw new Error("renderer disappeared");
      sent.push([channel, value]);
    },
  };
  const window = { isDestroyed: () => false, webContents };
  const quitReasons = [];
  const controller = createRendererRecoveryController({
    getWindow: () => window,
    isQuitting: () => quitting,
    requestQuit: (reason) => { quitReasons.push(reason); quitting = true; },
    maxRecoveries: 3,
    recoveryWatchdogMs: 50,
    stabilityWindowMs: 100,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onError: () => {},
  });
  return {
    controller,
    clock,
    quitReasons,
    sent,
    reloads: () => reloads,
    setDestroyed: (value) => { destroyed = value; },
    setLoading: (value) => { loading = value; },
    setQuitting: (value) => { quitting = value; },
  };
}

test("four crashes separated by stable windows each recover", () => {
  const state = fixture();
  for (let index = 0; index < 4; index += 1) {
    assert.equal(state.controller.failed("crashed"), true);
    assert.equal(state.controller.failureCount(), 1);
    state.setLoading(false);
    assert.equal(state.controller.loaded(), true);
    assert.equal(state.controller.failureCount(), 1);
    state.clock.tick(99);
    assert.equal(state.controller.failureCount(), 1);
    state.clock.tick(1);
    assert.equal(state.controller.failureCount(), 0);
  }
  assert.equal(state.reloads(), 4);
  assert.deepEqual(state.quitReasons, []);
});

test("renderer events are dropped safely during reload and resume only after load", () => {
  const state = fixture();
  assert.equal(state.controller.send("live-event", { seq: 1 }), true);
  state.setLoading(true);
  assert.equal(state.controller.send("live-event", { seq: 2 }), false);
  state.setLoading(false);
  state.controller.failed("crashed");
  assert.equal(state.controller.send("live-event", { seq: 3 }), false);
  assert.equal(state.sent.length, 1);
  state.setLoading(false);
  state.controller.loaded();
  assert.equal(state.controller.send("live-event", { seq: 4 }), true);
  state.setDestroyed(true);
  assert.equal(state.controller.send("queue-update", []), false);
  assert.deepEqual(state.sent.map((entry) => entry[1].seq), [1, 4]);

  const throwing = fixture({ throwOnSend: true });
  assert.equal(throwing.controller.send("update-state", {}), false);
});

test("three consecutive recovery attempts are allowed and the fourth quits", () => {
  const state = fixture();
  for (let index = 0; index < 3; index += 1) assert.equal(state.controller.failed("crashed"), true);
  assert.equal(state.controller.failureCount(), 3);
  assert.equal(state.reloads(), 3);
  assert.equal(state.controller.failed("crashed"), false);
  assert.equal(state.reloads(), 3);
  assert.deepEqual(state.quitReasons, ["renderer-recovery-limit"]);
});

test("load followed by an immediate crash does not reset the recovery budget", () => {
  const state = fixture();
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    assert.equal(state.controller.failed("crashed"), true);
    state.setLoading(false);
    state.controller.loaded();
    assert.equal(state.controller.failureCount(), attempt);
  }
  assert.equal(state.controller.failed("crashed"), false);
  assert.equal(state.reloads(), 3);
  assert.deepEqual(state.quitReasons, ["renderer-recovery-limit"]);
});

test("unresponsive recovery is retried by a bounded watchdog", () => {
  const state = fixture();
  assert.equal(state.controller.failed("crashed"), true);
  assert.equal(state.controller.failed("unresponsive", true), false);
  state.clock.tick(49);
  assert.equal(state.reloads(), 1);
  state.clock.tick(1);
  assert.equal(state.reloads(), 2);
  state.clock.tick(50);
  assert.equal(state.reloads(), 3);
  state.clock.tick(50);
  assert.deepEqual(state.quitReasons, ["renderer-recovery-limit"]);
  assert.equal(state.clock.pending(), 0);
});

test("successful load, disposal, and quitting cancel recovery timers", () => {
  const loaded = fixture();
  loaded.controller.failed("crashed");
  loaded.setLoading(false);
  loaded.controller.loaded();
  assert.equal(loaded.clock.pending(), 1);
  loaded.clock.tick(50);
  assert.equal(loaded.reloads(), 1);
  loaded.controller.dispose();
  assert.equal(loaded.clock.pending(), 0);

  const quitting = fixture();
  quitting.controller.failed("crashed");
  assert.equal(quitting.clock.pending(), 1);
  quitting.setQuitting(true);
  assert.equal(quitting.controller.failed("unresponsive", true), false);
  assert.equal(quitting.clock.pending(), 0);
  quitting.clock.tick(100);
  assert.equal(quitting.reloads(), 1);
});

test("a throwing reload is bounded without recursive recovery", () => {
  const state = fixture({ throwOnReload: true });
  assert.equal(state.controller.failed("crashed"), false);
  assert.equal(state.reloads(), 3);
  assert.deepEqual(state.quitReasons, ["renderer-recovery-limit"]);
});

test("quitting suppresses renderer recovery", () => {
  const state = fixture();
  state.setQuitting(true);
  assert.equal(state.controller.failed("crashed"), false);
  assert.equal(state.reloads(), 0);
  assert.deepEqual(state.quitReasons, []);
});
