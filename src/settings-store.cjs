const path = require("node:path");
const fs = require("node:fs");

const DEFAULT_PREFERENCES = Object.freeze({
  opacity: 0.96,
  glowIntensity: 0.82,
  size: "standard",
  windowLayer: "above",
  compactSide: "right",
  windowState: Object.freeze({ version: 1, mode: "full", full: null, orb: null, edge: null }),
});

// The schema version this build writes. normalizePreferences discards keys it does
// not know, so opening a file written by a NEWER build would silently destroy that
// build's settings on the next save. Such a file is preserved instead.
const SCHEMA_VERSION = 1;

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
  return {
    opacity: boundedNumber(source.opacity, DEFAULT_PREFERENCES.opacity, 0.65, 1),
    glowIntensity: boundedNumber(source.glowIntensity, DEFAULT_PREFERENCES.glowIntensity, 0, 1),
    size: ["compact", "standard", "large"].includes(source.size) ? source.size : DEFAULT_PREFERENCES.size,
    windowLayer,
    compactSide,
    windowState: {
      version: SCHEMA_VERSION,
      mode: ["full", "orb", "edge"].includes(windowStateSource.mode) ? windowStateSource.mode : "full",
      full: normalizeFullBounds(windowStateSource.full),
      orb: normalizeCompactBounds(windowStateSource.orb, compactSide),
      edge: normalizeCompactBounds(windowStateSource.edge, compactSide),
    },
  };
}

function createSettingsStore({ filePath, fileSystem = fs } = {}) {
  if (!filePath) throw new Error("Settings file path is required");
  const backupPath = `${filePath}.bak`;

  function read(candidate) {
    const raw = JSON.parse(fileSystem.readFileSync(candidate, "utf8"));
    const version = Number(raw?.windowState?.version);
    if (Number.isFinite(version) && version > SCHEMA_VERSION) {
      const error = new Error(`Settings schema v${version} is newer than v${SCHEMA_VERSION}`);
      error.code = "SETTINGS_TOO_NEW";
      throw error;
    }
    return normalizePreferences(raw);
  }

  return {
    load() {
      try {
        return read(filePath);
      } catch (error) {
        // A downgrade must not quietly overwrite a newer file: keep a copy first so
        // reinstalling the newer build restores the user's settings.
        if (error?.code === "SETTINGS_TOO_NEW") {
          try { fileSystem.copyFileSync(filePath, `${filePath}.v${Number(JSON.parse(fileSystem.readFileSync(filePath, "utf8"))?.windowState?.version)}`); } catch {}
        }
      }
      try { return read(backupPath); } catch {}
      return normalizePreferences();
    },
    save(value) {
      const normalized = normalizePreferences(value);
      fileSystem.mkdirSync(path.dirname(filePath), { recursive: true });
      const temporaryPath = `${filePath}.${process.pid}.tmp`;
      fileSystem.writeFileSync(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
      try {
        try {
          JSON.parse(fileSystem.readFileSync(filePath, "utf8"));
          fileSystem.copyFileSync(filePath, backupPath);
        } catch {}
        // renameSync replaces an existing destination on every supported platform
        // (libuv maps it to MoveFileExW with MOVEFILE_REPLACE_EXISTING on Windows), so
        // the swap is atomic. Deleting the destination first would open a window where
        // a crash leaves no settings file at all.
        fileSystem.renameSync(temporaryPath, filePath);
      } finally {
        try { fileSystem.rmSync(temporaryPath, { force: true }); } catch {}
      }
      return normalized;
    },
  };
}

module.exports = { DEFAULT_PREFERENCES, createSettingsStore, normalizePreferences };
