<p align="center">
  <img src="docs/cover.png" alt="NeoXider Agent Deck" width="100%" />
</p>

<h1 align="center">NeoXider Agent Deck</h1>

<p align="center"><strong>Your agents, alive on the desktop — a glowing companion for DeepSeek Harness sessions, context and chat.</strong></p>

<p align="center">
  <a href="https://github.com/NeoXider/neoxider-agent-deck/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/NeoXider/neoxider-agent-deck/actions/workflows/ci.yml/badge.svg" /></a>
  <img alt="Windows" src="https://img.shields.io/badge/Windows-10%20%7C%2011-49e7c6" />
  <img alt="Electron" src="https://img.shields.io/badge/Electron-44-8b79ff" />
  <img alt="Source version" src="https://img.shields.io/badge/source-v0.6.18-8b79ff" />
  <a href="CHANGELOG.md"><img alt="Changelog" src="https://img.shields.io/badge/changelog-0.6.18-49e7c6" /></a>
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-blue.svg" /></a>
</p>

Agent Deck keeps [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) close without keeping the full web interface open. It shows live sessions and subagents, provides a real mini-chat, tracks context pressure, switches models and reasoning effort, runs native Harness commands, changes workspaces, accepts file drops, renders safe Markdown, and keeps tool calls compact.

The NeoXider avatar reacts to agent state: breathing while idle, typing while working, floating while waiting, shaking on errors and celebrating completion. A subtle inner chat glow independently distinguishes model thinking, answer generation, and tool execution; idle chat has no glow. Short spring transitions make buttons, Send, view changes, avatar collapse, and edge docking feel responsive without ignoring Windows reduced-motion preferences.

## Preview

### Modes at a glance

<table>
  <tr>
    <td width="20%"><img src="docs/screenshots/chat.png" alt="Full NeoXider Agent Deck chat" /></td>
    <td width="20%"><img src="docs/screenshots/focus-chat.png" alt="Focus Mini chat-only mode" /></td>
    <td width="20%"><img src="docs/screenshots/recent-sessions-orb.png" alt="Orb mode with recent sessions" /></td>
    <td width="20%"><img src="docs/screenshots/edge-mode.png" alt="Edge mode docked to the physical screen edge" /></td>
    <td width="20%"><img src="docs/screenshots/small-chat-360.png" alt="Minimum 360 pixel chat layout" /></td>
  </tr>
  <tr>
    <td align="center"><strong>Full</strong></td>
    <td align="center"><strong>Focus Mini</strong></td>
    <td align="center"><strong>Orb</strong></td>
    <td align="center"><strong>Edge</strong></td>
    <td align="center"><strong>Minimum 360 px</strong></td>
  </tr>
</table>

