async function captureForChat(kind, { service, gate, window, mode, captureProtected = false, displayPoint, cursorPoint, prepareFiles, prepareImage, applyWindowMode, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  if (!service || !["display", "region", "display-send"].includes(kind)) return { ok: false, canceled: false, reason: "screenshot-service-unavailable" };
  return gate.run(async () => {
    const background = kind === "display-send";
    const wasVisible = window && !window.isDestroyed() && window.isVisible();
    const point = background ? cursorPoint() : displayPoint();
    let restoredToFull = false;
    let hiddenForCapture = false;
    try {
      if (wasVisible && !captureProtected) { window.hide(); hiddenForCapture = true; await wait(100); }
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
      if (window && !window.isDestroyed()) {
        if (background) { if (hiddenForCapture) window.showInactive(); }
        else if (hiddenForCapture && !restoredToFull) applyWindowMode(mode, { captureCurrent: false, persist: false });
      }
    }
  });
}
module.exports = { captureForChat };
