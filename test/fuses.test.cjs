// Guards the package-time fuse policy in scripts/electron-fuses.cjs.
//
// Fuses are invisible in every way that normally catches a regression: nothing imports
// them, no window changes, no test fails, and the app runs identically with all of them
// off. The only symptom of losing them is that the shipped .exe quietly becomes a Node
// runtime again — which nobody notices until someone uses it. So the values are asserted
// here rather than trusted to survive the next edit of package.json.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const packageJson = require(path.join("..", "package.json"));
const packageLock = require(path.join("..", "package-lock.json"));
const { FuseV1Options, FuseVersion } = require("@electron/fuses");
const { afterPack, resolveFuseConfig } = require("../scripts/electron-fuses.cjs");

// A packager stub in the shape electron-builder passes to an afterPack hook. The real
// one needs a full build on disk; the hook's whole job is choosing what to flip and
// handing it to the packager, and that is decidable without one.
function fakeContext(electronPlatformName, addElectronFuses) {
  const calls = [];
  const context = {
    electronPlatformName,
    appOutDir: path.join("release", `${electronPlatformName}-unpacked`),
    packager: {
      addElectronFuses: addElectronFuses
        || (async (ctx, fuses) => {
          calls.push({ ctx, fuses });
        }),
    },
  };
  return { context, calls };
}

test("the packaged binary cannot be re-used as a Node runtime", () => {
  // The four that close the documented escape on a portable .exe. Asserted per platform
  // because a policy that only held for the developer's own OS would be worthless: the
  // portable Windows build is often produced from CI, not from Windows by hand.
  for (const platform of ["win32", "darwin", "linux"]) {
    const fuses = resolveFuseConfig(platform);
    assert.equal(fuses.version, FuseVersion.V1, `${platform} must pin the v1 fuse wire`);
    assert.equal(
      fuses[FuseV1Options.RunAsNode],
      false,
      `${platform}: ELECTRON_RUN_AS_NODE would turn the shipped binary into a Node runtime`,
    );
    assert.equal(
      fuses[FuseV1Options.EnableNodeOptionsEnvironmentVariable],
      false,
      `${platform}: NODE_OPTIONS can inject --require, NODE_EXTRA_CA_CERTS can forge our trust store`,
    );
    assert.equal(
      fuses[FuseV1Options.EnableNodeCliInspectArguments],
      false,
      `${platform}: --inspect hands a debugger the main process`,
    );
    assert.equal(
      fuses[FuseV1Options.OnlyLoadAppFromAsar],
      true,
      `${platform}: otherwise an 'app' directory beside the binary silently replaces our code`,
    );
  }
});

test("asar integrity is claimed only where the platform actually implements it", () => {
  // Electron implements this check on macOS and Windows only, and electron-builder
  // embeds the matching metadata only for those. Enabling it on Linux would assert a
  // guarantee nothing verifies; leaving it on where it works is the point of the fuse.
  assert.equal(resolveFuseConfig("win32")[FuseV1Options.EnableEmbeddedAsarIntegrityValidation], true);
  assert.equal(resolveFuseConfig("darwin")[FuseV1Options.EnableEmbeddedAsarIntegrityValidation], true);
  assert.equal(resolveFuseConfig("mas")[FuseV1Options.EnableEmbeddedAsarIntegrityValidation], true);
  assert.equal(resolveFuseConfig("linux")[FuseV1Options.EnableEmbeddedAsarIntegrityValidation], false);
  // The check is only meaningful while app.asar is the sole place code may load from.
  assert.equal(resolveFuseConfig("win32")[FuseV1Options.OnlyLoadAppFromAsar], true);
  // And only while there is an asar at all to hash.
  assert.equal(packageJson.build.asar, true);
  assert.equal(packageJson.build.disableAsarIntegrity, undefined);
});