### Feature gallery

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/overview.png" alt="Compact agent overview" /></td>
    <td width="50%"><img src="docs/screenshots/chat.png" alt="Mini-chat with context, model, reasoning, workspace and commands" /></td>
  </tr>
  <tr>
    <td align="center"><strong>Live agent overview</strong></td>
    <td align="center"><strong>Full Harness mini-chat</strong></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/workspace-groups.png" alt="Agents grouped by exact Harness workspace and Ungrouped" /></td>
    <td width="50%"><img src="docs/screenshots/workspace-groups-chat.png" alt="Chat session picker with collapsible Harness workspaces" /></td>
  </tr>
  <tr>
    <td align="center"><strong>Exact Workspaces / Ungrouped agent deck</strong></td>
    <td align="center"><strong>Start inside a folder or ungrouped</strong></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/model-picker.png" alt="Searchable dark model picker with LM Studio first" /></td>
    <td width="50%"><img src="docs/screenshots/markdown-tools.png" alt="Safe Markdown and collapsed tool calls" /></td>
  </tr>
  <tr>
    <td align="center"><strong>Searchable provider/model picker</strong></td>
    <td align="center"><strong>Markdown + collapsed tool calls</strong></td>
  </tr>
  <tr>
    <td colspan="2"><img src="docs/screenshots/attachments.png" alt="Visible image and video attachment previews" /></td>
  </tr>
  <tr>
    <td colspan="2" align="center"><strong>Stable PNG and video attachment previews</strong></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/commands.png" alt="Compact Harness command palette above the input" /></td>
    <td width="50%"><img src="docs/screenshots/todo.png" alt="Harness TODO plan rendered inside the compact chat" /></td>
  </tr>
  <tr>
    <td align="center"><strong>Compact native command palette</strong></td>
    <td align="center"><strong>Live Harness TODO plan</strong></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/goal.png" alt="Structured goal command result" /></td>
    <td width="50%"><img src="docs/screenshots/mixed-tools.png" alt="Mixed tool group with per-tool success and failure state" /></td>
  </tr>
  <tr>
    <td align="center"><strong>Readable structured command results</strong></td>
    <td align="center"><strong>Per-tool status, even in mixed groups</strong></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/goal-dock.png" alt="The goal as a strip under the composer, opened to its controls" /></td>
    <td width="50%"><img src="docs/screenshots/markdown-tools.png" alt="Safe Markdown and a compact collapsed tool group" /></td>
  </tr>
  <tr>
    <td align="center"><strong>The goal never scrolls away</strong></td>
    <td align="center"><strong>Compact tool groups, opened on demand</strong></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/focus-chat.png" alt="Chat-only focus mode" /></td>
    <td width="50%"><img src="docs/screenshots/notification-orb.png" alt="Animated compact reply notification" /></td>
  </tr>
  <tr>
    <td align="center"><strong>One-click Focus Chat</strong></td>
    <td align="center"><strong>Session-aware compact notification</strong></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/queue.png" alt="Compact authoritative Harness queue actions" /></td>
    <td width="50%"><img src="docs/screenshots/live-stream.png" alt="Live growing assistant response bubble" /></td>
  </tr>
  <tr>
    <td align="center"><strong>Edit, delete or send queued messages now</strong></td>
    <td align="center"><strong>Streaming answer grows in place</strong></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/scroll-away.png" alt="Manual scroll position and jump to latest" /></td>
    <td width="50%"><img src="docs/screenshots/settings.png" alt="Window layer, opacity, glow and size settings" /></td>
  </tr>
  <tr>
    <td align="center"><strong>Reading position stays under user control</strong></td>
    <td align="center"><strong>Three window layers + adjustable glow</strong></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/update-ready.png" alt="Verified background update ready to install from the header" /></td>
    <td width="50%"><img src="docs/screenshots/empty-chat.png" alt="Empty session with a visible zero percent context ring" /></td>
  </tr>
  <tr>
    <td align="center"><strong>Verified update, one-click restart</strong></td>
    <td align="center"><strong>Complete UI before the first session</strong></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/composer-single-line.png" alt="Compact one-line chat composer" /></td>
    <td width="50%"><img src="docs/screenshots/composer-multiline-max.png" alt="Expanded multiline composer with its own scroll" /></td>
  </tr>
  <tr>
    <td align="center"><strong>Compact by default</strong></td>
    <td align="center"><strong>Grows to one third, then scrolls</strong></td>
  </tr>
</table>

<p align="center">
  <img src="docs/screenshots/recent-sessions-orb.png" alt="Orb mode with three recent sessions" height="118" />
  &nbsp;&nbsp;&nbsp;&nbsp;
  <img src="docs/screenshots/quick-reply-orb.png" alt="Exact-session quick reply in Orb mode" height="118" />
  &nbsp;&nbsp;&nbsp;&nbsp;
  <img src="docs/screenshots/edge-done.png" alt="Edge handle completion state" height="118" />
</p>

## Highlights

