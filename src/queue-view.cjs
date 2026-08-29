// The renderer must never see a raw Harness queue item: it needs a stable id, a
// placement it can filter on, a preview short enough for one line, and the original
// text only when the item is editable. Pure, so it is asserted directly.
const MAX_PREVIEW_CHARS = 240;

// A file attachment travels to Harness as an "@C:\...\name.ext" reference inside the message
// text, so a queued document used to fill its whole one-line row with an absolute path and
// still be cut off before the file name — the only part worth reading. The preview shows the
// name; the editable text keeps the real path, because saving a shortened one would break the
// reference.
const ABSOLUTE_REFERENCE = /@((?:[a-zA-Z]:[\\/]|\\\\|\/)\S+)/g;

function shortenReferences(value) {
  return value.replace(ABSOLUTE_REFERENCE, (match, filePath) => {
    const name = filePath.split(/[\\/]/).filter(Boolean).at(-1);
    return name ? `@${name}` : match;
  });
}

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
    preview: shortenReferences(String(text || fallback)).replace(/\s+/g, " ").slice(0, MAX_PREVIEW_CHARS),
  };
}

module.exports = { MAX_PREVIEW_CHARS, queueItemView, shortenReferences };
