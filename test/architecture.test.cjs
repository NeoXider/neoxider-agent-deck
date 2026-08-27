// Enforces the rules in ARCHITECTURE.md.
//
// This file exists because main.cjs was split into modules once, the rules were written
// down nowhere, and it grew back past 950 lines within days. Documentation does not stop
// erosion; a failing test does.
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, readdirSync } = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const sourceDir = path.join(root, "src");
const sourceFiles = readdirSync(sourceDir).filter((name) => name.endsWith(".cjs"));
const lineCount = (file) => readFileSync(path.join(sourceDir, file), "utf8").split(/\r?\n/).length;

// Only these two may reach for Electron. Everything else takes what it needs as a
// parameter, which is what lets 21 module tests run without booting a browser.
const ELECTRON_ALLOWED = new Set(["main.cjs", "preload.cjs"]);

// Modules without a same-named test file, and why. Anything else added here needs a
// reason that survives being read aloud.
const TEST_EXEMPT = new Map([
  ["main.cjs", "composition; covered by ui-contract, the Electron UI smoke and the input regression"],
  ["preload.cjs", "one line per channel; ui-contract asserts handler/caller parity in both directions"],
  ["settings-store.cjs", "covered by settings-persistence.test.cjs, including the restart fixture"],
]);

// A ratchet, not a target. Lower it when you extract; never raise it to fit new code.
const MAIN_LINE_CEILING = 1000;
const MAIN_LINE_GOAL = 400;
// No single module should become the next god-object either.
const MODULE_LINE_CEILING = 700;

test("only the Electron entry points import Electron", () => {
  const offenders = sourceFiles.filter((file) => {
    if (ELECTRON_ALLOWED.has(file)) return false;
    return /require\(["']electron["']\)/.test(readFileSync(path.join(sourceDir, file), "utf8"));
  });
  assert.deepEqual(
    offenders,
    [],
    `these modules import Electron directly, so they cannot be unit tested: ${offenders.join(", ")}. `
      + "Take what you need as a parameter instead.",
  );
});

test("every module has a test file", () => {
  const testFiles = new Set(readdirSync(path.join(root, "test")).filter((name) => name.endsWith(".test.cjs")));
  const missing = sourceFiles.filter((file) => {
    if (TEST_EXEMPT.has(file)) return false;
    return !testFiles.has(`${path.basename(file, ".cjs")}.test.cjs`);
  });
  assert.deepEqual(
    missing,
    [],
    `no test file for: ${missing.join(", ")}. Add test/<name>.test.cjs, or declare an exemption with a reason.`,
  );
});

test("the exemption list stays honest", () => {
  // An exemption for a module that no longer exists is a rule quietly losing its teeth.
  const stale = [...TEST_EXEMPT.keys()].filter((file) => !sourceFiles.includes(file));
  assert.deepEqual(stale, [], `exempted modules that no longer exist: ${stale.join(", ")}`);
});

test("main.cjs stays a composition root", () => {
  const lines = lineCount("main.cjs");
  assert.ok(
    lines <= MAIN_LINE_CEILING,
    `main.cjs is ${lines} lines, over the ${MAIN_LINE_CEILING} ceiling (goal: ${MAIN_LINE_GOAL}). `
      + "Extract a module and lower the ceiling. Raising it is not the fix — that is exactly how it "
      + "grew back to 990 lines after the first split.",
  );
});

test("no module becomes the next god-object", () => {
  const oversized = sourceFiles
    .filter((file) => file !== "main.cjs")
    .map((file) => ({ file, lines: lineCount(file) }))
    .filter((entry) => entry.lines > MODULE_LINE_CEILING);
  assert.deepEqual(
    oversized,
    [],
    `over the ${MODULE_LINE_CEILING}-line module ceiling: ${oversized.map((e) => `${e.file} (${e.lines})`).join(", ")}`,
  );
});

test("the renderer stays sandboxed and bridged", () => {
  const main = readFileSync(path.join(sourceDir, "main.cjs"), "utf8");
  assert.match(main, /contextIsolation: true/);
  assert.match(main, /nodeIntegration: false/);
  assert.match(main, /sandbox: true/);
  // A second window or a navigation away from the local app would escape all of the above.
  assert.match(main, /setWindowOpenHandler/);
  assert.match(main, /"will-navigate"/);
  assert.match(main, /"will-attach-webview"/);
});

test("model output cannot carry executable markup", () => {
  const markdown = readFileSync(path.join(sourceDir, "markdown.cjs"), "utf8");
  assert.match(markdown, /html: false/);
  assert.match(markdown, /allowedSchemes: \["http", "https", "mailto"\]/);
  assert.match(markdown, /allowProtocolRelative: false/);
});
