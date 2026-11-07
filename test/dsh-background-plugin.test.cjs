const test = require('node:test');
const assert = require('node:assert/strict');

function harness() {
  const listeners = [];
  const sections = [];
  const owner = { id: 'agent-1', injected: [], inject(context) { this.injected.push(context); } };
  const started = [];
  const ctx = {
    on: (event, listener) => listeners.push({ event, listener }),
    jobs: {
      servesOwner: (agent) => agent === owner,
      resolveOwner: (id) => id,
      start: (spec) => {
        started.push({ spec, hooks: spec.run() });
        return `code-${started.length}`;
      },
    },
    ptcRuntime: { timeout: { maxMs: 90000 } },
    systemPrompt: { getSectionOrder: () => 10, section: (value) => sections.push(value) },
  };
  return { ctx, listeners, sections, owner, started };
}

// One execution as DSH 0.2.2's tool pipeline hands it to tools/execute listeners.
function execution(overrides = {}) {
  const deferred = [];
  const concluded = [];
  const exec = {
    name: 'run_code',
    arguments: Object.freeze({ code: '1', description: 'one' }),
    signal: new AbortController().signal,
    deferContext(context) { deferred.push(context); },
    concludeTurn() { concluded.push(this); },
    ...overrides,
  };
  return { exec, deferred, concluded };
}

const toolResult = (value) => ({ isError: false, value, content: [{ type: 'text', text: JSON.stringify(value) }] });

test('background plugin listens on tools/execute and leaves other calls alone', async () => {
  const { apply } = await import('../integrations/dsh-background-code/index.js');
  const { ctx, listeners, sections, owner } = harness();
  apply(ctx);
  assert.deepEqual(listeners.map((entry) => entry.event), ['tools/execute']);
  assert.match(sections[0].text, /job_output/);
  const [{ listener }] = listeners;
  const passed = toolResult({ logs: ['ok'] });
  for (const overrides of [{ name: 'read' }, { agent: undefined }, { agent: {} }, { agent: owner, parent: {} }]) {
    const { exec } = execution(overrides);
    assert.equal(await listener(exec, async () => passed), passed);
  }
});

test('a fast run_code returns its own result with the capped default deadline and the real hooks', async () => {
  const { apply } = await import('../integrations/dsh-background-code/index.js');
  const { ctx, listeners, owner, started } = harness();
  apply(ctx);
  const [{ listener }] = listeners;
  const { exec, deferred, concluded } = execution({ agent: owner });
  const result = toolResult({ logs: ['ok'] });
  const out = await listener(exec, async () => {
    assert.equal(exec.arguments.timeoutMs, 90000);
    exec.deferContext({ note: 'later' });
    exec.concludeTurn();
    return result;
  });
  assert.equal(out, result);
  assert.deepEqual(deferred, [{ note: 'later' }]);
  assert.equal(concluded.length, 1);
  assert.equal(started.length, 0, 'fast calls must not register jobs');
});

test('a failed run_code keeps its own error result', async () => {
  const { apply } = await import('../integrations/dsh-background-code/index.js');
  const { ctx, listeners, owner } = harness();
  apply(ctx);
  const [{ listener }] = listeners;
  const failure = { isError: true, error: { message: 'boom' }, content: [{ type: 'text', text: 'Error: boom' }] };
  assert.equal(await listener(execution({ agent: owner }).exec, async () => failure), failure);
});

test('a slow run_code is handed to a job whose output is the program value', async () => {
  const { apply } = await import('../integrations/dsh-background-code/index.js');
  const { ctx, listeners, owner, started } = harness();
  apply(ctx);
  const [{ listener }] = listeners;
  let finish;
  const { exec } = execution({ agent: owner });
  const out = await listener(exec, () => new Promise((resolve) => { finish = resolve; }));
  assert.equal(out.value.result.job_id, 'code-1');
  assert.equal(out.value.result.status, 'running');
  assert.deepEqual(out.value.logs, []);
  assert.equal(started[0].spec.owner, 'agent-1');
  finish(toolResult({ logs: ['done'], result: 42 }));
  const outcome = await started[0].hooks.done;
  assert.equal(outcome.status, 'completed');
  assert.deepEqual(JSON.parse(outcome.result), { logs: ['done'], result: 42 });
});

