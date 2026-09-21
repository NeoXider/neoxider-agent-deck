const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  for (const [channel, value] of Object.entries({ 'get-preferences': {}, 'app-info': { version: 'test' }, 'get-update-state': {}, 'set-compact-status': {}, 'set-last-selected-session': null, history: { messages: [] } })) ipcMain.handle(channel, () => value);
  const win = new BrowserWindow({ show: false, width: 420, height: 640, webPreferences: { preload: path.join(__dirname, '../src/preload.cjs'), sandbox: true, contextIsolation: true, offscreen: true, backgroundThrottling: false } });
  await win.loadFile(path.join(__dirname, '../src/renderer/index.html'), { query: { screenshotFixture: 'goal-collapsed', screenshotStatic: '1' } });
  const run = script => win.webContents.executeJavaScript(script);
  await new Promise(resolve => setTimeout(resolve, 1000));
  await run(`deckAppearance.apply({ theme:'cyberpunk', background:'cave', overrideBackground:true, imageOpacity:.5, windowBorder:true, inputBorder:true }); document.body.dataset.chatState='tool'; document.body.classList.add('motion-off'); void 0;`);
  await new Promise(resolve => setTimeout(resolve, 300));
  const rectangles = await run(`[...document.querySelectorAll('.chat-activity-border')].map(el=>{ const r=el.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; })`);
  const capture = async () => { await new Promise(resolve => setTimeout(resolve, 80)); return win.webContents.capturePage(); };
  await run(`document.querySelectorAll('.chat-activity-border').forEach(el=>el.style.opacity='0'); void 0;`);
  const viewport = await run('({ width:innerWidth,height:innerHeight })');
  const off = await capture(); const before = off.toBitmap(); const size = off.getSize(); const scale = size.width / viewport.width;
  let minimum = Infinity;
  for (const angle of [0,90,180,270]) {
    await run(`document.querySelectorAll('.chat-activity-border').forEach(el=>{el.style.opacity='1';el.style.setProperty('--chat-border-angle','${angle}deg');}); void 0;`);
    const shot = await capture(); const after = shot.toBitmap();
    for (const r of rectangles) for (const side of ['top','bottom','left','right']) for (const fraction of (side==='top'||side==='bottom'?[.25,.5,.75]:[.5])) {
      const horizontal = side==='top'||side==='bottom';
      const x = horizontal ? r.x+r.width*fraction : side==='left'?r.x:r.x+r.width-1;
      const y = horizontal ? side==='top'?r.y:r.y+r.height-1 : r.y+r.height*fraction;
      let difference = 0;
      for (let shift=-2;shift<=2;shift++) {
        const px=Math.round(x*scale+(horizontal?0:shift)); const py=Math.round(y*scale+(horizontal?shift:0));
        if(px<0||py<0||px>=size.width||py>=size.height) continue;
        const index=(py*size.width+px)*4;
        difference=Math.max(difference,...[0,1,2].map(c=>Math.abs(after[index+c]-before[index+c])));
      }
      minimum=Math.min(minimum,difference);
      assert.ok(difference>5, `${side} rim disappeared at ${angle} degrees: ${difference}`);
    }
    if(angle===270) { fs.mkdirSync(path.join(__dirname,'../tmp'),{recursive:true}); fs.writeFileSync(path.join(__dirname,'../tmp/rim-continuity.png'),shot.toPNG()); }
  }
  console.log(`PASS both rims remain visible on all four sides at four rotation angles; minimum pixel difference ${minimum}`);
  win.destroy(); app.exit(0);
}).catch(error=>{ console.error(error); app.exit(1); });
