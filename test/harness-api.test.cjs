const test = require("node:test");
const assert = require("node:assert/strict");
const { HISTORY_PREVIEW_BYTES_BUDGET, HarnessApi, activityFromHistory, boundedHistoryEntries, messagesFromHistory, sessionStateFromHistory, titleFromSession, toolMessagesFromHistory } = require("../src/harness-api.cjs");

// Whatever happens to listen on the default loopback port must not decide the wire
// dialect under test: a legacy index answers the generation probe with HTTP 200.
const legacyFetch = async () => ({ ok: true, status: 200 });


test("subagent activity refreshes independently of an unchanged parent with bounded retries", async () => {
  let now = 0;
  let rosterCalls = 0;
  let historyCalls = 0;
  let failRoster = false;
  const api = new HarnessApi(undefined, legacyFetch, { now: () => now, subagentRefreshMs: 10000 });
  api.rpc = async (method) => {
    if (method === "session.history") { historyCalls += 1; return { events: [] }; }
    if (method === "subagent.list") {
      rosterCalls += 1;
      if (failRoster) throw new Error("offline");
      return { entries: [{ sessionId: "child", kind: "child", activity: rosterCalls === 1 ? "running" : "inactive" }] };
    }
    throw new Error(`Unexpected RPC: ${method}`);
  };
  const session = { sessionId: "parent", updatedAt: "same", running: false };
  const read = () => api.enrichSession(session, 0, new Map());
  assert.equal((await read()).subagents[0].activity, "running");
  now = 9999;
  await read();
  assert.equal(rosterCalls, 1);
  now = 10000;
  assert.equal((await read()).subagents[0].activity, "inactive");
  assert.equal(historyCalls, 1);
  failRoster = true;
  now = 20000;
  const failed = await read();
  assert.equal(failed.degraded, true);
  assert.equal(failed.subagents[0].activity, "inactive");
  now = 20001;
  await read();
  assert.equal(rosterCalls, 3);
});

test("dashboard enriches one selected older idle session beyond the bounded recent set", async () => {
  const api = new HarnessApi(undefined, legacyFetch);
  const rosters = [];
  const roots = Array.from({ length: 25 }, (_, index) => ({ sessionId: `root-${index}`, updatedAt: 1, running: false }));
  api.rpc = async (method, payload) => {
    if (method === "host.describe") return {};
    if (method === "session.list") return { items: roots };
    if (method === "workspace.list") return { items: [] };
    if (method === "session.history") return { events: [] };
    if (method === "subagent.list") {
      rosters.push(payload.parentSessionId);
      return { entries: [{ kind: "child", sessionId: `child-of-${payload.parentSessionId}`, activity: "inactive" }] };
    }
    throw new Error(`Unexpected RPC: ${method}`);
  };
  const result = await api.dashboard("root-24");
  assert.equal(rosters.length, 19);
  assert.equal(rosters.includes("root-23"), false);
  assert.equal(result.sessions[24].subagents[0].sessionId, "child-of-root-24");
});

test("RPC carrier sends the official envelope and unwraps the value", async () => {
  let request;
  const api = new HarnessApi("http://127.0.0.1:3080", async (_url, init) => {
    request = JSON.parse(init.body);
    return { ok: true, json: async () => ({ type: "server-response", rpcId: request.rpcId, result: { ok: true, value: { version: "test" } } }) };
  });
  assert.deepEqual(await api.rpc("host.describe"), { version: "test" });
  assert.equal(request.type, "client-request");
  assert.equal(request.method, "host.describe");
});

test("history keeps human and assistant text while hiding injected context and completed reasoning", () => {
  const result = messagesFromHistory([
    { event: { type: "user/message", seq: 1, time: 1, data: { source: { kind: "user" }, content: [{ type: "text", text: "Привет" }] } } },
    { event: { type: "user/message", seq: 2, time: 2, data: { source: { kind: "plugin" }, content: [{ type: "text", text: "hidden" }] } } },
    { event: { type: "assistant/message", seq: 3, time: 3, data: { message: { content: [{ type: "reasoning", text: "hidden" }, { type: "text", text: "Готово" }] } } } },
  ]);
  assert.deepEqual(result.map(({ role, text }) => ({ role, text })), [
    { role: "user", text: "Привет" },
    { role: "assistant", text: "Готово" },
  ]);
});

test("history preserves compact sent attachment metadata including attachment-only messages", () => {
  const result = messagesFromHistory([
    { event: { type: "user/message", seq: 1, data: { source: { kind: "user" }, content: [
      { type: "text", text: "Review this\n\n@C:\\clips\\demo.mp4\n\n@C:\\docs\\notes.txt" },
      { type: "image", mediaType: "image/png", data: "AA==", name: "shot.png" },
    ] } } },
    { event: { type: "user/message", seq: 2, data: { source: { kind: "user-rpc" }, content: [
      { type: "image", mediaType: "image/jpeg", data: "AQ==", name: "only.jpg" },
    ] } } },
  ]);
  assert.equal(result.length, 2);
  assert.equal(result[0].text, "Review this");
  assert.deepEqual(result[0].attachments.map(({ kind, previewKind, name }) => ({ kind, previewKind, name })), [
    { kind: "image", previewKind: undefined, name: "shot.png" },
    { kind: "reference", previewKind: "video", name: "demo.mp4" },
    { kind: "reference", previewKind: "file", name: "notes.txt" },
  ]);
  assert.equal(result[1].text, "");
  assert.equal(result[1].attachments[0].name, "only.jpg");
});

test("history retains only a strict aggregate of newest preview bytes and falls back to icons", () => {
  const eachBytes = Math.floor(HISTORY_PREVIEW_BYTES_BUDGET * 0.6);
  const preview = Buffer.alloc(eachBytes, 7).toString("base64");
  const entries = [1, 2].map((seq) => ({ event: {
    type: "user/message",
    seq,
    data: { source: { kind: "user" }, content: [{
      type: "image", mediaType: "image/png", data: preview, name: `${seq}.png`,
    }] },
  } }));
  const bounded = boundedHistoryEntries(entries);
  assert.equal(bounded[0].event.data.content[0].data, undefined, "older preview must become metadata-only");
  assert.equal(bounded[1].event.data.content[0].data, preview, "newest valid small preview must remain visible");
  assert.equal(entries[0].event.data.content[0].data, preview, "bounding must not mutate the RPC response");

  const messages = messagesFromHistory(entries);
  assert.equal(messages[0].attachments[0].data, undefined);
  assert.equal(messages[0].attachments[0].name, "1.png");
  assert.equal(messages[1].attachments[0].data, preview);
});

