const state = {
  dashboard: null,
  selectedSessionId: null,
  tab: "agents",
  refreshing: false,
  historyBusy: false,
  modelsBusy: false,
  commandsBusy: false,
  modelCatalog: null,
  commandCatalog: [],
  workspaces: [],
  workspacesBusy: false,
  selectedWorkspaceId: null,
  pendingAttachments: [],
  pendingSelection: null,
  windowMode: "full",
  avatarMode: "idle",
  unread: 0,
  dashboardInitialized: false,
  runningSessionIds: new Set(),
};

const $ = (selector) => document.querySelector(selector);
const AVATARS = {
  idle: "assets/neoxider-github.png",
  working: "assets/avatar-working.png",
  waiting: "assets/avatar-waiting.png",
  error: "assets/avatar-error.png",
  done: "assets/avatar-done.png",
};
const AVATAR_LABELS = {
  idle: "ready",
  working: "working",
  waiting: "waiting",
  error: "error",
  done: "done",
};

function setAvatar(mode, label) {
  state.avatarMode = mode;
  const shell = $("#avatarShell");
  shell.className = `avatar-shell ${mode}`;
  document.querySelectorAll("[data-avatar]").forEach((image) => { image.src = AVATARS[mode] || AVATARS.idle; });
  $("#avatarState").textContent = label || AVATAR_LABELS[mode] || "ready";
  document.body.classList.remove("state-idle", "state-working", "state-waiting", "state-error", "state-done");
  document.body.classList.add(`state-${mode}`);
}

function renderNotifications() {
  document.querySelectorAll("[data-notification]").forEach((badge) => {
    badge.textContent = state.unread > 99 ? "99+" : String(state.unread);
    badge.classList.toggle("visible", state.unread > 0);
  });
}

function notifyCompletion() {
  setAvatar("done");
  if (state.windowMode !== "full") {
    state.unread += 1;
    renderNotifications();
    window.widget.notifyAgentComplete();
  }
  setTimeout(() => {
    if (!state.dashboard?.sessions?.some((session) => session.running)) setAvatar("idle");
  }, 1600);
}

function applyWindowMode(mode) {
  state.windowMode = mode;
  document.body.classList.remove("mode-full", "mode-orb", "mode-edge");
  document.body.classList.add(`mode-${mode}`);
  if (mode === "full") {
    state.unread = 0;
    renderNotifications();
  }
}

async function setWindowMode(mode) {
  applyWindowMode(await window.widget.setWindowMode(mode));
}

function initials(title) {
  return String(title || "AI").split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase();
}

function counts(dashboard) {
  let active = 0;
  let subagents = 0;
  for (const session of dashboard.sessions || []) {
    if (session.running) active += 1;
    for (const child of session.subagents || []) {
      if (child.kind !== "child") continue;
      subagents += 1;
      if (child.activity === "running") active += 1;
    }
  }
  return { active, sessions: (dashboard.sessions || []).length, subagents };
}

function contextPressure(session) {
  const pressure = session?.projections?.values?.contextPressure;
  if (!pressure) return null;
  const used = Number(pressure.projectedTokens ?? pressure.pressureTokens);
  const total = Number(pressure.contextWindow);
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return null;
  return { used, total, percent: Math.max(0, Math.min(100, (used / total) * 100)) };
}

function formatTokens(value) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(value));
}

function renderContext() {
  const session = state.dashboard?.sessions?.find((item) => item.sessionId === state.selectedSessionId);
  const pressure = contextPressure(session);
  const meter = $("#contextMeter");
  meter.classList.remove("high", "critical");
  if (!pressure) {
    meter.style.setProperty("--context", "0");
    $("#contextArc").style.strokeDashoffset = "97.39";
    $("#contextValue").textContent = "—";
    meter.title = "Context usage unavailable";
    return;
  }
  const rounded = Math.round(pressure.percent);
  meter.style.setProperty("--context", String(rounded));
  $("#contextArc").style.strokeDashoffset = String(97.39 * (1 - rounded / 100));
  $("#contextValue").textContent = `${rounded}%`;
  meter.title = `Context: ${formatTokens(pressure.used)} / ${formatTokens(pressure.total)} tokens`;
  meter.classList.toggle("high", rounded >= 70 && rounded < 90);
  meter.classList.toggle("critical", rounded >= 90);
}

