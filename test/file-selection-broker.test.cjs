const test = require("node:test");
const assert = require("node:assert/strict");
const { createFileSelectionBroker, HANDLE_PREFIX } = require("../src/file-selection-broker.cjs");

test("trusted Electron files become opaque single-use handles", async () => {
  const prepared = [];
  const broker = createFileSelectionBroker({
    getPathForFile: (file) => file.nativePath,
    preparePaths: async (paths) => { prepared.push(paths); return { attachments: [] }; },
    randomUUID: () => "known-token",
  });
  const handle = broker.remember({ nativePath: "C:\\private\\notes.txt" });
  assert.equal(handle, `${HANDLE_PREFIX}known-token`);
  assert.doesNotMatch(handle, /private|notes/i);
  await broker.prepare([handle]);
  assert.deepEqual(prepared, [["C:\\private\\notes.txt"]]);
  assert.equal(broker.pendingCount(), 0);
  await assert.rejects(broker.prepare([handle]), /expired|trusted file drop/);
});

test("renderer-provided local paths never reach privileged preparation", async () => {
  let called = false;
  const broker = createFileSelectionBroker({
    getPathForFile: () => "",
    preparePaths: async () => { called = true; },
  });
  await assert.rejects(broker.prepare(["C:\\Users\\User\\secret.txt"]), /trusted file drop/);
  await assert.rejects(broker.prepare({ path: "C:\\secret.txt" }), /must be an array/);
  assert.equal(called, false);
});

test("only isolated screenshot fixtures may prepare explicit paths", async () => {
  const broker = createFileSelectionBroker({
    getPathForFile: () => "",
    preparePaths: async (paths) => paths,
    allowFixturePaths: true,
  });
  assert.deepEqual(await broker.prepare(["C:\\fixture\\shot.png"]), ["C:\\fixture\\shot.png"]);
});
