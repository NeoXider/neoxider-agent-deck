import { readdirSync, readFileSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

// One fact per Markdown file, so an entry can be read, fixed or deleted on its own, and an
// index derived from the files rather than kept beside them, so the two never disagree.
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_NAME = 64;
const MAX_DESCRIPTION = 200;
const MAX_CONTENT = 8000;
const INDEX_FILE = 'MEMORY.md';

export function checkName(name) {
  if (typeof name !== 'string' || name.length > MAX_NAME || !NAME.test(name)) {
    throw new Error(`memory name must be lowercase words joined by "-", at most ${MAX_NAME} characters (got ${JSON.stringify(name)})`);
  }
  return name;
}

function oneLine(text, limit, field) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (value === '') throw new Error(`memory ${field} must not be empty`);
  if (value.length > limit) throw new Error(`memory ${field} must be at most ${limit} characters`);
  return value;
}

function parseEntry(name, text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  const fields = {};
  for (const line of (match?.[1] ?? '').split(/\r?\n/)) {
    const field = /^([a-z]+):\s*(.*)$/.exec(line);
    if (field) fields[field[1]] = field[2];
  }
  return { name, description: fields.description ?? '', updated: fields.updated ?? '', body: (match?.[2] ?? text).trim() };
}

async function writeAtomic(file, text) {
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, text, 'utf8');
  await rename(temporary, file);
}

export function createMemoryStore(dir, { now = () => new Date() } = {}) {
  const fileOf = (name) => path.join(dir, `${checkName(name)}.md`);

  const entryFiles = (names) => names.filter((file) => file.endsWith('.md') && file !== INDEX_FILE && NAME.test(file.slice(0, -3))).sort();

  async function entries() {
    let names;
    try {
      names = await readdir(dir);
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
    const found = [];
    for (const file of entryFiles(names)) found.push(parseEntry(file.slice(0, -3), await readFile(path.join(dir, file), 'utf8')));
    return found;
  }

  // The prompt assembler reads context text synchronously, once per request. Reading the
  // few small files then keeps the index current when several agents write to it.
  function entriesSync() {
    let names;
    try {
      names = readdirSync(dir);
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
    return entryFiles(names).map((file) => parseEntry(file.slice(0, -3), readFileSync(path.join(dir, file), 'utf8')));
  }

  const indexLine = (entry) => `- ${entry.name}: ${entry.description}${entry.updated ? ` (${entry.updated})` : ''}`;

  async function writeIndex() {
    const lines = (await entries()).map(indexLine);
    await writeAtomic(path.join(dir, INDEX_FILE), `# Memory\n\n${lines.join('\n')}${lines.length ? '\n' : ''}`);
    return lines.length;
  }

  return {
    dir,
    entries,

    async save({ name, description, content }) {
      const entryName = checkName(name);
      const summary = oneLine(description, MAX_DESCRIPTION, 'description');
      const body = String(content ?? '').trim();
      if (body === '') throw new Error('memory content must not be empty');
      if (body.length > MAX_CONTENT) throw new Error(`memory content must be at most ${MAX_CONTENT} characters; split it into several entries`);
      await mkdir(dir, { recursive: true });
      const file = fileOf(entryName);
      let existed = true;
      try {
        await readFile(file, 'utf8');
      } catch {
        existed = false;
      }
      const updated = now().toISOString().slice(0, 10);
      await writeAtomic(file, `---\nname: ${entryName}\ndescription: ${summary}\nupdated: ${updated}\n---\n\n${body}\n`);
      const total = await writeIndex();
      return `${existed ? 'Updated' : 'Saved'} memory "${entryName}" (${total} entr${total === 1 ? 'y' : 'ies'}).`;
    },

    async read(name) {
      try {
        return await readFile(fileOf(name), 'utf8');
      } catch (error) {
        if (error?.code === 'ENOENT') throw new Error(`no memory named "${name}"; use memory_search to find one`);
        throw error;
      }
    },

    async search(query, limit = 20) {
      const all = await entries();
      const needle = String(query ?? '').trim().toLowerCase();
      if (needle === '') return all.length ? all.map(indexLine).join('\n') : 'Memory is empty.';
      const hits = [];
      for (const entry of all) {
        const where = [entry.name, entry.description, ...entry.body.split(/\r?\n/)].find((line) => line.toLowerCase().includes(needle));
        if (where !== undefined) hits.push(`- ${entry.name}: ${where.trim().slice(0, 200)}`);
        if (hits.length >= limit) break;
      }
      return hits.length ? hits.join('\n') : `No memory mentions "${query}".`;
    },

    async remove(name) {
      const file = fileOf(name);
      try {
        await rm(file);
      } catch (error) {
        if (error?.code === 'ENOENT') throw new Error(`no memory named "${name}"`);
        throw error;
      }
      const total = await writeIndex();
      return `Deleted memory "${name}" (${total} left).`;
    },

    /** The index as model context, cut to a byte budget so a large memory cannot crowd the window. */
    indexText(budgetBytes) {
      const all = entriesSync();
      if (all.length === 0) return 'MEMORY: empty. Save lasting facts with memory_save.';
      const head = `MEMORY (${all.length} entr${all.length === 1 ? 'y' : 'ies'}; read one with memory_read before relying on it):`;
      const lines = [head];
      let used = Buffer.byteLength(head);
      for (const [position, entry] of all.entries()) {
        const line = indexLine(entry);
        const left = all.length - position;
        if (used + Buffer.byteLength(line) + 1 > budgetBytes) {
          lines.push(`- ... ${left} more; find them with memory_search.`);
          break;
        }
        lines.push(line);
        used += Buffer.byteLength(line) + 1;
      }
      return lines.join('\n');
    },
  };
}
