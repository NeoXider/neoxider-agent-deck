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

function createAttachmentReader({
  fileSystem = fsPromises,
  // Returns a base64 PNG, or "" when no preview can be produced.
  makeThumbnail = async () => "",
  maxImageBytes = MAX_IMAGE_BYTES,
  maxAttachments = MAX_ATTACHMENTS,
} = {}) {
  async function prepareFile(filePath) {
    const resolved = path.resolve(String(filePath));
    // Asynchronous on purpose: the main process is single-threaded, and reading plus
    // base64-encoding up to twelve 8 MB files synchronously froze the window, the tray
    // and every IPC handler for seconds while Windows painted "Not responding".
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
      data: (await fileSystem.readFile(resolved)).toString("base64"),
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
};