function renderSessions() {
  const root = $("#sessions");
  const sessions = state.dashboard?.sessions || [];
  root.replaceChildren();
  if (!sessions.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = state.dashboard?.harness ? "No sessions yet. Start one in chat." : "Harness is offline.";
    root.append(empty);
    return;
  }
  for (const session of sessions) {
    const card = document.createElement("div");
    card.className = `session-card${session.sessionId === state.selectedSessionId ? " selected" : ""}`;
    const avatar = document.createElement("div");
    avatar.className = `avatar${session.running ? " running" : ""}`;
    avatar.textContent = initials(session.title);
    const main = document.createElement("div");
    main.className = "session-main";
    const name = document.createElement("div");
    name.className = "session-name";
    name.textContent = session.title || "New session";
    const meta = document.createElement("div");
    meta.className = "session-meta";
    const childCount = (session.subagents || []).filter((item) => item.kind === "child").length;
    const pressure = contextPressure(session);
    meta.textContent = `${session.running ? "working" : "idle"}${childCount ? ` · ${childCount} subagent${childCount === 1 ? "" : "s"}` : ""}${pressure ? ` · ${Math.round(pressure.percent)}% ctx` : ""}`;
    main.append(name, meta);
    const badge = document.createElement("div");
    badge.className = "agent-badge";
    badge.textContent = (session.subagents || []).filter((item) => item.kind === "child" && item.activity === "running").length || "·";
    card.append(avatar, main, badge);
    card.addEventListener("click", () => selectSession(session.sessionId, true));
    root.append(card);
  }
}

function renderSessionSelect() {
  const select = $("#sessionSelect");
  const sessions = state.dashboard?.sessions || [];
  select.replaceChildren();
  const fresh = document.createElement("option");
  fresh.value = "";
  fresh.textContent = "+ New session";
  select.append(fresh);
  for (const session of sessions) {
    const option = document.createElement("option");
    option.value = session.sessionId;
    option.textContent = `${session.running ? "● " : ""}${session.title}`;
    option.selected = session.sessionId === state.selectedSessionId;
    select.append(option);
  }
}

function modelSelectionValue(selection) {
  return selection ? JSON.stringify({ provider: selection.provider, model: selection.model }) : "";
}

function selectedModelDefinition() {
  const selection = state.pendingSelection || state.modelCatalog?.current;
  if (!selection) return null;
  const group = state.modelCatalog?.groups?.find((item) => item.id === selection.provider);
  return group?.models?.find((item) => item.id === selection.model) || null;
}

function renderReasoning() {
  const select = $("#reasoningSelect");
  select.replaceChildren();
  const model = selectedModelDefinition();
  const efforts = model?.reasoning?.efforts || [];
  const auto = document.createElement("option");
  auto.value = "";
  auto.textContent = model?.reasoning?.defaultEffort ? `Auto (${model.reasoning.defaultEffort})` : "Auto";
  select.append(auto);
  for (const effort of efforts) {
    const option = document.createElement("option");
    option.value = effort.id;
    option.textContent = effort.name || effort.id;
    select.append(option);
  }
  select.disabled = efforts.length === 0;
  select.value = state.pendingSelection?.reasoningEffort || state.modelCatalog?.current?.reasoningEffort || "";
}

function renderModels() {
  const select = $("#modelSelect");
  select.replaceChildren();
  const auto = document.createElement("option");
  auto.value = "";
  auto.textContent = "Harness default";
  select.append(auto);
  const catalog = state.modelCatalog;
  if (!catalog) {
    renderReasoning();
    return;
  }
  for (const group of catalog.groups || []) {
    const optgroup = document.createElement("optgroup");
    optgroup.label = group.name || group.id;
    for (const model of group.models || []) {
      const option = document.createElement("option");
      option.value = modelSelectionValue({ provider: group.id, model: model.id });
      option.textContent = model.name || model.id;
      optgroup.append(option);
    }
    select.append(optgroup);
  }
  const selected = state.pendingSelection || catalog.current;
  select.value = modelSelectionValue(selected);
  if (selected && !select.value) {
    const fallback = document.createElement("option");
    fallback.value = modelSelectionValue(selected);
    fallback.textContent = `${selected.provider} / ${selected.model}`;
    select.prepend(fallback);
    select.value = fallback.value;
  }
  renderReasoning();
}

