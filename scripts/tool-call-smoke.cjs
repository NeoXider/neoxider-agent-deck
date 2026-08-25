const { HarnessApi } = require("../src/harness-api.cjs");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const api = new HarnessApi(process.env.DSH_WIDGET_URL || "http://127.0.0.1:3080");
  const sessionId = await api.createSession();
  const provider = process.env.DSH_SMOKE_PROVIDER || "lmstudio";
  const model = process.env.DSH_SMOKE_MODEL || "ling-3.0-tiny";
  await api.selectModel(sessionId, { provider, model });
  await api.rpc("session.rename", { sessionId, title: "Widget tool-call smoke" });
  const permission = await api.executeCommand(sessionId, "/permission read-only");
  if (permission.result?.kind !== "success") throw new Error("Could not enforce read-only permission for tool smoke");
  await api.prompt(sessionId, "Call the read-only glob tool with pattern '*' exactly once. Do not create, edit, delete, or execute anything. After glob returns, answer exactly: TOOL_OK", "Asia/Yekaterinburg");

  let running = true;
  for (let attempt = 0; attempt < 90 && running; attempt += 1) {
    await delay(1000);
    const list = await api.rpc("session.list");
    running = Boolean((list.items || []).find((item) => item.sessionId === sessionId)?.running);
  }
  const history = await api.history(sessionId);
  const toolCalls = history.messages.filter((message) => message.role === "tool");
  const unsafeCalls = toolCalls.filter((message) => !["glob", "grep", "read"].includes(message.name));
  const assistantOk = history.messages.some((message) => message.role === "assistant" && /TOOL_OK/i.test(message.text));
  process.stdout.write(`${JSON.stringify({ sessionId, provider, model, running, toolCalls, unsafeCalls, assistantOk }, null, 2)}\n`);
  if (running || !toolCalls.length || unsafeCalls.length || !assistantOk) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
