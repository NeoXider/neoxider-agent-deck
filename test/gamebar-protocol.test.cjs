const test = require("node:test");
const assert = require("node:assert/strict");

const {
  GameBarProtocolError,
  MAX_FRAME_BYTES,
  MAX_QUICK_REPLY_CHARS,
  commandErrorFrame,
  createRequestIdTracker,
  decodeFrame,
  encodeFrame,
} = require("../src/gamebar-protocol.cjs");

const REQUEST_ID = "request-0001";

function expectProtocolError(code, callback) {
  assert.throws(callback, (error) => {
    assert.equal(error instanceof GameBarProtocolError, true);
    assert.equal(error.code, code);
    return true;
  });
}

function roundTrip(frame, options) {
  return decodeFrame(Buffer.from(encodeFrame(frame), "utf8"), options);
}

function snapshotAt(updatedAt) {
  return {
    v: 1,
    type: "snapshot",
    revision: 1,
    status: "idle",
    sessionId: "opaque-session",
    sessionTitle: "Session",
    detail: "Ready",
    contextPercent: 0,
    unread: false,
    updatedAt,
  };
}

test("all v1 frame shapes encode as one bounded JSON line and round-trip", () => {
  const frames = [
    { v: 1, type: "hello", client: "gamebar", requestId: REQUEST_ID },
    {
      v: 1,
      type: "hello.ok",
      requestId: REQUEST_ID,
      serverVersion: "0.5.2",
      capabilities: ["snapshot", "ack", "open-session", "quick-reply"],
    },
    {
      v: 1,
      type: "snapshot",
      revision: 42,
      status: "writing",
      sessionId: "opaque-session",
      sessionTitle: "Проверка виджета",
      detail: "Writing response",
      contextPercent: 29.5,
      unread: true,
      updatedAt: "2026-08-27T12:00:00Z",
    },
    { v: 1, type: "command", requestId: "request-0002", command: "request-snapshot" },
    { v: 1, type: "command", requestId: "request-0003", command: "ack", sessionId: "opaque-session" },
    { v: 1, type: "command", requestId: "request-0004", command: "open-session", sessionId: "opaque-session" },
    {
      v: 1,
      type: "command",
      requestId: "request-0005",
      command: "quick-reply",
      sessionId: "opaque-session",
      text: "Continue\nwith tests",
    },
    { v: 1, type: "command.ok", requestId: "request-0005" },
    { v: 1, type: "command.error", requestId: "request-0005", code: "command-failed", message: "The command failed" },
  ];

  for (const frame of frames) {
    const line = encodeFrame(frame);
    assert.equal(line.endsWith("\n"), true);
    assert.equal(line.slice(0, -1).includes("\n"), false);
    assert.ok(Buffer.byteLength(line, "utf8") <= MAX_FRAME_BYTES);
    assert.deepEqual(roundTrip(frame), frame);
  }
});

test("unsupported versions, types, statuses, commands and extra fields are rejected", () => {
  expectProtocolError("unsupported-version", () => encodeFrame({
    v: 2, type: "hello", client: "gamebar", requestId: REQUEST_ID,
  }));
  expectProtocolError("unknown-type", () => encodeFrame({ v: 1, type: "surprise" }));
  expectProtocolError("unknown-status", () => encodeFrame({
    v: 1,
    type: "snapshot",
    revision: 1,
    status: "working",
    sessionId: "",
    sessionTitle: "",
    detail: "",
    contextPercent: 0,
    unread: false,
    updatedAt: "2026-08-27T12:00:00Z",
  }));
  expectProtocolError("unknown-command", () => encodeFrame({
    v: 1, type: "command", requestId: REQUEST_ID, command: "run-shell",
  }));
  expectProtocolError("invalid-field", () => encodeFrame({
    v: 1, type: "hello", client: "gamebar", requestId: REQUEST_ID, token: "must-not-cross",
  }));
});

test("hello requires the complete exact v1 capability set", () => {
  const helloOk = (capabilities) => ({
    v: 1,
    type: "hello.ok",
    requestId: REQUEST_ID,
    serverVersion: "0.5.2",
    capabilities,
  });
  assert.deepEqual(roundTrip(helloOk([
    "quick-reply", "open-session", "ack", "snapshot",
  ])).capabilities, ["quick-reply", "open-session", "ack", "snapshot"]);
  expectProtocolError("invalid-field", () => encodeFrame(helloOk([
    "snapshot", "ack", "open-session",
  ])));
  expectProtocolError("invalid-field", () => encodeFrame(helloOk([
    "snapshot", "ack", "open-session", "snapshot",
  ])));
  expectProtocolError("invalid-field", () => encodeFrame(helloOk([
    "snapshot", "ack", "open-session", "launch-shell",
  ])));
});

test("command-specific fields and text bounds are enforced", () => {
  expectProtocolError("invalid-field", () => encodeFrame({
    v: 1, type: "command", requestId: REQUEST_ID, command: "ack",
  }));
  expectProtocolError("invalid-field", () => encodeFrame({
    v: 1, type: "command", requestId: REQUEST_ID, command: "request-snapshot", sessionId: "smuggled",
  }));
  expectProtocolError("invalid-field", () => encodeFrame({
    v: 1,
    type: "command",
    requestId: REQUEST_ID,
    command: "quick-reply",
    sessionId: "opaque-session",
    text: " ".repeat(10),
  }));
  expectProtocolError("invalid-field", () => encodeFrame({
    v: 1,
    type: "command",
    requestId: REQUEST_ID,
    command: "quick-reply",
    sessionId: "opaque-session",
    text: "x".repeat(MAX_QUICK_REPLY_CHARS + 1),
  }));
});

