const test = require("node:test");
const assert = require("node:assert/strict");
const { createChatVisualState } = require("../src/renderer/chat-visual-state.js");

function fixture(id = "selected") {
  const visual = createChatVisualState();
  const body = { dataset: {} };
  visual.select(id);
  const phase = () => { visual.sync(body); return body.dataset.chatState; };
  return { visual, body, phase };
}

test("waiting covers API delay and live phases are selected-session scoped", () => {
  const { visual, phase } = fixture();
  visual.noteSendStart("selected");
  visual.notePoll("selected", { running: false });
  assert.equal(phase(), "waiting");
  visual.noteStream("other", "writing");
  assert.equal(phase(), "waiting");
  for (const kind of ["thinking", "writing", "tool", "waiting"]) {
    visual.noteStream("selected", kind);
    assert.equal(phase(), kind);
  }
  visual.select("idle-session");
  assert.equal(phase(), "idle");
});

test("session creation cannot light another selected chat", () => {
  const { visual, phase } = fixture(null);
  visual.noteSendStart(null);
  assert.equal(phase(), "waiting");
  visual.select("other");
  assert.equal(phase(), "idle");
  visual.noteCreateSettled("created", "waiting");
  assert.equal(phase(), "idle");
  visual.select("created");
  assert.equal(phase(), "waiting");
});

test("offline overrides every phase without losing the selected turn on reconnect", () => {
  const { visual, phase } = fixture();
  visual.noteStream("selected", "writing");
  visual.setOffline(true);
  assert.equal(phase(), "offline");
  visual.noteCompletion("other", "error");
  assert.equal(phase(), "offline");
  visual.setOffline(false);
  assert.equal(phase(), "writing");
  visual.notePoll("selected", { running: false });
  assert.equal(phase(), "idle");
});

test("disconnect invalidates busy streams, retains text, and protects newer live events", () => {
  const fs = require("node:fs");
  const vm = require("node:vm");
  const source = fs.readFileSync(require.resolve("../src/renderer/app.js"), "utf8");
  const code = source.slice(source.indexOf("function invalidateDisconnectedStreams("), source.indexOf("async function refreshHistory("));
  const stale = { active: true, activity: { kind: "writing" }, text: "visible partial answer" };
  const fresh = { active: true, activity: { kind: "tool" } };
  const context = {
    state: { liveStreamsBySession: new Map([["stale", stale], ["fresh", fresh]]), liveSessionRevisions: new Map([["stale", 1], ["fresh", 2]]), runningSessionIds: new Set(["stale", "fresh"]), historyRequestSequence: 4 },
    invalidateSelectedHistoryVersion() { context.invalidated = true; }, selectedLiveStreamIsActive: () => stale.active,
    setActivity(value) { context.activity = value; },
  };
  vm.createContext(context);
  vm.runInContext(code, context);
  context.invalidateDisconnectedStreams(new Map([["stale", 1], ["fresh", 1]]));
  assert.equal(stale.active, false);
  assert.equal(stale.disconnected, true);
  assert.equal(stale.text, "visible partial answer");
  assert.equal(fresh.active, true);
  assert.equal(context.invalidated, true);
  assert.equal(context.activity, null);
  const { visual, phase } = fixture("stale");
  visual.noteStream("stale", "writing");
  visual.setOffline(true);
  assert.equal(phase(), "offline");
  visual.setOffline(false);
  visual.notePoll("stale", { running: false || stale.active });
  assert.equal(phase(), "idle");
});

