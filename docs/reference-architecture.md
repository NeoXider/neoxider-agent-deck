# Reference architecture and conformance

The standards this project is held to, where each comes from, and an honest statement of
where we currently sit. `ARCHITECTURE.md` describes rules that are already true and
enforced by a test; this file is the **target**, including the parts we have not reached.

Every row was checked against the code, not assumed. Where we fall short, the row says so.

---

## 1. Process model

**The standard.** Electron's performance guide is unambiguous: *"Under no circumstances
should you block this process and the UI thread with long-running operations."* The main
process owns windows, interaction and UI dispatch; CPU-bound work belongs on worker
threads or a `utilityProcess`.

The layering rule from wider practice: keep domain services free of `ipcMain` and
`BrowserWindow` imports, and let thin IPC modules adapt between transport and domain.
Coupling business logic to Electron APIs is what makes it untestable and unreusable.

| Rule | Us | Note |
|---|---|---|
| Domain modules free of Electron imports | **Met** | Only `main.cjs` and `preload.cjs` import Electron; every other module takes its dependencies as parameters. Enforced by `test/architecture.test.cjs`. |
| Main process is a thin orchestrator | **Partially met** | IPC registration and live stream/queue publication are extracted into injected, independently tested modules; `main.cjs` is now 787 lines against an enforced 820-line ceiling and a 400-line goal. Window lifecycle and composition still need further separation. |
| No CPU-bound work on the main process | **Partially met** | `base64-encoder.cjs` provides a lazy, bounded worker-thread pool and a tested fallback. Benchmarks currently keep inline encoding as the default because it produced less blocking on the measured machine; `DSH_WIDGET_B64_STRATEGY=worker` enables the pool. PNG thumbnail encoding still runs on main, and the larger measured stalls are now full-payload IPC transfer and Harness JSON serialisation. |
| Lazy-load expensive modules | Not assessed | Startup has not been profiled. Electron's guidance is to measure before optimising, so this stays open rather than guessed at. |

---

## 2. Security baseline

**The standard.** Electron publishes a numbered checklist. The items that apply here:
context isolation on, sandbox on, `nodeIntegration` off, a Content Security Policy,
`webSecurity` left enabled, navigation and window creation restricted, `webview`
restricted, `shell.openExternal` never given untrusted input, a current Electron version,
`setPermissionRequestHandler` on sessions, **validation of the sender of every IPC
message**, a preference for custom protocols over `file://`, and reviewing fuses.

| Checklist item | Us | Note |
|---|---|---|
| `contextIsolation: true` | **Met** | Asserted by the architecture test. |
| `sandbox: true` | **Met** | Asserted. |
| `nodeIntegration: false` | **Met** | Asserted. |
| Content Security Policy | **Met** | `default-src 'none'`, no `unsafe-inline`, no `unsafe-eval`; `data:` only for attachment thumbnails. |
| `webSecurity` not disabled | **Met** | Never touched, so the default stands. |
| Navigation and window creation restricted | **Met** | `setWindowOpenHandler` denies, `will-navigate` refuses, `will-attach-webview` blocked. Asserted. |
| `shell.openExternal` on trusted input only | **Met** | Every URL is re-parsed and protocol-checked against `http`/`https`/`mailto`. |
| Current Electron | **Met** | Electron 44. |
| Renderer cannot render executable markup | **Met** | `markdown.cjs` disables raw HTML and allows three schemes. Asserted. |
| **`setPermissionRequestHandler`** | **Met** | `ipc-handlers.cjs` installs deny-all request and check handlers on the renderer's default session. The policy and the missing-session case are covered by `test/ipc-handlers.test.cjs`. |
| **Validate the sender of every IPC message** | **Met** | All invoke and fire-and-forget channels are registered through shared guarded wrappers. They accept only the current widget window's live top frame; the complete registered surface is exercised against a foreign sender by `test/ipc-handlers.test.cjs`. |
| **Fuses reviewed** | **Met** | `scripts/electron-fuses.cjs` runs as electron-builder's `afterPack` hook and burns `RunAsNode`, `EnableNodeOptionsEnvironmentVariable` and `EnableNodeCliInspectArguments` off, `OnlyLoadAppFromAsar` on, and asar integrity validation on wherever the platform implements it. Asserted by `test/fuses.test.cjs`; verified by building the portable `.exe` and launching it. |
| Prefer a custom protocol over `file://` | **Not met** | The renderer is loaded with `loadFile`. Lower priority: the strict CSP removes most of what this protects against. |

---

## 3. IPC contract

**The standard.** Segregate channels deliberately; treat each as attack surface and expose
only what the renderer needs; validate arguments; never expose a raw `ipcRenderer`
pass-through, `fs`, `shell` or `process` across the bridge; expose high-level parameterised
actions instead.

| Rule | Us | Note |
|---|---|---|
| No raw `ipcRenderer` exposed | **Met** | `preload.cjs` is one named function per channel. |
| No `fs`, `shell`, `child_process` or `process` on the bridge | **Met** | The bridge exposes only domain actions. |
| Every bridged channel has a handler, every handler has a caller | **Met** | Asserted in both directions by `ui-contract`, which is how four dead channels were found and removed. |
| Arguments validated | **Partially met** | Session ids, drag payloads, queue updates and window modes are validated; several channels still forward renderer input unchecked. |
| Rate limiting | Not met | No channel is rate limited. A compromised renderer could flood main. Low priority given the sandbox and CSP, but recorded rather than ignored. |

---

## 4. Current renderer risks

These are present in the current implementation, not hypothetical consequences of the
target architecture.

