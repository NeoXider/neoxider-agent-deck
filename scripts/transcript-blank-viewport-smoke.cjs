// Regression for landing in a virtual spacer after a programmatic layout repair.
// Uses only generated history and never connects to a user's Harness.
const assert = require('node:assert/strict');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');
const root = path.resolve(__dirname, '..');
app.disableHardwareAcceleration();
const deadline = setTimeout(() => app.exit(1), 60000);
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
  await arrivalPhase(win);
  win.destroy(); clearTimeout(deadline); app.quit();
}

// The v0.9.23 report: one row at the top of the log, a screen of blank spacer under it, and
// the pill saying "91 new". A layout-only scroll lowered the follow flag for a reader who
// never moved - the scrollbar seek misread a long streaming answer as a spacer, and a short
// window grew upwards - so arrivals froze the window end behind a bottom spacer, the live
// answer gave way to it, and nothing materialized the rows until the next wheel tick. The
// history is shaped like a tool-heavy Harness turn: reasoning renders nothing and tool runs
// fold into one row.
async function arrivalPhase(win) {
  await win.loadFile(path.join(root, 'src/renderer/index.html'), {
    query: { screenshotFixture: 'chat', screenshotStatic: '1' },
  });
  await new Promise(resolve => setTimeout(resolve, 1100));
  const run = code => win.webContents.executeJavaScript(code);
  await run(`(() => {
    const log = document.querySelector('#messages');
    const frames = (count = 3) => new Promise(resolve => {
      const step = () => (count-- > 0 ? requestAnimationFrame(step) : resolve());
      step();
    });
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    let seq = 0;
    let run = 0;
    let arrivalStart = 0;
    const turn = (tag, answer) => [
      { role: 'user', text: 'Question ' + tag },
      ...Array.from({ length: 6 }, () => ({ role: 'reasoning', text: 'Thinking about ' + tag })),
      { role: 'tool', callId: 'write-' + tag, name: 'write', status: 'completed', arguments: '{"path":"notes.txt"}', result: 'Written' },
      { role: 'tool', callId: 'pwsh-' + tag, name: 'pwsh', status: 'completed', arguments: '{"command":"ls"}', result: 'output line\\n'.repeat(40) },
      ...Array.from({ length: 6 }, () => ({ role: 'reasoning', text: 'Checking ' + tag })),
      { role: 'assistant', text: answer || 'Answer ' + tag },
    ].map(message => ({ ...message, seq: ++seq }));
    const history = (turns, prefix = 'old') => Array.from({ length: turns }, (_, index) => turn(prefix + run + '-' + index)).flat();
    // 91 arrivals, ending in a visible final answer: five whole turns and the start of a sixth.
    const arrivals = () => [...history(5, 'new' + seq + '-'), ...turn('final' + seq, 'Final answer ' + run).slice(-11)];
    const rows = () => [...log.children].filter(node => node.dataset.transcriptKey);
    const shows = (node, view = log.getBoundingClientRect()) => {
      const rect = node.getBoundingClientRect();
      return rect.height > 0 && rect.bottom > view.top && rect.top < view.bottom;
    };
    const measure = () => {
      const view = log.getBoundingClientRect();
      const keyed = rows();
      const last = keyed[keyed.length - 1].getBoundingClientRect();
      const hiddenNewer = transcriptHiddenNewerCount();
      const below = keyed.find(node => node.getBoundingClientRect().top >= view.bottom - 0.5);
      const label = document.querySelector('#scrollLatestCount').textContent;
      return {
        // Blank between the last materialized row and the bottom of the viewport while
        // newer rows exist: the band in the report.
        blankBand: hiddenNewer > 0 ? Math.max(0, Math.round(view.bottom - last.bottom)) : 0,
        topBand: transcriptViewStart > 0 ? Math.max(0, Math.round(keyed[0].getBoundingClientRect().top - view.top)) : 0,
        hiddenNewer, visibleRows: keyed.filter(node => shows(node, view)).length,
        following: state.messagesStickToBottom, atLatest: transcriptAtLatest(), nearBottom: messagesNearBottom(log),
        finalVisible: keyed.some(node => node.textContent.includes('Final answer ' + run) && shows(node, view)),
        pillHidden: document.querySelector('#scrollLatestButton').hidden, pill: label,
        // Arrivals whose rows are still below the viewport: what the pill should count.
        newBelow: state.currentMessages.length - Math.max(arrivalStart, below ? Number(below.dataset.vmsg) : transcriptViewEnd),
        domRows: keyed.length, windowSize: transcriptViewEnd - transcriptViewStart,
      };
    };
    const reset = async () => {
      run += 1;
      state.liveStreamsBySession.delete(state.selectedSessionId);
      renderMessages(history(40));
      jumpToLatestTranscript();
      await frames();
    };
    const stream = async () => {
      state.liveStreamsBySession.set(state.selectedSessionId, { text: 'Streaming line\\n'.repeat(30), lastSeq: 'live-' + run });
      renderMessages(state.currentMessages);
      await frames();
    };
    const arrive = async () => {
      state.liveStreamsBySession.delete(state.selectedSessionId);
      arrivalStart = state.currentMessages.length;
      renderMessages([...state.currentMessages, ...arrivals()]);
      await frames(4);
    };
    // A hand on the wheel moving up by a small amount: past the foot, still reading the end.
    const handUp = async pixels => {
      log.dispatchEvent(new WheelEvent('wheel', { deltaY: -pixels, bubbles: true }));
      log.scrollTop -= pixels;
      await frames();
    };
    const anchorKept = (before, after) => before && after && before.key === after.key && Math.abs(before.offset - after.offset) < 1.5;
    window.__arrival = { log, frames, wait, reset, stream, arrive, handUp, measure, anchorKept, rows };
  })()`);

  // A: a layout-only scroll - what the live paint and the resize observer do, assigning
  // scrollTop with no hand on the log - must not drop following. With a long answer
  // streaming at the foot no keyed row is on screen, which the scrollbar seek misread as a
  // spacer; without one, the window is short enough that the scroll grew it upwards.
  const layoutScroll = await run(`(async () => {
    const t = window.__arrival;
    await t.reset();
    await t.stream();
    t.log.scrollTop = t.log.scrollHeight - t.log.clientHeight - 6;
    await t.frames();
    const followingAfterLayoutScroll = state.messagesStickToBottom;
    await t.arrive();
    return { followingAfterLayoutScroll, ...t.measure() };
  })()`);
  console.log('layout scroll', JSON.stringify(layoutScroll));
  const shortWindow = await run(`(async () => {
    const t = window.__arrival;
    await t.reset();
    const short = t.rows()[0].getBoundingClientRect().top > t.log.getBoundingClientRect().top - TRANSCRIPT_TOP_LOAD_PX;
    t.log.scrollTop = t.log.scrollHeight - t.log.clientHeight - 6;
    await t.frames();
    const followingAfterLayoutScroll = state.messagesStickToBottom;
    await t.arrive();
    return { short, followingAfterLayoutScroll, ...t.measure() };
  })()`);
  console.log('short window', JSON.stringify(shortWindow));
  // B: whatever cleared the flag, a reader at the foot of the newest message is following it.
  const lostFlag = await run(`(async () => {
    const t = window.__arrival;
    await t.reset();
    await t.stream();
    state.messagesStickToBottom = false;
    await t.arrive();
    return t.measure();
  })()`);
  console.log('lost flag', JSON.stringify(lostFlag));
  // C: a deliberate small scroll up pauses following; arrivals then fill the viewport below
  // the reading row without moving it, and the pill counts only what is below the viewport.
  const readingUp = await run(`(async () => {
    const t = window.__arrival;
    await t.reset();
    await t.stream();
    await t.handUp(120);
    const pausedByHand = !state.messagesStickToBottom;
    await t.wait(1300); // let the wheel intent lapse, as an idle reader's would
    const before = captureTranscriptAnchor(t.log);
    await t.arrive();
    const after = captureTranscriptAnchor(t.log);
    const measured = t.measure();
    document.querySelector('#scrollLatestButton').click();
    await t.wait(1100);
    await t.frames();
    const jumped = t.measure();
    await t.arrive();
    const afterJump = t.measure();
    return { pausedByHand, readingKept: t.anchorKept(before, after), ...measured,
      jumpedToLatest: jumped.finalVisible && jumped.nearBottom && jumped.following && jumped.pillHidden,
      followsAfterJump: afterJump.finalVisible && afterJump.following && afterJump.blankBand === 0 };
  })()`);
  console.log('reading up', JSON.stringify(readingUp));
  // D: arrivals frozen below a reader, then the viewport grows taller (a banner easing shut,
  // the composer shrinking after a send, the window resized).
  const growPrepared = await run(`(async () => {
    const t = window.__arrival;
    await t.reset();
    await t.handUp(100);
    await t.wait(1300);
    await t.arrive();
    window.__arrival.before = captureTranscriptAnchor(t.log);
    return t.measure();
  })()`);
  const [width, height] = win.getSize();
  win.setSize(width, height + 260);
  await new Promise(resolve => setTimeout(resolve, 500));
  const taller = await run(`(async () => {
    const t = window.__arrival;
    await t.frames();
    return { readingKept: t.anchorKept(t.before, captureTranscriptAnchor(t.log)), ...t.measure() };
  })()`);
  win.setSize(width, height);
  await new Promise(resolve => setTimeout(resolve, 400));
  console.log('viewport grew', JSON.stringify({ before: growPrepared, after: taller }));
  // E: arrivals frozen below a reader inside an open tool card, then the card folds shut.
  const folded = await run(`(async () => {
    const t = window.__arrival;
    await t.reset();
    const group = [...t.log.querySelectorAll('details.tool-group')].pop();
    for (const details of [group, ...group.querySelectorAll('details')]) details.open = true;
    await t.wait(700);
    t.log.scrollTop = t.log.scrollHeight;
    await t.frames();
    await t.handUp(160);
    await t.wait(1300);
    await t.arrive();
    const before = captureTranscriptAnchor(t.log);
    const openHeight = group.getBoundingClientRect().height;
    group.open = false;
    await t.wait(700);
    await t.frames();
    return { readingKept: t.anchorKept(before, captureTranscriptAnchor(t.log)), folded: Math.round(openHeight - group.getBoundingClientRect().height), ...t.measure() };
  })()`);
  console.log('tool card folded', JSON.stringify(folded));

  assert.equal(shortWindow.short, true, 'The tool-heavy window is shorter than the growth threshold');
  for (const [name, report] of Object.entries({ layoutScroll, shortWindow })) {
    assert.equal(report.followingAfterLayoutScroll, true, `${name}: a layout-only scroll at the foot must not stop following`);
  }
  for (const [name, report] of Object.entries({ layoutScroll, shortWindow, lostFlag })) {
    assert.equal(report.finalVisible, true, `${name}: arrivals must reach a reader at the foot`);
    assert.equal(report.following, true, `${name}: following continues`);
    assert.equal(report.blankBand, 0, `${name}: no blank band`);
    assert.equal(report.pillHidden, true, `${name}: nothing is unread below a follower`);
  }
  assert.equal(readingUp.pausedByHand, true, 'A deliberate scroll up pauses following');
  for (const [name, report] of Object.entries({ readingUp, taller, folded })) {
    assert.ok(report.blankBand <= 40, `${name}: rows must fill the viewport, not a ${report.blankBand}px spacer`);
    assert.ok(report.topBand <= 40, `${name}: no blank band above the rows either`);
    assert.ok(report.visibleRows > 0, `${name}: rows are visible`);
    assert.equal(report.readingKept, true, `${name}: filling the viewport must not move the text being read`);
    assert.equal(report.following, false, `${name}: filling does not resume following on its own`);
    assert.ok(report.newBelow > 0, `${name}: arrivals remain below the reading position`);
    assert.equal(report.pill, report.newBelow === 1 ? 'New' : `${report.newBelow} new`, `${name}: the pill counts only arrivals below the viewport`);
    assert.ok(report.domRows <= 320 && report.windowSize <= 320 + 40, `${name}: the DOM window stays bounded`);
  }
  assert.ok(growPrepared.blankBand <= 40, 'The resize case starts with a filled viewport');
  assert.ok(folded.folded > 200, 'The tool card folded by more than the reader was above the foot');
  assert.equal(readingUp.jumpedToLatest, true, 'The pill jumps to the latest message and follows it');
  assert.equal(readingUp.followsAfterJump, true, 'Following continues after the jump');
}
main().catch(error => { console.error(error.stack); clearTimeout(deadline); app.exit(1); });
