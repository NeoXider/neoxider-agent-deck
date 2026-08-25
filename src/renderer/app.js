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
  currentActivity: null,
  currentMode: "agent",
  unread: 0,
  dashboardInitialized: false,
  runningSessionIds: new Set(),
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
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

function createIcon(name, className = "ui-icon") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", className);
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#icon-${name}`);
  svg.append(use);
  return svg;
}

function compactText(value, limit = 120) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized;
}

function closePickers(except = null) {
  $$(".picker.open").forEach((picker) => {
    if (picker === except) return;
    picker.classList.remove("open");
    picker.querySelector(".picker-button")?.setAttribute("aria-expanded", "false");
  });
}

function togglePicker(button) {
  if (button.disabled) return;
  const picker = button.closest(".picker");
  const open = !picker.classList.contains("open");
  closePickers(open ? picker : null);
  picker.classList.toggle("open", open);
  button.setAttribute("aria-expanded", String(open));
}

function pickerOption(label, { selected = false, meta = "", title = "", onSelect } = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `picker-option${selected ? " selected" : ""}`;
  button.title = title || label;
  const mark = document.createElement("i");
  mark.className = "picker-check";
  if (selected) mark.append(createIcon("check"));
  const text = document.createElement("span");
  text.textContent = label;
  button.append(mark, text);
  if (meta) {
    const small = document.createElement("small");
    small.textContent = meta;
    button.append(small);
  }
  button.addEventListener("click", onSelect);
  return button;
}

function syncCompactStatus() {
  const activity = state.currentActivity;
  const active = Boolean(activity?.active || ["working", "waiting", "error", "done"].includes(state.avatarMode));
  const label = activity?.label || AVATAR_LABELS[state.avatarMode] || "Ready";
  const text = compactText(activity?.text || $("#avatarState")?.textContent || label, 96);
  document.body.classList.toggle("orb-has-status", active);
  $("#orbStatusLabel").textContent = label;
  $("#orbStatusText").textContent = text;
  window.widget.setCompactStatus({ active, label, text }).catch(() => {});
}

function setActivity(activity) {
  state.currentActivity = activity || null;
  document.body.classList.remove("activity-thinking", "activity-writing", "activity-tool");
  if (activity?.active && ["thinking", "writing", "tool"].includes(activity.kind)) {
    document.body.classList.add(`activity-${activity.kind}`);
  }
  const card = $("#activityCard");
  const hasActivity = Boolean(activity?.text);
  card.classList.toggle("has-activity", hasActivity);
  if (hasActivity) {
    $("#activityLabel").textContent = activity.label || "Activity";
    $("#activityPreview").textContent = compactText(activity.text, 110);
    $("#activityBody").textContent = activity.text;
  }
  syncCompactStatus();
}

function setAvatar(mode, label) {
  state.avatarMode = mode;
  const shell = $("#avatarShell");
  shell.className = `avatar-shell ${mode}`;
  document.querySelectorAll("[data-avatar]").forEach((image) => { image.src = AVATARS[mode] || AVATARS.idle; });
  $("#avatarState").textContent = label || AVATAR_LABELS[mode] || "ready";
  document.body.classList.remove("state-idle", "state-working", "state-waiting", "state-error", "state-done");
  document.body.classList.add(`state-${mode}`);
  syncCompactStatus();
}

function renderNotifications() {
  document.querySelectorAll("[data-notification]").forEach((badge) => {
    badge.textContent = state.unread > 99 ? "99+" : String(state.unread);
    badge.classList.toggle("visible", state.unread > 0);
  });
}

