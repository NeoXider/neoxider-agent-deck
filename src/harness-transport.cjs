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
  // One shared mint: after a restart every surface (dashboard, history, models,
  // commands, queue) fires at once with no cookie, and N parallel token
  // exchanges are exactly the stampede that makes some of them fail.
  let mintPromise = null;

  async function ensureCookie() {
    if (cookie) return cookie;
    if (!mintPromise) {
      mintPromise = (async () => {
        try {
          const launchUrl = typeof getLaunchBrowserUrl === "function" ? getLaunchBrowserUrl() : "";
          // The launch URL can come from the settings file, which anything with disk
          // access can write; never send the exchange anywhere but the configured Harness.
          if (launchUrl && !isSameHarnessOrigin(launchUrl, root)) {
            throw new Error("Harness launch URL does not point at the configured Harness address");
          }
          cookie = await mintBrowserCookie(launchUrl, fetchImpl);
          return cookie;
        } finally {
          mintPromise = null;
        }
      })();
    }
    return mintPromise;
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

  // The mux WebSocket carries the same browser-session cookie as the unary
  // calls; minting happens lazily on first use of either surface.
  async function ensureAuthenticated() {
    await ensureCookie();
  }

  // One multiplexed stream over /api/remote.mux. Each channel owns its socket so a
  // dead or wedged stream can never leak frames into another; the server still routes
  // by streamId and we enforce that on receive as well. The promise settles when the
  // open frame is sent; handle.closed resolves (with an Error, if any) when the stream
  // ends for whatever reason.
  function openChannel({ endpoint, args = {}, onFrame = () => {} }) {
    return ensureCookie().then((sessionCookie) => new Promise((resolve, reject) => {
      const WebSocketImpl = globalThis.WebSocket;
      if (typeof WebSocketImpl !== "function") {
        reject(new Error("Harness WebSocket is unavailable"));
        return;
      }
      const streamId = randomUUID();
      let socket;
      let resolved = false;
      let rejected = false;
      let ended = false;
      let closeResolve;
      const closed = new Promise((r) => { closeResolve = r; });

      function end(error) {
        if (ended) return;
        ended = true;
        clearTimeout(openTimer);
        try { socket?.removeAllListeners(); } catch {}
        try { socket?.close(); } catch {}
        closeResolve(error);
      }

      function fail(error) {
        if (resolved || rejected) return;
        rejected = true;
        end(error);
      }

      const url = new URL("/api/remote.mux", root);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      const openTimer = setTimeout(() => fail(new Error(`Harness ${endpoint} open timed out`)), 8000);

      try {
        socket = new WebSocketImpl(url.href, { headers: { cookie: sessionCookie } });
      } catch (error) {
        clearTimeout(openTimer);
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }

      socket.addEventListener("open", () => {
        try {
          socket.send(JSON.stringify({ type: "open", streamId, endpoint, payload: { args } }));
          resolved = true;
          resolve({
            close() {
              if (ended) return;
              try { socket.send(JSON.stringify({ type: "close", streamId })); } catch {}
              end();
            },
            get closed() { return closed; },
          });
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)));
        }
      });
      socket.addEventListener("message", (event) => {
        let frame;
        try { frame = JSON.parse(String(event.data)); } catch { return; }
        if (!frame || frame.streamId !== streamId) return;
        if (frame.type === "error") {
          const error = new Error(`Harness ${endpoint}: ${JSON.stringify(frame.error ?? {})}`);
          if (resolved) end(error); else fail(error);
          return;
        }
        // A throw from the publisher chain would escape into the WebSocket's event
        // dispatch, where nothing catches it; one bad frame must not take the stream down.
        try {
          onFrame(frame.value);
        } catch (error) {
          console.error(`Harness ${endpoint} frame handler failed`, error);
        }
      });
      socket.addEventListener("close", () => {
        if (!resolved) fail(new Error(`Harness ${endpoint} closed`));
        else end();
      });
      socket.addEventListener("error", () => { if (!resolved) fail(new Error(`Harness ${endpoint} failed to open`)); });
    }));
  }

  return {
    kind: "remote",
    detect: (fetchOverride) => detectGeneration(root, fetchOverride ?? fetchImpl),
    call,
    cookie: () => cookie,
    ensureAuthenticated,
    openChannel,
    dropCookie() {
      cookie = "";
    },
    get hasCookie() {
      return cookie !== "";
    },
  };
}

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

// Whether a launch URL belongs to the configured Harness. The launch URL is handed to
// the OS shell and used for the token exchange, and it can be planted in the settings
// file, so only the configured origin is trusted. Loopback names are one host here:
// dsh always prints its banner as http://127.0.0.1:<port> — even when bound to ::1 —
// while the widget may be configured with localhost, and a strict origin match would
// reject the very URL the Harness terminal shows.
function isSameHarnessOrigin(value, baseUrl) {
  let candidate;
  let base;
  try {
    candidate = new URL(String(value));
    base = new URL(String(baseUrl));
  } catch {
    return false;
  }
  if (!["http:", "https:"].includes(candidate.protocol)) return false;
  if (candidate.protocol !== base.protocol || candidate.port !== base.port) return false;
  if (candidate.username || candidate.password) return false;
  const host = candidate.hostname.toLowerCase();
  const expected = base.hostname.toLowerCase();
  return host === expected || (LOOPBACK_HOSTNAMES.has(host) && LOOPBACK_HOSTNAMES.has(expected));
}

// What the user pastes from the terminal that runs Harness: either the full
// `dsh web: http://127.0.0.1:3080/?token=…` URL or the bare token. A bare
// token is resolved against the configured Harness address. The query key is
// `token`: that is what the server's launch-token exchange reads (TOKEN_QUERY).
// Anything that is neither throws, so the offline banner can say why instead
// of failing later inside the cookie exchange with a bare network error. A URL for
// any other host is refused: see isSameHarnessOrigin.
function normalizeHarnessLaunchUrl(value, baseUrl = "http://127.0.0.1:3080") {
  const text = String(value || "").trim();
  if (!text) throw new Error("Paste the Harness launch URL first");
  if (!/[:/\s]/.test(text)) {
    if (!/^[A-Za-z0-9_-]{8,256}$/.test(text)) throw new Error("That does not look like a Harness launch token");
    return `${String(baseUrl).replace(/\/$/, "").split("?")[0]}/?token=${encodeURIComponent(text)}`;
  }
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error("That is not a valid Harness launch URL");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("The Harness launch URL must be http(s)");
  if (!isSameHarnessOrigin(url.href, baseUrl)) {
    let expected = String(baseUrl);
    try { expected = new URL(String(baseUrl)).origin; } catch {}
    throw new Error(`The Harness launch URL must point at the configured Harness (${expected})`);
  }
  url.hash = "";
  return url.href;
}

module.exports = {
  GATED_BODY_MARKER,
  createRemoteTransport,
  detectGeneration,
  isSameHarnessOrigin,
  mintBrowserCookie,
  normalizeHarnessLaunchUrl,
};
