// Where base64-encoding of attachment bytes happens, and the evidence for that choice.
//
// The premise of the change was that `buffer.toString("base64")` is a synchronous C++ call
// that owns the main thread for its whole duration, and that twelve 8 MB images is ~100 MB
// of it on the one thread that paints the window. That much is true. What was not true is
// that a worker thread fixes it.
//
// MEASURED, twelve 8 MB files, warm page cache, 16-core Windows box, 9 runs each, medians,
// via `npm run bench:encoding` (probe: a self-rescheduling setImmediate, see the script):
//
//   strategy                      longest stall   total blocked   wall
//   inline (this default)              14.8 ms         32.5 ms    53.5 ms
//   worker pool, string reply          10-25 ms        43-48 ms   61-71 ms
//   worker pool, SharedArrayBuffer     16-21 ms        21-48 ms   68-72 ms
//   inline, sliced + yielded           13.6-16.1 ms    61-67 ms   85-96 ms
//
// WHY THE WORKER LOSES. The main thread has to end up holding an 11 MB base64 string
// either way, and *creating* that string is the whole cost — encoding 8 MB of bytes runs at
// about memcpy speed in V8. Measured separately: encode 8 MB -> 2.0 ms; latin1-decode the
// same 11 MB from shared memory -> 2.1 ms; structured-clone-deserialise it from a worker
// -> ~4 ms. So a worker does not remove the 2 ms, it replaces it with 4 ms of copying and
// adds message plumbing on top. Off-loading only pays when the output is much smaller than
// the work; base64 output is 1.33x the input.
//
// The sliced variant is a warning worth keeping: `out += chunk` looked like it halved the
// worst stall, but V8 was building a rope and the flattening had simply not happened yet
// inside the measurement window. Forcing the flatten with `parts.join("")` showed it was
// twice as expensive as doing nothing.
//
// So `inline` stays the default. The worker pool is kept, wired and tested rather than
// deleted, because the conclusion is hardware-dependent and a deleted branch cannot be
// re-measured. `DSH_WIDGET_B64_STRATEGY=worker` runs the app on the pool, and
// `npm run bench:encoding` compares the two on whatever machine it is run on.
//
// WHERE THE TIME ACTUALLY GOES (same box, same twelve files, measured under real Electron):
// `webContents.send` of the finished payload blocks main for ~80 ms, and the `JSON.stringify`
// that `harness-api` does at send time blocks it for another ~80 ms. Each of those is about
// 2.5x the entire encode. That is the gap worth opening next, and it is not a threading
// problem — it is that the full-resolution base64 crosses the process boundary twice.
//
// WHY A POOL AND NOT ONE-SHOT WORKERS, for the strategy that does exist:
//   - One-shot workers pay for a fresh V8 isolate every time, and part of that setup runs
//     on the calling thread — the exact thread this is supposed to protect. Twelve
//     attachments would pay it twelve times.
//   - An always-on pool is the other extreme: this app is idle almost all of the time, and
//     holding isolates open for a drag-and-drop that may never come is memory for nothing.
//   - So: lazy, bounded, self-retiring. Nothing spawns until the first image, a burst of
//     twelve reuses the same few threads, and the pool terminates itself once idle.
//   - Bounded at four because base64 is memory-bandwidth bound. Twelve threads would mean
//     twelve simultaneous 8 MB reads and 11 MB strings without encoding any faster.
//
// No Electron here, and everything that can fail is injected, so the pool's failure
// handling is a unit test rather than a hope.
const os = require("node:os");
const path = require("node:path");
const fsPromises = require("node:fs/promises");
const { Worker } = require("node:worker_threads");

const WORKER_ENTRY = path.join(__dirname, "base64-encoder.worker.cjs");
const IDLE_TIMEOUT_MS = 30_000;
const STRATEGIES = new Set(["inline", "worker"]);

function defaultWorkerCount() {
  const cores = typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
  return Math.max(1, Math.min(4, cores - 1));
}

// The caller has already stat'd the file and refused anything oversized. Re-checking the
// real length is not paranoia about the caller: between the stat and the read the file can
// be replaced, and an unbounded read is how a 4 GB video becomes an out-of-memory crash.
async function encodeInlineFromDisk(filePath, maxBytes = 0, readFile = fsPromises.readFile) {
  const buffer = await readFile(String(filePath));
  if (maxBytes > 0 && buffer.length > maxBytes) {
    throw new Error(`${filePath} grew past the ${maxBytes} byte limit while it was being read`);
  }
  return buffer.toString("base64");
}

