const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const {
  createInstalledUpdateService,
  detectInstalledChannel,
  updateFileView,
} = require("../src/installed-update-service.cjs");

class FakeUpdater extends EventEmitter {
  constructor() {
    super();
    this.autoDownload = true;
    this.autoInstallOnAppQuit = true;
    this.allowPrerelease = true;
    this.allowDowngrade = true;
    this.checkCalls = 0;
    this.downloadCalls = 0;
    this.installCalls = [];
    this.checkAction = async () => ({ isUpdateAvailable: false, updateInfo: { version: "1.0.0" } });
    this.downloadAction = async () => [];
    this.installAction = () => {};
  }

  checkForUpdates() {
    this.checkCalls += 1;
    return this.checkAction();
  }

  downloadUpdate() {
    this.downloadCalls += 1;
    return this.downloadAction();
  }

  quitAndInstall(...args) {
    this.installCalls.push(args);
    return this.installAction(...args);
  }
}

function info(version = "1.1.0", overrides = {}) {
  return {
    version,
    files: [{ url: `NeoXider-Agent-Deck-${version}-windows-x64-setup.exe`, size: 120_000_000, sha512: "test" }],
    ...overrides,
  };
}

function installedService({ updater = new FakeUpdater(), onState, ...overrides } = {}) {
  const service = createInstalledUpdateService({
    currentVersion: "1.0.0",
    updater,
    platform: "win32",
    isPackaged: true,
    windowsTarget: "nsis",
    onState,
    ...overrides,
  });
  return { service, updater };
}

test("installed channel detection permits only NSIS, signed macOS, and AppImage", () => {
  assert.deepEqual(detectInstalledChannel({ platform: "win32", isPackaged: true }), { supported: true, channel: "nsis", reason: null });
  assert.equal(detectInstalledChannel({ platform: "win32", isPackaged: true, env: { PORTABLE_EXECUTABLE_FILE: "C:\\Agent.exe" } }).reason, "portable-update-channel");
  assert.equal(detectInstalledChannel({ platform: "win32", isPackaged: true, windowsTarget: "msi" }).reason, "unsupported-windows-package");
  assert.equal(detectInstalledChannel({ platform: "win32", isPackaged: true, isWindowsStore: true }).reason, "managed-by-store");
  assert.deepEqual(detectInstalledChannel({ platform: "darwin", isPackaged: true, isMacSigned: true }), { supported: true, channel: "mac", reason: null });
  assert.equal(detectInstalledChannel({ platform: "darwin", isPackaged: true, isMacSigned: false }).reason, "unsigned-macos-build");
  assert.equal(detectInstalledChannel({ platform: "darwin", isPackaged: true, isMacSigned: true, isMas: true }).reason, "managed-by-store");
  assert.deepEqual(detectInstalledChannel({ platform: "linux", isPackaged: true, env: { APPIMAGE: "/opt/Agent.AppImage" } }), { supported: true, channel: "appimage", reason: null });
  assert.equal(detectInstalledChannel({ platform: "linux", isPackaged: true, env: {} }).reason, "unsupported-linux-package");
  assert.equal(detectInstalledChannel({ platform: "freebsd", isPackaged: true }).reason, "unsupported-platform");
  assert.equal(detectInstalledChannel({ platform: "win32", isPackaged: false }).reason, "development-build");
});

test("managed updater is configured for explicit stable downloads and installs", () => {
  const { service, updater } = installedService();
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.allowPrerelease, false);
  assert.equal(updater.allowDowngrade, false);
  assert.equal(service.getState().installMode, "managed");
  assert.deepEqual(Object.keys(service.getState()), [
    "status",
    "currentVersion",
    "latestVersion",
    "releaseUrl",
    "assetName",
    "assetSize",
    "installMode",
    "manualReason",
    "progress",
    "receivedBytes",
    "totalBytes",
    "error",
  ]);
});

test("update file metadata is normalized without exposing paths", () => {
  assert.deepEqual(updateFileView(info()), {
    name: "NeoXider-Agent-Deck-1.1.0-windows-x64-setup.exe",
    size: 120_000_000,
  });
  assert.deepEqual(updateFileView({ files: [{ url: "https://example.com/path/App%20Setup.exe", size: -1 }] }), {
    name: "App Setup.exe",
    size: 0,
  });
  assert.deepEqual(updateFileView({}), { name: null, size: 0 });
});

