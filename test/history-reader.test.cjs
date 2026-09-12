const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { HarnessApi } = require("../src/harness-api.cjs");

test("production worker paginates HTTP history, reuses revisions, handles compaction and forgets deleted sessions", async () => {
  let entries = Array.from({ length: 205 }, (_, index) => ({ event: {
    seq: index + 1, type: "user/message", time: index + 1,
    data: { content: [{ type: "text", text: `Message ${index}` }] },
  } }));
  let requests = 0;
  let unavailable = false;
  let delayNext = null;
  const server = http.createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const { rpcId, payload } = JSON.parse(body);
    requests += 1;
    if (unavailable) { response.writeHead(503).end(); return; }
    const before = entries.filter((entry) => entry.event.seq < (payload.beforeSeq || Infinity));
    const events = before.slice(-payload.maxMessages);
    if (delayNext) { const delay = delayNext; delayNext = null; await delay(); }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ rpcId, result: { ok: true, value: { events, hasMore: before.length > events.length } } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const api = new HarnessApi(`http://127.0.0.1:${server.address().port}`);
    let ticked = false;
    setImmediate(() => { ticked = true; });
    const first = await api.history("chat");
    assert.equal(ticked, true);
    assert.equal(first.messages.length, 205);
    assert.equal(requests, 3);
    assert.equal(first.messages[0].text, "Message 0");
    const repeated = await api.history("chat");
    assert.equal(requests, 4);
    assert.equal(repeated.unchanged, true);
    assert.equal(repeated.revision, first.revision);
    entries = entries.slice(-2);
    const compacted = await api.history("chat");
    assert.equal(compacted.messages.length, 2);
    assert.notEqual(compacted.revision, first.revision);
    entries = [];
    assert.equal((await api.history("chat")).messages.length, 2, "empty transient responses retain cached history");
    api.forgetSession("chat");
    assert.equal((await api.history("chat")).messages.length, 0, "forget reaches the worker cache");
    unavailable = true;
    await assert.rejects(api.history("chat"), /HTTP 503/);
    unavailable = false;
    assert.equal((await api.history("chat")).messages.length, 0, "worker remains usable after a failed request");
    let release;
    let started;
    const startedPromise = new Promise((resolve) => { started = resolve; });
    const held = new Promise((resolve) => { release = resolve; });
    entries = [{ event: { seq: 999, type: "user/message", data: { content: [{ type: "text", text: "old" }] } } }];
    delayNext = async () => { started(); await held; };
    const oldRead = api.history("racing-chat");
    await startedPromise;
    api.forgetSession("racing-chat");
    entries = [];
    const afterForget = api.history("racing-chat");
    release();
    await oldRead;
    assert.equal((await afterForget).messages.length, 0, "an in-flight read cannot undo a later forget");
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
