// Regression for landing in a virtual spacer after a programmatic layout repair.
// Uses only generated history and never connects to a user's Harness.
const assert = require('node:assert/strict');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');
const root = path.resolve(__dirname, '..');
app.disableHardwareAcceleration();
const deadline = setTimeout(() => app.exit(1), 30000);
async function main() {
  await app.whenReady();
  for (const [channel, result] of Object.entries({
    'get-preferences': {}, 'app-info': { version: 'regression' },
    'get-update-state': { status: 'idle' }, 'set-compact-status': {},
    'set-last-selected-session': null,
  })) ipcMain.handle(channel, () => result);
  const win = new BrowserWindow({ width: 460, height: 640, show: false,
    webPreferences: { preload: path.join(root, 'src/preload.cjs'), contextIsolation: true,
      sandbox: true, offscreen: true, backgroundThrottling: false } });
  win.webContents.on('paint', () => {});
  await win.loadFile(path.join(root, 'src/renderer/index.html'), {
    query: { screenshotFixture: 'chat', screenshotStatic: '1' },
  });
  await new Promise(resolve => setTimeout(resolve, 1100));
  const result = await win.webContents.executeJavaScript(`(async () => {
    const log = document.querySelector('#messages');
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const visibleRows = () => {
      const view = log.getBoundingClientRect();
      return [...log.querySelectorAll('[data-transcript-key]')].filter(row => {
        const rect = row.getBoundingClientRect();
        return rect.height > 0 && rect.bottom > view.top && rect.top < view.bottom;
      }).length;
    };
    const messages = Array.from({ length: 10000 }, (_, i) => ({
      seq: i + 1, role: i % 2 ? 'assistant' : 'user', text: 'Generated message ' + i,
    }));
    state.messagesStickToBottom = false;
    renderMessages(messages);
    await wait(100);
    transcriptViewStart = 100; transcriptViewEnd = 180;
    renderMessages(messages);
    // Restoring an old pixel offset while heights change can land in the
    // lower spacer. The correction's scroll is intentionally ignored as own.
    settleTranscriptScroll(log, log.scrollHeight);
    maybeGrowTranscriptWindow();
    const blankAtLanding = visibleRows() === 0;
    await wait(350);
    // An unchanged history used to return early without repairing geometry.
    renderMessages(messages);
    await wait(100);
    const recoveredRows = visibleRows();
    const bounded = log.querySelectorAll('[data-transcript-key]').length <= 320;
    state.messagesStickToBottom = false;
    transcriptViewStart = 500; transcriptViewEnd = 580;
    renderMessages(messages);
    settleTranscriptScroll(log, 0);
    await wait(350); renderMessages(messages); await wait(100);
    const olderRecoveredRows = visibleRows();
    const didNotForceLatest = !state.messagesStickToBottom && transcriptViewEnd < messages.length;
    const before = captureTranscriptAnchor(log);
    renderMessages(messages); await wait(100);
    const after = captureTranscriptAnchor(log);
    const unchangedReadingPreserved = before?.key === after?.key && Math.abs(before.offset - after.offset) < 1.5;
    state.messagesStickToBottom = true; jumpToLatestTranscript();
    await wait(100);
    await handleLiveEvent({sessionId:state.selectedSessionId,event:{type:'turn/end',seq:10001,data:{reason:{kind:'error',error:{message:'Connection error.'}}}}});
    await wait(40);
    return { blankAtLanding, recoveredRows, olderRecoveredRows, didNotForceLatest, unchangedReadingPreserved, bounded,
      errorVisible: [...log.querySelectorAll('.bubble.error')].some(row => {
        const rect=row.getBoundingClientRect(), view=log.getBoundingClientRect();
        return rect.bottom>view.top&&rect.top<view.bottom;
      }), latest: transcriptAtLatest() };
  })()`);
  console.log(JSON.stringify(result));
  assert.ok(result.recoveredRows > 0, 'An unchanged history must repair a spacer-only viewport');
  assert.ok(result.olderRecoveredRows > 0, 'The upper spacer must also recover visible rows');
  assert.ok(result.didNotForceLatest, 'Repairing older history must not jump to latest');
  assert.ok(result.unchangedReadingPreserved, 'A nonblank reading position must remain unchanged');
  assert.ok(result.bounded, 'Viewport repair must keep DOM window bounded');
  assert.ok(result.errorVisible, 'A model connection error must remain visible at latest');
  win.destroy(); clearTimeout(deadline); app.quit();
}
main().catch(error => { console.error(error.stack); clearTimeout(deadline); app.exit(1); });
