const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const { readFileSync } = require("node:fs");

const {
  DEFAULT_MAX_INFLIGHT,
  HOST_EXE,
  createBoundedLineReader,
  createGameBarController,
  createSharedDashboardReader,
  readHarnessDashboard,
  resolveGameBarBridgeHost,
} = require("../src/gamebar-controller.cjs");
const { MAX_FRAME_BYTES, decodeFrame, encodeFrame } = require("../src/gamebar-protocol.cjs");

const HELLO = { v: 1, type: "hello", client: "gamebar", requestId: "hello-0001" };

assert.equal(DEFAULT_MAX_INFLIGHT, 16);

class FakeStdin extends EventEmitter {
  constructor() {
    super();
    this.writable = true;
    this.writes = [];
    this.acceptWrites = true;
  }

  write(value) {
    this.writes.push(String(value));
    return this.acceptWrites;
  }
}

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.stdin = new FakeStdin();
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this.killCount = 0;
  }

  kill() {
    this.killCount += 1;
  }
}

function timerHarness() {
  const timers = [];
  return {
    timers,
    setTimer(callback, delay) {
      const timer = { callback, delay, cleared: false, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimer(timer) {
      if (timer) timer.cleared = true;
    },
    async runNext(delay) {
      const timer = timers.find((item) => !item.cleared && (delay === undefined || item.delay === delay));
      assert.ok(timer, `missing timer${delay === undefined ? "" : ` at ${delay}ms`}`);
      timer.cleared = true;
      await timer.callback();
      await settle();
      return timer;
    },
  };
}

function session(overrides = {}) {
  return {
    sessionId: "session-a",
    title: "Safe session",
    state: "idle",
    running: false,
    projections: { values: {} },
    ...overrides,
  };
}

function dashboard(sessions = [session()]) {
  return { ok: true, harness: true, sessions };
}

function createHarness(overrides = {}) {
  const child = overrides.child || new FakeChild();
  const timers = overrides.timers || timerHarness();
  const calls = { fullAccess: [], prompts: [], opened: [] };
  const api = overrides.api || {
    async ensureFullAccess(sessionId) { calls.fullAccess.push(sessionId); },
    async prompt(sessionId, text, timeZone) { calls.prompts.push({ sessionId, text, timeZone }); },
  };
  const controller = createGameBarController({
    platform: "win32",
    appPath: "C:\\repo",
    resourcesPath: "C:\\resources",
    version: "0.5.2",
    fileExists: () => true,
    spawn: overrides.spawn || (() => child),
    readDashboard: overrides.readDashboard || (async () => dashboard()),
    onOpenSession: overrides.onOpenSession || (async (sessionId) => { calls.opened.push(sessionId); }),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    pollIntervalMs: 2_500,
    restartDelays: overrides.restartDelays || [10, 20],
    maxInflight: overrides.maxInflight || 16,
    maxQueuedBytes: overrides.maxQueuedBytes,
    reprobeIntervalMs: overrides.reprobeIntervalMs || 30_000,
    terminalExitGraceMs: overrides.terminalExitGraceMs || 1_000,
    api,
    now: overrides.now || (() => 1_700_000_000_000),
  });
  return { api, calls, child, controller, timers };
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function emit(child, frame) {
  child.stdout.emit("data", Buffer.from(encodeFrame(frame), "utf8"));
}

function writtenFrames(child) {
  return child.stdin.writes.join("").split("\n").filter(Boolean)
    .map((line) => decodeFrame(Buffer.from(`${line}\n`, "utf8")));
}

test("bridge host resolution is deterministic for packaged, development, missing, and non-Windows installs", () => {
  const packaged = path.win32.join("C:\\resources", "gamebar", HOST_EXE);
  assert.equal(resolveGameBarBridgeHost({
    platform: "win32", isPackaged: true, resourcesPath: "C:\\resources", fileExists: (candidate) => candidate === packaged,
  }), packaged);

  const development = resolveGameBarBridgeHost({
    platform: "win32", appPath: "C:\\repo", fileExists: (candidate) => candidate.includes("\\bin\\Release\\") && !candidate.includes("\\publish\\"),
  });
  assert.match(development, /windows-gamebar.*bin[\\/]Release.*win-x64.*BridgeHost\.exe$/);
  assert.equal(resolveGameBarBridgeHost({ platform: "linux", fileExists: () => true }), null);
  assert.equal(resolveGameBarBridgeHost({ platform: "win32", appPath: "C:\\repo", fileExists: () => false }), null);
});

test("dashboard reads preserve the renderer contract while failures become explicit offline state", async () => {
  assert.deepEqual(await readHarnessDashboard({ dashboard: async () => ({ sessions: [session()] }) }), {
    ok: true, harness: true, sessions: [session()],
  });
  assert.deepEqual(await readHarnessDashboard({ dashboard: async () => { throw new Error("offline"); } }), {
    ok: false, harness: false, error: "offline", sessions: [],
  });
});

test("the shared dashboard reader coalesces concurrent UI and Game Bar polls and caches their result briefly", async () => {
  let timestamp = 1_000;
  let calls = 0;
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const reader = createSharedDashboardReader({
    now: () => timestamp,
    cacheMs: 1_000,
    async readDashboard() {
      calls += 1;
      await blocked;
      return dashboard();
    },
  });
  const first = reader.read();
  const concurrent = reader.read();
  assert.equal(calls, 0);
  await settle();
  assert.equal(calls, 1);
  release();
  assert.strictEqual(await first, await concurrent);
  timestamp = 2_000;
  assert.strictEqual(await reader.read(), await first);
  assert.equal(calls, 1);
  timestamp = 2_001;
  await reader.read();
  assert.equal(calls, 2);
});

test("the shared dashboard reader converts thrown and malformed results into the offline contract", async () => {
  const thrown = createSharedDashboardReader({ readDashboard: async () => { throw new Error("offline"); } });
  assert.deepEqual(await thrown.read(), { ok: false, harness: false, error: "offline", sessions: [] });
  const malformed = createSharedDashboardReader({ readDashboard: async () => null });
  assert.deepEqual(await malformed.read(), {
    ok: false, harness: false, error: "Dashboard response is invalid", sessions: [],
  });
});

test("disabled, smoke, and missing-host controllers stay nonfatal and offline", async () => {
  for (const options of [
    { platform: "linux", smokeMode: false, fileExists: () => true, expected: "disabled" },
    { platform: "win32", smokeMode: true, fileExists: () => true, expected: "disabled" },
    { platform: "win32", smokeMode: false, fileExists: () => false, expected: "host-missing" },
  ]) {
    let spawned = 0;
    const controller = createGameBarController({
      ...options,
      readDashboard: async () => dashboard(),
      spawn: () => { spawned += 1; return new FakeChild(); },
    });
    assert.equal(controller.start(), options.expected);
    await settle();
    assert.equal(spawned, 0);
    assert.equal(controller.getStatus(), options.expected);
    assert.equal(controller.getSnapshot().status, "offline");
    controller.dispose();
  }
});

test("hello negotiates the exact v1 capabilities and snapshot requests receive command.ok then current state", async () => {
  const { child, controller } = createHarness();
  controller.start();
  await settle();
  emit(child, HELLO);
  await settle();
  assert.deepEqual(writtenFrames(child)[0], {
    v: 1,
    type: "hello.ok",
    requestId: HELLO.requestId,
    serverVersion: "0.5.2",
    capabilities: ["snapshot", "ack", "open-session", "quick-reply"],
  });

  child.stdin.writes.length = 0;
  emit(child, { v: 1, type: "command", requestId: "request-0001", command: "request-snapshot" });
  await settle();
  const response = writtenFrames(child);
  assert.equal(response[0].type, "command.ok");
  assert.equal(response[1].type, "snapshot");
  assert.equal(response[1].sessionId, "session-a");
  controller.dispose();
});

test("stdin backpressure waits for drain without killing the host and preserves response order", async () => {
  const { child, controller } = createHarness();
  controller.start();
  await settle();
  child.stdin.acceptWrites = false;
  emit(child, HELLO);
  emit(child, { v: 1, type: "command", requestId: "request-0001", command: "request-snapshot" });
  await settle();
  assert.equal(child.killCount, 0);
  assert.equal(controller.getStatus(), "connected");
  assert.deepEqual(writtenFrames(child).map((frame) => frame.type), ["hello.ok"]);
  child.stdin.acceptWrites = true;
  child.stdin.emit("drain");
  await settle();
  assert.deepEqual(writtenFrames(child).map((frame) => frame.type), ["hello.ok", "command.ok", "snapshot"]);
  assert.equal(child.stdin.listenerCount("drain"), 0);
  controller.dispose();
});

test("backpressure waiters are released on stream close and disposal", async () => {
  for (const close of [
    ({ child }) => child.stdin.emit("close"),
    ({ controller }) => controller.dispose(),
  ]) {
    const harness = createHarness();
    harness.controller.start();
    await settle();
    harness.child.stdin.acceptWrites = false;
    emit(harness.child, HELLO);
    await settle();
    assert.equal(harness.child.stdin.listenerCount("drain"), 1);
    close(harness);
    await settle();
    assert.equal(harness.child.stdin.listenerCount("drain"), 0);
    harness.controller.dispose();
  }
});

test("a peer that never drains cannot grow the serialized output queue without bound", async () => {
  const { child, controller } = createHarness({ maxInflight: 1_000, maxQueuedBytes: MAX_FRAME_BYTES });
  controller.start();
  await settle();
  child.stdin.acceptWrites = false;
  emit(child, HELLO);
  for (let index = 0; index < 500; index += 1) {
    emit(child, {
      v: 1,
      type: "command",
      requestId: `request-${String(index).padStart(4, "0")}`,
      command: "request-snapshot",
    });
    if (child.killCount) break;
  }
  await settle();
  assert.equal(child.killCount, 1);
  assert.equal(controller.getStatus(), "restarting");
  controller.dispose();
});

test("pre-handshake commands and repeated hello close the transport without a command response", async () => {
  for (const frames of [
    [{ v: 1, type: "command", requestId: "request-pre1", command: "request-snapshot" }],
    [HELLO, { ...HELLO, requestId: "hello-0002" }],
  ]) {
    const { child, controller } = createHarness();
    controller.start();
    await settle();
    child.stdin.writes.length = 0;
    for (const frame of frames) emit(child, frame);
    await settle();
    assert.equal(child.killCount, 1);
    assert.equal(controller.getStatus(), "restarting");
    assert.equal(writtenFrames(child).some((frame) => frame.type === "command.error"), false);
    controller.dispose();
  }
});

test("commands route only snapshot-authorized exact sessions and duplicates fail closed", async () => {
  const { calls, child, controller } = createHarness();
  controller.start();
  await settle();
  emit(child, HELLO);
  await settle();
  child.stdin.writes.length = 0;

  const open = { v: 1, type: "command", requestId: "request-open-1", command: "open-session", sessionId: "session-a" };
  emit(child, open);
  await settle();
  assert.deepEqual(calls.opened, ["session-a"]);
  assert.equal(writtenFrames(child).at(-1).type, "command.ok");

  emit(child, open);
  emit(child, { ...open, requestId: "request-open-2", sessionId: "unknown" });
  await settle();
  const errors = writtenFrames(child).filter((frame) => frame.type === "command.error");
  assert.deepEqual(errors.map((frame) => frame.code), ["duplicate-request", "invalid-field"]);
  assert.deepEqual(calls.opened, ["session-a"]);
  assert.doesNotMatch(JSON.stringify(errors), /Unknown Harness session|C:\\|secret/i);
  controller.dispose();
});

test("an unavailable renderer rejects open-session with a fixed safe error", async () => {
  const { child, controller } = createHarness({
    onOpenSession: async () => { throw new Error("Renderer unavailable at C:\\private"); },
  });
  controller.start();
  await settle();
  emit(child, HELLO);
  await settle();
  child.stdin.writes.length = 0;
  emit(child, {
    v: 1, type: "command", requestId: "request-open1", command: "open-session", sessionId: "session-a",
  });
  await settle();
  const response = writtenFrames(child).at(-1);
  assert.deepEqual({ type: response.type, code: response.code, message: response.message }, {
    type: "command.error", code: "internal-error", message: "The command failed",
  });
  assert.doesNotMatch(JSON.stringify(response), /private|Renderer unavailable/i);
  controller.dispose();
});

test("ack returns a fresh snapshot and quick reply uses full access plus the Harness prompt queue", async () => {
  const { calls, child, controller } = createHarness();
  controller.start();
  await settle();
  emit(child, HELLO);
  await settle();
  child.stdin.writes.length = 0;

  emit(child, { v: 1, type: "command", requestId: "request-ack-1", command: "ack", sessionId: "session-a" });
  emit(child, { v: 1, type: "command", requestId: "request-reply-1", command: "quick-reply", sessionId: "session-a", text: "  Continue  " });
  await settle();
  const frames = writtenFrames(child);
  assert.equal(frames[0].type, "command.ok");
  assert.equal(frames[1].type, "snapshot");
  assert.equal(frames.at(-1).type, "command.ok");
  assert.deepEqual(calls.fullAccess, ["session-a"]);
  assert.equal(calls.prompts[0].sessionId, "session-a");
  assert.equal(calls.prompts[0].text, "Continue");
  assert.equal(typeof calls.prompts[0].timeZone, "string");
  controller.dispose();
});

test("inflight work is bounded without executing overflow quick replies", async () => {
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const api = {
    calls: [],
    async ensureFullAccess(sessionId) { this.calls.push(sessionId); await blocked; },
    async prompt() {},
  };
  const { child, controller } = createHarness({ api, maxInflight: 1 });
  controller.start();
  await settle();
  emit(child, HELLO);
  await settle();
  child.stdin.writes.length = 0;
  emit(child, { v: 1, type: "command", requestId: "request-reply-1", command: "quick-reply", sessionId: "session-a", text: "First" });
  emit(child, { v: 1, type: "command", requestId: "request-reply-2", command: "quick-reply", sessionId: "session-a", text: "Second" });
  await settle();
  assert.deepEqual(api.calls, ["session-a"]);
  assert.equal(writtenFrames(child).find((frame) => frame.requestId === "request-reply-2").code, "request-limit");
  release();
  await settle();
  controller.dispose();
});

test("a delayed old command cannot write to a new authenticated child after clean retirement", async () => {
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const children = [];
  const timers = timerHarness();
  const harness = createHarness({
    timers,
    restartDelays: [10, 20],
    spawn: () => {
      const next = new FakeChild();
      children.push(next);
      return next;
    },
    api: {
      async ensureFullAccess() { await blocked; },
      async prompt() {},
    },
  });
  harness.controller.start();
  await settle();
  emit(children[0], HELLO);
  await settle();
  emit(children[0], {
    v: 1, type: "command", requestId: "request-old1", command: "quick-reply", sessionId: "session-a", text: "Continue",
  });
  await settle();
  children[0].stdout.emit("end");
  children[0].stdin.emit("close");
  children[0].emit("exit", 0);
  await timers.runNext(10);
  emit(children[1], { ...HELLO, requestId: "hello-0002" });
  await settle();
  children[1].stdin.writes.length = 0;
  release();
  await settle();
  await settle();
  assert.equal(writtenFrames(children[1]).some((frame) => frame.requestId === "request-old1"), false);
  harness.controller.dispose();
});

test("clean sidecar retirement always uses the first quick restart without consuming the crash budget", async () => {
  const children = [];
  const timers = timerHarness();
  const harness = createHarness({
    timers,
    restartDelays: [10, 20],
    spawn: () => {
      const next = new FakeChild();
      children.push(next);
      return next;
    },
  });
  harness.controller.start();
  await settle();
  for (let index = 0; index < 6; index += 1) {
    children[index].stdout.emit("end");
    children[index].stdin.emit("close");
    children[index].emit("exit", 0);
    await timers.runNext(10);
  }
  assert.equal(children.length, 7);
  assert.equal(harness.controller.getStatus(), "waiting-for-widget");
  harness.controller.dispose();
});

test("polling publishes only semantic snapshot changes and exact renderer selection changes the target", async () => {
  let current = dashboard([session(), session({ sessionId: "session-b", title: "Second" })]);
  const { child, controller } = createHarness({ readDashboard: async () => current });
  controller.start();
  await settle();
  emit(child, HELLO);
  await settle();
  child.stdin.writes.length = 0;
  await controller.pollNow();
  await settle();
  assert.equal(child.stdin.writes.length, 0);

  assert.equal(controller.setSelectedSessionId("unknown"), false);
  assert.equal(controller.setSelectedSessionId("session-b"), true);
  await settle();
  assert.equal(writtenFrames(child).at(-1).sessionId, "session-b");

  child.stdin.writes.length = 0;
  current = { ...current, sessions: current.sessions.map((item) => ({ ...item })) };
  await controller.pollNow();
  await settle();
  assert.equal(child.stdin.writes.length, 0);

  current = { ok: false, harness: false, error: "private path C:\\secret", sessions: [] };
  await controller.pollNow();
  await settle();
  const offline = writtenFrames(child).at(-1);
  assert.equal(offline.status, "offline");
  assert.doesNotMatch(JSON.stringify(offline), /private path|C:\\secret/);
  child.stdin.writes.length = 0;
  await controller.pollNow();
  await settle();
  assert.equal(child.stdin.writes.length, 0);
  controller.dispose();
});

test("strict line buffering bounds memory and transport failures restart only a finite number of times", async () => {
  let failure = null;
  const reader = createBoundedLineReader(() => assert.fail("oversized data reached the parser"), (error) => { failure = error; });
  reader.push(Buffer.alloc(MAX_FRAME_BYTES));
  assert.equal(failure.code, "oversized-frame");

  const children = [];
  const timers = timerHarness();
  const harness = createHarness({
    timers,
    restartDelays: [10, 20],
    spawn: () => {
      const child = new FakeChild();
      children.push(child);
      return child;
    },
  });
  harness.controller.start();
  await settle();
  children[0].stdout.emit("data", Buffer.from([0xff, 0x0a]));
  await settle();
  assert.equal(children[0].killCount, 1);
  await timers.runNext(10);
  children[1].emit("exit", 1);
  await timers.runNext(20);
  children[2].emit("exit", 1);
  await settle();
  assert.equal(harness.controller.getStatus(), "restart-limit");
  assert.equal(children.length, 3);
  harness.controller.dispose();
});

test("terminal stream close waits briefly for an authoritative process exit", async () => {
  const { child, controller, timers } = createHarness();
  controller.start();
  await settle();
  child.stdout.emit("end");
  child.stdin.emit("close");
  await settle();
  assert.equal(child.killCount, 0);
  assert.equal(child.stdout.listenerCount("data"), 1);
  await timers.runNext(1_000);
  assert.equal(child.killCount, 1);
  assert.equal(controller.getStatus(), "restarting");
  controller.dispose();
});

test("stdio errors close safely, restart once, and remove transport listeners", async () => {
  for (const breakTransport of [
    (child) => child.stdout.emit("error", new Error("stdout failed")),
    (child) => child.stderr.emit("error", new Error("stderr failed")),
  ]) {
    const { child, controller } = createHarness();
    controller.start();
    await settle();
    breakTransport(child);
    await settle();
    assert.equal(child.killCount, 1);
    assert.equal(controller.getStatus(), "restarting");
    assert.equal(child.stdout.listenerCount("data"), 0);
    assert.equal(child.stderr.listenerCount("error"), 0);
    assert.equal(child.stdin.listenerCount("error"), 0);
    controller.dispose();
  }
});

test("a missing host is re-probed slowly and starts when the executable appears", async () => {
  let available = false;
  const children = [];
  const timers = timerHarness();
  const controller = createGameBarController({
    platform: "win32",
    appPath: "C:\\repo",
    fileExists: () => available,
    spawn: () => {
      const child = new FakeChild();
      children.push(child);
      return child;
    },
    readDashboard: async () => dashboard(),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    reprobeIntervalMs: 30_000,
  });
  assert.equal(controller.start(), "host-missing");
  assert.equal(controller.getSnapshot().status, "offline");
  assert.equal(children.length, 0);
  available = true;
  await timers.runNext(30_000);
  assert.equal(children.length, 1);
  assert.equal(controller.getStatus(), "waiting-for-widget");
  controller.dispose();
});

test("widget package absence is re-probed slowly and disposal cancels further launches", async () => {
  const children = [];
  const timers = timerHarness();
  const harness = createHarness({
    timers,
    reprobeIntervalMs: 30_000,
    spawn: () => {
      const child = new FakeChild();
      children.push(child);
      return child;
    },
  });
  harness.controller.start();
  await settle();
  children[0].emit("exit", 3);
  assert.equal(harness.controller.getStatus(), "widget-package-missing");
  await timers.runNext(30_000);
  assert.equal(children.length, 2);
  assert.equal(harness.controller.getStatus(), "waiting-for-widget");
  harness.controller.dispose();
  assert.equal(harness.controller.getStatus(), "disposed");
  assert.equal(timers.timers.filter((timer) => !timer.cleared).length, 0);
});

test("the sandbox bridge carries exact Game Bar selection in both directions", () => {
  const root = path.resolve(__dirname, "..");
  const main = readFileSync(path.join(root, "src", "main.cjs"), "utf8");
  // These two channels live in ipc-handlers.cjs now, behind the shared sender guard.
  const ipc = readFileSync(path.join(root, "src", "ipc-handlers.cjs"), "utf8");
  const preload = readFileSync(path.join(root, "src", "preload.cjs"), "utf8");
  const renderer = readFileSync(path.join(root, "src", "renderer", "app.js"), "utf8");
  assert.match(ipc, /on\("gamebar-selected-session"/);
  assert.match(ipc, /const dashboard = await readDashboard\(\)/);
  assert.match(main, /readDashboard: dashboardReader\.read/);
  assert.match(main, /sendToRenderer\("gamebar-select-session", sessionId\)/);
  assert.match(preload, /selectGameBarSession: \(sessionId\) => ipcRenderer\.send\("gamebar-selected-session", sessionId\)/);
  assert.match(preload, /onGameBarSelectSession: \(listener\) => ipcRenderer\.on\("gamebar-select-session"/);
  assert.match(renderer, /onGameBarSelectSession\(\(sessionId\) => \{ selectSession\(sessionId, true\)/);
  assert.match(renderer, /selectGameBarSession\(state\.selectedSessionId\)/);
});

// Creating a session and refreshing immediately used to be served the snapshot from before
// the session existed, so the renderer concluded its brand-new id did not exist.
test("the shared dashboard cache can be dropped when the session set changes", async () => {
  let reads = 0;
  let clock = 0;
  const reader = createSharedDashboardReader({
    readDashboard: async () => ({ ok: true, harness: true, sessions: [{ sessionId: `s${reads++}` }] }),
    now: () => clock,
    cacheMs: 1000,
  });

  assert.deepEqual((await reader.read()).sessions, [{ sessionId: "s0" }]);
  assert.deepEqual((await reader.read()).sessions, [{ sessionId: "s0" }], "served from the cache");
  reader.invalidate();
  assert.deepEqual((await reader.read()).sessions, [{ sessionId: "s1" }], "a fresh read after invalidation");
  assert.equal(reads, 2);
});
