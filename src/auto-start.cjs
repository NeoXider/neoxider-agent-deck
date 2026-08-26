const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { APP_ID, LEGACY } = require("./product.cjs");

const LOGIN_ITEM_NAME = APP_ID;
const LEGACY_LOGIN_ITEM_NAMES = LEGACY.loginItemNames;
const WINDOWS_RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";

function resolveLoginItemTarget({ env = process.env, execPath = process.execPath, isPackaged = true, appPath = "", platform = process.platform } = {}) {
  const portablePath = typeof env.PORTABLE_EXECUTABLE_FILE === "string" ? env.PORTABLE_EXECUTABLE_FILE.trim() : "";
  if (platform === "win32" && portablePath && path.win32.isAbsolute(portablePath)) return { path: portablePath, args: [] };
  if (!isPackaged && appPath) return { path: execPath, args: [appPath] };
  return { path: execPath, args: [] };
}

function loginItemEnabled(settings, platform = process.platform) {
  const exactTargetEnabled = Boolean(settings?.openAtLogin);
  if (platform !== "win32") return exactTargetEnabled;
  return exactTargetEnabled && settings?.executableWillLaunchAtLogin !== false;
}

function parseWindowsRunItemPath(output, name = LOGIN_ITEM_NAME) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(output || "").match(new RegExp(`^\\s*${escapedName}\\s+REG_[A-Z0-9_]+\\s+(.+)$`, "im"));
  if (!match) return "";
  const command = match[1].trim();
  if (command.startsWith('"')) {
    const closingQuote = command.indexOf('"', 1);
    return closingQuote > 1 ? command.slice(1, closingQuote) : "";
  }
  return command.match(/^\S+/)?.[0] || "";
}

