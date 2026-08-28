const test = require("node:test");
const assert = require("node:assert/strict");

const { clipboardFiles, prepareClipboard, rawImageAttachment } = require("../src/renderer/clipboard-attachments.js");

function file({ name = "clip.png", type = "image/png", bytes = [1, 2, 3], lastModified = 1 } = {}) {
  const content = Uint8Array.from(bytes);
  return { name, type, size: content.length, lastModified, arrayBuffer: async () => content.buffer };
}

test("plain text paste stays native because it is not treated as attachments", async () => {
  let prepared = false;
  const result = await prepareClipboard({ files: [], items: [{ kind: "string" }] }, {
    pathForFile: () => "",
    prepareFiles: async () => { prepared = true; },
  });
  assert.equal(result, null);
  assert.equal(prepared, false);
});

test("copied filesystem files use their Electron paths and the existing safe reader", async () => {
  const copied = file({ name: "notes.txt", type: "text/plain" });
  let itemFallbackUsed = false;
  const dataTransfer = { files: [copied], items: [{ kind: "file", getAsFile: () => { itemFallbackUsed = true; return copied; } }] };
  let paths;
  const result = await prepareClipboard(dataTransfer, {
    pathForFile: () => "C:\\work\\notes.txt",
    prepareFiles: async (value) => {
      paths = value;
      return { attachments: [{ kind: "reference", path: value[0], name: "notes.txt" }], failures: [] };
    },
  });
  assert.deepEqual(paths, ["C:\\work\\notes.txt"]);
  assert.equal(result.attachments[0].name, "notes.txt");
  assert.equal(clipboardFiles(dataTransfer).length, 1, "DataTransfer files/items duplicates must collapse");
  assert.equal(itemFallbackUsed, false, "DataTransfer.files must be authoritative when populated");
});

test("distinct same-metadata files survive while path and digest duplicates collapse", async () => {
  const first = file({ name: "same.png", bytes: [1, 2, 3], lastModified: 7 });
  const second = file({ name: "same.png", bytes: [4, 5, 6], lastModified: 7 });
  const paths = new Map([[first, "C:\\one\\same.png"], [second, "C:\\two\\same.png"]]);
  const filesystem = await prepareClipboard({ files: [first, second] }, {
    pathForFile: (value) => paths.get(value),
    prepareFiles: async (values) => ({
      attachments: [...values, values[0]].map((path) => ({ kind: "image", path, name: "same.png" })),
      failures: [],
    }),
  });
  assert.deepEqual(filesystem.attachments.map((entry) => entry.path), ["C:\\one\\same.png", "C:\\two\\same.png"]);

  const subtle = { digest: async () => Uint8Array.from([0xaa, 0xbb, 0xcc, 0xdd]).buffer };
  const raw = await prepareClipboard({ files: [], items: [
    { kind: "file", getAsFile: () => first },
    { kind: "file", getAsFile: () => second },
  ] }, { pathForFile: () => "", subtle });
  assert.equal(raw.attachments.length, 1, "equal content digests must collapse after reading");
});

test("a pathless clipboard bitmap is bounded, encoded and content-dedupable", async () => {
  const subtle = { digest: async () => Uint8Array.from([0xaa, 0xbb, 0xcc, 0xdd]).buffer };
  const attachment = await rawImageAttachment(file(), { subtle });
  assert.deepEqual(attachment, {
    kind: "image",
    mediaType: "image/png",
    data: "AQID",
    name: "clip.png",
    path: "clipboard:aabbccdd",
    bytes: 3,
  });

  await assert.rejects(
    rawImageAttachment(file({ bytes: [1, 2, 3, 4] }), { maxImageBytes: 3, subtle }),
    /exceeds the 0 MB image limit/,
  );
  await assert.rejects(
    rawImageAttachment(file({ name: "notes.txt", type: "text/plain" }), { subtle }),
    /not a supported image/,
  );
});

test("clipboard batches report the limit instead of silently dropping extra items", async () => {
  const files = Array.from({ length: 14 }, (_, index) => file({ name: `${index}.png`, lastModified: index }));
  const result = await prepareClipboard({ files }, {
    maxAttachments: 12,
    pathForFile: (value) => `C:\\clips\\${value.name}`,
    prepareFiles: async (paths) => ({ attachments: paths.map((path) => ({ kind: "image", path })), failures: [] }),
  });
  assert.equal(result.attachments.length, 12);
  assert.match(result.failures[0].error, /first 12 attachments/);
});
