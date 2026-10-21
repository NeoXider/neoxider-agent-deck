// The card the context meter shows on hover: what the open chat has cost and used - spend,
// turns, tokens and cache, the model, how long it has worked, what runs under it.
//
// Everything comes from what Deck already holds: the session row Harness lists (its token
// totals, context pressure and model) and the transcript on screen. Nothing is fetched for
// it. Loaded before app.js; app.js globals are only touched inside functions.

function statsSession() {
  return (state.dashboard?.sessions || []).find((session) => session.sessionId === state.selectedSessionId) || null;
}

// Turns are the user's messages; replies and tool calls are counted from the same transcript.
function transcriptCounts(messages = state.currentMessages || []) {
  const counts = { turns: 0, replies: 0, tools: 0, failedTools: 0 };
  for (const message of messages) {
    if (message?.role === "user") counts.turns += 1;
    else if (message?.role === "assistant" && message.text) counts.replies += 1;
    else if (message?.role === "tool") {
      counts.tools += 1;
      if (message.isError) counts.failedTools += 1;
    }
  }
  return counts;
}

function statsAgo(value) {
  const at = Number(value) || Date.parse(value) || 0;
  if (!at) return "";
  const minutes = Math.floor((Date.now() - at) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

function statsRow(label, value, { hint = "", tone = "" } = {}) {
  const row = document.createElement("div");
  row.className = `stats-row${tone ? ` ${tone}` : ""}`;
  row.append(Object.assign(document.createElement("span"), { textContent: label }));
  const right = document.createElement("b");
  right.textContent = value;
  if (hint) right.append(Object.assign(document.createElement("small"), { textContent: ` ${hint}` }));
  row.append(right);
  return row;
}

// A section with nothing to say is left out.
function statsSection(title, rows) {
  const present = rows.filter(Boolean);
  if (!present.length) return document.createDocumentFragment();
  const section = document.createElement("div");
  section.className = "stats-section";
  section.append(Object.assign(document.createElement("small"), { className: "stats-section-title", textContent: title }), ...present);
  return section;
}

function sessionStatsCard() {
  const session = statsSession();
  if (!session) return null;
  const pricing = globalThis.modelPricing;
  const count = pricing?.groupDigits || ((value) => String(Math.round(value || 0)));
  const values = session.projections?.values || {};
  const pressure = contextPressure(session);
  const spend = sessionSpend(session);
  const counts = transcriptCounts();
  // A long chat loads its newest messages first, so until the rest is read its counts are a floor.
  const partial = Boolean(state.historyHasOlder);
  const atLeast = (value) => `${value}${partial ? "+" : ""}`;
  const card = document.createElement("div");
  card.className = "stats-card-body";

  const head = document.createElement("div");
  head.className = "stats-head";
  head.append(Object.assign(document.createElement("b"), { textContent: compactText(session.title || "This chat", 48) }));
  const model = values.modelSelection?.lastUsed || values.modelSelection?.next || null;
  if (model?.model) {
    const effort = model.reasoningEffort ? ` · ${model.reasoningEffort}` : "";
    head.append(Object.assign(document.createElement("small"), { textContent: `${model.model}${effort}` }));
  }
  card.append(head);

  if (spend && spend.total > 0) {
    const hero = document.createElement("div");
    hero.className = "stats-hero";
    hero.append(Object.assign(document.createElement("b"), { textContent: spendAmount(spend) }));
    const perTurn = counts.turns && !partial ? spend.total / counts.turns : 0;
    hero.append(Object.assign(document.createElement("small"), { textContent: perTurn ? `spent · ~${pricing.formatUsd(perTurn)} a turn` : "spent at list prices" }));
    card.append(hero);
  }

  if (pressure) {
    const bar = document.createElement("div");
    bar.className = `stats-bar${pressure.percent >= 90 ? " critical" : pressure.percent >= 70 ? " high" : ""}`;
    bar.style.setProperty("--fill", `${pressure.percent.toFixed(1)}%`);
    bar.append(document.createElement("span"));
    const breakdown = values.contextBreakdown;
    // What fills it, as Harness estimates it: the system prompt, tool schemas, the messages.
    const parts = breakdown ? [["System", breakdown.systemTokens], ["Tools", breakdown.toolsTokens], ["Messages", breakdown.messageTokens]]
      .filter(([, value]) => Number(value) > 0) : [];
    const partsLine = parts.length ? document.createElement("div") : null;
    if (partsLine) {
      partsLine.className = "stats-parts";
      for (const [name, value] of parts) {
        const part = document.createElement("span");
        part.append(Object.assign(document.createElement("i"), { className: `stats-part-${name.toLowerCase()}` }), `${name} `, Object.assign(document.createElement("b"), { textContent: formatTokens(Number(value)) }));
        partsLine.append(part);
      }
    }
    card.append(statsSection("Context", [
      statsRow("In use", `${formatTokens(pressure.used)} / ${formatTokens(pressure.total)}`, { hint: `${Math.round(pressure.percent)}%`, tone: pressure.percent >= 90 ? "critical" : pressure.percent >= 70 ? "high" : "" }),
      bar,
      partsLine,
      statsRow("Left", formatTokens(Math.max(0, pressure.total - pressure.used))),
    ]));
  }

  card.append(statsSection("Conversation", [
    statsRow("Turns", atLeast(counts.turns), { hint: counts.replies ? `· ${counts.replies} repl${counts.replies === 1 ? "y" : "ies"}` : "" }),
    counts.tools ? statsRow("Tool calls", atLeast(counts.tools), { hint: counts.failedTools ? `· ${counts.failedTools} failed` : "", tone: counts.failedTools ? "warn" : "" }) : null,
    (session.subagents || []).length ? statsRow("Subagents", String(session.subagents.filter((child) => child?.kind === "child").length || session.subagents.length)) : null,
    session.backgroundJobCount ? statsRow("Background jobs", String(session.backgroundJobCount)) : null,
  ]));

  const tokens = spend?.tokens || (() => {
    const usage = values.tokenUsage?.totals || values.tokenUsage;
    if (!usage) return null;
    return { input: Number(usage.uncachedInputTokens) || 0, output: Number(usage.outputTokens) || 0, cacheRead: Number(usage.cacheReadTokens) || 0, cacheWrite: Number(usage.cacheWriteTokens) || 0 };
  })();
  if (tokens && tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite > 0) {
    const prompt = tokens.input + tokens.cacheRead + tokens.cacheWrite;
    const hit = prompt > 0 ? Math.round((tokens.cacheRead / prompt) * 100) : 0;
    const money = (key) => (spend ? `$${spend.cost[key].toFixed(spend.cost[key] >= 1 ? 2 : 4)}` : "");
    card.append(statsSection("Tokens", [
      statsRow("Input", count(tokens.input), { hint: money("input") }),
      statsRow("Output", count(tokens.output), { hint: money("output") }),
      statsRow("Cache read", count(tokens.cacheRead), { hint: money("cacheRead") }),
      statsRow("Cache write", count(tokens.cacheWrite), { hint: money("cacheWrite") }),
      prompt > 0 ? statsRow("Cache hits", `${hit}%`, { tone: hit >= 60 ? "good" : "" }) : null,
    ]));
  }

  const since = Number(session.runningSince);
  const worked = Number.isFinite(since) && since > 0 ? Date.now() - since : Number(session.lastRunMs);
  card.append(statsSection("Time", [
    Number.isFinite(worked) && worked > 0 ? statsRow(session.running ? "Working for" : "Last turn took", formatWorkDuration(worked)) : null,
    session.createdAt ? statsRow("Started", statsAgo(session.createdAt)) : null,
    session.updatedAt ? statsRow("Last activity", statsAgo(session.updatedAt)) : null,
  ]));

  if (spend) card.append(Object.assign(document.createElement("small"), { className: "stats-foot", textContent: `Estimated from ${spend.requestedModel || spend.model}'s list prices; Harness reports tokens, not money.` }));
  else if (model?.model) card.append(Object.assign(document.createElement("small"), { className: "stats-foot", textContent: "No list price for this model, so no spend is shown." }));
  return card;
}
