(function exposeCompactSessions(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.compactSessions = api;
}(typeof globalThis === "object" ? globalThis : this, () => {
  function timestamp(value) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(String(value || ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function recentReplySessions(sessions, limit = 3) {
    const unique = new Map();
    for (const session of Array.isArray(sessions) ? sessions : []) {
      const sessionId = String(session?.sessionId || "").trim();
      const preview = String(session?.preview || "").replace(/\s+/g, " ").trim();
      if (!sessionId || !preview) continue;
      const candidate = {
        sessionId,
        title: String(session?.title || "Current session").trim() || "Current session",
        preview,
        updatedAt: timestamp(session?.replyAt ?? session?.updatedAt),
        running: Boolean(session?.running),
      };
      const current = unique.get(sessionId);
      if (!current || candidate.updatedAt >= current.updatedAt) unique.set(sessionId, candidate);
    }
    return [...unique.values()]
      .sort((left, right) => right.updatedAt - left.updatedAt || left.title.localeCompare(right.title))
      .slice(0, Math.max(0, Number(limit) || 0));
  }

  return { recentReplySessions };
}));
