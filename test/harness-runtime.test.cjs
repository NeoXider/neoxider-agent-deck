const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { channelOf, compareVersions, createHarnessRuntime, installedRuntimes } = require("../src/harness-runtime.cjs");

// An in-memory file system with just what the runtime manager touches.
function memoryFs(files = {}) {
  const store = new Map(Object.entries(files).map(([key, value]) => [path.normalize(key), value]));
  return {
    store,
    existsSync: (file) => store.has(path.normalize(file)),
    readFileSync: (file) => { const value = store.get(path.normalize(file)); if (value === undefined) throw new Error("ENOENT"); return value; },
    writeFileSync: (file, value) => store.set(path.normalize(file), value),
    mkdirSync: () => {},
    rmSync: (dir) => { for (const key of [...store.keys()]) if (key.startsWith(path.normalize(dir))) store.delete(key); },
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

test("versions sort the semver way, prereleases included, and an alpha stays on alpha", () => {
  const sorted = ["0.2.0-rc.2", "0.2.1-alpha.10", "0.2.0", "0.2.1-alpha.4", "0.1.9"].sort(compareVersions);
  assert.deepEqual(sorted, ["0.1.9", "0.2.0-rc.2", "0.2.0", "0.2.1-alpha.4", "0.2.1-alpha.10"]);
  assert.equal(channelOf("0.2.1-alpha.2"), "alpha");
  assert.equal(channelOf("0.2.0-rc.2"), "latest");
});

test("the newest installed runtime is the one started, root installs included", () => {
  const fileSystem = memoryFs({ ...dsh(ROOT, "0.2.1-alpha.2"), ...dsh(path.join(ROOT, "versions", "0.2.1-alpha.4"), "0.2.1-alpha.4") });
  const runtimes = installedRuntimes(ROOT, fileSystem);
  assert.deepEqual(runtimes.map((runtime) => runtime.version), ["0.2.1-alpha.4", "0.2.1-alpha.2"]);
});

test("a newer release on the same channel is installed beside the running one and waits for a restart", async () => {
  const fileSystem = memoryFs(dsh(ROOT, "0.2.1-alpha.2"));
  const npm = [];
  const states = [];
  const runtime = createHarnessRuntime({
    root: ROOT, fileSystem, onState: (state) => states.push(state),
    fetchImpl: registry({ latest: "0.2.0-rc.2", alpha: "0.2.1-alpha.4" }),
    runNpm: async (args, { cwd }) => { npm.push({ args, cwd }); Object.assign(fileSystem.store, new Map()); for (const [key, value] of Object.entries(dsh(cwd, "0.2.1-alpha.4"))) fileSystem.store.set(path.normalize(key), value); },
  });
  const result = await runtime.check();
  assert.deepEqual(npm[0].args.at(-1), "@deepseek-ai/dsh@0.2.1-alpha.4", "the alpha channel's newest");
  assert.equal(npm[0].cwd, path.join(ROOT, "versions", "0.2.1-alpha.4"), "in its own directory, never over the running one");
  assert.ok(fileSystem.existsSync(path.join(ROOT, "versions", "0.2.1-alpha.4", "package.json")), "with its own package.json so npm stays there");
  assert.equal(result.installed, "0.2.1-alpha.4");
  assert.equal(result.ready, "0.2.1-alpha.4", "waits for the user's restart");
  assert.equal(runtime.switched().ready, "");
  assert.ok(states.some((state) => state.installing === "0.2.1-alpha.4"));
});

test("with no runtime at all the stable one is installed; up to date installs nothing", async () => {
  const fileSystem = memoryFs();
  const npm = [];
  const runNpm = async (args, { cwd }) => { npm.push(args.at(-1)); for (const [key, value] of Object.entries(dsh(cwd, args.at(-1).split("@").at(-1)))) fileSystem.store.set(path.normalize(key), value); };
  const runtime = createHarnessRuntime({ root: ROOT, fileSystem, runNpm, fetchImpl: registry({ latest: "0.2.0-rc.2", alpha: "0.2.1-alpha.4" }) });
  assert.equal((await runtime.check()).installed, "0.2.0-rc.2");
  assert.deepEqual(npm, ["@deepseek-ai/dsh@0.2.0-rc.2"]);
  await runtime.check();
  assert.equal(npm.length, 1, "nothing newer, nothing installed");
});

test("a failed install reports why and leaves no half-installed directory", async () => {
  const fileSystem = memoryFs(dsh(ROOT, "0.2.0-rc.1"));
  const runtime = createHarnessRuntime({ root: ROOT, fileSystem, fetchImpl: registry({ latest: "0.2.0-rc.2" }), runNpm: async () => { throw new Error("npm was not found: install Node.js to let Deck install Harness"); } });
  const result = await runtime.check();
  assert.match(result.error, /npm was not found/);
  assert.equal(result.installed, "0.2.0-rc.1", "the old runtime is still the one started");
  assert.equal(installedRuntimes(ROOT, fileSystem).length, 1);
  await assert.rejects(runtime.install("0.2.0; rm -rf /"), /Not a Harness version/, "only real version strings reach npm");
});
