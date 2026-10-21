const test = require("node:test");
const assert = require("node:assert/strict");
const { createHarnessServices, publicTargetState } = require("../src/harness-services.cjs");

const WEB = "http://127.0.0.1:3080";
const TOKEN = "secret-token-value";

test("the renderer is told which Harness Deck follows, never a launch token", () => {
  const view = publicTargetState({
    preference: "auto", kind: "desktop", url: "http://127.0.0.1:43129", launchUrl: `http://127.0.0.1:43129/?token=${TOKEN}`, webRunning: false,
    desktop: { installed: true, running: true, url: "http://127.0.0.1:43129", launchUrl: `http://127.0.0.1:43129/?token=${TOKEN}`, executable: "C:\\DSH Desktop.exe" },
  }, { installed: "0.12.0", latest: "0.12.1", available: true });
  assert.ok(!JSON.stringify(view).includes(TOKEN));
  assert.equal(view.kind, "desktop");
  assert.equal(view.desktop.canOpen, true);
  assert.equal(view.desktopUpdate.available, true);
});

function services(overrides = {}) {
  const preferences = { harnessTarget: "auto" };
  const sent = [];
  const running = [];
  const spawned = [];
  const service = createHarnessServices({
    api: { ensureRemote: async () => null },
    webUrl: WEB,
    runtime: { setRunning: (version) => running.push(version) },
    getPreferences: () => preferences,
    savePreferences: () => { preferences.saved = true; },
    probeReady: async () => false,
    send: (channel, value) => sent.push([channel, value]),
    platform: "win32",
    env: {},
    runCommand: async () => ({ stdout: "" }),
    spawnProcess: (command, args) => { spawned.push([command, args]); return { on() {}, unref() {} }; },
    setTimer: () => 0,
    clearTimer: () => {},
    setIntervalFn: () => 0,
    clearIntervalFn: () => {},
    ...overrides,
  });
  return { service, preferences, sent, running, spawned };
}

test("choosing a Harness saves the choice and re-reads where things run", async () => {
  const { service, preferences, sent } = services();
  const view = await service.setTarget("desktop");
  assert.equal(preferences.harnessTarget, "desktop");
  assert.equal(preferences.saved, true);
  assert.equal(view.kind, "desktop");
  assert.equal(sent.at(-1)[0], "harness-target");
  assert.equal((await service.setTarget("nonsense")).preference, "auto");
});

test("the running version comes from the launch Deck owns before any process lookup", async () => {
  const { service, running } = services({ getLauncher: () => ({ runningEntry: () => "C:\\R\\versions\\0.2.1-rc.2\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js" }) });
  assert.equal(await service.detectRunningVersion(), "0.2.1-rc.2");
  assert.deepEqual(running, ["0.2.1-rc.2"]);
});

test("DSH Desktop cannot be opened when it is not installed, and Deck stays on its own Harness", async () => {
  const { service } = services();
  await assert.rejects(service.openDesktop(), /not installed/);
  assert.equal(service.desktopLaunchUrl(), "");
  assert.equal(service.onDesktop(), false);
});
