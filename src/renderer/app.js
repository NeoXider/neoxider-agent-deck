const state = {
  dashboard: null,
  selectedSessionId: null,
  tab: "chat",
  focusMode: false,
  focusReturnTab: "chat",
  refreshing: false,
  historyBusy: false,
  modelsBusy: false,
  commandsBusy: false,
  modelCatalog: null,
  modelLoadState: "idle",
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
  compactNotification: null,
  compactNotificationTimer: null,
  compactStatusClosing: false,
  compactHistoryOpen: false,
  compactReplySessionId: null,
  commandSelectionIndex: 0,
  lastCommandQuery: "",
  queuedPromptsBySession: new Map(),
  nextQueuedPromptId: 1,
  queueEditingId: null,
  queueBusyId: null,
  liveStreamsBySession: new Map(),
  currentMessages: [],
  messagesStickToBottom: true,
  unseenMessages: 0,
  historySignature: "",
  harnessStarting: false,
  platformCapabilities: null,
  platformPresentation: null,
  pollTimer: null,
  pollInterval: 0,
};

let confirmedAutoStart = false;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function syncPressed(buttons, selectedValue, dataKey) {
  buttons.forEach((button) => {
    const selected = button.dataset[dataKey] === selectedValue;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}
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

function closePickers(except = null, { restoreFocus = false } = {}) {
  $$(".picker.open").forEach((picker) => {
    if (picker === except) return;
    const activeInside = picker.contains(document.activeElement);
    picker.classList.remove("open");
    const button = picker.querySelector(".picker-button");
    button?.setAttribute("aria-expanded", "false");
    picker.querySelector(".picker-menu")?.setAttribute("aria-hidden", "true");
    if (restoreFocus || activeInside) button?.focus();
  });
}

function togglePicker(button) {
  if (button.disabled) return;
  const picker = button.closest(".picker");
  const open = !picker.classList.contains("open");
  closePickers(open ? picker : null);
  picker.classList.toggle("open", open);
  button.setAttribute("aria-expanded", String(open));
  picker.querySelector(".picker-menu")?.setAttribute("aria-hidden", String(!open));
}

function pickerOption(label, { selected = false, meta = "", title = "", onSelect } = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `picker-option${selected ? " selected" : ""}`;
  button.title = title || label;
  button.setAttribute("role", "option");
  button.setAttribute("aria-selected", String(selected));
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

function compactPreviewEntry() {
  if (state.compactNotification) return state.compactNotification;
  if (state.compactHistoryOpen) {
    const sessions = state.dashboard?.sessions || [];
    const session = sessions.find((item) => item.sessionId === state.selectedSessionId)
      || [...sessions].sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))[0];
    if (session) return {
      kind: "history",
      sessionId: session.sessionId,
      title: session.title || "Current session",
      text: session.preview || "No assistant reply yet.",
    };
  }
  return null;
}

function syncCompactStatus() {
  const activity = state.currentActivity;
  const preview = compactPreviewEntry();
  const active = Boolean(state.compactStatusClosing || preview || activity?.active || ["working", "waiting", "error", "done"].includes(state.avatarMode));
  const label = preview?.title || activity?.label || AVATAR_LABELS[state.avatarMode] || "Ready";
  const text = compactText(preview?.text || activity?.text || $("#avatarState")?.textContent || label, 96);
  document.body.classList.toggle("orb-has-status", active);
  document.body.classList.toggle("orb-has-notification", preview?.kind === "notification");
  document.body.classList.toggle("orb-status-closing", state.compactStatusClosing);
  document.body.classList.toggle("orb-history-open", state.compactHistoryOpen);
  $("#orbStatusLabel").textContent = label;
  $("#orbStatusText").textContent = text;
  $("#orbStatus").disabled = !preview?.sessionId && !state.selectedSessionId;
  const compactButton = $("#orbHistoryButton");
  const replySession = state.dashboard?.sessions?.find((session) => session.sessionId === state.compactReplySessionId);
  const hasReplyTarget = Boolean(state.compactReplySessionId);
  const compactButtonLabel = hasReplyTarget
    ? (replySession?.title ? `Reply to ${replySession.title}` : "Reply in this session")
    : "Recent messages";
  compactButton.classList.toggle("active", state.compactHistoryOpen || hasReplyTarget);
  compactButton.setAttribute("aria-pressed", String(state.compactHistoryOpen));
  compactButton.title = compactButtonLabel;
  compactButton.setAttribute("aria-label", compactButtonLabel);
  compactButton.querySelector("use")?.setAttribute("href", hasReplyTarget ? "#icon-send" : "#icon-chat");
  window.widget.setCompactStatus({ active, label, text }).catch(() => {});
}

function syncActivityCard() {
  const activity = state.currentActivity;
  const card = $("#activityCard");
  const hasActivity = Boolean(activity?.text);
  const hasWritingBubble = activity?.kind === "writing" && Boolean($("#messages .live-assistant"));
  const showCard = hasActivity && !hasWritingBubble;
  card.classList.toggle("has-activity", showCard);
  if (hasActivity) {
    $("#activityLabel").textContent = activity.label || "Activity";
    $("#activityPreview").textContent = compactText(activity.text, 110);
    $("#activityBody").textContent = activity.text;
  }
}

function setActivity(activity) {
  state.currentActivity = activity || null;
  document.body.classList.remove("activity-thinking", "activity-writing", "activity-tool");
  if (activity?.active && ["thinking", "writing", "tool"].includes(activity.kind)) {
    document.body.classList.add(`activity-${activity.kind}`);
  }
  syncActivityCard();
  syncCompactStatus();
}

function setAvatar(mode, label) {
  state.avatarMode = mode;
  const shell = $("#avatarShell");
  shell.className = `avatar-shell ${mode}`;
  document.querySelectorAll("[data-avatar]").forEach((image) => { image.src = AVATARS[mode] || AVATARS.idle; });
  $("#avatarState").textContent = label === "" ? "" : (label || AVATAR_LABELS[mode] || "ready");
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

function notifyCompletion(session) {
  setAvatar("done");
  setActivity({ active: true, kind: "done", label: "Done", text: "Agent finished the current task." });
  if (state.windowMode !== "full") {
    state.compactReplySessionId = session?.sessionId || state.compactReplySessionId;
    state.compactNotification = {
      kind: "notification",
      sessionId: session?.sessionId || null,
      title: session?.title || "Agent finished",
      text: session?.preview || "A new reply is ready.",
    };
    clearTimeout(state.compactNotificationTimer);
    state.compactStatusClosing = false;
    state.compactNotificationTimer = setTimeout(() => {
      state.compactNotification = null;
      state.compactStatusClosing = !state.compactHistoryOpen;
      syncCompactStatus();
      if (state.compactStatusClosing) setTimeout(() => {
        state.compactStatusClosing = false;
        syncCompactStatus();
      }, 240);
    }, 2500);
    state.unread += 1;
    renderNotifications();
    window.widget.notifyAgentComplete();
    syncCompactStatus();
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
  if (mode !== "edge") window.widget.setEdgePointerActive(true);
  if (mode === "full") {
    state.unread = 0;
    renderNotifications();
  }
  syncCompactStatus();
}

async function setWindowMode(mode) {
  if (mode === "edge" && state.platformPresentation?.edgeAvailable === false) return state.windowMode;
  applyWindowMode(await window.widget.setWindowMode(mode));
  return state.windowMode;
}

function applyCompactSide(side) {
  document.body.classList.toggle("side-left", side === "left");
  document.body.classList.toggle("side-right", side !== "left");
}

let compactDrag = null;
let suppressCompactClick = false;
let fullDrag = null;
let suppressProjectClick = false;
let suppressProjectClickTimer = null;
let edgePointerActive = false;
const EDGE_HIT_PADDING = 5;

function setEdgePointerActive(active) {
  const next = state.windowMode === "edge" && Boolean(active);
  if (edgePointerActive === next) return;
  edgePointerActive = next;
  $("#edgeMode").classList.toggle("edge-hit-active", next);
  window.widget.setEdgePointerActive(next);
}

function updateEdgePointerHit(event) {
  if (state.windowMode !== "edge") return;
  if (compactDrag) {
    setEdgePointerActive(true);
    return;
  }
  const line = $("#edgeMode .edge-line");
  const rect = line.getBoundingClientRect();
  const hit = event.clientX >= rect.left - EDGE_HIT_PADDING
    && event.clientX <= rect.right + EDGE_HIT_PADDING
    && event.clientY >= rect.top - EDGE_HIT_PADDING
    && event.clientY <= rect.bottom + EDGE_HIT_PADDING;
  setEdgePointerActive(hit);
}

function suppressBrandClickAfterDrag() {
  suppressProjectClick = true;
  clearTimeout(suppressProjectClickTimer);
  suppressProjectClickTimer = setTimeout(() => { suppressProjectClick = false; }, 1200);
}

function beginFullDrag(event) {
  if (event.button !== 0 || state.platformPresentation?.positionAvailable === false) return;
  fullDrag = {
    target: event.currentTarget,
    // Pointer capture retargets the follow-up click to the capturing element, so a
    // tap on a child button never reaches that button's own click handler. Remember
    // where the gesture started and resolve the tap in endFullDrag instead.
    origin: event.target,
    pointerId: event.pointerId,
    startX: event.screenX,
    startY: event.screenY,
    moved: false,
  };
  event.currentTarget.setPointerCapture?.(event.pointerId);
  window.widget.beginFullDrag({ x: event.screenX, y: event.screenY });
}

function moveFullDrag(event) {
  if (!fullDrag || fullDrag.pointerId !== event.pointerId) return;
  if (!fullDrag.moved && Math.hypot(event.screenX - fullDrag.startX, event.screenY - fullDrag.startY) < 4) return;
  fullDrag.moved = true;
  suppressBrandClickAfterDrag();
  event.preventDefault();
  window.widget.moveFullDrag({ x: event.screenX, y: event.screenY });
}

function endFullDrag(event) {
  if (!fullDrag || fullDrag.pointerId !== event.pointerId) return;
  const moved = fullDrag.moved;
  const origin = fullDrag.origin;
  fullDrag.target.releasePointerCapture?.(event.pointerId);
  fullDrag = null;
  if (moved) {
    event.preventDefault();
    suppressBrandClickAfterDrag();
  } else {
    activateBrandTarget(origin);
  }
  window.widget.endFullDrag().catch(() => null);
}

// A tap that never turned into a drag still has to do what the button says.
function activateBrandTarget(origin) {
  if (!origin || typeof origin.closest !== "function") return;
  if (origin.closest("#avatarButton")) setWindowMode("orb");
  else if (origin.closest("#projectLink")) window.widget.openProject();
}

function beginCompactDrag(event) {
  if (event.button !== 0 || state.platformPresentation?.positionAvailable === false || event.target.closest("#orbStatus, #orbHistoryButton")) return;
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
  // The click event fires synchronously right after pointerup, long before this IPC
  // round trip resolves. Arming the guard after the await let every drag release
  // fall through to the click handler and restore the full widget.
  if (moved) {
    event.preventDefault();
    suppressCompactClick = true;
  }
  const result = await window.widget.endCompactDrag().catch(() => null);
  if (!moved) return;
  if (result?.side) applyCompactSide(result.side);
  if (state.windowMode === "edge") setEdgePointerActive(false);
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
  meter.classList.toggle("unavailable", !pressure);
  $("#chatForm").classList.toggle("context-unavailable", !pressure);
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
    empty.textContent = state.dashboard?.harness ? "No sessions yet. Start one in chat." : "Start Harness to load sessions.";
    root.append(empty);
    return;
  }
  for (const session of sessions) {
    const agentState = ["working", "error"].includes(session.state)
      ? session.state
      : (session.running ? "working" : "idle");
    const card = document.createElement("div");
    card.className = `session-card state-${agentState}${session.sessionId === state.selectedSessionId ? " selected" : ""}`;
    const avatar = document.createElement("div");
    avatar.className = `agent-avatar ${agentState}`;
    const avatarImage = document.createElement("img");
    avatarImage.src = AVATARS[agentState] || AVATARS.idle;
    avatarImage.alt = "";
    avatar.append(avatarImage);
    const main = document.createElement("div");
    main.className = "session-main";
    const name = document.createElement("div");
    name.className = "session-name";
    name.textContent = session.title || "New session";
    const meta = document.createElement("div");
    meta.className = "session-meta";
    const childCount = (session.subagents || []).filter((item) => item.kind === "child").length;
    const pressure = contextPressure(session);
    meta.textContent = `${agentState}${childCount ? ` · ${childCount} subagent${childCount === 1 ? "" : "s"}` : ""}${pressure ? ` · ${Math.round(pressure.percent)}% ctx` : ""}`;
    main.append(name, meta);
    const status = document.createElement("div");
    status.className = `session-state ${agentState}`;
    status.textContent = agentState;
    card.append(avatar, main, status);
    card.addEventListener("click", () => selectSession(session.sessionId, true));
    root.append(card);
  }
}

function renderSessionSelect() {
  const sessions = state.dashboard?.sessions || [];
  const selected = sessions.find((session) => session.sessionId === state.selectedSessionId);
  $("#openSessionButton").disabled = !state.selectedSessionId;
  $("#openSessionButton").title = selected
    ? `Open ${selected.title || "current session"} in DeepSeek Harness`
    : "Select a session to open it in DeepSeek Harness";
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
  if (!selection) return "Automatic route";
  const group = state.modelCatalog?.groups?.find((item) => item.id === selection.provider);
  const model = group?.models?.find((item) => item.id === selection.model);
  return `${group?.name || selection.provider} · ${model?.name || selection.model}`;
}

function modelCount(catalog = state.modelCatalog) {
  return (catalog?.groups || []).reduce((total, group) => total + (group.models || []).length, 0);
}

function appendModelPickerStatus(root, kind, title, text, actions = []) {
  const status = document.createElement("div");
  status.className = `model-picker-status ${kind}`;
  const heading = document.createElement("b");
  heading.textContent = title;
  const detail = document.createElement("small");
  detail.textContent = text;
  status.append(heading, detail);
  if (actions.length) {
    const buttons = document.createElement("div");
    buttons.className = "model-picker-actions";
    for (const action of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = action.label;
      button.addEventListener("click", action.onClick);
      buttons.append(button);
    }
    status.append(buttons);
  }
  root.append(status);
}

function retryModels() {
  return loadModels({ force: true });
}

function updateControlsSummary() {
  const selection = state.pendingSelection || state.modelCatalog?.current;
  const model = selectedModelDefinition();
  let shortModel = model?.name || model?.id || selection?.model || "Auto";
  if (state.modelLoadState === "loading") shortModel = "Loading…";
  else if (["error", "ready"].includes(state.modelLoadState) && !modelCount()) shortModel = "No model";
  const effort = $("#reasoningButtonText")?.textContent || "Auto";
  $("#controlsPrimary").textContent = shortModel;
  $("#controlsSummary").textContent = `${shortModel} · ${effort}`;
  const summary = $("#agentControls > summary");
  const fullLabel = `${modelDisplay(selection)} · ${effort}`;
  summary.title = `Model / Setup: ${fullLabel}`;
  summary.setAttribute("aria-label", `Model and agent setup: ${fullLabel}`);
}

function renderModelOptions(query = "") {
  const root = $("#modelOptions");
  const statusRoot = $("#modelStatus");
  root.replaceChildren();
  statusRoot.replaceChildren();
  const catalog = state.modelCatalog;
  const selected = state.pendingSelection || catalog?.current;
  const normalized = query.trim().toLowerCase();
  if (state.modelLoadState === "loading") {
    appendModelPickerStatus(statusRoot, "loading", "Loading model providers", "Reading the routes exposed by Harness…");
    return;
  }
  if (state.modelLoadState === "error") {
    appendModelPickerStatus(statusRoot, "error", "Models unavailable", "Check Harness and your provider, then retry.", [
      { label: "Retry", onClick: retryModels },
      { label: "Open Harness", onClick: () => window.widget.openHarness() },
    ]);
    if (!modelCount(catalog)) return;
  }
  if (!modelCount(catalog)) {
    appendModelPickerStatus(statusRoot, "empty", "No models loaded", "Load a model in LM Studio or another Harness provider, then retry.", [
      { label: "Retry", onClick: retryModels },
      { label: "Open Harness", onClick: () => window.widget.openHarness() },
    ]);
    return;
  }
  root.append(pickerOption("Automatic route", {
    selected: !selected,
    meta: "Harness",
    onSelect: () => {
      state.pendingSelection = null;
      closePickers();
      renderModels();
    },
  }));
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
  let label = modelDisplay(selected);
  if (state.modelLoadState === "loading") label = "Loading providers…";
  else if (state.modelLoadState === "error" && !modelCount(catalog)) label = "Models unavailable";
  else if (!modelCount(catalog)) label = "No models loaded";
  $("#modelButtonText").textContent = label;
  $("#modelButton").title = `Model: ${label}`;
  $("#modelButton").setAttribute("aria-label", `Model: ${label}`);
  renderModelOptions($("#modelSearch").value || "");
  renderReasoning();
  updateControlsSummary();
}

async function loadModels({ force = false } = {}) {
  if (state.modelsBusy) return;
  if (!state.dashboard?.harness) {
    if (force) {
      state.modelLoadState = "error";
      renderModels();
    }
    return;
  }
  state.modelsBusy = true;
  state.modelLoadState = "loading";
  renderModels();
  try {
    state.modelCatalog = await window.widget.models(state.selectedSessionId);
    state.pendingSelection = state.modelCatalog.current || state.pendingSelection;
    state.modelLoadState = "ready";
  } catch {
    state.modelLoadState = "error";
    setAvatar("error", "models unavailable");
  } finally {
    state.modelsBusy = false;
    renderModels();
  }
}

function commandQuery() {
  return /^\/([^\s]*)$/.exec($("#messageInput").value)?.[1]?.toLowerCase() || "";
}

function filteredCommands(query = "") {
  const normalized = String(query || "").trim().toLowerCase();
  if (!normalized) return state.commandCatalog;
  return state.commandCatalog.filter((command) => `${command.name} ${command.description || ""}`.toLowerCase().includes(normalized));
}

function setCommandMenuOpen(open) {
  const root = $("#commandMenu");
  root.classList.toggle("open", Boolean(open));
  root.setAttribute("aria-hidden", String(!open));
  $("#commandsButton").setAttribute("aria-expanded", String(Boolean(open)));
}

function chooseCommand(command) {
  if (!command) return;
  const input = $("#messageInput");
  input.value = `/${command.name}${command.input?.hint ? " " : ""}`;
  input.placeholder = command.input?.hint || "Run Harness command…";
  state.commandSelectionIndex = 0;
  state.lastCommandQuery = "";
  setCommandMenuOpen(false);
  input.focus();
}

function renderCommands(query = commandQuery()) {
  const root = $("#commandMenu");
  root.replaceChildren();
  const normalized = String(query || "").toLowerCase();
  if (normalized !== state.lastCommandQuery) {
    state.commandSelectionIndex = 0;
    state.lastCommandQuery = normalized;
  }
  const commands = filteredCommands(normalized);
  state.commandSelectionIndex = Math.min(state.commandSelectionIndex, Math.max(0, commands.length - 1));

  const head = document.createElement("div");
  head.className = "command-menu-head";
  head.append(createIcon("command"));
  const title = document.createElement("b");
  title.textContent = "Harness commands";
  const meta = document.createElement("small");
  meta.textContent = `${commands.length} shown · ↑↓ select`;
  head.append(title, meta);
  root.append(head);

  const options = document.createElement("div");
  options.className = "command-options";
  if (!commands.length) {
    const empty = document.createElement("div");
    empty.className = "command-empty";
    empty.textContent = state.commandsBusy ? "Loading commands…" : "No matching commands";
    options.append(empty);
  }
  for (const [index, command] of commands.entries()) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `command-row${index === state.commandSelectionIndex ? " selected" : ""}`;
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", String(index === state.commandSelectionIndex));
    row.dataset.command = command.name;
    const name = document.createElement("span");
    name.className = "command-name";
    name.textContent = `/${command.name}`;
    const hint = document.createElement("span");
    hint.className = "command-hint";
    hint.textContent = command.input?.hint || "run now";
    const description = document.createElement("span");
    description.className = "command-description";
    description.textContent = command.description || command.name;
    row.append(name, hint, description);
    row.addEventListener("pointerenter", () => {
      state.commandSelectionIndex = index;
      options.querySelectorAll(".command-row").forEach((item, itemIndex) => {
        const selected = itemIndex === index;
        item.classList.toggle("selected", selected);
        item.setAttribute("aria-selected", String(selected));
      });
    });
    row.addEventListener("click", () => chooseCommand(command));
    options.append(row);
  }
  root.append(options);
}

function queuedPromptsFor(sessionId = state.selectedSessionId) {
  return sessionId ? state.queuedPromptsBySession.get(sessionId) || [] : [];
}

function queueActionButton(icon, title, className, onClick, disabled = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `queue-action ${className || ""}`.trim();
  button.title = title;
  button.setAttribute("aria-label", title);
  button.disabled = disabled;
  button.append(createIcon(icon));
  button.addEventListener("click", onClick);
  return button;
}

async function updateQueuedPrompt(item, action) {
  if (!state.selectedSessionId || !item?.id || item.optimistic) return;
  state.queueBusyId = item.id;
  renderQueuedPrompts();
  try {
    await window.widget.updateQueue({ sessionId: state.selectedSessionId, itemId: item.id, action });
    const items = queuedPromptsFor();
    if (["remove", "steer"].includes(action.kind)) {
      state.queuedPromptsBySession.set(state.selectedSessionId, items.filter((entry) => entry.id !== item.id));
    } else if (action.kind === "edit") {
      state.queuedPromptsBySession.set(state.selectedSessionId, items.map((entry) => entry.id === item.id
        ? { ...entry, text: action.text, preview: action.text }
        : entry));
    }
    state.queueEditingId = null;
  } catch (error) {
    showError(error);
    setAvatar("error", "queue error");
  } finally {
    state.queueBusyId = null;
    renderQueuedPrompts();
  }
}

function renderQueuedPrompts() {
  const root = $("#queueDock");
  const listRoot = $("#queueList");
  const items = queuedPromptsFor();
  root.classList.toggle("has-items", items.length > 0);
  root.setAttribute("aria-label", `${items.length} queued message${items.length === 1 ? "" : "s"}`);
  listRoot.replaceChildren();
  for (const [index, item] of items.entries()) {
    const row = document.createElement("div");
    row.className = "queue-row";
    row.dataset.queueId = item.id;
    const position = document.createElement("span");
    position.className = "queue-position";
    position.textContent = String(index + 1);
    position.title = "Queued in Harness";
    row.append(position);
    const editing = state.queueEditingId === item.id;
    const busy = state.queueBusyId === item.id;
    const actions = document.createElement("span");
    actions.className = "queue-actions";
    if (editing) {
      const input = document.createElement("input");
      input.className = "queue-edit-input";
      input.value = item.text || "";
      input.setAttribute("aria-label", "Edit queued message");
      const save = () => {
        const text = input.value.trim();
        if (text) updateQueuedPrompt(item, { kind: "edit", text });
      };
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") { event.preventDefault(); save(); }
        if (event.key === "Escape") { state.queueEditingId = null; renderQueuedPrompts(); }
      });
      actions.append(
        queueActionButton("check", "Save queued message", "steer", save, busy),
        queueActionButton("close", "Cancel editing", "", () => { state.queueEditingId = null; renderQueuedPrompts(); }, busy),
      );
      row.append(input, actions);
      requestAnimationFrame(() => { input.focus(); input.select(); });
    } else {
      const preview = document.createElement("span");
      preview.className = "queue-preview";
      preview.textContent = compactText(item.preview || item.text || `${item.attachmentCount || 1} attachment${item.attachmentCount === 1 ? "" : "s"}`, 110);
      actions.append(
        queueActionButton("edit", "Edit queued message", "", () => { state.queueEditingId = item.id; renderQueuedPrompts(); }, busy || item.optimistic || item.text === null),
        queueActionButton("trash", "Delete queued message", "danger", () => updateQueuedPrompt(item, { kind: "remove" }), busy || item.optimistic),
        queueActionButton("send", "Send now", "steer", () => updateQueuedPrompt(item, { kind: "steer" }), busy || item.optimistic),
      );
      row.append(preview, actions);
    }
    listRoot.append(row);
  }
}

