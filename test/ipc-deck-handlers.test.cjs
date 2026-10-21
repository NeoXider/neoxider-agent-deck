const test = require("node:test");
const assert = require("node:assert/strict");
const { registerDeckHandlers } = require("../src/ipc-deck-handlers.cjs");

function register(overrides = {}) {
  const handlers = new Map();
  const log = [];
  registerDeckHandlers({
    handle: (channel, handler) => handlers.set(channel, handler),
    api: { reconnect: async () => log.push("reconnect") },
    invalidateDashboard: () => log.push("invalidate"),
    persistCapturedLaunchUrl: () => log.push("persist"),
    ...overrides,
  });
  const call = (channel, ...args) => handlers.get(channel)({}, ...args);
  return { handlers, log, call };
}

test("every Harness channel is registered through the guarded handle()", () => {
  const { handlers } = register();
  assert.deepEqual([...handlers.keys()].sort(), [
    "archive-session", "check-harness-runtime", "get-harness-runtime", "get-harness-target", "interrupt-subagent", "job-output",
    "kill-job", "open-dsh-desktop", "open-viewer", "pin-session", "restart-harness", "session-jobs", "set-harness-target", "set-recent-sessions-open", "unarchive-session", "update-harness",
  ]);
});

test("the viewer opens an image, a path against the chat's folder, or an attachment read from Harness", async () => {
  const opened = [];
  const viewer = {
    openImage: (value) => opened.push(["image", value.name]),
    openPath: (value, options) => opened.push(["path", value, options.cwd]),
    openBytes: (value) => opened.push(["bytes", value.name, value.mediaType, value.data]),
  };
  const api = { readAttachment: async (sessionId, attachmentId) => ({ attachment: { name: "notes.md", mediaType: "text/markdown" }, data: `${sessionId}:${attachmentId}` }) };
  const { call } = register({ getViewer: () => viewer, api });
  await call("open-viewer", { type: "image", name: "shot.png", dataUrl: "data:image/png;base64,AA==" });
  await call("open-viewer", { type: "path", path: "docs/plan.md", cwd: "D:\\deck" });
  await call("open-viewer", { type: "attachment", sessionId: "s1", attachmentId: "a1" });
  assert.deepEqual(opened, [["image", "shot.png"], ["path", "docs/plan.md", "D:\\deck"], ["bytes", "notes.md", "text/markdown", "s1:a1"]]);
  await assert.rejects(call("open-viewer", { type: "attachment", sessionId: "", attachmentId: "a1" }), /session id/);
  await assert.rejects(call("open-viewer", { type: "shell", path: "calc.exe" }), /Nothing to show/);
});

test("update installs the newest stable runtime, then restarts onto it and records the switch", async () => {
  const steps = [];
  const runtime = {
    check: async (options) => { steps.push(["check", options]); return { ready: "0.2.1-rc.2" }; },
    switched: () => steps.push(["switched"]),
    state: () => ({ running: "0.2.1-rc.2" }),
  };
  const { call, log } = register({
    getHarnessRuntime: () => runtime,
    getHarnessLauncher: () => ({ restart: async () => { steps.push(["restart"]); return { ok: true, started: true }; } }),
  });
  const result = await call("update-harness");
  assert.deepEqual(steps, [["check", { install: true }], ["restart"], ["switched"]]);
  assert.equal(result.updated, true);
  assert.deepEqual(log, ["persist", "reconnect", "invalidate"]);
});

test("an update that is not needed restarts nothing, and a failed install says why", async () => {
  let restarts = 0;
  const launcher = { restart: async () => { restarts += 1; return { ok: true }; } };
  const upToDate = register({ getHarnessRuntime: () => ({ check: async () => ({ ready: "" }), state: () => ({}) }), getHarnessLauncher: () => launcher });
  assert.equal((await upToDate.call("update-harness")).updated, false);
  const failing = register({ getHarnessRuntime: () => ({ check: async () => ({ error: "Not enough disk space for Harness 0.2.1-rc.2" }) }), getHarnessLauncher: () => launcher });
  await assert.rejects(failing.call("update-harness"), /Not enough disk space/);
  assert.equal(restarts, 0);
});

test("DSH Desktop's Harness is never restarted or updated from Deck", async () => {
  let restarts = 0;
  const { call } = register({
    getHarnessServices: () => ({ onDesktop: () => true }),
    getHarnessLauncher: () => ({ restart: async () => { restarts += 1; return { ok: true }; } }),
    getHarnessRuntime: () => ({ check: async () => ({ ready: "x" }) }),
  });
  assert.deepEqual(await call("restart-harness"), { ok: false, started: false, reason: "desktop-owned" });
  await assert.rejects(call("update-harness"), /update DSH Desktop instead/);
  assert.equal(restarts, 0);
});

test("session tasks validate ids, reach the task service and refresh the list after a change", async () => {
  const calls = [];
  const tasks = {
    archive: async (id, options) => { calls.push(["archive", id, options]); return { archivedSessionIds: [id] }; },
    unarchive: async (id) => { calls.push(["unarchive", id]); return { archivedSessionIds: [] }; },
    pin: async (id, pinned) => { calls.push(["pin", id, pinned]); return { pinnedSessionIds: pinned ? [id] : [] }; },
    jobs: async (id) => [{ id: "bash-1", owner: id }],
    killJob: async (id, jobId) => ({ id, jobId }),
    jobOutput: async () => ({ output: "ok" }),
    interruptSubagent: async (child, parent) => ({ child, parent }),
  };
  const { call, log } = register({ getHarnessServices: () => ({ tasks, onDesktop: () => false }) });
  await call("archive-session", "s1", { stopActivity: true });
  await call("pin-session", "s1", false);
  await call("unarchive-session", "s1");
  assert.deepEqual(calls, [["archive", "s1", { stopActivity: true }], ["pin", "s1", false], ["unarchive", "s1"]]);
  assert.equal(log.filter((entry) => entry === "invalidate").length, 3);
  await assert.rejects(call("archive-session", "  "), /session id is required/);
  assert.deepEqual(await call("interrupt-subagent", "kid", "parent"), { child: "kid", parent: "parent" });
  await assert.rejects(call("interrupt-subagent", "kid", ""), /session id is required/);
});
