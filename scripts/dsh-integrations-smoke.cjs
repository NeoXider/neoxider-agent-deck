// Opt-in acceptance for the DSH integrations in integrations/, against an installed DSH:
// an isolated home, headless runs and a scripted OpenAI-compatible model. No user chats
// or API keys are used. Run it after a DSH upgrade, since the integrations ride DSH's
// runtime API: `npm run test:dsh-integrations -- --entry <dsh/lib/bin.js>`.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const integration = (name) => pathToFileURL(path.join(__dirname, "..", "integrations", name, "index.js")).href;
const MARK = "SMOKE_MARK_7f3c";

// What each scenario's run_code program does. A run longer than 1.5 s goes to the
// background, so these programs outlive the step that started them.
const PROGRAMS = {
  // The hand-off alone: the job must complete and keep its value.
  "background": "await new Promise((r) => setTimeout(r, 2500));\nreturn { ok: 1 };",
  // A nested tool call made after the hand-off, once the step's tool set has closed.
  "background-nested": (file) => `await new Promise((r) => setTimeout(r, 2500));\nreturn await tools.read({ file_path: ${JSON.stringify(file)} });`,
  // A fast program never becomes a job.
  "foreground": (file) => `return await tools.read({ file_path: ${JSON.stringify(file)} });`,
};

const WRITTEN_UNKNOWN = "Waiting.\n<tool_call>\n<function=tools>\n<parameter=arguments>\n{\"job_id\": \"code-1\", \"wait\": true}\n</parameter>\n</function>\n</tool_call>";

function chunk(delta, finish = null) {
  return `data: ${JSON.stringify({ id: "smoke", object: "chat.completion.chunk", created: 1, model: "smoke", choices: [{ index: 0, delta, finish_reason: finish }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`;
}
const text = (content) => (typeof content === "string" ? content : (content || []).map((part) => part.text || "").join(""));

