import assert from "node:assert/strict";
import test from "node:test";
import { runBackgroundCode } from "./background-run.mjs";

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

class FakeJobs {
  constructor() {
    this.records = new Map();
    this.starts = [];
    this.kills = [];
  }

  start(spec) {
    const id = `code-${this.records.size + 1}`;
    const hooks = spec.run();
    const record = { id, spec, hooks, status: "running", output: "", reads: 0 };
    this.records.set(id, record);
    this.starts.push(spec);
    hooks.done.then((outcome) => Object.assign(record, outcome));
    return id;
  }

  async kill(id, owner, reason) {
    const record = this.records.get(id);
    assert.equal(record.spec.owner, owner);
    this.kills.push({ id, owner, reason });
    record.hooks.cancel(reason);
    await record.hooks.done;
  }
}

function fixture() {
  const injected = [];
  const deferred = [];
  const conclusions = [];
  const agent = { inject: (value) => injected.push(value) };
  const abort = new AbortController();
  return {
    abort,
    injected,
    deferred,
    conclusions,
    exec: {
      agent,
      signal: abort.signal,
      deferContext: (value) => deferred.push(value),
      concludeTurn: (...args) => conclusions.push(args),
    },
  };
}

test("fast execution returns the original value and runs once", async () => {
  const state = fixture();
  const jobs = new FakeJobs();
  const value = { logs: ["hello"], result: { answer: 42 } };
  let calls = 0;
  const actual = await runBackgroundCode({
    args: {}, exec: state.exec, jobs, yieldMs: 20,
    execute: async (_args, clone) => {
      calls += 1;
      clone.deferContext("fast-context");
      clone.concludeTurn("done");
      return value;
    },
  });
  assert.equal(actual, value);
  assert.equal(calls, 1);
  assert.deepEqual(state.deferred, ["fast-context"]);
  assert.deepEqual(state.conclusions, [["done"]]);
  assert.equal(jobs.starts.length, 0);
});

test("slow execution survives outer abort after handoff and injects contexts", async () => {
  const state = fixture();
  const jobs = new FakeJobs();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let detachedSignal;
  const response = await runBackgroundCode({
    args: {}, exec: state.exec, jobs, yieldMs: 1,
    execute: async (_args, clone) => {
      detachedSignal = clone.signal;
      clone.deferContext("before");
      await gate;
      clone.deferContext("after");
      clone.concludeTurn("must-be-ignored");
      return { logs: [], result: "complete" };
    },
  });
  assert.equal(response.result.status, "running");
  assert.deepEqual(state.injected, ["before"]);
  state.abort.abort(new Error("turn ended"));
  assert.equal(detachedSignal.aborted, false);
  release();
  await jobs.records.get("code-1").hooks.done;
  assert.deepEqual(state.injected, ["before", "after"]);
  assert.deepEqual(state.conclusions, []);
});

test("handoff targets the registry session id and rides the payload on result", async () => {
  const state = fixture();
  state.exec.agent.id = "sess-1";
  const jobs = new FakeJobs();
  // DSH 0.1.7+ resolves the start owner through the agent registry by
  // session id and reads a finished job's payload from `result`.
  jobs.resolveOwner = (session) => session;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const response = await runBackgroundCode({
    args: {}, exec: state.exec, jobs, yieldMs: 1,
    execute: async () => { await gate; return { logs: [], result: { answer: 1 } }; },
  });
  assert.equal(response.result.status, "running");
  assert.equal(jobs.records.get("code-1").spec.owner, "sess-1");
  release();
  const outcome = await jobs.records.get("code-1").hooks.done;
  assert.equal(outcome.status, "completed");
  assert.equal(outcome.result, outcome.output);
  assert.match(outcome.result, /"answer":1/);
});

test("foreground abort kills the job and rejects clearly", async () => {
  const state = fixture();
  const jobs = new FakeJobs();
  const promise = runBackgroundCode({
    args: {}, exec: state.exec, jobs, yieldMs: 100,
    execute: async (_args, clone) => new Promise((_, reject) => {
      clone.signal.addEventListener("abort", () => reject(clone.signal.reason), { once: true });
    }),
  });
  await delay(0);
  state.abort.abort({ code: "STOP", message: "cancelled by caller" });
  await assert.rejects(promise, /STOP|cancelled by caller/);
  assert.equal(jobs.starts.length, 0);
});