test("history paginates to the first message and reuses older pages on refresh", async () => {
  const api = new HarnessApi(undefined, legacyFetch);
  const calls = [];
  const entries = (first, last) => Array.from({ length: last - first + 1 }, (_, offset) => {
    const seq = first + offset;
    return {
      event: {
        type: "user/message",
        seq,
        data: { source: { kind: "user" }, content: [{ type: "text", text: `message-${seq}` }] },
      },
    };
  });
  api.rpc = async (method, payload) => {
    assert.equal(method, "session.history");
    calls.push(payload);
    if (calls.length === 1) return { events: entries(81, 160), hasMore: true };
    if (calls.length === 2) return { events: entries(1, 80), hasMore: false };
    if (calls.length === 3) return { events: entries(82, 161), hasMore: true };
    throw new Error(`Unexpected history page ${calls.length}`);
  };

  const initial = await api.history("long-session");
  assert.equal(initial.messages.length, 160);
  assert.equal(initial.messages[0].text, "message-1");
  assert.equal(initial.messages.at(-1).text, "message-160");
  assert.deepEqual(calls.slice(0, 2), [
    { sessionId: "long-session", maxMessages: 80 },
    { sessionId: "long-session", beforeSeq: 81, maxMessages: 80 },
  ]);

  const refreshed = await api.history("long-session");
  assert.equal(refreshed.messages.length, 161);
  assert.equal(refreshed.messages[0].text, "message-1");
  assert.equal(refreshed.messages.at(-1).text, "message-161");
  assert.equal(calls.length, 3, "a tail page overlapping the complete cache must not reload older pages");
});

test("a truncated history cache repaginates so long conversations remain complete", async () => {
  const api = new HarnessApi("http://127.0.0.1:3080", legacyFetch, {
    historyCacheEventLimit: 2,
    historyCacheBytesLimit: 4096,
  });
  const calls = [];
  const entries = (first, last) => Array.from({ length: last - first + 1 }, (_, offset) => {
    const seq = first + offset;
    return { event: { type: "user/message", seq, data: { source: { kind: "user" }, content: [{ type: "text", text: `message-${seq}` }] } } };
  });
  api.rpc = async (_method, payload) => {
    calls.push(payload);
    if (calls.length === 1) return { events: entries(4, 5), hasMore: true };
    if (calls.length === 2) return { events: entries(1, 3), hasMore: false };
    if (calls.length === 3) return { events: entries(5, 6), hasMore: true };
    if (calls.length === 4) return { events: entries(1, 4), hasMore: false };
    throw new Error(`Unexpected history page ${calls.length}`);
  };

  const initial = await api.history("bounded-long-session");
  assert.deepEqual(initial.messages.map(({ text }) => text), entries(1, 5).map((entry) => `message-${entry.event.seq}`));
  assert.deepEqual(initial.cache, { bytes: initial.cache.bytes, complete: false, eventCount: 2 });

  const refreshed = await api.history("bounded-long-session");
  assert.deepEqual(refreshed.messages.map(({ text }) => text), entries(1, 6).map((entry) => `message-${entry.event.seq}`));
  assert.deepEqual(calls.map(({ beforeSeq }) => beforeSeq ?? null), [null, 4, null, 5]);
  assert.equal(api.historyCache.get("bounded-long-session").events.length, 2);
});

test("history cache enforces byte bounds without truncating the current response", async () => {
  const api = new HarnessApi("http://127.0.0.1:3080", legacyFetch, {
    historyCacheEventLimit: 20,
    historyCacheBytesLimit: 700,
  });
  const events = [1, 2, 3].map((seq) => ({ event: {
    type: "user/message",
    seq,
    data: { source: { kind: "user" }, content: [{ type: "text", text: `${seq}-${"x".repeat(300)}` }] },
  } }));
  api.rpc = async () => ({ events, hasMore: false });

  const result = await api.history("byte-bounded");
  const cached = api.historyCache.get("byte-bounded");
  assert.equal(result.messages.length, 3, "the fetched response remains complete");
  assert.ok(cached.bytes <= 700);
  assert.ok(cached.events.length < events.length);
  assert.equal(cached.complete, false);
  assert.equal(result.cache.complete, false);
});

test("older pages strip repeated base64 before entering the bounded cache", async () => {
  const api = new HarnessApi("http://127.0.0.1:3080", legacyFetch, {
    historyCacheEventLimit: 10,
    historyCacheBytesLimit: 64 * 1024,
  });
  const repeatedPreview = Buffer.alloc(128 * 1024, 7).toString("base64");
  const olderPage = [1, 2].map((seq) => ({ event: {
    type: "user/message",
    seq,
    data: { source: { kind: "user" }, content: [{
      type: "image", mediaType: "image/png", name: `${seq}.png`, data: repeatedPreview,
    }] },
  } }));
  let call = 0;
  api.rpc = async () => {
    call += 1;
    return call === 1
      ? { events: [{ event: { type: "assistant/message", seq: 3, data: { message: { content: [{ type: "text", text: "done" }] } } } }], hasMore: true }
      : { events: olderPage, hasMore: false };
  };

  const result = await api.history("image-pages");
  const cachedJson = JSON.stringify(api.historyCache.get("image-pages"));
  assert.equal(result.messages[0].attachments[0].data, undefined);
  assert.equal(result.messages[1].attachments[0].data, undefined);
  assert.equal(cachedJson.includes(repeatedPreview), false);
  assert.equal(olderPage[0].event.data.content[0].data, repeatedPreview, "the RPC response is not mutated");
});

