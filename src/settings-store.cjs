const path = require("node:path");
const fs = require("node:fs");
const { DEFAULT_HOTKEYS, normalizeHotkeyBindings } = require("./hotkey-manager.cjs");

const DEFAULT_PREFERENCES = Object.freeze({
  opacity: 0.96,
  glowIntensity: 0.82,
  showThinking: true,
  size: "standard",
  windowLayer: "above",
  compactSide: "right",
  hotkeys: DEFAULT_HOTKEYS,
  windowState: Object.freeze({ version: 2, mode: "full", full: null, orb: null, edge: null }),
});

// The schema version this build writes. normalizePreferences discards keys it does
// not know, so opening a file written by a NEWER build would silently destroy that
// build's settings on the next save. Such a file is preserved instead.
const SCHEMA_VERSION = 2;
const DEFAULT_RETRY_DELAYS_MS = Object.freeze([120, 360, 900]);
const TRANSIENT_WRITE_ERROR_CODES = new Set(["EACCES", "EBUSY", "EMFILE", "ENFILE", "EPERM"]);

function boundedNumber(value, fallback, min, max) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(min, Math.min(max, numeric)) : fallback;
}

function finiteInteger(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric) : null;
}

function normalizeFullBounds(value) {
  const x = finiteInteger(value?.x);
  const y = finiteInteger(value?.y);
  const width = finiteInteger(value?.width);
  const height = finiteInteger(value?.height);
  return x === null || y === null || width === null || height === null || width < 1 || height < 1
    ? null
    : { x, y, width, height };
}

function normalizeCompactBounds(value, fallbackSide) {
  const x = finiteInteger(value?.x);
  const y = finiteInteger(value?.y);
  const side = value?.side === "left" || value?.side === "right" ? value.side : fallbackSide;
  return x === null || y === null ? null : { x, y, side };
}

function normalizePreferences(raw = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  const compactSide = source.compactSide === "left" ? "left" : "right";
  const legacyLayer = Object.prototype.hasOwnProperty.call(source, "alwaysOnTop")
    ? (source.alwaysOnTop ? "above" : "normal")
    : DEFAULT_PREFERENCES.windowLayer;
  const windowLayer = ["normal", "above", "game"].includes(source.windowLayer) ? source.windowLayer : legacyLayer;
  const windowStateSource = source.windowState && typeof source.windowState === "object" ? source.windowState : {};
  let hotkeys;
  try {
    hotkeys = normalizeHotkeyBindings(source.hotkeys || DEFAULT_HOTKEYS);
  } catch {
    hotkeys = normalizeHotkeyBindings(DEFAULT_HOTKEYS);
  }
  return {
    opacity: boundedNumber(source.opacity, DEFAULT_PREFERENCES.opacity, 0.65, 1),
    glowIntensity: boundedNumber(source.glowIntensity, DEFAULT_PREFERENCES.glowIntensity, 0, 1),
    showThinking: source.showThinking !== false,
    size: ["compact", "standard", "large"].includes(source.size) ? source.size : DEFAULT_PREFERENCES.size,
    windowLayer,
    compactSide,
    hotkeys,
    windowState: {
      version: SCHEMA_VERSION,
      mode: ["full", "orb", "edge"].includes(windowStateSource.mode) ? windowStateSource.mode : "full",
      full: normalizeFullBounds(windowStateSource.full),
      orb: normalizeCompactBounds(windowStateSource.orb, compactSide),
      edge: normalizeCompactBounds(windowStateSource.edge, compactSide),
    },
  };
}