test("foreground abort awaits slow teardown instead of registering a job", async () => {
  const state = fixture();
  const jobs = new FakeJobs();
  let cleaned = false;
  let receivedReason;
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const promise = runBackgroundCode({
    args: {}, exec: state.exec, jobs, yieldMs: 1,
    execute: async (_args, clone) => new Promise((_, reject) => {
      markStarted();
      const stop = async () => {
        receivedReason = clone.signal.reason;
        await delay(10);
        cleaned = true;
        reject(clone.signal.reason);
      };
      if (clone.signal.aborted) void stop();
      else clone.signal.addEventListener("abort", stop, { once: true });
    }),
  });
  await started;
  state.abort.abort({ code: "STOP_OBJECT", detail: "structured reason" });
  await assert.rejects(promise, /STOP_OBJECT/);
  assert.ok(receivedReason instanceof Error);
  assert.match(receivedReason.message, /STOP_OBJECT/);
  assert.equal(cleaned, true);
  assert.equal(jobs.starts.length, 0);
});

test("job kill aborts execution and awaits teardown", async () => {
  const state = fixture();
  const jobs = new FakeJobs();
  let cleaned = false;
  let receivedReason;
  await runBackgroundCode({
    args: {}, exec: state.exec, jobs, yieldMs: 1,
    execute: async (_args, clone) => new Promise((_, reject) => {
      clone.signal.addEventListener("abort", async () => {
        receivedReason = clone.signal.reason;
        await delay(5);
        cleaned = true;
        reject(clone.signal.reason);
      }, { once: true });
    }),
  });
  await jobs.kill("code-1", state.exec.agent, "no longer needed");
  assert.equal(cleaned, true);
  assert.ok(receivedReason instanceof Error);
  assert.equal(receivedReason.message, "no longer needed");
  assert.equal(jobs.records.get("code-1").status, "killed");
});

test("fast failures are normalized without retaining a job", async () => {
  const state = fixture();
  const jobs = new FakeJobs();
  await assert.rejects(runBackgroundCode({
    args: {}, exec: state.exec, jobs, yieldMs: 20,
    execute: async () => { throw { code: "E_RUN", detail: "bad code" }; },
  }), /E_RUN/);
  assert.equal(jobs.starts.length, 0);
});

test("preserves explicit timeout and supplies the default otherwise", async () => {
  const state = fixture();
  const jobs = new FakeJobs();
  const seen = [];
  await runBackgroundCode({ args: { timeoutMs: 7 }, exec: state.exec, jobs, execute: async (args) => { seen.push(args.timeoutMs); return { logs: [], result: 1 }; } });
  await runBackgroundCode({ args: {}, exec: state.exec, jobs, timeoutMs: 99, execute: async (args) => { seen.push(args.timeoutMs); return { logs: [], result: 2 }; } });
  assert.deepEqual(seen, [7, 99]);
});

test("retained output stays within the UTF-8 byte cap", async () => {
  const state = fixture();
  const jobs = new FakeJobs();
  await runBackgroundCode({
    args: {}, exec: state.exec, jobs, outputLimitBytes: 48, yieldMs: 1,
    execute: async () => { await delay(5); return { logs: [], result: "😀".repeat(100) }; },
  });
  await jobs.records.get("code-1").hooks.done;
  const output = jobs.records.get("code-1").output;
  assert.ok(Buffer.byteLength(output, "utf8") <= 48);
});

test("registration failure aborts and waits for native teardown", async () => {
  const state = fixture();
  let cleaned = false;
  const jobs = { start() { throw new Error("capacity reached"); } };
  await assert.rejects(runBackgroundCode({
    args: {}, exec: state.exec, jobs, yieldMs: 1,
    execute: async (_args, clone) => new Promise((_, reject) => {
      clone.signal.addEventListener("abort", async () => {
        await delay(5);
        cleaned = true;
        reject(clone.signal.reason);
      }, { once: true });
    }),
  }), /Unable to continue run_code in the background: capacity reached/);
  assert.equal(cleaned, true);
});
