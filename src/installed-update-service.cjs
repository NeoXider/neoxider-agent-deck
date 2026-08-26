const path = require("node:path");
const { REPOSITORY_SLUG } = require("./product.cjs");
const { compareStableVersions, parseStableVersion } = require("./update-service.cjs");

const STATUSES = Object.freeze([
  "idle",
  "checking",
  "current",
  "available",
  "downloading",
  "ready",
  "installing",
  "error",
]);
const TRANSITIONS = Object.freeze({
  idle: new Set(["checking"]),
  checking: new Set(["current", "available", "error"]),
  current: new Set(["checking", "error"]),
  available: new Set(["checking", "downloading", "error"]),
  downloading: new Set(["ready", "error"]),
  ready: new Set(["installing", "error"]),
  installing: new Set(["error"]),
  error: new Set(["checking"]),
});

function detectInstalledChannel({
  platform = process.platform,
  env = process.env,
  isPackaged = false,
  isMacSigned = false,
  isMas = false,
  isWindowsStore = false,
  windowsTarget = "nsis",
} = {}) {
  if (!isPackaged) return { supported: false, channel: null, reason: "development-build" };
  if (platform === "win32") {
    if (isWindowsStore) return { supported: false, channel: null, reason: "managed-by-store" };
    if (env.PORTABLE_EXECUTABLE_FILE) return { supported: false, channel: null, reason: "portable-update-channel" };
    if (windowsTarget !== "nsis") return { supported: false, channel: null, reason: "unsupported-windows-package" };
    return { supported: true, channel: "nsis", reason: null };
  }
  if (platform === "darwin") {
    if (isMas) return { supported: false, channel: null, reason: "managed-by-store" };
    if (!isMacSigned) return { supported: false, channel: null, reason: "unsigned-macos-build" };
    return { supported: true, channel: "mac", reason: null };
  }
  if (platform === "linux") {
    const appImage = typeof env.APPIMAGE === "string" ? env.APPIMAGE.trim() : "";
    if (!appImage || !path.posix.isAbsolute(appImage)) {
      return { supported: false, channel: null, reason: "unsupported-linux-package" };
    }
    return { supported: true, channel: "appimage", reason: null };
  }
  return { supported: false, channel: null, reason: "unsupported-platform" };
}

function publicError(error, fallbackCode, fallbackMessage) {
  return Object.freeze({
    code: String(error?.code || fallbackCode),
    message: String(error?.message || fallbackMessage),
  });
}

function releaseUrl(repository, version = null) {
  return version
    ? `https://github.com/${repository}/releases/tag/v${version}`
    : `https://github.com/${repository}/releases/latest`;
}

function updateFileView(info) {
  const file = Array.isArray(info?.files) ? info.files[0] : null;
  const rawName = String(file?.url || info?.path || "");
  let name = "";
  if (rawName) {
    try {
      name = path.posix.basename(decodeURIComponent(new URL(rawName, "https://updates.invalid/").pathname));
    } catch {
      name = path.posix.basename(rawName.replaceAll("\\", "/"));
    }
  }
  const size = Number(file?.size);
  return {
    name: name || null,
    size: Number.isSafeInteger(size) && size > 0 ? size : 0,
  };
}

