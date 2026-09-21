function detectPlatformCapabilities({ platform = process.platform, env = process.env } = {}) {
  const wayland = platform === "linux" && (
    String(env.XDG_SESSION_TYPE || "").toLowerCase() === "wayland"
    || Boolean(env.WAYLAND_DISPLAY)
  );
  const windowsOrMac = platform === "win32" || platform === "darwin";
  return Object.freeze({
    platform,
    wayland,
    layerLevels: windowsOrMac,
    nativeOpacity: windowsOrMac,
    programmaticPosition: !wayland,
    edgeMouseForwarding: windowsOrMac,
    edgeMode: wayland ? "unavailable" : (platform === "linux" ? "interactive-wide" : "click-through"),
    skipTaskbar: windowsOrMac,
    visibleOnFullScreen: platform === "darwin",
    gameLayer: windowsOrMac,
    captureExclusion: platform === "win32",
  });
}

function normalizeWindowLayer(value, capabilities) {
  const requested = ["normal", "above", "game", "private"].includes(value) ? value : "above";
  if (requested === "private" && !capabilities.captureExclusion) return "above";
  return requested === "game" && !capabilities.gameLayer ? "above" : requested;
}

function applyPlatformWindowLayer(windowRef, { layer, mode = "full", capabilities } = {}) {
  if (!windowRef || windowRef.isDestroyed?.()) return "normal";
  const effectiveLayer = normalizeWindowLayer(layer, capabilities);
  const compact = mode !== "full";
  if (capabilities.captureExclusion && typeof windowRef.setContentProtection === "function") {
    windowRef.setContentProtection(effectiveLayer === "private");
  }
  if (effectiveLayer === "normal") {
    windowRef.setAlwaysOnTop(false);
  } else if (capabilities.layerLevels) {
    windowRef.setAlwaysOnTop(true, compact || effectiveLayer === "game" || effectiveLayer === "private" ? "screen-saver" : "floating");
  } else {
    windowRef.setAlwaysOnTop(true);
  }
  if (capabilities.visibleOnFullScreen && typeof windowRef.setVisibleOnAllWorkspaces === "function") {
    const visible = effectiveLayer !== "normal" && (compact || effectiveLayer === "game" || effectiveLayer === "private");
    windowRef.setVisibleOnAllWorkspaces(visible, { visibleOnFullScreen: visible });
  }
  return effectiveLayer;
}

function applyPlatformOpacity(windowRef, value, capabilities) {
  const opacity = Math.max(0.65, Math.min(1, Number(value) || 0.96));
  if (capabilities.nativeOpacity) windowRef.setOpacity(opacity);
  return { opacity, native: capabilities.nativeOpacity };
}

function setPlatformBounds(windowRef, bounds, animate, capabilities) {
  if (capabilities.programmaticPosition) windowRef.setBounds(bounds, animate);
  else windowRef.setSize(bounds.width, bounds.height, animate);
}

function setPlatformSkipTaskbar(windowRef, skip, capabilities) {
  if (capabilities.skipTaskbar) windowRef.setSkipTaskbar(Boolean(skip));
}

module.exports = {
  applyPlatformOpacity,
  applyPlatformWindowLayer,
  detectPlatformCapabilities,
  normalizeWindowLayer,
  setPlatformBounds,
  setPlatformSkipTaskbar,
};
