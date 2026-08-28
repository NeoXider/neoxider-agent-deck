const fs = require("node:fs");
const path = require("node:path");

const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const CHECKSUM_MANIFEST = "SHA256SUMS.txt";

function expectedReleaseArtifactNames(version, { includeChecksum = true } = {}) {
  if (!STABLE_VERSION.test(String(version || ""))) {
    throw new Error("A stable release version is required");
  }

  const names = [
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
    `NeoXider-Agent-Deck-GameBar-${version}-windows-x64.msix`,
    `NeoXider-Agent-Deck-GameBar-${version}-windows-x64.cer`,
    `NeoXider-Agent-Deck-GameBar-${version}-windows-x64.zip`,
    "Install-NeoXider-Agent-Deck-GameBar.ps1",
  ];
  if (includeChecksum) names.push(CHECKSUM_MANIFEST);
  return Object.freeze(names);
}

function verifyReleaseArtifacts(directory, version, { includeChecksum = true } = {}) {
  const resolvedDirectory = path.resolve(directory || "artifacts");
  const expected = new Set(expectedReleaseArtifactNames(version, { includeChecksum }));
  const entries = fs.readdirSync(resolvedDirectory, { withFileTypes: true });
  if (entries.some((entry) => !entry.isFile())) {
    throw new Error("Release artifacts must be in one flat directory");
  }

  const actual = new Set(entries.map((entry) => entry.name));
  const missing = [...expected].filter((name) => !actual.has(name));
  const unexpected = [...actual].filter((name) => !expected.has(name));
  if (missing.length || unexpected.length) {
    throw new Error(`Release artifact mismatch. Missing: ${missing.join(", ") || "none"}. Unexpected: ${unexpected.join(", ") || "none"}`);
  }
  for (const name of expected) {
    const stat = fs.statSync(path.join(resolvedDirectory, name));
    if (!stat.isFile() || stat.size <= 0) throw new Error(`Release artifact is empty: ${name}`);
  }
  return expected.size;
}

function main(argv = process.argv.slice(2)) {
  const [directory = "artifacts", version = "", mode = "--final"] = argv;
  if (!["--final", "--pre-checksum"].includes(mode)) {
    throw new Error(`Unknown release artifact verification mode: ${mode}`);
  }
  const includeChecksum = mode !== "--pre-checksum";
  const count = verifyReleaseArtifacts(directory, version, { includeChecksum });
  console.log(`Release artifact contract passed for ${version}: ${count} files (${includeChecksum ? "final" : "pre-checksum"})`);
}

if (require.main === module) main();

module.exports = {
  CHECKSUM_MANIFEST,
  expectedReleaseArtifactNames,
  verifyReleaseArtifacts,
};
