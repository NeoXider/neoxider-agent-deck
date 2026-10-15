const test = require("node:test");
const assert = require("node:assert/strict");
const { RETRY_PROMPT, describeEngineCrash } = require("../src/renderer/engine-crash.js");

const STRATA = "the engine stopped unexpectedly (exit code 3221226505); the next request restarts it";

test("a native abort reported in decimal is named, shown in hex and blamed on the engine", () => {
  const crash = describeEngineCrash(STRATA);
  assert.equal(crash.code, 3221226505);
  assert.equal(crash.hex, "0xC0000409");
  assert.equal(crash.name, "STATUS_STACK_BUFFER_OVERRUN");
  assert.equal(crash.title, "Model engine crashed: native abort (fail-fast) (0xC0000409)");
  assert.match(crash.summary, /exit code 0xC0000409, 3221226505/);
  assert.match(crash.summary, /Deck and Harness are still running/);
  assert.match(crash.explanation, /prompt too long/);
  assert.equal(crash.restartsItself, true);
  assert.equal(crash.original, STRATA, "the provider's own words are kept for the details");
});

test("well-known crash codes are recognised however the number is written", () => {
  const cases = [
    ["model server exited with code -1073741819", "0xC0000005", "access violation"],
    ["engine exit status 3221225725", "0xC00000FD", "stack overflow"],
    ["backend crashed: exit_code=0xC0000017", "0xC0000017", "out of memory"],
    ["llama-server terminated with exitCode: 3221225773", "0xC000012D", "out of memory (commit limit)"],
    ["inference failed: process returned 0xc0000005", "0xC0000005", "access violation"],
  ];
  for (const [text, hex, meaning] of cases) {
    const crash = describeEngineCrash(text);
    assert.ok(crash, text);
    assert.equal(crash.hex, hex, text);
    assert.equal(crash.meaning, meaning, text);
  }
  const killed = describeEngineCrash("engine exited with code 137");
  assert.equal(killed.meaning, "killed");
  assert.equal(killed.hex, "");
  assert.match(killed.explanation, /out-of-memory killer/);
});

test("ordinary failures are left as they are", () => {
  for (const text of [
    "400: No models loaded",
    "Provider rate limit (429)",
    "tool exited with code 1",
    "exit code 0",
    "the engine is warming up",
    "",
    null,
  ]) assert.equal(describeEngineCrash(text), null, String(text));
  // An unknown code counts only when the provider says its engine went down.
  assert.equal(describeEngineCrash("the engine stopped unexpectedly (exit code 7)").meaning, "an unexpected exit");
});

test("a large context suggests compacting, from the context meter or the provider's own count", () => {
  assert.equal(describeEngineCrash(STRATA).compactSuggested, false, "no context data, no guess");
  const fromMeter = describeEngineCrash(STRATA, { contextUsed: 153489, contextWindow: 262144 });
  assert.equal(fromMeter.compactSuggested, true);
  assert.equal(fromMeter.contextText, "This chat's context is large (153k of 262k tokens). Long prompts are a common trigger; compacting before you retry may help.");
  assert.equal(describeEngineCrash(STRATA, { contextUsed: 70000, contextWindow: 131072 }).compactSuggested, true, "over half the window");
  assert.equal(describeEngineCrash(STRATA, { contextUsed: 12000, contextWindow: 131072 }).compactSuggested, false);
  const fromProvider = describeEngineCrash(`${STRATA}; phase=reading the prompt prompt_tokens=153489`);
  assert.equal(fromProvider.compactSuggested, true);
  assert.match(fromProvider.contextText, /\(153k tokens\)/);
});

test("Retry asks the model to resume rather than start over", () => {
  assert.match(RETRY_PROMPT, /Continue with the previous request/);
  assert.match(RETRY_PROMPT, /without repeating completed work/);
});
