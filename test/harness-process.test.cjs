const test = require("node:test");
const assert = require("node:assert/strict");
const { dshEntryFromCommandLine, listenerCommandLine, listenerDshEntry, pidsFromNetstat } = require("../src/harness-process.cjs");

const WINDOWS_COMMAND = 'node.exe --max-old-space-size=8192 "C:\\Users\\u\\AppData\\Local\\NeoXider\\DeepSeek Harness Runtime\\versions\\0.2.1-alpha.5\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js" web --no-open';
const NETSTAT = [
  "  TCP    0.0.0.0:3080           0.0.0.0:0              LISTENING       18576",
  "  TCP    127.0.0.1:3080         127.0.0.1:51000        ESTABLISHED     18576",
  "  TCP    127.0.0.1:51000        127.0.0.1:3080         ESTABLISHED     23072",
].join("\r\n");

test("the dsh entry is read out of a command line, quoted or not", () => {
  assert.equal(dshEntryFromCommandLine(WINDOWS_COMMAND), "C:\\Users\\u\\AppData\\Local\\NeoXider\\DeepSeek Harness Runtime\\versions\\0.2.1-alpha.5\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js");
  assert.equal(dshEntryFromCommandLine("node /home/u/.neoxider/dsh-runtime/versions/0.2.1-rc.2/node_modules/@deepseek-ai/dsh/lib/bin.js web"), "/home/u/.neoxider/dsh-runtime/versions/0.2.1-rc.2/node_modules/@deepseek-ai/dsh/lib/bin.js");
  assert.equal(dshEntryFromCommandLine("node server.js"), "");
});

test("only the listener on the Harness port counts, never a client of it", () => {
  assert.deepEqual(pidsFromNetstat(NETSTAT, 3080), [18576]);
  assert.deepEqual(pidsFromNetstat(NETSTAT, 43129), []);
});

test("on Windows the listener's command line comes from netstat and CIM; elsewhere from lsof and ps", async () => {
  const windowsCalls = [];
  const windows = await listenerDshEntry(3080, { platform: "win32", env: { SystemRoot: "C:\\Windows" }, runCommand: async (file, args) => {
    windowsCalls.push([file, args.at(-1)]);
    return { stdout: /netstat/.test(file) ? NETSTAT : WINDOWS_COMMAND };
  } });
  assert.match(windows, /0\.2\.1-alpha\.5/);
  assert.equal(windowsCalls[0][0], "C:\\Windows\\System32\\netstat.exe");
  assert.match(windowsCalls[1][1], /ProcessId=18576/);

  const posix = await listenerCommandLine(3080, { platform: "linux", runCommand: async (file) => ({ stdout: file === "lsof" ? "4242\n" : "node /x/@deepseek-ai/dsh/lib/bin.js web\n" }) });
  assert.equal(posix, "node /x/@deepseek-ai/dsh/lib/bin.js web");
  assert.equal(await listenerCommandLine(0), "");
  assert.equal(await listenerDshEntry(3080, { platform: "win32", env: {}, runCommand: async () => ({ stdout: "" }) }), "");
});
