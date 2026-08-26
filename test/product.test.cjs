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
    assert.match(packageJson.scripts[script], /--publish never$/);
  }
});

test("the Windows installer follows the canonical repository, artifact, and product name", () => {
  const installer = readFileSync(path.join(__dirname, "..", "scripts", "install-desktop.ps1"), "utf8");
  assert.match(installer, /NeoXider\/neoxider-agent-deck/);
  assert.match(installer, /NeoXider-Agent-Deck-\*-windows-\*-portable\.exe/);
  assert.match(installer, /NeoXider Agent Deck\.exe/);
  assert.match(installer, /NeoXider Agent Deck\.lnk/);
  assert.match(installer, /Get-FileHash -LiteralPath \$temporary -Algorithm SHA256/);
  assert.match(installer, /\[System\.IO\.File\]::Replace\(\$temporary, \$executable, \$rollback/);
  assert.doesNotMatch(installer, /DeepSeek Harness Widget/);
});
