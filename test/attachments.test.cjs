const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { MAX_ATTACHMENTS, createAttachmentReader } = require("../src/attachments.cjs");

// A fake disk keyed by resolved path, so these rules can be exercised without Electron
// and without touching the real filesystem.
function fakeFileSystem(entries) {
  return {
    async stat(candidate) {
      const entry = entries[path.resolve(candidate)];
      if (!entry) {
        const error = new Error(`ENOENT: no such file, stat '${candidate}'`);
        error.code = "ENOENT";
        throw error;
      }
      return { isFile: () => entry.isFile !== false, size: entry.size ?? 0 };
    },
    async readFile(candidate) {
      const entry = entries[path.resolve(candidate)];
      if (entry?.unreadable) throw new Error("EACCES: permission denied");
      return Buffer.from(entry?.contents ?? "");
    },
  };
}

test("an image under the ceiling becomes an inline content block", async () => {
  const file = path.resolve("/tmp/shot.png");
  const { prepareFile } = createAttachmentReader({
    fileSystem: fakeFileSystem({ [file]: { size: 10, contents: "hello" } }),
  });

  const attachment = await prepareFile(file);
  assert.equal(attachment.kind, "image");
  assert.equal(attachment.mediaType, "image/png");
  assert.equal(attachment.data, Buffer.from("hello").toString("base64"));
  assert.equal(attachment.bytes, 10);
  assert.equal(attachment.name, "shot.png");
});

test("an oversized image is refused by name so the user knows which file", async () => {
  const file = path.resolve("/tmp/huge.jpg");
  const { prepareFile } = createAttachmentReader({
    fileSystem: fakeFileSystem({ [file]: { size: 9 * 1024 * 1024 } }),
    maxImageBytes: 8 * 1024 * 1024,
  });

  await assert.rejects(prepareFile(file), /huge\.jpg exceeds the 8 MB image limit/);
});

test("a video attaches by reference and a missing preview is not a failure", async () => {
  const file = path.resolve("/tmp/clip.mp4");
  const entries = { [file]: { size: 999 } };

  const withPreview = createAttachmentReader({
    fileSystem: fakeFileSystem(entries),
    makeThumbnail: async () => "UE5H",
  });
  const previewed = await withPreview.prepareFile(file);
  assert.equal(previewed.previewKind, "video");
  assert.equal(previewed.thumbnailData, "UE5H");
  assert.equal(previewed.thumbnailMediaType, "image/png");

  // A thumbnailer that throws must not cost the user the attachment itself.
  const withoutPreview = createAttachmentReader({
    fileSystem: fakeFileSystem(entries),
    makeThumbnail: async () => { throw new Error("no decoder"); },
  });
  const plain = await withoutPreview.prepareFile(file);
  assert.equal(plain.kind, "reference");
  assert.equal(plain.thumbnailData, "");
  assert.equal(plain.thumbnailMediaType, "");
});

test("an unknown extension attaches as a plain local reference", async () => {
  const file = path.resolve("/tmp/notes.tar.zst");
  const { prepareFile } = createAttachmentReader({
    fileSystem: fakeFileSystem({ [file]: { size: 5 } }),
  });

  const attachment = await prepareFile(file);
  assert.deepEqual(attachment, {
    kind: "reference",
    previewKind: "file",
    path: file,
    name: "notes.tar.zst",
  });
});

test("one bad file does not sink the batch", async () => {
  const good = path.resolve("/tmp/a.png");
  const missing = path.resolve("/tmp/gone.png");
  const oversized = path.resolve("/tmp/big.png");
  const { prepareFiles } = createAttachmentReader({
    fileSystem: fakeFileSystem({
      [good]: { size: 4, contents: "ok" },
      [oversized]: { size: 50 },
    }),
    maxImageBytes: 10,
  });

  const { attachments, failures } = await prepareFiles([good, missing, oversized]);
  // The whole selection used to be rejected, leaving the user with nothing and no
  // indication of which file was at fault.
  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].name, "a.png");
  assert.deepEqual(failures.map((failure) => failure.name).sort(), ["big.png", "gone.png"]);
  assert.match(failures.find((failure) => failure.name === "big.png").error, /exceeds/);
});

test("duplicates collapse and the batch is capped", async () => {
  const entries = {};
  const paths = [];
  for (let index = 0; index < MAX_ATTACHMENTS + 5; index += 1) {
    const file = path.resolve(`/tmp/file-${index}.png`);
    entries[file] = { size: 1, contents: "x" };
    paths.push(file, file);
  }
  const { prepareFiles } = createAttachmentReader({ fileSystem: fakeFileSystem(entries) });

  const { attachments, failures } = await prepareFiles(paths);
  assert.equal(failures.length, 0);
  assert.equal(attachments.length, MAX_ATTACHMENTS);
  assert.equal(new Set(attachments.map((entry) => entry.path)).size, MAX_ATTACHMENTS);
});

test("a directory is refused rather than read", async () => {
  const directory = path.resolve("/tmp/folder");
  const { prepareFile } = createAttachmentReader({
    fileSystem: fakeFileSystem({ [directory]: { isFile: false } }),
  });

  await assert.rejects(prepareFile(directory), /Not a file/);
});
