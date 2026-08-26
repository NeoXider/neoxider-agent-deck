// The Harness event multiplexer: one WebSocket carrying queue snapshots and live turn
// events for every session.
//
// This lives apart from the window and IPC code because its hard part is purely about
// connection liveness, and that is only testable when the socket, the clock and the
// frame handlers are injected rather than reached for.

const MUX_RECONNECT_MIN = 1500;
const MUX_RECONNECT_MAX = 30000;
// Harness pushes frames continuously while a session is live, so a full minute of
// silence means the connection is dead even if the operating system never said so.
const MUX_SILENCE_TIMEOUT = 60000;

function muxUrl(harnessUrl) {
  const url = new URL("/api/events.mux", harnessUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
}

function createMuxClient({
  harnessUrl,
  onQueue = () => {},
  onLiveEvent = () => {},
  onSubscribed = () => {},
  WebSocketImpl = globalThis.WebSocket,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
  silenceTimeout = MUX_SILENCE_TIMEOUT,
  reconnectMin = MUX_RECONNECT_MIN,
  reconnectMax = MUX_RECONNECT_MAX,
} = {}) {
  let socket = null;
  let reconnectTimer = null;
  let silenceTimer = null;
  let reconnectDelay = reconnectMin;
  let stopped = false;

  function handleFrame(frame) {
    if (frame?.type === "session/subscribed") onSubscribed(frame.sessionId);
    else if (frame?.type === "session/queue" && frame.sessionId) onQueue(frame.sessionId, frame.items);
    else if (frame?.type === "session/event") onLiveEvent(frame);
  }

  function connect() {
    if (stopped || socket) return;
    const current = new WebSocketImpl(muxUrl(harnessUrl));
    socket = current;

    // A half-open TCP connection (laptop sleep, VPN or Wi-Fi switch) never delivers
    // onclose. Without this watchdog the socket stays non-null forever, the guard above
    // returns early on every retry, and live events stop arriving for the rest of the
    // session — while HTTP polling keeps the rest of the interface looking healthy.
    const noteTraffic = () => {
      clearTimeoutImpl(silenceTimer);
      silenceTimer = setTimeoutImpl(() => {
        if (socket === current) current.close();
      }, silenceTimeout);
    };

    const reconnect = () => {
      clearTimeoutImpl(silenceTimer);
      silenceTimer = null;
      if (socket === current) socket = null;
      if (stopped || reconnectTimer) return;
      const delay = reconnectDelay;
      // Back off so an offline Harness is not hammered every 1.5s indefinitely.
      reconnectDelay = Math.min(reconnectDelay * 2, reconnectMax);
      reconnectTimer = setTimeoutImpl(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };

    current.onopen = () => {
      reconnectDelay = reconnectMin;
      noteTraffic();
    };
    current.onmessage = (event) => {
      noteTraffic();
      try {
        handleFrame(JSON.parse(String(event.data))?.payload);
      } catch {}
    };
    current.onclose = reconnect;
    current.onerror = () => {
      // onerror does not always imply onclose; force the socket down one path only.
      if (socket === current && current.readyState !== 3) current.close();
    };
    noteTraffic();
  }

  return {
    connect,
    stop() {
      stopped = true;
      clearTimeoutImpl(reconnectTimer);
      reconnectTimer = null;
      clearTimeoutImpl(silenceTimer);
      silenceTimer = null;
      socket?.close();
      socket = null;
    },
    // Exposed for assertions; the widget itself never reads these.
    get state() {
      return { connected: Boolean(socket), reconnectDelay, stopped };
    },
  };
}

module.exports = {
  MUX_RECONNECT_MAX,
  MUX_RECONNECT_MIN,
  MUX_SILENCE_TIMEOUT,
  createMuxClient,
  muxUrl,
};
