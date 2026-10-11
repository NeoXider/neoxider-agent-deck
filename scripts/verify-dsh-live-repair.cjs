const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { HarnessApi } = require("../src/harness-api.cjs");
async function main() {
  const settingsFile = path.join(process.env.APPDATA, "NeoXider", "AgentDeck", "widget-settings.json");
  const settings = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
  if (process.argv.includes("--refresh-token")) {
    const log = fs.readFileSync(path.join(__dirname, "../tmp/harness-alpha2-repaired.stdout.log"), "utf8");
    const url = log.match(/http:\/\/127\.0\.0\.1:3080\/\?token=[^\s]+/)?.[0];
    assert.ok(url);
    settings.harnessLaunchUrl = url;
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
  }
  const api = new HarnessApi("http://127.0.0.1:3080", fetch, { historyWorker: false, getLaunchBrowserUrl: () => settings.harnessLaunchUrl });
  const id = settings.lastSelectedSessionId;
  const catalog = await api.models(id);
  assert.ok(catalog.groups.some(g => g.id === "openrouter" && g.models.some(m => m.id === "inclusionai/ling-3.1-flash")));
  assert.ok(!catalog.groups.some(g => g.id === "deepseek" || g.id === "deepseek-account"));
  assert.equal(catalog.failures.length, 0);
  const before = await api.history(id);
  console.log(JSON.stringify({ selected: id, providers: catalog.groups.map(g => ({ id: g.id, count: g.models.length })), existingMessages: before.messages.length }));
  if (process.argv.includes("--prompt-current") || process.argv.includes("--verify-current")) {
    if (process.argv.includes("--prompt-current")) await api.prompt(id, "Проверка исправления конфигурации: ответь только «готово». Инструменты не вызывай.", "Asia/Yekaterinburg");
    const end = Date.now() + 240000;
    while (Date.now() < end) {
      await new Promise(resolve => setTimeout(resolve, 1500));
      const history = await api.history(id);
      const start = history.messages.findLastIndex(m => m.role === "user" && m.text?.includes("Проверка исправления конфигурации:"));
      if (start < 0) continue; // The accepted prompt may still be queued/processing.
      const fresh = history.messages.slice(start + 1);
      const error = fresh.find(m => m.role === "error");
      if (error) throw new Error(error.text);
      const reply = fresh.find(m => m.role === "assistant" && m.text?.trim());
      const remote = await api.ensureRemote();
      const listing = await remote.call("session/list", { _request: {} }, 30000);
      const current = listing.items.find(s => s.sessionId === id);
      if (reply && current?.running === false) {
        console.log(JSON.stringify({ livePromptPassed: true, reply: reply.text.slice(0, 500), newError: false }));
        return;
      }
    }
    throw new Error("Live prompt did not complete within four minutes");
  }
}
main().then(() => process.exit(0), e => { console.error(e.message); process.exit(1); });
