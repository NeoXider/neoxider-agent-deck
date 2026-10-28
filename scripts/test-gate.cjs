// The whole release gate in one command: `npm run test:gate`.
//
// It used to be seven commands typed one after another, each stopping at its first failure,
// so a red suite hid every later one until the next run. Here every suite runs even after
// another failed, each one's time is printed, and the summary at the end names what to rerun.
// The unit tests go first (a minute, and a broken build fails there), then the visual suite
// on its worker pool (ui-visual-smoke.cjs), then the Electron smokes one at a time: they own
// the keyboard focus and the clock, so they never share the machine with each other. The
// scale benchmark goes last, alone, since it measures frame times.
const { spawn } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const SUITES = ["test", "test:ui", "test:input", "test:large-chat", "test:stability", "test:motion", "test:queued-attachments", "test:viewer", "test:scale"];

function runSuite(name) {
  return new Promise((resolve) => {
    const started = Date.now();
    // npm is a .cmd on Windows, which spawn only runs through a shell.
    const child = spawn("npm", ["run", name, "--silent"], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
    child.once("error", () => resolve({ name, code: 1, ms: Date.now() - started }));
    child.once("close", (code) => resolve({ name, code: code ?? 1, ms: Date.now() - started }));
  });
}

(async () => {
  const requested = process.argv.slice(2);
  const suites = requested.length ? SUITES.filter((name) => requested.includes(name)) : SUITES;
  const began = Date.now();
  const results = [];
  for (const name of suites) {
    process.stdout.write(`\n=== ${name} ===\n`);
    results.push(await runSuite(name));
  }
  process.stdout.write("\nGate summary\n");
  for (const { name, code, ms } of results) process.stdout.write(`  ${code === 0 ? "✓" : "✗"} ${name.padEnd(24)} ${(ms / 1000).toFixed(1)}s\n`);
  const failed = results.filter(({ code }) => code !== 0);
  process.stdout.write(`${results.length - failed.length}/${results.length} suites passed in ${((Date.now() - began) / 1000).toFixed(0)}s\n`);
  if (failed.length) {
    process.stdout.write(`Rerun: ${failed.map(({ name }) => (name === "test" ? "npm test" : name === "test:ui" ? "node scripts/ui-visual-smoke.cjs --failed" : `npm run ${name}`)).join(" ; ")}\n`);
    process.exitCode = 1;
  }
})();
