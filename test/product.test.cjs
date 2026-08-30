const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { readFileSync } = require("node:fs");
const packageJson = require(path.join("..", "package.json"));
const packageLock = require(path.join("..", "package-lock.json"));
const readme = readFileSync(path.join(__dirname, "..", "README.md"), "utf8");
const changelog = readFileSync(path.join(__dirname, "..", "CHANGELOG.md"), "utf8");
const todo = readFileSync(path.join(__dirname, "..", "TODO.md"), "utf8");
const {
  APP_ID,
  PACKAGE_NAME,
  PRODUCT_NAME,
  REPOSITORY_URL,
  USER_DATA_SEGMENTS,
} = require("../src/product.cjs");
const { HOST_EXE, resolveGameBarBridgeHost } = require("../src/gamebar-controller.cjs");

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
  const windowsBuild = packageJson.scripts["build:win"];
  const applicationTests = windowsBuild.indexOf("npm run test");
  const bridgeBuild = windowsBuild.indexOf("npm run build:bridge-host:win");
  const electronBuild = windowsBuild.indexOf("electron-builder");
  const packagedSmoke = windowsBuild.indexOf("packaged-launch-smoke.ps1");
  assert.ok(applicationTests >= 0 && applicationTests < bridgeBuild);
  assert.ok(bridgeBuild < electronBuild);
  assert.ok(electronBuild < packagedSmoke);
  assert.match(packageJson.scripts["build:bridge-host:win"], /build-bridge-host\.ps1 -Configuration Release$/);
  assert.doesNotMatch(packageJson.scripts["build:mac"], /bridge-host|dotnet/i);
  assert.doesNotMatch(packageJson.scripts["build:linux"], /bridge-host|dotnet/i);
  const main = readFileSync(path.join(__dirname, "..", "src", "main.cjs"), "utf8");
  assert.doesNotMatch(main, /^const \{ attachScreenshotHarness \} = require/m);
  assert.match(main, /if \(screenshotPath\) \{\s+const \{ attachScreenshotHarness \} = require/);
  assert.match(main, /const ISOLATED_SMOKE_MODE = SCREENSHOT_MODE \|\| Boolean\(PACKAGED_SMOKE_PATH\)/);
  assert.match(main, /if \(!ISOLATED_SMOKE_MODE\) autoStartController\.migrateLegacy\(\)/);
});

test("Windows packages exactly the bridge host path resolved by the packaged controller", () => {
  assert.deepEqual(packageJson.build.win.extraResources, [{
    from: "windows-gamebar/artifacts/bridge-host/win-x64/NeoXiderAgentDeck.BridgeHost.exe",
    to: `gamebar/${HOST_EXE}`,
  }]);

  const resourcesPath = path.win32.join("C:\\", "packaged-resources");
  const embeddedHost = path.win32.join(resourcesPath, packageJson.build.win.extraResources[0].to);
  assert.equal(resolveGameBarBridgeHost({
    platform: "win32",
    isPackaged: true,
    resourcesPath,
    fileExists: (candidate) => candidate === embeddedHost,
  }), embeddedHost);

  const publishScript = readFileSync(path.join(__dirname, "..", "windows-gamebar", "scripts", "build-bridge-host.ps1"), "utf8");
  const hostProject = readFileSync(path.join(__dirname, "..", "windows-gamebar", "NeoXiderAgentDeck.BridgeHost", "NeoXiderAgentDeck.BridgeHost.csproj"), "utf8");
  assert.match(publishScript, /--self-contained true/);
  assert.match(publishScript, /PublishTrimmed=true/);
  assert.match(hostProject, /<PublishSingleFile>true<\/PublishSingleFile>/);
  assert.match(publishScript, /\$publishedBytes -le 0 -or \$publishedBytes -ge \$maximumPublishedBytes/);
  assert.match(publishScript, /\$maximumPublishedBytes = 20MB/);

  const packagedSmoke = readFileSync(path.join(__dirname, "..", "scripts", "packaged-launch-smoke.ps1"), "utf8");
  assert.match(packagedSmoke, /\[string\]\$Executable = "release\\win-unpacked\\NeoXider Agent Deck\.exe"/);
  assert.match(packagedSmoke, /Join-Path \(Split-Path -Parent \$target\) "resources\\gamebar\\NeoXiderAgentDeck\.BridgeHost\.exe"/);
  assert.match(packagedSmoke, /resources\\gamebar\\NeoXiderAgentDeck\.BridgeHost\.exe/);
  assert.match(packagedSmoke, /\$bridgeHostBytes -le 0 -or \$bridgeHostBytes -ge 20MB/);
});

