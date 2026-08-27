const test = require("node:test");
const assert = require("node:assert/strict");

const { validateFrame } = require("../src/gamebar-protocol.cjs");
const {
  createGameBarSnapshotState,
  deriveContextPercent,
  isValidSessionId,
  safeSessionTitle,
} = require("../src/gamebar-snapshot.cjs");

function clock(start = Date.parse("2026-08-27T12:00:00.000Z")) {
  let value = start;
  return {
    now: () => value,
    advance(milliseconds = 1_000) { value += milliseconds; },
  };
}

function session(overrides = {}) {
  return {
    sessionId: "session-a",
    title: "Release verification",
    updatedAt: 100,
    running: false,
    state: "idle",
    activity: null,
    preview: "",
    projections: { values: {} },
    ...overrides,
  };
}

function dashboard(sessions, overrides = {}) {
  return { ok: true, harness: true, sessions, ...overrides };
}

test("snapshots use the protocol-v1 shape and map authoritative activity kinds", () => {
  for (const kind of ["thinking", "writing", "tool"]) {
    const time = clock();
    const state = createGameBarSnapshotState({ now: time.now });
    const snapshot = state.update(dashboard([session({
      running: true,
      activity: { active: true, kind, label: "unsafe", text: "private reasoning" },
    })]), "session-a");

    assert.equal(snapshot.status, kind);
    assert.equal(snapshot.detail, kind === "writing" ? "Writing response" : kind === "tool" ? "Using tool" : "Thinking");
    assert.equal(validateFrame(snapshot), snapshot);
    assert.doesNotMatch(JSON.stringify(snapshot), /private reasoning|unsafe/);
  }
});

test("a stale running flag without authoritative activity maps to waiting", () => {
  const state = createGameBarSnapshotState({ now: clock().now });
  const snapshot = state.update(dashboard([session({
    running: true,
    state: "working",
    activity: null,
  })]), "session-a");

  assert.equal(snapshot.status, "waiting");
  assert.equal(snapshot.detail, "Waiting for agent");
});

test("running-to-idle completion becomes done and stays unread until its exact session is acknowledged", () => {
  const time = clock();
  const state = createGameBarSnapshotState({ now: time.now });
  const running = state.update(dashboard([session({ running: true })]), "session-a");
  time.advance();
  const done = state.update(dashboard([session({
    running: false,
    updatedAt: 200,
    preview: "Completed response",
  })]), "session-a");

  assert.equal(running.status, "waiting");
  assert.equal(done.status, "done");
  assert.equal(done.unread, true);
  assert.equal(done.revision, running.revision + 1);
  assert.equal(done.updatedAt, "2026-08-27T12:00:01.000Z");

  const unchanged = state.update(dashboard([session({
    running: false,
    updatedAt: 200,
    preview: "Completed response",
  })]), "session-a");
  assert.strictEqual(unchanged, done);

  time.advance();
  const acknowledged = state.ack("session-a");
  assert.equal(acknowledged.status, "done");
  assert.equal(acknowledged.unread, false);
  assert.equal(acknowledged.revision, done.revision + 1);
});

test("an existing error is a read baseline while a distinct later error becomes unread", () => {
  const state = createGameBarSnapshotState({ now: clock().now });
  const error = state.update(dashboard([session({
    state: "error",
    running: true,
    activity: { active: true, kind: "writing", text: "raw failure" },
    preview: "secret failure output",
  })]), "session-a");
  assert.equal(error.status, "error");
  assert.equal(error.unread, false);

  const acknowledged = state.ack("session-a");
  assert.equal(acknowledged.unread, false);
  const unchanged = state.update(dashboard([session({
    state: "error",
    running: true,
    activity: { active: true, kind: "writing", text: "raw failure" },
    preview: "secret failure output",
  })]), "session-a");
  assert.strictEqual(unchanged, acknowledged);

  const distinct = state.update(dashboard([session({
    state: "error",
    running: false,
    updatedAt: 999,
    preview: "a different failure",
    error: { code: "MODEL_UNAVAILABLE", message: "Model unavailable" },
  })]), "session-a");
  assert.equal(distinct.status, "error");
  assert.equal(distinct.unread, true);
});

