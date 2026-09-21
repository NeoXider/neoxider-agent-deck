const { QUEUE_CONTENT, queueItemView } = require("./queue-view.cjs");

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

function createStreamPublisher({ queueSnapshots, backgroundJobs = new Map(), send, readAttachment = null }) {
  if (!(queueSnapshots instanceof Map)) throw new TypeError("queueSnapshots must be a Map");
  if (typeof send !== "function") throw new TypeError("send must be a function");
  const previewCache = new Map();

  async function hydrateQueuePreviews(sessionId, snapshot) {
    if (typeof readAttachment !== "function") return;
    let remaining = 1024 * 1024;
    const wanted = [];
    for (const item of snapshot.items) for (const attachment of item.attachments || []) {
      if (attachment.kind !== "image" || attachment.data || !attachment.attachmentId || wanted.some((entry) => entry.id === attachment.attachmentId)) continue;
      wanted.push({ id: attachment.attachmentId, mediaType: attachment.mediaType });
    }
    const dataById = new Map();
    await Promise.all(wanted.slice(0, 12).map(async ({ id, mediaType }) => {
      try {
        const cacheKey = `${sessionId}\0${id}`;
        let pending = previewCache.get(cacheKey);
        if (!pending) {
          pending = Promise.resolve(readAttachment(sessionId, id)).then((value) => {
            const data = String(value?.data || "");
            const bytes = Buffer.byteLength(data, "base64");
            return value?.attachment?.mediaType === mediaType && data.length % 4 === 0
              && /^[a-zA-Z0-9+/]*={0,2}$/.test(data) && bytes > 0 && bytes <= 1024 * 1024
              ? { data, mediaType } : null;
          }, () => null);
          previewCache.set(cacheKey, pending);
          if (previewCache.size > 32) previewCache.delete(previewCache.keys().next().value);
        }
        const value = await pending;
        const bytes = value ? Buffer.byteLength(value.data, "base64") : 0;
        if (value?.mediaType === mediaType && bytes <= remaining) {
          remaining -= bytes; dataById.set(id, value.data);
        }
      } catch {}
    }));
    if (!dataById.size || queueSnapshots.get(sessionId) !== snapshot) return;
    const items = snapshot.items.map((item) => {
      const next = { ...item, attachments: item.attachments.map((attachment) => {
        const data = dataById.get(attachment.attachmentId);
        return data ? { ...attachment, data } : attachment;
      }) };
      Object.defineProperty(next, QUEUE_CONTENT, { value: item[QUEUE_CONTENT], enumerable: false });
      return next;
    });
    const hydrated = { revision: snapshot.revision + 1, items };
    queueSnapshots.set(sessionId, hydrated);
    send("queue-update", { sessionId, ...hydrated });
  }

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
    void hydrateQueuePreviews(key, snapshot);
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
      // Remote durable events carry the correlation id inside the tool-result block.
      const resultBlock = Array.isArray(event.data?.message?.content) ? event.data.message.content[0] : null;
      data = { callId: String(event.data?.callId || event.data?.toolCallId || resultBlock?.toolCallId || "") };
    } else if (event.type === "tool/code-dispatch-start") {
      data = {
        name: String(event.data?.name || "tool"),
        callId: String(event.data?.subCallId || event.data?.callId || ""),
      };
    } else if (event.type === "tool/code-dispatch") {
      data = {
        callId: String(event.data?.subCallId || event.data?.callId || ""),
        isError: Boolean(event.data?.isError),
      };
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

  function publishJobs(sessionId, jobs) {
    const count = (Array.isArray(jobs) ? jobs : []).filter(job => job?.status === "running" || job?.status === "stopping").length;
    if (count) backgroundJobs.set(sessionId, count); else backgroundJobs.delete(sessionId);
    send("live-event", { sessionId, event: { type: "session/jobs", data: { count } } });
  }
  return { publishLiveEvent, publishQueue, publishJobs };
}

module.exports = { createStreamPublisher, textFromContent };
