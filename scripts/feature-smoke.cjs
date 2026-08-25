const { HarnessApi } = require("../src/harness-api.cjs");

async function main() {
  const api = new HarnessApi(process.env.DSH_WIDGET_URL || "http://127.0.0.1:3080");
  const host = await api.rpc("host.describe");
  const workspaces = await api.workspaces();
  const sessionId = await api.createSession({ cwd: host.cwd });
  await api.rpc("session.rename", { sessionId, title: "Widget feature smoke" });

  const [commands, models, sessions] = await Promise.all([
    api.commands(sessionId),
    api.models(sessionId),
    api.rpc("session.list"),
  ]);
  const commandResult = await api.executeCommand(sessionId, "/goal");
  const created = (sessions.items || []).find((session) => session.sessionId === sessionId);
  const reasoningModels = (models.groups || []).flatMap((group) => group.models || []).filter((model) => model.reasoning?.efforts?.length).length;
  const commandNames = commands.map((command) => command.name);
  const report = {
    sessionId,
    cwd: created?.cwd,
    workspaceCount: workspaces.length,
    commandNames,
    reasoningModels,
    goalCommand: commandResult.result,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (created?.cwd !== host.cwd) throw new Error("Workspace-aware session creation did not preserve cwd");
  for (const required of ["goal", "plan", "compact", "permission"]) {
    if (!commandNames.includes(required)) throw new Error(`Missing command: ${required}`);
  }
  if (reasoningModels < 1) throw new Error("No reasoning-capable models were returned");
  if (commandResult.result?.kind !== "success") throw new Error("/goal command did not succeed");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
