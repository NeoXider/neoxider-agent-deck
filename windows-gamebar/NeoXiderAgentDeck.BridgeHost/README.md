# NeoXider Agent Deck Bridge Host

This Windows-only sidecar owns the authenticated named-pipe transport between the desktop Electron process and the packaged Xbox Game Bar widget.

- UWP frames are written unchanged to standard output as UTF-8 JSONL.
- Desktop responses are read unchanged from standard input as UTF-8 JSONL.
- Diagnostics are written only to standard error.
- The sidecar exits when standard input reaches EOF or the process receives Ctrl+C.

At startup it resolves the installed `NeoXider.AgentDeck.GameBar` package for the current user. If the package is missing or its identity is ambiguous, startup fails before a pipe is created. The pipe ACL contains only SYSTEM, the current user, and the dynamically derived package SID; `FILE_FLAG_FIRST_PIPE_INSTANCE` prevents a pre-existing same-name pipe from being silently accepted. Each connected client is impersonated and its AppContainer SID must equal the SID derived from the resolved package family.

Desktop frames are routed only to the currently authenticated pipe generation. Frames received while disconnected are dropped, and queue overflow closes that generation instead of leaking stale responses into a reconnect.

Build, test, and publish a trimmed, self-contained `win-x64` executable:

```powershell
..\scripts\build-bridge-host.ps1
```

The published executable is placed under `windows-gamebar/artifacts/bridge-host/win-x64/`, which is intentionally ignored by Git.

The partial trim keeps the complete `Microsoft.Windows.SDK.NET` and `WinRT.Runtime`
assemblies rooted. Current C#/WinRT packages still emit linker-analysis warnings for
generic projections. A missing-package startup smoke is not release proof: an installed
widget must complete package discovery and a positive AppContainer handshake before the
trimmed executable is treated as runtime-verified.

Partial trimming currently reports `IL2104` from the Windows SDK projection assemblies. The publish smoke exercises `PackageManager` activation and fail-closed lookup after trimming; the warnings are kept visible rather than globally suppressed. A 20 MiB size ceiling guards against accidentally shipping an untrimmed runtime.
