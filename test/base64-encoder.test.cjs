const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");

const { createBase64Encoder, defaultWorkerCount, encodeInlineFromDisk } = require("../src/base64-encoder.cjs");

// A worker that never leaves this thread. The pool's interesting behaviour is all in what
// it does when a thread misbehaves — dies on load, dies mid-job, answers late — and none of
// that is reproducible by spawning a real one and hoping.
function fakeWorker() {
  const worker = new EventEmitter();
  worker.sent = [];
  worker.terminated = 0;
  worker.postMessage = (message) => worker.sent.push(message);
  worker.terminate = () => { worker.terminated += 1; };
  worker.ref = () => {};
  worker.unref = () => {};
  worker.reply = (data) => worker.emit("message", { id: worker.sent.at(-1).id, data });
  worker.fail = (message) => worker.emit("message", { id: worker.sent.at(-1).id, error: message });
  return worker;
}

function fakePool(overrides = {}) {
  const created = [];
  const timers = [];
  const encoder = createBase64Encoder({
    strategy: "worker",
    createWorker: () => {
      const worker = fakeWorker();
      created.push(worker);
      return worker;
    },
    encodeInline: async (filePath) => `inline:${filePath}`,
    setTimer: (fn) => { timers.push(fn); return { unref() {} }; },
    clearTimer: () => {},
    onDegrade: () => {},
    ...overrides,
  });
  return { encoder, created, timers };
}

const settled = () => new Promise((resolve) => setImmediate(resolve));

test("the default strategy stays on this thread and spawns nothing", async () => {
  // The default is a measured choice, not an oversight: moving the encode to a worker made
  // the main thread block *more*, because the 11 MB result has to be copied back. If this
  // ever flips to spawning by default it should be because a number changed.
  let spawned = 0;
  const encoder = createBase64Encoder({
    createWorker: () => { spawned += 1; return fakeWorker(); },
    encodeInline: async (filePath, maxBytes) => `inline:${filePath}:${maxBytes}`,
  });

  assert.equal(await encoder.encodeFile("/tmp/a.png", 99), "inline:/tmp/a.png:99");
  assert.equal(spawned, 0);
  assert.equal(encoder.stats().workers, 0);
});

test("an unrecognised strategy falls back to the thing that always works", async () => {
  // A typo in an env var must not throw while the user is attaching a photo.
  let spawned = 0;
  const encoder = createBase64Encoder({
    strategy: "wroker",
    createWorker: () => { spawned += 1; return fakeWorker(); },
    encodeInline: async () => "inline",
  });
  assert.equal(await encoder.encodeFile("/tmp/a.png"), "inline");
  assert.equal(spawned, 0);
});

test("the worker strategy hands the path over and resolves with the reply", async () => {
  const { encoder, created } = fakePool();
  const pending = encoder.encodeFile("/tmp/a.png", 512);
  await settled();

  assert.equal(created.length, 1);
  assert.deepEqual(created[0].sent, [{ id: 1, filePath: "/tmp/a.png", maxBytes: 512 }]);
  created[0].reply("QUJD");
  assert.equal(await pending, "QUJD");
});

test("a burst is capped at the pool ceiling and the rest queues", async () => {
  // Twelve threads for twelve attachments would mean twelve simultaneous 8 MB reads for no
  // gain: base64 is bandwidth bound, not compute bound.
  const { encoder, created } = fakePool({ maxWorkers: 2 });
  const files = ["a", "b", "c", "d"].map((name) => `/tmp/${name}.png`);
  const pending = Promise.all(files.map((file) => encoder.encodeFile(file)));
  await settled();

  assert.equal(created.length, 2);
  assert.equal(encoder.stats().queued, 2);
  created[0].reply("A");
  created[1].reply("B");
  await settled();
  // The freed workers pick up the queue rather than new threads being spawned.
  assert.equal(created.length, 2);
  created[0].reply("C");
  created[1].reply("D");
  assert.deepEqual(await pending, ["A", "B", "C", "D"]);
});

test("a worker that cannot start degrades the whole pool to inline encoding", async () => {
  // The realistic cause is a packaging mistake that leaves the worker entry unreachable.
  // Losing every image attachment would be a far worse regression than the stall the pool
  // was meant to remove, so the pool gives up on itself rather than on the user's files.
  const reported = [];
  const encoder = createBase64Encoder({
    strategy: "worker",
    createWorker: () => { throw new Error("MODULE_NOT_FOUND"); },
    encodeInline: async (filePath) => `inline:${filePath}`,
    onDegrade: (error) => reported.push(error.message),
  });

  assert.equal(await encoder.encodeFile("/tmp/a.png"), "inline:/tmp/a.png");
  assert.equal(await encoder.encodeFile("/tmp/b.png"), "inline:/tmp/b.png");
  assert.deepEqual(reported, ["MODULE_NOT_FOUND"]);
  assert.equal(encoder.stats().degraded, true);
});

