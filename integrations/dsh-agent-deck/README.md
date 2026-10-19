# Agent Deck for DSH

A server-side DSH plugin that puts the
[NeoXider Agent Deck](https://github.com/NeoXider/neoxider-agent-deck) desktop
widget next to your Harness: a desktop chat, a slime that climbs the screen
while your agents work, or a thin hinge of light on the screen edge. It
registers two tools and needs no client build, so the same package works in
`dsh web` and in the Harness bundled with DSH Desktop.

| Tool | What it does |
| --- | --- |
| `deck_status` | Reports whether the widget is installed, its executable and installed version, whether a process is running, the mode it is folded into (`chat`, `avatar`, `hinge`), its window layer and size, which Harness origin its settings point at, and whether that is the Harness serving this session. |
| `deck_open` | Starts the widget attached to a Harness (default: this session's Harness) or, when it is already running, brings its window forward. |

## What the widget gives you

- **Chat** — the full window: every session, its messages and tool calls, model
  controls.
- **Avatar** — folded into the pet: a small slime that walks the screen edge,
  naps, tells you when an agent finishes and asks you when one needs you. Stored
  as `orb`.
- **Hinge** — folded into a discreet glowing handle on the screen edge, showing
  what the agents are doing. Stored as `edge`.

Deck switches modes itself (`Ctrl+Alt+Shift+A` / `Ctrl+Alt+Shift+E`); the plugin
only reports the mode stored in the app's settings.

### Placement and private capture

| `windowLayer` | Behaviour |
| --- | --- |
| `normal` | An ordinary window. |
| `above` | Always on top of other windows. |
| `game` | Stays above applications, including games in borderless or windowed mode. |
| `private` | As `game`, and asks Windows to leave the widget out of supported screenshots and screen sharing. |

Private mode is Windows-only and uses Electron content protection: on Windows 10
version 2004 and newer the supported capture methods omit the window, while older
versions may show a black area instead. Some recording tools ignore the request,
and no layer guarantees visibility over exclusive fullscreen games — Deck's own
README says the same. `deck_status` reports the layer and mode so you can confirm
what is actually on screen.

The plugin reads the app's own `widget-settings.json` and the version inside the
packaged `app.asar`. The launch URL stored in those settings carries a session
token, so only its origin is ever reported.

## Install

```sh
dsh plugin --profile web add github:NeoXider/neoxider-agent-deck#path:/integrations/dsh-agent-deck
```

To use it in DSH Desktop, install it into the desktop Harness profile the same
way with `DSH_HOME` pointing at `%APPDATA%\dsh-desktop\harness`
(`~/Library/Application Support/dsh-desktop/harness` on macOS,
`~/.config/dsh-desktop/harness` on Linux), or add the same line to that profile's
`cordis.patch.yml`.

Both hosts load `tools`, which is the only service this plugin requires. The
Harness origin comes from `webServer` when it is present and falls back to
`DSH_WIDGET_URL`; without either, `deck_open` needs an explicit `harness_url`.

## Behaviour

- Location: the packaged app in its default install directory
  (`%LOCALAPPDATA%\Programs\NeoXider Agent Deck` on Windows,
  `/Applications/NeoXider Agent Deck.app` on macOS, common `PATH`/`/opt`
  locations on Linux). Set `NEOXIDER_AGENT_DECK_PATH` to point at another copy.
- Deck allows one instance. Launching it a second time focuses the existing
  window, so a running copy keeps whichever Harness it started with;
  `deck_open` reports `alreadyRunning` when that happens.
- The tools only read files and start the app. Nothing is written to the widget's
  settings and no install-time process is started.

## Test

```sh
node --test "integrations/dsh-agent-deck/test/*.test.mjs"
```

## Uninstall

```sh
dsh plugin --profile web remove dsh-agent-deck
```
