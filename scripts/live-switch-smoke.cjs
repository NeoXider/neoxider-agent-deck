// Read-only timing of chat switching in the real renderer against the configured local
// Harness: a cold open of the longest chats, the return to one already opened, and older
// messages loading as the reader scrolls up. It never sends prompts, selects models, changes
// the remembered chat or edits a log.
// Run with: npx electron scripts/live-switch-smoke.cjs
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { app, BrowserWindow, ipcMain } = require("electron");
const { HarnessApi } = require("../src/harness-api.cjs");
const { createSharedDashboardReader } = require("../src/gamebar-controller.cjs");
const { renderMarkdown } = require("../src/markdown.cjs");

app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "deck-live-switch-")));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const root = path.resolve(__dirname, "..");

async function main() {
  const settingsPath = path.join(process.env.APPDATA, "NeoXider", "AgentDeck", "widget-settings.json");
  const preferences = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  const api = new HarnessApi(process.env.DSH_WIDGET_URL || "http://127.0.0.1:3080", fetch, {
    historyWorker: false, getLaunchBrowserUrl: () => JSON.parse(fs.readFileSync(settingsPath, "utf8")).harnessLaunchUrl,
  });
  await app.whenReady();
  await api.reconnect();
  const snapshot = await api.dashboard(preferences.lastSelectedSessionId);
  const candidates = snapshot.sessions.filter((session) => !session.degraded && !session.unreadable && !session.parentSessionId).slice(0, 6);
  assert.ok(candidates.length >= 2, "Two readable chats are needed to switch between");
  const reader = createSharedDashboardReader({ api });
  const handlers = {
    "get-preferences": () => ({ ...preferences, harnessLaunchUrl: undefined, lastSelectedSessionId: candidates[0].sessionId }),
    "dashboard": (_event, id) => reader.read(id),
    "models": (_event, id) => api.models(id),
    "commands": (_event, id) => api.commandCatalog(id),
    "workspaces": () => api.workspaces(),
    // The same contract as the real handler in ipc-handlers.cjs.
    "history": async (_event, id, options) => {
      const older = options?.older === true;
      const view = await api.history(id, { older });
      if (!older && typeof options?.revision === "string" && options.revision === view.revision) return { ...view, messages: null, unchanged: true };
      return { ...view, messages: view.messages.map((m) => (m.role === "tool" ? m : { ...m, html: renderMarkdown(m.text || "") })) };
    },
    "get-queue": () => ({ revision: 0, items: [] }),
    "app-info": () => ({ version: require("../package.json").version }),
    "get-update-state": () => ({ status: "idle" }),
    "set-window-mode": (_event, mode) => mode,
    "set-last-selected-session": (_event, id) => id,
    "render-markdown": (_event, text) => renderMarkdown(text),
  };
  const forbidden = new Set(["send", "create-session", "select-model", "execute-command", "cancel", "update-queue", "start-harness", "restart-harness", "set-harness-launch-url"]);
  const preload = fs.readFileSync(path.join(root, "src", "preload.cjs"), "utf8");
  for (const [, channel] of preload.matchAll(/ipcRenderer\.invoke\("([^"]+)"/g)) {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, handlers[channel] || (() => {
      if (forbidden.has(channel)) throw new Error(`Read-only check forbids ${channel}`);
      return {};
    }));
  }
  const win = new BrowserWindow({ show: false, width: 420, height: 640, frame: false,
    webPreferences: { preload: path.join(root, "src", "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true, backgroundThrottling: false } });
  await win.loadFile(path.join(root, "src", "renderer", "index.html"));
  await win.webContents.executeJavaScript(`setWindowMode("full")`);
  const open = (sessionId) => win.webContents.executeJavaScript(`(async () => {
    const started = performance.now();
    const settled = selectSession(${JSON.stringify(sessionId)}, true);
    const shown = () => state.selectedSessionId === ${JSON.stringify(sessionId)} && !transcriptAwaitingHistory()
      && (document.querySelector("#messages .bubble, #messages .tool-call, #messages .empty-state") !== null);
    while (!shown() && performance.now() - started < 20000) await new Promise((resolve) => setTimeout(resolve, 4));
    const paintedMs = Math.round(performance.now() - started);
    await settled;
    return { paintedMs, settledMs: Math.round(performance.now() - started), messages: state.currentMessages.length, hasOlder: state.historyHasOlder };
  })()`);
  const cold = [];
  for (const session of candidates) cold.push({ title: String(session.title || "").slice(0, 40), ...(await open(session.sessionId)) });
  const back = await open(candidates[0].sessionId);
  const deepest = cold.reduce((best, row, index) => (row.hasOlder && (!best || row.messages > cold[best.index].messages) ? { index } : best), null);
  let older = null;
  if (deepest) {
    await open(candidates[deepest.index].sessionId);
    older = await win.webContents.executeJavaScript(`(async () => {
      const root = document.querySelector("#messages");
      const before = state.currentMessages.length;
      const started = performance.now();
      while (state.currentMessages.length === before && performance.now() - started < 20000) {
        root.scrollTop = 0;
        root.dispatchEvent(new WheelEvent("wheel", { deltaY: -400 }));
        root.dispatchEvent(new Event("scroll"));
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
      return { before, after: state.currentMessages.length, ms: Math.round(performance.now() - started), hasOlder: state.historyHasOlder };
    })()`);
    assert.ok(older.after > older.before, `Scrolling to the top must load older messages: ${JSON.stringify(older)}`);
  }
  assert.ok(back.paintedMs < 150, `A chat opened before must paint at once: ${JSON.stringify(back)}`);
  console.log(JSON.stringify({ passed: true, cold, back, older }, null, 2));
  win.destroy();
}
const watchdog = setTimeout(() => { console.error("Live switch check timed out"); app.exit(1); }, 120000);
main().then(() => { clearTimeout(watchdog); app.exit(0); }, (error) => { console.error(error.stack); clearTimeout(watchdog); app.exit(1); });
