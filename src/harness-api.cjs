const { randomUUID } = require("node:crypto");
const { isMainThread } = require("node:worker_threads");
const { createHistoryReader } = require("./history-reader.cjs");
const { createRemoteTransport, detectGeneration } = require("./harness-transport.cjs");
const {
  activityFromHistory,
  sessionStateFromHistory,
  turnTimingFromHistory,
} = require("./session-activity.cjs");
const {
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
} = require("./history-model.cjs");

class HarnessApi {
  constructor(baseUrl = "http://127.0.0.1:3080", fetchImpl = globalThis.fetch, options = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.fetch = fetchImpl;
    this.sessionStateCache = new Map();
    this.now = typeof options.now === "function" ? options.now : Date.now;
    this.subagentRefreshMs = positiveInteger(options.subagentRefreshMs, 10000);
    this.historyCache = new Map();
    this.historyCacheSessionLimit = positiveInteger(options.historyCacheSessionLimit, HISTORY_CACHE_SESSION_LIMIT);
    this.historyCacheEventLimit = positiveInteger(options.historyCacheEventLimit, HISTORY_CACHE_EVENT_LIMIT);
    this.historyCacheBytesLimit = positiveInteger(options.historyCacheBytesLimit, HISTORY_CACHE_BYTES_LIMIT);
    this.historyReader = isMainThread && options.historyWorker !== false
      ? createHistoryReader(this.baseUrl, { historyCacheSessionLimit: this.historyCacheSessionLimit, historyCacheEventLimit: this.historyCacheEventLimit, historyCacheBytesLimit: this.historyCacheBytesLimit }) : null;
    this.fullAccessSessions = new Set();
    this.workspaceSnapshot = { items: [], archivedSessionIds: [] };
    // Two Harness generations speak different wire protocols. The probe result is
    // cached for the process lifetime once it is not "down", so a harness that comes
    // up later (launcher start) re-probes on every call until it answers.
    this._generationPromise = null;
    this._remoteTransport = null;
    this.getLaunchBrowserUrl = typeof options.getLaunchBrowserUrl === "function" ? options.getLaunchBrowserUrl : () => "";
    // A launch URL being verified outranks every stored one, for exactly as long as the
    // check runs. See verifyLaunchUrl.
    this._candidateLaunchUrl = "";
  }

  // What the cookie is minted from right now: a URL under verification first, then
  // whatever the owner (captured banner token, then the saved preference) supplies.
  resolveLaunchBrowserUrl() {
    return this._candidateLaunchUrl || this.getLaunchBrowserUrl();
  }

  // Prove one candidate launch URL before anybody commits to it. Connect used to call
  // dashboard() straight after normalizing the pasted text, but the cookie is minted
  // from the *stored* URL, so the check never saw what the user pasted: on a first
  // connect nothing is stored, the mint throws, and the button could not succeed at
  // all; with a good URL already stored, a typo "verified" against the old cookie and
  // was then written over it. The candidate is dropped either way, and so is the
  // cookie it minted, so the next call re-mints from whatever the caller kept.
  async verifyLaunchUrl(candidate) {
    const value = String(candidate || "").trim();
    if (!value) throw new Error("Paste the Harness launch URL first");
    this._candidateLaunchUrl = value;
    this.resetRemoteAuth();
    try {
      await this.dashboard();
    } finally {
      this._candidateLaunchUrl = "";
      this.resetRemoteAuth();
    }
    return true;
  }

  async detectGeneration() {
    if (!this._generationPromise) {
      const fetchImpl = this.fetch;
      this._generationPromise = detectGeneration(this.baseUrl, fetchImpl).then((generation) => {
        if (generation === "down") this._generationPromise = null;
        return generation;
      });
    }
    return this._generationPromise;
  }

  // The remote transport is created lazily so legacy harnesses never pay for the
  // launch-URL exchange, and reused across calls.
  async ensureRemote() {
    const generation = await this.detectGeneration();
    if (generation !== "gated") return null;
    if (!this._remoteTransport) {
      this._remoteTransport = createRemoteTransport({
        baseUrl: this.baseUrl,
        fetchImpl: this.fetch,
        getLaunchBrowserUrl: () => this.resolveLaunchBrowserUrl(),
      });
    }
    return this._remoteTransport;
  }

