const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { REPOSITORY_SLUG } = require("./product.cjs");
const { recoverStagedUpdate } = require("./portable-update-stage.cjs");

const DEFAULT_MAX_UPDATE_BYTES = 256 * 1024 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 15 * 60_000;
const DEFAULT_DOWNLOAD_IDLE_TIMEOUT_MS = 30_000;
const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SHA256_DIGEST = /^sha256:([a-f\d]{64})$/i;
const STATUSES = Object.freeze([
  "idle",
  "checking",
  "current",
  "available",
  "downloading",
  "ready",
  "installing",
  "error",
]);
const TRANSITIONS = Object.freeze({
  idle: new Set(["checking"]),
  checking: new Set(["current", "available", "error"]),
  current: new Set(["checking"]),
  available: new Set(["checking", "downloading", "ready", "error"]),
  downloading: new Set(["available", "ready", "error"]),
  ready: new Set(["installing", "error"]),
  installing: new Set(["error"]),
  error: new Set(["checking"]),
});

const POWERSHELL_REPLACEMENT_HELPER = String.raw`param(
  [Parameter(Mandatory=$true)][string]$Target,
  [Parameter(Mandatory=$true)][string]$Staged,
  [Parameter(Mandatory=$true)][string]$Backup,
  [Parameter(Mandatory=$true)][int]$ParentPid
)

$ErrorActionPreference = "Stop"
$replacementDone = $false
$exitCode = 1

function Move-FileReplace([string]$Source, [string]$Destination) {
  if (-not ("NativeUpdate.MoveFile" -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace NativeUpdate {
  public static class MoveFile {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool MoveFileEx(string source, string destination, int flags);
  }
}
'@
  }
  $replaceExisting = 0x1
  $writeThrough = 0x8
  if (-not [NativeUpdate.MoveFile]::MoveFileEx($Source, $Destination, $replaceExisting -bor $writeThrough)) {
    $code = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    throw "MoveFileEx failed with Win32 error $code"
  }
}

try {
  try { Wait-Process -Id $ParentPid -Timeout 60 -ErrorAction SilentlyContinue } catch {}

  $unlocked = $false
  for ($attempt = 0; $attempt -lt 480; $attempt += 1) {
    try {
      $handle = [IO.File]::Open($Target, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
      $handle.Dispose()
      $unlocked = $true
      break
    } catch {
      Start-Sleep -Milliseconds 250
    }
  }
  if (-not $unlocked) { throw "The portable launcher did not become writable" }

  Remove-Item -LiteralPath $Backup -Force -ErrorAction SilentlyContinue
  try {
    [IO.File]::Replace($Staged, $Target, $Backup, $true)
  } catch {
    Copy-Item -LiteralPath $Target -Destination $Backup -Force
    Move-FileReplace $Staged $Target
  }
  $replacementDone = $true

  try {
    Start-Process -FilePath $Target -WorkingDirectory ([IO.Path]::GetDirectoryName($Target)) | Out-Null
  } catch {
    if (Test-Path -LiteralPath $Backup) {
      Move-FileReplace $Backup $Target
      $replacementDone = $false
    }
    throw
  }
  $exitCode = 0
} catch {
  if (-not $replacementDone) {
    Remove-Item -LiteralPath $Staged -Force -ErrorAction SilentlyContinue
  }
} finally {
  Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue
}

exit $exitCode
`;

class UpdateError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = "UpdateError";
    this.code = code;
  }
}

function updateError(code, message, cause) {
  return cause instanceof UpdateError ? cause : new UpdateError(code, message, cause);
}

function publicError(error) {
  return Object.freeze({
    code: String(error?.code || "UPDATE_FAILED"),
    message: String(error?.message || "Update failed"),
  });
}

function parseStableVersion(value) {
  const match = String(value || "").match(STABLE_VERSION);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}

