const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const HARNESS_NPX_ARGS = Object.freeze(["--yes", "@deepseek-ai/dsh@latest", "web", "--no-open"]);
const HARNESS_DIRECT_ARGS = Object.freeze(["web", "--no-open"]);
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

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

async function defaultProbeReady(harnessUrl, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") return false;
  try {
    const response = await fetchImpl(harnessUrl, { method: "GET", signal: AbortSignal.timeout(1500) });
    return Boolean(response?.ok);
  } catch {
    return false;
  }
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
} = {}) {
  const installedEntry = resolveInstalledDshEntry({ platform, env, workingDirectory, fileSystem });
  const launchSpec = resolveHarnessLaunchSpec({ platform, env, harnessUrl, installedEntry });
  const legacyBatchPath = platform === "win32" && desktopPath
    ? path.join(desktopPath, "Запустить DeepSeek Harness.bat")
    : "";
  let startPromise = null;
  let ownedLaunch = null;

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

  function spawnOwnedLaunch() {
    if (workingDirectory) fileSystem.mkdirSync(workingDirectory, { recursive: true });
    const launch = { child: null, error: null, exited: false, ready: false };
    const childEnv = { ...env };
    delete childEnv.ELECTRON_RUN_AS_NODE;
    const child = spawnProcess(launchSpec.command, launchSpec.args, {
      ...(workingDirectory ? { cwd: workingDirectory } : {}),
      detached: true,
      env: childEnv,
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    });
    launch.child = child;
    child.once?.("error", (error) => {
      launch.error = error;
      launch.exited = true;
    });
    child.once?.("exit", (code) => {
      launch.exited = true;
      if (launch.ready) return;
      launch.error = new Error(`Harness launcher exited before becoming ready (code ${code})`);
    });
    child.unref?.();
    ownedLaunch = launch;
    return launch;
  }

  async function startInternal() {
    if (!isLocalHarnessUrl(harnessUrl)) {
      return { ok: false, started: false, reason: "remote-url" };
    }
    if (await probeReady()) {
      if (ownedLaunch) ownedLaunch.ready = true;
      return { ok: true, started: false, alreadyRunning: true };
    }
    if (new URL(harnessUrl).protocol !== "http:") {
      return { ok: false, started: false, reason: "unsupported-local-protocol" };
    }

    if (ownedLaunch?.exited) ownedLaunch = null;
    const deadline = now() + readinessAttempts * readinessInterval;
    let launch = ownedLaunch;
    try {
      if (!launch) launch = spawnOwnedLaunch();
      const ready = await waitUntilReady(() => launch.error, deadline);
      if (!ready) throw new Error("DeepSeek Harness did not become ready before the startup timeout");
      launch.ready = true;
      return { ok: true, started: true, fallback: null, command: launchSpec.displayCommand };
    } catch (error) {
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
    start() {
      if (startPromise) return startPromise;
      startPromise = startInternal().finally(() => { startPromise = null; });
      return startPromise;
    },
  };
}

module.exports = {
  HARNESS_DIRECT_ARGS,
  HARNESS_NPX_ARGS,
  createHarnessLauncher,
  defaultProbeReady,
  isLocalHarnessUrl,
  resolveDshNodeExecutable,
  resolveInstalledDshEntry,
  resolveHarnessLaunchSpec,
};
