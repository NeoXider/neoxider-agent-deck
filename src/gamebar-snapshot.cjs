const { createHash } = require("node:crypto");

const { PROTOCOL_VERSION, validateFrame } = require("./gamebar-protocol.cjs");

const MAX_SESSION_ID_CHARS = 256;
const MAX_SESSION_TITLE_CHARS = 160;
const MAX_TRACKED_SESSION_STATES = 128;
const ACTIVITY_STATUSES = new Set(["thinking", "writing", "tool"]);
const DEFAULT_SESSION_TITLE = "Current session";

const STATUS_DETAILS = Object.freeze({
  idle: "Ready",
  thinking: "Thinking",
  writing: "Writing response",
  tool: "Using tool",
  waiting: "Waiting for agent",
  done: "Agent finished",
  error: "Session needs attention",
  offline: "Harness is offline",
});

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isValidSessionId(value) {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= MAX_SESSION_ID_CHARS
    && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
}

function timestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Date.parse(typeof value === "string" ? value : "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeSessionTitle(value) {
  const title = typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").replace(/\s+/g, " ").trim()
    : "";
  if (!title) return DEFAULT_SESSION_TITLE;

  const looksLikePath = /[A-Za-z]:[\\/]|\\\\|file:\/\/|(?:^|[^A-Za-z0-9])\/(?!\/)\S|(?:^|[^A-Za-z0-9])~[\\/]/i.test(title);
  const looksLikeCredential = /\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|authorization|bearer|password|passwd|secret|client[_ -]?secret|private[_ -]?key)\b/i.test(title)
    || /\btoken\s*[:=]\s*\S+/i.test(title)
    || /\b(?:sk[-_]|ghp_|github_pat_|AKIA)[A-Za-z0-9_-]{12,}\b/.test(title)
    || /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/.test(title)
    || /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(title);
  if (looksLikePath || looksLikeCredential) return DEFAULT_SESSION_TITLE;
  return title.slice(0, MAX_SESSION_TITLE_CHARS);
}

function deriveContextPercent(session) {
  const pressure = session?.projections?.values?.contextPressure;
  if (!isRecord(pressure)) return 0;
  const used = Number(pressure.projectedTokens ?? pressure.pressureTokens);
  const total = Number(pressure.contextWindow);
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(100, (used / total) * 100));
}

function activeStatus(session) {
  const activity = isRecord(session?.activity) && session.activity.active !== false
    ? session.activity
    : null;
  return activity && ACTIVITY_STATUSES.has(activity.kind) ? activity.kind : null;
}

function isExplicitError(session) {
  return session?.state === "error" || session?.status === "error";
}

function isActive(session) {
  return Boolean(session?.running || activeStatus(session));
}

