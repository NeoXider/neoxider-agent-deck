// A session's subagents, read from the session list Deck already fetches.
//
// Every subagent is a session of its own: session/list returns it with `origin: "subagent"`
// and its parent's id, and the Agents list leaves it out. Deck used to ask for each
// session's children with `subagent/list`, which current DSH no longer has, so every
// session reported none and the "N subagents" chip never appeared. The list rows are
// enough: who the children are, which of them run right now, and (in the projection hints
// the row carries) the label each was started with and how long its turn has taken.
//
// The result is flat, depth-first, so the renderer can draw the tree without recursion,
// and capped, so a runaway fan-out cannot flood the widget.
const MAX_DEPTH = 4;
const MAX_ENTRIES = 80;

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function timestamp(value) {
  const number = typeof value === "string" ? Date.parse(value) : Number(value);
  return Number.isFinite(number) ? number : 0;
}

// parentSessionId -> the rows of its direct children.
function childrenByParent(items) {
  const map = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const parent = text(item?.parentSessionId);
    const id = text(item?.sessionId);
    if (!parent || !id || parent === id) continue;
    if (!map.has(parent)) map.set(parent, []);
    map.get(parent).push(item);
  }
  return map;
}

// Labels a parent recorded for its children, from its subagentCatalog projection.
function catalogLabels(parent) {
  const labels = new Map();
  const catalog = parent?.projections?.values?.subagentCatalog;
  for (const entry of Array.isArray(catalog) ? catalog : []) {
    if (text(entry?.id) && text(entry?.label)) labels.set(text(entry.id), text(entry.label));
  }
  return labels;
}

// When a child last answered. DSH has no such field: a row's updatedAt is its last prompt
// (max(createdAt, lastPromptAt)), and the timing projection keeps only how long it worked.
// HarnessApi records the poll on which a child stopped running; a child that finished before
// Deck saw it is placed at its last prompt plus the time it worked - when that prompt's turn
// would have ended.
function answeredAt(child, observed) {
  const seen = observed?.(text(child?.sessionId));
  if (Number.isFinite(seen)) return seen;
  const settled = Number(child?.projections?.values?.subagentTiming?.settledMs);
  return timestamp(child?.updatedAt) + (Number.isFinite(settled) && settled > 0 ? settled : 0);
}

function childEntry(child, depth, parentId, labels, childCount) {
  const values = child?.projections?.values || {};
  const identity = values.subagent && typeof values.subagent === "object" ? values.subagent : null;
  const timing = values.subagentTiming && typeof values.subagentTiming === "object" ? values.subagentTiming : null;
  const running = Boolean(child.running);
  const since = Number(timing?.active?.since);
  const settled = Number(timing?.settledMs);
  return {
    kind: "child",
    sessionId: text(child.sessionId),
    parentSessionId: parentId,
    title: text(identity?.label) || labels.get(text(child.sessionId)) || text(values.title) || "Subagent",
    mode: text(identity?.mode) || "",
    activity: running ? "running" : "idle",
    // The last closed turn: finished normally, or not (failed, stopped, refused).
    outcome: running ? "" : timing?.lastTurnCompleted === false ? "failed" : timing?.lastTurnCompleted === true ? "done" : "",
    runningSince: running && Number.isFinite(since) && since > 0 ? since : null,
    workedMs: Number.isFinite(settled) && settled > 0 ? settled : null,
    updatedAt: timestamp(child.updatedAt),
    depth,
    childCount,
  };
}

// Every descendant of `parentId`, depth-first: among siblings the ones at work first, the
// newest of them on top, then the one that answered last. Ordering the finished ones by
// their row's updatedAt put them in the order they were started, so a subagent that had
// just answered could sit under ones that finished long before. `observedAnswer(id)`
// returns the time HarnessApi saw that child stop, when it did.
function subagentTree(parentId, map, parentRow = null, { maxDepth = MAX_DEPTH, maxEntries = MAX_ENTRIES, observedAnswer = null } = {}) {
  const entries = [];
  const seen = new Set([text(parentId)]);
  const recency = (child) => (child.running ? timestamp(child.updatedAt) : answeredAt(child, observedAnswer));
  const walk = (id, row, depth) => {
    if (depth > maxDepth || entries.length >= maxEntries) return;
    const labels = catalogLabels(row);
    const children = [...(map.get(id) || [])].sort((left, right) => (Number(Boolean(right.running)) - Number(Boolean(left.running)))
      || recency(right) - recency(left));
    for (const child of children) {
      const childId = text(child.sessionId);
      if (seen.has(childId) || entries.length >= maxEntries) continue;
      seen.add(childId);
      entries.push(childEntry(child, depth, id, labels, (map.get(childId) || []).length));
      walk(childId, child, depth + 1);
    }
  };
  walk(text(parentId), parentRow, 1);
  return entries;
}

module.exports = { MAX_DEPTH, MAX_ENTRIES, answeredAt, catalogLabels, childrenByParent, subagentTree };
