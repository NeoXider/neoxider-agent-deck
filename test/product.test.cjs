const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { readFileSync } = require("node:fs");
const packageJson = require(path.join("..", "package.json"));
const packageLock = require(path.join("..", "package-lock.json"));
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
  assert.equal(packageJson.version, "0.3.0");
  assert.equal(packageLock.name, PACKAGE_NAME);
  assert.equal(packageLock.version, packageJson.version);
  assert.equal(packageLock.packages[""].name, PACKAGE_NAME);
  assert.equal(packageLock.packages[""].version, packageJson.version);
  assert.deepEqual(USER_DATA_SEGMENTS, ["NeoXider", "AgentDeck"]);
  const main = readFileSync(path.join(__dirname, "..", "src", "main.cjs"), "utf8");
  assert.match(main, /app\.setName\(PRODUCT_NAME\)/);
});

test("every release artifact starts with the canonical product slug", () => {
  for (const platform of ["win", "mac", "linux"]) {
    assert.match(packageJson.build[platform].artifactName, /^NeoXider-Agent-Deck-/);
  }
});

test("the Windows installer follows the canonical repository, artifact, and product name", () => {
  const installer = readFileSync(path.join(__dirname, "..", "scripts", "install-desktop.ps1"), "utf8");
  assert.match(installer, /NeoXider\/neoxider-agent-deck/);
  assert.match(installer, /NeoXider-Agent-Deck-\*-windows-\*-portable\.exe/);
  assert.match(installer, /NeoXider Agent Deck\.exe/);
  assert.match(installer, /NeoXider Agent Deck\.lnk/);
  assert.doesNotMatch(installer, /DeepSeek Harness Widget/);
});
