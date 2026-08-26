const test = require("node:test");
const assert = require("node:assert/strict");
const {
  LEGACY_LOGIN_ITEM_NAMES,
  LOGIN_ITEM_NAME,
  createAutoStartController,
  deleteWindowsRunItem,
  loginItemEnabled,
  parseWindowsRunItemPath,
  resolveLoginItemTarget,
} = require("../src/auto-start.cjs");

function sameArgs(left = [], right = []) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function createFakeApp({ isPackaged = true, appPath = "C:\\app", launchItems = [] } = {}) {
  const calls = { get: [], set: [] };
  const records = new Map(launchItems.map((item) => [item.name, { ...item, args: [...(item.args || [])] }]));
  return {
    calls,
    isPackaged,
    getAppPath: () => appPath,
    getLoginItemSettings(options) {
      calls.get.push(options);
      const items = [...records.values()];
      if (!options || options.type) {
        if (options?.type) {
          const mac = records.get("mac-main");
          return { openAtLogin: Boolean(mac?.enabled), status: mac?.enabled ? "enabled" : "not-registered" };
        }
        return { openAtLogin: false, executableWillLaunchAtLogin: false, launchItems: items };
      }
      const match = items.find((item) => item.path === options.path && sameArgs(item.args, options.args));
      return {
        openAtLogin: Boolean(match?.enabled),
        executableWillLaunchAtLogin: Boolean(match?.enabled),
        launchItems: items,
      };
    },
    setLoginItemSettings(value) {
      calls.set.push({ ...value, args: [...(value.args || [])] });
      if (value.type) {
        records.set("mac-main", { enabled: Boolean(value.openAtLogin) });
        return;
      }
      records.set(value.name, {
        name: value.name,
        path: value.path,
        args: [...(value.args || [])],
        enabled: Boolean(value.openAtLogin && value.enabled !== false),
        scope: "user",
      });
    },
  };
}

const portableLauncher = "C:\\AI\\apps\\NeoXider Agent Deck\\NeoXider Agent Deck.exe";
const temporaryChild = "C:\\Users\\User\\AppData\\Local\\Temp\\widget\\DeepSeek Harness Widget.exe";
const legacyName = LEGACY_LOGIN_ITEM_NAMES[0];

test("new login item uses the stable product id and portable launcher", () => {
  const app = createFakeApp();
  const controller = createAutoStartController({ app, env: { PORTABLE_EXECUTABLE_FILE: portableLauncher }, execPath: temporaryChild, platform: "win32" });

  assert.equal(LOGIN_ITEM_NAME, "dev.neoxider.agentdeck");
  assert.deepEqual(controller.target, { path: portableLauncher, args: [] });
  assert.equal(controller.setEnabled(true), true);
  assert.equal(app.calls.set[0].name, LOGIN_ITEM_NAME);
  assert.equal(app.calls.set[0].path, portableLauncher);
});

test("enable, query, and disable use the identical target", () => {
  const app = createFakeApp();
  const options = { app, env: { PORTABLE_EXECUTABLE_FILE: portableLauncher }, execPath: temporaryChild, platform: "win32" };
  const controller = createAutoStartController(options);

  assert.equal(controller.setEnabled(true), true);
  assert.equal(createAutoStartController(options).getEnabled(), true);
  assert.equal(controller.setEnabled(false), false);
  assert.ok(app.calls.get.filter((value) => value?.path).every((value) => value.path === portableLauncher && sameArgs(value.args, [])));
});

test("an unpackaged run uses Electron plus the app path", () => {
  assert.deepEqual(resolveLoginItemTarget({
    env: {},
    execPath: "C:\\Electron\\electron.exe",
    isPackaged: false,
    appPath: "C:\\AI\\work\\deepseek-harness-widget",
    platform: "win32",
  }), {
    path: "C:\\Electron\\electron.exe",
    args: ["C:\\AI\\work\\deepseek-harness-widget"],
  });
});

test("another Electron startup entry does not enable this app", () => {
  assert.equal(loginItemEnabled({ openAtLogin: false, executableWillLaunchAtLogin: true }, "win32"), false);
});

test("quoted Windows Run output yields its executable path", () => {
  const output = `\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\r\n    ${legacyName}    REG_SZ    "${temporaryChild}" --hidden\r\n`;
  assert.equal(parseWindowsRunItemPath(output, legacyName), temporaryChild);
});

