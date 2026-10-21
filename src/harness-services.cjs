// The Harness-side services Deck composes in main: which Harness it follows (its own or
// DSH Desktop's), what it can do to sessions and their background work, and which Harness
// versions are running and available. main.cjs only creates this and hands it to IPC.
//
// Launch tokens stay in the main process: the renderer is told which Harness it is on and
// whether the other one runs, never how to get into either.
const { spawn } = require("node:child_process");
const { createDshDesktopLocator, installedDesktopVersion, latestDesktopVersion } = require("./dsh-desktop.cjs");
const { createHarnessTarget } = require("./harness-target.cjs");
const { createHarnessTasks } = require("./harness-tasks.cjs");
const { listenerDshEntry } = require("./harness-process.cjs");
const { compareVersions, versionOfEntry } = require("./harness-runtime.cjs");

const DESKTOP_UPDATE_CHECK_MS = 6 * 60 * 60 * 1000;

function publicTargetState(state, desktopUpdate) {
  const desktop = state?.desktop || {};
  return {
    preference: state?.preference || "auto",
    kind: state?.kind || "web",
    url: state?.url || "",
    webRunning: Boolean(state?.webRunning),
    desktop: { installed: Boolean(desktop.installed), running: Boolean(desktop.running), url: desktop.url || "", canOpen: Boolean(desktop.executable) },
    desktopUpdate: desktopUpdate ? { ...desktopUpdate } : null,
  };
}

function createHarnessServices({
  api,
  webUrl,
  runtime = null,
  getLauncher = () => null,
  getPreferences,
  savePreferences = () => {},
  probeReady,
  onSwitch = async () => {},
  send = () => {},
  fetchImpl = globalThis.fetch,
  platform = process.platform,
  env = process.env,
  runCommand = undefined,
  spawnProcess = spawn,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
} = {}) {
  if (!api || !webUrl) throw new TypeError("the Harness API and its address are required");
  const locator = createDshDesktopLocator({ platform, env, probe: probeReady });
  let desktopUpdate = null;
  let desktopTimer = null;
  const publish = (state) => send("harness-target", publicTargetState(state, desktopUpdate));
  const target = createHarnessTarget({
    webUrl,
    locator,
    probeWeb: probeReady,
    getPreference: () => getPreferences()?.harnessTarget,
    onSwitch: async (state) => { await onSwitch(state); detectRunningVersion().catch(() => {}); },
    onState: publish,
    setTimer,
    clearTimer,
  });
  const tasks = createHarnessTasks({ api });

  // The Harness serving on Deck's own port, by the dsh entry its process runs.
  async function detectRunningVersion() {
    if (!runtime) return "";
    const owned = getLauncher()?.runningEntry?.() || "";
    const port = Number(new URL(webUrl).port) || 3080;
    const entry = owned || await listenerDshEntry(port, { platform, env, ...(runCommand ? { runCommand } : {}) });
    const version = versionOfEntry(entry);
    runtime.setRunning(version);
    return version;
  }

  async function checkDesktopUpdate() {
    const desktop = target.state().desktop || locator.current();
    if (!desktop?.installed) {
      desktopUpdate = null;
      return null;
    }
    const [installed, latest] = await Promise.all([
      installedDesktopVersion({ platform, executable: desktop.executable, ...(runCommand ? { runCommand } : { runCommand: defaultPowerShell }) }),
      latestDesktopVersion(fetchImpl).catch(() => ""),
    ]);
    desktopUpdate = { installed, latest, available: Boolean(installed && latest && compareVersions(latest, installed) > 0) };
    publish(target.state());
    return { ...desktopUpdate };
  }

  async function setTarget(value) {
    const preferences = getPreferences();
    preferences.harnessTarget = ["auto", "web", "desktop"].includes(value) ? value : "auto";
    savePreferences();
    const state = await target.refresh();
    return publicTargetState(state, desktopUpdate);
  }

  // Starts DSH Desktop; it starts its own Harness, which the next refresh finds.
  async function openDesktop() {
    const desktop = await locator.locate();
    if (!desktop.executable) throw new Error("DSH Desktop is not installed on this computer");
    const command = platform === "darwin" ? "open" : desktop.executable;
    const args = platform === "darwin" ? ["-a", desktop.executable] : [];
    const child = spawnProcess(command, args, { detached: true, stdio: "ignore", windowsHide: false });
    child.on?.("error", () => {});
    child.unref?.();
    for (const delay of [4000, 10000, 20000]) setTimer(() => { target.refresh().catch(() => {}); }, delay);
    return { ok: true };
  }

  function start() {
    const first = target.start();
    first.then(() => detectRunningVersion()).catch(() => {});
    setTimer(() => { checkDesktopUpdate().catch(() => {}); }, 15000);
    if (!desktopTimer) desktopTimer = setIntervalFn(() => { checkDesktopUpdate().catch(() => {}); }, DESKTOP_UPDATE_CHECK_MS);
    return first;
  }

  function stop() {
    target.stop();
    if (desktopTimer) clearIntervalFn(desktopTimer);
    desktopTimer = null;
  }

  return {
    start,
    stop,
    tasks,
    target,
    setTarget,
    openDesktop,
    detectRunningVersion,
    checkDesktopUpdate,
    // What the API mints its cookie from on DSH Desktop's Harness; "" on Deck's own.
    desktopLaunchUrl: () => (target.kind() === "desktop" ? target.launchUrl() : ""),
    onDesktop: () => target.kind() === "desktop",
    state: () => publicTargetState(target.state(), desktopUpdate),
  };
}

function defaultPowerShell(file, args) {
  return new Promise((resolve) => {
    require("node:child_process").execFile(file, args, { encoding: "utf8", timeout: 8000, windowsHide: true }, (error, stdout) => resolve({ stdout: String(stdout || ""), error }));
  });
}

module.exports = { createHarnessServices, publicTargetState };
