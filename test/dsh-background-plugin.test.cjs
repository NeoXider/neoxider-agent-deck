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
