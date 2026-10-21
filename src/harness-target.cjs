// Which Harness Deck follows: its own (`dsh web`, the one Deck starts and updates) or the
// one inside DSH Desktop. They are separate installations with separate sessions (DSH
// Desktop keeps its own home), so Deck follows one at a time and says which.
//
// - "web": always Deck's own Harness.
// - "desktop": always DSH Desktop's, found through its log (dsh-desktop.cjs).
// - "auto" (the default): the one that is running. With both running it stays where it
//   is, so the list never flips back and forth under the user; with neither, it waits on
//   its own, so Start has something to start.
//
// A switch hands the new address and launch URL to `onSwitch`, which re-points the API and
// reconnects the live streams. DSH Desktop prints a new launch token every time it starts,
// so a changed token is a switch too.
const TARGET_PREFERENCES = Object.freeze(["auto", "web", "desktop"]);
const REFRESH_MS = 15000;

function normalizeHarnessTarget(value) {
  return TARGET_PREFERENCES.includes(value) ? value : "auto";
}

function createHarnessTarget({
  webUrl,
  locator,
  probeWeb = async () => false,
  getPreference = () => "auto",
  onSwitch = async () => {},
  onState = () => {},
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  refreshMs = REFRESH_MS,
} = {}) {
  if (!webUrl) throw new TypeError("the web Harness URL is required");
  if (!locator || typeof locator.locate !== "function") throw new TypeError("a DSH Desktop locator is required");
  let state = { preference: "auto", kind: "web", url: webUrl, launchUrl: "", webRunning: false, desktop: locator.current?.() || null };
  let timer = null;
  let pending = null;
  let stopped = false;

  function snapshot() {
    return { ...state, desktop: state.desktop ? { ...state.desktop } : null };
  }

  function choose(preference, webRunning, desktop) {
    if (preference === "web" || preference === "desktop") return preference;
    const currentRunning = state.kind === "desktop" ? desktop.running : webRunning;
    if (state.checked && currentRunning) return state.kind;
    if (webRunning) return "web";
    if (desktop.running) return "desktop";
    return "web";
  }

  async function runRefresh() {
    const preference = normalizeHarnessTarget(getPreference());
    const [desktop, webRunning] = await Promise.all([
      locator.locate().catch(() => ({ installed: false, running: false, url: "", launchUrl: "" })),
      probeWeb(webUrl).then(Boolean, () => false),
    ]);
    const kind = choose(preference, webRunning, desktop);
    const next = {
      preference,
      kind,
      url: kind === "desktop" ? desktop.url : webUrl,
      launchUrl: kind === "desktop" ? desktop.launchUrl || "" : "",
      webRunning,
      desktop,
      checked: true,
    };
    const switched = next.kind !== state.kind || next.url !== state.url || (kind === "desktop" && next.launchUrl && next.launchUrl !== state.launchUrl);
    // A desktop launch that has not printed its token yet keeps the token it had.
    if (kind === "desktop" && !next.launchUrl && state.kind === "desktop" && state.url === next.url) next.launchUrl = state.launchUrl;
    state = next;
    if (switched) {
      try { await onSwitch(snapshot()); } catch {}
    }
    try { onState(snapshot()); } catch {}
    return snapshot();
  }

  function refresh() {
    if (!pending) pending = runRefresh().finally(() => { pending = null; });
    return pending;
  }

  function schedule() {
    if (stopped) return;
    clearTimer(timer);
    timer = setTimer(() => { refresh().catch(() => {}).finally(schedule); }, refreshMs);
  }

  return {
    start() { stopped = false; const first = refresh(); schedule(); return first; },
    stop() { stopped = true; clearTimer(timer); timer = null; },
    refresh,
    state: snapshot,
    kind: () => state.kind,
    url: () => state.url,
    launchUrl: () => state.launchUrl,
  };
}

module.exports = { REFRESH_MS, TARGET_PREFERENCES, createHarnessTarget, normalizeHarnessTarget };
