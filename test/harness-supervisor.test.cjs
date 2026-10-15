const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CRASH_WINDOW_MS,
  MAX_CRASHES,
  RESTART_DELAYS_MS,
  createHarnessSupervisor,
  describeExit,
} = require("../src/harness-supervisor.cjs");

const settle = () => new Promise((resolve) => setImmediate(resolve));

// A clock and timer queue the test moves by hand.
function fakeTimers() {
  let clock = 0;
  const pending = [];
  const timers = {
    pending,
    now: () => clock,
    setTimer(callback, ms) {
      const timer = { callback, ms, at: clock + ms };
      pending.push(timer);
      return timer;
    },
    clearTimer(timer) {
      const index = pending.indexOf(timer);
      if (index >= 0) pending.splice(index, 1);
    },
    async advance(ms) {
      clock += ms;
      for (const timer of pending.filter((entry) => entry.at <= clock)) {
        pending.splice(pending.indexOf(timer), 1);
        timer.callback();
      }
      await settle();
      await settle();
    },
  };
  return timers;
}

// Results are consumed one per start()/restart() call; an Error is thrown, a function is
// called first (to let a test print into the log), anything else is returned.
function fakeLauncher(results = []) {
  const listeners = new Set();
  const calls = [];
  async function next(kind) {
    calls.push(kind);
    let result = results.shift();
    if (typeof result === "function") result = result();
    if (result instanceof Error) throw result;
    return result || { ok: true, started: true };
  }
  return {
    calls,
    listenerCount: () => listeners.size,
    onExit(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    crash(event = {}) {
      for (const listener of listeners) listener({ code: 1, signal: null, ready: true, probe: false, requested: false, unexpected: true, ...event });
    },
    start: () => next("start"),
    restart: () => next("restart"),
  };
}

function fakeLog() {
  const lines = [];
  const notes = [];
  return {
    lines,
    notes,
    print: (...more) => lines.push(...more),
    note(message, { keep = true } = {}) {
      notes.push(message);
      if (keep) lines.push(`[deck] ${message}`);
    },
    recentLines: (count) => lines.slice(-count),
    mark: () => lines.length,
    linesSince: (mark) => lines.slice(mark),
    ensureLogFile: () => "/user-data/logs/harness.log",
  };
}

function supervise({ launcher = fakeLauncher(), log = fakeLog(), timers = fakeTimers(), ...options } = {}) {
  const states = [];
  const recovered = [];
  const supervisor = createHarnessSupervisor({
    launcher,
    outputLog: log,
    probeReady: async () => false,
    now: timers.now,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    onState: (value) => states.push(value),
    onRecovered: (result) => recovered.push(result),
    ...options,
  });
  return { supervisor, launcher, log, timers, states, recovered };
}

test("a crashed owned Harness is restarted after a second, with the crash recorded", async () => {
  const { supervisor, launcher, log, timers, states, recovered } = supervise();
  log.print("loading session 7f3a", "dsh: fatal uncaught exception: RangeError: Invalid string length");
  launcher.crash({ code: 3221226505 });

  const scheduled = supervisor.getState();
  assert.equal(scheduled.status, "scheduled");
  assert.equal(scheduled.exitCode, 3221226505);
  assert.equal(scheduled.exitText, "exit code 0xC0000409");
  assert.equal(scheduled.restartAt, 1000);
  assert.equal(scheduled.crashCount, 1);
  assert.deepEqual(scheduled.tail.slice(-1), ["dsh: fatal uncaught exception: RangeError: Invalid string length"]);
  assert.match(log.notes[0], /^=== Harness stopped unexpectedly \(exit code 0xC0000409\); its last 2 lines follow ===$/);
  assert.ok(log.notes.includes("| dsh: fatal uncaught exception: RangeError: Invalid string length"));
  assert.equal(log.lines.filter((line) => line.startsWith("[deck] |")).length, 0, "the copied lines do not crowd the tail");

  await timers.advance(999);
  assert.deepEqual(launcher.calls, []);
  await timers.advance(1);
  assert.deepEqual(launcher.calls, ["start"], "nothing on the port, so a plain non-destructive start");
  assert.equal(supervisor.getState().status, "idle");
  assert.deepEqual(recovered, [{ ok: true, started: true }]);
  assert.deepEqual(states.map((state) => state.status), ["scheduled", "restarting", "idle"]);
});

test("restarts back off 1, 3, 10, 30 seconds and stop at the fifth failure in ten minutes", async () => {
  const failure = () => new Error("Harness launcher exited before becoming ready (code 1)");
  const launcher = fakeLauncher([failure(), failure(), failure(), failure()]);
  const { supervisor, timers, recovered } = supervise({ launcher });
  launcher.crash();
  const delays = [];
  while (timers.pending.length) {
    delays.push(timers.pending[0].ms);
    await timers.advance(timers.pending[0].ms);
  }
  assert.deepEqual(delays, [...RESTART_DELAYS_MS]);
  assert.deepEqual(RESTART_DELAYS_MS, [1000, 3000, 10000, 30000]);
  assert.equal(launcher.calls.length, 4);
  const state = supervisor.getState();
  assert.equal(state.status, "gave-up");
  assert.equal(state.crashCount, MAX_CRASHES);
  assert.equal(state.lastError, "Harness launcher exited before becoming ready (code 1)");
  assert.deepEqual(recovered, []);
});

test("crashes further apart than the window do not add up to a give-up", async () => {
  const { supervisor, launcher, timers } = supervise();
  for (let round = 0; round < MAX_CRASHES + 2; round += 1) {
    launcher.crash();
    assert.equal(supervisor.getState().restartAt - timers.now(), 1000, `crash ${round + 1} starts the backoff over`);
    await timers.advance(1000);
    assert.equal(supervisor.getState().status, "idle");
    await timers.advance(CRASH_WINDOW_MS);
  }
  assert.equal(launcher.calls.length, MAX_CRASHES + 2);
});

test("nothing is restarted while the app quits or after dispose", async () => {
  let quitting = true;
  const { supervisor, launcher, timers } = supervise({ isQuitting: () => quitting });
  launcher.crash();
  assert.equal(supervisor.getState().status, "idle");
  assert.equal(timers.pending.length, 0);

  // A quit that begins during the wait cancels the restart it was waiting for.
  quitting = false;
  launcher.crash();
  assert.equal(timers.pending.length, 1);
  quitting = true;
  await timers.advance(1000);
  assert.deepEqual(launcher.calls, []);

  quitting = false;
  launcher.crash();
  supervisor.dispose();
  assert.equal(timers.pending.length, 0, "dispose clears a scheduled restart");
  assert.equal(launcher.listenerCount(), 0);
  assert.deepEqual(await supervisor.restartNow(), { ok: false, started: false, reason: "disposed" });
  assert.deepEqual(launcher.calls, []);
});

test("an exit the widget asked for, a token probe or a Harness it does not own is left alone", async () => {
  const { supervisor, launcher, timers, states } = supervise();
  launcher.crash({ unexpected: false, requested: true });
  launcher.crash({ unexpected: false, probe: true, ready: true });
  launcher.crash({ unexpected: false, ready: false });
  assert.equal(timers.pending.length, 0);
  assert.deepEqual(states, []);
  assert.equal(supervisor.getState().status, "idle");
});

test("a Harness answering on the port is adopted through Start and never killed", async () => {
  const launcher = fakeLauncher([{ ok: false, started: false, reason: "token-required" }]);
  const { supervisor, timers } = supervise({ launcher, probeReady: async () => true });
  launcher.crash();
  await timers.advance(1000);
  assert.deepEqual(launcher.calls, ["start"]);
  assert.equal(supervisor.getState().status, "idle", "another Harness took the port; it is not ours to restart");
  assert.equal(timers.pending.length, 0);
  // Even an explicit Restart now goes through Start while something answers.
  await supervisor.restartNow();
  assert.deepEqual(launcher.calls, ["start", "start"]);
});

test("a port still held by the dead instance is cleared on the next attempt", async () => {
  const launcher = fakeLauncher();
  const log = fakeLog();
  launcher.start = async () => {
    launcher.calls.push("start");
    log.print("listen EADDRINUSE: address already in use 127.0.0.1:3080");
    throw new Error("Harness launcher exited before becoming ready (code 1)");
  };
  const { supervisor, timers } = supervise({ launcher, log });
  launcher.crash();
  await timers.advance(1000);
  assert.equal(supervisor.getState().status, "scheduled");
  assert.match(log.notes.join("\n"), /the port is still held/);
  await timers.advance(3000);
  assert.deepEqual(launcher.calls, ["start", "restart"]);
  assert.equal(supervisor.getState().status, "idle");
});

test("EADDRINUSE printed before the attempt does not count against it", async () => {
  const launcher = fakeLauncher([new Error("did not become ready before the startup timeout")]);
  const log = fakeLog();
  log.print("listen EADDRINUSE: address already in use 127.0.0.1:3080");
  const { timers } = supervise({ launcher, log });
  launcher.crash();
  await timers.advance(1000);
  await timers.advance(3000);
  assert.deepEqual(launcher.calls, ["start", "start"]);
});

test("Restart now skips the wait, and after a give-up restores the whole budget", async () => {
  const failure = () => new Error("boom");
  const launcher = fakeLauncher([failure(), failure(), failure(), failure()]);
  const { supervisor, timers } = supervise({ launcher });
  launcher.crash();
  while (timers.pending.length) await timers.advance(timers.pending[0].ms);
  assert.equal(supervisor.getState().status, "gave-up");

  assert.deepEqual(await supervisor.restartNow(), { ok: true, started: true });
  assert.equal(launcher.calls.at(-1), "restart", "the user's Restart may clear a dead port holder");
  assert.equal(supervisor.getState().status, "idle");
  launcher.crash();
  assert.equal(supervisor.getState().restartAt - timers.now(), 1000);
  assert.equal(supervisor.getState().crashCount, 1);

  // While a restart is scheduled, Restart now runs it at once and only once.
  const [first, second] = await Promise.all([supervisor.restartNow(), supervisor.restartNow()]);
  assert.equal(first, second);
  assert.equal(timers.pending.length, 0);
});

test("a launcher that can never start a Harness here gives up at once", async () => {
  const launcher = fakeLauncher([{ ok: false, started: false, reason: "remote-url" }]);
  const { supervisor, timers } = supervise({ launcher });
  launcher.crash();
  await timers.advance(1000);
  assert.equal(supervisor.getState().status, "gave-up");
  assert.equal(supervisor.getState().lastError, "remote-url");
  assert.equal(timers.pending.length, 0);
});

test("a Harness started by hand after a give-up gets a fresh budget when it crashes", async () => {
  const failure = () => new Error("boom");
  const launcher = fakeLauncher([failure(), failure(), failure(), failure()]);
  const { supervisor, timers } = supervise({ launcher });
  launcher.crash();
  while (timers.pending.length) await timers.advance(timers.pending[0].ms);
  assert.equal(supervisor.getState().status, "gave-up");
  // Only a launch that became ready reports an unexpected exit, so this one ran.
  launcher.crash({ code: 3 });
  assert.equal(supervisor.getState().status, "scheduled");
  assert.equal(supervisor.getState().crashCount, 1);
});

test("a crash that lands while a restart is still finishing keeps its own schedule", async () => {
  const launcher = fakeLauncher();
  let finish;
  launcher.start = () => { launcher.calls.push("start"); return new Promise((resolve) => { finish = resolve; }); };
  const { supervisor, timers } = supervise({ launcher });
  launcher.crash();
  await timers.advance(1000);
  assert.equal(supervisor.getState().status, "restarting");
  launcher.crash({ code: 5 });
  finish({ ok: true, started: true });
  await settle();
  assert.equal(supervisor.getState().status, "scheduled", "the new crash is not papered over by the older success");
  assert.equal(supervisor.getState().exitCode, 5);
  assert.equal(timers.pending.length, 1);
});

test("Open log hands the shell only the output log's own file", async () => {
  const opened = [];
  const { supervisor } = supervise({ openPath: async (filePath) => { opened.push(filePath); return ""; } });
  assert.deepEqual(await supervisor.openLog(), { ok: true });
  assert.deepEqual(opened, ["/user-data/logs/harness.log"]);
  assert.equal(supervisor.openLog.length, 0, "the renderer cannot name a file");

  const failing = supervise({ openPath: async () => "No application is associated with this file" });
  assert.deepEqual(await failing.supervisor.openLog(), { ok: false, error: "No application is associated with this file" });
  const missing = supervise({ log: { ...fakeLog(), ensureLogFile: () => "" }, openPath: async () => "" });
  assert.equal((await missing.supervisor.openLog()).ok, false);
});

test("exit descriptions read native crash codes in hex", () => {
  assert.equal(describeExit({ code: 1 }), "exit code 1");
  assert.equal(describeExit({ code: -1073741819 }), "exit code 0xC0000005");
  assert.equal(describeExit({ code: 3221225725 }), "exit code 0xC00000FD");
  assert.equal(describeExit({ code: null, signal: "SIGKILL" }), "signal SIGKILL");
  assert.equal(describeExit({}), "no exit code");
});
