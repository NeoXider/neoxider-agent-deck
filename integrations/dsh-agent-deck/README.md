# Agent Deck for DSH

A server-side DSH plugin that connects a Harness session to the
[NeoXider Agent Deck](https://github.com/NeoXider/neoxider-agent-deck) desktop
widget. It registers two tools and needs no client build, so the same package
works in `dsh web` and in the Harness bundled with DSH Desktop.

| Tool | What it does |
| --- | --- |
| `deck_status` | Reports whether the widget is installed, its executable and installed version, whether a process is running, which Harness origin its settings point at, and whether that is the Harness serving this session. |
| `deck_open` | Starts the widget attached to a Harness (default: this session's Harness) or, when it is already running, brings its window forward. |

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
node --test integrations/dsh-agent-deck/test/
```

## Uninstall

```sh
dsh plugin --profile web remove dsh-agent-deck
```
