const path = require("node:path");
const { spawn: spawnProcess } = require("node:child_process");
const { existsSync } = require("node:fs");

const {
  CAPABILITIES,
  GameBarProtocolError,
  MAX_FRAME_BYTES,
  PROTOCOL_VERSION,
  commandErrorFrame,
  createRequestIdTracker,
  decodeFrame,
  encodeFrame,
} = require("./gamebar-protocol.cjs");
const { createGameBarSnapshotState } = require("./gamebar-snapshot.cjs");

const HOST_EXE = "NeoXiderAgentDeck.BridgeHost.exe";
const DEFAULT_POLL_MS = 2_500;
const DEFAULT_MAX_INFLIGHT = 16;
const DEFAULT_DASHBOARD_CACHE_MS = 1_000;
const DEFAULT_REPROBE_MS = 30_000;
const DEFAULT_TERMINAL_EXIT_GRACE_MS = 1_000;
const DEFAULT_MAX_QUEUED_BYTES = MAX_FRAME_BYTES * 32;
const DEFAULT_RESTART_DELAYS = Object.freeze([250, 1_000, 2_500, 5_000, 10_000]);
const STABLE_PROCESS_MS = 30_000;

function readHarnessDashboard(api) {
  return Promise.resolve()
    .then(() => api.dashboard())
    .then((dashboard) => ({ ok: true, harness: true, ...dashboard }))
    .catch((error) => ({
      ok: false,
      harness: false,
      error: error instanceof Error ? error.message : String(error),
      sessions: [],
    }));
}

function createSharedDashboardReader({
  api,
  readDashboard = () => readHarnessDashboard(api),
  now = Date.now,
  cacheMs = DEFAULT_DASHBOARD_CACHE_MS,
} = {}) {
  if (typeof readDashboard !== "function" || typeof now !== "function"
    || !Number.isFinite(cacheMs) || cacheMs < 0) {
    throw new TypeError("Invalid shared dashboard reader options");
  }
  let cached = null;
  let cachedAt = -Infinity;
  let inflight = null;

  function offline(error) {
    return {
      ok: false,
      harness: false,
      error: error instanceof Error ? error.message : String(error),
      sessions: [],
    };
  }

  function read() {
    const timestamp = Number(now());
    if (!Number.isFinite(timestamp)) return Promise.resolve(offline(new Error("Dashboard clock is unavailable")));
    const cacheAge = timestamp - cachedAt;
    if (cached && cacheAge >= 0 && cacheAge <= cacheMs) return Promise.resolve(cached);
    if (inflight) return inflight;
    inflight = Promise.resolve()
      .then(readDashboard)
      .catch(offline)
      .then((dashboard) => {
        cached = dashboard && typeof dashboard === "object" && !Array.isArray(dashboard) && Array.isArray(dashboard.sessions)
          ? dashboard
          : offline(new Error("Dashboard response is invalid"));
        cachedAt = Number(now());
        if (!Number.isFinite(cachedAt)) cachedAt = timestamp;
        return cached;
      })
      .finally(() => { inflight = null; });
    return inflight;
  }

  return Object.freeze({ read });
}

function resolveGameBarBridgeHost({
  platform = process.platform,
  isPackaged = false,
  appPath = "",
  resourcesPath = process.resourcesPath || "",
  fileExists = existsSync,
} = {}) {
  if (platform !== "win32" || typeof fileExists !== "function") return null;
  const pathApi = path.win32;
  const candidates = isPackaged
    ? [pathApi.join(resourcesPath, "gamebar", HOST_EXE), pathApi.join(resourcesPath, HOST_EXE)]
    : [
      pathApi.join(appPath, "windows-gamebar", "NeoXiderAgentDeck.BridgeHost", "bin", "Release", "net9.0-windows10.0.19041.0", "win-x64", "publish", HOST_EXE),
      pathApi.join(appPath, "windows-gamebar", "NeoXiderAgentDeck.BridgeHost", "bin", "Release", "net9.0-windows10.0.19041.0", "win-x64", HOST_EXE),
      pathApi.join(appPath, "windows-gamebar", "NeoXiderAgentDeck.BridgeHost", "bin", "Debug", "net9.0-windows10.0.19041.0", "win-x64", HOST_EXE),
    ];
  return candidates.find((candidate) => {
    try { return fileExists(candidate); } catch { return false; }
  }) || null;
}

