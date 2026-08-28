const test = require("node:test");
const assert = require("node:assert/strict");
const { createAttachmentRegistry, ATTACHMENT_TOKEN_PREFIX } = require("../src/attachment-registry.cjs");

function registry(options = {}) {
  let next = 0;
  return createAttachmentRegistry({ randomToken: () => `token-${++next}`, ...options });
}

test("prepared references expose an opaque token and resolve to the canonical path", () => {
  const values = registry();
  const exposed = values.register({ kind: "reference", previewKind: "file", path: "C:\\docs\\notes.txt", name: "notes.txt" });
  assert.equal(exposed.path, `${ATTACHMENT_TOKEN_PREFIX}token-1`);
  assert.doesNotMatch(exposed.path, /docs|notes/i);

  const resolved = values.resolvePayload([{ ...exposed, path: "C:\\Windows\\win.ini", name: "spoofed.txt" }]);
  assert.deepEqual(resolved, [{ kind: "reference", previewKind: "file", path: "C:\\docs\\notes.txt", name: "notes.txt" }]);
});

test("raw reference paths and forged or expired tokens are rejected", () => {
  let current = 10;
  const values = registry({ now: () => current, ttlMs: 5 });
  const exposed = values.register({ kind: "reference", path: "C:\\docs\\notes.txt", name: "notes.txt" });
  assert.throws(() => values.resolvePayload([{ kind: "reference", path: "C:\\secret.txt", name: "secret.txt" }]), /unsupported attachment kind/);
  assert.throws(() => values.resolvePayload([{ kind: "reference", path: `${ATTACHMENT_TOKEN_PREFIX}forged`, name: "x.txt" }]), /expired|trusted file selection/);
  current = 16;
  assert.throws(() => values.resolvePayload([exposed]), /expired|trusted file selection/);
});

test("pathless clipboard images remain allowed but local image paths require a token", () => {
  const values = registry();
  const raw = { kind: "image", mediaType: "image/png", data: "AA==", name: "paste.png", path: "clipboard:aabbccdd" };
  assert.deepEqual(values.resolvePayload([raw]), [{ ...raw, bytes: 1 }]);
  assert.throws(() => values.resolvePayload([{ ...raw, path: "C:\\secret.png" }]), /not from a trusted file selection/);
});

test("successful sends can release capabilities while failed sends can retry", () => {
  const values = registry();
  const exposed = values.register({ kind: "image", mediaType: "image/png", data: "AA==", name: "shot.png", path: "C:\\shot.png" });
  assert.equal(values.resolvePayload([exposed])[0].path, "C:\\shot.png");
  values.releasePayload([exposed]);
  assert.throws(() => values.resolvePayload([exposed]), /expired|trusted file selection/);
});

test("registry is bounded and evicts its oldest capability", () => {
  const values = registry({ maxEntries: 2 });
  const first = values.register({ kind: "reference", path: "C:\\1.txt", name: "1.txt" });
  values.register({ kind: "reference", path: "C:\\2.txt", name: "2.txt" });
  values.register({ kind: "reference", path: "C:\\3.txt", name: "3.txt" });
  assert.equal(values.size(), 2);
  assert.throws(() => values.resolvePayload([first]), /expired|trusted file selection/);
});
