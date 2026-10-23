const { randomUUID } = require("node:crypto");
const { isMainThread } = require("node:worker_threads");
const { createHistoryReader } = require("./history-reader.cjs");
const {
  channelFirstFrame,
  commandTimeoutMs,
  createRemoteTransport,
  detectGeneration,
  isStoredSessionRefusal,
  storedSessionRefusalHolds,
} = require("./harness-transport.cjs");
const {
  activityFromHistory,
  sessionStateFromHistory,
  turnTimingFromHistory,
} = require("./session-activity.cjs");
const {
  HISTORY_CACHE_SESSION_LIMIT,
  HISTORY_PREVIEW_BYTES_BUDGET,
  adaptQueueAction,
  boundedHistoryEntries,
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
const { childrenByParent, subagentTree } = require("./subagent-tree.cjs");
const { readHistory } = require("./history-loader.cjs");

class HarnessApi {
  constructor(baseUrl = "http://127.0.0.1:3080", fetchImpl = globalThis.fetch, options = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.fetch = fetchImpl;
    this.sessionStateCache = new Map();
    this.backgroundJobs = new Map();
    this.now = typeof options.now === "function" ? options.now : Date.now;
    this.subagentRefreshMs = positiveInteger(options.subagentRefreshMs, 10000);
    this.historyCache = new Map();
    this.historyCacheSessionLimit = positiveInteger(options.historyCacheSessionLimit, HISTORY_CACHE_SESSION_LIMIT);
    this._historyReaderUrl = this.baseUrl;
    this.historyReader = isMainThread && options.historyWorker !== false
      ? createHistoryReader(this.baseUrl, { historyCacheSessionLimit: this.historyCacheSessionLimit }) : null;
    this.fullAccessSessions = new Set();
    // childSessionId -> parentSessionId, from the last session list. See sessionAddress.
    this.subagentParents = new Map();
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

  // Follow another Harness: DSH Desktop's, or back to Deck's own. Everything learned from
  // the old one goes with it - its generation, its cookie and every per-session cache.
  setBaseUrl(baseUrl) {
    const next = String(baseUrl || "").replace(/\/$/, "");
    if (!next || next === this.baseUrl) return false;
    this.baseUrl = next;
    this._generationPromise = null;
    this._remoteTransport = null;
    for (const cache of [this.sessionStateCache, this.historyCache, this.backgroundJobs, this.fullAccessSessions, this.subagentParents]) cache.clear();
    this.attachmentCache?.clear();
    this.workspaceSnapshot = { items: [], archivedSessionIds: [], pinnedSessionIds: [] };
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

  // The first frame of a read-only stream; see channelFirstFrame in harness-transport.cjs.
  remoteChannelFirstFrame(remote, endpoint, args) {
    return channelFirstFrame(remote, endpoint, args);
  }

  // Drop the minted browser-session cookie so the next remote call re-mints it
  // from the current launch URL. Used after the user pastes a new launch URL;
  // the generation probe stays cached because the Harness itself did not change.
  resetRemoteAuth() {
    try { this._remoteTransport?.dropCookie(); } catch {}
  }

  async isReachable() {
    return (await detectGeneration(this.baseUrl, this.fetch)) !== "down";
  }
  async reconnect() {
    this._generationPromise = null;
    this.resetRemoteAuth();
    const generation = await this.detectGeneration();
    if (generation === "down") throw new Error("Harness is not responding");
    const remote = await this.ensureRemote();
    if (remote) await remote.ensureAuthenticated();
    return true;
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

  // A subagent's log is read under its parent. DSH refuses a plain session address for one
  // ("subagent Sessions require their durable parent address"), which left every subagent's
  // chat on "History could not be loaded". "unknown" mode is the one DSH never checks
  // against the child's own, so a continuable or one-shot child opens alike.
  sessionAddress(sessionId) {
    const parentSessionId = this.subagentParents.get(sessionId);
    return parentSessionId ? { kind: "subagent", parentSessionId, childSessionId: sessionId, mode: "unknown" } : { kind: "session", sessionId };
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
    const address = this.sessionAddress(sessionId);
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
        // Cold on-disk session lists need a larger bounded budget than other calls.
        remote.call("session/list", { _request: {} }, 30000),
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
        pinnedSessionIds: Array.isArray(workspaceValue?.pinnedSessionIds) ? workspaceValue.pinnedSessionIds : [],
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
    // Subagents are sessions too; their rows say whose they are (subagent-tree.cjs).
    const children = remote ? childrenByParent(sessionsValue.items) : null;
    if (children) this.subagentParents = new Map([...children].flatMap(([parent, rows]) => rows.map((row) => [row.sessionId, parent])));
    // Per session, and never rejecting. Only the two RPCs used to be guarded, so a single
    // malformed history event thrown by one of the derivation readers rejected the whole
    // Promise.all — and the renderer received {harness:false, sessions:[]}, which is what
    // made every session on screen disappear at once.
    const enriched = await Promise.all(sessions.map(async (session, index) => {
      try {
        return await this.enrichSession(session, index, workspaceBySessionId, selectedSessionId, Boolean(remote), children);
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
      pinnedSessionIds: Array.isArray(workspaceValue?.pinnedSessionIds) ? workspaceValue.pinnedSessionIds : [],
      workspaceDegraded,
    };
  }

  async enrichSession(session, index, workspaceBySessionId, selectedSessionId = null, remoteGeneration = false, children = null) {
    {
      const cachedState = this.sessionStateCache.get(session.sessionId);
      const shouldEnrich = Boolean(session.running || index < 18 || session.sessionId === selectedSessionId);
      const now = this.now();
      // A refused log is not re-read on every poll: each attempt is a full decode in DSH.
      const refusalHolds = storedSessionRefusalHolds(cachedState?.historyRefusal, session.updatedAt, now);
      // The selected session is always re-read: its preview, activity and clock
      // are what the open chat renders, and session.list does not promise to
      // bump updatedAt for every new message. Anything else keeps the cache.
      const shouldReadState = shouldEnrich && !refusalHolds && (!cachedState || cachedState.updatedAt !== session.updatedAt
        || session.sessionId === selectedSessionId);
      // Children can change activity without changing the parent's updatedAt.
      // Refresh their roster on a bounded cadence independent of history polling.
      const shouldReadSubagents = !children && shouldEnrich && (shouldReadState
        || !Number.isFinite(cachedState?.subagentsReadAt)
        || now - cachedState.subagentsReadAt >= this.subagentRefreshMs);
      let degraded = refusalHolds;
      let historyRefusal = refusalHolds ? cachedState.historyRefusal : null;
      // Once a running turn's start is known, later polls only need its newest events. Reading
      // 120 messages of a long, tool-heavy chat parsed some 8 MB on the main process every poll.
      const knownTurn = remoteGeneration && session.running && Number.isFinite(cachedState?.runningSince);
      const [catalog, historyValue] = await Promise.all([
        shouldReadSubagents
          ? this.listSubagents(session.sessionId).catch(() => {
              degraded = true;
              return null;
            })
          : Promise.resolve(null),
        shouldReadState
          ? this.readHistoryEvents(session.sessionId, session.running ? (knownTurn ? 24 : 120) : 12).catch((error) => {
              degraded = true;
              if (isStoredSessionRefusal(error)) historyRefusal = { updatedAt: session.updatedAt, at: now };
              return null;
            })
          : Promise.resolve(null),
      ]);
      const subagents = children ? subagentTree(session.sessionId, children, session) : catalog ? (catalog.entries || []) : (cachedState?.subagents ?? []);
      const events = historyValue?.events || [];
      // A short read from inside the known turn holds neither its start nor its end.
      const inKnownTurn = knownTurn && !events.some((entry) => ["turn/start", "turn/end"].includes(entry?.event?.type));
      // Modern DSH reports live phase in session/list; a durable history tail can
      // still show the previous ended turn while a new request is starting.
      const historyActivity = historyValue ? activityFromHistory(inKnownTurn ? [{ event: { type: "turn/start" } }, ...events] : events) : null;
      const effectiveRunning = remoteGeneration || !historyValue ? Boolean(session.running) : Boolean(historyActivity?.active);
      const activity = effectiveRunning ? historyActivity : null;
      const agentState = historyValue
        ? sessionStateFromHistory(events, effectiveRunning)
        : (effectiveRunning ? "working" : cachedState?.state === "error" ? "error" : "idle");
      const latestAssistant = historyValue
        ? messagesFromHistory(events).findLast((message) => message.role === "assistant")
        : null;
      const preview = latestAssistant?.text || cachedState?.preview || "";
      // Timing is cached alongside state so a poll that reuses history — most of them —
      // keeps reporting the same turn start instead of dropping the elapsed clock to zero.
      const timing = historyValue && !inKnownTurn ? turnTimingFromHistory(events) : null;
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
        ...(historyRefusal ? { historyRefusal } : {}),
      });
      return {
        ...session,
        ...(workspaceBySessionId.has(session.sessionId) ? { workspaceId: workspaceBySessionId.get(session.sessionId) } : {}),
        running: effectiveRunning,
        backgroundJobCount: this.backgroundJobs.get(session.sessionId) || 0,
        title: titleFromSession(session),
        subagents,
        degraded,
        activity,
        state: agentState,
        preview,
        runningSince: effectiveRunning ? runningSince : null,
        lastRunMs,
        // DSH refuses this chat's saved log; the list says so instead of showing it idle.
        ...(historyRefusal ? { unreadable: true } : {}),
      };
    }
  }

  // Newest messages first; `older` extends the loaded range by a page. See history-loader.cjs.
  async history(sessionId, options = {}) {
    const remote = await this.ensureRemote();
    // The worker reader speaks the legacy wire only; remote generations read pages
    // through follow snapshots and session/page instead.
    if (!remote && this.historyReader && this._historyReaderUrl === this.baseUrl && this.fetch === globalThis.fetch && this.rpc === HarnessApi.prototype.rpc) return this.historyReader.read(sessionId, options);
    return readHistory(this, sessionId, { older: options?.older === true });
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
      // The catalog is host-wide, but current comes from this session's durable projection.
      const [value, snapshot] = await Promise.all([
        remote.call("session/modelCatalog", {}, 20000),
        sessionId ? this.remoteChannelFirstFrame(remote, "session/follow", {
          request: { address: this.sessionAddress(sessionId), maxMessages: 1 },
        }).catch(() => null) : null,
      ]);
      const projection = snapshot?.projections?.values?.modelSelection;
      return {
        current: projection?.next || projection?.lastUsed || value.default || null, routable: true,
        routableProviders: Array.isArray(value.routableProviders) ? value.routableProviders : [],
        groups: Array.isArray(value.groups) ? value.groups : [], failures: Array.isArray(value.failures) ? value.failures : [],
      };
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
    const { originalContent: _originalContent, ...legacyAction } = action || {};
    return this.rpc("session.updateQueue", { sessionId, itemId, action: legacyAction }, 10000);
  }

  async readAttachment(sessionId, attachmentId) {
    const remote = await this.ensureRemote();
    return remote ? remote.call("session/attachment", { request: { sessionId, attachmentId } }, 10000)
      : this.rpc("session.attachment", { sessionId, attachmentId }, 10000);
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
    const timeoutMs = commandTimeoutMs(line);
    const remote = await this.ensureRemote();
    if (remote) {
      // Remote attachments are tagged unions; the legacy widget hands over bare image objects.
      const submittedAttachments = images.map((image) => ({ type: "image", ...image }));
      return remote.call("commands/execute", { agentId: sessionId, line, submittedAttachments }, timeoutMs);
    }
    return this.rpc("commands/execute", {
      args: { agentId: sessionId, line, images },
    }, timeoutMs);
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