test("a new assistant result is done and unread even when polling missed the running transition", () => {
  const state = createGameBarSnapshotState({ now: clock().now });
  const initial = state.update(dashboard([session({ preview: "Earlier result", replyAt: 100 })]), "session-a");
  assert.equal(initial.unread, false);

  const result = state.update(dashboard([session({ preview: "New result", replyAt: 200, updatedAt: 200 })]), "session-a");
  assert.equal(result.status, "done");
  assert.equal(result.unread, true);
});

test("session updatedAt changes do not turn the previous assistant result unread", () => {
  const state = createGameBarSnapshotState({ now: clock().now });
  state.update(dashboard([session({ preview: "Earlier result", updatedAt: 100 })]), "session-a");
  const running = state.update(dashboard([session({
    preview: "Earlier result",
    updatedAt: 200,
    running: true,
    activity: { active: true, kind: "thinking" },
  })]), "session-a");

  assert.equal(running.status, "thinking");
  assert.equal(running.unread, false);
});

test("an authoritative reply timestamp distinguishes otherwise identical assistant replies", () => {
  const state = createGameBarSnapshotState({ now: clock().now });
  state.update(dashboard([session({ preview: "Same text", replyAt: 100 })]), "session-a");
  const repeated = state.update(dashboard([session({ preview: "Same text", replyAt: 200 })]), "session-a");

  assert.equal(repeated.status, "done");
  assert.equal(repeated.unread, true);
});

test("acknowledgement is isolated per session and hidden session changes do not bump the visible revision", () => {
  const state = createGameBarSnapshotState({ now: clock().now });
  const first = session({ sessionId: "first", updatedAt: 200, running: true });
  const second = session({ sessionId: "second", updatedAt: 100, running: true });
  const visible = state.update(dashboard([first, second]), "first");

  const hiddenCompletion = state.update(dashboard([
    first,
    session({ sessionId: "second", updatedAt: 300, running: false, preview: "Second done" }),
  ]), "first");
  assert.strictEqual(hiddenCompletion, visible);

  const hiddenAck = state.ack("second");
  assert.strictEqual(hiddenAck, visible);
  assert.equal(state.update(dashboard([
    first,
    session({ sessionId: "second", updatedAt: 300, running: false, preview: "Second done" }),
  ]), "second").unread, false);
});

test("valid selection wins; an absent selection falls back to the most recently active or replied session", () => {
  const state = createGameBarSnapshotState({ now: clock().now });
  const olderSelected = session({ sessionId: "selected", updatedAt: 100 });
  const latestReply = session({ sessionId: "latest", updatedAt: 300, replyAt: 400, preview: "Ready" });
  const selected = state.update(dashboard([latestReply, olderSelected]), "selected");
  assert.equal(selected.sessionId, "selected");

  const fallback = state.update(dashboard([
    session({ sessionId: "latest", updatedAt: 300, replyAt: 400, preview: "Ready" }),
    session({ sessionId: "active", updatedAt: 500, running: true }),
  ]));
  assert.equal(fallback.sessionId, "active");
  assert.equal(fallback.status, "waiting");
});

test("active and replied sessions outrank a newer empty idle session", () => {
  const state = createGameBarSnapshotState({ now: clock().now });
  const active = state.update(dashboard([
    session({ sessionId: "active", running: true, updatedAt: 900 }),
    session({ sessionId: "empty", updatedAt: 1_000 }),
  ]));
  assert.equal(active.sessionId, "active");

  const replied = state.update(dashboard([
    session({ sessionId: "replied", preview: "Answer", replyAt: 800, updatedAt: 800 }),
    session({ sessionId: "empty", updatedAt: 2_000 }),
  ]));
  assert.equal(replied.sessionId, "replied");
});

