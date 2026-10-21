const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  DEFAULT_DESKTOP_PORT,
  createDshDesktopLocator,
  desktopDataDirectory,
  desktopExecutablePath,
  desktopLogPath,
  parseDesktopLaunch,
  readTail,
} = require("../src/dsh-desktop.cjs");

const TOKEN_A = "a".repeat(43);
const TOKEN_B = "b".repeat(43);
const LOG = [
  "[2026-10-19T08:11:20.490Z] + 1519ms [desktop] starting 2026-10-19T08:11:20.490Z",
  "[2026-10-19T08:11:20.490Z] + 1519ms [desktop] endpoint http://127.0.0.1:43129",
  `[2026-10-19T08:11:32.787Z] +13816ms [stdout] dsh web: http://127.0.0.1:43129/?token=${TOKEN_A}`,
  "[2026-10-19T09:41:03.364Z] +  399ms [desktop] starting 2026-10-19T09:41:03.363Z",
  "[2026-10-19T09:41:03.364Z] +  399ms [desktop] preferred endpoint http://127.0.0.1:43129 is unavailable; using a temporary port",
  "[2026-10-19T09:41:03.364Z] +  399ms [desktop] endpoint http://127.0.0.1:51234",
  `[2026-10-19T09:41:09.699Z] + 6734ms [stdout] dsh web: http://127.0.0.1:51234/?token=${TOKEN_B}`,
].join("\r\n");

test("the data folder and its log are where DSH Desktop keeps them on each platform", () => {
  assert.equal(desktopDataDirectory({ platform: "win32", env: { APPDATA: "C:\\Users\\u\\AppData\\Roaming" } }), "C:\\Users\\u\\AppData\\Roaming\\dsh-desktop");
  assert.equal(desktopLogPath({ platform: "win32", env: { APPDATA: "C:\\Users\\u\\AppData\\Roaming" } }), "C:\\Users\\u\\AppData\\Roaming\\dsh-desktop\\logs\\harness.log");
  assert.equal(desktopDataDirectory({ platform: "darwin", env: {}, homedir: "/Users/u" }), "/Users/u/Library/Application Support/dsh-desktop");
  assert.equal(desktopLogPath({ platform: "linux", env: {}, homedir: "/home/u" }), "/home/u/.config/dsh-desktop/logs/harness.log");
  assert.equal(desktopLogPath({ platform: "win32", env: {} }), "", "no APPDATA, no guess");
});

test("the current launch is the newest endpoint and the launch URL that same launch printed", () => {
  const launch = parseDesktopLaunch(LOG);
  assert.equal(launch.url, "http://127.0.0.1:51234");
  assert.equal(launch.port, 51234);
  assert.equal(new URL(launch.launchUrl).searchParams.get("token"), TOKEN_B);
  assert.equal(launch.startedAt, Date.parse("2026-10-19T09:41:03.364Z"));
});

test("a launch still booting never borrows the token of the launch before it", () => {
  const booting = `${LOG}\r\n[2026-10-20T10:00:00.000Z] +  10ms [desktop] endpoint http://127.0.0.1:43129`;
  const launch = parseDesktopLaunch(booting);
  assert.equal(launch.url, "http://127.0.0.1:43129");
  assert.equal(launch.launchUrl, "");
  assert.equal(parseDesktopLaunch("nothing here"), null);
  assert.equal(parseDesktopLaunch("[desktop] endpoint http://evil.example:80"), null, "only a loopback endpoint counts");
});

test("only the tail of a long log is read", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deck-dshd-"));
  try {
    const file = path.join(dir, "harness.log");
    fs.writeFileSync(file, `${"x".repeat(5000)}\n${LOG}`);
    const tail = readTail(file, fs, 2000);
    assert.equal(tail.length, 2000);
    assert.ok(tail.endsWith(TOKEN_B));
    assert.equal(readTail(path.join(dir, "missing.log")), "");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the locator reports a running Harness with its launch URL, and drops the token of one that is not running", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deck-dshd-"));
  try {
    const appData = path.join(dir, "Roaming");
    fs.mkdirSync(path.join(appData, "dsh-desktop", "logs"), { recursive: true });
    fs.writeFileSync(path.join(appData, "dsh-desktop", "logs", "harness.log"), LOG);
    let answering = true;
    const probed = [];
    const locator = createDshDesktopLocator({
      platform: process.platform === "win32" ? "win32" : "linux",
      env: { APPDATA: appData, XDG_CONFIG_HOME: appData, LOCALAPPDATA: path.join(dir, "Local") },
      homedir: dir,
      probe: async (url) => { probed.push(url); return answering; },
    });
    const running = await locator.locate();
    assert.equal(running.running, true);
    assert.equal(running.installed, true, "a log proves it has run here");
    assert.equal(running.url, "http://127.0.0.1:51234");
    assert.ok(running.launchUrl.includes(TOKEN_B));
    assert.deepEqual(probed, ["http://127.0.0.1:51234"]);
    answering = false;
    const stopped = await locator.locate();
    assert.equal(stopped.running, false);
    assert.equal(stopped.launchUrl, "");
    assert.deepEqual(locator.current(), stopped);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("with no log the default port is probed and the executable is looked up where the installer puts it", async () => {
  const locator = createDshDesktopLocator({ platform: "win32", env: {}, fileSystem: { existsSync: () => false }, probe: async () => false });
  const result = await locator.locate();
  assert.equal(result.url, `http://127.0.0.1:${DEFAULT_DESKTOP_PORT}`);
  assert.equal(result.installed, false);
  const exe = "C:\\Users\\u\\AppData\\Local\\Programs\\DSH Desktop\\DSH Desktop.exe";
  assert.equal(desktopExecutablePath({ platform: "win32", env: { LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" }, fileSystem: { existsSync: (file) => file === exe } }), exe);
  assert.equal(desktopExecutablePath({ platform: "linux", env: {}, fileSystem: { existsSync: () => true } }), "");
});

test("the newest DSH Desktop release comes from its updater feed, the installed one from the app", async () => {
  const { DESKTOP_UPDATE_FEED, installedDesktopVersion, latestDesktopVersion } = require("../src/dsh-desktop.cjs");
  const seen = [];
  const latest = await latestDesktopVersion(async (url) => { seen.push(url); return { ok: true, text: async () => "version: 0.12.1\nfiles:\n  - url: \"x.exe\"\n" }; });
  assert.equal(latest, "0.12.1");
  assert.deepEqual(seen, [DESKTOP_UPDATE_FEED]);
  await assert.rejects(latestDesktopVersion(async () => ({ ok: false, status: 503 })), /503/);
  const commands = [];
  const installed = await installedDesktopVersion({ platform: "win32", executable: "C:\P\DSH Desktop\DSH Desktop.exe", runCommand: async (file, args) => { commands.push(args.at(-1)); return { stdout: "0.12.0.0\r\n" }; } });
  assert.equal(installed, "0.12.0");
  assert.match(commands[0], /Get-Item -LiteralPath 'C:\P\DSH Desktop\DSH Desktop\.exe'/);
  const mac = await installedDesktopVersion({ platform: "darwin", executable: "/Applications/DSH Desktop.app", fileSystem: { readFileSync: () => "<key>CFBundleShortVersionString</key>\n<string>0.12.1</string>" } });
  assert.equal(mac, "0.12.1");
  assert.equal(await installedDesktopVersion({ platform: "win32", executable: "" }), "");
});
