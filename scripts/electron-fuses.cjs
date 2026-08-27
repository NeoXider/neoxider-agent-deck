// Burns Electron's fuses into the packaged binary, as electron-builder's `afterPack` hook.
//
// This exists because we ship a portable `.exe`. Everything the renderer sandbox, the
// strict CSP and the preload bridge buy us is irrelevant if the shipped executable will
// run whatever it is told to — and by default it will:
//
//     set ELECTRON_RUN_AS_NODE=1 && "NeoXider Agent Deck.exe" -e "<any code>"
//
// That is arbitrary code execution wearing our name, our icon and our publisher. It is
// not a bug in our code, it is what an un-fused Electron binary is: a general-purpose
// Node runtime with a window attached. A portable build makes it worse, because it is
// handed around on a USB stick and run from a Downloads folder with no installer, no
// update channel and nothing watching it.
//
// Fuses are the only place this closes. They are bit flags burned into the binary at
// package time, read before any of our JavaScript runs, and no environment variable or
// command-line flag can turn them back on afterwards. `harness-launcher.cjs` already
// strips ELECTRON_RUN_AS_NODE from the environment it hands to child processes; that
// protects the child, not us. This protects the binary itself.
const { FuseV1Options, FuseVersion } = require("@electron/fuses");

// ASAR integrity validation is only implemented for macOS (electron >= 16) and Windows
// (electron >= 30). On Linux it is not merely unused, it is compiled out: the checks in
// Electron's `shell/common/asar/archive.cc` sit behind `#if BUILDFLAG(IS_MAC) ||
// BUILDFLAG(IS_WIN)`, and `HeaderIntegrity()` unconditionally returns nothing on every
// other platform. electron-builder matches that — `ElectronFramework.beforeCopyExtraFiles`
// embeds integrity metadata only for Windows and macOS, and its Linux branch does none.
//
// So setting the fuse on AppImage or deb is safe; it is simply inert. It is left off
// anyway, because an enabled fuse reads as "this build validates its archive" and on
// Linux nothing does. A guarantee nobody enforces is worse than an absent one: it gets
// believed. The test asserts the distinction so the reason survives the next edit.
const ASAR_INTEGRITY_PLATFORMS = new Set(["darwin", "mas", "win32"]);

/**
 * The fuse policy, resolved for one packaged platform.
 *
 * `electronPlatformName` is a parameter rather than a read of `process.platform` for the
 * same reason every path-resolving module here takes `platform`: the value that matters
 * is the platform being *packaged*, which on a cross-build is not the one running the
 * build. Reading the global would silently produce a Linux policy for a Windows artifact.
 */
function resolveFuseConfig(electronPlatformName) {
  const validateAsarIntegrity = ASAR_INTEGRITY_PLATFORMS.has(electronPlatformName);
  return {
    version: FuseVersion.V1,

    // Flipping fuses rewrites bytes inside the .app, which invalidates the ad-hoc
    // signature Electron ships with. macOS on Apple Silicon refuses to launch a binary
    // whose signature does not match, so it has to be re-applied or the build is dead on
    // arrival on every arm64 Mac.
    //
    // electron-builder normally re-signs straight after flipping and this would be
    // redundant — but it only signs when it finds an identity, and we configure none.
    // An unsigned arm64 dmg is therefore exactly the case that needs it. @electron/fuses
    // only acts on this when the path is a .app, so it is inert on Windows and Linux.
    resetAdHocDarwinSignature: electronPlatformName === "darwin" || electronPlatformName === "mas",

    // The escape described at the top of this file.
    [FuseV1Options.RunAsNode]: false,

    // NODE_OPTIONS can inject `--require` into our process from outside it. NODE_EXTRA_CA_CERTS
    // can make us trust an attacker's certificate authority, which matters because we talk to
    // a local harness over HTTP and check for updates over HTTPS. We set neither ourselves.
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,

    // `--inspect` on a shipped build hands a debugger full control of the main process:
    // arbitrary evaluation, every module we loaded, every token in memory. Disabling it
    // also stops SIGUSR1 from opening the inspector behind our back. Development runs
    // through `npm start` on an unpackaged Electron, which this hook never touches.
    [FuseV1Options.EnableNodeCliInspectArguments]: false,

    // Without this, Electron's lookup order is app.asar -> app -> default_app.asar, so
    // dropping an `app` directory next to the binary silently replaces our code. That is
    // trivial on a portable build sitting in a writable folder. Pinning the search to
    // app.asar is what makes the integrity check below worth having: unvalidated code has
    // nowhere left to be loaded from.
    [FuseV1Options.OnlyLoadAppFromAsar]: true,

    // Verifies app.asar's header hash against the value the packager embedded in the
    // executable (a PE `INTEGRITY` resource on Windows, `ElectronAsarIntegrity` in
    // Info.plist on macOS), so an edited archive fails to load instead of running.
    // electron-builder computes and embeds that metadata for every asar build unless
    // `disableAsarIntegrity` is set, which we do not set.
    //
    // The trap this creates for later: the check is fatal for *any* .asar beside the
    // executable that the packager did not hash, and electron-builder hashes
    // `extraResources` but not `extraFiles`. We ship neither, and the test keeps it that
    // way — otherwise such a build would package cleanly, run here, and die on users.
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: validateAsarIntegrity,

    // Deliberately not set:
    //
    // GrantFileProtocolExtraPrivileges — main.cjs loads the renderer with `loadFile`, so
    // the UI *is* a file:// page. Revoking those privileges breaks the app we ship. It
    // becomes available to us once the renderer moves to a custom protocol, which the
    // reference architecture lists as a separate open gap.
    //
    // EnableCookieEncryption — a one-way door. Once on, existing cookies are re-written
    // encrypted, and turning it back off leaves an unreadable store. We load no remote
    // content under a `default-src 'none'` CSP, so there is nothing here worth that risk.
    //
    // LoadBrowserProcessSpecificV8Snapshot — only useful when shipping a custom browser
    // process snapshot, which we do not.
  };
}

/**
 * electron-builder's `afterPack` hook.
 *
 * Delegates to the packager's own `addElectronFuses` rather than calling `flipFuses` on a
 * hand-built path: locating the binary differs per platform (`.app`, `.exe`, bare) and on
 * Linux uses the configured `executableName` instead of the product name. Re-deriving that
 * here would be a second copy of a rule that already exists, and would break the first time
 * `executableName` changed.
 */
async function afterPack(context) {
  await context.packager.addElectronFuses(context, resolveFuseConfig(context.electronPlatformName));
}

module.exports = { afterPack, resolveFuseConfig, ASAR_INTEGRITY_PLATFORMS };
