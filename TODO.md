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

## Shipped in 0.6.2

- Retried atomic preference writes after transient file-lock failures without discarding the latest settings.
- Cleared stale working state after temporary Harness history failures once the authoritative session state was idle.
- Applied Desktop window layer consistently across Full, Avatar, and Edge modes.
- Added chat-first navigation, state-aware Agents, Focus Chat, a searchable model picker, native slash commands, structured goals, live TODOs, and compact mixed-status tool groups.
- Added authoritative queue Edit/Delete/Send-now behavior with durable steering handoff and no duplicate or ghost requests.
- Added streamed reasoning plus a growing Markdown answer bubble, respectful manual scrolling, and a jump-to-latest action.
- Added compact screen capture, eight rebindable hotkeys, persistent glow/opacity/layer/autostart settings, and independent Full/Orb/Edge placement.
- Added three-session Orb history and reply, exact-session notifications, smoother completion/error states, and reduced-motion-safe mode transitions.
- Fixed the Orb recent-session race so clicking a message reliably restores Full and opens that exact session.
- Added 360 px minimum layouts, smaller horizontal attachment previews, a one-line composer that grows to one third, and current README screenshots/cover.

## Shipped in 0.6.3

- Split live multi-tool turns into named per-call cards and reduced live thinking to one compact line.
- Coalesced drag moves to the display frame rate and polished the Full/Orb/Edge transition spring.
- Repaired background update staging, restart recovery, checksum publication, and legacy Start-at-login cleanup.

## Shipped in 0.6.4

- Mirrored exact Harness `Workspaces` and `Ungrouped` session groups in Agents and Chat, including compact collapse and create-in-group actions; covered by grouping and compact visual regressions.
- Kept jump-to-latest visible whenever manual scroll is away from the bottom; covered by renderer and interaction regressions.
- Restored the compact two-by-two composer with `/` above the paperclip and bounded single-line geometry; covered by contract and visual layout regressions.
- Suppressed the transient stale red Edge state during compact transitions; covered by interaction and Edge-state visual regressions.
- Added a persistent Show live Think preference whose compact overlay preserves the conversation viewport; covered by persistence, IPC, interaction, and visual regressions.
- Loaded complete Harness history through backward pagination with cached sequence deduplication; covered by 160-to-161-message API and renderer regressions.
- Locked Edge dragging to the physical display side, moved compact drag tracking to the native cursor, and added hover/drop spring feedback plus distinct idle and working palettes.
- Preserved workspace/archive projections through transient refresh failures and kept acknowledged command failures from returning to compact error state.
- Added native `Ctrl+V` file/image preparation, content-deduplicated clipboard bitmaps, and compact sent image/file/video previews, including attachment-only messages.
- Made a successful queued-message checkmark leave edit mode even across an authoritative snapshot race, while failed saves remain open for retry.

## Shipped in 0.6.5

- Restored the ability to move the Edge line to the opposite screen edge: the side now follows the pointer instead of x being frozen for the drag, so crossing the middle of the display moves the line across and another monitor is reachable; covered by geometry and IPC regressions.
- Removed the Avatar-mode jump when quick reply opens by waiting for the native orb resize before easing the panel in, with a bounded fallback so a hung IPC cannot leave the orb blank; covered by renderer and visual regressions.

## Shipped in 0.6.6

- Merged Harness skills into the `/` menu from `skill.list`, badged as `skill` and sent as prompts rather than host commands; covered by API and contract regressions.
- Added live elapsed turn time and last-turn duration to session cards and the session picker, derived from turn events so it survives a restart; covered by activity, API and visual regressions.
- Made Avatar mode collapsed by default with a working-agent count on its expand button, plus an opt-in **Expand avatar on activity** preference; covered by persistence, contract and two new visual regressions.
- Stopped a single unhealthy dashboard poll from clearing the selected session and its transcript, remembered the user's choice across the outage, and dropped the shared dashboard cache whenever the session set changes; covered by contract and controller regressions.
- Made session enrichment degrade per session instead of taking the whole dashboard offline, and stopped an empty history answer from blanking and caching over a conversation; covered by API regressions.
- Widened the live-activity preference from `thinking` to the whole live-status strip, made it repaint compact chrome, and gave the overlay its own opaque layer; covered by contract, two visual regressions and the input regression.
- Forwarded the mouse through the transparent parts of both compact windows, restricted Avatar dragging to the circle, and moved side snapping and clamping onto the visible element so it can reach both screen edges; covered by geometry, hit-tracker and visual regressions.

## Shipped in 0.6.7

