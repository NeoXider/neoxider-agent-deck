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

  function groupSessions(sessions, workspaces, archivedSessionIds = [], selectedSessionId = "") {
    const archived = new Set((archivedSessionIds || []).map(text).filter(Boolean));
    const selected = text(selectedSessionId);
    const visible = (Array.isArray(sessions) ? sessions : []).filter((session) => {
      const sessionId = text(session?.sessionId);
      return sessionId
        && session?.origin !== "subagent"
        && (!session?.blank || sessionId === selected)
        && !archived.has(sessionId);
    });
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
    return groups;
  }

  return { UNGROUPED_KEY, folderName, groupSessions };
}));
