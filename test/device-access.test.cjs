const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { createDeviceAccessServer } = require('../src/device-access.cjs');

async function fixture(t, options = {}) {
  const requests = [];
  const { handleUpstream, handleUpgrade, ...serverOptions } = options;
  let exchanges = 0;
  const upstream = http.createServer((req, res) => {
    if (req.url === '/?token=private-launch') {
      exchanges++;
      res.writeHead(303, { 'set-cookie': 'upstream=private-session; HttpOnly', location: '/' }); res.end(); return;
    }
    requests.push({ url: req.url, headers: req.headers });
    if (handleUpstream) return handleUpstream(req, res, requests.length);
    res.writeHead(200, { 'set-cookie': 'upstream=do-not-leak' });
    res.end(JSON.stringify({ ok: true }));
  });
  upstream.on('upgrade', (req, socket) => {
    requests.push({ url: req.url, headers: req.headers });
    if (handleUpgrade) return handleUpgrade(req, socket);
    socket.end('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSet-Cookie: secret=no\r\n\r\n');
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;
  const app = createDeviceAccessServer({ upstreamUrl, getLaunchUrl: () => `${upstreamUrl}/?token=private-launch`,
    port: 0, approveDevice: async () => true, ...serverOptions });
  await app.start();
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => { await app.close(); await new Promise(resolve => upstream.close(resolve)); });
  async function request(path, { method = 'GET', cookie, headers = {} } = {}) {
    return fetch(origin + path, { method, headers: { origin, ...(cookie ? { cookie } : {}), ...headers } });
  }
  async function pair() {
    const response = await request('/_deck/pair', { method: 'POST' });
    const body = await response.json();
    const pendingCookie = response.headers.getSetCookie()[0].split(';')[0];
    await request('/_deck/status', { cookie: pendingCookie });
    await new Promise(resolve => setImmediate(resolve));
    return { response, body, pendingCookie };
  }
  async function approve() {
    const { pendingCookie } = await pair();
    const response = await request('/_deck/status', { cookie: pendingCookie });
    assert.equal((await response.json()).status, 'approved');
    return response.headers.getSetCookie()[0].split(';')[0];
  }
  return { app, origin, request, pair, approve, requests, upstreamUrl, exchanges: () => exchanges };
}

test('a reset on an unauthenticated upgrade cannot escape the socket error handler', async t => {
  const f = await fixture(t);
  let handled = false;
  f.app.server.once('upgrade', (_req, socket) => {
    assert.doesNotThrow(() => socket.emit('error', Object.assign(new Error('reset'), { code: 'ECONNRESET' })));
    handled = true;
  });
  await new Promise((resolve, reject) => {
    const socket = net.connect(f.app.server.address().port, '127.0.0.1');
    socket.on('connect', () => socket.write(`GET /api/socket HTTP/1.1\r\nHost: ${new URL(f.origin).host}\r\nOrigin: ${f.origin}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`));
    socket.on('data', () => {});
    socket.on('error', error => { if (error.code !== 'ECONNRESET') reject(error); });
    socket.on('close', resolve);
  });
  assert.equal(handled, true);
  assert.equal((await f.request('/')).status, 200);
});

test('reloading the sign-in page resumes the same request without stacking confirmations', async t => {
  let calls = 0;
  const f = await fixture(t, { approveDevice: () => { calls++; return new Promise(() => {}); } });
  const pair = await f.pair();
  for (let i = 0; i < 5; i++) {
    const resumed = await f.request('/_deck/pair', { method: 'POST', cookie: pair.pendingCookie });
    assert.equal(resumed.status, 202);
    assert.equal((await resumed.json()).code, pair.body.code);
    await f.request('/_deck/status', { cookie: pair.pendingCookie });
  }
  assert.equal(calls, 1);
  assert.equal((await f.request('/_deck/pair', { method: 'POST' })).status, 429);
});

test('cross-site document navigation opens login but cannot pair or read APIs', async t => {
  const f = await fixture(t);
  const headers = { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' };
  // Node fetch overrides sec-fetch-mode, so use raw HTTP to reproduce Chrome.
  const get = path => new Promise((resolve, reject) => {
    http.get(f.origin + path, { headers }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); }).on('error', reject);
  });
  assert.equal(await get('/'), 200);
  assert.equal(await get('/_deck/status'), 403);
  assert.equal(await get('/api/session'), 403);
  assert.equal((await f.request('/_deck/pair', { method: 'POST', headers })).status, 403);
  assert.equal(await get('/?token=foreign'), 403);
});

