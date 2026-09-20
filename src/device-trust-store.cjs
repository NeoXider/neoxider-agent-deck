const fs = require("node:fs");
const path = require("node:path");

const HASH = /^[a-f0-9]{64}$/;

function normalize(records, now = Date.now()) {
  if (!Array.isArray(records)) return [];
  const unique = new Map();
  for (const record of records) {
    const digest = typeof record?.digest === "string" ? record.digest.toLowerCase() : "";
    const expiresAt = Number(record?.expiresAt);
    if (HASH.test(digest) && Number.isFinite(expiresAt) && expiresAt > now) unique.set(digest, { digest, expiresAt });
  }
  return [...unique.values()].sort((a, b) => a.expiresAt - b.expiresAt).slice(-1000);
}

function createDeviceTrustStore({ filePath, fileSystem = fs, now = Date.now } = {}) {
  if (!filePath) throw new Error("Device trust path is required");
  function load() {
    try { return normalize(JSON.parse(fileSystem.readFileSync(filePath, "utf8"))?.devices, now()); }
    catch { return []; }
  }
  function save(records) {
    const devices = normalize(records, now());
    fileSystem.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    try {
      fileSystem.writeFileSync(temporaryPath, `${JSON.stringify({ version: 1, devices }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      fileSystem.renameSync(temporaryPath, filePath);
    } finally {
      try { fileSystem.rmSync(temporaryPath, { force: true }); } catch {}
    }
    return devices;
  }
  function clear() {
    try { fileSystem.rmSync(filePath, { force: true }); }
    catch (error) { if (error?.code !== "ENOENT") throw error; }
  }
  return { load, save, clear };
}

module.exports = { createDeviceTrustStore, normalizeDeviceTrust: normalize };
