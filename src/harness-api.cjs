const { createHash, randomUUID } = require("node:crypto");

const HISTORY_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const HISTORY_IMAGE_BASE64_LIMIT = Math.ceil(8 * 1024 * 1024 * 4 / 3) + 8;
const HISTORY_PREVIEW_BYTES_BUDGET = 1024 * 1024;
const HISTORY_CACHE_SESSION_LIMIT = 8;
const HISTORY_CACHE_EVENT_LIMIT = 800;
const HISTORY_CACHE_BYTES_LIMIT = 4 * 1024 * 1024;
const HISTORY_VIDEO_EXTENSIONS = new Set(["mp4", "mov", "m4v", "webm", "mkv", "avi", "wmv"]);

function historyImageBytes(data) {
  if (typeof data !== "string" || !data.length || data.length > HISTORY_IMAGE_BASE64_LIMIT
      || data.length % 4 !== 0 || !/^[a-zA-Z0-9+/]*={0,2}$/.test(data)) return -1;
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return (data.length / 4) * 3 - padding;
}

// Keep newest small previews within one strict history-wide budget. Image attachment
// metadata survives when data is stripped, so the renderer can show a safe icon fallback.
function boundedHistoryEntries(entries, maxPreviewBytes = HISTORY_PREVIEW_BYTES_BUDGET) {
  if (!Array.isArray(entries)) return [];
  let remaining = Math.max(0, Number(maxPreviewBytes) || 0);
  const bounded = [...entries];
  for (let index = bounded.length - 1; index >= 0; index -= 1) {
    const entry = bounded[index];
    const content = entry?.event?.data?.content;
    if (!Array.isArray(content)) continue;
    let changed = false;
    const nextContent = content.map((block) => {
      if (block?.type !== "image" || typeof block.data !== "string") return block;
      const bytes = HISTORY_IMAGE_TYPES.has(String(block.mediaType || "").toLowerCase())
        ? historyImageBytes(block.data)
        : -1;
      if (bytes > 0 && bytes <= remaining) {
        remaining -= bytes;
        return block;
      }
      changed = true;
      const { data: _discarded, ...metadata } = block;
      return metadata;
    });
    if (changed) bounded[index] = {
      ...entry,
      event: {
        ...entry.event,
        data: { ...entry.event.data, content: nextContent },
      },
    };
  }
  return bounded;
}

function positiveInteger(value, fallback) { return Number.isSafeInteger(value) && value > 0 ? value : fallback; }

function historyEntryBytes(entry) { try { return Buffer.byteLength(JSON.stringify(entry), "utf8"); } catch { return Infinity; } }

function boundedHistoryCacheEntries(entries, { maxEvents = HISTORY_CACHE_EVENT_LIMIT, maxBytes = HISTORY_CACHE_BYTES_LIMIT } = {}) {
  const eventLimit = positiveInteger(maxEvents, HISTORY_CACHE_EVENT_LIMIT);
  const byteLimit = positiveInteger(maxBytes, HISTORY_CACHE_BYTES_LIMIT);
  const retainedNewestFirst = [];
  let bytes = 0;
  let truncated = false;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (retainedNewestFirst.length >= eventLimit) { truncated = true; break; }
    const entry = entries[index];
    const entryBytes = historyEntryBytes(entry);
    if (!Number.isFinite(entryBytes) || entryBytes > byteLimit - bytes) { truncated = true; continue; }
    retainedNewestFirst.push(entry);
    bytes += entryBytes;
  }
  if (retainedNewestFirst.length !== entries.length) truncated = true;
  return { bytes, entries: retainedNewestFirst.reverse(), truncated };
}

