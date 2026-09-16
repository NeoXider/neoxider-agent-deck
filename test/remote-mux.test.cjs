const test = require("node:test");
const assert = require("node:assert/strict");

const { createRemoteMuxClient, REMOTE_MUX_RECONNECT_MIN, REMOTE_MUX_RECONNECT_MAX } = require("../src/remote-mux.cjs");

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
