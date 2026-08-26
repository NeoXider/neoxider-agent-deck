const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const HARNESS_NPX_ARGS = Object.freeze(["--yes", "@deepseek-ai/dsh@latest", "web", "--no-open"]);
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function isLocalHarnessUrl(value) {
  try {
    const url = new URL(String(value));
    return new Set(["http:", "https:"]).has(url.protocol) && LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function resolveHarnessLaunchSpec({ platform = process.platform, env = process.env, harnessUrl = "http://127.0.0.1:3080" } = {}) {
  const configured = typeof env.DSH_WIDGET_HARNESS_EXECUTABLE === "string"
    ? env.DSH_WIDGET_HARNESS_EXECUTABLE.trim()
    : "";
  const args = [...HARNESS_NPX_ARGS];
  try {
    const url = new URL(harnessUrl);
    if (url.port && url.port !== "3080") args.push("--port", url.port);
    if (["::1", "[::1]"].includes(url.hostname.toLowerCase())) args.push("--host", "::1");
  } catch {}
  if (configured) return { command: configured, args, displayCommand: configured };
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
  return {
    command: "npx",
    args,
    displayCommand: "npx",
  };
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
} = {}) {
  const launchSpec = resolveHarnessLaunchSpec({ platform, env, harnessUrl });
  const legacyBatchPath = platform === "win32" && desktopPath
    ? path.join(desktopPath, "Запустить DeepSeek Harness.bat")
    : "";
  let startPromise = null;

  async function waitUntilReady(getLaunchError) {
    for (let attempt = 0; attempt < readinessAttempts; attempt += 1) {
      const launchError = getLaunchError?.();
      if (launchError) throw launchError;
      if (await probeReady()) return true;
      if (attempt + 1 < readinessAttempts) await delay(readinessInterval);
    }
    return false;
  }

  async function startLegacyFallback() {
    if (!legacyBatchPath || typeof openPath !== "function" || !fileSystem.existsSync(legacyBatchPath)) return null;
    const errorMessage = await openPath(legacyBatchPath);
    if (errorMessage) throw new Error(errorMessage);
    const ready = await waitUntilReady();
    if (!ready) throw new Error("DeepSeek Harness did not become ready after the legacy launcher opened");
    return { ok: true, started: true, fallback: "windows-batch", command: legacyBatchPath };
  }

  async function startInternal() {
    if (!isLocalHarnessUrl(harnessUrl)) {
      return { ok: false, started: false, reason: "remote-url" };
    }
    if (await probeReady()) {
      return { ok: true, started: false, alreadyRunning: true };
    }
    if (new URL(harnessUrl).protocol !== "http:") {
      return { ok: false, started: false, reason: "unsupported-local-protocol" };
    }

    let launchError = null;
    try {
      if (workingDirectory) fileSystem.mkdirSync(workingDirectory, { recursive: true });
      const child = spawnProcess(launchSpec.command, launchSpec.args, {
        ...(workingDirectory ? { cwd: workingDirectory } : {}),
        detached: true,
        shell: false,
        stdio: "ignore",
        windowsHide: true,
      });
      child.once?.("error", (error) => { launchError = error; });
      child.once?.("exit", (code) => {
        if (code !== null && code !== 0) launchError = new Error(`Harness launcher exited with code ${code}`);
      });
      child.unref?.();
      const ready = await waitUntilReady(() => launchError);
      if (!ready) throw new Error("DeepSeek Harness did not become ready before the startup timeout");
      return { ok: true, started: true, fallback: null, command: launchSpec.displayCommand };
    } catch (error) {
      const fallback = await startLegacyFallback();
      if (fallback) return fallback;
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
  HARNESS_NPX_ARGS,
  createHarnessLauncher,
  defaultProbeReady,
  isLocalHarnessUrl,
  resolveHarnessLaunchSpec,
};
