const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { app, BrowserWindow, ipcMain } = require("electron");
const { messagesFromHistory } = require("../src/history-model.cjs");

const root = path.resolve(__dirname, "..");
app.disableHardwareAcceleration();
const deadline = setTimeout(() => app.exit(1), 30000);

async function main() {
  await app.whenReady();
  for (const [channel, result] of Object.entries({ "get-preferences": {}, "app-info": { version: "test" }, "get-update-state": { status: "idle" }, "set-compact-status": {} })) {
    ipcMain.handle(channel, () => result);
  }
  const win = new BrowserWindow({ width: 360, height: 500, show: false, webPreferences: {
    preload: path.join(root, "src/preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, offscreen: true,
  } });
  win.webContents.on("paint", () => {});
  await win.loadFile(path.join(root, "src/renderer/index.html"), { query: { screenshotFixture: "chat", screenshotStatic: "1" } });
  const event = (type, seq, data) => ({ event: { type, seq, time: seq * 1000, data, ...(type === "user/message" && seq === 4 ? { surfaceOp: { op: "replace", startSeq: 0, endSeq: 1 } } : {}) } });
  const messages = messagesFromHistory([
    event("user/message", 1, { content: [{ type: "text", text: "Continue after summarizing the earlier discussion." }] }),
    { event: { type: "assistant/message", seq: 2, surfaceOp: "append", data: { usage: { inputTokens: 99996 }, message: { content: [] } } } },
    event("compaction/summary", 3, { compactionId: "smoke", shadowedTokenCount: 78000, shadowedRange: { start: 0, end: 1 } }),
    event("user/message", 4, { source: { kind: "plugin", plugin: "compact", compactionId: "smoke" }, content: [{ type: "text", text: "x".repeat(87968) }] }),
    event("assistant/message", 5, { message: { content: [{ type: "text", text: "The summary is ready. We can continue." }] } }),
  ]);
  const result = await win.webContents.executeJavaScript(`(async () => {
    renderMessages(${JSON.stringify(messages)});
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const log = document.querySelector('#messages');
    const divider = log.querySelector('.context-compaction');
    const bounds = divider.getBoundingClientRect();
    const parent = log.getBoundingClientRect();
    const before = divider.previousElementSibling?.textContent || '';
    const after = divider.nextElementSibling?.textContent || '';
    const initialLabel = divider.textContent;
    const lines = getComputedStyle(divider, '::before').height === '1px' && getComputedStyle(divider, '::after').height === '1px';
    renderMessages(state.currentMessages);
    const stable = divider === log.querySelector('.context-compaction');
    renderMessages(state.currentMessages.map(message => message.role === 'compaction' ? {...message, afterTokens: 18000} : message));
    const updatedLabel = log.querySelector('.context-compaction').textContent;
    // Return to the original parsed history before capturing the visual evidence.
    renderMessages(${JSON.stringify(messages)});
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return { initialLabel, title: divider.title, before, after, stable,
      updatedLabel, screenshotLabel: log.querySelector('.context-compaction').textContent,
      unclipped: bounds.width > 0 && bounds.height > 0 && bounds.left >= parent.left && bounds.right <= parent.right,
      lines };
  })()`);
  assert.equal(result.initialLabel, "Context ≈ 100k → 44k");
  assert.equal(result.updatedLabel, "Context ≈ 100k → 18k");
  assert.equal(result.screenshotLabel, "Context ≈ 100k → 44k");
  assert.match(result.title, /Estimated full context/);
  assert.match(result.before, /earlier discussion/);
  assert.match(result.after, /summary is ready/);
  assert.equal(result.stable, true);
  assert.equal(result.unclipped, true);
  assert.equal(result.lines, true);
  const output = path.join(root, "tmp/compaction-smoke.png");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, (await win.webContents.capturePage()).toPNG());
  console.log(JSON.stringify({ ...result, screenshot: output }, null, 2));
  clearTimeout(deadline);
  win.destroy();
  app.quit();
}
main().catch(error => { console.error(error); clearTimeout(deadline); app.exit(1); });
