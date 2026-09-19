const assert = require('node:assert/strict');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');

const root = path.resolve(__dirname, '..');
app.disableHardwareAcceleration();
const deadline = setTimeout(() => app.exit(1), 60000);
async function main() {
  await app.whenReady();
  for (const [channel, result] of Object.entries({
    'get-preferences': {}, 'app-info': { version: 'test' },
    'get-update-state': { status: 'idle' }, 'set-compact-status': {},
    'set-last-selected-session': null,
  })) ipcMain.handle(channel, () => result);
  const win = new BrowserWindow({ width: 420, height: 640, show: false,
    webPreferences: { preload: path.join(root, 'src/preload.cjs'),
      contextIsolation: true, sandbox: true, backgroundThrottling: false, offscreen: true } });
  win.webContents.on("paint", () => {});
  await win.loadFile(path.join(root, 'src/renderer/index.html'), {
    query: { screenshotFixture: 'chat', screenshotStatic: '1' },
  });
  await new Promise(resolve => setTimeout(resolve, 1200));
  const result = await win.webContents.executeJavaScript(`(async () => {
    const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const log = document.querySelector('#messages');
    const visibleRows = () => [...log.children].filter(node => {
      const rect = node.getBoundingClientRect(), view = log.getBoundingClientRect();
      return node.dataset.transcriptKey && rect.bottom > view.top && rect.top < view.bottom;
    });
    const messages = Array.from({ length: 10000 }, (_, index) => ({
      role: index % 2 ? 'assistant' : 'user', seq: index + 1,
      text: 'Message ' + index + '\\n' + 'Variable height text. '.repeat(1 + index % 19),
    }));
    state.messagesStickToBottom = true;
    renderMessages(messages);
    await frames();
    // Move to the start of the *rendered window*, far from the whole log's top.
    const first = [...log.children].find(row => row.dataset.transcriptKey);
    state.messagesStickToBottom = false;
    log.scrollTop += first.getBoundingClientRect().top - log.getBoundingClientRect().top + 10;
    transcriptProgrammaticScrollAt = 0;
    const before = captureTranscriptAnchor(log);
    const start = transcriptViewStart;
    maybeGrowTranscriptWindow();
    const after = captureTranscriptAnchor(log);
    const result = { grewAtWindowEdge: transcriptViewStart < start,
      anchorPreserved: before.key === after.key && Math.abs(before.offset - after.offset) < 1.5 };
    await frames();
    // A scrollbar jump must materialize its destination in a single event.
    log.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    for (const fraction of [0, .48, .85, .2, 1]) {
      state.messagesStickToBottom = false;
      log.scrollTop = fraction * (log.scrollHeight - log.clientHeight);
      maybeGrowTranscriptWindow();
      await frames();
      if (!visibleRows().length) throw new Error('Blank transcript at ' + fraction);
    }
    result.noBlankSeeks = true;
    log.scrollTop = log.scrollHeight * .45;
    transcriptProgrammaticScrollAt = 0;
    maybeGrowTranscriptWindow();
    await frames();
    state.messagesStickToBottom = false;
    const reading = captureTranscriptAnchor(log);
    for (let i = 0; i < 12; i++) {
      renderMessages([...state.currentMessages, { role: 'assistant', seq: 10001 + i, text: 'New response ' + i }]);
      await frames();
    }
    const refreshed = captureTranscriptAnchor(log);
    result.arrivalAnchorStable = reading.key === refreshed.key && Math.abs(reading.offset - refreshed.offset) < 1.5;
    rememberTranscriptReadingPosition(log);
    const beforeResize = captureTranscriptAnchor(log);
    document.body.style.width = '360px';
    await frames();
    const resized = captureTranscriptAnchor(log);
    result.resizeAnchorStable = beforeResize.key === resized.key && Math.abs(beforeResize.offset - resized.offset) < 1.5;
    document.body.style.width = '';
    await frames();
    const idleTop = log.scrollTop;
    await new Promise(resolve => setTimeout(resolve, 600));
    result.noIdleScroll = Math.abs(log.scrollTop - idleTop) < 1.5;
    result.boundedRows = log.children.length <= 324;
    jumpToLatestTranscript();
    await frames();
    result.latestVisible = visibleRows().some(row => row.textContent.includes('New response 11'));
    result.atBottom = messagesNearBottom(log);
    return result;
  })()`);
  console.log(JSON.stringify(result, null, 2));
  for (const [name, passed] of Object.entries(result)) assert.equal(passed, true, name);
  win.destroy();
  clearTimeout(deadline);
  app.exit(0);
}
main().catch(error => { console.error(error); clearTimeout(deadline); app.exit(1); });
