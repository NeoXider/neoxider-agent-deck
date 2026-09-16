// Last-resort handlers for the main process.
//
// Node's default for an unhandled rejection is to throw, and in Electron's main process an
// uncaught exception ends the app with no window, no tray and no message. So a throw anywhere
// during startup (the tray, the hotkeys, the autostart controller) or inside a websocket
// callback took the whole widget down silently, and the user saw it simply vanish. These keep
// the process alive and leave a line in the log that says what happened.
function installProcessGuards({ processRef = process, log = console.error } = {}) {
  const onException = (error) => {
    log("Uncaught exception in the main process", error);
  };
  const onRejection = (reason) => {
    log("Unhandled promise rejection in the main process", reason);
  };
  processRef.on("uncaughtException", onException);
  processRef.on("unhandledRejection", onRejection);
  return function removeProcessGuards() {
    processRef.off?.("uncaughtException", onException);
    processRef.off?.("unhandledRejection", onRejection);
  };
}

module.exports = { installProcessGuards };