test('a handed-off run_code still completes after DSH freezes its execution', async () => {
  const { apply } = await import('../integrations/dsh-background-code/index.js');
  const { ctx, listeners, owner, started } = harness();
  apply(ctx);
  const [{ listener }] = listeners;
  const { exec } = execution({ agent: owner });
  let finish;
  // The body as DSH 0.2.2 runs it: swap in its fused signal, restore the wrapper's on the
  // way out. The pipeline freezes the execution when the acknowledgement is delivered.
  const body = async () => {
    'use strict'; // as in DSH's ES modules, where writing a frozen property throws
    const wrapperSignal = exec.signal;
    exec.signal = new AbortController().signal;
    try {
      return await new Promise((resolve) => { finish = resolve; });
    } finally {
      exec.signal = wrapperSignal;
    }
  };
  const out = await listener(exec, body);
  assert.equal(out.value.result.status, 'running');
  Object.freeze(exec);
  finish(toolResult({ logs: [], result: 'searched' }));
  const outcome = await started[0].hooks.done;
  assert.equal(outcome.status, 'completed', outcome.detail);
  assert.deepEqual(JSON.parse(outcome.result), { logs: [], result: 'searched' });
});

test('a handed-off program never writes a tool dispatch between turns', async () => {
  const { gateDispatchLog } = await import('../integrations/dsh-background-code/index.js');
  const log = [];
  const session = { append(type, data) { log.push(type + (data?.subCallId ? ':' + data.subCallId : '')); return { type }; } };
  assert.equal(gateDispatchLog(session), true);
  assert.equal(gateDispatchLog(session), false, 'one gate per session');
  session.append('tool/ptc-dispatch-start', { subCallId: 'a' });
  session.append('tool/ptc-dispatch', { subCallId: 'a' });
  session.append('turn/end', {});
  // The program goes on after its turn: nothing reaches the log until a turn is open again.
  session.append('tool/ptc-dispatch-start', { subCallId: 'b' });
  session.append('job/settled', {});
  session.append('tool/ptc-dispatch', { subCallId: 'b' });
  assert.deepEqual(log, ['tool/ptc-dispatch-start:a', 'tool/ptc-dispatch:a', 'turn/end', 'job/settled']);
  session.append('turn/start', {});
  assert.deepEqual(log.slice(4), ['turn/start', 'tool/ptc-dispatch-start:b', 'tool/ptc-dispatch:b']);
  session.append('tool/ptc-dispatch-start', { subCallId: 'c' });
  assert.equal(log.at(-1), 'tool/ptc-dispatch-start:c', 'inside a turn it writes straight through');
  assert.equal(gateDispatchLog(Object.freeze({ append() {} })), false, 'a session it cannot wrap is left alone');
  assert.equal(gateDispatchLog(undefined), false);
});

test('a handed-off program keeps the tools its step admitted after the step closes', async () => {
  const { keepToolSet } = await import('../integrations/dsh-background-code/index.js');
  const agent = { id: 'agent-1' };
  const hub = { name: 'capability_hub' };
  const read = { name: 'read' };
  const registered = new Map([['capability_hub', hub], ['read', read], ['write', { name: 'write' }]]);
  let closed = false;
  // A step's tool set as DSH 0.2.2 resolves it: frozen, and empty once disposed.
  const stepSet = Object.freeze({
    dispose: () => { closed = true; },
    view: (scope) => (closed || scope !== agent ? new Map() : new Map([['capability_hub', hub], ['read', read]])),
  });
  const kept = keepToolSet(stepSet, agent, { get: (name) => registered.get(name) });
  assert.deepEqual([...kept.view(agent).keys()], ['capability_hub', 'read']);
  kept.dispose();
  assert.equal(closed, true);
  // After the step: what it admitted, never a tool it did not have, nor one since replaced.
  registered.set('read', { name: 'read' });
  assert.deepEqual([...kept.view(agent).keys()], ['capability_hub']);
  assert.equal(kept.view({ id: 'other' }).size, 0);
  assert.equal(keepToolSet(undefined, agent, {}), undefined);
});
