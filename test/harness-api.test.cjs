const test = require("node:test");
const assert = require("node:assert/strict");
const { HarnessApi, activityFromHistory, messagesFromHistory, sessionStateFromHistory, titleFromSession, toolMessagesFromHistory } = require("../src/harness-api.cjs");

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
  const api = new HarnessApi();
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
  const api = new HarnessApi();
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
  const api = new HarnessApi();
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
  const api = new HarnessApi();
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
  const api = new HarnessApi();
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
