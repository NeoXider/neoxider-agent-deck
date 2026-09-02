# Changelog

All notable changes to NeoXider Agent Deck are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.0] - 2026-09-02

### Fixed

- **The log is no longer rebuilt on every change.** Each poll while a tool ran, each result that landed, each message that arrived threw the whole transcript away and built it again. Every bubble was a new node: entry animations replayed on bubbles that had been there for minutes, images reloaded, an open tool card had to be re-found by key, and a text selection had to be captured and re-resolved by character offset. The transcript is keyed now — a block whose content did not change keeps the very node it had, and only what is new or different is built, patched into place around everything else. Nothing that did not change moves.

- **The finished answer no longer reflows.** The bubble that streamed the answer was plain text, and the finished message came back from history as Markdown, so every turn ended with a minute's worth of reading being re-set into headings, lists and code — and for one frame drawn twice, as the stream and the message it had become. The answer is formatted *while it streams*, through the same sanitizer that renders history, one request in flight at a time and only the newest text allowed to land; the caret sits inside the last line rather than under it. When the message lands, the bubble that streamed it simply becomes it.

- **The strips around the log no longer pop.** The activity card above the conversation and the plan, queue, attachments, command palette, error and goal strips below it appeared and vanished in one frame, and the log jumped by their height each time. Each one now eases its height open and shut, and a log that was following the conversation keeps following it on every frame of the move — re-anchored after layout and before paint, so there is no frame in which the last line is cut off. The same anchor holds through a window resize and the size presets.

- **Choosing a session no longer claims it is empty.** Between the pick and the history arriving, the log said "Write a message to start this session" — a wrong claim for a moment, then a jump when the real messages landed. It shows three quiet placeholder bubbles now, and the empty state only once Harness has actually said so.

### Added

- **Copy and reuse on every message.** Hover or focus a bubble and a column of glyphs appears beside it, in the room its width limit leaves, never over the text: **Copy** on every message, and on your own also **Reuse**, which puts the message back in the composer to be sent again or changed. A one-line toast over the foot of the log confirms it — the same toast now answers a goal paused, resumed or cleared and a queued message sent now, edited or removed.

- **The composer remembers.** Half-written text follows its session: switch away and back through the picker and it is where you left it. From an empty composer the **arrow keys** walk back through what was sent in that session, the way a shell recalls its history — only from an empty composer, so a message being written keeps its arrows, and only from the first or last line of a recalled message, so a multi-line recall can still be edited with the keyboard.

- **More of the interface answers you, and the switch still takes all of it off.** A slow aurora in the widget's own colours drifts behind everything, follows the glow slider and brightens a little while the agent works; the active tab is one plate that slides rather than two that swap; the plane leaves the Send button with the message; the context ring is drawn in both accent colours and beats when it turns critical; a working session card carries a slow sweep of light and every card lifts under the pointer; a new message slides into the log; tool cards, the activity card and the goal panel open like drawers rather than snapping; settings rows arrive one after another. All of it is animation or transition, and **Settings → Motion effects** turns both off wholesale — the widget stays the same, simply still.

## [0.6.18] - 2026-08-31

### Changed

- **Pause and resume moved onto the goal strip, as the glyph alone.** It was a 26-pixel button behind a click, inside the opened panel, wearing more frame than glyph. It is now the first thing on the strip itself — always one press away, no ring, no plate, no label: two bars while the goal runs, a play arrow while it is paused, and the press does not also open the panel. The panel's own Edit and Delete lost their frames the same way, so the icon is what you see and the box is only what you press.

- **The strip is smaller and the bar inside it is bigger.** The rail that carries the round count is the part worth seeing, so it is three times its old thickness, while the container around it — height, padding, gaps — is down to 16 pixels of strip.

- **A queued row starts where its text starts, and a tool card is one line of box.** The queue position was a badge in a circle that ate the left edge of every row; it is a plain number now, and the row is tighter around it. Collapsed tool calls and tool groups each lost four pixels of header and some padding, which is several lines of conversation back over a long turn.

### Added

- **Motion, and a switch to turn it off.** The widget says what it is doing with movement: the goal rail flows while the loop runs and goes still and amber when it is paused, the pause glyph breathes, a running tool group pulses on its own icon, the composer answers focus, and controls answer a press. All of it sits on surfaces that carry state and never under the text, so nothing moves while you read. **Settings → Motion effects** takes the whole lot off in one click and persists like every other preference; the jump-to-message pulse keeps a still form of itself, because that one is a signal rather than decoration.

### Fixed

- **A third of the visual suite could only ever run on a 100%-scaled display.** A case asks for an exact window size and is compared against exact pixels, but on a scaled display the window came back wider than it asked for and the capture came back magnified, so every case below 423 pixels — and the cover renderer — aborted before it could assert anything. The device scale is pinned for captures now (the widget itself still follows the display), and with the suite actually running end to end it immediately paid for itself: it caught a real clipping bug and two expectations that had gone stale unnoticed.

