const test = require("node:test");
const assert = require("node:assert/strict");
const { attachmentReference, attachmentReferenceFields, readAttachmentWire } = require("../src/attachment-reference.cjs");

const full = { attachmentId: "img-1", mediaType: "image/png", bytes: 64, width: 10, height: 8 };

test("a full image reference keeps only the fields the strict wire schema allows", () => {
  assert.deepEqual(attachmentReference({ ...full, name: "C:\\shot.png", kind: "image", data: "AAAA", sessionId: "s1" }), full);
  assert.deepEqual(attachmentReference({ ...full, originalDimensions: { width: 20, height: 16, extra: 1 } }), { ...full, originalDimensions: { width: 20, height: 16 } });
  assert.deepEqual(attachmentReference("img-1"), { attachmentId: "img-1" });
  assert.deepEqual(attachmentReference({ ...full, width: 0 }), { attachmentId: "img-1" });
  assert.deepEqual(attachmentReference({ ...full, mediaType: "text/html" }), { attachmentId: "img-1" });
  assert.equal(attachmentReference({ attachmentId: "" }), null);
  assert.equal(attachmentReference({ attachmentId: "x".repeat(257) }), null);
  assert.deepEqual(attachmentReferenceFields(full), { mediaType: "image/png", bytes: 64, width: 10, height: 8 });
  assert.deepEqual(attachmentReferenceFields({ attachmentId: "only-id" }), {});
});

test("DSH 0.2.2 is asked with the whole reference, not the id", async () => {
  const calls = [];
  const remote = { call: async (method, args) => { calls.push([method, args]); return { attachment: full, data: "AA==" }; } };
  const value = await readAttachmentWire(remote, "s1", { ...full, name: "shot.png" });
  assert.equal(value.data, "AA==");
  assert.deepEqual(calls, [["session/attachment", { request: { sessionId: "s1", attachment: full } }]]);
});

test("a 0.2.1 Harness that rejects the reference shape is asked again by id", async () => {
  const calls = [];
  const remote = { call: async (method, args) => {
    calls.push(args.request);
    if (args.request.attachment) throw new Error('typert gateway: session/attachment: wire field "request.attachment" is not allowed');
    return { attachment: { mediaType: "image/png" }, data: "AA==" };
  } };
  assert.equal((await readAttachmentWire(remote, "s1", full)).data, "AA==");
  assert.deepEqual(calls.at(-1), { sessionId: "s1", attachmentId: "img-1" });
});

test("a bare id goes out in the 0.2.1 shape and a timeout is not retried", async () => {
  const calls = [];
  const byId = { call: async (_method, args) => { calls.push(args.request); return { data: "AA==" }; } };
  await readAttachmentWire(byId, "s1", "img-1");
  assert.deepEqual(calls, [{ sessionId: "s1", attachmentId: "img-1" }]);
  let attempts = 0;
  const slow = { call: async () => { attempts += 1; throw new Error("session/attachment timed out after 10000 ms"); } };
  await assert.rejects(readAttachmentWire(slow, "s1", full), /timed out/);
  assert.equal(attempts, 1);
  await assert.rejects(readAttachmentWire(byId, "s1", ""), /valid attachment id/);
});
