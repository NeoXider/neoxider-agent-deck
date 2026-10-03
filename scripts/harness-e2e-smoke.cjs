// Opt-in acceptance against an installed DSH, with an isolated home and a
// deterministic OpenAI-compatible server. No user chats or API keys are used.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { HarnessApi } = require("../src/harness-api.cjs");
const { createRemoteMuxClient } = require("../src/remote-mux.cjs");
const { createStreamPublisher } = require("../src/stream-publisher.cjs");
const { QUEUE_CONTENT } = require("../src/queue-view.cjs");

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, label, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await read();
    if (value) return value;
    await wait(80);
  }
  throw new Error(`Timed out: ${label}`);
}
async function listen(server) {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return server.address().port;
}
async function main() {
  const entry = process.argv[process.argv.indexOf("--entry") + 1];
  assert.ok(process.argv.includes("--entry") && fs.existsSync(entry), "Use --entry <installed dsh/lib/bin.js>");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "deck-dsh-e2e-"));
  const compactionCheck = process.argv.includes("--compaction");
  const checks = ["startup/auth", "session creation", "models", "commands/skills", "workspaces", "streaming", "text/image queue", "durable image read", "queue edit/delete", "queue reconnect", "stream reconnect", "send now", "queue drain", "history", "slash command"];
  const requests = [];
  const held = new Set();
  const mock = http.createServer(async (req, res) => {
    let body = "";
    for await (const data of req) body += data;
    if (!req.url.endsWith("/chat/completions")) { res.writeHead(404); res.end(); return; }
    const input = JSON.parse(body);
    requests.push(input);
    const prompts = input.messages.filter(m => m.role === "user").map(m => typeof m.content === "string" ? m.content
      : (m.content || []).filter(b => b.type === "text").map(b => b.text).join(" "));
    const text = prompts.filter(value => /HOLD|EDITED|EDIT_ME|DELETE_ME|Image caption/.test(value)).at(-1) || "";
    const answer = "SMOKE_OK";
    const delta = content => ({ id: "test", object: "chat.completion.chunk", created: 1, model: "smoke", choices: [{ index: 0, delta: { content }, finish_reason: null }] });
    if (!input.stream) { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ id: "test", object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: answer }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } })); return; }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(`data: ${JSON.stringify(delta(text.includes("HOLD") ? "STREAM_PREFIX" : answer))}\n\n`);
    if (text.includes("HOLD") && requests.length === 1) {
      held.add(res);
      res.on("close", () => held.delete(res));
      return;
    }
    res.end(`data: ${JSON.stringify({ ...delta(""), choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } })}\n\ndata: [DONE]\n\n`);
  });
  const mockPort = await listen(mock);
  const probe = http.createServer();
  const harnessPort = await listen(probe);
  await new Promise(resolve => probe.close(resolve));
  const overlay = path.join(home, "smoke.patch.yml");
  fs.writeFileSync(overlay, `- id: llm-pi-ai\n  config:\n    providers:\n      openai:\n        api: openai-completions\n        baseURL: http://127.0.0.1:${mockPort}/v1\n        apiKeyEnv: DECK_SMOKE_KEY\n        models:\n          - id: smoke\n            name: Acceptance model\n            contextWindow: 32768\n            maxTokens: 1024\n            input: [text, image]\n- id: agent-default-model\n  config:\n    provider: openai\n    model: smoke\n- id: session-title-llm\n  disabled: true\n`);
  let launchUrl = "", output = "";
  const child = spawn(process.execPath, [entry, "web", "--patch", overlay, "--no-open", "--port", String(harnessPort)], {
    cwd: home, env: { ...process.env, DSH_HOME: home, DECK_SMOKE_KEY: "test-only" }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  for (const pipe of [child.stdout, child.stderr]) pipe.on("data", data => {
    output = (output + data).slice(-24000);
    const match = output.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s\x1b]+/);
    if (match) launchUrl = match[0];
  });
  let api, mux, sessionId;
  const snapshots = new Map();
  const live = [];
  const compactionEvents = [];
  const publisher = createStreamPublisher({ queueSnapshots: snapshots, send: (channel, value) => { if (channel === "live-event") live.push(value); } });
  const attach = async () => {
    mux = createRemoteMuxClient({ getTransport: () => api.ensureRemote(), onQueue: publisher.publishQueue, onLiveEvent: frame => {
      if (frame.event.type.startsWith("compaction/")) compactionEvents.push(frame.event.type);
      publisher.publishLiveEvent(frame);
    } });
    mux.start();
    mux.track(sessionId);
    await until(() => snapshots.has(sessionId), "queue baseline");
  };
  try {
    await until(() => { if (child.exitCode !== null) throw new Error(`DSH exited: ${output.replace(/token=[^\s]+/g, "token=REDACTED")}`); return launchUrl; }, "Harness startup", 60000);
    api = new HarnessApi(`http://127.0.0.1:${harnessPort}`, fetch, { historyWorker: false, getLaunchBrowserUrl: () => launchUrl });
    sessionId = await api.createSession({ cwd: home, agentPreset: "standard" });
    await api.ensureFullAccess(sessionId);
    await api.selectModel(sessionId, { provider: "openai", model: "smoke" });
    const models = await api.models(sessionId);
    assert.equal(models.current.model, "smoke");
    const commands = await api.commands(sessionId);
    for (const name of ["goal", "compact", "plan", "permission"]) assert.ok(commands.some(c => c.name === name), `command ${name}`);
    await api.skills(sessionId);
    await api.workspaces();
    await attach();
    await api.prompt(sessionId, "HOLD the first test response", "UTC");
    await until(() => live.some(x => x.event.data?.chunk?.text === "STREAM_PREFIX"), "live response chunks");
    assert.equal((await api.dashboard(sessionId)).sessions.find(s => s.sessionId === sessionId)?.running, true, "host live phase remains authoritative");
    await api.prompt(sessionId, "EDIT_ME", "UTC");
    await api.prompt(sessionId, "DELETE_ME", "UTC");
    const png = fs.readFileSync(path.join(__dirname, "../src/renderer/assets/neoxider-github.png")).toString("base64");
    await api.prompt(sessionId, "Image caption", "UTC", [{ mediaType: "image/png", data: png, name: "smoke.png" }]);
    await until(() => snapshots.get(sessionId)?.items.length === 3, "three queued prompts");
    const image = snapshots.get(sessionId).items.find(x => x.attachments.length);
    assert.equal(image.editable, false, "image edits must not discard durable attachments");
    assert.ok(image.attachments[0].attachmentId, "image has a durable id");
    const read = await api.readAttachment(sessionId, image.attachments[0].attachmentId);
    assert.ok(read.data);
    const edit = snapshots.get(sessionId).items.find(x => x.text === "EDIT_ME");
    await api.updateQueue(sessionId, edit.id, { kind: "edit", text: "EDITED", originalContent: edit[QUEUE_CONTENT] });
    await until(() => snapshots.get(sessionId).items.some(x => x.text === "EDITED"), "edit acknowledgement");
    const remove = snapshots.get(sessionId).items.find(x => x.text === "DELETE_ME");
    await api.updateQueue(sessionId, remove.id, { kind: "remove" });
    await until(() => snapshots.get(sessionId).items.length === 2, "delete acknowledgement");
    mux.stop();
    snapshots.clear(); live.length = 0;
    await attach();
    await until(() => snapshots.get(sessionId)?.items.length === 2, "queue restored after reconnect");
    await until(() => live.some(x => x.event.type === "assistant/reset" && x.event.data.text === "STREAM_PREFIX"), "response prefix restored after reconnect");
    const steer = snapshots.get(sessionId).items.find(x => x.text === "EDITED");
    await api.updateQueue(sessionId, steer.id, { kind: "steer" });
    await until(() => snapshots.get(sessionId)?.items.some(x => x.id === steer.id && x.placement === "steering"), "next-step injection");
    // Steering does not abort the current model request; it takes effect at the
    // next agent step. Complete the held request just as a real model would.
    for (const res of held) res.end('data: {"id":"test","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
    await until(async () => !(await api.dashboard()).sessions.find(s => s.sessionId === sessionId)?.running, "queue drained", 30000);
    await until(() => snapshots.get(sessionId)?.items.length === 0, "empty queue published");
    const history = await api.history(sessionId);
    assert.ok(history.messages.some(x => x.role === "user" && x.text === "EDITED"));
    assert.ok(!history.messages.some(x => x.role === "user" && x.text === "DELETE_ME"));
    assert.ok(history.messages.some(x => x.role === "assistant" && x.text.includes("SMOKE_OK")));
    assert.ok(history.messages.some(x => x.attachments?.length), "sent attachment appears in history");
    if (compactionCheck) {
      // Saturate only this disposable chat. Keep all real model requests local to
      // the deterministic server and observe the actual host compaction events.
      for (let round = 0; round < 7; round++) {
        await api.prompt(sessionId, `CONTEXT_BOUNDARY_${round}\n` + "stable acceptance facts and decisions. ".repeat(1100), "UTC");
        await until(async () => {
          const h = await api.history(sessionId);
          return h.messages.some(m => m.role === "user" && m.text.startsWith(`CONTEXT_BOUNDARY_${round}`))
            && !(await api.dashboard(sessionId)).sessions.find(s => s.sessionId === sessionId)?.running;
        }, `large context round ${round}`, 30000);
      }
      assert.ok(compactionEvents.includes("compaction/start"), "automatic compaction ran before the context filled");
      assert.ok(compactionEvents.includes("compaction/end"), "automatic compaction completed");
      const compact = await api.executeCommand(sessionId, "/compact");
      assert.equal(compact.result.kind, "success", "manual compaction remains usable");
      await api.prompt(sessionId, "AFTER_COMPACTION", "UTC");
      await until(async () => {
        const h = await api.history(sessionId);
        return h.messages.some(m => m.role === "user" && m.text === "AFTER_COMPACTION")
          && !(await api.dashboard(sessionId)).sessions.find(s => s.sessionId === sessionId)?.running;
      }, "continuation after compaction");
      checks.push("automatic compaction", "manual compaction", "continuation after compaction");
    }
    const command = await api.executeCommand(sessionId, "/goal");
    assert.equal(command.result.kind, "success");
    console.log(JSON.stringify({ passed: true, checks, modelRequests: requests.length, home }));
  } catch (error) {
    console.error(JSON.stringify({ requests: requests.length, compactionEvents, liveTypes: live.map(x => x.event.type), home }));
    if (api && sessionId) {
      const h = await api.history(sessionId).catch(e => ({ error: e.message }));
      console.error(JSON.stringify({ messages: h.messages?.length, errors: h.messages?.filter(m => m.role === "error").map(m => m.text.slice(0, 500)), error: h.error }));
    }
    console.error(output.replace(/token=[^\s]+/g, "token=REDACTED").slice(-9000));
    throw error;
  } finally {
    mux?.stop();
    if (sessionId) await api.cancel(sessionId).catch(() => {});
    for (const res of held) res.destroy();
    mock.closeAllConnections();
    await new Promise(resolve => mock.close(resolve));
    child.kill();
    await Promise.race([new Promise(resolve => child.once("exit", resolve)), wait(5000)]);
    // Keep isolated evidence for inspection. It contains no user credentials or chats.
  }
}
main().then(() => process.exit(0), error => { console.error(error.stack); process.exit(1); });