function safeDigest(value) {
  if (typeof value !== "string" || !value) return "";
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

function assistantMarker(session) {
  const digest = safeDigest(session?.preview);
  if (!digest) return "";
  const replyTime = timestamp(session?.replyAt);
  return replyTime ? `${replyTime}:${digest}` : `content:${digest}`;
}

function errorMarker(session) {
  if (!isExplicitError(session)) return "";
  const error = session?.error ?? session?.failure ?? session?.lastError;
  const parts = [];
  if (typeof error === "string") parts.push(error);
  else if (isRecord(error)) {
    for (const key of ["kind", "code", "name", "message"]) {
      if (["string", "number"].includes(typeof error[key])) parts.push(`${key}:${error[key]}`);
    }
  }
  const errorDigest = safeDigest(parts.join("\u001f"));
  return `${assistantMarker(session)}:${errorDigest || "error"}`;
}

function activityTime(session) {
  return Math.max(
    timestamp(session?.activity?.updatedAt ?? session?.activity?.time),
    timestamp(session?.lastActiveAt),
    timestamp(session?.replyAt),
    timestamp(session?.updatedAt),
  );
}

function hasAssistantReply(session) {
  return typeof session?.preview === "string" && Boolean(session.preview.trim());
}

function replyTime(session) {
  if (!hasAssistantReply(session)) return 0;
  return timestamp(session?.replyAt) || timestamp(session?.updatedAt);
}

function compareSessionIds(left, right) {
  if (left.sessionId < right.sessionId) return -1;
  if (left.sessionId > right.sessionId) return 1;
  return 0;
}

function chooseNewest(candidates, score, previousSessionId) {
  let bestScore = -Infinity;
  let tied = [];
  for (const session of candidates) {
    const candidateScore = score(session);
    if (candidateScore > bestScore) {
      bestScore = candidateScore;
      tied = [session];
    } else if (candidateScore === bestScore) {
      tied.push(session);
    }
  }
  const previous = tied.find((session) => session.sessionId === previousSessionId);
  return previous || tied.sort(compareSessionIds)[0] || null;
}

function chooseSession(sessions, selectedSessionId, previousSessionId = "") {
  if (isValidSessionId(selectedSessionId)) {
    const selected = sessions.find((session) => session.sessionId === selectedSessionId);
    if (selected) return selected;
  }
  const active = sessions.filter(isActive);
  if (active.length) return chooseNewest(active, activityTime, previousSessionId);
  const replied = sessions.filter(hasAssistantReply);
  if (replied.length) return chooseNewest(replied, replyTime, previousSessionId);
  const previous = sessions.find((session) => session.sessionId === previousSessionId);
  return previous || [...sessions].sort(compareSessionIds)[0] || null;
}

function clockTimestamp(now) {
  const value = now();
  const milliseconds = value instanceof Date ? value.getTime() : Number(value);
  if (!Number.isFinite(milliseconds)) throw new TypeError("Game Bar snapshot clock must return a finite timestamp");
  return new Date(milliseconds).toISOString();
}

function sameVisibleState(left, right) {
  if (!left || !right) return false;
  return left.status === right.status
    && left.sessionId === right.sessionId
    && left.sessionTitle === right.sessionTitle
    && left.detail === right.detail
    && left.contextPercent === right.contextPercent
    && left.unread === right.unread;
}

function createGameBarSnapshotState({ now = Date.now } = {}) {
  if (typeof now !== "function") throw new TypeError("Game Bar snapshot clock must be a function");

  let revision = 0;
  let requestedSessionId = "";
  let online = false;
  let sessions = [];
  let sessionsById = new Map();
  const sessionStates = new Map();
  let selectedSession = null;
  let snapshot = Object.freeze({
    v: PROTOCOL_VERSION,
    type: "snapshot",
    revision,
    status: "offline",
    sessionId: "",
    sessionTitle: "",
    detail: STATUS_DETAILS.offline,
    contextPercent: 0,
    unread: false,
    updatedAt: clockTimestamp(now),
  });

  function statusFor(session) {
    if (!online) return "offline";
    if (!session) return "idle";
    if (isExplicitError(session)) return "error";
    const activity = activeStatus(session);
    if (activity) return activity;
    if (session.running) return "waiting";
    if (sessionStates.get(session.sessionId)?.done) return "done";
    return "idle";
  }

  function visibleState() {
    const status = statusFor(selectedSession);
    return {
      status,
      sessionId: selectedSession?.sessionId || "",
      sessionTitle: selectedSession ? safeSessionTitle(selectedSession.title) : "",
      detail: selectedSession || status === "offline" ? STATUS_DETAILS[status] : "No active session",
      contextPercent: selectedSession ? deriveContextPercent(selectedSession) : 0,
      unread: Boolean(selectedSession && sessionStates.get(selectedSession.sessionId)?.unread),
    };
  }

  function publish() {
    const visible = visibleState();
    if (sameVisibleState(snapshot, visible)) return snapshot;
    if (revision >= Number.MAX_SAFE_INTEGER) throw new RangeError("Game Bar snapshot revision limit reached");
    revision += 1;
    const next = {
      v: PROTOCOL_VERSION,
      type: "snapshot",
      revision,
      ...visible,
      updatedAt: clockTimestamp(now),
    };
    validateFrame(next);
    snapshot = Object.freeze(next);
    return snapshot;
  }

  function update(dashboard, selectedSessionId) {
    if (arguments.length >= 2) {
      requestedSessionId = isValidSessionId(selectedSessionId) ? selectedSessionId : "";
    } else if (isValidSessionId(dashboard?.selectedSessionId)) {
      requestedSessionId = dashboard.selectedSessionId;
    }

    online = isRecord(dashboard)
      && Array.isArray(dashboard.sessions)
      && dashboard.harness !== false
      && dashboard.ok !== false;
    const sourceSessions = online && Array.isArray(dashboard.sessions) ? dashboard.sessions : [];
    const nextById = new Map();
    sessions = [];
    for (const session of sourceSessions) {
      if (!isRecord(session) || !isValidSessionId(session.sessionId) || nextById.has(session.sessionId)) continue;
      nextById.set(session.sessionId, session);
      sessions.push(session);
    }

    for (const session of sessions) {
      const sessionId = session.sessionId;
      const current = {
        active: isActive(session),
        error: isExplicitError(session),
        assistant: assistantMarker(session),
        errorMarker: errorMarker(session),
      };
      const previous = sessionStates.get(sessionId);
      let done = Boolean(previous?.done);
      let unread = Boolean(previous?.unread);
      const assistantChanged = Boolean(previous && current.assistant && previous.assistant !== current.assistant);

      if (current.error) {
        done = false;
        if (previous && (!previous.error || previous.errorMarker !== current.errorMarker)) unread = true;
      } else if (previous?.active && !current.active) {
        done = true;
        unread = true;
      } else if (current.active) {
        done = false;
      } else if (assistantChanged) {
        done = true;
        unread = true;
      }

      if (assistantChanged) unread = true;
      sessionStates.delete(sessionId);
      sessionStates.set(sessionId, { ...current, done, unread });
    }

    while (sessionStates.size > MAX_TRACKED_SESSION_STATES) {
      sessionStates.delete(sessionStates.keys().next().value);
    }

    sessionsById = nextById;
    selectedSession = chooseSession(sessions, requestedSessionId, selectedSession?.sessionId);
    return publish();
  }

  function getSession(sessionId) {
    if (!isValidSessionId(sessionId)) return null;
    return sessionsById.get(sessionId) || null;
  }

  function hasSession(sessionId) {
    return getSession(sessionId) !== null;
  }

  function requireSession(sessionId) {
    const session = getSession(sessionId);
    if (!session) throw new RangeError("Unknown Harness session");
    return session;
  }

  function ack(sessionId) {
    requireSession(sessionId);
    const previous = sessionStates.get(sessionId);
    if (previous?.unread) {
      sessionStates.delete(sessionId);
      sessionStates.set(sessionId, { ...previous, unread: false });
    }
    return publish();
  }

  return Object.freeze({
    ack,
    getSession,
    getSnapshot: () => snapshot,
    hasSession,
    requireSession,
    update,
  });
}

module.exports = {
  STATUS_DETAILS,
  chooseSession,
  createGameBarSnapshotState,
  deriveContextPercent,
  isValidSessionId,
  safeSessionTitle,
};