function scriptedModel(scenario, file, results) {
  return http.createServer(async (req, res) => {
    let body = "";
    for await (const data of req) body += data;
    if (!req.url.endsWith("/chat/completions")) { res.writeHead(404); res.end(); return; }
    const input = JSON.parse(body);
    const toolResults = input.messages.filter((message) => message.role === "tool").map((message) => text(message.content));
    if (toolResults.length > 0) results.splice(0, results.length, ...toolResults);
    // A settled job's value reaches the model once: inline in DSH's completion notice when
    // it fits, otherwise in the first job_output read after it settled.
    results.conversation = input.messages.filter((message) => message.role !== "system").map((message) => text(message.content)).join("\n");
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const reply = (delta, finish) => res.end(`${chunk(delta)}${chunk({}, finish)}data: [DONE]\n\n`);
    const call = (name, args) => reply({ role: "assistant", tool_calls: [{ index: 0, id: `call_${toolResults.length}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] }, "tool_calls");
    if (scenario === "text-call") return toolResults.length === 0 ? reply({ role: "assistant", content: WRITTEN_UNKNOWN }, "stop") : reply({ role: "assistant", content: "done" }, "stop");
    if (toolResults.length === 0) {
      const program = PROGRAMS[scenario];
      return call("run_code", { description: scenario, code: typeof program === "function" ? program(file) : program });
    }
    // Collect in short waits, so the collecting run_code never goes to the background.
    const job = /code-[0-9a-f]{16}/.exec(toolResults[0])?.[0];
    if (job && !/"status": ?"(completed|failed|killed)"/.test(toolResults.at(-1)) && toolResults.length < 12) {
      return call("run_code", { description: "collect", code: `return await tools.job_output({ job_id: ${JSON.stringify(job)}, wait: true, timeout_ms: 1000 });` });
    }
    return reply({ role: "assistant", content: "done" }, "stop");
  });
}

async function run(entry, home, scenario) {
  const file = path.join(home, "work", "notes.txt");
  const results = [];
  const model = scriptedModel(scenario, file, results);
  await new Promise((resolve) => model.listen(0, "127.0.0.1", resolve));
  const overlay = path.join(home, "smoke.patch.yml");
  fs.writeFileSync(overlay, [
    // run_code comes from the PTC executor, and a scope holds one executor.
    "- id: tool-executor-native\n  disabled: true",
    "- id: tool-executor-ptc\n  disabled: false",
    `- id: llm-pi-ai\n  config:\n    providers:\n      smoke:\n        api: openai-completions\n        baseURL: http://127.0.0.1:${model.address().port}/v1\n        apiKeyEnv: DECK_SMOKE_KEY\n        compat: { supportsDeveloperRole: false, supportsReasoningEffort: false, supportsStrictMode: false }\n        models:\n          - { id: smoke, name: smoke, contextWindow: 100000, input: [text], reasoningEfforts: false }`,
    "- id: agent-default-model\n  config:\n    provider: smoke\n    model: smoke",
    `- insert:\n    - id: neoxider-background-code\n      name: '${integration("dsh-background-code")}'\n    - id: neoxider-tool-call-recovery\n      name: '${integration("dsh-tool-call-recovery")}'`,
    "",
  ].join("\n"));
  const child = spawn(process.execPath, [entry, "--profile", "headless", "--patch", overlay, "--permission-mode", "danger-full-access", "go"], {
    cwd: path.join(home, "work"),
    env: { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: "1", DSH_PERMISSION_MODE: "danger-full-access", DECK_SMOKE_KEY: "test-only" },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "", stderr = "";
  child.stdout.on("data", (data) => { stdout += data; });
  child.stderr.on("data", (data) => { stderr += data; });
  const timer = setTimeout(() => child.kill(), 120000);
  const code = await new Promise((resolve) => child.on("close", resolve));
  clearTimeout(timer);
  await new Promise((resolve) => model.close(resolve));
  assert.equal(code, 0, `${scenario}: dsh exited ${code}\n${stderr.slice(-2000)}`);
  assert.equal(stdout.trim().split("\n").at(-1), "done", `${scenario}: no final answer\n${stderr.slice(-2000)}`);
  return results;
}

async function main() {
  const entry = process.argv[process.argv.indexOf("--entry") + 1];
  assert.ok(process.argv.includes("--entry") && fs.existsSync(entry), "Use --entry <installed dsh/lib/bin.js>");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "deck-dsh-integrations-"));
  fs.mkdirSync(path.join(home, "work"));
  fs.writeFileSync(path.join(home, "work", "notes.txt"), `${MARK}\n`);
  try {
    // The last poll reports the settled job; its value is looked for in the whole conversation.
    const job = (results) => JSON.parse(results.at(-1)).job;
    const value = (results) => results.conversation || "";

    let results = await run(entry, home, "background");
    assert.match(results[0], /"status": "running"/, "a long run_code becomes a job");
    assert.equal(job(results).status, "completed", `the job keeps its value after the hand-off: ${job(results).detail}`);
    // The program's own value, as the job serialized it: `return { ok: 1 }` reads `{"ok":1}`.
    assert.match(value(results), /\\?"result\\?":\{\\?"ok\\?":1\}/, `the job's value reaches the model: ${value(results).slice(-1500)}`);
    console.log("ok background: the handed-off job completes with its value");

    results = await run(entry, home, "background-nested");
    assert.equal(job(results).status, "completed", `a tool called after the hand-off still resolves: ${job(results).detail}`);
    assert.ok(value(results).includes(MARK), `the nested read returned the file: ${value(results).slice(-1500)}`);
    console.log("ok background-nested: a tool called after the step closed still runs");

    results = await run(entry, home, "foreground");
    assert.equal(results.length, 1);
    assert.ok(results[0].includes(MARK) && !/code-[0-9a-f]{16}/.test(results[0]), "a fast run_code returns its own result");
    console.log("ok foreground: a fast run_code is not a job");

    results = await run(entry, home, "text-call");
    assert.match(results[0], /^Error: unknown tool "tools": it is not one of this agent's tools\./);
    assert.match(results[0], /tools\.NAME/);
    console.log("ok text-call: a call to no tool is refused with a hint and the turn goes on");
  } finally {
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 3 });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
