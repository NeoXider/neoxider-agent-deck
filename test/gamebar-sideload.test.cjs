const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { readFileSync } = require("node:fs");

const root = path.join(__dirname, "..");
const read = (...parts) => readFileSync(path.join(root, ...parts), "utf8");

test("Game Bar CI creates an ephemeral signed x64 sideload kit and releases only public material", () => {
  const workflow = read(".github", "workflows", "gamebar-ci.yml");
  const release = read(".github", "workflows", "release.yml");

  assert.match(workflow, /workflow_call:[\s\S]+release_package:[\s\S]+type: boolean/);
  assert.match(workflow, /build-sideload-package\.ps1[\s\S]+-Version \$version/);
  assert.match(workflow, /name: release-gamebar-x64/);
  assert.match(workflow, /NeoXider-Agent-Deck-GameBar-\*-windows-x64\.appx/);
  assert.match(workflow, /NeoXider-Agent-Deck-GameBar-\*-windows-x64\.cer/);
  assert.match(workflow, /NeoXider-Agent-Deck-GameBar-\*-windows-x64\.zip/);
  assert.match(workflow, /Install-NeoXider-Agent-Deck-GameBar\.ps1/);
  assert.match(workflow, /if-no-files-found: error/);
  assert.doesNotMatch(workflow, /\.pfx|\.p12|\.pvk|private.?key/i);

  assert.match(release, /gamebar:[\s\S]+uses: \.\/\.github\/workflows\/gamebar-ci\.yml[\s\S]+release_package: true/);
  assert.match(release, /needs: \[build, gamebar\]/);
  for (const name of [
    "NeoXider-Agent-Deck-GameBar-${version}-windows-x64.appx",
    "NeoXider-Agent-Deck-GameBar-${version}-windows-x64.cer",
    "NeoXider-Agent-Deck-GameBar-${version}-windows-x64.zip",
    "Install-NeoXider-Agent-Deck-GameBar.ps1",
  ]) {
    assert.ok(release.includes(`\"${name}\"`));
  }
  assert.doesNotMatch(release, /\.pfx|\.p12|\.pvk|private.?key/i);
});

test("sideload builder deletes private material and validates package identity before publishing", () => {
  const build = read("windows-gamebar", "scripts", "build-sideload-package.ps1");
  const verify = read("windows-gamebar", "scripts", "verify-sideload-package.ps1");

  assert.match(build, /New-SelfSignedCertificate[\s\S]+-Subject 'CN=NeoXider'/);
  assert.match(build, /Export-PfxCertificate[\s\S]+Export-Certificate/);
  assert.match(build, /Import-Certificate[\s\S]+Cert:\\CurrentUser\\TrustedPeople/);
  assert.match(build, /\[System\.IO\.Path\]::GetTempPath\(\)/);
  assert.match(build, /finally \{[\s\S]+Cert:\\CurrentUser\\My[\s\S]+Remove-Item[\s\S]+\$temporaryRoot/);
  assert.match(build, /verify-sideload-package\.ps1[\s\S]+Compress-Archive/);
  assert.match(build, /Extension -in @\('\.pfx', '\.p12', '\.pvk', '\.key'\)/);
  assert.match(build, /AppxPackageSigningEnabled=true/);
  assert.match(build, /Platform=x64/);
  assert.match(build, /UapAppxPackageBuildMode=SideloadOnly/);

  assert.match(verify, /Get-AuthenticodeSignature/);
  assert.match(verify, /signature\.Status -ne 'Valid'/);
  assert.match(verify, /SignerCertificate\.Thumbprint -ne \$certificate\.Thumbprint/);
  assert.match(verify, /AppxManifest\.xml/);
  assert.match(verify, /ProcessorArchitecture -ne 'x64'/);
  assert.match(verify, /identity\.Version -ne "\$Version\.0"/);
  assert.match(verify, /HasPrivateKey/);
});

test("sideload installer validates the signer before trusting the public certificate", () => {
  const installer = read("windows-gamebar", "scripts", "install-sideload-package.ps1");
  const signatureCheck = installer.indexOf("Get-AuthenticodeSignature");
  const certificateImport = installer.indexOf("Import-Certificate");
  const packageInstall = installer.indexOf("Add-AppxPackage");

  assert.ok(signatureCheck >= 0 && signatureCheck < certificateImport);
  assert.ok(certificateImport < packageInstall);
  assert.match(installer, /Cert:\\CurrentUser\\TrustedPeople/);
  assert.match(installer, /SignerCertificate\.Thumbprint -ne \$publicCertificate\.Thumbprint/);
  assert.match(installer, /trustedSignature\.Status -ne 'Valid'/);
  assert.match(installer, /HasPrivateKey/);
  assert.match(installer, /DependencyPath/);
  assert.match(installer, /ForceApplicationShutdown/);
});