test('device access requires explicit approval and never exposes upstream credentials', async t => {
  let details;
  const f = await fixture(t, { approveDevice: async value => { details = value; return true; } });
  assert.equal((await f.request('/api/session')).status, 401);
  const page = await f.request('/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Подключиться/);
  const { body, pendingCookie, response } = await f.pair();
  assert.match(body.code, /^\d{6}$/);
  assert.equal(details.code, body.code);
  assert.ok(!response.headers.get('set-cookie').includes('deck_device'));
  assert.equal((await f.request('/_deck/status')).status, 410);
  const status = await f.request('/_deck/status', { cookie: pendingCookie });
  const cookie = status.headers.getSetCookie()[0].split(';')[0];
  assert.match(status.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.equal((await f.request('/_deck/status', { cookie: pendingCookie })).status, 410);
  const proxied = await f.request('/api/session', { cookie, headers: { authorization: 'Bearer client' } });
  assert.equal(proxied.status, 200);
  assert.equal(proxied.headers.get('set-cookie'), null);
  assert.deepEqual(await proxied.json(), { ok: true });
  assert.equal(f.requests[0].headers.cookie, 'upstream=private-session');
  assert.equal(f.requests[0].headers.authorization, undefined);
  assert.equal(f.requests[0].headers.origin, f.upstreamUrl);
});

test('approved device tokens survive a server restart while only their hashes are persisted', async t => {
  let trusted = [];
  const persistence = {
    loadTrustedDevices: () => trusted,
    saveTrustedDevices: records => { trusted = structuredClone(records); },
  };
  const first = await fixture(t, persistence);
  const cookie = await first.approve();
  const token = cookie.split('=')[1];
  assert.equal(trusted.length, 1);
  assert.match(trusted[0].digest, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(trusted).includes(token));
  await first.app.close();

  const second = createDeviceAccessServer({ upstreamUrl: first.upstreamUrl,
    getLaunchUrl: () => `${first.upstreamUrl}/?token=private-launch`, port: 0, approveDevice: async () => true,
    ...persistence });
  await second.start();
  t.after(() => second.close());
  const origin = `http://127.0.0.1:${second.server.address().port}`;
  const response = await fetch(origin + '/api/session', { headers: { origin, cookie } });
  assert.equal(response.status, 200);
});

test('a failed trust-store write never issues a usable device token', async t => {
  const f = await fixture(t, { saveTrustedDevices: () => { throw new Error('disk unavailable'); } });
  const { pendingCookie } = await f.pair();
  const response = await f.request('/_deck/status', { cookie: pendingCookie });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('set-cookie'), null);
});

test('denial, expiration and late approval cannot grant access', async t => {
  let time = 10000, complete;
  const f = await fixture(t, { now: () => time, pendingTtlMs: 1000,
    approveDevice: () => new Promise(resolve => { complete = resolve; }) });
  let pair = await f.pair();
  complete(false); await new Promise(resolve => setImmediate(resolve));
  let status = await f.request('/_deck/status', { cookie: pair.pendingCookie });
  assert.equal((await status.json()).status, 'denied');
  assert.equal(status.headers.get('set-cookie'), null);
  pair = await f.pair(); time += 1001; complete(true);
  await new Promise(resolve => setImmediate(resolve));
  status = await f.request('/_deck/status', { cookie: pair.pendingCookie });
  assert.equal(status.status, 410);
  assert.equal(status.headers.get('set-cookie'), null);
  assert.equal(f.requests.length, 0);
});

test('rejects hostile origins, Host rebinding, token URLs and excessive approvals', async t => {
  const f = await fixture(t);
  const hostileHost = await new Promise((resolve, reject) => {
    const req = http.get(f.origin, { headers: { host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
  });
  assert.equal(hostileHost, 403);
  assert.equal((await f.request('/_deck/pair', { method: 'POST', headers: { origin: 'http://evil.example' } })).status, 403);
  assert.equal((await fetch(f.origin + '/_deck/pair', { method: 'POST' })).status, 403);
  assert.equal((await f.request('/?token=anything')).status, 400);
  for (let i = 0; i < 3; i++) await f.approve();
  assert.equal((await f.request('/_deck/pair', { method: 'POST' })).status, 429);
});

test('approved sessions expire and cannot perform cross-origin writes', async t => {
  let time = 100;
  const f = await fixture(t, { now: () => time, sessionTtlMs: 1000 });
  const cookie = await f.approve();
  assert.equal((await fetch(f.origin + '/api/write', { method: 'POST', headers: { cookie } })).status, 403);
  assert.equal((await f.request('/api/read', { cookie })).status, 200);
  time += 1001;
  assert.equal((await f.request('/api/read', { cookie })).status, 401);
});

test('WebSocket upgrades require the approved cookie and matching origin', async t => {
  const f = await fixture(t);
  function upgrade(cookie, origin = f.origin) {
    return new Promise((resolve, reject) => {
      const req = http.request(f.origin + '/socket', { headers: {
        connection: 'Upgrade', upgrade: 'websocket', origin, ...(cookie ? { cookie } : {}),
      } });
      req.on('upgrade', (res, socket) => { socket.destroy(); resolve(res); });
      req.on('response', res => { res.resume(); resolve(res); });
      req.on('error', reject); req.end();
    });
  }
  assert.equal((await upgrade()).statusCode, 401);
  const cookie = await f.approve();
  assert.equal((await upgrade(cookie, 'http://evil.example')).statusCode, 403);
  const response = await upgrade(cookie);
  assert.equal(response.statusCode, 101);
  assert.equal(response.headers['set-cookie'], undefined);
  assert.equal(f.requests[0].headers.cookie, 'upstream=private-session');
});

test('refreshes stale authentication for reads without replaying writes', async t => {
  const f = await fixture(t, { handleUpstream: (req, res, count) => {
    req.resume();
    res.writeHead(count === 2 ? 200 : 401); res.end('result');
  } });
  const cookie = await f.approve();
  assert.equal((await f.request('/read', { cookie })).status, 200);
  assert.equal(f.exchanges(), 2);
  assert.equal((await f.request('/write', { method: 'POST', cookie })).status, 401);
  assert.equal(f.requests.length, 3);
  assert.equal(f.exchanges(), 2);
  assert.equal((await f.request('/write-again', { method: 'POST', cookie })).status, 401);
  assert.equal(f.requests.length, 4);
  assert.equal(f.exchanges(), 3);
});

test('one pending approval at a time; denied request releases slot', async t => {
  const f = await fixture(t, { approveDevice: () => false });
  const pair = await f.pair();
  assert.equal((await f.request('/_deck/pair', { method: 'POST' })).status, 429);
  const status = await f.request('/_deck/status', { cookie: pair.pendingCookie });
  assert.equal((await status.json()).status, 'denied');
  assert.equal((await f.request('/_deck/pair', { method: 'POST' })).status, 202);
});

test('WebSocket authentication failure refreshes credentials on next request', async t => {
  const f = await fixture(t, { handleUpgrade: (req, socket) => socket.end('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n') });
  const cookie = await f.approve();
  const status = await new Promise((resolve, reject) => {
    const req = http.request(f.origin + '/socket', { headers: { connection: 'Upgrade', upgrade: 'websocket', origin: f.origin, cookie } });
    req.on('response', res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); req.end();
  });
  assert.equal(status, 401);
  assert.equal(f.exchanges(), 1);
  assert.equal((await f.request('/read', { cookie })).status, 200);
  assert.equal(f.exchanges(), 2);
});

test('header timeout is bounded but response stream may continue afterwards', async t => {
  const f = await fixture(t, { headerTimeoutMs: 30, handleUpstream: (req, res) => {
    if (req.url === '/hang') return;
    res.writeHead(200, { connection: 'keep-alive, x-internal', 'x-internal': 'private' });
    res.flushHeaders();
    setTimeout(() => res.end('long stream completed'), 80);
  } });
  const cookie = await f.approve();
  assert.equal((await f.request('/hang', { cookie })).status, 502);
  const streamed = await f.request('/stream', { cookie });
  assert.equal(streamed.headers.get('x-internal'), null);
  assert.equal(await streamed.text(), 'long stream completed');
});

test('upgraded sessions close at expiration and server shutdown', async t => {
  let time = 0;
  const f = await fixture(t, { now: () => time, sessionTtlMs: 100,
    handleUpgrade: (req, socket) => {
      socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
      socket.on('end', () => socket.end());
    } });
  async function connect(cookie) {
    return new Promise((resolve, reject) => {
      const req = http.request(f.origin + '/socket', { headers: { connection: 'Upgrade', upgrade: 'websocket', origin: f.origin, cookie } });
      req.on('upgrade', (res, socket) => { socket.resume(); resolve(socket); }); req.on('error', reject); req.end();
    });
  }
  const cookie = await f.approve();
  const first = await connect(cookie);
  const firstClosed = new Promise(resolve => first.once('close', resolve));
  time = 101;
  await f.request('/'); // Expiration sweep revokes the active upgraded connection.
  await firstClosed;
  const nextCookie = await f.approve();
  const second = await connect(nextCookie);
  const secondClosed = new Promise(resolve => second.once('close', resolve));
  await f.app.close(); await secondClosed;
});

test('streams request bodies and strips upstream redirect credentials', async t => {
  let received = '';
  const f = await fixture(t, { handleUpstream: (req, res) => {
    req.on('data', part => { received += part; });
    req.on('end', () => { res.writeHead(302, { location: '/?token=must-not-leak' }); res.end(); });
  } });
  const cookie = await f.approve();
  const response = await fetch(f.origin + '/write', { method: 'POST', headers: { cookie, origin: f.origin },
    body: 'attachment-payload', redirect: 'manual' });
  assert.equal(received, 'attachment-payload');
  assert.equal(response.headers.get('location'), null);
});
