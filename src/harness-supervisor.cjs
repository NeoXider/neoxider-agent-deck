// Brings the widget's own Harness back after it dies, and says so while it does.
//
// Before this, an owned Harness that crashed after becoming ready left the widget polling
// a dead port: the banner said "offline" and nothing restarted it, so every crash cost the
// user a manual Start and gave them no idea why it had happened.
//
// The supervisor only acts on what the launcher reports as an unexpected exit: a server
// launch that had served, that the widget did not stop, while the app was not quitting.
// A Harness the widget did not start is never restarted or killed from here.
//
// Restarts back off — 1 s, 3 s, 10 s, then 30 s — and a failed restart counts like a
// crash. Five within ten minutes means something is wrong that another restart will not
// fix, so it stops and leaves the decision (and the log) to the user.
const RESTART_DELAYS_MS = Object.freeze([1000, 3000, 10000, 30000]);
const MAX_CRASHES = 5;
const CRASH_WINDOW_MS = 10 * 60 * 1000;
const CRASH_TAIL_LINES = 40;
const PORT_IN_USE = /EADDRINUSE|address already in use/i;
// Reasons the launcher gives for never being able to start a Harness here at all.
const PERMANENT_REASONS = new Set(["remote-url", "unsupported-local-protocol", "restart-unsupported", "disposed"]);

function describeExit({ code = null, signal = null } = {}) {
  if (signal) return `signal ${signal}`;
  if (code === null || code === undefined) return "no exit code";
  const unsigned = Number(code) >>> 0;
  // Windows reports a native crash as an NTSTATUS, which is only recognisable in hex.
  return unsigned >= 0xC0000000 ? `exit code 0x${unsigned.toString(16).toUpperCase()}` : `exit code ${code}`;
}

function messageOf(error) {
  return String(error?.message || error || "").slice(0, 500);
}

