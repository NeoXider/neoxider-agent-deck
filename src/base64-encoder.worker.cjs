// The body that runs on a worker thread for `base64-encoder.cjs`.
//
// It reads the file *and* encodes it, so the main thread never allocates the 8 MB buffer
// at all — only the finished base64 string crosses back. Reading synchronously here is
// deliberate: this thread exists to be blocked, and a sync read avoids a second trip
// through the worker's own event loop for no benefit.
//
// Everything is exported as a plain function and the port wiring is a separate call, so
// the encoding rules can be tested on the main thread without spawning anything.
const fs = require("node:fs");
const { isMainThread, parentPort } = require("node:worker_threads");

// The caller has already stat'd the file and refused anything oversized. Re-checking the
// real length here is not paranoia about the caller: between the stat and this read the
// file can be replaced, and an unbounded read is how a 4 GB video becomes an out-of-memory
// crash of the whole app.
function encodeFileToBase64(filePath, { maxBytes = 0, readFile = fs.readFileSync } = {}) {
  const buffer = readFile(String(filePath));
  if (maxBytes > 0 && buffer.length > maxBytes) {
    throw new Error(`${filePath} grew past the ${maxBytes} byte limit while it was being read`);
  }
  return buffer.toString("base64");
}

// One job at a time per worker; the pool never sends a second before the first replies.
// The id is echoed back so a reply that arrives after the pool gave up can be discarded
// instead of being handed to whichever job took its place.
function serveRequests(port, { encode = encodeFileToBase64 } = {}) {
  port.on("message", (job) => {
    if (!job || typeof job !== "object") return;
    try {
      port.postMessage({ id: job.id, data: encode(job.filePath, { maxBytes: job.maxBytes }) });
    } catch (error) {
      port.postMessage({ id: job.id, error: error instanceof Error ? error.message : String(error) });
    }
  });
}

if (!isMainThread && parentPort) serveRequests(parentPort);

module.exports = { encodeFileToBase64, serveRequests };
