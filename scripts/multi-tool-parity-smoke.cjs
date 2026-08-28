const fs = require("node:fs");
const path = require("node:path");
const {
  HarnessApi,
  activityFromHistory,
  messagesFromHistory,
} = require("../src/harness-api.cjs");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const api = new HarnessApi(process.env.DSH_WIDGET_URL || "http://127.0.0.1:3080");
  const provider = process.env.DSH_SMOKE_PROVIDER || "lmstudio";
  const model = process.env.DSH_SMOKE_MODEL || "qwen3.8-27b-unleashed";
  const cwd = path.resolve(__dirname, "..");
  const sessionId = await api.createSession({ cwd });
  await api.selectModel(sessionId, { provider, model });
  await api.ensureFullAccess(sessionId);
  await api.rpc("session.rename", { sessionId, title: "Widget multi-tool parity smoke" });
  await api.prompt(sessionId, [
    "Проведи безопасную проверку только чтением.",
    "Выполни по очереди ровно три инструмента:",
    "1. glob с pattern README.md;",
    "2. grep по строке NeoXider Agent Deck в README.md;",
    "3. read первых 12 строк README.md.",
    "Не используй shell и ничего не создавай, не изменяй и не удаляй.",
    "После результатов ответь по-русски и закончи токеном MULTITOOL_PARITY_OK.",
  ].join("\n"), "Asia/Yekaterinburg");

  let running = true;
  for (let attempt = 0; attempt < 480 && running; attempt += 1) {
    await delay(1000);
    const list = await api.rpc("session.list");
    running = Boolean((list.items || []).find((item) => item.sessionId === sessionId)?.running);
  }

  const raw = await api.rpc("session.history", { sessionId, maxMessages: 250 }, 20000);
  const events = raw.events || [];
  const messages = messagesFromHistory(events);
  const tools = messages.filter((message) => message.role === "tool");
  const assistant = messages.filter((message) => message.role === "assistant").at(-1)?.text || "";
  const eventTypeCounts = events.reduce((counts, entry) => {
    const type = entry?.event?.type || "unknown";
    counts[type] = (counts[type] || 0) + 1;
    return counts;
  }, {});
  const report = {
    schemaVersion: 1,
    audit: model.includes("qwen3.8-27b") ? "qwen27-multi-tool-live-parity" : "lmstudio-multi-tool-live-parity",
    sessionId,
    provider,
    model,
    runningAfterTurn: running,
    eventTypeCounts,
    rawToolCalls: eventTypeCounts["tool/call"] || 0,
    rawToolResults: eventTypeCounts["tool/result"] || 0,
    widgetTools: tools.map(({ callId, name, status, isError, durationMs, arguments: input, result }) => ({
      callId,
      name,
      status,
      isError,
      durationMs,
      input,
      result,
    })),
    finalActivity: activityFromHistory(events),
    assistantToken: assistant.includes("MULTITOOL_PARITY_OK"),
    assistantText: assistant,
  };
  const output = `${JSON.stringify(report, null, 2)}\n`;
  process.stdout.write(output);
  if (process.env.DSH_SMOKE_RECEIPT) {
    fs.mkdirSync(path.dirname(process.env.DSH_SMOKE_RECEIPT), { recursive: true });
    fs.writeFileSync(process.env.DSH_SMOKE_RECEIPT, output, "utf8");
  }

  const names = new Set(tools.map((tool) => tool.name));
  if (running) throw new Error("The Qwen turn did not stop");
  if ((eventTypeCounts["tool/call"] || 0) < 3 || (eventTypeCounts["tool/result"] || 0) < 3) {
    throw new Error("Harness did not emit three correlated tool calls and results");
  }
  for (const required of ["glob", "grep", "read"]) {
    if (!names.has(required)) throw new Error(`Missing transformed tool card: ${required}`);
  }
  if (tools.some((tool) => tool.isError || tool.status !== "done")) throw new Error("At least one tool card failed or remained running");
  if (!report.assistantToken) throw new Error("The final assistant token is missing");
  if (report.finalActivity !== null) throw new Error("Completed activity did not clear after turn/end");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
