const test = require("node:test"), assert = require("node:assert/strict");

test("large local image contexts recover in text chunks without changing original blocks", async () => {
  const { createCompactionEngine } = await import("../integrations/dsh-lmstudio-budget/compaction.mjs");
  const calls = [];
  class Base {
    constructor() { this.ctx = { tokenMeter: { estimateMessage: () => 15000 } }; }
    async summarize(input) { calls.push(input); return { summary: [{ type: "text", text: "Facts retained" }], provider: "openai", model: "local", maxTokens: 70000 }; }
  }
  const Engine = createCompactionEngine(Base), engine = new Engine();
  const input = { messages: [{ role: "user", content: [{ type: "text", text: "x".repeat(110000) }, { type: "image", attachment: { attachmentId: "original" } }] }] };
  const before = JSON.stringify(input);
  const result = await engine.summarize(input, { options: { provider: "openai" } });
  assert.equal(calls.length, 3);
  assert.ok(calls.every(part => part.messages.every(message => message.content.every(block => block.type === "text"))));
  assert.equal(JSON.stringify(input), before);
  assert.match(result.summary[0].text, /Facts retained/);
});

test("unrelated cloud providers keep their native summary path", async () => {
  const { createCompactionEngine } = await import("../integrations/dsh-lmstudio-budget/compaction.mjs");
  let seen;
  class Base { async summarize(input) { seen = input; return { summary: [] }; } }
  const Engine = createCompactionEngine(Base), input = { messages: [] };
  await new Engine().summarize(input, { options: { provider: "cloud" } });
  assert.equal(seen, input);
});

test("only local auxiliary summaries disable thinking, without changing the main LLM or agent", async () => {
  const { createCompactionEngine } = await import("../integrations/dsh-lmstudio-budget/compaction.mjs");
  const seen = [];
  const llm = { stream: options => { seen.push(options); return { summary: [{ type: "text", text: "Summary" }] }; } };
  class Base {
    constructor() { this.ctx = { llm, tokenMeter: { estimateMessage: () => 100 } }; }
    async summarize() { return this.ctx.llm.stream({ purpose: "compaction", provider: "openai", maxTokens: 16384 }); }
  }
  const Engine = createCompactionEngine(Base), engine = new Engine(), agent = { options: { provider: "openai", reasoningEffort: "xhigh" } };
  await engine.summarize({ messages: [] }, agent);
  assert.equal(seen[0].reasoningEffort, "off");
  assert.equal(agent.options.reasoningEffort, "xhigh");
  assert.equal(engine.ctx.llm, llm);
});
