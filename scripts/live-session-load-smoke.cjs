// Read-only renderer acceptance against the configured local Harness. It never
// sends prompts, selects models, changes the remembered chat or edits its log.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { app, BrowserWindow, ipcMain } = require("electron");
const { HarnessApi } = require("../src/harness-api.cjs");
const { createSharedDashboardReader } = require("../src/gamebar-controller.cjs");
const { renderMarkdown } = require("../src/markdown.cjs");

app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "deck-live-load-")));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const root = path.resolve(__dirname, "..");

async function main() {
  const settingsPath = path.join(process.env.APPDATA, "NeoXider", "AgentDeck", "widget-settings.json");
  const preferences = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  const api = new HarnessApi(process.env.DSH_WIDGET_URL || "http://127.0.0.1:3080", fetch, {
    historyWorker: false, getLaunchBrowserUrl: () => JSON.parse(fs.readFileSync(settingsPath, "utf8")).harnessLaunchUrl,
  });
  await app.whenReady();
  const startupDeadline = Date.now() + 20000;
  while (true) {
    try { await api.reconnect(); break; }
    catch (error) { if (Date.now() >= startupDeadline) throw error; await wait(200); }
  }
  const snapshot = await api.dashboard(preferences.lastSelectedSessionId);
  const healthy = process.argv.includes("--healthy");
  const selected = healthy ? snapshot.sessions.find(s => !s.degraded && !s.running && s.sessionId !== preferences.lastSelectedSessionId)?.sessionId : preferences.lastSelectedSessionId;
  assert.ok(selected, "A saved/healthy session is required for this read-only check");
  const reader = createSharedDashboardReader({ api });
  const handlers = {
    "get-preferences": () => ({ ...preferences, harnessLaunchUrl: undefined, lastSelectedSessionId: selected }),
    "dashboard": (_event, id) => reader.read(id),
    "models": (_event, id) => api.models(id),
    "commands": (_event, id) => api.commandCatalog(id),
    "workspaces": () => api.workspaces(),
    "history": async (_event, id) => {
      const view = await api.history(id);
      return { ...view, messages: view.messages.map(m => m.role === "tool" ? m : { ...m, html: renderMarkdown(m.text || "") }) };
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
    if (ipcMain.__loadSmokeChannels?.has(channel)) continue;
    ipcMain.__loadSmokeChannels ||= new Set();
    ipcMain.__loadSmokeChannels.add(channel);
    ipcMain.handle(channel, handlers[channel] || (() => {
      if (forbidden.has(channel)) throw new Error(`Read-only check forbids ${channel}`);
      return {};
    }));
  }
  const win = new BrowserWindow({ show: false, width: 420, height: 640, frame: false, transparent: true,
    webPreferences: { preload: path.join(root, "src", "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true, backgroundThrottling: false } });
  await win.loadFile(path.join(root, "src", "renderer", "index.html"));
  let result;
  const deadline = Date.now() + 45000;
  do {
    await wait(200);
    result = await win.webContents.executeJavaScript(`({ modelState: state.modelLoadState, modelBusy: state.modelsBusy,
      modelCount: modelCount(), modelLabel: document.querySelector("#reasoningModelName").textContent,
      offline: state.harnessOffline, historyBusy: state.historyBusy, historyLoaded: state.historyLoadedSessionId === state.selectedSessionId,
      commandsLoaded: state.commandsLoadedSessionId === state.selectedSessionId,
      errorVisible: !document.querySelector("#historyLoadError").hidden,
      errorHeight: document.querySelector("#historyLoadError").getBoundingClientRect().height,
      errorDisplay: getComputedStyle(document.querySelector("#historyLoadError")).display,
      errorLabel: document.querySelector("#historyLoadErrorLabel").textContent,
      errorDetails: document.querySelector("#historyLoadErrorText").textContent,
      selected: state.selectedSessionId })`);
  } while (Date.now() < deadline && (result.modelBusy || result.modelState !== "ready" || (!result.historyLoaded && !result.errorVisible) || (healthy && !result.commandsLoaded)));
  assert.equal(result.selected, selected, "The read-only check must retain the selected chat");
  assert.equal(result.offline, false);
  assert.equal(result.modelState, "ready");
  assert.ok(result.modelCount > 0);
  assert.doesNotMatch(result.modelLabel, /Loading/);
  if (healthy) {
    assert.equal(result.historyLoaded, true);
    assert.equal(result.commandsLoaded, true, "The saved preset must resume and expose commands");
  }
  else {
    assert.equal(result.errorVisible, true);
    assert.ok(result.errorHeight > 50, `The recovery card must actually be painted: ${JSON.stringify(result)}`);
    assert.match(result.errorDetails, /SessionFormatError|outside an open turn|stored.+corrupt/i);
    assert.match(result.errorLabel, /recovery/);
  }
  fs.mkdirSync(path.join(root, "tmp"), { recursive: true });
  await win.webContents.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  await wait(200);
  fs.writeFileSync(path.join(root, "tmp", `live-session-load-${healthy ? "healthy" : "corrupt"}.png`), (await win.webContents.capturePage()).toPNG());
  console.log(JSON.stringify({ passed: true, kind: healthy ? "healthy" : "corrupt", modelReady: true, modelCount: result.modelCount, historyLoaded: result.historyLoaded, commandsLoaded: result.commandsLoaded, recoveryVisible: result.errorVisible, selectionRetained: true }));
  win.destroy();
}
const watchdog = setTimeout(() => { console.error("Live renderer check timed out"); app.exit(1); }, 65000);
main().then(() => { clearTimeout(watchdog); app.exit(0); }, error => { console.error(error.stack); clearTimeout(watchdog); app.exit(1); });