test("history revisions are stable and the per-session cache uses LRU eviction", async () => {
  const api = new HarnessApi("http://127.0.0.1:3080", legacyFetch, {
    historyCacheSessionLimit: 2,
    historyCacheEventLimit: 10,
    historyCacheBytesLimit: 4096,
  });
  const versions = new Map();
  api.rpc = async (_method, { sessionId }) => {
    const count = versions.get(sessionId) || 1;
    return {
      events: Array.from({ length: count }, (_, index) => ({ event: {
        type: "assistant/message",
        seq: index + 1,
        data: { message: { content: [{ type: "text", text: `${sessionId}-${index + 1}` }] } },
      } })),
      hasMore: false,
    };
  };

  const first = await api.history("a");
  const unchanged = await api.history("a");
  assert.equal(first.unchanged, false);
  assert.equal(unchanged.unchanged, true);
  assert.equal(unchanged.revision, first.revision);

  versions.set("a", 2);
  const changed = await api.history("a");
  assert.equal(changed.unchanged, false);
  assert.notEqual(changed.revision, first.revision);

  await api.history("b");
  await api.history("a");
  await api.history("c");
  assert.deepEqual([...api.historyCache.keys()], ["a", "c"], "the least recently used session is evicted");

  api.fullAccessSessions.add("a");
  api.sessionStateCache.set("a", { updatedAt: 1 });
  api.forgetSession("a");
  assert.equal(api.historyCache.has("a"), false);
  assert.equal(api.sessionStateCache.has("a"), false);
  assert.equal(api.fullAccessSessions.has("a"), false);
});

test("completed reasoning disappears with the live activity card after turn end", () => {
  const activity = activityFromHistory([
    { event: { type: "turn/start", seq: 1, data: {} } },
    { event: { type: "assistant/chunk", seq: 2, data: { chunk: { type: "reasoning-delta", text: "private chain" } } } },
    { event: { type: "assistant/message", seq: 3, data: { message: { content: [{ type: "reasoning", text: "private chain" }, { type: "text", text: "Done" }] } } } },
    { event: { type: "turn/end", seq: 4, data: {} } },
  ]);
  assert.equal(activity, null);
});

test("agent session state distinguishes working, idle, and the latest turn error", () => {
  assert.equal(sessionStateFromHistory([], true), "working");
  assert.equal(sessionStateFromHistory([{ event: { type: "turn/end", data: { reason: { kind: "success" } } } }]), "idle");
  assert.equal(sessionStateFromHistory([{ event: { type: "turn/end", data: { reason: { kind: "error", error: { message: "boom" } } } } }]), "error");
});

test("dashboard ignores stale session.list running after a successful turn end", async () => {
  const api = new HarnessApi(undefined, legacyFetch);
  api.rpc = async (method) => {
    if (method === "host.describe") return { version: "test" };
    if (method === "session.list") {
      return { items: [{ sessionId: "ended", running: true, updatedAt: 10, cwd: "C:\\AI\\ended" }] };
    }
    if (method === "subagent.list") return { entries: [] };
    if (method === "session.history") {
      return {
        events: [
          { event: { type: "turn/start", seq: 1, data: {} } },
          { event: { type: "assistant/chunk", seq: 2, data: { chunk: { type: "text-delta", text: "Done" } } } },
          { event: { type: "turn/end", seq: 3, data: { reason: { kind: "success" } } } },
        ],
      };
    }
    throw new Error(`Unexpected RPC ${method}`);
  };

  const { sessions } = await api.dashboard();
  assert.equal(sessions[0].running, false);
  assert.equal(sessions[0].state, "idle");
  assert.equal(sessions[0].activity, null);
});

test("dashboard turns stale running into error after a failed Harness turn", async () => {
  const api = new HarnessApi(undefined, legacyFetch);
  api.rpc = async (method) => {
    if (method === "host.describe") return { version: "test" };
    if (method === "session.list") {
      return { items: [{ sessionId: "failed", running: true, updatedAt: 11, cwd: "C:\\AI\\failed" }] };
    }
    if (method === "subagent.list") return { entries: [] };
    if (method === "session.history") {
      return {
        events: [
          { event: { type: "turn/start", seq: 1, data: {} } },
          { event: { type: "assistant/message", seq: 2, data: { message: { content: [{ type: "text", text: "400: No models loaded" }] } } } },
          { event: { type: "turn/end", seq: 3, data: { reason: { kind: "error", error: { message: "400: No models loaded" } } } } },
        ],
      };
    }
    throw new Error(`Unexpected RPC ${method}`);
  };

  const { sessions } = await api.dashboard();
  assert.equal(sessions[0].running, false);
  assert.equal(sessions[0].state, "error");
  assert.equal(sessions[0].activity, null);
  assert.match(sessions[0].preview, /400: No models loaded/);
});

test("dashboard retries a transient history failure instead of caching a stale working state", async () => {
  const api = new HarnessApi(undefined, legacyFetch);
  let poll = 0;
  let historyCalls = 0;
  api.rpc = async (method) => {
    if (method === "host.describe") return { version: "test" };
    if (method === "session.list") {
      poll += 1;
      return {
        items: [{
          sessionId: "transient-history-failure",
          running: poll === 1,
          updatedAt: poll === 1 ? 10 : 11,
          cwd: "C:\\AI\\transient-history-failure",
        }],
      };
    }
    if (method === "subagent.list") return { entries: [] };
    if (method === "session.history") {
      historyCalls += 1;
      if (historyCalls === 2) throw new Error("temporary history outage");
      return {
        events: historyCalls === 1
          ? [{ event: { type: "turn/start", seq: 1, data: {} } }]
          : [
              { event: { type: "turn/start", seq: 1, data: {} } },
              { event: { type: "turn/end", seq: 2, data: { reason: { kind: "success" } } } },
            ],
      };
    }
    throw new Error(`Unexpected RPC ${method}`);
  };

  const first = await api.dashboard();
  assert.equal(first.sessions[0].state, "working");
  assert.equal(first.sessions[0].running, true);

  const second = await api.dashboard();
  assert.equal(second.sessions[0].state, "idle");
  assert.equal(second.sessions[0].running, false);
  assert.equal(second.sessions[0].degraded, true);

  const third = await api.dashboard();
  assert.equal(third.sessions[0].state, "idle");
  assert.equal(third.sessions[0].running, false);
  assert.equal(third.sessions[0].degraded, false);
  assert.equal(historyCalls, 3);
});