function trackQueuedPrompt(sessionId, { text, attachmentCount = 0 }) {
  if (!sessionId) return;
  const items = queuedPromptsFor(sessionId);
  state.queuedPromptsBySession.set(sessionId, [...items, {
    id: `local-${state.nextQueuedPromptId++}`,
    text: text || null,
    preview: text || `${attachmentCount} attachment${attachmentCount === 1 ? "" : "s"}`,
    attachmentCount,
    acceptedAt: Date.now(),
    optimistic: true,
  }]);
  renderQueuedPrompts();
}

async function loadQueue(sessionId = state.selectedSessionId) {
  if (!sessionId) return;
  try {
    const items = await window.widget.getQueue(sessionId);
    state.queuedPromptsBySession.set(sessionId, Array.isArray(items) ? items : []);
    if (sessionId === state.selectedSessionId) renderQueuedPrompts();
  } catch {}
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
  state.messagesStickToBottom = true;
  state.unseenMessages = 0;
  state.historySignature = "";
  state.pendingSelection = null;
  state.modelCatalog = null;
  state.modelLoadState = "idle";
  state.commandCatalog = [];
  state.selectedWorkspaceId = state.dashboard?.sessions?.find((item) => item.sessionId === sessionId)?.workspaceId || null;
  renderSessions();
  renderSessionSelect();
  renderContext();
  renderWorkspaces();
  renderQueuedPrompts();
  if (openChat) setTab("chat");
  await Promise.all([refreshHistory(), loadModels(), loadCommands(), loadWorkspaces(), loadQueue(sessionId)]);
}

