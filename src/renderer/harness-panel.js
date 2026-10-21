// DeepSeek Harness in Deck: which Harness it follows (its own `dsh web`, or the one inside
// DSH Desktop), which version runs and which stable release is out, and the one-press update
// that installs it beside the running one and restarts onto it.
//
// Updates follow DSH's stable releases only. A new one is announced once - a toast in the
// widget, a notification beside the avatar - and stays as a chip in the title bar until it
// is installed. Loaded before app.js; app.js globals are only touched inside functions.

const harnessPanel = { runtime: null, target: null, updating: false };

// A docs or smoke capture: nothing is announced and nothing is polled behind the fixture.
function deckScreenshotMode() {
  return new URLSearchParams(location.search).has("screenshotFixture");
}
const HARNESS_ANNOUNCED_KEY = "deck.harnessUpdateAnnounced";

function harnessOnDesktop() {
  return harnessPanel.target?.kind === "desktop";
}

function desktopHarnessRunning() {
  return Boolean(harnessPanel.target?.desktop?.running);
}

function runningAgentCount() {
  return (state.dashboard?.sessions || []).filter((session) => session.running).length;
}

// The version a press of Update would bring: one installed and waiting, else the release.
function harnessUpdateVersion(runtime = harnessPanel.runtime) {
  if (!runtime || harnessOnDesktop()) return "";
  if (runtime.ready) return runtime.ready;
  return runtime.updateAvailable ? runtime.latest : "";
}

function renderHarnessRuntime(runtime) {
  if (!runtime) return;
  harnessPanel.runtime = runtime;
  const version = $("#harnessRuntimeVersion");
  const parts = [];
  if (runtime.running) parts.push(`Running ${runtime.running}`);
  if (runtime.installed && runtime.installed !== runtime.running) parts.push(`${runtime.installed} installed`);
  if (runtime.latest) parts.push(`stable ${runtime.latest}`);
  version.textContent = parts.length ? parts.join(" · ") : "Not installed yet";
  const update = harnessUpdateVersion(runtime);
  const badge = $("#harnessRuntimeBadge");
  badge.hidden = !(update || runtime.installing);
  badge.textContent = runtime.installing ? "Installing" : "Update";
  $("#harnessRuntimeStatus").textContent = harnessOnDesktop()
    ? "DSH Desktop runs and updates its own Harness."
    : harnessPanel.updating ? `Updating Harness to ${update || runtime.installing}…`
    : runtime.installing ? `Installing Harness ${runtime.installing}… The running Harness keeps working.`
    : runtime.error ? `Harness update failed: ${runtime.error}`
    : runtime.ready ? `Harness ${runtime.ready} is installed. Update restarts Harness onto it; running agents are stopped.`
    : runtime.updateAvailable ? `Harness ${runtime.latest} is out. Update installs it next to the running one and restarts onto it.`
    : runtime.latest ? `Up to date: ${runtime.latest} is the newest stable release.`
    : "Deck installs Harness when it is missing and offers stable updates.";
  const button = $("#updateHarnessButton");
  button.hidden = !update;
  button.disabled = harnessPanel.updating || Boolean(runtime.installing);
  button.textContent = runtime.ready ? `Restart onto ${runtime.ready}` : `Update to ${update}`;
  $("#checkHarnessRuntimeButton").disabled = Boolean(runtime.installing) || harnessPanel.updating;
  renderHarnessUpdateChip();
  announceHarnessUpdate(update);
}

function renderHarnessUpdateChip() {
  const chip = $("#harnessUpdateChip");
  if (!chip) return;
  const update = harnessUpdateVersion();
  const show = Boolean(update) && !harnessPanel.updating;
  if (chip.hidden === show) chip.hidden = !show;
  if (!show) return;
  chip.textContent = `DSH ${update}`;
  chip.title = `DeepSeek Harness ${update} is out. Click to update`;
  chip.setAttribute("aria-label", chip.title);
}

// Once per release: a toast in the widget, or a notification beside the avatar.
function announceHarnessUpdate(version) {
  if (!version || deckScreenshotMode()) return;
  let announced = "";
  try { announced = localStorage.getItem(HARNESS_ANNOUNCED_KEY) || ""; } catch {}
  if (announced === version) return;
  try { localStorage.setItem(HARNESS_ANNOUNCED_KEY, version); } catch {}
  if (state.windowMode === "full") {
    showActionToast(`DeepSeek Harness ${version} is out`, { icon: "down", duration: 10000, action: { label: "Update", run: () => updateHarnessNow().catch(() => {}) } });
  } else {
    showCompactNotification({ kind: "notification", title: "DeepSeek Harness update", text: `${version} is out. Open Deck and press DSH ${version} to update.` }, 9000);
  }
}

async function updateHarnessNow() {
  const version = harnessUpdateVersion();
  if (!version || harnessPanel.updating) return;
  const running = runningAgentCount();
  const confirmed = await deckConfirm({
    title: `Update DeepSeek Harness to ${version}?`,
    text: running
      ? `${running} agent${running === 1 ? " is" : "s are"} working now and will be stopped when Harness restarts.`
      : "Deck installs it next to the running Harness and restarts onto it. It takes a few seconds.",
    okLabel: "Update now",
    danger: running > 0,
  });
  if (!confirmed) return;
  harnessPanel.updating = true;
  state.harnessStarting = true;
  state.harnessStartingLabel = `Updating Harness to ${version}…`;
  renderHarnessRuntime(harnessPanel.runtime);
  renderOfflineBanner();
  showActionToast(`Updating Harness to ${version}…`, { icon: "down", duration: 4000 });
  try {
    const result = await window.widget.updateHarness();
    if (result?.updated) showActionToast(`DeepSeek Harness ${result.runtime?.running || version} is running`, { icon: "check", duration: 4000 });
    else if (result?.ok) showActionToast("Harness is already up to date", { icon: "check" });
    else showActionToast(harnessRestartFailure(result?.result), { kind: "error", icon: "alert", duration: 6000 });
  } catch (error) {
    showActionToast(`Update failed: ${compactText(String(error?.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), 90)}`, { kind: "error", icon: "alert", duration: 7000 });
  } finally {
    harnessPanel.updating = false;
    state.harnessStarting = false;
    state.harnessStartingLabel = "";
    window.widget.getHarnessRuntime?.().then(renderHarnessRuntime).catch(() => {});
    renderOfflineBanner();
    refresh({ afterCurrent: true }).catch(() => {});
  }
}

