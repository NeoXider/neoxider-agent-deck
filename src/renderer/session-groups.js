(function exposeSessionGroups(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.sessionGroups = api;
}(typeof globalThis === "object" ? globalThis : this, () => {
  const UNGROUPED_KEY = "ungrouped";

  function text(value) {
    return String(value || "").trim();
  }

  function folderName(value) {
    const normalized = text(value).replace(/[\\/]+$/, "");
    return normalized.split(/[\\/]/).filter(Boolean).at(-1) || normalized || "Workspace";
  }

  function timestamp(value) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && value !== null && value !== "") return numeric;
    const parsed = Date.parse(String(value || ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  // Newest activity first, as DSH's own sidebar orders them. Equal times keep Harness's
  // order, so a list without timestamps reads exactly as it did.
  function byRecent(left, right) {
    return timestamp(right?.updatedAt) - timestamp(left?.updatedAt);
  }

  // Pinned chats first, in the order they were pinned (most recent pin first), then the rest
  // by recency.
  function orderSessions(sessions, pinnedSessionIds = []) {
    const pins = new Map((pinnedSessionIds || []).map((id, index) => [text(id), index]));
    return [...sessions].sort((left, right) => {
      const a = pins.has(text(left?.sessionId)) ? pins.get(text(left.sessionId)) : Infinity;
      const b = pins.has(text(right?.sessionId)) ? pins.get(text(right.sessionId)) : Infinity;
      if (a !== b) return a < b ? -1 : 1;
      return byRecent(left, right);
    });
  }

  function isListed(session, archived, selected) {
    const sessionId = text(session?.sessionId);
    return Boolean(sessionId)
      && session?.origin !== "subagent"
      && (!session?.blank || sessionId === selected)
      && !archived.has(sessionId);
  }

  // The chats touched last, across every group: what DSH shows at the top of its sidebar.
  function recentSessions(sessions, { archivedSessionIds = [], selectedSessionId = "", limit = 5 } = {}) {
    const archived = new Set((archivedSessionIds || []).map(text).filter(Boolean));
    const selected = text(selectedSessionId);
    return (Array.isArray(sessions) ? sessions : [])
      .filter((session) => isListed(session, archived, selected) && timestamp(session?.updatedAt) > 0)
      .sort(byRecent)
      .slice(0, Math.max(0, Number(limit) || 0));
  }

  function groupSessions(sessions, workspaces, archivedSessionIds = [], selectedSessionId = "", { pinnedSessionIds = [], order = "server" } = {}) {
    const archived = new Set((archivedSessionIds || []).map(text).filter(Boolean));
    const selected = text(selectedSessionId);
    const visible = (Array.isArray(sessions) ? sessions : []).filter((session) => isListed(session, archived, selected));
    const byId = new Map(visible.map((session) => [text(session.sessionId), session]));
    const assigned = new Set();
    const groups = [];
    for (const workspace of Array.isArray(workspaces) ? workspaces : []) {
      const workspaceId = text(workspace?.workspaceId);
      if (!workspaceId) continue;
      const items = [];
      for (const sessionId of Array.isArray(workspace?.sessionIds) ? workspace.sessionIds : []) {
        const normalizedId = text(sessionId);
        const session = byId.get(normalizedId);
        if (!session || assigned.has(normalizedId)) continue;
        assigned.add(normalizedId);
        items.push(session);
      }
      groups.push({
        key: `workspace:${workspaceId}`,
        workspaceId,
        label: text(workspace.title) || folderName(workspace.path),
        path: text(workspace.path),
        sessions: items,
      });
    }
    const ungrouped = visible.filter((session) => !assigned.has(text(session.sessionId)));
    if (ungrouped.length || !groups.length) {
      groups.push({ key: UNGROUPED_KEY, workspaceId: null, label: "Ungrouped", path: "", sessions: ungrouped });
    }
    if (order === "recent") for (const group of groups) group.sessions = orderSessions(group.sessions, pinnedSessionIds);
    return groups;
  }

  return { UNGROUPED_KEY, folderName, groupSessions, orderSessions, recentSessions, timestamp };
}));
