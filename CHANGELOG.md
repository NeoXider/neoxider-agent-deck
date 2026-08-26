# Changelog

All notable changes to NeoXider Agent Deck are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-08-26

A reliability pass over the main process. Every item below was verified against the
running code before it was changed, and the whole set is covered by new tests.

### Fixed

- **Live events died silently on a half-open connection.** The queue/event socket had
  no liveness detection, so a laptop sleep or a VPN switch left a socket that never
  fires `onclose`. It stayed non-null forever, the reconnect guard returned early on
  every retry, and queue and streaming updates stopped for the rest of the session —
  while HTTP polling kept the rest of the interface looking healthy. A silence
  watchdog now closes a mute socket, and reconnects back off from 1.5s to 30s instead
  of hammering an offline Harness forever.
- **Attachments froze the whole application.** Files were read and base64-encoded
  synchronously on the single-threaded main process: up to twelve 8 MB files stalled
  the window, tray and every IPC handler for seconds. Preparation is now asynchronous.
- **One bad file discarded the whole selection.** Attachment preparation used
  `Promise.all`, so a single unreadable or oversized file rejected the entire batch and
  the user got nothing back with no indication of which file failed. Each file is now
  reported separately: the good ones attach and the failures are named.
- **`Start with Windows` aside, launching Harness could not work on macOS or Linux.**
  The fallback spawned bare `npx`, but an app started from Finder, a `.desktop`
  launcher or systemd inherits a minimal PATH without nvm or homebrew. The fallback now
  goes through a login shell, mirroring what the Windows branch already did with `cmd.exe`.
- **Full access was renegotiated on every message.** An extra command RPC with a 30s
  timeout ran before each prompt, doubling perceived send latency, even though the
  permission is a property of the session. It is now negotiated once per session.
- **A renderer payload could retarget a call at another session.** `session.selectModel`
  spread the renderer-supplied selection after the session id, so `selection.sessionId`
  silently overwrote the real one. The id is now authoritative and validated.
- **Settings written by a newer build were silently destroyed.** The schema version was
  written but never read, and unknown keys are discarded on normalisation, so running an
  older build once wiped the newer build's settings. A newer file is now detected and
  copied aside instead of being overwritten.
- **The widget was never re-clamped when the display layout changed.** Unplugging a
  monitor or changing resolution could leave it off-screen until the next mode switch.

### Removed

- Four IPC channels that nothing called (`set-always-on-top`, `window-bounds`,
  `move-compact-window`, `snap-compact-window`) along with their preload bridges. A test
  now fails if a bridged channel loses its handler, or if a handler loses every caller.

## [0.3.2] - 2026-08-26

### Added

- One offline status banner with a guarded **Start** action that prefers the installed
  official DeepSeek Harness runtime and opens the live Web service without leaving the
  widget.
- Real screenshot-based README cover showing the current Full, Avatar and Edge modes.
- Platform-aware settings presentation and automated Windows, macOS, Linux X11 and
  Wayland fixtures.

### Changed

- The compact toolbar always names the active model, unavailable context no longer
  consumes composer width, and the live answer uses a growing bubble with a subtle caret.
- Avatar and Edge glow are softer and transition without expanding the draggable hit area.
- Tabs and selected switch groups expose keyboard and screen-reader state; placeholders
  now meet WCAG AA contrast.

### Fixed

- Offline state is no longer repeated in the title and session list. Agents and Focus
  modes retain the single actionable banner.
- Linux and Wayland no longer expose opacity, Game, Edge or positioning controls that the
  current desktop cannot perform; Linux X11 labels its wider interactive Edge behavior.
- A timed-out Harness launch is retained and re-probed, so Retry cannot spawn a duplicate
  owned process. Definite launch failures still use the bounded Windows batch fallback.

## [0.3.1] - 2026-08-26

### Fixed

- **Clicking the avatar did not collapse the widget to the orb.** The brand area
  captures the pointer so it can be dragged, and pointer capture retargets the
  follow-up click to the capturing element — so the click never reached the avatar
  button's own handler. Taps are now resolved where the gesture started, and
  keyboard activation still works. Reproduced and verified with real mouse input
  through `npm run test:input`.
- **Releasing the collapsed edge handle after a drag reopened the widget.** The
  guard that suppresses the click after a drag was armed only after awaiting an IPC
  round trip, while the click event fires synchronously right after `pointerup` —
  so every drag release fell through and restored the full window. The guard is now
  set before any await.

### Added

- `npm run test:input` — a physical-input regression that drives real mouse events
  against the compact-mode gestures, which synthetic `click()` calls cannot reproduce.

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

[0.4.0]: https://github.com/NeoXider/neoxider-agent-deck/releases/tag/v0.4.0
[0.3.2]: https://github.com/NeoXider/neoxider-agent-deck/releases/tag/v0.3.2
[0.3.1]: https://github.com/NeoXider/neoxider-agent-deck/releases/tag/v0.3.1
[0.3.0]: https://github.com/NeoXider/neoxider-agent-deck/releases/tag/v0.3.0
[0.2.4]: https://github.com/NeoXider/neoxider-agent-deck/releases/tag/v0.2.4
[0.2.3]: https://github.com/NeoXider/neoxider-agent-deck/releases/tag/v0.2.3
[0.2.2]: https://github.com/NeoXider/neoxider-agent-deck/releases/tag/v0.2.2
[0.2.1]: https://github.com/NeoXider/neoxider-agent-deck/releases/tag/v0.2.1
[0.2.0]: https://github.com/NeoXider/neoxider-agent-deck/releases/tag/v0.2.0
[0.1.0]: https://github.com/NeoXider/neoxider-agent-deck/releases/tag/v0.1.0
