const { queueItemView } = require("./queue-view.cjs");

const QUEUE_PLACEMENTS = new Set(["queued", "steering"]);
const TODO_STATUSES = new Set(["pending", "in_progress", "completed"]);

function textFromContent(content) {
  return (Array.isArray(content) ? content : [])
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim()
    .slice(0, 4000);
}

function createStreamPublisher({ queueSnapshots, send }) {
  if (!(queueSnapshots instanceof Map)) throw new TypeError("queueSnapshots must be a Map");
  if (typeof send !== "function") throw new TypeError("send must be a function");

  function publishQueue(sessionId, items) {
    const key = String(sessionId || "");
    if (!key) return null;
    const previous = queueSnapshots.get(key);
    const revision = Number(previous?.revision || 0) + 1;
    const safeItems = (Array.isArray(items) ? items : [])
      .map(queueItemView)
      .filter((item) => item.id && QUEUE_PLACEMENTS.has(item.placement));
    const snapshot = { revision, items: safeItems };
    queueSnapshots.set(key, snapshot);
    send("queue-update", { sessionId: key, ...snapshot });
    return snapshot;
  }

  function publishLiveEvent(frame) {
    if (!frame?.sessionId || !frame?.event) return false;
    const event = frame.event;
    let data = {};
    if (event.type === "assistant/chunk") {
      const chunk = event.data?.chunk || {};
      data = { chunk: {
        type: String(chunk.type || ""),
        index: Number(chunk.index) || 0,
        blockType: String(chunk.blockType || chunk.block?.type || ""),
        text: typeof chunk.text === "string" ? chunk.text : "",
        name: typeof chunk.name === "string" ? chunk.name : "",
      } };
    } else if (event.type === "tool/call") {
      data = { name: String(event.data?.name || "tool"), callId: String(event.data?.callId || "") };
    } else if (event.type === "tool/result") {
      data = { callId: String(event.data?.callId || event.data?.toolCallId || "") };
    } else if (event.type === "turn/end") {
      data = { reason: { kind: String(event.data?.reason?.kind || "stop") } };
    } else if (event.type === "todo/write") {
      const todos = Array.isArray(event.data?.todos) ? event.data.todos : [];
      data = { todos: todos.slice(0, 100).map((todo) => ({
        content: String(todo?.content || "").slice(0, 2000),
        status: TODO_STATUSES.has(todo?.status) ? todo.status : "pending",
      })).filter((todo) => todo.content) };
    } else if (event.type === "user/message") {
      data = {
        messageId: String(event.data?.id || ""),
        sourceKind: String(event.data?.source?.kind || ""),
        text: textFromContent(event.data?.content),
      };
    } else if (!["turn/start", "assistant/message"].includes(event.type)) {
      return false;
    }
    send("live-event", { sessionId: String(frame.sessionId), event: { type: event.type, seq: event.seq, data } });
    return true;
  }

  return { publishLiveEvent, publishQueue };
}

module.exports = { createStreamPublisher, textFromContent };
