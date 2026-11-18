"use strict";

// Reading an image back from Harness. DSH 0.2.1 took `session/attachment` as
// { sessionId, attachmentId } and looked the image up in the Session. DSH 0.2.2 reads it
// "without consulting Session history": the request carries the whole durable reference,
// { sessionId, attachment: { attachmentId, mediaType, bytes, width, height } }, and an id alone
// fails the wire schema. Deck keeps that reference from the history or queue block, sends the
// 0.2.2 shape when it has one and falls back to the id for an older Harness.

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const positive = (value) => Number.isSafeInteger(value) && value > 0;

// The wire schema is strict (no extra fields), so only the verified fields travel. The display
// name is optional there and Deck's copy is shortened, so it is left out.
function attachmentReference(value) {
  const source = typeof value === "string" ? { attachmentId: value } : value && typeof value === "object" ? value : {};
  const attachmentId = String(source.attachmentId || "").trim();
  if (!attachmentId || attachmentId.length > 256) return null;
  const reference = { attachmentId };
  const mediaType = String(source.mediaType || "").toLowerCase();
  const bytes = Number(source.bytes), width = Number(source.width), height = Number(source.height);
  if (IMAGE_TYPES.has(mediaType) && positive(bytes) && positive(width) && positive(height)) {
    Object.assign(reference, { mediaType, bytes, width, height });
    const original = source.originalDimensions;
    if (original && positive(original.width) && positive(original.height)) {
      reference.originalDimensions = { width: original.width, height: original.height };
    }
  }
  return reference;
}

function requireAttachmentReference(value) {
  const reference = attachmentReference(value);
  if (!reference) throw new Error("A valid attachment id is required");
  return reference;
}

function isFullReference(reference) { return Boolean(reference?.mediaType); }

// The fields a renderer attachment carries so it can ask for its own image again.
function attachmentReferenceFields(source) {
  const reference = attachmentReference(source);
  if (!reference) return {};
  const { attachmentId: _id, ...fields } = reference;
  return fields;
}

async function readAttachmentWire(remote, sessionId, value, timeoutMs = 10000) {
  const reference = requireAttachmentReference(value);
  const byId = () => remote.call("session/attachment", { request: { sessionId, attachmentId: reference.attachmentId } }, timeoutMs);
  if (!isFullReference(reference)) return byId();
  try {
    return await remote.call("session/attachment", { request: { sessionId, attachment: reference } }, timeoutMs);
  } catch (error) {
    // A 0.2.1 Harness rejects the reference shape on the wire but still reads by id. A timeout
    // is not a shape problem; asking again would only double the wait.
    if (/timed? ?out|timeout/i.test(String(error?.message || error))) throw error;
    try { return await byId(); } catch { throw error; }
  }
}

module.exports = { attachmentReference, attachmentReferenceFields, isFullReference, readAttachmentWire, requireAttachmentReference };
