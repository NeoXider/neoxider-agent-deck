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
| Main process is a thin orchestrator | **Partially met** | 45 IPC handlers still live inline in `main.cjs` (1007 lines). The extraction is identified and unstarted. |
| No CPU-bound work on the main process | **Not met** | Attachment reads are async, but base64 encoding of up to twelve 8 MB files still runs on the main thread, as does PNG thumbnail encoding. |
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
| **`setPermissionRequestHandler`** | **Not met** | No handler registered. We load no remote content and CSP is `default-src 'none'`, so practical risk is low — but the checklist's position is deny-by-default, and a deny-all handler is a few lines. |
| **Validate the sender of every IPC message** | **Not met** | 6 of 45 handlers check the sender. Electron's wording is that sender validation *should be the default*. One window and no remote content make this hard to exploit today; it is still the largest single gap. |
| **Fuses reviewed** | **Not met** | `@electron/fuses` is not used. `ELECTRON_RUN_AS_NODE` turns the shipped binary into a general-purpose Node runtime for anyone who can execute it — and we ship a portable `.exe`. |
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

## 4. What this changes about how we work

**Sender validation is a default, not a feature.** All web frames can in theory send IPC to
main. The correct shape is one shared guard applied at registration, so a new handler is
validated because of how it is registered — not because someone remembered.

**Retrofitting security costs more than building it in.** That is the argument for closing
the permission-handler and fuses gaps now, while each is a handful of lines, rather than
after something depends on the current behaviour.

**Measure before optimising.** Electron's performance guide leads with *"Measure, Measure,
Measure"*. This project already works that way where it counts — the capability broker's
context savings, the platform matrix, the physical input regression all exist because a
number or a real run settled a question that reading the code could not. Startup time has
not been profiled, so this document claims nothing about it.

---

## 5. Prioritised gaps

1. **Centralised IPC sender validation.** 39 unguarded handlers, an explicit checklist
   item, cheap to fix once at the registration point. Pairs naturally with extracting the
   handlers out of `main.cjs`, which is separately overdue.
2. **Electron fuses.** Disabling `run-as-node` and `node-options` closes a known escape on
   a portable binary we already distribute. Small, self-contained, package-time only.
3. **Deny-all permission handler.** A few lines, and it removes a class of future mistakes.
4. **Move base64 and thumbnail encoding off the main thread.** The measured symptom was a
   frozen window on large attachments; async I/O fixed part of it, encoding is what is left.
5. **Extract the IPC handlers from `main.cjs`.** 233 lines closing over 40 identifiers, 16
   of them mutable module state that needs accessors rather than snapshots — the same trap
   the screenshot harness hit. Blocked only by needing the file free.
6. **Custom protocol instead of `file://`.** Real, but the strict CSP already covers most
   of the motivation.

## Sources

- [Electron — Security](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron — Performance](https://www.electronjs.org/docs/latest/tutorial/performance)
- [LogRocket — Advanced Electron.js architecture](https://blog.logrocket.com/advanced-electron-js-architecture/)
- [Quasar — Electron security concerns](https://quasar.dev/quasar-cli-vite/developing-electron-apps/electron-security-concerns/)
- [Doyensec — Electronegativity, permission request handler check](https://github.com/doyensec/electronegativity/wiki/PERMISSION_REQUEST_HANDLER_JS_CHECK)
- [Doyensec — Electron security checklist (PDF)](https://doyensec.com/resources/us-17-Carettoni-Electronegativity-A-Study-Of-Electron-Security-wp.pdf)
