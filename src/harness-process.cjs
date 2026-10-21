// Which dsh is serving on the Harness port right now.
//
// Deck often follows a Harness it did not start this session: the one it started before a
// restart of the widget keeps running. To say "Harness 0.2.1-alpha.5 is running, 0.2.1-rc.2
// is out", the version has to come from the process itself, so the port's listener is
// looked up and the dsh entry read from its command line (`node ... dsh/lib/bin.js web`).
// Nothing is ever signalled or changed here.
const path = require("node:path");
const { execFile } = require("node:child_process");

const COMMAND_TIMEOUT_MS = 8000;

function defaultRunCommand(file, args, { timeout = COMMAND_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { encoding: "utf8", timeout, windowsHide: true }, (error, stdout) => resolve({ stdout: String(stdout || ""), error: error || null }));
  });
}

function windowsTool(name, env = process.env) {
  const root = typeof env?.SystemRoot === "string" ? env.SystemRoot.trim() : "";
  return root ? path.win32.join(root, "System32", name) : name;
}

// `...\node_modules\@deepseek-ai\dsh\lib\bin.js` out of a whole command line, quoted or not.
function dshEntryFromCommandLine(commandLine) {
  const match = /([A-Za-z]:[\\/][^"]*?|\/[^"\s]*?)[\\/]@deepseek-ai[\\/]dsh[\\/](lib|dist)[\\/]bin\.js/.exec(String(commandLine || ""));
  if (!match) return "";
  const separator = match[0].includes("\\") ? "\\" : "/";
  return `${match[1]}${separator}@deepseek-ai${separator}dsh${separator}${match[2]}${separator}bin.js`;
}

function pidsFromNetstat(output, port) {
  const pids = new Set();
  for (const line of String(output || "").split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5 || parts[0].toUpperCase() !== "TCP" || !parts[1].endsWith(`:${port}`)) continue;
    const listening = parts[3].toUpperCase() === "LISTENING" || /^(?:0\.0\.0\.0|\[::\]):0$/.test(parts[2]);
    const pid = Number.parseInt(parts[4], 10);
    if (listening && pid > 0) pids.add(pid);
  }
  return [...pids];
}

async function listenerCommandLine(port, { platform = process.platform, env = process.env, runCommand = defaultRunCommand } = {}) {
  const number = Number(port);
  if (!Number.isInteger(number) || number <= 0 || number > 65535) return "";
  if (platform === "win32") {
    const listing = await runCommand(windowsTool("netstat.exe", env), ["-ano"]);
    const [pid] = pidsFromNetstat(listing.stdout, number);
    if (!pid) return "";
    const powershell = windowsTool(path.win32.join("WindowsPowerShell", "v1.0", "powershell.exe"), env);
    const result = await runCommand(powershell, ["-NoProfile", "-NonInteractive", "-Command", `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`]);
    return result.stdout.trim();
  }
  const listing = await runCommand("lsof", ["-nP", `-iTCP:${number}`, "-sTCP:LISTEN", "-t"]);
  const pid = Number.parseInt(listing.stdout.trim().split(/\s+/)[0], 10);
  if (!(pid > 0)) return "";
  return (await runCommand("ps", ["-o", "args=", "-p", String(pid)])).stdout.trim();
}

async function listenerDshEntry(port, options) {
  return dshEntryFromCommandLine(await listenerCommandLine(port, options).catch(() => ""));
}

module.exports = { dshEntryFromCommandLine, listenerCommandLine, listenerDshEntry, pidsFromNetstat };