  // Wait for the opening frame of a channel that starts with one. Used for read-only
  // surfaces where opening a live stream is just the cheapest way to get an
  // authoritative snapshot. Workspace streams wrap theirs as {type:"baseline", value};
  // session follow streams yield the raw {type:"snapshot"} record page instead.
  remoteChannelFirstFrame(remote, endpoint, args) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let handle = null;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { handle?.close(); } catch {}
        reject(new Error(`Harness ${endpoint} timed out`));
      }, 8000);
      remote.openChannel({
        endpoint,
        args,
        onFrame: (value) => {
          if (!settled && value?.type === "baseline") {
            settled = true;
            clearTimeout(timer);
            resolve(value.value ?? {});
            try { handle?.close(); } catch {}
          } else if (!settled && value?.type === "snapshot") {
            settled = true;
            clearTimeout(timer);
            resolve(value);
            try { handle?.close(); } catch {}
          }
        },
      }).then((opened) => {
        handle = opened;
        if (!settled) {
          // Frames can only arrive after the open resolves, so a channel that dies
          // before delivering its baseline must reject instead of waiting out the timer.
          opened.closed.then(() => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(new Error(`Harness ${endpoint} closed`));
          });
        }
      }).catch((error) => {
        if (!settled) { settled = true; clearTimeout(timer); reject(error); }
      });
    });
  }

  // Drop the minted browser-session cookie so the next remote call re-mints it
  // from the current launch URL. Used after the user pastes a new launch URL;
  // the generation probe stays cached because the Harness itself did not change.
  resetRemoteAuth() {
    try { this._remoteTransport?.dropCookie(); } catch {}
  }

  async listSubagents(parentSessionId) {
    const remote = await this.ensureRemote();
    if (remote) return remote.call("subagent/list", { request: { parentSessionId } }, 4000);
    return this.rpc("subagent.list", { parentSessionId }, 4000);
  }

  async readHistoryEvents(sessionId, maxMessages) {
    const remote = await this.ensureRemote();
    if (!remote) return this.rpc("session.history", { sessionId, maxMessages }, 6000);
    const page = await this.fetchHistoryPage(remote, sessionId, { maxMessages });
    return { events: Array.isArray(page.events) ? page.events : [] };
  }

  // One history page for either dialect. Legacy pages come from session.history;
  // remote ones open a follow snapshot (first page) or walk session/page with the
  // cursor the snapshot handed out. Both return {events, hasMore}.
  async fetchHistoryPage(remote, sessionId, { maxMessages, beforeSeq = null, throughSeq = null } = {}) {
    if (!remote) {
      const payload = { sessionId, maxMessages };
      if (beforeSeq != null) payload.beforeSeq = beforeSeq;
      return this.rpc("session.history", payload);
    }
    const address = { kind: "session", sessionId };
    if (beforeSeq == null || throughSeq == null) {
      const snapshot = await this.remoteChannelFirstFrame(remote, "session/follow", { request: { address, maxMessages } });
      const throughSeq = Number.isFinite(snapshot.cursor) ? snapshot.cursor : null;
      return {
        events: Array.isArray(snapshot.records) ? snapshot.records : [],
        // session/page cannot be walked without the cursor: the next fetch would land
        // back in this branch, return the identical page and fail as "no progress",
        // taking the whole transcript down. Serve the snapshot as the complete answer.
        hasMore: Boolean(snapshot.hasMore) && throughSeq !== null,
        throughSeq,
      };
    }
    const page = await remote.call("session/page", { request: { address, throughSeq, beforeSeq, maxMessages } }, 8000);
    return { events: Array.isArray(page.records) ? page.records : [], hasMore: Boolean(page.hasMore), throughSeq };
  }

  async remoteWorkspaceBaseline() {
    const remote = await this.ensureRemote();
    if (!remote) throw new Error("Harness is not on the remote generation");
    return this.remoteChannelFirstFrame(remote, "workspace/follow", {});
  }

  cachedHistory(sessionId) {
    const key = String(sessionId || "");
    const cached = this.historyCache.get(key) || null;
    if (!cached) return null;
    this.historyCache.delete(key); this.historyCache.set(key, cached);
    return cached;
  }

  cacheHistory(sessionId, value) {
    const key = String(sessionId || "");
    this.historyCache.delete(key); this.historyCache.set(key, value);
    while (this.historyCache.size > this.historyCacheSessionLimit) this.historyCache.delete(this.historyCache.keys().next().value);
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

  async dashboard(selectedSessionId = null) {
    const remote = await this.ensureRemote();
    let host;
    let sessionsValue;
    let workspaceResult;
    if (remote) {
      // The remote generation has no host.describe and the renderer never reads host,
      // so an empty object stands in. Workspaces arrive as a follow-channel baseline.
      [sessionsValue, workspaceResult] = await Promise.all([
        remote.call("session/list", { _request: {} }),
        this.remoteWorkspaceBaseline()
          .then((value) => ({ value, degraded: false }))
          .catch(() => ({ value: this.workspaceSnapshot, degraded: true })),
      ]);
    } else {
      [host, sessionsValue, workspaceResult] = await Promise.all([
        this.rpc("host.describe"),
        this.rpc("session.list"),
        this.rpc("workspace.list", {}, 4000)
          .then((value) => ({ value, degraded: false }))
          .catch(() => ({ value: this.workspaceSnapshot, degraded: true })),
      ]);
    }
    const workspaceDegraded = workspaceResult.degraded;
    const workspaceValue = workspaceResult.value || this.workspaceSnapshot;
    if (!workspaceDegraded) {
      this.workspaceSnapshot = {
        items: Array.isArray(workspaceValue?.items) ? workspaceValue.items : [],
        archivedSessionIds: Array.isArray(workspaceValue?.archivedSessionIds) ? workspaceValue.archivedSessionIds : [],
      };
    }
    const archivedSessionIds = Array.isArray(workspaceValue?.archivedSessionIds) ? workspaceValue.archivedSessionIds : [];
    const archived = new Set(archivedSessionIds);
    const workspaceBySessionId = new Map();
    for (const workspace of Array.isArray(workspaceValue?.items) ? workspaceValue.items : []) {
      for (const sessionId of Array.isArray(workspace?.sessionIds) ? workspace.sessionIds : []) {
        if (!workspaceBySessionId.has(sessionId)) workspaceBySessionId.set(sessionId, workspace.workspaceId);
      }
    }
    const sessions = (sessionsValue.items || []).filter((session) => session.origin !== "subagent" && !archived.has(session.sessionId));
    // Per session, and never rejecting. Only the two RPCs used to be guarded, so a single
    // malformed history event thrown by one of the derivation readers rejected the whole
    // Promise.all — and the renderer received {harness:false, sessions:[]}, which is what
    // made every session on screen disappear at once.
    const enriched = await Promise.all(sessions.map(async (session, index) => {
      try {
        return await this.enrichSession(session, index, workspaceBySessionId, selectedSessionId);
      } catch (error) {
        const cachedState = this.sessionStateCache.get(session.sessionId);
        return {
          ...session,
          title: titleFromSession(session),
          subagents: cachedState?.subagents ?? [],
          degraded: true,
          activity: null,
          state: cachedState?.state ?? (session.running ? "working" : "idle"),
          preview: cachedState?.preview ?? "",
          runningSince: session.running ? (cachedState?.runningSince ?? null) : null,
          lastRunMs: cachedState?.lastRunMs ?? null,
          enrichmentError: error instanceof Error ? error.message : String(error),
        };
      }
    }));
    return {
      host: host || {},
      sessions: enriched,
      workspaces: Array.isArray(workspaceValue?.items) ? workspaceValue.items : [],
      archivedSessionIds,
      workspaceDegraded,
    };
  }

  async enrichSession(session, index, workspaceBySessionId, selectedSessionId = null) {
    {
      const cachedState = this.sessionStateCache.get(session.sessionId);
      const shouldEnrich = Boolean(session.running || index < 18 || session.sessionId === selectedSessionId);
      // The selected session is always re-read: its preview, activity and clock
      // are what the open chat renders, and session.list does not promise to
      // bump updatedAt for every new message. Anything else keeps the cache.
      const shouldReadState = shouldEnrich && (!cachedState || cachedState.updatedAt !== session.updatedAt
        || session.sessionId === selectedSessionId);
      // Children can change activity without changing the parent's updatedAt.
      // Refresh their roster on a bounded cadence independent of history polling.
      const now = this.now();
      const shouldReadSubagents = shouldEnrich && (shouldReadState
        || !Number.isFinite(cachedState?.subagentsReadAt)
        || now - cachedState.subagentsReadAt >= this.subagentRefreshMs);
      let degraded = false;
      const [catalog, historyValue] = await Promise.all([
        shouldReadSubagents
          ? this.listSubagents(session.sessionId).catch(() => {
              degraded = true;
              return null;
            })
          : Promise.resolve(null),
        shouldReadState
          ? this.readHistoryEvents(session.sessionId, session.running ? 120 : 12).catch(() => {
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
      // Timing is cached alongside state so a poll that reuses history — most of them —
      // keeps reporting the same turn start instead of dropping the elapsed clock to zero.
      const timing = historyValue ? turnTimingFromHistory(events) : null;
      const runningSince = timing ? timing.runningSince : (cachedState?.runningSince ?? null);
      const lastRunMs = timing?.lastRunMs ?? cachedState?.lastRunMs ?? null;
      this.sessionStateCache.set(session.sessionId, {
        updatedAt: historyValue ? session.updatedAt : cachedState?.updatedAt,
        state: agentState,
        preview,
        subagents,
        subagentsReadAt: shouldReadSubagents ? now : cachedState?.subagentsReadAt,
        runningSince,
        lastRunMs,
      });
      return {
        ...session,
        ...(workspaceBySessionId.has(session.sessionId) ? { workspaceId: workspaceBySessionId.get(session.sessionId) } : {}),
        running: effectiveRunning,
        title: titleFromSession(session),
        subagents,
        degraded,
        activity,
        state: agentState,
        preview,
        runningSince: effectiveRunning ? runningSince : null,
        lastRunMs,
      };
    }
  }

  async history(sessionId) {
    const remote = await this.ensureRemote();
    // The worker reader speaks the legacy wire only; remote generations read pages
    // through follow snapshots and session/page instead.
    if (!remote && this.historyReader && this.fetch === globalThis.fetch && this.rpc === HarnessApi.prototype.rpc) return this.historyReader.read(sessionId);
    const key = String(sessionId || "");
    const cachedHistory = this.cachedHistory(key);
    const cached = cachedHistory?.events || [];
    const cachedSequences = new Set(cached.map((entry) => entry?.event?.seq).filter(Number.isFinite));
    const pages = [];
    let page = await this.fetchHistoryPage(remote, sessionId, { maxMessages: 80 });
    const tailHasMore = Boolean(page.hasMore);
    pages.push(boundedHistoryEntries(page.events || []));
    let overlapsCache = pages[0].some((entry) => cachedSequences.has(entry?.event?.seq));
    let beforeSeq = Infinity;
    while (page.hasMore && (!cachedHistory?.complete || !overlapsCache)) {
      const oldestSeq = Math.min(...pages.at(-1).map((entry) => entry?.event?.seq).filter(Number.isFinite));
      if (!Number.isFinite(oldestSeq) || oldestSeq >= beforeSeq) throw new Error("Harness history pagination made no progress");
      beforeSeq = oldestSeq;
      page = await this.fetchHistoryPage(remote, sessionId, { maxMessages: 80, beforeSeq, throughSeq: page.throughSeq });
      // The newest tail owns the preview budget; strip older pages before fetching more.
      const events = boundedHistoryEntries(page.events || [], 0);
      pages.push(events);
      overlapsCache = events.some((entry) => cachedSequences.has(entry?.event?.seq));
    }
    // A complete newest page replaces the cache, including legitimate /compact shrinkage.
    // Empty responses during restart/re-indexing keep the cached floor; fresh sequenced
    // events always supersede their cached versions.
    const fresh = pages.flat();
    const blankedOut = fresh.length === 0 && cached.length > 0;
    const entries = tailHasMore || blankedOut ? [...cached, ...fresh] : fresh;
    const sequenced = new Map();
    const unsequenced = [];
    for (const entry of entries) {
      const seq = entry?.event?.seq;
      if (Number.isFinite(seq)) sequenced.set(seq, entry);
      else unsequenced.push(entry);
    }
    const events = [...sequenced.entries()].sort(([left], [right]) => left - right).map(([, entry]) => entry).concat(unsequenced);
    const boundedEvents = boundedHistoryEntries(events);
    const revision = historyRevision(boundedEvents);
    const cacheBound = boundedHistoryCacheEntries(boundedEvents, { maxEvents: this.historyCacheEventLimit, maxBytes: this.historyCacheBytesLimit });
    const sourceComplete = !page.hasMore || Boolean(overlapsCache && cachedHistory?.complete);
    const cache = { bytes: cacheBound.bytes, complete: sourceComplete && !cacheBound.truncated, eventCount: cacheBound.entries.length };
    this.cacheHistory(key, { bytes: cache.bytes, complete: cache.complete, events: cacheBound.entries, revision });
    return {
      messages: messagesFromHistory(boundedEvents),
      activity: activityFromHistory(boundedEvents),
      revision,
      unchanged: cachedHistory?.revision === revision,
      cache,
    };
  }

  async createSession(options = {}) {
    const remote = await this.ensureRemote();
    if (remote) {
      const value = await remote.call("session/create", { request: options });
      return value.sessionId;
    }
    const value = await this.rpc("session.create", options);
    return value.sessionId;
  }

  async workspaces() {
    const remote = await this.ensureRemote();
    const value = remote ? await this.remoteWorkspaceBaseline() : await this.rpc("workspace.list", {});
    this.workspaceSnapshot = {
      items: Array.isArray(value?.items) ? value.items : [],
      archivedSessionIds: Array.isArray(value?.archivedSessionIds) ? value.archivedSessionIds : [],
    };
    return this.workspaceSnapshot.items;
  }

  async createWorkspace(workspacePath) {
    const remote = await this.ensureRemote();
    if (remote) {
      const value = await remote.call("workspace/create", { request: { path: workspacePath } });
      return value?.workspace ?? value;
    }
    return this.rpc("workspace.create", { path: workspacePath });
  }

  async models(sessionId) {
    const remote = await this.ensureRemote();
    if (remote) {
      // The remote catalog is host-wide and has no per-session selection, so the
      // default stands in for current; the renderer's picker shape matches already.
      const value = await remote.call("session/modelCatalog", {}, 20000);
      return { current: value.default || null, routable: true, groups: value.groups || [], failures: value.failures || [] };
    }
    if (sessionId) return this.rpc("session.models", { sessionId }, 20000);
    const value = await this.rpc("llm.models", {}, 20000);
    return { current: null, routable: true, groups: value.groups || [], failures: value.failures || [] };
  }

  // The spread used to come last, so a renderer-supplied selection.sessionId would
  // silently overwrite the real one and retarget the call at another session.
  async selectModel(sessionId, selection) {
    const remote = await this.ensureRemote();
    if (remote) return remote.call("session/selectModel", { request: { ...(selection || {}), sessionId } }, 20000);
    return this.rpc("session.selectModel", { ...(selection || {}), sessionId }, 20000);
  }

  async prompt(sessionId, text, timeZone, images = []) {
    const content = [];
    if (text) content.push({ type: "text", text });
    for (const image of images) {
      content.push({ type: "image", mediaType: image.mediaType, data: image.data, name: image.name });
    }
    const remote = await this.ensureRemote();
    if (remote) {
      return remote.call("session/prompt", {
        request: {
          requestId: randomUUID(),
          sessionId,
          mode: "queue",
          content,
          ...(timeZone ? { clientTimeZone: timeZone } : {}),
        },
      }, 30000);
    }
    return this.rpc("session.prompt", {
      sessionId,
      mode: "queue",
      content,
      ...(timeZone ? { clientTimeZone: timeZone } : {}),
    }, 30000);
  }

  async cancel(sessionId) {
    const remote = await this.ensureRemote();
    if (remote) return remote.call("session/cancel", { request: { sessionId } });
    return this.rpc("session.cancel", { sessionId });
  }

  async updateQueue(sessionId, itemId, action) {
    const remote = await this.ensureRemote();
    if (remote) return remote.call("session/updateQueue", { request: { sessionId, itemId, action: adaptQueueAction(action) } }, 10000);
    return this.rpc("session.updateQueue", { sessionId, itemId, action }, 10000);
  }

  async commands(sessionId) {
    const remote = await this.ensureRemote();
    if (remote) return remote.call("commands/list", { agentId: sessionId }, 10000);
    return this.rpc("commands/list", { args: { agentId: sessionId } }, 10000);
  }

  // Skills are a second, separate source for the same "/" menu. Harness's own composer
  // merges them; the widget listed only commands/list, which is why a skill installed in the
  // workspace showed up in Harness and was missing here.
  async skills(sessionId) {
    const remote = await this.ensureRemote();
    if (remote) {
      const value = await remote.call("skills/list", { request: { sessionId } }, 8000);
      return Array.isArray(value?.skills) ? value.skills : [];
    }
    const value = await this.rpc("skill.list", { sessionId }, 8000);
    return Array.isArray(value?.skills) ? value.skills : [];
  }

  // One catalog for the renderer, tagged by source. A Harness build without the skill
  // plugin answers "not found", and that must not take the built-in commands down with it.
  async commandCatalog(sessionId) {
    const [commands, skills] = await Promise.all([
      this.commands(sessionId),
      this.skills(sessionId).catch(() => []),
    ]);
    const entries = (Array.isArray(commands) ? commands : []).map((command) => ({ ...command, kind: "command" }));
    const known = new Set(entries.map((entry) => entry.name.toLowerCase()));
    for (const skill of skills) {
      const name = String(skill?.name || "").trim();
      if (!name || known.has(name.toLowerCase())) continue;
      known.add(name.toLowerCase());
      entries.push({
        name,
        // Harness labels a skill the model cannot start on its own, so the menu says so too
        // instead of promising something that will not happen.
        description: skill.modelInvocable === false
          ? `User only · ${skill.description || ""}`.trim()
          : String(skill.description || ""),
        kind: "skill",
      });
    }
    return entries;
  }

  async executeCommand(sessionId, line, images = []) {
    const remote = await this.ensureRemote();
    if (remote) {
      // Remote attachments are tagged unions; the legacy widget hands over bare image objects.
      const submittedAttachments = images.map((image) => ({ type: "image", ...image }));
      return remote.call("commands/execute", { agentId: sessionId, line, submittedAttachments }, 30000);
    }
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

    // Session permission needs one RPC, rather than adding a second 30s timeout per send.
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
    const key = String(sessionId || "");
    this.fullAccessSessions.delete(key);
    this.sessionStateCache.delete(key);
    this.historyCache.delete(key);
    this.historyReader?.forget(key);
  }

  // Drop per-session state for every session not in the given list (the dashboard's
  // current one). sessionStateCache and fullAccessSessions gained an entry for each
  // session ever seen and were never evicted. The caller must include any session it
  // still shows outside that list, such as an open subagent chat, or its history cache
  // is rebuilt on every read. An empty list is ignored: a Harness that is restarting
  // or re-indexing can answer with no sessions, and wiping the history cache then
  // would defeat the cached floor that keeps a transcript from blanking out.
  retainSessions(sessionIds) {
    const keep = new Set([...(sessionIds || [])].map((id) => String(id || "")).filter(Boolean));
    if (keep.size === 0) return 0;
    const known = new Set([...this.sessionStateCache.keys(), ...this.fullAccessSessions, ...this.historyCache.keys()]);
    let evicted = 0;
    for (const key of known) {
      if (keep.has(key)) continue;
      this.forgetSession(key);
      evicted += 1;
    }
    return evicted;
  }
}

module.exports = {
  HISTORY_PREVIEW_BYTES_BUDGET,
  HarnessApi,
  activityFromHistory,
  boundedHistoryEntries,
  messagesFromHistory,
  readableToolValue,
  reasoningFromBlocks,
  sessionStateFromHistory,
  textFromBlocks,
  titleFromSession,
  toolMessagesFromHistory,
  toolResultFromBlocks,
  turnTimingFromHistory,
  userContentFromBlocks,
};
