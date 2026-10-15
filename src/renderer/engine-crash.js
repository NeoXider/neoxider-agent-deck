// Turns "the engine stopped unexpectedly (exit code 3221226505)" into something a person
// can act on.
//
// A model provider that wraps a native inference engine reports the engine's death with
// its raw process exit code. On Windows that is an NTSTATUS printed in decimal, which says
// nothing to anyone: 3221226505 is 0xC0000409, a native fail-fast abort. The message also
// reads as if Deck or Harness had crashed, when both are fine and it is the provider's
// engine — often on another machine — that died. This names the code, says whose process
// it was, and, when the chat's context is large, points at the most common trigger.
(function exposeEngineCrash(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.engineCrash = api;
}(typeof globalThis === "object" ? globalThis : this, () => {
  // Windows NTSTATUS codes a crashing native engine exits with.
  const NTSTATUS = new Map([
    [0xC0000409, ["STATUS_STACK_BUFFER_OVERRUN", "native abort (fail-fast)", "Its native code stopped itself on purpose: an internal check failed or it called abort(). Local engines typically do this on a prompt too long for the model or for the memory they were given."]],
    [0xC0000005, ["STATUS_ACCESS_VIOLATION", "access violation", "It touched memory it does not own: a bug in the engine build, or a GPU driver problem."]],
    [0xC00000FD, ["STATUS_STACK_OVERFLOW", "stack overflow", "It ran out of stack space, usually in deeply recursive code."]],
    [0xC0000017, ["STATUS_NO_MEMORY", "out of memory", "It could not allocate memory. A smaller context or model, or fewer programs running on that machine, may help."]],
    [0xC000012D, ["STATUS_COMMITMENT_LIMIT", "out of memory (commit limit)", "Windows refused it more memory because RAM plus page file was exhausted. A larger page file, a smaller context or a smaller model may help."]],
    [0xC0000374, ["STATUS_HEAP_CORRUPTION", "heap corruption", "Its memory was corrupted, which points at a bug or an incompatible build of the engine."]],
    [0xC000001D, ["STATUS_ILLEGAL_INSTRUCTION", "illegal CPU instruction", "It was built for CPU features that machine lacks, for example AVX-512."]],
    [0xC0000135, ["STATUS_DLL_NOT_FOUND", "missing DLL", "A library it needs, such as a CUDA runtime, was not found."]],
    [0xC0000142, ["STATUS_DLL_INIT_FAILED", "DLL initialization failed", "A library it loads, often a GPU runtime, failed to start."]],
    [0xC0000094, ["STATUS_INTEGER_DIVIDE_BY_ZERO", "integer division by zero", "A bug in the engine."]],
    [0xC0000420, ["STATUS_ASSERTION_FAILURE", "assertion failure", "An internal consistency check failed."]],
    [0xC0000602, ["STATUS_FAIL_FAST_EXCEPTION", "fail-fast exception", "Its native code stopped itself on purpose after detecting a fatal error."]],
    [0xE06D7363, ["", "unhandled C++ exception", "An error inside the engine was never caught."]],
    [0xC000013A, ["STATUS_CONTROL_C_EXIT", "stopped by Ctrl+C or a closed console", "Its console window was closed or interrupted."]],
  ]);
  // POSIX: a process killed by a signal exits with 128 + the signal number.
  const SIGNALS = new Map([
    [134, ["SIGABRT", "native abort", "Its native code called abort() after an internal check failed."]],
    [137, ["SIGKILL", "killed", "Something killed it outright; on Linux that is usually the out-of-memory killer."]],
    [139, ["SIGSEGV", "segmentation fault", "It touched memory it does not own: a bug in the engine build, or a GPU driver problem."]],
  ]);
  const EXIT_CODE = /\b(?:exit(?:ed)?(?:\s+with)?[\s_-]*(?:code|status)|exitcode|return\s+code)\s*[:=]?\s*\(?\s*(-?0x[0-9a-f]{1,8}|-?\d{1,10})\b/i;
  const BARE_NTSTATUS = /\b0x(c0000[0-9a-f]{3}|e06d7363)\b/i;
  // Narrow on purpose: a tool or a Harness worker that exits with a code is not the engine.
  const CRASH_WORDING = /\b(?:engine|model server|llama(?:\.cpp)?|inference server|crash(?:ed)?|stopped unexpectedly)\b/i;
  const PROMPT_TOKENS = /\bprompt[_\s-]?tokens?\D{0,3}(\d{4,})/i;
  const LARGE_CONTEXT_TOKENS = 100000;
  const LARGE_CONTEXT_SHARE = 0.5;
  // Sent by Retry. The engine died before the turn finished, so the model is asked to pick
  // up the same request rather than given a new one.
  const RETRY_PROMPT = "The model engine crashed before it could finish. Continue with the previous request without repeating completed work.";

  function hex(code) {
    return `0x${(code >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
  }

  function parseCode(text) {
    const match = EXIT_CODE.exec(text);
    const raw = match?.[1] || (BARE_NTSTATUS.exec(text) ? `0x${BARE_NTSTATUS.exec(text)[1]}` : "");
    if (!raw) return null;
    const negative = raw.startsWith("-");
    const digits = negative ? raw.slice(1) : raw;
    const value = /^0x/i.test(digits) ? Number.parseInt(digits.slice(2), 16) : Number.parseInt(digits, 10);
    if (!Number.isFinite(value)) return null;
    return negative ? -value : value;
  }

  function formatTokens(value) {
    return value >= 1000 ? `${Math.round(value / 1000)}k` : String(Math.round(value));
  }

  // { contextUsed, contextWindow } is the chat's context meter, when the caller has one.
  function describeEngineCrash(message, { contextUsed, contextWindow } = {}) {
    const text = String(message ?? "");
    const code = parseCode(text);
    if (code === null) return null;
    const unsigned = code >>> 0;
    const known = NTSTATUS.get(unsigned) || (code > 128 && code < 160 ? SIGNALS.get(code) : null);
    // An unknown code is only a crash when the message says so; "exit code 1" alone is not.
    if (!known && !CRASH_WORDING.test(text)) return null;
    if (!known && code === 0) return null;
    const windowsCode = unsigned >= 0xC0000000;
    const shown = windowsCode ? hex(unsigned) : String(code);
    const [name = "", meaning = "an unexpected exit", explanation = "The engine process ended on its own."] = known || [];
    const used = Math.max(Number(contextUsed) || 0, Number(PROMPT_TOKENS.exec(text)?.[1]) || 0);
    const total = Number(contextWindow) || 0;
    const compactSuggested = used >= LARGE_CONTEXT_TOKENS || (total > 0 && used / total >= LARGE_CONTEXT_SHARE);
    return {
      code,
      hex: windowsCode ? hex(unsigned) : "",
      name,
      meaning,
      title: `Model engine crashed: ${meaning} (${shown})`,
      summary: `The model provider's engine stopped (exit code ${shown}${windowsCode && String(code) !== shown ? `, ${code}` : ""}). Deck and Harness are still running.`,
      explanation,
      restartsItself: /\bnext request (?:restarts|will restart)|\brestart(?:s|ing)? (?:it|automatically)\b/i.test(text),
      compactSuggested,
      contextText: compactSuggested
        ? `This chat's context is large (${formatTokens(used)}${total > 0 ? ` of ${formatTokens(total)}` : ""} tokens). Long prompts are a common trigger; compacting before you retry may help.`
        : "",
      original: text,
    };
  }

  return { RETRY_PROMPT, describeEngineCrash };
}));
