// Physical-input regression for the two compact-mode gestures that broke:
//   1. a click on the brand avatar must collapse the widget to the orb;
//   2. releasing the edge handle after a drag must NOT restore the full widget.
// Both are driven with real sendInputEvent mouse events, because both bugs live in
// the pointer-capture / click ordering that synthetic click() calls cannot reproduce.
const path = require("node:path");
const { app, BrowserWindow, ipcMain } = require("electron");

const root = path.resolve(__dirname, "..");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Minimal stand-ins for the main process, so the renderer runs its real code path
// instead of silently failing on a missing handler.
let currentMode = "full";
const sentPayloads = [];
const openedSessionIds = [];
const modeRequests = [];
const modeResponseDelays = new Map();
const compactDragEvents = [];
let dashboardValue = { harness: true, sessions: [
  { sessionId: "demo-build", title: "Build review", updatedAt: 3, running: false, preview: "Windows package passed." },
  { sessionId: "demo-unity", title: "Unity gameplay", updatedAt: 2, running: false, preview: "Play Mode passed." },
  { sessionId: "demo-mcp", title: "Capability Hub", updatedAt: 1, running: false, preview: "Dynamic routing passed." },
] };
const deferredSessionRequests = { history: new Map(), models: new Map(), commands: new Map() };
let deferredSend = null;
let deferredCommand = null;
let deferredQueueUpdate = null;
let deferredDashboard = null;
let createdSessionId = "created-session";
let dashboardCalls = 0;
let startHarnessCalls = 0;
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, reject, resolve };
}
function registerStubs() {
  ipcMain.handle("set-window-mode", (_event, mode) => {
    modeRequests.push(mode);
    currentMode = mode;
    const delay = modeResponseDelays.get(mode) || 0;
    return delay ? wait(delay).then(() => mode) : mode;
  });
  ipcMain.handle("end-compact-drag", () => {
    compactDragEvents.push("end");
    return { side: "right" };
  });
  ipcMain.handle("end-full-drag", () => null);
  ipcMain.handle("app-info", () => ({ version: "0.0.0-test" }));
  ipcMain.handle("get-update-state", () => ({ status: "idle", currentVersion: "0.0.0", installMode: "manual" }));
  ipcMain.handle("check-for-updates", () => null);
  ipcMain.handle("download-update", () => null);
  ipcMain.handle("install-update", () => null);
  ipcMain.handle("set-compact-status", () => null);
  ipcMain.handle("get-preferences", () => ({}));
  ipcMain.handle("send", (_event, payload) => {
    sentPayloads.push(payload);
    return deferredSend?.promise || { sessionId: payload.sessionId };
  });
  ipcMain.handle("execute-command", (_event, payload) => deferredCommand?.promise || ({ result: { kind: "text", text: payload.line } }));
  ipcMain.handle("update-queue", () => deferredQueueUpdate?.promise || ({ ok: true }));
  ipcMain.handle("dashboard", () => {
    dashboardCalls += 1;
    return deferredDashboard?.promise || dashboardValue;
  });
  ipcMain.handle("start-harness", () => {
    startHarnessCalls += 1;
    return { ok: true, started: true };
  });
  ipcMain.handle("create-session", () => ({ sessionId: createdSessionId }));
  ipcMain.handle("history", (_event, sessionId) => {
    openedSessionIds.push(sessionId);
    return deferredSessionRequests.history.get(sessionId)?.promise || { messages: [], activity: null };
  });
  ipcMain.handle("models", (_event, sessionId) => deferredSessionRequests.models.get(sessionId)?.promise || ({ current: null, groups: [] }));
  ipcMain.handle("commands", (_event, sessionId) => deferredSessionRequests.commands.get(sessionId)?.promise || []);
  ipcMain.handle("workspaces", () => []);
  ipcMain.handle("get-queue", () => []);
  for (const channel of ["begin-compact-drag", "move-compact-drag", "begin-full-drag", "move-full-drag", "set-edge-pointer-active", "agent-complete"]) {
    ipcMain.on(channel, () => {
      if (channel === "begin-compact-drag") compactDragEvents.push("begin");
      if (channel === "move-compact-drag") compactDragEvents.push("move");
    });
  }
}

async function mode(contents) {
  return contents.executeJavaScript("document.body.className");
}

function click(contents, x, y) {
  contents.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
  contents.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
}

