// Answers the agent's questions from Deck.
//
// `ask_user_question` pauses the agent until a connected Harness Client answers. Harness
// forwards the pending question to every Client over the Gateway's event stream (the
// `$events` channel on /api/remote.mux) as a `waterfall` frame, and the first Client to
// post a `result` to `$events/result` settles it; every other Client then gets a `cancel`
// frame for the same event. Deck never opened that stream, so a question was only ever
// answerable in the browser: the chat showed "waiting for your answer" and a button that
// sent the user to Harness.
//
// The relay keeps that stream open for as long as Harness is up, holds each question until
// the user answers it here or somewhere else, and reconnects with backoff when Harness
// restarts. Questions asked before Deck connected are delivered on connect: the Gateway
// replays every pending event to a new Client.
//
// `approval/request` arrives on the same stream and is deliberately left unanswered. A
// waterfall settles with `next` only when every Client says so, and `next` hands the
// request to Harness's own fallback; Deck saying `next` while it is the only Client would
// decide an approval nobody saw. Holding it changes nothing: the browser's answer still
// settles it, and closing the stream releases Deck's claim.
//
// Nothing in here imports Electron; the transport and the publisher are injected.

const QUESTION_EVENT = "user-questions/request";
const DEFAULT_RETRY_DELAYS = [1000, 2000, 5000, 10000, 15000];

function text(value, limit = 4000) {
  return typeof value === "string" ? value.slice(0, limit) : "";
}

// The Gateway has already validated the request against Harness's own schema; this only
// keeps what the renderer draws, in plain JSON, so nothing unexpected crosses the bridge.
function normalizeQuestions(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).map((question, index) => ({
    id: text(question?.id, 200) || `q${index + 1}`,
    question: text(question?.question),
    header: text(question?.header, 120),
    detail: text(question?.detail),
    multiSelect: question?.multiSelect === true,
    options: Array.isArray(question?.options)
      ? question.options.slice(0, 20).map((option) => ({ label: text(option?.label, 400), description: text(option?.description, 1000) })).filter((option) => option.label)
      : [],
  })).filter((question) => question.question);
}

// One item per question of the request, each naming its question exactly once: the rule
// Harness enforces on its side, checked here so a malformed answer fails with a message
// the card can show instead of an opaque Gateway rejection.
function normalizeAnswer(entry, value) {
  const answers = Array.isArray(value?.answers) ? value.answers : null;
  if (!answers) throw new Error("The answer must list one entry per question");
  const ids = new Set(entry.questions.map((question) => question.id));
  const seen = new Set();
  const result = answers.map((answer) => {
    const id = text(answer?.id, 200);
    if (!ids.has(id) || seen.has(id)) throw new Error("The answer must name each question exactly once");
    seen.add(id);
    const selected = Array.isArray(answer?.selected) ? answer.selected.map((label) => text(label, 400)).filter(Boolean) : [];
    const custom = text(answer?.custom).trim();
    return { id, selected, ...(custom ? { custom } : {}) };
  });
  if (seen.size !== ids.size) throw new Error("The answer must name each question exactly once");
  return { answers: result };
}

function createQuestionRelay({
  getTransport,
  publish = () => {},
  retryDelays = DEFAULT_RETRY_DELAYS,
  now = () => Date.now(),
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  onError = () => {},
} = {}) {
  const pending = new Map();
  let channel = null;
  let clientId = null;
  let connecting = false;
  let stopped = true;
  let attempt = 0;
  let retryTimer = null;

  function list() {
    return [...pending.values()].map((entry) => ({
      eventId: entry.eventId,
      sessionId: entry.sessionId,
      callId: entry.callId,
      receivedAt: entry.receivedAt,
      questions: entry.questions.map((question) => ({ ...question, options: question.options.map((option) => ({ ...option })) })),
    }));
  }

  function changed() {
    try { publish(list()); } catch (error) { onError(error); }
  }

  function schedule() {
    if (stopped || retryTimer) return;
    const delay = retryDelays[Math.min(attempt, retryDelays.length - 1)];
    attempt += 1;
    retryTimer = setTimeoutFn(() => {
      retryTimer = null;
      connect();
    }, delay);
  }

  function onFrame(frame) {
    if (!frame || typeof frame !== "object") return;
    if (frame.type === "ready") {
      clientId = typeof frame.clientId === "string" ? frame.clientId : null;
      attempt = 0;
      return;
    }
    if (frame.type === "cancel") {
      if (pending.delete(frame.eventId)) changed();
      return;
    }
    if (frame.type !== "waterfall" || frame.event !== QUESTION_EVENT || !clientId) return;
    const questions = normalizeQuestions(frame.request?.questions);
    if (!questions.length || typeof frame.eventId !== "string") return;
    pending.set(frame.eventId, {
      eventId: frame.eventId,
      clientId,
      // A root agent's id is its session id; that is how Harness addresses the answer too.
      sessionId: typeof frame.agentId === "string" ? frame.agentId : "",
      callId: text(frame.request?.wait?.callId, 200),
      receivedAt: now(),
      questions,
    });
    changed();
  }

  async function connect() {
    if (stopped || channel || connecting) return;
    connecting = true;
    try {
      const transport = await getTransport();
      // A legacy Harness has no event stream, and an offline one has nothing to open.
      if (!transport || typeof transport.openChannel !== "function") {
        schedule();
        return;
      }
      const handle = await transport.openChannel({ endpoint: "$events", args: {}, onFrame });
      if (stopped) {
        handle.close();
        return;
      }
      channel = handle;
      Promise.resolve(handle.closed).then(() => {
        if (channel !== handle) return;
        channel = null;
        clientId = null;
        // The Gateway forgets this Client's deliveries with the stream and replays whatever
        // is still pending to the next one, so nothing held here is answerable any more.
        if (pending.size) {
          pending.clear();
          changed();
        }
        schedule();
      });
    } catch (error) {
      onError(error);
      schedule();
    } finally {
      connecting = false;
    }
  }

  async function answer(eventId, value) {
    const entry = pending.get(String(eventId || ""));
    if (!entry) throw new Error("This question is no longer waiting for an answer");
    const result = normalizeAnswer(entry, value);
    const transport = await getTransport();
    if (!transport || typeof transport.call !== "function") throw new Error("Harness is not connected");
    await transport.call("$events/result", { clientId: entry.clientId, eventId: entry.eventId, outcome: { kind: "result", value: result } }, 10000);
    if (pending.delete(entry.eventId)) changed();
    return true;
  }

  function start() {
    if (!stopped) return;
    stopped = false;
    attempt = 0;
    connect();
  }

  // Harness came back: try now instead of waiting out the backoff.
  function kick() {
    if (stopped || channel || connecting) return;
    if (retryTimer) clearTimeoutFn(retryTimer);
    retryTimer = null;
    attempt = 0;
    connect();
  }

  function stop() {
    stopped = true;
    if (retryTimer) clearTimeoutFn(retryTimer);
    retryTimer = null;
    const handle = channel;
    channel = null;
    clientId = null;
    try { handle?.close(); } catch {}
    if (pending.size) {
      pending.clear();
      changed();
    }
  }

  return { start, stop, kick, answer, list, isConnected: () => Boolean(channel && clientId) };
}

module.exports = { QUESTION_EVENT, createQuestionRelay, normalizeAnswer, normalizeQuestions };