async function loadModels() {
  if (state.modelsBusy || !state.dashboard?.harness) return;
  state.modelsBusy = true;
  try {
    state.modelCatalog = await window.widget.models(state.selectedSessionId);
    state.pendingSelection = state.modelCatalog.current || state.pendingSelection;
    renderModels();
  } catch (error) {
    setAvatar("error", "models unavailable");
  } finally {
    state.modelsBusy = false;
  }
}

function renderCommands() {
  const root = $("#commandMenu");
  root.replaceChildren();
  for (const command of state.commandCatalog) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "command-chip";
    chip.textContent = `/${command.name}`;
    chip.title = `${command.description || command.name}${command.input?.hint ? ` · ${command.input.hint}` : ""}`;
    chip.addEventListener("click", () => {
      const input = $("#messageInput");
      input.value = `/${command.name}${command.input?.hint ? " " : ""}`;
      input.placeholder = command.input?.hint || "Run Harness command…";
      input.focus();
    });
    root.append(chip);
  }
}

function renderWorkspaces() {
  const select = $("#workspaceSelect");
  select.replaceChildren();
  const current = document.createElement("option");
  current.value = "";
  current.textContent = "Current workspace";
  select.append(current);
  for (const workspace of state.workspaces) {
    const option = document.createElement("option");
    option.value = workspace.workspaceId;
    option.textContent = workspace.title || workspace.path;
    option.title = workspace.path;
    select.append(option);
  }
  const session = state.dashboard?.sessions?.find((item) => item.sessionId === state.selectedSessionId);
  select.value = session?.workspaceId || state.selectedWorkspaceId || "";
}

async function loadWorkspaces() {
  if (state.workspacesBusy || !state.dashboard?.harness) return;
  state.workspacesBusy = true;
  try {
    state.workspaces = await window.widget.workspaces();
    renderWorkspaces();
  } catch {
    state.workspaces = [];
    renderWorkspaces();
  } finally {
    state.workspacesBusy = false;
  }
}

function renderAttachments() {
  const root = $("#attachmentList");
  root.replaceChildren();
  state.pendingAttachments.forEach((attachment, index) => {
    const chip = document.createElement("div");
    chip.className = "attachment-chip";
    chip.title = attachment.path;
    const icon = document.createElement("i");
    icon.textContent = attachment.kind === "image" ? "▧" : "⌕";
    const name = document.createElement("span");
    name.textContent = attachment.name;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.title = "Remove attachment";
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      state.pendingAttachments.splice(index, 1);
      renderAttachments();
    });
    chip.append(icon, name, remove);
    root.append(chip);
  });
}

function addAttachments(attachments) {
  const known = new Set(state.pendingAttachments.map((item) => item.path));
  for (const attachment of attachments || []) {
    if (!known.has(attachment.path) && state.pendingAttachments.length < 12) {
      state.pendingAttachments.push(attachment);
      known.add(attachment.path);
    }
  }
  renderAttachments();
}

async function loadCommands() {
  if (state.commandsBusy || !state.selectedSessionId || !state.dashboard?.harness) {
    if (!state.selectedSessionId) {
      state.commandCatalog = [];
      renderCommands();
    }
    return;
  }
  state.commandsBusy = true;
  try {
    state.commandCatalog = await window.widget.commands(state.selectedSessionId);
    renderCommands();
  } catch {
    state.commandCatalog = [];
    renderCommands();
  } finally {
    state.commandsBusy = false;
  }
}

