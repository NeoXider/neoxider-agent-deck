# Product backlog

This backlog records planned work only. Items are not part of the current release until their acceptance checks pass.

## Epic: Desktop capture

### Feature: Capture a screen region into chat

- **Purpose:** add a compact Screenshot action that captures a user-selected desktop region and immediately adds it to the current message as a visible image attachment.
- **User flow:** press the composer action or its configurable global shortcut, drag a region across any monitor, release, then review/remove the preview before sending. `Esc` cancels without creating a file or attachment.
- **Behavior:** temporarily exclude or hide the widget from its own capture, preserve per-monitor DPI and negative coordinates, encode PNG, reuse the existing attachment preview/removal path, and never send automatically.
- **Architecture:** keep native capture/selection in the main process behind a narrow IPC contract. The renderer receives only attachment metadata and preview data. Store temporary captures under the app temp directory and clean them after removal or shutdown.
- **Acceptance:** works on mixed-DPI multi-monitor desktops; selection can start on either side of the widget; the captured preview matches the selected pixels; cancellation is lossless; chat layout does not shift; protected/exclusive-fullscreen surfaces produce an explicit error instead of a blank attachment.
- **Risk:** Windows Graphics Capture and DRM-protected surfaces need separate handling; the selection overlay must never remain above the desktop after cancellation or failure.

### Feature: Attach clipboard image

- **Purpose:** one action attaches the current clipboard bitmap without opening a file picker.
- **Acceptance:** deduplicates repeated presses, preserves alpha, uses the same preview/removal UI, and explains when the clipboard has no supported image.

## Epic: Configurable global hotkeys

### Feature: Hotkey settings

- **Purpose:** let the user enable, disable and rebind shortcuts without editing configuration files.
- **Suggested defaults:** `Ctrl+Alt+Space` show/restore or collapse, `Ctrl+Alt+N` create a new session and focus the composer, `Ctrl+Alt+S` capture a screen region.
- **Optional unbound actions:** focus the current chat, cycle Full/Avatar/Edge, open the current session in Harness, switch to the next working agent, show recent replies, cancel the active turn, toggle Game overlay mode.
- **Behavior:** validate conflicts before saving, show registration failures inline, keep shortcuts disabled by default for destructive actions, and unregister everything on quit or when disabled.
- **Architecture:** a main-process shortcut registry owns Electron `globalShortcut`; preferences store action-to-accelerator mappings; renderer settings use a reusable shortcut recorder. Session operations continue through the existing Harness API layer.
- **Acceptance:** shortcuts work while another ordinary app or borderless game is focused; rebinding survives restart; invalid combinations do not replace the last valid mapping; a second widget instance does not double-register shortcuts; uninstall/quit leaves no active registrations.
- **Risk:** some games and anti-cheat systems consume or reject global shortcuts. Registration failure must degrade cleanly without input hooks or privileged drivers.

## Epic: Overlay quality

### Feature: Overlay diagnostics

- **Purpose:** make Game mode verifiable without guessing.
- **Behavior:** an optional diagnostics row reports requested layer, effective always-on-top state, current display, window mode and whether the target foreground window is exclusive fullscreen, borderless or ordinary.
- **Acceptance:** diagnostics contain no session text, file paths or model prompts and can be copied as a small support receipt.

### Feature: Reproducible fullscreen overlay smoke

- **Purpose:** replace subjective “it looks visible” checks with a repeatable borderless-game receipt.
- **Behavior:** sample foreground ownership, game/widget bounds, visibility, cloaking and z-order for 15 seconds while taking three monitor captures. Produce a compact JSON summary and hashes for the evidence files.
- **Acceptance:** the game remains foreground for at least 95% of the passive phase; the widget remains visible, uncloaked and above the game in at least 95% of samples; any disappearance longer than 250 ms fails the run. Exclusive fullscreen is reported as a capability probe, not silently treated as borderless.

### Feature: Per-game overlay profiles

- **Purpose:** remember layer, opacity, size and compact position for selected game executables.
- **Behavior:** profiles are opt-in and local; unmatched apps use the global defaults.
- **Acceptance:** changing the foreground game switches only presentation settings and never changes the selected Harness session or permission preset.

## Epic: Compact productivity

### Feature: Recent-session switcher

- **Purpose:** open the last replies and working agents from Avatar mode without expanding the full deck.
- **Acceptance:** each item shows session name and state, opens the exact session, and remains keyboard accessible.

### Feature: Quiet notifications

- **Purpose:** temporarily mute completion slides and sounds while keeping state changes and unread replies.
- **Acceptance:** supports a timed mute and an until-enabled-again mode, survives restart, and remains visible in compact mode.
