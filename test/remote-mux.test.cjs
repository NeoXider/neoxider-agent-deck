const test = require("node:test");
const assert = require("node:assert/strict");

const { createRemoteMuxClient, REMOTE_MUX_RECONNECT_MIN, REMOTE_MUX_RECONNECT_MAX, REMOTE_MUX_REFUSED_RETRY } = require("../src/remote-mux.cjs");

function createFakeTransport() {
  const channels = [];
  return {
    channels,
    openChannel({ endpoint, args, onFrame }) {
      const handle = { endpoint, args, onFrame, closed: null, closedResolvers: [], closeCalls: 0 };
      handle.closed = new Promise((resolve) => { handle.closedResolvers.push(resolve); });
      handle.close = () => { handle.closeCalls += 1; for (const r of handle.closedResolvers) r(); };
      channels.push(handle);
      return handle;
    },
  };
}

function createTransportGate() {
  let transport = null;
  const gate = {
    get transport() { return transport; },
    setTransport(t) { transport = t; },
    getTransport: () => transport,
  };
  return gate;
}

function fakeSleep() {
  const calls = [];
  return {
    calls,
    sleep(ms) { calls.push(ms); return new Promise(() => {}); },
  };
}

async function tick() { await new Promise((r) => setTimeout(r, 20)); }

test("DSH inbox projections publish editable messages and survive reconnect", async () => {
  const transport = createFakeTransport();
  const queues = [];
  const mux = createRemoteMuxClient({ getTransport: () => transport, onQueue: (id, items) => queues.push([id, items]) });
  mux.start();
  await tick();
  try {
    const channel = transport.channels[0];
    const message = { id: "image-prompt", role: "user", source: { kind: "user" }, content: [{ type: "text", text: "Caption" }, { type: "image", attachment: { attachmentId: "image-1" } }] };
    channel.onFrame({ type: "baseline", value: { projections: { s1: { asOfSeq: 10, values: { inbox: { "next-turn": [message], "next-step": [] } } } } } });
    assert.deepEqual(queues.at(-1), ["s1", [{ id: message.id, placement: "queued", message, editable: false }]]);
    const background = { id: "job", source: { kind: "tool" }, content: [] };
    channel.onFrame({ type: "projection", sessionId: "s1", key: "inbox", seq: 11, value: { "next-turn": [], "next-step": [message, background] } });
    assert.deepEqual(queues.at(-1), ["s1", [{ id: message.id, placement: "steering", message }]]);
    const count = queues.length;
    channel.onFrame({ type: "projection", sessionId: "s1", key: "inbox", seq: 9, value: { "next-turn": [message] } });
    assert.equal(queues.length, count, "an older frame cannot resurrect a consumed message");
    channel.onFrame({ type: "baseline", value: { projections: {} } });
    assert.deepEqual(queues.at(-1), ["s1", []], "a reconnect clears queues absent from the baseline");
    channel.onFrame({ type: "baseline", value: { projections: { s1: { asOfSeq: 8, values: { inbox: { "next-turn": [message] } } } } } });
    assert.equal(queues.at(-1)[1][0].id, message.id, "the new connection owns its watermark");
    channel.onFrame({ type: "projection", sessionId: "s1", key: "inbox", seq: 12, value: { "next-turn": [], "next-step": [] } });
    assert.deepEqual(queues.at(-1), ["s1", []]);
  } finally { mux.stop(); }
});

test("job snapshots replace live state and reconnect clears removed sessions", async () => {
  const transport = createFakeTransport();
  const updates = [];
  const mux = createRemoteMuxClient({ getTransport: () => transport, onJobs: (id, jobs) => updates.push([id, jobs]) });
  mux.start();
  await tick();
  try {
    const channel = transport.channels[0];
    channel.onFrame({ type: "baseline", value: { jobs: { s1: [{ status: "running" }] } } });
    channel.onFrame({ type: "jobs", sessionId: "s1", jobs: [{ status: "completed" }] });
    channel.onFrame({ type: "baseline", value: { jobs: {} } });
    assert.deepEqual(updates, [["s1", [{ status: "running" }]], ["s1", [{ status: "completed" }]], ["s1", []]]);
  } finally { mux.stop(); }
});

