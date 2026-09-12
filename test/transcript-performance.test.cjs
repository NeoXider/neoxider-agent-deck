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

function harness() {
  let builds = 0;
  const root = { scrollTop: 0, scrollHeight: 1000, clientHeight: 500, dataset: {}, querySelector: () => null };
  const state = { selectedSessionId: "large", currentMessages: [], transcriptCache: new Map(), messagesStickToBottom: true };
  const context = vm.createContext({
    state, root, $: () => root,
    HISTORY_PREVIEW_BYTES_BUDGET: 1024,
    liveAssistantSnapshot: () => null, steeringPromptsFor: () => [], transcriptAwaitingHistory: () => false,
    paintLiveAssistant: () => false, openToolKeys: () => new Set(), captureMessageSelection: () => null,
    liveBubbleText: new WeakMap(),
    createMessageBubble: message => { builds++; return { message }; },
    createActivityRun: messages => { builds++; return { messages }; },
    createHistoryNavigation: page => ({ page }),
    createGoalResultCard: () => null, isMissingModelError: () => false,
    markTranscriptEntry: () => {}, reconcileChildren: (_root, nodes) => { root.nodes = nodes; },
    syncLiveBubbleContent: () => false, restoreOpenToolKeys: () => {}, applyMessageScrollPin: () => false,
    paintMessageMarkFlash: () => {}, restoreMessageSelection: () => {}, syncActivityCard: () => {},
    updateScrollLatestButton: () => {}, renderMessageMarks: () => {}, syncMessageMagnet: () => {},
  });
  vm.runInContext(`
    const TRANSCRIPT_PAGE_SIZE = 80;
    let transcriptPageSessionId;
    let transcriptPageEnd = null;
    let transcriptPreviewCache = { source: [], messages: [] };
    ${["transcriptPage", "visibleMessagePreviews", "boundedMessagePreviews", "messagePreviewBytes", "messageSignature", "messageBlockKey", "transcriptCache", "commandResultName", "renderMessages"].map(declaration).join("\n")}
  `, context);
  return { context, root, state, builds: () => builds, run: code => vm.runInContext(code, context) };
}

test("100,000-message histories build at most 80 messages and reuse unchanged nodes", () => {
  const app = harness();
  app.state.currentMessages = Array.from({ length: 100000 }, (_, seq) => ({ role: seq % 2 ? "assistant" : "user", text: `Message ${seq}`, seq: seq + 1 }));
  // Off-page message data must never be inspected or serialized by rendering.
  Object.defineProperty(app.state.currentMessages[0], "text", { get() { throw new Error("Read off-page text"); } });
  app.run("renderMessages(state.currentMessages)");
  assert.equal(app.builds(), 80);
  assert.equal(app.root.nodes.length, 81);
  assert.equal(app.root.nodes[1].message.seq, 99921);
  const originalNodes = app.root.nodes.slice();
  app.run("renderMessages(state.currentMessages)");
  assert.equal(app.builds(), 80);
  assert.deepEqual(app.root.nodes, originalNodes);
  app.state.currentMessages.push({ role: "assistant", seq: 100001, text: "Newest" });
  app.run("renderMessages(state.currentMessages)");
  assert.equal(app.builds(), 81);
  assert.equal(app.root.nodes.length, 81);
  assert.equal(app.state.transcriptCache.size, 81);
});

test("older pages remain bounded, retain position on arrivals, and reset for another session", () => {
  const app = harness();
  app.state.currentMessages = Array.from({ length: 241 }, (_, seq) => ({ role: "user", text: `${seq}`, seq: seq + 1 }));
  const seen = [];
  for (const end of [241, 161, 81, 1]) {
    app.run(`transcriptPageEnd = ${end}; renderMessages(state.currentMessages)`);
    seen.push(...app.root.nodes.filter(node => node.message).map(node => node.message.seq));
    assert.ok(app.root.nodes.length <= 81);
    assert.ok(app.state.transcriptCache.size <= 81);
  }
  assert.equal(new Set(seen).size, 241, "every message is reachable without gaps");
  app.state.currentMessages.push({ role: "user", seq: 242, text: "Arrived" });
  app.run("renderMessages(state.currentMessages)");
  assert.equal(app.root.nodes.at(-1).message.seq, 1, "arrivals do not replace the page being read");
  app.state.selectedSessionId = "another";
  app.run("renderMessages(state.currentMessages)");
  assert.equal(app.root.nodes.at(-1).message.seq, 242);
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
