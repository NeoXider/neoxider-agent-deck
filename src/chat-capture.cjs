async function captureForChat(kind, { service, gate, window, mode, displayPoint, cursorPoint, prepareFiles, applyWindowMode, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  if (!service || !["display", "region", "display-send"].includes(kind)) return { ok: false, canceled: false, reason: "screenshot-service-unavailable" };
  return gate.run(async () => {
    const background = kind === "display-send";
    const wasVisible = window && !window.isDestroyed() && window.isVisible();
    const point = background ? cursorPoint() : displayPoint();
    let restoredToFull = false;
    try {
      if (window && !window.isDestroyed()) window.hide();
      await wait(100);
      const result = kind === "region" ? await service.captureRegion() : await service.captureDisplay({ point });
      if (!result.ok) return result;
      let prepared;
      try { prepared = await prepareFiles([result.path]); }
      finally { try { await service.removeCapture(result.path); } catch (error) { console.warn("Failed to remove prepared screenshot", error); } }
      if (!background) { applyWindowMode("full"); restoredToFull = true; }
      return { ...result, prepared };
    } finally {
      if (window && !window.isDestroyed()) {
        if (background) { if (wasVisible) window.showInactive(); }
        else if (!restoredToFull) applyWindowMode(mode, { captureCurrent: false, persist: false });
      }
    }
  });
}
module.exports = { captureForChat };
