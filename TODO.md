# Product backlog

This backlog records planned work only. Items are not part of the current release until their acceptance checks pass.

## Shipped in 0.5.0

- Region and full-display capture with reviewable PNG attachments, cancellation, cleanup, and configurable hotkeys.
- Rebindable shortcuts for show/collapse, new session, and both capture modes.
- Three-session Avatar switcher with exact-session open and inline quick reply.

## Shipped in 0.6.0

- Authenticated native BridgeHost and UWP Xbox Game Bar companion protocol for pinned fullscreen status and exact-session actions.
- Quiet background update download with digest verification and a header install action only when the release is ready.
- Bounded renderer recovery plus downgrade-safe persistence for settings and independent Full, Avatar, and Edge positions.

## Shipped in 0.6.1

- Compact 2×2 composer controls that preserve the 50 px resting input height.
- Rebindable Focus Chat and Open Harness shortcuts.

## Epic: Desktop capture

### Feature: Attach clipboard image

- **Purpose:** one action attaches the current clipboard bitmap without opening a file picker.
- **Acceptance:** deduplicates repeated presses, preserves alpha, uses the same preview/removal UI, and explains when the clipboard has no supported image.

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

### Feature: Quiet notifications

- **Purpose:** temporarily mute completion slides and sounds while keeping state changes and unread replies.
- **Acceptance:** supports a timed mute and an until-enabled-again mode, survives restart, and remains visible in compact mode.
