const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { INSTALLING_MARKER, MIN_FREE_BYTES, channelOf, compareVersions, createHarnessRuntime, installedRuntimes, versionOfEntry } = require("../src/harness-runtime.cjs");

// An in-memory file system with just what the runtime manager touches.
function memoryFs(files = {}) {
  const store = new Map(Object.entries(files).map(([key, value]) => [path.normalize(key), value]));
  return {
    store,
    existsSync: (file) => store.has(path.normalize(file)),
    readFileSync: (file) => { const value = store.get(path.normalize(file)); if (value === undefined) throw new Error("ENOENT"); return value; },
    writeFileSync: (file, value) => store.set(path.normalize(file), value),
    mkdirSync: () => {},
    rmSync: (dir) => { for (const key of [...store.keys()]) if (key === path.normalize(dir) || key.startsWith(path.normalize(dir) + path.sep)) store.delete(key); },
    readdirSync: (dir) => {
      const prefix = path.normalize(dir) + path.sep;
      return [...new Set([...store.keys()].filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length).split(path.sep)[0]))];
    },
  };
}
const ROOT = path.join("runtime");
const dsh = (dir, version) => ({
  [path.join(dir, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js")]: "",
  [path.join(dir, "node_modules", "@deepseek-ai", "dsh", "package.json")]: JSON.stringify({ version }),
});
const registry = (tags) => async () => ({ ok: true, json: async () => ({ "dist-tags": tags }) });
const installs = (fileSystem, log = []) => async (args, { cwd }) => {
  log.push({ args, cwd });
  for (const [key, value] of Object.entries(dsh(cwd, args.at(-1).split("@").at(-1)))) fileSystem.store.set(path.normalize(key), value);
};
const plenty = () => 50 * 1024 ** 3;

test("versions sort the semver way, prereleases included", () => {
  const sorted = ["0.2.0-rc.2", "0.2.1-alpha.10", "0.2.0", "0.2.1-alpha.4", "0.1.9", "0.2.1-rc.2"].sort(compareVersions);
  assert.deepEqual(sorted, ["0.1.9", "0.2.0-rc.2", "0.2.0", "0.2.1-alpha.4", "0.2.1-alpha.10", "0.2.1-rc.2"]);
  assert.equal(channelOf("0.2.1-alpha.2"), "alpha");
  assert.equal(channelOf("0.2.0-rc.2"), "latest");
});

test("the newest installed runtime is the one started, root installs included", () => {
  const fileSystem = memoryFs({ ...dsh(ROOT, "0.2.1-alpha.2"), ...dsh(path.join(ROOT, "versions", "0.2.1-alpha.4"), "0.2.1-alpha.4") });
  const runtimes = installedRuntimes(ROOT, fileSystem);
  assert.deepEqual(runtimes.map((runtime) => runtime.version), ["0.2.1-alpha.4", "0.2.1-alpha.2"]);
});

test("half an install is never a runtime: no package.json, or the install marker still there", () => {
  const broken = path.join(ROOT, "versions", "0.2.1-rc.2");
  const running = path.join(ROOT, "versions", "0.2.1-rc.3");
  const fileSystem = memoryFs({
    ...dsh(path.join(ROOT, "versions", "0.2.1-alpha.5"), "0.2.1-alpha.5"),
    // What the disk running out of space left behind: the entry without its package.json.
    [path.join(broken, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js")]: "",
    ...dsh(running, "0.2.1-rc.3"),
    [path.join(running, INSTALLING_MARKER)]: "1",
  });
  assert.deepEqual(installedRuntimes(ROOT, fileSystem).map((runtime) => runtime.version), ["0.2.1-alpha.5"]);
});

test("updates follow the stable tag: an installed alpha is offered the release candidate above it, never another alpha", async () => {
  const fileSystem = memoryFs(dsh(path.join(ROOT, "versions", "0.2.1-alpha.5"), "0.2.1-alpha.5"));
  const npm = [];
  const runtime = createHarnessRuntime({
    root: ROOT, fileSystem, freeBytes: plenty, runNpm: installs(fileSystem, npm),
    fetchImpl: registry({ latest: "0.2.1-rc.2", alpha: "0.2.1-alpha.9", next: "0.2.1-rc.2" }),
  });
  runtime.setRunning("0.2.1-alpha.5");
  const announced = await runtime.check();
  assert.equal(npm.length, 0, "a newer release is announced, not installed behind the user's back");
  assert.equal(announced.latest, "0.2.1-rc.2");
  assert.equal(announced.updateAvailable, true);
  assert.equal(announced.ready, "");

  const updated = await runtime.check({ install: true });
  assert.equal(npm[0].args.at(-1), "@deepseek-ai/dsh@0.2.1-rc.2", "the stable tag, not the alpha");
  assert.equal(npm[0].cwd, path.join(ROOT, "versions", "0.2.1-rc.2"), "in its own directory, never over the running one");
  assert.ok(!fileSystem.existsSync(path.join(ROOT, "versions", "0.2.1-rc.2", INSTALLING_MARKER)), "the marker goes once npm succeeds");
  assert.equal(updated.installed, "0.2.1-rc.2");
  assert.equal(updated.ready, "0.2.1-rc.2", "waits for the restart that switches to it");
  const switched = runtime.switched();
  assert.equal(switched.ready, "");
  assert.equal(switched.running, "0.2.1-rc.2");
  assert.equal(switched.updateAvailable, false);
});

test("an alpha newer than the stable release is left alone", async () => {
  const fileSystem = memoryFs(dsh(path.join(ROOT, "versions", "0.2.2-alpha.1"), "0.2.2-alpha.1"));
  const npm = [];
  const runtime = createHarnessRuntime({ root: ROOT, fileSystem, freeBytes: plenty, runNpm: installs(fileSystem, npm), fetchImpl: registry({ latest: "0.2.1-rc.2" }) });
  const result = await runtime.check({ install: true });
  assert.equal(npm.length, 0);
  assert.equal(result.updateAvailable, false);
});

test("with no runtime at all the stable one is installed at once; up to date installs nothing", async () => {
  const fileSystem = memoryFs();
  const npm = [];
  const runtime = createHarnessRuntime({ root: ROOT, fileSystem, freeBytes: plenty, runNpm: installs(fileSystem, npm), fetchImpl: registry({ latest: "0.2.0-rc.2", alpha: "0.2.1-alpha.4" }) });
  assert.equal((await runtime.check()).installed, "0.2.0-rc.2");
  assert.deepEqual(npm.map((entry) => entry.args.at(-1)), ["@deepseek-ai/dsh@0.2.0-rc.2"]);
  await runtime.check({ install: true });
  assert.equal(npm.length, 1, "nothing newer, nothing installed");
});

test("a failed install reports why and removes the whole version directory, even with the entry written", async () => {
  const fileSystem = memoryFs(dsh(ROOT, "0.2.0-rc.1"));
  const target = path.join(ROOT, "versions", "0.2.0-rc.2");
  const runtime = createHarnessRuntime({
    root: ROOT, fileSystem, freeBytes: plenty, fetchImpl: registry({ latest: "0.2.0-rc.2" }),
    runNpm: async (_args, { cwd }) => {
      fileSystem.store.set(path.normalize(path.join(cwd, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js")), "");
      throw new Error("the disk ran out of space while npm installed Harness");
    },
  });
  const result = await runtime.check({ install: true });
  assert.match(result.error, /ran out of space/);
  assert.equal(result.installed, "0.2.0-rc.1", "the old runtime is still the one started");
  assert.ok(![...fileSystem.store.keys()].some((key) => key.startsWith(path.normalize(target))), "nothing of the half install is left");
  await assert.rejects(runtime.install("0.2.0; rm -rf /"), /Not a Harness version/, "only real version strings reach npm");
});

test("an install is refused up front when the disk has no room for it", async () => {
  const fileSystem = memoryFs(dsh(ROOT, "0.2.0-rc.1"));
  const npm = [];
  const runtime = createHarnessRuntime({ root: ROOT, fileSystem, freeBytes: () => 55 * 1024 * 1024, runNpm: installs(fileSystem, npm), fetchImpl: registry({ latest: "0.2.0-rc.2" }) });
  const result = await runtime.check({ install: true });
  assert.equal(npm.length, 0, "npm never starts");
  assert.match(result.error, /Not enough disk space for Harness 0\.2\.0-rc\.2: 55 MB free, about 1200 MB needed/);
  assert.ok(MIN_FREE_BYTES > 800 * 1024 * 1024);
});

test("the running version is read from the package next to its entry", () => {
  const dir = path.join(ROOT, "versions", "0.2.1-alpha.5");
  const fileSystem = memoryFs(dsh(dir, "0.2.1-alpha.5"));
  assert.equal(versionOfEntry(path.join(dir, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"), fileSystem), "0.2.1-alpha.5");
  assert.equal(versionOfEntry("C:\\x\\versions\\0.2.1-rc.2\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js", memoryFs()), "0.2.1-rc.2");
  assert.equal(versionOfEntry("", fileSystem), "");
  // Linux reads a Windows path as relative: no package.json in the working directory answers.
  const anyPackage = { readFileSync: () => JSON.stringify({ version: "1.1.0" }) };
  assert.equal(versionOfEntry("R\\versions\\0.2.1-rc.2\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js", anyPackage), "0.2.1-rc.2");
  assert.equal(versionOfEntry("node_modules/@deepseek-ai/dsh/lib/bin.js", anyPackage), "");
});
