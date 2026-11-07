import { recoverToolCalls } from './recovery.mjs';

export const name = 'dsh-tool-call-recovery';

export function apply(ctx) {
  // Global, so subagents and every agent preset are covered: they all call the model
  // through the one llm service. Deferred tools are not sent to the model, so a written
  // call is only ever recovered as a call to a tool the model was actually offered.
  ctx.on('llm/stream', (request, next) => {
    const tools = (request.tools ?? []).filter((tool) => !tool.deferLoading);
    return tools.length === 0 ? next() : recoverToolCalls(next(), tools);
  }, { global: true });
}
