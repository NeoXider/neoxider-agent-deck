const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
app.disableHardwareAcceleration();
const deadline = setTimeout(() => app.exit(1), 60000);
app.whenReady().then(async () => {
  for (const [channel, value] of Object.entries({ 'get-preferences': {}, 'app-info': { version: 'test' }, 'get-update-state': {}, 'set-compact-status': {}, 'set-last-selected-session': null, history: { messages: [] } })) ipcMain.handle(channel, () => value);
  const win = new BrowserWindow({ show: false, width: 420, height: 640, webPreferences: {
    preload: path.join(__dirname, '../src/preload.cjs'), sandbox: true, contextIsolation: true, offscreen: true, backgroundThrottling: false,
  } });
  await win.loadFile(path.join(__dirname, '../src/renderer/index.html'), { query: { screenshotFixture: 'chat', screenshotStatic: '1' } });
  await new Promise(resolve => setTimeout(resolve, 1200));
  const run = script => win.webContents.executeJavaScript(script);
  await run(`window.perfHistory = Array.from({ length: 10000 }, (_, seq) => ({ role: seq % 2 ? 'assistant' : 'user', seq, text: 'Message ' + seq })); renderMessages(window.perfHistory);`);
  const debug = win.webContents.debugger;
  debug.attach('1.3');
  await debug.sendCommand('HeapProfiler.enable');
  const heap = async () => { await debug.sendCommand('HeapProfiler.collectGarbage'); return (await debug.sendCommand('Runtime.getHeapUsage')).usedSize; };
  const before = await heap();
  await debug.sendCommand('HeapProfiler.startSampling', { samplingInterval: 32768, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
  const result = await run(`(async () => {
    const input = document.querySelector('#messageInput');
    const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
    const baselineNodes = document.querySelectorAll('*').length;
    const timings = [];
    for (let pass = 0; pass < 100; pass++) {
      const start = performance.now();
      input.value = ('Line ' + pass + '\\n').repeat(pass % 2 ? 60 : 1);
      resizeMessageInput({ immediate: true });
      timings.push(performance.now() - start);
      renderMessages(window.perfHistory);
    }
    input.value = 'short'; resizeMessageInput({ immediate: true });
    const shortHeight = input.getBoundingClientRect().height;
    input.value = 'Long line\\n'.repeat(100); input.setSelectionRange(2, 6);
    resizeMessageInput({ immediate: true });
    const longHeight = input.getBoundingClientRect().height;
    const selection = [input.selectionStart, input.selectionEnd];
    const scrollable = input.classList.contains('is-scrollable');
    input.value = ''; resizeMessageInput({ immediate: true });
    const restoredHeight = input.getBoundingClientRect().height;
    for (let n = 0; n < 100; n++) { input.value = String(n); resizeMessageInput(); }
    await frame(); await frame();
    timings.sort((a,b) => a-b);
    return { p95ResizeMs: timings[94], totalResizeMs: timings.reduce((a,b) => a+b, 0),
      addedNodes: document.querySelectorAll('*').length - baselineNodes,
      measureNodes: document.querySelectorAll('textarea[aria-hidden="true"]').length,
      shortHeight, longHeight, restoredHeight, selection, scrollable };
  })()`);
  const sample = await debug.sendCommand('HeapProfiler.stopSampling');
  const allocations = [];
  const visit = node => { if (node.selfSize) allocations.push({ function: node.callFrame.functionName || '(anonymous)', bytes: node.selfSize }); for (const child of node.children || []) visit(child); };
  visit(sample.profile.head);
  result.retainedHeapDelta = (await heap()) - before;
  result.allocations = allocations.sort((a,b) => b.bytes-a.bytes).slice(0, 8);
  assert.equal(result.shortHeight, 34);
  assert.equal(result.restoredHeight, 34);
  assert.ok(result.longHeight > 34 && result.longHeight <= 640 / 3);
  assert.deepEqual(result.selection, [2, 6]);
  assert.equal(result.scrollable, true);
  assert.equal(result.measureNodes, 1);
  assert.ok(result.addedNodes <= 1, 'repeated resizing must reuse its measurement node');
  assert.ok(result.retainedHeapDelta < 8 * 1024 * 1024, 'settled heap must remain bounded');
  assert.ok(result.p95ResizeMs < 50, 'composer resize must not create long tasks');
  fs.writeFileSync(path.join(__dirname, '../tmp/widget-performance.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  win.destroy(); clearTimeout(deadline); app.exit(0);
}).catch(error => { console.error(error); clearTimeout(deadline); app.exit(1); });
