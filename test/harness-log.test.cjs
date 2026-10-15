const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  HARNESS_LOG_FILES,
  HARNESS_LOG_MAX_BYTES,
  createHarnessOutputLog,
  createRotatingLog,
  redactHarnessOutput,
  rotatedLogPath,
} = require("../src/harness-log.cjs");

// An in-memory file system with the calls the log makes. childWrite() is the Harness
// appending through the descriptor it was spawned with.
function memoryFs() {
  const files = new Map();
  const descriptors = new Map();
  let nextFd = 10;
  const missing = (filePath) => Object.assign(new Error(`ENOENT: ${filePath}`), { code: "ENOENT" });
  const append = (filePath, text) => files.set(filePath, Buffer.concat([files.get(filePath) || Buffer.alloc(0), Buffer.from(String(text))]));
  return {
    files,
    text: (filePath) => (files.get(filePath) || Buffer.alloc(0)).toString("utf8"),
    childWrite: append,
    existsSync: (filePath) => files.has(filePath),
    statSync(filePath) {
      if (!files.has(filePath)) throw missing(filePath);
      return { size: files.get(filePath).length, isFile: () => true };
    },
    mkdirSync() {},
    appendFileSync: append,
    renameSync(from, to) {
      if (!files.has(from)) throw missing(from);
      files.set(to, files.get(from));
      files.delete(from);
    },
    rmSync: (filePath) => { files.delete(filePath); },
    truncateSync(filePath, length = 0) {
      if (!files.has(filePath)) throw missing(filePath);
      files.set(filePath, files.get(filePath).subarray(0, length));
    },
    openSync(filePath, flags) {
      if (flags === "r" && !files.has(filePath)) throw missing(filePath);
      if (!files.has(filePath)) files.set(filePath, Buffer.alloc(0));
      const fd = nextFd++;
      descriptors.set(fd, filePath);
      return fd;
    },
    fstatSync: (fd) => ({ size: files.get(descriptors.get(fd)).length }),
    readSync: (fd, buffer, offset, length, position) => files.get(descriptors.get(fd)).copy(buffer, offset, position, position + length),
    closeSync: (fd) => { descriptors.delete(fd); },
    openDescriptors: () => descriptors.size,
  };
}

const directory = path.join(path.sep, "user-data", "logs");
const logPath = path.join(directory, "harness.log");
const spoolPath = path.join(directory, "harness-output.spool");
const NOW = Date.parse("2026-10-15T10:00:00.000Z");

test("launch tokens, bearer tokens and provider keys never reach the log", () => {
  const cases = [
    ["dsh web: http://127.0.0.1:3080/?token=4f9c2a7e1b", "dsh web: http://127.0.0.1:3080/?token=[redacted]"],
    ["open http://localhost:3080/#launchToken=abcdef0123&x=1", "open http://localhost:3080/#launchToken=[redacted]&x=1"],
    ["Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig", "Authorization: Bearer [redacted]"],
    ["provider failed with key sk-proj-AbCdEfGh1234567890xyz", "provider failed with key sk-[redacted]"],
    ["OPENROUTER key sk-or-v1-0123456789abcdef0123", "OPENROUTER key sk-[redacted]"],
    ["DEEPSEEK_API_KEY=ds-live-0123456789", "DEEPSEEK_API_KEY=[redacted]"],
    ['{"apiKey": "plainsecretvalue", "model": "x"}', '{"apiKey": "[redacted]", "model": "x"}'],
    ["password=hunter2hunter2", "password=[redacted]"],
    ["google AIzaSyA-0123456789abcdefghijklmnop", "google AIza[redacted]"],
  ];
  for (const [input, expected] of cases) {
    assert.equal(redactHarnessOutput(input), expected, input);
    assert.equal(redactHarnessOutput(expected), expected, `redaction is idempotent for ${expected}`);
  }
  // Ordinary diagnostics stay readable: counts, limits and the words themselves.
  for (const text of [
    "prompt_tokens 153489 of 262144",
    "max_tokens=4096 temperature=0.7",
    "listen EADDRINUSE: address already in use 127.0.0.1:3080",
    "token budget exhausted",
  ]) assert.equal(redactHarnessOutput(text), text);
});