- **At 360x360 with everything open, the composer was pushed off the bottom edge.** With the activity card, the plan, the queue and attachments all showing, the stack stood six pixels taller than the panel. The gaps between those strips pay for it — each already carries its own border — so the log keeps its floor and no control shrinks.

- **Two smoke expectations that had quietly gone stale** while their cases could not run: a queued row has carried four actions since the expand chevron landed in 0.6.13, not three, and the 360-wide update case was still asserting a version from 0.6.9.

- **The contract tests no longer depend on how the tree was checked out.** `core.autocrlf` hands the sources back with CRLF on a fresh clone, and several assertions match across a line break, so they failed on a clean checkout and passed only after an edit rewrote the file. They normalize line endings on read now.

## [0.6.17] - 2026-08-31

### Changed

- **The goal strip spends its space on the bar, not on a frame.** It is 18 pixels now, with no border or box of its own, and the rounds rail is three times thicker — a real bar rather than a hairline. The fill flows while the goal runs, a slow gradient that says the loop is alive without moving anything on screen, and it stops dead and turns amber the moment the goal is paused. A goal with no round cap flows along the whole rail instead of leaving an empty one. The chevron is a control you can hit, and inside the panel the pencil and the trash are 29 pixels with the glyph filling them — while **Pause/Resume**, the one control pressed mid-run, is wide and says which it is.

- **Queued rows and tool headers were mostly padding.** A queued message is one line of text and three buttons in a 34-pixel row; it is 28 now, and its actions 24. A tool header is one line too — the single call drops from 36 pixels to 29 and the group header from 39 to 31 — so a turn full of tool calls shows more of itself in the same log. Nothing about opening them changed: a queued row still prints its command whole, and its editor still grows with the text to a ceiling and then scrolls.

## [0.6.16] - 2026-08-31

### Changed

- **The goal is a hairline strip under the composer.** Above the chat it was in the wrong place twice over. Collapsed, it still printed the objective — which is the expanded view of a one-line dock, not the collapsed one. And it sat directly under the activity block, which appears, grows and disappears on every turn, so the goal was shoved up and down the whole time you were reading.

  It now lives below the input, where nothing above it can move it. Collapsed it is 20 pixels carrying no text at all: the orb, a rail of rounds against the goal's cap, and the counter — the objective itself is on the tooltip. Opening it lifts a panel with the objective, the round count and the controls, while the strip stays welded to the bottom edge, so the line you press never moves under your cursor. The full text is read and rewritten behind the pencil, where an editor has the room for it. Pausing turns the orb and the rail amber and swaps the glyph to a pause, so the state reads without a word on the strip.

### Fixed

- **Pressing a mark on the scroll rail often did nothing.** Every repaint of the log writes back the scroll offset it captured before rebuilding — and while the agent is answering, the live stream repaints on every poll. A press captured mid-jump was therefore restored to where the jump started, and writing `scrollTop` also cancels a smooth scroll in flight, so the further the target, the more reliably the press was thrown away. A press now pins the message it asked for: for a short window the repaints re-resolve that message and land on it instead of on a stale offset, and the pin lets go the moment you scroll for yourself. The pulse that says "this one" is re-applied by index too, so a repaint landing mid-flash no longer swallows it.

- **The jump-to-latest pill covered the last marks on the rail.** It is drawn above the rail and overlapped its bottom ~34 pixels, so presses meant for the last few messages hit "Latest" and went to the end of the log instead. The pill now steps aside whenever the rail has marks.

- **A 3-pixel tick was a 3-pixel target.** The mark is still drawn as a 3-pixel tick, but the button now carries 11 pixels of transparent hit area around it, so the press lands where the hover tooltip promised.

## [0.6.15] - 2026-08-31

### Added

- **The goal has its own dock above the chat.** It lived only as a `/goal` card inline in the log, so it scrolled off and was "not always visible". It is a live projection, so it now sits in a persistent strip above the conversation: collapsed to one line — the objective, an active/paused chip, a chevron — and expanded to the full objective with the round count and the same controls a queued message has: **Edit** (an inline growing editor), **Pause/Resume**, and **Delete**. Every control is a `/goal` subcommand over the command path — edit, pause, resume, clear — so Harness stays the one owner of goal state. Delete takes a second press to confirm, since clearing the goal removes the projection with it.

### Fixed

- **The message marks did not always scroll when clicked.** Each mark held a reference to its bubble, but the 2.5-second dashboard poll rebuilds the whole message log, so moments later that bubble was a detached node and `scrollIntoView` on it did nothing. A mark now stores its message's index and resolves the live bubble at click time, so it cannot go stale. This is also what made a mark feel like it pointed at a tool call: it pointed at nothing.

