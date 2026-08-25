<p align="center">
  <img src="docs/cover.png" alt="DeepSeek Harness Widget — Agent Deck" width="100%" />
</p>

<h1 align="center">DeepSeek Harness Widget</h1>

<p align="center"><strong>An animated Windows desktop companion for agents, context and chat.</strong></p>

<p align="center">
  <a href="https://github.com/NeoXider/deepseek-harness-widget/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/NeoXider/deepseek-harness-widget/actions/workflows/ci.yml/badge.svg" /></a>
  <img alt="Windows" src="https://img.shields.io/badge/Windows-10%20%7C%2011-49e7c6" />
  <img alt="Electron" src="https://img.shields.io/badge/Electron-44-8b79ff" />
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-blue.svg" /></a>
</p>

Agent Deck keeps [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) close without keeping the full web interface open. It shows live sessions and subagents, provides a real mini-chat, tracks context pressure, switches models and reasoning effort, runs native Harness commands, changes workspaces, and accepts file drops.

The NeoXider avatar reacts to agent state: breathing while idle, typing while working, floating while waiting, shaking on errors and celebrating completion.

## Preview

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/overview.png" alt="Compact agent overview" /></td>
    <td width="50%"><img src="docs/screenshots/chat.png" alt="Mini-chat with context, model, reasoning, workspace and commands" /></td>
  </tr>
  <tr>
    <td align="center"><strong>Live agent overview</strong></td>
    <td align="center"><strong>Full Harness mini-chat</strong></td>
  </tr>
</table>

<p align="center">
  <img src="docs/screenshots/avatar-mode.png" alt="Avatar mode" width="76" />
  &nbsp;&nbsp;&nbsp;&nbsp;
  <img src="docs/screenshots/edge-mode.png" alt="Edge handle mode" height="132" />
</p>

## Highlights

- **Real Harness sessions** — session titles, running state, subagents and errors come from the live HTTP RPC API.
- **Context pressure** — a compact ring shows projected tokens against the model context window.
- **Model routing** — choose every provider/model exposed by Harness, including LM Studio routes.
- **Reasoning control** — effort options update dynamically for the selected model.
- **Native commands** — the `/` palette is loaded from `commands/list`, so `/goal`, `/plan`, `/compact`, `/permission` and plugin commands stay current.
- **Workspace switching** — select an existing Harness workspace or add a folder; the widget starts the next session there.
- **Files and drag-and-drop** — PNG, JPEG, WebP and GIF files use official image content blocks. Other files become explicit local `@path` references.
- **Three window states** — full deck, notification avatar, or an iridescent edge handle.
- **Completion notifications** — the avatar badge increments while collapsed; the edge handle bounces when work finishes.
- **No close button** — window close gestures dock the widget to the screen edge. Quit remains available from the tray menu.
- **Personal controls** — opacity, compact/standard/large size, always-on-top and Windows autostart.

## Install

### Portable release

1. Download the latest `DeepSeek-Harness-Widget-*-portable.exe` from [Releases](https://github.com/NeoXider/deepseek-harness-widget/releases/latest).
2. Start DeepSeek Harness Web on `http://127.0.0.1:3080`.
3. Run the portable executable.

To install the latest release under `%LOCALAPPDATA%`, create a desktop shortcut and launch it:

```powershell
git clone https://github.com/NeoXider/deepseek-harness-widget.git
cd deepseek-harness-widget
powershell -ExecutionPolicy Bypass -File .\scripts\install-desktop.ps1
```

### From source

Requirements: Node.js 22+ and a running DeepSeek Harness Web profile.

```powershell
git clone https://github.com/NeoXider/deepseek-harness-widget.git
cd deepseek-harness-widget
npm ci
npm test
npm start
```

Set `DSH_WIDGET_URL` to use a different Harness endpoint.

## Controls

| Control | Action |
|---|---|
| `◉` / `✦` | Agent overview / chat |
| `●` | Collapse to the animated avatar |
| `❯` | Dock to the screen edge |
| `/` | Open the live Harness command palette |
| `◇` | Select model |
| `∴` | Select reasoning effort |
| `⌂` | Choose workspace |
| `◈` | Switch Agent / Plan mode |
| `⌕` | Attach files |
| `■` | Cancel the current turn |

Click the avatar or edge handle to restore the full deck. Use the tray menu to quit completely.

## How chat works

The widget does not embed or scrape the Harness web page. It uses the installed Harness RPC contracts directly:

- `session.list`, `session.history`, `session.create`, `session.prompt`, `session.cancel`
- `session.models`, `session.selectModel`
- `workspace.list`, `workspace.create`
- `commands/list`, `commands/execute`

This keeps the UI small and avoids coupling it to Harness HTML layout changes. Provider credentials remain inside Harness; the widget never reads API keys.

## Build and verify

```powershell
npm test
npm run smoke
npm run feature-smoke
npm run chat-smoke
npm run build
```

The portable executable is written to `release/DeepSeek-Harness-Widget-0.1.0-portable.exe`.

`feature-smoke` verifies workspace-aware session creation, live command discovery/execution and reasoning-capable model discovery. `chat-smoke` creates a real Harness session and expects an `OK` reply from the configured LM Studio route.

## Security

The renderer is sandboxed with `contextIsolation` enabled and Node.js integration disabled. Local file preparation and Harness requests stay in the main process behind a narrow IPC bridge. See [SECURITY.md](SECURITY.md).

## Companion project

Reduce MCP schema overhead with one lazy tool: [DeepSeek Capability Hub](https://github.com/NeoXider/deepseek-capability-hub).

## Contributing

Focused issues and pull requests are welcome. Please include a screenshot for visual changes and a test or live smoke receipt for behavior changes.

MIT © NeoXider
