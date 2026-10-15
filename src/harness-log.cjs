const fs = require("node:fs");
const path = require("node:path");
const { StringDecoder } = require("node:string_decoder");

// What the owned Harness prints, kept on disk so a crash can be read after the fact.
//
// Before this existed the launcher read stdout only until it had the launch URL and threw
// stderr away, so a Harness that died at runtime left nothing behind: DSH's own fail-loud
// handler writes the fatal error to stderr and exits, and that line went nowhere.
//
// Two files live in the log directory:
//
//   harness-output.spool  the raw output. The owned Harness writes into it directly, not
//                         through a pipe (see openSpool), so it keeps a place to write after
//                         the widget has quit. It holds the launch token, so it is drained
//                         into the log and truncated, never shown.
//   harness.log           what a person reads: timestamped, secrets redacted, rotated at
//                         2 MB with three generations kept (harness.log, .1.log, .2.log).
const HARNESS_LOG_NAME = "harness.log";
const HARNESS_SPOOL_NAME = "harness-output.spool";
const HARNESS_LOG_MAX_BYTES = 2 * 1024 * 1024;
const HARNESS_LOG_FILES = 3;
const RECENT_LINE_LIMIT = 200;
// One enormous line (a JSON dump, a minified bundle in a stack) must not cost the whole log.
const MAX_LINE_CHARS = 4000;
// Bounds one read, so a backlog written while the widget was closed cannot stall startup.
const MAX_READ_BYTES = 1024 * 1024;
// The spool is truncated once drained past this size even when nothing secret was seen.
const SPOOL_TRUNCATE_BYTES = 256 * 1024;
const TAIL_INTERVAL_MS = 1000;

