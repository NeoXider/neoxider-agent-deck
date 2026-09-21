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
test('screenshot send freezes target session, ignores repeat shortcut and preserves draft', async () => {
  const vm = require('node:vm'); const fs = require('node:fs');
  const source = fs.readFileSync(require('node:path').join(__dirname, '../src/renderer/app.js'), 'utf8');
  const snippet = source.slice(source.indexOf('let screenshotSendInFlight = false;'), source.indexOf('function handleScreenshotResult'));
  let resolveCapture; const sent = []; let captures = 0;
  const state = { selectedSessionId: 'first', pendingAttachments: ['draft-image'] };
  const context = vm.createContext({ state, Intl, showToast() {}, showComposerError() {}, window: { widget: { captureScreenshot: () => { captures++; return new Promise(resolve => { resolveCapture = resolve; }); }, send: async payload => sent.push(payload) } } });
  vm.runInContext(snippet, context);
  const first = vm.runInContext('captureAndSendScreenshot()', context);
  state.selectedSessionId = 'second'; await vm.runInContext('captureAndSendScreenshot()', context);
  resolveCapture({ ok: true, prepared: { attachments: ['screenshot'] } }); await first;
  assert.equal(captures, 1); assert.equal(sent[0].sessionId, 'first'); assert.equal(sent[0].text, '');
  assert.deepEqual(sent[0].attachments, ['screenshot']); assert.deepEqual(state.pendingAttachments, ['draft-image']);
});