function notifyCompletion() {
  setAvatar("done");
  setActivity({ active: true, kind: "done", label: "Done", text: "Agent finished the current task." });
  if (state.windowMode !== "full") {
    state.unread += 1;
    renderNotifications();
    window.widget.notifyAgentComplete();
  }
  setTimeout(() => {
    if (!state.dashboard?.sessions?.some((session) => session.running)) {
      setAvatar("idle");
      setActivity(null);
    }
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
  syncCompactStatus();
}

async function setWindowMode(mode) {
  applyWindowMode(await window.widget.setWindowMode(mode));
}

function applyCompactSide(side) {
  document.body.classList.toggle("side-left", side === "left");
  document.body.classList.toggle("side-right", side !== "left");
}

let compactDrag = null;
let suppressCompactClick = false;

function beginCompactDrag(event) {
  if (event.button !== 0 || event.target.closest(".orb-actions button")) return;
  compactDrag = {
    target: event.currentTarget,
    pointerId: event.pointerId,
    startX: event.screenX,
    startY: event.screenY,
    moved: false,
  };
  event.currentTarget.setPointerCapture?.(event.pointerId);
  window.widget.beginCompactDrag({ x: event.screenX, y: event.screenY });
}

function moveCompactDrag(event) {
  if (!compactDrag || compactDrag.pointerId !== event.pointerId) return;
  const dx = event.screenX - compactDrag.startX;
  const dy = event.screenY - compactDrag.startY;
  if (!compactDrag.moved && Math.hypot(dx, dy) < 4) return;
  compactDrag.moved = true;
  event.preventDefault();
  window.widget.moveCompactDrag({ x: event.screenX, y: event.screenY });
}

async function endCompactDrag(event) {
  if (!compactDrag || compactDrag.pointerId !== event.pointerId) return;
  const moved = compactDrag.moved;
  compactDrag.target.releasePointerCapture?.(event.pointerId);
  compactDrag = null;
  if (!moved) return;
  event.preventDefault();
  suppressCompactClick = true;
  const result = await window.widget.endCompactDrag().catch(() => null);
  if (result?.side) applyCompactSide(result.side);
  setTimeout(() => { suppressCompactClick = false; }, 0);
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
  const sessions = state.dashboard?.sessions || [];
  const selected = sessions.find((session) => session.sessionId === state.selectedSessionId);
  $("#sessionButtonText").textContent = selected?.title || "New session";
  const root = $("#sessionOptions");
  root.replaceChildren();
  root.append(pickerOption("New session", {
    meta: "new",
    onSelect: async () => {
      closePickers();
      await createNewSession();
    },
  }));
  for (const session of sessions) {
    const pressure = contextPressure(session);
    root.append(pickerOption(session.title || "New session", {
      selected: session.sessionId === state.selectedSessionId,
      meta: session.running ? "working" : pressure ? `${Math.round(pressure.percent)}%` : "idle",
      title: session.cwd || session.title,
      onSelect: async () => {
        closePickers();
        await selectSession(session.sessionId);
      },
    }));
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
  const model = selectedModelDefinition();
  const efforts = model?.reasoning?.efforts || [];
  const selectedId = state.pendingSelection?.reasoningEffort || state.modelCatalog?.current?.reasoningEffort || "";
  const autoLabel = model?.reasoning?.defaultEffort ? `Auto · ${model.reasoning.defaultEffort}` : "Auto";
  const selectedEffort = efforts.find((effort) => effort.id === selectedId);
  $("#reasoningButtonText").textContent = selectedEffort?.name || selectedEffort?.id || autoLabel;
  $("#reasoningButton").disabled = efforts.length === 0;
  const root = $("#reasoningOptions");
  root.replaceChildren();
  root.append(pickerOption(autoLabel, {
    selected: !selectedId,
    onSelect: async () => {
      const base = state.pendingSelection || state.modelCatalog?.current;
      if (base) state.pendingSelection = { provider: base.provider, model: base.model };
      closePickers();
      renderReasoning();
      updateControlsSummary();
      await applyModelSelection();
    },
  }));
  for (const effort of efforts) {
    root.append(pickerOption(effort.name || effort.id, {
      selected: effort.id === selectedId,
      onSelect: async () => {
        const base = state.pendingSelection || state.modelCatalog?.current;
        if (!base) return;
        state.pendingSelection = { provider: base.provider, model: base.model, reasoningEffort: effort.id };
        closePickers();
        renderReasoning();
        updateControlsSummary();
        await applyModelSelection();
      },
    }));
  }
}

function modelDisplay(selection) {
  if (!selection) return "Harness default";
  const group = state.modelCatalog?.groups?.find((item) => item.id === selection.provider);
  const model = group?.models?.find((item) => item.id === selection.model);
  return `${group?.name || selection.provider} · ${model?.name || selection.model}`;
}

function updateControlsSummary() {
  const model = modelDisplay(state.pendingSelection || state.modelCatalog?.current);
  const effort = $("#reasoningButtonText")?.textContent || "Auto";
  $("#controlsSummary").textContent = `${model} · ${effort}`;
}

function renderModelOptions(query = "") {
  const root = $("#modelOptions");
  root.replaceChildren();
  const catalog = state.modelCatalog;
  const selected = state.pendingSelection || catalog?.current;
  const normalized = query.trim().toLowerCase();
  root.append(pickerOption("Harness default", {
    selected: !selected,
    meta: "auto",
    onSelect: () => {
      state.pendingSelection = null;
      closePickers();
      renderModels();
    },
  }));
  if (!catalog) return;
  const currentProvider = selected?.provider || catalog.current?.provider;
  const localRank = (id) => id === currentProvider ? 0 : ["lmstudio", "ollama", "local"].includes(String(id).toLowerCase()) ? 1 : 2;
  const groups = [...(catalog.groups || [])].sort((left, right) => localRank(left.id) - localRank(right.id) || String(left.name || left.id).localeCompare(String(right.name || right.id)));
  let matches = 0;
  for (const group of groups) {
    const models = (group.models || []).filter((model) => !normalized || `${group.name || group.id} ${group.id} ${model.name || model.id} ${model.id}`.toLowerCase().includes(normalized));
    if (!models.length) continue;
    const heading = document.createElement("div");
    heading.className = "picker-group";
    heading.textContent = group.name || group.id;
    root.append(heading);
    for (const model of models) {
      matches += 1;
      root.append(pickerOption(model.name || model.id, {
        selected: selected?.provider === group.id && selected?.model === model.id,
        meta: model.reasoning?.efforts?.length ? "reasoning" : "",
        title: `${group.name || group.id} / ${model.name || model.id}`,
        onSelect: async () => {
          state.pendingSelection = { provider: group.id, model: model.id };
          if (model.reasoning?.defaultEffort) state.pendingSelection.reasoningEffort = model.reasoning.defaultEffort;
          closePickers();
          renderModels();
          await applyModelSelection();
        },
      }));
    }
  }
  if (normalized && matches === 0) {
    const empty = document.createElement("div");
    empty.className = "picker-empty";
    empty.textContent = "No matching models";
    root.append(empty);
  }
}

function renderModels() {
  const catalog = state.modelCatalog;
  const selected = state.pendingSelection || catalog?.current;
  $("#modelButtonText").textContent = modelDisplay(selected);
  renderModelOptions($("#modelSearch").value || "");
  renderReasoning();
  updateControlsSummary();
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
  const session = state.dashboard?.sessions?.find((item) => item.sessionId === state.selectedSessionId);
  const selectedId = session?.workspaceId || state.selectedWorkspaceId || "";
  const selected = state.workspaces.find((workspace) => workspace.workspaceId === selectedId);
  $("#workspaceButtonText").textContent = selected?.title || selected?.path || "Current workspace";
  const root = $("#workspaceOptions");
  root.replaceChildren();
  root.append(pickerOption("Current workspace", {
    selected: !selectedId,
    onSelect: () => {
      state.selectedWorkspaceId = null;
      closePickers();
      renderWorkspaces();
    },
  }));
  for (const workspace of state.workspaces) {
    root.append(pickerOption(workspace.title || workspace.path, {
      selected: workspace.workspaceId === selectedId,
      meta: "folder",
      title: workspace.path,
      onSelect: async () => {
        closePickers();
        await switchWorkspace(workspace.workspaceId);
      },
    }));
  }
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
    const preview = document.createElement("div");
    preview.className = "attachment-preview";
    if (attachment.kind === "image" && attachment.data && attachment.mediaType) {
      const image = document.createElement("img");
      image.src = `data:${attachment.mediaType};base64,${attachment.data}`;
      image.alt = "";
      preview.append(image);
    } else if (attachment.thumbnailData && attachment.thumbnailMediaType) {
      const image = document.createElement("img");
      image.src = `data:${attachment.thumbnailMediaType};base64,${attachment.thumbnailData}`;
      image.alt = "";
      preview.append(image);
    } else {
      preview.append(createIcon(attachment.kind === "image" ? "image" : attachment.previewKind === "video" ? "image" : "file"));
    }
    const name = document.createElement("span");
    name.className = "attachment-name";
    const title = document.createElement("b");
    title.textContent = attachment.name;
    const kind = document.createElement("small");
    kind.textContent = attachment.kind === "image" ? "image" : attachment.previewKind === "video" ? "video" : "file";
    name.append(title, kind);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "attachment-remove";
    remove.title = "Remove attachment";
    remove.setAttribute("aria-label", `Remove ${attachment.name}`);
    remove.append(createIcon("close"));
    remove.addEventListener("click", () => {
      state.pendingAttachments.splice(index, 1);
      renderAttachments();
    });
    chip.append(preview, name, remove);
    root.append(chip);
  });
  const count = state.pendingAttachments.length;
  $("#attachmentBar").classList.toggle("has-items", count > 0);
  $("#attachmentCount").textContent = `${count} file${count === 1 ? "" : "s"}`;
  $("#orbAttachmentCount").textContent = count ? String(count) : "";
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
    if (message.role === "tool") {
      const details = document.createElement("details");
      details.className = `tool-call${message.isError ? " failed" : ""}${message.nested ? " nested" : ""}`;
      const summary = document.createElement("summary");
      summary.append(createIcon("command"));
      const identity = document.createElement("span");
      identity.className = "tool-identity";
      const name = document.createElement("b");
      name.textContent = message.name || "Tool call";
      const status = document.createElement("small");
      status.textContent = message.status === "running" ? "running" : message.isError ? "failed" : "completed";
      identity.append(name, status);
      summary.append(identity);
      if (Number.isFinite(message.durationMs)) {
        const duration = document.createElement("time");
        duration.textContent = message.durationMs < 1000 ? `${message.durationMs} ms` : `${(message.durationMs / 1000).toFixed(1)} s`;
        summary.append(duration);
      }
      summary.append(createIcon("chevron", "ui-icon tool-chevron"));
      const body = document.createElement("div");
      body.className = "tool-body";
      const addSection = (label, value) => {
        if (!value) return;
        const section = document.createElement("section");
        const heading = document.createElement("b");
        heading.textContent = label;
        const pre = document.createElement("pre");
        pre.textContent = value;
        section.append(heading, pre);
        body.append(section);
      };
      addSection("Input", message.arguments);
      addSection(message.isError ? "Error" : "Result", message.result);
      if (!body.childElementCount) {
        const pending = document.createElement("span");
        pending.className = "tool-pending";
        pending.textContent = "Waiting for the tool result…";
        body.append(pending);
      }
      details.append(summary, body);
      root.append(details);
      continue;
    }
    if (message.role === "reasoning") {
      const details = document.createElement("details");
      details.className = "reasoning-bubble";
      const summary = document.createElement("summary");
      summary.append(createIcon("reasoning"));
      const preview = document.createElement("span");
      preview.textContent = compactText(message.text, 130);
      summary.append(preview, createIcon("chevron"));
      const body = document.createElement("div");
      body.className = "reasoning-text";
      if (message.html) body.innerHTML = message.html;
      else { body.classList.add("plain"); body.textContent = message.text; }
      details.append(summary, body);
      root.append(details);
      continue;
    }
    const bubble = document.createElement("div");
    bubble.className = `bubble ${message.role}`;
    if (message.html) bubble.innerHTML = message.html;
    else { bubble.classList.add("plain"); bubble.textContent = message.text; }
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
    const view = await window.widget.history(state.selectedSessionId);
    const messages = view.messages || [];
    renderMessages(messages);
    setActivity(view.activity || null);
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
    $("#offlineBanner").classList.toggle("show", !dashboard.harness);
    const selectedSession = dashboard.sessions?.find((session) => session.sessionId === state.selectedSessionId);
    const selectedRunning = Boolean(selectedSession?.running);
    $("#chatForm").classList.toggle("has-running", selectedRunning);
    $("#cancelButton").hidden = !selectedRunning;
    if (!dashboard.harness) setAvatar("error", "Harness offline");
    else if (dashboard.sessions?.some((session) => session.running)) {
      const running = selectedSession?.running ? selectedSession : dashboard.sessions.find((session) => session.running);
      if (running?.activity) setActivity(running.activity);
      else setActivity({ active: true, kind: "working", label: "Working", text: "Agent is processing the current turn…" });
      setAvatar("working", running?.activity?.label || "working");
    }
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

async function createNewSession({ restore = true } = {}) {
  setAvatar("waiting", "creating session");
  setActivity({ active: true, kind: "working", label: "New session", text: "Creating a Harness session…" });
  try {
    const result = await window.widget.createSession(state.selectedWorkspaceId ? { workspaceId: state.selectedWorkspaceId } : {});
    state.selectedSessionId = result.sessionId;
    state.pendingSelection = null;
    state.modelCatalog = null;
    state.commandCatalog = [];
    await refresh();
    await Promise.all([loadModels(), loadCommands(), loadWorkspaces()]);
    if (restore) {
      setTab("chat");
      $("#messageInput").focus();
    }
    setAvatar("done", "session ready");
    setActivity({ active: true, kind: "done", label: "Session ready", text: "A new Harness session is ready." });
  } catch (error) {
    showError(error);
    setAvatar("error", "session error");
    setActivity({ active: true, kind: "error", label: "Session error", text: String(error?.message || error) });
  }
}

async function switchWorkspace(workspaceId) {
  if (!workspaceId) return;
  setAvatar("waiting", "switching workspace");
  setActivity({ active: true, kind: "working", label: "Workspace", text: "Opening the selected workspace…" });
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
}

function renderMode() {
  $$(".mode-option").forEach((button) => button.classList.toggle("active", button.dataset.mode === state.currentMode));
}

async function setAgentMode(mode) {
  const previous = state.currentMode;
  state.currentMode = mode;
  renderMode();
  try {
    await executeHarnessCommand(mode === "plan" ? "/plan" : "/plan off");
  } catch (error) {
    state.currentMode = previous;
    renderMode();
    showError(error);
    setAvatar("error", "mode error");
  }
}

async function pickAttachments() {
  try {
    addAttachments(await window.widget.pickFiles());
    if (state.pendingAttachments.length && state.windowMode !== "full") {
      setActivity({ active: true, kind: "files", label: "Files ready", text: `${state.pendingAttachments.length} attachment${state.pendingAttachments.length === 1 ? "" : "s"} ready to send.` });
    }
  } catch (error) {
    showError(error);
    setAvatar("error", "attachment error");
  }
}

async function openCommands({ restore = false } = {}) {
  if (restore && state.windowMode !== "full") await setWindowMode("full");
  setTab("chat");
  await loadCommands();
  $("#commandMenu").classList.add("open");
  $("#messageInput").focus();
}

document.querySelectorAll(".tab").forEach((button) => button.addEventListener("click", () => setTab(button.dataset.tab)));
$("#sessionButton").addEventListener("click", (event) => { event.stopPropagation(); togglePicker(event.currentTarget); });
$("#modelButton").addEventListener("click", (event) => {
  event.stopPropagation();
  togglePicker(event.currentTarget);
  if (event.currentTarget.closest(".picker").classList.contains("open")) setTimeout(() => $("#modelSearch").focus(), 0);
});
$("#reasoningButton").addEventListener("click", (event) => { event.stopPropagation(); togglePicker(event.currentTarget); });
$("#workspaceButton").addEventListener("click", (event) => { event.stopPropagation(); togglePicker(event.currentTarget); });
$("#modelSearch").addEventListener("input", (event) => renderModelOptions(event.target.value));
document.addEventListener("click", (event) => { if (!event.target.closest(".picker")) closePickers(); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closePickers(); });
$("#newSessionButton").addEventListener("click", () => createNewSession());
$("#commandsButton").addEventListener("click", async () => {
  if ($("#commandMenu").classList.contains("open")) $("#commandMenu").classList.remove("open");
  else await openCommands();
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
$$('.mode-option').forEach((button) => button.addEventListener("click", () => setAgentMode(button.dataset.mode)));
$("#attachButton").addEventListener("click", pickAttachments);
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
$("#messages").addEventListener("click", (event) => {
  const link = event.target.closest("a[href]");
  if (!link) return;
  event.preventDefault();
  window.widget.openExternal(link.href).catch(() => {});
});
$("#cancelButton").addEventListener("click", async () => state.selectedSessionId && window.widget.cancel(state.selectedSessionId));
$("#offlineBanner").addEventListener("click", () => window.widget.startHarness());
$("#openHarnessButton").addEventListener("click", () => window.widget.openHarness());
$("#refreshButton").addEventListener("click", refresh);
$("#orbButton").addEventListener("click", () => setWindowMode("orb"));
$("#dockButton").addEventListener("click", () => setWindowMode("edge"));
$("#orbRestore").addEventListener("click", (event) => { if (suppressCompactClick) event.preventDefault(); else setWindowMode("full"); });
$("#orbNewSession").addEventListener("click", () => createNewSession({ restore: false }));
$("#orbCommands").addEventListener("click", () => openCommands({ restore: true }));
$("#orbAttach").addEventListener("click", pickAttachments);
$("#edgeMode").addEventListener("click", (event) => { if (suppressCompactClick) event.preventDefault(); else setWindowMode("full"); });
for (const target of [$("#orbMode"), $("#edgeMode")]) {
  target.addEventListener("pointerdown", beginCompactDrag);
  target.addEventListener("pointermove", moveCompactDrag);
  target.addEventListener("pointerup", endCompactDrag);
  target.addEventListener("pointercancel", endCompactDrag);
}
$("#projectLink").addEventListener("click", () => window.widget.openProject());
$("#settingsButton").addEventListener("click", () => $("#settingsPanel").classList.toggle("open"));
$("#closeSettings").addEventListener("click", () => $("#settingsPanel").classList.remove("open"));
$("#topToggle").addEventListener("change", (event) => window.widget.setAlwaysOnTop(event.target.checked));
$("#autoStartToggle").addEventListener("change", async (event) => { event.target.checked = await window.widget.setAutoStart(event.target.checked); });
$("#opacityRange").addEventListener("input", async (event) => {
  const percent = Number(event.target.value);
  $("#opacityValue").textContent = `${percent}%`;
  await window.widget.setOpacity(percent / 100);
});
$$('#sizeSwitch button').forEach((button) => button.addEventListener("click", async () => {
  const value = await window.widget.setSize(button.dataset.size);
  $$('#sizeSwitch button').forEach((item) => item.classList.toggle("active", item.dataset.size === value));
}));

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
window.widget.onCompactSide((side) => applyCompactSide(side));
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
  $$('#sizeSwitch button').forEach((item) => item.classList.toggle("active", item.dataset.size === preferences.size));
  applyCompactSide(preferences.compactSide || "right");
  applyWindowMode(preferences.windowMode || "full");
});
window.widget.getAppInfo().then((info) => {
  $("#versionLabel").textContent = `v${info.version}`;
  $("#projectLink").title = `Open NeoXider/deepseek-harness-widget v${info.version} on GitHub`;
});

const launchParams = new URLSearchParams(location.search);
const requestedTab = launchParams.get("screenshotTab");
const screenshotFixture = launchParams.get("screenshotFixture");
if (requestedTab === "chat") setTab("chat");
setAvatar("idle");
renderNotifications();
renderAttachments();
renderMode();
if (!screenshotFixture) {
  refresh();
  setInterval(refresh, 2500);
}

if (screenshotFixture) {
  setTimeout(async () => {
    if (screenshotFixture === "overview") {
      setTab("agents");
      state.dashboard = {
        harness: true,
        sessions: [
          { sessionId: "demo-active", title: "NeuralNetLab experiment", running: true, projections: { values: { contextPressure: { projectedTokens: 32768, contextWindow: 131072 } } }, subagents: [{ kind: "child", activity: "running" }, { kind: "child", activity: "idle" }] },
          { sessionId: "demo-unity", title: "Unity gameplay pass", running: false, projections: { values: { contextPressure: { projectedTokens: 11800, contextWindow: 65536 } } }, subagents: [] },
          { sessionId: "demo-review", title: "Release verification", running: false, projections: { values: {} }, subagents: [{ kind: "child", activity: "idle" }] },
        ],
      };
      state.selectedSessionId = "demo-active";
      renderSessions();
    } else if (screenshotFixture === "chat") {
      setTab("chat");
      state.dashboard = { harness: true, sessions: [{ sessionId: "demo-chat", title: "Release verification", running: false, projections: { values: { contextPressure: { projectedTokens: 55296, contextWindow: 131072 } } }, subagents: [] }] };
      state.selectedSessionId = "demo-chat";
      $("#sessionButtonText").textContent = "Release verification";
      $("#controlsSummary").textContent = "LM Studio · Qwen 3.5 9B · Medium";
      renderContext();
      renderMessages([
        { role: "user", text: "Verify the compact widget and summarize the result." },
        { role: "reasoning", text: "I should inspect the layout, run the automated checks, and report only verified results.", html: "<p>I should inspect the layout, run the automated checks, and report only verified results.</p>" },
        { role: "assistant", text: "All checks passed.", html: "<p><strong>All checks passed.</strong></p><ul><li>No clipped controls</li><li>Markdown and tool calls render correctly</li><li>Compact modes snap to screen edges</li></ul>" },
      ]);
    } else if (screenshotFixture === "model") {
      setTab("chat");
      state.modelCatalog = {
        current: { provider: "lmstudio", model: "qwen3.5-9b", reasoningEffort: "medium" },
        groups: [
          { id: "lmstudio", name: "LM Studio", models: [{ id: "qwen3.5-9b", name: "Qwen 3.5 9B", reasoning: { defaultEffort: "medium", efforts: [{ id: "low", name: "Low" }, { id: "medium", name: "Medium" }, { id: "high", name: "High" }] } }, { id: "deepseek-r1", name: "DeepSeek R1 Distill" }] },
          { id: "deepseek", name: "DeepSeek", models: [{ id: "deepseek-chat", name: "DeepSeek Chat" }, { id: "deepseek-reasoner", name: "DeepSeek Reasoner" }] },
          { id: "openai", name: "OpenAI", models: [{ id: "gpt-5.6", name: "GPT-5.6" }, { id: "gpt-5.6-codex", name: "GPT-5.6 Codex" }] },
        ],
      };
      state.pendingSelection = state.modelCatalog.current;
      renderModels();
      $("#agentControls").open = true;
      togglePicker($("#modelButton"));
    } else if (screenshotFixture === "attachments") {
      setTab("chat");
      const paths = (launchParams.get("screenshotFiles") || "").split("|").filter(Boolean);
      if (paths.length) addAttachments(await window.widget.prepareFiles(paths));
    } else if (screenshotFixture === "thinking") {
      setTab("chat");
      setAvatar("working", "thinking");
      setActivity({ active: true, kind: "thinking", label: "Thinking", text: "Reviewing the workspace and preparing the next tool call…" });
    } else if (screenshotFixture === "writing") {
      setTab("chat");
      setAvatar("working", "writing");
      setActivity({ active: true, kind: "writing", label: "Writing", text: "Composing the answer in the mini-chat…" });
    } else if (screenshotFixture === "tool") {
      setTab("chat");
      setAvatar("working", "using tool");
      setActivity({ active: true, kind: "tool", label: "Using tool", text: "read_file" });
    } else if (screenshotFixture === "markdown-tools") {
      setTab("chat");
      renderMessages([
        { role: "assistant", text: "Result", html: "<h3>Workspace checked</h3><ul><li><strong>Build</strong> is clean</li><li>2 files inspected</li></ul><pre><code>npm test ✓</code></pre>" },
        { role: "tool", name: "read_file", arguments: "{\n  \"path\": \"src/main.cjs\"\n}", result: "Loaded 412 lines", status: "done", durationMs: 184 },
        { role: "tool", name: "run_tests", arguments: "{\n  \"suite\": \"widget\"\n}", result: "18 tests passed", status: "done", durationMs: 1260, nested: true },
      ]);
    }
  }, 700);
}
