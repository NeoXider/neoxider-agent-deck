const { HarnessApi } = require("../src/harness-api.cjs");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const api = new HarnessApi(process.env.DSH_WIDGET_URL || "http://127.0.0.1:3080");
  const sessionId = await api.createSession();
  const provider = process.env.DSH_SMOKE_PROVIDER || "lmstudio";
  const model = process.env.DSH_SMOKE_MODEL || "ling-3.0-tiny";
  await api.rpc("session.selectModel", { sessionId, provider, model });
  await api.rpc("session.rename", { sessionId, title: "Widget smoke test" });
  await api.prompt(sessionId, "Ответь только словом: OK", "Asia/Yekaterinburg");

  let running = true;
  for (let attempt = 0; attempt < 60 && running; attempt += 1) {
    await delay(1000);
    const list = await api.rpc("session.list");
    running = Boolean((list.items || []).find((item) => item.sessionId === sessionId)?.running);
  }
  const history = await api.history(sessionId);
  process.stdout.write(`${JSON.stringify({ sessionId, provider, model, running, history }, null, 2)}\n`);
  if (running || !history.some((message) => message.role === "assistant" && /OK/i.test(message.text))) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
