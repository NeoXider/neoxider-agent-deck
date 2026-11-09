const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { createContextPressure, usageOf } = require("../src/context-pressure.cjs");
const { HarnessApi } = require("../src/harness-api.cjs");

const row = (sessionId, values = {}) => ({ sessionId, projections: { values } });
const pressure = (value) => value?.projections?.values?.contextPressure;

test("a snapshot's pressure is put back on a row that lacks it", () => {
  const tracker = createContextPressure();
  tracker.seed("a", { values: { contextPressure: { pressureTokens: 100, projectedTokens: 120, contextWindow: 1000 } } });
  assert.deepEqual(pressure(tracker.applyTo(row("a", { title: "x" }))), { pressureTokens: 100, projectedTokens: 120, contextWindow: 1000 });
  assert.equal(tracker.applyTo(row("a", { title: "x" })).projections.values.title, "x");
  const stranger = row("other");
  assert.equal(tracker.applyTo(stranger), stranger, "unknown chats are left alone");
});

test("a row the Harness did fill keeps the Harness's figure", () => {
  const tracker = createContextPressure();
  tracker.seed("a", { values: { contextPressure: { projectedTokens: 1, contextWindow: 10 } } });
  const own = row("a", { contextPressure: { projectedTokens: 7, contextWindow: 70 } });
  assert.equal(tracker.applyTo(own), own);
});

test("live events move the figure: a reply's usage and a request's window", () => {
  const tracker = createContextPressure();
  tracker.observe("a", { type: "request/context", data: { contextWindow: 200000 } });
  tracker.observe("a", { type: "assistant/message", data: { usage: { inputTokens: 1000, cacheReadTokens: 16000, cacheWriteTokens: 380 } } });
  assert.deepEqual(pressure(tracker.applyTo(row("a"))), { contextWindow: 200000, pressureTokens: 17380, projectedTokens: 17380 });
  tracker.observe("a", { type: "assistant/message", data: { usage: { inputTokens: 500 } } });
  assert.equal(pressure(tracker.applyTo(row("a"))).projectedTokens, 500);
  tracker.observe("a", { type: "assistant/message", data: {} });
  tracker.observe("a", { type: "turn/start", data: {} });
  assert.equal(pressure(tracker.applyTo(row("a"))).projectedTokens, 500, "events that carry no figure change nothing");
});

test("a history snapshot read through HarnessApi seeds the chat's pressure", async () => {
  const api = new HarnessApi("http://127.0.0.1:1", async () => { throw new Error("offline"); }, { historyWorker: false });
  api.remoteChannelFirstFrame = async () => ({ cursor: 3, records: [], hasMore: false, projections: { values: { contextPressure: { pressureTokens: 5, projectedTokens: 6, contextWindow: 50 } } } });
  await api.fetchHistoryPage({}, "s1", { maxMessages: 1 });
  assert.equal(pressure(api.contextPressure.applyTo(row("s1"))).contextWindow, 50);
  api.contextPressure.observe("s1", { type: "assistant/message", data: { usage: { inputTokens: 9 } } });
  assert.equal(pressure(api.contextPressure.applyTo(row("s1"))).projectedTokens, 9);
});

test("the table is bounded, oldest chat first", () => {
  const tracker = createContextPressure();
  for (let i = 0; i < 450; i += 1) tracker.seed(`s${i}`, { values: { contextPressure: { projectedTokens: i, contextWindow: 10 } } });
  assert.equal(pressure(tracker.applyTo(row("s0"))), undefined);
  assert.equal(pressure(tracker.applyTo(row("s449"))).projectedTokens, 449);
});