function createBase64Encoder({
  strategy = "inline",
  createWorker = () => new Worker(WORKER_ENTRY),
  maxWorkers = defaultWorkerCount(),
  idleTimeoutMs = IDLE_TIMEOUT_MS,
  encodeInline = encodeInlineFromDisk,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  onDegrade = (error) => console.warn("Base64 worker unavailable; encoding on the main thread instead", error),
} = {}) {
  // An unknown strategy is a typo in a config or an env var, and the safe reading of a typo
  // is "do the thing that always works", not "throw while the user is attaching a photo".
  const useWorkers = STRATEGIES.has(strategy) ? strategy === "worker" : false;
  const handles = new Set();
  const idle = [];
  const busy = new Set();
  const queue = [];
  let retireTimer = null;
  let degraded = !useWorkers;
  let stopped = false;

  function degrade(error) {
    if (degraded) return;
    degraded = true;
    onDegrade(error);
    // Anything already queued has to go somewhere, and it cannot wait for a pool that is
    // never going to work.
    const stranded = queue.splice(0, queue.length);
    for (const job of stranded) encodeInline(job.filePath, job.maxBytes).then(job.resolve, job.reject);
  }

  function terminate(handle) {
    handles.delete(handle);
    const index = idle.indexOf(handle);
    if (index >= 0) idle.splice(index, 1);
    busy.delete(handle);
    try {
      handle.worker.terminate();
    } catch {
      // A worker that already exited is exactly the state we wanted.
    }
  }

  function scheduleRetire() {
    if (retireTimer) clearTimer(retireTimer);
    retireTimer = setTimer(() => {
      retireTimer = null;
      if (busy.size || queue.length) return;
      while (idle.length) terminate(idle[idle.length - 1]);
    }, idleTimeoutMs);
    // An idle pool must never be the reason a process stays alive.
    if (typeof retireTimer?.unref === "function") retireTimer.unref();
  }

  function settle(handle, job, outcome) {
    handle.job = null;
    busy.delete(handle);
    if (handles.has(handle)) {
      idle.push(handle);
      // Referenced only while a reply is outstanding: an idle thread should not hold the
      // process open, but a busy one must, or the reply is lost to an early exit.
      if (typeof handle.worker.unref === "function") handle.worker.unref();
    }
    if (outcome.error) job.reject(outcome.error);
    else job.resolve(outcome.data);
    if (queue.length) pump();
    else if (!busy.size) scheduleRetire();
  }

  function loseWorker(handle, error) {
    const job = handle.job;
    handle.job = null;
    const neverWorked = !handle.completed;
    terminate(handle);
    // A worker that died without ever finishing a job is almost always a load failure — a
    // missing entry point, an unreadable archive — and retrying buys nothing. A worker that
    // had been working is worth replacing, so the job goes back on the queue.
    if (neverWorked) degrade(error);
    if (job) {
      if (degraded) encodeInline(job.filePath, job.maxBytes).then(job.resolve, job.reject);
      else {
        queue.unshift(job);
        pump();
      }
    } else if (queue.length) pump();
  }

  function adopt(handle) {
    handle.worker.on("message", (reply) => {
      const job = handle.job;
      // A reply for a job we already gave up on belongs to nobody.
      if (!job || !reply || reply.id !== job.id) return;
      handle.completed = true;
      settle(handle, job, reply.error ? { error: new Error(reply.error) } : { data: reply.data });
    });
    handle.worker.on("error", (error) => loseWorker(handle, error));
    handle.worker.on("exit", () => {
      if (handles.has(handle)) loseWorker(handle, new Error("Base64 worker exited unexpectedly"));
    });
  }

  function takeWorker() {
    if (idle.length) return idle.pop();
    if (handles.size >= maxWorkers) return null;
    let handle;
    try {
      handle = { worker: createWorker(), job: null, nextId: 0, completed: false };
    } catch (error) {
      degrade(error);
      return null;
    }
    handles.add(handle);
    adopt(handle);
    return handle;
  }

  function pump() {
    while (queue.length && !degraded) {
      const handle = takeWorker();
      if (!handle) return;
      const job = queue.shift();
      handle.job = job;
      handle.nextId += 1;
      job.id = handle.nextId;
      busy.add(handle);
      if (typeof handle.worker.ref === "function") handle.worker.ref();
      try {
        handle.worker.postMessage({ id: job.id, filePath: job.filePath, maxBytes: job.maxBytes });
      } catch (error) {
        loseWorker(handle, error);
        return;
      }
    }
  }

  function encodeFile(filePath, maxBytes = 0) {
    if (degraded || stopped) return encodeInline(filePath, maxBytes);
    if (retireTimer) {
      clearTimer(retireTimer);
      retireTimer = null;
    }
    return new Promise((resolve, reject) => {
      queue.push({ filePath: String(filePath), maxBytes, resolve, reject, id: 0 });
      pump();
    });
  }

  function shutdown() {
    stopped = true;
    if (retireTimer) clearTimer(retireTimer);
    retireTimer = null;
    // Jobs already on a thread have to be rescued too, not just the ones still queued.
    // Terminating a worker out from under its job leaves a promise that never settles, and
    // an awaiting caller with no error and no result is the worst of both.
    const stranded = [];
    for (const handle of [...handles]) {
      if (handle.job) stranded.push(handle.job);
      handle.job = null;
      terminate(handle);
    }
    stranded.push(...queue.splice(0, queue.length));
    for (const job of stranded) encodeInline(job.filePath, job.maxBytes).then(job.resolve, job.reject);
  }

  // Only for tests and the bench: a pool whose whole point is to be invisible is also
  // impossible to assert on without a window into it.
  function stats() {
    return { workers: handles.size, idle: idle.length, busy: busy.size, queued: queue.length, degraded };
  }

  return { encodeFile, shutdown, stats };
}

module.exports = {
  IDLE_TIMEOUT_MS,
  STRATEGIES,
  WORKER_ENTRY,
  createBase64Encoder,
  defaultWorkerCount,
  encodeInlineFromDisk,
};
