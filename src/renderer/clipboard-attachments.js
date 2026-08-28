(function exposeClipboardAttachments(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.clipboardAttachments = api;
}(typeof globalThis === "object" ? globalThis : this, () => {
  const MAX_ATTACHMENTS = 12;
  const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
  const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

  function clipboardFiles(dataTransfer) {
    const primary = Array.from(dataTransfer?.files || []);
    const candidates = primary.length
      ? primary
      : Array.from(dataTransfer?.items || [])
        .filter((item) => item?.kind === "file")
        .map((item) => item.getAsFile?.())
        .filter(Boolean);
    const seen = new Set();
    return candidates.filter((file) => {
      if (seen.has(file)) return false;
      seen.add(file);
      return true;
    });
  }

  function safeName(value, mediaType) {
    const name = String(value || "").split(/[\\/]/).at(-1).trim().slice(0, 120);
    if (name) return name;
    const extension = mediaType === "image/jpeg" ? "jpg" : mediaType.split("/")[1] || "png";
    return `clipboard-image.${extension}`;
  }

  function base64FromBytes(bytes) {
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
  }

  async function digestHex(bytes, subtle = globalThis.crypto?.subtle) {
    if (subtle?.digest) {
      const digest = new Uint8Array(await subtle.digest("SHA-256", bytes));
      return [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
    }
    // Web Crypto is present in Electron, but keep deterministic dedupe for unit-test
    // and degraded runtimes without treating this non-security fallback as identity.
    let hash = 0x811c9dc5;
    for (const value of bytes) hash = Math.imul(hash ^ value, 0x01000193) >>> 0;
    return hash.toString(16).padStart(8, "0");
  }

  async function rawImageAttachment(file, options = {}) {
    const mediaType = String(file?.type || "").toLowerCase();
    if (!IMAGE_TYPES.has(mediaType)) throw new Error("Clipboard item has no readable file path and is not a supported image");
    const size = Number(file?.size);
    if (!Number.isFinite(size) || size < 1) throw new Error("Clipboard image is empty");
    if (size > (options.maxImageBytes || MAX_IMAGE_BYTES)) {
      throw new Error(`Clipboard image exceeds the ${Math.round((options.maxImageBytes || MAX_IMAGE_BYTES) / (1024 * 1024))} MB image limit`);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length !== size) throw new Error("Clipboard image size changed while reading");
    const digest = await digestHex(bytes, options.subtle);
    const name = safeName(file.name, mediaType);
    return {
      kind: "image",
      mediaType,
      data: base64FromBytes(bytes),
      name,
      path: `clipboard:${digest}`,
      bytes: bytes.length,
    };
  }

  async function prepareClipboard(dataTransfer, {
    pathForFile,
    prepareFiles,
    maxAttachments = MAX_ATTACHMENTS,
    maxImageBytes = MAX_IMAGE_BYTES,
    subtle,
  } = {}) {
    const files = clipboardFiles(dataTransfer);
    if (!files.length) return null;
    const failures = [];
    if (files.length > maxAttachments) {
      failures.push({ name: "Clipboard", error: `Only the first ${maxAttachments} attachments were prepared` });
    }
    const selected = files.slice(0, maxAttachments);
    const paths = [];
    const rawFiles = [];
    for (const file of selected) {
      let filePath = "";
      try { filePath = String(pathForFile?.(file) || ""); } catch {}
      if (filePath) paths.push(filePath);
      else rawFiles.push(file);
    }
    const preparedPaths = paths.length
      ? await prepareFiles(paths)
      : { attachments: [], failures: [] };
    const raw = await Promise.allSettled(rawFiles.map((file) => rawImageAttachment(file, { maxImageBytes, subtle })));
    const attachments = [...(preparedPaths?.attachments || [])];
    failures.push(...(preparedPaths?.failures || []));
    raw.forEach((entry, index) => {
      if (entry.status === "fulfilled") attachments.push(entry.value);
      else failures.push({
        name: safeName(rawFiles[index]?.name, rawFiles[index]?.type || "image/png"),
        error: entry.reason instanceof Error ? entry.reason.message : String(entry.reason),
      });
    });
    const seenPaths = new Set();
    return {
      attachments: attachments.filter((attachment) => {
        const key = String(attachment?.path || "");
        if (!key || seenPaths.has(key)) return false;
        seenPaths.add(key);
        return true;
      }),
      failures,
    };
  }

  return { IMAGE_TYPES, MAX_ATTACHMENTS, MAX_IMAGE_BYTES, clipboardFiles, prepareClipboard, rawImageAttachment };
}));