test("dashboard keeps every root session while workspace membership and enrichment stay bounded", async () => {
  const api = new HarnessApi(undefined, legacyFetch);
  const rootSessions = Array.from({ length: 23 }, (_, index) => ({
    sessionId: `root-${index}`,
    running: index === 21,
    updatedAt: 100 + index,
    cwd: index === 3 ? "C:\\AI\\shared-worktree" : `C:\\AI\\root-${index}`,
  }));
  rootSessions[2].cwd = "C:\\AI\\shared-worktree";

  const workspaces = [
    {
      workspaceId: "workspace-exact",
      name: "Exact membership",
      sessionIds: ["root-2", "root-20"],
    },
    {
      workspaceId: "workspace-second",
      name: "Second workspace",
      sessionIds: ["root-20", "root-22"],
    },
  ];
  const archivedSessionIds = ["archived-root"];
  const expensiveCalls = [];

  api.rpc = async (method, payload) => {
    if (method === "host.describe") return { version: "test" };
    if (method === "session.list") {
      return {
        items: [
          ...rootSessions,
          { sessionId: "archived-root", running: false, updatedAt: 1, cwd: "C:\\AI\\archived" },
          { sessionId: "nested-agent", origin: "subagent", running: true, updatedAt: 1, cwd: "C:\\AI\\nested" },
        ],
      };
    }
    if (method === "workspace.list") return { items: workspaces, archivedSessionIds };
    if (method === "subagent.list" || method === "session.history") {
      expensiveCalls.push({ method, payload });
      return method === "subagent.list" ? { entries: [] } : { events: [] };
    }
    throw new Error(`Unexpected RPC ${method}`);
  };

  const dashboard = await api.dashboard();

  assert.equal(dashboard.sessions.length, 23, "the dashboard must not truncate root sessions at 18");
  assert.deepEqual(dashboard.sessions.map((session) => session.sessionId), rootSessions.map((session) => session.sessionId));
  assert.deepEqual(dashboard.workspaces, workspaces);
  assert.deepEqual(dashboard.archivedSessionIds, archivedSessionIds);
  assert.equal(dashboard.sessions.some((session) => session.sessionId === "archived-root"), false);
  assert.equal(dashboard.sessions.some((session) => session.sessionId === "nested-agent"), false);

  const byId = new Map(dashboard.sessions.map((session) => [session.sessionId, session]));
  assert.equal(byId.get("root-2").workspaceId, "workspace-exact");
  assert.equal(byId.get("root-20").workspaceId, "workspace-exact", "first explicit workspace membership wins");
  assert.equal(byId.get("root-22").workspaceId, "workspace-second");
  assert.equal(byId.get("root-3").workspaceId, undefined, "matching cwd must not imply workspace membership");

  const historyCalls = expensiveCalls.filter(({ method }) => method === "session.history");
  const subagentCalls = expensiveCalls.filter(({ method }) => method === "subagent.list");
  const expectedEnrichedIds = [...rootSessions.slice(0, 18).map((session) => session.sessionId), "root-21"];
  assert.deepEqual(historyCalls.map(({ payload }) => payload.sessionId), expectedEnrichedIds);
  assert.deepEqual(subagentCalls.map(({ payload }) => payload.parentSessionId), expectedEnrichedIds);
  assert.equal(historyCalls.length, 19, "only the first 18 sessions and later running sessions are enriched");
  assert.equal(subagentCalls.length, 19, "subagent enrichment follows the same bound");
  assert.equal(historyCalls.find(({ payload }) => payload.sessionId === "root-21").payload.maxMessages, 120);
});

test("dashboard preserves the last workspace and archive snapshot across a transient workspace failure", async () => {
  const api = new HarnessApi(undefined, legacyFetch);
  let workspacePoll = 0;
  const workspaces = [{ workspaceId: "workspace-stable", path: "C:\\AI\\stable", sessionIds: ["member"] }];
  const archivedSessionIds = ["archived"];
  api.rpc = async (method) => {
    if (method === "host.describe") return { version: "test" };
    if (method === "session.list") {
      return {
        items: [
          { sessionId: "member", running: false, updatedAt: 1, cwd: "C:\\AI\\stable" },
          { sessionId: "archived", running: false, updatedAt: 1, cwd: "C:\\AI\\archived" },
        ],
      };
    }
    if (method === "workspace.list") {
      workspacePoll += 1;
      if (workspacePoll === 2) throw new Error("temporary workspace outage");
      return { items: workspaces, archivedSessionIds };
    }
    if (method === "subagent.list") return { entries: [] };
    if (method === "session.history") return { events: [] };
    throw new Error(`Unexpected RPC ${method}`);
  };

  const first = await api.dashboard();
  const degraded = await api.dashboard();

  assert.equal(first.workspaceDegraded, false);
  assert.equal(degraded.workspaceDegraded, true);
  assert.deepEqual(degraded.workspaces, workspaces);
  assert.deepEqual(degraded.archivedSessionIds, archivedSessionIds);
  assert.deepEqual(degraded.sessions.map((session) => session.sessionId), ["member"]);
  assert.equal(degraded.sessions[0].workspaceId, "workspace-stable");
});

test("a direct workspace refresh seeds the same fallback snapshot used by dashboard", async () => {
  const api = new HarnessApi(undefined, legacyFetch);
  let workspacePoll = 0;
  const workspace = { workspaceId: "direct-workspace", path: "C:\\AI\\direct", sessionIds: ["direct-member"] };
  api.rpc = async (method) => {
    if (method === "workspace.list") {
      workspacePoll += 1;
      if (workspacePoll > 1) throw new Error("temporary workspace outage");
      return { items: [workspace], archivedSessionIds: ["archived"] };
    }
    if (method === "host.describe") return { version: "test" };
    if (method === "session.list") return { items: [{ sessionId: "direct-member", running: false, updatedAt: 1 }] };
    if (method === "subagent.list") return { entries: [] };
    if (method === "session.history") return { events: [] };
    throw new Error(`Unexpected RPC ${method}`);
  };

  assert.deepEqual(await api.workspaces(), [workspace]);
  const dashboard = await api.dashboard();
  assert.equal(dashboard.workspaceDegraded, true);
  assert.deepEqual(dashboard.workspaces, [workspace]);
  assert.deepEqual(dashboard.archivedSessionIds, ["archived"]);
  assert.equal(dashboard.sessions[0].workspaceId, "direct-workspace");
});

