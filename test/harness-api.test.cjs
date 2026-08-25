const test = require("node:test");
const assert = require("node:assert/strict");
const { HarnessApi, activityFromHistory, messagesFromHistory, titleFromSession, toolMessagesFromHistory } = require("../src/harness-api.cjs");

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

test("history keeps human, visible reasoning and assistant text while hiding injected context", () => {
  const result = messagesFromHistory([
    { event: { type: "user/message", seq: 1, time: 1, data: { source: { kind: "user" }, content: [{ type: "text", text: "Привет" }] } } },
    { event: { type: "user/message", seq: 2, time: 2, data: { source: { kind: "plugin" }, content: [{ type: "text", text: "hidden" }] } } },
    { event: { type: "assistant/message", seq: 3, time: 3, data: { message: { content: [{ type: "reasoning", text: "hidden" }, { type: "text", text: "Готово" }] } } } },
  ]);
  assert.deepEqual(result.map(({ role, text }) => ({ role, text })), [
    { role: "user", text: "Привет" },
    { role: "reasoning", text: "hidden" },
    { role: "assistant", text: "Готово" },
  ]);
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
