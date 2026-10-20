const test = require("node:test");
const assert = require("node:assert/strict");

const {
  priceFor,
  normalizeModelId,
  usageSpend,
  sessionSpend,
  formatUsd,
} = require("../src/renderer/model-pricing.js");

test("model ids normalize across gateway prefixes, dots and date suffixes", () => {
  assert.equal(normalizeModelId("anthropic/claude-opus-5.5"), "claude-opus-5-5");
  assert.equal(normalizeModelId("claude-opus-5-5"), "claude-opus-5-5");
  assert.equal(normalizeModelId("  Claude_Sonnet_5.5  "), "claude-sonnet-5-5");
  assert.equal(normalizeModelId(""), "");
});

test("an Anthropic model resolves to its list price, dated variants included", () => {
  const direct = priceFor("anthropic", "claude-opus-5-5");
  assert.deepEqual(
    { input: direct.input, output: direct.output, cacheRead: direct.cacheRead, cacheWrite: direct.cacheWrite },
    { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  );
  const dated = priceFor("anthropic", "claude-opus-4-5-20251101");
  assert.equal(dated.input, 5);
  assert.equal(dated.model, "claude-opus-4-5-20251101");
});

test("a gateway route to an Anthropic model still prices, and unknown models do not", () => {
  assert.equal(priceFor("routerai", "anthropic/claude-sonnet-5.5").output, 10);
  assert.equal(priceFor("lmstudio", "qwen3.8-flash-next-iq3_xxs"), null);
  assert.equal(priceFor("anthropic", ""), null);
});

test("spend adds input, output and both cache directions at per-million rates", () => {
  const price = priceFor("anthropic", "claude-opus-5-5");
  const spend = usageSpend({
    uncachedInputTokens: 1_000_000,
    outputTokens: 1_000_000,
    cacheReadTokens: 1_000_000,
    cacheWriteTokens: 1_000_000,
  }, price);
  assert.equal(spend.cost.input, 4);
  assert.equal(spend.cost.output, 20);
  assert.equal(spend.cost.cacheRead, 0.2);
  assert.equal(spend.cost.cacheWrite, 5);
  assert.equal(spend.total, 29.2);
});

test("the projection cache shape and the wire shape both count", () => {
  const price = priceFor("anthropic", "claude-opus-5-5");
  const nested = usageSpend({ totals: { uncachedInputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, last: null }, price);
  const wire = usageSpend({ uncachedInputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, price);
  assert.equal(nested.total, wire.total);
  assert.equal(nested.total, 4);
});

test("a session reports spend with its model, and reports nothing without a price", () => {
  const session = (model, provider = "anthropic") => ({
    projections: {
      values: {
        modelSelection: { lastUsed: { provider, model } },
        tokenUsage: { uncachedInputTokens: 302, outputTokens: 170_791, cacheReadTokens: 45_477_197, cacheWriteTokens: 480_327 },
      },
    },
  });
  const spend = sessionSpend(session("claude-opus-5-5"));
  assert.equal(spend.model, "claude-opus-5-5");
  assert.equal(spend.tokens.cacheRead, 45_477_197);
  assert.equal(formatUsd(spend.total), "$14.91");
  assert.equal(sessionSpend(session("qwen3.8-flash-next-iq3_xxs", "lmstudio")), null);
  assert.equal(sessionSpend({}), null);
  assert.equal(sessionSpend(session("anthropic/claude-opus-5.5", "routerai")).total, spend.total);
});

test("amounts format for a glance and never claim precision they do not have", () => {
  assert.equal(formatUsd(0), "$0.00");
  assert.equal(formatUsd(0.001), "<$0.01");
  assert.equal(formatUsd(14.936), "$14.94");
  assert.equal(formatUsd(1_234.5), "$1235");
  assert.equal(formatUsd(Number.NaN), "$0.00");
});
