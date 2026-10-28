// What Deck costs when a lot is happening at once: `npm run test:scale`.
//
// The real renderer, stubbed IPC, no Harness. Forty sessions in the list, each with
// subagents; the open chat holds 2,400 messages, some of them 20,000-character answers; then
// the open chat and twelve others stream answers at 25 chunks a second each for eight
// seconds while the reader scrolls up through the long transcript. It records what the
// reader feels - long tasks, frame times, how far the line being read moved - and where the
// main thread's time went, by wrapping the renderer's hot functions. It is a benchmark with
// a few ceilings, not a pixel test: the ceilings are loose enough for a loaded CI machine
// and tight enough to catch a regression back to per-chunk whole-list work.
//
//   SCALE_RUNNING=24 SCALE_SECONDS=12 npm run test:scale     a heavier run
//   SCALE_JSON=1 npm run test:scale                          the raw numbers only
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const assert = require("node:assert/strict");
const { renderMarkdown } = require("../src/markdown.cjs");

const SESSIONS = Number(process.env.SCALE_SESSIONS) || 40;
const RUNNING = Math.min(SESSIONS - 1, Number(process.env.SCALE_RUNNING) || 12);
const SECONDS = Number(process.env.SCALE_SECONDS) || 8;
const HISTORY = Number(process.env.SCALE_HISTORY) || 2400;
const CHUNKS_PER_SECOND = 25;
const SELECTED = "scale-0";

app.disableHardwareAcceleration();
const deadline = setTimeout(() => { process.stderr.write("scale smoke timed out\n"); app.exit(1); }, 120000);

const paragraph = (seed) => `Paragraph ${seed}: the agent explains what it changed and why, with \`inline code\`, a [link](https://example.com/${seed}) and **emphasis** so the formatter has real work to do.`;
function longAnswer(seed, size) {
  const parts = [`## Section ${seed}`];
  while (parts.join("\n\n").length < size) {
    parts.push(paragraph(seed + parts.length));
    if (parts.length % 5 === 0) parts.push("```js\n" + Array.from({ length: 12 }, (_, line) => `const value${line} = compute(${seed}, ${line});`).join("\n") + "\n```");
    if (parts.length % 7 === 0) parts.push(Array.from({ length: 6 }, (_, item) => `- item ${item} of list ${seed}`).join("\n"));
  }
  return parts.join("\n\n");
}

const markdownStats = { calls: 0, ms: 0, chars: 0 };
function timedMarkdown(text) {
  const started = performance.now();
  const html = renderMarkdown(text);
  markdownStats.calls += 1;
  markdownStats.ms += performance.now() - started;
  markdownStats.chars += text.length;
  return html;
}

function transcript() {
  const messages = [];
  for (let seq = 1; seq <= HISTORY; seq += 1) {
    const user = seq % 2 === 1;
    const text = user ? `Question ${seq}: what happens next?` : (seq % 40 === 0 ? longAnswer(seq, 20000) : paragraph(seq));
    messages.push({ role: user ? "user" : "assistant", seq, text, ...(user ? {} : { html: renderMarkdown(text) }) });
  }
  return messages;
}

function dashboard(now) {
  return {
    ok: true, harness: true, workspaces: [], archivedSessionIds: [], pinnedSessionIds: [],
    sessions: Array.from({ length: SESSIONS }, (_, index) => {
      const running = index <= RUNNING;
      return {
        sessionId: `scale-${index}`, title: `Parallel task ${index}`, updatedAt: new Date(now - index * 60000).toISOString(),
        running, state: running ? "working" : "idle", runningSince: running ? now - 30000 : null, preview: paragraph(index),
        projections: { values: { contextPressure: { projectedTokens: 20000 + index * 900, contextWindow: 200000 } } },
        subagents: Array.from({ length: 3 }, (_, child) => ({ kind: "child", sessionId: `scale-${index}-sub-${child}`, parentSessionId: `scale-${index}`,
          title: `Helper ${child}`, activity: running && child === 0 ? "running" : "idle", outcome: "", runningSince: null, workedMs: 9000, depth: 1, childCount: 0, mode: "continuable" })),
      };
    }),
  };
}

