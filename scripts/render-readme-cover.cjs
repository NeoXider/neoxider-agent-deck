const { app, BrowserWindow } = require("electron");
const { writeFileSync } = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = path.join(root, "docs", "cover-source.html");
const output = path.join(root, "docs", "cover.png");

app.disableHardwareAcceleration();
// The cover is a fixed 1672x941 composition. Without this it renders at whatever scaling
// the machine happens to use, and a 125% display captures a cropped, magnified corner of it.
app.commandLine.appendSwitch("force-device-scale-factor", "1");

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    width: 1672,
    height: 941,
    useContentSize: true,
    frame: false,
    transparent: false,
    backgroundColor: "#070b12",
    webPreferences: { sandbox: true, contextIsolation: true },
  });
  await window.loadFile(source);
  await new Promise((resolve) => setTimeout(resolve, 350));
  const image = await window.webContents.capturePage({ x: 0, y: 0, width: 1672, height: 941 });
  writeFileSync(output, image.toPNG());
  window.destroy();
  app.quit();
}).catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  app.exit(1);
});
