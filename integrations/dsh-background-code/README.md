# Background code for DSH

Local integration for DSH 0.1.7-rc.2 (backward compatible with 0.1.6-alpha.1). It connects the existing `run_code`
transport to DSH's native job registry without replacing sandbox policy,
approval, nested tool dispatch, or the code interpreter.

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
are modified. Recheck integration compatibility after DSH upgrades: wrapping the
PTC transport uses DSH's current runtime API. Install once at profile root: the
PTC transport is shared across the process, so this is not a per-agent preset.

Run `npm test` from the Deck repository, or `node --test
integrations/dsh-background-code/background-run.test.mjs` for focused coverage.
