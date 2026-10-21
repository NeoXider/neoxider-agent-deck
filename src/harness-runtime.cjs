// Installs and updates the DeepSeek Harness runtime that Deck starts.
//
// Deck keeps its own runtimes, one directory per version under `<root>/versions/`,
// installed with npm:
//
// - none at all: the stable runtime is installed in the background, so the offline
//   banner's Start has something to start;
// - one installed: npm is asked for the newest STABLE release (the `latest` dist-tag)
//   every few hours. A newer one is announced, not installed behind the user's back: a
//   runtime is the better part of a gigabyte, and the switch cuts off running agents, so
//   "Update" in Deck installs it next to the running one and restarts Harness onto it.
//
// Deck used to follow the channel of whatever was installed, so an alpha stayed on alpha
// and never heard of the release candidates published as `latest` above it. Alphas are
// never offered now; an installed alpha is replaced by the first stable release newer
// than it.
//
// A running Harness is never touched. Its files stay where they are, the new version waits
// in its own directory, and the launcher starts the newest installed one the next time it
// starts Harness.
//
// An install that does not finish leaves nothing the launcher could start: the version
// directory carries a marker until npm succeeds and is removed when it fails. One install
// that ran out of disk space used to leave `lib/bin.js` without the rest of the package,
// and that half runtime would have been the newest one the next restart picked.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const RUNTIME_PACKAGE = "@deepseek-ai/dsh";
const REGISTRY_URL = "https://registry.npmjs.org/@deepseek-ai%2Fdsh";
const STABLE_TAG = "latest";
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const KEEP_VERSIONS = 2;
const INSTALLING_MARKER = ".deck-installing";
// One runtime is about 830 MB on disk, and npm's cache grows while it installs.
const MIN_FREE_BYTES = 1200 * 1024 * 1024;

function runtimeRoot({ platform = process.platform, env = process.env, homedir = os.homedir() } = {}) {
  if (platform === "win32" && env.LOCALAPPDATA) return path.win32.join(env.LOCALAPPDATA, "NeoXider", "DeepSeek Harness Runtime");
  return path.posix.join(homedir, ".neoxider", "dsh-runtime");
}

