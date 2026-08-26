// The renderer must never see a raw Harness queue item: it needs a stable id, a
// placement it can filter on, a preview short enough for one line, and the original
// text only when the item is editable. Pure, so it is asserted directly.
const MAX_PREVIEW_CHARS = 240;

function queueItemView(item) {
  const content = Array.isArray(item?.message?.content) ? item.message.content : [];
  const textBlocks = content.filter((block) => block?.type === "text" && typeof block.text === "string");
  const text = textBlocks.map((block) => block.text).join("\n").trim();
  // Only a message made entirely of text can be edited in place; anything with an
  // attachment would silently lose it on save.
  const editableText = content.length > 0 && content.every((block) => block?.type === "text") ? text : null;
  const fallback = content.length
    ? `${content.length} attachment${content.length === 1 ? "" : "s"}`
    : "Queued message";
  return {
    id: String(item?.id || item?.message?.id || ""),
    placement: String(item?.placement || "queued"),
    text: editableText,
    preview: String(text || fallback).replace(/\s+/g, " ").slice(0, MAX_PREVIEW_CHARS),
  };
}

module.exports = { MAX_PREVIEW_CHARS, queueItemView };
