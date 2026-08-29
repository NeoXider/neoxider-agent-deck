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
const { normalizeHotkeyBindings } = require("../src/hotkey-manager.cjs");

function withTemporaryStore(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agent-deck-settings-test-"));
  const filePath = path.join(directory, "widget-settings.json");
  try {
    return run({ directory, filePath, store: createSettingsStore({ filePath }) });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function retryHarness() {
  const scheduled = [];
  return {
    scheduleRetry(callback, delay) {
      const handle = { callback, delay, canceled: false, unref() {} };
      scheduled.push(handle);
      return handle;
    },
    cancelRetry(handle) {
      handle.canceled = true;
    },
    runNext() {
      const handle = scheduled.find((candidate) => !candidate.canceled && !candidate.ran);
      if (!handle) return false;
      handle.ran = true;
      handle.callback();
      return true;
    },
    pending() {
      return scheduled.filter((candidate) => !candidate.canceled && !candidate.ran);
    },
  };
}

function fileSystemFailingRenames(failureState) {
  const fileSystem = Object.create(fs);
  fileSystem.renameSync = (source, destination) => {
    if (failureState.remaining > 0) {
      failureState.remaining -= 1;
      const error = new Error("settings file is temporarily locked");
      error.code = failureState.code;
      throw error;
    }
    return fs.renameSync(source, destination);
  };
  return fileSystem;
}

const completePreferences = {
  opacity: 0.73,
  glowIntensity: 0.41,
  showThinking: false,
  compactAutoExpand: true,
  size: "large",
  windowLayer: "game",
  compactSide: "left",
  hotkeys: normalizeHotkeyBindings({ captureRegion: { enabled: true, accelerator: "Control+Shift+R" } }),
  windowState: {
    version: 2,
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

test("a transient write failure keeps the latest preferences dirty and retries them", () => {
  withTemporaryStore(({ filePath }) => {
    const failureState = { remaining: 1, code: "EPERM" };
    const retries = retryHarness();
    const statuses = [];
    const store = createSettingsStore({
      filePath,
      fileSystem: fileSystemFailingRenames(failureState),
      retryDelaysMs: [25, 75],
      scheduleRetry: retries.scheduleRetry,
      cancelRetry: retries.cancelRetry,
      onStatusChange: (status) => statuses.push(status),
    });

    assert.throws(() => store.save(completePreferences), { code: "EPERM" });
    assert.deepEqual(store.getStatus(), {
      dirty: true,
      retryScheduled: true,
      retriesStarted: 1,
      retriesRemaining: 1,
      lastError: { code: "EPERM", message: "settings file is temporarily locked" },
      readOnly: false,
    });
    assert.deepEqual(retries.pending().map((entry) => entry.delay), [25]);

    assert.equal(retries.runNext(), true);
    assert.deepEqual(store.getStatus(), {
      dirty: false,
      retryScheduled: false,
      retriesStarted: 0,
      retriesRemaining: 2,
      lastError: null,
      readOnly: false,
    });
    assert.deepEqual(createSettingsStore({ filePath }).load(), completePreferences);
    assert.equal(statuses.some((status) => status.dirty && status.retryScheduled), true);
    assert.equal(statuses.at(-1).dirty, false);
  });
});

test("retry exhaustion remains observable and flush can persist the retained dirty state", () => {
  withTemporaryStore(({ filePath }) => {
    const failureState = { remaining: 3, code: "EBUSY" };
    const retries = retryHarness();
    const store = createSettingsStore({
      filePath,
      fileSystem: fileSystemFailingRenames(failureState),
      retryDelaysMs: [10, 30],
      scheduleRetry: retries.scheduleRetry,
      cancelRetry: retries.cancelRetry,
    });

    assert.throws(() => store.save(completePreferences), { code: "EBUSY" });
    while (retries.runNext()) {}
    assert.deepEqual(store.getStatus(), {
      dirty: true,
      retryScheduled: false,
      retriesStarted: 2,
      retriesRemaining: 0,
      lastError: { code: "EBUSY", message: "settings file is temporarily locked" },
      readOnly: false,
    });
    assert.equal(fs.existsSync(filePath), false);

    failureState.remaining = 0;
    assert.equal(store.flush(), true);
    assert.equal(store.getStatus().dirty, false);
    assert.deepEqual(createSettingsStore({ filePath }).load(), completePreferences);
  });
});

test("non-transient failures stay dirty without a background retry", () => {
  withTemporaryStore(({ filePath }) => {
    const failureState = { remaining: 1, code: "ENOSPC" };
    const retries = retryHarness();
    const store = createSettingsStore({
      filePath,
      fileSystem: fileSystemFailingRenames(failureState),
      retryDelaysMs: [10, 30],
      scheduleRetry: retries.scheduleRetry,
      cancelRetry: retries.cancelRetry,
    });

    assert.throws(() => store.save(completePreferences), { code: "ENOSPC" });
    assert.equal(store.getStatus().dirty, true);
    assert.equal(store.getStatus().retryScheduled, false);
    assert.equal(retries.pending().length, 0);

    assert.equal(store.flush(), true);
    assert.deepEqual(createSettingsStore({ filePath }).load(), completePreferences);
  });
});

test("final synchronous save keeps the latest state and does not start a shutdown retry loop", () => {
  withTemporaryStore(({ filePath }) => {
    const failureState = { remaining: 2, code: "EBUSY" };
    const finalPreferences = { ...completePreferences, opacity: 0.88 };
    const retries = retryHarness();
    const store = createSettingsStore({
      filePath,
      fileSystem: fileSystemFailingRenames(failureState),
      retryDelaysMs: [10, 30],
      scheduleRetry: retries.scheduleRetry,
      cancelRetry: retries.cancelRetry,
    });

    assert.throws(() => store.save(completePreferences), { code: "EBUSY" });
    assert.equal(retries.pending().length, 1);
    assert.throws(() => store.save(finalPreferences, { retryOnFailure: false }), { code: "EBUSY" });
    assert.equal(store.getStatus().dirty, true);
    assert.equal(store.getStatus().retryScheduled, false);
    assert.equal(retries.pending().length, 0);

    assert.equal(store.flush({ retryOnFailure: false }), true);
    assert.deepEqual(createSettingsStore({ filePath }).load(), finalPreferences);
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
  ["live Think visibility", (value) => ({ ...value, showThinking: true })],
  ["avatar auto expand", (value) => ({ ...value, compactAutoExpand: false })],
  ["size", (value) => ({ ...value, size: "compact" })],
  ["window layer", (value) => ({ ...value, windowLayer: "normal" })],
  ["compact side", (value) => ({ ...value, compactSide: "right" })],
  // normalizeHotkeyBindings, not normalizePreferences: the expectation still has to be
  // built independently of the store's own preference normalizer.
  ["hotkeys", (value) => ({ ...value, hotkeys: normalizeHotkeyBindings({ ...value.hotkeys, captureDisplay: false }) })],
  ["startup mode", (value) => ({ ...value, windowState: { ...value.windowState, mode: "edge" } })],
  ["full bounds", (value) => ({ ...value, windowState: { ...value.windowState, full: { x: 80, y: 90, width: 380, height: 520 } } })],
  ["orb bounds", (value) => ({ ...value, windowState: { ...value.windowState, orb: { x: 1740, y: 260, side: "right" } } })],
  ["edge bounds", (value) => ({ ...value, windowState: { ...value.windowState, edge: { x: -1920, y: 640, side: "left" } } })],
];

for (const [label, mutate] of preferenceMutations) {
  test(`${label} changes without resetting any other preference`, () => {
    withTemporaryStore(({ filePath, store }) => {
      store.save(completePreferences);
      // Built from the literal, NOT by re-running normalizePreferences over the mutation.
      // The expectation used to come out of the same normalizer the store applies, so a
      // normalizer that started dropping a field dropped it from the expectation too and
      // all eleven of these tests still passed while the setting was being destroyed.
      const expected = mutate(completePreferences);
      store.save(expected);
      const reloaded = createSettingsStore({ filePath }).load();
      assert.deepEqual(reloaded, expected);
      // And the mutation has to be the ONLY difference from where we started.
      const changed = Object.keys(expected).filter((key) => JSON.stringify(reloaded[key]) !== JSON.stringify(completePreferences[key]));
      assert.deepEqual(changed, Object.keys(expected).filter((key) => JSON.stringify(expected[key]) !== JSON.stringify(completePreferences[key])));
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

test("an older build cannot overwrite a newer settings schema and a newer reader gets the original data", () => {
  withTemporaryStore(({ filePath }) => {
    const newerPreferences = {
      ...completePreferences,
      futurePreference: { animationProfile: "cinematic" },
      windowState: { ...completePreferences.windowState, version: 3 },
    };
    fs.writeFileSync(filePath, `${JSON.stringify(newerPreferences, null, 2)}\n`, "utf8");
    fs.writeFileSync(`${filePath}.bak`, `${JSON.stringify(completePreferences, null, 2)}\n`, "utf8");

    const olderStore = createSettingsStore({ filePath });
    const fallback = olderStore.load();
    assert.deepEqual(fallback, completePreferences);
    assert.equal(olderStore.isReadOnly(), true);

    const attemptedSave = { ...fallback, opacity: 0.65, size: "compact" };
    assert.deepEqual(olderStore.save(attemptedSave), normalizePreferences(attemptedSave));
    assert.deepEqual(JSON.parse(fs.readFileSync(filePath, "utf8")), newerPreferences);
    assert.deepEqual(JSON.parse(fs.readFileSync(`${filePath}.bak`, "utf8")), completePreferences);

    const readAsNewerBuild = (candidate) => {
      const value = JSON.parse(fs.readFileSync(candidate, "utf8"));
      assert.equal(value.windowState.version, 3);
      return value;
    };
    assert.equal(readAsNewerBuild(filePath).futurePreference.animationProfile, "cinematic");
  });
});

for (const primaryState of ["absent", "corrupt"]) {
  test(`direct save preserves a newer backup when the primary is ${primaryState}`, () => {
    withTemporaryStore(({ filePath }) => {
      const newerBackup = {
        ...completePreferences,
        futurePreference: { responseStyle: "adaptive" },
        windowState: { ...completePreferences.windowState, version: 3 },
      };
      const backupPath = `${filePath}.bak`;
      fs.writeFileSync(backupPath, `${JSON.stringify(newerBackup, null, 2)}\n`, "utf8");
      if (primaryState === "corrupt") fs.writeFileSync(filePath, "{ corrupt primary", "utf8");

      const olderStore = createSettingsStore({ filePath });
      const attemptedSave = { ...completePreferences, opacity: 0.66 };
      assert.deepEqual(olderStore.save(attemptedSave), normalizePreferences(attemptedSave));
      assert.equal(olderStore.isReadOnly(), true);
      assert.deepEqual(JSON.parse(fs.readFileSync(backupPath, "utf8")), newerBackup);
      if (primaryState === "absent") assert.equal(fs.existsSync(filePath), false);
      else assert.equal(fs.readFileSync(filePath, "utf8"), "{ corrupt primary");
    });
  });
}

test("legacy alwaysOnTop migrates without losing other user settings", () => {
  const migrated = normalizePreferences({
    alwaysOnTop: false,
    opacity: 0.75,
    glowIntensity: 0.25,
    showThinking: true,
    size: "compact",
    compactSide: "left",
  });

  assert.deepEqual(migrated, {
    opacity: 0.75,
    glowIntensity: 0.25,
    showThinking: true,
    // Absent from an older file, so the collapsed default applies rather than the old
    // always-expanding behaviour being silently carried forward.
    compactAutoExpand: false,
    size: "compact",
    windowLayer: "normal",
    compactSide: "left",
    hotkeys: normalizeHotkeyBindings(),
    windowState: { version: 2, mode: "full", full: null, orb: null, edge: null },
  });
});

test("invalid shortcuts fall back without resetting unrelated preferences", () => {
  const normalized = normalizePreferences({
    opacity: 0.71,
    glowIntensity: 0.36,
    hotkeys: { showRestore: "not a shortcut" },
  });
  assert.equal(normalized.opacity, 0.71);
  assert.equal(normalized.glowIntensity, 0.36);
  assert.deepEqual(normalized.hotkeys, normalizeHotkeyBindings());
});

test("missing or malformed settings fall back to complete normalized defaults", () => {
  withTemporaryStore(({ filePath, store }) => {
    assert.deepEqual(store.load(), normalizePreferences(DEFAULT_PREFERENCES));
    fs.writeFileSync(filePath, "{ broken json", "utf8");
    assert.deepEqual(store.load(), normalizePreferences(DEFAULT_PREFERENCES));
  });
});