function historyRevision(entries) {
  const hash = createHash("sha256");
  for (const entry of entries) {
    try { hash.update(JSON.stringify(entry)); }
    catch { hash.update("[unserializable]"); }
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

function textFromBlocks(blocks) {
  if (!Array.isArray(blocks)) return "";
  return blocks
    .filter((block) => block && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function reasoningFromBlocks(blocks) {
  if (!Array.isArray(blocks)) return "";
  return blocks
    .filter((block) => block && block.type === "reasoning" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function shortAttachmentName(value, fallback = "attachment") {
  return (String(value || "").split(/[\\/]/).filter(Boolean).at(-1) || fallback).slice(0, 120);
}

function userContentFromBlocks(blocks) {
  const attachments = [];
  for (const block of Array.isArray(blocks) ? blocks : []) {
    const mediaType = String(block?.mediaType || "").toLowerCase();
    const data = typeof block?.data === "string" ? block.data : "";
    if (block?.type === "image" && HISTORY_IMAGE_TYPES.has(mediaType)) {
      const attachment = {
        kind: "image",
        mediaType,
        name: shortAttachmentName(block.name, "image"),
      };
      if (historyImageBytes(data) > 0) attachment.data = data;
      attachments.push(attachment);
    }
  }
  const lines = textFromBlocks(blocks).split("\n");
  const textLines = [];
  for (const line of lines) {
    const candidate = line.trim();
    const reference = /^@((?:[a-zA-Z]:[\\/]|\\\\|\/).+)$/.exec(candidate);
    if (!reference) {
      textLines.push(line);
      continue;
    }
    const filePath = reference[1].trim();
    const name = shortAttachmentName(filePath);
    const extension = name.includes(".") ? name.split(".").at(-1).toLowerCase() : "";
    attachments.push({ kind: "reference", previewKind: HISTORY_VIDEO_EXTENSIONS.has(extension) ? "video" : "file", name });
  }
  return { text: textLines.join("\n").trim(), attachments: attachments.slice(0, 12) };
}

function readableToolValue(value) {
  if (value == null || value === "") return "";
  if (typeof value !== "string") {
    try { return JSON.stringify(value, null, 2); } catch { return String(value); }
  }
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2);
  } catch {
    return trimmed;
  }
}

function toolResultFromBlocks(blocks) {
  if (!Array.isArray(blocks)) return "";
  const parts = [];
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    if ((block.type === "text" || block.type === "reasoning") && typeof block.text === "string") {
      parts.push(block.text);
    } else if (block.type === "tool-result") {
      const nested = toolResultFromBlocks(block.content);
      if (nested) parts.push(nested);
    } else if (block.type === "image") {
      parts.push("[Image result]");
    } else {
      const readable = readableToolValue(block);
      if (readable) parts.push(readable);
    }
  }
  return parts.join("\n").trim();
}

function resultCallId(data) {
  const message = data && data.message;
  const sourceId = message && message.source && message.source.callId;
  if (sourceId) return String(sourceId);
  const block = Array.isArray(message && message.content)
    ? message.content.find((item) => item && item.type === "tool-result")
    : null;
  return block && block.toolCallId ? String(block.toolCallId) : "";
}

function durationBetween(start, end) {
  const toMillis = (value) => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const parsed = Date.parse(String(value || ""));
    return Number.isFinite(parsed) ? parsed : null;
  };
  const startMs = toMillis(start);
  const endMs = toMillis(end);
  if (startMs == null || endMs == null || endMs < startMs) return null;
  return Math.round(endMs - startMs);
}

function toolMessagesFromHistory(entries) {
  if (!Array.isArray(entries)) return [];
  const nativeCallIds = new Set();
  const results = new Map();
  const codeResults = new Map();
  for (const entry of entries) {
    const event = entry && entry.event;
    const data = event && event.data || {};
    if (!event) continue;
    if (event.type === "tool/call" && data.callId) nativeCallIds.add(String(data.callId));
    if (event.type === "tool/result") {
      const callId = resultCallId(data);
      if (callId) results.set(callId, { event, data });
    }
    if (event.type === "tool/code-dispatch" && data.subCallId) codeResults.set(String(data.subCallId), { event, data });
  }

  const calls = [];
  const seen = new Set();
  const append = ({ callId, name, arguments: args, event, result, nested = false }) => {
    const id = String(callId || "");
    if (!id || seen.has(id)) return;
    seen.add(id);
    const resultData = result && result.data || {};
    const resultEvent = result && result.event;
    const resultBlock = resultData.message && Array.isArray(resultData.message.content)
      ? resultData.message.content.find((block) => block && block.type === "tool-result")
      : null;
    const isError = Boolean(resultData.isError || resultData.error || resultBlock?.isError);
    const outputBlocks = resultBlock?.content || resultData.content || [];
    calls.push({
      role: "tool",
      callId: id,
      name: String(name || "Tool call"),
      arguments: readableToolValue(args),
      result: toolResultFromBlocks(outputBlocks),
      status: result ? (isError ? "error" : "done") : "running",
      isError,
      nested,
      durationMs: resultEvent ? durationBetween(event.time, resultEvent.time) : null,
      time: event.time,
      seq: event.seq,
    });
  };

  for (const entry of entries) {
    const event = entry && entry.event;
    const data = event && event.data || {};
    if (!event) continue;
    if (event.type === "tool/call") {
      append({ callId: data.callId, name: data.name, arguments: data.arguments, event, result: results.get(String(data.callId || "")) });
    } else if (event.type === "assistant/message") {
      for (const block of data.message?.content || []) {
        if (block?.type !== "tool-call" || nativeCallIds.has(String(block.id || ""))) continue;
        append({ callId: block.id, name: block.name, arguments: block.arguments, event, result: results.get(String(block.id || "")) });
      }
    } else if (event.type === "tool/code-dispatch-start") {
      append({ callId: data.subCallId, name: data.name, arguments: data.arguments, event, result: codeResults.get(String(data.subCallId || "")), nested: true });
    } else if (event.type === "tool/code-dispatch" && !seen.has(String(data.subCallId || ""))) {
      append({ callId: data.subCallId, name: data.name, arguments: data.arguments, event, result: { event, data }, nested: true });
    }
  }
  return calls;
}

function titleFromSession(session) {
  const values = session && session.projections && session.projections.values;
  const candidates = [
    values && values.title,
    values && values.sessionTitle,
    values && values.sessionListMetadata && values.sessionListMetadata.title,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (value && typeof value.title === "string" && value.title.trim()) return value.title.trim();
  }
  if (session && session.cwd) {
    const normalized = String(session.cwd).replace(/[\\/]+$/, "");
    return normalized.split(/[\\/]/).pop() || "New session";
  }
  return "New session";
}

function messagesFromHistory(entries) {
  if (!Array.isArray(entries)) return [];
  const boundedEntries = boundedHistoryEntries(entries);
  const messages = [];
  const hiddenCommandIds = new Set(boundedEntries
    .map((entry) => entry?.event)
    .filter((event) => event?.type === "command/run"
      && event.data?.name === "permission"
      && String(event.data?.args || "").trim() === "danger-full-access")
    .map((event) => String(event.data.commandId || ""))
    .filter(Boolean));
  for (const entry of boundedEntries) {
    const event = entry && entry.event;
    if (!event || !event.data) continue;
    if (event.type === "user/message") {
      if (event.data.source && !["user", "user-rpc"].includes(event.data.source.kind)) continue;
      const { text, attachments } = userContentFromBlocks(event.data.content);
      if (text || attachments.length) messages.push({ role: "user", text, attachments, time: event.time, seq: event.seq });
    } else if (event.type === "assistant/message") {
      const blocks = event.data.message && event.data.message.content;
      const text = textFromBlocks(blocks);
      if (text) messages.push({ role: "assistant", text, time: event.time, seq: event.seq });
    } else if (event.type === "command/run" && event.data.source && event.data.source.kind === "user") {
      if (hiddenCommandIds.has(String(event.data.commandId || ""))) continue;
      const text = `/${event.data.name}${event.data.args || ""}`;
      messages.push({ role: "user", text, time: event.time, seq: event.seq });
    } else if (event.type === "command/done" && event.data.text) {
      if (hiddenCommandIds.has(String(event.data.commandId || ""))) continue;
      messages.push({
        role: event.data.kind === "error" ? "error" : "command",
        text: event.data.text,
        time: event.time,
        seq: event.seq,
      });
    } else if (event.type === "turn/end" && event.data.reason && event.data.reason.kind === "error") {
      const detail = event.data.reason.error || event.data.reason.failure || {};
      messages.push({
        role: "error",
        text: detail.message || "The model ended the turn with an error",
        time: event.time,
        seq: event.seq,
      });
    }
  }
  messages.push(...toolMessagesFromHistory(boundedEntries));
  return messages.sort((left, right) => (left.seq || 0) - (right.seq || 0));
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

class HarnessApi {
  constructor(baseUrl = "http://127.0.0.1:3080", fetchImpl = globalThis.fetch, options = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.fetch = fetchImpl;
    this.sessionStateCache = new Map();
    this.historyCache = new Map();
    this.historyCacheSessionLimit = positiveInteger(options.historyCacheSessionLimit, HISTORY_CACHE_SESSION_LIMIT);
    this.historyCacheEventLimit = positiveInteger(options.historyCacheEventLimit, HISTORY_CACHE_EVENT_LIMIT);
    this.historyCacheBytesLimit = positiveInteger(options.historyCacheBytesLimit, HISTORY_CACHE_BYTES_LIMIT);
    this.fullAccessSessions = new Set();
    this.workspaceSnapshot = { items: [], archivedSessionIds: [] };
  }

  cachedHistory(sessionId) {
    const key = String(sessionId || "");
    const cached = this.historyCache.get(key) || null;
    if (!cached) return null;
    this.historyCache.delete(key); this.historyCache.set(key, cached);
    return cached;
  }

  cacheHistory(sessionId, value) {
    const key = String(sessionId || "");
    this.historyCache.delete(key); this.historyCache.set(key, value);
    while (this.historyCache.size > this.historyCacheSessionLimit) this.historyCache.delete(this.historyCache.keys().next().value);
  }

  async rpc(method, payload = {}, timeoutMs = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const rpcId = randomUUID();
    try {
      const response = await this.fetch(`${this.baseUrl}/api/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "client-request", rpcId, method, payload }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Harness HTTP ${response.status}`);
      const envelope = await response.json();
      if (envelope.rpcId !== rpcId) throw new Error(`Harness rpcId mismatch for ${method}`);
      if (!envelope.result || !envelope.result.ok) {
        const error = envelope.result && envelope.result.error;
        throw new Error(error && error.message ? error.message : `Harness rejected ${method}`);
      }
      return envelope.result.value;
    } finally {
      clearTimeout(timer);
    }
  }

  async dashboard() {
    const [host, sessionsValue, workspaceResult] = await Promise.all([
      this.rpc("host.describe"),
      this.rpc("session.list"),
      this.rpc("workspace.list", {}, 4000)
        .then((value) => ({ value, degraded: false }))
        .catch(() => ({ value: this.workspaceSnapshot, degraded: true })),
    ]);
    const workspaceDegraded = workspaceResult.degraded;
    const workspaceValue = workspaceResult.value || this.workspaceSnapshot;
    if (!workspaceDegraded) {
      this.workspaceSnapshot = {
        items: Array.isArray(workspaceValue?.items) ? workspaceValue.items : [],
        archivedSessionIds: Array.isArray(workspaceValue?.archivedSessionIds) ? workspaceValue.archivedSessionIds : [],
      };
    }
    const archivedSessionIds = Array.isArray(workspaceValue?.archivedSessionIds) ? workspaceValue.archivedSessionIds : [];
    const archived = new Set(archivedSessionIds);
    const workspaceBySessionId = new Map();
    for (const workspace of Array.isArray(workspaceValue?.items) ? workspaceValue.items : []) {
      for (const sessionId of Array.isArray(workspace?.sessionIds) ? workspace.sessionIds : []) {
        if (!workspaceBySessionId.has(sessionId)) workspaceBySessionId.set(sessionId, workspace.workspaceId);
      }
    }
    const sessions = (sessionsValue.items || []).filter((session) => session.origin !== "subagent" && !archived.has(session.sessionId));
    const enriched = await Promise.all(sessions.map(async (session, index) => {
      const cachedState = this.sessionStateCache.get(session.sessionId);
      const shouldEnrich = Boolean(session.running || index < 18);
      const shouldReadState = shouldEnrich && (!cachedState || cachedState.updatedAt !== session.updatedAt);
      // The subagent roster only changes with the session itself, so it is reused from
      // the cache exactly like history is. Refetching it for every session on every
      // 2.5s poll was one request per session per tick with nothing to show for it.
      let degraded = false;
      const [catalog, historyValue] = await Promise.all([
        shouldReadState
          ? this.rpc("subagent.list", { parentSessionId: session.sessionId }, 4000).catch(() => {
              degraded = true;
              return null;
            })
          : Promise.resolve(null),
        shouldReadState
          ? this.rpc("session.history", { sessionId: session.sessionId, maxMessages: session.running ? 120 : 12 }, 6000).catch(() => {
              degraded = true;
              return null;
            })
          : Promise.resolve(null),
      ]);
      const subagents = catalog ? (catalog.entries || []) : (cachedState?.subagents ?? []);
      const events = historyValue?.events || [];
      // session.list may remain running=true briefly after the turn has ended.
      // When history is available, only a genuinely open turn is authoritative.
      const activity = historyValue ? activityFromHistory(events) : null;
      const effectiveRunning = historyValue
        ? Boolean(activity?.active)
        : Boolean(session.running);
      const agentState = historyValue
        ? sessionStateFromHistory(events, effectiveRunning)
        : (effectiveRunning ? "working" : cachedState?.state === "error" ? "error" : "idle");
      const latestAssistant = historyValue
        ? messagesFromHistory(events).findLast((message) => message.role === "assistant")
        : null;
      const preview = latestAssistant?.text || cachedState?.preview || "";
      this.sessionStateCache.set(session.sessionId, {
        updatedAt: historyValue ? session.updatedAt : cachedState?.updatedAt,
        state: agentState,
        preview,
        subagents,
      });
      return {
        ...session,
        ...(workspaceBySessionId.has(session.sessionId) ? { workspaceId: workspaceBySessionId.get(session.sessionId) } : {}),
        running: effectiveRunning,
        title: titleFromSession(session),
        subagents,
        degraded,
        activity,
        state: agentState,
        preview,
      };
    }));
    return {
      host,
      sessions: enriched,
      workspaces: Array.isArray(workspaceValue?.items) ? workspaceValue.items : [],
      archivedSessionIds,
      workspaceDegraded,
    };
  }

  async history(sessionId) {
    const key = String(sessionId || "");
    const cachedHistory = this.cachedHistory(key);
    const cached = cachedHistory?.events || [];
    const cachedSequences = new Set(cached.map((entry) => entry?.event?.seq).filter(Number.isFinite));
    const pages = [];
    let page = await this.rpc("session.history", { sessionId, maxMessages: 80 });
    const tailHasMore = Boolean(page.hasMore);
    pages.push(boundedHistoryEntries(page.events || []));
    let overlapsCache = pages[0].some((entry) => cachedSequences.has(entry?.event?.seq));
    let beforeSeq = Infinity;
    while (page.hasMore && (!cachedHistory?.complete || !overlapsCache)) {
      const oldestSeq = Math.min(...pages.at(-1).map((entry) => entry?.event?.seq).filter(Number.isFinite));
      if (!Number.isFinite(oldestSeq) || oldestSeq >= beforeSeq) throw new Error("Harness history pagination made no progress");
      beforeSeq = oldestSeq;
      page = await this.rpc("session.history", { sessionId, beforeSeq, maxMessages: 80 });
      // The newest tail owns the preview budget; strip older pages before fetching more.
      const events = boundedHistoryEntries(page.events || [], 0);
      pages.push(events);
      overlapsCache = events.some((entry) => cachedSequences.has(entry?.event?.seq));
    }
    const entries = tailHasMore
      ? [...cached, ...pages.flat()]
      : pages.flat();
    const sequenced = new Map();
    const unsequenced = [];
    for (const entry of entries) {
      const seq = entry?.event?.seq;
      if (Number.isFinite(seq)) sequenced.set(seq, entry);
      else unsequenced.push(entry);
    }
    const events = [...sequenced.entries()].sort(([left], [right]) => left - right).map(([, entry]) => entry).concat(unsequenced);
    const boundedEvents = boundedHistoryEntries(events);
    const revision = historyRevision(boundedEvents);
    const cacheBound = boundedHistoryCacheEntries(boundedEvents, { maxEvents: this.historyCacheEventLimit, maxBytes: this.historyCacheBytesLimit });
    const sourceComplete = !page.hasMore || Boolean(overlapsCache && cachedHistory?.complete);
    const cache = { bytes: cacheBound.bytes, complete: sourceComplete && !cacheBound.truncated, eventCount: cacheBound.entries.length };
    this.cacheHistory(key, { bytes: cache.bytes, complete: cache.complete, events: cacheBound.entries, revision });
    return {
      messages: messagesFromHistory(boundedEvents),
      activity: activityFromHistory(boundedEvents),
      revision,
      unchanged: cachedHistory?.revision === revision,
      cache,
    };
  }

  async createSession(options = {}) {
    const value = await this.rpc("session.create", options);
    return value.sessionId;
  }

  async workspaces() {
    const value = await this.rpc("workspace.list", {});
    this.workspaceSnapshot = {
      items: Array.isArray(value?.items) ? value.items : [],
      archivedSessionIds: Array.isArray(value?.archivedSessionIds) ? value.archivedSessionIds : [],
    };
    return this.workspaceSnapshot.items;
  }

  async createWorkspace(workspacePath) {
    return this.rpc("workspace.create", { path: workspacePath });
  }

  async models(sessionId) {
    if (sessionId) return this.rpc("session.models", { sessionId }, 20000);
    const value = await this.rpc("llm.models", {}, 20000);
    return { current: null, routable: true, groups: value.groups || [], failures: value.failures || [] };
  }

  // The spread used to come last, so a renderer-supplied selection.sessionId would
  // silently overwrite the real one and retarget the call at another session.
  async selectModel(sessionId, selection) {
    return this.rpc("session.selectModel", { ...(selection || {}), sessionId }, 20000);
  }

  async prompt(sessionId, text, timeZone, images = []) {
    const content = [];
    if (text) content.push({ type: "text", text });
    for (const image of images) {
      content.push({ type: "image", mediaType: image.mediaType, data: image.data, name: image.name });
    }
    return this.rpc("session.prompt", {
      sessionId,
      mode: "queue",
      content,
      ...(timeZone ? { clientTimeZone: timeZone } : {}),
    }, 30000);
  }

  async cancel(sessionId) {
    return this.rpc("session.cancel", { sessionId });
  }

  async updateQueue(sessionId, itemId, action) {
    return this.rpc("session.updateQueue", { sessionId, itemId, action }, 10000);
  }

  async commands(sessionId) {
    return this.rpc("commands/list", { args: { agentId: sessionId } }, 10000);
  }

  async executeCommand(sessionId, line, images = []) {
    return this.rpc("commands/execute", {
      args: { agentId: sessionId, line, images },
    }, 30000);
  }

  async executeWidgetCommand(sessionId, line, images = []) {
    const normalized = String(line || "").trim();
    if (/^\/permission(?:\s|$)/i.test(normalized)) {
      const permission = normalized.match(/^\/permission\s+([^\s]+)\s*$/i);
      if (!permission || permission[1] !== "danger-full-access") {
        throw new Error("Widget sessions always use Full access");
      }
    }
    return this.executeCommand(sessionId, normalized, images);
  }

  // The permission is a property of the session, not of a single turn. Running it
  // before every prompt added a second 30s-timeout RPC to each send, doubling the
  // latency the user feels, and Harness itself has to be told only once.
  async ensureFullAccess(sessionId) {
    const key = String(sessionId || "");
    if (!key) throw new Error("A session id is required to enable Full access");
    if (this.fullAccessSessions.has(key)) return null;
    const response = await this.executeCommand(key, "/permission danger-full-access");
    if (response?.result?.kind !== "success") {
      throw new Error(response?.result?.text || "Harness did not enable Full access");
    }
    this.fullAccessSessions.add(key);
    return response;
  }

  forgetSession(sessionId) {
    const key = String(sessionId || "");
    this.fullAccessSessions.delete(key);
    this.sessionStateCache.delete(key);
    this.historyCache.delete(key);
  }
}

module.exports = {
  HISTORY_PREVIEW_BYTES_BUDGET,
  HarnessApi,
  activityFromHistory,
  boundedHistoryEntries,
  messagesFromHistory,
  readableToolValue,
  reasoningFromBlocks,
  sessionStateFromHistory,
  textFromBlocks,
  titleFromSession,
  toolMessagesFromHistory,
  toolResultFromBlocks,
  userContentFromBlocks,
};
