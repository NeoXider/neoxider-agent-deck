// Which update service this build gets, decided in one place.
//
// A portable or unpackaged build replaces its own executable through the GitHub release
// pipeline; an installed build delegates to electron-updater. The choice used to live inline
// in main.cjs, where it could only be exercised by booting the whole app. Everything that
// depends on Electron or the environment arrives as a parameter, so the decision is testable
// on its own, and a missing electron-updater degrades to an installed service with no
// updater instead of taking startup down with it.
const { createUpdateService } = require("./update-service.cjs");
const { createInstalledUpdateService } = require("./installed-update-service.cjs");

function loadElectronUpdater() {
  return require("electron-updater").autoUpdater;
}

function createApplicationUpdateService({
  currentVersion,
  isPackaged,
  portableExecutable = "",
  openExternal,
  onState,
  requestQuit,
  isMas = false,
  isWindowsStore = false,
  loadUpdater = loadElectronUpdater,
  onUpdaterUnavailable = (error) => console.error("Installed updater is unavailable", error),
  createPortable = createUpdateService,
  createInstalled = createInstalledUpdateService,
} = {}) {
  const shared = { currentVersion, isPackaged, openExternal, onState };
  if (!isPackaged || portableExecutable) {
    return createPortable({ ...shared, requestQuit });
  }
  let updater = null;
  try {
    updater = loadUpdater();
  } catch (error) {
    onUpdaterUnavailable(error);
  }
  return createInstalled({
    ...shared,
    updater,
    isMas: Boolean(isMas),
    isWindowsStore: Boolean(isWindowsStore),
    isMacSigned: false,
  });
}

module.exports = { createApplicationUpdateService };
