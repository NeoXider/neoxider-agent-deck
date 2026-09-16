const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const {
  HARNESS_DIRECT_ARGS,
  HARNESS_NPX_ARGS,
  createHarnessLauncher,
  defaultProbeReady,
  extractLaunchBrowserUrl,
  imageNameFromTasklist,
  isLocalHarnessUrl,
  killProcessOnPort,
  listeningPidsFromNetstat,
  resolveInstalledDshEntry,
  resolveHarnessLaunchSpec,
} = require("../src/harness-launcher.cjs");

function fakeChild() {
  const child = new EventEmitter();
  child.unref = () => {};
  return child;
}

test("official Harness web command is resolved for each platform", () => {
  assert.deepEqual(resolveHarnessLaunchSpec({ platform: "win32", env: {} }), {
    command: "cmd.exe",
    args: ["/d", "/s", "/c", "npx.cmd", ...HARNESS_NPX_ARGS],
    displayCommand: "npx.cmd",
  });
  // An app started from Finder or a desktop launcher inherits a minimal PATH with no
  // nvm/homebrew npx, so the fallback goes through a login shell exactly like the
  // Windows branch goes through cmd.exe.
  assert.deepEqual(resolveHarnessLaunchSpec({ platform: "darwin", env: {} }), {
    command: "/bin/sh",
    args: ["-lc", ["npx", ...HARNESS_NPX_ARGS].join(" ")],
    displayCommand: "npx",
  });
  assert.deepEqual(resolveHarnessLaunchSpec({ platform: "darwin", env: { SHELL: "/bin/zsh" } }).command, "/bin/zsh");
  assert.deepEqual(HARNESS_NPX_ARGS, ["--yes", "@deepseek-ai/dsh@latest", "web", "--no-open"]);
  assert.deepEqual(resolveHarnessLaunchSpec({
    platform: "linux",
    env: {},
    harnessUrl: "http://localhost:4123",
  }).args, ["-lc", ["npx", ...HARNESS_NPX_ARGS, "--port", "4123"].join(" ")]);
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
    nodeExecutable: "C:\\AI\\apps\\NeoXider Agent Deck\\NeoXider Agent Deck.exe",
  }), {
    command: "node.exe",
    args: [entry, ...HARNESS_DIRECT_ARGS],
    displayCommand: entry,
  });
  assert.equal(resolveHarnessLaunchSpec({ platform: "linux", env: {}, installedEntry: "/runtime/dsh/lib/bin.js" }).command, "node");
});

