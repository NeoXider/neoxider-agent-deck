import assert from 'node:assert/strict';
import test from 'node:test';
import { apply } from './index.js';
import { fitArguments, parseTrailingCalls, recoverCalls, recoverToolCalls, resolveTool } from './recovery.mjs';

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
];
const NAMES = TOOLS.map((tool) => tool.name);

// What the model wrote in the chat that prompted this plugin.
const WRITTEN_READ = 'Let me read it.\n<tool_call>\n<function=read_file>\n<parameter=file_path>\nD:/Git/notes.md\n</parameter>\n</function>\n</tool_call>';

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

test('text that only quotes, cuts off or misnames a call is left alone', () => {
  assert.equal(recoverCalls(`${WRITTEN_READ}\nThat is how a call looks.`, TOOLS), undefined);
  assert.equal(recoverCalls(`Example:\n\`\`\`\n${WRITTEN_READ}`, TOOLS), undefined);
  assert.equal(recoverCalls('<tool_call>\n<function=read_file>\n<parameter=file_path>\nD:/Gi', TOOLS), undefined);
  assert.equal(recoverCalls(WRITTEN_READ.replace('read_file', 'delete_everything'), TOOLS), undefined);
  assert.equal(recoverCalls(`${WRITTEN_READ}\n${WRITTEN_READ.replace('read_file', 'nope')}`, TOOLS), undefined);
  assert.equal(parseTrailingCalls('<tool_call>\n<function=read>\nloose text\n</function>'), undefined);
});

test('a recovered reply streams the prose, then real tool-call blocks, and drops the written replay state', async () => {
  const out = await collect(recoverToolCalls(stream(...textReply(WRITTEN_READ)), TOOLS, () => 'call_1'));
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
    textReply(WRITTEN_READ.replace('read_file', 'delete_everything')),
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
  let listener;
  apply({
    on: (event, callback, options) => {
      assert.equal(event, 'llm/stream');
      assert.equal(options.global, true);
      listener = callback;
    },
  });
  const model = () => stream(...textReply(WRITTEN_READ));
  const recovered = await collect(listener({ tools: TOOLS }, model));
  assert.equal(recovered.find((chunk) => chunk.type === 'block-end' && chunk.block.type === 'tool-call')?.block.name, 'read');
  const untouched = model();
  assert.equal(listener({}, () => untouched), untouched);
  const deferredOnly = await collect(listener({ tools: [{ ...TOOLS[0], deferLoading: true }] }, model));
  assert.equal(deferredOnly.some((chunk) => chunk.type === 'tool-call-delta'), false);
});
