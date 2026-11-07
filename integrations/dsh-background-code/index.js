import { runBackgroundCode } from './background-run.mjs';

export const name = 'dsh-background-code';
export const inject = ['tools', 'jobs', 'systemPrompt', 'ptcRuntime'];

const RUN_CODE = 'run_code';

// A result as the tool pipeline returns it, as opposed to the raw value a hand-off returns.
const isToolResult = (value) => value !== null && typeof value === 'object'
  && Array.isArray(value.content) && typeof value.isError === 'boolean';

function resultText(result) {
  const text = result.content.filter((block) => block?.type === 'text').map((block) => block.text).join('\n');
  return text || result.error?.message || 'run_code failed';
}

export function apply(ctx) {
  // DSH 0.2.2 gives every PTC executor its own run_code transport, so the call is caught
  // where all of them meet: the tools/execute waterfall around the tool body.
  ctx.on('tools/execute', async (exec, next) => {
    // Preserve normal execution when no native job controller owns this agent.
    if (exec.name !== RUN_CODE || exec.parent !== undefined || !exec.agent || !ctx.jobs.servesOwner(exec.agent)) return next();
    const maxMs = ctx.ptcRuntime.timeout?.maxMs;
    // The body is handed this runner's own signal and hooks through the live execution;
    // the runner reports back through the original hooks, bound here before they change.
    const outer = { ...exec, deferContext: exec.deferContext.bind(exec), concludeTurn: exec.concludeTurn.bind(exec) };
    try {
      const value = await runBackgroundCode({
        args: exec.arguments,
        exec: outer,
        execute: async (input, context) => {
          exec.arguments = input;
          exec.signal = context.signal;
          exec.deferContext = context.deferContext;
          exec.concludeTurn = context.concludeTurn;
          const result = await next();
          if (result.isError) throw Object.assign(new Error(resultText(result)), { toolResult: result });
          return result;
        },
        jobValue: (result) => (isToolResult(result) ? result.value : result),
        jobs: ctx.jobs,
        timeoutMs: Number.isFinite(maxMs) ? Math.min(600000, maxMs) : 600000,
      });
      return isToolResult(value) ? value : { value };
    } catch (error) {
      if (error?.toolResult) return error.toolResult;
      throw error;
    }
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
