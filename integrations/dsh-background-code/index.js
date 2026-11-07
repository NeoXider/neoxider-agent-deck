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

/**
 * The step's tool admission, kept for a program that outlives its step. DSH closes a
 * step's tool set when the step ends, and a closed set shows no tools, so every tool a
 * handed-off program called after that failed as `unknown tool`. Once the step's own set
 * shows nothing, this shows what it admitted at the program's start, less anything since
 * unregistered or replaced, so the program never gains a tool its step did not have.
 */
export function keepToolSet(toolSet, agent, tools) {
  if (toolSet === undefined || agent === undefined) return toolSet;
  const admitted = toolSet.view(agent);
  return Object.freeze({
    dispose: () => toolSet.dispose(),
    view(scope) {
      const live = toolSet.view(scope);
      if (live.size > 0 || scope !== agent) return live;
      const visible = new Map();
      for (const [name, definition] of admitted) if (tools.get(name, agent) === definition) visible.set(name, definition);
      return visible;
    },
  });
}

const DISPATCH_EVENTS = new Set(['tool/ptc-dispatch-start', 'tool/ptc-dispatch']);
const HELD_STARTS_MAX = 2000;
const GATED = Symbol.for('neoxider.dispatch-gate');

/**
 * Keeps a chat's log valid while a handed-off program is still calling tools. PTC writes
 * a `tool/ptc-dispatch-start` and a `tool/ptc-dispatch` event into the chat's log for every
 * tool call a run_code program makes, and DSH refuses a log that holds one outside a turn
 * ("tool/ptc-dispatch is outside an open turn": the whole chat then fails to load). A
 * program that went to the background outlives its turn, so its calls landed between
 * turns. Such events are held and written right after the next turn opens, in order; a
 * log that never gets another turn simply never receives them.
 */
export function gateDispatchLog(session) {
  if (!session || typeof session.append !== 'function' || session[GATED]) return false;
  const append = session.append;
  const held = [];
  const dropped = new Set();
  let open = true; // a run_code is being called, so a turn is open right now
  const flush = () => {
    while (held.length > 0) {
      const [type, data] = held.shift();
      try { Reflect.apply(append, session, [type, data]); } catch { /* an event the log refuses is dropped, not retried */ }
    }
  };
  const gate = function gatedAppend(type, data, ...rest) {
    if (!open && DISPATCH_EVENTS.has(type)) {
      const id = data?.subCallId;
      if (dropped.has(id)) return undefined;
      if (type === 'tool/ptc-dispatch-start' && held.length >= HELD_STARTS_MAX) dropped.add(id);
      else held.push([type, data]);
      return undefined;
    }
    const event = Reflect.apply(append, session, [type, data, ...rest]);
    if (type === 'turn/end') open = false;
    else if (type === 'turn/start') { open = true; flush(); }
    return event;
  };
  try {
    Object.defineProperty(session, GATED, { value: true });
    Object.defineProperty(session, 'append', { value: gate, configurable: true, writable: true });
    return true;
  } catch {
    return false;
  }
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
          // DSH freezes the execution once its result is delivered, which for a handed-off
          // call is the acknowledgement. The body and the wrappers inside this listener
          // still restore `exec.signal` when they finish; on a frozen data property that
          // assignment throws, and the job failed with "Cannot assign to read only
          // property 'signal'" and lost its result. A frozen accessor keeps its setter.
          let signal = context.signal;
          Object.defineProperty(exec, 'signal', {
            configurable: true,
            enumerable: true,
            get: () => signal,
            set: (value) => { signal = value; },
          });
          exec.toolSet = keepToolSet(exec.toolSet, exec.agent, ctx.tools);
          gateDispatchLog(exec.agent?.session);
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
