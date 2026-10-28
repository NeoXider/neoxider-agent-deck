const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_INTERVAL_MS,
  DEFAULT_TICK_MS,
  createUpdateOrchestrator,
} = require("../src/update-orchestrator.cjs");

function scheduler() {
  const timers = [];
  return {
    timers,
    setTimer(callback, delay) {
      const timer = { callback, delay, cleared: false, unreferenced: false };
      timer.unref = () => { timer.unreferenced = true; };
      timers.push(timer);
      return timer;
    },
    clearTimer(timer) { timer.cleared = true; },
  };
}

test("manual and scheduled checks share check plus staging without parallel work", async () => {
  const clock = scheduler();
  let releaseCheck;
  let checks = 0;
  let downloads = 0;
  const service = {
    check() {
      checks += 1;
      return new Promise((resolve) => { releaseCheck = resolve; });
    },
    async download() {
      downloads += 1;
      return { status: "ready", installMode: "portable-replace" };
    },
  };
  const orchestrator = createUpdateOrchestrator({
    getService: () => service,
    initialDelayMs: 10,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });

  orchestrator.start();
  assert.equal(clock.timers[0].delay, 10);
  assert.equal(clock.timers[0].unreferenced, true);
  const first = orchestrator.checkAndStage();
  const second = orchestrator.checkAndStage();
  assert.strictEqual(first, second);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(checks, 1);
  releaseCheck({ status: "available", installMode: "portable-replace" });
  assert.deepEqual(await first, { status: "ready", installMode: "portable-replace" });
  assert.equal(downloads, 1);
});

test("the wall clock decides when to look again, so a machine that slept checks on its first tick", async () => {
  const clock = scheduler();
  let wall = 1_000_000;
  let checks = 0;
  const orchestrator = createUpdateOrchestrator({
    getService: () => ({ async check() { checks += 1; return { status: "current", installMode: "none" }; } }),
    initialDelayMs: 5,
    intervalMs: DEFAULT_INTERVAL_MS,
    tickMs: DEFAULT_TICK_MS,
    now: () => wall,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  const fire = async () => { clock.timers.at(-1).callback(); await new Promise((resolve) => setImmediate(resolve)); };
  orchestrator.start();
  await fire();
  assert.equal(checks, 1, "the first tick after start checks");
  assert.equal(clock.timers.at(-1).delay, DEFAULT_TICK_MS);
  assert.equal(clock.timers.at(-1).unreferenced, true);
  wall += DEFAULT_TICK_MS;
  await fire();
  assert.equal(checks, 1, "a tick inside the interval does not");
  // A night asleep: no tick ran, but the wall clock moved on.
  wall += 9 * 60 * 60_000;
  await fire();
  assert.equal(checks, 2, "the first tick after waking checks");
  orchestrator.stop();
  assert.equal(clock.timers.at(-1).cleared, true);
});

test("a check that never settles is let go instead of holding every later one back", async () => {
  const clock = scheduler();
  let wall = 0;
  let checks = 0;
  const orchestrator = createUpdateOrchestrator({
    getService: () => ({ check() { checks += 1; return checks === 1 ? new Promise(() => {}) : Promise.resolve({ status: "current", installMode: "none" }); } }),
    initialDelayMs: 0,
    intervalMs: 1000,
    tickMs: 100,
    stuckMs: 5000,
    now: () => wall,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  const fire = async () => { clock.timers.at(-1).callback(); await new Promise((resolve) => setImmediate(resolve)); };
  orchestrator.start();
  await fire();
  assert.equal(checks, 1);
  wall += 2000;
  await fire();
  assert.equal(checks, 1, "still waiting on the first one");
  wall += 5000;
  await fire();
  assert.equal(checks, 2, "the hung check was abandoned and a new one started");
});

test("a manual retry after an offline check stages the newly available update", async () => {
  let checks = 0;
  let downloads = 0;
  const orchestrator = createUpdateOrchestrator({
    getService: () => ({
      async check() {
        checks += 1;
        return checks === 1
          ? { status: "error", installMode: "manual" }
          : { status: "available", installMode: "managed" };
      },
      async download() {
        downloads += 1;
        return { status: "ready", installMode: "managed" };
      },
    }),
  });

  assert.equal((await orchestrator.checkAndStage()).status, "error");
  assert.equal((await orchestrator.checkAndStage()).status, "ready");
  assert.equal(checks, 2);
  assert.equal(downloads, 1);
});

test("stopping during a check prevents its completion from scheduling another timer", async () => {
  const clock = scheduler();
  let finish;
  const orchestrator = createUpdateOrchestrator({
    getService: () => ({ check: () => new Promise((resolve) => { finish = resolve; }) }),
    initialDelayMs: 5,
    intervalMs: 50,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });

  orchestrator.start();
  const checking = orchestrator.checkAndStage();
  await new Promise((resolve) => setImmediate(resolve));
  orchestrator.stop();
  finish({ status: "current", installMode: "none" });
  await checking;
  assert.equal(clock.timers.length, 1);
  assert.equal(clock.timers[0].cleared, true);
});