test("a request with an unknown window or a reply without usage never blanks the figure", () => {
  const tracker = createContextPressure();
  tracker.seed("a", { values: { contextPressure: { pressureTokens: 900, projectedTokens: 950, contextWindow: 2000 } } });
  // DSH drops the window when a request names a model whose window it does not know.
  tracker.observe("a", { type: "request/context", data: {} });
  tracker.seed("a", { values: { contextPressure: { pressureTokens: 900, projectedTokens: 950 } } });
  assert.equal(pressure(tracker.applyTo(row("a"))).contextWindow, 2000);
  // A stopped or failed attempt reports no tokens; DSH then counts the context as empty.
  tracker.observe("a", { type: "assistant/message", data: { usage: { inputTokens: 0, outputTokens: 0 } } });
  tracker.seed("a", { values: { contextPressure: { pressureTokens: 0, projectedTokens: 0, contextWindow: 2000 } } });
  tracker.seed("a", { values: { contextPressure: {} } });
  assert.deepEqual(pressure(tracker.applyTo(row("a"))), { pressureTokens: 900, projectedTokens: 950, contextWindow: 2000 });
  // A real smaller figure (a compaction) still replaces it.
  tracker.seed("a", { values: { contextPressure: { pressureTokens: 900, projectedTokens: 300, contextWindow: 2000 } } });
  assert.equal(pressure(tracker.applyTo(row("a"))).projectedTokens, 300);
});

test("usage is read from a reply's stream and from a failed attempt, as DSH reads it", () => {
  const tracker = createContextPressure();
  const stream = [
    { type: "text-chunks", texts: ["hi"] },
    { type: "chunk", chunk: { type: "usage", usage: { inputTokens: 10 } } },
    { type: "chunk", chunk: { type: "usage", usage: { inputTokens: 700, cacheReadTokens: 50 } } },
    { type: "chunk", chunk: { type: "finish" } },
  ];
  assert.deepEqual(usageOf({ type: "assistant/message", data: { stream } }), { inputTokens: 700, cacheReadTokens: 50 });
  assert.equal(usageOf({ type: "tool/result", data: { stream } }), null);
  tracker.observe("a", { type: "request/context", data: { contextWindow: 4000 } });
  tracker.observe("a", { type: "assistant/message", data: { stream } });
  assert.equal(pressure(tracker.applyTo(row("a"))).projectedTokens, 750);
  tracker.observe("a", { type: "assistant/attempt", data: { stream: [{ type: "chunk", chunk: { type: "usage", usage: { inputTokens: 800 } } }] } });
  assert.equal(pressure(tracker.applyTo(row("a"))).projectedTokens, 800);
});

test("a row the Harness filled only in part is completed from the table", () => {
  const tracker = createContextPressure();
  tracker.seed("a", { values: { contextPressure: { pressureTokens: 40, projectedTokens: 44, contextWindow: 500 } } });
  assert.deepEqual(pressure(tracker.applyTo(row("a", { contextPressure: { projectedTokens: 60 } }))), { pressureTokens: 60, projectedTokens: 60, contextWindow: 500 });
  assert.deepEqual(pressure(tracker.applyTo(row("a", { contextPressure: { contextWindow: 800 } }))), { pressureTokens: 40, projectedTokens: 44, contextWindow: 800 });
});

test("the table survives a restart, numbers only", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deck-pressure-"));
  const file = path.join(dir, "context-pressure.json");
  try {
    const first = createContextPressure({ file: () => file, saveDelayMs: 5 });
    first.seed("a", { values: { contextPressure: { pressureTokens: 100, projectedTokens: 120, contextWindow: 1000, text: "never stored" } } });
    first.observe("b", { type: "request/context", data: { contextWindow: 64000 } });
    for (let i = 0; i < 100 && !fs.existsSync(file); i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    const stored = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.deepEqual(stored.sessions, { a: { contextWindow: 1000, pressureTokens: 100, projectedTokens: 120 }, b: { contextWindow: 64000 } });
    const second = createContextPressure({ file });
    assert.deepEqual(pressure(second.applyTo(row("a"))), { contextWindow: 1000, pressureTokens: 100, projectedTokens: 120 });
    assert.equal(pressure(second.applyTo(row("b"))).contextWindow, 64000);
    fs.writeFileSync(file, "{ not json");
    assert.equal(pressure(createContextPressure({ file }).applyTo(row("a"))), undefined, "an unreadable table starts empty");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
