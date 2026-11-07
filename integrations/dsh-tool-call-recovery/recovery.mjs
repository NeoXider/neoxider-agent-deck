import { randomUUID } from 'node:crypto';

// Local servers such as Strata and llama-server turn a model's `<tool_call>` text into a
// structured call only when the function name is a declared tool. Qwen-family models often
// write the names they were trained on (read_file, run_shell_command) or an MCP-style name
// for a native tool (mcp__capability_hub), and every such call arrives as message text:
// nothing runs and the turn ends. This recovers those calls inside the model stream, and
// only ever as calls to tools the request declared. A call whose name means no declared
// tool still becomes a call, so the model is told the name is unknown and can retry,
// instead of the turn ending on the written call.

// Names other agents use for the same job, mapped to DSH tools in order of preference.
const ALIASES = new Map(Object.entries({
  read_file: ['read'], view_file: ['read'], open_file: ['read'], read_text_file: ['read'], cat: ['read'],
  write_file: ['write'], create_file: ['write'], write_to_file: ['write'], save_file: ['write'],
  edit_file: ['edit', 'str_replace_editor'], replace_in_file: ['edit', 'str_replace_editor'],
  str_replace: ['edit', 'str_replace_editor'], replace: ['edit', 'str_replace_editor'],
  run_shell_command: ['pwsh', 'bash'], run_command: ['pwsh', 'bash'], execute_command: ['pwsh', 'bash'],
  shell: ['pwsh', 'bash'], terminal: ['pwsh', 'bash'], powershell: ['pwsh'], bash: ['bash', 'pwsh'],
  search_file_content: ['grep'], search_files: ['grep'], grep_search: ['grep'], ripgrep: ['grep'], rg: ['grep'],
  find_files: ['glob'], file_search: ['glob'], list_files: ['glob'], list_directory: ['glob'], ls: ['glob'],
  fetch: ['web_fetch'], fetch_url: ['web_fetch'], url_fetch: ['web_fetch'],
  search_web: ['web_search'], websearch: ['web_search'], google_search: ['web_search'],
  todo: ['todo_write'], todos: ['todo_write'], update_todos: ['todo_write'], write_todos: ['todo_write'],
  ask_user: ['ask_user_question'], ask_question: ['ask_user_question'],
}));

// Argument names other agents use, keyed by the DSH parameter they stand for. A written key
// is renamed only when the target tool lacks it and exactly one of its parameters claims it.
const KEY_ALIASES = {
  file_path: ['path', 'file', 'filename', 'filepath', 'file_name', 'absolute_path', 'target_file'],
  path: ['directory', 'dir', 'dir_path', 'directory_path', 'folder', 'root', 'cwd'],
  content: ['contents', 'text', 'file_text', 'data'],
  old_string: ['old_str', 'old_text', 'search'],
  new_string: ['new_str', 'new_text', 'replacement'],
  command: ['cmd', 'script', 'shell_command'],
  pattern: ['glob', 'regex', 'query', 'search_pattern'],
  url: ['uri', 'link', 'href'],
  query: ['q', 'search_query'],
};

const normalize = (name) => name.trim().toLowerCase().replace(/-/g, '_');
const only = (list) => (list.length === 1 ? list[0] : undefined);

// The start of the error a call to an undeclared name gets, from DSH itself or from this
// plugin's hint. It marks that call in the history the next request carries.
export const UNKNOWN_TOOL = 'unknown tool "';

/** The declared tool a written function name means, or undefined when it is not clear. */
export function resolveTool(written, names) {
  if (names.includes(written)) return written;
  const target = normalize(written);
  // `mcp__server__tool`, and the `tools.read` / `functions.read` that code-mode prompts teach.
  const segments = target.split(/__|\./);
  return only(names.filter((name) => normalize(name) === target))
    ?? only(names.filter((name) => segments.includes(normalize(name))))
    ?? (ALIASES.get(segments.at(-1)) ?? []).find((name) => names.includes(name))
    ?? only(names.filter((name) => {
      const declared = normalize(name);
      return target.startsWith(`${declared}_`) || declared.startsWith(`${target}_`);
    }));
}

