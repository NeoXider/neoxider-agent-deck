# NeoXider Agent Deck 0.7.1 — visual state release

Goal: visibly distinguish idle, API waiting, reasoning, writing and tool activity in Full and Focus Chat, then publish and install the verified release.
Baseline: 2026-09-07, clean main at 8e99ea6 (v0.7.0); origin fetched and fast-forward pull reports current. Installed desktop app is 0.6.9.
Invariants: preserve transcript order, queue/idempotency, selected-session isolation, scrolling, geometry, saved preferences and compact modes; effects never intercept input or move layout.
Visual direction: shared palette for chat/avatar/edge; teal idle, blue-violet API wait, green-yellow writing, amber tools, gold completion, rose error, static slate-lilac offline; independent saved background alpha and bounded motion.
Ownership: orchestration/review/git/install = root; renderer state = worker A; CSS effects = worker B; release diagnosis = worker C. Parallel edits must not overlap.
Verification: state transition/failure tests, Full/Focus 360px screenshots, motion-off/reduced-motion checks, input/UI suite, Windows build, CI/release asset validation, installed app smoke.
Out of scope: unrelated history/security refactors, new model providers, game injection, dependency upgrades without a concrete release blocker.
Milestone 1 complete: inspected current checkout, pulled origin, found missing waiting/working chat bloom; neoxider-agents doctor and live opencode catalog succeeded.
Milestone 2 complete: root and independent audit accepted shared palette, offline, background alpha, compact active outline, reconnect and clipboard race fixes; 573/573 unit tests and 16/16 focused state checks pass. Muse provided a second-family release-gate audit before rate limiting.
Milestone 3 verified: 573/573 unit tests, 102/102 visual scenarios, native input suite, zero vulnerability audit and version contract passed. Screenshots/cover regenerated and inspected; renamed misleading Game label to Поверх окон+ (saved value unchanged), verified Settings at 360px. Final Windows package building from frozen source; root owns commit/push.
Milestone 4 pending: publish v0.7.1, update existing installed channel, verify settings/startup and native window.