// Semver order, prereleases included: 0.2.1-alpha.4 > 0.2.1-alpha.2 > 0.2.0 > 0.2.0-rc.2.
function compareVersions(left, right) {
  const parse = (value) => {
    const text = String(value || "");
    const dash = text.indexOf("-");
    const core = dash < 0 ? text : text.slice(0, dash);
    const pre = dash < 0 ? "" : text.slice(dash + 1);
    return { core: core.split(".").map((part) => Number(part) || 0), pre: pre ? pre.split(".") : [] };
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) if (a.core[index] !== b.core[index]) return a.core[index] < b.core[index] ? -1 : 1;
  if (!a.pre.length || !b.pre.length) return a.pre.length === b.pre.length ? 0 : a.pre.length ? -1 : 1;
  for (let index = 0; index < Math.max(a.pre.length, b.pre.length); index += 1) {
    const x = a.pre[index];
    const y = b.pre[index];
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    if (x === y) continue;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) return Number(x) < Number(y) ? -1 : 1;
    if (xn !== yn) return xn ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

// What kind of build a version is, for the label in Settings. Updates always follow
// the stable tag whatever this says.
function channelOf(version) {
  return /-alpha\b/i.test(String(version || "")) ? "alpha" : "latest";
}

function entryIn(directory, fileSystem = fs, platformPath = path) {
  for (const candidate of [["lib", "bin.js"], ["dist", "bin.js"]]) {
    const file = platformPath.join(directory, "node_modules", "@deepseek-ai", "dsh", ...candidate);
    if (fileSystem.existsSync(file)) return file;
  }
  return "";
}

function versionIn(directory, fileSystem = fs, platformPath = path) {
  try {
    return JSON.parse(fileSystem.readFileSync(platformPath.join(directory, "node_modules", "@deepseek-ai", "dsh", "package.json"), "utf8")).version || "";
  } catch {
    return "";
  }
}

// A runtime counts only when it is whole: its entry, its own package.json, and no marker
// of an install still running or cut short.
function completeRuntime(directory, fileSystem, platformPath) {
  if (fileSystem.existsSync(platformPath.join(directory, INSTALLING_MARKER))) return null;
  const entry = entryIn(directory, fileSystem, platformPath);
  const version = entry ? versionIn(directory, fileSystem, platformPath) : "";
  return entry && VERSION_PATTERN.test(version) ? { version, directory, entry } : null;
}

// Every runtime Deck can start, newest first: the per-version installs, then a runtime
// installed straight into the root (how the first installs were laid out).
function installedRuntimes(root, fileSystem = fs, platformPath = path) {
  const found = [];
  let names = [];
  try { names = fileSystem.readdirSync(platformPath.join(root, "versions")); } catch {}
  for (const name of Array.isArray(names) ? names : []) {
    if (!VERSION_PATTERN.test(String(name))) continue;
    const runtime = completeRuntime(platformPath.join(root, "versions", String(name)), fileSystem, platformPath);
    if (runtime) found.push(runtime);
  }
  const rootRuntime = completeRuntime(root, fileSystem, platformPath);
  if (rootRuntime) found.push(rootRuntime);
  return found.sort((left, right) => compareVersions(right.version, left.version));
}

function newestRuntimeEntry(root, fileSystem = fs, platformPath = path) {
  return installedRuntimes(root, fileSystem, platformPath)[0]?.entry || "";
}

// The version a dsh entry belongs to, read from the package next to it: `.../dsh/lib/bin.js`.
function versionOfEntry(entry, fileSystem = fs) {
  const text = String(entry || "");
  if (!text) return "";
  const fromPath = () => text.match(/[\\/]versions[\\/](\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)[\\/]/)?.[1] || "";
  // A path this platform cannot read as absolute (a Windows one on Linux) put the package.json
  // lookup in the working directory, and reported the version of whatever project ran there.
  if (!path.isAbsolute(text)) return fromPath();
  try {
    const version = JSON.parse(fileSystem.readFileSync(path.join(path.dirname(path.dirname(text)), "package.json"), "utf8")).version || "";
    return VERSION_PATTERN.test(version) ? version : "";
  } catch {
    return fromPath();
  }
}

// Free bytes on the drive that holds `directory` (or the nearest existing parent).
function defaultFreeBytes(directory, fileSystem = fs) {
  let probe = directory;
  for (let depth = 0; depth < 8 && probe; depth += 1) {
    try {
      const stats = fileSystem.statfsSync(probe);
      return Number(stats.bavail) * Number(stats.bsize);
    } catch {
      const parent = path.dirname(probe);
      if (parent === probe) break;
      probe = parent;
    }
  }
  return Infinity;
}

function megabytes(bytes) {
  return `${Math.max(0, Math.floor(bytes / 1048576))} MB`;
}

// npm runs with the version directory as its working directory and a package.json of its
// own there, or it would walk up and install into the root. Arguments carry no paths, so
// the Windows shell npm needs never has to quote anything.
function defaultRunNpm(args, { cwd, timeoutMs = INSTALL_TIMEOUT_MS, onOutput = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", args, { cwd, shell: process.platform === "win32", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let tail = "";
    const collect = (chunk) => {
      const text = String(chunk);
      tail = (tail + text).slice(-4000);
      onOutput(text);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timer = setTimeout(() => { try { child.kill(); } catch {} reject(new Error("npm install timed out")); }, timeoutMs);
    child.on("error", (error) => { clearTimeout(timer); reject(error.code === "ENOENT" ? new Error("npm was not found: install Node.js to let Deck install Harness") : error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(tail);
      else if (/ENOSPC|no space left/i.test(tail)) reject(new Error("the disk ran out of space while npm installed Harness"));
      else reject(new Error(tail.trim().split(/\r?\n/).slice(-3).join(" ") || `npm exited with ${code}`));
    });
  });
}

function createHarnessRuntime({
  root = runtimeRoot(),
  fetchImpl = globalThis.fetch,
  runNpm = defaultRunNpm,
  fileSystem = fs,
  freeBytes = (directory) => defaultFreeBytes(directory, fileSystem),
  onState = () => {},
  now = () => Date.now(),
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
} = {}) {
  let state = { installed: "", running: "", channel: "latest", latest: "", installing: "", error: "", checkedAt: 0, ready: "" };
  let timer = null;
  let busy = null;
  let installing = null;

  function publish(next, { emit = true } = {}) {
    state = { ...state, ...next };
    const runtimes = installedRuntimes(root, fileSystem);
    // `installed` is what the launcher will start next; `running` is reported by main.
    state.installed = runtimes[0]?.version || "";
    state.channel = state.installed ? channelOf(state.installed) : "latest";
    const current = state.running || state.installed;
    state.updateAvailable = Boolean(state.latest && current && compareVersions(state.latest, current) > 0);
    // Installed beside the running one and waiting for the restart that switches to it.
    if (state.running && state.installed && compareVersions(state.installed, state.running) > 0) state.ready = state.installed;
    else if (state.running && state.ready && compareVersions(state.ready, state.running) <= 0) state.ready = "";
    if (emit) try { onState({ ...state }); } catch {}
    return { ...state };
  }

  async function latestStable() {
    const response = await fetchImpl(REGISTRY_URL, { headers: { accept: "application/vnd.npm.install-v1+json" } });
    if (!response.ok) throw new Error(`npm registry answered ${response.status}`);
    const body = await response.json();
    const version = body?.["dist-tags"]?.[STABLE_TAG] || "";
    if (!VERSION_PATTERN.test(version)) throw new Error("npm registry gave no usable version");
    return version;
  }

  async function installVersion(version) {
    if (!VERSION_PATTERN.test(String(version || ""))) throw new Error("Not a Harness version");
    const directory = path.join(root, "versions", version);
    if (completeRuntime(directory, fileSystem, path)) return publish({ installing: "", error: "", ready: version });
    const free = freeBytes(root);
    if (Number.isFinite(free) && free < MIN_FREE_BYTES) {
      const error = new Error(`Not enough disk space for Harness ${version}: ${megabytes(free)} free, about ${megabytes(MIN_FREE_BYTES)} needed`);
      publish({ installing: "", error: error.message });
      throw error;
    }
    publish({ installing: version, error: "" });
    try {
      fileSystem.mkdirSync(directory, { recursive: true });
      fileSystem.writeFileSync(path.join(directory, INSTALLING_MARKER), String(now()));
      fileSystem.writeFileSync(path.join(directory, "package.json"), `${JSON.stringify({ name: "neoxider-dsh-runtime", private: true }, null, 2)}\n`);
      await runNpm(["install", "--no-audit", "--no-fund", "--loglevel=error", `${RUNTIME_PACKAGE}@${version}`], { cwd: directory });
      if (!entryIn(directory, fileSystem) || versionIn(directory, fileSystem) !== version) throw new Error("npm finished but Harness is not complete there");
      fileSystem.rmSync(path.join(directory, INSTALLING_MARKER), { force: true });
      prune();
      return publish({ installing: "", error: "", ready: version });
    } catch (error) {
      // Never the running runtime: only versions newer than every installed one get here.
      try { fileSystem.rmSync(directory, { recursive: true, force: true }); } catch {}
      publish({ installing: "", error: error?.message || String(error) });
      throw error;
    }
  }

  function install(version) {
    if (installing) return installing;
    installing = installVersion(version).finally(() => { installing = null; });
    return installing;
  }

  // Older per-version installs beyond the newest two go; the root install is left alone,
  // and so is the one running right now.
  function prune() {
    const versions = installedRuntimes(root, fileSystem).filter((runtime) => runtime.directory !== root);
    for (const runtime of versions.slice(KEEP_VERSIONS)) {
      if (runtime.version === state.running) continue;
      try { fileSystem.rmSync(runtime.directory, { recursive: true, force: true }); } catch {}
    }
  }

  // One pass: ask npm for the stable release. With nothing installed it is installed at once,
  // since Start has nothing to start otherwise; a newer one than the running runtime is only
  // announced unless `install` asks for it. Concurrent calls share the pass in flight.
  function check({ install: installNewer = false } = {}) {
    if (busy) return busy;
    busy = (async () => {
      try {
        const current = installedRuntimes(root, fileSystem)[0];
        const latest = await latestStable();
        publish({ latest, checkedAt: now(), error: "" });
        const newest = current ? current.version : "";
        if (!current || (installNewer && compareVersions(latest, newest) > 0)) await install(latest);
        return publish({});
      } catch (error) {
        return publish({ error: error?.message || String(error), checkedAt: now() });
      } finally {
        busy = null;
      }
    })();
    return busy;
  }

  function start() {
    publish({});
    check().catch(() => {});
    if (!timer) timer = setIntervalFn(() => { check().catch(() => {}); }, CHECK_INTERVAL_MS);
  }

  function stop() {
    if (timer) clearIntervalFn(timer);
    timer = null;
  }

  // Harness restarted on the newest runtime: nothing is waiting any more.
  const switched = () => publish({ ready: "", running: state.installed || state.running });
  // The version of the Harness serving right now, when Deck can tell (see main.cjs).
  const setRunning = (version) => publish({ running: VERSION_PATTERN.test(String(version || "")) ? String(version) : "" });

  return {
    start, stop, check, install, switched, setRunning,
    state: () => publish({}, { emit: false }),
    newestEntry: () => newestRuntimeEntry(root, fileSystem),
  };
}

module.exports = {
  INSTALLING_MARKER,
  MIN_FREE_BYTES,
  RUNTIME_PACKAGE,
  channelOf,
  compareVersions,
  createHarnessRuntime,
  installedRuntimes,
  newestRuntimeEntry,
  runtimeRoot,
  versionOfEntry,
};
