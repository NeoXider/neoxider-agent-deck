const test = require("node:test");
const assert = require("node:assert/strict");
const { HarnessApi, messagesFromHistory, titleFromSession } = require("../src/harness-api.cjs");

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

test("history keeps human and assistant text while hiding injected context", () => {
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
