const { HarnessApi } = require("../src/harness-api.cjs");

async function main() {
  const api = new HarnessApi(process.env.DSH_WIDGET_URL || "http://127.0.0.1:3080");
  const dashboard = await api.dashboard();
  process.stdout.write(`${JSON.stringify({
    version: dashboard.host.version,
    cwd: dashboard.host.cwd,
    attachedSessions: dashboard.host.attachedSessions,
    sessions: dashboard.sessions.length,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
