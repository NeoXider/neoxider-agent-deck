const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const { applyPlatformWindowLayer, detectPlatformCapabilities } = require('../src/platform-capabilities.cjs');
app.whenReady().then(() => {
  if(process.platform !== 'win32') { console.log('Windows capture exclusion: skipped on this platform'); app.exit(0); return; }
  const window = new BrowserWindow({ show:false, width:360, height:360, webPreferences:{sandbox:true,contextIsolation:true} });
  const capabilities = detectPlatformCapabilities();
  for(const mode of ['full','orb','edge']) {
    applyPlatformWindowLayer(window,{layer:'private',mode,capabilities});
    assert.equal(window.isContentProtected(),true);
    assert.equal(window.isAlwaysOnTop(),true);
    applyPlatformWindowLayer(window,{layer:'above',mode,capabilities});
    assert.equal(window.isContentProtected(),false);
  }
  window.destroy(); console.log('PASS native Windows capture exclusion enables in all modes and clears when leaving'); app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});
