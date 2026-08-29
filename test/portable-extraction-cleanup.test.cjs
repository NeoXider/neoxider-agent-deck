const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  MAX_REMOVALS_PER_LAUNCH,
  executableNames,
  isOwnExtraction,
  isPortableLaunch,
  startPortableExtractionSweep,
  sweepPortableExtractions,
} = require("../src/portable-extraction-cleanup.cjs");

const TEMP = "C:\\Temp";

// A fake disk shaped like the real one: a map of directory -> entry names, plus the set of
// files that exist. Nothing here touches a real filesystem, so the deletion rules can be
// asserted without a machine that has to be in the right state first.
function createDisk(layout, { unremovable = [] } = {}) {
  const removed = [];
  const files = new Set(layout.files || []);
  const directories = new Map(Object.entries(layout.directories || {}));
  return {
    removed,
    fileSystem: {
      async readdir(directory, options) {
        if (!directories.has(directory)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        const names = directories.get(directory);
        if (options?.withFileTypes) {
          return names.map((name) => ({
            name,
            isDirectory: () => directories.has(path.join(directory, name)),
          }));
        }
        return names;
      },
      async stat(filePath) {
        if (!files.has(filePath)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        return { isFile: () => true };
      },
      async rm(directory) {
        if (unremovable.includes(directory)) throw Object.assign(new Error("EBUSY"), { code: "EBUSY" });
        removed.push(directory);
      },
    },
  };
}

function extraction(name, { product = "NeoXider Agent Deck", asar = true } = {}) {
  const directory = path.join(TEMP, name);
  return {
    directory,
    entries: { [directory]: [`${product}.exe`, "resources", "locales"] },
    files: asar ? [path.join(directory, "resources", "app.asar")] : [],
  };
}

function diskWith(extractions, extra = {}) {
  const directories = { [TEMP]: extractions.map((item) => path.basename(item.directory)).concat(extra.names || []) };
  const files = [];
  for (const item of extractions) {
    Object.assign(directories, item.entries);
    files.push(...item.files);
  }
  for (const [name, entries] of Object.entries(extra.directories || {})) {
    directories[path.join(TEMP, name)] = entries;
  }
  files.push(...(extra.files || []));
  return createDisk({ directories, files }, extra.options);
}

test("a portable launch is recognised only by the launcher's own variable, on Windows", () => {
  assert.equal(isPortableLaunch({ PORTABLE_EXECUTABLE_FILE: "C:\\apps\\deck.exe" }, "win32"), true);
  assert.equal(isPortableLaunch({}, "win32"), false, "an installed build must never sweep");
  assert.equal(isPortableLaunch({ PORTABLE_EXECUTABLE_FILE: "   " }, "win32"), false);
  // The portable target only exists on Windows; nothing should run on the other platforms.
  assert.equal(isPortableLaunch({ PORTABLE_EXECUTABLE_FILE: "/apps/deck" }, "darwin"), false);
  assert.equal(isPortableLaunch({ PORTABLE_EXECUTABLE_FILE: "/apps/deck" }, "linux"), false);
});

test("the legacy product name is swept too", () => {
  const names = executableNames();
  assert.ok(names.includes("NeoXider Agent Deck.exe"));
  assert.ok(names.includes("DeepSeek Harness Widget.exe"), "the pre-rename build left the same litter");
});

test("previous extractions are removed and the running one is never touched", async () => {
  const own = extraction("running");
  const old1 = extraction("old-a");
  const old2 = extraction("old-b");
  const legacy = extraction("old-legacy", { product: "DeepSeek Harness Widget" });
  const disk = diskWith([own, old1, old2, legacy]);

  const result = await sweepPortableExtractions({
    fileSystem: disk.fileSystem,
    tempRoot: TEMP,
    currentDirectory: own.directory,
  });

  assert.deepEqual(result.removed.sort(), [old1.directory, old2.directory, legacy.directory].sort());
  assert.ok(!result.removed.includes(own.directory), "deleting our own directory would pull the app out from under itself");
  assert.equal(result.skipped.length, 0);
});

test("a directory that only borrows the name is left alone", async () => {
  // Same executable name, no resources/app.asar: not one of ours.
  const impostor = extraction("not-ours", { asar: false });
  const real = extraction("ours");
  const disk = diskWith([impostor, real]);

  const result = await sweepPortableExtractions({
    fileSystem: disk.fileSystem,
    tempRoot: TEMP,
    currentDirectory: path.join(TEMP, "elsewhere"),
  });

  assert.deepEqual(result.removed, [real.directory]);
});

test("unrelated temp directories are never scanned into", async () => {
  const real = extraction("ours");
  const disk = diskWith([real], {
    names: ["some-other-app", "a-loose-file.txt"],
    directories: { "some-other-app": ["setup.exe", "readme.txt"] },
  });

  const result = await sweepPortableExtractions({
    fileSystem: disk.fileSystem,
    tempRoot: TEMP,
    currentDirectory: "",
  });

  assert.deepEqual(result.removed, [real.directory]);
});

test("a directory held open by another running copy is skipped, not retried into a failure", async () => {
  const busy = extraction("still-running");
  const free = extraction("finished");
  const errors = [];
  const disk = diskWith([busy, free], { options: { unremovable: [busy.directory] } });

  const result = await sweepPortableExtractions({
    fileSystem: disk.fileSystem,
    tempRoot: TEMP,
    currentDirectory: "",
    onError: (error) => errors.push(error.code),
  });

  assert.deepEqual(result.removed, [free.directory]);
  assert.deepEqual(result.skipped, [busy.directory]);
  assert.deepEqual(errors, ["EBUSY"], "the lock is reported but never thrown");
});

test("a launch removes a bounded number so startup cannot stall", async () => {
  const many = Array.from({ length: MAX_REMOVALS_PER_LAUNCH + 6 }, (_, index) => extraction(`old-${index}`));
  const disk = diskWith(many);

  const result = await sweepPortableExtractions({
    fileSystem: disk.fileSystem,
    tempRoot: TEMP,
    currentDirectory: "",
  });

  assert.equal(result.removed.length, MAX_REMOVALS_PER_LAUNCH);
  assert.ok(many.length > result.removed.length, "the rest wait for the next launch");
});

test("an unreadable temp root reports rather than throws", async () => {
  const errors = [];
  const result = await sweepPortableExtractions({
    fileSystem: { async readdir() { throw Object.assign(new Error("EPERM"), { code: "EPERM" }); } },
    tempRoot: TEMP,
    currentDirectory: "",
    onError: (error) => errors.push(error.code),
  });
  assert.deepEqual(result.removed, []);
  assert.deepEqual(errors, ["EPERM"]);
});

test("isOwnExtraction requires both signatures", async () => {
  const withBoth = extraction("both");
  const disk = diskWith([withBoth]);
  assert.equal(await isOwnExtraction(disk.fileSystem, withBoth.directory), true);
  assert.equal(await isOwnExtraction(disk.fileSystem, path.join(TEMP, "missing")), false);
});

test("an installed build never sweeps, and a portable one does", async () => {
  const real = extraction("ours");
  const disk = diskWith([real]);
  const silent = { warn() {}, log() {} };

  const installed = startPortableExtractionSweep({
    tempRoot: TEMP, fileSystem: disk.fileSystem, env: {}, platform: "win32", log: silent,
  });
  assert.equal(installed, null, "an installed build has no extraction directory to collect");
  assert.deepEqual(disk.removed, []);

  const result = await startPortableExtractionSweep({
    tempRoot: TEMP,
    fileSystem: disk.fileSystem,
    env: { PORTABLE_EXECUTABLE_FILE: "C:\apps\deck.exe" },
    platform: "win32",
    execPath: path.join(TEMP, "running", "NeoXider Agent Deck.exe"),
    log: silent,
  });
  assert.deepEqual(result.removed, [real.directory]);
});

test("the sweep reports what it removed and never throws at the caller", async () => {
  const messages = [];
  const log = { warn: (...args) => messages.push(["warn", ...args]), log: (...args) => messages.push(["log", ...args]) };
  const busy = extraction("locked");
  const disk = diskWith([busy], { options: { unremovable: [busy.directory] } });

  const result = await startPortableExtractionSweep({
    tempRoot: TEMP,
    fileSystem: disk.fileSystem,
    env: { PORTABLE_EXECUTABLE_FILE: "C:\apps\deck.exe" },
    platform: "win32",
    execPath: path.join(TEMP, "elsewhere", "NeoXider Agent Deck.exe"),
    log,
  });
  assert.deepEqual(result.removed, [], "a locked directory is left for the next launch");
  assert.ok(messages.some(([level]) => level === "warn"));
  assert.ok(!messages.some(([level]) => level === "log"), "nothing removed means nothing announced");
});