function createToolCard(message) {
  const details = document.createElement("details");
  details.className = `tool-call${message.isError ? " failed" : ""}${message.nested ? " nested" : ""}`;
  details.dataset.toolKey = `tool:${message.callId || message.seq || `${message.name || "tool"}:${message.arguments || ""}`}`;
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
  return details;
}

function appendActivityRun(root, run) {
  const toolCount = run.length;
  if (toolCount === 1) {
    root.append(createToolCard(run[0]));
    return;
  }
  const failed = run.some((message) => message.isError);
  const running = run.some((message) => message.status === "running");
  const group = document.createElement("details");
  group.className = `tool-group${failed ? " failed" : ""}${running ? " running" : ""}`;
  group.dataset.toolKey = `group:${run.map((message) => message.callId || message.seq || message.name || "tool").join("|")}`;
  const summary = document.createElement("summary");
  summary.append(createIcon("command"));
  const identity = document.createElement("span");
  identity.className = "tool-group-identity";
  const label = document.createElement("b");
  label.textContent = `${toolCount} ${toolCount === 1 ? "tool" : "tools"}`;
  const meta = document.createElement("small");
  meta.textContent = running ? "running" : failed ? "failed" : "completed";
  identity.append(label, meta);
  summary.append(identity, createIcon("chevron", "ui-icon tool-chevron"));
  const body = document.createElement("div");
  body.className = "tool-group-body";
  for (const message of run) body.append(createToolCard(message));
  group.append(summary, body);
  root.append(group);
}