test("reconnect reconciles the final outage delta but preserves a newer healthy delta", () => {
  const fs = require("node:fs");
  const vm = require("node:vm");
  const source = fs.readFileSync(require.resolve("../src/renderer/app.js"), "utf8");
  const code = source.slice(source.indexOf("function invalidateDisconnectedStreams("), source.indexOf("async function refreshHistory("));
  for (const healthyDelta of [false, true]) {
    const stream = { active: true, activity: { kind: "writing" }, text: "last outage delta" };
    const context = {
      state: { selectedSessionId: "selected", liveStreamsBySession: new Map([["selected", stream]]), liveSessionRevisions: new Map([["selected", 2]]), runningSessionIds: new Set(["selected"]), historyRequestSequence: 0 },
      invalidateSelectedHistoryVersion() {}, selectedLiveStreamIsActive: () => stream.active, setActivity() {},
    };
    vm.createContext(context);
    vm.runInContext(code, context);
    context.invalidateDisconnectedStreams(new Map([["selected", 1]]));
    assert.equal(stream.active, true);
    assert.equal(stream.reconnectPending, true);
    const healthyRequest = new Map([["selected", 2]]);
    if (healthyDelta) context.state.liveSessionRevisions.set("selected", 3);
    context.reconcileReconnectedStream({ sessionId: "selected", running: false }, healthyRequest);
    assert.equal(stream.active, healthyDelta);
    assert.equal(stream.reconnectPending, false);
    assert.equal(stream.text, "last outage delta");
    if (healthyDelta) {
      context.reconcileReconnectedStream({ sessionId: "selected", running: false }, new Map([["selected", 3]]));
      assert.equal(stream.active, true, "ordinary healthy stale poll must not kill an unmarked stream");
    }
  }
});

test("HTTP send acceptance preserves a phase already advanced by the live stream", () => {
  const fs = require("node:fs");
  const vm = require("node:vm");
  const source = fs.readFileSync(require.resolve("../src/renderer/app.js"), "utf8");
  const code = source.slice(source.indexOf("function avatarModeForActivity("), source.indexOf("function renderNotifications("))
    + source.slice(source.indexOf("function showAcceptedSendState("), source.indexOf("async function sendCompactReply("));
  const avatars = [];
  const context = { state: { windowMode: "full", selectedSessionId: "selected", liveStreamsBySession: new Map(), dashboard: { sessions: [] } }, setActivity() {}, setAvatar: (...args) => avatars.push(args) };
  vm.createContext(context);
  vm.runInContext(code, context);
  context.showAcceptedSendState("selected");
  assert.equal(avatars.at(-1)[0], "waiting");
  context.state.liveStreamsBySession.set("selected", { active: true, activity: { kind: "writing", label: "Writing" } });
  context.showAcceptedSendState("selected");
  assert.deepEqual(avatars.at(-1), ["working", "Writing"]);
  context.showAcceptedSendState("selected", true);
  assert.deepEqual(avatars.at(-1), ["working", "Writing"]);
  const count = avatars.length;
  context.showAcceptedSendState("background");
  assert.equal(avatars.length, count);
});

test("turn-start wait and streamed content share the same compact and chat semantics", () => {
  const fs = require("node:fs");
  const vm = require("node:vm");
  const source = fs.readFileSync(require.resolve("../src/renderer/app.js"), "utf8");
  const code = source.slice(source.indexOf("function avatarModeForActivity("), source.indexOf("function renderNotifications("));
  const context = {};
  vm.createContext(context);
  vm.runInContext(code, context);
  const { visual, phase } = fixture();
  for (const [kind, compact, chat] of [["waiting", "waiting", "waiting"], ["working", "waiting", "waiting"], ["writing", "working", "writing"], ["tool", "working", "tool"]]) {
    visual.noteStream("selected", kind);
    assert.equal(phase(), chat);
    assert.equal(context.avatarModeForActivity({ kind }), compact);
  }
});

test("switching session during attachment preparation aborts without touching drafts", async () => {
  const fs = require("node:fs");
  const vm = require("node:vm");
  const source = fs.readFileSync(require.resolve("../src/renderer/app.js"), "utf8");
  const start = source.indexOf('$("#chatForm").addEventListener("submit", async (event) => {');
  const end = source.indexOf("  const submittedAttachments =", start);
  let submit;
  let finishPreparation;
  const input = { value: "Draft A" };
  const send = { disabled: false, classList: { add() {}, remove() {} } };
  const context = {
    composerSubmitInFlight: false, composerPasteFailurePending: false,
    composerPastePreparation: new Promise((resolve) => { finishPreparation = resolve; }),
    state: { selectedSessionId: "a", pendingSelection: null, pendingAttachments: [] },
    launchSendButton() {},
    $: (selector) => selector === "#chatForm" ? { addEventListener(_event, fn) { submit = fn; } } : selector === "#sendButton" ? send : input,
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end) + "return text; });", context);
  const pending = submit({ preventDefault() {} });
  context.state.selectedSessionId = "b";
  input.value = "Draft B";
  finishPreparation();
  assert.equal(await pending, undefined);
  assert.equal(input.value, "Draft B");
  assert.equal(send.disabled, false);
  assert.equal(context.composerSubmitInFlight, false);
});

