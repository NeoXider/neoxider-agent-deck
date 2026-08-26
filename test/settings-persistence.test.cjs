const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  DEFAULT_PREFERENCES,
  createSettingsStore,
  normalizePreferences,
} = require("../src/settings-store.cjs");

function withTemporaryStore(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agent-deck-settings-test-"));
  const filePath = path.join(directory, "widget-settings.json");
  try {
    return run({ directory, filePath, store: createSettingsStore({ filePath }) });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

const completePreferences = {
  opacity: 0.73,
  glowIntensity: 0.41,
  size: "large",
  windowLayer: "game",
  compactSide: "left",
  windowState: {
    version: 1,
    mode: "orb",
    full: { x: -1700, y: 140, width: 500, height: 760 },
    orb: { x: -1912, y: 510, side: "left" },
    edge: { x: 0, y: 780, side: "right" },
  },
};

test("all preferences and all mode bounds survive a disk round-trip", () => {
  withTemporaryStore(({ filePath, store }) => {
    assert.deepEqual(store.save(completePreferences), completePreferences);
    const afterRestart = createSettingsStore({ filePath });
    assert.deepEqual(afterRestart.load(), completePreferences);
  });
});

test("separate processes restore the same full, orb, and edge state from shared user data", () => {
  withTemporaryStore(({ filePath }) => {
    const child = path.join(__dirname, "fixtures", "settings-restart-child.cjs");
    const saved = spawnSync(process.execPath, [child, "save", filePath], {
      env: { ...process.env, WIDGET_TEST_PREFERENCES: JSON.stringify(completePreferences) },
      encoding: "utf8",
    });
    assert.equal(saved.status, 0, saved.stderr);

    const restarted = spawnSync(process.execPath, [child, "load", filePath], { encoding: "utf8" });
    assert.equal(restarted.status, 0, restarted.stderr);
    assert.deepEqual(JSON.parse(restarted.stdout), completePreferences);
  });
});

test("saving one setting does not erase other settings or mode bounds", () => {
  withTemporaryStore(({ filePath, store }) => {
    store.save(completePreferences);
    const loaded = createSettingsStore({ filePath }).load();
    createSettingsStore({ filePath }).save({ ...loaded, opacity: 0.88 });

    assert.deepEqual(createSettingsStore({ filePath }).load(), {
      ...completePreferences,
      opacity: 0.88,
    });
  });
});

const preferenceMutations = [
  ["opacity", (value) => ({ ...value, opacity: 0.88 })],
  ["glow intensity", (value) => ({ ...value, glowIntensity: 0.67 })],
  ["size", (value) => ({ ...value, size: "compact" })],
  ["window layer", (value) => ({ ...value, windowLayer: "normal" })],
  ["compact side", (value) => ({ ...value, compactSide: "right" })],
  ["startup mode", (value) => ({ ...value, windowState: { ...value.windowState, mode: "edge" } })],
  ["full bounds", (value) => ({ ...value, windowState: { ...value.windowState, full: { x: 80, y: 90, width: 380, height: 520 } } })],
  ["orb bounds", (value) => ({ ...value, windowState: { ...value.windowState, orb: { x: 1740, y: 260, side: "right" } } })],
  ["edge bounds", (value) => ({ ...value, windowState: { ...value.windowState, edge: { x: -1920, y: 640, side: "left" } } })],
];

for (const [label, mutate] of preferenceMutations) {
  test(`${label} changes without resetting any other preference`, () => {
    withTemporaryStore(({ filePath, store }) => {
      store.save(completePreferences);
      const expected = normalizePreferences(mutate(store.load()));
      store.save(expected);
      assert.deepEqual(createSettingsStore({ filePath }).load(), expected);
    });
  });
}

test("every native window mode survives restart", () => {
  withTemporaryStore(({ filePath, store }) => {
    for (const mode of ["full", "orb", "edge"]) {
      const expected = { ...completePreferences, windowState: { ...completePreferences.windowState, mode } };
      store.save(expected);
      assert.equal(createSettingsStore({ filePath }).load().windowState.mode, mode);
    }
  });
});

test("a corrupt primary settings file recovers the previous valid backup", () => {
  withTemporaryStore(({ filePath, store }) => {
    const previous = store.save(completePreferences);
    store.save({ ...completePreferences, size: "compact", glowIntensity: 0.9 });
    fs.writeFileSync(filePath, "{ definitely not json", "utf8");

    assert.deepEqual(createSettingsStore({ filePath }).load(), previous);
  });
});

test("corrupt primary and backup files fall back to all defaults", () => {
  withTemporaryStore(({ filePath, store }) => {
    store.save(completePreferences);
    store.save({ ...completePreferences, opacity: 0.9 });
    fs.writeFileSync(filePath, "{ broken primary", "utf8");
    fs.writeFileSync(`${filePath}.bak`, "{ broken backup", "utf8");

    assert.deepEqual(createSettingsStore({ filePath }).load(), normalizePreferences(DEFAULT_PREFERENCES));
  });
});

test("legacy alwaysOnTop migrates without losing other user settings", () => {
  const migrated = normalizePreferences({
    alwaysOnTop: false,
    opacity: 0.75,
    glowIntensity: 0.25,
    size: "compact",
    compactSide: "left",
  });

  assert.deepEqual(migrated, {
    opacity: 0.75,
    glowIntensity: 0.25,
    size: "compact",
    windowLayer: "normal",
    compactSide: "left",
    windowState: { version: 1, mode: "full", full: null, orb: null, edge: null },
  });
});

test("missing or malformed settings fall back to complete normalized defaults", () => {
  withTemporaryStore(({ filePath, store }) => {
    assert.deepEqual(store.load(), normalizePreferences(DEFAULT_PREFERENCES));
    fs.writeFileSync(filePath, "{ broken json", "utf8");
    assert.deepEqual(store.load(), normalizePreferences(DEFAULT_PREFERENCES));
  });
});