test("live reasoning deltas become a compact activity stream", () => {
  const activity = activityFromHistory([
    { event: { type: "turn/start", seq: 1, data: {} } },
    { event: { type: "assistant/chunk", seq: 2, data: { chunk: { type: "reasoning-delta", text: "Inspecting " } } } },
    { event: { type: "assistant/chunk", seq: 3, data: { chunk: { type: "reasoning-delta", text: "the project" } } } },
  ]);
  assert.deepEqual(activity, { active: true, kind: "thinking", label: "Thinking", text: "Inspecting the project" });
});

test("an unfinished Harness tool call becomes the live tool activity", () => {
  const activity = activityFromHistory([
    { event: { type: "turn/start", seq: 1, data: {} } },
    { event: { type: "assistant/chunk", seq: 2, data: { chunk: { type: "reasoning-delta", text: "Need the file" } } } },
    { event: { type: "tool/call", seq: 3, data: { callId: "call-1", name: "read_file", arguments: "{}" } } },
  ]);
  assert.deepEqual(activity, { active: true, kind: "tool", label: "Using tool", text: "read_file" });
});

test("completed tool activity removes the chat glow until new model output", () => {
  const activity = activityFromHistory([
    { event: { type: "turn/start", seq: 1, data: {} } },
    { event: { type: "tool/call", seq: 2, data: { callId: "call-1", name: "read_file", arguments: "{}" } } },
    { event: { type: "tool/result", seq: 3, data: { message: { source: { kind: "tool", callId: "call-1" }, content: [{ type: "tool-result", toolCallId: "call-1", content: [{ type: "text", text: "ok" }] }] } } } },
  ]);
  assert.equal(activity.kind, "working");
});

test("session title falls back to the workspace folder", () => {
  assert.equal(titleFromSession({ cwd: "C:\\AI\\demo" }), "demo");
});

test("history includes Harness command runs and results", () => {
  const result = messagesFromHistory([
    { event: { type: "command/run", seq: 1, time: 1, data: { name: "goal", args: "", source: { kind: "user" } } } },
    { event: { type: "command/done", seq: 2, time: 2, data: { kind: "success", text: "No goal is currently set." } } },
  ]);
  assert.deepEqual(result.map(({ role, text }) => ({ role, text })), [
    { role: "user", text: "/goal" },
    { role: "command", text: "No goal is currently set." },
  ]);
});

test("automatic Full access commands are hidden from widget history", () => {
  const result = messagesFromHistory([
    { event: { type: "command/run", seq: 1, data: { commandId: "auto", name: "permission", args: " danger-full-access", source: { kind: "user" } } } },
    { event: { type: "command/done", seq: 2, data: { commandId: "auto", kind: "success", text: "Permission preset: danger-full-access" } } },
    { event: { type: "assistant/message", seq: 3, data: { message: { content: [{ type: "text", text: "Ready" }] } } } },
  ]);
  assert.deepEqual(result.map(({ role, text }) => ({ role, text })), [{ role: "assistant", text: "Ready" }]);
});

test("widget Full access uses the exact preset accepted by Harness", async () => {
  const api = new HarnessApi(undefined, legacyFetch);
  let line;
  api.executeCommand = async (_sessionId, value) => {
    line = value;
    return { result: { kind: "success", text: "Permission preset: danger-full-access" } };
  };
  await api.ensureFullAccess("session-test");
  assert.equal(line, "/permission danger-full-access");
});

test("official Harness tool call and result events become one collapsed-card model", () => {
  const events = [
    { event: { type: "tool/call", seq: 4, time: 1000, data: { turn: 1, step: 1, callId: "call-1", name: "read_file", arguments: '{"path":"src/main.cjs"}' } } },
    { event: { type: "tool/result", seq: 5, time: 1245, data: { turn: 1, step: 1, message: { role: "user", source: { kind: "tool", callId: "call-1" }, content: [{ type: "tool-result", toolCallId: "call-1", content: [{ type: "text", text: "412 lines" }] }] } } } },
  ];
  assert.deepEqual(toolMessagesFromHistory(events), [{
    role: "tool",
    callId: "call-1",
    name: "read_file",
    arguments: '{\n  "path": "src/main.cjs"\n}',
    result: "412 lines",
    status: "done",
    isError: false,
    nested: false,
    durationMs: 245,
    time: 1000,
    seq: 4,
  }]);
});

test("Code Mode sub-dispatches and tool failures retain nested/error state", () => {
  const events = [
    { event: { type: "tool/code-dispatch-start", seq: 8, time: "2026-08-25T10:00:00.000Z", data: { rootCallId: "root", parentCallId: "root", subCallId: "root:code:1", name: "shell", arguments: { command: "npm test" } } } },
    { event: { type: "tool/code-dispatch", seq: 9, time: "2026-08-25T10:00:01.500Z", data: { rootCallId: "root", parentCallId: "root", subCallId: "root:code:1", name: "shell", arguments: { command: "npm test" }, isError: true, content: [{ type: "text", text: "exit 1" }] } } },
  ];
  const [call] = toolMessagesFromHistory(events);
  assert.equal(call.nested, true);
  assert.equal(call.isError, true);
  assert.equal(call.status, "error");
  assert.equal(call.result, "exit 1");
  assert.equal(call.durationMs, 1500);
});

test("command discovery uses the installed Harness remote endpoint", async () => {
  let url;
  let request;
  const api = new HarnessApi("http://127.0.0.1:3080", async (input, init) => {
    url = input;
    request = JSON.parse(init.body);
    return { ok: true, json: async () => ({ type: "server-response", rpcId: request.rpcId, result: { ok: true, value: [] } }) };
  });
  await api.commands("session-test");
  assert.equal(url, "http://127.0.0.1:3080/api/commands/list");
  assert.deepEqual(request.payload, { args: { agentId: "session-test" } });
});