function createSettingsStore({
  filePath,
  fileSystem = fs,
  retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
  scheduleRetry = setTimeout,
  cancelRetry = clearTimeout,
  onStatusChange = () => {},
} = {}) {
  if (!filePath) throw new Error("Settings file path is required");
  const backupPath = `${filePath}.bak`;
  const retryDelays = Array.from(retryDelaysMs, (value) => Math.max(0, Number(value) || 0));
  let protectedNewerSchema = null;
  let dirtyPreferences = null;
  let retryHandle = null;
  let retriesStarted = 0;
  let lastError = null;

  function read(candidate) {
    const raw = JSON.parse(fileSystem.readFileSync(candidate, "utf8"));
    const version = Number(raw?.windowState?.version);
    if (Number.isFinite(version) && version > SCHEMA_VERSION) {
      const error = new Error(`Settings schema v${version} is newer than v${SCHEMA_VERSION}`);
      error.code = "SETTINGS_TOO_NEW";
      error.settingsSchemaVersion = version;
      throw error;
    }
    return normalizePreferences(raw);
  }

  function protectNewerSettings(candidate, error) {
    if (error?.code !== "SETTINGS_TOO_NEW") return false;
    const version = error.settingsSchemaVersion;
    protectedNewerSchema ||= { path: candidate, version };
    if (candidate === filePath) {
      // This sidecar is only a recovery aid. The primary file remains authoritative
      // and save() becomes read-only so reinstalling the newer build sees it directly.
      try { fileSystem.copyFileSync(filePath, `${filePath}.v${version}`); } catch {}
    }
    return true;
  }

  function protectNewerSettingsBeforeSave() {
    if (protectedNewerSchema) return;
    let primaryIsUsable = false;
    try {
      read(filePath);
      primaryIsUsable = true;
    } catch (error) {
      try { protectNewerSettings(filePath, error); } catch {}
    }
    if (protectedNewerSchema || primaryIsUsable) return;
    try {
      read(backupPath);
    } catch (error) {
      try { protectNewerSettings(backupPath, error); } catch {}
    }
  }

  function errorView(error) {
    if (!error) return null;
    return {
      code: typeof error.code === "string" ? error.code : null,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  function status() {
    return {
      dirty: Boolean(dirtyPreferences),
      retryScheduled: retryHandle !== null,
      retriesStarted,
      retriesRemaining: Math.max(0, retryDelays.length - retriesStarted),
      lastError: errorView(lastError),
      readOnly: Boolean(protectedNewerSchema),
    };
  }

  function publishStatus() {
    try { onStatusChange(status()); } catch {}
  }

  function cancelScheduledRetry() {
    if (retryHandle === null) return;
    try { cancelRetry(retryHandle); } catch {}
    retryHandle = null;
  }

  function write(normalized) {
    fileSystem.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    try {
      fileSystem.writeFileSync(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
      try {
        JSON.parse(fileSystem.readFileSync(filePath, "utf8"));
        fileSystem.copyFileSync(filePath, backupPath);
      } catch {}
      fileSystem.renameSync(temporaryPath, filePath);
    } finally {
      try { fileSystem.rmSync(temporaryPath, { force: true }); } catch {}
    }
  }

  function retryable(error) {
    return TRANSIENT_WRITE_ERROR_CODES.has(error?.code);
  }

  function schedulePendingRetry() {
    if (retryHandle !== null || !dirtyPreferences || retriesStarted >= retryDelays.length) return;
    const delay = retryDelays[retriesStarted];
    retriesStarted += 1;
    retryHandle = scheduleRetry(() => {
      retryHandle = null;
      persistDirty(false);
    }, delay);
    retryHandle?.unref?.();
  }

  function persistDirty(throwOnFailure, retryOnFailure = true) {
    if (!dirtyPreferences) return true;
    try {
      write(dirtyPreferences);
      dirtyPreferences = null;
      lastError = null;
      retriesStarted = 0;
      publishStatus();
      return true;
    } catch (error) {
      lastError = error;
      if (retryOnFailure && retryable(error)) schedulePendingRetry();
      publishStatus();
      if (throwOnFailure) throw error;
      return false;
    }
  }

  return {
    load() {
      try {
        return read(filePath);
      } catch (error) {
        try { protectNewerSettings(filePath, error); } catch {}
      }
      try {
        return read(backupPath);
      } catch (error) {
        try { protectNewerSettings(backupPath, error); } catch {}
      }
      return normalizePreferences();
    },
    save(value, { retryOnFailure = true } = {}) {
      const normalized = normalizePreferences(value);
      // load() normally detects a downgrade first, but save() also guards direct
      // callers and a newer primary written after load. Returning the normalized
      // value preserves the existing API while deliberately leaving disk untouched.
      protectNewerSettingsBeforeSave();
      if (protectedNewerSchema) return normalized;
      cancelScheduledRetry();
      dirtyPreferences = normalized;
      retriesStarted = 0;
      lastError = null;
      persistDirty(true, retryOnFailure);
      return normalized;
    },
    flush({ retryOnFailure = true } = {}) {
      cancelScheduledRetry();
      return persistDirty(true, retryOnFailure);
    },
    getStatus: status,
    isReadOnly() {
      return Boolean(protectedNewerSchema);
    },
  };
}

module.exports = { DEFAULT_PREFERENCES, createSettingsStore, normalizePreferences };
