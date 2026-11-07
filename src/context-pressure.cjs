// How full a chat's context is. DSH 0.2.2 stopped putting the `contextPressure` projection
// in session/list rows (it is not a summary projection any more); it still rides the
// session/follow snapshot, and the events that move it are plain history events. So the
// number is kept here per chat: seeded from every snapshot Deck already opens, moved by
// the live events (a model reply's usage, a request's context window), and put back on
// the row the renderer draws from.

const MAX_TRACKED = 400;

function count(value) {
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

// What DSH counts as the prompt: fresh input plus what the cache served or took in.
function pressureOf(usage) {
  const input = count(usage?.inputTokens);
  if (input === null) return null;
  return input + (count(usage?.cacheReadTokens) ?? 0) + (count(usage?.cacheWriteTokens) ?? 0);
}

function createContextPressure() {
  const bySession = new Map();

  function put(sessionId, next) {
    bySession.delete(sessionId);
    bySession.set(sessionId, next);
    while (bySession.size > MAX_TRACKED) bySession.delete(bySession.keys().next().value);
  }

  function seed(sessionId, projections) {
    const value = projections?.values?.contextPressure;
    const key = String(sessionId || "");
    if (!key || !value || typeof value !== "object") return;
    put(key, { ...value });
  }

  function observe(sessionId, event) {
    const key = String(sessionId || "");
    if (!key || !event || typeof event !== "object") return;
    const current = bySession.get(key) || {};
    if (event.type === "request/context") {
      const window = count(event.data?.contextWindow);
      if (window && window !== current.contextWindow) put(key, { ...current, contextWindow: window });
    } else if (event.type === "assistant/message" && event.data?.usage) {
      const pressure = pressureOf(event.data.usage);
      if (pressure === null) return;
      // The projection's own projectedTokens also follows compaction; a fresh sample is the
      // best figure there is until the next snapshot says otherwise.
      put(key, { ...current, pressureTokens: pressure, projectedTokens: pressure });
    }
  }

  // The row with its chat's pressure, unless the Harness already sent one.
  function applyTo(row) {
    if (!row || typeof row !== "object" || row.projections?.values?.contextPressure) return row;
    const value = bySession.get(String(row.sessionId || ""));
    if (!value) return row;
    return { ...row, projections: { ...row.projections, values: { ...row.projections?.values, contextPressure: value } } };
  }

  return { seed, observe, applyTo };
}

module.exports = { createContextPressure, pressureOf };
