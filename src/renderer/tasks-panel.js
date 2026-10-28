// What works under the open chat: its subagents (each one a chat of its own) and the
// background jobs it started, the way DSH shows "9 subagents" above its conversation.
//
// The chip above the conversation counts them and opens a panel. A subagent opens as its own
// chat, read-only, with the way back to its parent above it; a job shows its output and can
// be stopped. Loaded before app.js; app.js globals are only touched inside functions.

const JOBS_POLL_MS = 8000;
const JOBS_POLL_OPEN_MS = 2500;
const tasksState = {
  open: false,
  jobsBySession: new Map(),
  jobsBusy: false,
  expandedJobId: null,
  outputs: new Map(),
  // { childId, rootId, title, rootTitle } while a subagent's chat is open.
  subagentView: null,
  pollTimer: 0,
  signature: "",
};

function subagentViewActive() {
  return Boolean(tasksState.subagentView);
}

function tasksRow(sessionId) {
  return (state.dashboard?.sessions || []).find((session) => session.sessionId === sessionId) || null;
}

function sessionSubagents(session) {
  return (session?.subagents || []).filter((child) => child?.kind === "child");
}

function sessionJobs(sessionId) {
  return tasksState.jobsBySession.get(sessionId) || [];
}

function liveJob(job) {
  return job?.status === "running" || job?.status === "stopping";
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

// The chip under the Thinking card. Each kind reads working/total, "Subagents 2/29", so the
// count that matters during a turn comes first and the total stays beside it. It replaces
// the old "N subagents" button, which opened the browser and only ever counted children
// `subagent/list` reported - none, on current DSH.
function renderTasksChip(session) {
  const button = $("#subagentsButton");
  if (!button) return;
  const subagents = sessionSubagents(session);
  const jobs = sessionJobs(session?.sessionId);
  const working = subagents.filter((child) => child.activity === "running").length;
  const live = jobs.filter(liveJob).length;
  const running = working + live;
  const visible = !subagentViewActive() && Boolean(session) && (subagents.length > 0 || jobs.length > 0);
  if (button.hidden === visible) button.hidden = !visible;
  if (!visible) {
    if (tasksState.open) closeTasksPanel();
    return;
  }
  const parts = [];
  if (subagents.length) parts.push(`Subagents ${working}/${subagents.length}`);
  if (jobs.length) parts.push(`Jobs ${live}/${jobs.length}`);
  const text = parts.join(" · ");
  const label = button.querySelector("span");
  if (label.textContent !== text) label.textContent = text;
  if (button.classList.contains("busy") !== running > 0) button.classList.toggle("busy", running > 0);
  const said = [subagents.length ? `${working} of ${plural(subagents.length, "subagent")} working` : "", jobs.length ? `${live} of ${plural(jobs.length, "job")} running` : ""].filter(Boolean);
  const title = `${said.join(" · ")}. Show what works under this chat`;
  if (button.title !== title) button.title = title;
  button.setAttribute("aria-expanded", String(tasksState.open));
  if (tasksState.open) renderTasksPanel(session);
}

function toggleTasksPanel() {
  if (tasksState.open) closeTasksPanel();
  else openTasksPanel();
}

function openTasksPanel() {
  const session = tasksRow(state.selectedSessionId);
  if (!session) return;
  tasksState.open = true;
  tasksState.signature = "";
  const panel = $("#tasksPanel");
  panel.hidden = false;
  panel.classList.remove("leaving");
  $("#subagentsButton").setAttribute("aria-expanded", "true");
  renderTasksPanel(session);
  refreshSessionJobs().catch(() => {});
  scheduleJobsPoll();
}

function closeTasksPanel() {
  tasksState.open = false;
  tasksState.expandedJobId = null;
  const panel = $("#tasksPanel");
  $("#subagentsButton")?.setAttribute("aria-expanded", "false");
  if (!panel || panel.hidden) return;
  if (prefersReducedMotion()) { panel.hidden = true; return; }
  panel.classList.add("leaving");
  setTimeout(() => { if (!tasksState.open) { panel.hidden = true; panel.classList.remove("leaving"); } }, 160);
}

function statusDot(kind) {
  const dot = document.createElement("span");
  dot.className = `task-dot ${kind}`;
  dot.setAttribute("aria-hidden", "true");
  return dot;
}

function taskTime(node, { since = null, ms = null } = {}) {
  if (Number.isFinite(since) && since > 0) {
    node.dataset.runningSince = String(since);
    node.textContent = formatWorkDuration(Date.now() - since);
  } else if (Number.isFinite(ms) && ms > 0) {
    node.textContent = formatWorkDuration(ms);
  }
  return node;
}

function subagentRow(entry, rootId) {
  const row = document.createElement("div");
  row.className = `task-row subagent-row ${entry.activity === "running" ? "running" : entry.outcome || "idle"}`;
  row.style.setProperty("--depth", String(Math.max(0, (entry.depth || 1) - 1)));
  const open = document.createElement("button");
  open.type = "button";
  open.className = "task-open";
  open.title = `Open ${entry.title}`;
  const copy = document.createElement("span");
  copy.className = "task-copy";
  copy.append(Object.assign(document.createElement("b"), { textContent: entry.title }));
  const meta = document.createElement("small");
  const status = entry.activity === "running" ? "working" : entry.outcome === "failed" ? "stopped short" : entry.outcome === "done" ? "done" : "idle";
  meta.append(Object.assign(document.createElement("span"), { textContent: entry.childCount ? `${status} · ${plural(entry.childCount, "subagent")}` : status }));
  const time = taskTime(Object.assign(document.createElement("span"), { className: "task-time" }), { since: entry.runningSince, ms: entry.workedMs });
  meta.append(time);
  copy.append(meta);
  open.append(statusDot(entry.activity === "running" ? "running" : entry.outcome || "idle"), copy, createIcon("open", "ui-icon task-go"));
  open.addEventListener("click", () => openSubagentChat(entry, rootId).catch(showError));
  row.append(open);
  if (entry.activity === "running") {
    const stop = Object.assign(document.createElement("button"), { type: "button", className: "task-stop", title: `Stop ${entry.title}` });
    stop.append(createIcon("stop"));
    stop.addEventListener("click", () => stopSubagent(entry).catch(() => {}));
    row.append(stop);
  }
  return row;
}

function jobRow(job, sessionId) {
  const row = document.createElement("div");
  const expanded = tasksState.expandedJobId === job.id;
  row.className = `task-row job-row ${job.status}${expanded ? " expanded" : ""}`;
  const open = document.createElement("button");
  open.type = "button";
  open.className = "task-open";
  open.setAttribute("aria-expanded", String(expanded));
  open.title = expanded ? "Hide the output" : "Show the output";
  const copy = document.createElement("span");
  copy.className = "task-copy";
  copy.append(Object.assign(document.createElement("b"), { className: "job-label", textContent: job.label }));
  const meta = document.createElement("small");
  const detail = job.progress || job.detail || job.status;
  meta.append(Object.assign(document.createElement("span"), { textContent: `${job.kind} · ${detail}` }));
  const live = liveJob(job);
  meta.append(taskTime(Object.assign(document.createElement("span"), { className: "task-time" }), live
    ? { since: job.startedAt }
    : { ms: job.finishedAt && job.startedAt ? job.finishedAt - job.startedAt : null }));
  copy.append(meta);
  open.append(statusDot(live ? "running" : job.status === "completed" ? "done" : job.status === "failed" ? "failed" : "idle"), copy, createIcon("chevron", "ui-icon task-chevron"));
  open.addEventListener("click", () => toggleJobOutput(sessionId, job.id));
  row.append(open);
  if (live) {
    const stop = Object.assign(document.createElement("button"), { type: "button", className: "task-stop", title: `Stop ${job.label}`, disabled: job.status === "stopping" });
    stop.append(createIcon("stop"));
    stop.addEventListener("click", () => stopJob(sessionId, job).catch(() => {}));
    row.append(stop);
  }
  if (expanded) {
    const output = tasksState.outputs.get(job.id);
    const pre = document.createElement("pre");
    pre.className = "job-output";
    pre.textContent = output ? `${output.lossy ? "…" : ""}${output.output || "(no output yet)"}` : "Reading the output…";
    row.append(pre);
    requestAnimationFrame(() => { pre.scrollTop = pre.scrollHeight; });
  }
  return row;
}

function renderTasksPanel(session) {
  const panel = $("#tasksPanel");
  if (!panel || !tasksState.open || !session) return;
  const subagents = sessionSubagents(session);
  const jobs = sessionJobs(session.sessionId);
  const signature = JSON.stringify([session.sessionId, subagents.map((entry) => [entry.sessionId, entry.title, entry.activity, entry.outcome, entry.runningSince, entry.workedMs, entry.depth]),
    jobs.map((job) => [job.id, job.status, job.progress, job.detail, job.finishedAt]), tasksState.expandedJobId, tasksState.outputs.get(tasksState.expandedJobId)?.output?.length || 0]);
  if (signature === tasksState.signature) return;
  tasksState.signature = signature;
  const content = [];
  const head = document.createElement("div");
  head.className = "tasks-head";
  head.append(Object.assign(document.createElement("b"), { textContent: "Working under this chat" }));
  const close = Object.assign(document.createElement("button"), { type: "button", className: "tasks-close", title: "Close" });
  close.setAttribute("aria-label", "Close");
  close.append(createIcon("close"));
  close.addEventListener("click", closeTasksPanel);
  head.append(close);
  content.push(head);
  const section = (icon, title, rows, empty) => {
    const block = document.createElement("div");
    block.className = "tasks-section";
    const heading = document.createElement("div");
    heading.className = "tasks-section-head";
    heading.append(createIcon(icon), Object.assign(document.createElement("span"), { textContent: title }), Object.assign(document.createElement("small"), { textContent: String(rows.length) }));
    block.append(heading);
    if (rows.length) block.append(...rows);
    else block.append(Object.assign(document.createElement("div"), { className: "tasks-empty", textContent: empty }));
    return block;
  };
  content.push(section("subagent", "Subagents", subagents.map((entry) => subagentRow(entry, session.sessionId)), "No subagents in this chat"));
  content.push(section("command", "Background jobs", jobs.map((job) => jobRow(job, session.sessionId)), "No background jobs"));
  panel.replaceChildren(...content);
  scheduleSessionTimers();
}

async function refreshSessionJobs(sessionId = state.selectedSessionId) {
  if (!sessionId || !window.widget.sessionJobs || state.harnessOffline || tasksState.jobsBusy || deckScreenshotMode()) return;
  tasksState.jobsBusy = true;
  try {
    tasksState.jobsBySession.set(sessionId, await window.widget.sessionJobs(sessionId));
  } catch {
    // An older Harness has no job list; nothing to show is the honest answer.
    tasksState.jobsBySession.set(sessionId, []);
  } finally {
    tasksState.jobsBusy = false;
  }
  for (const id of [...tasksState.jobsBySession.keys()]) if (id !== sessionId && id !== state.selectedSessionId) tasksState.jobsBySession.delete(id);
  if (tasksState.expandedJobId) await loadJobOutput(sessionId, tasksState.expandedJobId).catch(() => {});
  if (sessionId === state.selectedSessionId) renderTasksChip(tasksRow(sessionId));
}

// Jobs are read for the open chat only, and only while it can be seen: every few seconds,
// faster while the panel is open.
function scheduleJobsPoll() {
  clearTimeout(tasksState.pollTimer);
  tasksState.pollTimer = setTimeout(() => {
    const visible = !document.hidden && state.windowMode === "full" && state.tab === "chat" && !state.harnessOffline;
    (visible ? refreshSessionJobs() : Promise.resolve()).catch(() => {}).finally(scheduleJobsPoll);
  }, tasksState.open ? JOBS_POLL_OPEN_MS : JOBS_POLL_MS);
}

async function loadJobOutput(sessionId, jobId) {
  const result = await window.widget.jobOutput(sessionId, jobId);
  tasksState.outputs.set(jobId, result || { output: "" });
}

function toggleJobOutput(sessionId, jobId) {
  tasksState.expandedJobId = tasksState.expandedJobId === jobId ? null : jobId;
  tasksState.signature = "";
  renderTasksPanel(tasksRow(sessionId));
  if (tasksState.expandedJobId) {
    loadJobOutput(sessionId, jobId)
      .catch((error) => tasksState.outputs.set(jobId, { output: `Could not read the output: ${error?.message || error}` }))
      .finally(() => { tasksState.signature = ""; renderTasksPanel(tasksRow(sessionId)); });
  }
}

async function stopJob(sessionId, job) {
  const confirmed = await deckConfirm({ title: `Stop “${compactText(job.label, 40)}”?`, text: "The job is killed. The agent that started it sees that it was stopped.", okLabel: "Stop job", danger: true });
  if (!confirmed) return;
  try {
    const result = await window.widget.killJob(sessionId, job.id);
    showActionToast(result?.outcome === "already-finished" ? "It had already finished" : "Stopping the job", { icon: "stop" });
    await refreshSessionJobs(sessionId);
  } catch (error) {
    showActionToast(`Not stopped: ${compactText(String(error?.message || error), 60)}`, { kind: "error", icon: "alert", duration: 4200 });
  }
}

async function stopSubagent(entry) {
  const confirmed = await deckConfirm({ title: `Stop “${compactText(entry.title, 40)}”?`, text: "Its turn ends now. Its parent hears that it was stopped and can continue it later.", okLabel: "Stop subagent", danger: true });
  if (!confirmed) return;
  try {
    await window.widget.interruptSubagent(entry.sessionId, entry.parentSessionId);
    showActionToast("Stopping the subagent", { icon: "stop" });
    await refresh({ afterCurrent: true });
  } catch (error) {
    showActionToast(`Not stopped: ${compactText(String(error?.message || error), 60)}`, { kind: "error", icon: "alert", duration: 4200 });
  }
}

// --- A subagent's own chat ---------------------------------------------------------------

function subagentEntry(view = tasksState.subagentView) {
  if (!view) return null;
  return sessionSubagents(tasksRow(view.rootId)).find((entry) => entry.sessionId === view.childId) || null;
}

// The open subagent as a session row, for app.js's selectedSessionRow: whether it works and
// since when. The session list leaves subagents out, so nothing else can say.
function subagentSessionRow(sessionId = state.selectedSessionId) {
  const view = tasksState.subagentView;
  if (!view || view.childId !== sessionId) return null;
  const entry = subagentEntry(view);
  const running = entry?.activity === "running";
  // Its own session row from the last poll carries its tokens, context and model.
  const listed = state.dashboard?.subagentSession?.sessionId === sessionId ? state.dashboard.subagentSession : null;
  return { ...listed, sessionId, title: entry?.title || view.title, running, runningSince: running ? entry?.runningSince ?? null : null, activity: null, state: running ? "working" : "idle", subagent: true };
}

// DSH delivers a message to a subagent only when it was started continuable; a one-shot
// child ran once and answers to its parent alone. An unknown mode is offered the composer
// and DSH has the last word.
function subagentWritable(entry = subagentEntry()) {
  return Boolean(tasksState.subagentView) && entry?.mode !== "one-shot";
}

async function openSubagentChat(entry, rootId) {
  const root = tasksRow(rootId);
  tasksState.subagentView = { childId: entry.sessionId, rootId, title: entry.title, rootTitle: root?.title || "Chat" };
  closeTasksPanel();
  document.body.classList.add("viewing-subagent");
  renderSubagentBar();
  await selectSession(entry.sessionId, true);
}

async function closeSubagentChat() {
  const view = tasksState.subagentView;
  if (!view) return;
  leaveSubagentView();
  await selectSession(view.rootId, true);
}

function leaveSubagentView() {
  tasksState.subagentView = null;
  document.body.classList.remove("viewing-subagent", "subagent-writable");
  $("#subagentBar").hidden = true;
  $("#subagentReadOnly").hidden = true;
  $("#messageInput").placeholder = "Message the agent…";
}

// Called by selectSession: choosing any other chat leaves the subagent's view.
function syncSubagentView(selectedSessionId) {
  if (tasksState.subagentView && tasksState.subagentView.childId !== selectedSessionId) leaveSubagentView();
  if (tasksState.open && !tasksRow(selectedSessionId)) closeTasksPanel();
  tasksState.signature = "";
  if (selectedSessionId) refreshSessionJobs(selectedSessionId).catch(() => {});
}

function renderSubagentBar() {
  const view = tasksState.subagentView;
  const bar = $("#subagentBar");
  if (!bar) return;
  bar.hidden = !view;
  if (!view) { $("#subagentReadOnly").hidden = true; return; }
  const entry = subagentEntry(view);
  // A continuable subagent is written to here like any chat; its messages reach it through
  // the parent (HarnessApi.prompt). A one-shot one keeps the note saying why it cannot be.
  const writable = subagentWritable(entry);
  document.body.classList.toggle("subagent-writable", writable);
  $("#subagentReadOnly").hidden = writable;
  const input = $("#messageInput");
  const placeholder = writable ? "Message this subagent…" : "Message the agent…";
  if (input.placeholder !== placeholder) input.placeholder = placeholder;
  const running = entry?.activity === "running";
  $("#subagentParentTitle").textContent = compactText(view.rootTitle, 40);
  $("#subagentTitle").textContent = compactText(entry?.title || view.title, 60);
  const status = $("#subagentStatus");
  status.className = `subagent-status ${running ? "running" : entry?.outcome || "idle"}`;
  delete status.dataset.runningSince;
  if (running && entry.runningSince) taskTime(status, { since: entry.runningSince });
  else status.textContent = running ? "working" : entry?.outcome === "failed" ? "stopped short" : entry?.outcome === "done" ? "done" : "idle";
  $("#subagentStop").hidden = !running;
  renderSubagentUsage();
  scheduleSessionTimers();
}

// Context and spend of the open subagent. The chat heading that shows a chat's model and spend
// is hidden here, and a one-shot subagent has no composer, so no context meter either. Hovered,
// it opens the meter's card: model, tokens, cache and time.
function renderSubagentUsage() {
  const usage = $("#subagentUsage");
  if (!usage) return;
  const row = subagentSessionRow();
  const pressure = contextPressure(row);
  const spend = sessionSpend(row);
  const tree = sessionTreeSpend(row);
  const spendText = tree?.subagents.priced ? chatSpendAmount(spend, tree) : spend && (spend.total > 0 || spend.free) ? spendAmount(spend) : "";
  const parts = [pressure ? `${Math.round(pressure.percent)}%` : "", spendText].filter(Boolean);
  const text = parts.join(" · ");
  if (usage.hidden === Boolean(text)) usage.hidden = !text;
  if (usage.textContent !== text) usage.textContent = text;
  if (chatTooltipOwner === usage) showChatTooltip(usage);
}

// Wired once app.js has run: DOMContentLoaded fires after every script of the page.
document.addEventListener("DOMContentLoaded", () => {
  $("#subagentsButton").addEventListener("click", toggleTasksPanel);
  $("#subagentBack").addEventListener("click", () => closeSubagentChat().catch(showError));
  $("#subagentStop").addEventListener("click", () => { const entry = subagentEntry(); if (entry) stopSubagent(entry).catch(() => {}); });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    if (tasksState.open) { event.preventDefault(); closeTasksPanel(); }
    else if (subagentViewActive() && !document.querySelector(".floating-menu")) { event.preventDefault(); closeSubagentChat().catch(() => {}); }
  });
  scheduleJobsPoll();
});
