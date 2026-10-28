// What Deck can do to a session besides talking to it: delete (archive) and restore it,
// pin it, look at the background jobs it started and stop one, read a job's output, and
// stop a subagent that is still working.
//
// DSH has no way to erase a session over its API. Deleting a chat in its own sidebar
// archives it - the session leaves every list and comes back with "unarchive" - and Deck
// does the same, so "Delete" here and in DSH mean one thing and either can undo it.
//
// Background jobs (`bash` runs and the like) are a stream per session in DSH: `job/list`
// sends the whole set on open and again on every change. Deck reads its first frame when
// the panel that shows them asks, instead of keeping a socket open per session.
const JOB_STATUSES = new Set(["running", "stopping", "completed", "killed", "failed"]);
const OUTPUT_LIMIT = 24000;

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function requireId(value, what = "session") {
  const id = text(value);
  if (!id || id.length > 512) throw new Error(`A ${what} id is required`);
  return id;
}

function normalizeJob(job) {
  if (!job || typeof job !== "object" || !text(job.id)) return null;
  const startedAt = Number(job.startedAt);
  const finishedAt = Number(job.finishedAt);
  return {
    id: text(job.id),
    kind: text(job.kind) || "job",
    label: text(job.label) || text(job.kind) || "Background job",
    status: JOB_STATUSES.has(job.status) ? job.status : "running",
    progress: text(job.progress),
    detail: text(job.detail),
    startedAt: Number.isFinite(startedAt) ? startedAt : null,
    finishedAt: Number.isFinite(finishedAt) ? finishedAt : null,
    owned: Boolean(text(job.owner)),
    outputBytes: Number(job.output?.total) || 0,
  };
}

// Running ones first, the newest on top, then the one that finished last: a job that has just
// answered belongs above one that ended an hour ago, whenever each was started.
function sortJobs(jobs) {
  const live = (job) => (["running", "stopping"].includes(job.status) ? 1 : 0);
  const recency = (job) => (live(job) ? job.startedAt : job.finishedAt || job.startedAt) || 0;
  return jobs.sort((left, right) => live(right) - live(left) || recency(right) - recency(left));
}

// Opens a stream, hands every frame to `collect` until it says it has enough (returns true)
// or the time is up, and closes the stream either way.
function readStream(remote, endpoint, args, collect, { timeoutMs = 4000 } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let handle = null;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { handle?.close(); } catch {}
      if (error) reject(error); else resolve();
    };
    const timer = setTimeout(() => finish(), timeoutMs);
    remote.openChannel({ endpoint, args, onFrame: (value) => { if (!settled && collect(value)) finish(); } })
      .then((opened) => {
        handle = opened;
        if (settled) { try { opened.close(); } catch {} return; }
        Promise.resolve(opened.closed).then((reason) => finish(reason instanceof Error ? reason : null), () => finish());
      }, (error) => finish(error));
  });
}

function createHarnessTasks({ api }) {
  if (!api || typeof api.ensureRemote !== "function") throw new TypeError("a Harness API is required");

  async function remote() {
    const transport = await api.ensureRemote();
    if (!transport) throw new Error("This Harness is too old for that; update DeepSeek Harness");
    return transport;
  }

  async function archive(sessionId, { stopActivity = false } = {}) {
    const value = await (await remote()).call("workspace/archiveSession", { request: { sessionId: requireId(sessionId), stopActivity: Boolean(stopActivity) } }, 15000);
    api.forgetSession?.(sessionId);
    return { archivedSessionIds: Array.isArray(value?.archivedSessionIds) ? value.archivedSessionIds : [] };
  }

  async function unarchive(sessionId) {
    const value = await (await remote()).call("workspace/unarchiveSession", { request: { sessionId: requireId(sessionId) } }, 15000);
    return { archivedSessionIds: Array.isArray(value?.archivedSessionIds) ? value.archivedSessionIds : [] };
  }

  async function pin(sessionId, pinned = true) {
    const value = await (await remote()).call(pinned ? "workspace/pinSession" : "workspace/unpinSession", { request: { sessionId: requireId(sessionId) } }, 15000);
    return { pinnedSessionIds: Array.isArray(value?.pinnedSessionIds) ? value.pinnedSessionIds : [] };
  }

  async function jobs(sessionId) {
    const transport = await remote();
    let rows = null;
    await readStream(transport, "job/list", { request: { sessionId: requireId(sessionId) } }, (frame) => {
      if (frame?.type !== "rows") return false;
      rows = Array.isArray(frame.jobs) ? frame.jobs : [];
      return true;
    });
    if (!rows) throw new Error("Harness did not list the background jobs");
    return sortJobs(rows.map(normalizeJob).filter(Boolean));
  }

  async function killJob(sessionId, jobId) {
    const value = await (await remote()).call("job/kill", { request: { sessionId: requireId(sessionId), jobId: requireId(jobId, "job") } }, 10000);
    return { outcome: value?.outcome === "already-finished" ? "already-finished" : "requested" };
  }

  // The newest output a job has, up to OUTPUT_LIMIT characters, and its state.
  async function jobOutput(sessionId, jobId, { limit = OUTPUT_LIMIT } = {}) {
    const transport = await remote();
    let job = null;
    let output = "";
    let lossy = false;
    let total = 0;
    await readStream(transport, "job/follow", { request: { sessionId: requireId(sessionId), jobId: requireId(jobId, "job") } }, (frame) => {
      if (frame?.type === "opened") {
        job = normalizeJob(frame.job);
        total = Number(frame.job?.output?.total) || 0;
        lossy = Number(frame.job?.output?.earliest) > 0;
        return total === 0 && job?.status !== "running" && job?.status !== "stopping";
      }
      if (frame?.type === "output") {
        for (const chunk of Array.isArray(frame.chunks) ? frame.chunks : []) output += typeof chunk?.text === "string" ? chunk.text : "";
        if (frame.lossy) lossy = true;
        if (output.length > limit * 2) { output = output.slice(-limit); lossy = true; }
        return Number(frame.next) >= total && total > 0;
      }
      if (frame?.type === "status") {
        job = normalizeJob(frame.job) || job;
        return true;
      }
      return false;
    }, { timeoutMs: 2500 });
    if (output.length > limit) { output = output.slice(-limit); lossy = true; }
    return { job, output, lossy };
  }

  // Stops a working subagent the way DSH's own panel does: its turn ends and it can be
  // continued later.
  async function interruptSubagent(childSessionId, parentSessionId) {
    await (await remote()).call("subagents/interruptByParent", {
      childSessionId: requireId(childSessionId), parentSessionId: requireId(parentSessionId), mode: "continuable",
    }, 10000);
    return { ok: true };
  }

  return { archive, unarchive, pin, jobs, killJob, jobOutput, interruptSubagent };
}

module.exports = { OUTPUT_LIMIT, createHarnessTasks, normalizeJob, readStream, sortJobs };
