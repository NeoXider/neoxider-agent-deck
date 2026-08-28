const { randomUUID } = require("node:crypto");

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
  const messages = [];
  const hiddenCommandIds = new Set(entries
    .map((entry) => entry?.event)
    .filter((event) => event?.type === "command/run"
      && event.data?.name === "permission"
      && String(event.data?.args || "").trim() === "danger-full-access")
    .map((event) => String(event.data.commandId || ""))
    .filter(Boolean));
  for (const entry of entries) {
    const event = entry && entry.event;
    if (!event || !event.data) continue;
    if (event.type === "user/message") {
      if (event.data.source && !["user", "user-rpc"].includes(event.data.source.kind)) continue;
      const text = textFromBlocks(event.data.content);
      if (text) messages.push({ role: "user", text, time: event.time, seq: event.seq });
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
  messages.push(...toolMessagesFromHistory(entries));
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
  constructor(baseUrl = "http://127.0.0.1:3080", fetchImpl = globalThis.fetch) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.fetch = fetchImpl;
    this.sessionStateCache = new Map();
    this.fullAccessSessions = new Set();
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
    const [host, sessionsValue] = await Promise.all([
      this.rpc("host.describe"),
      this.rpc("session.list"),
    ]);
    const sessions = (sessionsValue.items || []).slice(0, 18);
    const enriched = await Promise.all(sessions.map(async (session) => {
      const cachedState = this.sessionStateCache.get(session.sessionId);
      const shouldReadState = session.running || !cachedState || cachedState.updatedAt !== session.updatedAt;
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
        running: effectiveRunning,
        title: titleFromSession(session),
        subagents,
        degraded,
        activity,
        state: agentState,
        preview,
      };
    }));
    return { host, sessions: enriched };
  }

  async history(sessionId) {
    const value = await this.rpc("session.history", { sessionId, maxMessages: 80 });
    return { messages: messagesFromHistory(value.events || []), activity: activityFromHistory(value.events || []) };
  }

  async createSession(options = {}) {
    const value = await this.rpc("session.create", options);
    return value.sessionId;
  }

  async workspaces() {
    const value = await this.rpc("workspace.list", {});
    return value.items || [];
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
    this.fullAccessSessions.delete(String(sessionId || ""));
    this.sessionStateCache.delete(String(sessionId || ""));
  }
}

module.exports = {
  HarnessApi,
  activityFromHistory,
  messagesFromHistory,
  readableToolValue,
  reasoningFromBlocks,
  sessionStateFromHistory,
  textFromBlocks,
  titleFromSession,
  toolMessagesFromHistory,
  toolResultFromBlocks,
};
