const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { fileURLToPath } = require("node:url");

// What the viewer window shows, worked out in main: an image, a Markdown document, text or
// code, or a file it cannot show and offers to open with the system instead.
//
// A chat names files in every way an agent writes them - `src/app.js`, `./README.md`,
// `D:\Git\deck\notes.md:42`, `file:///C:/x.png`, `~/notes.txt` - and only main can read
// them. Nothing here writes, executes or follows anything: a path is resolved, checked to be
// a regular file under the size limits, and read.

const IMAGE_TYPES = Object.freeze({
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".bmp": "image/bmp", ".ico": "image/x-icon", ".svg": "image/svg+xml", ".avif": "image/avif",
});
const IMAGE_MEDIA_TYPES = new Set(Object.values(IMAGE_TYPES));
const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".mdx", ".mdown"]);
// Extension → highlight.js language. Anything else that turns out to be text is shown plain.
const CODE_LANGUAGES = Object.freeze({
  ".js": "javascript", ".cjs": "javascript", ".mjs": "javascript", ".jsx": "javascript",
  ".ts": "typescript", ".tsx": "typescript", ".mts": "typescript", ".cts": "typescript",
  ".json": "json", ".jsonc": "json", ".json5": "json", ".css": "css", ".scss": "scss", ".less": "less",
  ".html": "xml", ".htm": "xml", ".xml": "xml", ".vue": "xml", ".xaml": "xml", ".csproj": "xml", ".uxml": "xml",
  ".yml": "yaml", ".yaml": "yaml", ".toml": "ini", ".ini": "ini", ".cfg": "ini", ".conf": "ini", ".env": "ini",
  ".py": "python", ".rb": "ruby", ".rs": "rust", ".go": "go", ".java": "java", ".kt": "kotlin", ".swift": "swift",
  ".c": "c", ".h": "c", ".cpp": "cpp", ".cc": "cpp", ".hpp": "cpp", ".cs": "csharp", ".php": "php", ".lua": "lua",
  ".sh": "bash", ".bash": "bash", ".zsh": "bash", ".ps1": "powershell", ".psm1": "powershell", ".bat": "dos", ".cmd": "dos",
  ".sql": "sql", ".diff": "diff", ".patch": "diff", ".dockerfile": "dockerfile", ".gradle": "gradle", ".r": "r",
  ".shader": "cpp", ".hlsl": "cpp", ".glsl": "cpp", ".uss": "css", ".asmdef": "json", ".unity": "yaml", ".prefab": "yaml",
});
const TEXT_EXTENSIONS = new Set([".txt", ".log", ".csv", ".tsv", ".gitignore", ".gitattributes", ".editorconfig", ".lock", ".properties"]);
const TEXT_NAMES = new Set(["license", "readme", "changelog", "makefile", "dockerfile", "procfile", ".gitignore", ".npmrc", ".env"]);

const LIMITS = Object.freeze({
  image: 40 * 1024 * 1024,
  // An unknown file is looked into only below this; a known text file is shown up to
  // `textShown` whatever its size, with a note that it goes on.
  text: 4 * 1024 * 1024,
  textShown: 1024 * 1024,
  highlight: 400 * 1024,
});

// "D:\x\notes.md:42" and "src/app.js:12:3" name a line; the viewer opens the file.
function stripLineSuffix(value) {
  const match = String(value).match(/^(.+?\.[A-Za-z0-9_-]{1,12}):(\d+)(?::\d+)?$/);
  return match ? { file: match[1], line: Number(match[2]) } : { file: String(value), line: null };
}

// A path an agent wrote, as an absolute path on this machine, or null.
function resolveViewerPath(value, { cwd = "", home = os.homedir(), platform = process.platform } = {}) {
  let raw = String(value ?? "").trim().replace(/^<(.*)>$/, "$1").replace(/^["'`](.*)["'`]$/, "$1");
  if (!raw || raw.length > 4096 || raw.includes("\0")) return null;
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  if (/^file:/i.test(raw)) {
    try { raw = fileURLToPath(raw, { windows: platform === "win32" }); } catch { return null; }
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !(platform === "win32" && /^[a-z]:[\\/]/i.test(raw))) {
    return null; // http(s) and friends belong to the browser
  }
  if (/%[0-9a-f]{2}/i.test(raw)) {
    try { raw = decodeURIComponent(raw); } catch {}
  }
  if (raw === "~" || /^~[\\/]/.test(raw)) raw = pathApi.join(home, raw.slice(1));
  if (pathApi.isAbsolute(raw)) return pathApi.normalize(raw);
  const base = String(cwd || "");
  if (!base || !pathApi.isAbsolute(base)) return null;
  return pathApi.resolve(base, raw);
}

function extensionOf(name) {
  const base = path.basename(String(name || "")).toLowerCase();
  if (base === "dockerfile") return ".dockerfile";
  return path.extname(base);
}

function looksBinary(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  if (!sample.length) return false;
  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 0) return true;
    if (byte < 7 || (byte > 14 && byte < 32 && byte !== 27)) suspicious += 1;
  }
  return suspicious / sample.length > 0.1;
}