function messagesNearBottom(root = $("#messages")) {
  return root.scrollHeight - root.scrollTop - root.clientHeight < 44;
}

function liveAssistantSnapshot() {
  const stream = state.liveStreamsBySession.get(state.selectedSessionId);
  if (stream?.text) return { text: stream.text, lastSeq: stream.lastSeq || "" };
  const activity = state.currentActivity;
  if (activity?.active && activity.kind === "writing" && activity.text) {
    return { text: activity.text, lastSeq: "activity" };
  }
  return null;
}

function messageTextOffset(root, node, offset) {
  if (!node || !root.contains(node)) return null;
  const range = document.createRange();
  range.selectNodeContents(root);
  try {
    range.setEnd(node, offset);
  } catch {
    return null;
  }
  return range.toString().length;
}

function captureMessageSelection(root) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return null;
  const anchor = messageTextOffset(root, selection.anchorNode, selection.anchorOffset);
  const focus = messageTextOffset(root, selection.focusNode, selection.focusOffset);
  return anchor === null || focus === null ? null : { anchor, focus };
}

function messageTextPoint(root, requestedOffset) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, Number(requestedOffset) || 0);
  let node = walker.nextNode();
  let last = null;
  while (node) {
    last = node;
    if (remaining <= node.data.length) return { node, offset: remaining };
    remaining -= node.data.length;
    node = walker.nextNode();
  }
  return last ? { node: last, offset: last.data.length } : null;
}

function restoreMessageSelection(root, snapshot) {
  if (!snapshot) return;
  const anchor = messageTextPoint(root, snapshot.anchor);
  const focus = messageTextPoint(root, snapshot.focus);
  if (!anchor || !focus) return;
  const selection = window.getSelection();
  selection.removeAllRanges();
  if (typeof selection.setBaseAndExtent === "function") {
    selection.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
    return;
  }
  const range = document.createRange();
  const [start, end] = snapshot.anchor <= snapshot.focus ? [anchor, focus] : [focus, anchor];
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  selection.addRange(range);
}

function openToolKeys(root) {
  return new Set($$("details.tool-group[open], details.tool-call[open]")
    .filter((details) => root.contains(details))
    .map((details) => details.dataset.toolKey)
    .filter(Boolean));
}

function restoreOpenToolKeys(root, keys) {
  if (!keys.size) return;
  root.querySelectorAll("details.tool-group, details.tool-call").forEach((details) => {
    if (keys.has(details.dataset.toolKey)) details.open = true;
  });
}

function updateScrollLatestButton() {
  const button = $("#scrollLatestButton");
  const visible = !state.messagesStickToBottom && state.unseenMessages > 0;
  button.hidden = !visible;
  $("#scrollLatestCount").textContent = state.unseenMessages > 1 ? `${state.unseenMessages} new` : "New";
}

function appendLiveAssistant(root) {
  const stream = liveAssistantSnapshot();
  if (!stream?.text) return;
  const bubble = document.createElement("div");
  bubble.className = "bubble assistant plain live-assistant";
  bubble.dataset.liveSeq = String(stream.lastSeq || "");
  bubble.textContent = stream.text;
  root.append(bubble);
}

function openModelPicker({ retry = false } = {}) {
  setTab("chat");
  $("#agentControls").open = true;
  const button = $("#modelButton");
  const picker = button.closest(".picker");
  closePickers(picker);
  picker.classList.add("open");
  button.setAttribute("aria-expanded", "true");
  if (retry) retryModels();
  setTimeout(() => $("#modelSearch").focus(), 0);
}

function modelOptionButtons() {
  return $$("#modelOptions .picker-option:not(:disabled)");
}

function moveModelOptionFocus(key) {
  const options = modelOptionButtons();
  if (!options.length) return false;
  const current = options.indexOf(document.activeElement);
  const selected = options.findIndex((option) => option.getAttribute("aria-selected") === "true");
  let index;
  if (key === "Home") index = 0;
  else if (key === "End") index = options.length - 1;
  else if (key === "ArrowUp") index = current >= 0 ? Math.max(0, current - 1) : Math.max(0, selected);
  else index = current >= 0 ? Math.min(options.length - 1, current + 1) : Math.max(0, selected);
  options[index].focus();
  return true;
}

function setSettingsOpen(open, { restoreFocus = true } = {}) {
  const panel = $("#settingsPanel");
  const next = Boolean(open);
  const activeInside = panel.contains(document.activeElement);
  panel.classList.toggle("open", next);
  panel.inert = !next;
  panel.setAttribute("aria-hidden", String(!next));
  $("#settingsButton").setAttribute("aria-expanded", String(next));
  if (next) requestAnimationFrame(() => $("#closeSettings").focus());
  else if (restoreFocus && activeInside) $("#settingsButton").focus();
}

function trapSettingsFocus(event) {
  const panel = $("#settingsPanel");
  if (event.key !== "Tab" || !panel.classList.contains("open")) return false;
  const focusable = [...panel.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])')]
    .filter((element) => !element.inert && element.getClientRects().length);
  if (!focusable.length) return false;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
    event.preventDefault();
    last.focus();
    return true;
  }
  if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) {
    event.preventDefault();
    first.focus();
    return true;
  }
  return false;
}

function isMissingModelError(value) {
  return /no models? (?:are )?loaded|no model (?:is )?(?:loaded|available)|model provider.*unavailable/i.test(String(value || ""));
}

function createModelSetupCard() {
  const card = document.createElement("div");
  card.className = "bubble error model-setup-card";
  const heading = document.createElement("b");
  heading.textContent = "No model is ready";
  const detail = document.createElement("span");
  detail.textContent = "Load a model in LM Studio or another Harness provider, then choose it or retry.";
  const actions = document.createElement("div");
  actions.className = "model-setup-actions";
  const choose = document.createElement("button");
  choose.type = "button";
  choose.textContent = "Choose model";
  choose.addEventListener("click", () => openModelPicker());
  const retry = document.createElement("button");
  retry.type = "button";
  retry.textContent = "Retry models";
  retry.addEventListener("click", () => openModelPicker({ retry: true }));
  actions.append(choose, retry);
  card.append(heading, detail, actions);
  return card;
}