test("available and current checks map events to the shared state shape", async (t) => {
  await t.test("available", async () => {
    const states = [];
    const { service, updater } = installedService({ onState: (state) => states.push(state.status) });
    updater.checkAction = async () => {
      updater.emit("checking-for-update");
      updater.emit("update-available", info());
      return { isUpdateAvailable: true, updateInfo: info() };
    };
    const result = await service.check();
    assert.equal(result.status, "available");
    assert.equal(result.latestVersion, "1.1.0");
    assert.equal(result.releaseUrl, "https://github.com/NeoXider/neoxider-agent-deck/releases/tag/v1.1.0");
    assert.equal(result.assetName, "NeoXider-Agent-Deck-1.1.0-windows-x64-setup.exe");
    assert.equal(result.assetSize, 120_000_000);
    assert.equal(result.installMode, "managed");
    assert.deepEqual(states, ["checking", "checking", "available"]);
  });

  await t.test("current", async () => {
    const { service, updater } = installedService();
    updater.checkAction = async () => {
      updater.emit("update-not-available", info("1.0.0"));
      return { isUpdateAvailable: false, updateInfo: info("1.0.0") };
    };
    const result = await service.check();
    assert.equal(result.status, "current");
    assert.equal(result.latestVersion, "1.0.0");
    assert.equal(result.installMode, "none");
  });
});

test("invalid, prerelease, equal, and downgraded available events never offer an update", async (t) => {
  for (const version of ["1.0.0", "0.9.9", "1.1.0-beta.1", "latest"]) {
    await t.test(version, async () => {
      const { service, updater } = installedService();
      updater.checkAction = async () => {
        updater.emit("update-available", info(version));
        return { isUpdateAvailable: true, updateInfo: info(version) };
      };
      const result = await service.check();
      assert.equal(result.status, "current");
      assert.notEqual(result.installMode, "managed");
    });
  }
});

test("concurrent checks call electron-updater once", async () => {
  const { service, updater } = installedService();
  let finish;
  updater.checkAction = () => new Promise((resolve) => { finish = resolve; });
  const first = service.check();
  const second = service.check();
  assert.strictEqual(first, second);
  finish({ isUpdateAvailable: true, updateInfo: info() });
  const [a, b] = await Promise.all([first, second]);
  assert.equal(updater.checkCalls, 1);
  assert.deepEqual(a, b);
  assert.equal(a.status, "available");
});

test("download progress and completion events produce a ready state", async () => {
  const states = [];
  const { service, updater } = installedService({ onState: (state) => states.push(state) });
  updater.checkAction = async () => ({ isUpdateAvailable: true, updateInfo: info() });
  updater.downloadAction = async () => {
    updater.emit("download-progress", { percent: 47.8, transferred: 57_000_000, total: 120_000_000 });
    updater.emit("update-downloaded", info());
    return ["update.exe"];
  };
  await service.check();
  const result = await service.download();
  assert.equal(result.status, "ready");
  assert.equal(result.progress, 100);
  assert.equal(result.receivedBytes, 120_000_000);
  assert.ok(states.some((state) => state.status === "downloading" && state.progress === 47));
  assert.equal(updater.downloadCalls, 1);
});

test("download completion promise is a fallback when no event is emitted", async () => {
  const { service, updater } = installedService();
  updater.checkAction = async () => ({ isUpdateAvailable: true, updateInfo: info() });
  updater.downloadAction = async () => ["update.exe"];
  await service.check();
  assert.equal((await service.download()).status, "ready");
});

test("concurrent downloads perform one updater transfer", async () => {
  const { service, updater } = installedService();
  updater.checkAction = async () => ({ isUpdateAvailable: true, updateInfo: info() });
  let finish;
  updater.downloadAction = () => new Promise((resolve) => { finish = resolve; });
  await service.check();
  const first = service.download();
  const second = service.download();
  assert.strictEqual(first, second);
  finish([]);
  assert.equal((await first).status, "ready");
  assert.equal(updater.downloadCalls, 1);
});