test("the log rotates at its size cap and keeps a fixed number of generations", () => {
  const fileSystem = memoryFs();
  const log = createRotatingLog({ filePath: logPath, maxBytes: 64, maxFiles: 3, fileSystem });
  for (let index = 0; index < 12; index += 1) log.append(`line ${String(index).padStart(2, "0")} ${"x".repeat(20)}\n`);
  assert.deepEqual([...fileSystem.files.keys()].sort(), [logPath, rotatedLogPath(logPath, 1), rotatedLogPath(logPath, 2)].sort());
  assert.match(fileSystem.text(logPath), /line 11/);
  assert.ok(fileSystem.files.get(logPath).length <= 64);
  assert.match(fileSystem.text(rotatedLogPath(logPath, 1)), /line 09/);
  assert.equal(fileSystem.existsSync(rotatedLogPath(logPath, 3)), false);
  assert.equal(rotatedLogPath(logPath, 2), path.join(directory, "harness.2.log"));
  assert.equal(HARNESS_LOG_MAX_BYTES, 2 * 1024 * 1024);
  assert.equal(HARNESS_LOG_FILES, 3);
});

test("a failing disk is remembered, not thrown", () => {
  const fileSystem = { ...memoryFs(), appendFileSync: () => { throw Object.assign(new Error("disk full"), { code: "ENOSPC" }); } };
  const log = createRotatingLog({ filePath: logPath, fileSystem });
  assert.equal(log.append("hello\n"), false);
  assert.equal(log.lastError().code, "ENOSPC");
});

test("spool output is redacted, timestamped, kept for crash reports and handed raw to the banner reader", () => {
  const fileSystem = memoryFs();
  const output = createHarnessOutputLog({ directory, fileSystem, now: () => NOW });
  const raw = [];
  output.subscribe((text) => raw.push(text));
  const spool = output.openSpool();
  assert.ok(spool, "a descriptor for the child's stdout and stderr");
  spool.close();
  assert.equal(fileSystem.openDescriptors(), 0, "the widget keeps no descriptor of its own open");

  fileSystem.childWrite(spoolPath, "booting\ndsh web: http://127.0.0.1:3080/?token=secret123\nhalf a li");
  output.ingest();
  assert.deepEqual(raw, ["booting\ndsh web: http://127.0.0.1:3080/?token=secret123\nhalf a li"]);
  const logged = fileSystem.text(logPath);
  assert.match(logged, /2026-10-15T10:00:00\.000Z booting\n/);
  assert.match(logged, /\?token=\[redacted\]/);
  assert.doesNotMatch(logged, /secret123/);
  assert.doesNotMatch(logged, /half a li/, "an unterminated line waits for its end");
  assert.equal(fileSystem.text(spoolPath), "", "a drained spool that carried a secret is emptied at once");

  fileSystem.childWrite(spoolPath, "ne\n");
  output.ingest();
  assert.match(fileSystem.text(logPath), /half a line\n/);
  assert.deepEqual(output.recentLines(3).slice(-2), ["dsh web: http://127.0.0.1:3080/?token=[redacted]", "half a line"]);
});

test("output written while the widget was closed is recovered at startup", () => {
  const fileSystem = memoryFs();
  fileSystem.childWrite(spoolPath, "dsh: fatal uncaught exception: Error: write EPIPE\n");
  const output = createHarnessOutputLog({ directory, fileSystem, now: () => NOW });
  assert.deepEqual(output.recentLines(2), [
    "dsh: fatal uncaught exception: Error: write EPIPE",
    "[deck] Output above was written while the widget was not running",
  ]);
  assert.equal(fileSystem.text(spoolPath), "");
});

test("a backlog too large for one read keeps its newest output, where a crash explains itself", () => {
  const fileSystem = memoryFs();
  fileSystem.childWrite(spoolPath, `${"chatty line\n".repeat(120000)}dsh: fatal uncaught exception: last words\n`);
  const output = createHarnessOutputLog({ directory, fileSystem, now: () => NOW });
  const recent = output.recentLines(200);
  assert.ok(recent.includes("dsh: fatal uncaught exception: last words"));
  const logged = [2, 1, 0].map((index) => fileSystem.text(rotatedLogPath(logPath, index))).join("");
  assert.match(logged, /\[deck\] \d+ bytes of earlier Harness output were skipped\n/);
  assert.equal(fileSystem.text(spoolPath), "");
});