test("Windows Run deletion targets one exact whitelisted legacy value", () => {
  const calls = [];
  const result = deleteWindowsRunItem(legacyName, (...args) => calls.push(args), { SystemRoot: "C:\\Windows" });

  assert.deepEqual(result, { ok: true, deleted: true, name: legacyName });
  assert.deepEqual(calls, [[
    "C:\\Windows\\System32\\reg.exe",
    ["delete", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", legacyName, "/f"],
    { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  ]]);
});

test("Windows Run deletion rejects unrelated value names without touching the registry", () => {
  const calls = [];
  const result = deleteWindowsRunItem("Unrelated Startup App", (...args) => calls.push(args), {});

  assert.equal(result.ok, false);
  assert.equal(result.reason, "not-legacy-name");
  assert.deepEqual(calls, []);
});

test("enabled legacy item migrates to the new target and is disabled only after verification", () => {
  const app = createFakeApp({ launchItems: [{ name: legacyName, path: temporaryChild, args: [], enabled: true, scope: "user" }] });
  const deleted = [];
  const controller = createAutoStartController({
    app,
    env: { PORTABLE_EXECUTABLE_FILE: portableLauncher },
    execPath: temporaryChild,
    platform: "win32",
    readRunItemPath: (name) => name === legacyName ? temporaryChild : "",
    deleteRunItem: (name) => {
      assert.equal(app.getLoginItemSettings({ path: portableLauncher, args: [] }).openAtLogin, true);
      deleted.push(name);
      return { ok: true, deleted: true, name };
    },
  });

  assert.equal(controller.migrateLegacy(), true);
  assert.deepEqual(app.calls.set.map((value) => [value.name, value.openAtLogin]), [
    [LOGIN_ITEM_NAME, true],
    [legacyName, false],
  ]);
  assert.deepEqual(deleted, [legacyName]);
  assert.equal(controller.getLastMigrationResult().status, "migrated");
});

test("disabled legacy StartupApproved item stays disabled even when its raw Run value exists", () => {
  const app = createFakeApp({ launchItems: [{ name: legacyName, path: temporaryChild, args: [], enabled: false, scope: "user" }] });
  const controller = createAutoStartController({
    app,
    env: { PORTABLE_EXECUTABLE_FILE: portableLauncher },
    execPath: temporaryChild,
    platform: "win32",
    readRunItemPath: (name) => name === legacyName ? temporaryChild : "",
  });

  assert.equal(controller.migrateLegacy(), false);
  assert.equal(app.calls.set.length, 0);
});

test("an already-enabled new target cleans a raw value left by a partial legacy migration", () => {
  const app = createFakeApp({
    launchItems: [{ name: legacyName, path: temporaryChild, args: [], enabled: false, scope: "user" }],
  });
  app.setLoginItemSettings({
    openAtLogin: true,
    enabled: true,
    name: LOGIN_ITEM_NAME,
    path: portableLauncher,
    args: [],
  });
  app.calls.set.length = 0;
  const deleted = [];
  const controller = createAutoStartController({
    app,
    env: { PORTABLE_EXECUTABLE_FILE: portableLauncher },
    execPath: temporaryChild,
    platform: "win32",
    readRunItemPath: (name) => name === legacyName ? temporaryChild : "",
    deleteRunItem: (name) => {
      deleted.push(name);
      return { ok: true, deleted: true, name };
    },
  });

  assert.equal(controller.migrateLegacy(), true);
  assert.deepEqual(deleted, [legacyName]);
  assert.equal(controller.getLastMigrationResult().status, "recovered-partial-migration");
  assert.equal(app.calls.set.length, 0);
});

test("raw Run fallback verifies the new target before deleting the exact legacy value", () => {
  const app = createFakeApp();
  const deleted = [];
  const controller = createAutoStartController({
    app,
    env: { PORTABLE_EXECUTABLE_FILE: portableLauncher },
    execPath: temporaryChild,
    platform: "win32",
    readRunItemPath: (name) => name === legacyName ? temporaryChild : "",
    deleteRunItem: (name) => {
      assert.equal(app.getLoginItemSettings({ path: portableLauncher, args: [] }).openAtLogin, true);
      deleted.push(name);
      return { ok: true, deleted: true, name };
    },
  });

  assert.equal(controller.migrateLegacy(), true);
  assert.deepEqual(app.calls.set.map((value) => [value.name, value.openAtLogin]), [
    [LOGIN_ITEM_NAME, true],
  ]);
  assert.deepEqual(deleted, [legacyName]);
});

test("a failed target verification leaves the legacy Run value untouched", () => {
  const app = createFakeApp();
  app.setLoginItemSettings = (value) => app.calls.set.push(value);
  const deleted = [];
  const controller = createAutoStartController({
    app,
    env: { PORTABLE_EXECUTABLE_FILE: portableLauncher },
    execPath: temporaryChild,
    platform: "win32",
    readRunItemPath: (name) => name === legacyName ? temporaryChild : "",
    deleteRunItem: (name) => {
      deleted.push(name);
      return { ok: true, deleted: true, name };
    },
  });

  assert.equal(controller.migrateLegacy(), false);
  assert.deepEqual(deleted, []);
  assert.equal(controller.getLastMigrationResult().status, "target-verification-failed");
});

test("a registry cleanup failure is observable while the verified new target stays enabled", () => {
  const app = createFakeApp();
  const issues = [];
  const controller = createAutoStartController({
    app,
    env: { PORTABLE_EXECUTABLE_FILE: portableLauncher },
    execPath: temporaryChild,
    platform: "win32",
    readRunItemPath: (name) => name === legacyName ? temporaryChild : "",
    deleteRunItem: (name) => ({ ok: false, deleted: false, name, reason: "delete-failed" }),
    reportMigrationIssue: (issue) => issues.push(issue),
  });

  assert.equal(controller.migrateLegacy(), false);
  assert.equal(controller.getEnabled(), true);
  assert.equal(controller.getLastMigrationResult().status, "cleanup-failed");
  assert.equal(issues.length, 1);
  assert.deepEqual(issues[0].cleanupFailures, [{ ok: false, deleted: false, name: legacyName, reason: "delete-failed" }]);
});

test("Linux reports autostart unavailable instead of calling an unsupported Electron API", () => {
  const app = { isPackaged: true, getAppPath: () => "/app" };
  const controller = createAutoStartController({ app, env: {}, execPath: "/app/neoxider-agent-deck", platform: "linux" });

  assert.equal(controller.available, false);
  assert.equal(controller.getEnabled(), false);
  assert.equal(controller.setEnabled(true), false);
});

test("macOS uses the signed main-app login service contract", () => {
  const app = createFakeApp();
  const controller = createAutoStartController({ app, env: {}, execPath: "/Applications/NeoXider Agent Deck.app", platform: "darwin" });

  assert.equal(controller.setEnabled(true), true);
  assert.deepEqual(app.calls.set[0], { type: "mainAppService", openAtLogin: true, args: [] });
});
