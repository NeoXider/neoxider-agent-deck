const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow, ipcMain } = require("electron");
const { HarnessApi } = require("../src/harness-api.cjs");
const { renderMarkdown } = require("../src/markdown.cjs");

// Opt-in, read-only integration check. Credentials and conversation content remain
// in memory; only counts and layout measurements are reported. No fixture mode.
const root = path.resolve(__dirname, "..");
const deadline = setTimeout(() => { console.error("Live transcript smoke timed out"); app.exit(1); }, 120000);
async function main() {
  const settingsPath = process.env.DECK_SMOKE_SETTINGS || path.join(process.env.APPDATA, "NeoXider", "AgentDeck", "widget-settings.json");
  const preferences = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  const selected = preferences.lastSelectedSessionId;
  assert.ok(selected, "Select a real session in Deck first");
  const api = new HarnessApi(process.env.DSH_WIDGET_URL || "http://127.0.0.1:3080", globalThis.fetch, {
    historyWorker: false, getLaunchBrowserUrl: () => preferences.harnessLaunchUrl || "",
  });
  const dashboard = await api.dashboard(selected);
  const history = await api.history(selected);
  const roles = {};
  for (const message of history.messages) roles[message.role] = (roles[message.role] || 0) + 1;
  console.log(JSON.stringify({ phase: "read-only-history", messages: history.messages.length, roles,
    contextPressure: dashboard.sessions.find(session => session.sessionId === selected)?.projections?.values?.contextPressure || null,
    backgroundOpacity: preferences.backgroundOpacity, motionEffects: preferences.motionEffects }));
  assert.ok(history.messages.length > 100, "This check requires a populated real history");
  history.messages = history.messages.map(message => message.role === "tool" ? message : { ...message, html: renderMarkdown(message.text || "") });
  await app.whenReady();
  let releaseHistory;
  const historyGate = new Promise(resolve => { releaseHistory = resolve; });
  const handlers = {
    "get-preferences": () => ({ ...preferences, windowMode: "full", harnessLaunchUrl: undefined }),
    dashboard: () => ({ ok: true, harness: true, ...dashboard }),
    history: async () => { await historyGate; return history; },
    models: () => ({ providers: [], models: [] }), commands: () => [], workspaces: () => [], "get-queue": () => [],
    "app-info": () => ({ version: "integration-check" }), "get-update-state": () => ({ status: "idle" }),
    "render-markdown": text => renderMarkdown(text),
  };
  const preload = fs.readFileSync(path.join(root, "src/preload.cjs"), "utf8");
  for (const channel of new Set([...preload.matchAll(/ipcRenderer\.invoke\("([^"]+)"/g)].map(match => match[1]))) {
    ipcMain.handle(channel, (_event, ...args) => handlers[channel]?.(...args) ?? null);
  }
  const win = new BrowserWindow({ width: 460, height: 700, show: false, frame: false, transparent: true, webPreferences: {
    preload: path.join(root, "src/preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, offscreen: true,
  } });
  await win.loadFile(path.join(root, "src/renderer/index.html"));
  await win.webContents.executeJavaScript(`(async () => {
    window.smokeErrors=[];
    window.addEventListener('error',event=>window.smokeErrors.push({name:event.error?.name,line:event.lineno}));
    clearInterval(state.pollTimer);
    setTab('chat');
    await new Promise(resolve => setTimeout(resolve, 100));
    state.historyPendingSessionId = state.selectedSessionId;
    renderMessages([]);
    state.messagesStickToBottom = false;
  })()`);
  releaseHistory();
  const initial = await win.webContents.executeJavaScript(`(async () => {
    let refreshResult;
    for (let attempt=0;attempt<8;attempt++) {
      refreshResult = await refreshHistory({priority:true});
      if (state.currentMessages.length) break;
      await new Promise(resolve => setTimeout(resolve,100));
    }
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const root = document.querySelector('#messages');
    const view = root.getBoundingClientRect();
    return { phase:'initial-history', refreshResult, selected:Boolean(state.selectedSessionId), total:state.currentMessages.length, start:transcriptViewStart, end:transcriptViewEnd,
      rows:root.querySelectorAll('[data-vmsg]').length,
      visibleRows:[...root.querySelectorAll('[data-vmsg]')].filter(node => {const r=node.getBoundingClientRect();return r.bottom>view.top&&r.top<view.bottom;}).length,
      unseen:transcriptArrivedCount(), pinned:state.messagesStickToBottom,
      contextUnavailable:document.querySelector('#contextMeter').classList.contains('unavailable') };
  })()`);
  console.log(JSON.stringify(initial));
  assert.ok(initial.visibleRows > 0, "loading-to-real-history must show actual message rows");
  assert.equal(initial.unseen, 0, "loaded history is not new arrivals");
  const modes = [];
  for (const mode of ["orb", "full", "edge", "full"]) {
    const size=mode === "full" ? [460, 700] : mode === "orb" ? [140, 140] : [88, 132];
    win.setSize(...size);
    modes.push(await win.webContents.executeJavaScript(`(async () => {
      applyWindowMode(${JSON.stringify(mode)});
      for(let attempt=0;attempt<20&&(Math.abs(innerWidth-${size[0]})>3||Math.abs(innerHeight-${size[1]})>3);attempt++) await new Promise(resolve=>setTimeout(resolve,50));
      await new Promise(resolve => setTimeout(resolve, 540));
      const root=document.querySelector('#messages'); const viewport=root.getBoundingClientRect();
      const rows=[...root.querySelectorAll('[data-vmsg]')];
      return {mode:state.windowMode, innerWidth,innerHeight, rows:rows.length,pinned:state.messagesStickToBottom,
        visibleRows:[...root.querySelectorAll('[data-vmsg]')].filter(node=>{const r=node.getBoundingClientRect();return r.bottom>viewport.top&&r.top<viewport.bottom&&r.height>0;}).length};
    })()`));
  }
  console.log(JSON.stringify({phase:"mode-transitions", modes}));
  for (const mode of modes.filter(item => item.mode === "full")) assert.ok(mode.visibleRows > 0, "full mode restores visible messages");
  const tooltip = await win.webContents.executeJavaScript(`(async () => {
    const tick=document.querySelector('.message-mark');
    tick.dispatchEvent(new PointerEvent('pointerover',{bubbles:true}));
    const tooltip=document.querySelector('#chatTooltip');
    const bounds=tooltip.getBoundingClientRect();
    const result={shown:tooltip.matches(':popover-open'),nativeTitle:tick.hasAttribute('title'),
      accessible:tick.getAttribute('aria-describedby')?.includes('chatTooltip'),
      fits:bounds.left>=0&&bounds.top>=0&&bounds.right<=innerWidth&&bounds.bottom<=innerHeight};
    document.querySelector('#messages').dispatchEvent(new Event('scroll'));
    result.dismissedOnScroll=!tooltip.matches(':popover-open');
    tick.dispatchEvent(new FocusEvent('focusin',{bubbles:true}));
    result.focusShown=tooltip.matches(':popover-open');
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    result.dismissedOnEscape=!tooltip.matches(':popover-open');
    return result;
  })()`);
  console.log(JSON.stringify({phase:"tooltip", ...tooltip}));
  assert.deepEqual(tooltip, {shown:true,nativeTitle:false,accessible:true,fits:true,dismissedOnScroll:true,focusShown:true,dismissedOnEscape:true});
  await win.webContents.executeJavaScript(`(async () => {
    const root=document.querySelector('#messages');
    root.dispatchEvent(new WheelEvent('wheel',{deltaY:-180,bubbles:true}));
    root.scrollTop-=180;
    await new Promise(resolve=>setTimeout(resolve,80));
    state.messagesStickToBottom=false;
    rememberTranscriptReadingPosition(root);
    window.smokeReadingAnchor=captureTranscriptAnchor(root);
  })()`);
  const reading = [];
  for (const mode of ["orb", "full", "edge", "full"]) {
    const size=mode === "full" ? [460, 700] : mode === "orb" ? [140, 140] : [88, 132];
    win.setSize(...size);
    reading.push(await win.webContents.executeJavaScript(`(async () => {
      applyWindowMode(${JSON.stringify(mode)});
      for(let attempt=0;attempt<20&&(Math.abs(innerWidth-${size[0]})>3||Math.abs(innerHeight-${size[1]})>3);attempt++) await new Promise(resolve=>setTimeout(resolve,50));
      await new Promise(resolve=>setTimeout(resolve,540));
      const current=captureTranscriptAnchor(document.querySelector('#messages'));
      const before=window.smokeReadingAnchor;
      return {mode:state.windowMode,pinned:state.messagesStickToBottom,
        sameAnchor:current?.key===before?.key, offsetDelta:current&&before ? Math.abs(current.offset-before.offset):null,
        errors:window.smokeErrors,restoreActive:Boolean(state.transcriptModeRestore)};
    })()`));
  }
  console.log(JSON.stringify({phase:"reading-mode-transitions", reading}));
  for (const value of reading.filter(item=>item.mode==="full")) {
    assert.equal(value.pinned,false,"mode transitions must not resume following while reading");
    assert.equal(value.sameAnchor,true,"mode transitions must preserve the reading row");
    assert.ok(value.offsetDelta<=3,"mode transitions must preserve the reading offset");
    assert.deepEqual(value.errors,[],"mode transitions must not throw renderer errors");
    assert.equal(value.restoreActive,false,"mode restoration must finish promptly");
  }
  win.destroy(); clearTimeout(deadline); app.quit();
}
main().catch(error => { console.error(error?.code || error?.name || "Live transcript check failed"); clearTimeout(deadline); app.exit(1); });