test("quick replies allow LF but reject every other C0, DEL and C1 control", () => {
  assert.equal(roundTrip({
    v: 1,
    type: "command",
    requestId: REQUEST_ID,
    command: "quick-reply",
    sessionId: "opaque-session",
    text: "first\nsecond",
  }).text, "first\nsecond");

  const forbiddenControls = [];
  for (let code = 0; code <= 0x1f; code += 1) {
    if (code !== 0x0a) forbiddenControls.push(code);
  }
  for (let code = 0x7f; code <= 0x9f; code += 1) forbiddenControls.push(code);
  for (const code of forbiddenControls) {
    expectProtocolError("invalid-field", () => encodeFrame({
      v: 1,
      type: "command",
      requestId: REQUEST_ID,
      command: "quick-reply",
      sessionId: "opaque-session",
      text: `before${String.fromCharCode(code)}after`,
    }));
  }


  for (const text of [
    "\uFEFF",
    "\uFEFF\uFEFF",
    " \n\uFEFF ",
    "\u00A0\u2003\u2028\u2029\uFEFF",
  ]) {
    expectProtocolError("invalid-field", () => encodeFrame({
      v: 1,
      type: "command",
      requestId: REQUEST_ID,
      command: "quick-reply",
      sessionId: "opaque-session",
      text,
    }));
  }
  assert.equal(roundTrip({
    v: 1,
    type: "command",
    requestId: REQUEST_ID,
    command: "quick-reply",
    sessionId: "opaque-session",
    text: "\uFEFFcontinue",
  }).text, "\uFEFFcontinue");
});

test("snapshot timestamps must be exact calendar-valid canonical UTC instants", () => {
  for (const timestamp of [
    "0001-01-01T00:00:00Z",
    "2024-02-29T23:59:59Z",
    "2026-08-27T12:00:00.1Z",
    "2026-08-27T12:00:00.12Z",
    "2026-08-27T12:00:00.123Z",
    "9999-12-31T23:59:59.999Z",
  ]) {
    assert.equal(roundTrip(snapshotAt(timestamp)).updatedAt, timestamp);
  }

  for (const timestamp of [
    "0000-01-01T00:00:00Z",
    "2025-02-29T12:00:00Z",
    "2026-02-31T12:00:00Z",
    "2026-08-27T24:00:00Z",
    "2026-08-27T12:00:60Z",
  ]) {
    expectProtocolError("invalid-field", () => encodeFrame(snapshotAt(timestamp)));
  }
});

test("request ids are unique for the full bounded connection and become stale by age", () => {
  let timestamp = 1_000;
  const requestIds = createRequestIdTracker({ now: () => timestamp, maxAgeMs: 100, maxEntries: 2 });
  const first = { v: 1, type: "hello", client: "gamebar", requestId: "request-1001" };
  assert.deepEqual(roundTrip(first, { requestIds }), first);
  expectProtocolError("duplicate-request", () => roundTrip(first, { requestIds }));

  timestamp += 101;
  expectProtocolError("stale-request", () => roundTrip(first, { requestIds }));
  roundTrip({ v: 1, type: "command", requestId: "request-1002", command: "request-snapshot" }, { requestIds });
  expectProtocolError("request-limit", () => roundTrip({
    v: 1, type: "command", requestId: "request-1003", command: "request-snapshot",
  }, { requestIds }));
  assert.equal(requestIds.size, 2);
});

test("malformed, multi-line, invalid UTF-8 and oversized frames fail before dispatch", () => {
  expectProtocolError("malformed-json", () => decodeFrame("{not json}\n"));
  expectProtocolError("invalid-frame", () => decodeFrame(`${encodeFrame({
    v: 1, type: "hello", client: "gamebar", requestId: REQUEST_ID,
  })}\n`));
  expectProtocolError("invalid-frame", () => decodeFrame(JSON.stringify({
    v: 1, type: "hello", client: "gamebar", requestId: REQUEST_ID,
  })));
  expectProtocolError("malformed-json", () => decodeFrame(Buffer.from([0xff, 0x0a])));
  expectProtocolError("oversized-frame", () => decodeFrame(Buffer.alloc(MAX_FRAME_BYTES + 1, 0x20)));
});

test("command errors expose fixed protocol messages and redact internal details", () => {
  const internal = new Error("token=secret C:\\Users\\User\\private.txt");
  internal.stack = "stack with API_KEY=secret";
  const safeInternal = commandErrorFrame(REQUEST_ID, internal);
  const encodedInternal = encodeFrame(safeInternal);
  assert.deepEqual(safeInternal, {
    v: 1,
    type: "command.error",
    requestId: REQUEST_ID,
    code: "internal-error",
    message: "The command failed",
  });
  assert.doesNotMatch(encodedInternal, /secret|Users|API_KEY|private/i);

  const duplicate = new GameBarProtocolError("duplicate-request");
  duplicate.message = "do not leak this override";
  const safeProtocol = commandErrorFrame(REQUEST_ID, duplicate);
  assert.equal(safeProtocol.code, "duplicate-request");
  assert.equal(safeProtocol.message, "The request identifier was already used");
  assert.doesNotMatch(encodeFrame(safeProtocol), /override|leak/i);
});