- **The scroll magnet pulled the view off the top of the log (regression in 0.6.14).** The magnet was CSS `scroll-snap`, and proximity snap pulled the scroll down to the first user message even at the very top, hiding the agent's opening reply, and it fought a deliberate drag. It is a guarded JS pull now: it eases a user message flush only once the scroll settles with one already close to the top, never at the top itself, never while the log follows a running turn, and only within a small pull distance — so ordinary scrolling is untouched.

### Note

- Verified that no tool calls are counted as message marks: the marks are exactly the `.bubble.user` elements, and the history parser only ever gives `role: "user"` to real user messages and typed slash commands — checked against a live 76-message session where every mark was a genuine message.

## [0.6.14] - 2026-08-31

### Added

- **Your own messages are marked on the scroll rail, and the scroll settles on them.** Getting back to what you asked meant dragging through everything the agent said in between, and in a long turn that is most of the log. A rail beside the scrollbar now carries one mark per message you wrote; clicking it jumps there and pulses the bubble, because the rail lands you in the middle of a conversation where one bubble looks like another.

  Marks are placed against `scrollHeight`, so a mark means what the scrollbar next to it means rather than approximating it, and the rail sits in the gutter beside the scrollbar instead of over it — dragging the scrollbar still works, and no mark covers a bubble.

  The magnet is `scroll-snap-type: y proximity` on your messages: free scrolling is unchanged and the pull only happens when the scroll ends near one of them. It is deliberately off while the log is pinned to a running turn, where content grows under the scroller on every repaint and snapping would fight it — it comes on once you have scrolled away to read, which is when landing squarely on your own message is the thing you were trying to do.

## [0.6.13] - 2026-08-31

### Changed

- **A queued message can be read and corrected in full.** A queued prompt is regularly a background job whose shell command runs several times longer than the row that held it — one 8px line, cut with an ellipsis, and the pencil opened a single-line input over the same text. Neither could show the command, let alone let anyone correct it.

  A row now opens: the text prints whole, wrapped, a size up, selectable, with its own line breaks kept. Editing is a textarea that grows with its content to a ceiling and then scrolls, so a pasted script cannot push the composer off the panel; Enter still saves and Shift+Enter is the newline, matching the composer.

  The room comes from the queue dock, which already sits between the conversation and the composer and takes it back the moment the row closes. Nothing is placed in the conversation and nothing floats over it — an overlay was exactly what 0.6.10 removed. The visual case asserts the opened text is neither clipped nor ellipsised and that the dock never reaches the composer.

## [0.6.12] - 2026-08-30

### Fixed

- **A rejected message never said why it was rejected.** A failed send wrote its reason into the shared activity block on a 3.2 second timer, and while a turn was running the 2.5 second dashboard poll overwrote that block with the turn's own status sooner still. So the message and its attachments stayed in the composer, the send button went back to normal, and nothing on screen said what had happened — the reported symptom was simply "it does not send".

  The composer has its own failure surface now, directly above it, carrying the reason Harness gave. Nothing polls it: it stays until the user dismisses it, until a send gets through, or until they leave the session whose composer content it belongs to. The reason wraps to two lines rather than ellipsising, because a message cut off at "switch to a mo…" is the same as no message; two lines is the ceiling so a long failure cannot push the composer off screen. The avatar is deliberately not turned red — a running turn is not in error because a send was rejected.

  The orb's quick reply already had a persistent feedback field of its own; this brings the main composer level with it.

### Notes

- Harness, not the widget, decides that a model cannot accept images. The widget sends image content as `{ type: "image", mediaType, data, name }`, the same shape Harness uses in its own history blocks, and the model catalog Harness returns carries only `id`, `name` and `reasoning` — no vision capability to check or act on. When Harness answers "The current model does not support images", the widget's job is to show that verdict rather than swallow it, which is what this release does.

## [0.6.11] - 2026-08-30

### Added

- **Chat says how long the turn has been running, and what is running under it.** Elapsed turn time and the count of active background tasks were built for the session cards in Agents, so the panel a user actually watches during a turn could report neither: a model twenty minutes into a long turn looked exactly like one that had just started, and subagents working underneath it were invisible unless you switched tabs. Both now sit in the live activity block, beside the reasoning line.

  They reuse the card helpers rather than a second implementation, so "background task" keeps one definition — children running *right now*, not the roster — and the clock joins the single one-second tick shared by the whole app instead of adding another. The clock is written straight into its node and stays out of the block's render signature, so a value that changes every second cannot rebuild the block every second. It also updates ahead of the unchanged-signature early return, because a turn whose label never changes still has to advance its clock and notice background tasks starting and finishing.

### Fixed

- `sessionAgentState` assumed it would always be handed a real session and read `.state` off it directly. Chat can be open with no session selected, so the new clock could call it with nothing; it is null-safe now. Every other caller holds a session from the dashboard list and is unaffected.

