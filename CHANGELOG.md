# Changelog

All notable changes to NeoXider Agent Deck are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-08-26

The project is renamed from **DeepSeek Harness Widget** to **NeoXider Agent Deck**,
and this release closes the security, accessibility and resilience findings from a
full audit of the main process, the renderer and the UI.

### Changed

- **Renamed to NeoXider Agent Deck.** Product name, application id
  (`dev.neoxider.agentdeck`), user-data directory, release artifact names and the
  repository moved to the new identity. Existing installs are migrated
  automatically: the previous settings directory and the old Windows autostart
  entries are detected and carried over, so upgrading keeps window placement,
  opacity, glow and autostart.
- Portable builds are now published as `NeoXider-Agent-Deck-<version>-windows-x64-portable.exe`.

### Added

- **Content Security Policy.** The renderer runs under
  `default-src 'none'` with no `unsafe-inline` and no `unsafe-eval`. Only local
  scripts and styles load, attachment thumbnails are limited to `data:` images, and
  the renderer cannot open a network connection of its own.
- **Navigation containment.** `setWindowOpenHandler` denies every attempt to spawn a
  second Electron window, `will-navigate` refuses to replace the widget with remote
  content, and `will-attach-webview` is blocked. Links from model output are
  re-parsed and protocol-checked before they are handed to the system browser.
- **Renderer crash recovery.** A frameless transparent window that lost its renderer
  used to remain on screen as a dead shape that could only be removed from the task
  manager. The renderer is now reloaded automatically, and after three failed
  recoveries the app exits cleanly instead of looping.
- **A visible focus ring on every keyboard-reachable control.** Tabs, mode
  switches, queue actions, command rows, size and layer switches and picker options
  previously signalled focus only with a faint background tint, or suppressed the
  outline entirely.
- **The conversation is exposed to assistive technology** as an ARIA log region, so
  screen readers announce incoming replies.

### Fixed

- **A failed settings write can no longer kill the application.** Preferences are
  saved from a timer, from the window close handler and from `before-quit`; a
  transient `EPERM` from a virus scanner or a sync client holding the file in
  `%APPDATA%` surfaced as an uncaught exception in the main process. Writes are now
  guarded and logged.
- **Settings are no longer deleted before being replaced.** The save path removed the
  destination file before renaming the temporary file over it, leaving a window in
  which a crash lost all settings. `renameSync` already replaces the destination
  atomically on every supported platform, so the delete is gone.
- **A losing second instance stops immediately.** Without a `return` after
  `app.quit()` the second process kept executing the whole module and could still
  register IPC handlers and build a window, tray and socket before the queued quit
  landed.
- **Opacity and glow sliders no longer rewrite the settings file on every tick.**
  Both now use the same debounced write as window resize and move, instead of a full
  synchronous rewrite per input event.
- **Five interface colours failed WCAG AA** against the widget surface — inactive
  tabs (4.47:1), empty states (4.07:1), empty picker text (4.47:1), picker option
  hints (4.48:1) and tool-call timestamps (3.98:1). All dimmed labels now use a
  single token that holds at least 5.8:1 on every surface.
- **Polling backs off while the widget is hidden.** The dashboard was refreshed every
  2.5 seconds even behind a minimized window; hidden polling now runs at 10 seconds
  and refreshes immediately when the widget becomes visible again.
- The tray icon is destroyed on quit instead of being left as a ghost in the
  notification area, `agent-complete` no longer writes to a destroyed window, and
  macOS dock activation handles a destroyed-but-not-null window.

## [0.2.4] - 2026-08-25

- Click-through edge glow: only the visible edge line accepts input, so the wider
  transparent halo no longer blocks clicks in applications underneath.
- Smooth easing between idle, thinking, writing, tool, waiting, error and done
  palettes for the collapsed avatar.

## [0.2.3] - 2026-08-25

- Focus Chat mode, jump-to-latest control and respectful scrolling.
- Live answer bubble: streamed assistant text grows inside the real chat bubble.

## [0.2.2] - 2026-08-25

- Authoritative Harness queue with Edit, Delete and Send now actions.
- Attachment previews for images and video without shifting the composer.

## [0.2.1] - 2026-08-25

- Chat-first navigation, searchable provider/model picker and reasoning control.
- Collapsed tool-call groups with input, result, timing and error state.

## [0.2.0] - 2026-08-25

- Draggable compact modes with edge magnetisation and per-mode placement memory.
- Three window layers: Normal, Above and Game.

## [0.1.0] - 2026-08-25

- First release: animated desktop companion for DeepSeek Harness sessions and chat.

[0.3.0]: https://github.com/NeoXider/neoxider-agent-deck/releases/tag/v0.3.0
[0.2.4]: https://github.com/NeoXider/neoxider-agent-deck/releases/tag/v0.2.4
[0.2.3]: https://github.com/NeoXider/neoxider-agent-deck/releases/tag/v0.2.3
[0.2.2]: https://github.com/NeoXider/neoxider-agent-deck/releases/tag/v0.2.2
[0.2.1]: https://github.com/NeoXider/neoxider-agent-deck/releases/tag/v0.2.1
[0.2.0]: https://github.com/NeoXider/neoxider-agent-deck/releases/tag/v0.2.0
[0.1.0]: https://github.com/NeoXider/neoxider-agent-deck/releases/tag/v0.1.0
