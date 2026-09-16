const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createRemoteTransport,
  detectGeneration,
  mintBrowserCookie,
  normalizeHarnessLaunchUrl,
} = require("../src/harness-transport.cjs");

function response({ ok = true, status = 200, headers = {}, json = null, text = "" } = {}) {
  return {
    ok,
    status,
    headers: {
      get: (name) => headers[String(name).toLowerCase()] ?? null,
      getSetCookie: undefined,
      ...headers,
    },
    json: async () => json,
    text: async () => text,
  };
}

test("generation detection separates legacy, gated, and down hosts", async () => {
  assert.equal(await detectGeneration("http://127.0.0.1:3080", async () => response({ ok: true })), "legacy");
  assert.equal(await detectGeneration("http://127.0.0.1:3080", async () => response({
    ok: false,
    status: 401,
    text: "dsh web authentication required; reopen the URL printed by dsh web.\n",
  })), "gated");
  assert.equal(await detectGeneration("http://127.0.0.1:3080", async () => response({ ok: false, status: 401, text: "nope" })), "down");
  assert.equal(await detectGeneration("http://127.0.0.1:3080", async () => response({ ok: false, status: 500 })), "down");
  assert.equal(await detectGeneration("http://127.0.0.1:3080", async () => { throw new Error("down"); }), "down");
  assert.equal(await detectGeneration("http://127.0.0.1:3080", null), "down");
});

test("cookie minting reads the manual-redirect Set-Cookie once", async () => {
  const seen = [];
  const fetchImpl = async (url, options) => {
    seen.push([url, options]);
    return response({ status: 303, headers: { "set-cookie": "dsh-auth-x=v1.abc; Max-Age=1; Path=/" } });
  };
  const cookie = await mintBrowserCookie("http://127.0.0.1:3080/?token=t", fetchImpl);
  assert.equal(cookie, "dsh-auth-x=v1.abc");
  assert.equal(seen[0][1].redirect, "manual");
  await assert.rejects(
    mintBrowserCookie("http://127.0.0.1:3080/?token=t", async () => response({ status: 303, headers: {} })),
    /without a session cookie/,
  );
  await assert.rejects(mintBrowserCookie("", fetchImpl), /launch URL is unknown/);
});

test("remote calls carry the cookie and the slash envelope", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push([String(url), options]);
    if (String(url).includes("?token=")) {
      return response({ status: 303, headers: { "set-cookie": "dsh-auth-x=v1.abc; Path=/" } });
    }
    return response({ json: { type: "server-response", rpcId: JSON.parse(options.body).rpcId, result: { ok: true, value: { items: [] } } } });
  };
  const transport = createRemoteTransport({
    baseUrl: "http://127.0.0.1:3080",
    fetchImpl,
    getLaunchBrowserUrl: () => "http://127.0.0.1:3080/?token=t",
  });
  const value = await transport.call("session/list", { _request: {} });
  assert.deepEqual(value, { items: [] });
  assert.equal(calls.filter(([url]) => url.includes("?token=")).length, 1, "mints exactly once");
  const posted = calls.find(([url]) => url.endsWith("/api/session/list"));
  assert.ok(posted, "posts to the slash endpoint");
  assert.equal(posted[1].headers.cookie, "dsh-auth-x=v1.abc");
  const body = JSON.parse(posted[1].body);
  assert.equal(body.method, "session/list");
  assert.deepEqual(body.payload, { args: { _request: {} } });
  assert.equal(typeof body.rpcId, "string");
  assert.equal(transport.hasCookie, true);
  transport.dropCookie();
  assert.equal(transport.hasCookie, false);
});

test("one 401 re-mints once and a second 401 surfaces", async () => {
  let mints = 0;
  let posts = 0;
  const fetchImpl = async (url, options) => {
    if (String(url).includes("?token=")) {
      mints += 1;
      return response({ status: 303, headers: { "set-cookie": `dsh-auth-x=v${mints}; Path=/` } });
    }
    posts += 1;
    if (posts === 1) return response({ ok: false, status: 401 });
    return response({ json: { type: "server-response", rpcId: JSON.parse(options.body).rpcId, result: { ok: true, value: 1 } } });
  };
  const transport = createRemoteTransport({
    baseUrl: "http://127.0.0.1:3080",
    fetchImpl,
    getLaunchBrowserUrl: () => "http://127.0.0.1:3080/?token=t",
  });
  assert.equal(await transport.call("session/list", {}), 1);
  assert.equal(mints, 2, "initial mint plus exactly one retry mint");
  assert.equal(posts, 2);
});

test("envelope violations surface instead of returning garbage", async () => {
  const good = (rpcId, result) => response({ json: { type: "server-response", rpcId, result } });
  const base = {
    baseUrl: "http://127.0.0.1:3080",
    getLaunchBrowserUrl: () => "http://127.0.0.1:3080/?token=t",
  };
  const minting = (impl) => createRemoteTransport({ ...base, fetchImpl: impl });
  const authed = (impl) => async (url, options) => {
    if (String(url).includes("?token=")) return response({ status: 303, headers: { "set-cookie": "c=v; Path=/" } });
    return impl(url, options);
  };
  await assert.rejects(
    minting(authed(async (url, options) => response({ json: { type: "server-response", rpcId: "other", result: { ok: true, value: 1 } } }))).call("session/list", {}),
    /rpcId mismatch/,
  );
  await assert.rejects(
    minting(authed(async (url, options) => {
      const parsed = JSON.parse(options.body);
      return response({ json: { type: "server-response", rpcId: parsed.rpcId, result: { ok: false, error: { message: "nope" } } } });
    })).call("session/list", {}),
    /nope/,
  );
  await assert.rejects(
    minting(authed(async () => response({ ok: false, status: 500 }))).call("session/list", {}, 50),
    /Harness HTTP 500/,
  );
  await assert.rejects(
    createRemoteTransport({ ...base, getLaunchBrowserUrl: () => "" }).call("session/list", {}),
    /launch URL is unknown/,
  );
});

test("pasted launch URLs accept the banner URL or a bare token", () => {
  assert.equal(
    normalizeHarnessLaunchUrl("dsh web: http://127.0.0.1:3080/?launchToken=abc".replace(/^dsh web: /, "")),
    "http://127.0.0.1:3080/?launchToken=abc",
  );
  assert.equal(
    normalizeHarnessLaunchUrl("  http://127.0.0.1:3080/?launchToken=abc#frag  "),
    "http://127.0.0.1:3080/?launchToken=abc",
  );
  assert.equal(
    normalizeHarnessLaunchUrl("abcDEF-123_456", "http://127.0.0.1:3080"),
    "http://127.0.0.1:3080/?launchToken=abcDEF-123_456",
  );
  assert.throws(() => normalizeHarnessLaunchUrl(""), /Paste the Harness launch URL/);
  assert.throws(() => normalizeHarnessLaunchUrl("not a url with spaces"), /not a valid Harness launch URL/);
  assert.throws(() => normalizeHarnessLaunchUrl("ftp://127.0.0.1:3080/x"), /must be http/);
});