## [0.6.10] - 2026-08-30

### Fixed

- **The live Think status covered the top of the conversation.** Reasoning was the one activity kind that did not use the status card above the chat: it got a strip of its own, absolutely positioned inside the message wrapper, and the room for it was reserved with `padding-top` on the scroll container. That padding belongs to the scrolled content, so it slid away with the first message — from then on the strip was painted over whatever row happened to be at the top of the log, and the widget showed two blocks of text stacked in the same place. Making the strip opaque in 0.6.9 only made the covering solid.

  There is one activity block now. Thinking renders in the same card as working, tool and writing, in normal flow above the chat, so it cannot reach the conversation at all — and it keeps the expander the strip had to hide, so the full reasoning text is one click away. **Show live activity** in settings still switches the whole block off.

## [0.6.9] - 2026-08-29

### Fixed

- **The portable build never cleaned up after itself.** It unpacks into a fresh `%TEMP%` directory on every launch and left the previous one behind forever — on one machine that had reached 27 GB across 75 directories, roughly 100–350 MB per release kept indefinitely with nothing in the product ever looking at them again. The launcher stub is electron-builder's and cannot be changed, so the app it starts now collects them, including directories left by the pre-rename `DeepSeek Harness Widget` build.

  The whole risk is deleting the wrong directory, so the rules are narrow and each one is asserted: a candidate must sit directly in the temp root, carry an executable named for this product, *and* carry `resources/app.asar`; the directory the running process was unpacked into is never a candidate; a directory still held by another running copy is skipped and collected on a later launch; and each launch removes a bounded number so startup cannot stall.

## [0.6.8] - 2026-08-29

### Fixed

- **A queued document filled its row with an absolute path.** A file attachment travels to Harness as an `@C:\Users\…\report.pdf` reference inside the message text, so a message queued behind a running turn spent its whole one-line row on a path and was still cut off before the file name — the only part worth reading. The preview now shows the name; the editable text keeps the real path, because saving a shortened one would hand Harness a reference it cannot resolve.

### Internal

- Added `npm run queue-smoke`, which drives a real Harness end to end: it opens a turn, sends text, an image-only message and a document behind it, and reads the queue off the same event multiplexer the widget listens on, through the same two functions the widget renders from. Queuing an attachment crosses four places where it could be lost — the prompt encoder, the multiplexer, `queue-view.cjs` and the placement filter in `stream-publisher.cjs` — and no unit test spans them.

## [0.6.7] - 2026-08-29

### Changed

- **Background tasks are a count of what is running, not a roster size.** A session card spelled out `2 subagents` — the number of children Harness had ever started under it, finished ones included — which spent most of a narrow card's width on something that was often no longer true. It is now one badge showing how many background tasks are working right now, and nothing at all when none are. The count feeds the render signature, so a task starting or finishing repaints the list; `counts()`, a helper that computed the same thing and was called from nowhere, has been removed.

## [0.6.6] - 2026-08-29

### Added

- **Harness skills in the `/` menu.** Harness feeds its own slash menu from two sources; the widget read only `commands/list`, so a skill installed in the workspace appeared in Harness and was missing here. The catalog now merges `skill.list` as well, badges each entry as `skill`, refuses to let a skill shadow a host command of the same name, and marks skills the model cannot start itself as *User only*. Picking one inserts `/name ` and sends it as an ordinary prompt, because a skill is invoked by the model rather than executed by the host — routing it through `commands/execute` would be rejected as an unknown command. A Harness build without the skill plugin answers "not found" and still returns its commands.
- **Elapsed turn time in the session list.** Every session card and picker entry shows how long the agent has been on the current turn, ticking once a second, and how long the last completed turn took. The value is derived from the turn's own `turn/start` and `turn/end` events rather than timed in the widget, so it is already correct for a session that was running before the widget opened and survives a restart. The clock is written straight into the node and deliberately kept out of every render signature, so it cannot rebuild the list once a second, and the interval stops when nothing is running.
- **Expand avatar on activity** — a settings toggle, off by default, that restores the previous behaviour of opening the status panel by itself.

### Changed

- **Avatar mode is collapsed until you open it.** Activity, a finished turn and even an offline Harness used to widen the orb to 400 px on their own, putting a panel over the screen without being asked. The collapsed orb is now a circle plus an expand button carrying a count of the agents currently working; the panel opens on request.
- **Show live Think became Show live activity**, and now governs the whole live-status strip rather than the single word "thinking".

### Fixed

