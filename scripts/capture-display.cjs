const fs = require("node:fs");
const path = require("node:path");
const { app, desktopCapturer, screen } = require("electron");

async function main() {
  const outputPath = path.resolve(process.argv[2] || path.join("tmp", "display-capture.png"));
  const primary = screen.getPrimaryDisplay();
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: primary.size,
  });
  const source = sources.find((item) => item.display_id === String(primary.id)) || sources[0];
  if (!source || source.thumbnail.isEmpty()) throw new Error("Primary display capture is unavailable");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, source.thumbnail.toPNG());
  process.stdout.write(`${outputPath}\n`);
}

app.whenReady()
  .then(main)
  .then(() => app.quit())
  .catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    app.exit(1);
  });
