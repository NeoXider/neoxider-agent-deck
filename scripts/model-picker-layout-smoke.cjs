const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');

// Offscreen only: do not steal focus, register shortcuts, or capture the desktop.
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  for (const [channel, value] of Object.entries({ commands: [], 'get-preferences': {}, 'app-info': { version: 'test' }, 'get-update-state': {}, 'set-compact-status': {}, 'set-last-selected-session': null, history: { messages: [] } })) ipcMain.handle(channel, () => value);
  const out = path.join(__dirname, '../tmp/ui-smoke');
  fs.mkdirSync(out, { recursive: true });
  for (const [width, height] of [[360, 360], [360, 640], [480, 700]]) {
    const win = new BrowserWindow({ show: false, width, height, webPreferences: { preload: path.join(__dirname, '../src/preload.cjs'), sandbox: true, contextIsolation: true, offscreen: true, backgroundThrottling: false } });
    try {
      await win.loadFile(path.join(__dirname, '../src/renderer/index.html'), { query: { screenshotFixture: 'chat', screenshotStatic: '1' } });
      await new Promise(resolve => setTimeout(resolve, 700));
      const result = await win.webContents.executeJavaScript(`(async () => {
        document.body.dataset.design = 'cyberpunk';
        loadModels = async () => {};
        applyModelSelection = async () => {};
        state.modelLoadState = 'ready';
        state.modelCatalog = { current: { provider:'local', model:'model-12' }, groups:[{id:'local', name:'Local models', models:Array.from({length:20}, (_,i)=>({id:'model-'+i,name:'Model '+i}))}] };
        state.pendingSelection = state.modelCatalog.current;
        renderModels();
        const camera = document.querySelector('#captureButton').getBoundingClientRect();
        const quick = document.querySelector('#reasoningButton'); quick.click(); document.querySelector('.reasoning-model').click();
        await new Promise(r=>setTimeout(r,60));
        const menu = document.querySelector('#modelMenu');
        const rect = menu.getBoundingClientRect();
        const list = document.querySelector('#modelOptions');
        const listRect = list.getBoundingClientRect();
        const snapshot = { square:Math.abs(camera.width-camera.height)<1, popover:menu.matches(':popover-open'), fits:rect.left>=0 && rect.top>=0 && rect.right<=innerWidth && rect.bottom<=innerHeight, scrolls:list.scrollHeight>list.clientHeight, usable:listRect.height>=100, options:document.querySelectorAll('[data-model-option]').length };
        document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
        snapshot.escapeClosed = !menu.matches(':popover-open');
        snapshot.focusRestored = document.activeElement === quick;
        snapshot.setupCollapsed = !document.querySelector('#agentControls').open;
        quick.click(); document.querySelector('.reasoning-model').click(); await new Promise(r=>setTimeout(r,30));
        const search=document.querySelector('#modelSearch'); search.value='Model 19'; search.dispatchEvent(new Event('input',{bubbles:true}));
        const option=document.querySelector('[data-model-option]'); option.click();
        snapshot.selected = state.pendingSelection.model === 'model-19' && !menu.matches(':popover-open');
        search.value=''; renderModelOptions(); quick.click(); document.querySelector('.reasoning-model').click();
        await new Promise(r=>setTimeout(r,60));
        return snapshot;
      })()`);
      for (const [key, value] of Object.entries(result)) assert.equal(value, key === 'options' ? 20 : true, `${width}x${height}: ${key}`);
      fs.writeFileSync(path.join(out, `model-layout-${width}x${height}.png`), (await win.webContents.capturePage()).toPNG());
      console.log(`${width}x${height}: passed`);
    } finally { win.destroy(); }
  }
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