- **The session and its conversation disappeared on their own.** A single unhealthy dashboard poll — a Harness restart, an 8 s RPC timeout, a laptop waking up — answers `{harness:false, sessions:[]}`, and that was treated as authoritative: the selection was dropped, the chat re-rendered empty, and the next healthy poll re-selected whichever session happened to be running. A one-second blip left the user reading a different conversation, with no way back. A session is now only given up on after a *healthy* dashboard has failed to mention it twice in a row, auto-selection never runs against an offline dashboard, and the previous choice is remembered so recovery restores it instead of guessing.
- **A newly created session could become unreachable.** Creating a session and refreshing immediately hit the one-second shared dashboard cache and was served the snapshot from before it existed; because a blank, unselected session is hidden from every group, it then vanished from the UI entirely. Anything that changes the session set now drops that cache first.
- **One malformed session took the whole dashboard offline.** Only the two enrichment RPCs were guarded, so a throw from any of the history readers rejected the shared `Promise.all` and produced the empty payload above — every session on screen disappeared at once. Enrichment is now per session and degrades alone, carrying the reason.
- **An empty history answer could blank a conversation and cache the blank.** When the newest page reported no more data its contents replaced the cached transcript outright, so a restart that answered with nothing wiped the chat and stored the empty result as complete. The cache is now a floor against emptiness specifically; `/compact` still legitimately shrinks a history.
- **Turning off live Think left "Working" above the conversation.** Only `kind === "thinking"` was gated. Every tool result clears the activity and a `working` fallback takes its place, so the card came back a second after being switched off. The preference now covers thinking, writing, tool and working, and flipping it repaints the compact chrome too — previously it did nothing at all while the widget was collapsed.
- **The live Think overlay blended into the chat.** It inherited the activity card's translucent gradient, so the conversation showed straight through it. It now floats on its own opaque layer with a border, shadow and blur, and eases in from the top edge.
- **The avatar occupied a huge invisible click target.** A 172 × 128 transparent window — up to 460 × 158 with the panel open — sat over the desktop for a 68 px circle, swallowing clicks and starting a drag anywhere inside it. Both compact windows now forward the mouse through their empty space: the renderer measures its live controls and only those rectangles take input. Avatar mode is dragged by the circle alone.
- **The avatar jumped sideways after a drag, and could leave the screen.** The docked side was decided from the window's centre, but with the panel open the circle sits up to 300 px away from it — so a drag that plainly ended on one side snapped back to the other. Placement is now measured on the visible element throughout: the side follows the circle, clamping uses the live window size instead of the size captured when the drag began, and the transparent margin may hang off the screen while the visible part may not.
- **The avatar and the edge line could not reach the top or bottom of the screen.** Clamping the whole window to the work area stopped the visible circle 30 px short at each end and the line 28 px short. Both can now be parked flush against either edge.

### Internal

- Compact placement moved out of `applyWindowMode` into `compact-window.cjs`, so the orb and edge branches share one set of rules; `session-activity.cjs` now owns turn and activity derivation, keeping `harness-api.cjs` a transport.
- Six tests that could not fail were replaced rather than deleted: the fire-and-forget sender guard now observes the absence of effects instead of the absence of a throw (seven of eight handlers complete without throwing anyway); two `doesNotMatch` guards were measured against character budgets their functions had already outgrown; the show-acknowledgement ordering check passed on a missing needle; the preference round-trip built its expectation with the same normalizer it was testing; and the release-artifact loop silently swapped one assertion for an unrelated one.

## [0.6.5] - 2026-08-29

### Fixed

- **The Edge line could not be moved to the other side of the screen.** The 0.6.4 fix for cumulative rightward drift froze the window's horizontal position for the whole drag, which stopped the drift but also meant the line could only ever slide up and down the side it started on. Edge drags now follow the pointer: the line stays flush against a screen edge while the side is re-derived from the cursor on every move, so crossing the middle of the display moves it across immediately, and dragging onto another monitor lands it there. Because the position is derived from the pointer rather than accumulated, the drift has nothing to build up from.
- **Pressing the chat button in Avatar mode made the interface jump.** Opening quick reply resizes the native orb window from 172 px to 460 px in the main process, but the DOM had already switched to the wide layout — so for a few frames it was laid out inside the narrow window and then snapped. The panel now waits for the resize to be acknowledged and eases in at the correct size, with a bounded fallback so a hung or stubbed IPC shows the panel anyway instead of leaving a blank orb.

## [0.6.4] - 2026-08-28

### Added

- Agents and Chat now mirror exact Harness `Workspaces` membership plus `Ungrouped`, with one-line collapsible group headings and a compact action to create a session inside any group.
- Settings now persist a **Show live Think** toggle; disabling it hides the reasoning overlay without hiding writing or tool status.
- `Ctrl+V` now adds copied files and pathless clipboard images to the existing reviewable attachment strip; sent user bubbles retain tiny safe image previews or compact file/video chips.

### Changed