- **Chat-first navigation** — the real mini-chat is the default first page; the agent deck is one tap away.
- **State-aware agent deck** — every session card changes its avatar, glow and label for working, idle or error state. Activity is cleared from authoritative turn events, so a completed or failed session does not remain falsely marked as working.
- **Real Harness sessions** — session titles, running state, subagents and errors come from the live HTTP RPC API.
- **Complete long conversations** — history follows Harness backward pagination to the first event, then reuses cached older pages while polling only the newest tail; no silent 80-message cutoff remains.
- **Context pressure** — a compact ring shows projected tokens against the model context window and remains a calm `0%` ring before the first session exists.
- **Model routing** — use the searchable dark picker for every provider/model exposed by Harness; the active/local route (including LM Studio) stays first.
- **Reasoning control** — effort options update dynamically for the selected model.
- **Native commands and skills** — the vertical `/` palette opens above the composer and merges Harness's two sources: `commands/list` for `/goal`, `/plan`, `/compact`, `/permission` and plugin commands, and `skill.list` for every skill installed in the workspace. Skills are badged as such and sent as ordinary prompts, because a skill is invoked by the model rather than executed by the host.
- **Harness session groups** — Agents and Chat use exact Harness `Workspaces` membership plus `Ungrouped`, keep each folder collapsible in one line, and offer a compact action for starting a session inside that group or outside every workspace.
- **Safe, colorful Markdown** — headings, emphasis, links, quotes, tables, inline code and fenced code use a restrained dark palette, with Highlight.js syntax colors for supported languages; executable HTML and unsafe link protocols are blocked.
- **Collapsed tool runs** — consecutive native `tool/call`, `tool/result`, and nested Code Mode dispatches become one expandable group; each child still exposes input, result, timing, and error state.
- **Live answer bubble** — streamed assistant text grows inside the real chat bubble as it arrives; the activity card remains reserved for reasoning and tool state instead of mislabeling an answer as thinking.
- **Optional live activity** — thinking, tool and working status share one compact overlay that floats above the conversation on its own opaque layer, never shifts the reading viewport, and can be hidden persistently with **Show live activity**. Outcomes — a finished or failed turn — are still announced.
- **Authoritative Harness queue** — messages sent during a running turn appear as compact one-line queued items from Harness itself, with Edit, Delete and Send now actions. Attachments queue too: an image-only message reads as `1 attachment` and refuses in-place text editing, and a file is previewed by name while its full path is preserved for editing.
- **Respectful scrolling** — reading older messages is never interrupted by forced auto-scroll; a compact jump-to-latest control remains available whenever the chat is away from the bottom, even before another message arrives.
- **Compact 2×2 composer** — context/expand and command/attachment actions stay in two vertical pairs, with `/` above the paperclip and a tightly fitted Send button that leaves the input wide.
- **Files, paste and drag-and-drop** — `Ctrl+V` adds copied files or clipboard images for review without auto-sending. PNG, JPEG, WebP and GIF files use official image content blocks; sent messages retain tiny image previews or compact file/video chips, while other files become explicit local `@path` references.
- **Instant screenshots** — capture a selected region or the current display from the header or a global shortcut, inspect the PNG preview above the composer, then decide whether to send it.
- **Rebindable global shortcuts** — show/collapse the deck, create a session, capture a region or display, focus chat, and open Harness; every binding can be disabled, changed, reset, and survives restart.
- **Live chat aura** — brighter-by-default, distinct inner glows indicate thinking, writing, and tool execution. No activity means no glow, and glow intensity is adjustable in settings.
- **Focus Chat** — one compact composer button hides all chrome and setup surfaces, leaving only messages, optional attachment previews, the input, context and actions; tap it again to restore everything.
- **Three window states** — full deck, notification avatar, or an iridescent edge handle.
- **Draggable compact modes** — drag the avatar by its circle, or the edge handle by its line, with native cursor tracking; release magnetizes it to the nearest screen edge, decided by where the visible element was dropped rather than by the transparent window around it. Both can be parked flush against the top or bottom of the screen.
- **Persistent per-mode placement** — full, avatar and edge modes remember their own monitor, side and vertical position across restarts; missing displays are handled by safely clamping the window into the current work area.
- **Click-through compact modes** — on supported native desktops both compact windows forward the mouse through their transparent space: only the 68 px avatar circle and its two controls, or the visible 8 px edge line (each plus a small comfort margin), accept hover, restore, and drag input; hover springs inward with bloom, idle shimmers cyan-green, and active work accelerates in green-yellow. Linux X11 exposes an honestly labeled wider interactive edge, while Wayland disables Edge mode.
- **Smooth pet status glow** — the collapsed avatar now eases between idle, thinking, writing, tool, waiting, error, and done palettes instead of switching its ring abruptly.
- **Classic NeoXider slimes** — idle, working, waiting, error, and done now use the original soft-bottom mascot shapes from NeoXider Video Studio instead of the round variants.
- **Click-or-drag brand** — click the full-size avatar to collapse, click the NeoXider title to open the repository, or drag anywhere across the brand area to move the full widget. Brand text is non-selectable, so a drag cannot turn into a text selection.
- **Collapsed by default** — Avatar mode stays a circle with a count of working agents on its expand button; the session panel opens only when asked. **Expand avatar on activity** in settings restores the old always-opening behaviour.
- **Background task count** — a session card shows how many background tasks (Harness subagents) are running under it right now, and nothing when none are; the roster size, which counted children that had already finished, is gone.
- **Elapsed turn time** — every session card and the session picker show how long the agent has been on the current turn, ticking live, and how long the last completed turn took. The clock is read from the turn's own events, so it survives a widget restart.
- **Exact-session pet reply** — collapsed pet mode keeps one useful reply button instead of create/command/attachment clutter; it opens the agent and session that produced the reply.
- **Session-aware notifications** — a completed reply slides out for about 2.7 seconds with its session name and answer preview; clicking it restores that exact session. The edge handle still bounces when work finishes.
- **Three window layers** — choose Desktop, where every ordinary window covers the widget; the default Above layer; or the strongest available Game layer. Game is best-effort: exclusive fullscreen and anti-cheat overlays can still win, and unsupported Linux desktops disable the choice instead of silently pretending it worked.
- **No close button** — window close gestures dock the widget to the screen edge. Quit remains available from the tray menu.
- **Single-instance launch** — repeated shortcut clicks focus the existing widget instead of stacking translucent windows.
- **Personal controls** — opacity, compact/standard/large size, chat glow intensity, window layer and Start at login where the platform supports them.
- **Locked-down renderer** — a strict Content Security Policy (`default-src 'none'`, no `unsafe-inline`, no `unsafe-eval`), denied window creation, blocked navigation and protocol-checked external links mean model output can render but never execute or navigate.
- **Survives a renderer crash** — a frameless transparent window that loses its renderer is reloaded automatically instead of lingering as a dead shape that only the task manager can remove.
- **Keyboard and screen reader support** — every reachable control draws a visible focus ring, dimmed labels hold WCAG AA contrast, and the conversation is exposed as an ARIA log region.
- **Reliable portable autostart** — Start at login on Windows targets the stable portable launcher instead of Electron's temporary extracted child; existing stale startup entries are migrated automatically.
- **Quiet background updates** — supported builds check and download a stable release without interrupting the chat. Only after the file is fully verified does a compact **Update** action appear beside the version; installation and restart still require one click.
- **Xbox Game Bar bridge** — the Windows package includes a bounded native sidecar for the separate Game Bar companion. The protocol authenticates the exact AppContainer package, exposes only snapshot, acknowledge, exact-session open and quick reply, and never injects into a game process.

