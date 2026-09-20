const { randomBytes } = require('node:crypto');

const escape = value => String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

function createDeviceApproval({ BrowserWindow, timeoutMs = 120000 }) {
  let active;
  function show() {
    const win = active?.win;
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show(); win.moveTop(); win.focus(); win.flashFrame(true);
  }
  function close() { active?.finish(false); }
  function request({ address, userAgent, code, signal }) {
    if (active || signal?.aborted) return Promise.resolve(false);
    return new Promise(resolve => {
      const nonce = randomBytes(24).toString('hex');
      const decisionUrl = `https://deck-approval.invalid/${nonce}/`;
      const win = new BrowserWindow({ width: 510, height: 460, show: false, alwaysOnTop: true,
        autoHideMenuBar: true, resizable: false, title: 'Agent Deck — доступ устройства',
        backgroundColor: '#151827', webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
      let finished = false;
      const finish = approved => {
        if (finished) return;
        finished = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
        active = null;
        if (!win.isDestroyed()) win.destroy();
        resolve(approved === true && !signal?.aborted);
      };
      const abort = () => finish(false);
      const timer = setTimeout(abort, timeoutMs);
      active = { win, finish };
      signal?.addEventListener('abort', abort, { once: true });
      win.on('closed', abort);
      win.webContents.on('render-process-gone', abort);
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.webContents.on('will-navigate', (event, url) => {
        event.preventDefault();
        if (url === decisionUrl + 'allow') finish(true);
        else if (url === decisionUrl + 'deny') finish(false);
      });
      win.once('ready-to-show', show);
      const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>body{font:16px system-ui;background:#151827;color:#eef3ff;margin:26px}h1{font-size:23px}strong{display:block;font-size:38px;letter-spacing:6px;text-align:center;margin:20px}p{line-height:1.45}small{display:block;overflow-wrap:anywhere;color:#b8c2d8}nav{display:flex;gap:14px;margin-top:24px}a{flex:1;text-align:center;padding:13px;border-radius:12px;background:#30374b;color:white;text-decoration:none}a:last-child{background:#65e1ce;color:#102527}</style><h1>Разрешить вход в DSH?</h1><p>Сверь этот код с кодом в браузере. Вводить его не нужно.</p><strong>${escape(code)}</strong><small>${escape(address)} · ${escape(String(userAgent || '').slice(0, 100))}</small><p>Устройство получит доступ к чатам и запуску действий агента.</p><nav><a autofocus href="${decisionUrl}deny">Отклонить</a><a href="${decisionUrl}allow">Разрешить</a></nav></html>`;
      win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)).catch(abort);
    });
  }
  return { request, show, close, get pending() { return Boolean(active); } };
}

module.exports = { createDeviceApproval };