test("control channel publishes baseline queues via onQueue", async () => {
  const transport = createFakeTransport();
  const queues = [];
  const gate = createTransportGate();
  gate.setTransport(transport);
  const mux = createRemoteMuxClient({ getTransport: gate.getTransport, onQueue: (sid, items) => queues.push({ sid, items }) });
  mux.start();
  await tick();
  assert.equal(transport.channels.length, 1);
  assert.equal(transport.channels[0].endpoint, "session/control");
  transport.channels[0].onFrame({ type: "baseline", value: { queues: { s1: [{ id: "q1" }], s2: [] } } });
  assert.deepEqual(queues, [{ sid: "s1", items: [{ id: "q1" }] }, { sid: "s2", items: [] }]);
  mux.stop();
});

test("live queue frames update onQueue", async () => {
  const transport = createFakeTransport();
  const queues = [];
  const gate = createTransportGate();
  gate.setTransport(transport);
  const mux = createRemoteMuxClient({ getTransport: gate.getTransport, onQueue: (sid, items) => queues.push({ sid, items }) });
  mux.start();
  await tick();
  transport.channels[0].onFrame({ type: "queue", sessionId: "s3", items: [{ id: "q2" }] });
  assert.deepEqual(queues, [{ sid: "s3", items: [{ id: "q2" }] }]);
  mux.stop();
});

test("malformed frames are ignored without crashing", async () => {
  const transport = createFakeTransport();
  const gate = createTransportGate();
  gate.setTransport(transport);
  const mux = createRemoteMuxClient({ getTransport: gate.getTransport });
  mux.start();
  await tick();
  transport.channels[0].onFrame(null);
  transport.channels[0].onFrame(42);
  transport.channels[0].onFrame({ type: "unknown" });
  mux.stop();
});

test("setTrackedSessions opens follow channels per session", async () => {
  const transport = createFakeTransport();
  const gate = createTransportGate();
  gate.setTransport(transport);
  const mux = createRemoteMuxClient({ getTransport: gate.getTransport });
  mux.start();
  await tick();
  mux.setTrackedSessions(["s1", "s2"]);
  await tick();
  const follows = transport.channels.filter((c) => c.endpoint === "session/follow");
  assert.equal(follows.length, 2);
  assert.deepEqual(follows.map((c) => c.args.request.address.sessionId).sort(), ["s1", "s2"]);
  assert.equal(follows[0].args.request.assistantStream, true);
  mux.stop();
});

test("setTrackedSessions deduplicates repeat calls", async () => {
  const transport = createFakeTransport();
  const gate = createTransportGate();
  gate.setTransport(transport);
  const mux = createRemoteMuxClient({ getTransport: gate.getTransport });
  mux.start();
  await tick();
  mux.setTrackedSessions(["s1"]);
  await tick();
  mux.setTrackedSessions(["s1"]);
  await tick();
  const follows = transport.channels.filter((c) => c.endpoint === "session/follow");
  assert.equal(follows.length, 1, "must not open a second follow for the same session");
  mux.stop();
});

test("setTrackedSessions closes channels for removed sessions", async () => {
  const transport = createFakeTransport();
  const gate = createTransportGate();
  gate.setTransport(transport);
  const mux = createRemoteMuxClient({ getTransport: gate.getTransport });
  mux.start();
  await tick();
  mux.setTrackedSessions(["s1", "s2"]);
  await tick();
  const before = transport.channels.filter((c) => c.endpoint === "session/follow").length;
  mux.setTrackedSessions(["s1"]);
  await tick();
  const after = transport.channels.filter((c) => c.endpoint === "session/follow" && c.closeCalls === 0).length;
  assert.ok(after < before, "untracked session channel must be closed");
  mux.stop();
});

test("live event frames call onLiveEvent with sessionId", async () => {
  const transport = createFakeTransport();
  const events = [];
  const gate = createTransportGate();
  gate.setTransport(transport);
  const mux = createRemoteMuxClient({ getTransport: gate.getTransport, onLiveEvent: (e) => events.push(e) });
  mux.start();
  await tick();
  mux.setTrackedSessions(["s1"]);
  await tick();
  const follow = transport.channels.find((c) => c.endpoint === "session/follow");
  follow.onFrame({ type: "event", event: { type: "turn/start" } });
  assert.equal(events.length, 1);
  assert.equal(events[0].sessionId, "s1");
  assert.deepEqual(events[0].event, { type: "turn/start" });
  mux.stop();
});