test("real session selection cancels late paste even after A to B to A", async () => {
  const fs = require("node:fs");
  const vm = require("node:vm");
  const source = fs.readFileSync(require.resolve("../src/renderer/app.js"), "utf8");
  const pasteCode = source.slice(source.indexOf("function handleComposerPaste("), source.indexOf("async function loadCommands("));
  const selectStart = source.indexOf("async function selectSession(");
  const selectCode = source.slice(selectStart, source.indexOf("  const selectedGroup =", selectStart)) + "}";
  for (const returnToOrigin of [false, true]) {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const toasts = [];
    const context = {
      composerPastePreparation: Promise.resolve(), composerSelectionGeneration: 0, composerPasteFailurePending: false,
      state: { selectedSessionId: "a", pendingAttachments: [{ name: "already-reviewed.png" }] },
      window: { clipboardAttachments: { clipboardFiles: () => [1], prepareClipboard: () => gate }, widget: {} },
      addAttachments(result) { context.state.pendingAttachments.push(...result.attachments); },
      showToast: (text) => toasts.push(text), showTransientActivityError() { assert.fail("old-session error leaked"); },
      invalidateSelectedHistoryVersion() {}, clearComposerError() {}, stashComposerDraft() {}, restoreComposerDraft() {}, renderAttachments() {},
    };
    vm.createContext(context);
    vm.runInContext(pasteCode + selectCode, context);
    await context.selectSession("a", true);
    assert.equal(context.state.pendingAttachments.length, 1);
    const pending = context.handleComposerPaste({ clipboardData: {}, preventDefault() {} });
    await Promise.resolve();
    await context.selectSession("b", true);
    assert.equal(context.state.pendingAttachments.length, 0);
    if (returnToOrigin) await context.selectSession("a", true);
    release({ attachments: [{ name: "late-from-a.png" }] });
    await pending;
    assert.equal(context.state.pendingAttachments.length, 0);
    assert.ok(toasts.some((text) => text.includes("preparation canceled")));
  }
});

test("queued sends preserve writing and unchanged sync never rewrites DOM", () => {
  const { visual, body, phase } = fixture();
  visual.noteStream("selected", "writing");
  visual.noteSendStart("selected");
  assert.equal(phase(), "writing");
  assert.equal(visual.sync(body), false);
  visual.noteSendAccepted("selected");
  assert.equal(phase(), "writing");
});

test("completion survives stale running polls; stop and acknowledgment clear it", () => {
  const { visual, phase } = fixture();
  visual.noteCompletion("selected", "done");
  visual.notePoll("selected", { running: true, activityKind: "writing" });
  assert.equal(phase(), "done");
  visual.clearIf("selected", "done");
  assert.equal(phase(), "idle");
  visual.noteCompletion("selected", "error");
  assert.equal(phase(), "error");
  visual.noteStop("selected");
  assert.equal(phase(), "idle");
  visual.notePoll("selected", { running: false, activityKind: "writing" });
  assert.equal(phase(), "idle");
});

test("new turn replaces old outcome and historical session state is bounded", () => {
  const { visual, phase } = fixture();
  visual.noteCompletion("selected", "error");
  visual.noteSendStart("selected");
  assert.equal(phase(), "waiting");
  for (let i = 0; i < 250; i++) visual.noteStream(`session-${i}`, "tool");
  assert.equal(visual.phaseFor("session-0"), "idle");
  assert.equal(visual.phaseFor("session-249"), "tool");
});

