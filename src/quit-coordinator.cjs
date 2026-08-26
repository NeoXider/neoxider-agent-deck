function createQuitCoordinator({ app, cleanup = [], onCleanupError = () => {} } = {}) {
  if (!app || typeof app.quit !== "function") throw new TypeError("app.quit must be available");
  const cleanupSteps = Array.isArray(cleanup) ? cleanup : [cleanup];
  let quitting = false;
  let cleaned = false;
  let reason = "";

  function markQuitting(nextReason = "application") {
    const first = !quitting;
    quitting = true;
    reason ||= String(nextReason || "application");
    app.isQuitting = true;
    return first;
  }

  function runCleanup() {
    if (cleaned) return false;
    cleaned = true;
    for (const step of cleanupSteps) {
      if (typeof step !== "function") continue;
      try {
        step();
      } catch (error) {
        onCleanupError(error);
      }
    }
    return true;
  }

  function requestQuit(nextReason = "user") {
    const first = markQuitting(nextReason);
    runCleanup();
    if (first) app.quit();
    return first;
  }

  function beforeQuit() {
    markQuitting("before-quit");
    runCleanup();
  }

  function handleWindowClose(event, collapse) {
    if (quitting) return true;
    event?.preventDefault?.();
    collapse?.();
    return false;
  }

  function handleActivation(activate) {
    if (quitting) return false;
    activate?.();
    return true;
  }

  function handleRendererGone(details, recover) {
    if (quitting || details?.reason === "clean-exit") return false;
    recover?.();
    return true;
  }

  return Object.freeze({
    beforeQuit,
    handleActivation,
    handleRendererGone,
    handleWindowClose,
    isQuitting: () => quitting,
    quitReason: () => reason,
    requestQuit,
  });
}

module.exports = { createQuitCoordinator };
