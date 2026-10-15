const test = require("node:test");
const assert = require("node:assert/strict");

const { createQuestionRelay, normalizeAnswer } = require("../src/question-relay.cjs");

function fakeTransport() {
  const calls = [];
  const channels = [];
  return {
    calls,
    channels,
    openChannel({ endpoint, args, onFrame }) {
      let close;
      const closed = new Promise((resolve) => { close = resolve; });
      const channel = { endpoint, args, onFrame, closedByClient: false, close() { this.closedByClient = true; close(); }, end: () => close(), closed };
      channels.push(channel);
      return Promise.resolve(channel);
    },
    async call(endpoint, args, timeoutMs) {
      calls.push({ endpoint, args, timeoutMs });
      return undefined;
    },
  };
}

function relayWith(transport, extra = {}) {
  const published = [];
  const timers = [];
  const relay = createQuestionRelay({
    getTransport: async () => transport,
    publish: (value) => published.push(value),
    now: () => 1000,
    setTimeoutFn: (fn, delay) => { const timer = { fn, delay }; timers.push(timer); return timer; },
    clearTimeoutFn: (timer) => { timer.cleared = true; },
    ...extra,
  });
  return { relay, published, timers };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));
const question = {
  type: "waterfall",
  event: "user-questions/request",
  eventId: "event-1",
  agentId: "session-1",
  request: { questions: [{ id: "service", header: "Service", question: "Which service do you mean?", options: [{ label: "Pay (Recommended)", description: "The billing one" }, { label: "Auth" }] }] },
};

test("a question forwarded on the event stream is held and answered through $events/result", async () => {
  const transport = fakeTransport();
  const { relay, published } = relayWith(transport);
  relay.start();
  await tick();
  const [channel] = transport.channels;
  assert.equal(channel.endpoint, "$events");
  assert.deepEqual(channel.args, {});
  channel.onFrame({ type: "ready", clientId: "client-1", host: { home: "C:/Users/me" } });
  channel.onFrame(question);
  assert.equal(relay.list().length, 1);
  assert.equal(relay.list()[0].sessionId, "session-1");
  assert.equal(relay.list()[0].questions[0].options[0].description, "The billing one");
  assert.equal(published.at(-1).length, 1);

  await relay.answer("event-1", { answers: [{ id: "service", selected: ["Pay (Recommended)"], custom: "  " }] });
  assert.deepEqual(transport.calls, [{
    endpoint: "$events/result",
    args: { clientId: "client-1", eventId: "event-1", outcome: { kind: "result", value: { answers: [{ id: "service", selected: ["Pay (Recommended)"] }] } } },
    timeoutMs: 10000,
  }]);
  assert.deepEqual(relay.list(), []);
  assert.deepEqual(published.at(-1), []);
});

test("an answer given elsewhere cancels the card, and approvals are never answered", async () => {
  const transport = fakeTransport();
  const { relay } = relayWith(transport);
  relay.start();
  await tick();
  const [channel] = transport.channels;
  channel.onFrame({ type: "ready", clientId: "client-1" });
  channel.onFrame({ type: "waterfall", event: "approval/request", eventId: "approval-1", agentId: "session-1", request: { tool: "shell" } });
  assert.deepEqual(relay.list(), [], "approvals are not questions");
  assert.deepEqual(transport.calls, [], "no next is ever sent for an approval");
  channel.onFrame(question);
  channel.onFrame({ type: "cancel", eventId: "event-1" });
  assert.deepEqual(relay.list(), []);
  await assert.rejects(() => relay.answer("event-1", { answers: [] }), /no longer waiting/);
});

test("a closed stream drops what it held and reconnects with backoff", async () => {
  const transport = fakeTransport();
  const { relay, timers } = relayWith(transport, { retryDelays: [5, 50] });
  relay.start();
  await tick();
  transport.channels[0].onFrame({ type: "ready", clientId: "client-1" });
  transport.channels[0].onFrame(question);
  transport.channels[0].end();
  await tick();
  assert.deepEqual(relay.list(), []);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 5);
  timers[0].fn();
  await tick();
  assert.equal(transport.channels.length, 2, "a new stream was opened");
  relay.stop();
  assert.equal(transport.channels[1].closedByClient, true);
});

test("an offline or legacy Harness is retried instead of throwing", async () => {
  const { relay, timers } = relayWith(null, { getTransport: async () => null });
  relay.start();
  await tick();
  assert.equal(timers.length, 1);
  relay.kick();
  assert.equal(timers[0].cleared, true);
  relay.stop();
});

test("answers must name each question exactly once", () => {
  const entry = { questions: [{ id: "a" }, { id: "b" }] };
  assert.throws(() => normalizeAnswer(entry, { answers: [{ id: "a", selected: [] }] }), /exactly once/);
  assert.throws(() => normalizeAnswer(entry, { answers: [{ id: "a", selected: [] }, { id: "a", selected: [] }] }), /exactly once/);
  assert.throws(() => normalizeAnswer(entry, {}), /one entry per question/);
  assert.deepEqual(normalizeAnswer(entry, { answers: [{ id: "b", selected: [], custom: " later " }, { id: "a", selected: ["x", 7] }] }), {
    answers: [{ id: "b", selected: [], custom: "later" }, { id: "a", selected: ["x"] }],
  });
});
