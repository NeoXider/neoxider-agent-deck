function turnOutcome(reason) {
  const kind = String(reason?.kind || "stop");
  if (kind === "max-tokens") return {
    role: "warning", code: "output-token-limit", title: "Output token limit reached",
    text: 'The reply was cut off. Earlier output is preserved. Send "continue" to resume, or reduce thinking effort if no final answer was produced.',
  };
  if (kind === "error") return {
    role: "error", code: "model-error", title: "Model request failed",
    text: String(reason.error?.message || reason.failure?.message || "The model ended the turn with an error"),
  };
  return null;
}

function publicTurnReason(reason) {
  const kind = String(reason?.kind || "stop");
  const outcome = turnOutcome(reason);
  return kind === "error" ? { kind, error: { message: outcome.text.slice(0, 4000) } } : { kind };
}

module.exports = { turnOutcome, publicTurnReason };
