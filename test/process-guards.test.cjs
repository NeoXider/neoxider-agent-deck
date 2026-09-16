const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const { installProcessGuards } = require("../src/process-guards.cjs");

// An uncaught exception in Electron's main process ends the app with no window and no
// message. The guards keep it alive and say what happened.
test("an uncaught exception or rejection is logged instead of ending the process", () => {
  const processRef = new EventEmitter();
  const logged = [];
  const remove = installProcessGuards({ processRef, log: (message, detail) => logged.push([message, detail?.message ?? detail]) });
  assert.equal(processRef.listenerCount("uncaughtException"), 1);
  assert.equal(processRef.listenerCount("unhandledRejection"), 1);

  processRef.emit("uncaughtException", new Error("tray failed"));
  processRef.emit("unhandledRejection", new Error("socket callback threw"));
  assert.deepEqual(logged, [
    ["Uncaught exception in the main process", "tray failed"],
    ["Unhandled promise rejection in the main process", "socket callback threw"],
  ]);

  remove();
  assert.equal(processRef.listenerCount("uncaughtException"), 0);
  assert.equal(processRef.listenerCount("unhandledRejection"), 0);
});
