# Background code for DSH

Local integration for DSH 0.2.2-rc.1. It connects `run_code` calls to DSH's native
job registry without replacing sandbox policy, approval, nested tool dispatch, or
the code interpreter. Since DSH 0.2.2 every PTC executor owns its own `run_code`
transport, so the integration listens on the shared `tools/execute` waterfall
instead of wrapping one process-wide transport, which DSH no longer exposes.

Calls that finish within 1.5 seconds return normally. Longer calls return
`result.job_id`; the same execution continues once in the background. The native
`tool-jobs` completion notice reaches the owning agent, and wakes an idle agent
subject to its configured consecutive-wake budget (three by default).
`job_output` collects the result; `job_kill` cancels it. Short calls leave no jobs
in the registry. Final retained output is capped at 32,000 UTF-8 bytes.

The default code deadline becomes ten minutes, capped by the runtime maximum.
Explicit `timeoutMs` is preserved. These are process-local jobs: restarting DSH
or disposing the owning agent cancels them. This is not a durable scheduler.

## Local installation

Add this entry to the active profile's `cordis.patch.yml`, adjusting the path:

```yaml
- insert:
    - id: neoxider-background-code
      name: D:/Git/neoxider-agent-deck/integrations/dsh-background-code/index.js
```

The profile must load `tools`, `ptcRuntime`, `jobs`, `systemPrompt`, and the native
`tool-jobs` controller with completion delivery set to `wakeup`. With profile
`patchReload: live`, the entry loads without restarting the server. Installation
applies to subsequent calls; already-running calls cannot be detached retroactively.

Removing the entry restores normal foreground execution. Keep this source
directory present while the entry is installed. No runtime `node_modules` files
are modified. Recheck integration compatibility after DSH upgrades: the
`tools/execute` execution shape is DSH's current runtime API. Install once at
profile root, where the listener sees every agent's top-level `run_code`; this is
not a per-agent preset.

To load edited source without restarting the server, delete the entry, let the
profile reload, then add it back under a new URL, for example
`'file:///D:/Git/neoxider-agent-deck/integrations/dsh-background-code/index.js?v=2'`.
Node caches the module by URL, and changing only an entry's `name` does not
re-create its plugin. A module the entry imports keeps its first-loaded copy until
the server restarts.

Run `npm test` from the Deck repository, or `node --test
integrations/dsh-background-code/background-run.test.mjs` for focused coverage.