test("the installed runtime uses explicit external Node and never packaged Electron runAsNode", async () => {
  const runtime = "C:\\AI\\work\\deepseek-harness-runtime";
  const entry = path.win32.join(runtime, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
  const widgetExecutable = "C:\\AI\\apps\\NeoXider Agent Deck\\NeoXider Agent Deck.exe";
  const externalNode = "C:\\Program Files\\nodejs\\node.exe";
  const env = {
    ExistingValue: "preserved",
    SystemDrive: "C:",
    DSH_WIDGET_NODE_EXECUTABLE: externalNode,
    ELECTRON_RUN_AS_NODE: "1",
  };
  let spawnOptions;
  const launcher = createHarnessLauncher({
    harnessUrl: "http://127.0.0.1:3080",
    platform: "win32",
    env,
    nodeExecutable: widgetExecutable,
    workingDirectory: "C:\\Users\\User\\AppData\\Roaming\\NeoXider\\AgentDeck\\harness-workspace",
    fileSystem: {
      existsSync: (candidate) => path.win32.normalize(candidate) === path.win32.normalize(entry),
      mkdirSync: () => {},
    },
    spawnProcess(command, args, options) {
      assert.equal(command, externalNode);
      assert.notEqual(command, widgetExecutable);
      assert.deepEqual(args, [entry, ...HARNESS_DIRECT_ARGS]);
      spawnOptions = options;
      return fakeChild();
    },
    probeReady: (() => {
      let calls = 0;
      return async () => { calls += 1; return calls >= 2; };
    })(),
    delay: async () => {},
    readinessAttempts: 2,
  });

  assert.deepEqual(await launcher.start(), { ok: true, started: true, fallback: null, command: entry });
  assert.deepEqual(spawnOptions, {
    cwd: "C:\\Users\\User\\AppData\\Roaming\\NeoXider\\AgentDeck\\harness-workspace",
    detached: true,
    env: { ExistingValue: "preserved", SystemDrive: "C:", DSH_WIDGET_NODE_EXECUTABLE: externalNode },
    shell: false,
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true,
  });
});

test("an external Node process that exits before readiness fails immediately", async () => {
  const entry = "C:\\runtime\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js";
  let probeCount = 0;
  const launcher = createHarnessLauncher({
    harnessUrl: "http://127.0.0.1:3080",
    platform: "win32",
    env: {},
    nodeExecutable: "C:\\apps\\NeoXider Agent Deck.exe",
    fileSystem: {
      existsSync: (candidate) => candidate === entry,
      mkdirSync: () => {},
    },
    workingDirectory: "C:\\runtime",
    spawnProcess() {
      const child = fakeChild();
      queueMicrotask(() => child.emit("exit", 0));
      return child;
    },
    probeReady: async () => { probeCount += 1; return false; },
    delay: async () => {},
    readinessAttempts: 60,
  });

  await assert.rejects(
    launcher.start(),
    /Harness launcher exited before becoming ready \(code 0\)/,
  );
  assert.ok(probeCount < 60, "an exited Node process should not wait for the full readiness timeout");
});

test("an installed-runtime Node failure can still use the Windows batch fallback", async () => {
  const runtime = "C:\\runtime";
  const entry = path.win32.join(runtime, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
  const desktopPath = "C:\\Users\\User\\Desktop";
  const fallbackPath = path.win32.join(desktopPath, "Запустить DeepSeek Harness.bat");
  let fallbackOpened = "";
  let probeCount = 0;
  const launcher = createHarnessLauncher({
    harnessUrl: "http://127.0.0.1:3080",
    platform: "win32",
    env: {},
    nodeExecutable: "C:\\apps\\NeoXider Agent Deck.exe",
    desktopPath,
    workingDirectory: runtime,
    fileSystem: {
      existsSync: (candidate) => candidate === entry || candidate === fallbackPath,
      mkdirSync: () => {},
    },
    spawnProcess() {
      const child = fakeChild();
      queueMicrotask(() => child.emit("exit", 0));
      return child;
    },
    openPath: async (candidate) => { fallbackOpened = candidate; return ""; },
    probeReady: async () => { probeCount += 1; return probeCount >= 3; },
    delay: async () => {},
    readinessAttempts: 4,
  });

  assert.deepEqual(await launcher.start(), {
    ok: true,
    started: true,
    fallback: "windows-batch",
    command: fallbackPath,
  });
  assert.equal(fallbackOpened, fallbackPath);
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

test("a delayed live launcher is retained across Retry instead of spawning a duplicate", async () => {
  let spawnCount = 0;
  let probeCount = 0;
  const launcher = createHarnessLauncher({
    harnessUrl: "http://127.0.0.1:3080",
    platform: "linux",
    env: {},
    spawnProcess() {
      spawnCount += 1;
      return fakeChild();
    },
    probeReady: async () => {
      probeCount += 1;
      return probeCount >= 4;
    },
    delay: async () => {},
    readinessAttempts: 1,
  });

  await assert.rejects(launcher.start(), /startup timeout/);
  assert.deepEqual(await launcher.start(), {
    ok: true,
    started: true,
    fallback: null,
    command: "npx",
  });
  assert.equal(spawnCount, 1);
});

test("a never-ready live launcher stays single-owned across repeated retries", async () => {
  let spawnCount = 0;
  const launcher = createHarnessLauncher({
    harnessUrl: "http://127.0.0.1:3080",
    platform: "linux",
    env: {},
    spawnProcess() {
      spawnCount += 1;
      return fakeChild();
    },
    probeReady: async () => false,
    delay: async () => {},
    readinessAttempts: 1,
  });

  await assert.rejects(launcher.start(), /startup timeout/);
  await assert.rejects(launcher.start(), /startup timeout/);
  assert.equal(spawnCount, 1);
});

test("an already-ready Harness instance is reused when the probe captures the token", async () => {
  let spawnCount = 0;
  const launcher = createHarnessLauncher({
    harnessUrl: "http://localhost:3080",
    spawnProcess: () => {
      spawnCount += 1;
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.unref = () => {};
      queueMicrotask(() => child.stdout.emit("data", "dsh web: http://localhost:3080/?token=abc\n"));
      return child;
    },
    probeReady: async () => true,
    delay: async () => {},
  });

  assert.deepEqual(await launcher.start(), { ok: true, started: false, alreadyRunning: true });
  assert.equal(spawnCount, 1, "a probe-only spawn is made to capture the launch token");
});

test("an already-ready Harness without a captured token asks for its launch URL", async () => {
  const commands = [];
  let spawnCount = 0;
  const launcher = createHarnessLauncher({
    harnessUrl: "http://localhost:3080",
    platform: "win32",
    env: {},
    spawnProcess: () => { spawnCount += 1; return fakeChild(); },
    probeReady: async () => true,
    delay: async () => {},
    runCommand: recordingRunCommand(commands),
  });

  // The foreign process must survive: Start reports what it needs instead of
  // killing a Harness that may hold live turns visible in the browser.
  const result = await launcher.start();
  assert.deepEqual(result, { ok: false, started: false, reason: "token-required" });
  assert.equal(spawnCount, 1, "only the token-probe spawn runs");
  assert.deepEqual(commands.filter(([file]) => /netstat/.test(file)), [], "no port kill runs without an explicit restart");
});

// Records every shell-out and answers netstat/tasklist from the given fixtures, so no
// test ever lists or kills a real process on the machine running the suite.
function recordingRunCommand(commands, { netstat = "", tasklist = "", fail = () => false } = {}) {
  return async (file, args, options = {}) => {
    commands.push([path.win32.basename(file), [...args], options]);
    const name = path.win32.basename(file).toLowerCase();
    if (fail(name, args)) return { stdout: "", error: new Error(`${name} failed`) };
    if (name === "netstat.exe") return { stdout: netstat, error: null };
    if (name === "tasklist.exe") return { stdout: typeof tasklist === "function" ? tasklist(args) : tasklist, error: null };
    return { stdout: "", error: null };
  };
}

const NETSTAT_3080 = [
  "",
  "Active Connections",
  "",
  "  Proto  Local Address          Foreign Address        State           PID",
  "  TCP    127.0.0.1:3080         0.0.0.0:0              LISTENING       1234",
  "  TCP    127.0.0.1:51000        127.0.0.1:3080         ESTABLISHED     777",
  "",
].join("\r\n");

test("an explicit restart stops the port holder and boots an owned Harness", async () => {
  const commands = [];
  let spawnCount = 0;
  let probeCount = 0;
  const launcher = createHarnessLauncher({
    harnessUrl: "http://localhost:3080",
    platform: "win32",
    env: { SystemRoot: "C:\\Windows" },
    spawnProcess: () => { spawnCount += 1; return fakeChild(); },
    probeReady: async () => { probeCount += 1; return probeCount >= 2; },
    delay: async () => {},
    runCommand: recordingRunCommand(commands, {
      netstat: NETSTAT_3080,
      tasklist: '"node.exe","1234","Console","1","85 000 K"\r\n',
    }),
  });

  const result = await launcher.restart();
  assert.equal(result.ok, true);
  assert.equal(result.started, true, "fresh owned start after the explicit restart");
  assert.deepEqual(commands.map(([file, args]) => [file, args]), [
    ["netstat.exe", ["-ano"]],
    ["tasklist.exe", ["/FI", "PID eq 1234", "/FO", "CSV", "/NH"]],
    ["taskkill.exe", ["/PID", "1234", "/T", "/F"]],
  ], "only the listener is killed, with its tree; the client connection on 777 is not");
  assert.equal(spawnCount, 1, "an owned Harness is booted");
});

// Without a post-kill check the new launch's first readiness probe was answered by the
// instance that was supposed to be gone, and the restart reported a success it never had.
test("a restart whose port holder survives reports failure instead of success", async () => {
  const commands = [];
  let spawnCount = 0;
  let probeCount = 0;
  const launcher = createHarnessLauncher({
    harnessUrl: "http://127.0.0.1:3080",
    platform: "win32",
    env: {},
    spawnProcess: () => { spawnCount += 1; return fakeChild(); },
    probeReady: async () => { probeCount += 1; return true; },
    delay: async () => {},
    stopAttempts: 4,
    runCommand: recordingRunCommand(commands, {
      netstat: NETSTAT_3080,
      // taskkill failed (access denied, say); the old instance keeps answering.
      fail: (name) => name === "taskkill.exe",
    }),
  });

  assert.deepEqual(await launcher.restart(), { ok: false, started: false, reason: "restart-failed" });
  assert.equal(probeCount, 4, "the wait for the port to free is bounded");
  assert.equal(spawnCount, 0, "no second instance is booted onto a busy port");
});

test("a restart off Windows cannot stop a foreign Harness and says so", async () => {
  const commands = [];
  const signals = [];
  let spawnCount = 0;
  const launcher = createHarnessLauncher({
    harnessUrl: "http://127.0.0.1:3080",
    platform: "linux",
    env: {},
    spawnProcess: () => { spawnCount += 1; return fakeChild(); },
    probeReady: async () => true,
    delay: async () => {},
    runCommand: recordingRunCommand(commands),
    killProcess: (pid, signal) => signals.push([pid, signal]),
  });

  assert.deepEqual(await launcher.restart(), { ok: false, started: false, reason: "restart-unsupported" });
  assert.equal(spawnCount, 0);
  assert.deepEqual(commands, []);
  assert.deepEqual(signals, []);
});

test("a restart leaves a port holder that is not a Harness alone", async () => {
  const commands = [];
  let spawnCount = 0;
  const launcher = createHarnessLauncher({
    harnessUrl: "http://127.0.0.1:3080",
    platform: "win32",
    env: {},
    spawnProcess: () => { spawnCount += 1; return fakeChild(); },
    probeReady: async () => true,
    delay: async () => {},
    runCommand: recordingRunCommand(commands, {
      netstat: NETSTAT_3080,
      tasklist: '"postgres.exe","1234","Services","0","12 000 K"\r\n',
    }),
  });

  assert.deepEqual(await launcher.restart(), {
    ok: false,
    started: false,
    reason: "restart-failed",
    blockedBy: ["postgres.exe"],
  });
  assert.equal(commands.some(([file]) => file === "taskkill.exe"), false);
  assert.equal(spawnCount, 0);
});

test("a restart with a remote Harness URL never touches local processes", async () => {
  const commands = [];
  const launcher = createHarnessLauncher({
    harnessUrl: "https://harness.example.test:3080",
    platform: "win32",
    env: {},
    spawnProcess: () => { throw new Error("must not spawn"); },
    probeReady: async () => true,
    delay: async () => {},
    runCommand: recordingRunCommand(commands, { netstat: NETSTAT_3080 }),
  });

  assert.deepEqual(await launcher.restart(), { ok: false, started: false, reason: "remote-url" });
  assert.deepEqual(commands, []);
});

// Probe answers in order; once the script runs out the port keeps answering.
function scriptedProbe(answers) {
  const queue = [...answers];
  return async () => (queue.length > 0 ? queue.shift() : true);
}

function pidChildren(firstPid) {
  const children = [];
  return {
    children,
    spawnProcess() {
      const child = fakeChild();
      child.pid = firstPid + children.length;
      child.kill = () => { throw new Error("child.kill only reaches the command processor"); };
      children.push(child);
      return child;
    },
  };
}

test("an owned launch is restarted by killing its whole tree", async () => {
  const commands = [];
  const { children, spawnProcess } = pidChildren(4000);
  const launcher = createHarnessLauncher({
    harnessUrl: "http://127.0.0.1:3080",
    platform: "win32",
    env: {},
    fileSystem: { existsSync: () => false, mkdirSync: () => {} },
    spawnProcess,
    // start: down, then up. restart: gone after the kill, then the new one is up.
    probeReady: scriptedProbe([false, true, false, true]),
    delay: async () => {},
    runCommand: recordingRunCommand(commands),
  });
  assert.equal((await launcher.start()).started, true);

  const result = await launcher.restart();
  assert.equal(result.ok, true);
  assert.equal(result.started, true);
  assert.deepEqual(commands[0].slice(0, 2), ["taskkill.exe", ["/PID", "4000", "/T", "/F"]]);
  assert.equal(children.length, 2, "a fresh instance replaces the killed tree");
});

test("a token probe is reaped as a tree and its verdict is reused for a while", async () => {
  const commands = [];
  let spawnCount = 0;
  let clock = 1000;
  const launcher = createHarnessLauncher({
    harnessUrl: "http://127.0.0.1:3080",
    platform: "win32",
    env: {},
    fileSystem: { existsSync: () => false, mkdirSync: () => {} },
    spawnProcess: () => {
      spawnCount += 1;
      const child = fakeChild();
      child.pid = 5000 + spawnCount;
      return child;
    },
    probeReady: async () => true,
    delay: async () => {},
    now: () => clock,
    tokenProbeCacheMs: 30000,
    runCommand: recordingRunCommand(commands),
  });

  assert.equal((await launcher.start()).reason, "token-required");
  assert.deepEqual(commands.map(([file, args]) => [file, args]), [["taskkill.exe", ["/PID", "5001", "/T", "/F"]]],
    "the npx/node grandchild dies with the probe instead of leaking");
  clock += 29999;
  assert.equal((await launcher.start()).reason, "token-required");
  assert.equal(spawnCount, 1, "a repeated Start inside the window does not spawn another probe");
  clock += 1;
  assert.equal((await launcher.start()).reason, "token-required");
  assert.equal(spawnCount, 2, "the verdict expires");
});

test("a POSIX probe is reaped through its process group", async () => {
  const signals = [];
  const launcher = createHarnessLauncher({
    harnessUrl: "http://127.0.0.1:3080",
    platform: "darwin",
    env: {},
    spawnProcess: () => {
      const child = fakeChild();
      child.pid = 321;
      child.kill = () => { throw new Error("child.kill only reaches the login shell"); };
      return child;
    },
    probeReady: async () => true,
    delay: async () => {},
    runCommand: recordingRunCommand([]),
    killProcess: (pid, signal) => signals.push([pid, signal]),
  });

  assert.equal((await launcher.start()).reason, "token-required");
  assert.deepEqual(signals, [[-321, "SIGTERM"]]);
});

test("dispose reaps probes and unready launches but keeps a ready Harness unless asked", async () => {
  const commands = [];
  const make = (probeReady, firstPid) => createHarnessLauncher({
    harnessUrl: "http://127.0.0.1:3080",
    platform: "win32",
    env: {},
    fileSystem: { existsSync: () => false, mkdirSync: () => {} },
    spawnProcess: pidChildren(firstPid).spawnProcess,
    probeReady,
    delay: async () => {},
    readinessAttempts: 1,
    runCommand: recordingRunCommand(commands),
  });

  // A launch that never became ready is a leak once the app is gone.
  const stuck = make(async () => false, 6000);
  await assert.rejects(stuck.start(), /startup timeout/);
  assert.equal(await stuck.dispose(), 1);
  assert.deepEqual(commands.map(([file, args, options]) => [file, args, options.detached]), [
    ["taskkill.exe", ["/PID", "6000", "/T", "/F"], true],
  ], "the quit-time kill is detached so it outlives the app");
  assert.deepEqual(await stuck.start(), { ok: false, started: false, reason: "disposed" });

  // A ready owned Harness is meant to outlive the widget; the caller can still ask.
  commands.length = 0;
  const owned = make(scriptedProbe([false, true]), 7000);
  assert.equal((await owned.start()).started, true);
  assert.equal(await owned.dispose(), 0);
  assert.deepEqual(commands, []);
  assert.equal(await owned.dispose({ stopOwnedHarness: true }), 1);
  assert.deepEqual(commands.map(([file, args]) => [file, args]), [["taskkill.exe", ["/PID", "7000", "/T", "/F"]]]);
});

test("a launch that dies before becoming ready drops its captured token", async () => {
  const child = fakeChild();
  child.stdout = new EventEmitter();
  const launcher = createHarnessLauncher({
    harnessUrl: "http://127.0.0.1:3080",
    platform: "win32",
    env: {},
    fileSystem: { existsSync: () => false, mkdirSync: () => {} },
    spawnProcess: () => child,
    probeReady: async () => false,
    delay: () => new Promise((resolve) => setImmediate(resolve)),
    readinessAttempts: 50,
    runCommand: recordingRunCommand([]),
  });
  const starting = launcher.start();
  await new Promise((resolve) => setImmediate(resolve));
  child.stdout.emit("data", "dsh web: http://127.0.0.1:3080/?token=doomed\n");
  assert.equal(launcher.browserUrl(), "http://127.0.0.1:3080/?token=doomed");
  child.emit("exit", 1);
  await assert.rejects(starting, /exited before becoming ready/);
  assert.equal(launcher.browserUrl(), "", "a dead launch's token must not shadow the saved launch URL");
});

test("netstat and tasklist output is parsed without trusting localized text", () => {
  // Localized headers (Russian Windows) and a localized state column must not hide the
  // listener; the wildcard foreign address identifies it.
  const localized = [
    "Активные подключения",
    "  Имя    Локальный адрес        Внешний адрес          Состояние       PID",
    "  TCP    0.0.0.0:3080           0.0.0.0:0              ПРОСЛУШИВАНИЕ   3820",
    "  TCP    [::]:3080              [::]:0                 ПРОСЛУШИВАНИЕ   3820",
    "  TCP    127.0.0.1:30800        0.0.0.0:0              LISTENING       99",
    "  TCP    127.0.0.1:3080         127.0.0.1:51000        ESTABLISHED     3820",
    "  UDP    0.0.0.0:3080           *:*                                    55",
  ].join("\r\n");
  assert.deepEqual(listeningPidsFromNetstat(localized, 3080), [3820]);
  assert.deepEqual(listeningPidsFromNetstat("", 3080), []);
  assert.equal(imageNameFromTasklist('"node.exe","3820","Console","1","856 320 КБ"\r\n', 3820), "node.exe");
  assert.equal(imageNameFromTasklist("Информация: задачи, отвечающие заданным критериям, отсутствуют.", 3820), "");
  assert.equal(imageNameFromTasklist('"node.exe","1","Console","1","1 K"', 3820), "");
});

test("the port kill only runs on Windows and reports what it did", async () => {
  const commands = [];
  assert.deepEqual(await killProcessOnPort(3080, { platform: "linux", runCommand: recordingRunCommand(commands) }), {
    supported: false, killed: [], skipped: [], failed: [],
  });
  assert.deepEqual(commands, []);
  const report = await killProcessOnPort(3080, {
    platform: "win32",
    env: {},
    selfPid: 999,
    runCommand: recordingRunCommand(commands, { netstat: NETSTAT_3080, tasklist: () => "" }),
  });
  assert.deepEqual(report, { supported: true, killed: [1234], skipped: [], failed: [] },
    "an unidentifiable holder of the Harness port is still stopped");
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

test("first installed dsh wins across roots (unary RPC only works on the older host)", () => {
  const first = path.win32.join("C:\\first", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
  const second = path.win32.join("C:\\second", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
  const fileSystem = { existsSync: (candidate) => candidate === first || candidate === second };
  assert.equal(resolveInstalledDshEntry({
    platform: "win32",
    env: { SystemDrive: "C:", DSH_WIDGET_HARNESS_RUNTIME: "C:\\first", APPDATA: "C:\\second" },
    workingDirectory: "C:\\other",
    fileSystem,
  }), first);
});

test("readiness probe accepts the gated browser index as up", async () => {
  assert.equal(await defaultProbeReady("http://127.0.0.1:3080", async () => ({ ok: true, status: 200 })), true);
  assert.equal(await defaultProbeReady("http://127.0.0.1:3080", async () => ({
    ok: false,
    status: 401,
    text: async () => "dsh web authentication required; reopen the URL printed by dsh web.\n",
  })), true);
  assert.equal(await defaultProbeReady("http://127.0.0.1:3080", async () => ({
    ok: false,
    status: 401,
    text: async () => "unauthorized",
  })), false);
  assert.equal(await defaultProbeReady("http://127.0.0.1:3080", async () => ({ ok: false, status: 500 })), false);
  assert.equal(await defaultProbeReady("http://127.0.0.1:3080", async () => { throw new Error("down"); }), false);
  assert.equal(await defaultProbeReady("http://127.0.0.1:3080", null), false);
});

test("launch browser URL is parsed from the dsh web banner", () => {
  assert.equal(
    extractLaunchBrowserUrl("dsh web: http://127.0.0.1:3080/?token=abc123\n"),
    "http://127.0.0.1:3080/?token=abc123",
  );
  assert.equal(extractLaunchBrowserUrl("dsh web: http://127.0.0.1:3080"), "http://127.0.0.1:3080");
  assert.equal(extractLaunchBrowserUrl("dsh web: (http://127.0.0.1:3080/?token=x)."), "http://127.0.0.1:3080/?token=x");
  assert.equal(extractLaunchBrowserUrl("something else"), "");
  assert.equal(extractLaunchBrowserUrl(""), "");
});

test("owned launch exposes the captured browser URL until exit", async () => {
  const child = fakeChild();
  child.stdout = new EventEmitter();
  let ready = false;
  let spawned = null;
  const launcher = createHarnessLauncher({
    harnessUrl: "http://127.0.0.1:3080",
    platform: "win32",
    env: {},
    fileSystem: { existsSync: () => false, mkdirSync: () => {} },
    spawnProcess() { spawned = child; return child; },
    probeReady: async () => ready,
    delay: () => new Promise((resolve) => setImmediate(resolve)),
    readinessAttempts: 4,
  });
  assert.equal(launcher.browserUrl(), "");
  const started = launcher.start();
  while (!spawned) await new Promise((resolve) => setImmediate(resolve));
  child.stdout.emit("data", "dsh web: http://127.0.0.1:3080/?token=");
  assert.equal(launcher.browserUrl(), "", "a split banner line must not freeze a truncated token");
  child.stdout.emit("data", "tok123\n");
  ready = true;
  assert.deepEqual((await started).ok, true);
  assert.equal(launcher.browserUrl(), "http://127.0.0.1:3080/?token=tok123");
  child.emit("exit", 0);
  assert.equal(launcher.browserUrl(), "http://127.0.0.1:3080/?token=tok123",
    "captured token persists after the probe child exits so the API can still authenticate");
});

test("forgetting the browser URL drops a dead banner token that would shadow a pasted one", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.unref = () => {};
  const launcher = createHarnessLauncher({
    harnessUrl: "http://127.0.0.1:3080",
    platform: "win32",
    env: {},
    fileSystem: { existsSync: () => false, mkdirSync: () => {} },
    spawnProcess: () => child,
    probeReady: async () => true,
    delay: async () => {},
  });
  const starting = launcher.start();
  queueMicrotask(() => child.stdout.emit("data", "dsh web: http://127.0.0.1:3080/?token=dead\n"));
  assert.deepEqual(await starting, { ok: true, started: false, alreadyRunning: true });
  assert.equal(launcher.browserUrl(), "http://127.0.0.1:3080/?token=dead");
  assert.equal(launcher.forgetBrowserUrl(), true);
  assert.equal(launcher.browserUrl(), "", "Connect must mint from the pasted URL, not the dead banner");
});
