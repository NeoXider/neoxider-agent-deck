const { TextDecoder } = require("node:util");

const PROTOCOL_VERSION = 1;
const MAX_FRAME_BYTES = 65_536;
const MAX_REQUEST_ID_CHARS = 64;
const MAX_SESSION_ID_CHARS = 256;
const MAX_QUICK_REPLY_CHARS = 4_000;
const DEFAULT_REQUEST_MAX_AGE_MS = 120_000;
const DEFAULT_REQUEST_LIMIT = 1_024;

const STATUSES = Object.freeze(["idle", "thinking", "writing", "tool", "waiting", "done", "error", "offline"]);
const COMMANDS = Object.freeze(["request-snapshot", "ack", "open-session", "quick-reply"]);
const CAPABILITIES = Object.freeze(["snapshot", "ack", "open-session", "quick-reply"]);
const STATUS_SET = new Set(STATUSES);
const COMMAND_SET = new Set(COMMANDS);
const CAPABILITY_SET = new Set(CAPABILITIES);
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,63}$/;
const CODE_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const ISO_UTC_PATTERN = /^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

const SAFE_ERROR_MESSAGES = Object.freeze({
  "duplicate-request": "The request identifier was already used",
  "internal-error": "The command failed",
  "invalid-field": "The frame contains an invalid field",
  "invalid-frame": "The frame is invalid",
  "malformed-json": "The frame is not valid JSON",
  "oversized-frame": "The frame exceeds the size limit",
  "request-limit": "The connection request limit was reached",
  "stale-request": "The request identifier is stale",
  "unknown-command": "The command is not supported",
  "unknown-status": "The status is not supported",
  "unknown-type": "The frame type is not supported",
  "unsupported-version": "The protocol version is not supported",
});

class GameBarProtocolError extends Error {
  constructor(code) {
    super(SAFE_ERROR_MESSAGES[code] || SAFE_ERROR_MESSAGES["invalid-frame"]);
    this.name = "GameBarProtocolError";
    this.code = SAFE_ERROR_MESSAGES[code] ? code : "invalid-frame";
  }
}

function fail(code) {
  throw new GameBarProtocolError(code);
}

function isRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireExactKeys(value, keys) {
  if (!isRecord(value)) fail("invalid-frame");
  const expected = new Set(keys);
  const actual = Object.keys(value);
  if (actual.length !== expected.size || actual.some((key) => !expected.has(key))) fail("invalid-field");
}

function requireString(value, { min = 0, max, pattern, allowLineBreaks = false } = {}) {
  if (typeof value !== "string" || value.length < min || value.length > max) fail("invalid-field");
  // Multiline command text permits LF only. Tabs, CR and every other C0,
  // DEL and C1 control remain invalid so they cannot create alternate forms.
  if ((!allowLineBreaks && /[\u0000-\u001f\u007f-\u009f]/.test(value))
    || (allowLineBreaks && /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/.test(value))) {
    fail("invalid-field");
  }
  if (pattern && !pattern.test(value)) fail("invalid-field");
  return value;
}

function requireRequestId(value) {
  return requireString(value, { min: 8, max: MAX_REQUEST_ID_CHARS, pattern: REQUEST_ID_PATTERN });
}

function requireSessionId(value) {
  return requireString(value, { min: 1, max: MAX_SESSION_ID_CHARS });
}

function requireVersion(frame) {
  if (frame.v !== PROTOCOL_VERSION) fail("unsupported-version");
}

function requireUtcTimestamp(value) {
  const timestamp = requireString(value, { min: 20, max: 24, pattern: ISO_UTC_PATTERN });
  const milliseconds = Date.parse(timestamp);
  if (!Number.isFinite(milliseconds)) fail("invalid-field");

  const canonical = timestamp.includes(".")
    ? timestamp.replace(/\.(\d{1,3})Z$/, (_match, fraction) => `.${fraction.padEnd(3, "0")}Z`)
    : timestamp.replace(/Z$/, ".000Z");
  if (new Date(milliseconds).toISOString() !== canonical) fail("invalid-field");
  return timestamp;
}

function isBlankQuickReply(value) {
  return !value.replace(/\ufeff/g, "").trim();
}

function validateHello(frame) {
  requireExactKeys(frame, ["v", "type", "client", "requestId"]);
  if (frame.client !== "gamebar") fail("invalid-field");
  requireRequestId(frame.requestId);
}

function validateHelloOk(frame) {
  requireExactKeys(frame, ["v", "type", "requestId", "serverVersion", "capabilities"]);
  requireRequestId(frame.requestId);
  requireString(frame.serverVersion, { min: 1, max: 64, pattern: /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/ });
  if (!Array.isArray(frame.capabilities) || frame.capabilities.length !== CAPABILITIES.length) fail("invalid-field");
  const unique = new Set(frame.capabilities);
  if (unique.size !== frame.capabilities.length || frame.capabilities.some((value) => !CAPABILITY_SET.has(value))) fail("invalid-field");
}

function validateSnapshot(frame) {
  requireExactKeys(frame, [
    "v", "type", "revision", "status", "sessionId", "sessionTitle", "detail", "contextPercent", "unread", "updatedAt",
  ]);
  if (!Number.isSafeInteger(frame.revision) || frame.revision < 0) fail("invalid-field");
  if (!STATUS_SET.has(frame.status)) fail("unknown-status");
  requireString(frame.sessionId, { max: MAX_SESSION_ID_CHARS });
  requireString(frame.sessionTitle, { max: 160 });
  requireString(frame.detail, { max: 512 });
  if (typeof frame.contextPercent !== "number" || !Number.isFinite(frame.contextPercent)
    || frame.contextPercent < 0 || frame.contextPercent > 100) fail("invalid-field");
  if (typeof frame.unread !== "boolean") fail("invalid-field");
  requireUtcTimestamp(frame.updatedAt);
}