test("a spool truncated behind the reader's back is read again from the start", () => {
  const fileSystem = memoryFs();
  const output = createHarnessOutputLog({ directory, fileSystem, now: () => NOW });
  output.openSpool().close();
  fileSystem.childWrite(spoolPath, "first line of plain output\n");
  output.ingest();
  fileSystem.truncateSync(spoolPath, 0);
  fileSystem.childWrite(spoolPath, "x\n");
  output.ingest();
  assert.deepEqual(output.recentLines(2), ["first line of plain output", "x"]);
});

test("pipe output, notes and marks describe what one attempt printed", () => {
  const fileSystem = memoryFs();
  const output = createHarnessOutputLog({ directory, fileSystem, now: () => NOW });
  output.write("old noise\n");
  const mark = output.mark();
  output.write("listen EADDRINUSE: address already in use 127.0.0.1:3080\r\n");
  output.note("Harness exited (code 1)\nwith a newline");
  assert.deepEqual(output.linesSince(mark), [
    "listen EADDRINUSE: address already in use 127.0.0.1:3080",
    "[deck] Harness exited (code 1) with a newline",
  ]);
  assert.deepEqual(output.linesSince(output.mark()), []);
  output.write("no newline yet");
  output.write("", { flush: true });
  assert.equal(output.recentLines(1)[0], "no newline yet");
});

test("a probe's unterminated pipe output never splices into a spool line", () => {
  const fileSystem = memoryFs();
  const output = createHarnessOutputLog({ directory, fileSystem, now: () => NOW });
  output.openSpool().close();
  output.write("probe: half");
  fileSystem.childWrite(spoolPath, "server line\n");
  output.ingest();
  output.write(" done\n");
  assert.deepEqual(output.recentLines(2), ["server line", "probe: half done"]);
});

test("Open log only ever names the widget's own log file, creating it when missing", () => {
  const fileSystem = memoryFs();
  const output = createHarnessOutputLog({ directory, fileSystem, now: () => NOW });
  assert.equal(output.ensureLogFile.length, 0, "it takes no path from anyone");
  assert.equal(output.ensureLogFile(), logPath);
  assert.ok(fileSystem.existsSync(logPath));
  const broken = createHarnessOutputLog({ directory, fileSystem: { ...memoryFs(), statSync: () => { throw new Error("EACCES"); } }, now: () => NOW });
  assert.equal(broken.ensureLogFile(), "");
});

test("tailing runs on an injected timer and quit drains, flushes and empties the spool", () => {
  const fileSystem = memoryFs();
  const timers = [];
  const output = createHarnessOutputLog({
    directory,
    fileSystem,
    now: () => NOW,
    setIntervalImpl: (callback, ms) => { const timer = { callback, ms, cleared: false }; timers.push(timer); return timer; },
    clearIntervalImpl: (timer) => { timer.cleared = true; },
  });
  assert.equal(output.start(), true);
  assert.equal(output.start(), false, "one tail at a time");
  assert.equal(timers[0].ms, 1000);
  output.openSpool().close();
  fileSystem.childWrite(spoolPath, "tick one\n");
  timers[0].callback();
  assert.match(fileSystem.text(logPath), /tick one/);
  fileSystem.childWrite(spoolPath, "dying words without newline");
  output.stop();
  assert.equal(timers[0].cleared, true);
  assert.match(fileSystem.text(logPath), /dying words without newline\n/);
  assert.equal(fileSystem.text(spoolPath), "");
});

test("the real file system rotates and drains a spool written through an append descriptor", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-deck-harness-log-"));
  try {
    const output = createHarnessOutputLog({ directory: root, maxBytes: 256, now: () => NOW });
    const spool = output.openSpool();
    for (let index = 0; index < 20; index += 1) {
      fs.writeSync(spool.fd, `line ${index} Bearer abcdefghijk\n`);
      output.ingest();
    }
    spool.close();
    output.stop();
    const names = fs.readdirSync(root).sort();
    assert.deepEqual(names, ["harness-output.spool", "harness.1.log", "harness.2.log", "harness.log"]);
    const logged = names.filter((name) => name.endsWith(".log")).map((name) => fs.readFileSync(path.join(root, name), "utf8")).join("");
    assert.doesNotMatch(logged, /abcdefghijk/);
    assert.match(logged, /line 19 Bearer \[redacted\]/);
    assert.equal(fs.statSync(path.join(root, "harness-output.spool")).size, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
