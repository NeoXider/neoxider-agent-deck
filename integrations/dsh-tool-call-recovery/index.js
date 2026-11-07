// A live profile reload loads an edited plugin from a new `?v=` URL. The same query on
// this import makes Node load the edited recovery code too, not its first-loaded copy.
const { recoverToolCalls, unknownToolStreak } = await import(`./recovery.mjs${new URL(import.meta.url).search}`);

export const name = 'dsh-tool-call-recovery';

// After this many unknown-name errors in a row the written calls are left as text: a model
// that is not corrected by them only spends the turn on more of them.
export const MAX_UNKNOWN_STREAK = 3;

// Calls this plugin emitted for unknown names, by call id, with the error to answer each.
// Bounded, since a call can be dropped (an aborted turn) before it is ever prepared.
const HINT_LIMIT = 256;

export function apply(ctx) {
  const hints = new Map();
  const remember = (id, hint) => {
    hints.set(id, hint);
    while (hints.size > HINT_LIMIT) hints.delete(hints.keys().next().value);
  };

  // Global, so subagents and every agent preset are covered: they all call the model
  // through the one llm service. Deferred tools are not sent to the model, so a written
  // call is only ever recovered as a call to a tool the model was actually offered.
  ctx.on('llm/stream', (request, next) => {
    const offered = request.tools ?? [];
    const tools = offered.filter((tool) => !tool.deferLoading);
    if (tools.length === 0) return next();
    return recoverToolCalls(next(), tools, {
      known: offered.map((tool) => tool.name),
      unresolved: unknownToolStreak(request.messages) < MAX_UNKNOWN_STREAK,
      onUnknown: remember,
    });
  }, { global: true });

  // A call to an unknown name is refused before any permission policy sees it, so no
  // approval is asked for a tool that does not exist, and the model learns which declared
  // tools it probably meant. Without this DSH still answers `unknown tool` at dispatch.
  ctx.on('tools/pre-execute', (exec, next) => {
    const hint = exec.parent === undefined ? hints.get(exec.callId) : undefined;
    if (hint === undefined) return next();
    hints.delete(exec.callId);
    return Promise.resolve({ kind: 'deny', reason: hint });
  }, { global: true, prepend: true });
}