app.whenReady().then(async () => {
  const history = transcript();
  const preferences = { showThinking: true, lastSelectedSessionId: SELECTED, appearance: { theme: "claude", motion: "fluid", inputBorder: true, windowBorder: false } };
  const answers = {
    "get-preferences": preferences, "app-info": { version: "scale" }, "get-update-state": {}, "get-harness-supervisor-state": null,
    "get-pending-questions": [], "get-harness-runtime": null, "get-harness-target": null, "set-compact-status": {}, "set-last-selected-session": null,
    "models": { current: null, routable: true, groups: [], failures: [] }, "commands": [], "get-queue": { revision: 0, items: [] }, "session-jobs": [],
    "list-workspaces": [], "workspaces": [], "set-compact-hit-areas": null, "select-gamebar-session": null,
  };
  for (const [channel, value] of Object.entries(answers)) ipcMain.handle(channel, () => value);
  ipcMain.handle("dashboard", () => dashboard(Date.now()));
  ipcMain.handle("history", (_event, sessionId) => sessionId === SELECTED
    ? { messages: history, activity: null, revision: `r${HISTORY}`, hasOlder: false }
    : { messages: [{ role: "user", seq: 1, text: "Hello" }], activity: null, revision: "r1", hasOlder: false });
  ipcMain.handle("render-markdown", (_event, text) => timedMarkdown(String(text || "")));

  const win = new BrowserWindow({ show: false, width: 420, height: 640, webPreferences: {
    preload: path.join(__dirname, "../src/preload.cjs"), sandbox: true, contextIsolation: true, offscreen: true, backgroundThrottling: false,
  } });
  win.webContents.setFrameRate(60);
  await win.loadFile(path.join(__dirname, "../src/renderer/index.html"));
  const run = (script) => win.webContents.executeJavaScript(script);
  // The chat is open on the long transcript before anything is measured.
  for (let tries = 0; tries < 100; tries += 1) {
    const ready = await run(`Boolean(state.dashboard?.harness && state.selectedSessionId === ${JSON.stringify(SELECTED)} && document.querySelectorAll('#messages .bubble').length > 20)`);
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  // The chat was just shown: its first layout of 80 long rows is a cost of opening the chat,
  // not of streaming, so it is paid before the clock starts.
  await run(`setTab("chat"); void document.querySelector("#messages").scrollHeight; new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await run(`(() => {
    window.__scale = { calls: {}, longTasks: [], frames: [], anchor: [] };
    const wrap = (name) => {
      const original = window[name];
      if (typeof original !== "function") return;
      window[name] = function (...args) {
        const started = performance.now();
        try { return original.apply(this, args); }
        finally { const entry = window.__scale.calls[name] ||= { calls: 0, ms: 0, max: 0 }; const spent = performance.now() - started; entry.calls += 1; entry.ms += spent; entry.max = Math.max(entry.max, spent); }
      };
    };
    for (const name of ["paintLiveState", "paintLiveAssistant", "renderSessions", "renderSessionToolbar", "renderMessages", "syncActivityCard", "setActivity",
      "handleLiveEvent", "performRefresh", "renderTasksChip", "renderContext", "syncCompactStatus", "setAvatar", "updateLiveSessionState", "scheduleSessionTimers",
      "applyLiveMarkdown", "paintLiveText", "syncLiveBubbleContent", "captureMessageLayoutSnapshot", "restoreMessageLayoutSnapshot", "syncCrowdedChatState",
      "renderActivityMeta", "settleTranscriptScroll", "rememberTranscriptReadingPosition", "noteTranscriptSeen", "updateScrollLatestButton", "drawMessageMarks",
      "updateMessageMarks", "maybeGrowTranscriptWindow", "scheduleTranscriptViewportRepair", "repairTranscriptViewport", "decorateCodeBlocks", "syncChatVisualState",
      "transcriptReaderAtFoot", "messagesNearBottom", "liveCaretHost", "syncMessageMagnet", "restoreTranscriptAnchor", "captureTranscriptAnchor"]) wrap(name);
    // SCALE_LAYOUT_PROBE=1: what laying out each formatted update costs, forced right after it.
    if (${JSON.stringify(Boolean(process.env.SCALE_LAYOUT_PROBE))}) {
      const apply = window.applyLiveMarkdown;
      window.applyLiveMarkdown = function (...args) {
        const result = apply.apply(this, args);
        const started = performance.now();
        void document.querySelector("#messages").scrollHeight;
        const entry = window.__scale.calls["layout after live markdown"] ||= { calls: 0, ms: 0, max: 0 };
        const spent = performance.now() - started; entry.calls += 1; entry.ms += spent; entry.max = Math.max(entry.max, spent);
        return result;
      };
    }
    new PerformanceObserver((list) => { for (const entry of list.getEntries()) { window.__scale.longTasks.push(entry.duration); (window.__scale.longTaskStarts ||= []).push([entry.startTime, entry.duration]); } }).observe({ entryTypes: ["longtask"] });
    let last = performance.now();
    const tick = (now) => { window.__scale.frames.push(now - last); last = now; if (!window.__scale.stopped) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    window.__scale.origin = performance.now();
  })()`);

  // SCALE_PROFILE=1: a V8 CPU profile of the streaming window, self time per function. Layout
  // and style work forced by a script shows under the function that read the geometry.
  const profiler = process.env.SCALE_PROFILE ? win.webContents.debugger : null;
  if (profiler) {
    profiler.attach("1.3");
    await profiler.sendCommand("Profiler.enable");
    await profiler.sendCommand("Profiler.setSamplingInterval", { interval: 200 });
    await profiler.sendCommand("Profiler.start");
  }
  const now = Date.now();
  const streaming = Array.from({ length: RUNNING + 1 }, (_, index) => `scale-${index}`);
  const seq = new Map(streaming.map((id) => [id, 1000]));
  const send = (sessionId, type, data = {}) => { const next = seq.get(sessionId) + 1; seq.set(sessionId, next); win.webContents.send("live-event", { sessionId, event: { type, seq: next, data } }); };
  for (const id of streaming) send(id, "turn/start");
  const answer = longAnswer(7, 12000);
  const ticks = SECONDS * CHUNKS_PER_SECOND;
  let wheel = 0;
  for (let tick = 0; tick < ticks; tick += 1) {
    for (const id of streaming) {
      const offset = (tick * 48) % answer.length;
      // A turn thinks first and then writes, as a model does.
      send(id, "assistant/chunk", { chunk: { type: tick < ticks * .15 ? "reasoning-delta" : "text-delta", index: 0, blockType: "", text: answer.slice(offset, offset + 48), name: "" } });
    }
    // Halfway through, the reader scrolls up into the transcript and keeps reading there.
    if (process.env.SCALE_WHEEL !== "0" && tick >= ticks / 2 && wheel < 12 && tick % 2 === 0) {
      win.webContents.sendInputEvent({ type: "mouseWheel", x: 200, y: 300, deltaX: 0, deltaY: 120, wheelTicksY: 1, canScroll: true });
      wheel += 1;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000 / CHUNKS_PER_SECOND));
  }
  for (const id of streaming) send(id, "turn/end", { reason: { kind: "stop" } });
  await new Promise((resolve) => setTimeout(resolve, 600));
  if (profiler) {
    const { profile } = await profiler.sendCommand("Profiler.stop");
    const self = new Map();
    const interval = (profile.endTime - profile.startTime) / Math.max(1, profile.samples.length) / 1000;
    const byId = new Map(profile.nodes.map((node) => [node.id, node]));
    for (const id of profile.samples) {
      const frame = byId.get(id).callFrame;
      const key = `${frame.functionName || "(anonymous)"} ${frame.url ? `${path.basename(frame.url)}:${frame.lineNumber + 1}` : ""}`.trim();
      self.set(key, (self.get(key) || 0) + interval);
    }
    process.stdout.write("CPU self time (ms):\n");
    for (const [key, ms] of [...self].sort((a, b) => b[1] - a[1]).slice(0, Number(process.env.SCALE_PROFILE) > 1 ? Number(process.env.SCALE_PROFILE) : 20)) process.stdout.write(`  ${ms.toFixed(0).padStart(6)}  ${key}\n`);
  }
  const renderer = await run(`(() => { window.__scale.stopped = true; const s = window.__scale; const sorted = [...s.frames].sort((a, b) => a - b);
    const pick = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] || 0;
    return { calls: s.calls, longTasks: { count: s.longTasks.length, totalMs: Math.round(s.longTasks.reduce((a, b) => a + b, 0)), maxMs: Math.round(Math.max(0, ...s.longTasks)) },
      frames: { count: s.frames.length, p50: +pick(.5).toFixed(1), p95: +pick(.95).toFixed(1), max: +Math.max(0, ...s.frames).toFixed(1), over50: s.frames.filter((f) => f > 50).length },
      domNodes: document.querySelectorAll("*").length, longTaskSeconds: (s.longTaskStarts || []).reduce((bySecond, [start, duration]) => { const second = Math.floor((start - s.origin) / 1000); bySecond[second] = Math.round((bySecond[second] || 0) + duration); return bySecond; }, {}), heapMb: +(performance.memory?.usedJSHeapSize / 1048576 || 0).toFixed(1) }; })()`);
  const result = { sessions: SESSIONS, streaming: streaming.length, seconds: SECONDS, history: HISTORY, markdown: { calls: markdownStats.calls, ms: Math.round(markdownStats.ms), kb: Math.round(markdownStats.chars / 1024) }, ...renderer };
  for (const entry of Object.values(result.calls)) { entry.ms = Math.round(entry.ms); entry.max = +entry.max.toFixed(1); }
  if (process.env.SCALE_JSON) process.stdout.write(`${JSON.stringify(result)}\n`);
  else {
    process.stdout.write(`${result.streaming} sessions streaming for ${SECONDS}s over ${SESSIONS} sessions, ${HISTORY}-message chat open\n`);
    process.stdout.write(`frames p50 ${result.frames.p50}ms p95 ${result.frames.p95}ms max ${result.frames.max}ms, ${result.frames.over50} over 50ms; long tasks ${result.longTasks.count} (${result.longTasks.totalMs}ms, max ${result.longTasks.maxMs}ms)\n`);
    process.stdout.write(`long tasks by second: ${JSON.stringify(result.longTaskSeconds)}\n`);
    process.stdout.write(`main-process markdown: ${result.markdown.calls} renders, ${result.markdown.ms}ms, ${result.markdown.kb} KB formatted\n`);
    const top = Object.entries(result.calls).sort(([, a], [, b]) => b.ms - a.ms).slice(0, Number(process.env.SCALE_TOP) || 10);
    for (const [name, { calls, ms, max }] of top) process.stdout.write(`  ${name.padEnd(22)} ${String(calls).padStart(6)} calls ${String(ms).padStart(6)}ms  max ${max}ms\n`);
  }
  clearTimeout(deadline);
  try {
    // Ceilings, not targets: a regression to whole-list or whole-answer work per chunk trips them.
    assert.ok(result.frames.count > SECONDS * 20, `the renderer kept painting (${result.frames.count} frames)`);
    assert.ok(result.longTasks.maxMs < Number(process.env.SCALE_MAX_LONG_TASK_MS || 400), `no single stall longer than the ceiling (${result.longTasks.maxMs}ms)`);
    // Time depends on the machine and whatever else it runs, so the time ceilings only catch a
    // gross regression (1.2.0 spent 2.0-2.2 s of these 8 s in long tasks on a quiet machine,
    // 1.2.1 about 0.4 s). How much text goes through Markdown does not: 1.2.0 re-formatted the
    // whole answer per update, ~700 KB in this run; formatting a block at a time is tens of KB.
    assert.ok(result.longTasks.totalMs < Number(process.env.SCALE_MAX_LONG_TASKS_TOTAL_MS || 4000), `long tasks stay under the total ceiling (${result.longTasks.totalMs}ms)`);
    assert.ok(result.markdown.kb < 250, `a streaming answer is formatted a block at a time (${result.markdown.kb} KB formatted)`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    app.exit(1);
    return;
  }
  app.exit(0);
}).catch((error) => { process.stderr.write(`${error.stack || error}\n`); app.exit(1); });
