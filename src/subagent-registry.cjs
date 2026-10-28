// What Deck knows about the subagents of the last session list: whose child each one is, how
// it was started, and when it was seen to stop. HarnessApi routes a subagent's calls by it
// (sessionAddress, prompt, cancel) and subagent-tree.cjs orders a chat's subagents by it.
function createSubagentRegistry({ now = Date.now } = {}) {
  let parents = new Map(); // childSessionId -> { parentSessionId, mode }
  const running = new Set();
  const answers = new Map(); // childSessionId -> when a poll first saw it idle after work

  // `children` is childrenByParent's map of one session list; `items` are that list's rows.
  function update(children, items) {
    parents = new Map([...children].flatMap(([parent, rows]) => rows.map((row) => [row.sessionId, {
      parentSessionId: parent, mode: String(row.projections?.values?.subagent?.mode || ""),
    }])));
    // DSH says when a subagent was last prompted, not when it answered, so the poll that first
    // sees a running child idle stands for its answer. Only the children listed are kept.
    const at = now();
    const present = new Set();
    for (const row of Array.isArray(items) ? items : []) {
      if (row?.origin !== "subagent" || !row.sessionId) continue;
      present.add(row.sessionId);
      if (row.running) { running.add(row.sessionId); answers.delete(row.sessionId); }
      else if (running.delete(row.sessionId)) answers.set(row.sessionId, at);
    }
    for (const id of [...running]) if (!present.has(id)) running.delete(id);
    for (const id of [...answers.keys()]) if (!present.has(id)) answers.delete(id);
  }

  return {
    update,
    // { parentSessionId, mode } for a session the last list reported as a subagent, else null.
    of: (sessionId) => parents.get(sessionId) || null,
    // A subagent's log is read under its parent. DSH refuses a plain session address for one
    // ("subagent Sessions require their durable parent address"), which left every subagent's
    // chat on "History could not be loaded". "unknown" mode is the one DSH never checks
    // against the child's own, so a continuable or one-shot child opens alike.
    address(sessionId) {
      const parentSessionId = parents.get(sessionId)?.parentSessionId;
      return parentSessionId ? { kind: "subagent", parentSessionId, childSessionId: sessionId, mode: "unknown" } : { kind: "session", sessionId };
    },
    answeredAt: (sessionId) => answers.get(sessionId),
    clear() { parents = new Map(); running.clear(); answers.clear(); },
  };
}

module.exports = { createSubagentRegistry };
