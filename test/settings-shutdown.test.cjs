const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const mainSource = fs.readFileSync(path.join(__dirname, "..", "src", "main.cjs"), "utf8");

test("application cleanup stages current preferences with one final no-retry save", () => {
  assert.match(mainSource, /function cleanupApplication\(\) \{[\s\S]*?captureWindowBounds[\s\S]*?savePreferences\(\{ retryOnFailure: false \}\);/);
  assert.match(mainSource, /function writePreferences\(options\)[\s\S]*?settingsStore\.save\(preferences, options\)/);
});

test("tray Quit and before-quit share the idempotent cleanup coordinator", () => {
  assert.match(mainSource, /label: "Quit", click: \(\) => quitCoordinator\.requestQuit\("tray"\)/);
  assert.match(mainSource, /app\.on\("before-quit", \(\) => \{ imageEncoder\.shutdown\(\); quitCoordinator\.beforeQuit\(\); \}\);/);
});
