const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const {
  HARNESS_DIRECT_ARGS,
  HARNESS_NPX_ARGS,
  createHarnessLauncher,
  isLocalHarnessUrl,
  resolveInstalledDshEntry,
  resolveHarnessLaunchSpec,
} = require("../src/harness-launcher.cjs");

function fakeChild() {
  const child = new EventEmitter();
  child.unref = () => {};
  return child;
}

test("official Harness web command is resolved without a shell", () => {
  assert.deepEqual(resolveHarnessLaunchSpec({ platform: "win32", env: {} }), {
    command: "cmd.exe",
    args: ["/d", "/s", "/c", "npx.cmd", ...HARNESS_NPX_ARGS],
    displayCommand: "npx.cmd",
  });
  assert.deepEqual(resolveHarnessLaunchSpec({ platform: "darwin", env: {} }), {
    command: "npx",
    args: [...HARNESS_NPX_ARGS],
    displayCommand: "npx",
  });
  assert.deepEqual(HARNESS_NPX_ARGS, ["--yes", "@deepseek-ai/dsh@latest", "web", "--no-open"]);
  assert.deepEqual(resolveHarnessLaunchSpec({
    platform: "linux",
    env: {},
    harnessUrl: "http://localhost:4123",
  }).args, [...HARNESS_NPX_ARGS, "--port", "4123"]);
});

test("an installed Harness runtime is preferred over network npx", () => {
  const runtime = "C:\\AI\\work\\deepseek-harness-runtime";
  const entry = path.win32.join(runtime, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
  const fileSystem = { existsSync: (candidate) => path.win32.normalize(candidate) === path.win32.normalize(entry) };
  assert.equal(resolveInstalledDshEntry({
    platform: "win32",
    env: { SystemDrive: "C:" },
    workingDirectory: "C:\\other",
    fileSystem,
  }), entry);
  assert.deepEqual(resolveHarnessLaunchSpec({
    platform: "win32",
    env: {},
    installedEntry: entry,
    nodeExecutable: "C:\\Program Files\\nodejs\\node.exe",
  }), {
    command: "C:\\Program Files\\nodejs\\node.exe",
    args: [entry, ...HARNESS_DIRECT_ARGS],
    displayCommand: entry,
  });
});

test("a configured dsh executable receives dsh arguments rather than npx package arguments", () => {
  assert.deepEqual(resolveHarnessLaunchSpec({
    platform: "linux",
    env: { DSH_WIDGET_HARNESS_EXECUTABLE: "/usr/local/bin/dsh" },
  }), {
    command: "/usr/local/bin/dsh",
    args: [...HARNESS_DIRECT_ARGS],
    displayCommand: "/usr/local/bin/dsh",
  });
});

test("only loopback Harness endpoints are eligible for a local spawn", () => {
  assert.equal(isLocalHarnessUrl("http://127.0.0.1:3080"), true);
  assert.equal(isLocalHarnessUrl("http://localhost:3080"), true);
  assert.equal(isLocalHarnessUrl("http://[::1]:3080"), true);
  assert.equal(isLocalHarnessUrl("https://harness.example.test"), false);
});

test("a remote Harness URL never spawns a local process", async () => {
  let spawnCount = 0;
  const launcher = createHarnessLauncher({
    harnessUrl: "https://harness.example.test",
    spawnProcess: () => { spawnCount += 1; return fakeChild(); },
    probeReady: async () => false,
  });

  assert.deepEqual(await launcher.start(), { ok: false, started: false, reason: "remote-url" });
  assert.equal(spawnCount, 0);
});

test("an unavailable local HTTPS endpoint is not replaced with an HTTP process", async () => {
  let spawnCount = 0;
  const launcher = createHarnessLauncher({
    harnessUrl: "https://localhost:3080",
    spawnProcess: () => { spawnCount += 1; return fakeChild(); },
    probeReady: async () => false,
  });

  assert.deepEqual(await launcher.start(), { ok: false, started: false, reason: "unsupported-local-protocol" });
  assert.equal(spawnCount, 0);
});

test("concurrent starts share one spawn and one readiness sequence", async () => {
  let spawnCount = 0;
  let probeCount = 0;
  const createdDirectories = [];
  const launcher = createHarnessLauncher({
    harnessUrl: "http://127.0.0.1:3080",
    platform: "win32",
    env: {},
    workingDirectory: "C:\\Users\\User\\AppData\\Roaming\\NeoXider\\AgentDeck\\harness-workspace",
    fileSystem: { mkdirSync: (directory) => createdDirectories.push(directory), existsSync: () => false },
    spawnProcess(command, args, options) {
      spawnCount += 1;
      assert.equal(command, "cmd.exe");
      assert.deepEqual(args, ["/d", "/s", "/c", "npx.cmd", ...HARNESS_NPX_ARGS]);
      assert.equal(options.shell, false);
      assert.equal(options.cwd, "C:\\Users\\User\\AppData\\Roaming\\NeoXider\\AgentDeck\\harness-workspace");
      return fakeChild();
    },
    probeReady: async () => { probeCount += 1; return probeCount >= 3; },
    delay: async () => {},
    readinessAttempts: 4,
  });

  const first = launcher.start();
  const second = launcher.start();
  assert.equal(first, second);
  assert.deepEqual(await first, { ok: true, started: true, fallback: null, command: "npx.cmd" });
  assert.equal(spawnCount, 1);
  assert.deepEqual(createdDirectories, ["C:\\Users\\User\\AppData\\Roaming\\NeoXider\\AgentDeck\\harness-workspace"]);
});

test("an already-ready Harness instance is reused", async () => {
  let spawnCount = 0;
  const launcher = createHarnessLauncher({
    harnessUrl: "http://localhost:3080",
    spawnProcess: () => { spawnCount += 1; return fakeChild(); },
    probeReady: async () => true,
  });

  assert.deepEqual(await launcher.start(), { ok: true, started: false, alreadyRunning: true });
  assert.equal(spawnCount, 0);
});

test("Windows batch file is a bounded fallback when npx cannot launch", async () => {
  const desktopPath = "C:\\Users\\User\\Desktop";
  const fallbackPath = path.win32.join(desktopPath, "Запустить DeepSeek Harness.bat");
  let fallbackOpened = "";
  let probeCount = 0;
  const launcher = createHarnessLauncher({
    harnessUrl: "http://127.0.0.1:3080",
    platform: "win32",
    desktopPath,
    fileSystem: { existsSync: (candidate) => candidate === fallbackPath },
    spawnProcess() {
      const child = fakeChild();
      queueMicrotask(() => child.emit("error", new Error("npx missing")));
      return child;
    },
    openPath: async (candidate) => { fallbackOpened = candidate; return ""; },
    probeReady: async () => { probeCount += 1; return probeCount >= 4; },
    delay: async () => {},
    readinessAttempts: 3,
  });

  const result = await launcher.start();
  assert.equal(result.fallback, "windows-batch");
  assert.equal(fallbackOpened, fallbackPath);
});