async function applyModelSelection() {
  if (!state.selectedSessionId || !state.pendingSelection) return;
  setAvatar("waiting", "switching model");
  try {
    await window.widget.selectModel({ sessionId: state.selectedSessionId, selection: state.pendingSelection });
    setAvatar("idle", "model selected");
  } catch (error) {
    showError(error);
    setAvatar("error", "model error");
  }
}

async function selectSession(sessionId, openChat = false) {
  state.selectedSessionId = sessionId || null;
  state.pendingSelection = null;
  state.modelCatalog = null;
  state.commandCatalog = [];
  state.selectedWorkspaceId = state.dashboard?.sessions?.find((item) => item.sessionId === sessionId)?.workspaceId || null;
  renderSessions();
  renderSessionSelect();
  renderContext();
  renderWorkspaces();
  if (openChat) setTab("chat");
  await Promise.all([refreshHistory(), loadModels(), loadCommands(), loadWorkspaces()]);
}

function renderMessages(messages) {
  const root = $("#messages");
  root.replaceChildren();
  if (!messages.length) {
    root.innerHTML = '<div class="empty-state">Write a message — the widget will create a session.</div>';
    return;
  }
  for (const message of messages) {
    const bubble = document.createElement("div");
    bubble.className = `bubble ${message.role}`;
    bubble.textContent = message.text;
    root.append(bubble);
  }
  root.scrollTop = root.scrollHeight;
}

function showError(error) {
  renderMessages([{ role: "error", text: String(error?.message || error) }]);
}

async function refreshHistory() {
  if (state.historyBusy) return;
  if (!state.selectedSessionId) {
    renderMessages([]);
    return;
  }
  state.historyBusy = true;
  try {
    const messages = await window.widget.history(state.selectedSessionId);
    renderMessages(messages);
    const latest = messages[messages.length - 1];
    if (latest?.role === "error") setAvatar("error", "model error");
  } catch (error) {
    showError(error);
    setAvatar("error", "history error");
  } finally {
    state.historyBusy = false;
  }
}

function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll(".tab").forEach((button) => button.classList.toggle("active", button.dataset.tab === tab));
  $("#agentsPanel").classList.toggle("active", tab === "agents");
  $("#chatPanel").classList.toggle("active", tab === "chat");
  if (tab === "chat") Promise.all([refreshHistory(), loadModels(), loadCommands()]);
}

function detectCompletedSessions(nextSessions) {
  const currentRunning = new Set(nextSessions.filter((session) => session.running).map((session) => session.sessionId));
  if (state.dashboardInitialized) {
    const existing = new Set(nextSessions.map((session) => session.sessionId));
    for (const sessionId of state.runningSessionIds) {
      if (!currentRunning.has(sessionId) && existing.has(sessionId)) notifyCompletion();
    }
  }
  state.runningSessionIds = currentRunning;
  state.dashboardInitialized = true;
}

async function refresh() {
  if (state.refreshing) return;
  state.refreshing = true;
  try {
    const dashboard = await window.widget.dashboard();
    detectCompletedSessions(dashboard.sessions || []);
    state.dashboard = dashboard;
    if (state.selectedSessionId && !dashboard.sessions?.some((session) => session.sessionId === state.selectedSessionId)) state.selectedSessionId = null;
    if (!state.selectedSessionId && dashboard.sessions?.length) {
      state.selectedSessionId = (dashboard.sessions.find((session) => session.running) || dashboard.sessions[0]).sessionId;
    }
    const summary = counts(dashboard);
    $("#agentCount").textContent = summary.active;
    $("#sessionCount").textContent = summary.sessions;
    $("#subagentCount").textContent = summary.subagents;
    $("#offlineBanner").classList.toggle("show", !dashboard.harness);
    if (!dashboard.harness) setAvatar("error", "Harness offline");
    else if (dashboard.sessions?.some((session) => session.running)) setAvatar("working");
    else if (!["done", "error"].includes(state.avatarMode)) setAvatar("idle");
    $("#lastUpdate").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    renderSessions();
    renderSessionSelect();
    renderContext();
    if (!state.modelCatalog) await loadModels();
    if (!state.commandCatalog.length) await loadCommands();
    if (!state.workspaces.length) await loadWorkspaces();
    if (state.tab === "chat") await refreshHistory();
  } finally {
    state.refreshing = false;
  }
}

