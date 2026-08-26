const test = require("node:test");
const assert = require("node:assert/strict");
const { createQuitCoordinator } = require("../src/quit-coordinator.cjs");

function fakeApp() {
  return {
    isQuitting: false,
    quitCalls: 0,
    quit() { this.quitCalls += 1; },
  };
}

test("manual Quit marks shutdown before cleanup and calls app.quit only once", () => {
  const app = fakeApp();
  const observations = [];
  const coordinator = createQuitCoordinator({
    app,
    cleanup: [
      () => observations.push(["first", app.isQuitting]),
      () => observations.push(["second", app.isQuitting]),
    ],
  });

  assert.equal(coordinator.requestQuit("tray"), true);
  assert.equal(coordinator.requestQuit("tray-again"), false);
  assert.equal(app.isQuitting, true);
  assert.equal(app.quitCalls, 1);
  assert.equal(coordinator.quitReason(), "tray");
  assert.deepEqual(observations, [["first", true], ["second", true]]);
});

test("before-quit cleanup is idempotent with an earlier explicit Quit", () => {
  const app = fakeApp();
  let cleanupCalls = 0;
  const coordinator = createQuitCoordinator({ app, cleanup: () => { cleanupCalls += 1; } });

  coordinator.requestQuit("tray");
  coordinator.beforeQuit();
  coordinator.beforeQuit();
  assert.equal(cleanupCalls, 1);
  assert.equal(app.quitCalls, 1);
});

test("window close collapses while running and passes through during shutdown", () => {
  const app = fakeApp();
  const coordinator = createQuitCoordinator({ app });
  let prevented = 0;
  let collapsed = 0;
  const event = { preventDefault: () => { prevented += 1; } };

  assert.equal(coordinator.handleWindowClose(event, () => { collapsed += 1; }), false);
  assert.equal(prevented, 1);
  assert.equal(collapsed, 1);
  coordinator.requestQuit("tray");
  assert.equal(coordinator.handleWindowClose(event, () => { collapsed += 1; }), true);
  assert.equal(prevented, 1);
  assert.equal(collapsed, 1);
});

test("activation and renderer recovery cannot resurrect a quitting app", () => {
  const app = fakeApp();
  const coordinator = createQuitCoordinator({ app });
  let activations = 0;
  let recoveries = 0;

  assert.equal(coordinator.handleActivation(() => { activations += 1; }), true);
  assert.equal(coordinator.handleRendererGone({ reason: "crashed" }, () => { recoveries += 1; }), true);
  assert.equal(coordinator.handleRendererGone({ reason: "clean-exit" }, () => { recoveries += 1; }), false);
  coordinator.requestQuit("tray");
  assert.equal(coordinator.handleActivation(() => { activations += 1; }), false);
  assert.equal(coordinator.handleRendererGone({ reason: "crashed" }, () => { recoveries += 1; }), false);
  assert.equal(activations, 1);
  assert.equal(recoveries, 1);
});

test("cleanup failure is reported and cannot prevent process quit", () => {
  const app = fakeApp();
  const errors = [];
  const coordinator = createQuitCoordinator({
    app,
    cleanup: [() => { throw new Error("settings flush failed"); }],
    onCleanupError: (error) => errors.push(error.message),
  });

  assert.equal(coordinator.requestQuit("tray"), true);
  assert.equal(app.quitCalls, 1);
  assert.deepEqual(errors, ["settings flush failed"]);
});
