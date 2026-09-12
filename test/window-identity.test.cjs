const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { APP_ID, PRODUCT_NAME } = require("../src/product.cjs");
const { PRODUCT_ICO, PRODUCT_WINDOW_OPTIONS, applyWindowIdentity, quoteWindowsArgument } = require("../src/window-identity.cjs");

function details(overrides = {}) {
  let result;
  applyWindowIdentity({ setAppDetails(value) { result = value; } }, {
    app: { isPackaged: false, getAppPath: () => "D:\\My Projects\\Agent Deck" },
    platform: "win32", execPath: "D:\\Agent Deck\\electron.exe", env: {}, ...overrides,
  });
  return result;
}

test("source launch uses product identity and relaunches the project through Electron", () => {
  assert.deepEqual(details(), {
    appId: APP_ID, appIconPath: PRODUCT_ICO, appIconIndex: 0,
    relaunchCommand: '"D:\\Agent Deck\\electron.exe" "D:\\My Projects\\Agent Deck"',
    relaunchDisplayName: PRODUCT_NAME,
  });
});

test("installed and portable taskbar relaunch targets never point into temporary extraction", () => {
  const app = { isPackaged: true, getAppPath: () => "C:\\Temp\\unpacked\\resources\\app.asar" };
  const installed = details({ app, execPath: "C:\\Program Files\\Agent Deck.exe" });
  assert.equal(installed.appIconPath, "C:\\Program Files\\Agent Deck.exe");
  assert.equal(installed.relaunchCommand, '"C:\\Program Files\\Agent Deck.exe"');
  const portable = details({ app, env: { PORTABLE_EXECUTABLE_FILE: "D:\\Downloads\\Agent Deck.exe" } });
  assert.equal(portable.appIconPath, "D:\\Downloads\\Agent Deck.exe");
  assert.equal(portable.relaunchCommand, '"D:\\Downloads\\Agent Deck.exe"');
});

test("non-Windows windows keep cross-platform icon and title without Windows calls", () => {
  assert.equal(PRODUCT_WINDOW_OPTIONS.title, PRODUCT_NAME);
  assert.ok(fs.existsSync(PRODUCT_WINDOW_OPTIONS.icon));
  assert.equal(details({ platform: "linux" }), undefined);
  assert.equal(quoteWindowsArgument("C:\\project\\"), '"C:\\project\\\\"');
});

test("the relaunch ICO includes valid PNG images for small and large taskbar sizes", () => {
  const ico = fs.readFileSync(PRODUCT_ICO);
  assert.equal(ico.readUInt16LE(2), 1);
  const count = ico.readUInt16LE(4);
  assert.equal(count, 7);
  const sizes = [];
  for (let index = 0; index < count; index++) {
    const entry = 6 + index * 16;
    const size = ico[entry] || 256;
    const offset = ico.readUInt32LE(entry + 12);
    const length = ico.readUInt32LE(entry + 8);
    assert.ok(offset + length <= ico.length);
    assert.equal(ico.subarray(offset + 1, offset + 4).toString(), "PNG");
    assert.equal(ico.readUInt32BE(offset + 16), size);
    sizes.push(size);
  }
  assert.deepEqual(sizes, [16, 24, 32, 48, 64, 128, 256]);
});

test("main window sets identity before display and capture overlays use product assets", () => {
  const main = fs.readFileSync(path.join(__dirname, "../src/main.cjs"), "utf8");
  const region = fs.readFileSync(path.join(__dirname, "../src/region-selector.cjs"), "utf8");
  assert.ok(main.indexOf("app.setAppUserModelId(APP_ID)") < main.indexOf("app.whenReady()"));
  assert.match(main, /new BrowserWindow\(\{\s*\.\.\.PRODUCT_WINDOW_OPTIONS,/);
  assert.ok(main.indexOf("applyWindowIdentity(windowRef, { app })") < main.indexOf('windowRef.once("ready-to-show"'));
  assert.match(region, /new BrowserWindow\(\{\s*\.\.\.PRODUCT_WINDOW_OPTIONS,/);
  assert.match(region, /skipTaskbar: true/);
});
