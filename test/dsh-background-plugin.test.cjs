const test = require('node:test');
const assert = require('node:assert/strict');

test('background plugin preserves fallback, caps deadline and restores native transport', async () => {
  const { apply } = await import('../integrations/dsh-background-code/index.js');
  const calls = [];
  const native = function (args, exec) { calls.push({ args, exec, self: this }); return Promise.resolve({ logs: ['ok'] }); };
  const definition = { execute: native };
  const dispose = [];
  const sections = [];
  const owner = {};
  apply({
    tools: { requirePtcTransport: () => definition },
    jobs: { servesOwner: agent => agent === owner, start: () => assert.fail('fast calls must not register jobs') },
    ptcRuntime: { timeout: { maxMs: 90000 } },
    effect: callback => dispose.push(callback()),
    systemPrompt: { getSectionOrder: () => 10, section: value => sections.push(value) },
  });
  const base = { signal: new AbortController().signal, deferContext() {}, concludeTurn() {} };
  const args = { code: '1' };
  await definition.execute(args, base);
  assert.equal(calls[0].args, args);
  await definition.execute(args, { ...base, agent: owner });
  assert.equal(calls[1].args.timeoutMs, 90000);
  assert.equal(calls[1].self, definition);
  assert.match(sections[0].text, /job_output/);
  dispose[0]();
  assert.equal(definition.execute, native);
});