function createBoundedLineReader(onLine, onFailure) {
  let buffered = Buffer.alloc(0);
  let failed = false;
  return Object.freeze({
    push(chunk) {
      if (failed) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk || []);
      let offset = 0;
      while (offset < bytes.length) {
        const delimiter = bytes.indexOf(0x0a, offset);
        const end = delimiter < 0 ? bytes.length : delimiter + 1;
        const part = bytes.subarray(offset, end);
        if (buffered.length + part.length > MAX_FRAME_BYTES
          || (delimiter < 0 && buffered.length + part.length === MAX_FRAME_BYTES)) {
            failed = true;
            buffered = Buffer.alloc(0);
            onFailure(new GameBarProtocolError("oversized-frame"));
          return;
        }
        buffered = buffered.length ? Buffer.concat([buffered, part]) : Buffer.from(part);
        offset = end;
        if (delimiter < 0) return;
        const line = buffered;
        buffered = Buffer.alloc(0);
        onLine(line);
        if (failed) return;
      }
    },
    end() {
      if (!failed && buffered.length) onFailure(new GameBarProtocolError("invalid-frame"));
      buffered = Buffer.alloc(0);
    },
  });
}

function createGameBarController({
  platform = process.platform,
  smokeMode = false,
  isPackaged = false,
  appPath = "",
  resourcesPath = process.resourcesPath || "",
  version = "0.0.0",
  api,
  readDashboard = () => readHarnessDashboard(api),
  onOpenSession = () => {},
  spawn = spawnProcess,
  fileExists = existsSync,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  pollIntervalMs = DEFAULT_POLL_MS,
  maxInflight = DEFAULT_MAX_INFLIGHT,
  maxQueuedBytes = DEFAULT_MAX_QUEUED_BYTES,
  reprobeIntervalMs = DEFAULT_REPROBE_MS,
  terminalExitGraceMs = DEFAULT_TERMINAL_EXIT_GRACE_MS,
  restartDelays = DEFAULT_RESTART_DELAYS,
  snapshotState = createGameBarSnapshotState({ now }),
} = {}) {
  if (typeof readDashboard !== "function" || typeof onOpenSession !== "function"
    || typeof spawn !== "function" || typeof now !== "function"
    || typeof setTimer !== "function" || typeof clearTimer !== "function"
    || !Number.isFinite(pollIntervalMs) || pollIntervalMs < 1
    || !Number.isSafeInteger(maxInflight) || maxInflight < 1
    || !Number.isSafeInteger(maxQueuedBytes) || maxQueuedBytes < MAX_FRAME_BYTES
    || !Number.isFinite(reprobeIntervalMs) || reprobeIntervalMs < 1
    || !Number.isFinite(terminalExitGraceMs) || terminalExitGraceMs < 1
    || !Array.isArray(restartDelays) || restartDelays.some((delay) => !Number.isFinite(delay) || delay < 0)) {
    throw new TypeError("Invalid Game Bar controller options");
  }

  const enabled = platform === "win32" && !smokeMode;
  let executable = enabled ? resolveGameBarBridgeHost({ platform, isPackaged, appPath, resourcesPath, fileExists }) : null;
  const safeVersion = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/.test(String(version)) ? String(version) : "0.0.0";
  let child = null;
  let disposed = false;
  let started = false;
  let pollTimer = null;
  let pollingStarted = false;
  let restartTimer = null;
  let probeTimer = null;
  let terminalTimer = null;
  let terminalClosing = null;
  let restartAttempt = 0;
  let processStartedAt = 0;
  let pollBusy = false;
  let lastDashboard = { ok: false, harness: false, sessions: [] };
  let selectedSessionId = "";
  let handshaken = false;
  let processGeneration = 0;
  let requestIds = null;
  let inflight = 0;
  let writeChain = Promise.resolve();
  let queuedWriteBytes = 0;
  let transportCleanup = null;
  const drainWaiters = new Set();
  let status = enabled ? (executable ? "starting" : "host-missing") : "disabled";

  function schedule(callback, delay) {
    const timer = setTimer(callback, delay);
    timer?.unref?.();
    return timer;
  }

  function resetConnectionState() {
    handshaken = false;
    requestIds = null;
    inflight = 0;
  }

  function cancelDrainWaiters() {
    for (const cancel of [...drainWaiters]) cancel();
  }

  function detachTransport(expectedChild) {
    if (!transportCleanup || transportCleanup.child !== expectedChild) return;
    transportCleanup.dispose();
    transportCleanup = null;
  }

  function clearTerminalWait() {
    clearTimer(terminalTimer);
    terminalTimer = null;
    terminalClosing = null;
  }

  function terminateProcess(expectedChild = child, expectedGeneration = processGeneration) {
    if (!child || child !== expectedChild || processGeneration !== expectedGeneration) return false;
    const current = child;
    processGeneration += 1;
    child = null;
    resetConnectionState();
    clearTerminalWait();
    detachTransport(current);
    cancelDrainWaiters();
    try { current.kill(); } catch {}
    return true;
  }

  function transportFailed(expectedChild = child, expectedGeneration = processGeneration) {
    if (disposed || !child || expectedChild !== child || expectedGeneration !== processGeneration) return;
    status = "transport-error";
    terminateProcess(expectedChild, expectedGeneration);
    scheduleRestart();
  }

  function isCurrentProcess(expectedChild, expectedGeneration) {
    return !disposed && child === expectedChild && processGeneration === expectedGeneration;
  }

  function isWritableProcess(expectedChild, expectedGeneration) {
    return isCurrentProcess(expectedChild, expectedGeneration)
      && !(terminalClosing?.child === expectedChild && terminalClosing.generation === expectedGeneration);
  }

  function waitForProcessExit(expectedChild, expectedGeneration) {
    if (!isCurrentProcess(expectedChild, expectedGeneration)) return;
    cancelDrainWaiters();
    terminalClosing = { child: expectedChild, generation: expectedGeneration };
    if (terminalTimer) return;
    terminalTimer = schedule(() => {
      terminalTimer = null;
      terminalClosing = null;
      transportFailed(expectedChild, expectedGeneration);
    }, terminalExitGraceMs);
  }

  function waitForDrain(expectedChild, expectedGeneration) {
    return new Promise((resolve) => {
      let settled = false;
      const input = expectedChild?.stdin;
      function finish(value) {
        if (settled) return;
        settled = true;
        input?.removeListener?.("drain", onDrain);
        drainWaiters.delete(cancel);
        resolve(value);
      }
      function onDrain() {
        finish(isWritableProcess(expectedChild, expectedGeneration) && Boolean(input?.writable));
      }
      function cancel() { finish(false); }
      drainWaiters.add(cancel);
      input?.once?.("drain", onDrain);
      if (!isWritableProcess(expectedChild, expectedGeneration) || !input?.writable) finish(false);
    });
  }

  function queueFrames(frames, connection = { child, generation: processGeneration }) {
    let payload;
    try { payload = frames.map(encodeFrame).join(""); } catch { return Promise.resolve(false); }
    const payloadBytes = Buffer.byteLength(payload, "utf8");
    const expectedChild = connection.child;
    const expectedGeneration = connection.generation;
    if (!isWritableProcess(expectedChild, expectedGeneration)) return Promise.resolve(false);
    if (queuedWriteBytes + payloadBytes > maxQueuedBytes) {
      transportFailed(expectedChild, expectedGeneration);
      return Promise.resolve(false);
    }
    queuedWriteBytes += payloadBytes;
    const operation = writeChain.then(async () => {
      if (!isWritableProcess(expectedChild, expectedGeneration) || !expectedChild.stdin?.writable) return false;
      try {
        const accepted = expectedChild.stdin.write(payload, "utf8") !== false;
        return accepted || await waitForDrain(expectedChild, expectedGeneration);
      } catch {
        transportFailed(expectedChild, expectedGeneration);
        return false;
      }
    }).catch(() => {
      transportFailed(expectedChild, expectedGeneration);
      return false;
    }).finally(() => {
      queuedWriteBytes = Math.max(0, queuedWriteBytes - payloadBytes);
    });
    writeChain = operation;
    return operation;
  }

  function safeSession(sessionId) {
    try { return snapshotState.requireSession(sessionId); } catch { throw new GameBarProtocolError("invalid-field"); }
  }

  async function runCommand(frame, connection) {
    if (frame.command === "request-snapshot") {
      await queueFrames([
        { v: PROTOCOL_VERSION, type: "command.ok", requestId: frame.requestId },
        snapshotState.getSnapshot(),
      ], connection);
      return;
    }

    safeSession(frame.sessionId);
    if (frame.command === "ack") {
      const snapshot = snapshotState.ack(frame.sessionId);
      await queueFrames([
        { v: PROTOCOL_VERSION, type: "command.ok", requestId: frame.requestId },
        snapshot,
      ], connection);
      return;
    }
    if (frame.command === "open-session") {
      await onOpenSession(frame.sessionId);
    } else if (frame.command === "quick-reply") {
      await api.ensureFullAccess(frame.sessionId);
      await api.prompt(frame.sessionId, frame.text.trim(), Intl.DateTimeFormat().resolvedOptions().timeZone);
    }
    await queueFrames([{ v: PROTOCOL_VERSION, type: "command.ok", requestId: frame.requestId }], connection);
  }

  function rejectCommand(requestId, error, connection) {
    return queueFrames([commandErrorFrame(requestId, error)], connection);
  }

  function handleFrame(line, sourceChild, sourceGeneration) {
    if (!isWritableProcess(sourceChild, sourceGeneration)) return;
    let frame;
    try { frame = decodeFrame(line); } catch { transportFailed(sourceChild, sourceGeneration); return; }
    if (frame.type === "hello") {
      if (handshaken) {
        transportFailed(sourceChild, sourceGeneration);
        return;
      }
      handshaken = true;
      requestIds = createRequestIdTracker();
      inflight = 0;
      try { requestIds.accept(frame.requestId); } catch { transportFailed(sourceChild, sourceGeneration); return; }
      status = "connected";
      queueFrames([{
        v: PROTOCOL_VERSION,
        type: "hello.ok",
        requestId: frame.requestId,
        serverVersion: safeVersion,
        capabilities: [...CAPABILITIES],
      }], { child: sourceChild, generation: sourceGeneration });
      return;
    }
    if (frame.type !== "command") { transportFailed(sourceChild, sourceGeneration); return; }
    const connection = { child: sourceChild, generation: sourceGeneration };
    if (!handshaken || !requestIds) {
      transportFailed(sourceChild, sourceGeneration);
      return;
    }
    try { requestIds.accept(frame.requestId); } catch (error) { rejectCommand(frame.requestId, error, connection); return; }
    if (inflight >= maxInflight) {
      rejectCommand(frame.requestId, new GameBarProtocolError("request-limit"), connection);
      return;
    }
    inflight += 1;
    Promise.resolve(runCommand(frame, connection)).catch((error) => rejectCommand(frame.requestId, error, connection)).finally(() => {
      if (isCurrentProcess(sourceChild, sourceGeneration)) inflight = Math.max(0, inflight - 1);
    });
  }

  function publishChanged(previous, next) {
    if (handshaken && next !== previous) queueFrames([next], { child, generation: processGeneration });
  }

  async function pollNow() {
    if (disposed || pollBusy) return snapshotState.getSnapshot();
    pollBusy = true;
    const previous = snapshotState.getSnapshot();
    try {
      try {
        lastDashboard = await readDashboard();
      } catch {
        lastDashboard = { ok: false, harness: false, sessions: [] };
      }
      const next = snapshotState.update(lastDashboard, selectedSessionId);
      publishChanged(previous, next);
      return next;
    } catch {
      lastDashboard = { ok: false, harness: false, sessions: [] };
      try {
        const next = snapshotState.update(lastDashboard, "");
        publishChanged(previous, next);
      } catch {}
      return snapshotState.getSnapshot();
    } finally {
      pollBusy = false;
    }
  }

  function schedulePoll() {
    if (disposed || !started || !enabled || !pollingStarted) return;
    pollTimer = schedule(async () => {
      pollTimer = null;
      try { await pollNow(); } finally { schedulePoll(); }
    }, pollIntervalMs);
  }

  function startPolling() {
    if (pollingStarted || disposed) return;
    pollingStarted = true;
    void pollNow().then(schedulePoll, schedulePoll);
  }

  function stopPolling() {
    pollingStarted = false;
    clearTimer(pollTimer);
    pollTimer = null;
  }

  function scheduleRestart() {
    if (disposed || !started || !enabled || restartTimer || probeTimer || child) return;
    if (restartAttempt >= restartDelays.length) {
      status = "restart-limit";
      scheduleProbe();
      return;
    }
    const delay = restartDelays[restartAttempt++];
    status = "restarting";
    restartTimer = schedule(() => {
      restartTimer = null;
      launch();
    }, delay);
  }

  function scheduleProbe() {
    if (disposed || !started || !enabled || probeTimer || restartTimer || child) return;
    probeTimer = schedule(() => {
      probeTimer = null;
      restartAttempt = 0;
      launch();
    }, reprobeIntervalMs);
  }

  function launch() {
    if (disposed || child || !enabled) return;
    executable = resolveGameBarBridgeHost({ platform, isPackaged, appPath, resourcesPath, fileExists });
    if (!executable) {
      status = "host-missing";
      stopPolling();
      scheduleProbe();
      return;
    }
    let launched;
    try {
      launched = spawn(executable, [], { cwd: path.dirname(executable), windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"] });
    } catch {
      status = "spawn-error";
      scheduleRestart();
      return;
    }
    child = launched;
    processGeneration += 1;
    const launchedGeneration = processGeneration;
    processStartedAt = Number(now());
    resetConnectionState();
    status = "waiting-for-widget";
    startPolling();
    const reader = createBoundedLineReader(
      (line) => handleFrame(line, launched, launchedGeneration),
      () => transportFailed(launched, launchedGeneration),
    );
    const fail = () => transportFailed(launched, launchedGeneration);
    const onStdoutData = (chunk) => reader.push(chunk);
    const onStdoutEnd = () => { reader.end(); waitForProcessExit(launched, launchedGeneration); };
    const onStdinClose = () => waitForProcessExit(launched, launchedGeneration);
    const onExit = (code) => {
      if (!isCurrentProcess(launched, launchedGeneration)) return;
      processGeneration += 1;
      child = null;
      resetConnectionState();
      clearTerminalWait();
      detachTransport(launched);
      cancelDrainWaiters();
      if (disposed) return;
      if (code === 3) {
        status = "widget-package-missing";
        stopPolling();
        lastDashboard = { ok: false, harness: false, sessions: [] };
        snapshotState.update(lastDashboard, "");
        scheduleProbe();
        return;
      }
      const uptime = Number(now()) - processStartedAt;
      if (code === 0 || (Number.isFinite(uptime) && uptime >= STABLE_PROCESS_MS)) restartAttempt = 0;
      status = "stopped";
      scheduleRestart();
    };
    const listeners = [
      [launched.stdout, "data", onStdoutData],
      [launched.stdout, "end", onStdoutEnd],
      [launched.stdout, "error", fail],
      [launched.stderr, "data", () => {}],
      [launched.stderr, "error", fail],
      [launched.stdin, "error", fail],
      [launched.stdin, "close", onStdinClose],
      [launched, "error", fail],
      [launched, "exit", onExit],
    ].filter(([emitter]) => emitter?.on);
    for (const [emitter, event, listener] of listeners) emitter.on(event, listener);
    transportCleanup = {
      child: launched,
      dispose() {
        for (const [emitter, event, listener] of listeners) emitter.removeListener(event, listener);
      },
    };
  }

  function start() {
    if (started || disposed) return status;
    started = true;
    if (!enabled) return status;
    launch();
    return status;
  }

  function setSelectedSessionId(sessionId) {
    if (typeof sessionId !== "string" || !snapshotState.hasSession(sessionId)) return false;
    try {
      selectedSessionId = sessionId;
      const previous = snapshotState.getSnapshot();
      const next = snapshotState.update(lastDashboard, selectedSessionId);
      publishChanged(previous, next);
      return true;
    } catch { return false; }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    stopPolling();
    clearTimer(restartTimer);
    clearTimer(probeTimer);
    restartTimer = null;
    probeTimer = null;
    terminateProcess();
    status = "disposed";
  }

  return Object.freeze({
    dispose,
    getExecutable: () => executable,
    getSnapshot: () => snapshotState.getSnapshot(),
    getStatus: () => status,
    pollNow,
    setSelectedSessionId,
    start,
  });
}

module.exports = {
  DEFAULT_DASHBOARD_CACHE_MS,
  DEFAULT_MAX_INFLIGHT,
  DEFAULT_MAX_QUEUED_BYTES,
  DEFAULT_POLL_MS,
  DEFAULT_REPROBE_MS,
  DEFAULT_TERMINAL_EXIT_GRACE_MS,
  HOST_EXE,
  createBoundedLineReader,
  createGameBarController,
  createSharedDashboardReader,
  readHarnessDashboard,
  resolveGameBarBridgeHost,
};
