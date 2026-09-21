// The renderer must never see a raw Harness queue item: it needs a stable id, a
// placement it can filter on, a preview short enough for one line, and the original
// text only when the item is editable. Pure, so it is asserted directly.
const MAX_PREVIEW_CHARS = 240;
const QUEUE_CONTENT = Symbol("queueContent");
const { userContentFromBlocks } = require("./history-model.cjs");

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
  const { text: editableText, attachments } = userContentFromBlocks(content);
  const attachmentCount = Math.max(attachments.length, content.filter((block) => block?.type !== "text").length);
  const fallback = attachmentCount
    ? `${attachmentCount} attachment${attachmentCount === 1 ? "" : "s"}`
    : "Queued message";
  const view = {
    id: String(item?.id || item?.message?.id || ""),
    placement: String(item?.placement || "queued"),
    text: editableText,
    attachments,
    attachmentCount,
    preview: shortenReferences(String(text || fallback)).replace(/\s+/g, " ").slice(0, MAX_PREVIEW_CHARS),
  };
  // The original blocks are needed when editing text so durable attachment references
  // survive. A symbol keeps them in the main-process snapshot without exposing them to IPC.
  Object.defineProperty(view, QUEUE_CONTENT, { value: content, enumerable: false });
  return view;
}

module.exports = { MAX_PREVIEW_CHARS, QUEUE_CONTENT, queueItemView, shortenReferences };