test("low-level command RPC forwards images without applying widget permission policy", async () => {
  let request;
  const api = new HarnessApi("http://127.0.0.1:3080", async (_url, init) => {
    request = JSON.parse(init.body);
    return { ok: true, json: async () => ({ type: "server-response", rpcId: request.rpcId, result: { ok: true, value: { result: { kind: "success" } } } }) };
  });
  const images = [{ mediaType: "image/png", data: "AA==", name: "command-shot.png" }];

  await api.executeCommand("session-test", "/permission read-only", images);

  assert.equal(request.method, "commands/execute");
  assert.deepEqual(request.payload, {
    args: { agentId: "session-test", line: "/permission read-only", images },
  });
});

test("widget commands forward images but allow only the exact Full access permission mode", async () => {
  const api = new HarnessApi(undefined, legacyFetch);
  const calls = [];
  api.executeCommand = async (...args) => {
    calls.push(args);
    return { result: { kind: "success" } };
  };
  const images = [{ mediaType: "image/jpeg", data: "AQ==", name: "screen.jpg" }];

  await api.executeWidgetCommand("session-test", "  /permission danger-full-access  ", images);
  assert.deepEqual(calls, [["session-test", "/permission danger-full-access", images]]);

  for (const line of [
    "/permission",
    "/permission read-only",
    "/permission workspace-write",
    "/permission DANGER-FULL-ACCESS",
    "/permission danger-full-access extra",
  ]) {
    await assert.rejects(
      api.executeWidgetCommand("session-test", line, images),
      /always use Full access/,
      line,
    );
  }
  assert.equal(calls.length, 1, "rejected permission commands must not reach the low-level RPC");
});

test("prompt carries image attachments through the official content blocks", async () => {
  let request;
  const api = new HarnessApi("http://127.0.0.1:3080", async (_url, init) => {
    request = JSON.parse(init.body);
    return { ok: true, json: async () => ({ type: "server-response", rpcId: request.rpcId, result: { ok: true, value: { accepted: true } } }) };
  });
  await api.prompt("session-test", "inspect", "UTC", [{ mediaType: "image/png", data: "AA==", name: "shot.png" }]);
  assert.deepEqual(request.payload.content, [
    { type: "text", text: "inspect" },
    { type: "image", mediaType: "image/png", data: "AA==", name: "shot.png" },
  ]);
});

// One bad session used to take the whole dashboard offline: only the two RPCs were guarded,
// so a throw from the derivation readers rejected the shared Promise.all and the renderer
// received {harness:false, sessions:[]} — every session on screen vanished at once.
test("a session that fails to enrich degrades alone", async () => {
  const api = new HarnessApi(undefined, legacyFetch);
  api.rpc = async (method, payload) => {
    if (method === "host.describe") return { version: "test" };
    if (method === "session.list") {
      return { items: [
        { sessionId: "poison", running: true, updatedAt: 1, cwd: "C:\AI\poison" },
        { sessionId: "healthy", running: false, updatedAt: 2, cwd: "C:\AI\healthy" },
      ] };
    }
    if (method === "subagent.list") return { entries: [] };
    if (method === "session.history") {
      if (payload.sessionId === "poison") return { get events() { throw new Error("malformed history page"); } };
      return { events: [{ event: { type: "turn/end", seq: 1, time: 2, data: { reason: { kind: "success" } } } }] };
    }
    if (method === "workspace.list") return { items: [], archivedSessionIds: [] };
    throw new Error(`Unexpected RPC ${method}`);
  };

  const { sessions } = await api.dashboard();
  assert.equal(sessions.length, 2, "the healthy session still arrives");
  const poison = sessions.find((session) => session.sessionId === "poison");
  assert.equal(poison.degraded, true);
  assert.match(poison.enrichmentError, /malformed history page/);
  assert.equal(sessions.find((session) => session.sessionId === "healthy").state, "idle");
});

test("dashboard reports how long the current turn has been running", async () => {
  const api = new HarnessApi(undefined, legacyFetch);
  let historyCalls = 0;
  api.rpc = async (method) => {
    if (method === "host.describe") return { version: "test" };
    if (method === "session.list") return { items: [{ sessionId: "busy", running: true, updatedAt: 7, cwd: "C:\AI\busy" }] };
    if (method === "subagent.list") return { entries: [] };
    if (method === "session.history") {
      historyCalls += 1;
      return { events: [
        { event: { type: "turn/start", seq: 1, time: 1000, data: {} } },
        { event: { type: "assistant/chunk", seq: 2, time: 1200, data: { chunk: { type: "text-delta", text: "…" } } } },
      ] };
    }
    if (method === "workspace.list") return { items: [], archivedSessionIds: [] };
    throw new Error(`Unexpected RPC ${method}`);
  };

  const first = await api.dashboard();
  assert.equal(first.sessions[0].runningSince, 1000);
  // The second poll reuses the cached history, and the clock must not reset to null with it.
  const second = await api.dashboard();
  assert.equal(historyCalls, 1, "history was served from the cache");
  assert.equal(second.sessions[0].runningSince, 1000);
});

test("the selected session re-reads history on every dashboard poll", async () => {
  const api = new HarnessApi(undefined, legacyFetch);
  const historySessions = [];
  api.rpc = async (method, payload) => {
    if (method === "host.describe") return { version: "test" };
    if (method === "session.list") {
      return { items: [
        { sessionId: "open-chat", running: false, updatedAt: 5, cwd: "C:\\AI\\open" },
        { sessionId: "background-chat", running: false, updatedAt: 5, cwd: "C:\\AI\\bg" },
      ] };
    }
    if (method === "workspace.list") return { items: [], archivedSessionIds: [] };
    if (method === "subagent.list") return { entries: [] };
    if (method === "session.history") {
      historySessions.push(payload.sessionId);
      return { events: [] };
    }
    throw new Error(`Unexpected RPC ${method}`);
  };

  // session.list updatedAt never moves, yet the open chat must see new messages
  // while background sessions keep their cached enrichment.
  await api.dashboard("open-chat");
  await api.dashboard("open-chat");
  assert.equal(historySessions.filter((id) => id === "open-chat").length, 2);
  assert.equal(historySessions.filter((id) => id === "background-chat").length, 1);
});

