const state = {
  dashboard: null,
  selectedSessionId: null,
  tab: "chat",
  focusMode: false,
  focusReturnTab: "chat",
  refreshing: false,
  refreshPromise: null,
  historyBusy: false,
  historyRequestSequence: 0,
  historyPrioritySessionId: null,
  historyPriorityPromise: null,
  historyLoadedSessionId: null,
  historyLoadedUpdatedAt: undefined,
  historyLoadedRevision: null,
  modelsBusy: false,
  modelsRequestSequence: 0,
  commandsBusy: false,
  commandsRequestSequence: 0,
  commandsLoadedSessionId: null,
  modelCatalog: null,
  modelLoadState: "idle",
  commandCatalog: [],
  workspaces: [],
  workspacesBusy: false,
  workspacesLoaded: false,
  workspaceSignature: "",
  selectedWorkspaceId: null,
  pendingAttachments: [],
  pendingSelection: null,
  automaticModelRoute: false,
  windowMode: "full",
  avatarMode: "idle",
  avatarLabel: "ready",
  currentActivity: null,
  showThinking: true,
  compactAutoExpand: false,
  activityCardSignature: "",
  currentMode: "agent",
  agentModesBySessionId: new Map(),
  unread: 0,
  dashboardInitialized: false,
  runningSessionIds: new Set(),
  sessionSnapshotsById: new Map(),
  completedSignalSessionIds: new Set(),
  errorSignalSessionIds: new Set(),
  unacknowledgedErrorSessionIds: new Set(),
  composerError: null,
  compactErrorUnread: false,
  harnessOffline: false,
  completionSignalTimer: null,
  compactNotification: null,
  compactNotificationTimer: null,
  compactStatusClosing: false,
  compactHistoryOpen: false,
  compactReplySessionId: null,
  compactReplyOpen: false,
  compactReplyBusy: false,
  compactReplyError: "",
  compactSessionSignature: "",
  compactStatusDomSignature: "",
  compactStatusIpcSignature: "",
  compactStatusExpanded: false,
  compactResizeTimer: null,
  compactHitAreaSignature: "",
  sessionTimerTick: null,
  // A session is only given up on after a healthy dashboard has failed to mention it twice,
  // and the id is kept so recovery restores the user's choice instead of guessing.
  missingSelectionPolls: 0,
  lastSelectedSessionId: null,
  sessionListSignature: "",
  sessionSelectSignature: "",
  collapsedSessionGroupKeys: new Set(),
  contextSignature: "",
  modeSignature: "",
  commandSelectionIndex: 0,
  lastCommandQuery: "",
  commandHintSignature: "",
  queuedPromptsBySession: new Map(),
  steeringPromptsBySession: new Map(),
  queueSnapshotRevisions: new Map(),
  queueHandoffEpochs: new Map(),
  nextQueuedPromptId: 1,
  queueEditingId: null,
  queueEditingSessionId: null,
  queueExpandedId: null,
  queueExpandedSessionId: null,
  queueBusyId: null,
  queueBusySessionId: null,
  queueBusyKind: null,
  queueRecoveryGenerations: new Map(),
  queueSignature: "",
  messageMarksSignature: "",
  messageMarkFlashTimer: null,
  messageMarkFlashIndex: null,
  messageScrollPin: null,
  messageMagnetTimer: null,
  messageMagnetReleaseTimer: null,
  messageMagnetSnapping: false,
  goalSignature: "",
  goalEditing: false,
  goalBusy: false,
  goalDeleteConfirmTimer: null,
  todoExpandedSessionIds: new Set(),
  todoSignature: "",
  commandFeedbackBySession: new Map(),
  nextCommandFeedbackId: 1,
  liveStreamsBySession: new Map(),
  liveSessionRevisions: new Map(),
  liveTodosBySession: new Map(),
  turnGenerationsBySession: new Map(),
  currentMessages: [],
  messagesStickToBottom: true,
  unseenMessages: 0,
  scrollLatestSignature: "",
  scrollLatestAutoScrolling: false,
  scrollLatestAutoScrollTimer: null,
  historySignature: "",
  harnessStarting: false,
  platformCapabilities: null,
  platformPresentation: null,
  screenshotCapabilities: {},
  hotkeys: {},
  updateState: null,
  appVersion: "",
  gameBarSelectedSessionId: undefined,
  transientActivityTimer: null,
  cancelBusySessionId: null,
  cancelPendingSessionIds: new Set(),
  runningControlsSignature: "",
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
// What the live-activity preference governs. Gating only "thinking" was the reported bug:
// every tool result clears the activity, the fallback below substitutes kind "working", and
// the card the user had just switched off reappeared as "Working" a second later.
// Outcomes — done, error — and the user's own file and capture notices are not live agent
// internals, so they stay.
const LIVE_ACTIVITY_KINDS = new Set(["thinking", "writing", "tool", "working"]);

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

function compactRecentText(value, limit = 110) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  return normalized.length > limit ? `…${normalized.slice(-(limit - 1))}` : normalized;
}

const COMPOSER_INPUT_MIN_HEIGHT = 34;
const COMPOSER_INPUT_MAX_VIEWPORT_RATIO = 1 / 3;
const HISTORY_PREVIEW_BYTES_BUDGET = 1024 * 1024;
const COMMAND_MENU_CHROME_HEIGHT = 46;
const COMMAND_MENU_ROW_HEIGHT = 44;
const COMMAND_MENU_MAX_ROWS = 4;
const CORE_COMMAND_ORDER = new Map(["goal", "compact", "plan", "permission"].map((name, index) => [name, index]));
const MODEL_PICKER_CHROME_HEIGHT = 57;
const MODEL_PICKER_ROW_HEIGHT = 36;
const MODEL_PICKER_MAX_ROWS = 6;
const MODEL_PICKER_COMPACT_MAX_VIEWPORT_HEIGHT = 400;
const MODEL_PICKER_COMPACT_CHROME_HEIGHT = 47;
const MODEL_PICKER_COMPACT_ROW_HEIGHT = 30;
const PICKER_MENU_OFFSET = 6;
const PICKER_SURFACE_GAP = 7;
let messageInputResizeFrame = null;
let composerPastePreparation = Promise.resolve();
let composerPasteFailurePending = false;
let composerSubmitInFlight = false;

function captureMessageLayoutSnapshot() {
  const root = $("#messages");
  if (!root || root.clientHeight <= 0) return null;
  return { root, pinned: state.messagesStickToBottom, scrollTop: root.scrollTop };
}

function restoreMessageLayoutSnapshot(snapshot) {
  if (!snapshot?.root?.isConnected || snapshot.root.clientHeight <= 0) return;
  // A mark the caller just clicked outranks the offset captured before the rebuild.
  if (applyMessageScrollPin()) {
    paintMessageMarkFlash();
    updateScrollLatestButton();
    return;
  }
  if (snapshot.pinned) {
    snapshot.root.scrollTop = snapshot.root.scrollHeight;
    state.messagesStickToBottom = true;
    state.unseenMessages = 0;
  } else {
    snapshot.root.scrollTop = Math.min(snapshot.scrollTop, Math.max(0, snapshot.root.scrollHeight - snapshot.root.clientHeight));
    state.messagesStickToBottom = messagesNearBottom(snapshot.root);
    if (state.messagesStickToBottom) state.unseenMessages = 0;
  }
  updateScrollLatestButton();
}

function restoreMessageInputViewport(input, snapshot) {
  if (!snapshot) return;
  input.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd, snapshot.selectionDirection);
  const maximumScrollTop = Math.max(0, input.scrollHeight - input.clientHeight);
  const preservedScrollTop = input.classList.contains("is-scrollable")
    ? Math.round(snapshot.scrollTop / snapshot.lineHeight) * snapshot.lineHeight
    : snapshot.scrollTop;
  input.scrollTop = snapshot.stickToBottom ? maximumScrollTop : Math.min(preservedScrollTop, maximumScrollTop);
  input.scrollLeft = snapshot.scrollLeft;
}

function resizeMessageInput({ immediate = false } = {}) {
  const input = $("#messageInput");
  if (!input) return;
  const messageLayout = captureMessageLayoutSnapshot();
  if (messageInputResizeFrame) cancelAnimationFrame(messageInputResizeFrame);
  const style = getComputedStyle(input);
  const lineHeight = Number.parseFloat(style.lineHeight) || 15;
  const viewportMaximum = Math.max(COMPOSER_INPUT_MIN_HEIGHT, Math.floor(window.innerHeight * COMPOSER_INPUT_MAX_VIEWPORT_RATIO));
  const maximumHeight = Math.max(COMPOSER_INPUT_MIN_HEIGHT, Math.floor(viewportMaximum / lineHeight) * lineHeight);
  const previousHeight = Math.max(COMPOSER_INPUT_MIN_HEIGHT, Math.round(input.getBoundingClientRect().height));
  const snapshot = {
    selectionStart: input.selectionStart,
    selectionEnd: input.selectionEnd,
    selectionDirection: input.selectionDirection,
    scrollTop: input.scrollTop,
    scrollLeft: input.scrollLeft,
    lineHeight,
    stickToBottom: input === document.activeElement
      && input.selectionEnd === input.value.length
      && input.scrollTop + input.clientHeight >= input.scrollHeight - 2,
  };
  input.style.height = "0px";
  const contentHeight = input.scrollHeight;
  const isScrollable = contentHeight > maximumHeight;
  input.classList.toggle("is-scrollable", isScrollable);
  input.style.setProperty("--composer-input-max-height", `${maximumHeight}px`);
  const normalizedContentHeight = input.scrollHeight;
  const targetHeight = input.value.length
    ? Math.min(maximumHeight, Math.max(COMPOSER_INPUT_MIN_HEIGHT, normalizedContentHeight))
    : COMPOSER_INPUT_MIN_HEIGHT;
  $("#chatForm")?.classList.toggle("composer-multiline", targetHeight > COMPOSER_INPUT_MIN_HEIGHT);
  if (immediate) {
    input.style.height = `${targetHeight}px`;
    restoreMessageInputViewport(input, snapshot);
    restoreMessageLayoutSnapshot(messageLayout);
    messageInputResizeFrame = null;
    return;
  }
  input.style.height = `${previousHeight}px`;
  restoreMessageInputViewport(input, snapshot);
  messageInputResizeFrame = requestAnimationFrame(() => {
    input.style.height = `${targetHeight}px`;
    restoreMessageInputViewport(input, snapshot);
    restoreMessageLayoutSnapshot(messageLayout);
    messageInputResizeFrame = null;
  });
}

function resizeCommandMenu() {
  const menu = $("#commandMenu");
  if (!menu) return;
  const compactViewport = window.innerHeight <= 420;
  const chromeHeight = compactViewport ? 36 : COMMAND_MENU_CHROME_HEIGHT;
  const rowHeight = compactViewport ? 34 : COMMAND_MENU_ROW_HEIGHT;
  const availableHeight = Math.min(
    chromeHeight + rowHeight * COMMAND_MENU_MAX_ROWS,
    Math.floor(window.innerHeight * (compactViewport ? 0.55 : 0.36)),
  );
  const visibleRows = Math.max(1, Math.min(
    COMMAND_MENU_MAX_ROWS,
    menu.querySelectorAll(".command-row").length || 1,
    Math.floor((availableHeight - chromeHeight) / rowHeight),
  ));
  menu.style.setProperty("--command-menu-max-height", `${chromeHeight + visibleRows * rowHeight}px`);
}