test("a worker that dies before finishing anything is treated as a load failure", async () => {
  const { encoder, created } = fakePool();
  const pending = encoder.encodeFile("/tmp/a.png");
  await settled();
  created[0].emit("error", new Error("worker boot failed"));

  assert.equal(await pending, "inline:/tmp/a.png");
  assert.equal(encoder.stats().degraded, true);
});

test("a worker that dies mid-job after working is replaced and the job retried", async () => {
  const { encoder, created } = fakePool();
  const first = encoder.encodeFile("/tmp/a.png");
  await settled();
  created[0].reply("A");
  assert.equal(await first, "A");

  const second = encoder.encodeFile("/tmp/b.png");
  await settled();
  created[0].emit("exit", 1);
  await settled();

  // A thread that had been healthy is worth replacing; the file is not re-read on the main
  // thread just because one worker crashed.
  assert.equal(encoder.stats().degraded, false);
  assert.equal(created.length, 2);
  assert.deepEqual(created[1].sent, [{ id: 1, filePath: "/tmp/b.png", maxBytes: 0 }]);
  created[1].reply("B");
  assert.equal(await second, "B");
});

test("a reply that arrives for an abandoned job is discarded", async () => {
  const { encoder, created } = fakePool();
  const pending = encoder.encodeFile("/tmp/a.png");
  await settled();
  const worker = created[0];
  // An id from a job this worker already answered: without the check it would resolve
  // whichever job happens to be occupying the slot now, with someone else's bytes.
  worker.emit("message", { id: 99, data: "WRONG" });
  worker.reply("RIGHT");
  assert.equal(await pending, "RIGHT");
});

test("an error reply rejects that file only", async () => {
  const { encoder, created } = fakePool();
  const failing = encoder.encodeFile("/tmp/locked.png");
  await settled();
  created[0].fail("EACCES: permission denied");
  await assert.rejects(failing, /EACCES/);

  // The worker is still in the pool and still usable.
  const next = encoder.encodeFile("/tmp/ok.png");
  await settled();
  created[0].reply("OK");
  assert.equal(await next, "OK");
  assert.equal(created.length, 1);
});

test("an idle pool retires its threads instead of holding isolates open", async () => {
  const { encoder, created, timers } = fakePool();
  const pending = encoder.encodeFile("/tmp/a.png");
  await settled();
  created[0].reply("A");
  await pending;

  assert.equal(encoder.stats().workers, 1);
  timers.at(-1)();
  assert.equal(encoder.stats().workers, 0);
  assert.equal(created[0].terminated, 1);
});

test("shutdown terminates every thread and strands nothing", async () => {
  const { encoder, created } = fakePool({ maxWorkers: 1 });
  const inFlight = encoder.encodeFile("/tmp/a.png");
  await settled();
  const stillQueued = encoder.encodeFile("/tmp/b.png");
  assert.equal(encoder.stats().queued, 1);
  encoder.shutdown();

  assert.equal(created.every((worker) => worker.terminated === 1), true);
  assert.equal(encoder.stats().workers, 0);
  // Terminating a worker out from under its job used to leave a promise that never settled:
  // no error, no result, and a caller awaiting it forever. Both halves have to be rescued.
  assert.equal(await inFlight, "inline:/tmp/a.png");
  assert.equal(await stillQueued, "inline:/tmp/b.png");
  assert.equal(await encoder.encodeFile("/tmp/c.png"), "inline:/tmp/c.png");
});

test("inline encoding refuses a file that outgrew its ceiling", async () => {
  const readFile = async () => Buffer.alloc(32);
  await assert.rejects(encodeInlineFromDisk("/tmp/a.png", 8, readFile), /grew past the 8 byte limit/);
  assert.equal(await encodeInlineFromDisk("/tmp/a.png", 64, readFile), Buffer.alloc(32).toString("base64"));
});

test("the pool is bounded and never smaller than one thread", () => {
  const count = defaultWorkerCount();
  assert.ok(count >= 1 && count <= 4, `expected 1..4 workers, got ${count}`);
});

test("a real worker thread encodes a real file", async (t) => {
  // Everything above uses a fake port, so exactly one test has to prove the entry point
  // actually loads and answers on a thread. That is the piece a packaging mistake breaks.
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agent-deck-b64-"));
  const file = path.join(directory, "sample.bin");
  const bytes = Buffer.from("the quick brown fox".repeat(1000));
  fs.writeFileSync(file, bytes);
  const encoder = createBase64Encoder({ strategy: "worker", maxWorkers: 1, idleTimeoutMs: 50 });
  t.after(() => {
    encoder.shutdown();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  assert.equal(await encoder.encodeFile(file, bytes.length), bytes.toString("base64"));
  // The same thread serves the second request; a fresh isolate per file is what the pool exists to avoid.
  assert.equal(await encoder.encodeFile(file, bytes.length), bytes.toString("base64"));
  assert.equal(encoder.stats().workers, 1);
  await assert.rejects(encoder.encodeFile(path.join(directory, "missing.bin"), 10), /ENOENT|no such file/);
});
