import { runBackgroundCode } from './background-run.mjs';

export const name = 'dsh-background-code';
export const inject = ['tools', 'jobs', 'systemPrompt', 'ptcRuntime'];

export function apply(ctx) {
  const definition = ctx.tools.requirePtcTransport();
  const original = definition.execute;
  const wrapped = function (args, exec) {
    // Preserve normal execution when no native job controller owns this agent.
    if (!exec.agent || !ctx.jobs.servesOwner(exec.agent)) return original.call(this, args, exec);
    const maxMs = ctx.ptcRuntime.timeout?.maxMs;
    return runBackgroundCode({
      args,
      exec,
      execute: (input, context) => original.call(this, input, context),
      jobs: ctx.jobs,
      timeoutMs: Number.isFinite(maxMs) ? Math.min(600000, maxMs) : 600000,
    });
  };
  ctx.effect(() => {
    definition.execute = wrapped;
    return () => {
      if (definition.execute === wrapped) definition.execute = original;
    };
  });
  ctx.systemPrompt.section({
    name: 'tool:background-code',
    order: ctx.systemPrompt.getSectionOrder('TOOL_JOBS') + 1,
    text: 'Long run_code calls automatically continue as native background jobs after 1.5 seconds. '
      + 'A result containing job_id and status=running is an acknowledgement, not the script result. '
      + 'Record the job_id; continue independent work and do not repeat its side effects or busy-poll. '
      + 'Completion notifies this session, including after a final answer (subject to the native wake budget). '
      + 'Then read job_output and continue the original task. Use job_kill to cancel unwanted work. '
      + 'When only a delayed job remains, tell the user it is pending and finish the current response; '
      + 'do not keep the model turn occupied with sleep or repeated job_output waits. '
      + 'The default code deadline is ten minutes, capped by the runtime policy; an explicit timeoutMs is respected. '
      + 'Jobs belong to this running DSH process and do not survive its restart.',
  });
}
