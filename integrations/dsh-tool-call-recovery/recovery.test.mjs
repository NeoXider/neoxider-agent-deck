import assert from 'node:assert/strict';
import test from 'node:test';
import { apply } from './index.js';
import { fitArguments, parseTrailingCalls, recoverCalls, recoverToolCalls, resolveTool, suggestTools, unknownToolStreak } from './recovery.mjs';

// The declared tools of a Windows DSH agent, as the request carries them.
const TOOLS = [
  { name: 'read', parameters: { type: 'object', properties: { file_path: { type: 'string' }, offset: { type: 'integer' }, limit: { type: 'integer' } } } },
  { name: 'read_image', parameters: { type: 'object', properties: { file_path: { type: 'string' } } } },
  { name: 'write', parameters: { type: 'object', properties: { file_path: { type: 'string' }, content: { type: 'string' } } } },
  { name: 'edit', parameters: { type: 'object', properties: { file_path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' }, replace_all: { type: 'boolean' } } } },
  { name: 'pwsh', parameters: { type: 'object', properties: { command: { type: 'string' }, timeoutMs: { type: 'number' } } } },
  { name: 'grep', parameters: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' } } } },
  { name: 'web_fetch', parameters: { type: 'object', properties: { url: { type: 'string' } } } },
  { name: 'web_search', parameters: { type: 'object', properties: { query: { type: 'string' } } } },
  { name: 'capability_hub', parameters: { type: 'object', properties: { action: { type: 'string' }, name: { type: 'string' }, arguments: { type: 'object', additionalProperties: true } } } },
  { name: 'job_output', parameters: { type: 'object', properties: { job_id: { type: 'string' }, wait: { type: 'boolean' }, timeout_ms: { type: 'integer' } } } },
];
const NAMES = TOOLS.map((tool) => tool.name);

// What the model wrote in the chat that prompted this plugin.
const WRITTEN_READ = 'Let me read it.\n<tool_call>\n<function=read_file>\n<parameter=file_path>\nD:/Git/notes.md\n</parameter>\n</function>\n</tool_call>';

// A call to no declared tool at all, as a model wrote it while waiting on a background job:
// the namespace code mode calls tools through, the job_output arguments nested in a wrapper.
const WRITTEN_UNKNOWN = 'Waiting for the search.\n<tool_call>\n<function=tools>\n<parameter=arguments>\n{"job_id": "code-19e64e72a4264731", "wait": true, "timeout_ms": 240000}\n</parameter>\n<parameter=description>\nCollect web search results\n</parameter>\n</function>\n</tool_call>';

async function* stream(...chunks) {
  yield* chunks;
}

async function collect(source) {
  const out = [];
  for await (const chunk of source) out.push(chunk);
  return out;
}

function textReply(text, finish = { type: 'finish', reason: { kind: 'stop' }, replayState: { blocks: [{ type: 'text' }] } }) {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: text.slice(0, 12) },
    { type: 'text-delta', index: 0, text: text.slice(12) },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { input: 1, output: 1 } },
    finish,
  ];
}

const byJson = (left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right));

test('written names resolve to the declared tool they mean, and only when it is clear', () => {
  const cases = {
    read: 'read',
    READ: 'read',
    read_file: 'read',
    view_file: 'read',
    write_file: 'write',
    edit_file: 'edit',
    run_shell_command: 'pwsh',
    bash: 'pwsh',
    search_file_content: 'grep',
    fetch_url: 'web_fetch',
    'mcp__capability_hub': 'capability_hub',
    'mcp__capability-hub__capability_hub': 'capability_hub',
    'mcp__filesystem__read_file': 'read',
    'capability-hub': 'capability_hub',
    'tools.read': 'read',
    'functions.web_fetch': 'web_fetch',
  };
  for (const [written, expected] of Object.entries(cases)) assert.equal(resolveTool(written, NAMES), expected, written);
  for (const written of ['web', 'delete_everything', 'list_directory', 'todo']) assert.equal(resolveTool(written, NAMES), undefined, written);
  assert.equal(resolveTool('run_shell_command', ['bash', 'read']), 'bash');
});