test("Windows packaging workflows pin .NET 9 while Game Bar CI publishes bridge evidence", () => {
  const setupDotnet = "actions/setup-dotnet@67a3573c9a986a3f9c594539f4ab511d57bb3ce9";
  const ci = readFileSync(path.join(__dirname, "..", ".github", "workflows", "ci.yml"), "utf8");
  const release = readFileSync(path.join(__dirname, "..", ".github", "workflows", "release.yml"), "utf8");
  const gameBar = readFileSync(path.join(__dirname, "..", ".github", "workflows", "gamebar-ci.yml"), "utf8");

  for (const workflow of [ci, release, gameBar]) {
    assert.match(workflow, new RegExp(setupDotnet.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(workflow, /dotnet-version: 9\.0\.x/);
  }
  assert.match(ci, /if: runner\.os == 'Windows'[\s\S]+setup-dotnet@[0-9a-f]{40}[\s\S]+npm run \$\{\{ matrix\.script \}\}/);
  assert.match(release, /if: runner\.os == 'Windows'[\s\S]+setup-dotnet@[0-9a-f]{40}[\s\S]+npm run \$\{\{ matrix\.script \}\}/);
  const sidecarBuild = gameBar.indexOf("build-bridge-host.ps1 -Configuration Release");
  const uwpBuild = gameBar.indexOf("windows-gamebar\\scripts\\build.ps1 -Configuration");
  assert.ok(sidecarBuild >= 0 && sidecarBuild < uwpBuild);
  assert.match(gameBar, /windows-gamebar\/artifacts\/bridge-host\/win-x64\/NeoXiderAgentDeck\.BridgeHost\.exe/);
  assert.match(gameBar, /compilation only and does not deploy or run the widget/);
});

test("tag releases retain updater metadata and publish it with platform artifacts", () => {
  const workflow = readFileSync(path.join(__dirname, "..", ".github", "workflows", "release.yml"), "utf8");
  assert.match(workflow, /tags:[\s\S]+"v\*\.\*\.\*"/);
  for (const artifact of ["latest.yml", "latest-linux.yml", "*.blockmap", "*.AppImage", "release/*.exe"]) {
    assert.match(workflow, new RegExp(artifact.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  // The loop used to swap this one entry for a package.json check that line 56 already
  // makes, so the test named "publish it with platform artifacts" never verified that the
  // Windows installer is among the artifacts the workflow uploads.
  assert.match(packageJson.build.nsis.artifactName, /setup\.\$\{ext\}/);
  assert.match(workflow, /verify-release-version\.cjs/);
  assert.match(workflow, /permissions:\s+contents: read/);
  assert.match(workflow, /publish:[\s\S]+permissions:\s+contents: write/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /merge-multiple: true/);
  assert.match(workflow, /gh release create[^\n]+--draft/);
  assert.match(workflow, /gh release edit[^\n]+--draft=false --latest/);
  assert.match(workflow, /SHA256SUMS\.txt/);
  assert.match(workflow, /! -name 'SHA256SUMS\.txt'/);
  assert.match(workflow, /sha256sum -c SHA256SUMS\.txt/);
});

test("release documentation uses the current window-layer label and previews every window mode", () => {
  for (const document of [readme, changelog, todo]) {
    assert.doesNotMatch(document, /\bNormal window layer\b|window layers: Normal/);
  }
  assert.match(readme, /every ordinary window covers the widget/);
  for (const preview of ["Full", "Focus Mini", "Orb", "Edge", "Minimum 360 px"]) {
    assert.match(readme, new RegExp(`<strong>${preview}<\\/strong>`));
  }
  for (const screenshot of ["chat.png", "focus-chat.png", "recent-sessions-orb.png", "edge-mode.png", "small-chat-360.png"]) {
    assert.match(readme, new RegExp(`docs/screenshots/${screenshot.replace(".", "\\.")}`));
  }
});

test("the update-ready visual fixture shows the released upgrade path", () => {
  const renderer = readFileSync(path.join(__dirname, "..", "src", "renderer", "app.js"), "utf8");
  const visualSmoke = readFileSync(path.join(__dirname, "..", "scripts", "ui-visual-smoke.cjs"), "utf8");
  assert.match(renderer, /status: "ready", currentVersion: "0.6.10", latestVersion: "0.6.11"/);
  assert.match(visualSmoke, /updateStatus: "v0.6.11 is verified and ready"/);
  assert.equal(packageJson.version, "0.6.11");
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