## Install

### Portable release

1. Download the latest `NeoXider-Agent-Deck-*-windows-x64-portable.exe` from [Releases](https://github.com/NeoXider/neoxider-agent-deck/releases/latest).
2. Start DeepSeek Harness Web on `http://127.0.0.1:3080`, or press **Start** in the offline banner. The widget prefers an installed official runtime and avoids spawning a duplicate while a previous launch is still starting.
3. Run the portable executable.

To install the latest release under `%LOCALAPPDATA%`, create a desktop shortcut and launch it:

> **One-time upgrade note:** 0.5.0 is the first release with in-app updating. Version 0.4.3 and earlier cannot update themselves, so install 0.5.0 manually once; later supported releases can use **Settings → Updates**.

```powershell
git clone https://github.com/NeoXider/neoxider-agent-deck.git
cd neoxider-agent-deck
powershell -ExecutionPolicy Bypass -File .\scripts\install-desktop.ps1
```

### From source

Requirements: Node.js 22+ and a running DeepSeek Harness Web profile.

```powershell
git clone https://github.com/NeoXider/neoxider-agent-deck.git
cd neoxider-agent-deck
npm ci
npm test
npm run test:ui
npm start
```

Set `DSH_WIDGET_URL` to use a different Harness endpoint.

## Controls

| Control | Action |
|---|---|
| Glowing header tabs | Switch between the session list and mini-chat |
| Focus icon in the composer | Hide every surface except chat, attachment previews, input, context and actions; tap again to restore |
| Full-size avatar | Click to collapse to the animated avatar and quick actions; drag to move the window |
| NeoXider / Agent Deck title | Click to open this repository; drag to move the window |
| DeepSeek whale beside the session | Open the selected session directly in Harness Web |
| Edge arrow | Dock to the iridescent edge handle |
| Terminal button | Open the live Harness command palette |
| Model chip | Search providers and models |
| Lightbulb chip | Select reasoning effort |
| Folder chip | Choose or add a workspace |
| Agent / Plan switch | Change the Harness interaction mode |
| Paperclip | Attach files or open the attachment picker |
| Chat icon beside the collapsed pet | Expand the avatar panel; its badge counts the agents currently working |
| Jump-to-latest button | Return to the newest message after reading older chat content |
| Stop beside Send | Cancel only the current running turn |
| Context ring at the far left | Show projected context usage |
| Send at the far right | Submit the current message or attachments |

Click the collapsed avatar or edge handle to restore the full deck. Use the tray menu to quit completely.
Drag the avatar by its circle, or the edge handle by its line, and release it anywhere: it snaps to the nearest left or right screen edge and remembers that side. Everything else in those windows is transparent and belongs to whatever is behind them.

## How chat works

The widget does not embed or scrape the Harness web page. It uses the installed Harness RPC contracts directly:

- `session.list`, `session.history`, `session.create`, `session.prompt`, `session.cancel`
- `session.updateQueue` for authoritative Edit, Delete and Send now queue actions
- `session.models`, `session.selectModel`
- `workspace.list`, `workspace.create`
- `commands/list`, `commands/execute`

This keeps the UI small and avoids coupling it to Harness HTML layout changes. Provider credentials remain inside Harness; the widget never reads API keys.

Every session created or prompted from the widget is explicitly switched to Harness `danger-full-access` before the prompt runs. This matches the widget's intended trusted-desktop workflow, but it also means the selected agent can read, write, execute, and use configured tools without an additional permission prompt. Use the widget only with models, workspaces, MCP servers, and skills you trust.

## Build and verify

```powershell
npm test
npm run test:platforms
npm run test:input
npm run test:ui
npm audit --audit-level=high
npm run smoke
npm run feature-smoke
npm run chat-smoke
npm run tool-smoke
npm run build
```

The portable executable is written to `release/NeoXider-Agent-Deck-0.6.18-windows-x64-portable.exe`.

The test suite verifies the official Harness event shapes, ephemeral reasoning, safe Markdown, tool grouping/correlation, single-instance behavior hooks, compact-window geometry, and UI contracts. `test:ui` launches Electron in deterministic desktop and minimum-size scenarios and rejects clipped or overflowing layouts. `feature-smoke` verifies workspace-aware session creation, live command discovery/execution and reasoning-capable model discovery. `chat-smoke` creates a real Harness session and expects an `OK` reply from the configured LM Studio route. `tool-smoke` additionally requires that model to execute a real Harness tool and checks the widget's correlated tool card.

The 0.6.4 acceptance includes an exact local `lmstudio/qwen3.8-27b-unleashed` Dynamic MCP run through search → inspect → enable → tools → call → skill.load → status → disable → status with zero tool errors and a confirmed stopped Playwright child. During the final repeat, that 27B route failed honestly at LM Studio model startup (`Engine protocol startup was aborted`), so the same fresh read-only three-tool parity turn was repeated on the available `lmstudio/ling-3.0-tiny` route: Harness emitted three correlated `glob`, `grep`, and `read` calls/results; the widget produced separate completed cards, cleared live activity on `turn/end`, and preserved the final Russian answer. Durable receipts: [v0.6.4 Dynamic MCP on Qwen 27B](docs/verification/qwen3.8-27b-dynamic-mcp-v064.json), [final Tiny multi-tool parity](docs/verification/ling-3.0-tiny-multi-tool-parity-v064.json), [final Qwen 27B load failure](docs/verification/qwen3.8-27b-multi-tool-parity-v064-failed-load.json), and the deeper [widget streaming parity](docs/verification/qwen3.8-27b-widget-parity.json). The automated acceptance suite additionally covers exact workspace grouping and order, complete 160-to-161-message history pagination, grouped layouts at compact widths, the persistent jump-to-latest affordance, the non-shifting optional Think overlay, 2×2 composer geometry, native compact drag, and every Edge state.

## Security

The renderer is sandboxed with `contextIsolation` enabled and Node.js integration disabled. Local file preparation and Harness requests stay in the main process behind a narrow IPC bridge. Release downloads are bounded and digest-verified before replacement. Current Windows and macOS artifacts are not code-signed, so SmartScreen/Gatekeeper can warn until a signing certificate is configured. See [SECURITY.md](SECURITY.md).

## Companion project

Reduce MCP schema overhead with one lazy tool: [NeoXider MCP Hub](https://github.com/NeoXider/neoxider-mcp-hub).

## Roadmap

Screen capture, configurable global hotkeys, and the three-session pet switcher ship in 0.5.0; clipboard file/image paste ships in 0.6.4. Remaining overlay diagnostics, per-game profiles, and quiet-notification work is tracked in [TODO.md](TODO.md).

## Changelog

Every release is documented in [CHANGELOG.md](CHANGELOG.md). The current release, 0.6.18,
mirrors Harness Workspaces and Ungrouped sessions across both main views, keeps folder creation
compact, restores complete long-session history and the always-available jump to the latest
message, adds the optional non-shifting Think overlay and clipboard attachment previews,
tightens the 2×2 composer, and repairs compact drag plus Edge state feedback.

## Platform support

Windows 10 and 11 are the primary supported target. CI also packages Intel/Apple Silicon
macOS builds and Linux AppImage/deb builds, but those remain **experimental**. Linux uses
a freedesktop autostart entry; it disables native opacity and Game layer controls;
Wayland also disables window dragging and Edge mode, while X11 labels its wider interactive
Edge area. When no installed Harness runtime is found, `Start Harness` relies on `npx` being
present in the launcher environment, which is not guaranteed for an app started from Finder
or a desktop launcher. The Electron Game layer works over ordinary and borderless windows;
true exclusive fullscreen can outrank desktop windows, so the repository keeps the native
Xbox Game Bar companion path explicit rather than claiming a guarantee the OS does not give.

## Contributing

Focused issues and pull requests are welcome. Please include a screenshot for visual changes and a test or live smoke receipt for behavior changes.

MIT © NeoXider
