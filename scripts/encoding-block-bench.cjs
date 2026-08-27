// How long does attaching files take the main thread away from the UI?
//
// The claim being tested is narrow and measurable: base64-encoding attachments used to run
// on the thread that paints the window, and Electron's performance guide says nothing may.
// "It feels faster" is not evidence, so this measures the one number that matters — how
// long the event loop was unavailable — for the old inline encoder and the new worker pool,
// against the same files, in the same process.
//
// Both modes go through the real `createAttachmentReader`; the only difference is which
// encoder is injected, and the inline one is byte-for-byte the pre-change code. That is
// what makes this an A/B rather than two anecdotes.
//
//   node scripts/encoding-block-bench.cjs [--files 12] [--size 8] [--runs 5] [--mode both]
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { performance, monitorEventLoopDelay } = require("node:perf_hooks");

const { createAttachmentReader } = require("../src/attachments.cjs");
const { createBase64Encoder, defaultWorkerCount } = require("../src/base64-encoder.cjs");

// A 60 Hz window gets one frame every ~16.7 ms. A turn of the loop that takes longer than
// this is a frame the window could not have painted, which is the user-visible symptom.
const FRAME_MS = 16;
// Anything below this is scheduling noise, not a stall: an idle setImmediate chain turns
// over in ~0.002 ms here, so 0.5 ms is three orders of magnitude above the floor.
const STALL_FLOOR_MS = 0.5;

function parseArgs(argv) {
  const options = { files: 12, size: 8, runs: 5, mode: "both", keep: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--keep") options.keep = true;
    else if (flag === "--mode") options.mode = String(argv[++index] || "both");
    else if (flag === "--files") options.files = Number(argv[++index]);
    else if (flag === "--size") options.size = Number(argv[++index]);
    else if (flag === "--runs") options.runs = Number(argv[++index]);
  }
  return options;
}

// Real bytes, not zeros: a file of zeros can be served by sparse-file shortcuts on some
// filesystems, which would quietly make the read look free.
function makeFiles(directory, count, megabytes) {
  fs.mkdirSync(directory, { recursive: true });
  const chunk = crypto.randomBytes(1024 * 1024);
  const created = [];
  for (let index = 0; index < count; index += 1) {
    const file = path.join(directory, `bench-${index}.png`);
    created.push(file);
    if (fs.existsSync(file) && fs.statSync(file).size === megabytes * 1024 * 1024) continue;
    const handle = fs.openSync(file, "w");
    for (let block = 0; block < megabytes; block += 1) {
      // Vary each block so nothing downstream can dedupe or compress the work away.
      chunk.writeUInt32LE((index * 1024 + block) >>> 0, 0);
      fs.writeSync(handle, chunk);
    }
    fs.closeSync(handle);
  }
  return created;
}

// The probe is a self-rescheduling `setImmediate`, and that detail is the whole
// measurement.
//
// The obvious probe — `setInterval(fn, 4)` plus `monitorEventLoopDelay` — is wrong on
// Windows and lies in the flattering direction. Both are timer-driven, and the default
// Windows timer resolution is 15.6 ms, so an idle loop already reports ~15.6 ms gaps: the
// first version of this script measured 17.9 ms "stalls" for work that actually takes 2 ms,
// and would have reported the same 17.9 ms for a change that did nothing at all. Chromium
// raises the resolution with timeBeginPeriod, plain Node does not.
//
// `setImmediate` runs in the check phase on every turn of the loop with no timer involved,
// so the gap between two callbacks *is* the time the loop was busy. Idle floor here: about
// 0.002 ms. The histogram is still collected, but only as a cross-check with a known bias.
function startProbe() {
  const histogram = monitorEventLoopDelay({ resolution: 1 });
  histogram.enable();
  const gaps = [];
  let last = performance.now();
  let running = true;
  const tick = () => {
    const now = performance.now();
    gaps.push(now - last);
    last = now;
    if (running) setImmediate(tick);
  };
  setImmediate(tick);
  return {
    stop() {
      running = false;
      histogram.disable();
      const stalls = gaps.filter((gap) => gap > STALL_FLOOR_MS);
      return {
        longestStallMs: gaps.length ? Math.max(...gaps) : 0,
        blockedMs: stalls.reduce((total, value) => total + value, 0),
        droppedFrames: gaps.filter((gap) => gap > FRAME_MS).length,
        turns: gaps.length,
        loopMaxMs: histogram.max / 1e6,
        loopP99Ms: histogram.percentile(99) / 1e6,
      };
    },
  };
}

