const http = require('node:http');
const https = require('node:https');
const { createHash, randomBytes, randomInt } = require('node:crypto');

const SESSION = 'deck_device';
const PENDING = 'deck_pair';
const DAY = 86400000;
const random = () => randomBytes(32).toString('hex');
const digest = token => createHash('sha256').update(String(token || '')).digest('hex');

function createDeviceAccessServer({ upstreamUrl = 'http://127.0.0.1:3080',
  getLaunchUrl, approveDevice, host = '127.0.0.1', port = 3099,
  allowedHosts = [], pendingTtlMs = 120000, sessionTtlMs = 30 * DAY,
  now = Date.now, headerTimeoutMs = 15000, loadTrustedDevices = () => [], saveTrustedDevices = () => {} } = {}) {
  const upstream = new URL(upstreamUrl);
  if (!['http:', 'https:'].includes(upstream.protocol) || upstream.username || upstream.password) throw new Error('Invalid upstream');
  const transport = upstream.protocol === 'https:' ? https : http;
  const hosts = new Set(['localhost', '127.0.0.1', '[::1]', ...allowedHosts].map(x => String(x).toLowerCase()));
  const sessions = new Map((loadTrustedDevices() || []).map(item => [item.digest, item.expiresAt])
    .filter(([id, expires]) => /^[a-f0-9]{64}$/.test(id) && Number.isFinite(expires) && expires > now()).slice(-1000));
  const pending = new Map();
  const rates = new Map();
  const sockets = new Set();
  const authenticatedSockets = new Map();
  let approving = false;
  let upstreamCookie = '';
  let minting;
  let closed = false;
  function persistSessions() {
    try { saveTrustedDevices([...sessions].map(([id, expiresAt]) => ({ digest: id, expiresAt }))); return true; }
    catch { return false; }
  }
  function sweep() {
    for (const [id, item] of pending) if (item.expires <= now()) { item.controller.abort(); pending.delete(id); }
    let changed = false;
    for (const [id, expires] of sessions) if (expires <= now()) { sessions.delete(id); changed = true; }
    if (changed) persistSessions();
    for (const [id, item] of rates) if (item.until <= now()) rates.delete(id);
    for (const [socket, expires] of authenticatedSockets) if (expires <= now()) socket.destroy();
  }
  const cleanupTimer = setInterval(sweep, Math.max(1, Math.min(sessionTtlMs, 60000)));
  cleanupTimer.unref();
  function cookies(req) {
    return Object.fromEntries(String(req.headers.cookie || '').split(';').map(x => {
      const i = x.indexOf('='); return [x.slice(0, i).trim(), x.slice(i + 1).trim()];
    }));
  }
  function cookie(name, value, ttl) {
    return `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(ttl / 1000)}`;
  }
  function valid(req, requireOrigin = false) {
    try {
      const origin = new URL(`http://${req.headers.host}`);
      const boundPort = server.address()?.port;
      // Opening the landing page from another site/extension is navigation,
      // not a cross-origin API call. It still requires device authentication.
      const landingNavigation = !requireOrigin && req.method === 'GET' && req.url === '/'
        && req.headers['sec-fetch-mode'] === 'navigate' && req.headers['sec-fetch-dest'] === 'document';
      if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash ||
          !hosts.has(origin.hostname.toLowerCase()) || Number(origin.port || 80) !== boundPort) return false;
      if (!landingNavigation && req.headers.origin && req.headers.origin !== origin.origin) return false;
      if (requireOrigin && !req.headers.origin) return false;
      if (!landingNavigation && req.headers['sec-fetch-site'] === 'cross-site') return false;
      return true;
    } catch { return false; }
  }
  function sessionExpiry(req) { return sessions.get(digest(cookies(req)[SESSION])) || 0; }
  function authenticated(req) { return sessionExpiry(req) > now(); }
  function reply(res, code, value, headers = {}) {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
      'x-content-type-options': 'nosniff', ...headers });
    res.end(typeof value === 'string' ? value : JSON.stringify(value));
  }
  async function ensureCookie() {
    if (upstreamCookie) return upstreamCookie;
    if (!minting) minting = (async () => {
      const launch = new URL(await getLaunchUrl());
      if (launch.origin !== upstream.origin || launch.username || launch.password) throw new Error('Invalid launch origin');
      const response = await fetch(launch, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
      const values = response.headers.getSetCookie();
      const result = values.map(x => x.split(';', 1)[0]).filter(Boolean).join('; ');
      await response.body?.cancel();
      if (!result || response.status >= 400) throw new Error('Authentication unavailable');
      if (!closed) upstreamCookie = result;
      return result;
    })().finally(() => { minting = null; });
    return minting;
  }
  function pathFor(req) {
    if (!req.url.startsWith('/') || req.url.startsWith('//')) return null;
    const target = new URL(req.url, upstream);
    if (target.origin !== upstream.origin || target.searchParams.has('token')) return null;
    return target.pathname + target.search;
  }
  function requestHeaders(req, secret, upgrade = false) {
    const headers = { ...req.headers, host: upstream.host, cookie: secret };
    for (const name of ['authorization', 'proxy-authorization', 'forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto']) delete headers[name];
    if (headers.origin) headers.origin = upstream.origin;
    if (!upgrade) {
      for (const name of String(headers.connection || '').split(',').map(x => x.trim().toLowerCase())) delete headers[name];
      delete headers.connection; delete headers.upgrade;
    }
    return headers;
  }
  function responseHeaders(incoming, upgrade = false) {
    const headers = { ...incoming };
    if (!upgrade) {
      const hopHeaders = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade',
        ...String(headers.connection || '').split(',').map(x => x.trim().toLowerCase())];
      for (const name of hopHeaders) delete headers[name];
    }
    delete headers['set-cookie'];
    delete headers['set-cookie2'];
    if (headers.location) {
      try {
        const location = new URL(headers.location, upstream);
        if (location.origin !== upstream.origin || location.searchParams.has('token')) delete headers.location;
        else headers.location = location.pathname + location.search + location.hash;
      } catch { delete headers.location; }
    }
    return headers;
  }
  async function proxy(req, res, path, retry = false) {
    try {
      const secret = await ensureCookie();
      if (closed || res.destroyed) return;
      const outgoing = transport.request(upstream, { method: req.method, path, headers: requestHeaders(req, secret) }, incoming => {
        if (incoming.statusCode === 401 && upstreamCookie === secret) upstreamCookie = '';
        if (incoming.statusCode === 401 && !retry && ['GET', 'HEAD'].includes(req.method)) {
          incoming.resume();
          void proxy(req, res, path, true);
          return;
        }
        res.writeHead(incoming.statusCode, responseHeaders(incoming.headers));
        incoming.pipe(res);
        incoming.on('error', () => res.destroy());
      });
      boundHeaderWait(outgoing);
      outgoing.on('error', () => { if (!res.headersSent) reply(res, 502, { error: 'DSH is unavailable' }); else res.destroy(); });
      res.on('close', () => outgoing.destroy());
      if (retry || ['GET', 'HEAD'].includes(req.method)) outgoing.end(); else req.pipe(outgoing);
    } catch { if (!res.headersSent) reply(res, 502, { error: 'DSH authentication is unavailable' }); }
  }
  function boundHeaderWait(request) {
    let timer;
    let settled = false;
    request.once('finish', () => {
      if (settled) return;
      timer = setTimeout(() => request.destroy(new Error('Upstream headers timed out')), headerTimeoutMs);
      timer.unref();
    });
    // Bound network inactivity while connecting/uploading, not an active upload.
    request.setTimeout(headerTimeoutMs, () => request.destroy(new Error('Upstream connection timed out')));
    const clear = () => { settled = true; clearTimeout(timer); request.setTimeout(0); };
    request.once('response', clear); request.once('upgrade', clear);
    request.once('error', clear); request.once('close', clear);
  }
  function loginPage(res) {
    const nonce = random();
    reply(res, 200, `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Вход в DSH</title><style nonce="${nonce}">body{font:18px system-ui;background:#151827;color:#eef3ff;max-width:440px;margin:12vh auto;padding:24px}button{font:inherit;padding:14px;border-radius:12px;cursor:pointer}#code{font-size:36px;letter-spacing:6px}</style><h1>Подключиться к DSH</h1><p>Разрешите вход на компьютере. Сверьте код на обоих устройствах.</p><p>Браузер запоминается до 30 дней, включая перезапуски Deck. Отключение доступа отзывает разрешение.</p><div id="code"></div><p id="status"></p><button id="connect">Запросить доступ</button><script nonce="${nonce}">const b=document.getElementById('connect'),s=document.getElementById('status');b.onclick=async()=>{b.disabled=true;try{let r=await fetch('/_deck/pair',{method:'POST'}),v=await r.json();if(!r.ok)throw Error(v.error);document.getElementById('code').textContent=v.code;s.textContent='Ожидаем подтверждения на компьютере…';let timer=setInterval(async()=>{try{let r=await fetch('/_deck/status'),v=await r.json();if(v.status==='approved'){clearInterval(timer);location.replace('/')}else if(v.status!=='pending'){clearInterval(timer);s.textContent='Доступ отклонён или запрос истёк. Попробуйте снова.';b.disabled=false}}catch{clearInterval(timer);s.textContent='Соединение потеряно';b.disabled=false}},1000)}catch(e){s.textContent=e.message;b.disabled=false}};</script></html>`, {
      'content-type': 'text/html; charset=utf-8', 'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`, 'referrer-policy': 'no-referrer' });
  }
  const server = http.createServer((req, res) => {
    sweep();
    if (!valid(req)) return reply(res, 403, { error: 'Invalid request origin' });
    const path = pathFor(req);
    if (!path) return reply(res, 400, { error: 'Invalid request path' });
    if (path === '/_deck/pair' && req.method === 'POST') {
      req.resume();
      if (!valid(req, true)) return reply(res, 403, { error: 'Origin required' });
      const existing = pending.get(cookies(req)[PENDING]);
      if (existing && existing.status !== 'denied') return reply(res, 202, { code: existing.code, status: existing.status });
      if (existing) pending.delete(cookies(req)[PENDING]);
      const address = req.socket.remoteAddress;
      const rate = rates.get(address) || { count: 0, until: now() + 60000 };
      if (rate.count >= 3 || pending.size >= 1 || approving || sessions.size >= 1000 || rates.size >= 1000) return reply(res, 429, { error: 'Другой запрос ожидает ответа или достигнут лимит. Попробуйте позже.' });
      rate.count++; rates.set(address, rate);
      const id = random(), code = String(randomInt(100000, 1000000));
      const record = { status: 'pending', code, expires: now() + pendingTtlMs, controller: new AbortController() };
      pending.set(id, record);
      reply(res, 202, { code, status: 'pending' }, { 'set-cookie': cookie(PENDING, id, pendingTtlMs) });
      record.begin = () => {
        approving = true;
        Promise.resolve().then(() => approveDevice?.({ address, userAgent: String(req.headers['user-agent'] || '').slice(0, 300), code, signal: record.controller.signal })).then(approved => {
          if (!closed && pending.get(id) === record && record.expires > now()) record.status = approved === true ? 'approved' : 'denied';
        }).catch(() => { record.status = 'denied'; }).finally(() => { approving = false; });
      };
      return;
    }
    if (path === '/_deck/status' && req.method === 'GET') {
      const id = cookies(req)[PENDING], record = pending.get(id);
      if (!record) return reply(res, 410, { status: 'expired' });
      // The client has displayed the code before its first status poll.
      if (record.begin) { const begin = record.begin; delete record.begin; begin(); }
      if (record.status === 'approved') {
        pending.delete(id);
        const session = random(), sessionDigest = digest(session);sessions.set(sessionDigest, now() + sessionTtlMs);
        if (!persistSessions()) { sessions.delete(sessionDigest); return reply(res, 503, { status: 'unavailable' }); }
        return reply(res, 200, { status: 'approved' }, { 'set-cookie': [cookie(SESSION, session, sessionTtlMs), cookie(PENDING, '', 0)] });
      }
      if (record.status === 'denied') pending.delete(id);
      return reply(res, 200, { status: record.status });
    }
    if (path.startsWith('/_deck/')) return reply(res, 404, { error: 'Not found' });
    if (!authenticated(req)) {
      if (path === '/' && req.method === 'GET') return loginPage(res);
      req.resume(); return reply(res, 401, { error: 'Device approval required' });
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !valid(req, true)) return reply(res, 403, { error: 'Origin required' });
    void proxy(req, res, path);
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.on('upgrade', async (req, socket, head) => {
    // Node removes its HTTP error listener when handing us an upgrade socket.
    // Own resets even before authentication/handshake has finished.
    socket.on('error', () => socket.destroy());
    const reject = code => socket.end(`HTTP/1.1 ${code} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    if (!valid(req, true)) return reject(403);
    if (!authenticated(req)) return reject(401);
    const path = pathFor(req);
    if (!path || path.startsWith('/_deck/')) return reject(400);
    try {
      const secret = await ensureCookie();
      if (closed || socket.destroyed) return;
      const outgoing = transport.request(upstream, { method: 'GET', path, headers: requestHeaders(req, secret, true) });
      boundHeaderWait(outgoing);
      outgoing.on('upgrade', (incoming, target, upstreamHead) => {
        authenticatedSockets.set(socket, sessionExpiry(req));
        socket.once('close', () => authenticatedSockets.delete(socket));
        sockets.add(target); target.on('close', () => sockets.delete(target));
        const headers = responseHeaders(incoming.headers, true);
        socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(headers).map(([k,v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`);
        if (upstreamHead.length) socket.write(upstreamHead);
        if (head.length) target.write(head);
        socket.pipe(target).pipe(socket);
        target.on('error', () => socket.destroy()); socket.on('error', () => target.destroy());
        socket.on('close', () => target.destroy()); target.on('close', () => socket.destroy());
      });
      outgoing.on('response', incoming => {
        if (incoming.statusCode === 401 && upstreamCookie === secret) upstreamCookie = '';
        incoming.resume(); reject(incoming.statusCode);
      });
      outgoing.on('error', () => reject(502));
      socket.on('close', () => outgoing.destroy());
      outgoing.end();
    } catch { reject(502); }
  });
  return {
    server,
    start: () => new Promise((resolve, reject) => {
      const fail = error => reject(error); server.once('error', fail);
      server.listen(port, host, () => { server.off('error', fail); resolve(server.address()); });
    }),
    close: () => new Promise(resolve => {
      closed = true; for (const item of pending.values()) item.controller.abort(); pending.clear(); upstreamCookie = '';
      clearInterval(cleanupTimer);
      for (const socket of sockets) socket.destroy();
      server.close(() => resolve());
    }),
    revokeAll() { sessions.clear(); persistSessions(); for (const socket of authenticatedSockets.keys()) socket.destroy(); },
  };
}

module.exports = { createDeviceAccessServer };
