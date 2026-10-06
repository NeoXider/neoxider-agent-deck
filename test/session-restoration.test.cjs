const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const renderer = fs.readFileSync(path.join(__dirname, "../src/renderer/app.js"), "utf8");
const selectionBlock = renderer.slice(renderer.indexOf("    const dashboardVisibleSessions"), renderer.indexOf("    syncGameBarSelection();", renderer.indexOf("    const dashboardVisibleSessions")));
const hydrateBlock = renderer.slice(renderer.indexOf("    if (state.sessionSelectionGeneration === selectionGeneration"), renderer.indexOf("    syncPressed", renderer.indexOf("    if (state.sessionSelectionGeneration === selectionGeneration")));
const rememberFunction = renderer.slice(renderer.indexOf("function rememberSelectedSession()"), renderer.indexOf("async function selectSession("));

function harness() {
  const saved = [];
  const state = { selectedSessionId: null, lastSelectedSessionId: null, persistedSessionId: null, sessionSelectionGeneration: 0 };
  const context = vm.createContext({ state, window: { widget: { setLastSelectedSession: async (id) => saved.push(id) } }, invalidateSelectedHistoryVersion() {} });
  vm.runInContext(rememberFunction, context);
  return {
    state, saved,
    hydrate(id, generation = 0) {
      context.preferences = { lastSelectedSessionId: id };
      context.selectionGeneration = generation;
      vm.runInContext(hydrateBlock, context);
    },
    poll(online, sessions, selectedAtRequest = state.selectedSessionId) {
      context.dashboard = { harness: online, sessions };
      context.visibleSessions = () => sessions;
      context.selectedAtRequest = selectedAtRequest;
      // A new lexical scope models each dashboard request.
      vm.runInContext(`{ ${selectionBlock} }`, context);
    },
  };
}

