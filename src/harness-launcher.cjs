const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFile } = require("node:child_process");

const HARNESS_NPX_ARGS = Object.freeze(["--yes", "@deepseek-ai/dsh@latest", "web", "--no-open"]);
const HARNESS_DIRECT_ARGS = Object.freeze(["web", "--no-open"]);
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
// Image names a Harness listener legitimately runs under. A restart only kills a port
// holder whose image is one of these (plus the configured launch executable).
const HARNESS_IMAGE_NAMES = Object.freeze(["node.exe", "node", "dsh.exe", "dsh"]);
const COMMAND_TIMEOUT_MS = 5000;
// How long a "token-required" verdict is reused. Each Start click used to spawn a whole
// npx/dsh tree just to learn the same answer again.
const TOKEN_PROBE_CACHE_MS = 30000;

function isLocalHarnessUrl(value) {
  try {
    const url = new URL(String(value));
    return new Set(["http:", "https:"]).has(url.protocol) && LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function resolveInstalledDshEntry({ platform = process.platform, env = process.env, workingDirectory = "", fileSystem = fs } = {}) {
  const systemDrive = typeof env.SystemDrive === "string" && /^[A-Za-z]:$/.test(env.SystemDrive)
    ? env.SystemDrive
    : "C:";
  // This function is parameterised by platform, so it must build paths for THAT
  // platform rather than for whichever one happens to be running it. Using the native
  // path module here produced mixed separators when a win32 layout was resolved from
  // POSIX, which is why the launcher suite could never pass on macOS or Linux.
  const platformPath = platform === "win32" ? path.win32 : path.posix;
  const roots = [
    env.DSH_WIDGET_HARNESS_RUNTIME,
    workingDirectory,
    // LOCALAPPDATA and APPDATA only ever describe a Windows layout.
    env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, "NeoXider", "DeepSeek Harness Runtime"),
    env.APPDATA && path.win32.join(env.APPDATA, "npm"),
    platform === "win32" ? path.win32.join(systemDrive, "AI", "work", "deepseek-harness-runtime") : "",
  ].filter((value) => typeof value === "string" && value.trim());
  for (const root of roots) {
    const candidates = [
      platformPath.join(root, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"),
      platformPath.join(root, "node_modules", "@deepseek-ai", "dsh", "dist", "bin.js"),
    ];
    for (const candidate of candidates) {
      if (fileSystem.existsSync(candidate)) return candidate;
    }
  }
  return "";
}

function appendHarnessAddressArgs(args, harnessUrl) {
  const next = [...args];
  try {
    const url = new URL(harnessUrl);
    if (url.port && url.port !== "3080") next.push("--port", url.port);
    if (["::1", "[::1]"].includes(url.hostname.toLowerCase())) next.push("--host", "::1");
  } catch {}
  return next;
}

function resolveDshNodeExecutable({ platform = process.platform, env = process.env } = {}) {
  const configured = typeof env.DSH_WIDGET_NODE_EXECUTABLE === "string"
    ? env.DSH_WIDGET_NODE_EXECUTABLE.trim()
    : "";
  return configured || (platform === "win32" ? "node.exe" : "node");
}

function resolveHarnessLaunchSpec({ platform = process.platform, env = process.env, harnessUrl = "http://127.0.0.1:3080", installedEntry = "" } = {}) {
  const configured = typeof env.DSH_WIDGET_HARNESS_EXECUTABLE === "string"
    ? env.DSH_WIDGET_HARNESS_EXECUTABLE.trim()
    : "";
  const directArgs = appendHarnessAddressArgs(HARNESS_DIRECT_ARGS, harnessUrl);
  if (configured) return { command: configured, args: directArgs, displayCommand: configured };
  if (installedEntry) {
    return {
      command: resolveDshNodeExecutable({ platform, env }),
      args: [installedEntry, ...directArgs],
      displayCommand: installedEntry,
    };
  }
  const args = appendHarnessAddressArgs(HARNESS_NPX_ARGS, harnessUrl);
  if (platform === "win32") {
    const commandProcessor = env.ComSpec || (env.SystemRoot
      ? path.win32.join(env.SystemRoot, "System32", "cmd.exe")
      : "cmd.exe");
    return {
      command: commandProcessor,
      args: ["/d", "/s", "/c", "npx.cmd", ...args],
      displayCommand: "npx.cmd",
    };
  }
  // An app started from Finder, a .desktop launcher or systemd inherits a minimal
  // PATH that has no nvm/homebrew npx, so spawning "npx" directly fails with ENOENT.
  // The Windows branch above already goes through a command processor; do the same
  // here with a login shell so the user's real PATH is loaded first.
  const loginShell = typeof env.SHELL === "string" && env.SHELL.trim() ? env.SHELL.trim() : "/bin/sh";
  return {
    command: loginShell,
    args: ["-lc", ["npx", ...args].map(shellQuote).join(" ")],
    displayCommand: "npx",
  };
}

function shellQuote(value) {
  const text = String(value);
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(text) ? text : "'" + text.split("'").join("'\''") + "'";
}

// Every shell-out the launcher makes goes through here, and it never rejects: the
// caller decides what a failure means (restart re-probes the port rather than trusting
// an exit code). These used to be execSync calls on the Electron main thread, so a slow
// netstat or taskkill froze the whole widget for up to five seconds each.
function defaultRunCommand(file, args, { timeout = COMMAND_TIMEOUT_MS, detached = false } = {}) {
  return new Promise((resolve) => {
    if (!detached) {
      execFile(file, args, { encoding: "utf8", timeout, windowsHide: true }, (error, stdout) => {
        resolve({ stdout: String(stdout || ""), error: error || null });
      });
      return;
    }
    // libuv puts every non-detached child into a kill-on-close job on Windows, so a
    // taskkill started from quit cleanup would die with the app before reaping anything.
    try {
      const child = spawn(file, args, { detached: true, stdio: "ignore", windowsHide: true });
      child.once("error", (error) => resolve({ stdout: "", error }));
      child.once("exit", (code) => resolve({ stdout: "", error: code === 0 ? null : new Error(`${file} exited with code ${code}`) }));
      child.unref();
    } catch (error) {
      resolve({ stdout: "", error });
    }
  });
}

// Absolute System32 paths: a bare name is searched in the current directory first on
// Windows, so a stray netstat.exe or taskkill.exe there would run instead.
function windowsTool(name, env = process.env) {
  const root = typeof env?.SystemRoot === "string" ? env.SystemRoot.trim() : "";
  return root ? path.win32.join(root, "System32", `${name}.exe`) : `${name}.exe`;
}

// `netstat -ano` rows: Proto, Local, Foreign, State, PID. The column headers are
// localized and so is the state on some Windows builds, which is why a wildcard foreign
// address also counts as listening. Only the local address decides the port, so a
// client connection to the Harness is never mistaken for the Harness itself.
function listeningPidsFromNetstat(output, port) {
  const pids = new Set();
  for (const line of String(output || "").split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5 || parts[0].toUpperCase() !== "TCP") continue;
    const [, local, foreign, state, pidText] = parts;
    if (!local.endsWith(`:${port}`)) continue;
    const listening = state.toUpperCase() === "LISTENING" || /^(?:0\.0\.0\.0|\[::\]):0$/.test(foreign);
    const pid = Number.parseInt(pidText, 10);
    if (listening && pid > 0) pids.add(pid);
  }
  return [...pids];
}

// `tasklist /FO CSV /NH` prints `"node.exe","1234",...`; a PID with no match prints a
// localized notice instead. Anything unparseable is "unknown", not "foreign".
function imageNameFromTasklist(output, pid) {
  for (const line of String(output || "").split(/\r?\n/)) {
    const match = /^"([^"]+)","(\d+)"/.exec(line.trim());
    if (match && Number(match[2]) === pid) return match[1];
  }
  return "";
}

