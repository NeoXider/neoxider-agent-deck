const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "../src/renderer/app.js"), "utf8");
function declaration(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  let depth = 0;
  for (let index = source.indexOf("{", start); index < source.length; index++) {
    if (source[index] === "{") depth++;
    if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unclosed ${name}`);
}

function domNode(tag = "div") {
  return {
    tag,
    className: "",
    dataset: {},
    style: {},
    textContent: "",
    children: [],
    setAttribute() {},
    append(...nodes) { this.children.push(...nodes); },
  };
}

function harness() {
  let builds = 0;
  const root = {
    scrollTop: 0, scrollHeight: 1000, clientHeight: 500, dataset: {},
    children: [],
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const state = {
    selectedSessionId: "large",
    currentMessages: [],
    transcriptCache: new Map(),
    messagesStickToBottom: true,
    unseenMessages: 0,
    historySignature: "",
    messageScrollPin: null,
    messageMarkFlashIndex: null,
  };
  const context = vm.createContext({
    state, root,
    document: { createElement: (tag) => domNode(tag), querySelector: () => null },
    requestAnimationFrame: (callback) => { callback(); return 0; },
    $: () => root,
    $$: () => [],
    HISTORY_PREVIEW_BYTES_BUDGET: 1024,
    liveAssistantSnapshot: () => null, steeringPromptsFor: () => [], transcriptAwaitingHistory: () => false,
    liveDuplicatesFinalAnswer: () => false,
    paintLiveAssistant: () => false, openToolKeys: () => new Set(), captureMessageSelection: () => null,
    activeMessageScrollPin: () => null,
    liveBubbleText: new WeakMap(),
    createMessageBubble: (message) => { builds++; return { message, dataset: {}, className: "bubble" }; },
    createActivityRun: (messages) => { builds++; return { messages, dataset: {}, className: "tool-group" }; },
    createSteeringBubble: () => ({ dataset: {} }),
    createLiveBubble: () => ({ dataset: {} }),
    transcriptSkeleton: () => ({ dataset: {} }),
    transcriptEmptyState: () => ({ dataset: {} }),
    createGoalResultCard: () => null, isMissingModelError: () => false,
    markTranscriptEntry: () => {}, reconcileChildren: (_root, nodes) => { _root.nodes = nodes; },
    syncLiveBubbleContent: () => false, restoreOpenToolKeys: () => {}, applyMessageScrollPin: () => false,
    paintMessageMarkFlash: () => {}, restoreMessageSelection: () => {}, syncActivityCard: () => {},
    updateScrollLatestButton: () => {}, renderMessageMarks: () => {}, syncMessageMagnet: () => {},
  });
  vm.runInContext(`
    const TRANSCRIPT_WINDOW_INITIAL = 80;
    const TRANSCRIPT_WINDOW_GROW = 80;
    const TRANSCRIPT_WINDOW_MAX = 320;
    const TRANSCRIPT_TOP_LOAD_PX = 700;
    const TRANSCRIPT_ROW_ESTIMATE_PX = 64;
    let transcriptViewSessionId;
    let transcriptViewStart = 0;
    let transcriptViewEnd = 0;
    let transcriptViewTotal = 0;
    let transcriptAverageRowHeight = TRANSCRIPT_ROW_ESTIMATE_PX;
    let transcriptGrowing = false;
    let transcriptSilentGrow = false;
    let transcriptPreviewCache = { source: [], messages: [] };
    ${["transcriptWindow", "transcriptAtLatest", "transcriptHiddenNewerCount", "jumpToLatestTranscript", "growTranscriptWindowUp", "maybeGrowTranscriptWindow", "transcriptSpacer", "transcriptWindowEdge", "rememberTranscriptRowHeights", "visibleMessagePreviews", "boundedMessagePreviews", "messagePreviewBytes", "messageSignature", "messageBlockKey", "transcriptCache", "commandResultName", "renderMessages", "releaseMessageScrollPin"].map(declaration).join("\n")}
  `, context);
  return { context, root, state, builds: () => builds, run: code => vm.runInContext(code, context) };
}

test("100,000-message histories materialize a bounded window and reuse unchanged nodes", () => {
  const app = harness();
  app.state.currentMessages = Array.from({ length: 100000 }, (_, seq) => ({ role: seq % 2 ? "assistant" : "user", text: `Message ${seq}`, seq: seq + 1 }));
  // Off-window message data must never be inspected or serialized by rendering.
  Object.defineProperty(app.state.currentMessages[0], "text", { get() { throw new Error("Read off-window text"); } });
  app.run("renderMessages(state.currentMessages)");
  assert.equal(app.builds(), 80);
  // 80 bubbles plus the top spacer and the scroll-up hint; no page buttons.
  assert.equal(app.root.nodes.length, 82);
  assert.equal(app.root.nodes[2].message.seq, 99921);
  const originalNodes = app.root.nodes.slice();
  app.run("renderMessages(state.currentMessages)");
  assert.equal(app.builds(), 80);
  assert.deepEqual(app.root.nodes, originalNodes);
  app.state.currentMessages.push({ role: "assistant", seq: 100001, text: "Newest" });
  app.run("renderMessages(state.currentMessages)");
  assert.equal(app.builds(), 81);
  assert.equal(app.root.nodes.length, 82);
  assert.equal(app.state.transcriptCache.size, 82);
});

test("scrolling up grows the window, unloads distant rows, and jumps back to latest", () => {
  const app = harness();
  app.state.currentMessages = Array.from({ length: 500 }, (_, seq) => ({ role: "user", text: `${seq}`, seq: seq + 1 }));
  app.run("renderMessages(state.currentMessages)");
  assert.equal(app.root.nodes.filter((node) => node.message).length, 80);
  for (let grown = 0; grown < 5; grown += 1) app.run("growTranscriptWindowUp()");
  assert.equal(app.run("transcriptViewStart"), 20);
  // 480 rows would exceed the cap, so the newest 160 unload into the bottom
  // spacer instead of accumulating DOM.
  assert.equal(app.run("transcriptViewEnd"), 340);
  assert.equal(app.run("transcriptHiddenNewerCount()"), 160);
  assert.equal(app.root.nodes.filter((node) => node.message).length, 320);
  assert.ok(app.root.nodes.length <= 324);
  app.run("jumpToLatestTranscript()");
  assert.equal(app.run("transcriptViewStart"), 420);
  assert.equal(app.run("transcriptViewEnd"), 500);
  assert.equal(app.run("transcriptHiddenNewerCount()"), 0);
  assert.equal(app.root.nodes.filter((node) => node.message).length, 80);
});

test("tool runs are never cut by the window boundary", () => {
  const app = harness();
  app.state.currentMessages = [
    { role: "user", text: "first", seq: 1 },
    { role: "tool", callId: "a", name: "read", seq: 2 },
    { role: "tool", callId: "b", name: "write", seq: 3 },
    { role: "tool", callId: "c", name: "run", seq: 4 },
    ...Array.from({ length: 79 }, (_, offset) => ({ role: "user", text: `${offset}`, seq: offset + 5 })),
  ];
  // 83 messages open a window at index 3, right inside the tool run.
  app.run("renderMessages(state.currentMessages)");
  assert.equal(app.run("transcriptViewStart"), 1, "the window reaches back to the run start");
  const groups = app.root.nodes.filter((node) => node.messages);
  assert.equal(groups.length, 1, "the run split by the initial window stays one card");
  assert.equal(groups[0].messages.length, 3);
});

test("a long streaming answer continues updating past the markdown limit with bounded DOM text", () => {
  const bubble = { dataset: { formatted: "1" }, classList: { add() {} }, append() {} };
  const context = vm.createContext({ bubble, liveBubbleText: new WeakMap(), LIVE_MARKDOWN_MAX_CHARS: 60000, liveCaret: () => ({}), scheduleLiveMarkdown: () => {} });
  vm.runInContext(declaration("paintLiveText"), context);
  vm.runInContext('paintLiveText(bubble, "x".repeat(100000) + "still arriving")', context);
  assert.ok(bubble.textContent.endsWith("still arriving"));
  assert.ok(bubble.textContent.length < 60100);
  assert.equal(bubble.dataset.formatted, undefined);
});

function priorityHarness() {
  const calls = [];
  const state = { selectedSessionId: "a", historyPriorityPromise: null, historyPrioritySessionId: null, historyPriorityRequestedSessionId: null };
  const context = vm.createContext({ state, refreshHistory(options) {
    return new Promise((resolve, reject) => calls.push({ sessionId: state.selectedSessionId, options, resolve, reject }));
  } });
  vm.runInContext(declaration("refreshHistoryAfterLiveMessage"), context);
  return { state, calls, request: id => context.refreshHistoryAfterLiveMessage(id), tick: () => new Promise(resolve => setImmediate(resolve)) };
}

test("100 live events during a held history load coalesce into one trailing request", async () => {
  const app = priorityHarness();
  const first = app.request("a");
  await app.tick();
  assert.equal(app.calls.length, 1);
  const burst = Array.from({ length: 100 }, () => app.request("a"));
  assert.ok(burst.every(promise => promise === first), "callers share the complete drain");
  assert.equal(app.state.historyPrioritySessionId, "a");
  app.calls[0].resolve("old snapshot");
  await app.tick();
  assert.equal(app.calls.length, 2);
  assert.equal(app.state.historyPrioritySessionId, "a", "polling stays deferred until latest load completes");
  app.calls[1].resolve("latest snapshot");
  assert.deepEqual(await Promise.all([first, ...burst]), Array(101).fill("latest snapshot"));
  assert.equal(app.calls.length, 2);
  assert.equal(app.state.historyPriorityPromise, null);
  assert.equal(app.state.historyPrioritySessionId, null);
  const later = app.request("a");
  await app.tick();
  assert.equal(app.calls.length, 3, "the next independent burst still refreshes");
  app.calls[2].resolve("next snapshot");
  await later;
});

test("history coalescing follows a newly selected session and ignores old-session events", async () => {
  const app = priorityHarness();
  const pending = app.request("a");
  await app.tick();
  app.request("a");
  app.state.selectedSessionId = "b";
  const newer = app.request("b");
  assert.equal(await app.request("a"), "selection-changed");
  app.calls[0].resolve("superseded");
  await app.tick();
  assert.equal(app.calls.length, 2);
  assert.equal(app.calls[1].sessionId, "b");
  assert.equal(app.state.historyPrioritySessionId, "b");
  app.request("b");
  app.calls[1].resolve("b earlier");
  await app.tick();
  assert.equal(app.calls.length, 3, "events during the trailing request are eventually loaded");
  app.calls[2].resolve("b latest");
  assert.deepEqual(await Promise.all([pending, newer]), ["b latest", "b latest"]);
  assert.equal(app.state.historyPriorityPromise, null);
});

test("an abandoned queued session is skipped and an unexpected rejection releases priority", async () => {
  const app = priorityHarness();
  const pending = app.request("a");
  await app.tick();
  app.request("a");
  app.state.selectedSessionId = "b";
  app.calls[0].resolve("superseded");
  await pending;
  assert.equal(app.calls.length, 1);
  const failed = app.request("b");
  const rejection = assert.rejects(failed, /transport failed/);
  await app.tick();
  app.calls[1].reject(new Error("transport failed"));
  await rejection;
  assert.equal(app.state.historyPriorityPromise, null);
  assert.equal(app.state.historyPrioritySessionId, null);
});
