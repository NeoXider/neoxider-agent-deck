const { applyPlatformWindowLayer } = require("./platform-capabilities.cjs");

const DEFAULT_BURST_DELAYS = Object.freeze([80, 260, 800]);

function canRaiseWindow(windowRef) {
  if (!windowRef || windowRef.isDestroyed?.()) return false;
  if (typeof windowRef.isVisible === "function" && !windowRef.isVisible()) return false;
  if (typeof windowRef.isMinimized === "function" && windowRef.isMinimized()) return false;
  return true;
}

function createGameLayerKeeper({
  getWindow,
  isEnabled,
  getMode = () => "full",
  capabilities,
  heartbeatMs = 1250,
  burstDelays = DEFAULT_BURST_DELAYS,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
} = {}) {
  if (typeof getWindow !== "function") throw new TypeError("getWindow must be a function");
  if (typeof isEnabled !== "function") throw new TypeError("isEnabled must be a function");

  let attachedWindow = null;
  let heartbeat = null;
  const burstTimers = new Set();

  function active() {
    return Boolean(isEnabled()) && canRaiseWindow(getWindow());
  }

  function reassert() {
    const windowRef = getWindow();
    if (!isEnabled() || !canRaiseWindow(windowRef)) return false;
    applyPlatformWindowLayer(windowRef, {
      layer: "game",
      mode: getMode(),
      capabilities,
    });
    if (typeof windowRef.moveTop === "function") windowRef.moveTop();
    return true;
  }

  function clearBurst() {
    for (const timer of burstTimers) clearTimeoutFn(timer);
    burstTimers.clear();
  }

  function trigger() {
    if (!active()) return false;
    reassert();
    clearBurst();
    for (const delay of burstDelays) {
      const timer = setTimeoutFn(() => {
        burstTimers.delete(timer);
        reassert();
      }, delay);
      timer?.unref?.();
      burstTimers.add(timer);
    }
    return true;
  }

  function stopHeartbeat() {
    if (heartbeat === null) return;
    clearIntervalFn(heartbeat);
    heartbeat = null;
  }

  function sync() {
    if (!isEnabled()) {
      clearBurst();
      stopHeartbeat();
      return false;
    }
    reassert();
    if (heartbeat === null) {
      heartbeat = setIntervalFn(reassert, heartbeatMs);
      heartbeat?.unref?.();
    }
    return true;
  }

  const onBlur = () => trigger();
  const onShow = () => trigger();
  const onRestore = () => trigger();
  const onAlwaysOnTopChanged = (_event, enabled) => {
    if (!enabled) trigger();
  };
  const onClosed = () => stop();

  function detach() {
    if (!attachedWindow) return;
    attachedWindow.removeListener?.("blur", onBlur);
    attachedWindow.removeListener?.("show", onShow);
    attachedWindow.removeListener?.("restore", onRestore);
    attachedWindow.removeListener?.("always-on-top-changed", onAlwaysOnTopChanged);
    attachedWindow.removeListener?.("closed", onClosed);
    attachedWindow = null;
  }

  function attach(windowRef = getWindow()) {
    if (windowRef === attachedWindow) return sync();
    detach();
    attachedWindow = windowRef || null;
    attachedWindow?.on?.("blur", onBlur);
    attachedWindow?.on?.("show", onShow);
    attachedWindow?.on?.("restore", onRestore);
    attachedWindow?.on?.("always-on-top-changed", onAlwaysOnTopChanged);
    attachedWindow?.once?.("closed", onClosed);
    return sync();
  }

  function stop() {
    clearBurst();
    stopHeartbeat();
    detach();
  }

  return Object.freeze({ attach, reassert, stop, sync, trigger });
}

module.exports = {
  DEFAULT_BURST_DELAYS,
  canRaiseWindow,
  createGameLayerKeeper,
};
