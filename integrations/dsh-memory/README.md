# Memory for DSH

Local integration for DSH 0.2.2-rc.1. It gives an agent persistent memory across
sessions without a database, network access or third-party code.

Each fact is one Markdown file in a memory directory (default `~/.dsh/memory`), with
front matter for its name, a one-line description and the date it was last updated.
`MEMORY.md` beside them is an index derived from the files, so the two never disagree.
The index reaches the model as runtime context, cut to a byte budget (4,000 by
default); being runtime context, it changes without touching the system prompt that a
local server keeps in its prompt cache.

Tools:

- `memory_save` saves or overwrites one entry (`name`, `description`, `content`);
- `memory_read` returns one entry in full;
- `memory_search` finds entries by name, description or text; an empty query lists them all;
- `memory_delete` removes an entry that is wrong or no longer true.

A system-prompt section tells the model when to check memory and what is worth
keeping: lasting, non-obvious facts such as the user's preferences and corrections,
decisions and their reasons. It must never keep secrets, temporary task state, or
anything the code or git history already records. Names are lowercase words joined
by `-`, so an entry can never be written outside the directory, and one entry is at
most 8,000 characters.

## Local installation

Mount it inside the agent preset that should remember, so only that preset gets the
tools:

```yaml
plugins:
  - id: memory
    name: file:///D:/Git/neoxider-agent-deck/integrations/dsh-memory/index.js
    config:
      dir: C:/Users/me/.dsh/memory   # optional
      indexBytes: 4000              # optional
```

Run `npm test` from the Deck repository, or `node --test
integrations/dsh-memory/memory.test.mjs` for focused coverage.
