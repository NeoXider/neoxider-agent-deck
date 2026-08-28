// Physical-input regression for compact-mode and draggable-header gestures:
//   1. a click on the brand avatar must collapse the widget to the orb;
//   2. the Update button beside the draggable brand must install exactly once;
//   3. releasing the edge handle after a drag must NOT restore the full widget.
// These are driven with real sendInputEvent mouse events, because the bugs live in
// the pointer-capture / click ordering that synthetic click() calls cannot reproduce.
const path = require("node:path");
const { app, BrowserWindow, ipcMain } = require("electron");

const root = path.resolve(__dirname, "..");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Minimal stand-ins for the main process, so the renderer runs its real code path
// instead of silently failing on a missing handler.
let currentMode = "full";
const sentPayloads = [];
const commandPayloads = [];
const selectedModelPayloads = [];
const openedSessionIds = [];
const modeRequests = [];
const compactStatusPayloads = [];
const compactModeEchoes = [];
const modeResponseDelays = new Map();
const compactDragEvents = [];
const fullDragEvents = [];
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
let deferredCancel = null;
let createdSessionId = "created-session";
let dashboardCalls = 0;
let startHarnessCalls = 0;
let installUpdateCalls = 0;
let updateState = { status: "idle", currentVersion: "0.0.0", installMode: "manual" };
let nativeCompactStatus = { active: false, expanded: false };
let echoOrbModeOnCompactResize = false;
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, reject, resolve };
}
function within(promise, label, milliseconds = 5000) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} exceeded ${milliseconds}ms`)), milliseconds); }),
  ]).finally(() => clearTimeout(timer));
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
  ipcMain.handle("end-full-drag", () => {
    fullDragEvents.push("end");
    return null;
  });
  ipcMain.handle("app-info", () => ({ version: "0.0.0-test" }));
  ipcMain.handle("get-update-state", () => updateState);
  ipcMain.handle("check-for-updates", () => null);
  ipcMain.handle("download-update", () => null);
  ipcMain.handle("install-update", () => {
    installUpdateCalls += 1;
    return { status: "ready", currentVersion: "0.0.0", latestVersion: "0.6.1", progress: 100, installMode: "portable-replace" };
  });
  ipcMain.handle("set-compact-status", (event, payload) => {
    compactStatusPayloads.push(payload);
    const changed = nativeCompactStatus.active !== Boolean(payload?.active)
      || nativeCompactStatus.expanded !== Boolean(payload?.expanded);
    nativeCompactStatus = { active: Boolean(payload?.active), expanded: Boolean(payload?.expanded) };
    // Match the production handler: changing expanded Orb status resizes the
    // native window by reapplying Orb and publishes its authoritative mode.
    if (echoOrbModeOnCompactResize && currentMode === "orb" && changed) {
      compactModeEchoes.push("orb");
      event.sender.send("window-mode", "orb");
    }
    return payload;
  });
  ipcMain.handle("get-preferences", () => ({}));
  ipcMain.handle("send", (_event, payload) => {
    sentPayloads.push(payload);
    return deferredSend?.promise || { sessionId: payload.sessionId };
  });
  ipcMain.handle("select-model", (_event, payload) => {
    selectedModelPayloads.push(payload);
    return {};
  });
  ipcMain.handle("execute-command", (_event, payload) => {
    commandPayloads.push(payload);
    return deferredCommand?.promise || ({ result: { kind: "text", text: payload.line } });
  });
  ipcMain.handle("update-queue", () => deferredQueueUpdate?.promise || ({ ok: true }));
  ipcMain.handle("cancel", () => deferredCancel?.promise || ({ accepted: true }));
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
    const request = deferredSessionRequests.history.get(sessionId);
    return request?.take?.() || request?.promise || { messages: [], activity: null };
  });
  ipcMain.handle("models", (_event, sessionId) => deferredSessionRequests.models.get(sessionId)?.promise || ({ current: null, groups: [] }));
  ipcMain.handle("commands", (_event, sessionId) => deferredSessionRequests.commands.get(sessionId)?.promise || []);
  ipcMain.handle("workspaces", () => []);
  ipcMain.handle("get-queue", () => []);
  for (const channel of ["begin-compact-drag", "move-compact-drag", "begin-full-drag", "move-full-drag", "set-edge-pointer-active", "agent-complete"]) {
    ipcMain.on(channel, () => {
      if (channel === "begin-compact-drag") compactDragEvents.push("begin");
      if (channel === "move-compact-drag") compactDragEvents.push("move");
      if (channel === "begin-full-drag") fullDragEvents.push("begin");
      if (channel === "move-full-drag") fullDragEvents.push("move");
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

  // --- 1c. Update remains clickable and never begins a full drag -----------
  updateState = { status: "ready", currentVersion: "0.0.0", latestVersion: "0.6.1", progress: 100, installMode: "portable-replace" };
  await win.loadFile(path.join(root, "src", "renderer", "index.html"), {
    query: { screenshotFixture: "update-ready", screenshotStatic: "1" },
  });
  win.show();
  win.focus();
  await wait(1200);
  await contents.executeJavaScript('setSettingsOpen(false, { restoreFocus: false }); renderUpdateState({ status: "ready", currentVersion: "0.0.0", latestVersion: "0.6.1", progress: 100, installMode: "portable-replace" })');
  await wait(100);
  installUpdateCalls = 0;
  const headerUpdateState = await contents.executeJavaScript(`(() => {
    const button = document.querySelector('#headerUpdateButton');
    const rect = button.getBoundingClientRect();
    return { hidden: button.hidden, display: getComputedStyle(button).display, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
  })()`);
  const headerUpdate = await centerOf(contents, "#headerUpdateButton");
  if (!headerUpdate) throw new Error("headerUpdateButton not found");
  const headerUpdateHit = await hitAt(contents, headerUpdate);
  fullDragEvents.length = 0;
  click(contents, headerUpdate.x, headerUpdate.y);
  await wait(400);
  if (installUpdateCalls !== 1) {
    failures.push(`header Update invoked install ${installUpdateCalls} times instead of once; state=${JSON.stringify(headerUpdateState)}, hit=${JSON.stringify(headerUpdateHit)}`);
  }
  if (fullDragEvents.length) failures.push(`header Update began a full drag: ${JSON.stringify(fullDragEvents)}`);

  // --- 1d. Brand movement uses the custom full-drag path ------------------
  const dragStart = await centerOf(contents, "#projectLink");
  if (!dragStart) throw new Error("brand drag target not found");
  const dragStartHit = await hitAt(contents, dragStart);
  const dragBounds = win.getBounds();
  fullDragEvents.length = 0;
  contents.sendInputEvent({ type: "mouseDown", x: dragStart.x, y: dragStart.y, globalX: dragBounds.x + dragStart.x, globalY: dragBounds.y + dragStart.y, button: "left", clickCount: 1 });
  for (let step = 1; step <= 3; step += 1) {
    contents.sendInputEvent({ type: "mouseMove", x: dragStart.x + step * 5, y: dragStart.y + step * 2, globalX: dragBounds.x + dragStart.x + step * 5, globalY: dragBounds.y + dragStart.y + step * 2, button: "left" });
    await wait(25);
  }
  contents.sendInputEvent({ type: "mouseUp", x: dragStart.x + 15, y: dragStart.y + 6, globalX: dragBounds.x + dragStart.x + 15, globalY: dragBounds.y + dragStart.y + 6, button: "left", clickCount: 1 });
  await wait(200);
  if (!fullDragEvents.includes("begin") || !fullDragEvents.includes("move") || !fullDragEvents.includes("end")) {
    failures.push(`brand movement did not use the complete custom full-drag path: ${JSON.stringify({ events: fullDragEvents, hit: dragStartHit })}`);
  }
  updateState = { status: "idle", currentVersion: "0.0.0", installMode: "manual" };

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

  // --- 4. clicking a non-selected reply preview opens that exact session ---
  await win.loadFile(path.join(root, "src", "renderer", "index.html"), {
    query: { screenshotFixture: "orb-recent-three", screenshotStatic: "1" },
  });
  win.focus();
  await wait(1200);
  await contents.executeJavaScript('applyWindowMode("orb")');
  currentMode = "orb";
  echoOrbModeOnCompactResize = true;
  compactModeEchoes.length = 0;
  modeRequests.length = 0;
  openedSessionIds.length = 0;
  const compactStatusBeforeOpen = { ...nativeCompactStatus };
  const preview = await centerOf(contents, ".orb-session-row:nth-child(2) .orb-session-open");
  if (!preview) throw new Error("recent session preview not found");
  const previewHit = await hitAt(contents, preview);
  click(contents, preview.x, preview.y);
  await wait(600);
  echoOrbModeOnCompactResize = false;
  if (currentMode !== "full") failures.push(`recent session preview did not restore the full widget; hit=${JSON.stringify(previewHit)}`);
  if (!openedSessionIds.includes("demo-unity")) failures.push(`recent session opened the wrong id: ${JSON.stringify(openedSessionIds)}`);
  if (!compactStatusBeforeOpen.expanded || modeRequests.join(",") !== "full" || compactModeEchoes.length) {
    failures.push(`recent session did not restore before collapsing native Orb status: ${JSON.stringify({ compactStatusBeforeOpen, modeRequests, compactModeEchoes })}`);
  }

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

  await contents.executeJavaScript(`(async () => {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
    state.selectedSessionId = "stream-burst";
    state.dashboard = { harness: true, sessions: [] };
    state.currentMessages = Array.from({ length: 80 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", text: "history-" + index + "-" + "x".repeat(512) }));
    state.historySignature = "";
    state.liveStreamsBySession.delete("stream-burst");
    renderMessages(state.currentMessages);
    await handleLiveEvent({ sessionId: "stream-burst", event: { type: "turn/start", seq: 1000 } });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  })()`);
  compactStatusPayloads.length = 0;
  const streamBurst = await contents.executeJavaScript(`(async () => {
    const originalPaintLiveAssistant = paintLiveAssistant;
    const originalRenderMessages = renderMessages;
    let livePaints = 0;
    let historyRenders = 0;
    paintLiveAssistant = (...args) => {
      livePaints += 1;
      return originalPaintLiveAssistant(...args);
    };
    renderMessages = (...args) => {
      historyRenders += 1;
      return originalRenderMessages(...args);
    };
    try {
      for (let index = 1; index <= 500; index += 1) {
        handleLiveEvent({ sessionId: "stream-burst", event: { type: "assistant/chunk", seq: 1000 + index, data: { chunk: { type: "text-delta", text: "z" } } } });
      }
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const bubble = document.querySelector(".live-assistant");
      return {
        historyRenders,
        livePaints,
        textLength: bubble?.textContent.length || 0,
        seq: bubble?.dataset.liveSeq || "",
      };
    } finally {
      paintLiveAssistant = originalPaintLiveAssistant;
      renderMessages = originalRenderMessages;
      schedulePolling();
    }
  })()`);
  await wait(40);
  const compactStatusSends = compactStatusPayloads.length;
  if (streamBurst.historyRenders !== 0 || streamBurst.livePaints !== 1 || streamBurst.textLength !== 500 || streamBurst.seq !== "1500" || compactStatusSends !== 1) {
    failures.push(`500 streaming deltas were not coalesced into one bounded paint/status send: ${JSON.stringify({ ...streamBurst, compactStatusSends })}`);
  } else {
    console.log(`PASS 500 stream deltas -> ${streamBurst.livePaints} live paint, ${streamBurst.historyRenders} history renders, ${compactStatusSends} compact-status send`);
  }

  selectedModelPayloads.length = 0;
  const automaticModel = await contents.executeJavaScript(`(() => {
    state.selectedSessionId = "auto-model";
    state.modelCatalog = {
      current: { provider: "test", model: "manual-model" },
      groups: [{ id: "test", name: "Test", models: [{ id: "manual-model", name: "Manual model" }] }],
    };
    state.pendingSelection = state.modelCatalog.current;
    state.automaticModelRoute = false;
    state.modelLoadState = "ready";
    renderModels();
    [...document.querySelectorAll("#modelOptions .picker-option")]
      .find((button) => button.textContent.includes("Automatic route"))?.click();
    return new Promise((resolve) => setTimeout(() => resolve({
      label: document.querySelector("#modelButtonText")?.textContent || "",
      summary: document.querySelector("#controlsPrimary")?.textContent || "",
      automatic: state.automaticModelRoute,
    }), 40));
  })()`);
  const automaticPayload = selectedModelPayloads.at(-1);
  if (!automaticModel.automatic || automaticModel.label !== "Automatic route" || automaticModel.summary !== "Auto"
      || automaticPayload?.sessionId !== "auto-model" || Object.hasOwn(automaticPayload || {}, "selection")) {
    failures.push(`Automatic route was not applied as an empty Harness selection: ${JSON.stringify({ automaticModel, automaticPayload })}`);
  }

  for (const kind of Object.keys(deferredSessionRequests)) deferredSessionRequests[kind].set("clear-target", deferred());
  const immediateClear = await contents.executeJavaScript(`(() => {
    state.windowMode = "full";
    state.dashboard = { harness: true, sessions: [
      { sessionId: "clear-source", title: "Source", running: false, state: "idle", projections: { values: {} }, subagents: [] },
      { sessionId: "clear-target", title: "Target", running: false, state: "idle", projections: { values: {} }, subagents: [] },
    ] };
    state.selectedSessionId = "clear-source";
    renderMessages([{ role: "assistant", text: "OLD CONVERSATION" }]);
    setActivity({ active: true, kind: "thinking", label: "Old", text: "OLD ACTIVITY" });
    window.__immediateClear = selectSession("clear-target", true);
    return {
      selected: state.selectedSessionId,
      messages: state.currentMessages.length,
      text: document.querySelector("#messages")?.textContent || "",
      activity: state.currentActivity,
    };
  })()`);
  if (immediateClear.selected !== "clear-target" || immediateClear.messages !== 0 || immediateClear.text.includes("OLD CONVERSATION") || immediateClear.activity !== null) {
    failures.push(`session switch retained the previous presentation while history was pending: ${JSON.stringify(immediateClear)}`);
  }
  deferredSessionRequests.history.get("clear-target").resolve({ messages: [{ role: "assistant", text: "TARGET CONVERSATION" }], activity: null });
  deferredSessionRequests.models.get("clear-target").resolve({ current: null, groups: [] });
  deferredSessionRequests.commands.get("clear-target").resolve([]);
  await contents.executeJavaScript("window.__immediateClear");

  for (const kind of Object.keys(deferredSessionRequests)) deferredSessionRequests[kind].set("compact-target", deferred());
  currentMode = "orb";
  const compactClear = await contents.executeJavaScript(`(() => {
    state.windowMode = "orb";
    state.dashboard = { harness: true, sessions: [
      { sessionId: "compact-source", title: "Source", running: false, state: "idle", projections: { values: {} }, subagents: [] },
      { sessionId: "compact-target", title: "Target", running: false, state: "idle", projections: { values: {} }, subagents: [] },
    ] };
    state.selectedSessionId = "compact-source";
    renderMessages([{ role: "assistant", text: "OLD COMPACT CONVERSATION" }]);
    setActivity({ active: true, kind: "thinking", label: "Old", text: "OLD COMPACT ACTIVITY" });
    window.__compactClear = openCompactSession("compact-target");
    return {
      selected: state.selectedSessionId,
      messages: state.currentMessages.length,
      text: document.querySelector("#messages")?.textContent || "",
      activity: state.currentActivity,
    };
  })()`);
  await wait(240);
  const compactClearedAfterRestore = await contents.executeJavaScript(`({
    selected: state.selectedSessionId,
    messages: state.currentMessages.length,
    text: document.querySelector("#messages")?.textContent || "",
    activity: state.currentActivity,
  })`);
  if (compactClear.selected !== "compact-source" || compactClearedAfterRestore.selected !== "compact-target"
      || compactClearedAfterRestore.messages !== 0 || compactClearedAfterRestore.text.includes("OLD COMPACT CONVERSATION")
      || compactClearedAfterRestore.activity !== null) {
    failures.push(`compact exact-session open did not clear after the restore transition: ${JSON.stringify({ compactClear, compactClearedAfterRestore })}`);
  }
  deferredSessionRequests.history.get("compact-target").reject(new Error("history unavailable"));
  deferredSessionRequests.models.get("compact-target").resolve({ current: null, groups: [] });
  deferredSessionRequests.commands.get("compact-target").resolve([]);
  const compactAfterFailure = await contents.executeJavaScript(`(async () => {
    await window.__compactClear;
    return { selected: state.selectedSessionId, messages: state.currentMessages.length, text: document.querySelector("#messages")?.textContent || "" };
  })()`);
  if (compactAfterFailure.selected !== "compact-target" || compactAfterFailure.messages !== 0 || compactAfterFailure.text.includes("OLD COMPACT CONVERSATION")) {
    failures.push(`failed compact history restored the previous presentation: ${JSON.stringify(compactAfterFailure)}`);
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

  const streamHistory = deferred();
  deferredSessionRequests.history.set("stream-owner", streamHistory);
  const streamLifecycle = await contents.executeJavaScript(`(async () => {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
    state.selectedSessionId = "stream-owner";
    state.dashboard = { harness: true, sessions: [{ sessionId: "stream-owner", title: "Stream", running: true, state: "working", projections: { values: {} }, subagents: [] }] };
    state.currentMessages = [{ role: "user", text: "Show the stream." }];
    state.historySignature = "";
    state.liveStreamsBySession.delete("stream-owner");
    renderMessages(state.currentMessages);
    await handleLiveEvent({ sessionId: "stream-owner", event: { type: "turn/start", seq: 10 } });
    await handleLiveEvent({ sessionId: "stream-owner", event: { type: "assistant/chunk", seq: 11, data: { chunk: { type: "reasoning-delta", text: "Inspect" } } } });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const reasoning = { kind: state.currentActivity?.kind || "", text: state.currentActivity?.text || "" };

    await handleLiveEvent({ sessionId: "stream-owner", event: { type: "assistant/chunk", seq: 12, data: { chunk: { type: "text-delta", text: "Answer" } } } });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const writing = { kind: state.currentActivity?.kind || "", text: document.querySelector(".live-assistant")?.textContent || "" };

    await handleLiveEvent({ sessionId: "stream-owner", event: { type: "assistant/chunk", seq: 13, data: { chunk: { type: "text-delta", text: " final" } } } });
    await handleLiveEvent({ sessionId: "stream-owner", event: { type: "turn/end", seq: 14, data: {} } });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await new Promise((resolve) => setTimeout(resolve, 130));
    const completed = {
      kind: state.currentActivity?.kind || "",
      text: document.querySelector(".live-assistant")?.textContent || "",
      retained: state.liveStreamsBySession.get("stream-owner")?.text || "",
    };

    await handleLiveEvent({ sessionId: "stream-owner", event: { type: "turn/start", seq: 15 } });
    await handleLiveEvent({ sessionId: "stream-owner", event: { type: "assistant/chunk", seq: 16, data: { chunk: { type: "text-delta", text: "next" } } } });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return { reasoning, writing, completed, nextBeforeHistory: state.liveStreamsBySession.get("stream-owner")?.text || "" };
  })()`);
  if (streamLifecycle.reasoning.kind !== "thinking" || streamLifecycle.reasoning.text !== "Inspect"
      || streamLifecycle.writing.kind !== "writing" || streamLifecycle.writing.text !== "Answer"
      || streamLifecycle.completed.kind !== "done" || streamLifecycle.completed.text !== "Answer final"
      || streamLifecycle.completed.retained !== "Answer final" || streamLifecycle.nextBeforeHistory !== "next") {
    failures.push(`reasoning/text/end stream lifecycle regressed: ${JSON.stringify(streamLifecycle)}`);
  }
  streamHistory.resolve({ messages: [{ role: "assistant", text: "Authoritative first turn" }], activity: null });
  await wait(160);
  const streamAfterHistory = await contents.executeJavaScript(`(() => ({
    live: state.liveStreamsBySession.get("stream-owner")?.text || "",
    bubble: document.querySelector(".live-assistant")?.textContent || "",
    history: state.currentMessages.map((message) => message.text || ""),
  }))()`);
  deferredSessionRequests.history.delete("stream-owner");
  if (streamAfterHistory.live !== "next" || streamAfterHistory.bubble !== "next" || !streamAfterHistory.history.includes("Authoritative first turn")) {
    failures.push(`first turn history cleanup deleted or replaced the subsequent stream: ${JSON.stringify(streamAfterHistory)}`);
  }
  await contents.executeJavaScript(`clearCompletionSignal(); schedulePolling()`);

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

  deferredSend = deferred();
  dashboardValue = { harness: true, sessions: [{ sessionId: "queue-submit", title: "Queued work", running: true, state: "working", activity: { active: true, kind: "thinking", label: "Thinking", text: "Current turn" }, projections: { values: {} }, subagents: [] }] };
  await contents.executeJavaScript(`(() => {
    state.dashboard = ${JSON.stringify(dashboardValue)};
    state.selectedSessionId = "queue-submit";
    state.runningSessionIds = new Set(["queue-submit"]);
    state.queuedPromptsBySession.set("queue-submit", []);
    state.queueSnapshotRevisions.set("queue-submit", 0);
    state.pendingAttachments = [];
    const input = document.querySelector("#messageInput");
    input.value = "one queued request";
    document.querySelector("#chatForm").requestSubmit();
  })()`);
  await wait(40);
  contents.send("queue-update", { sessionId: "queue-submit", items: [{ id: "server-1", text: "one queued request", preview: "one queued request" }] });
  await wait(40);
  deferredSend.resolve({ sessionId: "queue-submit" });
  await wait(240);
  const queueSubmitRace = await contents.executeJavaScript(`(() => {
    const items = queuedPromptsFor("queue-submit");
    return { ids: items.map((item) => item.id), optimistic: items.filter((item) => item.optimistic).length, rows: document.querySelectorAll("#queueList .queue-row").length };
  })()`);
  deferredSend = null;
  if (queueSubmitRace.ids.join() !== "server-1" || queueSubmitRace.optimistic || queueSubmitRace.rows !== 1) {
    failures.push(`authoritative queue snapshot raced into a duplicate optimistic row: ${JSON.stringify(queueSubmitRace)}`);
  }
  contents.send("queue-update", { sessionId: "queue-submit", items: [
    { id: "server-2", text: "same", preview: "same" },
    { id: "server-3", text: "same", preview: "same" },
  ] });
  await wait(60);
  const identicalQueueItems = await contents.executeJavaScript(`queuedPromptsFor("queue-submit").map((item) => item.id)`);
  if (identicalQueueItems.join() !== "server-2,server-3") failures.push(`legitimate identical queue submissions were deduplicated: ${JSON.stringify(identicalQueueItems)}`);

  const todoPresentation = await contents.executeJavaScript(`(async () => {
    state.dashboard = { harness: true, sessions: [{ sessionId: "todo-session", title: "Plan", running: true, state: "working", projections: { values: { todos: [
      { content: "Inspect project", status: "completed" },
      { content: "Fix renderer", status: "in_progress" },
      { content: "Verify release", status: "pending" },
    ] } }, subagents: [] }] };
    state.selectedSessionId = "todo-session";
    state.todoSignature = "";
    renderTodos();
    const collapsed = { hidden: document.querySelector("#todoDock").hidden, rows: document.querySelectorAll("#todoList .todo-row").length, counts: document.querySelector("#todoCounts").textContent, expanded: document.querySelector("#todoToggle").getAttribute("aria-expanded") };
    document.querySelector("#todoToggle").click();
    const open = { hidden: document.querySelector("#todoList").hidden, active: document.querySelectorAll("#todoList .in_progress").length };
    await handleLiveEvent({ sessionId: "todo-session", event: { type: "todo/write", seq: 80, data: { todos: [{ content: "Live updated plan", status: "in_progress" }] } } });
    const live = document.querySelector("#todoList").textContent;
    await handleLiveEvent({ sessionId: "todo-session", event: { type: "turn/start", seq: 81, data: {} } });
    return { collapsed, open, live, cleared: document.querySelector("#todoDock").hidden };
  })()`);
  if (todoPresentation.collapsed.hidden || todoPresentation.collapsed.rows !== 3 || todoPresentation.collapsed.counts !== "1/3 done · 1 active" || todoPresentation.collapsed.expanded !== "false" || todoPresentation.open.hidden || todoPresentation.open.active !== 1 || !todoPresentation.live.includes("Live updated plan") || !todoPresentation.cleared) {
    failures.push(`Harness TODO projection did not render and update compactly: ${JSON.stringify(todoPresentation)}`);
  }

  const staleLiveDashboard = deferred();
  deferredDashboard = staleLiveDashboard;
  const liveDashboardRacePromise = contents.executeJavaScript(`(async () => {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
    state.dashboard = { harness: true, sessions: [{ sessionId: "live-race", title: "Live race", running: true, state: "working", activity: { active: true, kind: "thinking", label: "Thinking", text: "Before" }, projections: { values: { todos: [{ content: "Old plan", status: "pending" }] } }, subagents: [] }] };
    state.selectedSessionId = "live-race";
    state.runningSessionIds = new Set(["live-race"]);
    state.liveSessionRevisions.delete("live-race");
    syncRunningControls(true);
    const pending = performRefresh();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await handleLiveEvent({ sessionId: "live-race", event: { type: "todo/write", seq: 200, data: { todos: [{ content: "Fresh live plan", status: "in_progress" }] } } });
    await handleLiveEvent({ sessionId: "live-race", event: { type: "turn/end", seq: 201, data: {} } });
    await pending;
    const session = state.dashboard.sessions.find((item) => item.sessionId === "live-race");
    return {
      running: session.running,
      todos: todosFor("live-race").map((item) => item.content),
      stopHidden: document.querySelector("#cancelButton").hidden,
    };
  })()`);
  await wait(60);
  staleLiveDashboard.resolve({ harness: true, sessions: [{ sessionId: "live-race", title: "Live race", running: true, state: "working", activity: { active: true, kind: "thinking", label: "Thinking", text: "Stale" }, projections: { values: { todos: [{ content: "Old plan", status: "pending" }] } }, subagents: [] }] });
  const liveDashboardRace = await liveDashboardRacePromise;
  deferredDashboard = null;
  if (liveDashboardRace.running || liveDashboardRace.todos.join() !== "Fresh live plan" || !liveDashboardRace.stopHidden) {
    failures.push(`stale dashboard overwrote live TODO or resurrected Stop: ${JSON.stringify(liveDashboardRace)}`);
  }
  dashboardValue = { harness: true, sessions: [{ sessionId: "live-race", title: "Live race", running: false, state: "idle", activity: null, projections: { values: { contextPressure: { projectedTokens: 8192, contextWindow: 32768 }, todos: [{ content: "Old plan", status: "pending" }] } }, subagents: [] }] };
  const staleTodoNextPoll = await contents.executeJavaScript(`(async () => {
    await performRefresh();
    const session = state.dashboard.sessions.find((item) => item.sessionId === "live-race");
    return {
      todos: todosFor("live-race").map((item) => item.content),
      projectedTokens: session.projections?.values?.contextPressure?.projectedTokens,
      overlay: state.liveTodosBySession.has("live-race"),
    };
  })()`);
  dashboardValue = { harness: true, sessions: [{ sessionId: "live-race", title: "Live race", running: false, state: "idle", activity: null, projections: { values: { contextPressure: { projectedTokens: 16384, contextWindow: 32768 }, todos: [{ content: "Fresh live plan", status: "in_progress" }] } }, subagents: [] }] };
  const acknowledgedTodo = await contents.executeJavaScript(`(async () => {
    await performRefresh();
    const session = state.dashboard.sessions.find((item) => item.sessionId === "live-race");
    return {
      todos: todosFor("live-race").map((item) => item.content),
      projectedTokens: session.projections?.values?.contextPressure?.projectedTokens,
      overlay: state.liveTodosBySession.has("live-race"),
    };
  })()`);
  if (staleTodoNextPoll.todos.join() !== "Fresh live plan" || staleTodoNextPoll.projectedTokens !== 8192 || !staleTodoNextPoll.overlay
      || acknowledgedTodo.todos.join() !== "Fresh live plan" || acknowledgedTodo.projectedTokens !== 16384 || acknowledgedTodo.overlay) {
    failures.push(`live TODO overlay was not field-level, durable, or acknowledged: ${JSON.stringify({ staleTodoNextPoll, acknowledgedTodo })}`);
  }
  await contents.executeJavaScript(`schedulePolling()`);

  const mixedTools = await contents.executeJavaScript(`(() => {
    state.selectedSessionId = "tool-mix";
    renderMessages([
      { role: "tool", callId: "ok", name: "read", status: "completed", result: "ok", isError: false },
      { role: "tool", callId: "bad", name: "write", status: "completed", result: "denied", isError: true },
    ]);
    const group = document.querySelector("#messages .tool-group");
    return { className: group?.className || "", meta: group?.querySelector(".tool-group-identity small")?.textContent || "", failedRows: group?.querySelectorAll(".tool-call.failed").length || 0 };
  })()`);
  if (!mixedTools.className.includes("partial-failure") || mixedTools.className.includes("tool-group failed") || mixedTools.meta !== "1 completed · 1 failed" || mixedTools.failedRows !== 1) {
    failures.push(`one failed tool painted the whole group as failed: ${JSON.stringify(mixedTools)}`);
  }

  const steerPresentation = await contents.executeJavaScript(`(async () => {
    state.dashboard = { harness: true, sessions: [{ sessionId: "steer-session", title: "Steer", running: true, state: "working", projections: { values: {} }, subagents: [] }] };
    state.selectedSessionId = "steer-session";
    state.runningSessionIds = new Set(["steer-session"]);
    state.currentMessages = [];
    state.historySignature = "";
    state.liveStreamsBySession.set("steer-session", { text: "old unfinished answer", reasoning: "", lastSeq: 90, active: true, activity: { active: true, kind: "writing", label: "Writing", text: "old unfinished answer" } });
    setActivity({ active: true, kind: "writing", label: "Writing", text: "old unfinished answer" });
    renderMessages([]);
    state.queuedPromptsBySession.set("steer-session", [{ id: "steer-item", text: "new direction" }]);
    await updateQueuedPrompt({ id: "steer-item", text: "new direction" }, { kind: "steer" });
    const interrupted = { live: document.querySelector("#messages .live-assistant")?.textContent || "", steering: document.querySelector("#messages .steering-message")?.textContent || "", activity: state.currentActivity?.kind, stopHidden: document.querySelector("#cancelButton").hidden };
    await handleLiveEvent({ sessionId: "steer-session", event: { type: "assistant/chunk", seq: 91, data: { chunk: { type: "text-delta", text: "new answer" } } } });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const next = document.querySelector("#messages .live-assistant")?.textContent || "";
    await handleLiveEvent({ sessionId: "steer-session", event: { type: "turn/end", seq: 92, data: { reason: { kind: "stop" } } } });
    return { interrupted, next, stopHiddenAfterEnd: document.querySelector("#cancelButton").hidden };
  })()`);
  if (steerPresentation.interrupted.live || !steerPresentation.interrupted.steering.includes("new direction") || steerPresentation.interrupted.activity !== "thinking" || steerPresentation.interrupted.stopHidden || steerPresentation.next !== "new answer" || !steerPresentation.stopHiddenAfterEnd) {
    failures.push(`Send now did not interrupt the previous live bubble cleanly: ${JSON.stringify(steerPresentation)}`);
  }

  await within(contents.executeJavaScript(`(async () => {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
    if (state.refreshPromise) await state.refreshPromise;
    return true;
  })()`), "poll quiescence before steer race");
  deferredQueueUpdate = deferred();
  const staleSteerHistory = deferred();
  const prioritySteerHistory = deferred();
  const firstSteerHistoryStarted = deferred();
  const secondSteerHistoryStarted = deferred();
  let steerHistoryCalls = 0;
  deferredSessionRequests.history.set("steer-late", { take: () => {
    steerHistoryCalls += 1;
    if (steerHistoryCalls === 1) {
      firstSteerHistoryStarted.resolve();
      return staleSteerHistory.promise;
    }
    if (steerHistoryCalls === 2) {
      secondSteerHistoryStarted.resolve();
      return prioritySteerHistory.promise;
    }
    return Promise.resolve({ messages: [{ role: "user", text: "durable direction" }], activity: null });
  } });
  await contents.executeJavaScript(`(() => {
    state.dashboard = { harness: true, sessions: [{ sessionId: "steer-late", title: "Late steer", running: true, state: "working", projections: { values: {} }, subagents: [] }] };
    state.selectedSessionId = "steer-late";
    state.runningSessionIds = new Set(["steer-late"]);
    state.currentMessages = [];
    state.liveStreamsBySession.set("steer-late", { text: "old answer", reasoning: "", lastSeq: 300, active: true, activity: { active: true, kind: "writing", label: "Writing", text: "old answer" } });
    state.queuedPromptsBySession.set("steer-late", [{ id: "late-item", text: "durable direction" }]);
    state.steeringPromptsBySession.set("steer-late", []);
    state.queueSnapshotRevisions.set("steer-late", 10);
    window.__lateSteer = updateQueuedPrompt({ id: "late-item", text: "durable direction" }, { kind: "steer" });
    window.__staleSteerHistory = refreshHistory();
  })()`);
  await within(firstSteerHistoryStarted.promise, "stale steer history rendezvous");
  await contents.executeJavaScript(`(() => {
    applyQueueSnapshot("steer-late", [{ id: "late-item", text: "durable direction", placement: "steering" }], 11);
    applyQueueSnapshot("steer-late", [], 12);
    window.__lateSteerMessage = handleLiveEvent({ sessionId: "steer-late", event: { type: "user/message", seq: 301, data: { messageId: "late-item", sourceKind: "user", text: "durable direction" } } });
    return true;
  })()`);
  await within(secondSteerHistoryStarted.promise, "priority steer history rendezvous");
  const blockedHistory = await within(contents.executeJavaScript(`refreshHistory()`), "blocked poll refresh");
  staleSteerHistory.resolve({ messages: [], activity: null });
  const staleHistory = await within(contents.executeJavaScript(`window.__staleSteerHistory`), "stale history settlement");
  prioritySteerHistory.resolve({ messages: [{ role: "user", text: "durable direction" }], activity: null });
  const lateSteerBeforeRpc = await within(contents.executeJavaScript(`(async () => {
    await window.__lateSteerMessage;
    return {
      steering: steeringPromptsFor("steer-late").length,
      live: document.querySelector("#messages .live-assistant")?.textContent || "",
      durable: document.querySelectorAll("#messages .bubble.user").length,
    };
  })()`), "priority steer history settlement");
  deferredQueueUpdate.resolve({ ok: true });
  const lateSteerAfterRpc = await contents.executeJavaScript(`(async () => {
    await window.__lateSteer;
    return {
      steering: steeringPromptsFor("steer-late").length,
      live: document.querySelector("#messages .live-assistant")?.textContent || "",
      durable: document.querySelectorAll("#messages .bubble.user").length,
    };
  })()`);
  deferredQueueUpdate = null;
  deferredSessionRequests.history.delete("steer-late");
  if (blockedHistory !== "deferred" || staleHistory !== "superseded" || steerHistoryCalls < 2
      || lateSteerBeforeRpc.steering || lateSteerBeforeRpc.live || lateSteerBeforeRpc.durable !== 1
      || lateSteerAfterRpc.steering || lateSteerAfterRpc.live || lateSteerAfterRpc.durable !== 1) {
    failures.push(`durable steering handoff duplicated or resurrected after late updateQueue: ${JSON.stringify({ blockedHistory, staleHistory, steerHistoryCalls, lateSteerBeforeRpc, lateSteerAfterRpc })}`);
  }

  deferredCancel = deferred();
  await contents.executeJavaScript(`(() => {
    state.dashboard = { harness: true, sessions: [{ sessionId: "cancel-race", title: "Cancel race", running: true, state: "working", activity: { active: true, kind: "writing", label: "Writing", text: "old turn" }, projections: { values: {} }, subagents: [] }] };
    state.selectedSessionId = "cancel-race";
    state.runningSessionIds = new Set(["cancel-race"]);
    state.turnGenerationsBySession.set("cancel-race", 4);
    state.cancelPendingSessionIds.delete("cancel-race");
    syncRunningControls(true);
    window.__lateCancel = stopCurrentTurn();
  })()`);
  await wait(30);
  await contents.executeJavaScript(`handleLiveEvent({ sessionId: "cancel-race", event: { type: "turn/start", seq: 400, data: {} } })`);
  deferredCancel.resolve({ accepted: true });
  const lateCancel = await contents.executeJavaScript(`(async () => {
    await window.__lateCancel;
    const session = state.dashboard.sessions.find((item) => item.sessionId === "cancel-race");
    return {
      generation: state.turnGenerationsBySession.get("cancel-race"),
      running: session.running,
      live: state.liveStreamsBySession.get("cancel-race")?.active,
      cancelPending: state.cancelPendingSessionIds.has("cancel-race"),
      stopHidden: document.querySelector("#cancelButton").hidden,
    };
  })()`);
  deferredCancel = null;
  if (lateCancel.generation !== 5 || !lateCancel.running || !lateCancel.live || lateCancel.cancelPending || lateCancel.stopHidden) {
    failures.push(`late Stop completion idled a newer turn: ${JSON.stringify(lateCancel)}`);
  }

  await contents.executeJavaScript(`(() => { clearCompletionSignal(); return true; })()`);
  const stableMessages = Array.from({ length: 24 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", text: `Stable message ${index + 1}` }));
  dashboardValue = { harness: true, sessions: [{ sessionId: "stable-poll", title: "Stable polling", updatedAt: 42, running: false, state: "idle", preview: "Stable message 24", projections: { values: { contextPressure: { projectedTokens: 2048, contextWindow: 32768 }, todos: [] } }, subagents: [] }] };
  deferredSessionRequests.history.set("stable-poll", { promise: Promise.resolve({ messages: stableMessages, activity: null }) });
  const compactBeforeStablePoll = compactStatusPayloads.length;
  const boundsBeforeStablePoll = win.getBounds();
  const stablePolling = await contents.executeJavaScript(`(async () => {
    state.dashboardInitialized = false;
    state.dashboard = ${JSON.stringify(dashboardValue)};
    state.selectedSessionId = "stable-poll";
    state.modelCatalog = { current: null, groups: [] };
    state.modelLoadState = "ready";
    state.commandsLoadedSessionId = "stable-poll";
    state.commandCatalog = [];
    state.workspacesLoaded = true;
    state.workspaces = [];
    state.queuedPromptsBySession.set("stable-poll", []);
    state.queueSnapshotRevisions.set("stable-poll", 1);
    state.currentActivity = null;
    state.activityCardSignature = "";
    state.historySignature = "";
    await performRefresh();
    const root = document.querySelector(".widget-shell");
    const messages = document.querySelector("#messages");
    messages.scrollTop = Math.max(0, Math.floor((messages.scrollHeight - messages.clientHeight) / 2));
    state.messagesStickToBottom = false;
    state.unseenMessages = 0;
    document.querySelector("#messageInput").focus();
    const firstBubble = messages.querySelector(".bubble");
    const firstSession = document.querySelector("#sessions .session-card");
    const queueList = document.querySelector("#queueList");
    const before = {
      shell: [...[root.getBoundingClientRect()].map((r) => [r.x, r.y, r.width, r.height])][0],
      composer: [...[document.querySelector("#chatForm").getBoundingClientRect()].map((r) => [r.x, r.y, r.width, r.height])][0],
      messages: [...[messages.getBoundingClientRect()].map((r) => [r.x, r.y, r.width, r.height])][0],
      scrollTop: messages.scrollTop,
      active: document.activeElement?.id || "",
    };
    const mutations = [];
    const observer = new MutationObserver((records) => mutations.push(...records.map((record) => record.type + ":" + (record.attributeName || record.target.id || record.target.className || record.target.nodeName))));
    observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
    for (let index = 0; index < 8; index += 1) await performRefresh();
    observer.disconnect();
    const after = {
      shell: [...[root.getBoundingClientRect()].map((r) => [r.x, r.y, r.width, r.height])][0],
      composer: [...[document.querySelector("#chatForm").getBoundingClientRect()].map((r) => [r.x, r.y, r.width, r.height])][0],
      messages: [...[messages.getBoundingClientRect()].map((r) => [r.x, r.y, r.width, r.height])][0],
      scrollTop: messages.scrollTop,
      active: document.activeElement?.id || "",
    };
    return {
      before,
      after,
      mutations,
      sameBubble: firstBubble === messages.querySelector(".bubble"),
      sameSession: firstSession === document.querySelector("#sessions .session-card"),
      sameQueue: queueList === document.querySelector("#queueList"),
    };
  })()`);
  deferredSessionRequests.history.delete("stable-poll");
  const compactAfterStablePoll = compactStatusPayloads.length;
  const boundsAfterStablePoll = win.getBounds();
  if (stablePolling.mutations.length || JSON.stringify(stablePolling.before) !== JSON.stringify(stablePolling.after) || !stablePolling.sameBubble || !stablePolling.sameSession || !stablePolling.sameQueue || compactAfterStablePoll !== compactBeforeStablePoll || JSON.stringify(boundsBeforeStablePoll) !== JSON.stringify(boundsAfterStablePoll)) {
    failures.push(`eight unchanged 2.5s refresh passes mutated or moved the widget: ${JSON.stringify({ stablePolling, compactIpc: [compactBeforeStablePoll, compactAfterStablePoll], bounds: [boundsBeforeStablePoll, boundsAfterStablePoll] })}`);
  }

  dashboardValue = { harness: true, sessions: [{ sessionId: "slash-session", title: "Slash", running: false, state: "idle", projections: { values: {} }, subagents: [] }] };
  deferredSessionRequests.commands.set("slash-session", { promise: Promise.resolve([
    { name: "feedback", description: "Feedback" },
    { name: "goal", description: "Set or inspect the active goal", input: { hint: "[objective]", images: true } },
    { name: "compact", description: "Compact context" },
    { name: "plan", description: "Plan mode", input: { hint: "[on|off]", images: true } },
    { name: "permission", description: "Permission", input: { hint: "<mode>" } },
  ]) });
  deferredSessionRequests.history.set("slash-session", { promise: Promise.resolve({ messages: [
    { role: "user", text: "/goal create ship it" },
    { role: "command", text: "Status: active\nObjective: Ship it safely\nRounds: 2/4\nActivation: manual" },
  ], activity: null }) });
  const sentBeforeSlash = sentPayloads.length;
  const commandsBeforeSlash = commandPayloads.length;
  deferredCommand = deferred();
  const slashStart = await contents.executeJavaScript(`(async () => {
    state.dashboard = ${JSON.stringify(dashboardValue)};
    state.harnessOffline = false;
    await selectSession("slash-session", true);
    state.pendingAttachments = [
      { kind: "image", mediaType: "image/png", data: "AA==", name: "goal.png", path: "C:\\\\goal.png" },
      { kind: "file", name: "goal.png", path: "C:\\\\keep.txt" },
    ];
    renderAttachments();
    const input = document.querySelector("#messageInput");
    input.value = "/GoAl create ship it";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    const hint = document.querySelector("#commandHintBar")?.textContent || "";
    document.querySelector("#chatForm").requestSubmit();
    return { hint };
  })()`);
  await wait(50);
  deferredCommand.resolve({ result: { kind: "success", text: "Status: active\nObjective: Ship it safely\nRounds: 2/4\nActivation: manual" } });
  await wait(220);
  deferredCommand = null;
  const slashResult = await contents.executeJavaScript(`({
    goalCard: document.querySelector("#messages .goal-result")?.textContent || "",
    attachments: state.pendingAttachments.length,
    attachmentPaths: state.pendingAttachments.map((item) => item.path),
    firstCommands: [...document.querySelectorAll("#commandMenu .command-name")].slice(0, 4).map((item) => item.textContent),
  })`);
  const goalPayload = commandPayloads.at(-1);
  if (!slashStart.hint.includes("create <objective>") || sentPayloads.length !== sentBeforeSlash || commandPayloads.length !== commandsBeforeSlash + 1
      || goalPayload?.line !== "/GoAl create ship it" || goalPayload?.images?.[0]?.name !== "goal.png"
      || slashResult.attachments !== 1 || slashResult.attachmentPaths.join() !== "C:\\keep.txt" || !slashResult.goalCard.includes("Ship it safely")
      || slashResult.firstCommands.join() !== "/goal,/compact,/plan,/permission") {
    failures.push(`slash /goal lost command routing, guidance, image, or structured result: ${JSON.stringify({ slashStart, slashResult, goalPayload })}`);
  }

  const commandsBeforePlanImage = commandPayloads.length;
  await contents.executeJavaScript(`(() => {
    state.pendingAttachments.push({ kind: "image", mediaType: "image/png", data: "BB==", name: "plan.png", path: "C:\\\\plan.png" });
    renderAttachments();
    const input = document.querySelector("#messageInput");
    input.value = "/PlAn review this";
    document.querySelector("#chatForm").requestSubmit();
  })()`);
  await wait(180);
  const planImageResult = await contents.executeJavaScript(`({
    attachments: state.pendingAttachments.map((item) => item.path),
    input: document.querySelector("#messageInput").value,
  })`);
  const planImagePayload = commandPayloads.at(-1);
  if (commandPayloads.length !== commandsBeforePlanImage + 1 || planImagePayload?.line !== "/PlAn review this"
      || planImagePayload?.images?.[0]?.name !== "plan.png" || planImageResult.attachments.join() !== "C:\\keep.txt") {
    failures.push(`commandCatalog input.images was ignored or removed an unsent attachment: ${JSON.stringify({ planImagePayload, planImageResult })}`);
  }

  const sentBeforeUnknown = sentPayloads.length;
  const commandsBeforeUnknown = commandPayloads.length;
  const unknownSlash = await contents.executeJavaScript(`(async () => {
    const input = document.querySelector("#messageInput");
    input.value = "/NotACommand";
    document.querySelector("#chatForm").requestSubmit();
    await new Promise((resolve) => setTimeout(resolve, 80));
    return { value: input.value, activity: state.currentActivity?.text || "" };
  })()`);
  if (sentPayloads.length !== sentBeforeUnknown || commandPayloads.length !== commandsBeforeUnknown || unknownSlash.value !== "/NotACommand" || !/Unknown Harness command/i.test(unknownSlash.activity)) {
    failures.push(`unknown slash command leaked to the model prompt path: ${JSON.stringify(unknownSlash)}`);
  }
  deferredSessionRequests.commands.delete("slash-session");
  deferredSessionRequests.history.delete("slash-session");

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
  dashboardValue = { harness: true, sessions: [
    { sessionId: "send-a", title: "Send A", running: false, state: "idle", projections: { values: {} }, subagents: [] },
    { sessionId: "send-b", title: "Send B", running: false, state: "idle", projections: { values: {} }, subagents: [] },
  ] };
  deferredSessionRequests.history.set("send-b", { promise: Promise.resolve({ messages: [{ role: "assistant", text: "Selected B" }], activity: null }) });
  await contents.executeJavaScript(`(async () => {
    state.dashboard = { harness: true, sessions: [
      { sessionId: "send-a", title: "Send A", running: false, state: "idle", projections: { values: {} }, subagents: [] },
      { sessionId: "send-b", title: "Send B", running: false, state: "idle", projections: { values: {} }, subagents: [] },
    ] };
    state.selectedSessionId = "send-a";
    state.pendingAttachments = [];
    const input = document.querySelector("#messageInput");
    input.value = "message for A";
    document.querySelector("#chatForm").requestSubmit();
    await selectSession("send-b", true);
    renderMessages([{ role: "assistant", text: "Selected B" }]);
  })()`);
  await wait(40);
  deferredSend.resolve({ sessionId: "send-a" });
  await wait(180);
  const sendRace = await contents.executeJavaScript(`({ selected: state.selectedSessionId, text: document.querySelector("#messages")?.textContent || "" })`);
  deferredSend = null;
  deferredSessionRequests.history.delete("send-b");
  if (sendRace.selected !== "send-b" || !sendRace.text.includes("Selected B")) {
    failures.push(`send completion forced the UI back to its original session: ${JSON.stringify(sendRace)}`);
  }

  deferredSend = deferred();
  dashboardValue = { harness: true, sessions: [
    { sessionId: "failed-send-a", title: "Failed send A", running: false, state: "idle", projections: { values: {} }, subagents: [] },
    { sessionId: "failed-send-b", title: "Failed send B", running: false, state: "idle", projections: { values: {} }, subagents: [] },
  ] };
  deferredSessionRequests.history.set("failed-send-b", { promise: Promise.resolve({ messages: [], activity: null }) });
  await contents.executeJavaScript(`(async () => {
    state.dashboard = { harness: true, sessions: [
      { sessionId: "failed-send-a", title: "Failed send A", running: false, state: "idle", projections: { values: {} }, subagents: [] },
      { sessionId: "failed-send-b", title: "Failed send B", running: false, state: "idle", projections: { values: {} }, subagents: [] },
    ] };
    state.selectedSessionId = "failed-send-a";
    state.pendingAttachments = [];
    const input = document.querySelector("#messageInput");
    input.value = "message that belongs to A";
    document.querySelector("#chatForm").requestSubmit();
    await selectSession("failed-send-b", true);
    input.value = "draft for B";
  })()`);
  await wait(40);
  deferredSend.reject(new Error("A failed"));
  await wait(180);
  const failedSendRace = await contents.executeJavaScript(`({ selected: state.selectedSessionId, draft: document.querySelector("#messageInput").value, active: document.activeElement?.id || "" })`);
  deferredSend = null;
  deferredSessionRequests.history.delete("failed-send-b");
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
  if (failures.length === 0) console.log("PASS stable rendering, bounded live-stream paints, last-intent modes, compact drag, exact-session open, and inline quick reply behave correctly");
  app.exit(failures.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