- The compact composer keeps its actions in two vertical pairs, places `/` above the paperclip, and trims the Send button's vertical footprint without narrowing the message field.
- Idle Edge keeps a calm cyan-green shimmer, while active work switches to a faster green-yellow energy pass; hover and drag release use a bounded spring and bloom.
- The full-chat mascot aura is wider and brighter while remaining circular and inside its 44 px hit target.

### Fixed

- The jump-to-latest control remains visible whenever the user has scrolled away from the bottom, even when no unseen message has arrived yet.
- Compact transitions no longer expose a transient stale red Edge state before returning to the neutral cyan-green line.
- Appearing, streaming, and disappearing Think text no longer changes the conversation viewport or its manual scroll position.
- Long sessions now follow Harness `hasMore` / `beforeSeq` pagination to the first event instead of silently stopping at the latest 80 messages; older pages are cached and deduplicated by sequence.
- Avatar and Edge drag use the native desktop cursor, and Edge remains locked to its physical screen side, eliminating cumulative rightward drift and off-screen movement.
- A transient workspace refresh no longer drops folders or resurrects archived sessions, and viewed command errors no longer repaint the compact handle red.
- Saving a queued-message edit now always closes the editor after success, including when a newer authoritative queue snapshot arrives during the request; failed saves remain editable for retry.
- The IPC parity check matched `invoke` and `send` but not `sendSync`, so it reported the privileged `register-selected-file` channel as orphaned while the preload was calling it — a blind spot on precisely the synchronous channels that check exists to watch.
- The release-artifact test built an absolute temp path, which passed on Windows and turned the platform matrix red on macOS and Linux: simulated POSIX rules do not treat a drive letter as absolute, so the verifier resolved `C:\repo\C:\Users\...`. The test now uses a working-directory-relative path that resolves identically under both rule sets. `verifyReleaseArtifacts` was correct and is unchanged.
- The first-visible input regression asserted that an entry animation always plays, which failed the Windows release runner because it reports `prefers-reduced-motion: reduce` and `playFirstVisibleEntry` correctly declines to animate. The check now reads the reduced-motion state from the same page and only requires an animation where one is meant to happen; the invariant it exists for — that nothing animates before the native show acknowledgement — is asserted unconditionally and held on CI all along.

## [0.6.3] - 2026-08-28

### Changed

- Thinking is now a single collapsed one-line hint while the growing Markdown answer remains the primary live surface.
- Edge, Orb, and Full transitions use a softer GPU-friendly spring with staged Full-mode content entry.
- High-frequency Full and compact dragging is coalesced to one native window move per animation frame.

### Fixed

- Live Harness tool calls and results refresh into separate named cards as they happen instead of growing one ambiguous assistant bubble across multiple tools.
- Mixed tool groups keep only the failed row red and summarize the successful and failed tools independently.
- Manual and scheduled update checks now share one background check/download pipeline; a verified portable update survives restart and appears as **Update** only when its exact version, size, and SHA-256 match the live release.
- The release checksum manifest no longer hashes itself and is verified before publication.
- Enabling Start at login removes a competing legacy widget entry after the current NeoXider target has been verified, preventing an old build from returning after reboot.

## [0.6.2] - 2026-08-28

### Added

- Chat-first navigation with a state-aware Agents page, one-tap Focus Chat, a searchable Harness model picker, and a complete empty-session state.
- Native Harness slash-command palette above the composer, structured `/goal` output, `/plan` image forwarding, and compact live TODO rendering.
- Authoritative one-line queue cards with Edit, Delete, and Send now actions; Send now interrupts the previous live bubble without duplicating the request.
- Live growing assistant Markdown bubbles, ephemeral streamed reasoning, grouped tool activity, per-tool mixed-success states, syntax highlighting, and a jump-to-latest control that respects manual scrolling.
- Three-session Orb history with exact-session open and inline reply, animated session notifications, and distinct smooth state palettes for Orb and Edge modes.
- Screen-region and display capture with reviewed attachment previews plus eight configurable, persistent global shortcuts.
- Adjustable chat glow, independent persisted Full/Orb/Edge positions, a 360 px minimum layout, and an isolated user-data override for repeatable interactive acceptance runs.

### Changed

- The compact composer is one line by default, grows only to one third of the chat, then scrolls; context and expand controls form one vertical pair while attachment and command controls form the other.
- Attachment previews are smaller and horizontal, Send is more compact, the full-size avatar no longer sits on a rectangular plate, and the titlebar drag surface no longer selects text or steals control clicks.
- Settings, command, queue, TODO, model, update, offline, and compact-mode transitions now use the same reduced-motion-safe spring language.
- README previews and the cover now show the current Full, Focus, Orb, and Edge experience.

### Fixed

