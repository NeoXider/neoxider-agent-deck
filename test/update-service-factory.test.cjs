const test = require("node:test");
const assert = require("node:assert/strict");

const { createApplicationUpdateService } = require("../src/update-service-factory.cjs");

function recorder() {
  const calls = [];
  return {
    calls,
    createPortable: (options) => { calls.push(["portable", options]); return { kind: "portable" }; },
    createInstalled: (options) => { calls.push(["installed", options]); return { kind: "installed" }; },
  };
}

const base = {
  currentVersion: "1.2.3",
  openExternal: () => {},
  onState: () => {},
  requestQuit: () => {},
};

test("an unpackaged or portable build replaces its own executable", () => {
  for (const options of [{ isPackaged: false }, { isPackaged: true, portableExecutable: "C:\\Deck.exe" }]) {
    const fakes = recorder();
    const service = createApplicationUpdateService({ ...base, ...options, ...fakes, loadUpdater: () => assert.fail("must not load electron-updater") });
    assert.deepEqual(service, { kind: "portable" });
    assert.equal(fakes.calls[0][0], "portable");
    // The portable path is the one that restarts the app itself, so it needs the quit hook.
    assert.equal(fakes.calls[0][1].requestQuit, base.requestQuit);
    assert.equal(fakes.calls[0][1].currentVersion, "1.2.3");
  }
});

test("an installed build delegates to electron-updater", () => {
  const fakes = recorder();
  const updater = { checkForUpdates() {} };
  const service = createApplicationUpdateService({ ...base, isPackaged: true, isMas: 1, isWindowsStore: 0, ...fakes, loadUpdater: () => updater });
  assert.deepEqual(service, { kind: "installed" });
  const [, options] = fakes.calls[0];
  assert.equal(options.updater, updater);
  assert.equal(options.isMas, true);
  assert.equal(options.isWindowsStore, false);
  assert.equal(options.isMacSigned, false);
  assert.equal("requestQuit" in options, false);
});

test("a missing electron-updater degrades instead of failing startup", () => {
  const fakes = recorder();
  const reported = [];
  const service = createApplicationUpdateService({
    ...base,
    isPackaged: true,
    ...fakes,
    loadUpdater: () => { throw new Error("Cannot find module 'electron-updater'"); },
    onUpdaterUnavailable: (error) => reported.push(error.message),
  });
  assert.deepEqual(service, { kind: "installed" });
  assert.equal(fakes.calls[0][1].updater, null);
  assert.deepEqual(reported, ["Cannot find module 'electron-updater'"]);
});