// A restart that answers an empty page for a session that had a conversation is a fault, not
// a compaction. Replacing the cache with it blanked the chat and cached the blank as final.
test("an empty history answer cannot blank a conversation the widget already had", async () => {
  const api = new HarnessApi(undefined, legacyFetch);
  const full = [1, 2, 3].map((seq) => ({ event: { type: "assistant/message", seq, time: seq, data: { message: { content: [{ type: "text", text: `line ${seq}` }] } } } }));
  let page = { events: full, hasMore: false };
  api.rpc = async () => page;

  const before = await api.history("s1");
  assert.equal(before.messages.length, 3);

  page = { events: [], hasMore: false };
  const during = await api.history("s1");
  assert.equal(during.messages.length, 3, "the transcript survives the empty answer");

  // A real compaction still shrinks it: a shorter but non-empty answer is authoritative.
  page = { events: full.slice(2), hasMore: false };
  const compacted = await api.history("s1");
  assert.equal(compacted.messages.length, 1, "/compact still truncates");
});

test("the command catalog merges Harness commands with installed skills", async () => {
  const api = new HarnessApi(undefined, legacyFetch);
  api.rpc = async (method) => {
    if (method === "commands/list") return [{ name: "goal", description: "Set a goal" }];
    if (method === "skill.list") {
      return { skills: [
        { name: "neoxider-agents", description: "Run the agent fleet", modelInvocable: true },
        { name: "manual-only", description: "Needs a human", modelInvocable: false },
        { name: "goal", description: "shadows a real command", modelInvocable: true },
      ] };
    }
    throw new Error(`Unexpected RPC ${method}`);
  };

  const catalog = await api.commandCatalog("s1");
  assert.deepEqual(catalog.map(({ name, kind }) => ({ name, kind })), [
    { name: "goal", kind: "command" },
    { name: "neoxider-agents", kind: "skill" },
    { name: "manual-only", kind: "skill" },
  ], "a skill cannot shadow a host command of the same name");
  assert.match(catalog[2].description, /^User only · /);
});

// Not every Harness build has the skill plugin; skill.list answers "not found" there.
test("a Harness without skills still returns its commands", async () => {
  const api = new HarnessApi(undefined, legacyFetch);
  api.rpc = async (method) => {
    if (method === "commands/list") return [{ name: "compact", description: "Compact history" }];
    throw new Error("not found");
  };
  assert.deepEqual(await api.commandCatalog("s1"), [{ name: "compact", description: "Compact history", kind: "command" }]);
});

// Connect pastes a launch URL for a Harness the widget does not own. The cookie is
// minted from whatever resolveLaunchBrowserUrl returns, so unless the candidate is put
// in front of the stored one, the check verifies the wrong secret: nothing at all on a
// first connect, and the previous good URL when one is stored.
test("a launch URL under verification outranks the stored one, and only while it is checked", async () => {
  const api = new HarnessApi(undefined, legacyFetch, { getLaunchBrowserUrl: () => "http://127.0.0.1:3080/?token=stored" });
  assert.equal(api.resolveLaunchBrowserUrl(), "http://127.0.0.1:3080/?token=stored");

  const seen = [];
  api.dashboard = async () => { seen.push(api.resolveLaunchBrowserUrl()); return { sessions: [] }; };
  assert.equal(await api.verifyLaunchUrl("http://127.0.0.1:3080/?token=candidate"), true);
  assert.deepEqual(seen, ["http://127.0.0.1:3080/?token=candidate"]);
  assert.equal(api.resolveLaunchBrowserUrl(), "http://127.0.0.1:3080/?token=stored", "the candidate is dropped once the check is over");

  // A first connect has nothing stored; the candidate is the only thing that can answer.
  const fresh = new HarnessApi(undefined, legacyFetch);
  assert.equal(fresh.resolveLaunchBrowserUrl(), "");
  const freshSeen = [];
  fresh.dashboard = async () => { freshSeen.push(fresh.resolveLaunchBrowserUrl()); return { sessions: [] }; };
  await fresh.verifyLaunchUrl("http://127.0.0.1:3080/?token=first");
  assert.deepEqual(freshSeen, ["http://127.0.0.1:3080/?token=first"]);

  // A rejected candidate must not linger and shadow the stored URL afterwards.
  api.dashboard = async () => { throw new Error("Harness HTTP 401"); };
  await assert.rejects(api.verifyLaunchUrl("http://127.0.0.1:3080/?token=bad"), /401/);
  assert.equal(api.resolveLaunchBrowserUrl(), "http://127.0.0.1:3080/?token=stored");
  await assert.rejects(api.verifyLaunchUrl("   "), /Paste the Harness launch URL/);
});

// A remote follow snapshot that says hasMore but carries no cursor cannot be paged:
// session/page needs throughSeq. The next fetch took the snapshot branch again, got the
// identical page and threw "no progress", so the whole transcript failed to load.
test("a remote snapshot without a cursor is served instead of dead-ending pagination", async () => {
  const api = new HarnessApi(undefined, legacyFetch, { historyWorker: false });
  const records = [3, 4].map((seq) => ({ event: { type: "assistant/message", seq, data: { message: { content: [{ type: "text", text: `line ${seq}` }] } } } }));
  let opens = 0;
  const remote = {
    openChannel: async ({ endpoint, onFrame }) => {
      assert.equal(endpoint, "session/follow");
      opens += 1;
      queueMicrotask(() => onFrame({ type: "snapshot", records, hasMore: true }));
      return { close() {}, closed: new Promise(() => {}) };
    },
    call: async (endpoint) => { throw new Error(`unexpected ${endpoint} without a cursor`); },
  };
  api.ensureRemote = async () => remote;

  const result = await api.history("s1");
  assert.deepEqual(result.messages.map((message) => message.text), ["line 3", "line 4"]);
  assert.equal(opens, 1, "one snapshot, no second identical fetch");

  // With a cursor the older page is still walked.
  const older = [{ event: { type: "assistant/message", seq: 1, data: { message: { content: [{ type: "text", text: "line 1" }] } } } }];
  const pages = [];
  remote.openChannel = async ({ onFrame }) => {
    queueMicrotask(() => onFrame({ type: "snapshot", records, hasMore: true, cursor: 4 }));
    return { close() {}, closed: new Promise(() => {}) };
  };
  remote.call = async (endpoint, args) => {
    pages.push([endpoint, args.request.throughSeq, args.request.beforeSeq]);
    return { records: older, hasMore: false };
  };
  const paged = await api.history("s2");
  assert.deepEqual(pages, [["session/page", 4, 3]]);
  assert.deepEqual(paged.messages.map((message) => message.text), ["line 1", "line 3", "line 4"]);
});

