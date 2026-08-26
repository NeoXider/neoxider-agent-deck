const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createScreenshotCaptureGate, createScreenshotService } = require("../src/screenshot-service.cjs");

function image(width, height, png = "PNG") {
  return {
    crops: [],
    isEmpty: () => false,
    getSize: () => ({ width, height }),
    toPNG: () => Buffer.from(png),
    crop(rect) {
      this.crops.push(rect);
      return image(rect.width, rect.height, `CROP:${JSON.stringify(rect)}`);
    },
  };
}

function fixture({ platform = "win32", selectRegion = null, sources = null } = {}) {
  const leftImage = image(2560, 2048);
  const rightImage = image(1920, 1080);
  const displays = [
    { id: 11, bounds: { x: -1280, y: 0, width: 1280, height: 1024 }, size: { width: 1280, height: 1024 }, scaleFactor: 2 },
    { id: 22, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, size: { width: 1920, height: 1080 }, scaleFactor: 1 },
  ];
  const calls = { getSources: [], mkdir: [], write: [], rm: [] };
  const desktopCapturer = {
    async getSources(options) {
      calls.getSources.push(options);
      return sources || [
        { display_id: "11", thumbnail: leftImage },
        { display_id: "22", thumbnail: rightImage },
      ];
    },
  };
  const screen = {
    getAllDisplays: () => displays,
    getPrimaryDisplay: () => displays[1],
    getDisplayNearestPoint: (point) => point.x < 0 ? displays[0] : displays[1],
  };
  const fileSystem = {
    async mkdir(...args) { calls.mkdir.push(args); },
    async writeFile(...args) { calls.write.push(args); },
    async rm(...args) { calls.rm.push(args); },
  };
  const service = createScreenshotService({
    desktopCapturer,
    screen,
    platform,
    tempRoot: path.resolve("C:/app-temp"),
    fileSystem,
    selectRegion,
    now: () => Date.UTC(2026, 7, 27, 10, 11, 12),
    makeId: () => "safe-id",
  });
  return { calls, displays, leftImage, rightImage, service };
}

test("full-display capture maps Electron display_id and writes a private PNG under app temp", async () => {
  const { calls, service } = fixture();
  const result = await service.captureDisplay({ displayId: 11 });
  assert.equal(result.ok, true);
  assert.equal(result.displayId, 11);
  assert.equal(result.kind, "screen");
  assert.equal(path.dirname(result.path), service.captureDirectory);
  assert.match(path.basename(result.path), /^screen-2026-08-27T10-11-12-000Z-safe-id\.png$/);
  assert.deepEqual(calls.getSources[0], { types: ["screen"], thumbnailSize: { width: 2560, height: 2048 }, fetchWindowIcons: false });
  assert.deepEqual(calls.write[0][2], { flag: "wx", mode: 0o600 });
  assert.equal(calls.write[0][1].toString(), "PNG");
});

test("Windows region selection preserves negative monitor coordinates and mixed-DPI pixels", async () => {
  const selection = { displayId: 11, bounds: { x: -1200, y: 100, width: 200, height: 150 } };
  let contract;
  const { calls, leftImage, service } = fixture({ selectRegion: async (value) => { contract = value; return selection; } });
  const result = await service.captureRegion();
  assert.equal(contract.coordinateSpace, "dip");
  assert.equal(contract.cancelKey, "Escape");
  assert.equal(contract.constrainToDisplay, true);
  assert.deepEqual(contract.displays.map(({ id }) => id), [11, 22]);
  assert.deepEqual(result.pixelBounds, { x: 160, y: 200, width: 400, height: 300 });
  assert.deepEqual(leftImage.crops, [result.pixelBounds]);
  assert.equal(calls.write[0][1].toString(), `CROP:${JSON.stringify(result.pixelBounds)}`);
});

test("Escape/cancel creates no file and no attachment side effect", async () => {
  const { calls, service } = fixture({ selectRegion: async () => ({ canceled: true }) });
  const result = await service.captureRegion();
  assert.deepEqual(result, { ok: false, canceled: true, reason: "canceled" });
  assert.equal(calls.mkdir.length, 0);
  assert.equal(calls.write.length, 0);
  assert.equal("attachment" in result, false);
});