function typeOf(schema) {
  const type = schema?.type;
  return Array.isArray(type) ? type.find((item) => item !== 'null') : type;
}

function coerce(value, type) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  switch (type) {
    case 'boolean':
      return trimmed === 'true' ? true : trimmed === 'false' ? false : value;
    case 'number':
    case 'integer':
      return trimmed !== '' && Number.isFinite(Number(trimmed)) ? Number(trimmed) : value;
    case 'object':
    case 'array':
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    default:
      return value;
  }
}

/** Arguments renamed and typed against the declared tool's parameter schema. */
export function fitArguments(args, parameters) {
  const properties = parameters?.properties ?? {};
  const fitted = {};
  for (const [key, value] of Object.entries(args)) {
    let name = key;
    if (!Object.hasOwn(properties, key)) {
      const claims = Object.keys(properties).filter((property) => KEY_ALIASES[property]?.includes(key) && !Object.hasOwn(args, property));
      name = only(claims) ?? key;
    }
    fitted[name] = coerce(value, typeOf(properties[name]));
  }
  return fitted;
}

// Qwen's XML call format puts every value on its own lines, so one newline on each side
// belongs to the format rather than to the value.
const parameterText = (raw) => raw.replace(/^\r?\n/, '').replace(/\r?\n$/, '');

function parseXmlCall(body) {
  const call = /^<function=([^>\n]+)>([\s\S]*)<\/function>$/.exec(body);
  if (!call) return undefined;
  const args = {};
  const rest = call[2].replace(/<parameter=([^>\n]+)>([\s\S]*?)<\/parameter>/g, (_match, key, raw) => {
    args[key.trim()] = parameterText(raw);
    return '';
  });
  // Anything left between the parameters is not the format this parses.
  return rest.trim() === '' ? { name: call[1].trim(), arguments: args } : undefined;
}

function parseJsonCall(body) {
  try {
    const value = JSON.parse(body);
    const args = typeof value.arguments === 'string' ? JSON.parse(value.arguments) : value.arguments;
    if (typeof value.name !== 'string') return undefined;
    if (args !== undefined && (args === null || typeof args !== 'object' || Array.isArray(args))) return undefined;
    return { name: value.name, arguments: args ?? {} };
  } catch {
    return undefined;
  }
}

/**
 * Split text that ENDS in one or more written tool calls into the prose before them and the
 * calls. Text with anything after the calls, a call inside a code fence, or a call cut off
 * before `</function>` is not a call the model meant to make, so it yields nothing.
 */
