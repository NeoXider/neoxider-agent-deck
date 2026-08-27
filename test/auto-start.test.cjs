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

test("disabling autostart removes a raw legacy Run fallback so restart cannot re-enable it", () => {
  const app = createFakeApp();
  const rawEntries = new Map([[legacyName, temporaryChild]]);
  const options = {
    app,
    env: { PORTABLE_EXECUTABLE_FILE: portableLauncher },
    execPath: temporaryChild,
    platform: "win32",
    readRunItemPath: (name) => rawEntries.get(name) || "",
    deleteRunItem: (name) => {
      rawEntries.delete(name);
      return { ok: true, deleted: true, name };
    },
  };

  assert.equal(createAutoStartController(options).setEnabled(false), false);
  assert.equal(rawEntries.size, 0);
  assert.equal(createAutoStartController(options).migrateLegacy(), false);
  assert.equal(app.getLoginItemSettings({ path: portableLauncher, args: [] }).openAtLogin, false);
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

test("an enabled current-name login item moves to the new portable path", () => {
  const previousPortable = "C:\\Portable\\NeoXider Agent Deck.exe";
  const app = createFakeApp({
    launchItems: [{ name: LOGIN_ITEM_NAME, path: previousPortable, args: [], enabled: true, scope: "user" }],
  });
  const controller = createAutoStartController({
    app,
    env: { PORTABLE_EXECUTABLE_FILE: portableLauncher },
    execPath: temporaryChild,
    platform: "win32",
    readRunItemPath: () => "",
  });

  assert.equal(controller.getEnabled(), false);
  assert.equal(controller.migrateLegacy(), true);
  assert.equal(controller.getEnabled(), true);
  assert.deepEqual(app.calls.set.map((value) => [value.name, value.path, value.openAtLogin]), [
    [LOGIN_ITEM_NAME, portableLauncher, true],
  ]);
  assert.equal(controller.getLastMigrationResult().status, "relocated-current-target");
});

test("a raw current-name Run entry moves even when launchItems omits it", () => {
  const previousPortable = "C:\\Portable\\NeoXider Agent Deck.exe";
  const app = createFakeApp({
    launchItems: [{ name: LOGIN_ITEM_NAME, path: previousPortable, args: [], enabled: true, scope: "user" }],
  });
  const getLoginItemSettings = app.getLoginItemSettings.bind(app);
  app.getLoginItemSettings = (options) => {
    const result = getLoginItemSettings(options);
    return options ? result : { ...result, launchItems: [] };
  };
  const controller = createAutoStartController({
    app,
    env: { PORTABLE_EXECUTABLE_FILE: portableLauncher },
    execPath: temporaryChild,
    platform: "win32",
    readRunItemPath: (name) => name === LOGIN_ITEM_NAME ? previousPortable : "",
  });

  assert.equal(controller.migrateLegacy(), true);
  assert.equal(controller.getEnabled(), true);
  assert.equal(controller.getLastMigrationResult().status, "relocated-current-target");
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

test("Linux never calls the Electron login-item API, which is a no-op there", () => {
  const calls = [];
  const app = {
    isPackaged: true,
    getAppPath: () => "/app",
    getLoginItemSettings: (...args) => { calls.push(["get", args]); return {}; },
    setLoginItemSettings: (...args) => { calls.push(["set", args]); },
  };
  const files = new Map();
  const controller = createAutoStartController({
    app,
    env: { HOME: "/home/user" },
    execPath: "/app/neoxider-agent-deck",
    platform: "linux",
    fileSystem: {
      existsSync: (candidate) => files.has(candidate),
      mkdirSync: () => {},
      writeFileSync: (candidate, contents) => files.set(candidate, contents),
      rmSync: (candidate) => files.delete(candidate),
    },
  });

  controller.setEnabled(true);
  controller.getEnabled();
  controller.setEnabled(false);
  assert.deepEqual(calls, [], "Linux autostart must go through the desktop entry, not Electron");
});

test("macOS uses the signed main-app login service contract", () => {
  const app = createFakeApp();
  const controller = createAutoStartController({ app, env: {}, execPath: "/Applications/NeoXider Agent Deck.app", platform: "darwin" });

  assert.equal(controller.setEnabled(true), true);
  assert.deepEqual(app.calls.set[0], { type: "mainAppService", openAtLogin: true, args: [] });
});

test("Linux autostart writes a freedesktop entry instead of reporting itself unavailable", () => {
  const files = new Map();
  const fileSystem = {
    existsSync: (candidate) => files.has(candidate),
    mkdirSync: () => {},
    writeFileSync: (candidate, contents) => files.set(candidate, contents),
    rmSync: (candidate) => files.delete(candidate),
  };
  const app = {
    isPackaged: true,
    getAppPath: () => "/opt/agent-deck",
    getLoginItemSettings: () => ({}),
    setLoginItemSettings: () => {},
  };
  const controller = createAutoStartController({
    app,
    platform: "linux",
    env: { HOME: "/home/user", XDG_CONFIG_HOME: "/home/user/.config" },
    execPath: "/opt/agent-deck/neoxider-agent-deck",
    fileSystem,
  });

  assert.equal(controller.available, true);
  assert.equal(controller.getEnabled(), false);
  assert.equal(controller.setEnabled(true), true);

  const entryPath = "/home/user/.config/autostart/dev.neoxider.agentdeck.desktop";
  assert.deepEqual([...files.keys()], [entryPath]);
  const entry = files.get(entryPath);
  assert.match(entry, /^\[Desktop Entry\]$/m);
  assert.match(entry, /^Type=Application$/m);
  assert.match(entry, /^Name=NeoXider Agent Deck$/m);
  assert.match(entry, /^Exec=\/opt\/agent-deck\/neoxider-agent-deck$/m);

  assert.equal(controller.setEnabled(false), false);
  assert.equal(files.size, 0);
});

test("Linux autostart falls back to ~/.config when XDG_CONFIG_HOME is unset", () => {
  const files = new Map();
  const controller = createAutoStartController({
    app: { isPackaged: true, getAppPath: () => "/opt/a", getLoginItemSettings: () => ({}), setLoginItemSettings: () => {} },
    platform: "linux",
    env: { HOME: "/home/user" },
    execPath: "/opt/a/deck",
    fileSystem: {
      existsSync: (candidate) => files.has(candidate),
      mkdirSync: () => {},
      writeFileSync: (candidate, contents) => files.set(candidate, contents),
      rmSync: (candidate) => files.delete(candidate),
    },
  });
  controller.setEnabled(true);
  assert.deepEqual([...files.keys()], ["/home/user/.config/autostart/dev.neoxider.agentdeck.desktop"]);
});