test("reordered equal candidates preserve selection, revision, timestamp, and object identity", () => {
  const time = clock();
  const state = createGameBarSnapshotState({ now: time.now });
  const a = session({ sessionId: "a", updatedAt: 100 });
  const b = session({ sessionId: "b", updatedAt: 100 });
  const first = state.update(dashboard([b, a]));
  assert.equal(first.sessionId, "a");

  time.advance();
  const reordered = state.update(dashboard([a, b]));
  assert.strictEqual(reordered, first);
  assert.equal(reordered.revision, first.revision);
  assert.equal(reordered.updatedAt, first.updatedAt);
});

test("selection disappearance preserves transition history but cannot be acknowledged or routed", () => {
  const state = createGameBarSnapshotState({ now: clock().now });
  state.update(dashboard([session({ sessionId: "gone", running: true })]), "gone");
  state.update(dashboard([session({ sessionId: "gone", running: false, preview: "Done", updatedAt: 200 })]), "gone");

  const fallbackSession = session({ sessionId: "remaining", updatedAt: 300 });
  const fallback = state.update(dashboard([fallbackSession]));
  assert.equal(fallback.sessionId, "remaining");
  assert.equal(state.getSession("gone"), null);
  assert.throws(() => state.ack("gone"), /Unknown Harness session/);
  assert.strictEqual(state.requireSession("remaining"), fallbackSession);

  const reappeared = state.update(dashboard([
    session({ sessionId: "gone", running: false, preview: "Done", updatedAt: 200 }),
  ]), "gone");
  assert.equal(reappeared.status, "done");
  assert.equal(reappeared.unread, true);
});

test("acknowledgement survives transient offline state and an identical error reappearing", () => {
  const state = createGameBarSnapshotState({ now: clock().now });
  state.update(dashboard([session({ state: "error", preview: "Same failure", updatedAt: 100 })]), "session-a");
  state.ack("session-a");

  const offline = state.update({ ok: false, sessions: [] });
  assert.equal(offline.status, "offline");
  const recovered = state.update(dashboard([
    session({ state: "error", preview: "Same failure", updatedAt: 999 }),
  ]), "session-a");
  assert.equal(recovered.status, "error");
  assert.equal(recovered.unread, false);
});

test("a resolved error followed by another error is a new unread transition", () => {
  const state = createGameBarSnapshotState({ now: clock().now });
  state.update(dashboard([session({ state: "error", preview: "Failure" })]), "session-a");
  state.ack("session-a");
  state.update(dashboard([session({ state: "idle", preview: "Failure" })]), "session-a");
  const repeated = state.update(dashboard([session({ state: "error", preview: "Failure" })]), "session-a");

  assert.equal(repeated.status, "error");
  assert.equal(repeated.unread, true);
});

test("context percentage is derived from projections, bounded, and zero without a session", () => {
  assert.equal(deriveContextPercent(session({
    projections: { values: { contextPressure: { projectedTokens: 25, contextWindow: 100 } } },
  })), 25);
  assert.equal(deriveContextPercent(session({
    projections: { values: { contextPressure: { pressureTokens: 120, contextWindow: 100 } } },
  })), 100);
  assert.equal(deriveContextPercent(session({
    projections: { values: { contextPressure: { projectedTokens: -20, contextWindow: 100 } } },
  })), 0);
  assert.equal(deriveContextPercent(session({
    projections: { values: { contextPressure: { projectedTokens: 20, contextWindow: 0 } } },
  })), 0);

  const state = createGameBarSnapshotState({ now: clock().now });
  const empty = state.update(dashboard([]));
  assert.equal(empty.status, "idle");
  assert.equal(empty.sessionId, "");
  assert.equal(empty.sessionTitle, "");
  assert.equal(empty.contextPercent, 0);
  assert.equal(empty.unread, false);
});

