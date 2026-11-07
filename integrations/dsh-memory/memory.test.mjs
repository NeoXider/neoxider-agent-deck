import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { apply } from './index.js';
import { createMemoryStore } from './memory-store.mjs';

const tempDir = () => mkdtemp(path.join(os.tmpdir(), 'dsh-memory-'));
const fixedNow = () => new Date('2026-11-07T12:00:00Z');

test('entries are one file each and the index is derived from them', async () => {
  const dir = await tempDir();
  const store = createMemoryStore(dir, { now: fixedNow });
  assert.equal(await store.save({ name: 'user-language', description: 'Answers in Russian', content: 'The user writes and wants answers in Russian.' }), 'Saved memory "user-language" (1 entry).');
  assert.equal(await store.save({ name: 'release-routine', description: 'Push, tag, release', content: 'Every fix ends with push, tag and release.' }), 'Saved memory "release-routine" (2 entries).');
  assert.equal(await store.save({ name: 'user-language', description: 'Answers in Russian, plain words', content: 'Russian, without jargon.' }), 'Updated memory "user-language" (2 entries).');
  assert.deepEqual((await readdir(dir)).sort(), ['MEMORY.md', 'release-routine.md', 'user-language.md']);
  assert.equal(await readFile(path.join(dir, 'MEMORY.md'), 'utf8'), '# Memory\n\n- release-routine: Push, tag, release (2026-11-07)\n- user-language: Answers in Russian, plain words (2026-11-07)\n');
  assert.match(await store.read('user-language'), /^---\nname: user-language\ndescription: Answers in Russian, plain words\nupdated: 2026-11-07\n---\n\nRussian, without jargon\.\n$/);
});

test('search finds names, descriptions and text, and an empty query lists everything', async () => {
  const store = createMemoryStore(await tempDir(), { now: fixedNow });
  assert.equal(await store.search(''), 'Memory is empty.');
  await store.save({ name: 'strata-server', description: 'Where the local model runs', content: 'Strata on 192.168.1.154:8080.\nOne slot.' });
  await store.save({ name: 'deck-release', description: 'Release steps', content: 'Run the verify script before tagging.' });
  assert.equal(await store.search('SLOT'), '- strata-server: One slot.');
  assert.equal(await store.search('release'), '- deck-release: deck-release');
  assert.equal(await store.search('nothing like this'), 'No memory mentions "nothing like this".');
  assert.equal((await store.search('')).split('\n').length, 2);
});

test('bad names, empty or oversized entries and unknown entries are refused clearly', async () => {
  const store = createMemoryStore(await tempDir());
  await assert.rejects(store.save({ name: '../escape', description: 'x', content: 'x' }), /lowercase words joined by "-"/);
  await assert.rejects(store.save({ name: 'Has-Caps', description: 'x', content: 'x' }), /lowercase/);
  await assert.rejects(store.save({ name: 'ok', description: '  ', content: 'x' }), /description must not be empty/);
  await assert.rejects(store.save({ name: 'ok', description: 'x', content: '' }), /content must not be empty/);
  await assert.rejects(store.save({ name: 'ok', description: 'x', content: 'y'.repeat(8001) }), /split it/);
  await assert.rejects(store.read('missing'), /no memory named "missing"/);
  await assert.rejects(store.remove('missing'), /no memory named "missing"/);
});

test('the context index stays inside its byte budget and points to search for the rest', async () => {
  const store = createMemoryStore(await tempDir(), { now: fixedNow });
  assert.equal(store.indexText(4000), 'MEMORY: empty. Save lasting facts with memory_save.');
  for (let i = 0; i < 30; i++) await store.save({ name: `fact-${String(i).padStart(2, '0')}`, description: `Fact number ${i} with some words`, content: 'x' });
  const text = store.indexText(400);
  assert.ok(Buffer.byteLength(text) <= 400 + 60, 'only the overflow pointer may pass the budget');
  assert.match(text, /^MEMORY \(30 entries;/);
  assert.match(text, /- \.\.\. \d+ more; find them with memory_search\.$/);
  await store.remove('fact-00');
  assert.match(store.indexText(4000), /^MEMORY \(29 entries;/);
});

test('the plugin registers the four tools, the instructions and the index context', async () => {
  const dir = await tempDir();
  const tools = [];
  const sections = [];
  const contexts = [];
  apply({
    tools: { register: (definition) => tools.push(definition) },
    systemPrompt: {
      getSectionOrder: () => 2300,
      getContextOrder: () => 200,
      section: (value) => sections.push(value),
      context: (value) => contexts.push(value),
    },
  }, { dir, indexBytes: 2000 });
  assert.deepEqual(tools.map((tool) => tool.name), ['memory_save', 'memory_read', 'memory_search', 'memory_delete']);
  for (const tool of tools) assert.equal(tool.parameters.additionalProperties, false);
  assert.match(sections[0].text, /Never save secrets/);
  assert.equal(contexts[0].text(), 'MEMORY: empty. Save lasting facts with memory_save.');
  const save = tools.find((tool) => tool.name === 'memory_save');
  assert.match(await save.execute({ name: 'one', description: 'First', content: 'Body' }), /Saved memory "one"/);
  assert.match(contexts[0].text(), /^MEMORY \(1 entry;[^\n]*\n- one: First \(\d{4}-\d{2}-\d{2}\)$/);
  assert.deepEqual(save.output.render({}, 'done'), [{ type: 'text', text: 'done' }]);
});
