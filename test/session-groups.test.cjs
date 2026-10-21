const test = require("node:test");
const assert = require("node:assert/strict");

const { folderName, groupSessions } = require("../src/renderer/session-groups.js");

test("workspace membership follows exact Harness sessionIds and preserves server order", () => {
  const sessions = [
    { sessionId: "newest", title: "Newest" },
    { sessionId: "folder-b", title: "B" },
    { sessionId: "folder-a", title: "A" },
    { sessionId: "blank", blank: true },
    { sessionId: "archived" },
  ];
  const groups = groupSessions(sessions, [{
    workspaceId: "workspace-1",
    title: "Agent Deck",
    path: "C:\\AI\\agent-deck",
    sessionIds: ["folder-a", "folder-b", "missing"],
  }], ["archived"]);

  assert.deepEqual(groups.map(({ key }) => key), ["workspace:workspace-1", "ungrouped"]);
  assert.deepEqual(groups[0].sessions.map(({ sessionId }) => sessionId), ["folder-a", "folder-b"]);
  assert.deepEqual(groups[1].sessions.map(({ sessionId }) => sessionId), ["newest"]);
});

test("sessions with the same cwd stay ungrouped unless Harness accounts them to a workspace", () => {
  const groups = groupSessions([
    { sessionId: "accounted", cwd: "C:\\AI\\same" },
    { sessionId: "unaccounted", cwd: "C:\\AI\\same" },
  ], [{ workspaceId: "workspace-1", path: "C:\\AI\\same", sessionIds: ["accounted"] }]);

  assert.deepEqual(groups[0].sessions.map(({ sessionId }) => sessionId), ["accounted"]);
  assert.deepEqual(groups[1].sessions.map(({ sessionId }) => sessionId), ["unaccounted"]);
  assert.equal(groups[0].label, "same");
});

test("an empty Harness projection still exposes one Ungrouped target for a simple new session", () => {
  assert.deepEqual(groupSessions([], [], []), [{
    key: "ungrouped",
    workspaceId: null,
    label: "Ungrouped",
    path: "",
    sessions: [],
  }]);
  assert.equal(folderName("/home/user/project/"), "project");
});

test("blank and subagent rows stay hidden except for the currently selected blank session", () => {
  const sessions = [
    { sessionId: "blank", blank: true },
    { sessionId: "selected-blank", blank: true },
    { sessionId: "child", origin: "subagent" },
    { sessionId: "normal" },
  ];
  const groups = groupSessions(sessions, [], [], "selected-blank");
  assert.deepEqual(groups[0].sessions.map(({ sessionId }) => sessionId), ["selected-blank", "normal"]);
});

test("in recent order each group lists pinned chats first, then the newest activity, ties in Harness order", () => {
  const { groupSessions } = require("../src/renderer/session-groups.js");
  const sessions = [
    { sessionId: "old", updatedAt: 100 },
    { sessionId: "new", updatedAt: 300 },
    { sessionId: "pinned-old", updatedAt: 50 },
    { sessionId: "tie-a", updatedAt: 200 },
    { sessionId: "tie-b", updatedAt: 200 },
    { sessionId: "iso", updatedAt: new Date(250).toISOString() },
  ];
  const [group] = groupSessions(sessions, [], [], "", { order: "recent", pinnedSessionIds: ["pinned-old"] });
  assert.deepEqual(group.sessions.map(({ sessionId }) => sessionId), ["pinned-old", "new", "iso", "tie-a", "tie-b", "old"]);
  const [server] = groupSessions(sessions, [], []);
  assert.deepEqual(server.sessions.map(({ sessionId }) => sessionId), ["old", "new", "pinned-old", "tie-a", "tie-b", "iso"], "the default keeps Harness's order");
});

test("recent chats come from every group, newest first, without archived, blank or subagent rows", () => {
  const { recentSessions } = require("../src/renderer/session-groups.js");
  const recent = recentSessions([
    { sessionId: "a", updatedAt: 10 },
    { sessionId: "b", updatedAt: 40 },
    { sessionId: "gone", updatedAt: 90 },
    { sessionId: "kid", origin: "subagent", updatedAt: 80 },
    { sessionId: "blank", blank: true, updatedAt: 70 },
    { sessionId: "c", updatedAt: 30 },
    { sessionId: "never" },
  ], { archivedSessionIds: ["gone"], limit: 2 });
  assert.deepEqual(recent.map(({ sessionId }) => sessionId), ["b", "c"]);
});
