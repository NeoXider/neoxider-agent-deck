const { createHash } = require("node:crypto");
const { resultCallId, toMillis } = require("./session-activity.cjs");

const HISTORY_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const HISTORY_IMAGE_BASE64_LIMIT = Math.ceil(8 * 1024 * 1024 * 4 / 3) + 8;
const HISTORY_PREVIEW_BYTES_BUDGET = 1024 * 1024;
const HISTORY_CACHE_SESSION_LIMIT = 8;
const HISTORY_CACHE_EVENT_LIMIT = 800;
const HISTORY_CACHE_BYTES_LIMIT = 4 * 1024 * 1024;
const HISTORY_VIDEO_EXTENSIONS = new Set(["mp4", "mov", "m4v", "webm", "mkv", "avi", "wmv"]);

// The remote generation takes content blocks where the legacy one took plain text.
function adaptQueueAction(action) {
  if (!action || typeof action !== "object" || action.kind !== "edit") return action;
  const { text, ...rest } = action;
  return { ...rest, content: [{ type: "text", text }] };
}

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

function durationBetween(start, end) {
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

module.exports = {
  HISTORY_CACHE_BYTES_LIMIT,
  HISTORY_CACHE_EVENT_LIMIT,
  HISTORY_CACHE_SESSION_LIMIT,
  HISTORY_PREVIEW_BYTES_BUDGET,
  adaptQueueAction,
  boundedHistoryCacheEntries,
  boundedHistoryEntries,
  historyRevision,
  messagesFromHistory,
  positiveInteger,
  readableToolValue,
  reasoningFromBlocks,
  textFromBlocks,
  titleFromSession,
  toolMessagesFromHistory,
  toolResultFromBlocks,
  userContentFromBlocks,
};
