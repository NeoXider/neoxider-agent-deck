import os from 'node:os';
import path from 'node:path';
import { createMemoryStore } from './memory-store.mjs';

export const name = 'dsh-memory';
export const inject = ['tools', 'systemPrompt'];

const INSTRUCTIONS = 'Persistent memory survives across sessions as small Markdown entries managed by the memory tools; '
  + 'its index is in the runtime context under MEMORY. Check it at the start of a task and read an entry with memory_read '
  + 'before relying on it. What you observe now wins over memory: fix or delete an entry that turns out wrong. '
  + 'Save only lasting, non-obvious facts: the user\'s preferences and corrections, decisions and their reasons, project facts '
  + 'the code does not record, and pointers to external resources. One fact per entry with absolute dates; update an existing '
  + 'entry (same name) instead of adding a duplicate. Never save secrets, credentials, temporary task state, or anything the '
  + 'code or git history already records.';

const text = (description) => ({ type: 'string', description });
const object = (properties, required) => ({ type: 'object', properties, required, additionalProperties: false });
const NAME = text('Entry name: lowercase words joined by "-", e.g. user-prefers-russian.');

function textTool(toolName, description, parameters, run) {
  return {
    name: toolName,
    description,
    parameters,
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value ?? '') }],
    },
    execute: async (args) => run(args ?? {}),
  };
}

export function apply(ctx, config = {}) {
  const store = createMemoryStore(config.dir || path.join(os.homedir(), '.dsh', 'memory'));
  const budget = Number.isSafeInteger(config.indexBytes) && config.indexBytes > 0 ? config.indexBytes : 4000;

  for (const definition of [
    textTool('memory_save', 'Save or update one lasting fact in persistent memory. An existing name is overwritten.', object({
      name: NAME,
      description: text('One line saying what the entry holds; it is what the index shows.'),
      content: text('The fact itself in Markdown. For a preference or correction, add why and how to apply it.'),
    }, ['name', 'description', 'content']), (args) => store.save(args)),
    textTool('memory_read', 'Read one memory entry in full.', object({ name: NAME }, ['name']), (args) => store.read(args.name)),
    textTool('memory_search', 'Find memory entries whose name, description or text contains the query; an empty query lists them all.',
      object({ query: text('Words to look for, case-insensitive.') }, []), (args) => store.search(args.query)),
    textTool('memory_delete', 'Delete one memory entry that is wrong or no longer true.', object({ name: NAME }, ['name']),
      (args) => store.remove(args.name)),
  ]) ctx.tools.register(definition);

  ctx.systemPrompt.section({
    name: 'tool:memory',
    order: ctx.systemPrompt.getSectionOrder('TOOL_SESSION_QUERY') + 1,
    text: INSTRUCTIONS,
    interpolate: false,
  });
  // The index changes as entries are saved, so it travels as runtime context rather than
  // in the system prompt, whose prefix stays byte-identical for the server's prompt cache.
  ctx.systemPrompt.context({
    name: 'memory:index',
    order: ctx.systemPrompt.getContextOrder('HARNESS_SOURCE') + 1,
    interpolate: false,
    text: () => store.indexText(budget),
  });
}
