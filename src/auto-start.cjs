const path = require("node:path");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const { APP_ID, LEGACY, PRODUCT_NAME } = require("./product.cjs");

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

// Linux has no login-item API, so autostart is the freedesktop.org convention: a
// .desktop file under $XDG_CONFIG_HOME/autostart. Electron's setLoginItemSettings is
// a no-op there, which is why this used to report itself as simply unavailable.
function linuxAutostartPath(env) {
  // Explicitly posix: this branch describes a Linux filesystem even when the test
  // process itself runs on Windows.
  const configHome = typeof env.XDG_CONFIG_HOME === "string" && env.XDG_CONFIG_HOME.trim()
    ? env.XDG_CONFIG_HOME.trim()
    : path.posix.join(env.HOME || "", ".config");
  return path.posix.join(configHome, "autostart", `${APP_ID}.desktop`);
}

function desktopEntry(target) {
  const exec = [target.path, ...target.args]
    .map((part) => (/[\s"']/.test(part) ? `"${String(part).replaceAll('"', '\\"')}"` : part))
    .join(" ");
  return [
    "[Desktop Entry]",
    "Type=Application",
    `Name=${PRODUCT_NAME}`,
    `Exec=${exec}`,
    "X-GNOME-Autostart-enabled=true",
    "Terminal=false",
    "",
  ].join("\n");
}

function createAutoStartController({
  app,
  env = process.env,
  execPath = process.execPath,
  platform = process.platform,
  readRunItemPath = (name) => readWindowsRunItemPath(name, execFileSync, env),
  deleteRunItem = (name) => deleteWindowsRunItem(name, execFileSync, env),
  reportMigrationIssue = (issue) => console.warn("Auto-start migration cleanup failed", issue),
  fileSystem = fs,
} = {}) {
  const target = resolveLoginItemTarget({ env, execPath, platform, isPackaged: app.isPackaged, appPath: app.getAppPath() });

  if (platform === "linux") {
    const entryPath = linuxAutostartPath(env);
    return {
      available: true,
      target,
      getEnabled() {
        try { return fileSystem.existsSync(entryPath); } catch { return false; }
      },
      setEnabled(enabled) {
        try {
          if (enabled) {
            fileSystem.mkdirSync(path.posix.dirname(entryPath), { recursive: true });
            fileSystem.writeFileSync(entryPath, desktopEntry(target), { encoding: "utf8", mode: 0o644 });
          } else {
            fileSystem.rmSync(entryPath, { force: true });
          }
        } catch (error) {
          reportMigrationIssue({ step: "linux-autostart", error: error instanceof Error ? error.message : String(error) });
        }
        return this.getEnabled();
      },
      migrateLegacy() { return this.getEnabled(); },
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
  const samePath = (left, right) => (
    path.win32.normalize(String(left || "")).toLowerCase() === path.win32.normalize(String(right || "")).toLowerCase()
  );
  const sameTarget = (item) => (
    samePath(item?.path, target.path)
    && (item?.args || []).length === target.args.length
    && (item?.args || []).every((argument, index) => argument === target.args[index])
  );
  const legacyItems = () => launchItems().filter((item) => (
    LEGACY_LOGIN_ITEM_NAMES.includes(item?.name)
    && typeof item.path === "string"
  ));
  const relocatedCurrentItems = () => launchItems().filter((item) => (
    item?.name === LOGIN_ITEM_NAME
    && typeof item.path === "string"
    && !sameTarget(item)
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
  const cleanupLegacyItems = () => {
    const knownLegacy = legacyItems();
    disableLegacy(knownLegacy.filter((item) => item.enabled !== false));
    const failures = [];
    for (const name of LEGACY_LOGIN_ITEM_NAMES) {
      const rawPath = readRunItemPath(name);
      if (!rawPath) continue;
      if (!knownLegacy.some((item) => item.name === name)) writeItem(name, { path: rawPath, args: [] }, false);
      const result = deleteRunItem(name);
      if (!result?.ok) failures.push(result || { ok: false, deleted: false, name, reason: "unknown" });
    }
    return failures;
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
      const currentEnabled = this.getEnabled();
      if (enabled && !currentEnabled) return false;
      const cleanupFailures = cleanupLegacyItems();
      if (cleanupFailures.length) {
        reportMigrationIssue({ step: "set-enabled-legacy-cleanup", enabled: Boolean(enabled), cleanupFailures });
      }
      return enabled ? currentEnabled : this.getEnabled();
    },
    getLastMigrationResult() {
      return lastMigrationResult;
    },
    migrateLegacy() {
      const knownLegacy = legacyItems();
      const enabledRelocatedCurrent = relocatedCurrentItems().filter((item) => item.enabled !== false);
      const rawCurrentPath = readRunItemPath(LOGIN_ITEM_NAME);
      const enabledRawCurrent = Boolean(rawCurrentPath && !samePath(rawCurrentPath, target.path));
      const relocateCurrent = enabledRelocatedCurrent.length > 0 || enabledRawCurrent;
      const rawLegacyNames = LEGACY_LOGIN_ITEM_NAMES.filter((name) => Boolean(readRunItemPath(name)));
      if (knownLegacy.length) {
        const enabledLegacy = knownLegacy.filter((item) => item.enabled !== false);
        if (!enabledLegacy.length && !relocateCurrent) {
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
      if (!enabledLegacy.length && !rawLegacyNames.length && !relocateCurrent) {
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

      lastMigrationResult = {
        status: relocateCurrent ? "relocated-current-target" : "migrated",
        migrated: true,
        enabled: true,
        deletedRunItems: rawLegacyNames,
      };
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
