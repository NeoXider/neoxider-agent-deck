const { randomUUID } = require("node:crypto");

function textFromBlocks(blocks) {
  if (!Array.isArray(blocks)) return "";
  return blocks
    .filter((block) => block && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
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
  for (const entry of entries) {
    const event = entry && entry.event;
    if (!event || !event.data) continue;
    if (event.type === "user/message") {
      if (event.data.source && !["user", "user-rpc"].includes(event.data.source.kind)) continue;
      const text = textFromBlocks(event.data.content);
      if (text) messages.push({ role: "user", text, time: event.time, seq: event.seq });
    } else if (event.type === "assistant/message") {
      const text = textFromBlocks(event.data.message && event.data.message.content);
      if (text) messages.push({ role: "assistant", text, time: event.time, seq: event.seq });
    } else if (event.type === "command/run" && event.data.source && event.data.source.kind === "user") {
      const text = `/${event.data.name}${event.data.args || ""}`;
      messages.push({ role: "user", text, time: event.time, seq: event.seq });
    } else if (event.type === "command/done" && event.data.text) {
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
  return messages.sort((left, right) => (left.seq || 0) - (right.seq || 0));
}

class HarnessApi {
  constructor(baseUrl = "http://127.0.0.1:3080", fetchImpl = globalThis.fetch) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.fetch = fetchImpl;
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
      try {
        const catalog = await this.rpc("subagent.list", { parentSessionId: session.sessionId }, 4000);
        return { ...session, title: titleFromSession(session), subagents: catalog.entries || [] };
      } catch {
        return { ...session, title: titleFromSession(session), subagents: [] };
      }
    }));
    return { host, sessions: enriched };
  }

  async history(sessionId) {
    const value = await this.rpc("session.history", { sessionId, maxMessages: 80 });
    return messagesFromHistory(value.events || []);
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

  async selectModel(sessionId, selection) {
    return this.rpc("session.selectModel", { sessionId, ...selection }, 20000);
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

  async commands(sessionId) {
    return this.rpc("commands/list", { args: { agentId: sessionId } }, 10000);
  }

  async executeCommand(sessionId, line) {
    return this.rpc("commands/execute", {
      args: { agentId: sessionId, line, images: [] },
    }, 30000);
  }
}

module.exports = { HarnessApi, messagesFromHistory, textFromBlocks, titleFromSession };