test("remote models keep the full host catalog and use the addressed session selection", async () => {
  const api = new HarnessApi(undefined, legacyFetch, { historyWorker: false });
  const groups = [
    { id: "local", name: "Local", models: [{ id: "large", name: "Large" }] },
    { id: "cloud", name: "Cloud", models: [{ id: "fast", name: "Fast" }] },
  ];
  const calls = [];
  let hostDefault = { provider: "local", model: "large" };
  const selections = {
    "widget-session": { provider: "local", model: "large", reasoningEffort: "high" },
    "dsh-session": { provider: "cloud", model: "fast" },
  };
  const remote = {
    call: async (endpoint, args) => {
      calls.push([endpoint, args]);
      assert.equal(endpoint, "session/modelCatalog");
      return {
        default: hostDefault,
        routableProviders: ["local", "cloud"],
        groups,
        failures: [{ id: "offline", name: "Offline", message: "unavailable" }],
      };
    },
    openChannel: async ({ endpoint, args, onFrame }) => {
      calls.push([endpoint, args]);
      const current = selections[args.request.address.sessionId];
      queueMicrotask(() => onFrame({
        type: "snapshot",
        records: [],
        projections: {
          asOfSeq: 9,
          values: {
            modelSelection: {
              lastUsed: { provider: "cloud", model: "fast" },
              next: current,
            },
          },
        },
      }));
      return { close() {}, closed: new Promise(() => {}) };
    },
  };
  api.ensureRemote = async () => remote;

  const catalog = await api.models("widget-session");

  assert.deepEqual(catalog.current, { provider: "local", model: "large", reasoningEffort: "high" });
  assert.deepEqual(catalog.groups, groups, "all host groups and models reach the picker");
  assert.deepEqual(catalog.routableProviders, ["local", "cloud"]);
  assert.deepEqual(catalog.failures, [{ id: "offline", name: "Offline", message: "unavailable" }]);
  assert.deepEqual(calls.map(([endpoint]) => endpoint).sort(), ["session/follow", "session/modelCatalog"]);
  assert.deepEqual(calls.find(([endpoint]) => endpoint === "session/follow")[1], {
    request: { address: { kind: "session", sessionId: "widget-session" }, maxMessages: 1 },
  });

  hostDefault = selections["dsh-session"];
  assert.deepEqual((await api.models("widget-session")).current, selections["widget-session"],
    "another DSH session changing the host default cannot retarget the widget session");
  assert.deepEqual((await api.models("dsh-session")).current, selections["dsh-session"]);
});

test("remote models use the host default only before a session has a durable selection", async () => {
  const api = new HarnessApi(undefined, legacyFetch, { historyWorker: false });
  const fallback = { provider: "cloud", model: "default" };
  const remote = {
    call: async () => ({ default: fallback, groups: [], failures: [] }),
    openChannel: async ({ onFrame }) => {
      queueMicrotask(() => onFrame({
        type: "snapshot", records: [],
        projections: { asOfSeq: -1, values: { modelSelection: { lastUsed: null, next: null } } },
      }));
      return { close() {}, closed: new Promise(() => {}) };
    },
  };
  api.ensureRemote = async () => remote;

  assert.deepEqual((await api.models("new-session")).current, fallback);
});

test("remote model catalog still loads when the session projection is temporarily unavailable", async () => {
  const api = new HarnessApi(undefined, legacyFetch, { historyWorker: false });
  const fallback = { provider: "cloud", model: "default" };
  api.ensureRemote = async () => ({
    call: async () => ({ default: fallback, groups: [{ id: "cloud", models: [{ id: "default" }] }] }),
    openChannel: async () => { throw new Error("session is being resumed"); },
  });

  const catalog = await api.models("cold-session");
  assert.deepEqual(catalog.current, fallback);
  assert.equal(catalog.groups[0].models[0].id, "default");
});

// sessionStateCache and fullAccessSessions used to keep one entry for every session the
// widget had ever seen, for the life of the process.
test("retainSessions evicts per-session state for sessions no longer listed", () => {
  const api = new HarnessApi(undefined, legacyFetch, { historyWorker: false });
  const forgotten = [];
  api.historyReader = { forget: (id) => forgotten.push(id) };
  for (const id of ["keep", "gone-a", "gone-b"]) api.sessionStateCache.set(id, { updatedAt: 1 });
  api.fullAccessSessions.add("keep");
  api.fullAccessSessions.add("gone-c");
  api.cacheHistory("keep", { events: [] });
  api.cacheHistory("gone-d", { events: [] });

  assert.equal(api.retainSessions(["keep", "never-seen"]), 4);
  assert.deepEqual([...api.sessionStateCache.keys()], ["keep"]);
  assert.deepEqual([...api.fullAccessSessions], ["keep"]);
  assert.deepEqual([...api.historyCache.keys()], ["keep"]);
  assert.deepEqual(forgotten.sort(), ["gone-a", "gone-b", "gone-c", "gone-d"]);

  // A restarting Harness can list nothing; that must not wipe the transcript floor.
  assert.equal(api.retainSessions([]), 0);
  assert.equal(api.retainSessions(null), 0);
  assert.deepEqual([...api.historyCache.keys()], ["keep"]);
  assert.equal(api.retainSessions(new Set(["keep"])), 0);
});