test("region capture degrades explicitly outside Windows while full display remains available", async () => {
  const { calls, service } = fixture({ platform: "darwin", selectRegion: async () => { throw new Error("must not run"); } });
  assert.deepEqual(service.capabilities(), {
    display: { available: true, reason: "" },
    region: { available: false, reason: "region-selection-unsupported-on-platform" },
  });
  assert.deepEqual(await service.captureRegion(), { ok: false, canceled: false, reason: "region-selection-unsupported-on-platform" });
  assert.equal(calls.getSources.length, 0);
  assert.equal((await service.captureDisplay()).ok, true);
});

test("a region that crosses displays is rejected instead of cropping the wrong pixels", async () => {
  const { calls, service } = fixture({
    selectRegion: async () => ({ displayId: 11, bounds: { x: -100, y: 100, width: 200, height: 100 } }),
  });
  await assert.rejects(service.captureRegion(), { code: "region-outside-display" });
  assert.equal(calls.getSources.length, 0);
  assert.equal(calls.write.length, 0);
});

test("empty or protected display frames fail explicitly and never become blank attachments", async () => {
  const empty = image(1920, 1080);
  empty.isEmpty = () => true;
  const { calls, service } = fixture({ sources: [{ display_id: "22", thumbnail: empty }] });
  await assert.rejects(service.captureDisplay({ displayId: 22 }), { code: "empty-capture" });
  assert.equal(calls.write.length, 0);
});

test("cleanup cannot delete anything outside the app-owned capture directory", async () => {
  const { calls, service } = fixture();
  await assert.rejects(service.removeCapture(path.resolve("C:/Users/User/document.png")), { code: "capture-path-outside-temp" });
  await assert.rejects(service.removeCapture(path.join(service.captureDirectory, "nested", "screen-owned.png")), { code: "capture-path-outside-temp" });
  const owned = path.join(service.captureDirectory, "screen-owned.png");
  assert.equal(await service.removeCapture(owned), true);
  assert.deepEqual(calls.rm, [[owned, { force: true }]]);
});

test("capture gate rejects concurrent display or region work and unlocks after completion", async () => {
  const gate = createScreenshotCaptureGate();
  let release;
  const first = gate.run(() => new Promise((resolve) => { release = resolve; }));
  assert.equal(gate.isActive(), true);
  assert.deepEqual(await gate.run(async () => ({ ok: true })), {
    ok: false,
    canceled: false,
    reason: "capture-busy",
  });
  release({ ok: true, kind: "region" });
  assert.deepEqual(await first, { ok: true, kind: "region" });
  assert.equal(gate.isActive(), false);
  assert.deepEqual(await gate.run(async () => ({ ok: true, kind: "display" })), { ok: true, kind: "display" });
});

test("bounded cleanup removes only direct app-owned captures and keeps unrelated temp files", () => {
  const scratchRoot = path.resolve("tmp");
  fs.mkdirSync(scratchRoot, { recursive: true });
  const tempRoot = fs.mkdtempSync(path.join(scratchRoot, "agent-deck-capture-cleanup-"));
  try {
    const service = createScreenshotService({ tempRoot });
    fs.mkdirSync(service.captureDirectory, { recursive: true });
    const oldCapture = path.join(service.captureDirectory, "screen-old.png");
    const newCapture = path.join(service.captureDirectory, "region-new.png");
    const unrelated = path.join(service.captureDirectory, "notes.txt");
    const nestedDirectory = path.join(service.captureDirectory, "nested");
    const nestedCapture = path.join(nestedDirectory, "screen-nested.png");
    fs.writeFileSync(oldCapture, "old");
    fs.writeFileSync(newCapture, "new");
    fs.writeFileSync(unrelated, "keep");
    fs.mkdirSync(nestedDirectory);
    fs.writeFileSync(nestedCapture, "keep nested");
    fs.utimesSync(oldCapture, new Date(0), new Date(0));

    const result = service.cleanupCaptures({ maxAgeMs: 24 * 60 * 60 * 1000, maxFiles: 1, maxDeletes: 1 });
    assert.deepEqual(result, { scanned: 2, deleted: 1, failures: 0 });
    assert.equal(fs.existsSync(oldCapture), false);
    assert.equal(fs.existsSync(newCapture), true);
    assert.equal(fs.existsSync(unrelated), true);
    assert.equal(fs.existsSync(nestedCapture), true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
