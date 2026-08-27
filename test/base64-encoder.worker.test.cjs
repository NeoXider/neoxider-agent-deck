const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const { encodeFileToBase64, serveRequests } = require("../src/base64-encoder.worker.cjs");

// The worker body is exported as plain functions and the port wiring is a separate call,
// so all of this runs on the main thread against a fake port. Spawning a real thread to
// assert "it encodes bytes" would be slower and would test node, not us.
function fakePort() {
  const port = new EventEmitter();
  port.sent = [];
  port.postMessage = (message) => port.sent.push(message);
  return port;
}

test("a file is read and encoded in one call", () => {
  const readFile = (filePath) => {
    assert.equal(filePath, "/tmp/shot.png");
    return Buffer.from("hello");
  };
  assert.equal(encodeFileToBase64("/tmp/shot.png", { readFile }), Buffer.from("hello").toString("base64"));
});

test("a file that grew past the ceiling since the stat is refused, not encoded", () => {
  // The size check happened on the other thread, before this one was asked to read. A file
  // swapped in between the two is how an unbounded read becomes an out-of-memory crash.
  const readFile = () => Buffer.alloc(64);
  assert.throws(
    () => encodeFileToBase64("/tmp/swapped.png", { maxBytes: 16, readFile }),
    /grew past the 16 byte limit/,
  );
  assert.equal(encodeFileToBase64("/tmp/swapped.png", { maxBytes: 0, readFile }).length, 88);
});

test("a request is answered with its own id", () => {
  const port = fakePort();
  serveRequests(port, { encode: () => "QUJD" });
  port.emit("message", { id: 7, filePath: "/tmp/a.png", maxBytes: 10 });
  assert.deepEqual(port.sent, [{ id: 7, data: "QUJD" }]);
});

test("a read that throws comes back as a reply, never as an unhandled worker crash", () => {
  // A worker that dies takes its whole pool slot with it and the pool has to guess what
  // happened. Reporting the failure in-band keeps one unreadable file to one failed file.
  const port = fakePort();
  serveRequests(port, { encode: () => { throw new Error("EACCES: permission denied"); } });
  port.emit("message", { id: 1, filePath: "/tmp/locked.png" });
  assert.deepEqual(port.sent, [{ id: 1, error: "EACCES: permission denied" }]);
});

test("a malformed message is ignored rather than answered", () => {
  const port = fakePort();
  serveRequests(port, { encode: () => "x" });
  port.emit("message", null);
  port.emit("message", "not-a-job");
  assert.deepEqual(port.sent, []);
});
