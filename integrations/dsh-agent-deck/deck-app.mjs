import { execFile, spawn } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, readSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const PRODUCT_DIR = "NeoXider Agent Deck";
export const WINDOWS_EXECUTABLE = "NeoXider Agent Deck.exe";
export const MAC_BUNDLE = "NeoXider Agent Deck.app";
export const LINUX_EXECUTABLE = "neoxider-agent-deck";
export const USER_DATA_SEGMENTS = ["NeoXider", "AgentDeck"];
export const PATH_OVERRIDE_ENV = "NEOXIDER_AGENT_DECK_PATH";
export const WINDOW_MODES = ["full", "orb", "edge"];
/** The names the app shows, keyed by the mode it stores in widget-settings.json. */
export const MODE_LABELS = { full: "chat", orb: "avatar", edge: "hinge" };
export const ASAR_HEADER_MAX_BYTES = 16 * 1024 * 1024;
export const ASAR_ENTRY_MAX_BYTES = 1024 * 1024;

function homeDirectory(env) {
  return env.HOME || env.USERPROFILE || homedir();
}

export function userDataDirectory({ platform = process.platform, env = process.env, home = homeDirectory(env) } = {}) {
  if (platform === "win32") {
    return join(env.APPDATA || join(home, "AppData", "Roaming"), ...USER_DATA_SEGMENTS);
  }
  if (platform === "darwin") {
    return join(home, "Library", "Application Support", ...USER_DATA_SEGMENTS);
  }
  return join(env.XDG_CONFIG_HOME || join(home, ".config"), ...USER_DATA_SEGMENTS);
}

function candidate(executable, { launchKind, asarPath, source }) {
  return { executable, installDir: launchKind === "bundle" ? executable : dirname(executable), asarPath, launchKind, source };
}

/**
 * Ordered places the packaged app can live, best first. The env override is a
 * single explicit path and wins outright; everything after it is a default
 * install location for the platform.
 */
export function candidateLocations({ platform = process.platform, env = process.env, home = homeDirectory(env), fileExists = existsSync } = {}) {
  const found = [];
  const override = typeof env[PATH_OVERRIDE_ENV] === "string" ? env[PATH_OVERRIDE_ENV].trim() : "";
  if (override) {
    if (platform === "darwin" && override.endsWith(".app")) {
      found.push(candidate(override, { launchKind: "bundle", asarPath: join(override, "Contents", "Resources", "app.asar"), source: PATH_OVERRIDE_ENV }));
    } else {
      found.push(candidate(override, { launchKind: "binary", asarPath: join(dirname(override), "resources", "app.asar"), source: PATH_OVERRIDE_ENV }));
    }
    return found;
  }

  if (platform === "win32") {
    const roots = [env.LOCALAPPDATA && join(env.LOCALAPPDATA, "Programs"), env.LOCALAPPDATA, env.ProgramFiles, env["ProgramFiles(x86)"]].filter(Boolean);
    for (const root of roots) {
      const executable = join(root, PRODUCT_DIR, WINDOWS_EXECUTABLE);
      if (fileExists(executable)) found.push(candidate(executable, { launchKind: "binary", asarPath: join(dirname(executable), "resources", "app.asar"), source: root }));
    }
    return found;
  }

  if (platform === "darwin") {
    for (const root of ["/Applications", join(home, "Applications")]) {
      const bundle = join(root, MAC_BUNDLE);
      if (fileExists(bundle)) found.push(candidate(bundle, { launchKind: "bundle", asarPath: join(bundle, "Contents", "Resources", "app.asar"), source: root }));
    }
    return found;
  }

  const binaries = [
    join(home, ".local", "bin", LINUX_EXECUTABLE),
    join("/usr", "bin", LINUX_EXECUTABLE),
    join("/opt", PRODUCT_DIR, LINUX_EXECUTABLE),
    join("/opt", LINUX_EXECUTABLE, LINUX_EXECUTABLE),
  ];
  for (const executable of binaries) {
    if (fileExists(executable)) found.push(candidate(executable, { launchKind: "binary", asarPath: join(dirname(executable), "resources", "app.asar"), source: dirname(executable) }));
  }
  return found;
}

/**
 * README version from an Electron asar archive. The container is a 16-byte
 * prefix (payload size at 12), a JSON header, then the entry payloads; offsets
 * in the header are relative to the end of the header.
 */
export function readAsarVersion(asarPath) {
  let fd;
  try {
    fd = openSync(asarPath, "r");
    const sizeBuffer = Buffer.alloc(16);
    readSync(fd, sizeBuffer, 0, 16, 0);
    const headerSize = sizeBuffer.readUInt32LE(12);
    if (!Number.isFinite(headerSize) || headerSize <= 0 || headerSize > ASAR_HEADER_MAX_BYTES) return null;
    const headerBuffer = Buffer.alloc(headerSize);
    readSync(fd, headerBuffer, 0, headerSize, 16);
    const header = JSON.parse(headerBuffer.toString("utf8").replace(/\0+$/, ""));
    const entry = header && header.files && header.files["package.json"];
    if (!entry || typeof entry.offset !== "string") return null;
    const start = 16 + headerSize + Number(entry.offset);
    const length = Number(entry.size);
    if (!Number.isFinite(start) || !Number.isFinite(length) || length <= 0 || length > ASAR_ENTRY_MAX_BYTES) return null;
    const payload = Buffer.alloc(length);
    readSync(fd, payload, 0, length, start);
    const manifest = JSON.parse(payload.toString("utf8"));
    return typeof manifest.version === "string" ? manifest.version : null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {}
    }
  }
}