function closePickers(except = null, { restoreFocus = false } = {}) {
  $$(".picker.open").forEach((picker) => {
    if (picker === except) return;
    const activeInside = picker.contains(document.activeElement);
    picker.classList.remove("open");
    picker.classList.remove("compact-overlay");
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
  if (open) positionPickerMenu(picker);
}

function positionPickerMenu(picker) {
  const button = picker?.querySelector(".picker-button");
  const menu = picker?.querySelector(".picker-menu");
  if (!button || !menu) return;
  const rect = button.getBoundingClientRect();
  if (menu.classList.contains("model-menu")) {
    const shell = $(".widget-shell").getBoundingClientRect();
    const titlebar = $(".titlebar").getBoundingClientRect();
    const composer = $(".composer").getBoundingClientRect();
    const compactOverlay = window.innerHeight <= MODEL_PICKER_COMPACT_MAX_VIEWPORT_HEIGHT;
    picker.classList.toggle("compact-overlay", compactOverlay);
    if (compactOverlay) {
      const top = Math.ceil(titlebar.bottom + 1);
      const bottom = Math.floor(Math.min(shell.bottom - PICKER_SURFACE_GAP, composer.top - PICKER_MENU_OFFSET));
      const available = Math.max(0, bottom - top);
      const visibleRows = Math.max(1, Math.min(MODEL_PICKER_MAX_ROWS, Math.floor((available - MODEL_PICKER_COMPACT_CHROME_HEIGHT) / MODEL_PICKER_COMPACT_ROW_HEIGHT)));
      const menuHeight = MODEL_PICKER_COMPACT_CHROME_HEIGHT + visibleRows * MODEL_PICKER_COMPACT_ROW_HEIGHT;
      picker.classList.remove("open-up");
      menu.style.setProperty("--model-sheet-top", `${top}px`);
      menu.style.setProperty("--model-sheet-left", `${Math.ceil(titlebar.left)}px`);
      menu.style.setProperty("--model-sheet-width", `${Math.floor(titlebar.width)}px`);
      menu.style.setProperty("--picker-max-height", `${menuHeight}px`);
      menu.style.setProperty("--picker-options-height", `${visibleRows * MODEL_PICKER_COMPACT_ROW_HEIGHT}px`);
      requestAnimationFrame(scrollSelectedModelIntoView);
      return;
    }
    const topBoundary = shell.top + PICKER_SURFACE_GAP;
    const bottomBoundary = Math.min(shell.bottom - PICKER_SURFACE_GAP, composer.top - PICKER_SURFACE_GAP);
    const below = Math.max(0, bottomBoundary - rect.bottom - PICKER_MENU_OFFSET);
    const above = Math.max(0, rect.top - PICKER_MENU_OFFSET - topBoundary);
    const rowsFor = (space) => Math.max(0, Math.min(
      MODEL_PICKER_MAX_ROWS,
      Math.floor((space - MODEL_PICKER_CHROME_HEIGHT) / MODEL_PICKER_ROW_HEIGHT),
    ));
    const belowRows = rowsFor(below);
    const aboveRows = rowsFor(above);
    const opensUp = aboveRows > belowRows;
    const visibleRows = Math.max(1, opensUp ? aboveRows : belowRows);
    const menuHeight = MODEL_PICKER_CHROME_HEIGHT + visibleRows * MODEL_PICKER_ROW_HEIGHT;
    picker.classList.toggle("open-up", opensUp);
    menu.style.setProperty("--picker-max-height", `${menuHeight}px`);
    menu.style.setProperty("--picker-options-height", `${visibleRows * MODEL_PICKER_ROW_HEIGHT}px`);
    requestAnimationFrame(scrollSelectedModelIntoView);
    return;
  }
  const below = Math.max(88, window.innerHeight - rect.bottom - 12);
  const above = Math.max(88, rect.top - 12);
  const opensUp = below < 176 && above > below;
  picker.classList.toggle("open-up", opensUp);
  menu.style.setProperty("--picker-max-height", `${Math.floor(opensUp ? above : below)}px`);
}

function pickerOption(label, { selected = false, meta = "", title = "", key = "", onSelect } = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `picker-option${selected ? " selected" : ""}`;
  button.title = title || label;
  button.setAttribute("role", "option");
  button.setAttribute("aria-selected", String(selected));
  if (key) button.dataset.optionKey = key;
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

function scrollSelectedModelIntoView() {
  if (!$(".model-picker")?.classList.contains("open")) return;
  const selected = $("#modelOptions .picker-option[data-model-option][aria-selected='true']")
    || $("#modelOptions .picker-option[aria-selected='true']");
  selected?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function compactPreviewEntry() {
  if (state.compactNotification) return state.compactNotification;
  return null;
}

function modeFromCommand(value) {
  const match = String(value || "").trim().match(/^\/plan(?:\s+(off))?\s*$/i);
  if (!match) return null;
  return match[1] ? "agent" : "plan";
}

function modeFromMessages(messages) {
  let mode = null;
  for (const message of Array.isArray(messages) ? messages : []) {
    if (message?.role !== "user") continue;
    mode = modeFromCommand(message.text) || mode;
  }
  return mode;
}

function syncSelectedAgentMode() {
  state.currentMode = state.agentModesBySessionId.get(state.selectedSessionId) || "agent";
  renderMode();
}

function setSessionAgentMode(sessionId, mode) {
  if (!sessionId || !["agent", "plan"].includes(mode)) return;
  state.agentModesBySessionId.set(sessionId, mode);
  if (sessionId !== state.selectedSessionId) return;
  syncSelectedAgentMode();
}

function recentCompactSessions() {
  return window.compactSessions.recentReplySessions(state.dashboard?.sessions, 3);
}

function renderCompactSessions() {
  const root = $("#orbSessionList");
  const sessions = recentCompactSessions();
  const signature = JSON.stringify([
    state.compactReplySessionId,
    ...sessions.map((session) => [session.sessionId, session.title, session.preview]),
  ]);
  if (signature === state.compactSessionSignature && root.childElementCount) return sessions;
  state.compactSessionSignature = signature;
  root.replaceChildren();
  if (!sessions.length) {
    const empty = document.createElement("div");
    empty.className = "orb-session-empty";
    empty.textContent = "No assistant replies yet";
    root.append(empty);
    return sessions;
  }
  for (const session of sessions) {
    const row = document.createElement("div");
    row.className = `orb-session-row${session.sessionId === state.compactReplySessionId ? " selected" : ""}`;
    row.setAttribute("role", "listitem");
    const open = document.createElement("button");
    open.type = "button";
    open.className = "orb-session-open";
    open.title = `Open ${session.title}`;
    open.setAttribute("aria-label", `Open ${session.title} in the widget`);
    const title = document.createElement("b");
    title.textContent = session.title;
    const preview = document.createElement("small");
    preview.textContent = compactText(session.preview, 74);
    open.append(title, preview);
    open.addEventListener("click", () => openCompactSession(session.sessionId));
    const reply = document.createElement("button");
    reply.type = "button";
    reply.className = "orb-session-reply";
    reply.title = `Quick reply to ${session.title}`;
    reply.setAttribute("aria-label", `Quick reply to ${session.title}`);
    reply.append(createIcon("chat"));
    reply.addEventListener("click", () => openCompactReply(session.sessionId));
    row.append(open, reply);
    root.append(row);
  }
  return sessions;
}

function syncCompactStatus() {
  const activity = state.currentActivity;
  const preview = compactPreviewEntry();
  const compactSessions = renderCompactSessions();
  const expanded = state.compactHistoryOpen || state.compactReplyOpen;
  const offline = state.harnessOffline;
  // Avatar mode is collapsed unless the user opens it. Activity, a finished turn and even
  // an offline Harness used to widen the orb to 400 px on their own, which is what put a
  // panel over the user's screen without being asked. They now show as the ring colour and
  // the count on the expand button; the panel is a deliberate act.
  const autoActive = Boolean(offline || preview || activity?.active || ["working", "waiting", "error", "done"].includes(state.avatarMode));
  const active = Boolean(expanded || state.compactStatusClosing || (state.compactAutoExpand && autoActive));
  const label = offline ? "Harness offline" : preview?.title || activity?.label || AVATAR_LABELS[state.avatarMode] || "Ready";
  const text = compactText(offline ? "Start Harness to reconnect." : preview?.text || activity?.text || $("#avatarState")?.textContent || label, 96);
  const statusKind = offline ? "error" : preview?.kind || "";
  const compactButton = $("#orbHistoryButton");
  const replySession = state.dashboard?.sessions?.find((session) => session.sessionId === state.compactReplySessionId);
  // What someone glancing at a collapsed circle wants to know: how many agents are working
  // right now. With none running it falls back to how many replies are waiting to be read.
  const runningCount = (state.dashboard?.sessions || []).filter((session) => session.running).length;
  const badgeCount = runningCount || compactSessions.length;
  const compactButtonLabel = expanded ? "Close recent replies" : `Recent replies${compactSessions.length ? ` (${compactSessions.length})` : ""}`;
  const replyTitle = replySession?.title || "Quick reply";
  const domSignature = JSON.stringify([
    active,
    expanded,
    label,
    text,
    statusKind,
    state.compactStatusClosing,
    state.compactHistoryOpen,
    state.compactReplyOpen,
    state.compactErrorUnread,
    compactButtonLabel,
    badgeCount,
    replyTitle,
    state.compactReplyError,
    state.compactReplyBusy,
    state.selectedSessionId,
  ]);
  if (domSignature !== state.compactStatusDomSignature) {
    document.body.classList.toggle("orb-has-status", active);
    document.body.classList.toggle("orb-has-notification", statusKind === "notification");
    document.body.classList.toggle("orb-status-closing", state.compactStatusClosing);
    document.body.classList.toggle("orb-history-open", state.compactHistoryOpen);
    document.body.classList.toggle("orb-reply-open", state.compactReplyOpen);
    document.body.classList.toggle("compact-error-unread", state.compactErrorUnread);
    $("#orbStatusLabel").textContent = label;
    $("#orbStatusText").textContent = text;
    $("#orbStatusCard").hidden = expanded;
    $("#orbStatusCard").disabled = !preview?.sessionId && !state.selectedSessionId;
    $("#orbSessionList").hidden = !state.compactHistoryOpen;
    $("#orbReplyForm").hidden = !state.compactReplyOpen;
    compactButton.classList.toggle("active", expanded);
    compactButton.setAttribute("aria-pressed", String(expanded));
    compactButton.title = compactButtonLabel;
    compactButton.setAttribute("aria-label", compactButtonLabel);
    compactButton.querySelector("use")?.setAttribute("href", expanded ? "#icon-close" : "#icon-chat");
    const badge = $("#orbPanelCount");
    badge.textContent = badgeCount > 9 ? "9+" : String(badgeCount);
    badge.classList.toggle("visible", !expanded && badgeCount > 0);
    $("#orbReplyTitle").textContent = replyTitle;
    $("#orbReplyFeedback").textContent = state.compactReplyError;
    $("#orbReplySend").disabled = state.compactReplyBusy;
    // Committed only once every write above has happened. Caching the signature first meant
    // that a single throw anywhere in this block froze the orb at its last painted state for
    // the rest of the session, because every later call matched and returned early.
    state.compactStatusDomSignature = domSignature;
    publishCompactHitAreas();
  }
  const compactStatus = { active, expanded, label, text };
  const ipcSignature = JSON.stringify([active, expanded, label, text]);
  if (ipcSignature !== state.compactStatusIpcSignature) {
    const previousExpanded = state.compactStatusExpanded;
    state.compactStatusExpanded = expanded;
    state.compactStatusIpcSignature = ipcSignature;
    // Opening quick reply takes the orb from 172 px to 460 px, and that resize happens in
    // the main process. The DOM already showed the wide layout, so for a frame or two it
    // was laid out inside the narrow window and then snapped — the visible jerk when the
    // chat button is pressed in Avatar mode.
    //
    // setCompactStatus is an invoke, so the native resize can be awaited: the panel is
    // held back until the window is the size it is going to be, then animates in.
    const resizing = expanded !== previousExpanded;
    let settled = !resizing;
    const settle = () => {
      if (settled) return;
      settled = true;
      clearTimeout(state.compactResizeTimer);
      requestAnimationFrame(() => document.body.classList.remove("compact-resizing"));
    };
    if (resizing) {
      document.body.classList.add("compact-resizing");
      // A hung or stubbed IPC must never leave the panel invisible. The deadline is longer
      // than a real resize and shorter than a user would notice as broken, so the worst
      // case is the old jerk rather than a blank orb.
      clearTimeout(state.compactResizeTimer);
      state.compactResizeTimer = setTimeout(settle, COMPACT_RESIZE_SETTLE_TIMEOUT);
    }
    window.widget.setCompactStatus(compactStatus).then(() => {
      settle();
      publishCompactHitAreas();
    }, () => {
      settle();
      // Roll the expanded flag back too. Keeping it meant the retry computed "no resize",
      // never held the panel back, and the jerk this whole block exists to remove returned
      // after the first failed call.
      if (state.compactStatusIpcSignature !== ipcSignature) return;
      state.compactStatusIpcSignature = "";
      state.compactStatusExpanded = previousExpanded;
    });
  }
}

// Only the pixels that draw something should take the mouse. Everything else in the orb
// window forwards clicks to whatever is behind it, so the widget stops being a transparent
// slab over the desktop. The rectangles are measured live because the controls swap sides
// with the dock and the panel changes size.
function publishCompactHitAreas() {
  if (!window.widget.setCompactHitAreas || state.windowMode !== "orb") return;
  const areas = [];
  for (const selector of ["#orbRestore", "#orbHistoryButton", "#orbStatus"]) {
    const element = $(selector);
    if (!element || element.hidden || !element.offsetParent) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;
    areas.push({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
  }
  const signature = JSON.stringify(areas);
  if (signature === state.compactHitAreaSignature) return;
  state.compactHitAreaSignature = signature;
  window.widget.setCompactHitAreas(areas);
}

function syncGameBarSelection() {
  if (state.gameBarSelectedSessionId === state.selectedSessionId) return false;
  state.gameBarSelectedSessionId = state.selectedSessionId;
  window.widget.selectGameBarSession(state.selectedSessionId);
  return true;
}

// Chat had neither clock nor background-task count: both were built for the session cards
// in Agents, so the panel the user actually watches during a turn could not say how long
// the model had been working, nor that anything was running underneath it. Same two
// helpers as the cards, and the same shared one-second tick — the clock writes straight
// into its node and stays out of the card's render signature.
function renderActivityMeta(visible = !$("#activityCard").hidden) {
  const session = visible
    ? state.dashboard?.sessions?.find((entry) => entry.sessionId === state.selectedSessionId)
    : null;
  applySessionTime($("#activityTime"), session);
  applyBackgroundTaskCount($("#activityBackground"), activeBackgroundTasks(session));
  scheduleSessionTimers();
}

function syncActivityCard() {
  const activity = state.currentActivity;
  const card = $("#activityCard");
  const hasActivity = Boolean(activity?.text);
  const hasWritingBubble = activity?.kind === "writing" && Boolean($("#messages .live-assistant"));
  const showCard = hasActivity && !hasWritingBubble && (state.showThinking || !LIVE_ACTIVITY_KINDS.has(activity?.kind));
  // Reasoning used to get its own strip: absolutely positioned inside .messages-wrap, with
  // room reserved by padding-top on .messages. That padding scrolls away with the content,
  // so a scrolled log put the strip on top of its first visible row and the widget showed
  // two blocks of text in one place. Every activity kind now shares the one card in flow.
  const thinking = showCard && activity?.kind === "thinking";
  syncCrowdedChatState();
  // Ahead of the early return below: a turn that runs for minutes without changing its
  // label still has to advance its clock and pick up background tasks starting or ending.
  renderActivityMeta(showCard);
  const signature = showCard ? JSON.stringify([true, activity?.kind || "", activity?.label || "", activity?.text || ""]) : "hidden";
  if (signature === state.activityCardSignature) return false;
  const messageLayout = captureMessageLayoutSnapshot();
  state.activityCardSignature = signature;
  card.hidden = !showCard;
  card.setAttribute("aria-hidden", String(!showCard));
  card.classList.toggle("has-activity", showCard);
  card.classList.toggle("thinking-activity", thinking);
  if (showCard) {
    $("#activityLabel").textContent = activity.label || "Activity";
    // Reasoning arrives as one growing string; its tail is the part that is still news.
    $("#activityPreview").textContent = thinking
      ? compactRecentText(activity.text, 110)
      : compactText(activity.text, 110);
    $("#activityBody").textContent = activity.text;
  }
  restoreMessageLayoutSnapshot(messageLayout);
  if (messageLayout && !messageLayout.pinned) {
    state.messagesStickToBottom = false;
    updateScrollLatestButton();
  }
  return true;
}

function setActivity(activity) {
  const next = activity || null;
  const previous = state.currentActivity;
  const unchanged = Boolean(previous) === Boolean(next)
    && (!next || ["active", "kind", "label", "text"].every((key) => previous?.[key] === next[key]));
  if (unchanged) return false;
  state.currentActivity = next;
  document.body.classList.remove("activity-thinking", "activity-writing", "activity-tool");
  if (activity?.active && ["thinking", "writing", "tool"].includes(activity.kind)) {
    document.body.classList.add(`activity-${activity.kind}`);
  }
  syncActivityCard();
  syncCompactStatus();
  return true;
}

function setAvatar(mode, label) {
  if (mode !== "done") clearCompletionSignal();
  const text = label === "" ? "" : (label || AVATAR_LABELS[mode] || "ready");
  // The poll re-asserts the same state every 2.5s. Rewriting className, the image src and
  // the body state class when nothing changed restarted avatar-shake on every tick, which
  // is why a failed agent made the widget twitch about once every three seconds.
  if (state.avatarMode !== mode || state.avatarLabel !== text) {
    state.avatarMode = mode;
    state.avatarLabel = text;
    const shell = $("#avatarShell");
    shell.className = `avatar-shell ${mode}`;
    document.querySelectorAll("[data-avatar]").forEach((image) => {
      const next = AVATARS[mode] || AVATARS.idle;
      if (!image.src.endsWith(next)) image.src = next;
    });
    $("#avatarState").textContent = text;
    document.body.classList.remove("state-idle", "state-working", "state-waiting", "state-error", "state-done");
    document.body.classList.add(`state-${mode}`);
  }
  syncCompactStatus();
}

function renderNotifications() {
  document.querySelectorAll("[data-notification]").forEach((badge) => {
    badge.textContent = state.unread > 99 ? "99+" : String(state.unread);
    badge.classList.toggle("visible", state.unread > 0);
  });
}

function clearCompletionSignal() {
  clearTimeout(state.completionSignalTimer);
  state.completionSignalTimer = null;
  document.body.classList.remove("completion-celebration");
}

function syncUnacknowledgedErrors() {
  state.compactErrorUnread = state.unacknowledgedErrorSessionIds.size > 0;
  return state.compactErrorUnread;
}

function acknowledgeSessionError(sessionId) {
  if (sessionId) state.unacknowledgedErrorSessionIds.delete(sessionId);
  if (sessionId && state.compactNotification?.kind === "error" && state.compactNotification.sessionId === sessionId) {
    clearTimeout(state.compactNotificationTimer);
    state.compactNotificationTimer = null;
    state.compactNotification = null;
    state.compactStatusClosing = false;
  }
  syncUnacknowledgedErrors();
}

function clearAcknowledgedErrorPresentation() {
  if (state.compactErrorUnread || state.harnessOffline || state.avatarMode !== "error") return false;
  const commandFeedback = commandFeedbackFor(state.selectedSessionId);
  if (commandFeedback?.avatarMode === "error") setCommandFeedback(state.selectedSessionId, null);
  if (state.currentActivity?.kind === "error") {
    state.currentActivity = null;
    syncActivityCard();
  }
  setAvatar("idle");
  return true;
}

function signalSessionError(session, label = "model error", text = "The current Harness turn ended with an error.") {
  const sessionId = session?.sessionId || null;
  if (sessionId && state.errorSignalSessionIds.has(sessionId)) return false;
  if (sessionId) {
    state.errorSignalSessionIds.add(sessionId);
    state.completedSignalSessionIds.delete(sessionId);
  }
  clearCompletionSignal();
  clearTimeout(state.compactNotificationTimer);
  state.compactNotificationTimer = null;
  state.compactNotification = null;
  state.compactStatusClosing = false;
  const visibleInFull = state.windowMode === "full" && (!sessionId || sessionId === state.selectedSessionId);
  if (sessionId && !visibleInFull) state.unacknowledgedErrorSessionIds.add(sessionId);
  if (sessionId && !visibleInFull) {
    state.compactNotification = {
      kind: "error",
      sessionId,
      title: session?.title || "Session needs attention",
      text: session?.preview || text,
    };
  }
  syncUnacknowledgedErrors();
  if (state.windowMode !== "full" || visibleInFull) {
    setAvatar("error", label);
    setActivity({ active: true, kind: "error", label: "Turn failed", text });
  } else {
    syncCompactStatus();
  }
  return true;
}

function notifyCompletion(session) {
  const sessionId = session?.sessionId || null;
  if (sessionId && state.completedSignalSessionIds.has(sessionId)) return false;
  if (sessionId) {
    state.completedSignalSessionIds.add(sessionId);
    state.errorSignalSessionIds.delete(sessionId);
    state.unacknowledgedErrorSessionIds.delete(sessionId);
  }
  const visuallyRelevant = state.windowMode !== "full" || !sessionId || sessionId === state.selectedSessionId;
  if (!visuallyRelevant) return true;
  clearCompletionSignal();
  syncUnacknowledgedErrors();
  setAvatar("done");
  animateScrollLatestCompletion(sessionId);
  document.body.classList.add("completion-celebration");
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
      state.compactStatusClosing = !state.compactHistoryOpen && !state.compactReplyOpen;
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
  state.completionSignalTimer = setTimeout(() => {
    document.body.classList.remove("completion-celebration");
    state.completionSignalTimer = null;
    if (!state.dashboard?.sessions?.some((session) => session.running)) {
      if (state.avatarMode === "done") setAvatar("idle");
      if (state.currentActivity?.kind === "done") setActivity(null);
    }
  }, 2600);
  return true;
}

const MODE_EXIT_DURATION = 145;
const MODE_ENTER_DURATION = 390;
const FIRST_VISIBLE_ENTRY_DURATION = 460;
// Upper bound on waiting for the native compact resize before showing the panel anyway.
const COMPACT_RESIZE_SETTLE_TIMEOUT = 320;
// An opened queue editor grows with its content and then scrolls, so a pasted script
// cannot push the composer off the panel.
const QUEUE_EDIT_MAX_HEIGHT = 132;
let modeTransitionSequence = 0;
let modeRequestSequence = 0;
let firstVisibleEntryPlayed = false;

function playFirstVisibleEntry() {
  if (firstVisibleEntryPlayed) return false;
  firstVisibleEntryPlayed = true;
  document.body.classList.remove("pre-native-visible");
  if (prefersReducedMotion()) return false;
  void document.body.offsetWidth;
  document.body.classList.add("first-visible-entry");
  setTimeout(() => document.body.classList.remove("first-visible-entry"), FIRST_VISIBLE_ENTRY_DURATION);
  return true;
}

function clearModeTransitionClasses(kind) {
  const prefix = kind === "out" ? "mode-transition-to-" : "mode-transition-from-";
  document.body.classList.remove(`mode-transition-${kind}`);
  [...document.body.classList].filter((name) => name.startsWith(prefix)).forEach((name) => document.body.classList.remove(name));
}

function prefersReducedMotion() {
  return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

function animateModeExit(targetMode, requestSequence) {
  if (targetMode === state.windowMode || prefersReducedMotion()) return Promise.resolve(requestSequence === modeRequestSequence);
  const transitionSequence = ++modeTransitionSequence;
  clearModeTransitionClasses("out");
  void document.body.offsetWidth;
  document.body.classList.add("mode-transition-out", `mode-transition-to-${targetMode}`);
  return new Promise((resolve) => {
    setTimeout(() => {
      const currentTransition = transitionSequence === modeTransitionSequence;
      if (currentTransition) clearModeTransitionClasses("out");
      resolve(currentTransition && requestSequence === modeRequestSequence);
    }, MODE_EXIT_DURATION);
  });
}

function animateModeEnter(previousMode) {
  if (prefersReducedMotion()) return;
  const sequence = ++modeTransitionSequence;
  clearModeTransitionClasses("in");
  void document.body.offsetWidth;
  document.body.classList.add("mode-transition-in", `mode-transition-from-${previousMode}`);
  setTimeout(() => {
    if (sequence === modeTransitionSequence) clearModeTransitionClasses("in");
  }, MODE_ENTER_DURATION);
}

function applyWindowMode(mode) {
  const previousMode = state.windowMode;
  if (mode === previousMode) {
    syncCompactStatus();
    return;
  }
  clearModeTransitionClasses("out");
  state.windowMode = mode;
  document.body.classList.remove("mode-full", "mode-orb", "mode-edge");
  document.body.classList.add(`mode-${mode}`);
  syncCrowdedChatState();
  if (mode !== "edge") window.widget.setEdgePointerActive(true);
  if (mode === "full") {
    acknowledgeSessionError(state.selectedSessionId);
    clearAcknowledgedErrorPresentation();
    state.unread = 0;
    renderNotifications();
  } else if (state.compactErrorUnread && !state.harnessOffline) {
    const pendingSession = state.dashboard?.sessions?.find((session) => state.unacknowledgedErrorSessionIds.has(session.sessionId));
    setAvatar("error", "needs attention");
    setActivity({ active: true, kind: "error", label: "Turn failed", text: pendingSession?.preview || "A session needs attention." });
  } else if (state.avatarMode === "error" && !state.compactErrorUnread && !state.harnessOffline) {
    setAvatar("idle");
    if (state.currentActivity?.kind === "error") setActivity(null);
  }
  animateModeEnter(previousMode);
  syncCompactStatus();
  // syncCompactStatus only republishes when its own signature changed, and entering avatar
  // mode usually changes nothing it tracks — so the measurement has to be forced here, or
  // the freshly shown orb would keep the whole window interactive until something else moved.
  state.compactHitAreaSignature = "";
  requestAnimationFrame(publishCompactHitAreas);
}

async function setWindowMode(mode) {
  if (mode === "edge" && state.platformPresentation?.edgeAvailable === false) return state.windowMode;
  if (mode !== "full") clearAcknowledgedErrorPresentation();
  const requestSequence = ++modeRequestSequence;
  if (!await animateModeExit(mode, requestSequence) || requestSequence !== modeRequestSequence) return state.windowMode;
  const appliedMode = await window.widget.setWindowMode(mode);
  if (requestSequence !== modeRequestSequence) return state.windowMode;
  applyWindowMode(appliedMode);
  return state.windowMode;
}

function applyAuthoritativeWindowMode(mode) {
  // Native hotkeys, tray actions, and the main-process acknowledgement all outrank
  // a renderer request that is still waiting for its exit animation or IPC reply.
  modeRequestSequence += 1;
  clearModeTransitionClasses("out");
  applyWindowMode(mode);
}

function applyCompactSide(side) {
  document.body.classList.toggle("side-left", side === "left");
  document.body.classList.toggle("side-right", side !== "left");
}

let compactDrag = null;
let suppressCompactClick = false;
let fullDrag = null;
let compactDragMoveFrame = 0;
let compactDragPendingPoint = null;
let fullDragMoveFrame = 0;
let fullDragPendingPoint = null;
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

function animateEdgeDrop() {
  const edge = $("#edgeMode");
  edge.classList.remove("edge-drop");
  void edge.offsetWidth;
  edge.classList.add("edge-drop");
  setTimeout(() => edge.classList.remove("edge-drop"), 620);
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

function syncRunningControls(running) {
  const stopping = Boolean(state.selectedSessionId && state.cancelBusySessionId === state.selectedSessionId);
  const signature = JSON.stringify([Boolean(running), stopping]);
  if (signature === state.runningControlsSignature) return false;
  state.runningControlsSignature = signature;
  $("#chatForm").classList.toggle("has-running", Boolean(running));
  const button = $("#cancelButton");
  button.hidden = !running;
  button.disabled = stopping;
  button.title = stopping ? "Stopping current turn…" : "Stop current turn";
  button.setAttribute("aria-label", button.title);
  return true;
}

function canStartFullDrag(event) {
  const titlebar = event.currentTarget;
  if (!titlebar?.classList?.contains("titlebar") || !event.target.closest?.(".titlebar")) return false;
  if (event.target.closest(".tabs, .window-actions, .picker, #headerUpdateButton")) return false;
  const interactive = event.target.closest("button, a, input, textarea, select, summary, [role='button'], [role='tab'], [role='menuitem'], [contenteditable='true']");
  return !interactive || Boolean(interactive.closest("#avatarButton, #projectLink"));
}

function beginFullDrag(event) {
  if (event.button !== 0 || state.platformPresentation?.positionAvailable === false || !canStartFullDrag(event)) return;
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

function scheduleFullDragMove(point) {
  fullDragPendingPoint = point;
  if (fullDragMoveFrame) return;
  fullDragMoveFrame = requestAnimationFrame(() => {
    fullDragMoveFrame = 0;
    const next = fullDragPendingPoint;
    fullDragPendingPoint = null;
    if (next && fullDrag) window.widget.moveFullDrag(next);
  });
}

function flushFullDragMove() {
  if (fullDragMoveFrame) cancelAnimationFrame(fullDragMoveFrame);
  fullDragMoveFrame = 0;
  const next = fullDragPendingPoint;
  fullDragPendingPoint = null;
  if (next && fullDrag) window.widget.moveFullDrag(next);
}

function moveFullDrag(event) {
  if (!fullDrag || fullDrag.pointerId !== event.pointerId) return;
  if (!fullDrag.moved && Math.hypot(event.screenX - fullDrag.startX, event.screenY - fullDrag.startY) < 4) return;
  fullDrag.moved = true;
  suppressBrandClickAfterDrag();
  event.preventDefault();
  scheduleFullDragMove({ x: event.screenX, y: event.screenY });
}

function endFullDrag(event) {
  if (!fullDrag || fullDrag.pointerId !== event.pointerId) return;
  const moved = fullDrag.moved;
  const origin = fullDrag.origin;
  fullDrag.target.releasePointerCapture?.(event.pointerId);
  flushFullDragMove();
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

// Avatar mode is dragged BY THE CIRCLE, not by the 172x128 window around it. Treating the
// whole window as a drag handle meant a click anywhere near the avatar picked the widget up,
// including the transparent space the user was aiming past. Edge mode keeps the old rule:
// its window is one thin line with nothing else in it.
function compactDragHandle(target) {
  if (!target || typeof target.closest !== "function") return null;
  if (state.windowMode === "orb") return target.closest("#orbRestore");
  return target.closest("#orbStatus, #orbHistoryButton") ? null : target;
}

function beginCompactDrag(event) {
  if (event.button !== 0 || state.platformPresentation?.positionAvailable === false) return;
  if (!compactDragHandle(event.target)) return;
  compactDrag = {
    target: event.currentTarget,
    pointerId: event.pointerId,
    startX: event.screenX,
    startY: event.screenY,
    moved: false,
    nativeStarted: false,
  };
}

function scheduleCompactDragMove(point) {
  compactDragPendingPoint = point;
  if (compactDragMoveFrame) return;
  compactDragMoveFrame = requestAnimationFrame(() => {
    compactDragMoveFrame = 0;
    const next = compactDragPendingPoint;
    compactDragPendingPoint = null;
    if (next && compactDrag) window.widget.moveCompactDrag(next);
  });
}

function flushCompactDragMove() {
  if (compactDragMoveFrame) cancelAnimationFrame(compactDragMoveFrame);
  compactDragMoveFrame = 0;
  const next = compactDragPendingPoint;
  compactDragPendingPoint = null;
  if (next && compactDrag) window.widget.moveCompactDrag(next);
}

function moveCompactDrag(event) {
  if (!compactDrag || compactDrag.pointerId !== event.pointerId) return;
  const dx = event.screenX - compactDrag.startX;
  const dy = event.screenY - compactDrag.startY;
  if (!compactDrag.moved && Math.hypot(dx, dy) < 4) return;
  if (!compactDrag.nativeStarted) {
    compactDrag.nativeStarted = true;
    compactDrag.moved = true;
    compactDrag.target.setPointerCapture?.(event.pointerId);
    window.widget.beginCompactDrag({ x: compactDrag.startX, y: compactDrag.startY });
  }
  event.preventDefault();
  scheduleCompactDragMove({ x: event.screenX, y: event.screenY });
}

async function endCompactDrag(event) {
  if (!compactDrag || compactDrag.pointerId !== event.pointerId) return;
  const moved = compactDrag.moved;
  const nativeStarted = compactDrag.nativeStarted;
  if (nativeStarted) compactDrag.target.releasePointerCapture?.(event.pointerId);
  if (nativeStarted) flushCompactDragMove();
  compactDrag = null;
  // The click event fires synchronously right after pointerup, long before this IPC
  // round trip resolves. Arming the guard after the await let every drag release
  // fall through to the click handler and restore the full widget.
  if (moved) {
    event.preventDefault();
    suppressCompactClick = true;
  }
  if (!nativeStarted) return;
  const result = await window.widget.endCompactDrag().catch(() => null);
  if (result?.side) applyCompactSide(result.side);
  if (state.windowMode === "edge") {
    setEdgePointerActive(false);
    animateEdgeDrop();
  }
  setTimeout(() => { suppressCompactClick = false; }, 0);
}

function initials(title) {
  return String(title || "AI").split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase();
}

// Background tasks are Harness subagents running under a session. The card used to spell
// out "2 subagents" — the roster size, including children that had already finished — which
// spent most of a narrow card's width to say something that was often no longer true. What
// is worth knowing at a glance is how many are working right now, so that is all it says.
function activeBackgroundTasks(session) {
  return (session?.subagents || []).filter((child) => child.kind === "child" && child.activity === "running").length;
}

function applyBackgroundTaskCount(node, count) {
  if (!node) return;
  // Written into the <b>, never onto the wrapper: textContent on the wrapper would delete
  // the icon beside it, and the icon is what makes a bare number mean anything.
  const value = node.querySelector("b");
  if (value) value.textContent = count > 9 ? "9+" : String(count);
  node.classList.toggle("visible", count > 0);
  node.title = count ? `${count} background task${count === 1 ? "" : "s"} running` : "";
  node.setAttribute("aria-label", node.title);
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
  const signature = JSON.stringify([
    state.selectedSessionId,
    pressure ? Math.round(pressure.used) : null,
    pressure ? Math.round(pressure.total) : null,
    pressure ? Math.round(pressure.percent) : null,
  ]);
  if (signature === state.contextSignature) return false;
  state.contextSignature = signature;
  const meter = $("#contextMeter");
  meter.classList.remove("high", "critical");
  meter.classList.toggle("unavailable", !pressure);
  $("#chatForm").classList.toggle("context-unavailable", !pressure);
  if (!pressure) {
    meter.style.setProperty("--context", "0");
    $("#contextArc").style.strokeDashoffset = "97.39";
    $("#contextValue").textContent = "0%";
    meter.title = "Context usage unavailable";
    meter.setAttribute("aria-valuenow", "0");
    meter.setAttribute("aria-valuetext", "Context usage unavailable, 0%");
    return true;
  }
  const rounded = Math.round(pressure.percent);
  meter.style.setProperty("--context", String(rounded));
  $("#contextArc").style.strokeDashoffset = String(97.39 * (1 - rounded / 100));
  $("#contextValue").textContent = `${rounded}%`;
  meter.title = `Context: ${formatTokens(pressure.used)} / ${formatTokens(pressure.total)} tokens`;
  meter.setAttribute("aria-valuenow", String(rounded));
  meter.setAttribute("aria-valuetext", `Context usage ${rounded}%, ${formatTokens(pressure.used)} of ${formatTokens(pressure.total)} tokens`);
  meter.classList.toggle("high", rounded >= 70 && rounded < 90);
  meter.classList.toggle("critical", rounded >= 90);
  return true;
}

function groupedSessions(selectedSessionId = state.selectedSessionId) {
  return window.sessionGroups.groupSessions(
    state.dashboard?.sessions || [],
    state.dashboard?.workspaces || state.workspaces || [],
    state.dashboard?.archivedSessionIds || [],
    selectedSessionId,
  );
}

function visibleSessions(selectedSessionId = state.selectedSessionId) {
  return groupedSessions(selectedSessionId).flatMap((group) => group.sessions);
}

// Null-safe because the chat clock asks about the selected session, and Chat can be open
// with no session at all — every other caller holds a real one from the dashboard list.
function sessionAgentState(session) {
  return ["working", "error"].includes(session?.state) ? session.state : (session?.running ? "working" : "idle");
}

// "How long has it been working?" is the first thing anyone asks a list of running agents,
// and the widget made them guess. Below a minute the seconds matter; past an hour they do
// not, so they are dropped rather than shown ticking at the end of a long number.
function formatWorkDuration(ms) {
  const total = Math.max(0, Math.round(Number(ms) || 0) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = Math.floor(total % 60);
  if (hours) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

// The elapsed clock is written straight into the node and deliberately left out of every
// render signature: a value that changes every second would otherwise rebuild the whole
// session list once a second, and nothing else on the card has changed.
function applySessionTime(node, session) {
  if (!node) return;
  const runningSince = Number(session?.runningSince);
  const live = sessionAgentState(session) === "working" && Number.isFinite(runningSince) && runningSince > 0;
  const lastRun = Number(session?.lastRunMs);
  node.dataset.runningSince = live ? String(runningSince) : "";
  node.classList.toggle("running", live);
  if (live) {
    node.textContent = formatWorkDuration(Date.now() - runningSince);
    node.title = "Time on the current turn";
  } else if (Number.isFinite(lastRun) && lastRun > 0) {
    node.textContent = formatWorkDuration(lastRun);
    node.title = "Duration of the last turn";
  } else {
    node.textContent = "";
    node.title = "";
  }
}

function refreshSessionTimers() {
  const now = Date.now();
  let live = 0;
  for (const node of $$("[data-running-since]")) {
    const since = Number(node.dataset.runningSince);
    if (!Number.isFinite(since) || since <= 0) continue;
    live += 1;
    node.textContent = formatWorkDuration(now - since);
  }
  return live;
}

// One interval for the whole list, and only while something is actually running.
function scheduleSessionTimers() {
  const live = refreshSessionTimers();
  if (live && !state.sessionTimerTick) {
    state.sessionTimerTick = setInterval(() => {
      if (!refreshSessionTimers()) scheduleSessionTimers();
    }, 1000);
  } else if (!live && state.sessionTimerTick) {
    clearInterval(state.sessionTimerTick);
    state.sessionTimerTick = null;
  }
  return live;
}

function updateSessionCard(card, session) {
  const agentState = sessionAgentState(session);
  card.dataset.sessionId = session.sessionId;
  card.className = `session-card state-${agentState}${session.sessionId === state.selectedSessionId ? " selected" : ""}`;
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `Open ${session.title || "New session"}`);
  const background = activeBackgroundTasks(session);
  const pressure = contextPressure(session);
  card.querySelector(".agent-avatar").className = `agent-avatar ${agentState}`;
  card.querySelector(".agent-avatar img").src = AVATARS[agentState] || AVATARS.idle;
  card.querySelector(".session-name").textContent = session.title || "New session";
  card.querySelector(".session-meta-text").textContent = `${agentState}${pressure ? ` · ${Math.round(pressure.percent)}% ctx` : ""}`;
  applyBackgroundTaskCount(card.querySelector(".session-background"), background);
  applySessionTime(card.querySelector(".session-time"), session);
  const status = card.querySelector(".session-state");
  status.className = `session-state ${agentState}`;
  status.textContent = agentState;
}

function createSessionCard(session) {
  const card = document.createElement("div");
  const avatar = document.createElement("div");
  avatar.className = "agent-avatar";
  const avatarImage = document.createElement("img");
  avatarImage.alt = "";
  avatar.append(avatarImage);
  const main = document.createElement("div");
  main.className = "session-main";
  const name = document.createElement("div");
  name.className = "session-name";
  const meta = document.createElement("div");
  meta.className = "session-meta";
  const metaText = document.createElement("span");
  metaText.className = "session-meta-text";
  const metaTime = document.createElement("span");
  metaTime.className = "session-time";
  const metaBackground = document.createElement("span");
  metaBackground.className = "session-background";
  metaBackground.append(createIcon("agents"), document.createElement("b"));
  meta.append(metaText, metaTime, metaBackground);
  main.append(name, meta);
  const status = document.createElement("div");
  status.className = "session-state";
  card.append(avatar, main, status);
  const activate = () => selectSession(card.dataset.sessionId, true);
  card.addEventListener("click", activate);
  card.addEventListener("keydown", (event) => {
    if (!["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    activate();
  });
  updateSessionCard(card, session);
  return card;
}

function toggleSessionGroup(groupKey) {
  if (state.collapsedSessionGroupKeys.has(groupKey)) state.collapsedSessionGroupKeys.delete(groupKey);
  else state.collapsedSessionGroupKeys.add(groupKey);
  state.sessionListSignature = "";
  state.sessionSelectSignature = "";
  renderSessions();
  renderSessionSelect();
}

function createSessionGroup(group, { picker = false } = {}) {
  const wrapper = document.createElement("section");
  const heading = document.createElement("div");
  heading.className = "session-group-heading";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "session-group-toggle";
  toggle.append(createIcon("folder"));
  const label = document.createElement("span");
  const count = document.createElement("small");
  toggle.append(label, count, createIcon("chevron", "ui-icon session-group-chevron"));
  toggle.addEventListener("click", () => toggleSessionGroup(wrapper.dataset.groupKey));
  const add = document.createElement("button");
  add.type = "button";
  add.className = "session-group-add";
  add.append(createIcon("plus"));
  add.addEventListener("click", async () => {
    closePickers();
    await createNewSession({ workspaceId: wrapper.dataset.workspaceId || null });
  });
  heading.append(toggle, add);
  const body = document.createElement("div");
  body.className = "session-group-items";
  wrapper.append(heading, body);
  updateSessionGroup(wrapper, group, { picker });
  return { wrapper, body };
}

function updateSessionGroup(wrapper, group, { picker = false } = {}) {
  const collapsed = state.collapsedSessionGroupKeys.has(group.key);
  wrapper.className = `session-group${picker ? " picker-session-group" : ""}${collapsed ? " collapsed" : ""}`;
  wrapper.dataset.groupKey = group.key;
  wrapper.dataset.workspaceId = group.workspaceId || "";
  wrapper.setAttribute("role", "group");
  wrapper.setAttribute("aria-label", group.label);
  const toggle = wrapper.querySelector(".session-group-toggle");
  toggle.title = `${collapsed ? "Expand" : "Collapse"} ${group.label}`;
  toggle.setAttribute("aria-expanded", String(!collapsed));
  const label = toggle.querySelector("span");
  label.textContent = group.label;
  label.title = group.path || group.label;
  toggle.querySelector("small").textContent = String(group.sessions.length);
  const add = wrapper.querySelector(".session-group-add");
  add.title = group.workspaceId ? `New session in ${group.label}` : "New ungrouped session";
  add.setAttribute("aria-label", add.title);
  wrapper.querySelector(".session-group-items").hidden = collapsed;
}

function sessionGroupElements(root) {
  return [...root.children].filter((element) => element.classList.contains("session-group"));
}

function canPatchSessionGroups(root, groups, { picker = false } = {}) {
  const wrappers = sessionGroupElements(root);
  if (wrappers.length !== groups.length) return false;
  return groups.every((group, index) => {
    const wrapper = wrappers[index];
    if (wrapper.dataset.groupKey !== group.key || wrapper.classList.contains("picker-session-group") !== picker) return false;
    const items = [...wrapper.querySelector(".session-group-items").children];
    return items.length === group.sessions.length && group.sessions.every((session, itemIndex) => {
      const item = items[itemIndex];
      return (picker ? item.dataset.optionKey : item.dataset.sessionId) === session.sessionId;
    });
  });
}

function updatePickerSessionOption(option, session) {
  const pressure = contextPressure(session);
  const agentState = sessionAgentState(session);
  const selected = session.sessionId === state.selectedSessionId;
  option.classList.toggle("selected", selected);
  option.classList.remove("state-idle", "state-working", "state-error");
  option.classList.add(`state-${agentState}`);
  option.setAttribute("aria-selected", String(selected));
  option.title = session.cwd || session.title || "New session";
  option.querySelector("span").textContent = session.title || "New session";
  let meta = option.querySelector("small");
  if (!meta) {
    meta = document.createElement("small");
    option.append(meta);
  }
  meta.textContent = agentState === "working"
    ? "working"
    : agentState === "error"
      ? "error"
      : pressure
        ? `idle · ${Math.round(pressure.percent)}%`
        : "idle";
  let elapsed = option.querySelector(".session-time");
  if (!elapsed) {
    elapsed = document.createElement("small");
    elapsed.className = "session-time";
    meta.after(elapsed);
  }
  applySessionTime(elapsed, session);
  const mark = option.querySelector(".picker-check");
  mark.replaceChildren();
  if (selected) mark.append(createIcon("check"));
}

function renderSessions() {
  const root = $("#sessions");
  const groups = groupedSessions();
  const signature = JSON.stringify([
    Boolean(state.dashboard?.harness),
    state.selectedSessionId,
    [...state.collapsedSessionGroupKeys].sort(),
    ...groups.map((group) => [group.key, group.label, group.path, ...group.sessions.map((session) => {
      const pressure = contextPressure(session);
      return [session.sessionId, session.title || "", sessionAgentState(session), activeBackgroundTasks(session), pressure ? Math.round(pressure.percent) : null];
    })]),
  ]);
  if (signature === state.sessionListSignature && root.childElementCount) return false;
  state.sessionListSignature = signature;
  if (!state.dashboard?.harness) {
    root.replaceChildren();
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Start Harness to load sessions.";
    root.append(empty);
    return true;
  }
  if (canPatchSessionGroups(root, groups)) {
    sessionGroupElements(root).forEach((wrapper, groupIndex) => {
      const group = groups[groupIndex];
      updateSessionGroup(wrapper, group);
      [...wrapper.querySelector(".session-group-items").children].forEach((card, sessionIndex) => updateSessionCard(card, group.sessions[sessionIndex]));
    });
    scheduleSessionTimers();
    return true;
  }
  root.replaceChildren();
  for (const group of groups) {
    const { wrapper, body } = createSessionGroup(group);
    group.sessions.forEach((session) => body.append(createSessionCard(session)));
    root.append(wrapper);
  }
  scheduleSessionTimers();
  return true;
}

function renderSessionSelect() {
  const sessions = state.dashboard?.sessions || [];
  const selected = sessions.find((session) => session.sessionId === state.selectedSessionId);
  const groups = groupedSessions();
  const root = $("#sessionOptions");
  const signature = JSON.stringify([
    state.selectedSessionId,
    [...state.collapsedSessionGroupKeys].sort(),
    ...groups.map((group) => [group.key, group.label, group.path, ...group.sessions.map((session) => {
      const pressure = contextPressure(session);
      return [session.sessionId, session.title || "", sessionAgentState(session), pressure ? Math.round(pressure.percent) : null];
    })]),
  ]);
  if (signature === state.sessionSelectSignature && root.childElementCount) return false;
  state.sessionSelectSignature = signature;
  $("#openSessionButton").disabled = !state.selectedSessionId;
  $("#openSessionButton").title = selected
    ? `Open ${selected.title || "current session"} in DeepSeek Harness`
    : "Select a session to open it in DeepSeek Harness";
  $("#sessionButtonText").textContent = selected?.title || "New session";
  const currentNewOption = root.firstElementChild;
  if (currentNewOption?.dataset.optionKey === "__new__" && canPatchSessionGroups(root, groups, { picker: true })) {
    sessionGroupElements(root).forEach((wrapper, groupIndex) => {
      const group = groups[groupIndex];
      updateSessionGroup(wrapper, group, { picker: true });
      [...wrapper.querySelector(".session-group-items").children].forEach((option, sessionIndex) => updatePickerSessionOption(option, group.sessions[sessionIndex]));
    });
    return true;
  }
  root.replaceChildren();
  root.append(pickerOption("New ungrouped session", {
    meta: "new",
    key: "__new__",
    onSelect: async () => {
      closePickers();
      await createNewSession({ workspaceId: null });
    },
  }));
  for (const group of groups) {
    const { wrapper, body } = createSessionGroup(group, { picker: true });
    for (const session of group.sessions) {
      const pressure = contextPressure(session);
      const option = pickerOption(session.title || "New session", {
        selected: session.sessionId === state.selectedSessionId,
        meta: sessionAgentState(session),
        title: session.cwd || session.title,
        key: session.sessionId,
        onSelect: async () => {
          closePickers();
          await selectSession(session.sessionId);
        },
      });
      updatePickerSessionOption(option, session);
      body.append(option);
    }
    root.append(wrapper);
  }
  scheduleSessionTimers();
  return true;
}

function modelSelectionValue(selection) {
  return selection ? JSON.stringify({ provider: selection.provider, model: selection.model }) : "";
}

function effectiveModelSelection() {
  return state.automaticModelRoute ? null : state.pendingSelection || state.modelCatalog?.current || null;
}

function selectedModelDefinition() {
  const selection = effectiveModelSelection();
  if (!selection) return null;
  const group = state.modelCatalog?.groups?.find((item) => item.id === selection.provider);
  return group?.models?.find((item) => item.id === selection.model) || null;
}

function renderReasoning() {
  const model = selectedModelDefinition();
  const efforts = model?.reasoning?.efforts || [];
  const selectedId = effectiveModelSelection()?.reasoningEffort || "";
  const autoLabel = model?.reasoning?.defaultEffort ? `Auto · ${model.reasoning.defaultEffort}` : "Auto";
  const selectedEffort = efforts.find((effort) => effort.id === selectedId);
  $("#reasoningButtonText").textContent = selectedEffort?.name || selectedEffort?.id || autoLabel;
  $("#reasoningButton").disabled = efforts.length === 0;
  const root = $("#reasoningOptions");
  root.replaceChildren();
  root.append(pickerOption(autoLabel, {
    selected: !selectedId,
    onSelect: async () => {
      const base = effectiveModelSelection();
      if (base) {
        state.automaticModelRoute = false;
        state.pendingSelection = { provider: base.provider, model: base.model };
      }
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
        const base = effectiveModelSelection();
        if (!base) return;
        state.automaticModelRoute = false;
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
  const selection = effectiveModelSelection();
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
  const selected = effectiveModelSelection();
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
    onSelect: async () => {
      state.automaticModelRoute = true;
      state.pendingSelection = null;
      closePickers();
      renderModels();
      await applyModelSelection();
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
      const option = pickerOption(model.name || model.id, {
        selected: selected?.provider === group.id && selected?.model === model.id,
        meta: model.reasoning?.efforts?.length ? "reasoning" : "",
        title: `${group.name || group.id} / ${model.name || model.id}`,
        key: modelSelectionValue({ provider: group.id, model: model.id }),
        onSelect: async () => {
          state.automaticModelRoute = false;
          state.pendingSelection = { provider: group.id, model: model.id };
          if (model.reasoning?.defaultEffort) state.pendingSelection.reasoningEffort = model.reasoning.defaultEffort;
          closePickers();
          renderModels();
          await applyModelSelection();
        },
      });
      option.dataset.modelOption = "true";
      root.append(option);
    }
  }
  if (normalized && matches === 0) {
    const empty = document.createElement("div");
    empty.className = "picker-empty";
    empty.textContent = "No matching models";
    root.append(empty);
  }
  if ($(".model-picker")?.classList.contains("open")) requestAnimationFrame(scrollSelectedModelIntoView);
}

function renderModels() {
  const catalog = state.modelCatalog;
  const selected = effectiveModelSelection();
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
  const requestSequence = ++state.modelsRequestSequence;
  const sessionId = state.selectedSessionId;
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
    const catalog = await window.widget.models(sessionId);
    if (requestSequence !== state.modelsRequestSequence || sessionId !== state.selectedSessionId) return;
    state.modelCatalog = catalog;
    if (!state.automaticModelRoute) state.pendingSelection = catalog.current || state.pendingSelection;
    state.modelLoadState = "ready";
  } catch {
    if (requestSequence !== state.modelsRequestSequence || sessionId !== state.selectedSessionId) return;
    state.modelLoadState = "error";
    setAvatar("error", "models unavailable");
  } finally {
    if (requestSequence === state.modelsRequestSequence) {
      state.modelsBusy = false;
      renderModels();
    }
  }
}

function commandQuery() {
  return /^\/([^\s]*)$/.exec($("#messageInput").value)?.[1]?.toLowerCase() || "";
}

function filteredCommands(query = "") {
  const normalized = String(query || "").trim().toLowerCase();
  const commands = normalized
    ? state.commandCatalog.filter((command) => `${command.name} ${command.description || ""}`.toLowerCase().includes(normalized))
    : [...state.commandCatalog];
  return commands.sort((left, right) => {
    const leftOrder = CORE_COMMAND_ORDER.get(String(left.name || "").toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = CORE_COMMAND_ORDER.get(String(right.name || "").toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder || String(left.name || "").localeCompare(String(right.name || ""));
  });
}

function commandGuidance(commandName) {
  switch (String(commandName || "").toLowerCase()) {
    case "goal": return "create <objective> · show · edit <text> · pause · resume · clear";
    case "compact": return "summarize the current context now";
    case "plan": return "on · off";
    case "permission": return "Full access is locked for widget sessions";
    default: return "";
  }
}

function renderCommandHint() {
  const root = $("#commandHintBar");
  if (!root) return;
  const match = /^\/(\S+)/.exec($("#messageInput").value.trim());
  const command = match && state.commandCatalog.find((item) => item.name.toLowerCase() === match[1].toLowerCase());
  const text = command ? commandGuidance(command.name) || command.input?.hint || command.description || "" : "";
  const signature = JSON.stringify([command?.name || "", text]);
  if (signature === state.commandHintSignature) return;
  const messageLayout = captureMessageLayoutSnapshot();
  state.commandHintSignature = signature;
  root.hidden = !text;
  root.replaceChildren();
  if (!text) {
    restoreMessageLayoutSnapshot(messageLayout);
    return;
  }
  const name = document.createElement("b");
  name.textContent = `/${command.name}`;
  const hint = document.createElement("span");
  hint.textContent = text;
  root.append(name, hint);
  restoreMessageLayoutSnapshot(messageLayout);
}

function setCommandMenuOpen(open) {
  const root = $("#commandMenu");
  root.classList.toggle("open", Boolean(open));
  root.setAttribute("aria-hidden", String(!open));
  $("#commandsButton").setAttribute("aria-expanded", String(Boolean(open)));
  if (open) resizeCommandMenu();
}

function chooseCommand(command) {
  if (!command) return;
  const input = $("#messageInput");
  input.value = command.name.toLowerCase() === "permission"
    ? "/permission danger-full-access"
    : `/${command.name}${command.kind === "skill" || command.input?.hint ? " " : ""}`;
  resizeMessageInput();
  input.placeholder = "Run Harness command…";
  state.commandSelectionIndex = 0;
  state.lastCommandQuery = "";
  setCommandMenuOpen(false);
  renderCommandHint();
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
    row.className = `command-row${index === state.commandSelectionIndex ? " selected" : ""}${command.kind === "skill" ? " skill" : ""}`;
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", String(index === state.commandSelectionIndex));
    row.dataset.command = command.name;
    const name = document.createElement("span");
    name.className = "command-name";
    name.textContent = `/${command.name}`;
    const hint = document.createElement("span");
    hint.className = "command-hint";
    // Skills and host commands look the same in the menu but run through different paths,
    // so the badge says which one the user is about to trigger.
    hint.textContent = command.kind === "skill" ? "skill" : command.input?.hint ? "args" : "run";
    const description = document.createElement("span");
    description.className = "command-description";
    description.textContent = commandGuidance(command.name) || command.description || command.name;
    row.title = [command.description, command.input?.hint].filter(Boolean).join(" · ");
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
  resizeCommandMenu();
}

function queuedPromptsFor(sessionId = state.selectedSessionId) {
  return sessionId ? state.queuedPromptsBySession.get(sessionId) || [] : [];
}

function steeringPromptsFor(sessionId = state.selectedSessionId) {
  return sessionId ? state.steeringPromptsBySession.get(sessionId) || [] : [];
}

function queueSnapshotRevision(sessionId) {
  return sessionId ? state.queueSnapshotRevisions.get(sessionId) || 0 : 0;
}

function queueHandoffEpoch(sessionId) {
  return sessionId ? state.queueHandoffEpochs.get(sessionId) || 0 : 0;
}

function applyQueueSnapshot(sessionId, items, revision = null, { replaceOptimistic = false } = {}) {
  if (!sessionId) return;
  const currentRevision = queueSnapshotRevision(sessionId);
  const hasAuthoritativeRevision = revision !== null && revision !== undefined && Number.isFinite(Number(revision));
  const nextRevision = hasAuthoritativeRevision ? Number(revision) : currentRevision + 1;
  const hasSnapshot = state.queuedPromptsBySession.has(sessionId) || state.steeringPromptsBySession.has(sessionId);
  const hasOptimistic = queuedPromptsFor(sessionId).some((item) => item.optimistic);
  const replacesSameRevisionOptimism = replaceOptimistic && hasOptimistic && nextRevision === currentRevision;
  if (hasSnapshot && nextRevision <= currentRevision && !replacesSameRevisionOptimism) return false;
  const safeItems = Array.isArray(items) ? items : [];
  const previousSteeringIds = new Set(steeringPromptsFor(sessionId).map((item) => item.id));
  const steeringItems = safeItems.filter((item) => item?.placement === "steering");
  state.queueSnapshotRevisions.set(sessionId, nextRevision);
  state.queuedPromptsBySession.set(sessionId, safeItems.filter((item) => !item?.placement || item.placement === "queued"));
  state.steeringPromptsBySession.set(sessionId, steeringItems);
  const startedSteering = steeringItems.find((item) => !previousSteeringIds.has(item.id));
  if (startedSteering) beginSteeredTurn(sessionId, startedSteering);
  if (sessionId === state.selectedSessionId) {
    renderQueuedPrompts();
    renderMessages(state.currentMessages);
  }
  return true;
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
  const sessionId = state.selectedSessionId;
  if (!sessionId || !item?.id || item.optimistic) return;
  const expectedSnapshotRevision = queueSnapshotRevision(sessionId);
  const expectedHandoffEpoch = queueHandoffEpoch(sessionId);
  state.queueBusyId = item.id;
  state.queueBusySessionId = sessionId;
  state.queueBusyKind = action.kind;
  renderQueuedPrompts();
  try {
    await window.widget.updateQueue({ sessionId, itemId: item.id, action });
    if (state.queueEditingSessionId === sessionId && state.queueEditingId === item.id) {
      state.queueEditingId = null;
      state.queueEditingSessionId = null;
    }
    if (queueSnapshotRevision(sessionId) !== expectedSnapshotRevision || queueHandoffEpoch(sessionId) !== expectedHandoffEpoch) return;
    const items = queuedPromptsFor(sessionId);
    if (["remove", "steer"].includes(action.kind)) {
      state.queuedPromptsBySession.set(sessionId, items.filter((entry) => entry.id !== item.id));
      if (action.kind === "steer") beginSteeredTurn(sessionId, item);
    } else if (action.kind === "edit") {
      state.queuedPromptsBySession.set(sessionId, items.map((entry) => entry.id === item.id
        ? { ...entry, text: action.text, preview: action.text }
        : entry));
    }
  } catch (error) {
    if (sessionId === state.selectedSessionId) showTransientActivityError(error, "Queue update failed");
  } finally {
    if (state.queueBusyId === item.id && state.queueBusySessionId === sessionId) {
      state.queueBusyId = null;
      state.queueBusySessionId = null;
      state.queueBusyKind = null;
    }
    if (sessionId === state.selectedSessionId) renderQueuedPrompts();
  }
}

function renderQueuedPrompts() {
  const root = $("#queueDock");
  const listRoot = $("#queueList");
  const items = queuedPromptsFor();
  syncCrowdedChatState();
  const signature = JSON.stringify([
    state.selectedSessionId,
    state.queueEditingId,
    state.queueEditingSessionId,
    state.queueBusyId,
    state.queueBusySessionId,
    state.queueExpandedId,
    state.queueExpandedSessionId,
    ...items.map((item) => [item.id, item.text, item.preview, item.attachmentCount, Boolean(item.optimistic)]),
  ]);
  if (signature === state.queueSignature) return false;
  state.queueSignature = signature;
  root.classList.toggle("has-items", items.length > 0);
  const opened = items.some((item) => (state.queueExpandedSessionId === state.selectedSessionId && state.queueExpandedId === item.id)
    || (state.queueEditingSessionId === state.selectedSessionId && state.queueEditingId === item.id));
  root.classList.toggle("opened", opened);
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
    const editing = state.queueEditingSessionId === state.selectedSessionId && state.queueEditingId === item.id;
    const busy = state.queueBusySessionId === state.selectedSessionId && state.queueBusyId === item.id;
    const expanded = state.queueExpandedSessionId === state.selectedSessionId && state.queueExpandedId === item.id;
    row.classList.toggle("expanded", expanded || editing);
    const actions = document.createElement("span");
    actions.className = "queue-actions";
    if (editing) {
      // A textarea, not an input: a queued prompt is regularly a shell command that no one
      // can read — let alone correct — through an eight-pixel single-line window. Enter
      // still saves, because that is what the row has always done; Shift+Enter is the
      // newline, matching the composer.
      const input = document.createElement("textarea");
      input.className = "queue-edit-input";
      input.rows = 1;
      input.value = item.text || "";
      input.setAttribute("aria-label", "Edit queued message");
      const grow = () => {
        input.style.height = "auto";
        input.style.height = `${Math.min(input.scrollHeight, QUEUE_EDIT_MAX_HEIGHT)}px`;
      };
      const save = () => {
        const text = input.value.trim();
        if (text) updateQueuedPrompt(item, { kind: "edit", text });
      };
      input.addEventListener("input", grow);
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); save(); }
        if (event.key === "Escape") { state.queueEditingId = null; state.queueEditingSessionId = null; renderQueuedPrompts(); }
      });
      requestAnimationFrame(grow);
      actions.append(
        queueActionButton("check", "Save queued message", "steer", save, busy),
        queueActionButton("close", "Cancel editing", "", () => { state.queueEditingId = null; state.queueEditingSessionId = null; renderQueuedPrompts(); }, busy),
      );
      row.append(input, actions);
      requestAnimationFrame(() => { input.focus(); input.select(); });
    } else {
      const preview = document.createElement("span");
      preview.className = "queue-preview";
      const fallback = `${item.attachmentCount || 1} attachment${item.attachmentCount === 1 ? "" : "s"}`;
      // Expanded shows the queued text as it will actually be sent — the whole of it, no
      // compaction and no ellipsis. item.preview is the shortened server-side line and
      // item.text the real one, which is what matters once it is worth reading in full.
      preview.textContent = expanded
        ? (item.text || item.preview || fallback)
        : compactText(item.preview || item.text || fallback, 110);
      const canExpand = Boolean(item.text || item.preview);
      if (canExpand) {
        actions.append(queueActionButton(
          "chevron",
          expanded ? "Collapse queued message" : "Show the full queued message",
          "expand",
          () => {
            state.queueExpandedId = expanded ? null : item.id;
            state.queueExpandedSessionId = expanded ? null : state.selectedSessionId;
            renderQueuedPrompts();
          },
        ));
      }
      actions.append(
        queueActionButton("edit", "Edit queued message", "", () => { state.queueEditingId = item.id; state.queueEditingSessionId = state.selectedSessionId; renderQueuedPrompts(); }, busy || item.optimistic || item.text === null),
        queueActionButton("trash", "Delete queued message", "danger", () => updateQueuedPrompt(item, { kind: "remove" }), busy || item.optimistic),
        queueActionButton("send", "Send now", "steer", () => updateQueuedPrompt(item, { kind: "steer" }), busy || item.optimistic),
      );
      row.append(preview, actions);
    }
    listRoot.append(row);
  }
  return true;
}

function beginSteeredTurn(sessionId, item) {
  state.liveStreamsBySession.delete(sessionId);
  const steering = state.steeringPromptsBySession.get(sessionId) || [];
  if (item && !steering.some((entry) => entry.id === item.id)) {
    state.steeringPromptsBySession.set(sessionId, [...steering, { ...item, placement: "steering", optimistic: true }]);
  }
  if (sessionId !== state.selectedSessionId) return;
  if (livePaintFrame !== null) {
    cancelAnimationFrame(livePaintFrame);
    livePaintFrame = null;
  }
  const activity = { active: true, kind: "thinking", label: "Sending now", text: "Interrupting the previous response and starting the selected queued message…" };
  updateLiveSessionState(sessionId, true, activity, "working", { render: false });
  setActivity(activity);
  renderMessages(state.currentMessages);
  setAvatar("working", "sending now");
}

function trackQueuedPrompt(sessionId, { text, attachmentCount = 0 }, expectedSnapshotRevision = queueSnapshotRevision(sessionId)) {
  if (!sessionId) return;
  if (queueSnapshotRevision(sessionId) !== expectedSnapshotRevision) return false;
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
  recoverOptimisticQueue(sessionId).catch(() => {});
  return true;
}

const QUEUE_RECOVERY_DELAYS = [180, 540, 1080];

async function recoverOptimisticQueue(sessionId, delays = QUEUE_RECOVERY_DELAYS) {
  if (!sessionId) return false;
  const generation = (state.queueRecoveryGenerations.get(sessionId) || 0) + 1;
  state.queueRecoveryGenerations.set(sessionId, generation);
  try {
    for (const [index, delay] of delays.entries()) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (state.queueRecoveryGenerations.get(sessionId) !== generation) return false;
      if (!queuedPromptsFor(sessionId).some((item) => item.optimistic)) return true;
      await loadQueue(sessionId, { replaceOptimistic: index === delays.length - 1 });
    }
    return !queuedPromptsFor(sessionId).some((item) => item.optimistic);
  } finally {
    if (state.queueRecoveryGenerations.get(sessionId) === generation) state.queueRecoveryGenerations.delete(sessionId);
  }
}

async function loadQueue(sessionId = state.selectedSessionId, { replaceOptimistic = false } = {}) {
  if (!sessionId) return;
  try {
    const snapshot = await window.widget.getQueue(sessionId);
    if (Array.isArray(snapshot)) applyQueueSnapshot(sessionId, snapshot, null, { replaceOptimistic });
    else applyQueueSnapshot(sessionId, snapshot?.items, snapshot?.revision, { replaceOptimistic });
  } catch {}
}

function todosFor(sessionId = state.selectedSessionId) {
  const session = state.dashboard?.sessions?.find((item) => item.sessionId === sessionId);
  const projection = session?.projections?.values?.todos;
  const source = Array.isArray(projection) ? projection : Array.isArray(projection?.todos) ? projection.todos : [];
  return source
    .map((todo) => ({
      content: compactText(todo?.content, 180),
      status: ["pending", "in_progress", "completed"].includes(todo?.status) ? todo.status : "pending",
    }))
    .filter((todo) => todo.content);
}

function normalizedTodos(value) {
  const source = Array.isArray(value) ? value : Array.isArray(value?.todos) ? value.todos : [];
  return source.map((todo) => ({
    content: String(todo?.content || ""),
    status: ["pending", "in_progress", "completed"].includes(todo?.status) ? todo.status : "pending",
  })).filter((todo) => todo.content);
}

function projectionsWithTodos(projections, todos) {
  return {
    ...(projections || {}),
    values: {
      ...(projections?.values || {}),
      todos,
    },
  };
}

function mergeLiveTodos(session) {
  const liveTodos = state.liveTodosBySession.get(session.sessionId);
  if (!liveTodos) return session;
  const dashboardTodos = normalizedTodos(session.projections?.values?.todos);
  if (JSON.stringify(dashboardTodos) === JSON.stringify(liveTodos)) {
    state.liveTodosBySession.delete(session.sessionId);
    return session;
  }
  return { ...session, projections: projectionsWithTodos(session.projections, liveTodos) };
}

function clearLiveTodos(sessionId) {
  if (!sessionId) return false;
  // Keep an empty overlay until the dashboard acknowledges it, so a poll that
  // started before turn/end cannot resurrect the previous turn's plan.
  state.liveTodosBySession.set(sessionId, []);
  const session = state.dashboard?.sessions?.find((item) => item.sessionId === sessionId);
  if (session) session.projections = projectionsWithTodos(session.projections, []);
  if (sessionId === state.selectedSessionId) renderTodos();
  return true;
}

function syncCrowdedChatState() {
  const crowded = state.windowMode === "full"
    && state.tab === "chat"
    && window.innerHeight <= 420
    && todosFor().length > 0
    && queuedPromptsFor().length > 0
    && state.pendingAttachments.length > 0
    && state.showThinking
    && state.currentActivity?.kind === "thinking"
    && Boolean(state.currentActivity?.text);
  document.body.classList.toggle("chat-crowded", crowded);
  return crowded;
}

function goalFor(sessionId = state.selectedSessionId) {
  const session = state.dashboard?.sessions?.find((item) => item.sessionId === sessionId);
  const projection = session?.projections?.values?.goal;
  const goal = projection?.goal;
  if (!goal || !goal.objective) return null;
  return {
    objective: String(goal.objective),
    phase: goal.phase === "paused" ? "paused" : "active",
    maxRounds: Number(goal.maxGoalRounds) || null,
    rounds: Number(projection.roundsStarted) || 0,
  };
}

// The goal used to live only as a /goal card inline in the log, so it scrolled off and
// "was not always visible". It is a live projection, so it gets a dock of its own: a
// hairline strip pinned under the composer, clear of the activity card that appears and
// disappears above the log and used to shove the goal around. Collapsed it carries no text
// at all - the orb, the round rail and the counter - and the objective opens on click or
// rides the tooltip. The full text is read and rewritten behind the pencil. Every action is
// a /goal subcommand over the command path, so Harness stays the one owner of goal state.
function renderGoal() {
  const dock = $("#goalDock");
  const goal = goalFor();
  const busy = state.goalBusy;
  const signature = JSON.stringify([goal, state.goalEditing, busy]);
  if (signature === state.goalSignature) return false;
  state.goalSignature = signature;
  if (!goal) {
    dock.hidden = true;
    dock.open = false;
    state.goalEditing = false;
    return true;
  }
  dock.hidden = false;
  const paused = goal.phase === "paused";
  const rounds = goal.maxRounds ? `Round ${goal.rounds}/${goal.maxRounds}` : `Round ${goal.rounds}`;
  dock.dataset.phase = paused ? "paused" : "active";
  dock.classList.toggle("goal-unbounded", !goal.maxRounds);
  const summary = $("#goalSummary");
  summary.title = paused ? `${goal.objective}
${rounds} · paused` : `${goal.objective}
${rounds}`;
  summary.setAttribute("aria-label", `Goal, ${paused ? "paused" : "active"}: ${compactText(goal.objective, 90)}`);
  $("#goalOrbIcon").setAttribute("href", paused ? "#icon-pause" : "#icon-goal-dot");
  $("#goalRounds").textContent = goal.maxRounds ? `${goal.rounds}/${goal.maxRounds}` : String(goal.rounds);
  // Only a capped goal has a real fraction to draw; an open-ended one keeps the rail as a
  // plain hint instead of a bar frozen at zero.
  const progress = goal.maxRounds ? Math.max(0, Math.min(1, goal.rounds / goal.maxRounds)) : 0;
  $("#goalTrackFill").style.width = `${Math.round(progress * 100)}%`;
  $("#goalPhase").textContent = paused ? "paused" : "active";
  $("#goalPhase").classList.toggle("paused", paused);
  $("#goalObjective").textContent = goal.objective;
  $("#goalMeta").textContent = rounds;
  const pauseIcon = $("#goalPauseResume").querySelector("use");
  if (pauseIcon) pauseIcon.setAttribute("href", paused ? "#icon-play" : "#icon-pause");
  $("#goalPauseResumeLabel").textContent = paused ? "Resume" : "Pause";
  $("#goalPauseResume").title = paused ? "Resume the goal" : "Pause the goal";
  $("#goalPauseResume").setAttribute("aria-label", paused ? "Resume the goal" : "Pause the goal");
  $("#goalEdit").disabled = busy;
  $("#goalDelete").disabled = busy;
  $("#goalPauseResume").disabled = busy;
  $("#goalEditor").hidden = !state.goalEditing;
  $("#goalObjective").hidden = state.goalEditing;
  $(".goal-dock-actions").hidden = state.goalEditing;
  $(".goal-dock-editor-actions").hidden = !state.goalEditing;
  if (state.goalEditing) {
    const input = $("#goalEditInput");
    if (input.value === "" || input.dataset.goalObjective !== goal.objective) {
      input.value = goal.objective;
      input.dataset.goalObjective = goal.objective;
    }
    input.disabled = busy;
    $("#goalEditSave").disabled = busy;
    requestAnimationFrame(() => {
      input.style.height = "auto";
      input.style.height = `${Math.min(input.scrollHeight, QUEUE_EDIT_MAX_HEIGHT)}px`;
    });
  }
  return true;
}

async function runGoalCommand(line) {
  const sessionId = state.selectedSessionId;
  if (!sessionId || state.goalBusy) return;
  state.goalBusy = true;
  renderGoal();
  try {
    await executeHarnessCommand(line, sessionId);
    state.goalEditing = false;
    await refresh({ afterCurrent: true });
  } catch (error) {
    showComposerError(error, "Goal not updated");
  } finally {
    state.goalBusy = false;
    state.goalSignature = "";
    renderGoal();
  }
}

function renderTodos() {
  const root = $("#todoDock");
  const list = $("#todoList");
  const todos = todosFor();
  syncCrowdedChatState();
  const expanded = Boolean(state.selectedSessionId && state.todoExpandedSessionIds.has(state.selectedSessionId));
  const counts = {
    completed: todos.filter((todo) => todo.status === "completed").length,
    inProgress: todos.filter((todo) => todo.status === "in_progress").length,
    pending: todos.filter((todo) => todo.status === "pending").length,
  };
  const signature = JSON.stringify([
    state.selectedSessionId,
    expanded,
    ...todos.map((todo) => [todo.content, todo.status]),
  ]);
  if (signature === state.todoSignature) return false;
  state.todoSignature = signature;
  root.classList.toggle("has-items", todos.length > 0);
  root.classList.toggle("expanded", expanded);
  root.hidden = !todos.length;
  const toggle = $("#todoToggle");
  toggle.setAttribute("aria-expanded", String(expanded));
  toggle.title = expanded ? "Collapse current plan" : "Show current plan";
  $("#todoCounts").textContent = `${counts.completed}/${todos.length} done${counts.inProgress ? ` · ${counts.inProgress} active` : ""}`;
  list.hidden = !expanded;
  list.replaceChildren();
  for (const todo of todos) {
    const row = document.createElement("div");
    row.className = `todo-row ${todo.status}`;
    const marker = document.createElement("span");
    marker.className = "todo-marker";
    marker.append(createIcon(todo.status === "completed" ? "check" : todo.status === "in_progress" ? "session" : "stop"));
    const text = document.createElement("span");
    text.textContent = todo.content;
    text.title = todo.content;
    row.append(marker, text);
    list.append(row);
  }
  return true;
}

function renderWorkspaces() {
  const session = state.dashboard?.sessions?.find((item) => item.sessionId === state.selectedSessionId);
  const selectedId = session?.workspaceId || state.selectedWorkspaceId || "";
  const selected = state.workspaces.find((workspace) => workspace.workspaceId === selectedId);
  const signature = JSON.stringify([
    selectedId,
    ...state.workspaces.map((workspace) => [workspace.workspaceId, workspace.title || "", workspace.path || ""]),
  ]);
  if (signature === state.workspaceSignature && $("#workspaceOptions").childElementCount) return false;
  state.workspaceSignature = signature;
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
  return true;
}

async function loadWorkspaces() {
  if (state.workspacesBusy || !state.dashboard?.harness) return;
  state.workspacesBusy = true;
  try {
    state.workspaces = await window.widget.workspaces();
    state.workspacesLoaded = true;
    renderWorkspaces();
  } catch {
    state.workspacesLoaded = true;
  } finally {
    state.workspacesBusy = false;
  }
}

function renderAttachments() {
  const messageLayout = captureMessageLayoutSnapshot();
  syncCrowdedChatState();
  const root = $("#attachmentList");
  root.replaceChildren();
  state.pendingAttachments.forEach((attachment, index) => {
    const displayKind = attachment.kind === "image" ? "image" : attachment.previewKind === "video" ? "video" : "file";
    const chip = document.createElement("div");
    chip.className = "attachment-chip";
    chip.title = attachment.path;
    chip.dataset.attachmentKind = displayKind;
    chip.setAttribute("role", "group");
    chip.setAttribute("aria-label", `${attachment.name}, ${displayKind} attachment`);
    const preview = document.createElement("div");
    preview.className = "attachment-preview";
    preview.dataset.previewKind = displayKind;
    preview.setAttribute("aria-hidden", "true");
    if (attachment.kind === "image" && attachment.data && attachment.mediaType) {
      const image = document.createElement("img");
      image.src = `data:${attachment.mediaType};base64,${attachment.data}`;
      image.alt = "";
      image.draggable = false;
      preview.append(image);
    } else if (attachment.thumbnailData && attachment.thumbnailMediaType) {
      const image = document.createElement("img");
      image.src = `data:${attachment.thumbnailMediaType};base64,${attachment.thumbnailData}`;
      image.alt = "";
      image.draggable = false;
      preview.append(image);
    } else {
      preview.append(createIcon(displayKind === "file" ? "file" : "image"));
    }
    const name = document.createElement("span");
    name.className = "attachment-name";
    const title = document.createElement("b");
    title.textContent = attachment.name;
    const kind = document.createElement("small");
    kind.textContent = displayKind;
    name.append(title, kind);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "attachment-remove";
    remove.title = `Remove ${attachment.name}`;
    remove.setAttribute("aria-label", `Remove ${attachment.name}`);
    const removeText = document.createElement("span");
    removeText.textContent = "Remove";
    remove.append(createIcon("close"), removeText);
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
  restoreMessageLayoutSnapshot(messageLayout);
}

// The main process reports each file separately, so one unreadable or oversized
// file no longer discards the whole selection — the rest still attach and the
// user is told exactly which file failed and why.
function addAttachments(result) {
  const prepared = Array.isArray(result) ? { attachments: result, failures: [] } : (result || {});
  const known = new Set(state.pendingAttachments.map((item) => item.path));
  let limitSkipped = 0;
  for (const attachment of prepared.attachments || []) {
    if (!known.has(attachment.path) && state.pendingAttachments.length < 12) {
      state.pendingAttachments.push(attachment);
      known.add(attachment.path);
    } else if (!known.has(attachment.path)) limitSkipped += 1;
  }
  renderAttachments();
  const failures = [...(prepared.failures || [])];
  if (limitSkipped) failures.push({ name: "Attachment limit", error: `Only 12 attachments can be reviewed at once; ${limitSkipped} more ${limitSkipped === 1 ? "was" : "were"} skipped` });
  if (failures.length) {
    showError(new Error(failures.map((failure) => `${failure.name}: ${failure.error}`).join("; ")));
  }
}

function handleComposerPaste(event) {
  const clipboard = window.clipboardAttachments;
  if (!clipboard?.clipboardFiles(event.clipboardData).length) return;
  // Prevent the file's fallback name/URL from being inserted as text. Plain text
  // clipboard data never reaches this branch and retains the browser's native paste.
  event.preventDefault();
  const clipboardData = event.clipboardData;
  composerPastePreparation = composerPastePreparation.then(async () => {
    const result = await clipboard.prepareClipboard(clipboardData, {
      pathForFile: (file) => window.widget.pathForFile(file),
      prepareFiles: (paths) => window.widget.prepareFiles(paths),
    });
    addAttachments(result);
  }).catch((error) => {
    composerPasteFailurePending = true;
    showTransientActivityError(error, "Paste failed");
  });
  return composerPastePreparation;
}

async function loadCommands() {
  const requestSequence = ++state.commandsRequestSequence;
  const sessionId = state.selectedSessionId;
  if (!sessionId || !state.dashboard?.harness) {
    if (!state.selectedSessionId) {
      state.commandCatalog = [];
      renderCommands();
    }
    return;
  }
  state.commandsBusy = true;
  try {
    const commands = await window.widget.commands(sessionId);
    if (requestSequence !== state.commandsRequestSequence || sessionId !== state.selectedSessionId) return;
    state.commandCatalog = commands;
    state.commandsLoadedSessionId = sessionId;
    renderCommands();
    renderCommandHint();
  } catch {
    if (requestSequence !== state.commandsRequestSequence || sessionId !== state.selectedSessionId) return;
    state.commandCatalog = [];
    state.commandsLoadedSessionId = sessionId;
    renderCommands();
    renderCommandHint();
  } finally {
    if (requestSequence === state.commandsRequestSequence) state.commandsBusy = false;
  }
}

async function applyModelSelection() {
  const sessionId = state.selectedSessionId;
  const selection = effectiveModelSelection();
  if (!sessionId || (!state.automaticModelRoute && !selection)) return;
  setAvatar("waiting", "switching model");
  try {
    await window.widget.selectModel(selection ? { sessionId, selection } : { sessionId });
    if (sessionId === state.selectedSessionId) setAvatar("idle", "model selected");
  } catch (error) {
    if (sessionId !== state.selectedSessionId) return;
    showError(error);
    setAvatar("error", "model error");
  }
}

async function selectSession(sessionId, openChat = false) {
  const previousSessionId = state.selectedSessionId;
  state.selectedSessionId = sessionId || null;
  // The error belongs to the message that failed, and that message stays behind with its
  // own session's composer content.
  if (previousSessionId !== state.selectedSessionId) {
    invalidateSelectedHistoryVersion();
    clearComposerError();
  }
  const selectedGroup = groupedSessions(state.selectedSessionId).find((group) => group.sessions.some((session) => session.sessionId === state.selectedSessionId));
  if (selectedGroup && state.collapsedSessionGroupKeys.delete(selectedGroup.key)) {
    state.sessionListSignature = "";
    state.sessionSelectSignature = "";
  }
  syncGameBarSelection();
  if (state.windowMode === "full") acknowledgeSessionError(state.selectedSessionId);
  state.messagesStickToBottom = true;
  state.unseenMessages = 0;
  state.historySignature = "";
  if (previousSessionId !== state.selectedSessionId) {
    setActivity(null);
    renderMessages([]);
    const session = state.dashboard?.sessions?.find((item) => item.sessionId === state.selectedSessionId);
    const activity = commandFeedbackFor(state.selectedSessionId)?.activity || (session?.running
      ? session.activity || { active: true, kind: "working", label: "Working", text: "Agent is processing the current turn…" }
      : null);
    setActivity(activity);
    if (session?.state === "error") setAvatar("error", "model error");
    else if (session?.running) setAvatar("working", activity?.label || "working");
    else if (!state.harnessOffline) setAvatar("idle");
  }
  syncSelectedAgentMode();
  state.pendingSelection = null;
  state.automaticModelRoute = false;
  state.modelCatalog = null;
  state.modelLoadState = "idle";
  state.commandCatalog = [];
  state.commandsLoadedSessionId = null;
  state.selectedWorkspaceId = state.dashboard?.sessions?.find((item) => item.sessionId === sessionId)?.workspaceId || null;
  renderSessions();
  renderSessionSelect();
  renderContext();
  renderWorkspaces();
  renderTodos();
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
  const failedCount = run.filter((message) => message.isError).length;
  const allFailed = failedCount === toolCount;
  const partialFailure = failedCount > 0 && !allFailed;
  const running = run.some((message) => message.status === "running");
  const group = document.createElement("details");
  group.className = `tool-group${allFailed ? " failed" : ""}${partialFailure ? " partial-failure" : ""}${running ? " running" : ""}`;
  group.dataset.toolKey = `group:${run.map((message) => message.callId || message.seq || message.name || "tool").join("|")}`;
  const summary = document.createElement("summary");
  summary.append(createIcon("command"));
  const identity = document.createElement("span");
  identity.className = "tool-group-identity";
  const label = document.createElement("b");
  label.textContent = `${toolCount} ${toolCount === 1 ? "tool" : "tools"}`;
  const meta = document.createElement("small");
  const names = [...new Set(run.map((message) => message.name).filter(Boolean))].slice(0, 3).join(" · ");
  const statusText = running
    ? `running${failedCount ? ` · ${failedCount} failed` : ""}`
    : allFailed
      ? "all failed"
      : partialFailure
        ? `${toolCount - failedCount} completed · ${failedCount} failed`
        : "completed";
  meta.textContent = names ? `${names} · ${statusText}` : statusText;
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

// Where the caller's own messages sit in the log. Scrolling back to "the thing I
// asked" meant dragging through everything the agent said in between; the rail turns
// that into one click, and the marks are placed by real offsets so they line up with
// the scrollbar beside them rather than approximating.
// A rebuild of the log must not throw the jump away. renderMessages replaces every bubble
// on the 2.5s poll and restores the scroll offset it captured beforehand; a smooth scroll
// still in flight gets captured half-way and snapped back, which is the click that
// "did nothing". The pin survives those rebuilds - the restore re-resolves the message and
// lands on it instead of on a stale offset - and it lets go on the next deliberate scroll.
const MESSAGE_PIN_MS = 1600;
const MESSAGE_PIN_OFFSET = 6;
function activeMessageScrollPin() {
  const pin = state.messageScrollPin;
  if (!pin) return null;
  if (Date.now() > pin.expires) { state.messageScrollPin = null; return null; }
  return pin;
}

function releaseMessageScrollPin() {
  state.messageScrollPin = null;
}

function applyMessageScrollPin({ smooth = false } = {}) {
  const pin = activeMessageScrollPin();
  if (!pin) return false;
  const root = $("#messages");
  if (!root || root.clientHeight <= 0) return false;
  const bubble = root.querySelectorAll(".bubble.user")[pin.userIndex];
  if (!bubble) return false;
  // Measured, not offsetTop: the bubble's offsetParent is the wrap, not the scroller, so
  // only the live rectangles agree with what the scrollbar is actually showing.
  const delta = bubble.getBoundingClientRect().top - root.getBoundingClientRect().top;
  const limit = Math.max(0, root.scrollHeight - root.clientHeight);
  const target = Math.max(0, Math.min(limit, root.scrollTop + delta - MESSAGE_PIN_OFFSET));
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (smooth && !reduceMotion) root.scrollTo({ top: target, behavior: "smooth" });
  else root.scrollTop = target;
  state.messagesStickToBottom = false;
  return true;
}

function scrollToUserMessage(userIndex) {
  const bubbles = $$("#messages .bubble.user");
  // Resolved live, never from a captured node. renderMessages rebuilds the whole log
  // on the 2.5s poll, so a bubble captured when the mark was drawn is detached moments
  // later - scrollIntoView on a detached node does nothing, which is exactly the mark
  // that "did not click". An index into the current bubbles cannot go stale that way.
  if (!bubbles[userIndex]) return;
  state.messagesStickToBottom = false;
  state.unseenMessages = 0;
  state.messageScrollPin = { userIndex, expires: Date.now() + MESSAGE_PIN_MS };
  applyMessageScrollPin({ smooth: true });
  flashMessageMark(userIndex);
  updateScrollLatestButton();
}

function renderMessageMarks() {
  const rail = $("#messageMarks");
  const root = $("#messages");
  const bubbles = [...root.querySelectorAll(".bubble.user")];
  const span = root.scrollHeight;
  const scrollable = span - root.clientHeight > 4;
  const marks = scrollable
    ? bubbles.map((bubble, userIndex) => ({
        userIndex,
        // Against scrollHeight, not clientHeight: the fraction has to mean the same
        // thing as a scrollbar position or the mark points at the wrong message.
        ratio: Math.max(0, Math.min(1, (bubble.offsetTop + bubble.offsetHeight / 2) / span)),
        label: compactText(bubble.textContent || "Your message", 80),
      }))
    : [];
  const signature = JSON.stringify(marks.map((mark) => [Math.round(mark.ratio * 1000), mark.label]));
  if (signature === state.messageMarksSignature) return false;
  state.messageMarksSignature = signature;
  rail.classList.toggle("has-marks", marks.length > 0);
  $("#messages").parentElement?.classList.toggle("has-marks", marks.length > 0);
  rail.replaceChildren();
  for (const mark of marks) {
    const tick = document.createElement("button");
    tick.type = "button";
    tick.className = "message-mark";
    tick.style.top = `${(mark.ratio * 100).toFixed(3)}%`;
    tick.title = mark.label;
    tick.dataset.userIndex = String(mark.userIndex);
    tick.setAttribute("aria-label", `Your message ${mark.userIndex + 1} of ${marks.length}: ${mark.label}`);
    // The click reads the index off the element, so it resolves the live bubble at
    // click time rather than closing over one that a later render will have replaced.
    tick.addEventListener("click", () => scrollToUserMessage(Number(tick.dataset.userIndex)));
    rail.append(tick);
  }
  return true;
}

// The rail lands you somewhere in the middle of a long conversation, where one bubble
// looks like another. The pulse says which one you asked for, and it is re-applied by
// index after a rebuild so a poll landing mid-flash does not swallow it.
function flashMessageMark(userIndex) {
  clearTimeout(state.messageMarkFlashTimer);
  state.messageMarkFlashIndex = userIndex;
  paintMessageMarkFlash();
  state.messageMarkFlashTimer = setTimeout(() => {
    state.messageMarkFlashIndex = null;
    for (const previous of $$("#messages .bubble.mark-target")) previous.classList.remove("mark-target");
  }, 1200);
}

function paintMessageMarkFlash() {
  for (const previous of $$("#messages .bubble.mark-target")) previous.classList.remove("mark-target");
  if (state.messageMarkFlashIndex === null) return;
  const bubble = $$("#messages .bubble.user")[state.messageMarkFlashIndex];
  if (bubble) bubble.classList.add("mark-target");
}

// The magnet, and only where it helps. An earlier version used CSS scroll-snap on the
// whole log, but proximity snap pulled the view down to the first user message even at the
// very top, hiding the agent's opening reply, and it fought a deliberate drag. This one is
// a gentle JS pull on scroll-idle: once the scroll settles with a user message already
// close to the top of the viewport, it eases that message flush. It never fires at the top
// (so the opening reply is safe), never while the log follows a running turn, and only
// within a small pull distance, so ordinary scrolling is untouched.
const MESSAGE_MAGNET_PULL = 26;
function syncMessageMagnet() {
  // The class is only a marker that the magnet is armed; the pull itself is scheduled on
  // scroll. It carries no scroll-snap CSS any more.
  $("#messages").classList.toggle("magnet", !state.messagesStickToBottom);
}

function scheduleMessageMagnet() {
  clearTimeout(state.messageMagnetTimer);
  if (state.messagesStickToBottom || state.scrollLatestAutoScrolling || state.messageMagnetSnapping) return;
  state.messageMagnetTimer = setTimeout(() => {
    const root = $("#messages");
    if (state.messagesStickToBottom || state.scrollLatestAutoScrolling || state.messageMagnetSnapping) return;
    if (activeMessageScrollPin()) return; // a mark jump owns the scroll until it settles
    if (root.scrollTop < 8) return; // the top is a deliberate place to be; never pull off it
    const viewportTop = root.getBoundingClientRect().top;
    let best = null;
    let bestDist = Infinity;
    for (const bubble of root.querySelectorAll(".bubble.user")) {
      const dist = bubble.getBoundingClientRect().top - viewportTop;
      if (Math.abs(dist) < Math.abs(bestDist)) { bestDist = dist; best = bubble; }
    }
    if (!best || Math.abs(bestDist) < 1 || Math.abs(bestDist) > MESSAGE_MAGNET_PULL) return;
    state.messageMagnetSnapping = true;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    best.scrollIntoView({ block: "start", behavior: reduceMotion ? "auto" : "smooth" });
    clearTimeout(state.messageMagnetReleaseTimer);
    state.messageMagnetReleaseTimer = setTimeout(() => { state.messageMagnetSnapping = false; }, reduceMotion ? 0 : 420);
  }, 160);
}

function updateScrollLatestButton() {
  const button = $("#scrollLatestButton");
  const visible = !state.messagesStickToBottom;
  const label = state.unseenMessages > 1 ? `${state.unseenMessages} new` : state.unseenMessages === 1 ? "New" : "Latest";
  const signature = JSON.stringify([visible, label]);
  if (signature === state.scrollLatestSignature) return false;
  state.scrollLatestSignature = signature;
  button.hidden = !visible;
  $("#scrollLatestCount").textContent = label;
  return true;
}

function finishScrollLatestAutoScroll() {
  clearTimeout(state.scrollLatestAutoScrollTimer);
  state.scrollLatestAutoScrollTimer = null;
  state.scrollLatestAutoScrolling = false;
  const nearBottom = messagesNearBottom();
  state.messagesStickToBottom = nearBottom;
  if (nearBottom) state.unseenMessages = 0;
  updateScrollLatestButton();
}

function animateScrollLatestCompletion(sessionId) {
  if (state.windowMode !== "full" || sessionId !== state.selectedSessionId || state.messagesStickToBottom) return false;
  updateScrollLatestButton();
  const button = $("#scrollLatestButton");
  button.classList.remove("completion-pop");
  void button.offsetWidth;
  button.classList.add("completion-pop");
  setTimeout(() => button.classList.remove("completion-pop"), 760);
  return true;
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

function appendSteeringPrompts(root) {
  for (const item of steeringPromptsFor()) {
    const bubble = document.createElement("div");
    bubble.className = "bubble user steering-message";
    bubble.dataset.steeringId = item.id || "";
    const text = document.createElement("span");
    text.textContent = item.preview || item.text || "Queued message";
    const status = document.createElement("small");
    status.textContent = "sending now";
    bubble.append(text, status);
    root.append(bubble);
  }
}

function paintLiveAssistant() {
  const root = $("#messages");
  const previousTop = root.scrollTop;
  const wasPinned = state.messagesStickToBottom;
  const liveAssistant = liveAssistantSnapshot();
  const liveBubble = root.querySelector(".live-assistant");
  const liveText = liveAssistant?.text || "";
  const liveChanged = Boolean(liveBubble) !== Boolean(liveText) || (liveBubble?.textContent || "") !== liveText;
  if (liveText && liveBubble) {
    liveBubble.dataset.liveSeq = String(liveAssistant.lastSeq || "");
    if (liveBubble.textContent !== liveText) liveBubble.textContent = liveText;
  } else if (liveText) {
    root.querySelector(".empty-state")?.remove();
    appendLiveAssistant(root);
  } else if (liveBubble) {
    liveBubble.remove();
    if (!state.currentMessages.length && !steeringPromptsFor().length) root.innerHTML = `<div class="empty-state">${state.selectedSessionId ? "Write a message to start this session." : "Write a message — the widget will create a session."}</div>`;
  }
  // A mark the caller just clicked outranks the offset captured before this repaint. The
  // live stream repaints on every poll, and writing scrollTop back also cancels a smooth
  // scroll mid-flight - which is precisely the mark press that "did nothing" while the
  // agent was answering.
  if (applyMessageScrollPin()) {
    if (liveChanged) state.unseenMessages = 1;
  } else if (wasPinned) {
    root.scrollTop = root.scrollHeight;
    state.unseenMessages = 0;
  } else {
    root.scrollTop = Math.min(previousTop, Math.max(0, root.scrollHeight - root.clientHeight));
    if (liveChanged) state.unseenMessages = 1;
  }
  syncActivityCard();
  updateScrollLatestButton();
  return liveChanged;
}

function openModelPicker({ retry = false } = {}) {
  setTab("chat");
  $("#agentControls").open = true;
  const button = $("#modelButton");
  const picker = button.closest(".picker");
  closePickers(picker);
  picker.classList.add("open");
  positionPickerMenu(picker);
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
  [...panel.parentElement.children].forEach((element) => {
    if (element !== panel) element.inert = next;
  });
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

function commandResultName(messages, index) {
  const explicit = messages[index]?.command;
  if (explicit) return String(explicit).replace(/^\//, "").toLowerCase();
  const previous = messages[index - 1];
  return previous?.role === "user" ? (/^\/(\S+)/.exec(previous.text || "")?.[1] || "").toLowerCase() : "";
}

function goalResultField(text, label) {
  const match = new RegExp(`^${label}:\\s*(.+)$`, "im").exec(String(text || ""));
  return match?.[1]?.trim() || "";
}

function createGoalResultCard(text) {
  const objective = goalResultField(text, "Objective");
  const status = goalResultField(text, "Status") || (/no goal/i.test(text) ? "not set" : "active");
  const rounds = goalResultField(text, "Rounds");
  const activation = goalResultField(text, "Activation");
  const blocker = goalResultField(text, "Blocker");
  if (!objective && !rounds && !activation && !blocker && !/^No goal/i.test(String(text || "").trim())) return null;
  const card = document.createElement("div");
  card.className = "bubble command goal-result";
  const head = document.createElement("div");
  head.className = "goal-result-head";
  const title = document.createElement("b");
  title.textContent = "Goal";
  const phase = document.createElement("span");
  phase.className = "goal-phase";
  phase.textContent = status;
  head.append(title, phase);
  const objectiveNode = document.createElement("div");
  objectiveNode.className = "goal-objective";
  objectiveNode.textContent = objective || "No active goal";
  card.append(head, objectiveNode);
  const values = [["Rounds", rounds], ["Activation", activation], ["Blocker", blocker]].filter(([, value]) => value);
  if (values.length) {
    const meta = document.createElement("div");
    meta.className = "goal-meta";
    for (const [label, value] of values) {
      const item = document.createElement("span");
      item.textContent = `${label}: ${value}`;
      meta.append(item);
    }
    card.append(meta);
  }
  return card;
}

function messagePreviewBytes(data) {
  if (typeof data !== "string" || !data.length || data.length % 4 !== 0
      || !/^[a-zA-Z0-9+/]*={0,2}$/.test(data)) return -1;
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return (data.length / 4) * 3 - padding;
}

function boundedMessagePreviews(messages, maxPreviewBytes = HISTORY_PREVIEW_BYTES_BUDGET) {
  const bounded = Array.isArray(messages) ? [...messages] : [];
  let remaining = Math.max(0, Number(maxPreviewBytes) || 0);
  for (let index = bounded.length - 1; index >= 0; index -= 1) {
    const message = bounded[index];
    if (!Array.isArray(message?.attachments)) continue;
    const attachments = message.attachments.slice(0, 12).map((attachment) => {
      if (attachment?.kind !== "image" || typeof attachment.data !== "string") return attachment;
      const mediaType = String(attachment.mediaType || "").toLowerCase();
      const bytes = ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(mediaType)
        ? messagePreviewBytes(attachment.data)
        : -1;
      if (bytes > 0 && bytes <= remaining) {
        remaining -= bytes;
        return attachment;
      }
      const { data: _discarded, ...metadata } = attachment;
      return metadata;
    });
    bounded[index] = { ...message, attachments };
  }
  return bounded;
}

function createMessageAttachmentStrip(attachments) {
  const values = (Array.isArray(attachments) ? attachments : []).slice(0, 12);
  if (!values.length) return null;
  const strip = document.createElement("div");
  strip.className = "message-attachments";
  strip.setAttribute("aria-label", `${values.length} sent attachment${values.length === 1 ? "" : "s"}`);
  for (const attachment of values) {
    const displayKind = attachment?.kind === "image" ? "image" : attachment?.previewKind === "video" ? "video" : "file";
    const item = document.createElement("span");
    item.className = "message-attachment";
    item.dataset.attachmentKind = displayKind;
    item.title = String(attachment?.name || "Attachment");
    const preview = document.createElement("span");
    preview.className = "message-attachment-preview";
    const mediaType = String(attachment?.mediaType || "").toLowerCase();
    const data = typeof attachment?.data === "string" ? attachment.data : "";
    if (displayKind === "image"
        && ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(mediaType)
        && data.length > 0
        && data.length <= Math.ceil(8 * 1024 * 1024 * 4 / 3) + 8
        && /^[a-zA-Z0-9+/]*={0,2}$/.test(data)) {
      const image = document.createElement("img");
      image.src = `data:${mediaType};base64,${data}`;
      image.alt = "";
      image.draggable = false;
      image.decoding = "async";
      preview.append(image);
    } else {
      preview.append(createIcon(displayKind === "file" ? "file" : "image"));
    }
    const name = document.createElement("span");
    name.className = "message-attachment-name";
    name.textContent = String(attachment?.name || "Attachment");
    item.append(preview, name);
    strip.append(item);
  }
  return strip;
}

function renderMessages(messages) {
  const root = $("#messages");
  const previousTop = root.scrollTop;
  const wasPinned = state.messagesStickToBottom;
  state.currentMessages = boundedMessagePreviews(messages);
  const liveAssistant = liveAssistantSnapshot();
  const steering = steeringPromptsFor();
  const signature = `${state.selectedSessionId || "new"}::${state.currentMessages.map((message) => JSON.stringify([
    message.role,
    message.command || "",
    message.seq || "",
    message.callId || "",
    message.status || "",
    Boolean(message.isError),
    message.text || "",
    message.arguments || "",
    message.result || "",
    (message.attachments || []).map((attachment) => [attachment.kind, attachment.previewKind, attachment.mediaType, attachment.name, attachment.data?.length || 0]),
  ])).join("|")}::steering:${steering.map((item) => JSON.stringify([item.id, item.preview, item.text])).join("|")}`;
  const previousSignature = state.historySignature;
  const changed = Boolean(previousSignature && signature !== previousSignature);
  const unchanged = root.dataset.rendered === "true" && signature === previousSignature;
  state.historySignature = signature;
  if (unchanged) return paintLiveAssistant();
  const expandedTools = openToolKeys(root);
  const selection = captureMessageSelection(root);
  root.replaceChildren();
  root.dataset.rendered = "true";
  if (!state.currentMessages.length && !liveAssistant?.text && !steering.length) {
    root.innerHTML = `<div class="empty-state">${state.selectedSessionId ? "Write a message to start this session." : "Write a message — the widget will create a session."}</div>`;
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
    const commandName = message.role === "command" ? commandResultName(state.currentMessages, index) : "";
    const structuredCommand = commandName === "goal" ? createGoalResultCard(message.text) : null;
    if (structuredCommand) {
      root.append(structuredCommand);
      index += 1;
      continue;
    }
    const bubble = document.createElement("div");
    bubble.className = `bubble ${message.role}`;
    if (message.html) bubble.innerHTML = message.html;
    else if (message.text) { bubble.classList.add("plain"); bubble.textContent = message.text; }
    const attachmentStrip = message.role === "user" ? createMessageAttachmentStrip(message.attachments) : null;
    if (attachmentStrip) {
      bubble.classList.add("has-attachments");
      if (!message.text) bubble.classList.add("attachment-only");
      bubble.append(attachmentStrip);
    }
    root.append(bubble);
    index += 1;
  }
  appendSteeringPrompts(root);
  appendLiveAssistant(root);
  restoreOpenToolKeys(root, expandedTools);
  if (applyMessageScrollPin()) {
    if (changed) state.unseenMessages = 1;
  } else if (wasPinned) {
    root.scrollTop = root.scrollHeight;
    state.unseenMessages = 0;
  } else {
    root.scrollTop = Math.min(previousTop, Math.max(0, root.scrollHeight - root.clientHeight));
    if (changed) state.unseenMessages = 1;
  }
  paintMessageMarkFlash();
  restoreMessageSelection(root, selection);
  syncActivityCard();
  updateScrollLatestButton();
  renderMessageMarks();
  syncMessageMagnet();
  return true;
}

function showError(error) {
  showTransientActivityError(error, "Something went wrong");
}

// A send that failed is the one message the user has to read: their text and attachments
// are still sitting in the composer and nothing will happen until they act. It used to go
// to the shared activity block on a 3.2s timer, which meant it was gone before it could be
// read — and while a turn was running the 2.5s dashboard poll overwrote it with the turn's
// own status even sooner, so in practice a failed send explained itself to nobody. This is
// the composer's own surface: it stays until the user dismisses it or the next send works,
// and no poll writes here.
function showComposerError(error, label) {
  const text = String(error?.message || error || "").trim();
  state.composerError = { label, text };
  $("#composerErrorLabel").textContent = label;
  $("#composerErrorText").textContent = text;
  $("#composerError").hidden = false;
  $("#composerError").title = text;
}

function clearComposerError() {
  if (!state.composerError) return;
  state.composerError = null;
  $("#composerError").hidden = true;
  $("#composerErrorText").textContent = "";
  $("#composerError").title = "";
}

function showTransientActivityError(error, label) {
  clearTimeout(state.transientActivityTimer);
  const activity = { active: true, kind: "error", label, text: String(error?.message || error) };
  setActivity(activity);
  setAvatar("error", label.toLowerCase());
  state.transientActivityTimer = setTimeout(() => {
    if (state.currentActivity !== activity) return;
    setActivity(null);
    if (state.avatarMode === "error" && !state.compactErrorUnread && !state.harnessOffline) setAvatar("idle");
    state.transientActivityTimer = null;
  }, 3200);
}

function commandFeedbackFor(sessionId = state.selectedSessionId) {
  return sessionId ? state.commandFeedbackBySession.get(sessionId) || null : null;
}

function setCommandFeedback(sessionId, feedback) {
  if (!sessionId) return;
  const previous = state.commandFeedbackBySession.get(sessionId);
  if (previous?.timer) clearTimeout(previous.timer);
  if (!feedback) {
    state.commandFeedbackBySession.delete(sessionId);
    if (sessionId === state.selectedSessionId) setActivity(null);
    return;
  }
  state.commandFeedbackBySession.set(sessionId, feedback);
  if (sessionId === state.selectedSessionId) setActivity(feedback.activity);
}

function settleCommandFeedback(sessionId, feedback) {
  const timer = setTimeout(() => {
    const current = commandFeedbackFor(sessionId);
    if (current?.id !== feedback.id) return;
    state.commandFeedbackBySession.delete(sessionId);
    if (sessionId === state.selectedSessionId) refreshHistory();
  }, 3200);
  timer.unref?.();
  feedback.timer = timer;
  setCommandFeedback(sessionId, feedback);
}

function invalidateSelectedHistoryVersion() {
  state.historyLoadedSessionId = null;
  state.historyLoadedUpdatedAt = undefined;
  state.historyLoadedRevision = null;
}

function selectedSessionUpdatedAt(sessionId = state.selectedSessionId) {
  return state.dashboard?.sessions?.find((session) => session.sessionId === sessionId)?.updatedAt;
}

function selectedHistoryIsCurrent(session) {
  return Boolean(session)
    && state.historyLoadedSessionId === session.sessionId
    && Object.is(state.historyLoadedUpdatedAt, session.updatedAt);
}

function selectedLiveStreamIsActive(sessionId = state.selectedSessionId) {
  return Boolean(sessionId && state.liveStreamsBySession.get(sessionId)?.active);
}

async function refreshHistory({ priority = false } = {}) {
  const sessionId = state.selectedSessionId;
  if (!sessionId) {
    state.historyBusy = false;
    invalidateSelectedHistoryVersion();
    renderMessages([]);
    return "cleared";
  }
  if (!priority && state.historyPrioritySessionId === sessionId) return "deferred";
  const requestSequence = ++state.historyRequestSequence;
  state.historyBusy = true;
  try {
    const view = await window.widget.history(sessionId);
    if (requestSequence !== state.historyRequestSequence || sessionId !== state.selectedSessionId) return "superseded";
    const rendererAlreadyHasRevision = state.historyLoadedSessionId === sessionId && state.historyLoadedRevision !== null;
    const sameRevision = view.revision !== null && view.revision !== undefined
      && Object.is(state.historyLoadedRevision, view.revision);
    const skipReconciliation = rendererAlreadyHasRevision && (view.unchanged === true || sameRevision);
    state.historyLoadedSessionId = sessionId;
    state.historyLoadedUpdatedAt = selectedSessionUpdatedAt(sessionId);
    if (view.revision !== null && view.revision !== undefined) state.historyLoadedRevision = view.revision;
    if (skipReconciliation) return "unchanged";
    const messages = view.messages || [];
    setActivity(commandFeedbackFor(sessionId)?.activity || view.activity || null);
    const detectedMode = modeFromMessages(messages);
    if (detectedMode) setSessionAgentMode(sessionId, detectedMode);
    renderMessages(messages);
    const latest = messages[messages.length - 1];
    if (state.windowMode === "full") {
      if (latest?.role === "error") setAvatar("error", "model error");
      else if (view.activity?.active) setAvatar("working", view.activity.label || "working");
      else if (state.avatarMode === "error" && !state.harnessOffline) setAvatar("idle");
      else if (state.avatarMode !== "done" && !state.harnessOffline) setAvatar("idle");
    }
    return "applied";
  } catch (error) {
    if (requestSequence !== state.historyRequestSequence || sessionId !== state.selectedSessionId) return "superseded";
    showError(error);
    if (state.windowMode === "full") setAvatar("error", "history error");
    return "failed";
  } finally {
    if (requestSequence === state.historyRequestSequence) state.historyBusy = false;
  }
}

function refreshHistoryAfterLiveMessage(sessionId) {
  const previous = state.historyPriorityPromise;
  const pending = (async () => {
    if (previous) await previous;
    if (sessionId !== state.selectedSessionId) return "selection-changed";
    state.historyPrioritySessionId = sessionId;
    return refreshHistory({ priority: true });
  })();
  state.historyPriorityPromise = pending;
  return pending.finally(() => {
    if (state.historyPriorityPromise !== pending) return;
    state.historyPriorityPromise = null;
    state.historyPrioritySessionId = null;
  });
}

function updateLiveSessionState(sessionId, running, activity = null, stateName = null, { render = true } = {}) {
  const session = state.dashboard?.sessions?.find((item) => item.sessionId === sessionId);
  if (session) {
    session.running = Boolean(running);
    session.activity = activity;
    if (stateName) session.state = stateName;
  }
  if (running) {
    state.runningSessionIds.add(sessionId);
    state.completedSignalSessionIds.delete(sessionId);
    state.errorSignalSessionIds.delete(sessionId);
    state.unacknowledgedErrorSessionIds.delete(sessionId);
    syncUnacknowledgedErrors();
  }
  else state.runningSessionIds.delete(sessionId);
  if (sessionId === state.selectedSessionId) {
    syncRunningControls(running);
  }
  if (render) {
    renderSessions();
    renderSessionSelect();
  }
}

function bumpLiveSessionRevision(sessionId) {
  const next = (state.liveSessionRevisions.get(sessionId) || 0) + 1;
  state.liveSessionRevisions.set(sessionId, next);
  return next;
}

let livePaintFrame = null;

function paintLiveState() {
  livePaintFrame = null;
  renderSessions();
  renderSessionSelect();
  const session = state.dashboard?.sessions?.find((item) => item.sessionId === state.selectedSessionId);
  const stream = state.liveStreamsBySession.get(state.selectedSessionId);
  const activity = session?.activity || (stream?.active ? stream.activity : null);
  if (!session?.running && !stream?.active) {
    if (stream?.text) paintLiveAssistant();
    return;
  }
  const visibleActivity = activity
    || { active: true, kind: "working", label: "Working", text: "Agent is processing the current turn…" };
  setActivity(visibleActivity);
  if (visibleActivity.kind === "writing" || stream?.text) paintLiveAssistant();
  const avatarLabel = visibleActivity.kind === "tool" ? "using tool" : visibleActivity.kind === "thinking" ? "thinking" : visibleActivity.kind === "writing" ? "writing" : visibleActivity.label || "working";
  setAvatar("working", avatarLabel);
}

function scheduleLivePaint() {
  if (livePaintFrame !== null) return;
  livePaintFrame = requestAnimationFrame(paintLiveState);
}

async function handleLiveEvent(payload) {
  const sessionId = payload?.sessionId;
  const event = payload?.event;
  if (!sessionId || !event?.type) return;
  let stream = state.liveStreamsBySession.get(sessionId) || { text: "", reasoning: "", lastSeq: 0 };
  if (Number(event.seq) && Number(event.seq) <= Number(stream.lastSeq)) return;
  if (Number(event.seq)) stream.lastSeq = Number(event.seq);
  if (["turn/start", "assistant/chunk", "tool/call", "tool/result", "tool/code-dispatch-start", "tool/code-dispatch", "turn/end", "todo/write"].includes(event.type)) bumpLiveSessionRevision(sessionId);

  if (event.type === "todo/write") {
    const todos = normalizedTodos(event.data?.todos);
    state.liveTodosBySession.set(sessionId, todos);
    const session = state.dashboard?.sessions?.find((item) => item.sessionId === sessionId);
    if (session) {
      session.projections = projectionsWithTodos(session.projections, todos);
    }
    if (sessionId === state.selectedSessionId) renderTodos();
    return;
  }

  if (event.type === "user/message") {
    const messageId = String(event.data?.messageId || "");
    if (messageId) {
      state.queueHandoffEpochs.set(sessionId, queueHandoffEpoch(sessionId) + 1);
      const steering = steeringPromptsFor(sessionId);
      const index = steering.findIndex((item) => item.id === messageId);
      const pendingSteer = state.queueBusySessionId === sessionId && state.queueBusyId === messageId && state.queueBusyKind === "steer";
      if (index >= 0) {
        state.steeringPromptsBySession.set(sessionId, [...steering.slice(0, index), ...steering.slice(index + 1)]);
      }
      if (index >= 0 || pendingSteer) {
        state.liveStreamsBySession.delete(sessionId);
        if (sessionId === state.selectedSessionId) renderMessages(state.currentMessages);
      }
    }
    if (sessionId === state.selectedSessionId) await refreshHistoryAfterLiveMessage(sessionId);
    return;
  }

  if (event.type === "turn/start") {
    state.turnGenerationsBySession.set(sessionId, (state.turnGenerationsBySession.get(sessionId) || 0) + 1);
    state.cancelPendingSessionIds.delete(sessionId);
    const session = state.dashboard?.sessions?.find((item) => item.sessionId === sessionId);
    state.liveTodosBySession.set(sessionId, []);
    if (session) session.projections = projectionsWithTodos(session.projections, []);
    if (sessionId === state.selectedSessionId) renderTodos();
    const activity = { active: true, kind: "thinking", label: "Thinking", text: "Preparing the next step…" };
    stream = { text: "", reasoning: "", lastSeq: Number(event.seq) || 0, active: true, activity };
    state.liveStreamsBySession.set(sessionId, stream);
    updateLiveSessionState(sessionId, true, activity, "working", { render: false });
    scheduleLivePaint();
    return;
  }

  if (event.type === "assistant/chunk") {
    const chunk = event.data?.chunk || {};
    if (chunk.type === "reasoning-delta" && chunk.text) {
      stream.reasoning = `${stream.reasoning || ""}${chunk.text}`.slice(-1200);
      const activity = { active: true, kind: "thinking", label: "Thinking", text: compactRecentText(stream.reasoning, 110) };
      stream.active = true;
      stream.activity = activity;
      state.liveStreamsBySession.set(sessionId, stream);
      updateLiveSessionState(sessionId, true, activity, "working", { render: false });
      scheduleLivePaint();
    } else if (chunk.type === "text-delta" && chunk.text) {
      stream.text += chunk.text;
      const activity = { active: true, kind: "writing", label: "Writing", text: stream.text };
      stream.active = true;
      stream.activity = activity;
      state.liveStreamsBySession.set(sessionId, stream);
      updateLiveSessionState(sessionId, true, activity, "working", { render: false });
      scheduleLivePaint();
    }
    return;
  }

  if (["tool/call", "tool/code-dispatch-start"].includes(event.type)) {
    const activity = { active: true, kind: "tool", label: "Using tool", text: event.data?.name || "tool" };
    stream.text = "";
    stream.reasoning = "";
    stream.active = true;
    stream.activity = activity;
    state.liveStreamsBySession.set(sessionId, stream);
    updateLiveSessionState(sessionId, true, activity, "working");
    if (sessionId === state.selectedSessionId) {
      setAvatar("working", "using tool");
      setActivity(activity);
      await refreshHistoryAfterLiveMessage(sessionId);
    }
    return;
  }

  if (["tool/result", "tool/code-dispatch"].includes(event.type)) {
    stream.text = "";
    stream.reasoning = "";
    stream.active = true;
    stream.activity = null;
    state.liveStreamsBySession.set(sessionId, stream);
    updateLiveSessionState(sessionId, true, null, "working", { render: false });
    if (sessionId === state.selectedSessionId) {
      setActivity(null);
      await refreshHistoryAfterLiveMessage(sessionId);
    }
    scheduleLivePaint();
    return;
  }

  if (event.type === "turn/end") {
    const completedStream = stream;
    const failed = event.data?.reason?.kind === "error";
    completedStream.active = false;
    completedStream.activity = null;
    clearLiveTodos(sessionId);
    updateLiveSessionState(sessionId, false, null, failed ? "error" : "idle");
    const session = state.dashboard?.sessions?.find((item) => item.sessionId === sessionId) || { sessionId };
    if (failed) signalSessionError(session);
    else notifyCompletion(session);
    if (sessionId === state.selectedSessionId) {
      setTimeout(async () => {
        await refreshHistory({ priority: true });
        if (state.liveStreamsBySession.get(sessionId) === completedStream) {
          state.liveStreamsBySession.delete(sessionId);
        }
        if (sessionId === state.selectedSessionId) renderMessages(state.currentMessages);
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
  syncCrowdedChatState();
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
  const open = !(state.compactHistoryOpen || state.compactReplyOpen);
  state.compactHistoryOpen = open;
  state.compactReplyOpen = false;
  state.compactReplyBusy = false;
  state.compactReplyError = "";
  if (state.compactHistoryOpen) state.compactNotification = null;
  syncCompactStatus();
}

async function openCompactSession(requestedSessionId = null) {
  const entry = compactPreviewEntry();
  const sessionId = typeof requestedSessionId === "string"
    ? requestedSessionId
    : entry?.sessionId || state.selectedSessionId;
  if (!sessionId) return;
  state.compactNotification = null;
  state.compactStatusClosing = false;
  state.compactHistoryOpen = false;
  state.compactReplyOpen = false;
  state.compactReplyBusy = false;
  state.compactReplyError = "";
  clearTimeout(state.compactNotificationTimer);
  // Restore before selection publishes the collapsed compact status. While the
  // native Orb is resizing, its authoritative mode echo cancels an in-flight
  // animated mode request; sequencing these operations keeps Full as the intent.
  await setWindowMode("full");
  await selectSession(sessionId, true);
  if (state.compactReplySessionId === sessionId) state.compactReplySessionId = null;
  $("#messageInput")?.focus();
  syncCompactStatus();
}

function openCompactReply(sessionId) {
  if (!sessionId) return;
  state.compactReplySessionId = sessionId;
  state.compactNotification = null;
  state.compactStatusClosing = false;
  state.compactHistoryOpen = false;
  state.compactReplyOpen = true;
  state.compactReplyBusy = false;
  state.compactReplyError = "";
  clearTimeout(state.compactNotificationTimer);
  syncCompactStatus();
  requestAnimationFrame(() => $("#orbReplyInput")?.focus());
}

function closeCompactReply({ showHistory = true } = {}) {
  state.compactReplyOpen = false;
  state.compactReplyBusy = false;
  state.compactReplyError = "";
  state.compactHistoryOpen = showHistory;
  syncCompactStatus();
  if (showHistory) requestAnimationFrame(() => $("#orbSessionList .orb-session-reply")?.focus());
}

async function sendCompactReply() {
  if (state.compactReplyBusy) return;
  const sessionId = state.compactReplySessionId;
  const input = $("#orbReplyInput");
  const text = input.value.trim();
  if (!sessionId || !text) {
    state.compactReplyError = "Write a message first";
    syncCompactStatus();
    input.focus();
    return;
  }
  const session = state.dashboard?.sessions?.find((item) => item.sessionId === sessionId);
  const queueingBehindTurn = state.runningSessionIds.has(sessionId);
  const queueRevisionAtSubmit = queueSnapshotRevision(sessionId);
  state.compactReplyBusy = true;
  state.compactReplyError = "";
  syncCompactStatus();
  try {
    await window.widget.send({
      sessionId,
      text,
      selection: null,
      attachments: [],
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    if (queueingBehindTurn) trackQueuedPrompt(sessionId, { text }, queueRevisionAtSubmit);
    input.value = "";
    state.compactReplyOpen = false;
    state.compactHistoryOpen = false;
    state.compactReplyBusy = false;
    state.compactReplySessionId = null;
    state.compactNotification = {
      kind: "notification",
      sessionId,
      title: session?.title || "Reply sent",
      text: queueingBehindTurn ? "Queued behind the active turn." : "Reply sent to this session.",
    };
    clearTimeout(state.compactNotificationTimer);
    state.compactNotificationTimer = setTimeout(() => {
      state.compactNotification = null;
      state.compactStatusClosing = true;
      syncCompactStatus();
      setTimeout(() => {
        state.compactStatusClosing = false;
        syncCompactStatus();
      }, 240);
    }, 2200);
    setAvatar("waiting", queueingBehindTurn ? "queued" : "waiting for reply");
    syncCompactStatus();
    await refresh({ afterCurrent: true });
  } catch (error) {
    state.compactReplyBusy = false;
    state.compactReplyError = compactText(error?.message || error || "Reply was not sent", 86);
    setAvatar("error", "not sent");
    syncCompactStatus();
    requestAnimationFrame(() => input.focus());
  }
}

function detectCompletedSessions(nextSessions) {
  const currentRunning = new Set(nextSessions.filter((session) => session.running).map((session) => session.sessionId));
  const existing = new Set(nextSessions.map((session) => session.sessionId));
  for (const sessionId of state.agentModesBySessionId.keys()) if (!existing.has(sessionId)) state.agentModesBySessionId.delete(sessionId);
  for (const sessionId of state.liveTodosBySession.keys()) if (!existing.has(sessionId)) state.liveTodosBySession.delete(sessionId);
  for (const tracked of [state.completedSignalSessionIds, state.errorSignalSessionIds, state.unacknowledgedErrorSessionIds]) {
    for (const sessionId of tracked) if (!existing.has(sessionId)) tracked.delete(sessionId);
  }
  for (const sessionId of currentRunning) {
    state.completedSignalSessionIds.delete(sessionId);
    state.errorSignalSessionIds.delete(sessionId);
    state.unacknowledgedErrorSessionIds.delete(sessionId);
  }
  syncUnacknowledgedErrors();
  if (state.dashboardInitialized) {
    for (const sessionId of state.runningSessionIds) {
      if (!currentRunning.has(sessionId) && existing.has(sessionId)) {
        const session = nextSessions.find((item) => item.sessionId === sessionId);
        if (session?.state === "error") signalSessionError(session);
        else notifyCompletion(session);
      }
    }
    for (const session of nextSessions) {
      if (session.running) continue;
      const previous = state.sessionSnapshotsById.get(session.sessionId);
      if (!previous || previous.running) continue;
      const changed = session.updatedAt !== previous.updatedAt || session.preview !== previous.preview;
      if (!changed) continue;
      if (session.state === "error" && previous.state !== "error") signalSessionError(session);
      else if (session.preview && session.preview !== previous.preview) notifyCompletion(session);
    }
  } else {
    for (const session of nextSessions) if (!session.running && session.state === "error") signalSessionError(session);
  }
  state.runningSessionIds = currentRunning;
  state.sessionSnapshotsById = new Map(nextSessions.map((session) => [session.sessionId, {
    running: Boolean(session.running),
    state: session.state || "idle",
    updatedAt: session.updatedAt,
    preview: session.preview || "",
  }]));
  state.dashboardInitialized = true;
}

async function performRefresh() {
  state.refreshing = true;
  try {
    const selectedAtRequest = state.selectedSessionId;
    const liveRevisionsAtRequest = new Map(state.liveSessionRevisions);
    const dashboardResult = await window.widget.dashboard();
    const dashboard = {
      ...dashboardResult,
      sessions: (dashboardResult.sessions || []).map((session) => {
        let mergedSession = session;
        if ((state.liveSessionRevisions.get(session.sessionId) || 0) !== (liveRevisionsAtRequest.get(session.sessionId) || 0)) {
          const live = state.dashboard?.sessions?.find((item) => item.sessionId === session.sessionId);
          if (live) mergedSession = {
            ...mergedSession,
            running: live.running,
            state: live.state,
            activity: live.activity,
          };
        }
        if (state.cancelPendingSessionIds.has(session.sessionId)) {
          if (session.running) {
            mergedSession = { ...mergedSession, running: false, state: "idle", activity: null };
          } else {
            state.cancelPendingSessionIds.delete(session.sessionId);
          }
        }
        return mergeLiveTodos(mergedSession);
      }),
    };
    const wasOffline = state.harnessOffline;
    state.harnessOffline = !dashboard.harness;
    document.body.classList.toggle("harness-offline", state.harnessOffline);
    state.dashboard = dashboard;
    if (Array.isArray(dashboard.workspaces)) {
      state.workspaces = dashboard.workspaces;
      state.workspacesLoaded = true;
      state.workspaceSignature = "";
    }
    if (!dashboard.harness && state.focusMode) setFocusMode(false);
    const dashboardVisibleSessions = visibleSessions(selectedAtRequest);
    const selectionChangedWhileLoading = state.selectedSessionId !== selectedAtRequest;
    // "The session disappears and the chat empties." One unhealthy poll — a Harness restart,
    // an 8s RPC timeout, a laptop waking up — answers {harness:false, sessions:[]}. This used
    // to be treated as authoritative: the selection was dropped, the transcript re-rendered
    // empty, and the next healthy poll re-selected whatever ran first, so a one-second blip
    // left the user reading somebody else's conversation.
    //
    // Two rules now. A session is only forgotten when a HEALTHY dashboard has failed to
    // mention it twice running, and the id is remembered so recovery restores the user's
    // choice instead of guessing.
    if (!selectionChangedWhileLoading && state.selectedSessionId) {
      const present = dashboardVisibleSessions.some((session) => session.sessionId === state.selectedSessionId);
      if (present || !dashboard.harness) {
        state.missingSelectionPolls = 0;
      } else {
        state.missingSelectionPolls += 1;
        if (state.missingSelectionPolls >= 2) {
          state.lastSelectedSessionId = state.selectedSessionId;
          state.selectedSessionId = null;
          state.missingSelectionPolls = 0;
        }
      }
    }
    if (!selectionChangedWhileLoading && !state.selectedSessionId && dashboard.harness && dashboardVisibleSessions.length) {
      const remembered = dashboardVisibleSessions.find((session) => session.sessionId === state.lastSelectedSessionId);
      state.selectedSessionId = (remembered || dashboardVisibleSessions.find((session) => session.running) || dashboardVisibleSessions[0]).sessionId;
      if (remembered) state.lastSelectedSessionId = null;
    }
    if (state.selectedSessionId) state.lastSelectedSessionId = state.selectedSessionId;
    if (!selectionChangedWhileLoading && state.selectedSessionId !== selectedAtRequest) invalidateSelectedHistoryVersion();
    syncGameBarSelection();
    if (dashboard.harness) {
      detectCompletedSessions(dashboard.sessions || []);
      if (state.windowMode === "full") acknowledgeSessionError(state.selectedSessionId);
    } else {
      state.runningSessionIds = new Set();
      state.completedSignalSessionIds.clear();
      state.errorSignalSessionIds.clear();
      state.unacknowledgedErrorSessionIds.clear();
      state.sessionSnapshotsById.clear();
      syncUnacknowledgedErrors();
      state.dashboardInitialized = false;
    }
    syncCompactStatus();
    $("#offlineBanner").classList.toggle("show", !dashboard.harness);
    if (dashboard.harness && !state.harnessStarting) {
      if ($("#offlineBannerText").textContent !== "Harness is offline") $("#offlineBannerText").textContent = "Harness is offline";
      if ($("#startHarnessButton").textContent !== "Start") $("#startHarnessButton").textContent = "Start";
      if ($("#startHarnessButton").disabled) $("#startHarnessButton").disabled = false;
    }
    const selectedSession = dashboard.sessions?.find((session) => session.sessionId === state.selectedSessionId);
    const selectedRunning = Boolean(selectedSession?.running);
    const commandFeedback = commandFeedbackFor(state.selectedSessionId);
    syncRunningControls(selectedRunning);
    if (!dashboard.harness) setAvatar("error", "");
    else if (commandFeedback) {
      setActivity(commandFeedback.activity);
      setAvatar(commandFeedback.avatarMode, commandFeedback.avatarLabel);
    }
    else if (dashboard.sessions?.some((session) => session.running) && (state.windowMode !== "full" || selectedRunning)) {
      const running = selectedSession?.running ? selectedSession : dashboard.sessions.find((session) => session.running);
      if (running?.activity) setActivity(running.activity);
      else setActivity({ active: true, kind: "working", label: "Working", text: "Agent is processing the current turn…" });
      setAvatar("working", running?.activity?.label || "working");
    }
    else if (dashboard.sessions?.some((session) => session.running) && state.windowMode === "full") {
      if (state.currentActivity?.active) setActivity(null);
      if (["working", "waiting"].includes(state.avatarMode)) setAvatar("idle");
    }
    else if ((wasOffline && state.avatarMode === "error" && !state.compactErrorUnread) || !["done", "error"].includes(state.avatarMode)) setAvatar("idle");
    syncSelectedAgentMode();
    renderActivityMeta();
    renderGoal();
    renderSessions();
    renderSessionSelect();
    renderContext();
    renderWorkspaces();
    renderTodos();
    renderQueuedPrompts();
    if (state.selectedSessionId && !state.queuedPromptsBySession.has(state.selectedSessionId)) await loadQueue(state.selectedSessionId);
    if (!state.modelCatalog) await loadModels();
    if (state.commandsLoadedSessionId !== state.selectedSessionId) await loadCommands();
    if (!state.workspacesLoaded) await loadWorkspaces();
    if (state.tab === "chat") {
      if (!state.selectedSessionId) await refreshHistory();
      else if (!selectedLiveStreamIsActive() && !selectedHistoryIsCurrent(selectedSession)) await refreshHistory();
    }
  } finally {
    state.refreshing = false;
  }
}

function startRefreshPass() {
  let tracked;
  tracked = performRefresh().finally(() => {
    if (state.refreshPromise === tracked) state.refreshPromise = null;
  });
  state.refreshPromise = tracked;
  return tracked;
}

async function refresh({ afterCurrent = false } = {}) {
  const active = state.refreshPromise;
  if (!active) return startRefreshPass();
  await active;
  return afterCurrent ? refresh() : state.dashboard;
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
    await refresh({ afterCurrent: true });
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

async function executeHarnessCommand(line, sessionId = state.selectedSessionId, attachments = [], commandDescriptor = null) {
  if (!sessionId) throw new Error("Select or create a session first");
  const command = String(line || "").trim().split(/\s+/, 1)[0] || "Command";
  const commandName = command.replace(/^\//, "").toLowerCase();
  const descriptor = commandDescriptor || state.commandCatalog.find((item) => item.name.toLowerCase() === commandName);
  const sentImageAttachments = descriptor?.input?.images === true
    ? attachments.filter((item) => item?.kind === "image" && item.mediaType && item.data)
    : [];
  const images = sentImageAttachments.map(({ mediaType, data, name }) => ({ mediaType, data, name }));
  const id = state.nextCommandFeedbackId++;
  setCommandFeedback(sessionId, {
    id,
    avatarMode: "working",
    avatarLabel: "running command",
    activity: { active: true, kind: "tool", label: `Running ${command}`, text: `${line}\nWaiting for Harness…` },
  });
  setAvatar("working", "running command");
  try {
    const value = await window.widget.executeCommand({ sessionId, line, images });
    const result = value?.result;
    const failed = result?.kind === "error";
    const selectedMode = failed ? null : modeFromCommand(line);
    if (selectedMode) setSessionAgentMode(sessionId, selectedMode);
    const feedback = {
      id,
      avatarMode: failed ? "error" : "done",
      avatarLabel: failed ? "command error" : "command done",
      activity: {
        active: true,
        kind: failed ? "error" : "done",
        label: `${command} ${failed ? "failed" : "complete"}`,
        text: compactText(result?.text || "Command completed", 320),
      },
    };
    settleCommandFeedback(sessionId, feedback);
    if (!failed && images.length) {
      const submittedPaths = new Set(sentImageAttachments.map((image) => image.path).filter(Boolean));
      state.pendingAttachments = state.pendingAttachments.filter((attachment) => !submittedPaths.has(attachment.path));
      renderAttachments();
    }
    if (sessionId !== state.selectedSessionId) return result;
    renderMessages([
      ...state.currentMessages,
      { role: "user", text: line },
      { role: failed ? "error" : "command", command: commandName, text: result?.text || "Command completed" },
    ]);
    setAvatar(feedback.avatarMode, feedback.avatarLabel);
    await refreshHistory();
    return result;
  } catch (error) {
    settleCommandFeedback(sessionId, {
      id,
      avatarMode: "error",
      avatarLabel: "command error",
      activity: { active: true, kind: "error", label: `${command} failed`, text: compactText(error?.message || error, 320) },
    });
    if (sessionId === state.selectedSessionId) setAvatar("error", "command error");
    throw error;
  }
}

async function stopCurrentTurn() {
  const sessionId = state.selectedSessionId;
  if (!sessionId || state.cancelBusySessionId) return false;
  const turnGeneration = state.turnGenerationsBySession.get(sessionId) || 0;
  state.cancelBusySessionId = sessionId;
  syncRunningControls(true);
  const activity = { active: true, kind: "waiting", label: "Stopping", text: "Waiting for Harness to stop the current turn…" };
  if (sessionId === state.selectedSessionId) {
    setActivity(activity);
    setAvatar("waiting", "stopping");
  }
  try {
    await window.widget.cancel(sessionId);
  } catch (error) {
    if (sessionId === state.selectedSessionId) showTransientActivityError(error, "Could not stop");
    await refresh({ afterCurrent: true }).catch(() => {});
    return false;
  }
  try {
    if ((state.turnGenerationsBySession.get(sessionId) || 0) !== turnGeneration) return true;
    state.cancelPendingSessionIds.add(sessionId);
    bumpLiveSessionRevision(sessionId);
    state.liveStreamsBySession.delete(sessionId);
    clearLiveTodos(sessionId);
    updateLiveSessionState(sessionId, false, null, "idle");
    if (sessionId === state.selectedSessionId) {
      renderMessages(state.currentMessages);
      setActivity(null);
      if (!state.harnessOffline) setAvatar("idle", "stopped");
    }
    await refresh({ afterCurrent: true }).catch(() => {});
    return true;
  } finally {
    if (state.cancelBusySessionId === sessionId) state.cancelBusySessionId = null;
    if (sessionId === state.selectedSessionId) {
      const session = state.dashboard?.sessions?.find((item) => item.sessionId === sessionId);
      syncRunningControls(Boolean(session?.running));
    }
  }
}

async function createNewSession({ restore = true, workspaceId = null } = {}) {
  setAvatar("waiting", "creating session");
  setActivity({ active: true, kind: "working", label: "New session", text: "Creating a Harness session…" });
  try {
    const result = await window.widget.createSession(workspaceId ? { workspaceId } : {});
    state.selectedSessionId = result.sessionId;
    invalidateSelectedHistoryVersion();
    state.selectedWorkspaceId = workspaceId || null;
    setSessionAgentMode(result.sessionId, "agent");
    state.pendingSelection = null;
    state.automaticModelRoute = false;
    state.modelCatalog = null;
    state.modelLoadState = "idle";
    state.commandCatalog = [];
    state.commandsLoadedSessionId = null;
    await refresh({ afterCurrent: true });
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
    await refresh({ afterCurrent: true });
    await selectSession(result.sessionId, true);
    setAvatar("idle", "workspace ready");
  } catch (error) {
    showError(error);
    setAvatar("error", "workspace error");
  }
}

function renderMode() {
  if (state.modeSignature === state.currentMode) return false;
  state.modeSignature = state.currentMode;
  syncPressed($$(".mode-option"), state.currentMode, "mode");
  return true;
}

async function setAgentMode(mode) {
  const sessionId = state.selectedSessionId;
  if (!sessionId) return;
  const previous = state.agentModesBySessionId.get(sessionId) || "agent";
  setSessionAgentMode(sessionId, mode);
  try {
    await executeHarnessCommand(mode === "plan" ? "/plan" : "/plan off", sessionId);
  } catch (error) {
    setSessionAgentMode(sessionId, previous);
    if (sessionId === state.selectedSessionId) {
      showError(error);
      setAvatar("error", "mode error");
    }
  }
}

async function pickAttachments() {
  try {
    addAttachments(await window.widget.pickFiles());
    if (state.pendingAttachments.length && state.windowMode !== "full") {
      setActivity({ active: true, kind: "files", label: "Files ready", text: `${state.pendingAttachments.length} attachment${state.pendingAttachments.length === 1 ? "" : "s"} ready to send.` });
    }
  } catch (error) {
    showTransientActivityError(error, "Attachment failed");
  }
}

function handleScreenshotResult(result) {
  if (result?.canceled) {
    if (state.currentActivity?.kind === "capture") setActivity(null);
    return false;
  }
  if (!result?.ok) throw new Error(result?.error || `Screen capture unavailable: ${result?.reason || "unknown error"}`);
  addAttachments(result.prepared);
  if (!result.prepared?.attachments?.length) throw new Error("The screenshot could not be prepared as an attachment");
  setTab("chat");
  setActivity({
    active: true,
    kind: "files",
    label: result.kind === "region" ? "Region captured" : "Display captured",
    text: "Screenshot attached above the message field. Review it before sending.",
  });
  $("#messageInput").focus();
  return true;
}

async function captureScreenshot(kind) {
  closePickers();
  setActivity({ active: true, kind: "capture", label: "Screen capture", text: kind === "region" ? "Select an area · Esc cancels" : "Capturing the current display…" });
  try {
    return handleScreenshotResult(await window.widget.captureScreenshot(kind));
  } catch (error) {
    showTransientActivityError(error, "Capture failed");
    return false;
  }
}

async function openCommands({ restore = false } = {}) {
  if (restore && state.windowMode !== "full") await setWindowMode("full");
  setTab("chat");
  const input = $("#messageInput");
  if (!input.value.trim()) input.value = "/";
  resizeMessageInput();
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

function applyShowThinking(value) {
  state.showThinking = value !== false;
  $("#showThinkingToggle").checked = state.showThinking;
  syncActivityCard();
  // The compact status shows the same live text on a different chrome. Without this the
  // preference did nothing at all while the widget was collapsed, until some unrelated
  // status change happened to repaint it.
  syncCompactStatus();
  return state.showThinking;
}

function applyCompactAutoExpand(value) {
  state.compactAutoExpand = value === true;
  $("#compactAutoExpandToggle").checked = state.compactAutoExpand;
  syncCompactStatus();
  return state.compactAutoExpand;
}

function setAutoStartStatus(text, error = false) {
  const status = $("#autoStartStatus");
  status.textContent = text;
  status.classList.toggle("error", error);
}

function setHotkeyStatus(text, error = false) {
  const status = $("#hotkeyStatus");
  status.textContent = text;
  status.classList.toggle("error", error);
}

function hotkeyDisplayName(accelerator) {
  if (!accelerator) return "Not set";
  const commandKey = /Mac/i.test(navigator.userAgent) ? "Cmd" : "Ctrl";
  return accelerator.replaceAll("CommandOrControl", commandKey).replaceAll("Control", "Ctrl");
}

function renderHotkeys(bindings = state.hotkeys) {
  state.hotkeys = bindings || {};
  $$('[data-hotkey-action]').forEach((input) => {
    const binding = state.hotkeys[input.dataset.hotkeyAction];
    input.value = hotkeyDisplayName(binding?.accelerator);
    input.title = binding?.accelerator || "Not set";
    input.disabled = binding?.enabled === false;
  });
  $$('[data-hotkey-enabled]').forEach((toggle) => {
    const binding = state.hotkeys[toggle.dataset.hotkeyEnabled];
    toggle.checked = binding?.enabled !== false;
  });
}

function shortcutFromKeyboardEvent(event) {
  if (["Control", "Shift", "Alt", "Meta"].includes(event.key)) return "";
  const aliases = {
    " ": "Space",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    "+": "Plus",
  };
  const key = aliases[event.key] || (/^F(?:[1-9]|1\d|2[0-4])$/.test(event.key) ? event.key : /^[a-z0-9]$/i.test(event.key) ? event.key.toUpperCase() : event.key);
  if (!/^(?:Space|Tab|Enter|Escape|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Up|Down|Left|Right|Plus|F(?:[1-9]|1\d|2[0-4])|[A-Z0-9])$/.test(key)) return "";
  const modifiers = [];
  if (event.ctrlKey || event.metaKey) modifiers.push("CommandOrControl");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  return [...modifiers, key].join("+");
}

async function updateHotkey(action, binding) {
  const previous = state.hotkeys;
  setHotkeyStatus("Saving…");
  let result;
  try {
    result = await window.widget.setHotkeys({ ...previous, [action]: binding });
  } catch (error) {
    renderHotkeys(previous);
    setHotkeyStatus(String(error?.message || error), true);
    return false;
  }
  if (!result?.ok) {
    renderHotkeys(previous);
    setHotkeyStatus(result?.error?.message || "Shortcut is unavailable", true);
    return false;
  }
  renderHotkeys(result.hotkeys);
  setHotkeyStatus("Saved");
  return true;
}

function applyScreenshotCapabilities(capabilities = {}) {
  state.screenshotCapabilities = capabilities;
  for (const kind of ["region", "display"]) {
    const support = capabilities[kind] || {};
    const button = $(`#captureMenu [data-capture="${kind}"]`);
    button.disabled = support.available === false;
    button.title = support.available === false ? support.reason || "Unavailable" : "";
  }
  $("#captureButton").disabled = [capabilities.region, capabilities.display].every((support) => support?.available === false);
}

function renderUpdateState(value) {
  if (!value || typeof value !== "object") return;
  state.updateState = value;
  const status = $("#updateStatus");
  const progress = Number(value.progress);
  const latest = value.latestVersion ? `v${value.latestVersion}` : "";
  const labels = {
    idle: "Ready to check",
    checking: "Checking GitHub Releases…",
    current: value.installMode === "manual" ? "Open GitHub Releases to check this build" : "You have the latest version",
    available: value.installMode === "manual" ? `${latest} is available · open release to install` : `${latest} is available`,
    downloading: `Downloading ${Number.isFinite(progress) ? Math.round(progress) : 0}%…`,
    ready: `${latest} is verified and ready`,
    installing: "Installing update and restarting…",
    error: value.error?.message || "Update check failed",
  };
  status.textContent = labels[value.status] || "Ready to check";
  status.classList.toggle("error", value.status === "error");
  status.classList.toggle("ready", ["current", "ready"].includes(value.status));
  $("#updateVersion").textContent = latest && latest !== `v${value.currentVersion}`
    ? `Current v${value.currentVersion} · Latest ${latest}`
    : `Current v${value.currentVersion || state.appVersion || "…"}`;
  $("#updateBadge").hidden = !["available", "downloading", "ready"].includes(value.status);

  const progressBar = $("#updateProgress");
  const progressValue = Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : 0;
  progressBar.hidden = !["downloading", "ready", "installing"].includes(value.status);
  progressBar.style.setProperty("--update-progress", `${progressValue}%`);
  progressBar.setAttribute("aria-valuenow", String(Math.round(progressValue)));

  const busy = ["checking", "downloading", "installing"].includes(value.status);
  $("#checkUpdateButton").disabled = busy;
  const installButton = $("#installUpdateButton");
  installButton.hidden = !(value.status === "ready" || (["current", "available"].includes(value.status) && value.installMode === "manual"));
  installButton.disabled = busy;
  installButton.textContent = value.installMode === "manual" ? "Open release" : "Install & restart";
  const headerInstallButton = $("#headerUpdateButton");
  headerInstallButton.hidden = value.status !== "ready";
  headerInstallButton.disabled = busy;
  headerInstallButton.title = latest ? `Install ${latest} and restart` : "Install the verified update and restart";
}

async function runUpdateAction(action) {
  const methods = {
    check: "checkForUpdates",
    install: "installUpdate",
  };
  const method = methods[action];
  if (!method || typeof window.widget[method] !== "function") return;
  try {
    renderUpdateState(await window.widget[method]());
  } catch (error) {
    renderUpdateState({
      ...(state.updateState || { currentVersion: state.appVersion }),
      status: "error",
      error: { message: String(error?.message || error) },
    });
  }
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
    ? "Maximum safe layer for borderless fullscreen apps"
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
    applyShowThinking(preferences.showThinking);
    applyCompactAutoExpand(preferences.compactAutoExpand);
    syncPressed($$('#sizeSwitch button'), preferences.size, "size");
    applyPlatformCapabilities(preferences.platformCapabilities);
    applyCompactSide(preferences.compactSide || "right");
    applyWindowMode(preferences.windowMode || "full");
    renderHotkeys(preferences.hotkeys);
    applyScreenshotCapabilities(preferences.screenshotCapabilities);
    if (preferences.hotkeyError) setHotkeyStatus(preferences.hotkeyError.message, true);
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
$("#captureButton").addEventListener("click", (event) => { event.stopPropagation(); togglePicker(event.currentTarget); });
$$('#captureMenu [data-capture]').forEach((button) => button.addEventListener("click", () => captureScreenshot(button.dataset.capture)));
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
  if (event.key === "Escape" && state.windowMode === "orb" && (state.compactHistoryOpen || state.compactReplyOpen)) {
    event.preventDefault();
    event.stopPropagation();
    if (state.compactReplyOpen) closeCompactReply();
    else toggleCompactHistory();
    return;
  }
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
$("#newSessionButton").addEventListener("click", () => createNewSession({ workspaceId: null }));
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
    await refresh({ afterCurrent: true });
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
  if (composerSubmitInFlight) return;
  composerSubmitInFlight = true;
  $("#sendButton").disabled = true;
  $("#sendButton").classList.add("sending");
  const targetSessionId = state.selectedSessionId;
  await composerPastePreparation;
  if (composerPasteFailurePending) {
    composerPasteFailurePending = false;
    composerSubmitInFlight = false;
    $("#sendButton").disabled = false;
    $("#sendButton").classList.remove("sending");
    return;
  }
  const input = $("#messageInput");
  const text = input.value.trim();
  if (!text && !state.pendingAttachments.length) {
    composerSubmitInFlight = false;
    $("#sendButton").disabled = false;
    $("#sendButton").classList.remove("sending");
    return;
  }
  const submittedSelection = state.pendingSelection;
  const submittedAttachments = [...state.pendingAttachments];
  const queueingBehindTurn = Boolean(targetSessionId && state.runningSessionIds.has(targetSessionId));
  const queueRevisionAtSubmit = queueSnapshotRevision(targetSessionId);
  const attachmentCount = submittedAttachments.length;
  let submittedCommand = false;
  $("#agentControls").open = false;
  setSettingsOpen(false, { restoreFocus: false });
  setCommandMenuOpen(false);
  closePickers();
  input.value = "";
  resizeMessageInput();
  input.placeholder = "Message the agent…";
  renderCommandHint();
  try {
    const slashMatch = /^\/(\S+)/.exec(text);
    if (slashMatch && state.commandsLoadedSessionId !== targetSessionId) await loadCommands();
    const commandEntry = slashMatch
      ? state.commandCatalog.find((command) => command.name.toLowerCase() === slashMatch[1].toLowerCase())
      : null;
    if (slashMatch && !commandEntry) {
      throw new Error(state.commandCatalog.length
        ? `Unknown Harness command: /${slashMatch[1]}`
        : "Harness commands are unavailable. Try again when Harness is online.");
    }
    // A skill is not a host command. Harness's own composer inserts "/name" and sends it as
    // an ordinary message for the model to act on; commands/execute would reject it.
    if (commandEntry && commandEntry.kind !== "skill") {
      submittedCommand = true;
      await executeHarnessCommand(text, targetSessionId, submittedAttachments, commandEntry);
    } else {
      setAvatar("working", "sending");
      const result = await window.widget.send({
        sessionId: targetSessionId,
        text,
        selection: submittedSelection,
        attachments: submittedAttachments,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      const stillOwnsVisibleSession = state.selectedSessionId === targetSessionId;
      if (stillOwnsVisibleSession) {
        state.selectedSessionId = result.sessionId;
        if (!targetSessionId) setSessionAgentMode(result.sessionId, "agent");
      }
      clearComposerError();
      if (queueingBehindTurn) trackQueuedPrompt(result.sessionId, { text, attachmentCount }, queueRevisionAtSubmit);
      const submittedPaths = new Set(submittedAttachments.map((attachment) => attachment.path));
      state.pendingAttachments = state.pendingAttachments.filter((attachment) => !submittedPaths.has(attachment.path));
      renderAttachments();
      if (stillOwnsVisibleSession) {
        setAvatar("waiting", "waiting for reply");
        await refresh({ afterCurrent: true });
      }
    }
  } catch (error) {
    if (state.selectedSessionId === targetSessionId) {
      if (!input.value.trim()) input.value = text;
      resizeMessageInput();
      showComposerError(error, submittedCommand ? "Command failed" : "Message not sent");
    }
  } finally {
    composerSubmitInFlight = false;
    $("#sendButton").disabled = false;
    $("#sendButton").classList.remove("sending");
    if (state.selectedSessionId === targetSessionId) input.focus();
  }
});
$("#composerErrorDismiss").addEventListener("click", () => {
  clearComposerError();
  $("#messageInput").focus();
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
$("#messageInput").addEventListener("paste", (event) => { handleComposerPaste(event); });
$("#messageInput").addEventListener("input", async (event) => {
  resizeMessageInput();
  const slashMode = /^\/[^\s]*$/.test(event.target.value);
  if (!slashMode) {
    setCommandMenuOpen(false);
    if (!event.target.value) event.target.placeholder = "Message the agent…";
    renderCommandHint();
    return;
  }
  if (state.commandsLoadedSessionId !== state.selectedSessionId) await loadCommands();
  renderCommands(commandQuery());
  renderCommandHint();
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
  if (state.scrollLatestAutoScrolling) {
    if (nearBottom) finishScrollLatestAutoScroll();
    return;
  }
  state.messagesStickToBottom = nearBottom;
  if (nearBottom) state.unseenMessages = 0;
  updateScrollLatestButton();
  syncMessageMagnet();
  scheduleMessageMagnet();
});
// Scrolling under your own hand releases the pin at once; it only exists to keep a rebuild
// from landing on top of a jump that is still in flight.
for (const eventName of ["wheel", "pointerdown", "keydown"]) {
  $("#messages").addEventListener(eventName, releaseMessageScrollPin, { passive: true });
}
$("#scrollLatestButton").addEventListener("click", () => {
  releaseMessageScrollPin();
  clearTimeout(state.scrollLatestAutoScrollTimer);
  state.scrollLatestAutoScrolling = true;
  state.messagesStickToBottom = true;
  state.unseenMessages = 0;
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  state.scrollLatestAutoScrollTimer = setTimeout(finishScrollLatestAutoScroll, reduceMotion ? 0 : 900);
  $("#messages").scrollTo({ top: $("#messages").scrollHeight, behavior: reduceMotion ? "auto" : "smooth" });
  updateScrollLatestButton();
});
$("#todoToggle").addEventListener("click", () => {
  const sessionId = state.selectedSessionId;
  if (!sessionId) return;
  if (state.todoExpandedSessionIds.has(sessionId)) state.todoExpandedSessionIds.delete(sessionId);
  else state.todoExpandedSessionIds.add(sessionId);
  renderTodos();
});
// A <details> toggles itself; the extra work is only closing an open editor when the whole
// dock is collapsed, so reopening it never lands mid-edit.
$("#goalDock").addEventListener("toggle", () => {
  if (!$("#goalDock").open && state.goalEditing) { state.goalEditing = false; state.goalSignature = ""; renderGoal(); }
});
$("#goalEdit").addEventListener("click", () => {
  state.goalEditing = true;
  state.goalSignature = "";
  $("#goalDock").open = true;
  renderGoal();
  requestAnimationFrame(() => { const input = $("#goalEditInput"); input.focus(); input.select(); });
});
$("#goalEditCancel").addEventListener("click", () => { state.goalEditing = false; state.goalSignature = ""; renderGoal(); });
$("#goalEditInput").addEventListener("input", () => {
  const input = $("#goalEditInput");
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, QUEUE_EDIT_MAX_HEIGHT)}px`;
});
const saveGoalEdit = () => {
  const text = $("#goalEditInput").value.trim();
  const current = goalFor();
  if (!text) return;
  if (current && text === current.objective) { state.goalEditing = false; state.goalSignature = ""; renderGoal(); return; }
  runGoalCommand(`/goal edit ${text}`);
};
$("#goalEditSave").addEventListener("click", saveGoalEdit);
$("#goalEditInput").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); saveGoalEdit(); }
  if (event.key === "Escape") { state.goalEditing = false; state.goalSignature = ""; renderGoal(); }
});
$("#goalPauseResume").addEventListener("click", () => {
  const goal = goalFor();
  if (!goal) return;
  runGoalCommand(goal.phase === "paused" ? "/goal resume" : "/goal pause");
});
$("#goalDelete").addEventListener("click", () => {
  // Clearing the goal is destructive and the projection vanishes with it, so it takes a
  // second press. The button says so in between rather than opening a modal over a widget
  // this small.
  const button = $("#goalDelete");
  const labelNode = $("#goalDeleteLabel");
  const rest = () => { button.dataset.confirm = ""; labelNode.hidden = true; button.title = "Delete the goal"; };
  if (button.dataset.confirm !== "1") {
    button.dataset.confirm = "1";
    labelNode.hidden = false;
    button.title = "Press again to delete the goal";
    clearTimeout(state.goalDeleteConfirmTimer);
    state.goalDeleteConfirmTimer = setTimeout(rest, 3200);
    return;
  }
  clearTimeout(state.goalDeleteConfirmTimer);
  rest();
  runGoalCommand("/goal clear");
});
$("#cancelButton").addEventListener("click", () => { stopCurrentTurn().catch(showError); });
$("#focusChatButton").addEventListener("click", () => setFocusMode(!state.focusMode));
$("#startHarnessButton").addEventListener("click", startHarnessFromBanner);
$("#openHarnessButton").addEventListener("click", () => window.widget.openHarness());
$("#openSessionButton").addEventListener("click", () => {
  if (state.selectedSessionId) window.widget.openHarnessSession(state.selectedSessionId);
});
$("#dockButton").addEventListener("click", () => setWindowMode("edge"));
$("#orbRestore").addEventListener("click", (event) => { if (suppressCompactClick) event.preventDefault(); else setWindowMode("full"); });
$("#orbHistoryButton").addEventListener("click", toggleCompactHistory);
$("#orbStatusCard").addEventListener("click", () => openCompactSession().catch(showError));
$("#orbReplyClose").addEventListener("click", () => closeCompactReply());
$("#orbReplyForm").addEventListener("submit", (event) => {
  event.preventDefault();
  sendCompactReply().catch(() => {});
});
$("#orbReplyInput").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    $("#orbReplyForm").requestSubmit();
  }
});
$("#edgeMode").addEventListener("click", (event) => {
  if (suppressCompactClick) event.preventDefault();
  else if (compactPreviewEntry()?.sessionId) openCompactSession().catch(showError);
  else setWindowMode("full");
});
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
window.addEventListener("resize", () => {
  resizeMessageInput({ immediate: true });
  resizeCommandMenu();
  syncCrowdedChatState();
  $$(".picker.open").forEach(positionPickerMenu);
});
for (const target of [$(".titlebar")]) {
  target.addEventListener("pointerdown", beginFullDrag);
  target.addEventListener("pointermove", moveFullDrag);
  target.addEventListener("pointerup", endFullDrag);
  target.addEventListener("pointercancel", endFullDrag);
}
// Pointer taps are resolved in endFullDrag, because pointer capture on the titlebar
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
$("#showThinkingToggle").addEventListener("change", async (event) => {
  const toggle = event.currentTarget;
  const previous = state.showThinking;
  const requested = applyShowThinking(toggle.checked);
  toggle.disabled = true;
  try {
    applyShowThinking(await window.widget.setShowThinking(requested));
  } catch {
    applyShowThinking(previous);
  } finally {
    toggle.disabled = false;
  }
});
$("#compactAutoExpandToggle").addEventListener("change", async (event) => {
  const toggle = event.currentTarget;
  const previous = state.compactAutoExpand;
  const requested = applyCompactAutoExpand(toggle.checked);
  toggle.disabled = true;
  try {
    applyCompactAutoExpand(await window.widget.setCompactAutoExpand(requested));
  } catch {
    applyCompactAutoExpand(previous);
  } finally {
    toggle.disabled = false;
  }
});
$$('[data-hotkey-action]').forEach((input) => {
  input.addEventListener("focus", () => setHotkeyStatus("Press a new combination · Esc cancels"));
  input.addEventListener("keydown", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      renderHotkeys();
      setHotkeyStatus("Canceled");
      input.blur();
      return;
    }
    const accelerator = shortcutFromKeyboardEvent(event);
    if (!accelerator) {
      setHotkeyStatus("Include one supported key", true);
      return;
    }
    input.value = accelerator;
    if (await updateHotkey(input.dataset.hotkeyAction, { enabled: true, accelerator })) input.blur();
  });
});
$$('[data-hotkey-enabled]').forEach((toggle) => toggle.addEventListener("change", async () => {
  const action = toggle.dataset.hotkeyEnabled;
  const current = state.hotkeys[action];
  await updateHotkey(action, { enabled: toggle.checked, accelerator: current?.accelerator });
}));
$("#resetHotkeysButton").addEventListener("click", async () => {
  const result = await window.widget.resetHotkeys();
  if (result?.ok) {
    renderHotkeys(result.hotkeys);
    setHotkeyStatus("Defaults restored");
  } else {
    setHotkeyStatus(result?.error?.message || "Could not restore shortcuts", true);
  }
});
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
$("#checkUpdateButton").addEventListener("click", () => runUpdateAction("check"));
$("#installUpdateButton").addEventListener("click", () => runUpdateAction("install"));
$("#headerUpdateButton").addEventListener("click", () => runUpdateAction("install"));

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

window.widget.onWindowMode((mode) => applyAuthoritativeWindowMode(mode));
window.widget.onFirstVisible(playFirstVisibleEntry);
window.widget.onCompactSide((side) => applyCompactSide(side));
window.widget.onQueueUpdate(({ sessionId, items, revision }) => {
  if (!sessionId) return;
  applyQueueSnapshot(sessionId, items, revision);
});
window.widget.onLiveEvent((payload) => { handleLiveEvent(payload).catch(showError); });
window.widget.onHotkeyAction((action) => {
  if (action === "newSession") createNewSession();
  else if (action === "toggleFocusChat") setFocusMode(!state.focusMode);
});
window.widget.onHotkeyError((error) => setHotkeyStatus(error?.message || "Shortcut failed", true));
window.widget.onScreenshotCaptured((result) => {
  try { handleScreenshotResult(result); } catch (error) { showError(error); }
});
window.widget.onUpdateState((value) => renderUpdateState(value));
window.widget.onGameBarSelectSession((sessionId) => { selectSession(sessionId, true).catch(showError); });
window.widget.onEdgeBounce(() => {
  const edge = $("#edgeMode");
  edge.classList.remove("bounce");
  void edge.offsetWidth;
  edge.classList.add("bounce");
});
hydratePreferences();
window.widget.getAppInfo().then((info) => {
  state.appVersion = info.version;
  $("#versionLabel").textContent = `v${info.version}`;
  $("#projectLink").title = `Open NeoXider/neoxider-agent-deck v${info.version} on GitHub`;
  $("#updateVersion").textContent = `Current v${info.version}`;
});
window.widget.getUpdateState().then((value) => renderUpdateState(value)).catch(() => {});

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
renderTodos();
renderQueuedPrompts();
renderMode();
resizeMessageInput({ immediate: true });
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
    if (screenshotFixture === "empty-chat") {
      setTab("chat");
      state.dashboard = { harness: true, sessions: [] };
      state.selectedSessionId = null;
      renderSessions();
      renderSessionSelect();
      renderContext();
      renderMessages([]);
    } else if (["edge-idle", "edge-hover"].includes(screenshotFixture)) {
      setAvatar("idle", "");
      setActivity(null);
      state.dashboard = { harness: true, sessions: [] };
      if (screenshotFixture === "edge-hover") {
      $("#edgeMode").classList.add("edge-hit-active");
      }
    } else if (["offline", "offline-agents", "focus-offline"].includes(screenshotFixture)) {
      setTab("chat");
      if (screenshotFixture === "focus-offline") setFocusMode(true);
      state.dashboard = { harness: false, sessions: [] };
      state.harnessOffline = true;
      document.body.classList.add("harness-offline");
      state.selectedSessionId = null;
      if (state.focusMode) setFocusMode(false);
      $("#offlineBanner").classList.add("show");
      setAvatar("error", "");
      syncCompactStatus();
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
    } else if (["workspace-groups", "workspace-groups-chat"].includes(screenshotFixture)) {
      if (screenshotFixture === "workspace-groups-chat") setTab("chat");
      const workspace = {
        workspaceId: "workspace-neoxider",
        title: "NeoXider Widget",
        path: "C:\\AI\\work\\neoxider-agent-deck",
        sessionIds: ["grouped-active", "grouped-review"],
      };
      state.dashboard = {
        harness: true,
        workspaces: [workspace],
        archivedSessionIds: [],
        sessions: [
          { sessionId: "grouped-active", title: "Compact widget polish", running: true, state: "working", projections: { values: {} }, subagents: [] },
          { sessionId: "grouped-review", title: "Release review", running: false, state: "idle", projections: { values: {} }, subagents: [] },
          { sessionId: "ungrouped-notes", title: "Ungrouped notes", running: false, state: "idle", projections: { values: {} }, subagents: [] },
        ],
      };
      state.workspaces = [workspace];
      state.selectedSessionId = "ungrouped-notes";
      state.modelCatalog = {
        current: { provider: "lmstudio", model: "qwen3.8-27b-unleashed", reasoningEffort: "medium" },
        groups: [{ id: "lmstudio", name: "LM Studio", models: [{ id: "qwen3.8-27b-unleashed", name: "Qwen 3.8 27B", reasoning: { defaultEffort: "medium", efforts: [{ id: "medium", name: "Medium" }] } }] }],
      };
      state.modelLoadState = "ready";
      state.pendingSelection = state.modelCatalog.current;
      renderModels();
      $("#controlsSummary").textContent = "LM Studio · Qwen 3.8 27B · Medium";
      state.collapsedSessionGroupKeys.clear();
      if (screenshotFixture === "workspace-groups") state.collapsedSessionGroupKeys.add("workspace:workspace-neoxider");
      state.sessionListSignature = "";
      state.sessionSelectSignature = "";
      renderSessions();
      renderSessionSelect();
      if (screenshotFixture === "workspace-groups-chat") {
        clearTimeout(state.transientActivityTimer);
        setActivity(null);
        setAvatar("idle", "ready");
        renderMessages([{ role: "assistant", text: "Choose a session or start one inside a Harness workspace." }]);
        togglePicker($("#sessionButton"));
      } else {
        setTab("agents");
      }
    } else if (["small-chat", "composer-single-line", "composer-multiline"].includes(screenshotFixture)) {
      setTab("chat");
      state.dashboard = { harness: true, sessions: [{ sessionId: "demo-small", title: "Compact chat", running: false, projections: { values: { contextPressure: { projectedTokens: 4200, contextWindow: 65536 } } }, subagents: [] }] };
      state.selectedSessionId = "demo-small";
      renderSessionSelect();
      renderContext();
      renderMessages([{ role: "assistant", text: "Ready for the next task." }]);
      const input = $("#messageInput");
      input.value = screenshotFixture === "composer-multiline"
        ? Array.from({ length: 24 }, (_, index) => `Line ${index + 1}: keep the growing composer readable.`).join("\n")
        : "";
      resizeMessageInput({ immediate: true });
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
    } else if (screenshotFixture === "crowded-chat") {
      setTab("chat");
      state.dashboard = { harness: true, sessions: [{ sessionId: "demo-crowded", title: "Crowded compact chat", running: true, state: "working", projections: { values: { todos: [
        { content: "Inspect the compact panel", status: "completed" },
        { content: "Verify the combined budget", status: "in_progress" },
        { content: "Capture the final evidence", status: "pending" },
      ] } }, subagents: [] }] };
      state.selectedSessionId = "demo-crowded";
      state.runningSessionIds = new Set(["demo-crowded"]);
      state.showThinking = true;
      $("#showThinkingToggle").checked = true;
      state.todoExpandedSessionIds.add("demo-crowded");
      state.queuedPromptsBySession.set("demo-crowded", [
        { id: "crowded-queue-1", placement: "queued", text: "Run the remaining visual checks.", preview: "Run the remaining visual checks." },
        { id: "crowded-queue-2", placement: "queued", text: "Summarize the compact result.", preview: "Summarize the compact result." },
      ]);
      state.pendingAttachments = [{ kind: "file", name: "compact-evidence.txt", path: "C:\\fixture\\compact-evidence.txt" }];
      renderSessionSelect();
      renderContext();
      renderTodos();
      renderQueuedPrompts();
      renderAttachments();
      renderMessages(Array.from({ length: 6 }, (_, index) => ({
        role: index % 2 ? "user" : "assistant",
        text: index === 0 ? "Short message remains visible." : `Compact history message ${index + 1}.`,
      })));
      setActivity({ active: true, kind: "thinking", label: "Thinking", text: "Checking the compact layout budget…" });
      $("#messages").scrollTop = 0;
    } else if (screenshotFixture === "todo") {
      setTab("chat");
      state.dashboard = { harness: true, sessions: [{ sessionId: "demo-todo", title: "Release verification", running: true, state: "working", projections: { values: { todos: [
        { content: "Inspect the current session", status: "completed" },
        { content: "Verify live streaming and tools", status: "in_progress" },
        { content: "Build the Windows release", status: "pending" },
      ] } }, subagents: [] }] };
      state.selectedSessionId = "demo-todo";
      state.todoExpandedSessionIds.add("demo-todo");
      renderSessionSelect();
      renderTodos();
      renderMessages([{ role: "assistant", text: "The current plan stays compact above the conversation." }]);
    } else if (screenshotFixture === "goal-result") {
      setTab("chat");
      renderMessages([
        { role: "user", text: "/goal" },
        { role: "command", command: "goal", text: "Status: active\nObjective: Ship the verified NeoXider Agent Deck release\nRounds: 3/4\nActivation: manual" },
      ]);
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
    } else if (["goal-collapsed", "goal-expanded", "goal-paused"].includes(screenshotFixture)) {
      setTab("chat");
      const paused = screenshotFixture === "goal-paused";
      const goal = {
        goal: {
          id: "goal-demo", revision: 12,
          objective: "Reach the checkout flow, apply the launch coupon, and confirm the order total updates before payment. Keep a note of every step that needed a retry.",
          phase: paused ? "paused" : "active",
          maxGoalRounds: 12,
        },
        roundsStarted: 4,
      };
      state.dashboard = { harness: true, sessions: [{ sessionId: "demo-goal", title: "Long-running agent", running: true, state: "working", projections: { values: { goal } }, subagents: [] }] };
      state.selectedSessionId = "demo-goal";
      state.runningSessionIds = new Set(["demo-goal"]);
      renderMessages([{ role: "user", text: "/goal" }, { role: "assistant", text: "Working on the goal." }]);
      renderGoal();
      if (screenshotFixture !== "goal-collapsed") $("#goalDock").open = true;
    } else if (["message-marks", "mark-jump"].includes(screenshotFixture)) {
      // A conversation long enough to scroll, so the rail has somewhere to put marks.
      setTab("chat");
      state.dashboard = { harness: true, sessions: [{ sessionId: "demo-marks", title: "Long conversation", running: false, projections: { values: {} }, subagents: [] }] };
      state.selectedSessionId = "demo-marks";
      const history = [];
      for (let turn = 1; turn <= 5; turn += 1) {
        history.push({ role: "user", text: `Question ${turn}: what did the last run report?` });
        history.push({ role: "assistant", text: `Answer ${turn}. ${"The agent explains the result at some length so the log has to scroll. ".repeat(3)}` });
      }
      renderMessages(history);
      $("#messages").scrollTop = 0;
      state.messagesStickToBottom = false;
      syncMessageMagnet();
      renderMessageMarks();
      updateScrollLatestButton();
      if (screenshotFixture === "mark-jump") {
        // The reported failure: press a mark, then let the poll rebuild the log right on
        // top of the jump. Without the pin the rebuild restores the offset it captured
        // mid-flight and the press looks like it did nothing.
        // An early message, so the jump is a real move rather than a scroll that clamps
        // at the bottom of the log and proves nothing.
        const target = 1;
        window.__markJump = { target };
        $$("#messageMarks .message-mark")[target].click();
        renderMessages(history);
        paintLiveAssistant();
      }
    } else if (["queued-long", "queued-editing"].includes(screenshotFixture)) {
      // The reported case: a queued background job whose command is far longer than the
      // one-line row, opened so the whole of it can be read.
      const command = "background job pwsh-4 (pwsh: Set-Location D:\\Git\\web-search-neo; npm run build -- --profile release --target win-x64; if ($LASTEXITCODE -eq 0) { npm run verify -- --suite full --reporter json > artifacts/verify.json })";
      setTab("chat");
      state.dashboard = { harness: true, sessions: [{ sessionId: "demo-queue-long", title: "Long-running agent", running: true, projections: { values: {} }, subagents: [] }] };
      state.selectedSessionId = "demo-queue-long";
      state.runningSessionIds = new Set(["demo-queue-long"]);
      $("#chatForm").classList.add("has-running");
      $("#cancelButton").hidden = false;
      renderMessages([{ role: "assistant", text: "The current turn is still running…" }]);
      state.queuedPromptsBySession.set("demo-queue-long", [
        { id: "queue-long-1", placement: "queued", text: command, preview: command },
        { id: "queue-long-2", placement: "queued", text: "Then summarize only the failures.", preview: "Then summarize only the failures." },
      ]);
      if (screenshotFixture === "queued-editing") {
        state.queueEditingId = "queue-long-1";
        state.queueEditingSessionId = "demo-queue-long";
      } else {
        state.queueExpandedId = "queue-long-1";
        state.queueExpandedSessionId = "demo-queue-long";
      }
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
    } else if (["update-ready", "managed-update-available"].includes(screenshotFixture)) {
      setTab("chat");
      renderUpdateState(screenshotFixture === "update-ready"
        ? { status: "ready", currentVersion: "0.6.16", latestVersion: "0.6.17", installMode: "portable-replace", progress: 100 }
        : { status: "available", currentVersion: "0.6.8", latestVersion: "0.6.9", installMode: "managed", progress: 0 });
      setSettingsOpen(true, { restoreFocus: false });
    } else if (screenshotFixture === "hotkey-settings") {
      setTab("chat");
      renderHotkeys({
        showRestore: { enabled: true, accelerator: "CommandOrControl+Alt+Shift+Space" },
        toggleFocusChat: { enabled: true, accelerator: "CommandOrControl+Alt+Shift+F" },
        collapseAvatar: { enabled: true, accelerator: "CommandOrControl+Alt+Shift+A" },
        collapseEdge: { enabled: true, accelerator: "CommandOrControl+Alt+Shift+E" },
        newSession: { enabled: true, accelerator: "CommandOrControl+Alt+Shift+N" },
        openHarness: { enabled: true, accelerator: "CommandOrControl+Alt+Shift+H" },
        captureDisplay: { enabled: true, accelerator: "CommandOrControl+Alt+Shift+D" },
        captureRegion: { enabled: true, accelerator: "CommandOrControl+Alt+Shift+S" },
      });
      setSettingsOpen(true, { restoreFocus: false });
      $("#hotkeySettings").open = true;
    } else if (screenshotFixture === "capture-menu") {
      setTab("chat");
      applyScreenshotCapabilities({ region: { available: true }, display: { available: true } });
      togglePicker($("#captureButton"));
    } else if (screenshotFixture === "attachments") {
      setTab("chat");
      const paths = (launchParams.get("screenshotFiles") || "").split("|").filter(Boolean);
      if (paths.length) addAttachments(await window.widget.prepareFiles(paths));
      else {
        const previewData = async (video = false) => {
          const mascot = new Image();
          mascot.src = "./assets/avatar-working.png";
          await mascot.decode();
          const canvas = document.createElement("canvas");
          canvas.width = 96;
          canvas.height = 64;
          const context = canvas.getContext("2d");
          const gradient = context.createLinearGradient(0, 0, 96, 64);
          gradient.addColorStop(0, "#102c38");
          gradient.addColorStop(0.55, "#173249");
          gradient.addColorStop(1, "#281d4b");
          context.fillStyle = gradient;
          context.fillRect(0, 0, 96, 64);
          context.fillStyle = "rgba(73,231,198,.14)";
          context.beginPath();
          context.arc(18, 13, 10, 0, Math.PI * 2);
          context.fill();
          context.drawImage(mascot, 27, 4, 42, 52);
          context.strokeStyle = "rgba(73,231,198,.30)";
          context.lineWidth = 1;
          context.beginPath();
          context.moveTo(0, 50);
          context.quadraticCurveTo(25, 42, 48, 51);
          context.quadraticCurveTo(72, 58, 96, 47);
          context.stroke();
          if (video) {
            context.fillStyle = "rgba(4,8,14,.58)";
            context.fillRect(0, 0, 96, 64);
            context.fillStyle = "rgba(255,255,255,.95)";
            context.beginPath();
            context.moveTo(43, 23);
            context.lineTo(43, 43);
            context.lineTo(59, 33);
            context.closePath();
            context.fill();
            context.fillStyle = "rgba(255,255,255,.72)";
            for (let x = 5; x < 94; x += 14) {
              context.fillRect(x, 4, 7, 3);
              context.fillRect(x, 57, 7, 3);
            }
          }
          return canvas.toDataURL("image/png").split(",")[1];
        };
        addAttachments([
          { kind: "image", mediaType: "image/png", data: await previewData(), path: "C:\\demo\\neoxider-agent.png", name: "neoxider-agent.png" },
          { kind: "reference", previewKind: "video", thumbnailData: await previewData(true), thumbnailMediaType: "image/png", path: "C:\\demo\\agent-mode-demo.mp4", name: "agent-mode-demo.mp4" },
          { kind: "reference", previewKind: "file", path: "C:\\demo\\release-notes.md", name: "release-notes.md" },
        ]);
      }
      const image = state.pendingAttachments.find((attachment) => attachment.kind === "image");
      renderMessages([
        { role: "user", text: "Please review these files.", attachments: [
          image ? { kind: "image", mediaType: image.mediaType, data: image.data, name: image.name } : null,
          { kind: "reference", previewKind: "file", name: "release-notes.md" },
        ].filter(Boolean) },
        { role: "user", text: "", attachments: [{ kind: "reference", previewKind: "video", name: "agent-mode-demo.mp4" }] },
      ]);
    } else if (["orb-recent-three", "orb-recent-three-left", "orb-quick-reply"].includes(screenshotFixture)) {
      state.dashboard = { harness: true, sessions: [
        { sessionId: "demo-build", title: "Build review", updatedAt: Date.now(), running: false, state: "idle", preview: "Windows package passed the final verification.", projections: { values: {} }, subagents: [] },
        { sessionId: "demo-unity", title: "Unity gameplay", updatedAt: Date.now() - 1000, running: false, state: "idle", preview: "Play Mode checks completed successfully.", projections: { values: {} }, subagents: [] },
        { sessionId: "demo-mcp", title: "Capability Hub", updatedAt: Date.now() - 2000, running: true, state: "working", preview: "Dynamic MCP routing is ready for the next call.", projections: { values: {} }, subagents: [] },
      ] };
      state.selectedSessionId = "demo-build";
      state.compactNotification = null;
      state.compactHistoryOpen = true;
      state.compactReplyOpen = false;
      if (screenshotFixture === "orb-recent-three-left") applyCompactSide("left");
      if (screenshotFixture === "orb-quick-reply") openCompactReply("demo-build");
      else syncCompactStatus();
    } else if (screenshotFixture === "orb-notification") {
      state.dashboard = { harness: true, sessions: [{ sessionId: "demo-notification", title: "Unity gameplay pass", updatedAt: Date.now(), running: false, state: "idle", preview: "The Play Mode verification finished successfully.", projections: { values: {} }, subagents: [] }] };
      state.selectedSessionId = "demo-notification";
      state.compactReplySessionId = "demo-notification";
      state.compactNotification = { kind: "notification", sessionId: "demo-notification", title: "Unity gameplay pass", text: "The Play Mode verification finished successfully." };
      setAvatar("done", "done");
      syncCompactStatus();
    } else if (screenshotFixture === "edge-working") {
      setAvatar("working", "working");
      setActivity(null);
    } else if (screenshotFixture === "thinking") {
      setTab("chat");
      setAvatar("working", "thinking");
      setActivity({ active: true, kind: "thinking", label: "Thinking", text: "Reviewing the workspace and preparing the next tool call…" });
    } else if (screenshotFixture === "activity-meta") {
      // A turn 21 minutes in with two background tasks running under it — the state the
      // Chat panel used to describe as nothing but a line of reasoning text.
      const started = Date.now() - 1310000;
      setTab("chat");
      state.dashboard = { harness: true, sessions: [{ sessionId: "demo-long", title: "Long turn", running: true, state: "working", runningSince: started, projections: { values: {} }, subagents: [
        { kind: "child", activity: "running" },
        { kind: "child", activity: "running" },
        { kind: "child", activity: "idle" },
      ] }] };
      state.selectedSessionId = "demo-long";
      state.runningSessionIds = new Set(["demo-long"]);
      setAvatar("working", "thinking");
      setActivity({ active: true, kind: "thinking", label: "Thinking", text: "Weighing the remaining branches before the next tool call…" });
    } else if (screenshotFixture === "send-rejected") {
      // The rejection Harness returns for an image the model is not allowed to receive,
      // with the message and its attachment still in the composer where they were left.
      setTab("chat");
      state.dashboard = { harness: true, sessions: [{ sessionId: "demo-rejected", title: "Image message", running: true, state: "working", runningSince: Date.now() - 92000, projections: { values: {} }, subagents: [] }] };
      state.selectedSessionId = "demo-rejected";
      state.runningSessionIds = new Set(["demo-rejected"]);
      state.pendingAttachments = [{ kind: "image", name: "image.png", path: "C:\fixture\image.png" }];
      renderAttachments();
      $("#messageInput").value = "Look at this screenshot and tell me what is wrong.";
      resizeMessageInput();
      showComposerError(new Error("The current model does not support images; switch to a model with vision support."), "Message not sent");
      setAvatar("working", "thinking");
      setActivity({ active: true, kind: "thinking", label: "Thinking", text: "Continuing the turn that was already running…" });
    } else if (screenshotFixture === "thinking-hidden") {
      setTab("chat");
      applyShowThinking(false);
      setAvatar("working", "thinking");
      setActivity({ active: true, kind: "thinking", label: "Thinking", text: "This compact reasoning line stays hidden by preference." });
    } else if (screenshotFixture === "working-hidden") {
      // The reported regression: every tool result clears the activity and this "working"
      // fallback took its place, so the card came back a second after being switched off.
      setTab("chat");
      applyShowThinking(false);
      setAvatar("working", "working");
      setActivity({ active: true, kind: "working", label: "Working", text: "Agent is processing the current turn…" });
    } else if (screenshotFixture === "tool-hidden") {
      setTab("chat");
      applyShowThinking(false);
      setAvatar("working", "using tool");
      setActivity({ active: true, kind: "tool", label: "Using tool", text: "read_file" });
    } else if (screenshotFixture === "orb-collapsed") {
      // Avatar mode with an agent working: the circle stays a circle and the count goes on
      // the expand button instead of a 400 px panel opening over the user's screen.
      applyCompactAutoExpand(false);
      state.dashboard = { harness: true, sessions: [
        { sessionId: "demo-a", title: "Release verification", updatedAt: Date.now(), running: true, state: "working", preview: "Building the installer.", projections: { values: {} }, subagents: [] },
        { sessionId: "demo-b", title: "Docs pass", updatedAt: Date.now() - 900, running: true, state: "working", preview: "Rewriting the changelog.", projections: { values: {} }, subagents: [] },
      ] };
      setAvatar("working", "working");
      setActivity({ active: true, kind: "working", label: "Working", text: "Agent is processing the current turn…" });
      renderSessions();
      syncCompactStatus();
    } else if (screenshotFixture === "orb-auto-expand") {
      applyCompactAutoExpand(true);
      setAvatar("working", "working");
      setActivity({ active: true, kind: "working", label: "Working", text: "Agent is processing the current turn…" });
      syncCompactStatus();
    } else if (screenshotFixture === "session-times") {
      setTab("agents");
      const now = Date.now();
      state.dashboard = { harness: true, sessions: [
        // Two background tasks running out of three children: the finished one must not be
        // counted, which is what the old "3 subagents" roster size got wrong.
        { sessionId: "demo-running", title: "Long build", updatedAt: now, running: true, state: "working", runningSince: now - 754000, projections: { values: {} }, subagents: [{ kind: "child", activity: "running" }, { kind: "child", activity: "running" }, { kind: "child", activity: "idle" }] },
        { sessionId: "demo-just-started", title: "Fresh turn", updatedAt: now, running: true, state: "working", runningSince: now - 7000, projections: { values: {} }, subagents: [] },
        { sessionId: "demo-finished", title: "Finished earlier", updatedAt: now - 5000, running: false, state: "idle", lastRunMs: 128000, projections: { values: {} }, subagents: [{ kind: "child", activity: "idle" }] },
      ] };
      renderSessions();
    } else if (screenshotFixture === "writing") {
      setTab("chat");
      setAvatar("working", "writing");
      setActivity({ active: true, kind: "writing", label: "Writing", text: "Composing the answer in the mini-chat…" });
      renderMessages([]);
    } else if (screenshotFixture === "tool") {
      setTab("chat");
      setAvatar("working", "using tool");
      setActivity({ active: true, kind: "tool", label: "Using tool", text: "read_file" });
    } else if (["edge-done", "edge-done-cleanup", "completion-chat"].includes(screenshotFixture)) {
      const completedSession = { sessionId: "demo-complete", title: "Release verification", preview: "The latest session finished.", running: false, state: "idle" };
      state.dashboard = { harness: true, sessions: [completedSession] };
      state.selectedSessionId = completedSession.sessionId;
      notifyCompletion(completedSession);
    } else if (screenshotFixture === "edge-error") {
      const failedSession = { sessionId: "demo-error", title: "Failed verification", preview: "The latest session needs attention.", running: false, state: "error" };
      state.dashboard = { harness: true, sessions: [failedSession] };
      state.selectedSessionId = failedSession.sessionId;
      applyWindowMode("edge");
      signalSessionError(failedSession, "error", "The latest session needs attention.");
    } else if (screenshotFixture === "edge-error-ack") {
      const failedSession = { sessionId: "demo-error-ack", title: "Acknowledged failure", preview: "This failure was opened in full chat.", running: false, state: "error" };
      state.dashboard = { harness: true, sessions: [failedSession] };
      state.selectedSessionId = failedSession.sessionId;
      applyWindowMode("edge");
      signalSessionError(failedSession, "error", "The latest session needs attention.");
      applyWindowMode("full");
      applyWindowMode("edge");
    } else if (screenshotFixture === "edge-error-interrupts-done") {
      const completedSession = { sessionId: "demo-complete-before-error", title: "Earlier completion", preview: "This completion is superseded.", running: false, state: "idle" };
      const failedSession = { sessionId: "demo-new-error", title: "New failure", preview: "The newer error needs attention.", running: false, state: "error" };
      state.dashboard = { harness: true, sessions: [failedSession, completedSession] };
      state.selectedSessionId = failedSession.sessionId;
      applyWindowMode("edge");
      notifyCompletion(completedSession);
      signalSessionError(failedSession, "error", "The newer error needs attention.");
    } else if (screenshotFixture === "markdown-tools") {
      setTab("chat");
      renderMessages([
        { role: "assistant", text: "Result", html: "<h3>Workspace checked</h3><p><strong>Build</strong> is clean and <em>visually verified</em>.</p><blockquote>Accent colors remain readable on the dark surface.</blockquote><pre><code class=\"language-js\"><span class=\"hljs-keyword\">const</span> status = <span class=\"hljs-string\">\"ready\"</span>; <span class=\"hljs-comment\">// verified</span></code></pre>" },
        { role: "tool", name: "read_file", arguments: "{\n  \"path\": \"src/main.cjs\"\n}", result: "Loaded 412 lines", status: "done", durationMs: 184 },
        { role: "tool", name: "run_tests", arguments: "{\n  \"suite\": \"widget\"\n}", result: "18 tests passed", status: "done", durationMs: 1260, nested: true },
      ]);
    } else if (screenshotFixture === "mixed-tools") {
      setTab("chat");
      renderMessages([
        { role: "assistant", text: "Most checks completed; one optional write was denied." },
        { role: "tool", callId: "tool-ok", name: "read", arguments: "{\"path\":\"README.md\"}", result: "Read complete", status: "completed", durationMs: 84 },
        { role: "tool", callId: "tool-failed", name: "write", arguments: "{\"path\":\"protected.md\"}", result: "Permission denied", status: "completed", isError: true, durationMs: 21 },
      ]);
    }
  }, 700);
}
