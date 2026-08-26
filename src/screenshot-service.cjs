const path = require("node:path");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const { randomUUID } = require("node:crypto");

const CAPTURE_FILE_PATTERN = /^(?:screen|region)-[a-zA-Z0-9_.-]+\.png$/;
const DEFAULT_CAPTURE_RETENTION_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_CAPTURE_FILES = 32;
const DEFAULT_MAX_CLEANUP_DELETES = 64;
const DEFAULT_MAX_CLEANUP_SCAN = 256;

class ScreenshotError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ScreenshotError";
    this.code = details.code || "screenshot-error";
    Object.assign(this, details);
  }
}

function finiteRect(value) {
  if (!value || typeof value !== "object") return null;
  const rect = Object.fromEntries(["x", "y", "width", "height"].map((key) => [key, Number(value[key])]));
  return Object.values(rect).every(Number.isFinite) && rect.width > 0 && rect.height > 0 ? rect : null;
}

function containsRect(container, child) {
  return child.x >= container.x
    && child.y >= container.y
    && child.x + child.width <= container.x + container.width
    && child.y + child.height <= container.y + container.height;
}

function createScreenshotService({
  desktopCapturer,
  screen,
  platform = process.platform,
  tempRoot,
  fileSystem = fsPromises,
  syncFileSystem = fs,
  selectRegion = null,
  now = () => Date.now(),
  makeId = randomUUID,
} = {}) {
  const root = path.resolve(String(tempRoot || ""));
  if (!tempRoot || root === path.parse(root).root) throw new TypeError("A narrow app temp root is required");
  const captureDirectory = path.join(root, "neoxider-agent-deck", "captures");
  const fullAvailable = Boolean(desktopCapturer?.getSources && screen?.getAllDisplays);
  const regionAvailable = fullAvailable && platform === "win32" && typeof selectRegion === "function";

  function capturePath(filePath) {
    const resolved = path.resolve(String(filePath || ""));
    const relative = path.relative(captureDirectory, resolved);
    return relative
      && !relative.startsWith("..")
      && !path.isAbsolute(relative)
      && path.dirname(relative) === "."
      && CAPTURE_FILE_PATTERN.test(relative)
      ? resolved
      : null;
  }

  function capabilities() {
    return {
      display: {
        available: fullAvailable,
        reason: fullAvailable ? "" : "desktop-capturer-unavailable",
      },
      region: {
        available: regionAvailable,
        reason: regionAvailable
          ? ""
          : platform !== "win32"
            ? "region-selection-unsupported-on-platform"
            : !fullAvailable
              ? "desktop-capturer-unavailable"
              : "region-selector-not-configured",
      },
    };
  }

  function displays() {
    const values = fullAvailable ? screen.getAllDisplays() : [];
    return Array.isArray(values) ? values : [];
  }

  function findDisplay(values, { displayId, point } = {}) {
    if (!values.length) throw new ScreenshotError("No displays are available", { code: "no-displays" });
    if (displayId !== undefined && displayId !== null) {
      const match = values.find((display) => String(display.id) === String(displayId));
      if (!match) throw new ScreenshotError(`Display is unavailable: ${displayId}`, { code: "display-not-found", displayId });
      return match;
    }
    if (point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)) && typeof screen.getDisplayNearestPoint === "function") {
      return screen.getDisplayNearestPoint({ x: Math.round(Number(point.x)), y: Math.round(Number(point.y)) });
    }
    return typeof screen.getPrimaryDisplay === "function" ? screen.getPrimaryDisplay() : values[0];
  }

  async function snapshot(display) {
    const thumbnailSize = {
      width: Math.max(1, Math.ceil(Number(display.size?.width || display.bounds?.width || 1) * Number(display.scaleFactor || 1))),
      height: Math.max(1, Math.ceil(Number(display.size?.height || display.bounds?.height || 1) * Number(display.scaleFactor || 1))),
    };
    let sources;
    try {
      sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize, fetchWindowIcons: false });
    } catch (cause) {
      throw new ScreenshotError("Desktop capture failed or permission was denied", { code: "capture-failed", cause });
    }
    const source = sources.find((candidate) => String(candidate.display_id) === String(display.id))
      || (sources.length === 1 ? sources[0] : null);
    if (!source?.thumbnail || source.thumbnail.isEmpty?.()) {
      throw new ScreenshotError("The selected display returned no capturable pixels", { code: "empty-capture", displayId: display.id });
    }
    return source.thumbnail;
  }

  async function save(image, kind) {
    if (!image || image.isEmpty?.()) throw new ScreenshotError("Capture is empty", { code: "empty-capture" });
    const png = image.toPNG();
    if (!Buffer.isBuffer(png) || png.length === 0) throw new ScreenshotError("Capture could not be encoded as PNG", { code: "empty-png" });
    await fileSystem.mkdir(captureDirectory, { recursive: true });
    const stamp = new Date(now()).toISOString().replace(/[:.]/g, "-");
    const safeId = String(makeId()).replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64) || "capture";
    const filePath = path.join(captureDirectory, `${kind}-${stamp}-${safeId}.png`);
    await fileSystem.writeFile(filePath, png, { flag: "wx", mode: 0o600 });
    return filePath;
  }

  async function captureDisplay(options = {}) {
    if (!fullAvailable) return { ok: false, canceled: false, reason: "desktop-capturer-unavailable" };
    const values = displays();
    const display = findDisplay(values, options);
    const image = await snapshot(display);
    const filePath = await save(image, "screen");
    return { ok: true, canceled: false, kind: "screen", path: filePath, displayId: display.id, bounds: { ...display.bounds } };
  }

  async function captureRegion() {
    const support = capabilities().region;
    if (!support.available) return { ok: false, canceled: false, reason: support.reason };
    const values = displays();
    const selection = await selectRegion({
      displays: values.map((display) => ({ id: display.id, bounds: { ...display.bounds }, scaleFactor: display.scaleFactor })),
      coordinateSpace: "dip",
      cancelKey: "Escape",
      constrainToDisplay: true,
    });
    if (!selection || selection.canceled) return { ok: false, canceled: true, reason: "canceled" };
    const bounds = finiteRect(selection.bounds);
    if (!bounds) throw new ScreenshotError("Selected region is empty or invalid", { code: "invalid-region" });
    const display = findDisplay(values, { displayId: selection.displayId });
    if (!containsRect(display.bounds, bounds)) {
      throw new ScreenshotError("Selected region must stay within one display", { code: "region-outside-display", displayId: display.id });
    }
    const image = await snapshot(display);
    const imageSize = image.getSize();
    const scaleX = imageSize.width / display.bounds.width;
    const scaleY = imageSize.height / display.bounds.height;
    const crop = {
      x: Math.max(0, Math.round((bounds.x - display.bounds.x) * scaleX)),
      y: Math.max(0, Math.round((bounds.y - display.bounds.y) * scaleY)),
      width: Math.max(1, Math.round(bounds.width * scaleX)),
      height: Math.max(1, Math.round(bounds.height * scaleY)),
    };
    crop.width = Math.min(crop.width, imageSize.width - crop.x);
    crop.height = Math.min(crop.height, imageSize.height - crop.y);
    if (crop.width < 1 || crop.height < 1) throw new ScreenshotError("Selected region contains no capturable pixels", { code: "empty-region" });
    const cropped = image.crop(crop);
    const filePath = await save(cropped, "region");
    return { ok: true, canceled: false, kind: "region", path: filePath, displayId: display.id, bounds, pixelBounds: crop };
  }

  async function removeCapture(filePath) {
    const resolved = capturePath(filePath);
    if (!resolved) {
      throw new ScreenshotError("Only app-owned captures can be removed", { code: "capture-path-outside-temp" });
    }
    await fileSystem.rm(resolved, { force: true });
    return true;
  }

  function cleanupCaptures({
    maxAgeMs = DEFAULT_CAPTURE_RETENTION_MS,
    maxFiles = DEFAULT_MAX_CAPTURE_FILES,
    maxDeletes = DEFAULT_MAX_CLEANUP_DELETES,
    maxScanEntries = DEFAULT_MAX_CLEANUP_SCAN,
  } = {}) {
    const scanLimit = Math.max(0, Math.min(DEFAULT_MAX_CLEANUP_SCAN, Math.floor(Number(maxScanEntries) || 0)));
    const deleteLimit = Math.max(0, Math.min(DEFAULT_MAX_CLEANUP_DELETES, Math.floor(Number(maxDeletes) || 0)));
    const keepLimit = Math.max(0, Math.floor(Number(maxFiles) || 0));
    const ageLimit = Math.max(0, Number(maxAgeMs) || 0);
    if (!scanLimit || !deleteLimit) return { scanned: 0, deleted: 0, failures: 0 };

    let entries;
    try {
      entries = syncFileSystem.readdirSync(captureDirectory, { withFileTypes: true }).slice(0, scanLimit);
    } catch (error) {
      if (error?.code === "ENOENT") return { scanned: 0, deleted: 0, failures: 0 };
      return { scanned: 0, deleted: 0, failures: 1 };
    }

    const candidates = [];
    for (const entry of entries) {
      if (!entry?.isFile?.() || !CAPTURE_FILE_PATTERN.test(entry.name)) continue;
      const resolved = capturePath(path.join(captureDirectory, entry.name));
      if (!resolved) continue;
      try {
        const info = syncFileSystem.statSync(resolved);
        if (info.isFile()) candidates.push({ path: resolved, mtimeMs: Number(info.mtimeMs) || 0 });
      } catch {}
    }
    candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);

    const cutoff = now() - ageLimit;
    let deleted = 0;
    let failures = 0;
    for (let index = 0; index < candidates.length && deleted < deleteLimit; index += 1) {
      const candidate = candidates[index];
      if (index < keepLimit && candidate.mtimeMs >= cutoff) continue;
      try {
        syncFileSystem.rmSync(candidate.path, { force: true });
        deleted += 1;
      } catch {
        failures += 1;
      }
    }
    return { scanned: candidates.length, deleted, failures };
  }

  return {
    capabilities,
    captureDirectory,
    captureDisplay,
    captureRegion,
    cleanupCaptures,
    ownsCapture: (filePath) => Boolean(capturePath(filePath)),
    removeCapture,
  };
}

function createScreenshotCaptureGate() {
  let active = false;
  return {
    isActive: () => active,
    async run(operation) {
      if (active) return { ok: false, canceled: false, reason: "capture-busy" };
      active = true;
      try {
        return await operation();
      } finally {
        active = false;
      }
    },
  };
}

module.exports = {
  CAPTURE_FILE_PATTERN,
  ScreenshotError,
  containsRect,
  createScreenshotCaptureGate,
  createScreenshotService,
  finiteRect,
};