function compareStableVersions(left, right) {
  const a = parseStableVersion(left);
  const b = parseStableVersion(right);
  if (!a || !b) throw new TypeError("Both versions must be stable semantic versions");
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

function releaseVersion(release) {
  const tag = String(release?.tag_name || "");
  if (release?.draft || release?.prerelease || !tag.startsWith("v")) return null;
  const version = tag.slice(1);
  return parseStableVersion(version) ? version : null;
}

function expectedPortableAssetName(version) {
  return `NeoXider-Agent-Deck-${version}-windows-x64-portable.exe`;
}

function selectWindowsPortableAsset(release, version, {
  repository = REPOSITORY_SLUG,
  maxBytes = DEFAULT_MAX_UPDATE_BYTES,
} = {}) {
  const name = expectedPortableAssetName(version);
  const asset = Array.isArray(release?.assets)
    ? release.assets.find((candidate) => candidate?.name === name)
    : null;
  if (!asset) throw updateError("UPDATE_ASSET_MISSING", "This release has no Windows x64 portable update");
  if (asset.state !== "uploaded") throw updateError("UPDATE_ASSET_NOT_READY", "The Windows update is not ready to download");

  const size = Number(asset.size);
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw updateError("UPDATE_SIZE_INVALID", "The update has an invalid size");
  }
  if (size > maxBytes) throw updateError("UPDATE_TOO_LARGE", "The update exceeds the download size limit");

  const digest = String(asset.digest || "").match(SHA256_DIGEST)?.[1]?.toLowerCase();
  if (!digest) throw updateError("UPDATE_DIGEST_MISSING", "The update has no valid SHA-256 digest");

  const expectedUrl = `https://github.com/${repository}/releases/download/v${version}/${name}`;
  if (asset.browser_download_url !== expectedUrl) {
    throw updateError("UPDATE_URL_INVALID", "The update download address is invalid");
  }
  return Object.freeze({ name, size, digest, url: expectedUrl });
}

function resolvePortableInstallTarget({
  platform = process.platform,
  arch = process.arch,
  env = process.env,
  isPackaged = false,
} = {}) {
  if (!isPackaged) return { target: null, reason: "development-build" };
  if (platform !== "win32") return { target: null, reason: "unsupported-platform" };
  if (arch !== "x64") return { target: null, reason: "unsupported-architecture" };
  const candidate = typeof env.PORTABLE_EXECUTABLE_FILE === "string"
    ? env.PORTABLE_EXECUTABLE_FILE.trim()
    : "";
  if (!candidate) return { target: null, reason: "not-portable" };
  if (!path.win32.isAbsolute(candidate) || path.win32.extname(candidate).toLowerCase() !== ".exe") {
    return { target: null, reason: "invalid-portable-target" };
  }
  return { target: path.win32.normalize(candidate), reason: null };
}

async function writeAll(fileHandle, value, position) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  let offset = 0;
  while (offset < buffer.length) {
    const result = await fileHandle.write(buffer, offset, buffer.length - offset, position + offset);
    if (!result?.bytesWritten) throw updateError("UPDATE_WRITE_FAILED", "The update could not be written");
    offset += result.bytesWritten;
  }
}

function timedOperation(operation, timeoutMs, controller, error) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try { controller?.abort(); } catch {}
      reject(error);
    }, timeoutMs);
  });
  return Promise.race([operation, timeout]).finally(() => clearTimeout(timer));
}

async function removeStaleUpdateFiles(fileSystem, directory, targetName) {
  const prefix = `.${targetName}.`;
  let entries;
  try {
    entries = await fileSystem.readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.startsWith(prefix) && (entry.name.endsWith(".update") || entry.name.endsWith(".update.ps1")))
    .map((entry) => fileSystem.rm(path.join(directory, entry.name), { force: true }).catch(() => {})));
}

function childSpawned(child) {
  if (!child || typeof child.once !== "function") {
    child?.unref?.();
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref?.();
      resolve();
    });
  });
}

