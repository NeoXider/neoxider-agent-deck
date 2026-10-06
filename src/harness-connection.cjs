// Shared by the desktop and Game Bar readers: authentication failures must not
// turn into a generic "offline" result when the shared reader catches them first.
function harnessNeedsAuth(error) {
  return /launch URL is unknown|session cookie|token exchange|HTTP 401|\b401\b|unauthorized/i
    .test(error instanceof Error ? error.message : String(error ?? ""));
}

async function startHarnessConnection({ api, launcher, persistCapturedLaunchUrl, invalidateDashboard }) {
  // A saved valid launch URL already grants access to an inherited host. A
  // second DSH process cannot recover its token and must not replace live work.
  if (typeof api.reconnect === "function") {
    try {
      await api.reconnect();
      invalidateDashboard();
      return { ok: true, started: false, alreadyRunning: true };
    } catch { /* A down host or invalid saved token needs the launcher. */ }
  }
  const result = await launcher.start();
  persistCapturedLaunchUrl();
  if (result?.ok) {
    if (typeof api.reconnect === "function") await api.reconnect();
    invalidateDashboard();
  }
  return result;
}

module.exports = { harnessNeedsAuth, startHarnessConnection };
