# Architecture

These are not aspirations. Every rule below is already true of the code, and
[`test/architecture.test.cjs`](test/architecture.test.cjs) fails the build when one stops
being true. That test exists because the rules were followed for a while, written down
nowhere, and then quietly eroded: `main.cjs` was split into modules once and grew back
past 950 lines within days. A rule nothing checks is a rule that lasts until the next
deadline.

## The shape

```
main.cjs ─────────── composition only: create the window, wire modules, register IPC
  │
  ├── preload.cjs ── the only bridge to the renderer; one line per channel, no logic
  │
  └── everything else in src/ ── pure modules, no Electron, all dependencies injected
```

## Rule 1 — Only `main.cjs` and `preload.cjs` may import Electron

Every other module in `src/` takes what it needs as a parameter: a window, an `app`, a
`fileSystem`, a `spawnProcess`, a `now()`. Nothing else reaches for a global.

This is what makes the suite fast and honest. 24 modules, 21 of them with their own test
file, and none of those tests needs to boot Electron — they run in milliseconds against
injected fakes. `harness-launcher.cjs` is the clearest example: `fileSystem`,
`spawnProcess`, `probeReady`, `delay` and `now` are all parameters, so "an external Node
process that exits before readiness fails immediately" is a unit test, not a manual
experiment.

It also keeps behaviour testable across platforms. Modules that resolve paths take
`platform` as an argument — and must then build paths for *that* platform, not for the
one running the process. Getting this wrong is not theoretical: `resolveInstalledDshEntry`
branched on `platform` but used the native `path` module, so the suite passed on Windows
while CI was red on macOS and Linux for several releases. `npm run test:platforms` now
runs the whole suite three times, once per simulated platform, with the `path` module
swapped to match.

## Rule 2 — Every module has a test file

`src/foo.cjs` has `test/foo.test.cjs`. The two exceptions are declared in the enforcing
test, with reasons:

- `main.cjs` — composition. What it does is covered by `test/ui-contract.test.cjs`
  (source contracts), `scripts/ui-visual-smoke.cjs` (real Electron) and
  `scripts/input-regression.cjs` (real mouse input).
- `preload.cjs` — a one-line-per-channel bridge with no logic. Its correctness is that
  every channel it exposes has a handler, which `ui-contract` asserts in both directions:
  no bridged channel without a handler, and no handler without a caller.

If you add a module without a test, the architecture test tells you.

## Rule 3 — `main.cjs` composes, it does not implement

It may create the window, hold the small amount of state the window manager needs, and
register IPC handlers that immediately delegate. It may not contain feature logic.

The line budget is a ratchet: **it may only go down.** When you need room, extract —
do not raise the number. The current ceiling and the target both live in the enforcing
test.

Things that were pulled out, and why each was wrong to keep inline:

| Module | Why it left `main.cjs` |
|---|---|
| `mux-client.cjs` | The live event socket had no heartbeat, so a half-open TCP killed live updates silently. None of it was assertable until the socket, clock and handlers became injectable. |
| `attachments.cjs` | Reading and base64-encoding files synchronously froze the whole main process. Two behaviours had no coverage: a thumbnailer that throws must not cost the attachment, and one bad file must not sink the batch. |
| `screenshot-service.cjs` | ~190 lines of QA machinery ran through production window setup, guarded only by an environment variable. |
| `queue-view.cjs` | A queued message is editable only when it is entirely text; editing anything else silently drops the attachment. That is a rule worth a test, not a branch buried in a handler. |

## Rule 4 — The renderer reaches the main process only through the bridge

No `nodeIntegration`, `contextIsolation` on, `sandbox` on. The renderer runs under a
strict CSP (`default-src 'none'`, no `unsafe-inline`, no `unsafe-eval`), cannot open a
window, cannot navigate away, and cannot attach a webview. Links from model output are
re-parsed and protocol-checked in the main process before they reach the system browser.

Model output is rendered through `markdown.cjs`, which disables raw HTML and allows only
`http`, `https` and `mailto`.

## Rule 5 — Anything that can fail at runtime is injected, so failure is testable

Not "wrapped in try/catch and hoped for". The failures worth testing are the ones that
already happened: a settings write refused by a virus scanner, a renderer that died, a
child process that exited before it was ready, a socket that stopped delivering frames
without ever closing, a monitor unplugged while the widget sat on it.

## Verifying

```bash
npm test              # unit + contract tests, no Electron
npm run test:platforms # the same suite as win32, darwin and linux
npm run test:ui        # real Electron, fixture scenarios, layout assertions
npm run test:input     # real mouse input against the compact-mode gestures
```

`test:ui` and `test:input` exist because some defects only appear with a real compositor
and real input. The avatar-click bug was invisible to synthetic `click()` calls: the brand
area captures the pointer, and pointer capture retargets the follow-up click to the
capturing element, so the button's own handler never ran.
