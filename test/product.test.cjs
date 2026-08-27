const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { readFileSync } = require("node:fs");
const packageJson = require(path.join("..", "package.json"));
const packageLock = require(path.join("..", "package-lock.json"));
const readme = readFileSync(path.join(__dirname, "..", "README.md"), "utf8");
const changelog = readFileSync(path.join(__dirname, "..", "CHANGELOG.md"), "utf8");
const {
  APP_ID,
  PACKAGE_NAME,
  PRODUCT_NAME,
  REPOSITORY_URL,
  USER_DATA_SEGMENTS,
} = require("../src/product.cjs");

test("package metadata stays coherent with the product source of truth", () => {
  assert.equal(packageJson.name, PACKAGE_NAME);
  assert.equal(packageJson.productName, PRODUCT_NAME);
  assert.equal(packageJson.build.appId, APP_ID);
  assert.equal(packageJson.desktopName, `${APP_ID}.desktop`);
  assert.equal(packageJson.build.linux.syncDesktopName, true);
  assert.equal(packageJson.repository.url, `${REPOSITORY_URL}.git`);
  assert.equal(packageJson.homepage, `${REPOSITORY_URL}#readme`);
  assert.equal(packageJson.bugs, `${REPOSITORY_URL}/issues`);
  assert.equal(packageJson.author.name, "NeoXider");
  assert.match(packageJson.author.email, /@users\.noreply\.github\.com$/);
  assert.match(packageJson.version, /^\d+\.\d+\.\d+$/);
  assert.equal(packageLock.name, PACKAGE_NAME);
  assert.equal(packageLock.version, packageJson.version);
  assert.equal(packageLock.packages[""].name, PACKAGE_NAME);
  assert.equal(packageLock.packages[""].version, packageJson.version);
  const escapedVersion = packageJson.version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(readme, new RegExp(`source-v${escapedVersion}`));
  assert.match(readme, new RegExp(`changelog-${escapedVersion}`));
  assert.match(readme, new RegExp(`NeoXider-Agent-Deck-${escapedVersion}-windows-x64-portable\\.exe`));
  assert.match(readme, new RegExp(`current release, ${escapedVersion}`));
  assert.match(changelog, new RegExp(`^## \\[${escapedVersion}\\]`, "m"));
  assert.deepEqual(USER_DATA_SEGMENTS, ["NeoXider", "AgentDeck"]);
  const main = readFileSync(path.join(__dirname, "..", "src", "main.cjs"), "utf8");
  assert.match(main, /app\.setName\(PRODUCT_NAME\)/);
});

test("every release artifact starts with the canonical product slug", () => {
  for (const platform of ["mac", "linux"]) {
    assert.match(packageJson.build[platform].artifactName, /^NeoXider-Agent-Deck-/);
  }
  assert.match(packageJson.build.nsis.artifactName, /^NeoXider-Agent-Deck-/);
  assert.match(packageJson.build.portable.artifactName, /^NeoXider-Agent-Deck-/);
});

test("Windows ships both an auto-updatable installer and a portable fallback", () => {
  assert.deepEqual(packageJson.build.win.target, ["nsis", "portable"]);
  assert.match(packageJson.build.nsis.artifactName, /-setup\.\$\{ext\}$/);
  assert.match(packageJson.build.portable.artifactName, /-portable\.\$\{ext\}$/);
  assert.deepEqual(packageJson.build.publish, {
    provider: "github",
    owner: "NeoXider",
    repo: "neoxider-agent-deck",
  });
  assert.equal(packageJson.dependencies["electron-updater"], "6.8.9");
});

test("platform packaging creates artifacts without implicit publishing", () => {
  for (const script of ["build:win", "build:mac", "build:linux"]) {
    assert.match(packageJson.scripts[script], /--publish never/);
  }
  assert.match(packageJson.scripts["build:win"], /packaged-launch-smoke\.ps1$/);
  const main = readFileSync(path.join(__dirname, "..", "src", "main.cjs"), "utf8");
  assert.doesNotMatch(main, /^const \{ attachScreenshotHarness \} = require/m);
  assert.match(main, /if \(screenshotPath\) \{\s+const \{ attachScreenshotHarness \} = require/);
  assert.match(main, /const ISOLATED_SMOKE_MODE = SCREENSHOT_MODE \|\| Boolean\(PACKAGED_SMOKE_PATH\)/);
  assert.match(main, /if \(!ISOLATED_SMOKE_MODE\) autoStartController\.migrateLegacy\(\)/);
});

test("tag releases retain updater metadata and publish it with platform artifacts", () => {
  const workflow = readFileSync(path.join(__dirname, "..", ".github", "workflows", "release.yml"), "utf8");
  assert.match(workflow, /tags:[\s\S]+"v\*\.\*\.\*"/);
  for (const artifact of ["latest.yml", "latest-linux.yml", "*.blockmap", "*.AppImage", "*-setup.exe"]) {
    if (artifact === "*-setup.exe") assert.match(packageJson.build.nsis.artifactName, /setup\.\$\{ext\}/);
    else assert.match(workflow, new RegExp(artifact.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(workflow, /verify-release-version\.cjs/);
  assert.match(workflow, /permissions:\s+contents: read/);
  assert.match(workflow, /publish:[\s\S]+permissions:\s+contents: write/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /merge-multiple: true/);
  assert.match(workflow, /gh release create[^\n]+--draft/);
  assert.match(workflow, /gh release edit[^\n]+--draft=false --latest/);
  assert.match(workflow, /SHA256SUMS\.txt/);
});

test("the Windows installer follows the canonical repository, artifact, and product name", () => {
  const installer = readFileSync(path.join(__dirname, "..", "scripts", "install-desktop.ps1"), "utf8");
  assert.match(installer, /NeoXider\/neoxider-agent-deck/);
  assert.match(installer, /Add-Type -AssemblyName System\.Net\.Http/);
  assert.match(installer, /EnsureSuccessStatusCode\(\) \| Out-Null/);
  assert.match(installer, /NeoXider-Agent-Deck-\$version-windows-x64-portable\.exe/);
  assert.match(installer, /\$tag -notmatch '\^v/);
  assert.match(installer, /\$asset\.state/);
  assert.match(installer, /268435456/);
  assert.match(installer, /-TimeoutSec 30/);
  assert.match(installer, /ResponseHeadersRead/);
  assert.match(installer, /CancellationTokenSource/);
  assert.match(installer, /CancelAfter\(\[TimeSpan\]::FromMinutes\(5\)\)/);
  assert.match(installer, /ReadAsync\(\$buffer, 0, \$buffer\.Length, \$downloadDeadline\.Token\)/);
  assert.match(installer, /\$received -ne \$assetSize/);
  assert.match(installer, /\$expectedUrl/);
  assert.match(installer, /NeoXider Agent Deck\.exe/);
  assert.match(installer, /NeoXider Agent Deck\.lnk/);
  assert.match(installer, /Get-FileHash -LiteralPath \$temporary -Algorithm SHA256/);
  assert.match(installer, /\[System\.IO\.File\]::Replace\(\$temporary, \$executable, \$rollback/);
  assert.match(installer, /\[System\.IO\.File\]::Copy\(\$rollback, \$executable, \$true\)/);
  assert.match(installer, /if \(\$replacedExisting\) \{ Write-Host "Rollback copy: \$rollback" \}/);
  assert.doesNotMatch(installer, /DeepSeek Harness Widget/);
});
