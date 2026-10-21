// IPC for the Harness itself rather than the window: which Harness Deck follows, updating
// it, what can be done to a session besides chatting (delete, pin, its background jobs,
// its subagents), and opening what a chat points at in the viewer window. Registered through the guarded handle() of ipc-handlers.cjs, so
// every channel here is sender-checked like every other.

function requireSessionId(value) {
  const sessionId = String(value ?? "").trim();
  if (!sessionId || sessionId.length > 512) throw new Error("A session id is required");
  return sessionId;
}

function registerDeckHandlers({
  handle,
  api,
  getHarnessLauncher = () => null,
  getHarnessRuntime = () => null,
  getHarnessServices = () => null,
  getViewer = () => null,
  invalidateDashboard = () => {},
  persistCapturedLaunchUrl = () => false,
  getPreferences = () => ({}),
  schedulePreferenceSave = () => {},
}) {
  const services = () => {
    const value = getHarnessServices();
    if (!value) throw new Error("Harness services are not available");
    return value;
  };
  const tasks = () => services().tasks;

  // Restarting switches to the newest installed runtime; DSH Desktop's Harness belongs to
  // DSH Desktop and is never restarted from here.
  async function restartHarness() {
    if (getHarnessServices()?.onDesktop?.()) return { ok: false, started: false, reason: "desktop-owned" };
    const result = await getHarnessLauncher().restart();
    if (result?.ok) getHarnessRuntime()?.switched?.();
    persistCapturedLaunchUrl();
    if (result?.ok && typeof api.reconnect === "function") await api.reconnect();
    invalidateDashboard();
    if (result?.ok) getHarnessServices()?.detectRunningVersion?.().catch(() => {});
    return result;
  }

  handle("restart-harness", () => restartHarness());
  handle("get-harness-runtime", () => getHarnessRuntime()?.state() || null);
  handle("check-harness-runtime", () => getHarnessRuntime()?.check() || null);
  // The one-press update: install the newest stable release beside the running one, then
  // restart onto it. Running agents are cut off by the restart; the renderer asks first.
  handle("update-harness", async () => {
    const runtime = getHarnessRuntime();
    if (!runtime) throw new Error("Harness updates are not available");
    if (getHarnessServices()?.onDesktop?.()) throw new Error("DSH Desktop updates its own Harness; update DSH Desktop instead");
    const checked = await runtime.check({ install: true });
    if (checked?.error) throw new Error(checked.error);
    if (!checked?.ready) return { ok: true, updated: false, runtime: runtime.state() };
    const result = await restartHarness();
    return { ok: Boolean(result?.ok), updated: Boolean(result?.ok), result, runtime: runtime.state() };
  });

  handle("get-harness-target", () => getHarnessServices()?.state() || null);
  handle("set-harness-target", async (_event, value) => services().setTarget(String(value || "")));
  handle("open-dsh-desktop", async () => services().openDesktop());

  // The viewer window (viewer-window.cjs): an image, a file the chat names, or an attachment
  // read back from Harness, in a window of its own.
  handle("open-viewer", async (_event, payload) => {
    const viewer = getViewer();
    if (!viewer) throw new Error("The viewer is not available");
    const type = String(payload?.type || "");
    if (type === "image") return viewer.openImage({ name: payload?.name, dataUrl: payload?.dataUrl });
    if (type === "path") return viewer.openPath(String(payload?.path || "").slice(0, 4096), { cwd: String(payload?.cwd || "").slice(0, 4096) });
    if (type === "attachment") {
      const sessionId = requireSessionId(payload?.sessionId);
      const attachmentId = String(payload?.attachmentId || "").trim();
      if (!attachmentId || attachmentId.length > 256) throw new Error("A valid attachment id is required");
      const value = await api.readAttachment(sessionId, attachmentId);
      return viewer.openBytes({ name: value?.attachment?.name || payload?.name, mediaType: value?.attachment?.mediaType, data: value?.data });
    }
    throw new Error("Nothing to show");
  });
  handle("set-recent-sessions-open", (_event, value) => {
    const preferences = getPreferences();
    preferences.recentSessionsOpen = value !== false;
    schedulePreferenceSave();
    return preferences.recentSessionsOpen;
  });
  handle("archive-session", async (_event, sessionId, options) => {
    const result = await tasks().archive(requireSessionId(sessionId), { stopActivity: options?.stopActivity === true });
    invalidateDashboard();
    return result;
  });
  handle("unarchive-session", async (_event, sessionId) => {
    const result = await tasks().unarchive(requireSessionId(sessionId));
    invalidateDashboard();
    return result;
  });
  handle("pin-session", async (_event, sessionId, pinned) => {
    const result = await tasks().pin(requireSessionId(sessionId), pinned !== false);
    invalidateDashboard();
    return result;
  });
  handle("session-jobs", async (_event, sessionId) => tasks().jobs(requireSessionId(sessionId)));
  handle("kill-job", async (_event, sessionId, jobId) => tasks().killJob(requireSessionId(sessionId), String(jobId || "")));
  handle("job-output", async (_event, sessionId, jobId) => tasks().jobOutput(requireSessionId(sessionId), String(jobId || "")));
  handle("interrupt-subagent", async (_event, childId, parentId) => tasks().interruptSubagent(requireSessionId(childId), requireSessionId(parentId)));
}

module.exports = { registerDeckHandlers };
