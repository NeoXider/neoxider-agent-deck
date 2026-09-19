// Replay prompt pressure from a provider usage anchor plus subsequent surface
// deltas. Never confuse the summarizer's own usage with the conversation's.
const count = (value) => Number.isSafeInteger(value) && value >= 0;

function contentTokens(blocks) {
  if (!Array.isArray(blocks)) return null;
  let total = 0;
  for (const block of blocks) {
    let tokens;
    if (["text", "reasoning"].includes(block?.type) && typeof block.text === "string") {
      tokens = Math.ceil(block.text.length / 4);
    } else if (block?.type === "tool-call" && typeof block.name === "string" && typeof block.arguments === "string") {
      tokens = Math.ceil(block.name.length / 4) + Math.ceil(block.arguments.length / 4);
    } else if (block?.type === "tool-result") {
      tokens = contentTokens(block.content);
    } else return null; // Images/files require route-specific pricing.
    if (tokens === null) return null;
    total += tokens + 4;
  }
  return Number.isSafeInteger(total) ? total : null;
}

function messageTokens(event) {
  const blocks = event.type === "user/message" ? event.data?.content : event.data?.message?.content;
  if (event.type === "system/message") {
    if (!Array.isArray(blocks) || blocks.some((b) => b?.type !== "text" || typeof b.text !== "string")) return null;
    return blocks.length ? 4 + Math.ceil(blocks.reduce((sum, b) => sum + b.text.length, 0) / 4) : 0;
  }
  const tokens = contentTokens(blocks);
  return tokens === null ? null : tokens + 4;
}

function createCompactionContextTracker() {
  let projected = null;
  let previous = null;
  return function consume(event) {
    if (!event) { projected = null; previous = null; return null; }
    if (previous && event.seq !== previous.seq + 1) projected = null;
    // Header/schema changes and offloads can change prompt cost outside a
    // priced surface event. Wait for the next provider anchor in that case.
    if (["request/header", "image/offload"].includes(event.type)) projected = null;
    if (event.type === "assistant/message") {
      const usage = event.data?.usage;
      const fields = [usage?.inputTokens, usage?.cacheReadTokens ?? 0, usage?.cacheWriteTokens ?? 0];
      projected = fields.every(count) ? fields.reduce((sum, n) => sum + n, 0) : null;
    }
    const beforeTokens = projected;
    const surface = ["user/message", "assistant/message", "system/message", "tool/result"].includes(event.type);
    let matchedReplacement = false;
    if (surface) {
      const tokens = messageTokens(event);
      const op = event.surfaceOp;
      if (tokens === null || !op) projected = null;
      else if (op === "append") {
        if (projected !== null) projected += tokens;
      } else {
        const claim = previous?.data;
        matchedReplacement = ["compaction/summary", "compaction/prune"].includes(previous?.type)
          && previous.seq + 1 === event.seq && count(claim?.shadowedTokenCount)
          && op.op === "replace" && op.startSeq === claim?.shadowedRange?.start
          && op.endSeq === claim?.shadowedRange?.end;
        if (!matchedReplacement || projected === null || projected < claim.shadowedTokenCount) projected = null;
        else projected += tokens - claim.shadowedTokenCount;
      }
    } else if (event.surfaceOp) projected = null;
    if (!count(projected)) projected = null;
    previous = event;
    return matchedReplacement && count(beforeTokens) && projected !== null
      ? { beforeTokens, afterTokens: projected } : null;
  };
}

module.exports = { createCompactionContextTracker };