- Transient settings-file locks retain the latest preferences and retry the atomic write instead of silently losing the change.
- A temporary Harness history failure no longer leaves a finished session cached as working.
- Desktop window layer now stays below ordinary windows in Full, Avatar, and Edge modes.
- Start at login, opacity, glow, hotkeys, window layer, size, and all per-mode bounds survive restart without resetting one another.
- Stable polling no longer rebuilds unchanged DOM, moves the window, changes focus, forces chat scroll, or causes the periodic UI twitch.
- Completed turns clear Stop and live activity from authoritative turn events; a late cancel response cannot hide a newer running turn.
- Steering handoff is retired by its durable Harness message id, so a late queue RPC cannot resurrect a ghost bubble.
- Opening a non-selected recent Orb session now completes the Full transition before loading its history, so the compact resize acknowledgement cannot cancel the restore animation.
- Live TODO state survives consecutive stale dashboard polls while newer projection fields remain intact.
- A failed tool colors only that tool; a mixed tool group remains a mixed warning instead of falsely marking every call failed.
- Slash commands are validated against the live catalog, unknown commands never leak into a model prompt, and successfully submitted images are removed by exact path only.
- Widget-created and widget-prompted sessions consistently enforce exact `danger-full-access` without exposing unsafe permission alternatives.
- Offline state is shown once with a guarded Start action, and intentional tray Quit cannot be mistaken for a crash and restarted.

## [0.6.1] - 2026-08-27

### Added

- Rebindable global shortcuts for toggling Focus Chat and opening DeepSeek Harness.

### Fixed

- The four compact composer controls are a space-saving 2×2 grid again instead of stretching across the input row.
- The restored two-row controls stay within the same 50 px resting composer height at 360–420 px window widths.

## [0.6.0] - 2026-08-27

### Added

- A native Windows BridgeHost and UWP Xbox Game Bar companion contract for pinned fullscreen status, acknowledge, exact-session open, and Full-access quick reply.
- Strict versioned JSONL framing, exact AppContainer authentication, bounded queues, reconnect generations, and redacted three-session snapshots.
- A compact header **Update** action that appears only after a release has been fully downloaded and verified.

### Changed

- Supported builds now check and stage stable updates quietly in the background; installation and restart always remain user-triggered.
- Windows packages include the trimmed self-contained BridgeHost and verify its exact packaged path during launch smoke.
- Game Bar state and the desktop renderer share one coalesced dashboard read instead of running duplicate polling loops.
- README screenshots and cover now show the current full, compact, edge, update, and empty-session context states.

### Fixed

- The context ring remains visible at `0%` before any Harness session exists.
- Renderer recovery is bounded across crashes, failed loads, and unresponsive windows without resurrecting an intentional tray quit.
- Settings from a newer schema, autostart intent, opacity, glow, size, layer, hotkeys, and independent Full/Avatar/Edge positions survive restart without downgrade loss.
- Windows BridgeHost resolution now uses Windows path semantics even when the cross-platform suite runs on macOS or Linux.

## [0.5.2] - 2026-08-27

### Fixed

- The one-command Windows installer explicitly loads `System.Net.Http`, so it works in a clean Windows PowerShell 5.1 process.
- Successful HTTP response objects and their temporary signed download addresses no longer leak into installer output.

## [0.5.1] - 2026-08-27

### Fixed

- Portable Windows installs now migrate an enabled current-name startup entry to the new executable path even when Electron omits that raw Registry entry from `launchItems`.
- Packaged builds no longer load the source-only screenshot harness during normal startup, and Windows packaging now fails unless the finished application reaches a ready renderer.

## [0.5.0] - 2026-08-27

### Added

- Region and full-display screenshot capture with reviewable chat attachments.
- Six configurable global hotkeys with conflict validation, disable/reset controls, and persistence.
- Managed installer/AppImage updates plus a digest-verified atomic updater for Windows portable builds.
- A Start Harness action in the single offline banner and exact-session Harness deep links.
- Empty-session context now remains as a calm accessible `0%` ring instead of leaving a visual hole.

### Changed

- Chat is the first surface; compact Avatar mode exposes the three latest session replies and inline reply actions.
- Header, composer, model picker, settings, Markdown palette, tool groups, attachment previews, and Edge/Avatar glow were tightened for 360–420 px layouts.
- Full, Avatar, and Edge positions, opacity, glow, size, layer, hotkeys, and autostart are restored independently across restarts.
- Release publication now uses a least-privilege draft gate and verifies the complete cross-platform artifact set before making a release public.

### Fixed

- Session switching can no longer apply stale history, model, command, queue, send, or streaming results to another chat.
- A completed turn can no longer delete the first streamed fragment of the next queued turn.
- Background work and errors no longer leak glow or status into the selected idle session.
- Auxiliary capture/attachment errors no longer replace visible chat history.
- Manual scroll position, live-bubble identity, autostart opt-out, compact drag resize, and tray quit remain stable.
- Portable update headers and response bodies are bounded, partial staging files are cleaned safely, and installer downloads enforce a cancellable deadline, exact size, SHA-256, and recoverable rollback.
- Windows autostart follows an enabled current-name portable entry when the launcher is moved to a new stable path.

