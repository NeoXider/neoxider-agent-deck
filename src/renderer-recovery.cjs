const MAX_RENDERER_RECOVERIES = 3;
const RENDERER_STABILITY_WINDOW_MS = 10_000;
const RENDERER_RECOVERY_WATCHDOG_MS = 15_000;

function createRendererRecoveryController({
  getWindow,
  isQuitting,
  requestQuit,
  maxRecoveries = MAX_RENDERER_RECOVERIES,
  stabilityWindowMs = RENDERER_STABILITY_WINDOW_MS,
  recoveryWatchdogMs = RENDERER_RECOVERY_WATCHDOG_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  onError = console.error,
} = {}) {
  let failures = 0;
  let recovering = false;
  let disposed = false;
  let stabilityTimer = null;
  let watchdogTimer = null;

  function cancelStabilityTimer() {
    if (stabilityTimer === null) return;
    clearTimer(stabilityTimer);
    stabilityTimer = null;
  }

  function cancelWatchdogTimer() {
    if (watchdogTimer === null) return;
    clearTimer(watchdogTimer);
    watchdogTimer = null;
  }

  function cancelTimers() {
    cancelStabilityTimer();
    cancelWatchdogTimer();
  }

  function stopping() {
    return disposed || Boolean(isQuitting?.());
  }

  function schedule(callback, delay) {
    const timer = setTimer(callback, delay);
    timer?.unref?.();
    return timer;
  }

  function contents() {
    const window = getWindow?.();
    return !window || window.isDestroyed?.() ? null : window.webContents;
  }

  function loaded() {
    if (stopping()) {
      cancelTimers();
      recovering = false;
      return false;
    }
    cancelWatchdogTimer();
    cancelStabilityTimer();
    recovering = false;
    stabilityTimer = schedule(() => {
      stabilityTimer = null;
      if (stopping()) {
        cancelTimers();
        return;
      }
      failures = 0;
    }, stabilityWindowMs);
    return true;
  }

  function send(channel, value) {
    if (stopping()) {
      cancelTimers();
      return false;
    }
    const target = contents();
    if (!target || target.isDestroyed?.() || recovering || target.isLoading?.()) return false;
    try {
      target.send(channel, value);
      return true;
    } catch (error) {
      onError("Renderer send failed", error);
      return false;
    }
  }

  function recover() {
    if (stopping()) {
      cancelTimers();
      recovering = false;
      return false;
    }
    cancelStabilityTimer();
    cancelWatchdogTimer();
    recovering = true;
    while (failures < maxRecoveries) {
      const target = contents();
      if (!target || target.isDestroyed?.()) return false;
      failures += 1;
      try {
        target.reload();
        watchdogTimer = schedule(() => {
          watchdogTimer = null;
          if (stopping()) {
            cancelTimers();
            recovering = false;
          } else if (recovering) {
            recover();
          }
        }, recoveryWatchdogMs);
        return true;
      } catch (error) {
        onError("Renderer reload failed", error);
      }
    }
    requestQuit?.("renderer-recovery-limit");
    return false;
  }

  function failed(_reason, ignoreWhileRecovering = false) {
    if (stopping()) {
      cancelTimers();
      recovering = false;
      return false;
    }
    return ignoreWhileRecovering && recovering ? false : recover();
  }

  function dispose() {
    disposed = true;
    recovering = false;
    cancelTimers();
  }

  return Object.freeze({
    dispose,
    failed,
    loaded,
    send,
    failureCount: () => failures,
    isRecovering: () => recovering,
  });
}

module.exports = {
  createRendererRecoveryController,
  MAX_RENDERER_RECOVERIES,
  RENDERER_RECOVERY_WATCHDOG_MS,
  RENDERER_STABILITY_WINDOW_MS,
};