async function launchPowerShellReplacement({
  target,
  stagedPath,
  backupPath,
  helperPath,
  parentPid = process.pid,
  env = process.env,
  fileSystem = fs.promises,
  spawnImpl = spawn,
} = {}) {
  await fileSystem.writeFile(helperPath, POWERSHELL_REPLACEMENT_HELPER, { encoding: "utf8", flag: "wx" });
  const executable = env.SystemRoot
    ? path.win32.join(env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    : "powershell.exe";
  let child;
  try {
    child = spawnImpl(executable, [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      helperPath,
      "-Target",
      target,
      "-Staged",
      stagedPath,
      "-Backup",
      backupPath,
      "-ParentPid",
      String(parentPid),
    ], { detached: true, windowsHide: true, stdio: "ignore" });
    await childSpawned(child);
  } catch (error) {
    await fileSystem.rm(helperPath, { force: true }).catch(() => {});
    throw updateError("UPDATE_HELPER_FAILED", "The update installer could not be started", error);
  }
}

function createUpdateService({
  currentVersion,
  repository = REPOSITORY_SLUG,
  platform = process.platform,
  arch = process.arch,
  env = process.env,
  isPackaged = false,
  fetchImpl = globalThis.fetch,
  fileSystem = fs.promises,
  fileConstants = fs.constants,
  hashFactory = () => crypto.createHash("sha256"),
  randomId = () => crypto.randomUUID(),
  resolveInstallTarget = resolvePortableInstallTarget,
  launchReplacement = launchPowerShellReplacement,
  requestQuit = null,
  openExternal = null,
  onState = () => {},
  maxBytes = DEFAULT_MAX_UPDATE_BYTES,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  downloadTimeoutMs = DEFAULT_DOWNLOAD_TIMEOUT_MS,
  downloadIdleTimeoutMs = DEFAULT_DOWNLOAD_IDLE_TIMEOUT_MS,
  abortControllerFactory = () => new AbortController(),
  now = () => Date.now(),
  parentPid = process.pid,
} = {}) {
  if (!parseStableVersion(currentVersion)) throw new TypeError("currentVersion must be a stable semantic version");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new TypeError("repository must be owner/name");
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new TypeError("maxBytes must be a positive safe integer");
  for (const [name, value] of Object.entries({ requestTimeoutMs, downloadTimeoutMs, downloadIdleTimeoutMs })) {
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name} must be a positive safe integer`);
  }
  if (typeof abortControllerFactory !== "function") throw new TypeError("abortControllerFactory must be a function");
  if (typeof now !== "function") throw new TypeError("now must be a function");

  let state = Object.freeze({
    status: "idle",
    currentVersion,
    latestVersion: null,
    releaseUrl: null,
    assetName: null,
    assetSize: 0,
    installMode: "manual",
    manualReason: "not-checked",
    progress: null,
    receivedBytes: 0,
    totalBytes: 0,
    error: null,
  });
  let candidate = null;
  let installContext = { target: null, reason: "not-checked" };
  let stagedPath = null;
  let checkPromise = null;
  let downloadPromise = null;
  let installPromise = null;

  function snapshot() {
    return Object.freeze({ ...state, error: state.error ? Object.freeze({ ...state.error }) : null });
  }

  function publish() {
    try { onState(snapshot()); } catch {}
    return snapshot();
  }

  function transition(status, patch = {}) {
    if (!STATUSES.includes(status)) throw new TypeError(`Unknown update status: ${status}`);
    if (status !== state.status && !TRANSITIONS[state.status]?.has(status)) {
      throw new Error(`Invalid update transition: ${state.status} -> ${status}`);
    }
    state = Object.freeze({
      ...state,
      ...patch,
      status,
      error: status === "error" ? patch.error : null,
    });
    return publish();
  }

  function fail(statusFrom, error, fallbackCode, fallbackMessage) {
    const normalized = updateError(fallbackCode, fallbackMessage, error);
    if (state.status !== statusFrom) return snapshot();
    return transition("error", { error: publicError(normalized), progress: null });
  }

  async function evaluateInstallContext() {
    const resolved = await resolveInstallTarget({ platform, arch, env, isPackaged });
    if (!resolved?.target) return { target: null, reason: resolved?.reason || "not-portable" };
    try {
      const targetInfo = await fileSystem.stat(resolved.target);
      if (!targetInfo.isFile()) return { target: null, reason: "invalid-portable-target" };
      await fileSystem.access(resolved.target, fileConstants.R_OK | fileConstants.W_OK);
      await fileSystem.access(path.dirname(resolved.target), fileConstants.W_OK);
      if (typeof requestQuit !== "function") return { target: null, reason: "quit-unavailable" };
      return { target: resolved.target, reason: null };
    } catch {
      return { target: null, reason: "target-not-writable" };
    }
  }

  async function runCheck() {
    stagedPath = null;
    transition("checking", {
      progress: null,
      receivedBytes: 0,
      totalBytes: 0,
      manualReason: null,
    });
    try {
      const controller = abortControllerFactory();
      const response = await timedOperation(fetchImpl(`https://api.github.com/repos/${repository}/releases/latest`, {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "NeoXider-Agent-Deck-Updater",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal: controller.signal,
      }), requestTimeoutMs, controller, updateError("UPDATE_TIMEOUT", "The update check timed out"));
      if (!response?.ok) throw updateError("UPDATE_CHECK_HTTP", "GitHub could not be reached for updates");
      const release = await timedOperation(
        Promise.resolve().then(() => response.json()),
        requestTimeoutMs,
        controller,
        updateError("UPDATE_TIMEOUT", "The update response timed out"),
      );
      const latestVersion = releaseVersion(release);
      if (!latestVersion) throw updateError("UPDATE_RELEASE_INVALID", "The latest release is not a stable published version");
      const releaseUrl = `https://github.com/${repository}/releases/tag/v${latestVersion}`;

      if (compareStableVersions(latestVersion, currentVersion) <= 0) {
        candidate = null;
        installContext = { target: null, reason: "already-current" };
        return transition("current", {
          latestVersion,
          releaseUrl,
          assetName: null,
          assetSize: 0,
          installMode: "none",
          manualReason: null,
        });
      }

      const asset = selectWindowsPortableAsset(release, latestVersion, { repository, maxBytes });
      installContext = await evaluateInstallContext();
      candidate = Object.freeze({ version: latestVersion, releaseUrl, asset });
      const available = transition("available", {
        latestVersion,
        releaseUrl,
        assetName: asset.name,
        assetSize: asset.size,
        installMode: installContext.target ? "portable-replace" : "manual",
        manualReason: installContext.reason,
        progress: null,
        receivedBytes: 0,
        totalBytes: asset.size,
      });
      if (!installContext.target) return available;
      const recovered = await recoverStagedUpdate(fileSystem, installContext.target, latestVersion, asset, hashFactory);
      if (!recovered) return available;
      stagedPath = recovered;
      return transition("ready", {
        progress: 100,
        receivedBytes: asset.size,
        totalBytes: asset.size,
      });
    } catch (error) {
      candidate = null;
      installContext = { target: null, reason: "check-failed" };
      return fail("checking", error, "UPDATE_CHECK_FAILED", "Could not check for updates");
    }
  }

  function check() {
    if (checkPromise) return checkPromise;
    if (["downloading", "ready", "installing"].includes(state.status)) return Promise.resolve(snapshot());
    const operation = runCheck();
    checkPromise = operation;
    operation.then(
      () => { if (checkPromise === operation) checkPromise = null; },
      () => { if (checkPromise === operation) checkPromise = null; },
    );
    return operation;
  }

  function progressState(received, total, lastProgress) {
    const progress = total > 0 ? Math.min(100, Math.floor((received / total) * 100)) : null;
    if (progress === lastProgress && received !== total) return lastProgress;
    transition("downloading", { progress, receivedBytes: received, totalBytes: total });
    return progress;
  }

  async function runDownload() {
    if (state.status === "checking" && checkPromise) await checkPromise;
    if (state.status !== "available" || !candidate) return snapshot();
    if (!installContext.target) return snapshot();
    transition("downloading", {
      progress: 0,
      receivedBytes: 0,
      totalBytes: candidate.asset.size,
    });

    const targetDirectory = path.dirname(installContext.target);
    await removeStaleUpdateFiles(fileSystem, targetDirectory, path.basename(installContext.target));
    const token = String(randomId()).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 48) || String(process.pid);
    const stageName = `.${path.basename(installContext.target)}.${candidate.version}.${token}.update`;
    const pendingPath = path.join(targetDirectory, stageName);
    let handle;
    try {
      handle = await fileSystem.open(pendingPath, "wx");
    } catch (error) {
      installContext = { target: null, reason: "target-not-writable" };
      return transition("available", {
        installMode: "manual",
        manualReason: installContext.reason,
        progress: null,
        receivedBytes: 0,
      });
    }

    try {
      const controller = abortControllerFactory();
      const startedAt = now();
      const response = await timedOperation(fetchImpl(candidate.asset.url, {
        headers: { "User-Agent": "NeoXider-Agent-Deck-Updater" },
        redirect: "follow",
        signal: controller.signal,
      }), requestTimeoutMs, controller, updateError("UPDATE_TIMEOUT", "The update download could not start in time"));
      if (!response?.ok || !response.body) throw updateError("UPDATE_DOWNLOAD_HTTP", "The update download failed");
      const announcedLength = Number(response.headers?.get?.("content-length"));
      if (Number.isFinite(announcedLength) && announcedLength > maxBytes) {
        throw updateError("UPDATE_TOO_LARGE", "The update exceeds the download size limit");
      }

      const hash = hashFactory();
      let received = 0;
      let lastProgress = 0;
      const iterator = response.body[Symbol.asyncIterator]();
      while (true) {
        const remaining = downloadTimeoutMs - (now() - startedAt);
        if (remaining <= 0) throw updateError("UPDATE_TIMEOUT", "The update download timed out");
        const next = await timedOperation(
          iterator.next(),
          Math.min(downloadIdleTimeoutMs, remaining),
          controller,
          updateError("UPDATE_TIMEOUT", "The update download stalled"),
        );
        if (next.done) break;
        const value = next.value;
        const chunk = Buffer.from(value);
        if (received + chunk.length > maxBytes || received + chunk.length > candidate.asset.size) {
          throw updateError("UPDATE_TOO_LARGE", "The update exceeds its declared size");
        }
        await writeAll(handle, chunk, received);
        hash.update(chunk);
        received += chunk.length;
        lastProgress = progressState(received, candidate.asset.size, lastProgress);
      }
      await handle.close();
      handle = null;

      if (received !== candidate.asset.size) throw updateError("UPDATE_SIZE_MISMATCH", "The downloaded update size is invalid");
      const digest = hash.digest("hex").toLowerCase();
      if (digest !== candidate.asset.digest) throw updateError("UPDATE_DIGEST_MISMATCH", "The downloaded update failed verification");

      stagedPath = pendingPath;
      return transition("ready", {
        progress: 100,
        receivedBytes: received,
        totalBytes: candidate.asset.size,
      });
    } catch (error) {
      try { await handle?.close(); } catch {}
      await fileSystem.rm(pendingPath, { force: true }).catch(() => {});
      stagedPath = null;
      return fail("downloading", error, "UPDATE_DOWNLOAD_FAILED", "Could not download the update");
    }
  }

  function download() {
    if (downloadPromise) return downloadPromise;
    if (state.status === "ready") return Promise.resolve(snapshot());
    const operation = runDownload();
    downloadPromise = operation;
    operation.then(
      () => { if (downloadPromise === operation) downloadPromise = null; },
      () => { if (downloadPromise === operation) downloadPromise = null; },
    );
    return operation;
  }

  async function runInstall() {
    if (state.status === "checking" && checkPromise) await checkPromise;
    if (state.status === "downloading" && downloadPromise) await downloadPromise;
    if (state.status === "available" && state.installMode === "manual") {
      try {
        if (typeof openExternal === "function") await openExternal(state.releaseUrl);
        return Object.freeze({ ...snapshot(), manual: true });
      } catch (error) {
        return fail("available", error, "UPDATE_RELEASE_OPEN_FAILED", "The release page could not be opened");
      }
    }
    if (state.status === "available") await download();
    if (state.status !== "ready" || !candidate || !installContext.target || !stagedPath) return snapshot();

    transition("installing", { progress: 100 });
    const target = installContext.target;
    const pending = stagedPath;
    const backupPath = `${target}.rollback`;
    const helperPath = `${pending}.ps1`;
    try {
      await launchReplacement({
        target,
        stagedPath: pending,
        backupPath,
        helperPath,
        parentPid,
        env,
        fileSystem,
      });
      await requestQuit("update");
      return snapshot();
    } catch (error) {
      return fail("installing", error, "UPDATE_INSTALL_FAILED", "The update could not be installed");
    }
  }

  function install() {
    if (installPromise) return installPromise;
    const operation = runInstall();
    installPromise = operation;
    operation.then(
      () => { if (installPromise === operation) installPromise = null; },
      () => { if (installPromise === operation) installPromise = null; },
    );
    return operation;
  }

  return Object.freeze({
    check,
    download,
    getState: snapshot,
    install,
  });
}

module.exports = {
  DEFAULT_DOWNLOAD_IDLE_TIMEOUT_MS,
  DEFAULT_DOWNLOAD_TIMEOUT_MS,
  DEFAULT_MAX_UPDATE_BYTES,
  DEFAULT_REQUEST_TIMEOUT_MS,
  POWERSHELL_REPLACEMENT_HELPER,
  UpdateError,
  compareStableVersions,
  createUpdateService,
  expectedPortableAssetName,
  launchPowerShellReplacement,
  parseStableVersion,
  releaseVersion,
  resolvePortableInstallTarget,
  removeStaleUpdateFiles,
  selectWindowsPortableAsset,
};
