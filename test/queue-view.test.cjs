const test = require("node:test");
const assert = require("node:assert/strict");

const { MAX_PREVIEW_CHARS, queueItemView } = require("../src/queue-view.cjs");

test("a plain text item is editable and previewed on one line", () => {
  const view = queueItemView({
    id: "q1",
    placement: "queued",
    message: { content: [{ type: "text", text: "  first line\n\n  second   line " }] },
  });
  assert.equal(view.id, "q1");
  assert.equal(view.placement, "queued");
  assert.equal(view.text, "first line\n\n  second   line");
  // Newlines and runs of spaces would break the single-line queue row.
  assert.equal(view.preview, "first line second line");
});

test("an item carrying an attachment is not editable", () => {
  const view = queueItemView({
    id: "q2",
    message: { content: [{ type: "text", text: "look" }, { type: "image", source: {} }] },
  });
  // Editing would silently drop the non-text block, so the renderer must not offer it.
  assert.equal(view.text, null);
  assert.equal(view.preview, "look");
});

test("an item with no text at all still describes itself", () => {
  const view = queueItemView({ id: "q3", message: { content: [{ type: "image" }, { type: "image" }] } });
  assert.equal(view.preview, "2 attachments");
  const single = queueItemView({ id: "q4", message: { content: [{ type: "image" }] } });
  assert.equal(single.preview, "1 attachment");
  const empty = queueItemView({ id: "q5", message: { content: [] } });
  assert.equal(empty.preview, "Queued message");
});

test("a long preview is truncated", () => {
  const view = queueItemView({ id: "q6", message: { content: [{ type: "text", text: "x".repeat(500) }] } });
  assert.equal(view.preview.length, MAX_PREVIEW_CHARS);
});

test("malformed input never throws and falls back to the message id", () => {
  assert.deepEqual(queueItemView(undefined), { id: "", placement: "queued", text: null, preview: "Queued message" });
  assert.equal(queueItemView({ message: { id: "m1", content: "not an array" } }).id, "m1");
  assert.equal(queueItemView({ id: "q7", placement: "running", message: {} }).placement, "running");
});
