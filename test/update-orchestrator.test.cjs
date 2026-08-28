const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_INTERVAL_MS,
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
  assert.equal(clock.timers[0].cleared, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(checks, 1);
  releaseCheck({ status: "available", installMode: "portable-replace" });
  assert.deepEqual(await first, { status: "ready", installMode: "portable-replace" });
  assert.equal(downloads, 1);
  assert.equal(clock.timers.at(-1).delay, DEFAULT_INTERVAL_MS);
  assert.equal(clock.timers.at(-1).unreferenced, true);
});

test("periodic checks reschedule after completion and stop clears the timer", async () => {
  const clock = scheduler();
  let checks = 0;
  const orchestrator = createUpdateOrchestrator({
    getService: () => ({
      async check() {
        checks += 1;
        return { status: "current", installMode: "none" };
      },
    }),
    initialDelayMs: 5,
    intervalMs: 50,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });

  orchestrator.start();
  clock.timers[0].callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(checks, 1);
  assert.equal(clock.timers[1].delay, 50);
  orchestrator.stop();
  assert.equal(clock.timers[1].cleared, true);
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
