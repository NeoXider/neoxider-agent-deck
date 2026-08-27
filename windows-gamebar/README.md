# NeoXider Agent Deck — Xbox Game Bar companion

This isolated Windows UWP companion is the safe fullscreen path for NeoXider Agent Deck. Xbox Game Bar hosts and renders the widget in its own overlay; there is no DLL injection, DirectX hook, process patching, or anti-cheat-sensitive code.

The companion includes:

- official `Microsoft.Gaming.XboxGameBar` activation and manifest contract;
- a pin-capable 360×112 edge/orb status surface;
- Game Bar theme and opacity handling;
- a versioned, bounded desktop bridge contract;
- a self-contained native BridgeHost with exact AppContainer authentication;
- live snapshot, acknowledge, exact-session open and Full-access quick reply commands;
- prerequisite, protocol and sidecar checks that fail clearly.

The bridge is implemented and included in Windows desktop packages. The UWP package still needs a one-time sideload/deploy and user pinning before the Game Bar surface can connect. See [BRIDGE_PROTOCOL.md](BRIDGE_PROTOCOL.md).

## Install the release companion

Download `NeoXider-Agent-Deck-GameBar-<version>-windows-x64.zip` from the same GitHub release as the desktop app, extract it completely, then run:

```powershell
.\Install-NeoXider-Agent-Deck-GameBar.ps1
```

The installer verifies that the MSIX signature matches the supplied public certificate before requesting elevation, then asks for one Windows administrator confirmation to trust that certificate in the local computer's **Trusted People** store. It re-verifies the trusted signature, installs only the packaged x64 dependencies, and installs the companion. Press `Win+G`, open **Widgets**, choose **NeoXider Agent Deck**, and pin it.

The release certificate is a release-specific development/sideload certificate. GitHub Actions creates it only while building, deletes the private key and temporary PFX, and publishes only the signed MSIX plus public `.cer`. Never install a certificate or package obtained outside the official NeoXider release.

Runtime requirements are Windows 10 build 19041 or later (or Windows 11), x64, and a current Xbox Game Bar app. The release installer checks the signed package and its runtime dependencies directly.

## Build locally for development

Local compilation additionally requires Visual Studio 2022, the **Universal Windows Platform development** workload, and Windows 10 SDK **10.0.19041.0**:

```powershell
.\scripts\check-prerequisites.ps1
.\scripts\test-contract.ps1
.\scripts\build.ps1 -Configuration Debug
```

For the first deployment, open `NeoXiderAgentDeck.GameBar.sln` in Visual Studio, select `Debug | x64`, then choose **Build → Deploy Solution**. Game Bar widgets are protocol-activated, so normal startup opens only the instruction page.

Tag releases call the same Windows workflow used for pull-request compile verification. It builds a Release x64 package with an ephemeral `CN=NeoXider` certificate and rejects the release if the MSIX, public certificate, installer, signature, embedded identity, architecture, version, or x64 dependency set is missing or inconsistent.

## One-time Game Bar setup

1. Press `Win+G`.
2. Open the Widget menu.
3. Select **NeoXider Agent Deck**.
4. Press the pin button in the widget title bar.
5. Place and resize the widget once. Game Bar owns the pinned overlay placement.

Pinning is a user action and cannot be silently forced by the desktop app. A development/sideload install is suitable for local verification; production distribution should use the Microsoft Store/Game Bar Widget Store path described by Microsoft.

## Verification boundary

The project contract can be tested without UWP tools:

```powershell
.\scripts\test-contract.ps1
```

A real fullscreen Dota 2 verification requires all of the following: install the built package, open it through Game Bar, pin it, focus Dota 2 in fullscreen, and visually/physically verify that the pinned Game Bar surface remains visible and interactive. That proof cannot be claimed from an Electron topmost-window test.

Microsoft documents an additional platform limit: Game Bar may not appear above Vulkan/OpenGL games when the fullscreen presentation path bypasses DWM. The currently running Dota 2 process has no `-vulkan` launch flag, so that specific limitation is not indicated, but the pinned build still needs the live test above.

## Official references

- [Xbox Game Bar SDK](https://learn.microsoft.com/en-us/xbox/game-bar/)
- [Widget overview](https://learn.microsoft.com/en-us/gaming/game-bar/overview)
- [Recommended development tools](https://learn.microsoft.com/en-us/xbox/game-bar/guide/visual-studio)
- [Manifest changes](https://learn.microsoft.com/en-us/xbox/game-bar/guide/pkg-manifest)
- [Desktop app communication](https://learn.microsoft.com/en-us/gaming/game-bar/guide/communicating-apps)
- [Known issues and fullscreen limitations](https://learn.microsoft.com/en-us/xbox/game-bar/known-issues)
- [Microsoft Xbox Game Bar samples](https://github.com/microsoft/XboxGameBarSamples)
