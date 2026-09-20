const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createDeviceApproval } = require('../src/device-approval.cjs');

function fixture(timeoutMs = 10000) {
  const windows = [];
  class BrowserWindow extends EventEmitter {
    constructor(options) { super(); this.options = options; this.webContents = new EventEmitter(); this.webContents.setWindowOpenHandler = fn => { this.openHandler = fn; }; windows.push(this); }
    async loadURL(url) { this.html = decodeURIComponent(url.split(',').slice(1).join(',')); }
    isDestroyed() { return Boolean(this.destroyed); }
    isMinimized() { return false; }
    show() { this.shown = true; }
    moveTop() { this.top = true; }
    focus() { this.focused = true; }
    flashFrame(value) { this.flash = value; }
    destroy() { this.destroyed = true; this.emit('closed'); }
  }
  return { windows, approval: createDeviceApproval({ BrowserWindow, timeoutMs }) };
}

test('device confirmation is visible on top, isolated and accepts only its own explicit decision', async () => {
  const f = fixture();
  const result = f.approval.request({ code: '123456', address: '<script>', userAgent: 'phone' });
  const w = f.windows[0];
  w.emit('ready-to-show');
  assert.ok(w.shown && w.top && w.focused && w.flash);
  assert.equal(w.options.alwaysOnTop, true);
  assert.equal(w.options.webPreferences.sandbox, true);
  assert.equal(w.options.webPreferences.nodeIntegration, false);
  assert.match(w.html, /&lt;script&gt;/);
  assert.deepEqual(w.openHandler(), { action: 'deny' });
  w.webContents.emit('will-navigate', { preventDefault() {} }, 'https://attacker/allow');
  assert.equal(f.approval.pending, true);
  assert.equal(await f.approval.request({ code: '654321' }), false);
  const url = w.html.match(/href="([^"]+\/allow)"/)[1];
  w.webContents.emit('will-navigate', { preventDefault() {} }, url);
  assert.equal(await result, true);
  assert.equal(w.destroyed, true);
  assert.equal(f.approval.pending, false);
});

test('closing, revoking and expiration deny access and release the next request', async () => {
  for (const action of ['close', 'abort', 'expire', 'crash']) {
    const f = fixture(10);
    const controller = new AbortController();
    const result = f.approval.request({ code: '123456', signal: controller.signal });
    if (action === 'close') f.approval.close();
    if (action === 'abort') controller.abort();
    if (action === 'crash') f.windows[0].webContents.emit('render-process-gone');
    assert.equal(await result, false);
    assert.equal(f.approval.pending, false);
    assert.equal(f.windows[0].destroyed, true);
    const next = f.approval.request({ code: '654321' });
    assert.equal(f.windows.length, 2);
    f.approval.close();
    assert.equal(await next, false);
  }
});