const TARGET_LABELS = { web: "DeepSeek Harness", desktop: "DSH Desktop" };

function renderHarnessTarget(target) {
  if (!target) return;
  const previousKind = harnessPanel.target?.kind;
  harnessPanel.target = target;
  document.body.classList.toggle("harness-desktop", target.kind === "desktop");
  syncPressed($$("#harnessTargetSwitch button"), target.preference, "target");
  const desktop = target.desktop || {};
  let text = target.kind === "desktop"
    ? (desktop.running ? "Following DSH Desktop's Harness. Its chats and settings are DSH Desktop's own." : "DSH Desktop is not running. Open it and Deck connects to its Harness.")
    : desktop.running ? "Following Deck's own Harness. DSH Desktop is running too: choose it to see its chats."
    : desktop.installed ? "Following Deck's own Harness. DSH Desktop is installed but not running."
    : "Following Deck's own Harness.";
  const update = target.desktopUpdate;
  if (update?.available) text += ` DSH Desktop ${update.latest} is out (you have ${update.installed}); update it from DSH Desktop.`;
  $("#harnessTargetStatus").textContent = text;
  const open = $("#openDshDesktopButton");
  open.hidden = !(desktop.canOpen && !desktop.running);
  const label = TARGET_LABELS[target.kind] || TARGET_LABELS.web;
  const chip = $("#harnessSourceChip");
  $("#harnessSourceLabel").textContent = label;
  chip.dataset.state = (target.kind === "desktop" ? desktop.running : target.webRunning) ? "running" : "down";
  chip.title = `${label}${target.preference === "auto" ? " (picked automatically)" : ""}. Click to choose which Harness Deck follows`;
  if (harnessPanel.runtime) renderHarnessRuntime(harnessPanel.runtime);
  if (previousKind && previousKind !== target.kind) {
    showActionToast(`Now following ${label}`, { icon: "switch", duration: 3200 });
    state.sessionListSignature = "";
    refresh({ afterCurrent: true }).catch(() => {});
  }
  renderOfflineBanner();
}

async function chooseHarnessTarget(value) {
  try {
    renderHarnessTarget(await window.widget.setHarnessTarget(value));
  } catch (error) {
    showActionToast(`Could not switch: ${compactText(String(error?.message || error), 60)}`, { kind: "error", icon: "alert", duration: 4200 });
  }
}

async function openDshDesktop() {
  try {
    await window.widget.openDshDesktop();
    showActionToast("Starting DSH Desktop…", { icon: "open", duration: 4000 });
  } catch (error) {
    showActionToast(compactText(String(error?.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), 90), { kind: "error", icon: "alert", duration: 5000 });
  }
}

function openHarnessSourceMenu(anchor) {
  const target = harnessPanel.target || { preference: "auto", kind: "web", desktop: {} };
  openFloatingMenu(anchor, (menu) => {
    const option = (value, title, hint) => {
      const item = menuItem(target.preference === value ? "check" : "switch", title, () => { closeFloatingMenu(); chooseHarnessTarget(value); }, { hint });
      item.classList.toggle("current", target.preference === value);
      return item;
    };
    menu.append(
      option("auto", "Automatic", "Whichever Harness is running"),
      option("web", "DeepSeek Harness", "Deck's own dsh web"),
      option("desktop", "DSH Desktop", target.desktop?.running ? "Running now" : "Not running"),
    );
    if (target.desktop?.canOpen && !target.desktop?.running) menu.append(menuItem("open", "Open DSH Desktop", () => { closeFloatingMenu(); openDshDesktop(); }));
  }, { label: "Which Harness Deck follows" });
}

document.addEventListener("DOMContentLoaded", () => {
  window.widget.onHarnessRuntime?.((runtime) => renderHarnessRuntime(runtime));
  window.widget.getHarnessRuntime?.().then(renderHarnessRuntime).catch(() => {});
  window.widget.onHarnessTarget?.((target) => renderHarnessTarget(target));
  window.widget.getHarnessTarget?.().then(renderHarnessTarget).catch(() => {});
  $("#checkHarnessRuntimeButton").addEventListener("click", () => {
    $("#harnessRuntimeStatus").textContent = "Asking npm for the newest stable Harness…";
    window.widget.checkHarnessRuntime().then(renderHarnessRuntime).catch(showError);
  });
  $("#updateHarnessButton").addEventListener("click", () => updateHarnessNow().catch(showError));
  $("#harnessUpdateChip").addEventListener("click", () => updateHarnessNow().catch(showError));
  $("#openDshDesktopButton").addEventListener("click", () => openDshDesktop());
  $$("#harnessTargetSwitch button").forEach((button) => button.addEventListener("click", () => chooseHarnessTarget(button.dataset.target)));
  $("#harnessSourceChip").addEventListener("click", (event) => {
    if (floatingMenu?.anchor === event.currentTarget) closeFloatingMenu();
    else openHarnessSourceMenu(event.currentTarget);
  });
});
