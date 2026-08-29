// The portable build unpacks itself into a fresh %TEMP%\<random> directory on every launch
// and never removes the previous one. On this developer's machine that had accumulated 75
// directories holding 27 GB — roughly 100–350 MB per release, kept forever, with nothing in
// the product ever looking at them again.
//
// The launcher stub is electron-builder's and cannot be changed, but the app it starts can
// sweep the ones it left behind. The whole risk here is deleting the wrong directory, so the
// rules are deliberately narrow and every one of them is asserted:
//
//   * a candidate must sit directly in the temp root, never deeper;
//   * it must contain an executable named exactly for this product, current or legacy;
//   * it must also contain resources/app.asar, which an unrelated directory that merely
//     borrowed the name would not have;
//   * the directory this process is running from is never a candidate;
//   * a directory still held by another running copy simply fails to delete and is skipped.
//
// Nothing here reaches for Electron or the real filesystem, so the rules are testable
// against fakes rather than against a machine that has to be in the right state first.
const path = require("node:path");

const { LEGACY, PRODUCT_NAME } = require("./product.cjs");

// Bounded so a machine with hundreds of leftovers cannot turn startup into a long stall.
// The rest are swept on subsequent launches.
const MAX_REMOVALS_PER_LAUNCH = 24;

function executableNames() {
  const legacyProductNames = LEGACY.userDataDirectoryNames.filter((name) => name.includes(" "));
  return [PRODUCT_NAME, ...legacyProductNames].map((name) => `${name}.exe`);
}

// A portable launch runs from inside the extraction directory; an installed one does not.
// PORTABLE_EXECUTABLE_FILE is set by electron-builder's stub for the former only.
function isPortableLaunch(env = process.env, platform = process.platform) {
  if (platform !== "win32") return false;
  const portableFile = typeof env.PORTABLE_EXECUTABLE_FILE === "string" ? env.PORTABLE_EXECUTABLE_FILE.trim() : "";
  return Boolean(portableFile);
}

async function isOwnExtraction(fileSystem, directory) {
  const names = executableNames();
  let entries;
  try {
    entries = await fileSystem.readdir(directory);
  } catch {
    return false;
  }
  if (!entries.some((entry) => names.includes(entry))) return false;
  // The asar is the second signature: a directory that merely shares the product name, such
  // as one a user made by hand, will not carry one.
  try {
    const stats = await fileSystem.stat(path.join(directory, "resources", "app.asar"));
    return typeof stats?.isFile === "function" ? stats.isFile() : Boolean(stats);
  } catch {
    return false;
  }
}

async function sweepPortableExtractions({
  fileSystem,
  tempRoot,
  currentDirectory,
  maxRemovals = MAX_REMOVALS_PER_LAUNCH,
  onError = () => {},
} = {}) {
  const result = { scanned: 0, removed: [], skipped: [], bytesFreed: 0 };
  if (!fileSystem || !tempRoot) return result;
  let entries;
  try {
    entries = await fileSystem.readdir(tempRoot, { withFileTypes: true });
  } catch (error) {
    onError(error);
    return result;
  }
  const own = currentDirectory ? path.resolve(currentDirectory) : "";
  for (const entry of entries) {
    if (result.removed.length >= maxRemovals) break;
    if (!entry.isDirectory()) continue;
    const directory = path.join(tempRoot, entry.name);
    // Never the directory this process is executing from: removing it would pull the running
    // application out from under itself.
    if (own && path.resolve(directory) === own) continue;
    result.scanned += 1;
    if (!(await isOwnExtraction(fileSystem, directory))) continue;
    try {
      await fileSystem.rm(directory, { recursive: true, force: true });
      result.removed.push(directory);
    } catch (error) {
      // A copy that is still running holds its own files open. That is not a failure worth
      // reporting: the next launch, after that copy exits, will collect it.
      result.skipped.push(directory);
      onError(error);
    }
  }
  return result;
}

// The whole wiring lives here rather than in main.cjs, which is held to a line ceiling on
// purpose: the composition root should say *that* the sweep happens, not how.
//
// Deliberately not awaited by the caller — a slow temp volume must not hold up the window,
// and a failure here is housekeeping, never something to interrupt the user for.
function startPortableExtractionSweep({
  tempRoot,
  fileSystem = require("node:fs/promises"),
  execPath = process.execPath,
  env = process.env,
  platform = process.platform,
  log = console,
} = {}) {
  if (!isPortableLaunch(env, platform)) return null;
  return sweepPortableExtractions({
    fileSystem,
    tempRoot,
    currentDirectory: path.dirname(execPath),
    onError: (error) => log.warn?.("Could not remove a previous portable extraction", error?.code || error),
  })
    .then((result) => {
      if (result.removed.length) log.log?.(`Removed ${result.removed.length} previous portable extraction(s)`);
      return result;
    })
    .catch((error) => log.warn?.("Portable extraction sweep failed", error));
}

module.exports = {
  MAX_REMOVALS_PER_LAUNCH,
  executableNames,
  isOwnExtraction,
  isPortableLaunch,
  startPortableExtractionSweep,
  sweepPortableExtractions,
};