test("assistant-stream chunk frames produce synthesized assistant/chunk events", async () => {
  const transport = createFakeTransport();
  const events = [];
  const gate = createTransportGate();
  gate.setTransport(transport);
  const mux = createRemoteMuxClient({ getTransport: gate.getTransport, onLiveEvent: (e) => events.push(e) });
  mux.start();
  await tick();
  mux.setTrackedSessions(["s1"]);
  await tick();
  const follow = transport.channels.find((c) => c.endpoint === "session/follow");
  follow.onFrame({ type: "assistant-stream", frame: { type: "chunk", chunk: { text: "hi" } } });
  assert.equal(events.length, 1);
  assert.equal(events[0].sessionId, "s1");
  assert.equal(events[0].event.type, "assistant/chunk");
  assert.deepEqual(events[0].event.data.chunk, { text: "hi" });
  mux.stop();
});

test("reconnecting restores compact stream text and a new attempt clears it", async () => {
  const transport = createFakeTransport();
  const events = [];
  const mux = createRemoteMuxClient({ getTransport: () => transport, onLiveEvent: e => events.push(e) });
  mux.track("s1");
  await tick();
  try {
    const follow = transport.channels[0];
    follow.onFrame({ type: "snapshot", assistantStream: { activeAttempt: { stream: [
      { type: "reasoning-chunks", texts: ["Think", "ing"] },
      { type: "text-chunks", texts: ["Hello", " world"] },
      { type: "chunk", chunk: { type: "text-delta", text: "!" } },
    ] } } });
    assert.deepEqual(events.at(-1), { sessionId: "s1", event: { type: "assistant/reset", data: { text: "Hello world!", reasoning: "Thinking" } } });
    follow.onFrame({ type: "assistant-stream", frame: { type: "start", attemptId: "retry" } });
    assert.equal(events.at(-1).event.data.text, "");
    mux.untrack("s1");
    const count = events.length;
    follow.onFrame({ type: "assistant-stream", frame: { type: "chunk", chunk: { text: "late" } } });
    assert.equal(events.length, count, "late events cannot repaint an untracked session");
  } finally { mux.stop(); }
});

test("null transport opens nothing and leaves state clean", async () => {
  const gate = createTransportGate();
  gate.setTransport(null);
  const mux = createRemoteMuxClient({ getTransport: gate.getTransport });
  mux.start();
  await tick();
  assert.equal(mux.state.follows, 0);
  assert.equal(mux.state.connected, false);
  mux.stop();
});

test("reconnect backoff increases after failed opens", async () => {
  const transport = createFakeTransport();
  const gate = createTransportGate();
  gate.setTransport(transport);
  const { calls, sleep } = fakeSleep();
  const mux = createRemoteMuxClient({ getTransport: gate.getTransport, sleep });
  mux.start();
  await tick();
  const first = transport.channels[0];
  first.close();
  await tick();
  assert.ok(calls.length >= 1, "must have slept at least once");
  assert.equal(calls[0], REMOTE_MUX_RECONNECT_MIN);
  mux.stop();
});

test("stop closes all channels and clears follows", async () => {
  const transport = createFakeTransport();
  const gate = createTransportGate();
  gate.setTransport(transport);
  const mux = createRemoteMuxClient({ getTransport: gate.getTransport });
  mux.start();
  await tick();
  mux.setTrackedSessions(["s1"]);
  await tick();
  mux.stop();
  assert.equal(mux.state.stopped, true);
  assert.equal(mux.state.follows, 0);
  for (const ch of transport.channels) {
    assert.ok(ch.closeCalls >= 1, "all channels must be closed on stop");
  }
});

// A transport whose opens stay pending until the test releases them, which is the
// window in which untrack()/stop() used to find no handle to close.
function createSlowTransport() {
  const inner = createFakeTransport();
  const pending = [];
  return {
    channels: inner.channels,
    pending,
    openChannel(options) {
      return new Promise((resolve) => {
        pending.push(() => resolve(inner.openChannel(options)));
      });
    },
    releaseAll() {
      for (const release of pending.splice(0)) release();
    },
  };
}

test("a follow untracked while its channel is still opening is closed once it opens", async () => {
  const transport = createSlowTransport();
  const events = [];
  const gate = createTransportGate();
  gate.setTransport(transport);
  const mux = createRemoteMuxClient({ getTransport: gate.getTransport, onLiveEvent: (e) => events.push(e), sleep: fakeSleep().sleep });
  mux.setTrackedSessions(["s1"]);
  await tick();
  assert.equal(transport.pending.length, 1, "the follow open is in flight");
  mux.setTrackedSessions([]);
  transport.releaseAll();
  await tick();
  const follow = transport.channels.find((c) => c.endpoint === "session/follow");
  assert.ok(follow, "the open completed");
  assert.equal(follow.closeCalls, 1, "the late socket is closed instead of streaming for an untracked session");
  assert.equal(mux.state.follows, 0);
  assert.equal(transport.channels.length, 1, "no reconnect is attempted for the abandoned follow");
  mux.stop();
});

