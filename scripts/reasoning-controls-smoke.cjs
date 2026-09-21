const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  for (const [channel, value] of Object.entries({ 'get-preferences': {}, 'app-info': { version: 'test' }, 'get-update-state': {}, 'set-compact-status': {}, 'set-last-selected-session': null, history: { messages: [] } })) ipcMain.handle(channel, () => value);
  const win = new BrowserWindow({ show: false, width: 360, height: 640, webPreferences: { preload: path.join(__dirname, '../src/preload.cjs'), sandbox: true, contextIsolation: true, offscreen: true, backgroundThrottling: false } });
  await win.loadFile(path.join(__dirname, '../src/renderer/index.html'), { query: { screenshotFixture: 'chat', screenshotStatic: '1' } });
  await new Promise(resolve => setTimeout(resolve, 1200));
  const result = await win.webContents.executeJavaScript(`(async () => {
    const calls = []; applyModelSelection = async () => calls.push({ ...state.pendingSelection });
    state.modelCatalog = { current: { provider: 'local', model: 'test' }, groups: [{ id: 'local', models: [{ id: 'test', name: 'Test model', reasoning: { defaultEffort: 'medium', efforts: [{ id: 'off', name: 'Off' }, { id: 'medium', name: 'Medium' }, { id: 'high', name: 'High' }] } }] }] };
    state.pendingSelection = state.modelCatalog.current;
    document.querySelector('#agentControls').open = false; renderReasoning();
    const button = document.querySelector('#reasoningButton'); button.click();
    let slider = document.querySelector('.reasoning-slider');
    renderReasoning(); const stable = slider === document.querySelector('.reasoning-slider');
    slider.value = '2'; slider.dispatchEvent(new Event('input', { bubbles: true }));
    const preview = slider.getAttribute('aria-valuetext');
    slider.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
    const remainedOpen = document.querySelector('.reasoning-picker').classList.contains('open');
    document.querySelector('.reasoning-reset').click(); await Promise.resolve();
    await new Promise(resolve => setTimeout(resolve, 100));
    const resetOpen = document.querySelector(".reasoning-picker").classList.contains("open");
    document.body.classList.remove("screenshot-static", "motion-off");
    const motion = [];
    const defaultTheme = document.body.dataset.design;
    for (const theme of ['aurora', 'cyberpunk', 'cave']) {
      document.body.dataset.design = theme;
      for (const index of [0,1,2]) {
        state.pendingSelection = { provider:'local', model:'test', reasoningEffort:['off','medium','high'][index] }; renderReasoning();
        const fill = getComputedStyle(document.querySelector('.reasoning-fill'), '::before');
        const badge = getComputedStyle(button, '::before');
        motion.push({ theme,index,fill:fill.animationName,badge:badge.animationName,duration:fill.animationDuration,accent:getComputedStyle(document.querySelector('#reasoningMenu')).getPropertyValue('--reasoning-accent').trim() });
      }
    }
    document.body.dataset.design = defaultTheme || 'aurora';
    state.pendingSelection = { provider:'local',model:'test' }; renderReasoning();
    const rect = button.getBoundingClientRect();
    const modelRect = document.querySelector('#openSessionButton').getBoundingClientRect();
    const menuRect = document.querySelector('#reasoningMenu').getBoundingClientRect();
    document.querySelector('.reasoning-model').click();
    await new Promise(resolve => setTimeout(resolve, 300));
    const modelPickerOpened = document.querySelector('.model-picker').classList.contains('open') && document.querySelector('#agentControls').open;
    closePickers(); document.querySelector('#agentControls').open = false; button.click();
    return { modelPickerOpened, motion, resetOpen, stable, preview, remainedOpen, calls, visible: rect.width > 0 && rect.height > 0, sameRow: Math.abs(rect.top - modelRect.top) < 2, fits: menuRect.left >= 0 && menuRect.right <= innerWidth, reset: button.textContent.trim() };
  })()`);
  assert.equal(result.stable, true); assert.equal(result.preview, 'High'); assert.equal(result.remainedOpen, true);
  assert.equal(result.calls[0].reasoningEffort, 'high'); assert.equal(result.calls[1].reasoningEffort, undefined);
  for (const key of ['visible', 'sameRow', 'fits', 'resetOpen', 'modelPickerOpened']) assert.equal(result[key], true, key);
  assert.match(result.reset, /Auto/);
  for (const item of result.motion) {
    const expected = ['none','reasoning-prism','reasoning-prism'][item.index];
    assert.equal(item.fill,expected); assert.equal(item.badge,item.index ? "effort-chip-orbit" : "none");
    if(item.index) assert.equal(item.duration,item.index===1?'4.8s':'1.8s');
    if(item.theme==='cyberpunk') assert.equal(item.accent,'#fcee09');
  }
  fs.mkdirSync(path.join(__dirname, '../tmp/ui-smoke'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '../tmp/ui-smoke/reasoning-slider.png'), (await win.webContents.capturePage()).toPNG());
  console.log(JSON.stringify(result)); win.destroy(); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
