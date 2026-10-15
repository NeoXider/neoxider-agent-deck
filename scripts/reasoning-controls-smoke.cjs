const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  for (const [channel, value] of Object.entries({ 'get-preferences': {}, 'app-info': { version: require('../package.json').version }, 'get-update-state': {}, 'set-compact-status': {}, 'set-last-selected-session': null, history: { messages: [] }, commands: [] })) ipcMain.handle(channel, () => value);
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
    renderReasoning();
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
        motion.push({ theme,index,fill:fill.animationName,badge:badge.animationName,duration:fill.animationDuration,accent:getComputedStyle(document.querySelector('#reasoningMenu')).getPropertyValue('--reasoning-accent').trim(),themeAccent:getComputedStyle(document.body).getPropertyValue('--mint').trim(),pixels:getComputedStyle(document.querySelector('.reasoning-fill'),'::after').animationName,buttonPixels:getComputedStyle(button,'::after').animationName,star:getComputedStyle(document.querySelector('.reasoning-fill .reasoning-starfield i')).animationName,buttonStar:getComputedStyle(button.querySelector('.reasoning-starfield i')).animationName,starsShown:getComputedStyle(document.querySelector('.reasoning-fill .reasoning-starfield')).display==='block',starShape:getComputedStyle(document.querySelector('.reasoning-fill .reasoning-starfield i')).clipPath });
      }
    }
    // Entering the top level plays one burst from the handle; showing it again does not, and
    // with Motion effects off it never plays at all.
    const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    state.pendingSelection = { provider:'local', model:'test', reasoningEffort:'medium' }; renderReasoning();
    const burstTrack = document.querySelector('.reasoning-track');
    const burstSlider = document.querySelector('.reasoning-slider');
    burstSlider.value = '2'; burstSlider.dispatchEvent(new Event('input', { bubbles: true })); await frame();
    const burstOnEntry = burstTrack.classList.contains('effort-burst');
    const burstName = getComputedStyle(burstTrack, '::after').animationName;
    await new Promise(resolve => setTimeout(resolve, 900));
    const burstCleared = !burstTrack.classList.contains('effort-burst');
    burstSlider.dispatchEvent(new Event('input', { bubbles: true })); await frame();
    const burstNotRepeated = !burstTrack.classList.contains('effort-burst');
    document.body.classList.add('motion-off');
    burstSlider.value = '1'; burstSlider.dispatchEvent(new Event('input', { bubbles: true }));
    burstSlider.value = '2'; burstSlider.dispatchEvent(new Event('input', { bubbles: true })); await frame();
    const burstStillWhenOff = !burstTrack.classList.contains('effort-burst');
    document.body.classList.remove('motion-off');
    const burst = { reduced, burstOnEntry, burstName, burstCleared, burstNotRepeated, burstStillWhenOff };
    state.pendingSelection = { provider:'local', model:'test', reasoningEffort:'high' }; renderReasoning();
    const star = document.querySelector('.reasoning-fill .reasoning-starfield i');
    const starOpacityBefore = getComputedStyle(star).opacity;
    await new Promise(resolve => setTimeout(resolve, 220));
    const starOpacityAfter = getComputedStyle(star).opacity;
    state.pendingSelection = { provider:'local', model:'test', reasoningEffort:'high' }; renderReasoning();
    const frozenSlider = document.querySelector('.reasoning-slider');
    const frozenFill = document.querySelector('.reasoning-fill');
    const frozenBefore = { value:frozenSlider.value, x:frozenSlider.getBoundingClientRect().x, width:frozenFill.getBoundingClientRect().width };
    const pixelWaveBefore = getComputedStyle(frozenFill,'::before').backgroundPosition;
    const chipWaveBefore = getComputedStyle(button,'::before').backgroundPosition;
    const chipMask = getComputedStyle(button,'::before').maskImage;
    const chipMaskComposite = getComputedStyle(button,'::before').maskComposite;
    const chipDuration = getComputedStyle(button,'::before').animationDuration;
    await new Promise(resolve => setTimeout(resolve, 220));
    const frozenAfter = { value:frozenSlider.value, x:frozenSlider.getBoundingClientRect().x, width:frozenFill.getBoundingClientRect().width };
    const pixelWaveAfter = getComputedStyle(frozenFill,'::before').backgroundPosition;
    const chipWaveAfter = getComputedStyle(button,'::before').backgroundPosition;
    const frozenStyles = { sliderAnimation:getComputedStyle(frozenSlider).animationName, thumbAnimation:getComputedStyle(frozenSlider,'::-webkit-slider-thumb').animationName, pixelTransform:getComputedStyle(frozenFill,'::before').transform };
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
    const modelPickerOpened = document.querySelector('.model-picker').classList.contains('open') && !document.querySelector('#agentControls, .reasoning-setup');
    closePickers(); document.querySelector('#reasoningModelName').click();
    if (!button.closest('.picker').classList.contains('open') || document.querySelector('.reasoning-slider').getBoundingClientRect().width < 100 || document.querySelector('#modelMenu').matches(':popover-open')) throw new Error('Model chip did not open the reasoning slider');
    document.querySelector('.reasoning-model-choice').click();
    if (!document.querySelector('#modelMenu').matches(':popover-open')) throw new Error('Separate model choice did not open the picker');
    closePickers(); button.dispatchEvent(new KeyboardEvent('keydown', { key:'ArrowDown', bubbles:true }));
    if (!button.closest('.picker').classList.contains('open')) throw new Error('Keyboard model entry did not open the slider');
    closePickers(); button.click();
    return { burst, chipMaskComposite, modelPickerOpened, motion, sliderFrozen, frozenBefore, frozenAfter, frozenStyles, starOpacityBefore, starOpacityAfter, pixelWaveBefore, pixelWaveAfter, chipWaveBefore, chipWaveAfter, chipMask, chipDuration, twoEfforts: [reasoningIntensity(0,2),reasoningIntensity(1,2)], singleEffort: reasoningIntensity(0,1), resetOpen, stable, preview, remainedOpen, calls, visible: rect.width > 0 && rect.height > 0, sameRow: Math.abs(rect.top - modelRect.top) < 2, fits: menuRect.left >= 0 && menuRect.right <= innerWidth, reset: button.textContent.trim() };
  })()`);
  assert.ok(catalogReads > 0, "Opening model selection refreshes the catalog");
  assert.equal(result.stable, true); assert.equal(result.preview, 'High'); assert.equal(result.remainedOpen, true);
  assert.deepEqual(result.twoEfforts, ['deep', 'peak']); assert.equal(result.singleEffort, 'normal');
  assert.notEqual(result.starOpacityBefore, result.starOpacityAfter, 'Sparks glint and fade on their own');
  assert.notEqual(result.pixelWaveBefore, result.pixelWaveAfter, 'The current should move inside a fixed fill');
  assert.notEqual(result.chipWaveBefore, result.chipWaveAfter, 'The rim light must move independently of the fill');
  // The rim is a ring: two masks cut away everything but the one-pixel band, so the light
  // never passes under the model name.
  assert.match(result.chipMask, /^linear-gradient\(.*\), linear-gradient\(/, 'The chip light is confined to its rim');
  assert.match(result.chipMaskComposite, /^exclude/);
  assert.equal(result.chipDuration, '3.2s');
  assert.equal(result.burst.burstOnEntry, !result.burst.reduced, 'Entering the top effort plays the burst');
  if (!result.burst.reduced) assert.equal(result.burst.burstName, 'reasoning-burst');
  assert.equal(result.burst.burstCleared, true, 'The burst plays once and clears');
  assert.equal(result.burst.burstNotRepeated, true, 'Showing the top effort again does not burst again');
  assert.equal(result.burst.burstStillWhenOff, true, 'No burst with Motion effects off');
  assert.equal(result.calls[0].reasoningEffort, 'high'); assert.equal(result.calls[1].reasoningEffort, undefined);
  for (const key of ['visible', 'sameRow', 'fits', 'resetOpen', 'modelPickerOpened', 'sliderFrozen']) assert.equal(result[key], true, `${key}: ${JSON.stringify({ before:result.frozenBefore, after:result.frozenAfter, styles:result.frozenStyles })}`);
  assert.match(result.reset, /Auto/);
  for (const item of result.motion) {
    // Below the top two the fill is still; the penultimate is a slow tide with a sheen, the top
    // a fast current with a crisp sweep. The chip: a drifting wash, then light round its rim.
    assert.equal(item.fill,['none','reasoning-tide','reasoning-current'][item.index]);
    assert.equal(item.badge,['none','reasoning-chip-tide','reasoning-rim'][item.index]);
    assert.equal(item.pixels,['none','reasoning-sheen','reasoning-sweep'][item.index]);
    assert.equal(item.buttonPixels,['none','reasoning-sheen','reasoning-sweep'][item.index]);
    assert.equal(item.duration,['0s','9s','2.8s'][item.index]);
    assert.equal(item.accent,item.themeAccent);
    // Sparks belong to the top effort alone.
    assert.equal(item.starsShown,item.index===2);
    if(item.index===2) { assert.equal(item.star,'reasoning-spark'); assert.equal(item.buttonStar,'reasoning-spark'); assert.match(item.starShape,/polygon/); }
  }
  fs.mkdirSync(path.join(__dirname, '../tmp/ui-smoke'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '../tmp/ui-smoke/reasoning-slider.png'), (await win.webContents.capturePage()).toPNG());
  win.setSize(460, 500);
  const longName = await win.webContents.executeJavaScript(`(async () => {
    document.body.dataset.design = 'cave';
    state.modelCatalog.groups[0].models[0].name = 'qwen3.8-27b-heretic-gsq-rco';
    state.modelCatalog.groups[0].models[0].reasoning = { defaultEffort:'xhigh', efforts:[{id:'off',name:'Off'},{id:'medium',name:'Medium'},{id:'high',name:'High'},{id:'xhigh',name:'Xhigh'}] };
    state.pendingSelection = { provider:'local', model:'test', reasoningEffort:'xhigh' };
    renderReasoning();
    await new Promise(resolve => setTimeout(resolve, 500));
    const name = document.querySelector('#reasoningModelName');
    const badge = document.querySelector('#reasoningButtonText');
    return { text:name.textContent, readable:name.scrollWidth <= name.clientWidth,
      separated:name.getBoundingClientRect().right <= badge.getBoundingClientRect().left };
  })()`);
  assert.equal(longName.text, 'qwen3.8-27b-heretic-gsq-rco');
  assert.equal(longName.readable, true, 'The full Qwen name fits at the screenshot width');
  assert.equal(longName.separated, true, 'The effort badge never overlaps the model name');
  fs.writeFileSync(path.join(__dirname, '../tmp/ui-smoke/reasoning-model-chip-cave.png'), (await win.webContents.capturePage()).toPNG());
  console.log(JSON.stringify(result)); win.destroy(); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