test("offline and redacted snapshots never carry prompts, paths, credentials, previews, or raw errors", () => {
  const state = createGameBarSnapshotState({ now: clock().now });
  const unsafe = state.update(dashboard([session({
    title: "C:\\Users\\User\\secret-project",
    cwd: "C:\\Users\\User\\secret-project",
    prompt: "Do not expose this prompt",
    preview: "assistant result with sk-secretcredential123456",
    apiKey: "sk-secretcredential123456",
    error: { message: "password=opensesame" },
    activity: { active: true, kind: "tool", label: "Shell", text: "cat C:\\private\\credentials" },
    running: true,
  })]), "session-a");
  const encoded = JSON.stringify(unsafe);
  assert.equal(unsafe.sessionTitle, "Current session");
  for (const secret of ["secret-project", "Do not expose", "secretcredential", "opensesame", "credentials", "C:\\\\private"]) {
    assert.equal(encoded.includes(secret), false, secret);
  }

  const offline = state.update({
    ok: false,
    harness: false,
    error: "Authorization: Bearer very-secret-token",
    sessions: [session()],
  });
  assert.equal(offline.status, "offline");
  assert.equal(offline.sessionId, "");
  assert.equal(offline.contextPercent, 0);
  assert.doesNotMatch(JSON.stringify(offline), /Bearer|very-secret-token/);
});

test("titles redact cross-platform absolute paths, file URIs, credentials, and protocol controls", () => {
  for (const unsafe of [
    "/opt/company/secret-project",
    "/root/private",
    "/mnt/c/private",
    "C:\\private\\project",
    "workspace=C:\\private\\project",
    "\\\\server\\share\\project",
    "file:///home/user/project",
    "~/private/project",
    "workspace=/srv/private/project",
    "OPENAI_API_KEY sk-examplecredential123456",
    "password hunter2",
    "token=opaque-value",
  ]) {
    assert.equal(safeSessionTitle(unsafe), "Current session", unsafe);
  }
  assert.equal(safeSessionTitle("release\u0085verification"), "release verification");
  assert.equal(safeSessionTitle("Release verification"), "Release verification");
});

test("exact-session lookup rejects malformed, fuzzy, and disappeared ids", () => {
  const authoritative = session({ sessionId: "Case-Sensitive:1" });
  const state = createGameBarSnapshotState({ now: clock().now });
  state.update(dashboard([authoritative]));

  assert.equal(isValidSessionId("Case-Sensitive:1"), true);
  assert.strictEqual(state.getSession("Case-Sensitive:1"), authoritative);
  assert.equal(state.hasSession("case-sensitive:1"), false);
  assert.equal(state.getSession(" Case-Sensitive:1 "), null);
  assert.equal(state.getSession("bad\nidentifier"), null);
  assert.equal(isValidSessionId("bad\u0085identifier"), false);
  assert.throws(() => state.requireSession("case-sensitive:1"), /Unknown Harness session/);

  state.update(dashboard([]));
  assert.equal(state.hasSession("Case-Sensitive:1"), false);
});

test("semantically identical dashboard objects preserve revision, timestamp, and snapshot identity", () => {
  const time = clock();
  const state = createGameBarSnapshotState({ now: time.now });
  const first = state.update(dashboard([session({
    projections: { values: { contextPressure: { projectedTokens: 1, contextWindow: 4 } } },
  })]), "session-a");
  time.advance(60_000);
  const second = state.update(dashboard([session({
    projections: { values: { contextPressure: { projectedTokens: 1, contextWindow: 4 } } },
    ignoredPrompt: "changed but not externally visible",
  })]), "session-a");

  assert.strictEqual(second, first);
  assert.equal(second.revision, first.revision);
  assert.equal(second.updatedAt, first.updatedAt);
  assert.strictEqual(state.getSnapshot(), first);
});

test("tracked transition history is bounded and evicts the least recently seen session", () => {
  const state = createGameBarSnapshotState({ now: clock().now });
  state.update(dashboard([session({ sessionId: "old", running: true })]), "old");
  for (let index = 0; index < 128; index += 1) {
    const sessionId = `new-${String(index).padStart(3, "0")}`;
    state.update(dashboard([session({ sessionId })]), sessionId);
  }

  const reappeared = state.update(dashboard([
    session({ sessionId: "old", running: false }),
  ]), "old");
  assert.equal(reappeared.status, "idle");
  assert.equal(reappeared.unread, false);
});
