const test = require("node:test");
const assert = require("node:assert/strict");
const { createHarnessTasks, normalizeJob, sortJobs } = require("../src/harness-tasks.cjs");

// A remote transport whose unary calls are recorded and whose streams play back frames.
function fakeRemote({ frames = {}, answers = {} } = {}) {
  const calls = [];
  const opened = [];
  return {
    calls,
    opened,
    async call(endpoint, args, timeout) {
      calls.push({ endpoint, args, timeout });
      const answer = answers[endpoint];
      if (answer instanceof Error) throw answer;
      return typeof answer === "function" ? answer(args) : answer;
    },
    async openChannel({ endpoint, args, onFrame }) {
      let resolveClosed;
      const closed = new Promise((resolve) => { resolveClosed = resolve; });
      const handle = { closedByUs: false, close() { this.closedByUs = true; resolveClosed(); }, closed };
      opened.push({ endpoint, args, handle });
      setTimeout(() => { for (const frame of frames[endpoint] || []) onFrame(frame); }, 0);
      return handle;
    },
  };
}

const tasksFor = (remote, extra = {}) => createHarnessTasks({ api: { ensureRemote: async () => remote, ...extra } });

test("delete archives the session in DSH, can stop its work first, and restore takes it back", async () => {
  const forgotten = [];
  const remote = fakeRemote({ answers: {
    "workspace/archiveSession": { archivedSessionIds: ["s1"] },
    "workspace/unarchiveSession": { archivedSessionIds: [] },
  } });
  const tasks = tasksFor(remote, { forgetSession: (id) => forgotten.push(id) });
  assert.deepEqual(await tasks.archive("s1", { stopActivity: true }), { archivedSessionIds: ["s1"] });
  assert.deepEqual(remote.calls[0].args, { request: { sessionId: "s1", stopActivity: true } });
  assert.deepEqual(forgotten, ["s1"]);
  assert.deepEqual(await tasks.unarchive("s1"), { archivedSessionIds: [] });
  assert.equal(remote.calls[1].endpoint, "workspace/unarchiveSession");
  await assert.rejects(tasks.archive(" "), /session id is required/);
});

test("pinning and unpinning go to their own endpoints and return the whole pin set", async () => {
  const remote = fakeRemote({ answers: {
    "workspace/pinSession": { pinnedSessionIds: ["a", "b"] },
    "workspace/unpinSession": { pinnedSessionIds: ["b"] },
  } });
  const tasks = tasksFor(remote);
  assert.deepEqual(await tasks.pin("a", true), { pinnedSessionIds: ["a", "b"] });
  assert.deepEqual(await tasks.pin("a", false), { pinnedSessionIds: ["b"] });
  assert.deepEqual(remote.calls.map((call) => call.endpoint), ["workspace/pinSession", "workspace/unpinSession"]);
});

test("background jobs are read from the first frame of job/list, running first, and the stream is closed", async () => {
  const remote = fakeRemote({ frames: { "job/list": [{ type: "rows", jobs: [
    { id: "bash-1", kind: "bash", label: "npm test", status: "completed", startedAt: 10, finishedAt: 20, detail: "exit code: 0", owner: "s1", output: { total: 5, earliest: 0 } },
    { id: "bash-2", kind: "bash", label: "npm run dev", status: "running", startedAt: 5, progress: "watching", owner: "s1", output: { total: 900, earliest: 0 } },
    { nope: true },
  ] }] } });
  const jobs = await tasksFor(remote).jobs("s1");
  assert.deepEqual(jobs.map((job) => [job.id, job.status]), [["bash-2", "running"], ["bash-1", "completed"]]);
  assert.equal(jobs[0].progress, "watching");
  assert.equal(jobs[1].detail, "exit code: 0");
  assert.deepEqual(remote.opened[0].args, { request: { sessionId: "s1" } });
  assert.equal(remote.opened[0].handle.closedByUs, true, "one frame is all it takes");
});

test("a job's output is collected from job/follow until its total has arrived", async () => {
  const remote = fakeRemote({ frames: { "job/follow": [
    { type: "opened", job: { id: "bash-2", kind: "bash", label: "npm test", status: "running", startedAt: 1, output: { total: 11, earliest: 0 } }, from: 0 },
    { type: "output", chunks: [{ at: 0, text: "hello " }, { at: 6, text: "world" }], next: 11 },
  ] } });
  const result = await tasksFor(remote).jobOutput("s1", "bash-2");
  assert.equal(result.output, "hello world");
  assert.equal(result.job.status, "running");
  assert.equal(result.lossy, false);
  assert.equal(remote.opened[0].handle.closedByUs, true);
});

test("stopping a job and a subagent use DSH's own human-initiated calls", async () => {
  const remote = fakeRemote({ answers: { "job/kill": { outcome: "already-finished" }, "subagents/interruptByParent": {} } });
  const tasks = tasksFor(remote);
  assert.deepEqual(await tasks.killJob("s1", "bash-2"), { outcome: "already-finished" });
  assert.deepEqual(remote.calls[0].args, { request: { sessionId: "s1", jobId: "bash-2" } });
  assert.deepEqual(await tasks.interruptSubagent("kid", "parent"), { ok: true });
  assert.deepEqual(remote.calls[1].args, { childSessionId: "kid", parentSessionId: "parent", mode: "continuable" });
});

test("an old Harness says what is missing instead of failing somewhere inside", async () => {
  const tasks = createHarnessTasks({ api: { ensureRemote: async () => null } });
  await assert.rejects(tasks.jobs("s1"), /too old/);
  assert.throws(() => createHarnessTasks({}), /Harness API is required/);
});

test("job rows are normalized and sorted defensively", () => {
  assert.equal(normalizeJob(null), null);
  assert.equal(normalizeJob({ id: "x", status: "weird" }).status, "running");
  const sorted = sortJobs([{ status: "failed", startedAt: 9 }, { status: "stopping", startedAt: 1 }, { status: "completed", startedAt: 10 }]);
  assert.deepEqual(sorted.map((job) => job.status), ["stopping", "completed", "failed"]);
});