// By name first, then by the media type an attachment carries.
function kindOf(name, mediaType = "") {
  const extension = extensionOf(name);
  const type = String(mediaType || "").toLowerCase();
  if (IMAGE_TYPES[extension] || IMAGE_MEDIA_TYPES.has(type)) return "image";
  if (MARKDOWN_EXTENSIONS.has(extension) || type === "text/markdown") return "markdown";
  if (CODE_LANGUAGES[extension] || TEXT_EXTENSIONS.has(extension) || TEXT_NAMES.has(path.basename(String(name || "")).toLowerCase())) return "text";
  if (type.startsWith("text/") || type === "application/json" || type === "application/xml") return "text";
  return "unknown";
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

// What the viewer shows for these bytes. `buffer` may be the head of a longer file (`size`
// says how long). `renderMarkdown` and `highlight` come from markdown.cjs, so a document
// reads exactly like a reply in the chat.
function itemFromBuffer({ name, filePath = "", buffer, size = buffer.length, mediaType = "", renderMarkdown, highlight, line = null }) {
  const base = { name: String(name || path.basename(filePath) || "File"), path: filePath, size };
  const kind = kindOf(base.name, mediaType);
  if (kind === "image") {
    if (size > LIMITS.image || buffer.length < size) return { ...base, kind: "unknown", reason: `Larger than ${formatBytes(LIMITS.image)}` };
    const type = IMAGE_TYPES[extensionOf(base.name)] || String(mediaType).toLowerCase();
    return { ...base, kind: "image", dataUrl: `data:${type};base64,${buffer.toString("base64")}` };
  }
  if (kind === "unknown" && size > LIMITS.text) return { ...base, kind: "unknown" };
  const head = buffer.subarray(0, LIMITS.textShown);
  if (looksBinary(head)) return { ...base, kind: "unknown" };
  const text = head.toString("utf8").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const truncated = size > head.length;
  const lineCount = text ? text.split("\n").length : 0;
  if (kind === "markdown" && !truncated) return { ...base, kind: "markdown", html: renderMarkdown(text), text, lineCount, truncated };
  const language = CODE_LANGUAGES[extensionOf(base.name)] || (kind === "markdown" ? "markdown" : "");
  const html = text.length <= LIMITS.highlight ? highlight(text, language) : escapeHtml(text);
  return { ...base, kind: "text", language, html, text, lineCount, truncated, ...(Number.isFinite(line) && line > 0 ? { line } : {}) };
}

// Reads the file at `filePath` (already resolved) into what the viewer shows.
function readViewerItem(filePath, { fileSystem = fs, renderMarkdown, highlight, line = null } = {}) {
  const name = path.basename(filePath);
  let stat;
  try {
    stat = fileSystem.statSync(filePath);
  } catch {
    return { kind: "missing", name, path: filePath };
  }
  if (stat.isDirectory()) return { kind: "folder", name, path: filePath };
  if (!stat.isFile()) return { kind: "unknown", name, path: filePath, size: stat.size };
  const kind = kindOf(name);
  if (kind === "unknown" && stat.size > LIMITS.text) return { kind: "unknown", name, path: filePath, size: stat.size };
  // An image is read whole; anything else only as far as it can be shown, so a 3 GB log is
  // never pulled into memory to show its head.
  const wanted = kind === "image" ? Math.min(stat.size, LIMITS.image) : Math.min(stat.size, LIMITS.textShown);
  const buffer = Buffer.alloc(wanted);
  const handle = fileSystem.openSync(filePath, "r");
  let read = 0;
  try { read = fileSystem.readSync(handle, buffer, 0, wanted, 0); } finally { fileSystem.closeSync(handle); }
  return itemFromBuffer({ name, filePath, buffer: buffer.subarray(0, read), size: stat.size, renderMarkdown, highlight, line });
}

module.exports = { IMAGE_TYPES, LIMITS, escapeHtml, formatBytes, itemFromBuffer, kindOf, looksBinary, readViewerItem, resolveViewerPath, stripLineSuffix };