async function executeHarnessCommand(line) {
  if (!state.selectedSessionId) throw new Error("Select or create a session first");
  setAvatar("working", "running command");
  const value = await window.widget.executeCommand({ sessionId: state.selectedSessionId, line });
  const result = value?.result;
  renderMessages([
    { role: "user", text: line },
    { role: result?.kind === "error" ? "error" : "command", text: result?.text || "Command completed" },
  ]);
  setAvatar(result?.kind === "error" ? "error" : "done", result?.kind === "error" ? "command error" : "command done");
  await refreshHistory();
}

document.querySelectorAll(".tab").forEach((button) => button.addEventListener("click", () => setTab(button.dataset.tab)));
$("#sessionSelect").addEventListener("change", (event) => selectSession(event.target.value));
$("#newSessionButton").addEventListener("click", async () => {
  setAvatar("waiting", "creating session");
  const result = await window.widget.createSession(state.selectedWorkspaceId ? { workspaceId: state.selectedWorkspaceId } : {});
  state.selectedSessionId = result.sessionId;
  state.pendingSelection = null;
  state.modelCatalog = null;
  state.commandCatalog = [];
  await refresh();
  await Promise.all([loadModels(), loadCommands(), loadWorkspaces()]);
  $("#messageInput").focus();
});
$("#modelSelect").addEventListener("change", async (event) => {
  if (!event.target.value) {
    state.pendingSelection = null;
    renderReasoning();
    return;
  }
  state.pendingSelection = JSON.parse(event.target.value);
  const model = selectedModelDefinition();
  if (model?.reasoning?.defaultEffort) state.pendingSelection.reasoningEffort = model.reasoning.defaultEffort;
  renderReasoning();
  await applyModelSelection();
});
$("#reasoningSelect").addEventListener("change", async (event) => {
  const base = state.pendingSelection || state.modelCatalog?.current;
  if (!base) return;
  state.pendingSelection = { provider: base.provider, model: base.model };
  if (event.target.value) state.pendingSelection.reasoningEffort = event.target.value;
  await applyModelSelection();
});
$("#commandsButton").addEventListener("click", async () => {
  await loadCommands();
  $("#commandMenu").classList.toggle("open");
});
$("#workspaceSelect").addEventListener("change", async (event) => {
  const workspaceId = event.target.value;
  if (!workspaceId) return;
  setAvatar("waiting", "switching workspace");
  try {
    state.selectedWorkspaceId = workspaceId;
    const result = await window.widget.createSession({ workspaceId });
    await refresh();
    await selectSession(result.sessionId, true);
    setAvatar("idle", "workspace ready");
  } catch (error) {
    showError(error);
    setAvatar("error", "workspace error");
  }
});
$("#addWorkspaceButton").addEventListener("click", async () => {
  setAvatar("waiting", "choosing workspace");
  try {
    const result = await window.widget.pickWorkspace();
    if (!result) {
      setAvatar("idle");
      return;
    }
    state.workspaces = await window.widget.workspaces();
    state.selectedWorkspaceId = result.workspace.workspaceId;
    renderWorkspaces();
    const session = await window.widget.createSession({ workspaceId: state.selectedWorkspaceId });
    await refresh();
    await selectSession(session.sessionId, true);
    setAvatar("idle", "workspace ready");
  } catch (error) {
    showError(error);
    setAvatar("error", "workspace error");
  }
});
$("#modeSelect").addEventListener("change", async (event) => {
  try {
    await executeHarnessCommand(event.target.value === "plan" ? "/plan" : "/plan off");
  } catch (error) {
    showError(error);
    setAvatar("error", "mode error");
  }
});
$("#attachButton").addEventListener("click", async () => {
  try {
    addAttachments(await window.widget.pickFiles());
  } catch (error) {
    showError(error);
    setAvatar("error", "attachment error");
  }
});
$("#chatForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = $("#messageInput");
  const text = input.value.trim();
  if (!text && !state.pendingAttachments.length) return;
  $("#sendButton").disabled = true;
  input.value = "";
  input.placeholder = "Message the agent…";
  try {
    const commandName = /^\/(\S+)/.exec(text)?.[1];
    if (commandName && state.commandCatalog.some((command) => command.name === commandName)) {
      await executeHarnessCommand(text);
    } else {
      setAvatar("working", "sending");
      const result = await window.widget.send({
        sessionId: state.selectedSessionId,
        text,
        selection: state.pendingSelection,
        attachments: state.pendingAttachments,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      state.selectedSessionId = result.sessionId;
      state.pendingAttachments = [];
      renderAttachments();
      setAvatar("waiting", "waiting for reply");
      await refresh();
    }
  } catch (error) {
    input.value = text;
    showError(error);
    setAvatar("error", "not sent");
  } finally {
    $("#sendButton").disabled = false;
    input.focus();
  }
});
$("#messageInput").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    $("#chatForm").requestSubmit();
  }
});
$("#cancelButton").addEventListener("click", async () => state.selectedSessionId && window.widget.cancel(state.selectedSessionId));
$("#offlineBanner").addEventListener("click", () => window.widget.startHarness());
$("#openHarnessButton").addEventListener("click", () => window.widget.openHarness());
$("#refreshButton").addEventListener("click", refresh);
$("#orbButton").addEventListener("click", () => setWindowMode("orb"));
$("#dockButton").addEventListener("click", () => setWindowMode("edge"));
$("#orbMode").addEventListener("click", () => setWindowMode("full"));
$("#edgeMode").addEventListener("click", () => setWindowMode("full"));
$("#settingsButton").addEventListener("click", () => $("#settingsPanel").classList.toggle("open"));
$("#closeSettings").addEventListener("click", () => $("#settingsPanel").classList.remove("open"));
$("#topToggle").addEventListener("change", (event) => window.widget.setAlwaysOnTop(event.target.checked));
$("#autoStartToggle").addEventListener("change", async (event) => { event.target.checked = await window.widget.setAutoStart(event.target.checked); });
$("#opacityRange").addEventListener("input", async (event) => {
  const percent = Number(event.target.value);
  $("#opacityValue").textContent = `${percent}%`;
  await window.widget.setOpacity(percent / 100);
});
$("#sizeSelect").addEventListener("change", (event) => window.widget.setSize(event.target.value));