// Stop whatever listens on the Harness port. Used by an explicit, user-confirmed
// restart when a foreign Harness holds the port and its launch token is unreachable.
// The holder's image is checked first so an unrelated program that happens to own the
// port is left alone. When the image cannot be established (tasklist failed or timed
// out) the kill still goes ahead: the port is the configured Harness port and the user
// asked for the restart, and refusing would make restart useless on a machine where
// tasklist is unavailable. Only Windows is supported; the report says so and the caller
// re-probes the port instead of assuming the kill worked.
async function killProcessOnPort(port, {
  platform = process.platform,
  env = process.env,
  runCommand = defaultRunCommand,
  imageNames = HARNESS_IMAGE_NAMES,
  selfPid = process.pid,
} = {}) {
  const report = { supported: platform === "win32", killed: [], skipped: [], failed: [] };
  if (!report.supported) return report;
  const listing = await runCommand(windowsTool("netstat", env), ["-ano"]);
  const allowed = new Set([...imageNames].map((name) => String(name).toLowerCase()));
  for (const pid of listeningPidsFromNetstat(listing.stdout, port)) {
    if (pid === selfPid) continue;
    const lookup = await runCommand(windowsTool("tasklist", env), ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"]);
    const image = imageNameFromTasklist(lookup.stdout, pid);
    if (image && !allowed.has(image.toLowerCase())) {
      report.skipped.push({ pid, image });
      continue;
    }
    const result = await runCommand(windowsTool("taskkill", env), ["/PID", String(pid), "/T", "/F"]);
    (result.error ? report.failed : report.killed).push(pid);
  }
  return report;
}

async function defaultProbeReady(harnessUrl, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") return false;
  try {
    const response = await fetchImpl(harnessUrl, { method: "GET", signal: AbortSignal.timeout(1500) });
    if (response?.ok) return true;
    // dsh >= 0.1.2 gates the browser index behind a per-boot launch token
    // (HTTP 401 with a fixed body) while /api and the mux stay open. A 401
    // carrying that body proves OUR harness is up; anything else is not ready.
    if (response?.status === 401) {
      const body = await response.text().catch(() => "");
      return String(body).includes("dsh web authentication required");
    }
    return false;
  } catch {
    return false;
  }
}

// dsh prints `dsh web: <url>` (token included on gated hosts) once the index
// is served. Capturing it lets open-harness hand the browser a URL that works
// on the first visit instead of the 401 page.
function extractLaunchBrowserUrl(text) {
  const match = /dsh web:\s*["'(]?(https?:\/\/\S+)/.exec(String(text || ""));
  if (!match) return "";
  return match[1].replace(/[)\].,;'"]+$/, "");
}

// The banner line can arrive split across stdout chunks, so a URL is only
// accepted once its line ends — otherwise the first chunk would freeze a
// truncated token into browserUrl and later chunks would be ignored.
function extractCompleteLaunchBrowserUrl(buffered) {
  const match = /dsh web:\s*["'(]?(https?:\/\/\S+)/.exec(String(buffered || ""));
  if (!match) return "";
  const after = String(buffered).slice(match.index + match[0].length);
  if (!/[\r\n]/.test(after)) return "";
  return match[1].replace(/[)\].,;'"]+$/, "");
}

function createHarnessLauncher({
  harnessUrl,
  platform = process.platform,
  env = process.env,
  desktopPath = "",
  workingDirectory = "",
  fileSystem = fs,
  spawnProcess = spawn,
  openPath = null,
  probeReady = () => defaultProbeReady(harnessUrl),
  delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  readinessAttempts = 60,
  readinessInterval = 500,
  now = () => Date.now(),
  // Injected so tests never shell out to netstat/tasklist/taskkill or signal real
  // processes on the host.
  runCommand = defaultRunCommand,
  killProcess = (pid, signal) => process.kill(pid, signal),
  // After an explicit restart kills the port holder, the port must stop answering
  // before a new instance is booted; this bounds that wait.
  stopAttempts = 20,
  stopInterval = 250,
  tokenProbeCacheMs = TOKEN_PROBE_CACHE_MS,
} = {}) {
  const installedEntry = resolveInstalledDshEntry({ platform, env, workingDirectory, fileSystem });
  const launchSpec = resolveHarnessLaunchSpec({ platform, env, harnessUrl, installedEntry });
  // This path only ever describes a Windows desktop, so it must be built with the
  // win32 rules even when the process resolving it runs on POSIX.
  const legacyBatchPath = platform === "win32" && desktopPath
    ? path.win32.join(desktopPath, "Запустить DeepSeek Harness.bat")
    : "";
  // A configured dsh or Node executable is the listener's image too; the npx route goes
  // through a command processor, and the listener under it is plain node.
  const listenerImageNames = /^npx(?:\.cmd)?$/.test(launchSpec.displayCommand)
    ? [...HARNESS_IMAGE_NAMES]
    : [...HARNESS_IMAGE_NAMES, path.win32.basename(launchSpec.command)];
  let startPromise = null;
  let ownedLaunch = null;
  let capturedBrowserUrl = "";
  // Every spawned child that has not exited yet, probes included, so dispose() can reap
  // the ones nothing else references any more.
  const liveLaunches = new Set();
  let tokenRequiredUntil = 0;
  let disposed = false;

  // A launch that dies (or never serves) before becoming ready has a token nobody can
  // use, and the captured token outranks the saved launch URL in every reader, so a dead
  // instance would make a good saved URL look broken. A probe is exempt: it only ever
  // reports on the instance that already holds the port, and exiting is its job.
  function dropLaunchToken(launch) {
    if (!launch || launch.probe || launch.ready) return;
    if (launch.browserUrl && capturedBrowserUrl === launch.browserUrl) capturedBrowserUrl = "";
  }

  function markReady(launch) {
    launch.ready = true;
    if (launch.browserUrl) capturedBrowserUrl = launch.browserUrl;
  }

  // child.kill() only reaches the direct child: cmd.exe on Windows and the login shell
  // on POSIX, leaving the npx/node grandchild running with the port or the probe's
  // console. The launch is spawned detached, so on POSIX it leads its own process group.
  // A launch whose direct child already exited is skipped: its PID may be reused by now.
  async function killLaunchTree(launch, { detached = false } = {}) {
    const child = launch?.child;
    if (!child || launch.exited) return;
    const pid = Number(child.pid);
    if (Number.isInteger(pid) && pid > 0) {
      if (platform === "win32") {
        const result = await runCommand(windowsTool("taskkill", env), ["/PID", String(pid), "/T", "/F"], { detached });
        if (!result?.error) return;
      } else {
        try { killProcess(-pid, "SIGTERM"); return; } catch {}
      }
    }
    try { if (typeof child.kill === "function") child.kill(); } catch {}
  }

  // One deadline covers the whole start, including the legacy fallback. Each wait used
  // to get its own full budget, so a failed launch held the start-harness IPC call for
  // twice the advertised timeout with no answer and no progress for the renderer.
  async function waitUntilReady(getLaunchError, deadline = Number.POSITIVE_INFINITY) {
    for (let attempt = 0; attempt < readinessAttempts; attempt += 1) {
      const launchError = getLaunchError?.();
      if (launchError) throw launchError;
      if (await probeReady()) return true;
      if (now() >= deadline) return false;
      if (attempt + 1 < readinessAttempts) await delay(readinessInterval);
    }
    return false;
  }

  async function startLegacyFallback(deadline) {
    if (!legacyBatchPath || typeof openPath !== "function" || !fileSystem.existsSync(legacyBatchPath)) return null;
    const errorMessage = await openPath(legacyBatchPath);
    if (errorMessage) throw new Error(errorMessage);
    const ready = await waitUntilReady(undefined, deadline);
    if (!ready) throw new Error("DeepSeek Harness did not become ready after the legacy launcher opened");
    return { ok: true, started: true, fallback: "windows-batch", command: legacyBatchPath };
  }

  function spawnOwnedLaunch({ probe = false } = {}) {
    // A start that was already under way when the app quit must not leave a new tree.
    if (disposed) throw new Error("Harness launcher is disposed");
    if (workingDirectory) fileSystem.mkdirSync(workingDirectory, { recursive: true });
    const launch = { child: null, error: null, exited: false, ready: false, browserUrl: "", probe };
    const childEnv = { ...env };
    delete childEnv.ELECTRON_RUN_AS_NODE;
    const child = spawnProcess(launchSpec.command, launchSpec.args, {
      ...(workingDirectory ? { cwd: workingDirectory } : {}),
      detached: true,
      env: childEnv,
      shell: false,
      // stdout stays piped (not ignored) so the launch URL with the browser
      // token can be captured; the drain below keeps the pipe from ever
      // blocking the child once the URL is known.
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    launch.child = child;
    if (child.stdout && typeof child.stdout.on === "function") {
      let buffered = "";
      child.stdout.on("data", (chunk) => {
        if (launch.browserUrl) return;
        buffered = `${buffered}${String(chunk)}`.slice(-4096);
        const found = extractCompleteLaunchBrowserUrl(buffered);
        if (found) { launch.browserUrl = found; capturedBrowserUrl = found; }
      });
    }
    liveLaunches.add(launch);
    child.once?.("error", (error) => {
      launch.error = error;
      launch.exited = true;
      liveLaunches.delete(launch);
      dropLaunchToken(launch);
    });
    child.once?.("exit", (code) => {
      launch.exited = true;
      liveLaunches.delete(launch);
      if (launch.ready) return;
      launch.error = new Error(`Harness launcher exited before becoming ready (code ${code})`);
      dropLaunchToken(launch);
    });
    child.unref?.();
    ownedLaunch = launch;
    return launch;
  }

  // After the port holder is killed, the old instance must actually stop answering;
  // otherwise the new launch's first readiness probe is answered by the survivor and a
  // restart that changed nothing reports success.
  async function waitUntilStopped(attempts) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (!(await probeReady())) return true;
      if (attempt + 1 < attempts) await delay(stopInterval);
    }
    return false;
  }

  function unsupportedTarget() {
    if (!isLocalHarnessUrl(harnessUrl)) {
      return { ok: false, started: false, reason: "remote-url" };
    }
    if (new URL(harnessUrl).protocol !== "http:") {
      return { ok: false, started: false, reason: "unsupported-local-protocol" };
    }
    return null;
  }

  async function startInternal({ forceRestart = false } = {}) {
    const unsupported = unsupportedTarget();
    if (unsupported) return unsupported;
    if (!forceRestart && await probeReady()) {
      if (ownedLaunch && !ownedLaunch.exited) { markReady(ownedLaunch); return { ok: true, started: false, alreadyRunning: true }; }
      if (now() < tokenRequiredUntil) return { ok: false, started: false, reason: "token-required" };
      // The harness is reachable but we never captured its launch token (foreign
      // or inherited process). Spawn a dsh just to grab the token from its banner
      // line — it will exit almost immediately when it finds the port occupied.
      const probe = spawnOwnedLaunch({ probe: true });
      for (let i = 0; i < 20 && !probe.browserUrl && !probe.exited; i += 1) await delay(250);
      if (probe.browserUrl) {
        if (ownedLaunch === probe) probe.ready = true;
        return { ok: true, started: false, alreadyRunning: true };
      }
      // The second dsh did not print the banner, so its token is unreachable from
      // here. Killing a foreign Harness with live turns would destroy work the
      // user can see in the browser, so Start stops here: the widget offers to
      // connect with a pasted launch URL, or to restart Harness explicitly.
      if (ownedLaunch === probe) ownedLaunch = null;
      await killLaunchTree(probe);
      tokenRequiredUntil = now() + tokenProbeCacheMs;
      return { ok: false, started: false, reason: "token-required" };
    }
    tokenRequiredUntil = 0;
    return bootOwned();
  }

  // Explicit, user-confirmed restart: stop whatever holds the port — including a
  // foreign Harness with live turns — and boot a fresh owned instance that
  // prints its launch token to our captured stdout. Never runs implicitly.
  async function restartInternal() {
    // Checked before anything is killed: a remote Harness URL used to reach the port
    // kill below and stop whatever local process shared its port number.
    const unsupported = unsupportedTarget();
    if (unsupported) return unsupported;
    tokenRequiredUntil = 0;
    const port = parseInt(new URL(harnessUrl).port, 10) || 3080;
    const previous = ownedLaunch;
    ownedLaunch = null;
    const killedOwned = Boolean(previous && !previous.exited);
    if (killedOwned) await killLaunchTree(previous);
    const report = await killProcessOnPort(port, { platform, env, runCommand, imageNames: listenerImageNames });
    // With nothing killed there is nothing to wait for: one probe tells whether the
    // port is already free.
    const attempted = killedOwned || report.killed.length > 0 || report.failed.length > 0;
    if (!(await waitUntilStopped(attempted ? stopAttempts : 1))) {
      return {
        ok: false,
        started: false,
        reason: report.supported ? "restart-failed" : "restart-unsupported",
        ...(report.skipped.length > 0 ? { blockedBy: report.skipped.map((entry) => entry.image) } : {}),
      };
    }
    // The instance that printed the captured token is gone now; the new one prints its own.
    capturedBrowserUrl = "";
    return startInternal({ forceRestart: true });
  }

  // forceRestart skips the already-running fast path: the caller already
  // confirmed that the current holder of the port may go.
  async function bootOwned() {
    if (ownedLaunch?.exited) ownedLaunch = null;
    // A probe was spawned while another instance held the port, so it cannot be the
    // server now that the port is free; waiting on it would only burn the deadline.
    if (ownedLaunch?.probe) {
      const stale = ownedLaunch;
      ownedLaunch = null;
      await killLaunchTree(stale);
    }
    const deadline = now() + readinessAttempts * readinessInterval;
    let launch = ownedLaunch;
    try {
      if (!launch) launch = spawnOwnedLaunch();
      const ready = await waitUntilReady(() => launch.error, deadline);
      if (!ready) throw new Error("DeepSeek Harness did not become ready before the startup timeout");
      markReady(launch);
      return { ok: true, started: true, fallback: null, command: launchSpec.displayCommand };
    } catch (error) {
      // A launch that is still alive after the timeout keeps its own token (browserUrl()
      // reads it from the live launch, and a later Retry promotes it again); only the
      // copy that would outlive it is dropped.
      dropLaunchToken(launch);
      const definiteFailure = Boolean(launch?.error || launch?.exited || !launch);
      if (definiteFailure) {
        if (ownedLaunch === launch) ownedLaunch = null;
        const fallback = await startLegacyFallback(deadline);
        if (fallback) return fallback;
      }
      throw error;
    }
  }

  return {
    launchSpec,
    legacyBatchPath,
    workingDirectory,
    // Browser URL of the owned launch, token included when the host prints
    // one. Empty for foreign (already-running) instances whose token was
    // never observed, and once the owned child exits.
    browserUrl() {
      if (ownedLaunch && !ownedLaunch.exited && ownedLaunch.browserUrl) return ownedLaunch.browserUrl;
      return capturedBrowserUrl || "";
    },
    // Forget a captured banner token. It outranks the saved preference in every reader
    // and is never cleared on its own, so a token scraped from a launch that is now
    // dead would shadow a launch URL the user has just proved by pasting it.
    forgetBrowserUrl() {
      capturedBrowserUrl = "";
      if (ownedLaunch) ownedLaunch.browserUrl = "";
      return true;
    },
    start() {
      if (disposed) return Promise.resolve({ ok: false, started: false, reason: "disposed" });
      if (startPromise) return startPromise;
      startPromise = startInternal().finally(() => { startPromise = null; });
      return startPromise;
    },
    restart() {
      if (disposed) return Promise.resolve({ ok: false, started: false, reason: "disposed" });
      if (startPromise) return startPromise;
      startPromise = restartInternal().finally(() => { startPromise = null; });
      return startPromise;
    },
    // Reap what this launcher spawned; meant for the app's quit cleanup, which cannot
    // wait, so Windows kills run through a detached taskkill that outlives the app. The
    // returned promise settles when the kills finish, for callers that can wait.
    // Probes and launches that never became ready are always reaped. A READY owned
    // Harness is left running unless stopOwnedHarness is set: it is meant to outlive
    // the widget (its launch URL is persisted so the next run reconnects to it), and
    // killing it would end live turns the user can see in the browser.
    dispose({ stopOwnedHarness = false } = {}) {
      disposed = true;
      const doomed = [...liveLaunches].filter((launch) => launch.probe || !launch.ready || stopOwnedHarness);
      for (const launch of doomed) {
        liveLaunches.delete(launch);
        if (ownedLaunch === launch) ownedLaunch = null;
      }
      return Promise.all(doomed.map((launch) => killLaunchTree(launch, { detached: true }).catch(() => {})))
        .then(() => doomed.length);
    },
  };
}

module.exports = {
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
};