function validateCommand(frame) {
  if (!COMMAND_SET.has(frame.command)) fail("unknown-command");
  if (frame.command === "request-snapshot") {
    requireExactKeys(frame, ["v", "type", "requestId", "command"]);
  } else if (frame.command === "quick-reply") {
    requireExactKeys(frame, ["v", "type", "requestId", "command", "sessionId", "text"]);
    requireSessionId(frame.sessionId);
    requireString(frame.text, { min: 1, max: MAX_QUICK_REPLY_CHARS, allowLineBreaks: true });
    if (isBlankQuickReply(frame.text)) fail("invalid-field");
  } else {
    requireExactKeys(frame, ["v", "type", "requestId", "command", "sessionId"]);
    requireSessionId(frame.sessionId);
  }
  requireRequestId(frame.requestId);
}

function validateCommandOk(frame) {
  requireExactKeys(frame, ["v", "type", "requestId"]);
  requireRequestId(frame.requestId);
}

function validateCommandError(frame) {
  requireExactKeys(frame, ["v", "type", "requestId", "code", "message"]);
  requireRequestId(frame.requestId);
  requireString(frame.code, { min: 1, max: 64, pattern: CODE_PATTERN });
  requireString(frame.message, { min: 1, max: 256 });
}

const TYPE_VALIDATORS = Object.freeze({
  hello: validateHello,
  "hello.ok": validateHelloOk,
  snapshot: validateSnapshot,
  command: validateCommand,
  "command.ok": validateCommandOk,
  "command.error": validateCommandError,
});

function validateFrame(frame) {
  if (!isRecord(frame)) fail("invalid-frame");
  requireVersion(frame);
  if (typeof frame.type !== "string" || !TYPE_VALIDATORS[frame.type]) fail("unknown-type");
  TYPE_VALIDATORS[frame.type](frame);
  return frame;
}

function createRequestIdTracker({
  now = Date.now,
  maxAgeMs = DEFAULT_REQUEST_MAX_AGE_MS,
  maxEntries = DEFAULT_REQUEST_LIMIT,
} = {}) {
  if (typeof now !== "function" || !Number.isFinite(maxAgeMs) || maxAgeMs < 1
    || !Number.isSafeInteger(maxEntries) || maxEntries < 1) throw new TypeError("Invalid request tracker options");
  const seenAt = new Map();
  return Object.freeze({
    accept(requestId) {
      requireRequestId(requestId);
      const timestamp = Number(now());
      if (!Number.isFinite(timestamp)) throw new TypeError("Request tracker clock must return a finite number");
      if (seenAt.has(requestId)) {
        const age = Math.max(0, timestamp - seenAt.get(requestId));
        fail(age > maxAgeMs ? "stale-request" : "duplicate-request");
      }
      // Never evict a request id on a live connection: eviction would make a replay
      // look new. The caller must close/reconnect when this bounded limit is reached.
      if (seenAt.size >= maxEntries) fail("request-limit");
      seenAt.set(requestId, timestamp);
      return requestId;
    },
    get size() { return seenAt.size; },
  });
}

function decodeUtf8(line) {
  if (typeof line === "string") return line;
  if (!Buffer.isBuffer(line) && !(line instanceof Uint8Array)) fail("invalid-frame");
  try {
    return utf8Decoder.decode(line);
  } catch {
    fail("malformed-json");
  }
}

function decodeFrame(line, { requestIds } = {}) {
  const byteLength = typeof line === "string" ? Buffer.byteLength(line, "utf8") : line?.byteLength;
  if (!Number.isSafeInteger(byteLength) || byteLength > MAX_FRAME_BYTES) fail("oversized-frame");
  const text = decodeUtf8(line);
  if (!text.endsWith("\n") || text.indexOf("\n") !== text.length - 1 || text.includes("\r")) fail("invalid-frame");
  let frame;
  try {
    frame = JSON.parse(text.slice(0, -1));
  } catch {
    fail("malformed-json");
  }
  validateFrame(frame);
  if ((frame.type === "hello" || frame.type === "command") && requestIds) requestIds.accept(frame.requestId);
  return frame;
}

function encodeFrame(frame) {
  validateFrame(frame);
  let line;
  try {
    line = `${JSON.stringify(frame)}\n`;
  } catch {
    fail("invalid-frame");
  }
  if (Buffer.byteLength(line, "utf8") > MAX_FRAME_BYTES) fail("oversized-frame");
  return line;
}

function commandErrorFrame(requestId, error) {
  requireRequestId(requestId);
  const safeCode = error instanceof GameBarProtocolError && SAFE_ERROR_MESSAGES[error.code]
    ? error.code
    : "internal-error";
  return {
    v: PROTOCOL_VERSION,
    type: "command.error",
    requestId,
    code: safeCode,
    message: SAFE_ERROR_MESSAGES[safeCode],
  };
}

module.exports = {
  CAPABILITIES,
  COMMANDS,
  DEFAULT_REQUEST_LIMIT,
  DEFAULT_REQUEST_MAX_AGE_MS,
  GameBarProtocolError,
  MAX_FRAME_BYTES,
  MAX_QUICK_REPLY_CHARS,
  PROTOCOL_VERSION,
  STATUSES,
  commandErrorFrame,
  createRequestIdTracker,
  decodeFrame,
  encodeFrame,
  validateFrame,
};
