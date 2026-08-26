const test = require("node:test");
const assert = require("node:assert/strict");

const { recentReplySessions } = require("../src/renderer/compact-sessions.js");

test("recent replies are deduplicated by session, newest first, and capped at three", () => {
  const result = recentReplySessions([
    { sessionId: "alpha", title: "Alpha old", preview: "old", updatedAt: 10 },
    { sessionId: "beta", title: "Beta", preview: "second", updatedAt: 40 },
    { sessionId: "alpha", title: "Alpha", preview: "latest", updatedAt: 50 },
    { sessionId: "gamma", title: "Gamma", preview: "third", updatedAt: 30 },
    { sessionId: "delta", title: "Delta", preview: "fourth", updatedAt: 20 },
  ]);

  assert.deepEqual(result.map(({ sessionId }) => sessionId), ["alpha", "beta", "gamma"]);
  assert.equal(result[0].preview, "latest");
});

test("recent replies ignore sessions without an assistant preview and normalize ISO timestamps", () => {
  const result = recentReplySessions([
    { sessionId: "empty", title: "No reply", preview: "", updatedAt: "2026-08-26T12:00:00Z" },
    { sessionId: "older", title: "Older", preview: "ready", updatedAt: "2026-08-26T12:00:00Z" },
    { sessionId: "newer", title: "Newer", preview: "done", replyAt: "2026-08-26T13:00:00Z" },
  ]);

  assert.deepEqual(result.map(({ sessionId }) => sessionId), ["newer", "older"]);
});
