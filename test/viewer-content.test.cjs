const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { LIMITS, itemFromBuffer, kindOf, looksBinary, readViewerItem, resolveViewerPath, stripLineSuffix } = require("../src/viewer-content.cjs");
const { highlightCode, renderMarkdown } = require("../src/markdown.cjs");

const render = { renderMarkdown, highlight: highlightCode };

// A tiny in-memory file system with the calls readViewerItem makes.
function memoryFs(files) {
  const entries = new Map(Object.entries(files).map(([name, value]) => [name, value]));
  return {
    statSync(name) {
      if (!entries.has(name)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      const value = entries.get(name);
      if (value === "<dir>") return { isDirectory: () => true, isFile: () => false, size: 0 };
      return { isDirectory: () => false, isFile: () => true, size: value.length };
    },
    openSync: (name) => name,
    readSync(name, buffer, offset, length, position) {
      const source = entries.get(name);
      return source.copy(buffer, offset, position, position + length);
    },
    closeSync() {},
    readFileSync: (name) => entries.get(name),
  };
}

test("a path an agent writes resolves on this machine, relative ones against the chat's folder", () => {
  const win = { platform: "win32", home: "C:\\Users\\me" };
  assert.equal(resolveViewerPath("docs/plan.md", { ...win, cwd: "D:\\Git\\deck" }), "D:\\Git\\deck\\docs\\plan.md");
  assert.equal(resolveViewerPath("..\\notes.txt", { ...win, cwd: "D:\\Git\\deck" }), "D:\\Git\\notes.txt");
  assert.equal(resolveViewerPath("D:\\logs\\run.txt", win), "D:\\logs\\run.txt");
  assert.equal(resolveViewerPath("file:///C:/shots/a%20b.png", win), "C:\\shots\\a b.png");
  assert.equal(resolveViewerPath("~/notes.md", win), "C:\\Users\\me\\notes.md");
  assert.equal(resolveViewerPath("`src/app.js`", { ...win, cwd: "D:\\deck" }), "D:\\deck\\src\\app.js");
  assert.equal(resolveViewerPath("/var/log/x.log", { platform: "linux", home: "/home/me" }), "/var/log/x.log");
  // Without the chat's folder a relative path names nothing; a web address is not a file.
  assert.equal(resolveViewerPath("docs/plan.md", win), null);
  assert.equal(resolveViewerPath("https://example.com/a.md", { ...win, cwd: "D:\\deck" }), null);
  assert.equal(resolveViewerPath("javascript:alert(1)", { ...win, cwd: "D:\\deck" }), null);
  assert.equal(resolveViewerPath("a\0b", { ...win, cwd: "D:\\deck" }), null);
});

test("a line number after a file opens the file at that line", () => {
  assert.deepEqual(stripLineSuffix("src/app.js:42"), { file: "src/app.js", line: 42 });
  assert.deepEqual(stripLineSuffix("D:\\x\\notes.md:7:3"), { file: "D:\\x\\notes.md", line: 7 });
  assert.deepEqual(stripLineSuffix("D:\\x\\notes.md"), { file: "D:\\x\\notes.md", line: null });
});

test("files are sorted into what the viewer can draw", () => {
  assert.equal(kindOf("shot.PNG"), "image");
  assert.equal(kindOf("plan.md"), "markdown");
  assert.equal(kindOf("app.cjs"), "text");
  assert.equal(kindOf("Dockerfile"), "text");
  assert.equal(kindOf("LICENSE"), "text");
  assert.equal(kindOf("archive.zip"), "unknown");
  assert.equal(kindOf("blob", "image/webp"), "image");
  assert.equal(kindOf("notes", "text/plain"), "text");
  assert.equal(looksBinary(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01])), true);
  assert.equal(looksBinary(Buffer.from("plain text\nwith lines\n")), false);
});

test("Markdown renders like a chat reply; code is highlighted with its line count", () => {
  const files = memoryFs({
    "D:\\deck\\plan.md": Buffer.from("# Plan\r\n\r\n- [x] [notes](notes.md)\r\n<script>alert(1)</script>\r\n"),
    "D:\\deck\\app.js": Buffer.from("const a = 1;\nfunction b() { return a; }\n"),
  });
  const doc = readViewerItem("D:\\deck\\plan.md", { fileSystem: files, ...render });
  assert.equal(doc.kind, "markdown");
  assert.match(doc.html, /<h1>Plan<\/h1>/);
  assert.match(doc.html, /data-file="notes\.md"/, "a link to a file keeps its path for the viewer");
  assert.doesNotMatch(doc.html, /<script/);
  assert.equal(doc.text.includes("\r"), false);
  const code = readViewerItem("D:\\deck\\app.js", { fileSystem: files, ...render, line: 2 });
  assert.equal(code.kind, "text");
  assert.equal(code.language, "javascript");
  assert.match(code.html, /class="hljs-keyword"/);
  assert.equal(code.lineCount, 3);
  assert.equal(code.line, 2);
});

test("a missing file, a folder and a binary file say so instead of failing", () => {
  const files = memoryFs({ "D:\\deck": "<dir>", "D:\\deck\\a.bin": Buffer.from([1, 0, 2, 0, 3]) });
  assert.equal(readViewerItem("D:\\deck\\gone.md", { fileSystem: files, ...render }).kind, "missing");
  assert.equal(readViewerItem("D:\\deck", { fileSystem: files, ...render }).kind, "folder");
  assert.equal(readViewerItem("D:\\deck\\a.bin", { fileSystem: files, ...render }).kind, "unknown");
});

test("a long text file shows its head, never the whole file, and says it goes on", () => {
  const size = LIMITS.textShown + 4096;
  const long = Buffer.alloc(size, 0x61);
  const item = itemFromBuffer({ name: "big.log", buffer: long.subarray(0, LIMITS.textShown), size, ...render });
  assert.equal(item.kind, "text");
  assert.equal(item.truncated, true);
  assert.equal(item.text.length, LIMITS.textShown);
  // Too long to be a whole document, Markdown is shown as its source.
  const doc = itemFromBuffer({ name: "big.md", buffer: long.subarray(0, LIMITS.textShown), size, ...render });
  assert.equal(doc.kind, "text");
});

test("an image becomes a data URL of its own type; one too large is not read", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const item = itemFromBuffer({ name: "a.png", buffer: png, ...render });
  assert.equal(item.kind, "image");
  assert.equal(item.dataUrl, `data:image/png;base64,${png.toString("base64")}`);
  const attached = itemFromBuffer({ name: "clipboard", buffer: png, mediaType: "image/jpeg", ...render });
  assert.equal(attached.dataUrl.startsWith("data:image/jpeg;base64,"), true);
  const huge = itemFromBuffer({ name: "big.png", buffer: png, size: LIMITS.image + 1, ...render });
  assert.equal(huge.kind, "unknown");
  assert.equal(path.extname("a.png"), ".png");
});
