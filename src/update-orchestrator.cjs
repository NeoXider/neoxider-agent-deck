const DEFAULT_INITIAL_DELAY_MS = 4_000;
const DEFAULT_INTERVAL_MS = 2 * 60 * 60_000;
const DEFAULT_TICK_MS = 10 * 60_000;
const DEFAULT_STUCK_MS = 45 * 60_000;

// When Deck looks for a release. It used to be one timer, re-armed for six hours after each
// check. Timers count the time the machine is awake, so on a computer that sleeps every night
// "six hours" stretched into days: an installed 1.1.3 that had been running for two days had
// not looked once since three releases came out. Now a short tick compares the wall clock
// with the last check, so the first tick after a wake checks if the interval has passed. A
// check or download that never settles is let go after a while instead of holding every
// later one back.
function createUpdateOrchestrator({
  getService,
  initialDelayMs = DEFAULT_INITIAL_DELAY_MS,
  intervalMs = DEFAULT_INTERVAL_MS,
  tickMs = DEFAULT_TICK_MS,
  stuckMs = DEFAULT_STUCK_MS,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  onError = () => {},
} = {}) {
  if (typeof getService !== "function") throw new TypeError("getService must be a function");
  if (!Number.isSafeInteger(initialDelayMs) || initialDelayMs < 0) throw new TypeError("initialDelayMs must be a non-negative safe integer");
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1) throw new TypeError("intervalMs must be a positive safe integer");
  if (!Number.isSafeInteger(tickMs) || tickMs < 1) throw new TypeError("tickMs must be a positive safe integer");

  let active = false;
  let timer = null;
  let operation = null;
  let operationStartedAt = 0;
  let lastCheckAt = -Infinity;

  function schedule(delay) {
    if (!active || timer) return;
    timer = setTimer(() => {
      timer = null;
      tick();
    }, delay);
    timer?.unref?.();
  }

  function tick() {
    const at = now();
    if (operation && at - operationStartedAt >= stuckMs) operation = null;
    if (!operation && at - lastCheckAt >= intervalMs) checkAndStage().catch(onError);
    schedule(tickMs);
  }

  function checkAndStage() {
    if (operation) return operation;
    lastCheckAt = now();
    operationStartedAt = lastCheckAt;
    const task = Promise.resolve().then(async () => {
      const service = getService();
      if (!service) return null;
      const result = await service.check();
      return result?.status === "available" && ["portable-replace", "managed"].includes(result.installMode)
        ? service.download()
        : result || null;
    }).finally(() => {
      if (operation === task) operation = null;
    });
    operation = task;
    return task;
  }

  function start() {
    if (active) return false;
    active = true;
    schedule(initialDelayMs);
    return true;
  }

  function stop() {
    active = false;
    if (timer) clearTimer(timer);
    timer = null;
  }

  return Object.freeze({ checkAndStage, start, stop });
}

module.exports = {
  DEFAULT_INITIAL_DELAY_MS,
  DEFAULT_INTERVAL_MS,
  DEFAULT_STUCK_MS,
  DEFAULT_TICK_MS,
  createUpdateOrchestrator,
};