test('arguments are renamed and typed against the target schema', () => {
  const write = TOOLS.find((tool) => tool.name === 'write').parameters;
  assert.deepEqual(fitArguments({ path: 'a.txt', text: 'hi' }, write), { file_path: 'a.txt', content: 'hi' });
  const read = TOOLS.find((tool) => tool.name === 'read').parameters;
  assert.deepEqual(fitArguments({ file_path: 'a.txt', offset: '10', limit: 'all' }, read), { file_path: 'a.txt', offset: 10, limit: 'all' });
  const edit = TOOLS.find((tool) => tool.name === 'edit').parameters;
  assert.deepEqual(fitArguments({ path: 'a', old_str: 'x', new_str: 'y', replace_all: 'true' }, edit), { file_path: 'a', old_string: 'x', new_string: 'y', replace_all: true });
  // A key the tool already has is never renamed onto, and an unknown key is kept as written.
  assert.deepEqual(fitArguments({ file_path: 'a', path: 'b', extra: '1' }, write), { file_path: 'a', path: 'b', extra: '1' });
});

test('the written call from the chat becomes a read of the same file', () => {
  assert.deepEqual(recoverCalls(WRITTEN_READ, TOOLS), {
    prose: 'Let me read it.',
    calls: [{ name: 'read', arguments: { file_path: 'D:/Git/notes.md' } }],
  });
  const hub = '<tool_call>\n<function=mcp__capability_hub>\n<parameter=action>\ncall\n</parameter>\n<parameter=arguments>\n{"url": "https://example.com"}\n</parameter>\n</function>\n</tool_call>';
  assert.deepEqual(recoverCalls(hub, TOOLS).calls, [{ name: 'capability_hub', arguments: { action: 'call', arguments: { url: 'https://example.com' } } }]);
  const json = '<tool_call>\n{"name": "run_shell_command", "arguments": {"cmd": "Get-Date"}}\n</tool_call>';
  assert.deepEqual(recoverCalls(json, TOOLS).calls, [{ name: 'pwsh', arguments: { command: 'Get-Date' } }]);
});

test('text that only quotes or cuts off a call is left alone', () => {
  assert.equal(recoverCalls(`${WRITTEN_READ}\nThat is how a call looks.`, TOOLS), undefined);
  assert.equal(recoverCalls(`Example:\n\`\`\`\n${WRITTEN_READ}`, TOOLS), undefined);
  assert.equal(recoverCalls('<tool_call>\n<function=read_file>\n<parameter=file_path>\nD:/Gi', TOOLS), undefined);
  assert.equal(parseTrailingCalls('<tool_call>\n<function=read>\nloose text\n</function>'), undefined);
});

