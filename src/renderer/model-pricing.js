(function exposeModelPricing(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.modelPricing = api;
}(typeof globalThis === "object" ? globalThis : this, () => {
  const PER_MILLION = 1_000_000;
  const DATE_SUFFIX = /-\d{8}$/;

  // List prices in USD per million tokens, taken from the model catalog the Harness
  // ships (pi-ai `providers/data/*.json`, generated from models.dev). The Harness
  // itself never reports spend, so this table is the only price source.
  const PRICES = {
    anthropic: {
      "claude-fable-5": { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
      "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
      "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
      "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
      "claude-opus-4-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
      "claude-opus-4-6": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
      "claude-opus-4-7": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
      "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
      "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
      "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
      "claude-sonnet-4-5": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      "claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
      "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
    },
  };

  // "anthropic/claude-opus-5.5" and "claude-opus-5.5" are the same model, and a date
  // suffix never changes its rate, so both are folded onto the table's own spelling.
  function normalizeModelId(value) {
    let model = String(value ?? "").trim().toLowerCase();
    const slash = model.lastIndexOf("/");
    if (slash >= 0) model = model.slice(slash + 1);
    return model
      .replace(/[\s_.]+/g, "-")
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function normalizeProvider(value) {
    return String(value ?? "").trim().toLowerCase();
  }

  function entryFor(entries, modelId) {
    if (!entries) return null;
    return entries[modelId] || (DATE_SUFFIX.test(modelId) ? entries[modelId.replace(DATE_SUFFIX, "")] : null) || null;
  }

  // A model that runs on the user's own hardware has no per-token price. A quantised build is
  // named by its quant - Q4_K_M, IQ3_XXS, Q1_0, F16, a .gguf file - and a local runtime by its
  // provider. Such a chat used to say "no list price for this model", which read as if its
  // spend were unknown; it costs nothing at the point of use, and says so.
  const LOCAL_PROVIDERS = new Set(["ollama", "lmstudio", "lm-studio", "llamacpp", "llama-cpp", "llama.cpp", "vllm", "local", "localai", "koboldcpp", "jan", "gpt4all", "mlx", "tabby", "exllama"]);
  const QUANTIZED = /(?:^|[-_.\s/:@])(?:i?q[1-8](?:[_-]?[a-z0-9]{1,4})*|f16|bf16|fp16|gguf|gptq|awq|exl2)(?=$|[-_.\s/:@])/i;

  function isLocalModel(provider, model) {
    const providerId = normalizeProvider(provider);
    return LOCAL_PROVIDERS.has(providerId) || /^(?:local|localhost|127\.0\.0\.1)\b/.test(providerId) || QUANTIZED.test(String(model ?? ""));
  }

  // The provider's own row wins; a gateway route (routerai, openrouter, ...) that names
  // an Anthropic model falls back to the model's list price rather than showing nothing.
  function priceFor(provider, model) {
    const modelId = normalizeModelId(model);
    if (!modelId) return null;
    const providerId = normalizeProvider(provider);
    const direct = entryFor(PRICES[providerId], modelId);
    if (direct) return { ...direct, provider: providerId, model: modelId };
    for (const [name, entries] of Object.entries(PRICES)) {
      const fallback = entryFor(entries, modelId);
      if (fallback) return { ...fallback, provider: name, model: modelId };
    }
    if (isLocalModel(provider, model)) return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, provider: providerId, model: modelId, local: true };
    return null;
  }

  // The wire projection is the four counters; the projection cache wraps them in
  // `{ totals, last }`, and both shapes reach the renderer depending on the read.
  function countersFrom(usage) {
    const counters = usage && typeof usage === "object" && usage.totals && typeof usage.totals === "object"
      ? usage.totals
      : usage;
    if (!counters || typeof counters !== "object") return null;
    const tokens = {
      input: Number(counters.uncachedInputTokens ?? counters.inputTokens ?? counters.input ?? 0),
      output: Number(counters.outputTokens ?? counters.output ?? 0),
      cacheRead: Number(counters.cacheReadTokens ?? counters.cacheRead ?? 0),
      cacheWrite: Number(counters.cacheWriteTokens ?? counters.cacheWrite ?? 0),
    };
    return Object.values(tokens).every(Number.isFinite) ? tokens : null;
  }

  function usageSpend(usage, price) {
    const tokens = countersFrom(usage);
    if (!tokens || !price) return null;
    const cost = {
      input: (tokens.input / PER_MILLION) * Number(price.input || 0),
      output: (tokens.output / PER_MILLION) * Number(price.output || 0),
      cacheRead: (tokens.cacheRead / PER_MILLION) * Number(price.cacheRead || 0),
      cacheWrite: (tokens.cacheWrite / PER_MILLION) * Number(price.cacheWrite || 0),
    };
    const total = cost.input + cost.output + cost.cacheRead + cost.cacheWrite;
    if (!Number.isFinite(total)) return null;
    return { tokens, cost, total };
  }

  function sessionSpend(session) {
    const values = session?.projections?.values;
    const lastUsed = values?.modelSelection?.lastUsed || values?.modelSelection?.next || null;
    const price = priceFor(lastUsed?.provider, lastUsed?.model);
    if (!price) return null;
    const spend = usageSpend(values?.tokenUsage, price);
    if (!spend) return null;
    return { ...spend, provider: price.provider, model: price.model, requestedModel: String(lastUsed?.model || ""), ...(price.local ? { local: true } : {}) };
  }

  function formatUsd(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0) return "$0.00";
    if (amount < 0.005) return "<$0.01";
    if (amount < 1_000) return `$${amount.toFixed(2)}`;
    return `$${amount.toFixed(0)}`;
  }

  // Grouped by hand rather than by toLocaleString: the tooltip must read the same on a
  // machine whose locale would put a narrow space, or a dot, where a comma belongs.
  function groupDigits(value) {
    const amount = Math.round(Number(value) || 0);
    return String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  return { PRICES, normalizeModelId, normalizeProvider, isLocalModel, priceFor, countersFrom, usageSpend, sessionSpend, formatUsd, groupDigits };
}));
