// What a session is doing right now, and for how long, read from its event history.
//
// These readers were the tail of harness-api.cjs, which had grown past the module ceiling.
// They belong together and apart from the transport: each takes a plain array of history
// entries and returns a plain object, so the widget, the Game Bar companion and the tests
// all reach the same answer without a Harness connection.
function resultCallId(data) {
  const message = data && data.message;
  const sourceId = message && message.source && message.source.callId;
  if (sourceId) return String(sourceId);
  const block = Array.isArray(message && message.content)
    ? message.content.find((item) => item && item.type === "tool-result")
    : null;
  return block && block.toolCallId ? String(block.toolCallId) : "";
}

// Harness stamps events either as epoch milliseconds or as an ISO string, depending on the
// producer, so every reader has to accept both.
function toMillis(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function activityFromHistory(entries) {
  if (!Array.isArray(entries)) return null;
  let turnOpen = false;
  let reasoning = "";
  let writing = "";
  let latestSignal = null;
  let activeTool = null;
  const pendingTools = new Map();
  for (const entry of entries) {
    const event = entry && entry.event;
    const data = event && event.data || {};
    if (!event) continue;
    if (event.type === "turn/start") {
      turnOpen = true;
      reasoning = "";
      writing = "";
      latestSignal = null;
      activeTool = null;
      pendingTools.clear();
    } else if (event.type === "assistant/chunk") {
      const chunk = data.chunk || {};
      if (chunk.type === "reasoning-delta" && typeof chunk.text === "string") {
        reasoning += chunk.text;
        if (chunk.text) latestSignal = "thinking";
      }
      if (chunk.type === "text-delta" && typeof chunk.text === "string") {
        writing += chunk.text;
        if (chunk.text) latestSignal = "writing";
      }
    } else if (event.type === "tool/call" && data.callId) {
      pendingTools.set(String(data.callId), String(data.name || "tool"));
      activeTool = String(data.name || "tool");
      latestSignal = "tool";
    } else if (event.type === "tool/result") {
      const callId = resultCallId(data);
      if (callId) pendingTools.delete(callId);
      if (pendingTools.size === 0) {
        activeTool = null;
        latestSignal = null;
      }
    } else if (event.type === "tool/code-dispatch-start" && data.subCallId) {
      pendingTools.set(String(data.subCallId), String(data.name || "tool"));
      activeTool = String(data.name || "tool");
      latestSignal = "tool";
    } else if (event.type === "tool/code-dispatch" && data.subCallId) {
      pendingTools.delete(String(data.subCallId));
      if (pendingTools.size === 0) {
        activeTool = null;
        latestSignal = null;
      }
    } else if (event.type === "turn/end") {
      turnOpen = false;
    }
  }
  if (turnOpen) {
    if (latestSignal === "tool" && activeTool) return { active: true, kind: "tool", label: "Using tool", text: activeTool };
    if (latestSignal === "thinking" && reasoning.trim()) return { active: true, kind: "thinking", label: "Thinking", text: reasoning.trim() };
    if (latestSignal === "writing" && writing.trim()) return { active: true, kind: "writing", label: "Writing", text: writing.trim() };
    return { active: true, kind: "working", label: "Working", text: "Preparing the next step…" };
  }
  return null;
}

// How long the agent has been at it. Taken from the turn's own events rather than timed in
// the widget, so the number survives a restart, is identical in the Game Bar companion, and
// is already correct for a session that was running before the widget opened.
function turnTimingFromHistory(entries) {
  if (!Array.isArray(entries)) return { runningSince: null, lastRunMs: null };
  let openedAt = null;
  let lastRunMs = null;
  for (const entry of entries) {
    const event = entry?.event;
    if (event?.type === "turn/start") {
      openedAt = toMillis(event.time);
    } else if (event?.type === "turn/end") {
      const endedAt = toMillis(event.time);
      if (openedAt !== null && endedAt !== null && endedAt >= openedAt) lastRunMs = endedAt - openedAt;
      openedAt = null;
    }
  }
  return { runningSince: openedAt, lastRunMs };
}

function sessionStateFromHistory(entries, running = false) {
  if (running) return "working";
  if (!Array.isArray(entries)) return "idle";
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const event = entries[index]?.event;
    if (event?.type !== "turn/end") continue;
    return event.data?.reason?.kind === "error" ? "error" : "idle";
  }
  return "idle";
}


module.exports = {
  activityFromHistory,
  resultCallId,
  sessionStateFromHistory,
  toMillis,
  turnTimingFromHistory,
};
