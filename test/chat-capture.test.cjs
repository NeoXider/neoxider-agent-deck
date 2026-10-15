const test = require('node:test');
const assert = require('node:assert/strict');
const { captureForChat } = require('../src/chat-capture.cjs');
function fixture(visible = true) {
  const events = [];
  return { events, service: { captureDisplay: async ({ point }) => { events.push(['capture', point]); return { ok: true, path: 'capture.png' }; }, removeCapture: async () => events.push('removed') },
    gate: { run: fn => fn() }, window: { isDestroyed: () => false, isVisible: () => visible, hide: () => events.push('hide'), showInactive: () => events.push('restore-inactive') }, mode: 'edge',
    displayPoint: () => ({ x: 10, y: 10 }), cursorPoint: () => ({ x: 500, y: 600 }), prepareFiles: async () => ({ attachments: [{ id: 'image' }] }), applyWindowMode: mode => events.push(mode), wait: async () => events.push('frame') };
}
test('instant capture hides Deck, captures cursor monitor and restores without focus or mode change', async () => {
  const f = fixture(); const result = await captureForChat('display-send', f);
  assert.equal(result.prepared.attachments.length, 1);
  assert.deepEqual(f.events, ['hide', 'frame', ['capture', { x: 500, y: 600 }], 'removed', 'restore-inactive']);
});
test('capture failure restores Deck and deletes temporary image after preparation failure', async () => {
  const f = fixture(); f.prepareFiles = async () => { throw new Error('prepare'); };
  await assert.rejects(captureForChat('display-send', f), /prepare/);
  assert.deepEqual(f.events.slice(-2), ['removed', 'restore-inactive']);
});
test('instant capture never reveals an already hidden widget', async () => {
  const f = fixture(false); await captureForChat('display-send', f); assert.equal(f.events.includes('restore-inactive'), false);
});
test('ordinary capture still opens attachment review', async () => {
  const f = fixture(); await captureForChat('display', f); assert.equal(f.events.at(-1), 'full');
});

test('protected private overlay stays rendered and adds no hide delay or focus change', async () => {
  for (const kind of ['display', 'display-send']) {
    const f = fixture(); f.captureProtected = true; f.mode = 'full';
    await captureForChat(kind, f);
    assert.equal(f.events.includes('hide'), false); assert.equal(f.events.includes('frame'), false);
    assert.equal(f.events.includes('restore-inactive'), false); assert.equal(f.events.includes('full'), false);
  }
});
test('ordinary capture still opens review when a full widget was already hidden', async () => {
  const f = fixture(false); f.mode = 'full'; f.captureProtected = true;
  await captureForChat('display', f);
  assert.equal(f.events.at(-1), 'full'); assert.equal(f.events.includes('hide'), false);
});
test('memory capture preserves PNG bytes without disk roundtrip or duplicate IPC pixels', async () => {
  const f = fixture(); const png = Buffer.from('original lossless pixels');
  f.service.captureDisplay = async options => { assert.equal(options.inMemory, true); return { ok: true, png }; };
  f.prepareImage = async data => { assert.equal(data, png); return { attachments: ['image'] }; };
  f.prepareFiles = async () => { throw new Error('disk preparation must not run'); };
  const result = await captureForChat('display-send', f);
  assert.equal('png' in result, false); assert.deepEqual(result.prepared.attachments, ['image']);
  assert.equal(f.events.includes('removed'), false);
});
test('screenshot send freezes target session, ignores repeat shortcut and preserves draft', async () => {
  const vm = require('node:vm'); const fs = require('node:fs');
  const source = fs.readFileSync(require('node:path').join(__dirname, '../src/renderer/app.js'), 'utf8');
  const snippet = source.slice(source.indexOf('let screenshotSendInFlight = false;'), source.indexOf('function handleScreenshotResult'));
  let resolveCapture; const sent = []; let captures = 0;
  const state = { selectedSessionId: 'first', pendingAttachments: ['draft-image'], runningSessionIds: new Set() };
  const context = vm.createContext({ state, Intl, queueSnapshotRevision: () => 0, beginPendingSend() { return {}; }, settlePendingSend() {}, showToast() {}, showComposerError() {}, window: { widget: { captureScreenshot: () => { captures++; return new Promise(resolve => { resolveCapture = resolve; }); }, send: async payload => sent.push(payload) } } });
  vm.runInContext(snippet, context);
  const first = vm.runInContext('captureAndSendScreenshot()', context);
  state.selectedSessionId = 'second'; await vm.runInContext('captureAndSendScreenshot()', context);
  resolveCapture({ ok: true, prepared: { attachments: ['screenshot'] } }); await first;
  assert.equal(captures, 1); assert.equal(sent[0].sessionId, 'first'); assert.equal(sent[0].text, '');
  assert.deepEqual(sent[0].attachments, ['screenshot']); assert.deepEqual(state.pendingAttachments, ['draft-image']);
});

test('instant screenshot queue handoff uses submit-time state and preserves queue-before-ack ownership', async () => {
  const vm = require('node:vm'), fs = require('node:fs');
  const source = fs.readFileSync(require('node:path').join(__dirname, '../src/renderer/app.js'), 'utf8');
  const snippet = source.slice(source.indexOf('let screenshotSendInFlight = false;'), source.indexOf('function handleScreenshotResult'));
  const state = { selectedSessionId: 'first', pendingAttachments: ['draft-image'], runningSessionIds: new Set(['first']) };
  const events = [];
  const context = vm.createContext({ state, Intl, queueSnapshotRevision: () => 3,
    beginPendingSend: () => (events.push('sending'), {}),
    trackQueuedPrompt: (id, payload, revision) => events.push(['queue', id, payload.attachmentCount, revision]),
    settlePendingSend: (_entry, status) => events.push(status), showToast: text => events.push(text),
    showComposerError: error => { throw error; }, window: { widget: {
      captureScreenshot: async () => ({ ok: true, prepared: { attachments: [{ kind: 'image' }] } }),
      send: async () => { state.runningSessionIds.clear(); state.selectedSessionId = 'other'; },
    } },
  });
  vm.runInContext(snippet, context); await vm.runInContext('captureAndSendScreenshot()', context);
  assert.deepEqual(events, ['sending', ['queue', 'first', 1, 3], 'queued', 'Screenshot queued']);
  assert.deepEqual(state.pendingAttachments, ['draft-image']);
});
