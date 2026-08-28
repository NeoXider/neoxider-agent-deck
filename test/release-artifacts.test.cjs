const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  CHECKSUM_MANIFEST,
  expectedReleaseArtifactNames,
  verifyReleaseArtifacts,
} = require("../scripts/verify-release-artifacts.cjs");

const VERSION = "1.2.3";
const PRE_CHECKSUM_NAMES = [
  `NeoXider-Agent-Deck-${VERSION}-windows-x64-setup.exe`,
  `NeoXider-Agent-Deck-${VERSION}-windows-x64-setup.exe.blockmap`,
  `NeoXider-Agent-Deck-${VERSION}-windows-x64-portable.exe`,
  "latest.yml",
  `NeoXider-Agent-Deck-${VERSION}-linux-x86_64.AppImage`,
  `NeoXider-Agent-Deck-${VERSION}-linux-amd64.deb`,
  "latest-linux.yml",
  `NeoXider-Agent-Deck-${VERSION}-macos-arm64.dmg`,
  `NeoXider-Agent-Deck-${VERSION}-macos-arm64.zip`,
  `NeoXider-Agent-Deck-${VERSION}-macos-x64.dmg`,
  `NeoXider-Agent-Deck-${VERSION}-macos-x64.zip`,
  `NeoXider-Agent-Deck-GameBar-${VERSION}-windows-x64.msix`,
  `NeoXider-Agent-Deck-GameBar-${VERSION}-windows-x64.cer`,
  `NeoXider-Agent-Deck-GameBar-${VERSION}-windows-x64.zip`,
  "Install-NeoXider-Agent-Deck-GameBar.ps1",
];

let artifactRun = 0;

// The directory is RELATIVE to the working directory on purpose.
//
// This used to take an absolute path from os.tmpdir(), which passed on Windows and failed
// under the platform matrix: the matrix swaps the path module for posix rules while
// os.tmpdir() still returns `C:\Users\...`, and `path.posix.resolve` does not treat a
// drive letter as absolute, so the verifier resolved `C:\repo\C:\Users\...`. No real Linux
// machine hands out Windows temp paths, so that was a defect in the simulation rather than
// in verifyReleaseArtifacts, which is right to call path.resolve on whatever it is given.
//
// A relative directory resolves against the working directory identically under both rule
// sets, so the real code path is exercised on all three simulated platforms.
function withArtifactDirectory(names, callback) {
  artifactRun += 1;
  const directory = `.tmp-release-artifacts-${String(process.pid)}-${String(artifactRun)}`;
  fs.mkdirSync(directory, { recursive: true });
  try {
    for (const name of names) fs.writeFileSync(`${directory}/${name}`, name);
    return callback(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test("release payload contract contains the 15 built assets and final checksum manifest", () => {
  assert.deepEqual(expectedReleaseArtifactNames(VERSION, { includeChecksum: false }), PRE_CHECKSUM_NAMES);
  assert.deepEqual(expectedReleaseArtifactNames(VERSION), [...PRE_CHECKSUM_NAMES, CHECKSUM_MANIFEST]);
});

test("release payload verification rejects drift before and after checksum creation", () => {
  withArtifactDirectory(PRE_CHECKSUM_NAMES, (directory) => {
    assert.equal(verifyReleaseArtifacts(directory, VERSION, { includeChecksum: false }), 15);
    assert.throws(() => verifyReleaseArtifacts(directory, VERSION), /Missing: SHA256SUMS\.txt/);
    fs.writeFileSync(`${directory}/${CHECKSUM_MANIFEST}`, "digest  artifact\n");
    assert.equal(verifyReleaseArtifacts(directory, VERSION), 16);
    fs.writeFileSync(`${directory}/unexpected.bin`, "unexpected");
    assert.throws(() => verifyReleaseArtifacts(directory, VERSION), /Unexpected: unexpected\.bin/);
  });
});

test("release workflow uses the centralized contract on both sides of checksum creation", () => {
  const workflow = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "release.yml"), "utf8");
  const preChecksum = workflow.indexOf('node scripts/verify-release-artifacts.cjs artifacts "${TAG#v}" --pre-checksum');
  const checksum = workflow.indexOf("sha256sum -c SHA256SUMS.txt");
  const final = workflow.indexOf('node scripts/verify-release-artifacts.cjs artifacts "${TAG#v}"', preChecksum + 1);
  const publish = workflow.indexOf("gh release upload");

  assert.ok(preChecksum >= 0 && preChecksum < checksum);
  assert.ok(checksum < final && final < publish);
  assert.doesNotMatch(workflow, /NeoXider-Agent-Deck-\$\{version\}/);
});