test('a call to no declared tool becomes a refused call that names the tools it probably meant', () => {
  const recovered = recoverCalls(WRITTEN_UNKNOWN, TOOLS);
  assert.equal(recovered.prose, 'Waiting for the search.');
  assert.equal(recovered.calls.length, 1);
  const [call] = recovered.calls;
  assert.equal(call.name, 'tools');
  assert.deepEqual(call.arguments, { arguments: '{"job_id": "code-19e64e72a4264731", "wait": true, "timeout_ms": 240000}', description: 'Collect web search results' });
  assert.match(call.hint, /^unknown tool "tools": it is not one of this agent's tools\. /);
  assert.match(call.hint, /Closest declared tools: job_output \(job_id, wait, timeout_ms\)/);
  assert.deepEqual(suggestTools('job_ouput', {}, TOOLS).map((tool) => tool.name), ['job_output']);
  assert.deepEqual(suggestTools('frobnicate', {}, TOOLS), []);
  // In code mode the hint says how the other tools are reached.
  const codeMode = [{ name: 'run_code', parameters: { type: 'object', properties: { code: { type: 'string' }, description: { type: 'string' } } } }];
  const hint = recoverCalls(WRITTEN_UNKNOWN, codeMode).calls[0].hint;
  assert.match(hint, /functions inside a run_code program: put `return await tools\.NAME\(\{ \.\.\. \}\)`/);
  assert.match(hint, /Closest declared tools: run_code \(code, description\)\.$/);
  assert.doesNotMatch(call.hint, /run_code/);

  // Resolved and unknown calls in one reply both become calls.
  const mixed = recoverCalls(`${WRITTEN_READ}\n${WRITTEN_READ.replace('read_file', 'nope').replace('Let me read it.', '')}`, TOOLS);
  assert.deepEqual(mixed.calls.map((entry) => [entry.name, entry.hint !== undefined]), [['read', false], ['nope', true]]);
  // An offered tool's name is never reused for an unknown call, and a name keeps to the
  // characters a provider accepts.
  assert.equal(recoverCalls(WRITTEN_READ.replace('read_file', 'web search!'), TOOLS).calls[0].name, 'web_search_');
  assert.equal(recoverCalls(WRITTEN_READ.replace('read_file', 'web search'), TOOLS).calls[0].name, 'unknown_tool');
  // A deferred tool named exactly is DSH's to answer, so it passes as written.
  assert.deepEqual(recoverCalls(WRITTEN_READ.replace('read_file', 'tool_search'), TOOLS, { known: [...NAMES, 'tool_search'] }).calls, [{ name: 'tool_search', arguments: { file_path: 'D:/Git/notes.md' } }]);
  // A closed call in no readable form is refused too, and never runs the tool it names.
  const unreadable = recoverCalls('<tool_call>\n<function=read>\nloose text\n</function>\n</tool_call>', TOOLS);
  assert.deepEqual(unreadable.calls.map((entry) => entry.name), ['unknown_tool']);
  assert.match(unreadable.calls[0].hint, /^unknown tool "read": the call was written as text in a form that could not be read/);
  // With unknown calls switched off, nothing is recovered from a reply that has one.
  assert.equal(recoverCalls(WRITTEN_UNKNOWN, TOOLS, { unresolved: false }), undefined);
  assert.equal(recoverCalls(mixed.prose + WRITTEN_UNKNOWN, TOOLS, { unresolved: false }), undefined);
});

test('unknown-name errors are counted back to the last user message', () => {
  const refused = { role: 'tool', isError: true, content: [{ type: 'text', text: 'Error: unknown tool "tools": it is not one of this agent\'s tools.' }] };
  const failed = { role: 'tool', isError: true, content: [{ type: 'text', text: 'Error: file not found' }] };
  const assistant = { role: 'assistant', content: [] };
  assert.equal(unknownToolStreak(), 0);
  assert.equal(unknownToolStreak([{ role: 'user', content: [] }, assistant, refused, assistant, refused]), 2);
  assert.equal(unknownToolStreak([refused, refused, { role: 'user', content: [] }, assistant, refused]), 1);
  assert.equal(unknownToolStreak([refused, assistant, failed, assistant, refused]), 1);
});

test('a recovered reply streams the prose, then real tool-call blocks, and drops the written replay state', async () => {
  const out = await collect(recoverToolCalls(stream(...textReply(WRITTEN_READ)), TOOLS, { newId: () => 'call_1' }));
  assert.deepEqual(out, [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: WRITTEN_READ.slice(0, 12) },
    { type: 'text-delta', index: 0, text: WRITTEN_READ.slice(12) },
    { type: 'usage', usage: { input: 1, output: 1 } },
    { type: 'block-end', index: 0, block: { type: 'text', text: 'Let me read it.' } },
    { type: 'block-start', index: 1, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 1, id: 'call_1', name: 'read', argumentsDelta: '{"file_path":"D:/Git/notes.md"}' },
    { type: 'block-end', index: 1, block: { type: 'tool-call', id: 'call_1', name: 'read', arguments: '{"file_path":"D:/Git/notes.md"}' } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]);
});

test('replies with nothing to recover pass through with every chunk intact', async () => {
  const cases = [
    textReply('Plain answer.'),
    textReply(WRITTEN_READ, { type: 'finish', reason: { kind: 'max-tokens' } }),
    [
      { type: 'text-delta', index: 0, text: WRITTEN_READ },
      { type: 'block-end', index: 0, block: { type: 'text', text: WRITTEN_READ } },
      { type: 'block-start', index: 1, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 1, id: 'real', name: 'read', argumentsDelta: '{}' },
      { type: 'block-end', index: 1, block: { type: 'tool-call', id: 'real', name: 'read', arguments: '{}' } },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ],
  ];
  for (const chunks of cases) {
    const out = await collect(recoverToolCalls(stream(...chunks), TOOLS));
    assert.deepEqual([...out].sort(byJson), [...chunks].sort(byJson));
  }
});

test('the plugin wraps model streams that offer tools, counting only tools sent to the model', async () => {
  const listeners = {};
  apply({
    on: (event, callback, options) => {
      assert.equal(options.global, true);
      listeners[event] = { callback, options };
    },
  });
  assert.deepEqual(Object.keys(listeners).sort(), ['llm/stream', 'tools/pre-execute']);
  const listener = listeners['llm/stream'].callback;
  const model = () => stream(...textReply(WRITTEN_READ));
  const recovered = await collect(listener({ tools: TOOLS }, model));
  assert.equal(recovered.find((chunk) => chunk.type === 'block-end' && chunk.block.type === 'tool-call')?.block.name, 'read');
  const untouched = model();
  assert.equal(listener({}, () => untouched), untouched);
  const deferredOnly = await collect(listener({ tools: [{ ...TOOLS[0], deferLoading: true }] }, model));
  assert.equal(deferredOnly.some((chunk) => chunk.type === 'tool-call-delta'), false);
});

test('a call to an unknown name is refused with its hint before any policy runs', async () => {
  const listeners = {};
  apply({ on: (event, callback, options) => { listeners[event] = { callback, options }; } });
  assert.equal(listeners['tools/pre-execute'].options.prepend, true);
  const preExecute = listeners['tools/pre-execute'].callback;
  const out = await collect(listeners['llm/stream'].callback({ tools: TOOLS }, () => stream(...textReply(WRITTEN_UNKNOWN))));
  const call = out.find((chunk) => chunk.type === 'block-end' && chunk.block.type === 'tool-call').block;
  assert.equal(call.name, 'tools');
  assert.deepEqual(out.at(-1), { type: 'finish', reason: { kind: 'tool-calls' } });

  let policies = 0;
  const allow = () => { policies += 1; return Promise.resolve({ kind: 'allow' }); };
  const decision = await preExecute({ callId: call.id, name: call.name, arguments: {} }, allow);
  assert.equal(decision.kind, 'deny');
  assert.match(decision.reason, /^unknown tool "tools".*job_output/);
  assert.equal(policies, 0);
  // Each hint answers its call once; every other call goes on to the policies.
  assert.deepEqual(await preExecute({ callId: call.id, name: call.name }, allow), { kind: 'allow' });
  assert.deepEqual(await preExecute({ callId: 'other', name: 'read' }, allow), { kind: 'allow' });
  assert.equal(policies, 2);

  // A model that keeps writing unknown calls gets its text back after the third error.
  const refused = { role: 'tool', isError: true, content: [{ type: 'text', text: `Error: ${decision.reason}` }] };
  const history = [{ role: 'user', content: [] }, refused, refused, refused];
  const chunks = textReply(WRITTEN_UNKNOWN);
  const left = await collect(listeners['llm/stream'].callback({ tools: TOOLS, messages: history }, () => stream(...chunks)));
  assert.deepEqual([...left].sort(byJson), [...chunks].sort(byJson));
});
