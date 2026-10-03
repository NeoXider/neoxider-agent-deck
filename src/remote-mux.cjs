// Live surfaces for the remote Harness generation: one persistent session/control
// channel carrying inbox projections for every session, plus per-session
// session/follow channels for live events and assistant stream frames. Reconnect
// and backoff mirror mux-client so a dead socket degrades exactly as it always has.

const REMOTE_MUX_RECONNECT_MIN = 1500;
const REMOTE_MUX_RECONNECT_MAX = 30000;

function defaultSleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function createRemoteMuxClient({ getTransport, onQueue = () => {}, onJobs = () => {}, onLiveEvent = () => {}, sleep = defaultSleep } = {}) {
  if (typeof getTransport !== "function") throw new TypeError("getTransport must be a function");
  let stopped = false;
  let controlRunning = false;
  let controlHandle = null;
  const follows = new Map();
  const jobSessions = new Set();
  const queueSessions = new Set();
  const inboxRevisions = new Map();

  function publishInbox(sessionId, inbox, seq = null) {
    if (!sessionId || !inbox || typeof inbox !== "object") return;
    if (Number.isFinite(seq) && Number.isFinite(inboxRevisions.get(sessionId))
        && seq < inboxRevisions.get(sessionId)) return;
    if (Number.isFinite(seq)) inboxRevisions.set(sessionId, seq);
    queueSessions.add(sessionId);
    const items = [
      ...(Array.isArray(inbox["next-turn"]) ? inbox["next-turn"] : []).map(message => ({ id: message?.id, placement: "queued", message,
        editable: !(Array.isArray(message?.content) ? message.content : []).some(block => block?.type !== "text") })),
      ...(Array.isArray(inbox["next-step"]) ? inbox["next-step"] : [])
        .filter(message => message?.source?.kind === "user")
        .map(message => ({ id: message.id, placement: "steering", message })),
    ];
    onQueue(sessionId, items);
  }

  // The transport is async because the generation probe may still be settling, and it
  // is null until the harness proves itself to be on the remote generation.
  async function withChannel(endpoint, args, onFrame, isAbandoned = () => false) {
    const transport = await getTransport();
    if (!transport || isAbandoned()) return null;
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
            if (stopped || !value || typeof value !== "object") return;
            if (value.type === "baseline" && value.value) {
              // Current DSH sends complete projection baselines, not `queues`.
              // Reset the generation watermark: a restarted server may restore an
              // older durable position than the last process-local frame we saw.
              const projections = value.value.projections || {};
              const queues = value.value.queues || {};
              for (const id of queueSessions) if (!(id in projections) && !(id in queues)) onQueue(id, []);
              queueSessions.clear();
              inboxRevisions.clear();
              for (const [id, projection] of Object.entries(projections)) {
                publishInbox(id, projection?.values?.inbox || {}, projection?.asOfSeq);
              }
              const jobs = value.value.jobs || {};
              for (const id of jobSessions) if (!(id in jobs)) onJobs(id, []);
              jobSessions.clear();
              for (const [id, items] of Object.entries(jobs)) {
                jobSessions.add(id); onJobs(id, Array.isArray(items) ? items : []);
              }
              for (const [sessionId, items] of Object.entries(queues)) {
                queueSessions.add(sessionId);
                onQueue(sessionId, Array.isArray(items) ? items : []);
              }
            } else if (value.type === "projection" && value.key === "inbox") {
              publishInbox(value.sessionId, value.value, value.seq);
            } else if (value.type === "jobs" && value.sessionId) {
              jobSessions.add(value.sessionId);
              onJobs(value.sessionId, Array.isArray(value.jobs) ? value.jobs : []);
            } else if (value.type === "queue" && value.sessionId) {
              queueSessions.add(value.sessionId);
              onQueue(value.sessionId, Array.isArray(value.items) ? value.items : []);
            }
          }, () => stopped);
        } catch {}
        // stop() can only close a handle it can see, and there is none while the open is
        // pending. A socket that opens after stop() must be closed here, or it lives on
        // until the Harness drops it, publishing queue frames nobody asked for.
        if (handle && stopped) {
          try { handle.close(); } catch {}
          break;
        }
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
    const abandoned = () => stopped || entry.closing || follows.get(sessionId) !== entry;
    while (!abandoned()) {
      let handle = null;
      try {
        handle = await withChannel("session/follow", { request: { address: { kind: "session", sessionId }, assistantStream: true } }, (value) => {
          if (abandoned() || !value || typeof value !== "object") return;
          if (value.type === "snapshot" && value.assistantStream?.activeAttempt) {
            const records = value.assistantStream.activeAttempt.stream || [];
            let text = "", reasoning = "";
            for (const record of records) {
              if (record.type === "text-chunks") text += (record.texts || []).join("");
              else if (record.type === "reasoning-chunks") reasoning += (record.texts || []).join("");
              else if (record.chunk?.type === "text-delta") text += record.chunk.text || "";
              else if (record.chunk?.type === "reasoning-delta") reasoning += record.chunk.text || "";
            }
            onLiveEvent({ sessionId, event: { type: "assistant/reset", data: { text, reasoning } } });
          } else if (value.type === "assistant-stream" && value.frame?.type === "start") {
            onLiveEvent({ sessionId, event: { type: "assistant/reset", data: { text: "", reasoning: "" } } });
          } else if (value.type === "event" && value.event) {
            onLiveEvent({ sessionId, event: value.event });
          } else if (value.type === "assistant-stream" && value.frame?.type === "chunk") {
            // The frame's chunk is the raw model StreamChunk; the publisher
            // extracts the same fields it does for legacy live events.
            const chunk = value.frame.chunk && typeof value.frame.chunk === "object" ? value.frame.chunk : {};
            onLiveEvent({ sessionId, event: { type: "assistant/chunk", seq: 0, data: { chunk } } });
          }
        }, abandoned);
      } catch {}
      // untrack()/stop() close entry.handle, which is still null while the open is
      // pending. Without this check the freshly opened socket was stored and awaited
      // until the Harness dropped it, streaming live events for an untracked session.
      if (handle && abandoned()) {
        try { handle.close(); } catch {}
        break;
      }
      if (handle) {
        entry.handle = handle;
        delay = REMOTE_MUX_RECONNECT_MIN;
        try { await handle.closed; } catch {}
      }
      if (abandoned()) break;
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