function createHarnessSupervisor({
  launcher,
  outputLog = null,
  // Answers whether anything serves on the Harness port right now.
  probeReady = async () => Boolean(await launcher?.probeReady?.()),
  isQuitting = () => false,
  openPath = null,
  onState = () => {},
  onRecovered = () => {},
  now = () => Date.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  delays = RESTART_DELAYS_MS,
  maxCrashes = MAX_CRASHES,
  crashWindowMs = CRASH_WINDOW_MS,
}) {
  if (!launcher || typeof launcher.start !== "function") throw new TypeError("a Harness launcher is required");
  let crashes = [];
  let timer = null;
  let inFlight = null;
  let disposed = false;
  // The last failed start found the port held by something that does not answer: almost
  // certainly what is left of the instance that just crashed.
  let portBlocked = false;
  let state = {
    status: "idle", exitCode: null, signal: null, exitText: "", crashedAt: null, restartAt: null,
    crashCount: 0, maxCrashes, lastError: "", tail: [],
  };

  function publish(changes) {
    state = { ...state, ...changes };
    try { onState(getState()); } catch {}
  }

  function getState() {
    return { ...state, tail: [...state.tail] };
  }

  function note(message, options) {
    try { outputLog?.note?.(message, options); } catch {}
  }

  function stopped() {
    return disposed || isQuitting();
  }

  function cancelTimer() {
    if (timer) clearTimer(timer);
    timer = null;
  }

  function countFailure() {
    const at = now();
    crashes = crashes.filter((time) => at - time < crashWindowMs);
    crashes.push(at);
    return crashes.length;
  }

  function scheduleOrGiveUp(changes = {}) {
    const count = crashes.length;
    if (count >= maxCrashes) {
      note(`Harness failed ${count} times within ${Math.round(crashWindowMs / 60000)} minutes; automatic restarts stopped`);
      publish({ ...changes, status: "gave-up", restartAt: null, crashCount: count });
      return;
    }
    const delayMs = delays[Math.min(count - 1, delays.length - 1)];
    cancelTimer();
    timer = setTimer(() => {
      timer = null;
      attemptRestart({ explicit: false }).catch(() => {});
    }, delayMs);
    note(`Restarting Harness in ${delayMs / 1000} s (failure ${count} of ${maxCrashes})`);
    publish({ ...changes, status: "scheduled", restartAt: now() + delayMs, crashCount: count });
  }

  function handleExit(event) {
    if (!event?.unexpected || stopped()) return;
    // Only a launch that became ready reports this, so after a give-up the Harness was
    // started again by hand and ran: it gets a fresh budget like a Restart would.
    if (state.status === "gave-up") crashes = [];
    const tail = outputLog?.recentLines?.(CRASH_TAIL_LINES) || [];
    const exitText = describeExit(event);
    // A self-contained record, so the crash still reads as one block after more output.
    note(`=== Harness stopped unexpectedly (${exitText}); its last ${tail.length} lines follow ===`);
    for (const line of tail) note(`| ${line}`, { keep: false });
    note("=== end of crash report ===", { keep: false });
    countFailure();
    scheduleOrGiveUp({
      exitCode: event.code ?? null, signal: event.signal ?? null, exitText, crashedAt: now(), lastError: "", tail,
    });
  }

  async function runAttempt(explicit) {
    // Something answers on the port: either the old instance survived its wrapper or another
    // Harness took over. Either way it is adopted through Start, which never kills anything.
    if (await probeReady()) return launcher.start();
    // Nothing answers. A user's Restart, or a port the last attempt found occupied, may
    // clear the port first; restart() only stops node/dsh listeners there.
    if ((explicit || portBlocked) && typeof launcher.restart === "function") return launcher.restart();
    return launcher.start();
  }

  function attemptRestart({ explicit = false } = {}) {
    if (stopped()) return Promise.resolve({ ok: false, started: false, reason: "disposed" });
    if (inFlight) return inFlight;
    cancelTimer();
    publish({ status: "restarting", restartAt: null });
    const mark = outputLog?.mark?.() ?? 0;
    inFlight = (async () => {
      let result;
      try {
        result = await runAttempt(explicit);
      } catch (error) {
        result = { ok: false, started: false, reason: "start-failed", error: messageOf(error) };
      }
      if (stopped()) return result;
      if (result?.ok) {
        portBlocked = false;
        // It came back and died again before this attempt finished; that crash owns the state.
        if (timer || state.status === "gave-up") return result;
        note(result.started ? "Harness is back" : "Harness is answering again");
        publish({ status: "idle", restartAt: null, lastError: "", recoveredAt: now() });
        try { await onRecovered(result); } catch {}
        return result;
      }
      if (result?.reason === "token-required") {
        // Another Harness holds the port now. It is not ours to restart; the banner's
        // Connect/Restart choice covers it.
        note("Another Harness now holds the port; automatic restarts stopped");
        publish({ status: "idle", restartAt: null, lastError: "" });
        return result;
      }
      const printed = outputLog?.linesSince?.(mark) || [];
      const lastError = result?.error || result?.reason || "Harness could not be started";
      if (PERMANENT_REASONS.has(result?.reason)) {
        publish({ status: "gave-up", restartAt: null, lastError });
        return result;
      }
      portBlocked = PORT_IN_USE.test([...printed, lastError].join("\n"));
      note(`Harness restart failed: ${lastError}${portBlocked ? " (the port is still held)" : ""}`);
      countFailure();
      scheduleOrGiveUp({ lastError, tail: outputLog?.recentLines?.(CRASH_TAIL_LINES) || state.tail });
      return result;
    })().finally(() => { inFlight = null; });
    return inFlight;
  }

  const unsubscribe = typeof launcher.onExit === "function" ? launcher.onExit(handleExit) : () => {};

  return {
    getState,
    // The banner's "Restart now". After a give-up it also restores the full restart budget:
    // the user has seen the failure and asked for another go.
    restartNow() {
      if (stopped()) return Promise.resolve({ ok: false, started: false, reason: "disposed" });
      if (state.status === "gave-up") crashes = [];
      return attemptRestart({ explicit: true });
    },
    async openLog() {
      const filePath = outputLog?.ensureLogFile?.() || "";
      if (!filePath || typeof openPath !== "function") return { ok: false, error: "The Harness log is not available" };
      const error = await openPath(filePath);
      return error ? { ok: false, error: String(error) } : { ok: true };
    },
    dispose() {
      disposed = true;
      cancelTimer();
      try { unsubscribe(); } catch {}
    },
  };
}

module.exports = {
  CRASH_TAIL_LINES,
  CRASH_WINDOW_MS,
  MAX_CRASHES,
  RESTART_DELAYS_MS,
  createHarnessSupervisor,
  describeExit,
};
