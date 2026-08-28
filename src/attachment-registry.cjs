const crypto = require("node:crypto");
const { decodedBase64Length, MAX_ATTACHMENTS, validateAttachmentPayload } = require("./attachments.cjs");

const ATTACHMENT_TOKEN_PREFIX = "attachment:";

function tokenFromAttachment(item) {
  const explicit = typeof item?.token === "string" ? item.token : "";
  if (explicit.startsWith(ATTACHMENT_TOKEN_PREFIX)) return explicit.slice(ATTACHMENT_TOKEN_PREFIX.length);
  const path = typeof item?.path === "string" ? item.path : "";
  return path.startsWith(ATTACHMENT_TOKEN_PREFIX) ? path.slice(ATTACHMENT_TOKEN_PREFIX.length) : "";
}

function createAttachmentRegistry({
  now = () => Date.now(),
  randomToken = () => crypto.randomBytes(24).toString("base64url"),
  ttlMs = 60 * 60 * 1000,
  maxEntries = 256,
} = {}) {
  const entries = new Map();

  function prune() {
    const current = now();
    for (const [token, entry] of entries) {
      if (entry.expiresAt <= current) entries.delete(token);
    }
    while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
  }

  function register(attachment) {
    let canonical = validateAttachmentPayload([attachment])[0];
    if (canonical.kind === "reference" && attachment.thumbnailData) {
      const thumbnailData = String(attachment.thumbnailData);
      const thumbnailBytes = decodedBase64Length(thumbnailData);
      if (attachment.thumbnailMediaType === "image/png" && thumbnailBytes > 0 && thumbnailBytes <= 1024 * 1024) {
        canonical = { ...canonical, thumbnailData, thumbnailMediaType: "image/png" };
      }
    }
    prune();
    const token = randomToken();
    entries.set(token, { attachment: canonical, expiresAt: now() + ttlMs });
    while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
    return {
      ...canonical,
      path: `${ATTACHMENT_TOKEN_PREFIX}${token}`,
      token: `${ATTACHMENT_TOKEN_PREFIX}${token}`,
    };
  }

  function registerPrepared(result) {
    const prepared = result && typeof result === "object" ? result : {};
    return {
      attachments: (Array.isArray(prepared.attachments) ? prepared.attachments : []).map(register),
      failures: Array.isArray(prepared.failures) ? prepared.failures : [],
    };
  }

  function resolvePayload(value, { imagesOnly = false } = {}) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw new Error("Attachments must be an array");
    if (value.length > MAX_ATTACHMENTS) throw new Error(`Only ${MAX_ATTACHMENTS} attachments can be sent at once`);
    prune();
    return value.map((item) => {
      const token = tokenFromAttachment(item);
      if (token) {
        const entry = entries.get(token);
        if (!entry) throw new Error("Attachment expired or is not from a trusted file selection");
        if (imagesOnly && entry.attachment.kind !== "image") throw new Error(`${entry.attachment.name} has an unsupported attachment kind`);
        return { ...entry.attachment };
      }
      const inline = validateAttachmentPayload([item], { imagesOnly: true })[0];
      if (inline.path && !inline.path.startsWith("clipboard:")) {
        throw new Error(`${inline.name} is not from a trusted file selection`);
      }
      return inline;
    });
  }

  function releasePayload(value) {
    for (const item of Array.isArray(value) ? value : []) {
      const token = tokenFromAttachment(item);
      if (token) entries.delete(token);
    }
  }

  function clear() {
    entries.clear();
  }

  return { clear, register, registerPrepared, releasePayload, resolvePayload, size: () => entries.size };
}

module.exports = { ATTACHMENT_TOKEN_PREFIX, createAttachmentRegistry, tokenFromAttachment };
