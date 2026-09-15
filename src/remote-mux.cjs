// Live surfaces for the remote Harness generation: one persistent session/control
// channel carrying queue snapshots for every session, plus per-session
// session/follow channels for live events and assistant stream frames. Reconnect
// and backoff mirror mux-client so a dead socket degrades exactly as it always has.

const REMOTE_MUX_RECONNECT_MIN = 1500;
const REMOTE_MUX_RECONNECT_MAX = 30000;

function defaultSleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function createRemoteMuxClient({ getTransport, onQueue = () => {}, onLiveEvent = () => {}, sleep = defaultSleep } = {}) {
  if (typeof getTransport !== "function") throw new TypeError("getTransport must be a function");
  let stopped = false;
  let controlRunning = false;
  let controlHandle = null;
  const follows = new Map();

  // The transport is async because the generation probe may still be settling, and it
  // is null until the harness proves itself to be on the remote generation.
  async function withChannel(endpoint, args, onFrame) {
    const transport = await getTransport();
    if (!transport) return null;
    try {
      return await transport.openChannel({ endpoint, args, onFrame });
    } catch (error) {
      throw error;
    }
  }

  async function runControl() {
    if (stopped || controlRunning) return;
    controlRunning = true;
    try {
      let delay = REMOTE_MUX_RECONNECT_MIN;
      while (!stopped) {
        let handle = null;
        try {
          handle = await withChannel("session/control", {}, (value) => {
            if (!value || typeof value !== "object") return;
            if (value.type === "baseline" && value.value) {
              for (const [sessionId, items] of Object.entries(value.value.queues || {})) {
                onQueue(sessionId, Array.isArray(items) ? items : []);
              }
            } else if (value.type === "queue" && value.sessionId) {
              onQueue(value.sessionId, Array.isArray(value.items) ? value.items : []);
            }
          });
        } catch {}
        if (handle) {
          controlHandle = handle;
          delay = REMOTE_MUX_RECONNECT_MIN;
          try { await handle.closed; } catch {}
        }
        if (stopped) break;
        const finished = handle;
        handle = null;
        controlHandle = null;
        try { finished?.close(); } catch {}
        await sleep(delay);
        delay = Math.min(delay * 2, REMOTE_MUX_RECONNECT_MAX);
      }
    } finally {
      controlRunning = false;
      controlHandle = null;
    }
  }

  async function runFollow(entry, sessionId) {
    let delay = REMOTE_MUX_RECONNECT_MIN;
    while (!stopped && !entry.closing && follows.get(sessionId) === entry) {
      let handle = null;
      try {
        handle = await withChannel("session/follow", { request: { address: { kind: "session", sessionId }, assistantStream: true } }, (value) => {
          if (!value || typeof value !== "object") return;
          if (value.type === "event" && value.event) {
            onLiveEvent({ sessionId, event: value.event });
          } else if (value.type === "assistant-stream" && value.frame?.type === "chunk") {
            // The frame's chunk is the raw model StreamChunk; the publisher
            // extracts the same fields it does for legacy live events.
            const chunk = value.frame.chunk && typeof value.frame.chunk === "object" ? value.frame.chunk : {};
            onLiveEvent({ sessionId, event: { type: "assistant/chunk", seq: 0, data: { chunk } } });
          }
        });
      } catch {}
      if (handle) {
        entry.handle = handle;
        delay = REMOTE_MUX_RECONNECT_MIN;
        try { await handle.closed; } catch {}
      }
      if (stopped || entry.closing || follows.get(sessionId) !== entry) break;
      const finished = entry.handle;
      entry.handle = null;
      try { finished?.close(); } catch {}
      // A null transport means the harness is not on the remote generation yet; the
      // backoff below re-enters withChannel once it is.
      await sleep(delay);
      delay = Math.min(delay * 2, REMOTE_MUX_RECONNECT_MAX);
    }
  }

  function track(sessionId) {
    const key = String(sessionId || "");
    if (!key || stopped || follows.has(key)) return;
    const entry = { closing: false, handle: null };
    follows.set(key, entry);
    runFollow(entry, key);
  }

  function untrack(sessionId) {
    const key = String(sessionId || "");
    const entry = follows.get(key);
    if (!entry) return;
    entry.closing = true;
    follows.delete(key);
    try { entry.handle?.close(); } catch {}
  }

  function setTrackedSessions(ids) {
    const wanted = new Set([...(ids || [])].map(String).filter(Boolean));
    for (const key of [...follows.keys()]) if (!wanted.has(key)) untrack(key);
    for (const key of wanted) track(key);
  }

  function start() { runControl(); }

  function stop() {
    stopped = true;
    try { controlHandle?.close(); } catch {}
    for (const entry of follows.values()) {
      entry.closing = true;
      try { entry.handle?.close(); } catch {}
    }
    follows.clear();
  }

  return {
    start,
    stop,
    track,
    untrack,
    setTrackedSessions,
    get state() {
      return { connected: Boolean(controlHandle), follows: follows.size, stopped };
    },
  };
}

module.exports = {
  REMOTE_MUX_RECONNECT_MAX,
  REMOTE_MUX_RECONNECT_MIN,
  createRemoteMuxClient,
};
