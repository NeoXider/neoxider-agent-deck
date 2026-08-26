const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { APP_ID, LEGACY } = require("./product.cjs");

const LOGIN_ITEM_NAME = APP_ID;
const LEGACY_LOGIN_ITEM_NAMES = LEGACY.loginItemNames;

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
      "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
      "/v",
      name,
    ], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    return parseWindowsRunItemPath(output, name);
  } catch {
    return "";
  }
}

function sameWindowsPath(left, right) {
  return Boolean(left && right) && path.win32.normalize(left).toLowerCase() === path.win32.normalize(right).toLowerCase();
}

function createAutoStartController({
  app,
  env = process.env,
  execPath = process.execPath,
  platform = process.platform,
  readRunItemPath = (name) => readWindowsRunItemPath(name, execFileSync, env),
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
    migrateLegacy() {
      if (!env.PORTABLE_EXECUTABLE_FILE) return this.getEnabled();
      const knownLegacy = legacyItems();
      if (knownLegacy.length) {
        const enabledLegacy = knownLegacy.filter((item) => item.enabled !== false);
        if (!enabledLegacy.length) return this.getEnabled();
        writeItem(LOGIN_ITEM_NAME, target, true);
        if (!this.getEnabled()) return false;
        disableLegacy(enabledLegacy);
        return true;
      }

      for (const name of LEGACY_LOGIN_ITEM_NAMES) {
        const registeredPath = readRunItemPath(name);
        if (!registeredPath || sameWindowsPath(registeredPath, target.path)) continue;
        writeItem(LOGIN_ITEM_NAME, target, true);
        if (!this.getEnabled()) return false;
        disableLegacy([{ name, path: registeredPath, args: [] }]);
        return true;
      }
      return this.getEnabled();
    },
  };
}

module.exports = {
  LEGACY_LOGIN_ITEM_NAMES,
  LOGIN_ITEM_NAME,
  createAutoStartController,
  loginItemEnabled,
  parseWindowsRunItemPath,
  readWindowsRunItemPath,
  resolveLoginItemTarget,
};