test("startup restores the last chat instead of another running session", () => {
  const h = harness();
  h.hydrate("saved");
  h.poll(true, [{ sessionId: "running", running: true }, { sessionId: "saved" }]);
  assert.equal(h.state.selectedSessionId, "saved");
  assert.deepEqual(h.saved, []);
  assert.match(renderer, /async function performRefresh\(\) \{\s*await state\.preferencesReadyPromise;/);
  assert.match(renderer, /state\.preferencesReadyPromise = hydratePreferences\(\);/);
});

test("offline startup and reconnect retain the saved chat until Harness returns", () => {
  const h = harness();
  h.hydrate("saved");
  for (let i = 0; i < 5; i++) h.poll(false, []);
  assert.equal(h.state.selectedSessionId, "saved");
  h.poll(true, [{ sessionId: "saved" }]);
  h.poll(false, []);
  h.poll(true, [{ sessionId: "saved" }]);
  assert.equal(h.state.selectedSessionId, "saved");
});

test("Harness switching or omitting a chat never replaces Deck's remembered choice", () => {
  const h = harness();
  h.hydrate("widget-chat");
  for (let i = 0; i < 10; i++) h.poll(true, [{ sessionId: "harness-chat", running: true }]);
  assert.equal(h.state.selectedSessionId, "widget-chat");
  assert.equal(h.state.lastSelectedSessionId, "widget-chat");
  assert.deepEqual(h.saved, []);
  h.poll(false, []);
  h.poll(true, [{ sessionId: "widget-chat" }, { sessionId: "harness-chat", running: true }]);
  assert.equal(h.state.selectedSessionId, "widget-chat");
});

test("late preferences and an in-flight poll cannot override a new user choice", () => {
  const h = harness();
  h.state.selectedSessionId = "new-choice";
  h.state.sessionSelectionGeneration++;
  h.hydrate("old-choice");
  h.poll(true, [{ sessionId: "old-choice" }], "old-choice");
  assert.equal(h.state.selectedSessionId, "new-choice");
  assert.deepEqual(h.saved, ["new-choice"]);
});

function compactRestoreHarness() {
  const opened = [];
  const state = {
    selectedSessionId: "last-widget-chat", lastSelectedSessionId: "last-widget-chat",
    compactNotification: { sessionId: "other-notification-chat" },
  };
  const context = vm.createContext({
    state, clearTimeout() {}, $(selector) { return { focus() {} }; },
    setWindowMode: async () => opened.push("full"),
    selectSession: async (id) => { state.selectedSessionId = id; opened.push(id); },
    setTab: () => opened.push("chat"), syncCompactStatus() {},
  });
  const start = renderer.indexOf("async function openCompactSession(");
  vm.runInContext(renderer.slice(start, renderer.indexOf("function openCompactReply(", start)), context);
  return { state, opened, restore: context.openCompactSession };
}

test("restoring the compact widget ignores other chats' notifications and retains the reading position", async () => {
  const h = compactRestoreHarness();
  await h.restore();
  assert.equal(h.state.selectedSessionId, "last-widget-chat");
  assert.deepEqual(h.opened, ["full", "chat"], "restoring the same chat must not reselect it and reset its scroll");
  const start = renderer.indexOf('$("#edgeMode").addEventListener("click"');
  const edgeClick = renderer.slice(start, renderer.indexOf("for (const target", start));
  assert.doesNotMatch(edgeClick, /compactPreviewEntry|openCompactSession|selectSession/);
  assert.match(edgeClick, /setWindowMode\("full"\)/);
});

test("explicitly selecting a notification or recent chat still switches to that chat", async () => {
  const h = compactRestoreHarness();
  await h.restore("explicit-chat");
  assert.equal(h.state.selectedSessionId, "explicit-chat");
  assert.deepEqual(h.opened, ["full", "explicit-chat"]);
});

test("an empty restored widget opens the composer without guessing another notification's chat", async () => {
  const h = compactRestoreHarness();
  h.state.selectedSessionId = null;
  h.state.lastSelectedSessionId = null;
  await h.restore();
  assert.equal(h.state.selectedSessionId, null);
  assert.deepEqual(h.opened, ["full", "chat"]);
});

test("a superseded backend revision is applied before matching-revision responses may omit messages", async () => {
  const pending = [];
  const requests = [];
  const state = {
    selectedSessionId: "chat", historyLoadedSessionId: "chat", historyLoadedRevision: "R1",
    historyRequestSequence: 0, historyLoadErrors: new Map(), liveStreamsBySession: new Map(), currentMessages: [{ text: "old R1" }],
  };
  const context = vm.createContext({
    state, chatVisual: null,
    window: { widget: { history(sessionId, options) {
      requests.push({ sessionId, ...options });
      return new Promise((resolve) => pending.push(resolve));
    } } },
    selectedSessionUpdatedAt: () => 2,
    commandFeedbackFor: () => null,
    setActivity() {}, modeFromMessages: () => null,
    renderMessages(messages) { state.currentMessages = messages; },
    paintLiveAssistant() {}, renderHistoryLoadError() {},
    showError(error) { throw error; },
  });
  const start = renderer.indexOf("async function refreshHistory({");
  const end = renderer.indexOf("function refreshHistoryAfterLiveMessage(", start);
  vm.runInContext(renderer.slice(start, end), context);
  const previewStart = renderer.indexOf("function latestAssistantPreview(");
  const previewEnd = renderer.indexOf("function selectedLiveStreamIsActive(", previewStart);
  vm.runInContext(renderer.slice(previewStart, previewEnd), context);
  const olderRequest = context.refreshHistory();
  const newerRequest = context.refreshHistory({ priority: true });
  pending[0]({ revision: "R2", unchanged: false, messages: [{ text: "new R2" }] });
  assert.equal(await olderRequest, "superseded");
  // The worker now has R2 cached, but the renderer still has R1. Backend unchanged
  // is therefore insufficient even though the response contains the full R2 text.
  pending[1]({ revision: "R2", unchanged: true, messages: [{ text: "new R2" }] });
  assert.equal(await newerRequest, "applied");
  assert.equal(state.currentMessages[0].text, "new R2");
  assert.equal(state.historyLoadedRevision, "R2");
  const matchingRequest = context.refreshHistory();
  pending[2]({ revision: "R2", unchanged: true, messages: null });
  assert.equal(await matchingRequest, "unchanged");
  assert.equal(state.currentMessages[0].text, "new R2");
  assert.deepEqual(requests.map((request) => request.revision), ["R1", "R1", "R2"]);
});
