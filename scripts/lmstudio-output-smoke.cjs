// Isolated DSH -> recording proxy -> user's local LM Studio. No existing chat
// is prompted or changed; the only generation asks for the word READY.
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), http = require("node:http");
const { spawn } = require("node:child_process");
const { HarnessApi } = require("../src/harness-api.cjs");
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const listen = server => new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));

async function main() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "deck-lmstudio-output-"));
  const requests = [];
  let capturedInput = null, copiedSessionId = null;
  const replay = process.argv.includes("--replay-current");
  if (replay) {
    const settings = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, "NeoXider", "AgentDeck", "widget-settings.json")));
    copiedSessionId = settings.lastSelectedSessionId;
    if (!/^session-[a-zA-Z0-9-]+$/.test(copiedSessionId)) throw new Error("Invalid saved session id");
    const sourceRoot = path.join(process.env.USERPROFILE, ".dsh", "sessions");
    const project = fs.readdirSync(sourceRoot, { withFileTypes: true }).find(p => p.isDirectory() && fs.existsSync(path.join(sourceRoot, p.name, copiedSessionId)));
    if (!project) throw new Error("Saved session directory was not found");
    fs.cpSync(path.join(sourceRoot, project.name, copiedSessionId), path.join(home, "sessions", project.name, copiedSessionId), { recursive: true });
    const original = new HarnessApi("http://127.0.0.1:3080", fetch, { historyWorker: false, getLaunchBrowserUrl: () => settings.harnessLaunchUrl });
    const transport = await original.ensureRemote();
    const view = await original.remoteChannelFirstFrame(transport, "session/follow", { request: { address: { kind: "session", sessionId: copiedSessionId }, maxMessages: 100 } });
    const attachments = new Set();
    function findAttachments(value) {
      if (!value || typeof value !== "object") return;
      if (typeof value.attachmentId === "string" && /^sha256:[a-f0-9]{64}$/.test(value.attachmentId)) attachments.add(value.attachmentId.slice(7));
      for (const child of Object.values(value)) findAttachments(child);
    }
    findAttachments(view.records);
    for (const hash of attachments) {
      const relative = path.join("attachments", "v1", "objects", hash.slice(0, 2), hash);
      fs.mkdirSync(path.dirname(path.join(home, relative)), { recursive: true });
      fs.copyFileSync(path.join(process.env.USERPROFILE, ".dsh", relative), path.join(home, relative));
    }
  }
  const proxy = http.createServer(async (req, res) => {
    try {
      let body = ""; for await (const part of req) body += part;
      const input = body ? JSON.parse(body) : {};
      if (req.url.endsWith("chat/completions")) requests.push({ max_tokens: input.max_tokens, max_completion_tokens: input.max_completion_tokens, reasoning_effort: input.reasoning_effort, stream: input.stream });
      if (replay && req.url.endsWith("chat/completions")) {
        capturedInput = structuredClone(input);
        // The copied agent only sees this deterministic text and can never
        // execute model-generated tools. Real inference happens separately.
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        const frame = { id: "replay-qa", object: "chat.completion.chunk", created: 1, model: input.model, choices: [{ index: 0, delta: { content: "READY" }, finish_reason: null }] };
        const bytes = input.messages.reduce((total, message) => total + (typeof message.content === "string" ? Buffer.byteLength(message.content) : (message.content || []).reduce((n, block) => n + (block.type === "text" ? Buffer.byteLength(block.text || "") : 1024), 0)), 0);
        const promptTokens = Math.ceil((bytes + Buffer.byteLength(JSON.stringify(input.tools || []))) / 4);
        res.end(`data: ${JSON.stringify(frame)}\n\ndata: ${JSON.stringify({ ...frame, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: promptTokens, completion_tokens: 1, total_tokens: promptTokens + 1 } })}\n\ndata: [DONE]\n\n`);
        return;
      }
      if (process.argv.includes("--web-provider") && req.url.endsWith("chat/completions")) {
        // Record the real adapter budget first, then cap only this diagnostic
        // generation so high thinking cannot spend a full 32K test response.
        if (input.max_tokens !== undefined) input.max_tokens = Math.min(256, input.max_tokens);
        if (input.max_completion_tokens !== undefined) input.max_completion_tokens = Math.min(256, input.max_completion_tokens);
        body = JSON.stringify(input);
      }
      const reply = await fetch(`http://192.168.1.154:1234${req.url}`, { method: req.method, headers: { "Content-Type": "application/json" }, ...(body ? { body } : {}), signal: AbortSignal.timeout(30000) });
      res.writeHead(reply.status, { "Content-Type": reply.headers.get("Content-Type") || "application/json" });
      for await (const part of reply.body) res.write(part);
      res.end();
    } catch (error) { res.writeHead(502); res.end(JSON.stringify({ error: { message: error.message } })); }
  });
  const proxyPort = await listen(proxy);
  const portProbe = http.createServer(), harnessPort = await listen(portProbe);
  await new Promise(resolve => portProbe.close(resolve));
  const patch = path.join(home, "cordis.patch.yml");
  fs.writeFileSync(patch, `- id: llm-pi-ai\n  config:\n    providers:\n      openai:\n        api: openai-completions\n        baseURL: http://127.0.0.1:${proxyPort}/v1\n        apiKeyEnv: OUTPUT_SMOKE_KEY\n        models:\n          - id: orcarouter/orcasaq-2-cyber-27b-uncensored\n            contextWindow: 100000\n            maxTokens: 256\n            input: [text, image]\n            reasoningEfforts:\n              off: none\n              low: low\n              medium: medium\n              xhigh: xhigh\n            compat:\n              supportsReasoningEffort: true\n- id: session-title-llm\n  disabled: true\n`);
  const entry = process.argv[process.argv.indexOf("--entry") + 1];
  let configuredBudget = 32768;
  if (process.argv.includes("--web-provider")) {
    const yaml = require(require.resolve("js-yaml", { paths: [path.dirname(entry)] }));
    class JsExpression { constructor(value) { this.value = value; } }
    const schema = yaml.DEFAULT_SCHEMA.extend(new yaml.Type("tag:yaml.org,2002:js", { kind: "scalar", construct: value => new JsExpression(value), instanceOf: JsExpression, represent: value => value.value }));
    const webPatch = yaml.load(fs.readFileSync(path.join(process.env.USERPROFILE, ".dsh", "profiles", "web", "cordis.patch.yml"), "utf8"), { schema });
    const provider = structuredClone(webPatch.find(row => row.id === "llm-pi-ai").config.providers.openai);
    configuredBudget = provider.models.find(model => model.id === "orcarouter/orcasaq-2-cyber-27b-uncensored").maxTokens;
    provider.baseURL = `http://127.0.0.1:${proxyPort}/v1`;
    provider.apiKeyEnv = "OUTPUT_SMOKE_KEY";
    const entries = [{ id: "llm-pi-ai", config: { providers: { openai: provider } } }, { id: "session-title-llm", disabled: true }];
    if (process.argv.includes("--early-compaction")) {
      const standard = webPatch.find(row => row.id === "preset-standard");
      if (!standard) throw new Error("The configured Standard preset was not found");
      entries.push(standard);
    }
    fs.writeFileSync(patch, yaml.dump(entries, { schema }));
  }
  if (process.argv.includes("--budget")) fs.appendFileSync(patch, `\n- insert:\n    - id: lmstudio-output-budget\n      name: file:///${path.join(__dirname, "../integrations/dsh-lmstudio-budget/index.mjs").replace(/\\/g, "/")}\n      config:\n        provider: openai\n        models:\n          orcarouter/orcasaq-2-cyber-27b-uncensored: ${configuredBudget}\n`);
  const child = spawn(process.execPath, [entry, "web", "--no-open", "--port", String(harnessPort)], { cwd: home, env: { ...process.env, DSH_HOME: home, OUTPUT_SMOKE_KEY: "lm-studio" }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let url = "", output = "";
  for (const pipe of [child.stdout, child.stderr]) pipe.on("data", part => { output = (output + part).slice(-12000); const match = output.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s\x1b]+/); if (match) url = match[0]; });
  let api, sessionId;
  try {
    const startDeadline = Date.now() + 30000;
    while (!url && Date.now() < startDeadline && child.exitCode === null) await wait(100);
    if (!url) throw new Error(`Test Harness failed: ${output.replace(/token=[^\s]+/g, "token=REDACTED")}`);
    api = new HarnessApi(`http://127.0.0.1:${harnessPort}`, fetch, { historyWorker: false, getLaunchBrowserUrl: () => url });
    sessionId = copiedSessionId || await api.createSession({ cwd: home, agentPreset: "standard" });
    await api.selectModel(sessionId, { provider: "openai", model: "orcarouter/orcasaq-2-cyber-27b-uncensored", reasoningEffort: process.argv.includes("--xhigh") ? "xhigh" : "low" });
    if (replay) await api.executeCommand(sessionId, "/goal clear");
    await api.prompt(sessionId, "Ответь только словом READY. Не вызывай инструменты.", "UTC");
    const deadline = Date.now() + 35000;
    let history;
    do {
      await wait(200);
      history = await api.history(sessionId);
      if (requests.length && history.messages.some(m => m.role === "assistant" && m.text === "READY")) break;
    } while (Date.now() < deadline);
    console.log(JSON.stringify({ requests, responses: history.messages.filter(m => ["assistant", "warning", "error"].includes(m.role)).slice(-1).map(m => ({ role: m.role, text: m.text.slice(0, 180) })), home }));
    if (replay && capturedInput) {
      await api.cancel(sessionId);
      const body = { ...capturedInput, stream: false, tools: [], tool_choice: "none", reasoning_effort: "none" };
      if (body.max_tokens !== undefined) body.max_tokens = Math.min(1024, body.max_tokens);
      if (body.max_completion_tokens !== undefined) body.max_completion_tokens = Math.min(1024, body.max_completion_tokens);
      const response = await fetch("http://192.168.1.154:1234/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
      const value = await response.json();
      console.log(JSON.stringify({ largeContext: true, status: response.status, usage: value.usage, finish: value.choices?.[0]?.finish_reason, answerIsReady: /^READY[.!]?\s*$/.test(value.choices?.[0]?.message?.content || ""), answerChars: value.choices?.[0]?.message?.content?.length, error: value.error }));
    }
  } finally {
    if (sessionId) await api.cancel(sessionId).catch(() => {});
    child.kill(); proxy.closeAllConnections(); proxy.close();
  }
}
main().then(() => process.exit(0), error => { console.error(error.stack); process.exit(1); });
