// Runs the test suite three times, pretending to be each supported platform.
//
// The launcher resolves paths for a platform passed in as an argument, so a bug there
// is invisible on the developer's own OS and only shows up on another one. That is
// exactly what happened: the suite passed on Windows for several releases while CI was
// red on macOS and Linux the whole time. This makes the same failure reproducible
// locally, before a push.
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readdirSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const PLATFORMS = ["win32", "darwin", "linux"];
const scratch = mkdtempSync(path.join(os.tmpdir(), "agent-deck-platform-"));

let failed = false;
for (const platform of PLATFORMS) {
  const hook = path.join(scratch, `as-${platform}.cjs`);
  // Faking process.platform alone is NOT enough and gives false confidence: the path
  // module picks win32 or posix rules when it is first loaded, from the real OS. A
  // simulated POSIX run that still resolves Windows-style paths passes tests that fail
  // on a real Linux runner — which is exactly how a CI failure once stayed hidden here.
  const flavour = platform === "win32" ? "win32" : "posix";
  writeFileSync(
    hook,
    [
      `Object.defineProperty(process, "platform", { value: ${JSON.stringify(platform)}, configurable: true });`,
      'const Module = require("node:module");',
      'const nodePath = require("node:path");',
      `const simulated = nodePath[${JSON.stringify(flavour)}];`,
      'const load = Module._load;',
      'Module._load = function (request, ...rest) {',
      '  if (request === "path" || request === "node:path") return simulated;',
      '  return load.call(this, request, ...rest);',
      '};',
      '',
    ].join("\n"),
    "utf8",
  );
  // Enumerate exactly like `npm test` does: the fixtures directory is not a test.
  const testFiles = readdirSync(path.join(root, "test"))
    .filter((name) => name.endsWith(".test.cjs"))
    .map((name) => path.join("test", name));
  const result = spawnSync(
    process.execPath,
    ["--require", hook, "--test", ...testFiles],
    { cwd: root, encoding: "utf8" },
  );
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  const pass = output.match(/^\s*(?:ℹ|#)\s*pass\s+(\d+)\s*$/m)?.[1] ?? "?";
  const fail = output.match(/^\s*(?:ℹ|#)\s*fail\s+(\d+)\s*$/m)?.[1] ?? "?";
  const ok = result.status === 0;
  if (!ok) {
    failed = true;
    console.log(`\n--- ${platform} failures ---`);
    for (const line of output.split(/\r?\n/)) {
      // The default reporter marks a failure with a cross; TAP output uses "not ok".
      if (/^\s*(?:✖|not ok )/.test(line) || /^\s+(?:error|expected|actual):/.test(line)) {
        console.log(`  ${line.trim()}`);
      }
    }
  }
  console.log(`${ok ? "✓" : "✗"} ${platform}: ${pass} passed, ${fail} failed`);
}

if (failed) {
  console.error("\nThe suite does not pass on every supported platform.");
  process.exit(1);
}
console.log("\nAll supported platforms pass.");