function readWindowsRunItemPath(name = LOGIN_ITEM_NAME, run = execFileSync, env = process.env) {
  try {
    const executable = env.SystemRoot ? path.win32.join(env.SystemRoot, "System32", "reg.exe") : "reg.exe";
    const output = run(executable, [
      "query",
      WINDOWS_RUN_KEY,
      "/v",
      name,
    ], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    return parseWindowsRunItemPath(output, name);
  } catch {
    return "";
  }
}

function deleteWindowsRunItem(name, run = execFileSync, env = process.env) {
  if (!LEGACY_LOGIN_ITEM_NAMES.includes(name)) {
    return { ok: false, deleted: false, name: String(name || ""), reason: "not-legacy-name" };
  }

  try {
    const executable = env.SystemRoot ? path.win32.join(env.SystemRoot, "System32", "reg.exe") : "reg.exe";
    run(executable, ["delete", WINDOWS_RUN_KEY, "/v", name, "/f"], {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, deleted: true, name };
  } catch (error) {
    return {
      ok: false,
      deleted: false,
      name,
      reason: "delete-failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function createAutoStartController({
  app,
  env = process.env,
  execPath = process.execPath,
  platform = process.platform,
  readRunItemPath = (name) => readWindowsRunItemPath(name, execFileSync, env),
  deleteRunItem = (name) => deleteWindowsRunItem(name, execFileSync, env),
  reportMigrationIssue = (issue) => console.warn("Auto-start migration cleanup failed", issue),
} = {}) {
  const target = resolveLoginItemTarget({ env, execPath, platform, isPackaged: app.isPackaged, appPath: app.getAppPath() });

  if (platform === "linux") {
    return {
      available: false,
      target,
      getEnabled: () => false,
      setEnabled: () => false,
      migrateLegacy: () => false,
    };
  }

  if (platform === "darwin") {
    const options = { type: "mainAppService" };
    return {
      available: true,
      target,
      getEnabled: () => loginItemEnabled(app.getLoginItemSettings(options), platform),
      setEnabled(enabled) {
        app.setLoginItemSettings({ ...options, openAtLogin: Boolean(enabled) });
        return this.getEnabled();
      },
      migrateLegacy() { return this.getEnabled(); },
    };
  }

  const query = () => app.getLoginItemSettings({ path: target.path, args: target.args });
  const launchItems = () => app.getLoginItemSettings()?.launchItems || [];
  const legacyItems = () => launchItems().filter((item) => (
    LEGACY_LOGIN_ITEM_NAMES.includes(item?.name)
    && typeof item.path === "string"
  ));
  const writeItem = (name, itemTarget, enabled) => app.setLoginItemSettings({
    openAtLogin: Boolean(enabled),
    enabled: Boolean(enabled),
    name,
    path: itemTarget.path,
    args: itemTarget.args || [],
  });
  const disableLegacy = (items) => {
    for (const item of items) writeItem(item.name, { path: item.path, args: item.args || [] }, false);
  };
  let lastMigrationResult = { status: "not-run", migrated: false };

  return {
    available: true,
    target,
    getEnabled() {
      return loginItemEnabled(query(), platform);
    },
    setEnabled(enabled) {
      writeItem(LOGIN_ITEM_NAME, target, enabled);
      if (!enabled) disableLegacy(legacyItems().filter((item) => item.enabled !== false));
      return this.getEnabled();
    },
    getLastMigrationResult() {
      return lastMigrationResult;
    },
    migrateLegacy() {
      if (!env.PORTABLE_EXECUTABLE_FILE) {
        const enabled = this.getEnabled();
        lastMigrationResult = { status: "not-portable", migrated: false, enabled };
        return enabled;
      }
      const knownLegacy = legacyItems();
      const rawLegacyNames = LEGACY_LOGIN_ITEM_NAMES.filter((name) => Boolean(readRunItemPath(name)));
      if (knownLegacy.length) {
        const enabledLegacy = knownLegacy.filter((item) => item.enabled !== false);
        if (!enabledLegacy.length) {
          const enabled = this.getEnabled();
          if (enabled && rawLegacyNames.length) {
            const cleanupFailures = rawLegacyNames
              .map((name) => deleteRunItem(name))
              .filter((result) => !result?.ok);
            if (cleanupFailures.length) {
              lastMigrationResult = { status: "cleanup-failed", migrated: false, enabled: true, cleanupFailures };
              reportMigrationIssue(lastMigrationResult);
              return false;
            }
            lastMigrationResult = { status: "recovered-partial-migration", migrated: true, enabled: true, deletedRunItems: rawLegacyNames };
            return true;
          }
          lastMigrationResult = { status: "legacy-disabled", migrated: false, enabled };
          return enabled;
        }
      }

      const enabledLegacy = knownLegacy.filter((item) => item.enabled !== false);
      if (!enabledLegacy.length && !rawLegacyNames.length) {
        const enabled = this.getEnabled();
        lastMigrationResult = { status: "nothing-to-migrate", migrated: false, enabled };
        return enabled;
      }

      writeItem(LOGIN_ITEM_NAME, target, true);
      if (!this.getEnabled()) {
        lastMigrationResult = { status: "target-verification-failed", migrated: false, enabled: false };
        return false;
      }

      disableLegacy(enabledLegacy);
      const cleanupFailures = [];
      for (const name of rawLegacyNames) {
        const result = deleteRunItem(name);
        if (!result?.ok) cleanupFailures.push(result || { ok: false, deleted: false, name, reason: "unknown" });
      }
      if (cleanupFailures.length) {
        lastMigrationResult = { status: "cleanup-failed", migrated: false, enabled: true, cleanupFailures };
        reportMigrationIssue(lastMigrationResult);
        return false;
      }

      lastMigrationResult = { status: "migrated", migrated: true, enabled: true, deletedRunItems: rawLegacyNames };
      return true;
    },
  };
}

module.exports = {
  LEGACY_LOGIN_ITEM_NAMES,
  LOGIN_ITEM_NAME,
  createAutoStartController,
  deleteWindowsRunItem,
  loginItemEnabled,
  parseWindowsRunItemPath,
  readWindowsRunItemPath,
  resolveLoginItemTarget,
};