function renderMessages(messages) {
  const root = $("#messages");
  const previousTop = root.scrollTop;
  const wasPinned = state.messagesStickToBottom;
  state.currentMessages = Array.isArray(messages) ? messages : [];
  const liveAssistant = liveAssistantSnapshot();
  const signature = `${state.selectedSessionId || "new"}::${state.currentMessages.map((message) => JSON.stringify([
    message.role,
    message.seq || "",
    message.callId || "",
    message.status || "",
    Boolean(message.isError),
    message.text || "",
    message.arguments || "",
    message.result || "",
  ])).join("|")}::${liveAssistant?.text || ""}`;
  const previousSignature = state.historySignature;
  const changed = Boolean(previousSignature && signature !== previousSignature);
  const unchanged = root.dataset.rendered === "true" && signature === previousSignature;
  state.historySignature = signature;
  if (unchanged) {
    syncActivityCard();
    updateScrollLatestButton();
    return false;
  }
  const expandedTools = openToolKeys(root);
  const selection = captureMessageSelection(root);
  root.replaceChildren();
  root.dataset.rendered = "true";
  if (!state.currentMessages.length && !liveAssistant?.text) {
    root.innerHTML = '<div class="empty-state">Write a message — the widget will create a session.</div>';
    syncActivityCard();
    updateScrollLatestButton();
    return true;
  }
  let modelSetupShown = false;
  for (let index = 0; index < state.currentMessages.length;) {
    const message = state.currentMessages[index];
    if (message.role === "reasoning") {
      index += 1;
      continue;
    }
    if (message.role === "tool") {
      const run = [];
      while (index < state.currentMessages.length && state.currentMessages[index].role === "tool") run.push(state.currentMessages[index++]);
      appendActivityRun(root, run);
      continue;
    }
    if (["assistant", "error"].includes(message.role) && isMissingModelError(message.text)) {
      if (!modelSetupShown) root.append(createModelSetupCard());
      modelSetupShown = true;
      index += 1;
      continue;
    }
    const bubble = document.createElement("div");
    bubble.className = `bubble ${message.role}`;
    if (message.html) bubble.innerHTML = message.html;
    else { bubble.classList.add("plain"); bubble.textContent = message.text; }
    root.append(bubble);
    index += 1;
  }
  appendLiveAssistant(root);
  restoreOpenToolKeys(root, expandedTools);
  if (wasPinned) {
    root.scrollTop = root.scrollHeight;
    state.unseenMessages = 0;
  } else {
    root.scrollTop = Math.min(previousTop, Math.max(0, root.scrollHeight - root.clientHeight));
    if (changed) state.unseenMessages = 1;
  }
  restoreMessageSelection(root, selection);
  syncActivityCard();
  updateScrollLatestButton();
  return true;
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
    setActivity(view.activity || null);
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

function updateLiveSessionState(sessionId, running, activity = null, stateName = null) {
  const session = state.dashboard?.sessions?.find((item) => item.sessionId === sessionId);
  if (session) {
    session.running = Boolean(running);
    session.activity = activity;
    if (stateName) session.state = stateName;
  }
  if (running) state.runningSessionIds.add(sessionId);
  else state.runningSessionIds.delete(sessionId);
  renderSessions();
  renderSessionSelect();
}

async function handleLiveEvent(payload) {
  const sessionId = payload?.sessionId;
  const event = payload?.event;
  if (!sessionId || !event?.type) return;
  let stream = state.liveStreamsBySession.get(sessionId) || { text: "", reasoning: "", lastSeq: 0 };
  if (Number(event.seq) && Number(event.seq) <= Number(stream.lastSeq)) return;
  if (Number(event.seq)) stream.lastSeq = Number(event.seq);

  if (event.type === "turn/start") {
    stream = { text: "", reasoning: "", lastSeq: Number(event.seq) || 0 };
    state.liveStreamsBySession.set(sessionId, stream);
    const activity = { active: true, kind: "thinking", label: "Thinking", text: "Preparing the next step…" };
    updateLiveSessionState(sessionId, true, activity, "working");
    if (sessionId === state.selectedSessionId) {
      setAvatar("working", "thinking");
      setActivity(activity);
      renderMessages(state.currentMessages);
    }
    return;
  }

  if (event.type === "assistant/chunk") {
    const chunk = event.data?.chunk || {};
    if (chunk.type === "reasoning-delta" && chunk.text) {
      stream.reasoning += chunk.text;
      state.liveStreamsBySession.set(sessionId, stream);
      const activity = { active: true, kind: "thinking", label: "Thinking", text: stream.reasoning.trim() };
      updateLiveSessionState(sessionId, true, activity, "working");
      if (sessionId === state.selectedSessionId) {
        setAvatar("working", "thinking");
        setActivity(activity);
      }
    } else if (chunk.type === "text-delta" && chunk.text) {
      stream.text += chunk.text;
      state.liveStreamsBySession.set(sessionId, stream);
      const activity = { active: true, kind: "writing", label: "Writing", text: stream.text };
      updateLiveSessionState(sessionId, true, activity, "working");
      if (sessionId === state.selectedSessionId) {
        setAvatar("working", "writing");
        setActivity(activity);
        renderMessages(state.currentMessages);
      }
    }
    return;
  }

  if (event.type === "tool/call") {
    const activity = { active: true, kind: "tool", label: "Using tool", text: event.data?.name || "tool" };
    updateLiveSessionState(sessionId, true, activity, "working");
    if (sessionId === state.selectedSessionId) {
      setAvatar("working", "using tool");
      setActivity(activity);
    }
    return;
  }

  if (event.type === "turn/end") {
    const failed = event.data?.reason?.kind === "error";
    updateLiveSessionState(sessionId, false, null, failed ? "error" : "idle");
    if (sessionId === state.selectedSessionId) {
      if (failed) {
        setAvatar("error", "model error");
        setActivity({ active: true, kind: "error", label: "Turn failed", text: "The current Harness turn ended with an error." });
      } else {
        setAvatar("done", "done");
        setActivity(null);
      }
      setTimeout(async () => {
        await refreshHistory();
        state.liveStreamsBySession.delete(sessionId);
        renderMessages(state.currentMessages);
      }, 90);
    } else {
      state.liveStreamsBySession.delete(sessionId);
    }
  }
}

function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll(".tab").forEach((button) => {
    const selected = button.dataset.tab === tab;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  const agents = $("#agentsPanel");
  const chat = $("#chatPanel");
  agents.classList.toggle("active", tab === "agents");
  agents.hidden = tab !== "agents";
  chat.classList.toggle("active", tab === "chat");
  chat.hidden = tab !== "chat";
  if (tab === "chat") Promise.all([refreshHistory(), loadModels(), loadCommands()]);
}

function setFocusMode(enabled) {
  const next = Boolean(enabled);
  if (next && !state.focusMode) state.focusReturnTab = state.tab;
  state.focusMode = next;
  if (next) {
    if (state.tab !== "chat") setTab("chat");
    $("#agentControls").open = false;
    setSettingsOpen(false, { restoreFocus: false });
    $("#commandMenu").classList.remove("open");
    closePickers();
  } else if (state.focusReturnTab !== "chat") {
    setTab(state.focusReturnTab);
  }
  document.body.classList.toggle("focus-chat", next);
  const button = $("#focusChatButton");
  button.classList.toggle("active", next);
  button.setAttribute("aria-pressed", String(next));
  button.title = next ? "Show full interface" : "Focus chat";
  button.setAttribute("aria-label", button.title);
}

function toggleCompactHistory() {
  state.compactHistoryOpen = !state.compactHistoryOpen;
  if (state.compactHistoryOpen) state.compactNotification = null;
  syncCompactStatus();
}

async function openCompactSession() {
  const entry = compactPreviewEntry();
  const sessionId = entry?.sessionId || state.selectedSessionId;
  if (!sessionId) return;
  state.compactNotification = null;
  state.compactStatusClosing = false;
  state.compactHistoryOpen = false;
  clearTimeout(state.compactNotificationTimer);
  await setWindowMode("full");
  await selectSession(sessionId, true);
  if (state.compactReplySessionId === sessionId) state.compactReplySessionId = null;
  $("#messageInput")?.focus();
  syncCompactStatus();
}

async function openCompactReplySession() {
  const sessionId = state.compactReplySessionId || state.compactNotification?.sessionId;
  if (!sessionId) return;
  state.compactNotification = null;
  state.compactStatusClosing = false;
  state.compactHistoryOpen = false;
  clearTimeout(state.compactNotificationTimer);
  await setWindowMode("full");
  await selectSession(sessionId, true);
  state.compactReplySessionId = null;
  syncCompactStatus();
  requestAnimationFrame(() => $("#messageInput")?.focus());
}

function detectCompletedSessions(nextSessions) {
  const currentRunning = new Set(nextSessions.filter((session) => session.running).map((session) => session.sessionId));
  if (state.dashboardInitialized) {
    const existing = new Set(nextSessions.map((session) => session.sessionId));
    for (const sessionId of state.runningSessionIds) {
      if (!currentRunning.has(sessionId) && existing.has(sessionId)) {
        notifyCompletion(nextSessions.find((session) => session.sessionId === sessionId));
      }
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
    syncCompactStatus();
    if (!dashboard.harness && state.focusMode) setFocusMode(false);
    if (state.selectedSessionId && !dashboard.sessions?.some((session) => session.sessionId === state.selectedSessionId)) state.selectedSessionId = null;
    if (!state.selectedSessionId && dashboard.sessions?.length) {
      state.selectedSessionId = (dashboard.sessions.find((session) => session.running) || dashboard.sessions[0]).sessionId;
    }
    $("#offlineBanner").classList.toggle("show", !dashboard.harness);
    if (dashboard.harness && !state.harnessStarting) {
      $("#offlineBannerText").textContent = "Harness is offline";
      $("#startHarnessButton").textContent = "Start";
      $("#startHarnessButton").disabled = false;
    }
    const selectedSession = dashboard.sessions?.find((session) => session.sessionId === state.selectedSessionId);
    const selectedRunning = Boolean(selectedSession?.running);
    $("#chatForm").classList.toggle("has-running", selectedRunning);
    $("#cancelButton").hidden = !selectedRunning;
    if (!dashboard.harness) setAvatar("error", "");
    else if (dashboard.sessions?.some((session) => session.running)) {
      const running = selectedSession?.running ? selectedSession : dashboard.sessions.find((session) => session.running);
      if (running?.activity) setActivity(running.activity);
      else setActivity({ active: true, kind: "working", label: "Working", text: "Agent is processing the current turn…" });
      setAvatar("working", running?.activity?.label || "working");
    }
    else if (!["done", "error"].includes(state.avatarMode)) setAvatar("idle");
    renderSessions();
    renderSessionSelect();
    renderContext();
    renderQueuedPrompts();
    if (state.selectedSessionId && !state.queuedPromptsBySession.has(state.selectedSessionId)) await loadQueue(state.selectedSessionId);
    if (!state.modelCatalog) await loadModels();
    if (!state.commandCatalog.length) await loadCommands();
    if (!state.workspaces.length) await loadWorkspaces();
    if (state.tab === "chat") await refreshHistory();
  } finally {
    state.refreshing = false;
  }
}

async function startHarnessFromBanner() {
  if (state.harnessStarting) return;
  state.harnessStarting = true;
  const button = $("#startHarnessButton");
  const label = $("#offlineBannerText");
  button.disabled = true;
  button.textContent = "Starting…";
  label.textContent = "Launching Harness";
  try {
    const result = await window.widget.startHarness();
    if (!result?.ok) {
      const reason = result?.reason === "remote-url"
        ? "Remote Harness cannot be started here"
        : "Harness could not be started";
      throw new Error(reason);
    }
    label.textContent = "Connecting…";
    await refresh();
    if (!state.dashboard?.harness) throw new Error("Harness started but is not responding yet");
  } catch (error) {
    label.textContent = String(error?.message || "Harness could not be started");
    button.textContent = "Retry";
  } finally {
    state.harnessStarting = false;
    button.disabled = false;
    if (state.dashboard?.harness) {
      label.textContent = "Harness is offline";
      button.textContent = "Start";
      $("#offlineBanner").classList.remove("show");
    } else if (button.textContent !== "Retry") {
      button.textContent = "Start";
    }
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
    state.modelLoadState = "idle";
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
  syncPressed($$(".mode-option"), state.currentMode, "mode");
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
  const input = $("#messageInput");
  if (!input.value.trim()) input.value = "/";
  await loadCommands();
  renderCommands(commandQuery());
  setCommandMenuOpen(true);
  input.focus();
}

function applyGlowIntensity(value) {
  const numeric = Number(value);
  const intensity = Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : 0.82;
  document.documentElement.style.setProperty("--chat-glow-intensity", String(intensity));
  $("#glowRange").value = String(Math.round(intensity * 100));
  $("#glowValue").textContent = `${Math.round(intensity * 100)}%`;
  return intensity;
}

function setAutoStartStatus(text, error = false) {
  const status = $("#autoStartStatus");
  status.textContent = text;
  status.classList.toggle("error", error);
}

function applyPlatformCapabilities(capabilities) {
  state.platformCapabilities = capabilities || {};
  const presentation = window.platformPresentation.createPlatformPresentation(state.platformCapabilities);
  state.platformPresentation = presentation;
  document.body.classList.toggle("position-unavailable", !presentation.positionAvailable);
  document.body.classList.toggle("edge-interactive-wide", presentation.edgeMode === "interactive-wide");

  $("#autoStartLabel").textContent = presentation.startupLabel;
  const platformStatus = $("#platformStatus");
  platformStatus.textContent = presentation.platformHint;
  platformStatus.hidden = !presentation.platformHint;

  const opacitySetting = $("#opacitySetting");
  const opacityRange = $("#opacityRange");
  const opacityStatus = $("#opacityStatus");
  opacitySetting.classList.toggle("unsupported", !presentation.opacityAvailable);
  opacityRange.disabled = !presentation.opacityAvailable;
  opacityRange.setAttribute("aria-disabled", String(!presentation.opacityAvailable));
  opacityStatus.textContent = presentation.opacityHint;
  opacityStatus.hidden = !presentation.opacityHint;
  if (!presentation.opacityAvailable) $("#opacityValue").textContent = "Unavailable";

  const gameButton = $('#windowLayerSwitch [data-layer="game"]');
  gameButton.disabled = !presentation.gameLayerAvailable;
  gameButton.setAttribute("aria-disabled", String(!presentation.gameLayerAvailable));
  gameButton.title = presentation.gameLayerAvailable
    ? "Maximum layer for fullscreen apps"
    : "Game layer is unavailable on this platform; Above is used instead";

  const dockButton = $("#dockButton");
  dockButton.disabled = !presentation.edgeAvailable;
  dockButton.setAttribute("aria-disabled", String(!presentation.edgeAvailable));
  dockButton.title = presentation.dockTitle;
  dockButton.setAttribute("aria-label", presentation.dockTitle);
  if (presentation.platformHint) dockButton.setAttribute("aria-describedby", "platformStatus");
  else dockButton.removeAttribute("aria-describedby");
}

async function updateAutoStartToggle(event) {
  const toggle = event.currentTarget;
  const requested = toggle.checked;
  toggle.disabled = true;
  setAutoStartStatus("Saving…");
  try {
    confirmedAutoStart = Boolean(await window.widget.setAutoStart(requested));
    toggle.checked = confirmedAutoStart;
    setAutoStartStatus(confirmedAutoStart ? "Enabled" : "Disabled");
  } catch {
    toggle.checked = confirmedAutoStart;
    setAutoStartStatus("Could not update startup", true);
  } finally {
    toggle.disabled = false;
  }
}

async function hydratePreferences() {
  const autoStartToggle = $("#autoStartToggle");
  autoStartToggle.disabled = true;
  setAutoStartStatus("Checking…");
  try {
    const preferences = await window.widget.getPreferences();
    syncPressed($$('#windowLayerSwitch button'), preferences.windowLayer || "above", "layer");
    confirmedAutoStart = Boolean(preferences.autoStart);
    autoStartToggle.checked = confirmedAutoStart;
    autoStartToggle.disabled = preferences.autoStartAvailable === false;
    setAutoStartStatus(
      preferences.autoStartAvailable === false ? "Startup setting unavailable" : (confirmedAutoStart ? "Enabled" : "Disabled"),
      preferences.autoStartAvailable === false,
    );
    $("#opacityRange").value = Math.round(preferences.opacity * 100);
    $("#opacityValue").textContent = `${Math.round(preferences.opacity * 100)}%`;
    applyGlowIntensity(preferences.glowIntensity);
    syncPressed($$('#sizeSwitch button'), preferences.size, "size");
    applyPlatformCapabilities(preferences.platformCapabilities);
    applyCompactSide(preferences.compactSide || "right");
    applyWindowMode(preferences.windowMode || "full");
  } catch {
    autoStartToggle.checked = confirmedAutoStart;
    autoStartToggle.disabled = true;
    setAutoStartStatus("Could not read startup setting", true);
  }
}

document.querySelectorAll(".tab").forEach((button) => {
  button.addEventListener("click", () => setTab(button.dataset.tab));
  button.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const tabs = $$(".tab");
    const current = tabs.indexOf(event.currentTarget);
    const next = event.key === "Home"
      ? tabs[0]
      : event.key === "End"
        ? tabs[tabs.length - 1]
        : tabs[(current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
    setTab(next.dataset.tab);
    next.focus();
  });
});
$("#sessionButton").addEventListener("click", (event) => { event.stopPropagation(); togglePicker(event.currentTarget); });
$("#modelButton").addEventListener("click", (event) => {
  event.stopPropagation();
  togglePicker(event.currentTarget);
  if (event.currentTarget.closest(".picker").classList.contains("open")) setTimeout(() => $("#modelSearch").focus(), 0);
});
$("#reasoningButton").addEventListener("click", (event) => { event.stopPropagation(); togglePicker(event.currentTarget); });
$("#workspaceButton").addEventListener("click", (event) => { event.stopPropagation(); togglePicker(event.currentTarget); });
$("#modelSearch").addEventListener("input", (event) => renderModelOptions(event.target.value));
$("#modelMenu").addEventListener("keydown", (event) => {
  if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) && moveModelOptionFocus(event.key)) {
    event.preventDefault();
    return;
  }
  if (event.key === "Enter" && document.activeElement?.matches("#modelOptions .picker-option")) {
    event.preventDefault();
    document.activeElement.click();
  }
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".picker")) closePickers();
  if (!event.target.closest("#commandMenu, #commandsButton, #messageInput")) setCommandMenuOpen(false);
});
document.addEventListener("keydown", (event) => {
  if (trapSettingsFocus(event)) return;
  if (event.key === "Escape") {
    const settingsOpen = $("#settingsPanel").classList.contains("open");
    const pickerOpen = Boolean($(".picker.open"));
    if (settingsOpen) setSettingsOpen(false);
    else if (pickerOpen) closePickers(null, { restoreFocus: true });
    setCommandMenuOpen(false);
    if (settingsOpen || pickerOpen) {
      event.preventDefault();
      event.stopPropagation();
    }
  }
});
$("#newSessionButton").addEventListener("click", () => createNewSession());
$("#commandsButton").addEventListener("click", async () => {
  if ($("#commandMenu").classList.contains("open")) setCommandMenuOpen(false);
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
  const targetSessionId = state.selectedSessionId;
  const queueingBehindTurn = Boolean(targetSessionId && state.runningSessionIds.has(targetSessionId));
  const attachmentCount = state.pendingAttachments.length;
  $("#agentControls").open = false;
  setSettingsOpen(false, { restoreFocus: false });
  setCommandMenuOpen(false);
  closePickers();
  $("#sendButton").disabled = true;
  $("#sendButton").classList.add("sending");
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
      if (queueingBehindTurn) trackQueuedPrompt(result.sessionId, { text, attachmentCount });
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
    $("#sendButton").classList.remove("sending");
    input.focus();
  }
});
$("#messageInput").addEventListener("keydown", (event) => {
  if ($("#commandMenu").classList.contains("open") && !event.shiftKey) {
    const commands = filteredCommands(commandQuery());
    if (["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      state.commandSelectionIndex = (state.commandSelectionIndex + direction + commands.length) % Math.max(1, commands.length);
      renderCommands(commandQuery());
      $("#commandMenu .command-row.selected")?.scrollIntoView({ block: "nearest" });
      return;
    }
    if (["Enter", "Tab"].includes(event.key)) {
      const query = commandQuery();
      const exact = state.commandCatalog.find((command) => command.name.toLowerCase() === query);
      if (event.key === "Enter" && exact && !exact.input?.hint) {
        setCommandMenuOpen(false);
      } else {
        event.preventDefault();
        chooseCommand(commands[state.commandSelectionIndex]);
        return;
      }
    }
  }
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    $("#chatForm").requestSubmit();
  }
});
$("#messageInput").addEventListener("input", async (event) => {
  const slashMode = /^\/[^\s]*$/.test(event.target.value);
  if (!slashMode) {
    setCommandMenuOpen(false);
    if (!event.target.value) event.target.placeholder = "Message the agent…";
    return;
  }
  if (!state.commandCatalog.length) await loadCommands();
  renderCommands(commandQuery());
  setCommandMenuOpen(true);
});
$("#messages").addEventListener("click", (event) => {
  const link = event.target.closest("a[href]");
  if (!link) return;
  event.preventDefault();
  window.widget.openExternal(link.href).catch(() => {});
});
$("#messages").addEventListener("scroll", () => {
  const nearBottom = messagesNearBottom();
  state.messagesStickToBottom = nearBottom;
  if (nearBottom) state.unseenMessages = 0;
  updateScrollLatestButton();
});
$("#scrollLatestButton").addEventListener("click", () => {
  state.messagesStickToBottom = true;
  state.unseenMessages = 0;
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  $("#messages").scrollTo({ top: $("#messages").scrollHeight, behavior: reduceMotion ? "auto" : "smooth" });
  updateScrollLatestButton();
});
$("#cancelButton").addEventListener("click", async () => state.selectedSessionId && window.widget.cancel(state.selectedSessionId));
$("#focusChatButton").addEventListener("click", () => setFocusMode(!state.focusMode));
$("#startHarnessButton").addEventListener("click", startHarnessFromBanner);
$("#openHarnessButton").addEventListener("click", () => window.widget.openHarness());
$("#openSessionButton").addEventListener("click", () => {
  if (state.selectedSessionId) window.widget.openHarnessSession(state.selectedSessionId);
});
$("#dockButton").addEventListener("click", () => setWindowMode("edge"));
$("#orbRestore").addEventListener("click", (event) => { if (suppressCompactClick) event.preventDefault(); else setWindowMode("full"); });
$("#orbHistoryButton").addEventListener("click", () => {
  if (state.compactReplySessionId) openCompactReplySession().catch(showError);
  else toggleCompactHistory();
});
$("#orbStatus").addEventListener("click", openCompactSession);
$("#edgeMode").addEventListener("click", (event) => { if (suppressCompactClick) event.preventDefault(); else setWindowMode("full"); });
for (const target of [$("#orbMode"), $("#edgeMode")]) {
  target.addEventListener("pointerdown", beginCompactDrag);
  target.addEventListener("pointermove", moveCompactDrag);
  target.addEventListener("pointerup", endCompactDrag);
  target.addEventListener("pointercancel", endCompactDrag);
}
document.addEventListener("mousemove", updateEdgePointerHit, true);
document.addEventListener("mouseleave", () => {
  if (!compactDrag) setEdgePointerActive(false);
});
window.addEventListener("blur", () => {
  if (!compactDrag) setEdgePointerActive(false);
});
for (const target of [$(".brand")]) {
  target.addEventListener("pointerdown", beginFullDrag);
  target.addEventListener("pointermove", moveFullDrag);
  target.addEventListener("pointerup", endFullDrag);
  target.addEventListener("pointercancel", endFullDrag);
}
// Pointer taps are resolved in endFullDrag, because pointer capture on the brand
// steals the click. Keyboard activation reports detail 0 and still arrives here.
$("#avatarButton").addEventListener("click", (event) => {
  if (event.detail !== 0 || suppressProjectClick) return;
  setWindowMode("orb");
});
$("#projectLink").addEventListener("click", (event) => {
  if (event.detail !== 0 || suppressProjectClick) return;
  window.widget.openProject();
});
$("#settingsButton").addEventListener("click", () => setSettingsOpen(!$("#settingsPanel").classList.contains("open")));
$("#closeSettings").addEventListener("click", () => setSettingsOpen(false));
$$('#windowLayerSwitch button').forEach((button) => button.addEventListener("click", async () => {
  if (button.disabled) return;
  const value = await window.widget.setWindowLayer(button.dataset.layer);
  syncPressed($$('#windowLayerSwitch button'), value, "layer");
}));
$("#autoStartToggle").addEventListener("change", updateAutoStartToggle);
$("#opacityRange").addEventListener("input", async (event) => {
  if (event.currentTarget.disabled) return;
  const percent = Number(event.target.value);
  $("#opacityValue").textContent = `${percent}%`;
  await window.widget.setOpacity(percent / 100);
});
$("#glowRange").addEventListener("input", async (event) => {
  const intensity = applyGlowIntensity(Number(event.target.value) / 100);
  await window.widget.setGlowIntensity(intensity);
});
$$('#sizeSwitch button').forEach((button) => button.addEventListener("click", async () => {
  const value = await window.widget.setSize(button.dataset.size);
  syncPressed($$('#sizeSwitch button'), value, "size");
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
window.widget.onQueueUpdate(({ sessionId, items }) => {
  if (!sessionId) return;
  state.queuedPromptsBySession.set(sessionId, Array.isArray(items) ? items : []);
  if (sessionId === state.selectedSessionId) renderQueuedPrompts();
});
window.widget.onLiveEvent((payload) => { handleLiveEvent(payload).catch(showError); });
window.widget.onEdgeBounce(() => {
  const edge = $("#edgeMode");
  edge.classList.remove("bounce");
  void edge.offsetWidth;
  edge.classList.add("bounce");
});
hydratePreferences();
window.widget.getAppInfo().then((info) => {
  $("#versionLabel").textContent = `v${info.version}`;
  $("#projectLink").title = `Open NeoXider/neoxider-agent-deck v${info.version} on GitHub`;
});

const launchParams = new URLSearchParams(location.search);
const requestedTab = launchParams.get("screenshotTab");
const screenshotFixture = launchParams.get("screenshotFixture");
if (launchParams.get("screenshotStatic")) document.body.classList.add("screenshot-static");
const screenshotBackdrop = launchParams.get("screenshotBackdrop");
if (["black", "white", "checkerboard"].includes(screenshotBackdrop)) document.body.classList.add(`screenshot-backdrop-${screenshotBackdrop}`);
if (requestedTab === "chat") setTab("chat");
setAvatar("idle");
renderNotifications();
renderAttachments();
renderQueuedPrompts();
renderMode();
// A hidden widget still has to notice a finished turn, so polling never stops —
// it just slows down instead of hitting Harness every 2.5s behind a minimized window.
const POLL_INTERVAL_VISIBLE = 2500;
const POLL_INTERVAL_HIDDEN = 10000;

function schedulePolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  const interval = document.hidden ? POLL_INTERVAL_HIDDEN : POLL_INTERVAL_VISIBLE;
  state.pollInterval = interval;
  state.pollTimer = setInterval(refresh, interval);
}

if (!screenshotFixture) {
  refresh();
  schedulePolling();
  document.addEventListener("visibilitychange", () => {
    schedulePolling();
    if (!document.hidden) refresh();
  });
}

if (screenshotFixture) {
  setTimeout(async () => {
    if (screenshotFixture === "edge-hover") {
      $("#edgeMode").classList.add("edge-hit-active");
    } else if (["offline", "offline-agents", "focus-offline"].includes(screenshotFixture)) {
      setTab("chat");
      if (screenshotFixture === "focus-offline") setFocusMode(true);
      state.dashboard = { harness: false, sessions: [] };
      state.selectedSessionId = null;
      if (state.focusMode) setFocusMode(false);
      $("#offlineBanner").classList.add("show");
      setAvatar("error", "");
      renderSessions();
      renderSessionSelect();
      renderContext();
      renderMessages([]);
      if (screenshotFixture === "offline-agents") setTab("agents");
    } else if (screenshotFixture === "overview") {
      setTab("agents");
      state.dashboard = {
        harness: true,
        sessions: [
          { sessionId: "demo-active", title: "NeuralNetLab experiment", running: true, state: "working", projections: { values: { contextPressure: { projectedTokens: 32768, contextWindow: 131072 } } }, subagents: [{ kind: "child", activity: "running" }, { kind: "child", activity: "idle" }] },
          { sessionId: "demo-unity", title: "Unity gameplay pass", running: false, state: "idle", projections: { values: { contextPressure: { projectedTokens: 11800, contextWindow: 65536 } } }, subagents: [] },
          { sessionId: "demo-review", title: "Release verification", running: false, state: "error", projections: { values: {} }, subagents: [{ kind: "child", activity: "idle" }] },
        ],
      };
      state.selectedSessionId = "demo-active";
      renderSessions();
    } else if (["chat", "focus-chat"].includes(screenshotFixture)) {
      setTab("chat");
      state.dashboard = { harness: true, sessions: [{ sessionId: "demo-chat", title: "Release verification", running: false, projections: { values: { contextPressure: { projectedTokens: 55296, contextWindow: 131072 } } }, subagents: [] }] };
      state.selectedSessionId = "demo-chat";
      renderSessionSelect();
      $("#controlsSummary").textContent = "LM Studio · Qwen 3.5 9B · Medium";
      renderContext();
      renderMessages([
        { role: "user", text: "Verify the compact widget and summarize the result." },
        { role: "assistant", text: "All checks passed.", html: "<p><strong>All checks passed.</strong></p><ul><li>No clipped controls</li><li>Markdown and tool calls render correctly</li><li>Compact modes snap to screen edges</li></ul>" },
      ]);
      if (screenshotFixture === "focus-chat") setFocusMode(true);
    } else if (["model", "model-closed"].includes(screenshotFixture)) {
      setTab("chat");
      state.modelCatalog = {
        current: { provider: "lmstudio", model: "qwen3.5-9b", reasoningEffort: "medium" },
        groups: [
          { id: "lmstudio", name: "LM Studio", models: [{ id: "qwen3.5-9b", name: "Qwen 3.5 9B", reasoning: { defaultEffort: "medium", efforts: [{ id: "low", name: "Low" }, { id: "medium", name: "Medium" }, { id: "high", name: "High" }] } }, { id: "deepseek-r1", name: "DeepSeek R1 Distill" }] },
          { id: "deepseek", name: "DeepSeek", models: [{ id: "deepseek-chat", name: "DeepSeek Chat" }, { id: "deepseek-reasoner", name: "DeepSeek Reasoner" }] },
          { id: "openai", name: "OpenAI", models: [{ id: "gpt-5.6", name: "GPT-5.6" }, { id: "gpt-5.6-codex", name: "GPT-5.6 Codex" }] },
        ],
      };
      state.modelLoadState = "ready";
      state.pendingSelection = state.modelCatalog.current;
      renderModels();
      if (screenshotFixture === "model") {
        $("#agentControls").open = true;
        togglePicker($("#modelButton"));
      }
    } else if (screenshotFixture === "model-empty") {
      setTab("chat");
      state.modelCatalog = { current: null, groups: [], failures: [] };
      state.modelLoadState = "ready";
      renderModels();
      $("#agentControls").open = true;
      togglePicker($("#modelButton"));
    } else if (screenshotFixture === "model-error") {
      setTab("chat");
      state.modelCatalog = { current: null, groups: [], failures: ["No models loaded"] };
      state.modelLoadState = "error";
      renderModels();
      renderMessages([
        { role: "assistant", text: "400: No models loaded" },
        { role: "error", text: "400: No models loaded" },
      ]);
    } else if (["commands", "focus-commands"].includes(screenshotFixture)) {
      setTab("chat");
      state.dashboard = { harness: true, sessions: [{ sessionId: "demo-commands", title: "Command palette", running: false, projections: { values: { contextPressure: { projectedTokens: 22000, contextWindow: 131072 } } }, subagents: [] }] };
      state.selectedSessionId = "demo-commands";
      state.commandCatalog = [
        { name: "compact", description: "Compact older conversation history" },
        { name: "export", description: "Download this Session log as a ZIP archive" },
        { name: "feedback", description: "Record feedback about this session", input: { hint: "<text>" } },
        { name: "goal", description: "Set or view the goal for a long-running task", input: { hint: "[<objective>|clear|edit <objective>|pause|resume]" } },
        { name: "permission", description: "Switch the permission preset", input: { hint: "<preset>" } },
        { name: "plan", description: "Enter or leave plan mode", input: { hint: "[off|message]" } },
      ];
      renderSessionSelect();
      renderContext();
      $("#messageInput").value = "/";
      if (screenshotFixture === "focus-commands") setFocusMode(true);
      renderCommands("");
      setCommandMenuOpen(true);
    } else if (screenshotFixture === "queued-message") {
      setTab("chat");
      state.dashboard = { harness: true, sessions: [{ sessionId: "demo-queue", title: "Long-running agent", running: true, projections: { values: { contextPressure: { projectedTokens: 64120, contextWindow: 131072 } } }, subagents: [] }] };
      state.selectedSessionId = "demo-queue";
      state.runningSessionIds = new Set(["demo-queue"]);
      $("#chatForm").classList.add("has-running");
      $("#cancelButton").hidden = false;
      renderMessages([{ role: "assistant", text: "The current turn is still running…" }]);
      state.queuedPromptsBySession.set("demo-queue", [
        { id: "queue-1", placement: "queued", text: "After this, run the UI verification.", preview: "After this, run the UI verification." },
        { id: "queue-2", placement: "queued", text: "Then summarize only the failures.", preview: "Then summarize only the failures." },
      ]);
      renderQueuedPrompts();
    } else if (screenshotFixture === "live-stream") {
      setTab("chat");
      state.dashboard = { harness: true, sessions: [{ sessionId: "demo-live", title: "Streaming response", running: true, state: "working", projections: { values: {} }, subagents: [] }] };
      state.selectedSessionId = "demo-live";
      state.currentMessages = [{ role: "user", text: "Show me the verified result." }];
      state.liveStreamsBySession.set("demo-live", { text: "The response grows inside this assistant bubble while Harness is still generating it…", reasoning: "", lastSeq: 4 });
      setActivity({ active: true, kind: "writing", label: "Writing", text: "The response grows inside this assistant bubble while Harness is still generating it…" });
      renderMessages(state.currentMessages);
    } else if (screenshotFixture === "scroll-away") {
      setTab("chat");
      state.selectedSessionId = "demo-scroll";
      const messages = Array.from({ length: 22 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", text: `Earlier message ${index + 1}: scroll position must remain under user control.` }));
      renderMessages(messages);
      state.messagesStickToBottom = false;
      $("#messages").scrollTop = 0;
      state.unseenMessages = 1;
      updateScrollLatestButton();
    } else if (screenshotFixture === "glow-settings") {
      setTab("chat");
      applyGlowIntensity(0.82);
      setActivity({ active: true, kind: "writing", label: "Writing", text: "Composing the answer in the mini-chat…" });
      setSettingsOpen(true, { restoreFocus: false });
    } else if (screenshotFixture === "attachments") {
      setTab("chat");
      const paths = (launchParams.get("screenshotFiles") || "").split("|").filter(Boolean);
      if (paths.length) addAttachments(await window.widget.prepareFiles(paths));
      else addAttachments([
        { kind: "reference", previewKind: "file", path: "C:\\demo\\release-notes.md", name: "release-notes.md" },
        { kind: "reference", previewKind: "video", path: "C:\\demo\\widget-preview.mp4", name: "widget-preview.mp4" },
      ]);
    } else if (screenshotFixture === "orb-notification") {
      state.dashboard = { harness: true, sessions: [{ sessionId: "demo-notification", title: "Unity gameplay pass", updatedAt: Date.now(), running: false, state: "idle", preview: "The Play Mode verification finished successfully.", projections: { values: {} }, subagents: [] }] };
      state.selectedSessionId = "demo-notification";
      state.compactReplySessionId = "demo-notification";
      state.compactNotification = { kind: "notification", sessionId: "demo-notification", title: "Unity gameplay pass", text: "The Play Mode verification finished successfully." };
      setAvatar("done", "done");
      syncCompactStatus();
    } else if (screenshotFixture === "thinking") {
      setTab("chat");
      setAvatar("working", "thinking");
      setActivity({ active: true, kind: "thinking", label: "Thinking", text: "Reviewing the workspace and preparing the next tool call…" });
    } else if (screenshotFixture === "writing") {
      setTab("chat");
      setAvatar("working", "writing");
      setActivity({ active: true, kind: "writing", label: "Writing", text: "Composing the answer in the mini-chat…" });
      renderMessages([]);
    } else if (screenshotFixture === "tool") {
      setTab("chat");
      setAvatar("working", "using tool");
      setActivity({ active: true, kind: "tool", label: "Using tool", text: "read_file" });
    } else if (screenshotFixture === "markdown-tools") {
      setTab("chat");
      renderMessages([
        { role: "assistant", text: "Result", html: "<h3>Workspace checked</h3><p><strong>Build</strong> is clean and <em>visually verified</em>.</p><blockquote>Accent colors remain readable on the dark surface.</blockquote><pre><code class=\"language-js\"><span class=\"hljs-keyword\">const</span> status = <span class=\"hljs-string\">\"ready\"</span>; <span class=\"hljs-comment\">// verified</span></code></pre>" },
        { role: "tool", name: "read_file", arguments: "{\n  \"path\": \"src/main.cjs\"\n}", result: "Loaded 412 lines", status: "done", durationMs: 184 },
        { role: "tool", name: "run_tests", arguments: "{\n  \"suite\": \"widget\"\n}", result: "18 tests passed", status: "done", durationMs: 1260, nested: true },
      ]);
    }
  }, 700);
}
