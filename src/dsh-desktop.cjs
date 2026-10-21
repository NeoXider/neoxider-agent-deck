// DSH Desktop, the official desktop app for DeepSeek Harness, runs a Harness of its own.
//
// It is the same `dsh web` server Deck talks to, started by the desktop app with its own
// home (`<userData>/harness`, so its sessions and settings are separate from `~/.dsh`) on
// 127.0.0.1:43129, or on a temporary port when that one is taken. Like any gated Harness
// it prints `dsh web: http://127.0.0.1:<port>/?token=...` once it serves, and the desktop
// app copies every line of that output into its own log. That log is how Deck finds it:
// the newest `[desktop] endpoint` line says where the current launch listens, and the
// first `dsh web:` line after it carries the launch token for that launch only.
//
// Deck never starts, restarts or stops this Harness - the desktop app owns it - and the
// file is only ever read, from its tail.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_DESKTOP_PORT = 43129;
const LOG_TAIL_BYTES = 256 * 1024;

function desktopDataDirectory({ platform = process.platform, env = process.env, homedir = os.homedir() } = {}) {
  if (platform === "win32") return env.APPDATA ? path.win32.join(env.APPDATA, "dsh-desktop") : "";
  if (platform === "darwin") return path.posix.join(homedir, "Library", "Application Support", "dsh-desktop");
  return path.posix.join(env.XDG_CONFIG_HOME || path.posix.join(homedir, ".config"), "dsh-desktop");
}

function desktopLogPath(options = {}) {
  const directory = desktopDataDirectory(options);
  if (!directory) return "";
  return (options.platform || process.platform) === "win32"
    ? path.win32.join(directory, "logs", "harness.log")
    : path.posix.join(directory, "logs", "harness.log");
}

// Where the app itself is installed, to start it from Deck. Empty when it is not there.
function desktopExecutablePath({ platform = process.platform, env = process.env, fileSystem = fs } = {}) {
  const candidates = platform === "win32"
    ? [env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, "Programs", "DSH Desktop", "DSH Desktop.exe"),
      env.ProgramFiles && path.win32.join(env.ProgramFiles, "DSH Desktop", "DSH Desktop.exe")]
    : platform === "darwin" ? ["/Applications/DSH Desktop.app"] : [];
  return candidates.find((candidate) => candidate && fileSystem.existsSync(candidate)) || "";
}

function loopbackUrl(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]", "::1"].includes(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

// The current launch, read from the log: the last endpoint line, and the launch URL that
// the same launch printed after it. A launch that has not printed its URL yet yields the
// endpoint alone; an older launch's token is never paired with a newer endpoint.
function parseDesktopLaunch(text) {
  const lines = String(text || "").split(/\r?\n/);
  let endpointIndex = -1;
  let endpoint = null;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = /\[desktop\] endpoint (http:\/\/\S+)/.exec(lines[index]);
    if (match && loopbackUrl(match[1])) {
      endpointIndex = index;
      endpoint = loopbackUrl(match[1]);
      break;
    }
  }
  if (!endpoint) return null;
  const startedAt = Date.parse((/^\[([^\]]+)\]/.exec(lines[endpointIndex]) || [])[1] || "") || null;
  let launchUrl = "";
  for (let index = endpointIndex + 1; index < lines.length; index += 1) {
    const match = /\bdsh web:\s*(http:\/\/\S+)/.exec(lines[index]);
    const url = match && loopbackUrl(match[1]);
    if (url && url.port === endpoint.port && url.searchParams.get("token")) {
      launchUrl = url.href;
      break;
    }
  }
  return { url: `http://127.0.0.1:${endpoint.port}`, port: Number(endpoint.port), launchUrl, startedAt };
}

function readTail(filePath, fileSystem = fs, bytes = LOG_TAIL_BYTES) {
  let handle = null;
  try {
    handle = fileSystem.openSync(filePath, "r");
    const size = fileSystem.fstatSync(handle).size;
    const length = Math.min(size, bytes);
    const buffer = Buffer.alloc(length);
    fileSystem.readSync(handle, buffer, 0, length, size - length);
    return buffer.toString("utf8");
  } catch {
    return "";
  } finally {
    if (handle !== null) try { fileSystem.closeSync(handle); } catch {}
  }
}

// The newest DSH Desktop release, from the feed its own updater reads.
const DESKTOP_UPDATE_FEED = "https://dshdesktop.com/updates/latest/latest.yml";
async function latestDesktopVersion(fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(DESKTOP_UPDATE_FEED, { redirect: "follow", signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`DSH Desktop update feed answered ${response.status}`);
  const match = /^version:\s*["']?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/m.exec(await response.text());
  if (!match) throw new Error("DSH Desktop update feed has no version");
  return match[1];
}

// The installed app's version: the Windows file version, or the macOS bundle's.
async function installedDesktopVersion({ platform = process.platform, executable = "", runCommand = null, fileSystem = fs } = {}) {
  if (!executable) return "";
  try {
    if (platform === "darwin") {
      const plist = fileSystem.readFileSync(path.posix.join(executable, "Contents", "Info.plist"), "utf8");
      return (/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(plist) || [])[1] || "";
    }
    if (platform !== "win32" || typeof runCommand !== "function") return "";
    const quoted = executable.replace(/'/g, "''");
    const result = await runCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `(Get-Item -LiteralPath '${quoted}').VersionInfo.ProductVersion`]);
    const version = String(result?.stdout || "").trim().replace(/^(\d+\.\d+\.\d+)\.0$/, "$1");
    return /^\d+\.\d+\.\d+/.test(version) ? version : "";
  } catch {
    return "";
  }
}

// Where DSH Desktop's Harness is, whether it answers, and how to get in.
function createDshDesktopLocator({
  platform = process.platform,
  env = process.env,
  homedir = os.homedir(),
  fileSystem = fs,
  probe = async () => false,
} = {}) {
  const logPath = desktopLogPath({ platform, env, homedir });
  let last = { installed: false, running: false, url: `http://127.0.0.1:${DEFAULT_DESKTOP_PORT}`, launchUrl: "", checkedAt: 0 };

  async function locate() {
    const executable = desktopExecutablePath({ platform, env, fileSystem });
    const launch = logPath ? parseDesktopLaunch(readTail(logPath, fileSystem)) : null;
    const url = launch?.url || `http://127.0.0.1:${DEFAULT_DESKTOP_PORT}`;
    const running = await probe(url).catch(() => false);
    last = {
      installed: Boolean(executable || launch),
      executable,
      running: Boolean(running),
      url,
      // Without a running Harness the token of its last launch is worthless.
      launchUrl: running ? launch?.launchUrl || "" : "",
      startedAt: launch?.startedAt || null,
      checkedAt: Date.now(),
    };
    return { ...last };
  }

  return { locate, current: () => ({ ...last }), logPath };
}

module.exports = {
  DEFAULT_DESKTOP_PORT,
  DESKTOP_UPDATE_FEED,
  createDshDesktopLocator,
  installedDesktopVersion,
  latestDesktopVersion,
  desktopDataDirectory,
  desktopExecutablePath,
  desktopLogPath,
  parseDesktopLaunch,
  readTail,
};
