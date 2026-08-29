// Does a message with an image or a document actually reach the queue?
//
// The widget never asks Harness for its queue: the queue arrives unsolicited on the event
// multiplexer, is reshaped by queue-view.cjs, and is filtered by stream-publisher.cjs before
// the renderer ever sees it. A queued attachment could therefore be lost at four different
// places, and none of them are exercised by a unit test that stops at the IPC boundary.
//
// So this drives the real thing end to end: it opens a turn that will still be running a
// moment later, sends a text message, an image-only message and a document-only message
// behind it, and reads the queue off the same socket the widget listens on — through the
// same two pure functions the widget renders from.
//
//   node scripts/queue-attachment-smoke.cjs [--url http://127.0.0.1:3080] [--keep]
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

const { HarnessApi } = require("../src/harness-api.cjs");
const { createMuxClient } = require("../src/mux-client.cjs");
const { createStreamPublisher } = require("../src/stream-publisher.cjs");
const { createAttachmentReader, MAX_IMAGE_BYTES } = require("../src/attachments.cjs");

const args = process.argv.slice(2);
const harnessUrl = args.includes("--url") ? args[args.indexOf("--url") + 1] : "http://127.0.0.1:3080";
const keepSession = args.includes("--keep");

// A 1x1 PNG. Small enough that nothing in the pipeline can blame the size.
const PNG_1X1 = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408d763f8cfc0000003010100" +
  "18dd8db00000000049454e44ae426082",
  "hex",
);

function fail(message, detail) {
  console.error(`FAIL ${message}`);
  if (detail !== undefined) console.error(JSON.stringify(detail, null, 2));
  process.exitCode = 1;
}

async function waitFor(predicate, { timeoutMs = 15000, label = "condition" } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = predicate();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
}

async function main() {
  const workspace = mkdtempSync(path.join(tmpdir(), "agent-deck-queue-smoke-"));
  const imagePath = path.join(workspace, "queued-picture.png");
  const documentPath = path.join(workspace, "queued-document.txt");
  writeFileSync(imagePath, PNG_1X1);
  writeFileSync(documentPath, "This document only has to exist to be referenced.\n");

  const api = new HarnessApi(harnessUrl);
  const { prepareFiles } = createAttachmentReader({
    encodeImage: async (filePath) => require("node:fs").readFileSync(filePath).toString("base64"),
    maxImageBytes: MAX_IMAGE_BYTES,
  });
  const prepared = await prepareFiles([imagePath, documentPath]);
  if (prepared.failures.length) throw new Error(`Attachment preparation failed: ${JSON.stringify(prepared.failures)}`);
  const image = prepared.attachments.find((item) => item.kind === "image");
  const reference = prepared.attachments.find((item) => item.kind === "reference");
  if (!image || !reference) throw new Error(`Expected one image and one reference, got ${JSON.stringify(prepared.attachments.map((a) => a.kind))}`);

  const host = await api.rpc("host.describe");
  const sessionId = await api.createSession({ cwd: workspace });
  await api.ensureFullAccess(sessionId);
  console.log(`Harness ${host.version} · model ${host.provider}/${host.model} · session ${sessionId}`);

  // The queue is read exactly as the widget reads it: raw mux frames through the same two
  // pure functions, including the placement filter that could silently drop an item.
  const queueSnapshots = new Map();
  const published = [];
  const { publishQueue } = createStreamPublisher({
    queueSnapshots,
    send: (channel, payload) => { if (channel === "queue-update") published.push(payload); },
  });
  const mux = createMuxClient({ harnessUrl, onQueue: (id, items) => publishQueue(id, items) });
  mux.connect();
  const latest = () => queueSnapshots.get(sessionId) || { revision: 0, items: [] };

  try {
    // Open a turn that will still be running when the next three arrive behind it.
    await api.prompt(sessionId, "Think carefully, then reply with exactly the word: ACKNOWLEDGED", "UTC", []);
    await waitFor(() => api.history(sessionId).then(() => true).catch(() => false) && true, { label: "session to accept the first turn", timeoutMs: 5000 });

    const sent = [
      { label: "text only", text: "Queued text", images: [] },
      { label: "image only", text: "", images: [image] },
      { label: "document only", text: `@${reference.path}`, images: [] },
    ];
    for (const item of sent) {
      await api.prompt(sessionId, item.text, "UTC", item.images);
    }

    const snapshot = await waitFor(() => (latest().items.length >= 1 ? latest() : null), {
      label: "the queue to publish at least one item",
      timeoutMs: 20000,
    });
    // Give Harness a beat to publish the rest before judging completeness.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const final = latest();

    console.log(`\nqueue revision ${final.revision}, ${final.items.length} item(s) as the renderer would receive them:`);
    for (const item of final.items) {
      console.log(`  [${item.placement}] editable=${item.text === null ? "no" : "yes"} preview=${JSON.stringify(item.preview)}`);
    }

    if (!final.items.length) {
      fail("nothing reached the queue at all", { published, snapshot });
      return;
    }
    const previews = final.items.map((item) => item.preview);
    const imageItem = final.items.find((item) => /attachment/i.test(item.preview));
    const documentItem = final.items.find((item) => item.preview.includes("queued-document.txt"));

    if (!imageItem) fail("an image-only message did not reach the queue", previews);
    else if (imageItem.text !== null) fail("an image-only queued message must not be editable as plain text", imageItem);
    else console.log("\nPASS image-only message is queued and correctly marked non-editable");

    if (!documentItem) {
      fail("a document reference did not reach the queue", previews);
    } else if (documentItem.preview.includes(workspace)) {
      fail("the queue row is spending its width on an absolute path", documentItem.preview);
    } else if (!String(documentItem.text || "").includes(documentPath)) {
      // Shortening the preview must never reach the editable text: saving a shortened path
      // would hand Harness a reference it cannot resolve.
      fail("editing the queued document would lose its real path", documentItem);
    } else {
      console.log("PASS document reference is queued, previewed by name, editable by full path");
    }

    if (!final.items.some((item) => item.preview.includes("Queued text"))) {
      fail("the plain text message did not reach the queue", previews);
    } else {
      console.log("PASS plain text message is queued");
    }
    // Every published item must carry an id, or Edit/Delete/Send-now would address nothing.
    const idless = final.items.filter((item) => !item.id);
    if (idless.length) fail("queued items arrived without an id", idless);
  } finally {
    mux.stop();
    await api.cancel(sessionId).catch(() => {});
    if (!keepSession) rmSync(workspace, { recursive: true, force: true });
    else console.log(`\nWorkspace kept at ${workspace}`);
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
