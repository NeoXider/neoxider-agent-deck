const test = require("node:test");
const assert = require("node:assert/strict");

const { createMuxClient, muxUrl } = require("../src/mux-client.cjs");

// A controllable clock: timers only fire when the test advances time, so the silence
// watchdog and the reconnect backoff can be asserted without waiting a real minute.
function createClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    setTimeout(callback, delay) {
      const id = nextId++;
      timers.set(id, { at: now + delay, callback });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (timer.at <= now) {
          timers.delete(id);
          timer.callback();
        }
      }
    },
    get pending() {
      return timers.size;
    },
  };
}

function createSocketFactory() {
  const sockets = [];
  class FakeSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.closed = 0;
      sockets.push(this);
    }
    close() {
      this.closed += 1;
      this.readyState = 3;
      this.onclose?.();
    }
    open() {
      this.readyState = 1;
      this.onopen?.();
    }
    deliver(payload) {
      this.onmessage?.({ data: JSON.stringify({ payload }) });
    }
  }
  return { FakeSocket, sockets };
}

function harness(options = {}) {
  const clock = createClock();
  const { FakeSocket, sockets } = createSocketFactory();
  const frames = { queue: [], live: [], subscribed: [] };
  const client = createMuxClient({
    harnessUrl: "http://127.0.0.1:3080",
    WebSocketImpl: FakeSocket,
    setTimeoutImpl: clock.setTimeout,
    clearTimeoutImpl: clock.clearTimeout,
    onQueue: (sessionId, items) => frames.queue.push({ sessionId, items }),
    onLiveEvent: (frame) => frames.live.push(frame),
    onSubscribed: (sessionId) => frames.subscribed.push(sessionId),
    ...options,
  });
  return { clock, sockets, frames, client };
}

test("the mux url upgrades the scheme without losing the host", () => {
  assert.equal(muxUrl("http://127.0.0.1:3080"), "ws://127.0.0.1:3080/api/events.mux");
  assert.equal(muxUrl("https://harness.example"), "wss://harness.example/api/events.mux");
});

test("a silent socket is closed by the watchdog", () => {
  const { clock, sockets, client } = harness({ silenceTimeout: 60000 });
  client.connect();
  sockets[0].open();

  clock.advance(59999);
  assert.equal(sockets[0].closed, 0, "a socket must not be closed before the timeout");

  clock.advance(1);
  // Without this, a half-open TCP connection leaves the client believing it is
  // connected forever and live events stop arriving for the rest of the session.
  assert.equal(sockets[0].closed, 1);
});

test("traffic keeps the connection alive indefinitely", () => {
  const { clock, sockets, frames, client } = harness({ silenceTimeout: 60000 });
  client.connect();
  sockets[0].open();

  for (let tick = 0; tick < 10; tick += 1) {
    clock.advance(59000);
    sockets[0].deliver({ type: "session/event", sessionId: "s1", event: { type: "turn/start" } });
  }
  assert.equal(sockets[0].closed, 0, "an actively used socket must never be reaped");
  assert.equal(frames.live.length, 10);
});

test("reconnect backs off exponentially and stops at the cap", () => {
  const { clock, sockets, client } = harness({ reconnectMin: 1500, reconnectMax: 12000 });
  client.connect();

  const delays = [];
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const before = sockets.length;
    sockets[sockets.length - 1].close();
    // Find the delay by advancing one millisecond at a time would be slow; instead
    // advance the expected delay and assert a new socket appeared exactly then.
    const expected = Math.min(1500 * 2 ** attempt, 12000);
    clock.advance(expected - 1);
    assert.equal(sockets.length, before, `reconnect fired earlier than ${expected}ms`);
    clock.advance(1);
    assert.equal(sockets.length, before + 1, `reconnect did not fire at ${expected}ms`);
    delays.push(expected);
  }
  assert.deepEqual(delays, [1500, 3000, 6000, 12000, 12000]);
});

test("a successful connection resets the backoff", () => {
  const { clock, sockets, client } = harness({ reconnectMin: 1500, reconnectMax: 12000 });
  client.connect();

  sockets[0].close();
  clock.advance(1500);
  sockets[1].close();
  clock.advance(3000);
  assert.equal(sockets.length, 3);

  sockets[2].open();
  sockets[2].close();
  // After a healthy connection the next outage must start from the minimum again,
  // otherwise one bad night leaves the widget retrying every 30 seconds all day.
  clock.advance(1499);
  assert.equal(sockets.length, 3);
  clock.advance(1);
  assert.equal(sockets.length, 4);
});

test("stop prevents any further reconnect", () => {
  const { clock, sockets, client } = harness();
  client.connect();
  sockets[0].open();

  client.stop();
  assert.equal(sockets[0].closed, 1);

  clock.advance(600000);
  assert.equal(sockets.length, 1, "a stopped client must not resurrect the socket");
  assert.equal(clock.pending, 0, "stopping must not leave timers behind");
});

test("frames are routed to the matching handler and malformed data is ignored", () => {
  const { sockets, frames, client } = harness();
  client.connect();
  sockets[0].open();

  sockets[0].deliver({ type: "session/subscribed", sessionId: "s1" });
  sockets[0].deliver({ type: "session/queue", sessionId: "s2", items: [{ id: "q1" }] });
  sockets[0].deliver({ type: "session/event", sessionId: "s3", event: { type: "turn/end" } });
  sockets[0].deliver({ type: "something/else", sessionId: "s4" });
  sockets[0].onmessage({ data: "not json at all" });

  assert.deepEqual(frames.subscribed, ["s1"]);
  assert.deepEqual(frames.queue, [{ sessionId: "s2", items: [{ id: "q1" }] }]);
  assert.equal(frames.live.length, 1);
  assert.equal(frames.live[0].sessionId, "s3");
});

test("an error without a close still forces the socket down one path", () => {
  const { sockets, client } = harness();
  client.connect();
  sockets[0].open();

  sockets[0].onerror();
  // onerror does not always imply onclose; the client must not be left half-dead.
  assert.equal(sockets[0].closed, 1);
});