async function centerOf(contents, selector) {
  return contents.executeJavaScript(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
}

async function hitAt(contents, point) {
  return contents.executeJavaScript(`(() => {
    const point = ${JSON.stringify(point)};
    const target = document.elementFromPoint(point.x, point.y);
    return {
      target: target?.className?.baseVal || target?.className || target?.tagName || null,
      body: document.body.className,
      active: document.activeElement?.id || document.activeElement?.className || document.activeElement?.tagName || null,
    };
  })()`);
}

async function main() {
  await app.whenReady();
  registerStubs();
  const win = new BrowserWindow({
    width: 420,
    height: 640,
    show: false,
    webPreferences: {
      preload: path.join(root, "src", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const contents = win.webContents;
  await win.loadFile(path.join(root, "src", "renderer", "index.html"), {
    query: { screenshotFixture: "chat", screenshotStatic: "1" },
  });
  await wait(1200);

  const failures = [];

  // --- 1. avatar click must collapse to orb -------------------------------
  const avatar = await centerOf(contents, "#avatarButton");
  if (!avatar) throw new Error("avatarButton not found");
  currentMode = "full";
  click(contents, avatar.x, avatar.y);
  await wait(500);
  if (currentMode !== "orb") {
    failures.push(`avatar click did not collapse to orb (mode stayed "${currentMode}")`);
  }

  // --- 1b. a short click on the orb must restore Full --------------------
  const orb = await centerOf(contents, "#orbRestore");
  if (!orb) throw new Error("orbRestore not found");
  click(contents, orb.x, orb.y);
  await wait(600);
  if (currentMode !== "full") {
    failures.push(`orb click did not restore full (mode stayed "${currentMode}")`);
  }

  // Back to full for the next case.
  await contents.executeJavaScript('document.body.className = "mode-full"');
  await wait(200);

  // --- 2. dragging the edge handle must not restore the widget ------------
  await contents.executeJavaScript('document.body.className = "mode-edge side-right"');
  currentMode = "edge";
  modeRequests.length = 0;
  compactDragEvents.length = 0;
  await wait(300);
  const line = await centerOf(contents, "#edgeMode .edge-line");
  if (!line) throw new Error("edge line not found");
  const windowBounds = win.getBounds();
  contents.sendInputEvent({ type: "mouseDown", x: line.x, y: line.y, globalX: windowBounds.x + line.x, globalY: windowBounds.y + line.y, button: "left", clickCount: 1 });
  for (let step = 1; step <= 6; step += 1) {
    contents.sendInputEvent({ type: "mouseMove", x: line.x, y: line.y + step * 9, globalX: windowBounds.x + line.x, globalY: windowBounds.y + line.y + step * 9, button: "left" });
    await wait(30);
  }
  contents.sendInputEvent({ type: "mouseUp", x: line.x, y: line.y + 54, globalX: windowBounds.x + line.x, globalY: windowBounds.y + line.y + 54, button: "left", clickCount: 1 });
  await wait(600);
  if (currentMode === "full") {
    failures.push(`releasing the edge handle after a drag restored the widget; drag=${JSON.stringify(compactDragEvents)}, modes=${JSON.stringify(modeRequests)}`);
  }
  if (!compactDragEvents.includes("begin") || !compactDragEvents.includes("end")) {
    failures.push(`edge drag did not cross the native movement threshold: ${JSON.stringify(compactDragEvents)}`);
  }

  // --- 3. a per-session chat icon replies inline without restoring full --
  await win.loadFile(path.join(root, "src", "renderer", "index.html"), {
    query: { screenshotFixture: "orb-recent-three", screenshotStatic: "1" },
  });
  win.show();
  win.focus();
  await wait(1200);
  await contents.executeJavaScript(`(() => {
    document.body.classList.remove("mode-full", "mode-edge", "side-left");
    document.body.classList.add("mode-orb", "side-right");
  })()`);
  currentMode = "orb";
  const reply = await centerOf(contents, ".orb-session-row:first-child .orb-session-reply");
  if (!reply) throw new Error("quick reply button not found");
  const replyHit = await hitAt(contents, reply);
  click(contents, reply.x, reply.y);
  await wait(350);
  const quickReplyState = await contents.executeJavaScript(`(() => {
    const input = document.querySelector('#orbReplyInput');
    const rect = input.getBoundingClientRect();
    return { visible: rect.width > 0 && rect.height > 0, focused: document.activeElement === input };
  })()`);
  if (currentMode !== "orb") failures.push("quick reply restored the full widget");
  if (!quickReplyState.visible || !quickReplyState.focused) failures.push(`quick reply input was not visible and focused; hit=${JSON.stringify(replyHit)}`);
  contents.insertText("Reply from the pet");
  contents.sendInputEvent({ type: "keyDown", keyCode: "ENTER" });
  contents.sendInputEvent({ type: "keyUp", keyCode: "ENTER" });
  await wait(600);
  if (sentPayloads.length !== 1 || sentPayloads[0]?.sessionId !== "demo-build" || sentPayloads[0]?.text !== "Reply from the pet") {
    failures.push(`quick reply routed incorrectly: ${JSON.stringify(sentPayloads)}`);
  }

  // --- 4. clicking a reply preview opens that exact session ---------------
  await win.loadFile(path.join(root, "src", "renderer", "index.html"), {
    query: { screenshotFixture: "orb-recent-three", screenshotStatic: "1" },
  });
  win.focus();
  await wait(1200);
  await contents.executeJavaScript(`(() => {
    document.body.classList.remove("mode-full", "mode-edge", "side-left");
    document.body.classList.add("mode-orb", "side-right");
  })()`);
  currentMode = "orb";
  openedSessionIds.length = 0;
  const preview = await centerOf(contents, ".orb-session-row:first-child .orb-session-open");
  if (!preview) throw new Error("recent session preview not found");
  const previewHit = await hitAt(contents, preview);
  click(contents, preview.x, preview.y);
  await wait(600);
  if (currentMode !== "full") failures.push(`recent session preview did not restore the full widget; hit=${JSON.stringify(previewHit)}`);
  if (!openedSessionIds.includes("demo-build")) failures.push(`recent session opened the wrong id: ${JSON.stringify(openedSessionIds)}`);

  // Load a fresh renderer so the timing regression cannot perturb the physical
  // pointer sequences above (Electron retains pointer state across navigation).
  await win.loadFile(path.join(root, "src", "renderer", "index.html"), {
    query: { screenshotFixture: "chat", screenshotStatic: "1" },
  });
  win.focus();
  win.show();
  win.focus();
  await wait(1200);

  // --- 5. a stale delayed reply cannot override a newer mode intent -------
  modeRequests.length = 0;
  modeResponseDelays.set("orb", 260);
  modeResponseDelays.set("full", 5);
  const rapidMode = await contents.executeJavaScript(`(async () => {
    const first = setWindowMode("orb");
    await new Promise((resolve) => setTimeout(resolve, 130));
    const second = setWindowMode("full");
    await Promise.all([first, second]);
    return { stateMode: state.windowMode, bodyMode: document.body.className };
  })()`);
  modeResponseDelays.clear();
  if (currentMode !== "full" || rapidMode.stateMode !== "full" || !rapidMode.bodyMode.includes("mode-full")) {
    failures.push(`rapid mode requests did not keep the last Full intent: main=${currentMode}, renderer=${JSON.stringify(rapidMode)}`);
  }
  if (modeRequests.join(",") !== "orb,full") {
    failures.push(`rapid mode requests did not exercise both IPC replies: ${JSON.stringify(modeRequests)}`);
  }

  // --- 6. unchanged dashboard renders preserve nodes, focus, and scroll ---
  const stableRender = await contents.executeJavaScript(`(() => {
    setTab("agents");
    const changing = state.dashboard.sessions[0];
    changing.projections = { values: { contextPressure: { projectedTokens: 1000, contextWindow: 10000 } } };
    renderSessions();
    const list = document.querySelector("#sessions");
    const card = list.querySelector(".session-card");
    list.style.height = "18px";
    list.scrollTop = 9;
    const scrollTop = list.scrollTop;
    changing.projections.values.contextPressure.projectedTokens = 1100;
    renderSessions();
    const sameCard = card === list.querySelector(".session-card");
    const scrollPreserved = list.scrollTop === scrollTop;
    list.style.height = "";
    setTab("chat");
    document.querySelector("#sessionButton").click();
    const option = document.querySelector("#sessionOptions .picker-option:last-child");
    option.focus();
    const focusedBefore = document.activeElement === option;
    changing.projections.values.contextPressure.projectedTokens = 1200;
    renderSessionSelect();
    const result = {
      sameCard,
      sameOption: option === document.querySelector("#sessionOptions .picker-option:last-child"),
      optionFocused: focusedBefore && document.activeElement === option,
      scrollPreserved,
    };
    document.querySelector("#sessionButton").click();
    return result;
  })()`);
  if (!Object.values(stableRender).every(Boolean)) {
    failures.push(`unchanged dashboard rebuilt interactive DOM: ${JSON.stringify(stableRender)}`);
  }

  const emptyContext = await contents.executeJavaScript(`(() => {
    const selected = state.selectedSessionId;
    state.selectedSessionId = null;
    renderContext();
    const result = {
      value: document.querySelector("#contextValue").textContent,
      unavailable: document.querySelector("#contextMeter").classList.contains("unavailable"),
    };
    state.selectedSessionId = selected;
    renderContext();
    return result;
  })()`);
  if (emptyContext.value !== "0%" || !emptyContext.unavailable) {
    failures.push(`empty context meter was not retained at 0%: ${JSON.stringify(emptyContext)}`);
  }

  const stableLiveBubble = await contents.executeJavaScript(`(() => {
    state.selectedSessionId = "demo-build";
    state.currentMessages = [{ role: "user", text: "Stream the answer." }];
    state.historySignature = "";
    state.liveStreamsBySession.set("demo-build", { text: "First", reasoning: "", lastSeq: 1 });
    renderMessages(state.currentMessages);
    const first = document.querySelector(".live-assistant");
    state.liveStreamsBySession.set("demo-build", { text: "First and second", reasoning: "", lastSeq: 2 });
    renderMessages(state.currentMessages);
    const second = document.querySelector(".live-assistant");
    return { sameNode: first === second, text: second?.textContent || "", seq: second?.dataset.liveSeq || "" };
  })()`);
  if (!stableLiveBubble.sameNode || stableLiveBubble.text !== "First and second" || stableLiveBubble.seq !== "2") {
    failures.push(`streaming rebuilt or failed to update the live bubble: ${JSON.stringify(stableLiveBubble)}`);
  }

  for (const kind of Object.keys(deferredSessionRequests)) {
    deferredSessionRequests[kind].set("race-a", deferred());
    deferredSessionRequests[kind].set("race-b", deferred());
  }
  const sessionRacePromise = contents.executeJavaScript(`(async () => {
    state.dashboard = { harness: true, sessions: [
      { sessionId: "race-a", title: "Race A", running: false, projections: { values: {} }, subagents: [] },
      { sessionId: "race-b", title: "Race B", running: false, projections: { values: {} }, subagents: [] },
    ] };
    const first = selectSession("race-a", true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = selectSession("race-b", true);
    await Promise.all([first, second]);
    return {
      selected: state.selectedSessionId,
      text: document.querySelector("#messages")?.textContent || "",
      model: state.modelCatalog?.current?.model || "",
      commands: state.commandCatalog.map((command) => command.name),
    };
  })()`);
  await wait(80);
  deferredSessionRequests.history.get("race-a").resolve({ messages: [{ role: "assistant", text: "History A" }], activity: null });
  deferredSessionRequests.models.get("race-a").resolve({ current: { provider: "test", model: "model-a" }, groups: [{ id: "test", name: "Test", models: [{ id: "model-a", name: "Model A" }] }] });
  deferredSessionRequests.commands.get("race-a").resolve([{ name: "command-a", description: "A" }]);
  await wait(40);
  deferredSessionRequests.history.get("race-b").resolve({ messages: [{ role: "assistant", text: "History B" }], activity: null });
  deferredSessionRequests.models.get("race-b").resolve({ current: { provider: "test", model: "model-b" }, groups: [{ id: "test", name: "Test", models: [{ id: "model-b", name: "Model B" }] }] });
  deferredSessionRequests.commands.get("race-b").resolve([{ name: "command-b", description: "B" }]);
  const sessionRace = await sessionRacePromise;
  if (sessionRace.selected !== "race-b" || !sessionRace.text.includes("History B") || sessionRace.text.includes("History A") || sessionRace.model !== "model-b" || sessionRace.commands.join() !== "command-b") {
    failures.push(`stale session requests replaced the selected session UI: ${JSON.stringify(sessionRace)}`);
  }

  dashboardValue = { harness: true, sessions: [
    { sessionId: "error-a", title: "Selected", running: false, state: "idle", projections: { values: {} }, subagents: [] },
    { sessionId: "error-b", title: "Background failure", running: false, state: "error", preview: "Needs attention", projections: { values: {} }, subagents: [] },
  ] };
  const initialBackgroundError = await contents.executeJavaScript(`(async () => {
    state.windowMode = "orb";
    state.dashboardInitialized = false;
    state.selectedSessionId = "error-a";
    state.runningSessionIds.clear();
    state.errorSignalSessionIds.clear();
    state.unacknowledgedErrorSessionIds.clear();
    await refresh();
    return {
      pending: [...state.unacknowledgedErrorSessionIds],
      unread: state.compactErrorUnread,
      avatar: state.avatarMode,
      target: state.compactNotification?.sessionId || null,
      title: state.compactNotification?.title || "",
    };
  })()`);
  if (initialBackgroundError.pending.join() !== "error-b" || !initialBackgroundError.unread || initialBackgroundError.avatar !== "error" || initialBackgroundError.target !== "error-b" || initialBackgroundError.title !== "Background failure") {
    failures.push(`initial compact error snapshot was not surfaced: ${JSON.stringify(initialBackgroundError)}`);
  }

  currentMode = "edge";
  await contents.executeJavaScript(`(() => {
    applyWindowMode("edge");
    document.querySelector("#edgeMode").click();
  })()`);
  await wait(620);
  const edgeErrorTarget = await contents.executeJavaScript(`({ selected: state.selectedSessionId, mode: state.windowMode, notification: state.compactNotification })`);
  if (currentMode !== "full" || edgeErrorTarget.mode !== "full" || edgeErrorTarget.selected !== "error-b" || edgeErrorTarget.notification !== null) {
    failures.push(`edge error activation did not open and acknowledge the exact session: ${JSON.stringify({ currentMode, edgeErrorTarget })}`);
  }

  dashboardValue = { harness: true, sessions: [dashboardValue.sessions[0]] };
  const prunedBackgroundError = await contents.executeJavaScript(`(async () => {
    await refresh();
    return { pending: [...state.unacknowledgedErrorSessionIds], unread: state.compactErrorUnread };
  })()`);
  if (prunedBackgroundError.pending.length || prunedBackgroundError.unread) {
    failures.push(`removed session left a permanent compact error: ${JSON.stringify(prunedBackgroundError)}`);
  }

  dashboardValue = { harness: true, sessions: [
    { sessionId: "done-a", title: "Selected idle", running: false, state: "idle", projections: { values: {} }, subagents: [] },
    { sessionId: "done-b", title: "Finished background", running: false, state: "idle", preview: "Finished exactly here", projections: { values: {} }, subagents: [] },
  ] };
  currentMode = "edge";
  const edgeCompletionTarget = await contents.executeJavaScript(`(() => {
    state.dashboard = ${JSON.stringify(dashboardValue)};
    state.selectedSessionId = "done-a";
    state.completedSignalSessionIds.clear();
    applyWindowMode("edge");
    notifyCompletion(state.dashboard.sessions[1]);
    const target = state.compactNotification?.sessionId || null;
    document.querySelector("#edgeMode").click();
    return target;
  })()`);
  await wait(620);
  const openedCompletion = await contents.executeJavaScript(`({ selected: state.selectedSessionId, mode: state.windowMode })`);
  if (edgeCompletionTarget !== "done-b" || currentMode !== "full" || openedCompletion.mode !== "full" || openedCompletion.selected !== "done-b") {
    failures.push(`edge completion activation did not open the exact session: ${JSON.stringify({ edgeCompletionTarget, currentMode, openedCompletion })}`);
  }
  await contents.executeJavaScript(`clearCompletionSignal()`);

  dashboardValue = { harness: true, sessions: [
    { sessionId: "background-a", title: "Selected idle", running: false, state: "idle", projections: { values: {} }, subagents: [] },
    { sessionId: "background-b", title: "Background running", running: true, state: "working", activity: { active: true, kind: "thinking", label: "Thinking", text: "Background work" }, projections: { values: {} }, subagents: [] },
  ] };
  const backgroundGlow = await contents.executeJavaScript(`(async () => {
    state.windowMode = "full";
    state.selectedSessionId = "background-a";
    state.dashboardInitialized = true;
    state.runningSessionIds = new Set(["background-b"]);
    setAvatar("idle");
    setActivity(null);
    await refresh();
    return { avatar: state.avatarMode, activity: state.currentActivity, classes: document.body.className };
  })()`);
  if (backgroundGlow.avatar === "working" || backgroundGlow.activity?.active || /activity-(?:thinking|writing|tool)/.test(backgroundGlow.classes)) {
    failures.push(`background work leaked glow into the selected idle chat: ${JSON.stringify(backgroundGlow)}`);
  }

  const consecutiveTurns = await contents.executeJavaScript(`(async () => {
    state.selectedSessionId = "stream-owner";
    state.dashboard = { harness: true, sessions: [{ sessionId: "stream-owner", title: "Stream", running: true, state: "working", projections: { values: {} }, subagents: [] }] };
    await handleLiveEvent({ sessionId: "stream-owner", event: { type: "turn/start", seq: 10 } });
    await handleLiveEvent({ sessionId: "stream-owner", event: { type: "assistant/chunk", seq: 11, data: { chunk: { type: "text-delta", text: "old" } } } });
    await handleLiveEvent({ sessionId: "stream-owner", event: { type: "turn/end", seq: 12, data: {} } });
    await handleLiveEvent({ sessionId: "stream-owner", event: { type: "turn/start", seq: 13 } });
    await handleLiveEvent({ sessionId: "stream-owner", event: { type: "assistant/chunk", seq: 14, data: { chunk: { type: "text-delta", text: "first" } } } });
    await new Promise((resolve) => setTimeout(resolve, 240));
    return state.liveStreamsBySession.get("stream-owner")?.text || "";
  })()`);
  if (consecutiveTurns !== "first") failures.push(`turn-end cleanup deleted the next turn stream: ${JSON.stringify(consecutiveTurns)}`);

  const switchedError = await contents.executeJavaScript(`(async () => {
    state.windowMode = "full";
    state.harnessOffline = false;
    state.dashboard = { harness: true, sessions: [
      { sessionId: "status-error", title: "Failed", running: false, state: "error", projections: { values: {} }, subagents: [] },
      { sessionId: "status-idle", title: "Healthy", running: false, state: "idle", projections: { values: {} }, subagents: [] },
    ] };
    state.selectedSessionId = "status-error";
    setActivity({ active: true, kind: "error", label: "Turn failed", text: "failed" });
    setAvatar("error", "model error");
    await selectSession("status-idle", true);
    return { selected: state.selectedSessionId, avatar: state.avatarMode, activity: state.currentActivity };
  })()`);
  if (switchedError.selected !== "status-idle" || switchedError.avatar === "error" || switchedError.activity?.kind === "error") {
    failures.push(`error presentation leaked into a healthy selected session: ${JSON.stringify(switchedError)}`);
  }

  const transientError = await contents.executeJavaScript(`(() => {
    state.selectedSessionId = "status-idle";
    renderMessages([{ role: "assistant", text: "history stays" }]);
    showError(new Error("attachment failed"));
    return { messages: state.currentMessages.map((item) => item.text), text: document.querySelector("#messages")?.textContent || "", activity: state.currentActivity };
  })()`);
  if (transientError.messages.join() !== "history stays" || !transientError.text.includes("history stays") || transientError.activity?.kind !== "error") {
    failures.push(`auxiliary error replaced chat history: ${JSON.stringify(transientError)}`);
  }

  const fastPollError = await contents.executeJavaScript(`(() => {
    state.dashboardInitialized = true;
    state.windowMode = "orb";
    state.runningSessionIds.clear();
    state.errorSignalSessionIds.clear();
    state.unacknowledgedErrorSessionIds.clear();
    state.sessionSnapshotsById = new Map([["fast-error", { running: false, state: "idle", updatedAt: 1, preview: "before" }]]);
    detectCompletedSessions([{ sessionId: "fast-error", title: "Tiny model", running: false, state: "error", updatedAt: 2, preview: "failed", projections: { values: {} }, subagents: [] }]);
    return { signaled: state.errorSignalSessionIds.has("fast-error"), unread: state.unacknowledgedErrorSessionIds.has("fast-error") };
  })()`);
  if (!fastPollError.signaled || !fastPollError.unread) failures.push(`fast polling error transition was missed: ${JSON.stringify(fastPollError)}`);

  deferredQueueUpdate = deferred();
  await contents.executeJavaScript(`(() => {
    state.selectedSessionId = "queue-a";
    state.queuedPromptsBySession.set("queue-a", [{ id: "same-id", text: "A" }]);
    state.queuedPromptsBySession.set("queue-b", [{ id: "same-id", text: "B" }]);
    window.__queueRace = updateQueuedPrompt({ id: "same-id", text: "A" }, { kind: "remove" });
    state.selectedSessionId = "queue-b";
  })()`);
  deferredQueueUpdate.resolve({ ok: true });
  const queueRace = await contents.executeJavaScript(`(async () => {
    await window.__queueRace;
    return { a: queuedPromptsFor("queue-a").map((item) => item.text), b: queuedPromptsFor("queue-b").map((item) => item.text) };
  })()`);
  deferredQueueUpdate = null;
  if (queueRace.a.length || queueRace.b.join() !== "B") failures.push(`queue completion mutated the newly selected session: ${JSON.stringify(queueRace)}`);

  deferredCommand = deferred();
  await contents.executeJavaScript(`(() => {
    state.selectedSessionId = "command-a";
    window.__commandRace = executeHarnessCommand("/test", "command-a");
    state.selectedSessionId = "command-b";
    renderMessages([{ role: "assistant", text: "History B remains" }]);
  })()`);
  deferredCommand.resolve({ result: { kind: "text", text: "Command A result" } });
  const commandRace = await contents.executeJavaScript(`(async () => {
    await window.__commandRace;
    return { selected: state.selectedSessionId, messages: state.currentMessages.map((item) => item.text), text: document.querySelector("#messages")?.textContent || "" };
  })()`);
  deferredCommand = null;
  if (commandRace.selected !== "command-b" || commandRace.messages.join() !== "History B remains" || commandRace.text.includes("Command A result")) {
    failures.push(`command completion rendered into the newly selected session: ${JSON.stringify(commandRace)}`);
  }

  deferredSend = deferred();
  await contents.executeJavaScript(`(() => {
    state.selectedSessionId = "send-a";
    state.pendingAttachments = [];
    const input = document.querySelector("#messageInput");
    input.value = "message for A";
    document.querySelector("#chatForm").requestSubmit();
    state.selectedSessionId = "send-b";
    renderMessages([{ role: "assistant", text: "Selected B" }]);
  })()`);
  await wait(40);
  deferredSend.resolve({ sessionId: "send-a" });
  await wait(180);
  const sendRace = await contents.executeJavaScript(`({ selected: state.selectedSessionId, text: document.querySelector("#messages")?.textContent || "" })`);
  deferredSend = null;
  if (sendRace.selected !== "send-b" || !sendRace.text.includes("Selected B")) {
    failures.push(`send completion forced the UI back to its original session: ${JSON.stringify(sendRace)}`);
  }

  deferredSend = deferred();
  await contents.executeJavaScript(`(() => {
    state.selectedSessionId = "failed-send-a";
    state.pendingAttachments = [];
    const input = document.querySelector("#messageInput");
    input.value = "message that belongs to A";
    document.querySelector("#chatForm").requestSubmit();
    state.selectedSessionId = "failed-send-b";
    input.value = "draft for B";
  })()`);
  await wait(40);
  deferredSend.reject(new Error("A failed"));
  await wait(180);
  const failedSendRace = await contents.executeJavaScript(`({ selected: state.selectedSessionId, draft: document.querySelector("#messageInput").value, active: document.activeElement?.id || "" })`);
  deferredSend = null;
  if (failedSendRace.selected !== "failed-send-b" || failedSendRace.draft !== "draft for B") {
    failures.push(`a failed send restored its text into another session composer: ${JSON.stringify(failedSendRace)}`);
  }

  const sessionPresentation = await contents.executeJavaScript(`(async () => {
    state.harnessOffline = false;
    state.dashboard = { harness: true, sessions: [
      { sessionId: "presentation-a", title: "Working plan", running: true, state: "working", activity: { active: true, kind: "writing", label: "Writing", text: "A is writing" }, projections: { values: {} }, subagents: [] },
      { sessionId: "presentation-b", title: "Idle agent", running: false, state: "idle", projections: { values: {} }, subagents: [] },
    ] };
    state.selectedSessionId = "presentation-a";
    setSessionAgentMode("presentation-a", "plan");
    setActivity(state.dashboard.sessions[0].activity);
    setAvatar("working", "writing");
    await selectSession("presentation-b", true);
    const idle = { avatar: state.avatarMode, activity: state.currentActivity, mode: state.currentMode };
    await selectSession("presentation-a", true);
    const restored = { mode: state.currentMode };
    return { idle, restored };
  })()`);
  if (sessionPresentation.idle.avatar !== "idle" || sessionPresentation.idle.activity !== null || sessionPresentation.idle.mode !== "agent" || sessionPresentation.restored.mode !== "plan") {
    failures.push(`session-owned activity or Agent/Plan mode leaked across selection: ${JSON.stringify(sessionPresentation)}`);
  }

  deferredSessionRequests.history.set("history-plan", { promise: Promise.resolve({ messages: [{ role: "user", text: "/plan" }], activity: null }) });
  const historyMode = await contents.executeJavaScript(`(async () => {
    state.dashboard = { harness: true, sessions: [{ sessionId: "history-plan", title: "Existing plan", running: false, state: "idle", projections: { values: {} }, subagents: [] }] };
    state.agentModesBySessionId.delete("history-plan");
    await selectSession("history-plan", true);
    return state.currentMode;
  })()`);
  deferredSessionRequests.history.delete("history-plan");
  if (historyMode !== "plan") failures.push(`existing session Plan mode was not restored from history: ${JSON.stringify(historyMode)}`);

  dashboardValue = { harness: true, sessions: [{ sessionId: "old-session", title: "Old", running: false, state: "idle", projections: { values: {} }, subagents: [] }] };
  createdSessionId = "created-during-refresh";
  const staleDashboard = deferred();
  deferredDashboard = staleDashboard;
  const creationCallsBefore = dashboardCalls;
  await contents.executeJavaScript(`(() => {
    state.selectedSessionId = "old-session";
    window.__staleRefresh = refresh();
    window.__creationRace = createNewSession({ restore: false });
  })()`);
  await wait(60);
  dashboardValue = { harness: true, sessions: [{ sessionId: "created-during-refresh", title: "Created", running: false, state: "idle", projections: { values: {} }, subagents: [] }] };
  deferredDashboard = null;
  staleDashboard.resolve({ harness: true, sessions: [{ sessionId: "old-session", title: "Old", running: false, state: "idle", projections: { values: {} }, subagents: [] }] });
  const creationRace = await contents.executeJavaScript(`(async () => {
    await window.__creationRace;
    return { selected: state.selectedSessionId, sessions: state.dashboard.sessions.map((session) => session.sessionId) };
  })()`);
  if (dashboardCalls - creationCallsBefore < 2 || creationRace.selected !== "created-during-refresh" || creationRace.sessions.join() !== "created-during-refresh") {
    failures.push(`session creation did not receive a fresh trailing dashboard: ${JSON.stringify({ calls: dashboardCalls - creationCallsBefore, creationRace })}`);
  }

  const offlineDashboard = deferred();
  deferredDashboard = offlineDashboard;
  const startCallsBefore = dashboardCalls;
  const startsBefore = startHarnessCalls;
  await contents.executeJavaScript(`(() => {
    state.dashboard = { harness: false, sessions: [] };
    state.harnessOffline = true;
    state.selectedSessionId = null;
    window.__offlineRefresh = refresh();
    window.__startRace = startHarnessFromBanner();
  })()`);
  await wait(60);
  dashboardValue = { harness: true, sessions: [] };
  deferredDashboard = null;
  offlineDashboard.resolve({ harness: false, sessions: [] });
  const startRace = await contents.executeJavaScript(`(async () => {
    await window.__startRace;
    return {
      harness: state.dashboard?.harness,
      label: document.querySelector("#offlineBannerText").textContent,
      button: document.querySelector("#startHarnessButton").textContent,
      visible: document.querySelector("#offlineBanner").classList.contains("show"),
    };
  })()`);
  if (dashboardCalls - startCallsBefore < 2 || startHarnessCalls - startsBefore !== 1 || !startRace.harness || startRace.button === "Retry" || startRace.visible) {
    failures.push(`Start Harness reused a stale in-flight offline snapshot: ${JSON.stringify({ calls: dashboardCalls - startCallsBefore, starts: startHarnessCalls - startsBefore, startRace })}`);
  }

  for (const failure of failures) console.error(`FAIL ${failure}`);
  if (failures.length === 0) console.log("PASS stable rendering, last-intent modes, compact drag, exact-session open, and inline quick reply behave correctly");
  app.exit(failures.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