| Risk | Current evidence | Target |
|---|---|---|
| Full attachment data crosses the process boundary twice | Image preparation returns full-resolution base64 from main to renderer. The renderer retains it for the preview and sends it back to main with the prompt. Twelve allowed 8 MiB images produce about 128 MiB of base64, or about 256 MiB of structured-clone traffic before the payload is JSON-serialised for Harness. The repository benchmark records roughly 80 ms for the full-payload Electron transfer and another roughly 80 ms for Harness JSON serialisation on the measured machine. | Keep original bytes in main behind opaque attachment ids. Send only bounded thumbnails and metadata to renderer; resolve, revalidate and encode ids in main when the prompt is sent. |

Two former renderer risks are now closed. Live deltas are accumulated per session and
coalesced behind one animation-frame paint; the paint patches only the live assistant
bubble, while compact-status IPC and nearby DOM updates are signature-deduplicated.
Harness queue snapshots now carry a main-process monotonic revision. The renderer rejects
older snapshots and adds an optimistic row only when no newer authoritative snapshot won
the pending-send race. The physical input regression covers the snapshot-before-send
ordering, duplicate-looking independent queue items, steering, and bounded stream paints.

### Target renderer split

Keep the existing preload contract and avoid a framework rewrite. `app.js` should become a
small composition/bootstrap module, with ownership split along the state transitions that
already exist:

- `chat-stream`: history rendering, live-delta coalescing, activity and scroll ownership;
- `queue`: authoritative snapshots, optimistic reconciliation and queue actions;
- `attachments`: thumbnail chips and opaque attachment handles only;
- `session-controls`: sessions, models, commands and workspaces, including request epochs;
- `compact-view`: avatar/edge presentation, notifications, drag and mode transitions;
- `preferences-view`: settings, hotkeys, update state and persistence feedback.

Pure transition helpers should be testable without Electron or a DOM. Each view module
should own one render scheduler instead of mutating the shared state and immediately
calling several neighbouring render paths. This is an incremental extraction target, not
permission to change the bridge or redesign the product.

---

## 5. What this changes about how we work

**Sender validation is a default, not a feature.** All web frames can in theory send IPC to
main. This is now enforced by the shared `handle` and `on` wrappers in
`ipc-handlers.cjs`: a new handler is validated because of how it is registered, not
because someone remembered.

**Retrofitting security costs more than building it in.** That is the argument for closing
small gaps before something depends on the current behaviour. Sender validation and the
deny-all permission policy stayed small because they were centralised alongside the IPC
extraction; the fuse policy followed the same pattern with one build hook and a test.

**A protection nothing exercises is a claim, not a control.** The fuse policy is asserted
by a unit test *and* checked against a real packaged build, because the values are
invisible at runtime — the app behaves identically whether they are burned in or not, so
a wiring mistake would have looked exactly like success.

**Measure before optimising.** Electron's performance guide leads with *"Measure, Measure,
Measure"*. This project already works that way where it counts — the capability broker's
context savings, the platform matrix, the physical input regression all exist because a
number or a real run settled a question that reading the code could not. Startup time has
not been profiled, so this document claims nothing about it.

---

## 6. Prioritised gaps

1. **Split the renderer monolith.** `src/renderer/app.js` is about 4,000 lines and is not covered
   by the root-`.cjs` module-size ratchet. Use the ownership boundaries above without
   changing the preload bridge or introducing a UI framework.
2. **Continue shrinking `main.cjs`.** IPC handlers are extracted, but the composition root
   is still 787 lines against a 400-line goal and remains protected by an 820-line ceiling.
3. **Complete IPC input validation.** Important individual inputs are normalised or
   validated, including queue actions, window values and session ids on selected channels,
   but the bridge still has no complete per-channel schema and several payloads are passed
   through structurally unchecked.
4. **Rate limiting.** No IPC channel is rate limited. A compromised renderer could flood
   main. This is lower risk behind the sandbox, CSP and sender guard, but remains open.
5. **Stop transferring full attachment payloads through the renderer.** Worker-thread
   encoding is available, but measured IPC transfer and later JSON serialisation each cost
   more than encoding. Main-owned opaque attachment ids would address the actual bottleneck.
6. **Custom protocol instead of `file://`.** Real, but the strict CSP already covers most
   of the motivation. It also gates the one fuse we cannot set today:
   `GrantFileProtocolExtraPrivileges` stays on only because the renderer is a `file://`
   page.

**Closed:** *IPC handler extraction and central sender validation* —
`src/ipc-handlers.cjs`; *bounded, animation-frame-coalesced live rendering* — renderer
stream state plus signature-deduplicated DOM/IPC updates; *monotonic authoritative queue
snapshots* — `src/stream-publisher.cjs` and renderer revision checks; *deny-all renderer
permissions* — registered on `session.defaultSession`; *Electron fuses* —
`scripts/electron-fuses.cjs`, wired as `afterPack`.

## Sources

- [Electron — Security](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron — Performance](https://www.electronjs.org/docs/latest/tutorial/performance)
- [LogRocket — Advanced Electron.js architecture](https://blog.logrocket.com/advanced-electron-js-architecture/)
- [Quasar — Electron security concerns](https://quasar.dev/quasar-cli-vite/developing-electron-apps/electron-security-concerns/)
- [Doyensec — Electronegativity, permission request handler check](https://github.com/doyensec/electronegativity/wiki/PERMISSION_REQUEST_HANDLER_JS_CHECK)
- [Doyensec — Electron security checklist (PDF)](https://doyensec.com/resources/us-17-Carettoni-Electronegativity-A-Study-Of-Electron-Security-wp.pdf)