function createInstalledUpdateService({
  currentVersion,
  updater = null,
  repository = REPOSITORY_SLUG,
  platform = process.platform,
  env = process.env,
  isPackaged = false,
  isMacSigned = false,
  isMas = false,
  isWindowsStore = false,
  windowsTarget = "nsis",
  openExternal = null,
  onState = () => {},
} = {}) {
  if (!parseStableVersion(currentVersion)) throw new TypeError("currentVersion must be a stable semantic version");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new TypeError("repository must be owner/name");

  const detected = detectInstalledChannel({
    platform,
    env,
    isPackaged,
    isMacSigned,
    isMas,
    isWindowsStore,
    windowsTarget,
  });
  const managed = detected.supported && updater && typeof updater.on === "function";
  const manualReason = detected.supported && !managed ? "updater-unavailable" : detected.reason;
  let state = Object.freeze({
    status: "idle",
    currentVersion,
    latestVersion: null,
    releaseUrl: releaseUrl(repository),
    assetName: null,
    assetSize: 0,
    installMode: managed ? "managed" : "manual",
    manualReason: managed ? null : manualReason,
    progress: null,
    receivedBytes: 0,
    totalBytes: 0,
    error: null,
  });
  let candidate = null;
  let checkPromise = null;
  let downloadPromise = null;
  let installPromise = null;

  function snapshot() {
    return Object.freeze({ ...state, error: state.error ? Object.freeze({ ...state.error }) : null });
  }

  function publish() {
    const value = snapshot();
    try { onState(value); } catch {}
    return value;
  }

  function transition(status, patch = {}) {
    if (!STATUSES.includes(status)) throw new TypeError(`Unknown update status: ${status}`);
    if (status !== state.status && !TRANSITIONS[state.status]?.has(status)) {
      throw new Error(`Invalid update transition: ${state.status} -> ${status}`);
    }
    state = Object.freeze({
      ...state,
      ...patch,
      status,
      error: status === "error" ? patch.error : null,
    });
    return publish();
  }

  function fail(error, code, message) {
    if (!["checking", "current", "available", "downloading", "ready", "installing"].includes(state.status)) return snapshot();
    return transition("error", { error: publicError(error, code, message), progress: null });
  }

  function setAvailable(info) {
    const version = String(info?.version || "");
    if (!parseStableVersion(version) || compareStableVersions(version, currentVersion) <= 0) {
      candidate = null;
      if (state.status === "checking") {
        return transition("current", {
          latestVersion: parseStableVersion(version) ? version : currentVersion,
          releaseUrl: releaseUrl(repository, parseStableVersion(version) ? version : currentVersion),
          assetName: null,
          assetSize: 0,
          installMode: "none",
          manualReason: null,
          progress: null,
          receivedBytes: 0,
          totalBytes: 0,
        });
      }
      return snapshot();
    }
    const file = updateFileView(info);
    candidate = Object.freeze({ info, version, file });
    if (state.status !== "checking") return snapshot();
    return transition("available", {
      latestVersion: version,
      releaseUrl: releaseUrl(repository, version),
      assetName: file.name,
      assetSize: file.size,
      installMode: "managed",
      manualReason: null,
      progress: null,
      receivedBytes: 0,
      totalBytes: file.size,
    });
  }

  function setCurrent(info = null) {
    if (state.status !== "checking") return snapshot();
    const version = parseStableVersion(String(info?.version || "")) ? String(info.version) : currentVersion;
    candidate = null;
    return transition("current", {
      latestVersion: version,
      releaseUrl: releaseUrl(repository, version),
      assetName: null,
      assetSize: 0,
      installMode: "none",
      manualReason: null,
      progress: null,
      receivedBytes: 0,
      totalBytes: 0,
    });
  }

  function setProgress(progress) {
    if (state.status !== "downloading") return snapshot();
    const rawPercent = Number(progress?.percent);
    const transferred = Number(progress?.transferred);
    const total = Number(progress?.total);
    return transition("downloading", {
      progress: Number.isFinite(rawPercent) ? Math.max(0, Math.min(100, Math.floor(rawPercent))) : state.progress,
      receivedBytes: Number.isFinite(transferred) && transferred >= 0 ? Math.floor(transferred) : state.receivedBytes,
      totalBytes: Number.isFinite(total) && total >= 0 ? Math.floor(total) : state.totalBytes,
    });
  }

  function setDownloaded(info = null) {
    if (state.status !== "downloading") return snapshot();
    if (info?.version && candidate?.version && info.version !== candidate.version) {
      return fail({ code: "UPDATE_VERSION_MISMATCH", message: "The downloaded update version is invalid" }, "UPDATE_VERSION_MISMATCH", "The downloaded update version is invalid");
    }
    return transition("ready", {
      progress: 100,
      receivedBytes: state.totalBytes || state.receivedBytes,
    });
  }

  if (managed) {
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    updater.on("checking-for-update", () => {
      if (state.status === "checking") publish();
    });
    updater.on("update-available", setAvailable);
    updater.on("update-not-available", setCurrent);
    updater.on("download-progress", setProgress);
    updater.on("update-downloaded", setDownloaded);
    updater.on("error", (error) => fail(error, "UPDATE_FAILED", "Update failed"));
  }

  async function runManualCheck() {
    transition("checking", { progress: null, receivedBytes: 0, totalBytes: 0 });
    return transition("current", {
      latestVersion: null,
      releaseUrl: releaseUrl(repository),
      assetName: null,
      assetSize: 0,
      installMode: "manual",
      manualReason,
    });
  }

  async function runCheck() {
    if (!managed) return runManualCheck();
    transition("checking", {
      latestVersion: null,
      assetName: null,
      assetSize: 0,
      installMode: "managed",
      manualReason: null,
      progress: null,
      receivedBytes: 0,
      totalBytes: 0,
    });
    try {
      const result = await updater.checkForUpdates();
      if (state.status !== "checking") return snapshot();
      if (result?.isUpdateAvailable === true) return setAvailable(result.updateInfo);
      return setCurrent(result?.updateInfo);
    } catch (error) {
      if (state.status !== "checking") return snapshot();
      return fail(error, "UPDATE_CHECK_FAILED", "Could not check for updates");
    }
  }

  function check() {
    if (checkPromise) return checkPromise;
    if (["downloading", "ready", "installing"].includes(state.status)) return Promise.resolve(snapshot());
    const operation = runCheck();
    checkPromise = operation;
    operation.then(
      () => { if (checkPromise === operation) checkPromise = null; },
      () => { if (checkPromise === operation) checkPromise = null; },
    );
    return operation;
  }

  async function runDownload() {
    if (state.status === "checking" && checkPromise) await checkPromise;
    if (!managed || state.status !== "available" || !candidate) return snapshot();
    transition("downloading", {
      progress: 0,
      receivedBytes: 0,
      totalBytes: candidate.file.size,
    });
    try {
      await updater.downloadUpdate();
      return state.status === "downloading" ? setDownloaded(candidate.info) : snapshot();
    } catch (error) {
      if (state.status !== "downloading") return snapshot();
      return fail(error, "UPDATE_DOWNLOAD_FAILED", "Could not download the update");
    }
  }

  function download() {
    if (downloadPromise) return downloadPromise;
    if (state.status === "ready") return Promise.resolve(snapshot());
    const operation = runDownload();
    downloadPromise = operation;
    operation.then(
      () => { if (downloadPromise === operation) downloadPromise = null; },
      () => { if (downloadPromise === operation) downloadPromise = null; },
    );
    return operation;
  }

  async function openManualRelease() {
    if (state.status === "idle") await check();
    try {
      if (typeof openExternal !== "function") throw new Error("External links are unavailable");
      await openExternal(state.releaseUrl || releaseUrl(repository));
      return Object.freeze({ ...snapshot(), manual: true });
    } catch (error) {
      return fail(error, "UPDATE_RELEASE_OPEN_FAILED", "The release page could not be opened");
    }
  }

  async function runInstall() {
    if (!managed) return openManualRelease();
    if (state.status === "checking" && checkPromise) await checkPromise;
    if (state.status === "downloading" && downloadPromise) await downloadPromise;
    if (state.status === "available") await download();
    if (state.status !== "ready") return snapshot();
    transition("installing", { progress: 100 });
    try {
      await updater.quitAndInstall(false, true);
      return snapshot();
    } catch (error) {
      return fail(error, "UPDATE_INSTALL_FAILED", "The update could not be installed");
    }
  }

  function install() {
    if (installPromise) return installPromise;
    const operation = runInstall();
    installPromise = operation;
    operation.then(
      () => { if (installPromise === operation) installPromise = null; },
      () => { if (installPromise === operation) installPromise = null; },
    );
    return operation;
  }

  return Object.freeze({
    check,
    download,
    getState: snapshot,
    install,
  });
}

module.exports = {
  createInstalledUpdateService,
  detectInstalledChannel,
  updateFileView,
};