/** Scheme/host/port of a Harness launch URL. The query carries the session token, so it never leaves this process. */
export function originOf(rawUrl) {
  if (typeof rawUrl !== "string" || rawUrl.trim() === "") return null;
  try {
    const url = new URL(rawUrl.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname) return null;
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

export function readWidgetSettings({ platform = process.platform, env = process.env, home = homeDirectory(env), fileExists = existsSync, readFile = readFileSync } = {}) {
  const directory = userDataDirectory({ platform, env, home });
  const file = join(directory, "widget-settings.json");
  const result = { path: file, found: false, harnessOrigin: null, harnessLaunchUrlConfigured: false, deviceAccessEnabled: null, size: null, windowLayer: null, windowMode: null };
  if (!fileExists(file)) return result;
  try {
    const text = readFile ? String(readFile(file)) : "";
    if (text.trim() === "") return result;
    const settings = JSON.parse(text);
    result.found = true;
    result.harnessOrigin = originOf(settings.harnessLaunchUrl);
    result.harnessLaunchUrlConfigured = typeof settings.harnessLaunchUrl === "string" && settings.harnessLaunchUrl.trim() !== "";
    result.deviceAccessEnabled = typeof settings.deviceAccessEnabled === "boolean" ? settings.deviceAccessEnabled : null;
    result.size = typeof settings.size === "string" ? settings.size : null;
    result.windowLayer = typeof settings.windowLayer === "string" ? settings.windowLayer : null;
    result.windowMode = WINDOW_MODES.includes(settings.windowState?.mode) ? settings.windowState.mode : null;
  } catch {
    result.found = true;
  }
  return result;
}

function parseWindowsTasklist(stdout) {
  const text = String(stdout || "").toLowerCase();
  return text.includes(WINDOWS_EXECUTABLE.toLowerCase());
}

function parsePosixProcessList(stdout) {
  const text = String(stdout || "").toLowerCase();
  return text.includes(MAC_BUNDLE.toLowerCase()) || text.split(/\r?\n/).some((line) => line.trim().endsWith(` ${LINUX_EXECUTABLE}`));
}

/** Whether a Deck process is alive. `null` means the check itself failed, not that the app is closed. */
export function detectRunning({ platform = process.platform, execFileImpl = execFile, timeout = 4000 } = {}) {
  return new Promise((resolve) => {
    const finish = (value) => resolve(value);
    const onDone = (error, stdout) => {
      if (error) return finish({ running: null, error: error.message || String(error) });
      finish({ running: platform === "win32" ? parseWindowsTasklist(stdout) : parsePosixProcessList(stdout), error: null });
    };
    try {
      if (platform === "win32") {
        execFileImpl("tasklist", ["/FI", `IMAGENAME eq ${WINDOWS_EXECUTABLE}`, "/NH", "/FO", "CSV"], { timeout, windowsHide: true }, onDone);
      } else {
        execFileImpl("ps", ["-A", "-o", "pid=,comm="], { timeout, windowsHide: true }, onDone);
      }
    } catch (error) {
      finish({ running: null, error: error instanceof Error ? error.message : String(error) });
    }
  });
}

/**
 * Start the app. Deck holds a single-instance lock, so a second launch only
 * raises the window that is already running; the env override below is read
 * only by a fresh process.
 */
export function launchDeck({ location, platform = process.platform, harnessUrl = null, spawnImpl = spawn, env = process.env, spawnTimeout = 5000 } = {}) {
  if (!location || !location.executable) throw new Error("No NeoXider Agent Deck installation was found");
  const bundle = platform === "darwin" && location.launchKind === "bundle";
  const command = bundle ? "/usr/bin/open" : location.executable;
  const args = bundle && harnessUrl ? ["-a", location.executable, "--env", `DSH_WIDGET_URL=${harnessUrl}`] : bundle ? ["-a", location.executable] : [];
  const childEnv = { ...env };
  if (harnessUrl) childEnv.DSH_WIDGET_URL = harnessUrl;

  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else {
        child.unref?.();
        resolve({ pid: child.pid ?? null, command });
      }
    };
    const timer = setTimeout(() => settle(), spawnTimeout);
    timer.unref?.();
    const child = spawnImpl(command, args, { detached: true, stdio: "ignore", windowsHide: true, env: childEnv });
    child.once("spawn", () => settle());
    child.once("error", (error) => settle(error));
  });
}

export function validHarnessUrl(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname) return null;
    if (url.username || url.password) return null;
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}