test("no side-loaded archive can trip the integrity check on users", () => {
  // Once validation is on, Windows and macOS treat *any* unhashed .asar beside the
  // executable as fatal — and electron-builder hashes `extraResources` but not
  // `extraFiles`. Shipping an .asar through the latter would package cleanly, launch on
  // the machine that built it, and abort on every user. We ship neither today; this
  // fails the moment someone adds one, rather than after a release.
  const carriesAsar = (patterns) => []
    .concat(patterns ?? [])
    .some((entry) => JSON.stringify(entry).includes(".asar"));
  assert.equal(carriesAsar(packageJson.build.extraFiles), false, "an .asar in extraFiles is never hashed");
  assert.equal(carriesAsar(packageJson.build.extraResources), false, "hashed, but keep it deliberate");
});

test("macOS re-signs after the flip, and no other platform pretends to", () => {
  // Flipping rewrites bytes inside the .app and invalidates the ad-hoc signature Electron
  // ships with. arm64 macOS refuses to launch the result, so this is not cosmetic.
  assert.equal(resolveFuseConfig("darwin").resetAdHocDarwinSignature, true);
  assert.equal(resolveFuseConfig("mas").resetAdHocDarwinSignature, true);
  assert.equal(resolveFuseConfig("win32").resetAdHocDarwinSignature, false);
  assert.equal(resolveFuseConfig("linux").resetAdHocDarwinSignature, false);
});

test("the fuses that would break the app we ship stay untouched", () => {
  // This is the regression this file most expects to catch. Both look like free
  // hardening and both are load-bearing:
  //   - the renderer is a file:// page (main.cjs uses loadFile), so revoking the file
  //     protocol's extra privileges breaks the UI;
  //   - cookie encryption is a one-way door that corrupts the store if reverted.
  // Absent, not false: an unset fuse keeps Electron's default, while `false` actively
  // burns the opposite choice into the binary.
  for (const platform of ["win32", "darwin", "linux"]) {
    const fuses = resolveFuseConfig(platform);
    assert.equal(fuses[FuseV1Options.GrantFileProtocolExtraPrivileges], undefined);
    assert.equal(fuses[FuseV1Options.EnableCookieEncryption], undefined);
    assert.equal(fuses[FuseV1Options.LoadBrowserProcessSpecificV8Snapshot], undefined);
  }
});

test("the hook hands the resolved policy to the packager that located the binary", async () => {
  const { context, calls } = fakeContext("win32");
  await afterPack(context);
  assert.equal(calls.length, 1, "the binary must be fused exactly once");
  assert.equal(calls[0].ctx, context, "the packager needs the real context to find the executable");
  assert.deepEqual(calls[0].fuses, resolveFuseConfig("win32"));
});

test("a failed flip fails the build instead of shipping an unfused binary", async () => {
  // The dangerous shape here is a try/catch that logs and continues: the build stays
  // green, the artifact is published, and every protection above is silently absent.
  const { context } = fakeContext("win32", async () => {
    throw new Error("resedit could not parse the executable");
  });
  await assert.rejects(afterPack(context), /resedit could not parse the executable/);
});

test("electron-builder is actually wired to the hook", () => {
  // A perfect policy that nothing invokes is the failure mode worth guarding: the values
  // above would all still pass while every artifact shipped unfused.
  const hookPath = packageJson.build.afterPack;
  assert.equal(typeof hookPath, "string", "build.afterPack must point at the fuse hook");
  const resolved = require(path.join("..", hookPath));
  // electron-builder looks up the hook by the name of the event, falling back to the
  // module's default export. Asserting the named export keeps that lookup unambiguous.
  assert.equal(resolved.afterPack, afterPack, "build.afterPack must resolve to this module's hook");
  assert.equal(typeof resolved.afterPack, "function");
  // It must not be packaged into the app: this is build machinery, not runtime code.
  assert.ok(
    !packageJson.build.files.some((pattern) => pattern.startsWith("scripts")),
    "the fuse hook must not ship inside the asar",
  );
});

test("@electron/fuses is a pinned, declared devDependency", () => {
  // It arrives transitively through electron-builder either way, so an undeclared
  // dependency would work right up until electron-builder changed its own version.
  const version = packageJson.devDependencies["@electron/fuses"];
  assert.match(version, /^\d+\.\d+\.\d+$/, "pin the fuse tool exactly, like electron and electron-builder");
  assert.equal(packageLock.packages[""].devDependencies["@electron/fuses"], version);
  assert.equal(packageLock.packages["node_modules/@electron/fuses"].version, version);
});
