// Installs and updates the DeepSeek Harness runtime that Deck starts.
//
// Deck used to start whatever Harness it found, or `npx @deepseek-ai/dsh@<pinned>` when it
// found none, and never looked for a newer one: a runtime installed once stayed that version
// until someone updated it by hand. Now Deck keeps its own runtimes, one directory per
// version under `<root>/versions/`, installed with npm:
//
// - none at all: the stable (`latest`) runtime is installed in the background, so the
//   offline banner's Start has something to start;
// - one installed: npm is asked for the newest release on the same channel (an alpha stays
//   on alpha, a release candidate on latest) every few hours, and a newer one is installed
//   next to the running one.
//
// A running Harness is never touched. Its files stay where they are, the new version waits
// in its own directory, and the launcher starts the newest installed one the next time it
// starts Harness: after the user presses Restart, or after Harness stops for any reason.
// Restarting by itself would cut off whatever the agents are doing.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const RUNTIME_PACKAGE = "@deepseek-ai/dsh";
const REGISTRY_URL = "https://registry.npmjs.org/@deepseek-ai%2Fdsh";
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const KEEP_VERSIONS = 2;

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

// The npm dist-tag a version follows: alphas stay on `alpha`; everything else on `latest`.
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

// Every runtime Deck can start, newest first: the per-version installs, then a runtime
// installed straight into the root (how the first installs were laid out).
function installedRuntimes(root, fileSystem = fs, platformPath = path) {
  const found = [];
  let names = [];
  try { names = fileSystem.readdirSync(platformPath.join(root, "versions")); } catch {}
  for (const name of Array.isArray(names) ? names : []) {
    if (!VERSION_PATTERN.test(String(name))) continue;
    const directory = platformPath.join(root, "versions", String(name));
    const entry = entryIn(directory, fileSystem, platformPath);
    if (entry) found.push({ version: versionIn(directory, fileSystem, platformPath) || String(name), directory, entry });
  }
  const rootEntry = entryIn(root, fileSystem, platformPath);
  if (rootEntry) found.push({ version: versionIn(root, fileSystem, platformPath), directory: root, entry: rootEntry });
  return found.sort((left, right) => compareVersions(right.version, left.version));
}

function newestRuntimeEntry(root, fileSystem = fs, platformPath = path) {
  return installedRuntimes(root, fileSystem, platformPath)[0]?.entry || "";
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
      else reject(new Error(tail.trim().split(/\r?\n/).slice(-3).join(" ") || `npm exited with ${code}`));
    });
  });
}

function createHarnessRuntime({
  root = runtimeRoot(),
  fetchImpl = globalThis.fetch,
  runNpm = defaultRunNpm,
  fileSystem = fs,
  onState = () => {},
  now = () => Date.now(),
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
} = {}) {
  let state = { installed: "", channel: "latest", latest: "", installing: "", error: "", checkedAt: 0, ready: "" };
  let timer = null;
  let busy = null;

  function publish(next, { emit = true } = {}) {
    state = { ...state, ...next };
    const runtimes = installedRuntimes(root, fileSystem);
    // `installed` is what the launcher will start next; `running` is reported by main.
    state.installed = runtimes[0]?.version || "";
    state.channel = state.installed ? channelOf(state.installed) : "latest";
    state.updateAvailable = Boolean(state.latest && state.installed && compareVersions(state.latest, state.installed) > 0);
    if (emit) try { onState({ ...state }); } catch {}
    return { ...state };
  }

  async function latestOnChannel(channel) {
    const response = await fetchImpl(REGISTRY_URL, { headers: { accept: "application/vnd.npm.install-v1+json" } });
    if (!response.ok) throw new Error(`npm registry answered ${response.status}`);
    const body = await response.json();
    const version = body?.["dist-tags"]?.[channel] || body?.["dist-tags"]?.latest || "";
    if (!VERSION_PATTERN.test(version)) throw new Error("npm registry gave no usable version");
    return version;
  }

  async function install(version) {
    if (!VERSION_PATTERN.test(String(version || ""))) throw new Error("Not a Harness version");
    const directory = path.join(root, "versions", version);
    publish({ installing: version, error: "" });
    try {
      fileSystem.mkdirSync(directory, { recursive: true });
      fileSystem.writeFileSync(path.join(directory, "package.json"), `${JSON.stringify({ name: "neoxider-dsh-runtime", private: true }, null, 2)}\n`);
      await runNpm(["install", "--no-audit", "--no-fund", "--loglevel=error", `${RUNTIME_PACKAGE}@${version}`], { cwd: directory });
      if (!entryIn(directory, fileSystem)) throw new Error("npm finished but Harness is not there");
      prune();
      return publish({ installing: "", ready: version });
    } catch (error) {
      try { if (!entryIn(directory, fileSystem)) fileSystem.rmSync(directory, { recursive: true, force: true }); } catch {}
      publish({ installing: "", error: error?.message || String(error) });
      throw error;
    }
  }

  // Older per-version installs beyond the newest two go; the root install is left alone.
  function prune() {
    const versions = installedRuntimes(root, fileSystem).filter((runtime) => runtime.directory !== root);
    for (const runtime of versions.slice(KEEP_VERSIONS)) {
      try { fileSystem.rmSync(runtime.directory, { recursive: true, force: true }); } catch {}
    }
  }

  // One pass: install the stable runtime when there is none, otherwise install a newer
  // release on the installed one's channel. Concurrent calls share the pass in flight.
  function check({ install: allowInstall = true } = {}) {
    if (busy) return busy;
    busy = (async () => {
      try {
        const current = installedRuntimes(root, fileSystem)[0];
        const channel = current ? channelOf(current.version) : "latest";
        const latest = await latestOnChannel(channel);
        publish({ latest, checkedAt: now(), error: "" });
        if (allowInstall && (!current || compareVersions(latest, current.version) > 0)) await install(latest);
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
  const switched = () => publish({ ready: "" });

  return { start, stop, check, install, switched, state: () => publish({}, { emit: false }), newestEntry: () => newestRuntimeEntry(root, fileSystem) };
}

module.exports = { RUNTIME_PACKAGE, channelOf, compareVersions, createHarnessRuntime, installedRuntimes, newestRuntimeEntry, runtimeRoot };
