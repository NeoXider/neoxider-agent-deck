// How full a chat's context is. DSH 0.2.2 stopped putting the `contextPressure` projection
// in session/list rows (it is not a summary projection any more); it still rides the
// session/follow snapshot, and the events that move it are plain history events. So the
// number is kept here per chat: seeded from every snapshot Deck already opens, moved by
// the live events (a model reply's usage, a request's context window), and put back on
// the row the renderer draws from.
//
// The figure is sticky. DSH forgets the window whenever a request names a model whose
// window it does not know, and counts a reply that reported no usage (a stopped or failed
// attempt) as zero tokens; either one blanked the meter until the next good request. A
// context is never empty and a window does not stop existing, so the last real value
// stays until a real one replaces it. The table is also written to disk (numbers only),
// so the meter and the Agents list keep their figures across a Deck restart.

const fs = require("node:fs");

const MAX_TRACKED = 400;
const SAVE_DELAY_MS = 1500;

function count(value) {
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

// What DSH counts as the prompt: fresh input plus what the cache served or took in.
function pressureOf(usage) {
  const input = count(usage?.inputTokens);
  if (input === null) return null;
  return input + (count(usage?.cacheReadTokens) ?? 0) + (count(usage?.cacheWriteTokens) ?? 0);
}

// The usage a history event carries, read the way DSH's own meter reads it: on the reply
// itself, or in the last `usage` chunk of the reply's (or a failed attempt's) stream.
function usageOf(event) {
  if (event?.type !== "assistant/message" && event?.type !== "assistant/attempt") return null;
  if (event.type === "assistant/message" && event.data?.usage) return event.data.usage;
  const stream = Array.isArray(event.data?.stream) ? event.data.stream : [];
  for (let index = stream.length - 1; index >= 0; index -= 1) {
    const record = stream[index];
    if (record?.type === "chunk" && record.chunk?.type === "usage") return record.chunk.usage || null;
  }
  return null;
}

// `current` with whatever `value` really knows laid over it: a positive window, a
// positive token figure. Nothing in `value` can blank what `current` holds.
function merged(current, value) {
  const window = count(value?.contextWindow);
  const pressure = count(value?.pressureTokens);
  const projected = count(value?.projectedTokens);
  const used = projected || pressure;
  if (!window && !used) return current;
  const next = { ...current };
  if (window) next.contextWindow = window;
  if (used) {
    next.pressureTokens = pressure || used;
    next.projectedTokens = used;
  }
  return next;
}

const same = (a, b) => a?.contextWindow === b?.contextWindow && a?.pressureTokens === b?.pressureTokens && a?.projectedTokens === b?.projectedTokens;

// `file` names where the table is kept between runs: a path, or a function returning one
// (the user-data folder is not known when the API is built). Without it nothing is stored.
function createContextPressure({ file, saveDelayMs = SAVE_DELAY_MS } = {}) {
  const bySession = new Map();
  let loaded = !file;
  let saveTimer = null;

  const filePath = () => { try { return typeof file === "function" ? file() : file; } catch { return ""; } };

  function load() {
    if (loaded) return;
    loaded = true;
    try {
      const stored = JSON.parse(fs.readFileSync(filePath(), "utf8"));
      for (const [key, value] of Object.entries(stored?.sessions || {}).slice(-MAX_TRACKED)) {
        const entry = merged({}, value);
        if (key && entry !== undefined && Object.keys(entry).length > 0 && !bySession.has(key)) bySession.set(key, entry);
      }
    } catch { /* no table yet, or an unreadable one: start empty */ }
  }

  function save() {
    saveTimer = null;
    const target = filePath();
    if (!target) return;
    const temporary = `${target}.tmp`;
    const body = JSON.stringify({ version: 1, sessions: Object.fromEntries(bySession) });
    fs.promises.writeFile(temporary, body, "utf8").then(() => fs.promises.rename(temporary, target)).catch(() => {});
  }

  function put(sessionId, next) {
    bySession.delete(sessionId);
    bySession.set(sessionId, next);
    while (bySession.size > MAX_TRACKED) bySession.delete(bySession.keys().next().value);
    if (!file || saveTimer) return;
    saveTimer = setTimeout(save, saveDelayMs);
    saveTimer.unref?.();
  }

  function update(sessionId, value) {
    const key = String(sessionId || "");
    if (!key || !value || typeof value !== "object") return;
    load();
    const current = bySession.get(key) || {};
    const next = merged(current, value);
    if (!same(current, next)) put(key, next);
  }

  function seed(sessionId, projections) {
    update(sessionId, projections?.values?.contextPressure);
  }

  function observe(sessionId, event) {
    if (!event || typeof event !== "object") return;
    if (event.type === "request/context") {
      update(sessionId, { contextWindow: event.data?.contextWindow });
      return;
    }
    const usage = usageOf(event);
    if (!usage) return;
    // The projection's own projectedTokens also follows compaction; a fresh sample is the
    // best figure there is until the next snapshot says otherwise.
    const pressure = pressureOf(usage);
    if (pressure) update(sessionId, { pressureTokens: pressure, projectedTokens: pressure });
  }

  // The row with its chat's pressure. What the Harness itself sent wins field by field,
  // and whatever it left out or zeroed is filled from the table.
  function applyTo(row) {
    if (!row || typeof row !== "object") return row;
    load();
    const tracked = bySession.get(String(row.sessionId || ""));
    const own = row.projections?.values?.contextPressure;
    if (!tracked) return row;
    if (count(own?.contextWindow) && (count(own?.projectedTokens) || count(own?.pressureTokens))) return row;
    const value = own && typeof own === "object" ? merged(tracked, own) : tracked;
    return { ...row, projections: { ...row.projections, values: { ...row.projections?.values, contextPressure: value } } };
  }

  return { seed, observe, applyTo };
}

module.exports = { createContextPressure, pressureOf, usageOf };
