const fs = require("node:fs");
const path = require("node:path");
const { createSettingsStore, normalizePreferences } = require("./settings-store.cjs");
const { LEGACY, PACKAGE_NAME, USER_DATA_SEGMENTS } = require("./product.cjs");

const SETTINGS_FILE_NAME = "widget-settings.json";
const MIGRATION_MARKER_NAME = "migration-v1.json";

function writeJsonAtomic(filePath, value, fileSystem = fs) {
  fileSystem.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  try {
    fileSystem.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fileSystem.renameSync(temporaryPath, filePath);
  } finally {
    try { fileSystem.rmSync(temporaryPath, { force: true }); } catch {}
  }
}

function readNormalizedSettings(filePath, fileSystem = fs) {
  const parsed = JSON.parse(fileSystem.readFileSync(filePath, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Settings root must be an object");
  return normalizePreferences(parsed);
}

function migrateUserSettings({
  destinationDirectory,
  legacyDirectories,
  fileSystem = fs,
  now = () => new Date().toISOString(),
} = {}) {
  if (!destinationDirectory) throw new Error("Destination user-data directory is required");
  const destinationPath = path.join(destinationDirectory, SETTINGS_FILE_NAME);
  const markerPath = path.join(destinationDirectory, MIGRATION_MARKER_NAME);
  fileSystem.mkdirSync(destinationDirectory, { recursive: true });

  if (fileSystem.existsSync(destinationPath)) {
    return { status: "destination-present", destinationPath, markerPath, sourcePath: null };
  }

  const candidates = (legacyDirectories || []).flatMap((directory) => [
    path.join(directory, SETTINGS_FILE_NAME),
    path.join(directory, `${SETTINGS_FILE_NAME}.bak`),
  ]);

  for (const sourcePath of candidates) {
    if (!fileSystem.existsSync(sourcePath)) continue;
    try {
      const normalized = readNormalizedSettings(sourcePath, fileSystem);
      createSettingsStore({ filePath: destinationPath, fileSystem }).save(normalized);
      let markerWritten = false;
      try {
        writeJsonAtomic(markerPath, {
          version: 1,
          status: "migrated",
          sourcePath,
          migratedAt: now(),
        }, fileSystem);
        markerWritten = true;
      } catch {}
      return { status: "migrated", destinationPath, markerPath, markerWritten, sourcePath };
    } catch {}
  }

  return { status: "not-found", destinationPath, markerPath, sourcePath: null };
}

function configureProductUserData({ app, env = process.env, fileSystem = fs } = {}) {
  if (!app) throw new Error("Electron app is required");
  if (env.DSH_WIDGET_USER_DATA) {
    const userDataDirectory = path.resolve(env.DSH_WIDGET_USER_DATA);
    const sessionDataDirectory = path.join(userDataDirectory, "session-data");
    fileSystem.mkdirSync(userDataDirectory, { recursive: true });
    fileSystem.mkdirSync(sessionDataDirectory, { recursive: true });
    app.setPath("userData", userDataDirectory);
    app.setPath("sessionData", sessionDataDirectory);
    return { isSmoke: false, isIsolated: true, userDataDirectory, sessionDataDirectory, migration: null };
  }
  if (env.WIDGET_SCREENSHOT_PATH || env.WIDGET_PACKAGED_SMOKE_PATH) {
    const smokeRoot = path.join(app.getPath("temp"), `${PACKAGE_NAME}-smoke`, String(process.pid));
    const userDataDirectory = path.join(smokeRoot, "user-data");
    const sessionDataDirectory = path.join(smokeRoot, "session");
    fileSystem.mkdirSync(userDataDirectory, { recursive: true });
    fileSystem.mkdirSync(sessionDataDirectory, { recursive: true });
    app.setPath("userData", userDataDirectory);
    app.setPath("sessionData", sessionDataDirectory);
    return { isSmoke: true, userDataDirectory, sessionDataDirectory, migration: null };
  }

  const appDataDirectory = app.getPath("appData");
  const userDataDirectory = path.join(appDataDirectory, ...USER_DATA_SEGMENTS);
  const sessionDataDirectory = path.join(userDataDirectory, "session-data");
  const legacyDirectories = LEGACY.userDataDirectoryNames.map((name) => path.join(appDataDirectory, name));
  fileSystem.mkdirSync(userDataDirectory, { recursive: true });
  fileSystem.mkdirSync(sessionDataDirectory, { recursive: true });
  app.setPath("userData", userDataDirectory);
  app.setPath("sessionData", sessionDataDirectory);
  const migration = migrateUserSettings({ destinationDirectory: userDataDirectory, legacyDirectories, fileSystem });
  return { isSmoke: false, userDataDirectory, sessionDataDirectory, legacyDirectories, migration };
}

module.exports = {
  MIGRATION_MARKER_NAME,
  SETTINGS_FILE_NAME,
  configureProductUserData,
  migrateUserSettings,
  readNormalizedSettings,
};