let dragDepth = 0;
document.addEventListener("dragenter", (event) => {
  event.preventDefault();
  dragDepth += 1;
  if (state.tab === "chat") $("#chatPanel").classList.add("dragging");
});
document.addEventListener("dragover", (event) => event.preventDefault());
document.addEventListener("dragleave", (event) => {
  event.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) $("#chatPanel").classList.remove("dragging");
});
document.addEventListener("drop", async (event) => {
  event.preventDefault();
  dragDepth = 0;
  $("#chatPanel").classList.remove("dragging");
  if (state.tab !== "chat") return;
  try {
    const paths = [...event.dataTransfer.files].map((file) => window.widget.pathForFile(file)).filter(Boolean);
    addAttachments(await window.widget.prepareFiles(paths));
  } catch (error) {
    showError(error);
    setAvatar("error", "attachment error");
  }
});

window.widget.onWindowMode((mode) => applyWindowMode(mode));
window.widget.onEdgeBounce(() => {
  const edge = $("#edgeMode");
  edge.classList.remove("bounce");
  void edge.offsetWidth;
  edge.classList.add("bounce");
});
window.widget.getPreferences().then((preferences) => {
  $("#topToggle").checked = preferences.alwaysOnTop;
  $("#autoStartToggle").checked = preferences.autoStart;
  $("#opacityRange").value = Math.round(preferences.opacity * 100);
  $("#opacityValue").textContent = `${Math.round(preferences.opacity * 100)}%`;
  $("#sizeSelect").value = preferences.size;
  applyWindowMode(preferences.windowMode || "full");
});

const requestedTab = new URLSearchParams(location.search).get("screenshotTab");
if (requestedTab === "chat") setTab("chat");
setAvatar("idle");
renderNotifications();
refresh();
setInterval(refresh, 2500);