test("a control channel that opens after stop is closed immediately", async () => {
  const transport = createSlowTransport();
  const gate = createTransportGate();
  gate.setTransport(transport);
  const { calls, sleep } = fakeSleep();
  const mux = createRemoteMuxClient({ getTransport: gate.getTransport, sleep });
  mux.start();
  mux.setTrackedSessions(["s1"]);
  await tick();
  assert.equal(transport.pending.length, 2);
  mux.stop();
  transport.releaseAll();
  await tick();
  assert.equal(transport.channels.length, 2);
  for (const channel of transport.channels) {
    assert.equal(channel.closeCalls, 1, `${channel.endpoint} must be closed once it opens after stop`);
  }
  assert.deepEqual(calls, [], "a stopped client does not back off and retry");
  assert.equal(mux.state.connected, false);
});

test("a follow untracked before its transport resolves never opens a channel", async () => {
  const transport = createFakeTransport();
  let releaseTransport;
  const getTransport = () => new Promise((resolve) => { releaseTransport = () => resolve(transport); });
  const mux = createRemoteMuxClient({ getTransport, sleep: fakeSleep().sleep });
  mux.track("s1");
  mux.untrack("s1");
  releaseTransport();
  await tick();
  assert.equal(transport.channels.length, 0);
});

test("reconnect constants are exported", () => {
  assert.equal(REMOTE_MUX_RECONNECT_MIN, 1500);
  assert.equal(REMOTE_MUX_RECONNECT_MAX, 30000);
});

// DSH accepts a follow stream, decodes the whole stored log and only then refuses it. Resetting
// the backoff on open retried such a session every 1.5s, a full decode each time, for good.
test("a follow that ends without delivering anything backs off, and one that delivered starts over", async () => {
  const transport = createFakeTransport();
  const calls = [];
  const mux = createRemoteMuxClient({ getTransport: () => transport, sleep: async (ms) => { calls.push(ms); } });
  mux.track("s1");
  try {
    await tick();
    transport.channels.at(-1).close();
    await tick();
    transport.channels.at(-1).close();
    await tick();
    const healthy = transport.channels.at(-1);
    healthy.onFrame({ type: "snapshot", records: [] });
    healthy.close();
    await tick();
    assert.deepEqual(calls.slice(0, 3), [REMOTE_MUX_RECONNECT_MIN, REMOTE_MUX_RECONNECT_MIN * 2, REMOTE_MUX_RECONNECT_MIN]);
  } finally { mux.stop(); }
});

test("a follow DSH refuses as corrupt is asked for again only after the long refusal wait", async () => {
  const transport = createFakeTransport();
  const calls = [];
  const mux = createRemoteMuxClient({ getTransport: () => transport, sleep: (ms) => { calls.push(ms); return new Promise(() => {}); } });
  mux.track("s1");
  try {
    await tick();
    const refused = new Error('Harness session/follow: stored session "s1" is corrupt: SessionFormatError: tool/ptc-dispatch is outside an open turn');
    for (const resolve of transport.channels[0].closedResolvers) resolve(refused);
    await tick();
    assert.deepEqual(calls, [REMOTE_MUX_REFUSED_RETRY]);
    assert.ok(REMOTE_MUX_REFUSED_RETRY >= 5 * 60 * 1000, "a refused log must not be decoded again within minutes");
    assert.equal(transport.channels.length, 1, "no second open while the refusal wait runs");
  } finally { mux.stop(); }
});

test("only live sessions get a stream: running, with a child at work, recently touched, or open", () => {
  const { liveSessionIds } = require("../src/remote-mux.cjs");
  const now = Date.parse("2026-10-16T12:00:00Z");
  const sessions = [
    { sessionId: "running", running: true, updatedAt: "2026-10-01T00:00:00Z" },
    { sessionId: "child", running: false, subagents: [{ kind: "child", activity: "running" }], updatedAt: 0 },
    { sessionId: "recent", running: false, updatedAt: "2026-10-16T11:55:00Z" },
    { sessionId: "idle", running: false, state: "idle", updatedAt: "2026-10-15T09:00:00Z" },
    { sessionId: "open", running: false, updatedAt: "2026-10-10T09:00:00Z" },
  ];
  assert.deepEqual(liveSessionIds(sessions, { selected: "open", now }).sort(), ["child", "open", "recent", "running"]);
  assert.deepEqual(liveSessionIds([], { selected: "kept", now }), ["kept"], "the open chat streams even when the list omits it");
});
