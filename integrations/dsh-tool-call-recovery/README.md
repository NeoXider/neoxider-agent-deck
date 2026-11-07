# Tool call recovery for DSH

Local integration for DSH 0.2.1-rc.4. It runs tool calls that a local model wrote as
text.

A local server such as Strata or llama-server turns a model's `<tool_call>` text into a
structured call only when the function name is a declared tool. Qwen-family models often
write the names they were trained on (`read_file`, `run_shell_command`) or an MCP-style
name for a native tool (`mcp__capability_hub`). The server then returns the whole call as
message text, so nothing runs and the turn ends.

The plugin wraps every model stream (`llm/stream`) that offers tools. When a reply has no
structured tool call and its text ends in written calls, each name is matched to a tool
the request declared, in this order:

1. the exact name, ignoring case and `-` against `_`;
2. a segment of an MCP-style name (`mcp__capability_hub` is `capability_hub`);
3. a known alias (`read_file` is `read`, `run_shell_command` is `pwsh` or `bash`,
   `search_file_content` is `grep`, and so on);
4. a unique word prefix (`read_file` is `read` when no other tool starts that way).

Argument names other agents use (`path` for `file_path`, `old_str` for `old_string`) are
renamed when the tool lacks them, and values are typed by the tool's schema. The calls
then run as real calls, and the message keeps only the text before them. Qwen's XML form
and the JSON form are both read.

Nothing changes when any written name does not resolve, when the call is quoted in a code
fence or followed by more text, when it is cut off, or when the reply hit its token limit.
No alias tool is registered, so the prompt does not grow, and a call only ever reaches a
tool the model was offered, under that tool's own permissions.

## Local installation

Add this entry to the active profile's `cordis.patch.yml`, adjusting the path:

```yaml
- insert:
    - id: neoxider-tool-call-recovery
      name: D:/Git/neoxider-agent-deck/integrations/dsh-tool-call-recovery/index.js
```

With profile `patchReload: live` it loads without restarting the server. To load edited
source, delete the entry, let the profile reload, then add it back under a new URL, for
example `'file:///D:/Git/neoxider-agent-deck/integrations/dsh-tool-call-recovery/index.js?v=2'`.
Node caches the module by URL, and changing only an entry's `name` does not re-create
its plugin. Removing the entry restores the server's own parsing.

Run `npm test` from the Deck repository, or `node --test
integrations/dsh-tool-call-recovery/recovery.test.mjs` for focused coverage.