## [0.4.3] - 2026-08-26

### Fixed

- **The Windows batch fallback path was built with the running platform's rules.**
  `legacyBatchPath` describes a Windows desktop but used the native path module, so
  resolving it from POSIX produced a path that never matched and two launcher tests
  failed on every macOS and Linux runner.
- **`npm run test:platforms` was giving false confidence.** It overrode
  `process.platform` only, but the path module chooses its win32 or posix rules from
  the real OS when it is first loaded — so a simulated Linux run still resolved
  Windows-style paths and passed tests that fail on a real Linux runner. The hook now
  substitutes the path module as well. Verified by reintroducing the defect: the
  simulation reports exactly the two failures CI reported, and goes green once fixed.
- **macOS packaging tried to publish during the build.** Every platform build now uses
  `--publish never`; CI creates deterministic artifacts and the release step owns all
  GitHub publication.
- **Linux `.deb` packaging lacked maintainer metadata.** The public NeoXider GitHub
  noreply address is now supplied as the package maintainer, so both AppImage and `.deb`
  artifacts can be produced in CI.

## 0.4.2 - 2026-08-26

### Fixed

- **The test suite could never pass on macOS or Linux, so CI was red on those
  platforms for every release so far.** `resolveInstalledDshEntry` takes the target
  platform as an argument and branched on it when choosing a Windows root, but then
  built the candidate paths with the *native* path module. Resolving a Windows layout
  from POSIX produced mixed separators and never matched. Paths are now built for the
  platform that was asked for.

### Added

- `npm run test:platforms` runs the whole suite three times, once pretending to be each
  supported platform. The launcher takes its platform as an argument, so a bug there is
  invisible on the developer's own OS — which is exactly how this one survived several
  releases while CI was failing.

## 0.4.1 - 2026-08-26

Closes the remaining findings from the reliability audit.

### Fixed

- **The dashboard refetched the subagent roster for every session on every poll.**
  Session history was already cached against `updatedAt`, but `subagent.list` was not,
  so an eighteen-session deck issued eighteen extra requests every 2.5 seconds with
  nothing to show for them. The roster is now cached alongside history, and a failed
  lookup sets a `degraded` flag instead of being silently swallowed.
- **Starting Harness could hold the IPC call for twice the advertised timeout.** The
  readiness wait and the legacy fallback each got their own full 30 second budget, so a
  failed launch blocked `start-harness` for up to a minute with no answer. One deadline
  now covers the whole operation.
- **Autostart on Linux did nothing and said so.** Electron's login-item API is a no-op
  there, so the control reported itself unavailable even though Linux builds ship. It
  now writes a freedesktop `.desktop` entry under `$XDG_CONFIG_HOME/autostart`, falling
  back to `~/.config`, and never calls the unsupported Electron API.

## 0.4.0 - 2026-08-26

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

## 0.3.2 - 2026-08-26

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

## 0.3.1 - 2026-08-26

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

## 0.3.0 - 2026-08-26

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

## 0.2.4 - 2026-08-25

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
- Three window layers: Desktop, Above and Game.

## [0.1.0] - 2026-08-25

- First release: animated desktop companion for DeepSeek Harness sessions and chat.

[0.6.4]: https://github.com/NeoXider/neoxider-agent-deck/releases/tag/v0.6.4
[0.6.3]: https://github.com/NeoXider/neoxider-agent-deck/releases/tag/v0.6.3
[0.6.2]: https://github.com/NeoXider/neoxider-agent-deck/releases/tag/v0.6.2
[0.6.1]: https://github.com/NeoXider/neoxider-agent-deck/releases/tag/v0.6.1
[0.6.0]: https://github.com/NeoXider/neoxider-agent-deck/releases/tag/v0.6.0
[0.5.2]: https://github.com/NeoXider/neoxider-agent-deck/releases/tag/v0.5.2
[0.5.1]: https://github.com/NeoXider/neoxider-agent-deck/releases/tag/v0.5.1
[0.5.0]: https://github.com/NeoXider/neoxider-agent-deck/releases/tag/v0.5.0
[0.4.3]: https://github.com/NeoXider/neoxider-agent-deck/releases/tag/v0.4.3
[0.2.3]: https://github.com/NeoXider/neoxider-agent-deck/releases/tag/v0.2.3
[0.2.2]: https://github.com/NeoXider/neoxider-agent-deck/releases/tag/v0.2.2
[0.2.1]: https://github.com/NeoXider/neoxider-agent-deck/releases/tag/v0.2.1
[0.2.0]: https://github.com/NeoXider/neoxider-agent-deck/releases/tag/v0.2.0
[0.1.0]: https://github.com/NeoXider/neoxider-agent-deck/releases/tag/v0.1.0