async function runOnce(reader, filePaths) {
  const probe = startProbe();
  const started = performance.now();
  const result = await reader.prepareFiles(filePaths);
  const wallMs = performance.now() - started;
  const measured = probe.stop();
  if (result.failures.length) throw new Error(`bench files failed: ${JSON.stringify(result.failures)}`);
  const bytes = result.attachments.reduce((total, item) => total + (item.bytes || 0), 0);
  return { ...measured, wallMs, bytes, attachments: result.attachments.length };
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

function summarise(label, runs) {
  return {
    mode: label,
    wallMs: median(runs.map((run) => run.wallMs)),
    longestStallMs: median(runs.map((run) => run.longestStallMs)),
    worstStallMs: Math.max(...runs.map((run) => run.longestStallMs)),
    blockedMs: median(runs.map((run) => run.blockedMs)),
    droppedFrames: median(runs.map((run) => run.droppedFrames)),
    loopMaxMs: median(runs.map((run) => run.loopMaxMs)),
    loopP99Ms: median(runs.map((run) => run.loopP99Ms)),
  };
}

const fixed = (value, places = 1) => Number(value).toFixed(places);

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const directory = path.join(os.tmpdir(), "agent-deck-encoding-bench");
  process.stdout.write(`Preparing ${options.files} x ${options.size} MB in ${directory}\n`);
  const filePaths = makeFiles(directory, options.files, options.size);

  // Warm the page cache first. Otherwise the first mode measured also pays for cold disk
  // reads and the comparison measures the disk, not the encoding.
  for (const file of filePaths) fs.readFileSync(file);

  const encoder = createBase64Encoder();
  const readers = {
    inline: createAttachmentReader({ maxImageBytes: options.size * 1024 * 1024 }),
    worker: createAttachmentReader({
      maxImageBytes: options.size * 1024 * 1024,
      encodeImage: (filePath, maxBytes) => encoder.encodeFile(filePath, maxBytes),
    }),
  };
  const modes = options.mode === "both" ? ["inline", "worker"] : [options.mode];

  const summaries = [];
  for (const mode of modes) {
    // One discarded run per mode so JIT warm-up and the pool's first spawn are not counted
    // as part of the steady state. The spawn cost is reported separately below.
    const cold = await runOnce(readers[mode], filePaths);
    const runs = [];
    for (let index = 0; index < options.runs; index += 1) runs.push(await runOnce(readers[mode], filePaths));
    summaries.push({ ...summarise(mode, runs), coldStallMs: cold.longestStallMs, coldWallMs: cold.wallMs });
  }

  process.stdout.write(`\nworkers: ${defaultWorkerCount()} of ${os.cpus().length} cores, ${options.runs} measured runs per mode (median)\n\n`);
  const header = ["mode", "wall ms", "longest stall ms", "blocked ms", "dropped frames", "loop max ms", "loop p99 ms", "first-run stall ms"];
  process.stdout.write(`${header.join(" | ")}\n`);
  for (const row of summaries) {
    process.stdout.write([
      row.mode.padEnd(6),
      fixed(row.wallMs),
      fixed(row.longestStallMs),
      fixed(row.blockedMs),
      String(row.droppedFrames),
      fixed(row.loopMaxMs),
      fixed(row.loopP99Ms),
      fixed(row.coldStallMs),
    ].join(" | ") + "\n");
  }

  const before = summaries.find((row) => row.mode === "inline");
  const after = summaries.find((row) => row.mode === "worker");
  if (before && after) {
    const share = (value, baseline) => (baseline > 0 ? `${fixed((1 - value / baseline) * 100)}% lower` : "n/a");
    process.stdout.write([
      "",
      `longest stall: ${fixed(before.longestStallMs)} ms -> ${fixed(after.longestStallMs)} ms (${share(after.longestStallMs, before.longestStallMs)})`,
      `blocked total: ${fixed(before.blockedMs)} ms -> ${fixed(after.blockedMs)} ms (${share(after.blockedMs, before.blockedMs)})`,
      `wall clock:    ${fixed(before.wallMs)} ms -> ${fixed(after.wallMs)} ms`,
      "",
    ].join("\n"));
  }

  encoder.shutdown();
  if (!options.keep) fs.rmSync(directory, { recursive: true, force: true });
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