test("a genuinely newer polled turn replaces completion, a stale turn does not", () => {
  const { visual, phase } = fixture();
  visual.noteCompletion("selected", "done");
  visual.notePoll("selected", { running: true, runningSince: Date.now() - 10000, activityKind: "writing" });
  assert.equal(phase(), "done");
  visual.notePoll("selected", { running: true, runningSince: Date.now() + 1, activityKind: "thinking" });
  assert.equal(phase(), "thinking");
});

test("dashboard reconciliation uses active stream phase over stale activity", () => {
  const fs = require("node:fs");
  const vm = require("node:vm");
  const source = fs.readFileSync(require.resolve("../src/renderer/app.js"), "utf8");
  const start = source.indexOf("    const selectedStream = state.liveStreamsBySession.get(state.selectedSessionId);");
  const code = source.slice(start, source.indexOf("    syncRunningControls(selectedRunning);", start));
  const visual = createChatVisualState();
  const body = { dataset: {} };
  visual.select("selected");
  visual.noteStream("selected", "writing");
  const context = {
    state: { selectedSessionId: "selected", liveStreamsBySession: new Map([["selected", { active: true, activity: { kind: "writing" } }]]) },
    chatVisual: visual, dashboard: { harness: true }, selectedRunning: true, selectedSession: { activity: { kind: "working" } }, commandFeedback: null,
    syncChatVisualState: () => visual.sync(body),
  };
  vm.createContext(context);
  vm.runInContext(code, context);
  assert.equal(body.dataset.chatState, "writing");
  context.state.liveStreamsBySession.get("selected").activity = null;
  vm.runInContext(`{${code}}`, context);
  assert.equal(body.dataset.chatState, "waiting");
});

test("background opacity clamps and updates only its independent CSS variable", () => {
  const fs = require("node:fs");
  const vm = require("node:vm");
  const source = fs.readFileSync(require.resolve("../src/renderer/app.js"), "utf8");
  const fn = source.slice(source.indexOf("function applyBackgroundOpacity("), source.indexOf("function applyShowThinking("));
  const controls = { "#backgroundOpacityRange": {}, "#backgroundOpacityValue": {} };
  const writes = [];
  const context = { $: (id) => controls[id], document: { documentElement: { style: { setProperty: (...args) => writes.push(args) } } } };
  vm.createContext(context);
  vm.runInContext(fn, context);
  assert.equal(context.applyBackgroundOpacity(2), 1);
  assert.equal(context.applyBackgroundOpacity(-1), 0);
  assert.equal(context.applyBackgroundOpacity(undefined), 0.9);
  assert.equal(controls["#backgroundOpacityValue"].textContent, "90%");
  assert.ok(writes.every(([key]) => key === "--panel-background-opacity"));
});

test("unchanged session timer and background count do not mutate DOM", () => {
  const fs = require("node:fs");
  const vm = require("node:vm");
  const source = fs.readFileSync(require.resolve("../src/renderer/app.js"), "utf8");
  const countFn = source.slice(source.indexOf("function applyBackgroundTaskCount("), source.indexOf("function contextPressure("));
  const timeFn = source.slice(source.indexOf("function applySessionTime("), source.indexOf("function refreshSessionTimers("));
  const context = { sessionAgentState: () => "idle", formatWorkDuration: (ms) => String(ms) };
  vm.createContext(context);
  vm.runInContext(countFn + timeFn, context);
  let writes = 0;
  const track = (object) => new Proxy(object, { set(target, key, value) { writes++; target[key] = value; return true; } });
  const classes = new Set();
  const value = track({ textContent: "" });
  const attrs = {};
  const node = track({
    textContent: "", title: "", dataset: track({}), querySelector: () => value,
    classList: { contains: (key) => classes.has(key), toggle(key, on) { writes++; if (on) classes.add(key); else classes.delete(key); } },
    getAttribute: (key) => attrs[key], setAttribute: (key, value) => { writes++; attrs[key] = value; },
  });
  context.applyBackgroundTaskCount(node, 2);
  const before = writes;
  context.applyBackgroundTaskCount(node, 2);
  assert.equal(writes, before);
  context.applySessionTime(node, { lastRunMs: 2000 });
  const timerBefore = writes;
  context.applySessionTime(node, { lastRunMs: 2000 });
  assert.equal(writes, timerBefore);
});
