// Turning dropped files into message content.
//
// Separated from the main process because the rules here — what counts as an image,
// what the size ceiling is, what happens to a file that cannot be read — are worth
// testing on their own, and none of them need Electron once the thumbnail maker is
// injected.
const path = require("node:path");
const fsPromises = require("node:fs/promises");

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_ATTACHMENTS = 12;
const IMAGE_TYPES = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
]);
const VIDEO_TYPES = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi", ".wmv"]);

function decodedBase64Length(value) {
  if (typeof value !== "string" || !value.length || value.length % 4 !== 0
      || !/^[a-zA-Z0-9+/]*={0,2}$/.test(value)) return -1;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

function safeAttachmentName(value) {
  if (typeof value !== "string") throw new Error("Attachment name is required");
  const name = value.trim();
  if (!name || name.length > 120 || /[\u0000-\u001f\u007f\\/]/.test(name)) {
    throw new Error("Attachment name is invalid");
  }
  return name;
}

function isAbsoluteLocalPath(value) {
  return path.isAbsolute(value) || path.win32.isAbsolute(value) || path.posix.isAbsolute(value);
}

// Renderer state is convenient UI state, not a privilege boundary. Rebuild attachment
// payloads from a small allowlist before they can reach Harness or local cleanup code.
function validateAttachmentPayload(value, { imagesOnly = false } = {}) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("Attachments must be an array");
  if (value.length > MAX_ATTACHMENTS) throw new Error(`Only ${MAX_ATTACHMENTS} attachments can be sent at once`);

  return value.map((item) => {
    if (!item || typeof item !== "object") throw new Error("Attachment is invalid");
    const kind = String(item.kind || "");
    const name = safeAttachmentName(item.name);
    if (kind === "image") {
      const mediaType = String(item.mediaType || "").toLowerCase();
      if (![...IMAGE_TYPES.values()].includes(mediaType)) throw new Error(`${name} has an unsupported image type`);
      const data = item.data;
      const bytes = decodedBase64Length(data);
      if (bytes < 1) throw new Error(`${name} has invalid image data`);
      if (bytes > MAX_IMAGE_BYTES) throw new Error(`${name} exceeds the 8 MB image limit`);
      const attachment = { kind, mediaType, data, name, bytes };
      if (item.path !== undefined && item.path !== null && String(item.path).trim()) {
        const imagePath = String(item.path).trim();
        if (imagePath.length > 4096 || (!isAbsoluteLocalPath(imagePath) && !/^clipboard:[a-f0-9]{8,64}$/i.test(imagePath))) {
          throw new Error(`${name} has an invalid image path`);
        }
        attachment.path = imagePath;
      }
      return attachment;
    }
    if (imagesOnly || kind !== "reference") throw new Error(`${name} has an unsupported attachment kind`);
    const filePath = typeof item.path === "string" ? item.path.trim() : "";
    if (!filePath || filePath.length > 4096 || filePath.includes("\u0000") || !isAbsoluteLocalPath(filePath)) {
      throw new Error(`${name} has an invalid reference path`);
    }
    return {
      kind,
      previewKind: item.previewKind === "video" ? "video" : "file",
      path: filePath,
      name,
    };
  });
}

function createAttachmentReader({
  fileSystem = fsPromises,
  // Returns a base64 PNG, or "" when no preview can be produced.
  makeThumbnail = async () => "",
  // (filePath, maxBytes) -> base64 string. Injected so the CPU-bound half can be moved to
  // another thread without this module knowing that threads exist; the default below is
  // the original inline encode, which is what keeps these rules testable against a fake
  // disk and what the bench script uses as its "before" number.
  encodeImage = null,
  maxImageBytes = MAX_IMAGE_BYTES,
  maxAttachments = MAX_ATTACHMENTS,
} = {}) {
  const encode = encodeImage
    || (async (filePath) => (await fileSystem.readFile(filePath)).toString("base64"));

  async function prepareFile(filePath) {
    const resolved = path.resolve(String(filePath));
    // Asynchronous on purpose: the main process is single-threaded, and reading plus
    // base64-encoding up to twelve 8 MB files synchronously froze the window, the tray
    // and every IPC handler for seconds while Windows painted "Not responding". Async
    // I/O alone was not enough — `toString("base64")` holds the thread for its whole
    // duration whoever awaits it — so the caller injects an encoder that runs elsewhere.
    const info = await fileSystem.stat(resolved);
    if (!info.isFile()) throw new Error(`Not a file: ${resolved}`);

    const extension = path.extname(resolved).toLowerCase();
    const mediaType = IMAGE_TYPES.get(extension);
    if (!mediaType) {
      if (VIDEO_TYPES.has(extension)) {
        // A missing preview is not a failure: the file still attaches by reference.
        const thumbnailData = await makeThumbnail(resolved).catch(() => "");
        return {
          kind: "reference",
          previewKind: "video",
          thumbnailData,
          thumbnailMediaType: thumbnailData ? "image/png" : "",
          path: resolved,
          name: path.basename(resolved),
        };
      }
      return { kind: "reference", previewKind: "file", path: resolved, name: path.basename(resolved) };
    }

    if (info.size > maxImageBytes) {
      throw new Error(`${path.basename(resolved)} exceeds the ${Math.round(maxImageBytes / (1024 * 1024))} MB image limit`);
    }
    return {
      kind: "image",
      mediaType,
      data: await encode(resolved, maxImageBytes),
      name: path.basename(resolved),
      path: resolved,
      bytes: info.size,
    };
  }

  async function prepareFiles(filePaths) {
    const resolved = [...new Set((filePaths || []).map((value) => path.resolve(String(value))))]
      .slice(0, maxAttachments);
    const settled = await Promise.allSettled(resolved.map(prepareFile));
    // One unreadable or oversized file used to reject the whole batch, so the user got
    // nothing back and no way to tell which file was at fault. Report per file instead.
    const attachments = [];
    const failures = [];
    settled.forEach((entry, index) => {
      if (entry.status === "fulfilled") attachments.push(entry.value);
      else {
        failures.push({
          name: path.basename(resolved[index]),
          error: entry.reason instanceof Error ? entry.reason.message : String(entry.reason),
        });
      }
    });
    return { attachments, failures };
  }

  return { prepareFile, prepareFiles };
}

module.exports = {
  IMAGE_TYPES,
  MAX_ATTACHMENTS,
  MAX_IMAGE_BYTES,
  VIDEO_TYPES,
  createAttachmentReader,
  decodedBase64Length,
  validateAttachmentPayload,
};
