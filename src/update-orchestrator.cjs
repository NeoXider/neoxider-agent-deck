const DEFAULT_INITIAL_DELAY_MS = 4_000;
const DEFAULT_INTERVAL_MS = 6 * 60 * 60_000;

function createUpdateOrchestrator({
  getService,
  initialDelayMs = DEFAULT_INITIAL_DELAY_MS,
  intervalMs = DEFAULT_INTERVAL_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  onError = () => {},
} = {}) {
  if (typeof getService !== "function") throw new TypeError("getService must be a function");
  if (!Number.isSafeInteger(initialDelayMs) || initialDelayMs < 0) throw new TypeError("initialDelayMs must be a non-negative safe integer");
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1) throw new TypeError("intervalMs must be a positive safe integer");

  let active = false;
  let timer = null;
  let operation = null;

  function schedule(delay) {
    if (!active || timer) return;
    timer = setTimer(() => {
      timer = null;
      checkAndStage().catch(onError);
    }, delay);
    timer?.unref?.();
  }

  function checkAndStage() {
    if (active && timer) {
      clearTimer(timer);
      timer = null;
    }
    if (operation) return operation;

    const task = Promise.resolve().then(async () => {
      const service = getService();
      if (!service) return null;
      const result = await service.check();
      return result?.status === "available" && ["portable-replace", "managed"].includes(result.installMode)
        ? service.download()
        : result || null;
    }).finally(() => {
      if (operation === task) operation = null;
      schedule(intervalMs);
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
  createUpdateOrchestrator,
};
