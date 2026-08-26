# NeoXider Agent Deck — Xbox Game Bar companion

This isolated Windows UWP companion is the safe fullscreen path for NeoXider Agent Deck. Xbox Game Bar hosts and renders the widget in its own overlay; there is no DLL injection, DirectX hook, process patching, or anti-cheat-sensitive code.

The first stage includes:

- official `Microsoft.Gaming.XboxGameBar` activation and manifest contract;
- a pin-capable 360×112 edge/orb status surface;
- Game Bar theme and opacity handling;
- a versioned, bounded desktop bridge contract;
- prerequisite and structural checks that fail clearly.

It intentionally reports `offline` until the desktop named-pipe bridge is implemented. See [BRIDGE_PROTOCOL.md](BRIDGE_PROTOCOL.md).

## Requirements

- Windows 10 build 19041 or later, or Windows 11;
- the current Xbox Game Bar app;
- Visual Studio 2022;
- **Universal Windows Platform development** workload;
- Windows 10 SDK **10.0.19041.0**.

Check the machine without changing it:

```powershell
.\scripts\check-prerequisites.ps1
```

On this machine, Xbox Game Bar is installed, but the UWP workload and SDK 19041 are currently missing. Install them from **Visual Studio Installer → Modify** before building. The scripts never install workloads automatically.

## Build and deploy for development

After the prerequisites are installed:

```powershell
.\scripts\test-contract.ps1
.\scripts\build.ps1 -Configuration Debug
```

For the first deployment, open `NeoXiderAgentDeck.GameBar.sln` in Visual Studio, select `Debug | x64`, then choose **Build → Deploy Solution**. Game Bar widgets are protocol-activated, so normal startup opens only the instruction page.

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
