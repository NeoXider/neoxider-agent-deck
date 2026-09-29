const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  for (const [channel, value] of Object.entries({ 'get-preferences': {}, 'app-info': { version: 'test' }, 'get-update-state': {}, 'set-compact-status': {}, 'set-last-selected-session': null, history: { messages: [] }, commands: [] })) ipcMain.handle(channel, () => value);
  let catalogReads = 0;
  ipcMain.handle('models', () => {
    catalogReads += 1;
    return { current: { provider: 'local', model: 'test' }, groups: [{ id: 'local', models: [{ id: 'test', name: 'Test model', reasoning: { defaultEffort: 'medium', efforts: [{ id: 'off', name: 'Off' }, { id: 'medium', name: 'Medium' }, { id: 'high', name: 'High' }] } }] }] };
  });
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
        motion.push({ theme,index,fill:fill.animationName,badge:badge.animationName,duration:fill.animationDuration,accent:getComputedStyle(document.querySelector('#reasoningMenu')).getPropertyValue('--reasoning-accent').trim(),themeAccent:getComputedStyle(document.body).getPropertyValue('--mint').trim(),pixels:getComputedStyle(document.querySelector('.reasoning-fill'),'::after').animationName,buttonPixels:getComputedStyle(button,'::after').animationName,star:getComputedStyle(document.querySelector('.reasoning-fill .reasoning-starfield i')).animationName,buttonStar:getComputedStyle(button.querySelector('.reasoning-starfield i')).animationName,starShape:getComputedStyle(document.querySelector('.reasoning-fill .reasoning-starfield i')).clipPath });
      }
    }
    state.pendingSelection = { provider:'local', model:'test', reasoningEffort:'medium' }; renderReasoning();
    const star = document.querySelector('.reasoning-fill .reasoning-starfield i');
    const starOpacityBefore = getComputedStyle(star).opacity;
    await new Promise(resolve => setTimeout(resolve, 220));
    const starOpacityAfter = getComputedStyle(star).opacity;
    state.pendingSelection = { provider:'local', model:'test', reasoningEffort:'high' }; renderReasoning();
    const frozenSlider = document.querySelector('.reasoning-slider');
    const frozenFill = document.querySelector('.reasoning-fill');
    const frozenBefore = { value:frozenSlider.value, x:frozenSlider.getBoundingClientRect().x, width:frozenFill.getBoundingClientRect().width };
    const pixelWaveBefore = getComputedStyle(frozenFill,'::after').backgroundPosition;
    await new Promise(resolve => setTimeout(resolve, 220));
    const frozenAfter = { value:frozenSlider.value, x:frozenSlider.getBoundingClientRect().x, width:frozenFill.getBoundingClientRect().width };
    const pixelWaveAfter = getComputedStyle(frozenFill,'::after').backgroundPosition;
    const frozenStyles = { sliderAnimation:getComputedStyle(frozenSlider).animationName, thumbAnimation:getComputedStyle(frozenSlider,'::-webkit-slider-thumb').animationName, pixelTransform:getComputedStyle(frozenFill,'::after').transform };
    const sliderFrozen = JSON.stringify(frozenBefore) === JSON.stringify(frozenAfter)
      && frozenStyles.sliderAnimation === 'none'
      && frozenStyles.thumbAnimation === 'none'
      && frozenStyles.pixelTransform === 'none';
    document.body.dataset.design = defaultTheme || 'aurora';
    state.pendingSelection = { provider:'local',model:'test' }; renderReasoning();
    const rect = button.getBoundingClientRect();
    const modelRect = document.querySelector('#openSessionButton').getBoundingClientRect();
    const menuRect = document.querySelector('#reasoningMenu').getBoundingClientRect();
    document.querySelector('.reasoning-model').click();
    await new Promise(resolve => setTimeout(resolve, 300));
    const modelPickerOpened = document.querySelector('.model-picker').classList.contains('open') && document.querySelector('#agentControls').open;
    closePickers(); document.querySelector('#agentControls').open = false; button.click();
    return { modelPickerOpened, motion, sliderFrozen, frozenBefore, frozenAfter, frozenStyles, starOpacityBefore, starOpacityAfter, pixelWaveBefore, pixelWaveAfter, twoEfforts: [reasoningIntensity(0,2),reasoningIntensity(1,2)], singleEffort: reasoningIntensity(0,1), resetOpen, stable, preview, remainedOpen, calls, visible: rect.width > 0 && rect.height > 0, sameRow: Math.abs(rect.top - modelRect.top) < 2, fits: menuRect.left >= 0 && menuRect.right <= innerWidth, reset: button.textContent.trim() };
  })()`);
  assert.ok(catalogReads > 0, "Opening model selection refreshes the catalog");
  assert.equal(result.stable, true); assert.equal(result.preview, 'High'); assert.equal(result.remainedOpen, true);
  assert.deepEqual(result.twoEfforts, ['deep', 'peak']); assert.equal(result.singleEffort, 'normal');
  assert.notEqual(result.starOpacityBefore, result.starOpacityAfter, 'Sharp stars should twinkle independently');
  assert.notEqual(result.pixelWaveBefore, result.pixelWaveAfter, 'The pixel wave should move inside a fixed fill');
  assert.equal(result.calls[0].reasoningEffort, 'high'); assert.equal(result.calls[1].reasoningEffort, undefined);
  for (const key of ['visible', 'sameRow', 'fits', 'resetOpen', 'modelPickerOpened', 'sliderFrozen']) assert.equal(result[key], true, `${key}: ${JSON.stringify({ before:result.frozenBefore, after:result.frozenAfter, styles:result.frozenStyles })}`);
  assert.match(result.reset, /Auto/);
  for (const item of result.motion) {
    assert.equal(item.fill,['none','reasoning-prism','none'][item.index]);
    assert.equal(item.badge,item.index===0 ? 'none' : 'effort-chip-orbit');
    if(item.index===1) assert.equal(item.duration,'1.8s');
    if(item.index===2) assert.equal(item.duration,'0s');
    assert.equal(item.accent,item.themeAccent);
    if(item.index===1) { assert.equal(item.pixels,'none'); assert.equal(item.star,'reasoning-star-twinkle'); assert.equal(item.buttonStar,'reasoning-star-twinkle'); assert.match(item.starShape,/polygon/); }
    if(item.index===2) { assert.equal(item.pixels,'reasoning-pixel-wave'); assert.equal(item.buttonPixels,'reasoning-pixel-wave'); }
  }
  fs.mkdirSync(path.join(__dirname, '../tmp/ui-smoke'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '../tmp/ui-smoke/reasoning-slider.png'), (await win.webContents.capturePage()).toPNG());
  console.log(JSON.stringify(result)); win.destroy(); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
