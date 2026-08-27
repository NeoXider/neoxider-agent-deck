const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  MIGRATION_MARKER_NAME,
  SETTINGS_FILE_NAME,
  configureProductUserData,
  migrateUserSettings,
} = require("../src/user-data-migration.cjs");

function withTemporaryDirectory(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agent-deck-user-data-"));
  try { return run(directory); } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

const legacyPreferences = {
  opacity: 0.74,
  glowIntensity: 0.42,
  size: "large",
  windowLayer: "game",
  compactSide: "left",
  windowState: { version: 1, mode: "edge", full: null, orb: null, edge: { x: 4, y: 220, side: "left" } },
};

test("migrates and normalizes only the legacy settings file without deleting it", () => withTemporaryDirectory((root) => {
  const legacy = path.join(root, "deepseek-harness-widget");
  const destination = path.join(root, "NeoXider", "AgentDeck");
  fs.mkdirSync(legacy, { recursive: true });
  const sourcePath = path.join(legacy, SETTINGS_FILE_NAME);
  fs.writeFileSync(sourcePath, JSON.stringify({ ...legacyPreferences, opacity: 9, unknown: true }));

  const result = migrateUserSettings({ destinationDirectory: destination, legacyDirectories: [legacy], now: () => "2026-08-26T00:00:00.000Z" });

  assert.equal(result.status, "migrated");
  assert.equal(result.markerWritten, true);
  assert.equal(result.sourcePath, sourcePath);
  assert.equal(JSON.parse(fs.readFileSync(path.join(destination, SETTINGS_FILE_NAME))).opacity, 1);
  assert.equal(fs.existsSync(sourcePath), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(destination, MIGRATION_MARKER_NAME))), {
    version: 1,
    status: "migrated",
    sourcePath,
    migratedAt: "2026-08-26T00:00:00.000Z",
  });
}));

test("uses the valid legacy backup when the primary file is corrupt", () => withTemporaryDirectory((root) => {
  const legacy = path.join(root, "legacy");
  const destination = path.join(root, "new");
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, SETTINGS_FILE_NAME), "{ broken", "utf8");
  fs.writeFileSync(path.join(legacy, `${SETTINGS_FILE_NAME}.bak`), JSON.stringify(legacyPreferences), "utf8");

  const result = migrateUserSettings({ destinationDirectory: destination, legacyDirectories: [legacy] });

  assert.equal(result.status, "migrated");
  assert.equal(result.sourcePath.endsWith(".bak"), true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(destination, SETTINGS_FILE_NAME))).windowState.mode, "edge");
}));

test("an existing destination always wins over legacy data", () => withTemporaryDirectory((root) => {
  const legacy = path.join(root, "legacy");
  const destination = path.join(root, "new");
  fs.mkdirSync(legacy, { recursive: true });
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(legacy, SETTINGS_FILE_NAME), JSON.stringify(legacyPreferences));
  fs.writeFileSync(path.join(destination, SETTINGS_FILE_NAME), JSON.stringify({ marker: "new" }));

  const result = migrateUserSettings({ destinationDirectory: destination, legacyDirectories: [legacy] });

  assert.equal(result.status, "destination-present");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(destination, SETTINGS_FILE_NAME))), { marker: "new" });
}));

for (const [label, env] of [
  ["screenshot", { WIDGET_SCREENSHOT_PATH: "capture.png" }],
  ["packaged launch", { WIDGET_PACKAGED_SMOKE_PATH: "ready.json" }],
]) test(`${label} smoke uses isolated user and session data without migration`, () => withTemporaryDirectory((root) => {
  const calls = [];
  const app = {
    getPath(name) {
      if (name === "temp") return root;
      if (name === "appData") return path.join(root, "app-data");
      throw new Error(`Unexpected path: ${name}`);
    },
    setPath(name, value) { calls.push([name, value]); },
  };

  const result = configureProductUserData({ app, env });

  assert.equal(result.isSmoke, true);
  assert.match(result.userDataDirectory, /neoxider-agent-deck-smoke/);
  assert.equal(result.migration, null);
  assert.deepEqual(calls.map(([name]) => name), ["userData", "sessionData"]);
}));