export function parseTrailingCalls(text) {
  const open = '<tool_call>';
  const close = '</tool_call>';
  const start = text.indexOf(open);
  if (start < 0) return undefined;
  const prose = text.slice(0, start);
  if ((prose.match(/```/g)?.length ?? 0) % 2 === 1) return undefined;
  const calls = [];
  let rest = text.slice(start);
  while ((rest = rest.trimStart()) !== '') {
    if (!rest.startsWith(open)) return undefined;
    const end = rest.indexOf(close);
    const body = (end < 0 ? rest.slice(open.length) : rest.slice(open.length, end)).trim();
    let call = body.startsWith('{') ? parseJsonCall(body) : parseXmlCall(body);
    // A closed call the model meant to make, written in no form this reads.
    if (!call && end >= 0) call = { name: /^<function=([^>\n]+)>/.exec(body)?.[1].trim() ?? '', arguments: {}, unreadable: true };
    if (!call) return undefined;
    calls.push(call);
    rest = end < 0 ? '' : rest.slice(end + close.length);
  }
  return calls.length > 0 ? { prose: prose.trimEnd(), calls } : undefined;
}

// Keys a call carries, with those of an `arguments`-style wrapper a confused model nests
// its real arguments in.
function writtenKeys(args) {
  const keys = new Set(Object.keys(args));
  for (const wrapper of ['arguments', 'args', 'parameters', 'params', 'input']) {
    let value = args[wrapper];
    if (typeof value === 'string') {
      try {
        value = JSON.parse(value);
      } catch {
        value = undefined;
      }
    }
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) for (const key of Object.keys(value)) keys.add(key);
  }
  return keys;
}

function distance(left, right) {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(previous[column] + 1, current[column - 1] + 1, previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[right.length];
}

/** Declared tools a call to an undeclared name most likely meant, best first. */
export function suggestTools(written, args, tools, limit = 3) {
  const keys = writtenKeys(args);
  const target = normalize(written);
  return tools
    .map((tool, order) => {
      const name = normalize(tool.name);
      const shared = Object.keys(tool.parameters?.properties ?? {}).filter((key) => keys.has(key)).length;
      const near = target.length >= 3 && (name.includes(target) || target.includes(name) || distance(name, target) <= 2);
      return { tool, order, score: shared * 2 + (near ? 3 : 0) };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.order - right.order)
    .slice(0, limit)
    .map((entry) => entry.tool);
}

/** What the model is told when it calls a name that is none of its tools. */
export function unknownToolHint(call, tools) {
  const written = call.name || 'tool_call';
  const problem = call.unreadable
    ? `${UNKNOWN_TOOL}${written}": the call was written as text in a form that could not be read`
    : `${UNKNOWN_TOOL}${written}": it is not one of this agent's tools`;
  const advice = "Make the call again as a real tool call: the exact name of a declared tool, with that tool's own parameters as the arguments.";
  const suggestions = suggestTools(written, call.arguments ?? {}, tools).map((tool) => {
    const parameters = Object.keys(tool.parameters?.properties ?? {});
    return parameters.length === 0 ? tool.name : `${tool.name} (${parameters.slice(0, 8).join(', ')})`;
  });
  // In code mode only run_code is declared, and every other tool is a function on the
  // `tools` object of its program, so a model reaching for one of those writes its name.
  const codeMode = tools.some((tool) => tool.name === 'run_code')
    ? " Here the other tools are functions inside a run_code program: put `return await tools.NAME({ ... })` in its code, with the tool's own name and arguments."
    : '';
  return `${problem}. ${advice}${codeMode}${suggestions.length === 0 ? '' : ` Closest declared tools: ${suggestions.join('; ')}.`}`;
}

// A name the history can carry: providers accept only these characters in a call name.
// It is never an offered tool's name, or the call would run that tool.
function unknownName(written, known) {
  const safe = written.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
  return safe !== '' && !known.includes(safe) ? safe : 'unknown_tool';
}

/**
 * The written calls as calls to declared tools. A call naming an offered tool exactly that
 * is not declared (a deferred one) passes as written, for DSH to answer. Any other name
 * that resolves to nothing becomes a call carrying `hint`, the error that answers it, or,
 * with `unresolved` false, leaves the text unrecovered.
 */
export function recoverCalls(text, tools, { known = tools.map((tool) => tool.name), unresolved = true } = {}) {
  const parsed = parseTrailingCalls(text);
  if (!parsed) return undefined;
  const names = tools.map((tool) => tool.name);
  const calls = [];
  for (const call of parsed.calls) {
    const name = call.unreadable ? undefined : resolveTool(call.name, names);
    if (name !== undefined) {
      const tool = tools.find((candidate) => candidate.name === name);
      calls.push({ name, arguments: fitArguments(call.arguments, tool?.parameters) });
    } else if (!call.unreadable && known.includes(call.name)) {
      calls.push({ name: call.name, arguments: call.arguments });
    } else if (unresolved) {
      calls.push({ name: unknownName(call.name, known), arguments: call.arguments, hint: unknownToolHint(call, tools) });
    } else {
      return undefined;
    }
  }
  return { prose: parsed.prose, calls };
}

function messageText(message) {
  const content = Array.isArray(message?.content) ? message.content : [];
  return content.map((block) => (block?.type === 'text' ? block.text : '')).join('\n');
}

/**
 * How many tool results in a row, since the user last wrote, answered calls to unknown
 * names. A model that keeps writing them is not corrected by one more error.
 */
export function unknownToolStreak(messages = []) {
  let streak = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'user') break;
    if (message?.role !== 'tool') continue;
    if (!message.isError || !messageText(message).includes(UNKNOWN_TOOL)) break;
    streak += 1;
  }
  return streak;
}

/**
 * Pass a model stream through, and when it ends with no structured tool call and its last
 * text block ends in written calls, replace that text with the prose before them and emit
 * the calls as real tool-call blocks.
 *
 * Text block ends are held back until the stream finishes, because a block's end fixes its
 * final text; the deltas still stream live. The provider's replay state describes the
 * message as it was written, so a recovered message drops it and the next request rebuilds
 * that message from its blocks.
 */
export async function* recoverToolCalls(stream, tools, {
  newId = () => `call_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
  known,
  unresolved = true,
  // Told the id and hint of each call to an unknown name, before that call is emitted.
  onUnknown = () => {},
} = {}) {
  const texts = new Map();
  const heldEnds = new Map();
  let structured = false;
  let lastText;
  let maxIndex = -1;

  function* release() {
    yield* heldEnds.values();
    heldEnds.clear();
  }

  for await (const chunk of stream) {
    if (Number.isInteger(chunk.index)) maxIndex = Math.max(maxIndex, chunk.index);
    if (structured) {
      yield chunk;
      continue;
    }
    if (chunk.type === 'tool-call-delta'
      || (chunk.type === 'block-start' && chunk.blockType === 'tool-call')
      || (chunk.type === 'block-end' && chunk.block?.type === 'tool-call')) {
      structured = true;
      yield* release();
      yield chunk;
      continue;
    }
    if (chunk.type === 'text-delta') {
      texts.set(chunk.index, (texts.get(chunk.index) ?? '') + (chunk.text ?? ''));
      lastText = chunk.index;
      yield chunk;
      continue;
    }
    if (chunk.type === 'block-end' && chunk.block?.type === 'text') {
      texts.set(chunk.index, chunk.block.text ?? texts.get(chunk.index) ?? '');
      heldEnds.set(chunk.index, chunk);
      lastText = chunk.index;
      continue;
    }
    if (chunk.type !== 'finish') {
      yield chunk;
      continue;
    }

    const kind = chunk.reason?.kind;
    const recovered = (kind === 'stop' || kind === 'tool-calls') && lastText !== undefined
      ? recoverCalls(texts.get(lastText) ?? '', tools, { ...(known === undefined ? {} : { known }), unresolved })
      : undefined;
    if (!recovered) {
      yield* release();
      yield chunk;
      continue;
    }
    const held = heldEnds.get(lastText);
    heldEnds.delete(lastText);
    yield* release();
    yield { type: 'block-end', index: lastText, block: { ...(held?.block ?? { type: 'text' }), text: recovered.prose } };
    for (const call of recovered.calls) {
      const index = ++maxIndex;
      const id = newId();
      if (call.hint !== undefined) onUnknown(id, call.hint);
      const args = JSON.stringify(call.arguments);
      yield { type: 'block-start', index, blockType: 'tool-call' };
      yield { type: 'tool-call-delta', index, id, name: call.name, argumentsDelta: args };
      yield { type: 'block-end', index, block: { type: 'tool-call', id, name: call.name, arguments: args } };
    }
    const { replayState: _written, ...finish } = chunk;
    yield { ...finish, reason: kind === 'stop' ? { kind: 'tool-calls' } : chunk.reason };
  }
  yield* release();
}
