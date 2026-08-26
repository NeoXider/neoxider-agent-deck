const fs = require("node:fs");
const path = require("node:path");

const directory = path.resolve(process.argv[2] || "artifacts");
const version = String(process.argv[3] || "");
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error("A stable release version is required");

const expected = new Set([
  `NeoXider-Agent-Deck-${version}-windows-x64-setup.exe`,
  `NeoXider-Agent-Deck-${version}-windows-x64-setup.exe.blockmap`,
  `NeoXider-Agent-Deck-${version}-windows-x64-portable.exe`,
  "latest.yml",
  `NeoXider-Agent-Deck-${version}-linux-x86_64.AppImage`,
  `NeoXider-Agent-Deck-${version}-linux-amd64.deb`,
  "latest-linux.yml",
  `NeoXider-Agent-Deck-${version}-macos-arm64.dmg`,
  `NeoXider-Agent-Deck-${version}-macos-arm64.zip`,
  `NeoXider-Agent-Deck-${version}-macos-x64.dmg`,
  `NeoXider-Agent-Deck-${version}-macos-x64.zip`,
]);

const entries = fs.readdirSync(directory, { withFileTypes: true });
if (entries.some((entry) => !entry.isFile())) throw new Error("Release artifacts must be in one flat directory");
const actual = new Set(entries.map((entry) => entry.name));
const missing = [...expected].filter((name) => !actual.has(name));
const unexpected = [...actual].filter((name) => !expected.has(name));
if (missing.length || unexpected.length) {
  throw new Error(`Release artifact mismatch. Missing: ${missing.join(", ") || "none"}. Unexpected: ${unexpected.join(", ") || "none"}`);
}
for (const name of expected) {
  const stat = fs.statSync(path.join(directory, name));
  if (!stat.isFile() || stat.size <= 0) throw new Error(`Release artifact is empty: ${name}`);
}
console.log(`Release artifact contract passed for ${version}: ${expected.size} files`);
