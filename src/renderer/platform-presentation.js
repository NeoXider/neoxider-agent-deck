(function exposePlatformPresentation(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.platformPresentation = api;
}(typeof globalThis === "object" ? globalThis : this, () => {
  function createPlatformPresentation(capabilities = {}) {
    const platform = String(capabilities.platform || "win32");
    const wayland = Boolean(capabilities.wayland);
    const opacityAvailable = capabilities.nativeOpacity !== false;
    const gameLayerAvailable = capabilities.gameLayer !== false;
    const positionAvailable = capabilities.programmaticPosition !== false;
    const edgeMode = String(capabilities.edgeMode || "click-through");
    const edgeAvailable = edgeMode !== "unavailable";
    const notes = [];

    if (!opacityAvailable) notes.push("Window opacity is not supported on Linux.");
    if (!gameLayerAvailable) notes.push("Game layer is unavailable; Above is used instead.");
    if (wayland) notes.push("Wayland manages window position and does not support Edge mode.");
    else if (edgeMode === "interactive-wide") notes.push("Linux Edge mode uses a wider interactive area and is not click-through.");

    return {
      platform,
      opacityAvailable,
      gameLayerAvailable,
      positionAvailable,
      edgeAvailable,
      edgeMode,
      startupLabel: "Start at login",
      opacityHint: opacityAvailable ? "" : "Unavailable on Linux",
      platformHint: notes.join(" "),
      dockTitle: !edgeAvailable
        ? "Edge mode is unavailable on Wayland"
        : edgeMode === "interactive-wide"
          ? "Dock to the Linux edge handle (wider interactive area)"
          : "Dock to screen edge",
    };
  }

  return { createPlatformPresentation };
}));
