export const name = "lmstudio-output-budget";

export function apply(ctx, config = {}) {
  const provider = config.provider || "openai";
  const budgets = config.models || {};
  ctx.on("agent/request", async (_request, next) => {
    const proposal = await next();
    const budget = budgets[proposal.model];
    if (proposal.provider !== provider || !Number.isSafeInteger(budget) || budget < 2) return proposal;
    // Keep explicit user caps. Materialize the configured adapter default on
    // resumed local routes, including the one-token degenerate resume case.
    if (proposal.maxTokens === undefined || proposal.maxTokens === 1) return { ...proposal, maxTokens: budget };
    return proposal;
  });
}
