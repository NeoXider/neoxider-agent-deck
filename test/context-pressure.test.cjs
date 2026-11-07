const test = require("node:test");
const assert = require("node:assert/strict");
const { createContextPressure } = require("../src/context-pressure.cjs");
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
