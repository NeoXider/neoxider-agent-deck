// A whole-display capture keeps Deck on screen and only excludes it from the pixels when the
// platform can (Windows capture exclusion), so the 3-5 s capture shows progress instead of a
// vanished window. A region pick still hides Deck: the user must see what lies under it.
async function captureForChat(kind, { service, gate, window, mode, captureProtected = false, shieldFromCapture = null, displayPoint, cursorPoint, prepareFiles, prepareImage, applyWindowMode, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  if (!service || !["display", "region", "display-send"].includes(kind)) return { ok: false, canceled: false, reason: "screenshot-service-unavailable" };
  return gate.run(async () => {
    const background = kind === "display-send";
    const wasVisible = window && !window.isDestroyed() && window.isVisible();
    const point = background ? cursorPoint() : displayPoint();
    let restoredToFull = false;
    let hiddenForCapture = false;
    let shielded = false;
    try {
      if (wasVisible && !captureProtected && kind !== "region" && typeof shieldFromCapture === "function") { shieldFromCapture(true); shielded = true; }
      else if (wasVisible && !captureProtected) { window.hide(); hiddenForCapture = true; await wait(100); }
      const inMemory = typeof prepareImage === "function";
      const result = kind === "region" ? await service.captureRegion({ inMemory }) : await service.captureDisplay({ point, inMemory });
      if (!result.ok) return result;
      let prepared;
      if (Buffer.isBuffer(result.png) && inMemory) prepared = await prepareImage(result.png);
      else {
        try { prepared = await prepareFiles([result.path]); }
        finally { try { await service.removeCapture(result.path); } catch (error) { console.warn("Failed to remove prepared screenshot", error); } }
      }
      if (!background && (!wasVisible || hiddenForCapture || mode !== "full")) { applyWindowMode("full"); restoredToFull = true; }
      const { png, ...publicResult } = result; // Do not copy raw pixels over IPC a second time.
      return { ...publicResult, prepared };
    } finally {
      if (shielded) shieldFromCapture(false);
      if (window && !window.isDestroyed()) {
        if (background) { if (hiddenForCapture) window.showInactive(); }
        else if (hiddenForCapture && !restoredToFull) applyWindowMode(mode, { captureCurrent: false, persist: false });
      }
    }
  });
}
// Main's side of chat screenshots: the button and hotkey captures, and removing the files of
// captures that were sent. The window and service are read when used, since both are made
// after this is.
function createChatCaptureController({ getService, gate, getWindow, getMode, screen, isPrivate, captureExclusion, prepareImage, prepareFiles, applyWindowMode, send }) {
  const liveWindow = () => { const window = getWindow(); return window && !window.isDestroyed() ? window : null; };
  function displayPoint() {
    const window = liveWindow();
    if (!window) return undefined;
    const bounds = window.getBounds();
    return { x: bounds.x + Math.round(bounds.width / 2), y: bounds.y + Math.round(bounds.height / 2) };
  }
  function capture(kind) {
    const window = getWindow();
    const canExclude = captureExclusion && typeof window?.setContentProtection === "function";
    return captureForChat(kind, {
      service: getService(), gate, window, mode: getMode(), displayPoint, cursorPoint: () => screen.getCursorScreenPoint(),
      captureProtected: isPrivate() && canExclude,
      shieldFromCapture: canExclude ? (on) => liveWindow()?.setContentProtection(on || isPrivate()) : null,
      prepareImage, prepareFiles, applyWindowMode,
    });
  }
  async function captureFromHotkey(kind) {
    send("hotkey-action", `captureStarted:${kind}`);
    try {
      send("screenshot-captured", await capture(kind));
    } catch (error) {
      send("screenshot-captured", { ok: false, canceled: false, reason: error?.code || "capture-failed", error: String(error?.message || error) });
    }
  }
  async function cleanupSentCaptureFiles(attachments) {
    const service = getService();
    if (!service) return;
    const paths = [...new Set((attachments || [])
      .map((item) => item?.path)
      .filter((filePath) => service.ownsCapture(filePath)))].slice(0, 12);
    await Promise.all(paths.map(async (filePath) => {
      try {
        await service.removeCapture(filePath);
      } catch (error) {
        console.warn("Failed to remove sent screenshot", error);
      }
    }));
  }
  return { capture, captureFromHotkey, cleanupSentCaptureFiles };
}
module.exports = { captureForChat, createChatCaptureController };
