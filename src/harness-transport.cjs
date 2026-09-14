// Transport negotiation and authenticated calls for two Harness generations.
// - "legacy" (0.1.1 and older): unary POST /api/<dotted-method> with the
//   client-request envelope, no authentication.
// - "remote" (0.1.2 and newer): slash endpoints (session/list), arguments
//   wrapped as { args }, and the browser-session cookie the launch-token
//   exchange mints. The cookie is captured from a manual-redirect GET of the
//   owned launch URL, so the token never travels further than that one call.
//
// This module owns bytes on the wire only: endpoint names and argument shapes
// live in harness-api.cjs, which keeps speaking domain methods. Nothing here
// imports Electron; fetch and the launch-URL accessor are injected.

const { randomUUID } = require("node:crypto");

const GATED_BODY_MARKER = "dsh web authentication required";
const PROBE_TIMEOUT_MS = 1500;

// What the readiness probe already established: a gated index answers 401
// with a fixed body, an old one answers 200.
async function detectGeneration(baseUrl, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") return "down";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetchImpl(String(baseUrl).replace(/\/$/, ""), {
      method: "GET",
      signal: controller.signal,
    });
    if (response?.ok) return "legacy";
    if (response?.status === 401) {
      const body = await response.text().catch(() => "");
      if (String(body).includes(GATED_BODY_MARKER)) return "gated";
    }
    return "down";
  } catch {
    return "down";
  } finally {
    clearTimeout(timer);
  }
}

function firstSetCookie(headers) {
  const all = typeof headers?.getSetCookie === "function" ? headers.getSetCookie() : [];
  const raw = all.length > 0 ? all : [headers?.get?.("set-cookie")];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const pair = entry.split(";", 1)[0].trim();
    if (pair.includes("=")) return pair;
  }
  return "";
}

// Exchange the owned launch URL for one browser-session cookie. The fetch
// must NOT follow the 303: following it replays the request without a jar,
// the Set-Cookie lands nowhere, and the second hop 401s.
async function mintBrowserCookie(launchBrowserUrl, fetchImpl = globalThis.fetch) {
  const url = String(launchBrowserUrl || "").trim();
  if (!url) throw new Error("Harness launch URL is unknown; cannot mint a browser cookie");
  if (typeof fetchImpl !== "function") throw new Error("Harness fetch is unavailable");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetchImpl(url, { method: "GET", redirect: "manual", signal: controller.signal });
    const cookie = firstSetCookie(response?.headers);
    if (!cookie) throw new Error(`Harness token exchange returned ${response?.status ?? "?"} without a session cookie`);
    return cookie;
  } finally {
    clearTimeout(timer);
  }
}

function checkEnvelope(envelope, rpcId, endpoint) {
  if (!envelope || envelope.rpcId !== rpcId) {
    throw new Error(`Harness rpcId mismatch for ${endpoint}`);
  }
  const result = envelope.result;
  if (!result || !result.ok) {
    const error = result && result.error;
    throw new Error(error && error.message ? error.message : `Harness rejected ${endpoint}`);
  }
  return result.value;
}

function createRemoteTransport({ baseUrl = "http://127.0.0.1:3080", fetchImpl = globalThis.fetch, getLaunchBrowserUrl = () => "" } = {}) {
  const root = String(baseUrl).replace(/\/$/, "").split("?")[0];
  let cookie = "";

  async function ensureCookie() {
    if (cookie) return cookie;
    const launchUrl = typeof getLaunchBrowserUrl === "function" ? getLaunchBrowserUrl() : "";
    cookie = await mintBrowserCookie(launchUrl, fetchImpl);
    return cookie;
  }

  async function post(endpoint, args, timeoutMs) {
    const rpcId = randomUUID();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${root}/api/${endpoint}`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ type: "client-request", rpcId, method: endpoint, payload: { args } }),
        signal: controller.signal,
      });
      return { response, rpcId };
    } finally {
      clearTimeout(timer);
    }
  }

  async function call(endpoint, args = {}, timeoutMs = 8000) {
    await ensureCookie();
    let attempt = await post(endpoint, args, timeoutMs);
    if (attempt.response.status === 401) {
      // The cookie died (server restart mints nothing new, but a rotated or
      // cleared credential store invalidates old ones): mint once and retry
      // exactly once rather than looping against a broken exchange.
      cookie = "";
      await ensureCookie();
      attempt = await post(endpoint, args, timeoutMs);
    }
    const response = attempt.response;
    if (!response.ok) throw new Error(`Harness HTTP ${response.status}`);
    return checkEnvelope(await response.json(), attempt.rpcId, endpoint);
  }

  return {
    kind: "remote",
    detect: (fetchOverride) => detectGeneration(root, fetchOverride ?? fetchImpl),
    call,
    dropCookie() {
      cookie = "";
    },
    get hasCookie() {
      return cookie !== "";
    },
  };
}

module.exports = {
  GATED_BODY_MARKER,
  createRemoteTransport,
  detectGeneration,
  mintBrowserCookie,
};