- Replaced the `N subagents` roster size on session cards with a badge counting only the background tasks running right now, hidden entirely at zero; covered by contract and visual regressions.

## Shipped in 0.6.8

- Previewed a queued file attachment by its name instead of its absolute path, while keeping the full path in the editable text; verified live against Harness with the new `npm run queue-smoke` and covered by queue-view regressions.

## Known gaps at 0.6.7

- **The animation and accessibility audit did not complete.** Three attempts stalled on
  infrastructure, so the CSS animation system had no systematic review this cycle — only the
  surfaces touched by these fixes. Worth re-running before the next release. The open
  questions were: transitions declared on elements that are toggled with `display:none` and
  therefore snap; `infinite` animations on always-present nodes; the same property animated
  by two rules with different durations, so the timing depends on cascade order; and contrast
  on the 8–9 px muted greys.
- **`forgetSession` is dead code.** `harness-api.cjs` exposes it and nothing in `src/` calls
  it, so `fullAccessSessions`, `sessionStateCache` and `historyCache` retain archived and
  deleted sessions for the life of the process. Harmless at current sizes, but it is a leak
  with a name that promises otherwise.
- **Sessions ranked past 18 are never enriched**, so they carry an empty preview and a
  default `idle` state — losing a real `error` — and `recentReplySessions` skips them
  entirely, so such a session can never reach the Avatar reply list even when it is the most
  recently updated one.

## Known gaps at 0.6.5

Recorded rather than quietly dropped. None of these block the release; all of them are
things a reader of the verification folder would otherwise have to infer.

- **No multi-tool parity receipt on Qwen 3.8 27B.** Two attempts failed for infrastructure
  reasons and both are kept: `qwen3.8-27b-multi-tool-parity-v064-failed-load.json` records
  LM Studio returning `Engine protocol startup was aborted`, and a later retry found the
  GPU already committed to another model with 683 MB free. The multi-tool path *is*
  verified live on Ling 3.0 Tiny (`ling-3.0-tiny-multi-tool-parity-v064.json` — 3/3 tool
  calls, 3/3 results, clean turn end), and the 27B has a passing dynamic-MCP receipt
  (`qwen3.8-27b-dynamic-mcp-v064.json`). What is missing is only the 27B *multi-tool*
  receipt. Re-run `npm run parity-smoke` once the 27B can be loaded.
  - Practical note: LM Studio defaults to 111 parallel slots and sizes a per-slot cache,
    which can claim the whole 24 GB card and is what blocked the retry. Load with
    `--parallel 1`.
  - Qwen 3.5 4B MTP was tried as a stand-in and is **not a substitute**: **one run in three
    passed**. The passing run made the expected three calls and emitted the completion
    marker. The other two looped on `grep` — one to the 100-call cap, one stopping at 79,
    so it is not merely a cap artifact — and neither emitted the marker. The recorded
    receipt is one of the failures, `qwen3.5-4b-mtp-multi-tool-parity-v064-no-marker.json`.
    Tool *parity* held in every run — calls and results matched exactly, zero errors,
    `runningAfterTurn` false, no lingering activity — so the widget's transport and live
    rendering are fine and the instability is the 4B model's planning. Re-running until one
    came back green would have been cherry-picking.
- **Live update flow has not been walked end to end by a human on this machine.** Staging,
  digest verification and restart survival are covered by
  `test/update-orchestrator.test.cjs` and `test/portable-update-stage.test.cjs`, and
  `scripts/verify-release-artifacts.cjs` checks the published payload on both sides of
  checksum creation — but pressing Update on an installed build and watching it restart is
  still a manual step.
- **The portable build reuses its temp extraction directory.** A relaunch after replacing
  the exe can silently keep running the previous build; confirming a version means checking
  the unpacked `app.asar`, not the file timestamps. Worth automating before the next
  release.

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

### Feature: Voice input after Harness audio support

- **Purpose:** record a short voice prompt directly into the composer when the installed Harness message schema exposes a supported audio content block.
- **Current gate:** Harness 0.1.1-rc.2 exposes text, image and file-reference content but no audio input block, so 0.6.4 intentionally does not record or silently transcribe microphone data through an unrelated provider.
- **Acceptance:** recording is opt-in, visibly bounded, reviewable before send, cancellable without leaving a file, and covered by the same attachment/privacy limits as images.

### Feature: Quiet notifications

- **Purpose:** temporarily mute completion slides and sounds while keeping state changes and unread replies.
- **Acceptance:** supports a timed mute and an until-enabled-again mode, survives restart, and remains visible in compact mode.