// Order matters only for readability; every rule is idempotent on its own output.
const REDACTIONS = Object.freeze([
  // The launch token: `dsh web: http://127.0.0.1:3080/?token=...` and its variants.
  [/([?&#](?:launch[_-]?)?token=)(?!\[redacted\])[^\s&#"'<>)\]]+/gi, "$1[redacted]"],
  [/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{6,}/gi, "$1[redacted]"],
  [/\b(Basic\s+)[A-Za-z0-9+/=]{8,}/g, "$1[redacted]"],
  // Provider key shapes: OpenAI/DeepSeek/Anthropic/OpenRouter (sk-), Google, GitHub, Hugging Face, Slack.
  [/\bsk-[A-Za-z0-9_-]{12,}/g, "sk-[redacted]"],
  [/\bAIza[0-9A-Za-z_-]{20,}/g, "AIza[redacted]"],
  [/\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{16,}/g, "[redacted-github-token]"],
  [/\bhf_[A-Za-z0-9]{16,}/g, "hf_[redacted]"],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, "xox-[redacted]"],
  // key=value / "key": "value" forms, including prefixed names such as DEEPSEEK_API_KEY.
  [/((?:api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|auth[_-]?token|id[_-]?token|client[_-]?secret|secret[_-]?key|private[_-]?key|password|passwd|secret|token|authorization|cookie)["']?\s*[:=]\s*["']?)(?!\[redacted\])(?!Bearer\s|Basic\s)[^\s"',;&}<>]{6,}/gi, "$1[redacted]"],
]);

function redactHarnessOutput(text) {
  let result = String(text ?? "");
  for (const [pattern, replacement] of REDACTIONS) result = result.replace(pattern, replacement);
  return result;
}

function rotatedLogPath(filePath, index) {
  if (!index) return filePath;
  const extension = path.extname(filePath);
  const stem = extension ? filePath.slice(0, -extension.length) : filePath;
  return `${stem}.${index}${extension}`;
}

// Size-capped append-only file with numbered generations. Every failure is swallowed and
// remembered: the log is diagnostics, and a full disk must not take the widget down.
function createRotatingLog({ filePath, maxBytes = HARNESS_LOG_MAX_BYTES, maxFiles = HARNESS_LOG_FILES, fileSystem = fs }) {
  let size = null;
  let lastError = null;

  function currentSize() {
    if (size === null) {
      try { size = fileSystem.statSync(filePath).size; } catch { size = 0; }
    }
    return size;
  }

  function rotate() {
    for (let index = maxFiles - 1; index >= 1; index -= 1) {
      const target = rotatedLogPath(filePath, index);
      try { fileSystem.rmSync(target, { force: true }); } catch {}
      try { fileSystem.renameSync(rotatedLogPath(filePath, index - 1), target); } catch {}
    }
    size = 0;
  }

  return {
    filePath,
    append(text) {
      const value = String(text || "");
      if (!value) return true;
      const bytes = Buffer.byteLength(value);
      try {
        if (currentSize() > 0 && currentSize() + bytes > maxBytes) rotate();
        fileSystem.mkdirSync(path.dirname(filePath), { recursive: true });
        fileSystem.appendFileSync(filePath, value);
        size = currentSize() + bytes;
        lastError = null;
        return true;
      } catch (error) {
        lastError = error;
        size = null;
        return false;
      }
    },
    lastError: () => lastError,
  };
}

function createHarnessOutputLog({
  directory,
  fileSystem = fs,
  now = () => Date.now(),
  maxBytes = HARNESS_LOG_MAX_BYTES,
  maxFiles = HARNESS_LOG_FILES,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
  tailIntervalMs = TAIL_INTERVAL_MS,
}) {
  const logPath = path.join(directory, HARNESS_LOG_NAME);
  const spoolPath = path.join(directory, HARNESS_SPOOL_NAME);
  const log = createRotatingLog({ filePath: logPath, maxBytes, maxFiles, fileSystem });
  const subscribers = new Set();
  const recent = [];
  let written = 0;
  // Unterminated tails, kept per source so a probe's pipe never splices into a spool line.
  const partials = { spool: "", pipe: "" };
  let offset = 0;
  let decoder = new StringDecoder("utf8");
  let timer = null;

  function remember(lines) {
    recent.push(...lines);
    if (recent.length > RECENT_LINE_LIMIT) recent.splice(0, recent.length - RECENT_LINE_LIMIT);
    written += lines.length;
  }

  function stamp() {
    try { return new Date(now()).toISOString(); } catch { return ""; }
  }

  // Splits output into lines, keeps an unterminated tail for the next chunk, redacts each
  // line and writes them with one timestamp per chunk. Returns whether redaction changed
  // anything, which is what tells the spool reader a secret just passed through.
  function consume(text, { flush = false, source = "pipe" } = {}) {
    const lines = `${partials[source]}${text}`.split("\n");
    let partial = lines.pop() || "";
    if (flush || partial.length > MAX_LINE_CHARS) {
      if (partial) lines.push(partial);
      partial = "";
    }
    partials[source] = partial;
    if (!lines.length) return false;
    let redactedAny = false;
    const clean = lines.map((line) => {
      const bare = line.replace(/\r/g, "");
      const redacted = redactHarnessOutput(bare);
      if (redacted !== bare) redactedAny = true;
      return redacted.length > MAX_LINE_CHARS ? `${redacted.slice(0, MAX_LINE_CHARS)} …[truncated]` : redacted;
    });
    remember(clean);
    const at = stamp();
    log.append(clean.map((line) => `${at} ${line}\n`).join(""));
    return redactedAny;
  }

  // The read position only moves back when the truncation really happened; otherwise the
  // next read would replay everything already logged.
  function truncateSpool() {
    try {
      fileSystem.truncateSync(spoolPath, 0);
      offset = 0;
      decoder = new StringDecoder("utf8");
    } catch {}
  }

  // Reads what was appended to the spool since the last read. The writer holds the file in
  // append mode, so a truncation here is safe: its next write lands at the new end, never
  // after a hole. Bytes written between the read and the truncation are lost, which is why
  // truncation is limited to drained spools that held a secret or grew large.
  function ingest({ flush = false } = {}) {
    let fd = null;
    let text = "";
    let drained = false;
    let size = 0;
    let skipped = 0;
    try {
      fd = fileSystem.openSync(spoolPath, "r");
      size = fileSystem.fstatSync(fd).size;
      if (size < offset) {
        offset = 0;
        decoder = new StringDecoder("utf8");
      }
      // A backlog bigger than one read keeps only its newest part: the end of the output is
      // where a crash explains itself.
      if (size - offset > MAX_READ_BYTES) {
        skipped = size - offset - MAX_READ_BYTES;
        offset = size - MAX_READ_BYTES;
        decoder = new StringDecoder("utf8");
        partials.spool = "";
      }
      const length = size - offset;
      if (length > 0) {
        const buffer = Buffer.alloc(length);
        const read = fileSystem.readSync(fd, buffer, 0, length, offset);
        offset += read;
        text = decoder.write(buffer.subarray(0, read));
      }
      drained = offset >= size;
    } catch {
      return "";
    } finally {
      if (fd !== null) { try { fileSystem.closeSync(fd); } catch {} }
    }
    if (skipped) note(`${skipped} bytes of earlier Harness output were skipped`);
    const sawSecret = text || (flush && partials.spool) ? consume(text, { flush, source: "spool" }) : false;
    if (text) for (const listener of subscribers) { try { listener(text); } catch {} }
    if (drained && size > 0 && (sawSecret || offset >= SPOOL_TRUNCATE_BYTES)) truncateSpool();
    return text;
  }

  // Whatever an earlier run left behind was written while the widget was closed: most
  // usefully the fatal error of a Harness that outlived it and then died.
  if (ingest({ flush: true })) note("Output above was written while the widget was not running");
  truncateSpool();

  // The widget's own lines. `keep: false` writes to the file only, for blocks that repeat
  // output already held here (a crash report), so they do not crowd it out.
  function note(message, { keep = true } = {}) {
    const line = `[deck] ${redactHarnessOutput(String(message ?? "")).replace(/[\r\n]+/g, " ")}`;
    if (keep) remember([line]);
    log.append(`${stamp()} ${line}\n`);
  }

  return {
    logPath,
    spoolPath,
    // A file descriptor for the child's stdout and stderr. The caller passes it to spawn
    // and closes its own copy straight after with close().
    openSpool() {
      ingest({ flush: true });
      try {
        fileSystem.mkdirSync(directory, { recursive: true });
        const fd = fileSystem.openSync(spoolPath, "a");
        return { fd, close() { try { fileSystem.closeSync(fd); } catch {} } };
      } catch {
        return null;
      }
    },
    // Raw spool text, before redaction, for the launcher's banner reader only.
    subscribe(listener) {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
    ingest,
    // Pipe-mode output (token probes, or a spool that could not be opened).
    write(text, { flush = false } = {}) {
      const value = String(text ?? "");
      if (value || flush) consume(value, { flush });
    },
    note,
    recentLines(count = 40) {
      return recent.slice(-Math.max(0, count));
    },
    // A position in the output, for "what did this attempt print".
    mark: () => written,
    linesSince(mark) {
      const count = written - Number(mark || 0);
      return count > 0 ? recent.slice(-Math.min(count, recent.length)) : [];
    },
    // The only file "Open log" may hand to the shell: always this one, never a path that
    // came from the renderer. It is created when missing so the action never opens nothing.
    ensureLogFile() {
      try {
        if (!fileSystem.existsSync(logPath)) note("Harness log created");
        return fileSystem.statSync(logPath).isFile() ? logPath : "";
      } catch {
        return "";
      }
    },
    start() {
      if (timer) return false;
      timer = setIntervalImpl(() => ingest(), tailIntervalMs);
      timer?.unref?.();
      return true;
    },
    // Final drain at quit. The Harness may keep running and keep writing; the next run
    // picks that up from the spool.
    stop() {
      if (timer) clearIntervalImpl(timer);
      timer = null;
      ingest({ flush: true });
      truncateSpool();
    },
  };
}

module.exports = {
  HARNESS_LOG_FILES,
  HARNESS_LOG_MAX_BYTES,
  HARNESS_LOG_NAME,
  HARNESS_SPOOL_NAME,
  createHarnessOutputLog,
  createRotatingLog,
  redactHarnessOutput,
  rotatedLogPath,
};
