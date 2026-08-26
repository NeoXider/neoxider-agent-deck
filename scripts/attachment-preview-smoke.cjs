const fs = require("node:fs");
const path = require("node:path");
const { app, nativeImage } = require("electron");
const { createAttachmentReader } = require("../src/attachments.cjs");

async function main() {
  const filePaths = process.argv.slice(2).map((value) => path.resolve(value));
  if (filePaths.length === 0) throw new Error("Pass at least one image or video path");
  const outputDirectory = path.resolve("tmp", "attachment-preview-smoke");
  fs.mkdirSync(outputDirectory, { recursive: true });
  const reader = createAttachmentReader({
    async makeThumbnail(filePath) {
      const thumbnail = await nativeImage.createThumbnailFromPath(filePath, { width: 320, height: 180 });
      return thumbnail.isEmpty() ? "" : thumbnail.toPNG().toString("base64");
    },
  });
  const result = await reader.prepareFiles(filePaths);
  const summary = result.attachments.map((attachment, index) => {
    const previewData = attachment.kind === "image" ? attachment.data : attachment.thumbnailData;
    const previewPath = previewData ? path.join(outputDirectory, `${index + 1}-${path.parse(attachment.name).name}.png`) : "";
    if (previewPath) fs.writeFileSync(previewPath, Buffer.from(previewData, "base64"));
    return {
      name: attachment.name,
      kind: attachment.kind,
      previewKind: attachment.previewKind || "image",
      previewBytes: previewData ? Buffer.byteLength(previewData, "base64") : 0,
      previewPath,
    };
  });
  process.stdout.write(`${JSON.stringify({ summary, failures: result.failures }, null, 2)}\n`);
  if (result.failures.length || summary.some((item) => item.previewBytes === 0)) process.exitCode = 1;
}

app.whenReady()
  .then(main)
  .then(() => app.quit())
  .catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    app.exit(1);
  });
