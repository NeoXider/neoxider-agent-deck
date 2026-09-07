// Session-scoped phases, independent of aggregate notifications and activity visibility.
(function exposeChatVisualState(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.chatVisualState = api;
}(typeof globalThis === "object" ? globalThis : this, () => {
  const PHASES = ["idle", "waiting", "thinking", "writing", "tool", "done", "error", "offline"];
  const PHASE_SET = new Set(PHASES);
  const ACTIVE_PHASES = new Set(["waiting", "thinking", "writing", "tool"]);
  // Server/history activity kinds map onto glow phases; composer-local kinds
  // (files, capture) and anything unknown map to null = no glow.
  const KIND_TO_PHASE = {
    waiting: "waiting",
    working: "waiting",
    thinking: "thinking",
    writing: "writing",
    tool: "tool",
    done: "done",
    error: "error",
  };

  function normalizePhase(value) {
    return PHASE_SET.has(value) ? value : "idle";
  }

  function phaseFromActivityKind(kind) {
    return KIND_TO_PHASE[String(kind || "")] || null;
  }

  // A late poll cannot erase completion; a newer turn timestamp can supersede it.
  function resolvePollPhase({ current, running, activityKind, pending, freshTurn } = {}) {
    const base = normalizePhase(current);
    const mapped = phaseFromActivityKind(activityKind);
    if (mapped === "done" || mapped === "error") return mapped;
    if ((base === "done" || base === "error") && !freshTurn) return base;
    if (mapped && ACTIVE_PHASES.has(mapped) && (running || pending)) return mapped;
    if (running) return "waiting";
    if (pending) return "waiting";
    if (ACTIVE_PHASES.has(base)) return "idle";
    return base;
  }

  function createChatVisualState() {
    const phasesBySession = new Map();
    const outcomesAt = new Map();
    const pendingBySession = new Set();
    let pendingCreate = false;
    let selectedId = null;
    let lastApplied = null;
    let offline = false;

    function setPhase(id, phase) {
      phasesBySession.delete(id);
      phasesBySession.set(id, phase);
      if (phase === "done" || phase === "error") {
        if (!outcomesAt.has(id)) outcomesAt.set(id, Date.now());
      } else outcomesAt.delete(id);
      while (phasesBySession.size > 200) {
        const oldest = phasesBySession.keys().next().value;
        phasesBySession.delete(oldest);
        outcomesAt.delete(oldest);
        pendingBySession.delete(oldest);
      }
    }

    function currentPhase(id) {
      if (id === null || id === undefined) return "idle";
      if (outcomesAt.has(id) && Date.now() - outcomesAt.get(id) > 8000) setPhase(id, "idle");
      return normalizePhase(phasesBySession.get(id) || "idle");
    }

    function selectedPhase() {
      if (offline) return "offline";
      if (pendingCreate && !selectedId) return "waiting";
      if (selectedId === null || selectedId === undefined) return "idle";
      if (pendingBySession.has(selectedId)) {
        const phase = currentPhase(selectedId);
        return ACTIVE_PHASES.has(phase) ? phase : "waiting";
      }
      return currentPhase(selectedId);
    }

    return {
      setOffline(value) { offline = Boolean(value); },
      select(id) {
        selectedId = id || null;
      },
      // A send/create starts waiting at once, before any API response. Queued behind
      // an active turn it preserves the current activity instead of downgrading it.
      noteSendStart(id) {
        if (!id) {
          pendingCreate = true;
          return selectedPhase();
        }
        pendingBySession.add(id);
        if (!ACTIVE_PHASES.has(currentPhase(id))) setPhase(id, "waiting");
        return currentPhase(id);
      },
      noteCreateStart() {
        pendingCreate = true;
        return selectedPhase();
      },
      noteCreateSettled(id, phase) {
        pendingCreate = false;
        if (!id) return selectedPhase();
        pendingBySession.delete(id);
        setPhase(id, normalizePhase(phase));
        return currentPhase(id);
      },
      noteSendAccepted(id) {
        pendingBySession.delete(id);
        return currentPhase(id);
      },
      // Live stream/tool progress for any session (recorded per session; only the
      // selected one is ever painted).
      noteStream(id, kind) {
        if (!id) return selectedPhase();
        const mapped = phaseFromActivityKind(kind);
        if (!mapped) return currentPhase(id);
        pendingBySession.delete(id);
        setPhase(id, mapped);
        return currentPhase(id);
      },
      noteCompletion(id, kind) {
        if (!id) return selectedPhase();
        pendingBySession.delete(id);
        setPhase(id, kind === "error" ? "error" : "done");
        return currentPhase(id);
      },
      noteSendFailure(id) {
        if (!id) {
          pendingCreate = false;
          return selectedPhase();
        }
        pendingBySession.delete(id);
        setPhase(id, "idle");
        return "idle";
      },
      noteStop(id) {
        if (!id) return selectedPhase();
        pendingBySession.delete(id);
        setPhase(id, "idle");
        return "idle";
      },
      notePoll(id, { running = false, activityKind = null, runningSince = null } = {}) {
        if (!id) return selectedPhase();
        setPhase(id, resolvePollPhase({
          current: currentPhase(id),
          running: Boolean(running),
          activityKind,
          pending: pendingBySession.has(id),
          freshTurn: Boolean(running && outcomesAt.has(id) && Number(runningSince) > outcomesAt.get(id)),
        }));
        return currentPhase(id);
      },
      // Clear a sticky done/error once its presentation lifetime ends.
      clearIf(id, phase) {
        if (!id || !PHASE_SET.has(phase)) return selectedPhase();
        if (currentPhase(id) === phase) setPhase(id, "idle");
        return selectedPhase();
      },
      phaseFor(id) {
        return currentPhase(id);
      },
      hasPending(id) {
        return id ? pendingBySession.has(id) : pendingCreate;
      },
      // The one DOM write. Reasserting the same phase never touches the DOM, so
      // animations keep running instead of restarting on every poll.
      sync(body) {
        const target = body || (typeof document !== "undefined" ? document.body : null);
        if (!target) return false;
        const phase = selectedPhase();
        if (lastApplied === phase && target.dataset && target.dataset.chatState === phase) return false;
        if (target.dataset) {
          if (target.dataset.chatState === phase) {
            lastApplied = phase;
            return false;
          }
          target.dataset.chatState = phase;
        }
        lastApplied = phase;
        return true;
      },
    };
  }

  return {
    PHASES,
    normalizePhase,
    phaseFromActivityKind,
    resolvePollPhase,
    createChatVisualState,
  };
}));
