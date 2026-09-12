const path = require("node:path");
const { APP_ID, PRODUCT_NAME } = require("./product.cjs");
const { resolveLoginItemTarget } = require("./auto-start.cjs");

const PRODUCT_ICON = path.join(__dirname, "renderer", "assets", "neoxider-github.png");
const PRODUCT_ICO = path.join(__dirname, "renderer", "assets", "neoxider-github.ico");
const PRODUCT_WINDOW_OPTIONS = Object.freeze({ title: PRODUCT_NAME, icon: PRODUCT_ICON });

function quoteWindowsArgument(value) {
  return `"${String(value).replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`;
}

function applyWindowIdentity(window, { app, platform = process.platform, execPath = process.execPath, env = process.env } = {}) {
  if (platform !== "win32") return;
  const target = resolveLoginItemTarget({ platform, execPath, env, isPackaged: app.isPackaged, appPath: app.getAppPath() });
  window.setAppDetails({
    appId: APP_ID,
    // Explorer cannot read a PNG or a file inside app.asar as a relaunch icon.
    appIconPath: app.isPackaged ? target.path : PRODUCT_ICO,
    appIconIndex: 0,
    relaunchCommand: [target.path, ...target.args].map(quoteWindowsArgument).join(" "),
    relaunchDisplayName: PRODUCT_NAME,
  });
}

module.exports = { PRODUCT_ICON, PRODUCT_ICO, PRODUCT_WINDOW_OPTIONS, applyWindowIdentity, quoteWindowsArgument };
