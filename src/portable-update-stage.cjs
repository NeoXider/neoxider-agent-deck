const path = require("node:path");

async function verifyStagedUpdate(fileSystem, filePath, asset, hashFactory) {
  let handle;
  try {
    handle = await fileSystem.open(filePath, "r");
    const before = typeof handle.stat === "function" ? await handle.stat() : await fileSystem.stat(filePath);
    if (!before.isFile() || before.size !== asset.size) return false;
    const hash = hashFactory();
    const buffer = Buffer.allocUnsafe(Math.min(1024 * 1024, asset.size));
    let position = 0;
    while (position < asset.size) {
      const length = Math.min(buffer.length, asset.size - position);
      const { bytesRead } = await handle.read(buffer, 0, length, position);
      if (!bytesRead) return false;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const after = typeof handle.stat === "function" ? await handle.stat() : await fileSystem.stat(filePath);
    return after.isFile() && after.size === asset.size && hash.digest("hex").toLowerCase() === asset.digest;
  } catch {
    return false;
  } finally {
    try { await handle?.close(); } catch {}
  }
}

async function recoverStagedUpdate(fileSystem, target, version, asset, hashFactory) {
  const directory = path.dirname(target);
  const targetName = path.basename(target);
  const prefix = `.${targetName}.${version}.`;
  let entries;
  try {
    entries = await fileSystem.readdir(directory, { withFileTypes: true });
  } catch {
    return null;
  }
  const candidates = entries
    .filter((entry) => entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith(".update"))
    .filter((entry) => /^[A-Za-z0-9_-]{1,48}$/.test(entry.name.slice(prefix.length, -".update".length)))
    .slice(0, 16);
  for (const entry of candidates) {
    const candidatePath = path.join(directory, entry.name);
    if (await verifyStagedUpdate(fileSystem, candidatePath, asset, hashFactory)) return candidatePath;
  }
  return null;
}

module.exports = { recoverStagedUpdate, verifyStagedUpdate };