test("install waits for download, calls quitAndInstall once, and never relies on app quit", async () => {
  const { service, updater } = installedService();
  updater.checkAction = async () => ({ isUpdateAvailable: true, updateInfo: info() });
  let finishDownload;
  updater.downloadAction = () => new Promise((resolve) => { finishDownload = resolve; });
  await service.check();
  const downloading = service.download();
  const first = service.install();
  const second = service.install();
  assert.strictEqual(first, second);
  assert.deepEqual(updater.installCalls, []);
  finishDownload([]);
  await downloading;
  const result = await first;
  assert.equal(result.status, "installing");
  assert.deepEqual(updater.installCalls, [[false, true]]);
  assert.equal(updater.autoInstallOnAppQuit, false);
});

test("install from available performs the explicit download first", async () => {
  const { service, updater } = installedService();
  updater.checkAction = async () => ({ isUpdateAvailable: true, updateInfo: info() });
  await service.check();
  const result = await service.install();
  assert.equal(result.status, "installing");
  assert.equal(updater.downloadCalls, 1);
  assert.deepEqual(updater.installCalls, [[false, true]]);
});

test("updater errors map to the active operation without duplicate transitions", async (t) => {
  await t.test("check error event", async () => {
    const { service, updater } = installedService();
    updater.checkAction = async () => {
      const error = Object.assign(new Error("network offline"), { code: "ERR_NETWORK" });
      updater.emit("error", error);
      throw error;
    };
    const result = await service.check();
    assert.equal(result.status, "error");
    assert.deepEqual(result.error, { code: "ERR_NETWORK", message: "network offline" });
  });

  await t.test("download error", async () => {
    const { service, updater } = installedService();
    updater.checkAction = async () => ({ isUpdateAvailable: true, updateInfo: info() });
    updater.downloadAction = async () => { throw new Error("disk full"); };
    await service.check();
    const result = await service.download();
    assert.equal(result.status, "error");
    assert.equal(result.error.code, "UPDATE_DOWNLOAD_FAILED");
  });

  await t.test("install error", async () => {
    const { service, updater } = installedService();
    updater.checkAction = async () => ({ isUpdateAvailable: true, updateInfo: info() });
    updater.installAction = () => { throw Object.assign(new Error("installer denied"), { code: "ELEVATION_DENIED" }); };
    await service.check();
    await service.download();
    const result = await service.install();
    assert.equal(result.status, "error");
    assert.equal(result.error.code, "ELEVATION_DENIED");
  });
});

test("manual channels open the latest release without calling updater methods", async (t) => {
  for (const [name, options, reason] of [
    ["portable", { platform: "win32", isPackaged: true, env: { PORTABLE_EXECUTABLE_FILE: "C:\\Agent.exe" } }, "portable-update-channel"],
    ["unsigned mac", { platform: "darwin", isPackaged: true, isMacSigned: false }, "unsigned-macos-build"],
    ["deb", { platform: "linux", isPackaged: true, env: {} }, "unsupported-linux-package"],
  ]) {
    await t.test(name, async () => {
      const updater = new FakeUpdater();
      let opened = "";
      const service = createInstalledUpdateService({
        currentVersion: "1.0.0",
        updater,
        openExternal: async (url) => { opened = url; },
        ...options,
      });
      const checked = await service.check();
      assert.equal(checked.status, "current");
      assert.equal(checked.installMode, "manual");
      assert.equal(checked.manualReason, reason);
      assert.equal((await service.download()).status, "current");
      const installed = await service.install();
      assert.equal(installed.manual, true);
      assert.equal(opened, "https://github.com/NeoXider/neoxider-agent-deck/releases/latest");
      assert.equal(updater.checkCalls, 0);
      assert.equal(updater.downloadCalls, 0);
      assert.deepEqual(updater.installCalls, []);
    });
  }
});

test("manual install before check is safe and a missing external opener is explicit", async () => {
  const service = createInstalledUpdateService({ currentVersion: "1.0.0", platform: "linux", isPackaged: true, env: {} });
  const result = await service.install();
  assert.equal(result.status, "error");
  assert.equal(result.error.code, "UPDATE_RELEASE_OPEN_FAILED");
});
