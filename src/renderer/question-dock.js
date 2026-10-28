// The agent's question, answered above the composer.
//
// question-relay.cjs in the main process holds each `ask_user_question` the agent is
// waiting on; this draws the oldest one for the open chat and sends the user's answer
// back. The pure half (drafts in, Harness answer out) is exported for the unit tests; the
// DOM half only runs in the renderer.
(function exposeQuestionDock(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.questionDock = api;
}(typeof globalThis === "object" ? globalThis : this, () => {
  const RECOMMENDED = /\s*\(recommended\)\s*$/i;

  function emptyDraft(entry) {
    return Object.fromEntries((entry?.questions || []).map((question) => [question.id, { selected: [], custom: "" }]));
  }

  function answered(draft) {
    return Boolean(draft && (draft.selected.length || draft.custom.trim()));
  }

  // Ready once at least one question has an answer; the rest go as skipped, which Harness
  // records as an answer item with nothing selected and no text.
  function draftReady(entry, draft) {
    return Boolean(entry?.questions?.some((question) => answered(draft?.[question.id])));
  }

  function answerFromDraft(entry, draft, { skip = false } = {}) {
    return {
      answers: (entry?.questions || []).map((question) => {
        const item = draft?.[question.id] || { selected: [], custom: "" };
        const custom = skip ? "" : item.custom.trim();
        return { id: question.id, selected: skip ? [] : [...item.selected], ...(custom ? { custom } : {}) };
      }),
    };
  }

  // A single-choice question keeps one answer: picking an option clears typed text and
  // typing clears the option, so what is sent is what the card shows.
  function toggleOption(question, draft, label) {
    const current = draft[question.id] || { selected: [], custom: "" };
    if (question.multiSelect) {
      const selected = current.selected.includes(label) ? current.selected.filter((item) => item !== label) : [...current.selected, label];
      return { ...draft, [question.id]: { ...current, selected } };
    }
    const selected = current.selected[0] === label ? [] : [label];
    return { ...draft, [question.id]: { selected, custom: selected.length ? "" : current.custom } };
  }

  function setCustom(question, draft, value) {
    const current = draft[question.id] || { selected: [], custom: "" };
    const text = String(value || "");
    return { ...draft, [question.id]: { selected: question.multiSelect || !text.trim() ? current.selected : [], custom: text } };
  }

  function optionLabel(label) {
    return { text: String(label || "").replace(RECOMMENDED, ""), recommended: RECOMMENDED.test(String(label || "")) };
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function mount(dock, { answer, onAnswered = () => {}, describeError = (error) => error?.message || String(error) } = {}) {
    let entry = null;
    let draft = {};
    let busy = false;
    let error = "";
    // Questions folded away for now, by event: the poll redraws nothing for the same question,
    // and a chat opened again shows its question as it was left. A new question comes open.
    const folded = new Set();

    function applyFolded() {
      const on = Boolean(entry && folded.has(entry.eventId));
      dock.classList.toggle("collapsed", on);
      const fold = dock.querySelector(".question-fold");
      if (!fold) return;
      fold.title = on ? "Show the question" : "Fold the question away for now";
      fold.setAttribute("aria-label", fold.title);
      fold.setAttribute("aria-expanded", String(!on));
    }

    function setFolded(on) {
      if (!entry) return;
      if (on) folded.add(entry.eventId); else folded.delete(entry.eventId);
      while (folded.size > 50) folded.delete(folded.values().next().value);
      applyFolded();
    }

    function sync() {
      if (!entry) return;
      for (const question of entry.questions) {
        const item = draft[question.id];
        const node = dock.querySelector(`[data-question-id="${CSS.escape(question.id)}"]`);
        if (!node) continue;
        node.querySelectorAll(".question-option").forEach((option) => {
          const on = item.selected.includes(option.dataset.label);
          option.classList.toggle("selected", on);
          option.setAttribute("aria-checked", String(on));
        });
        const input = node.querySelector(".question-custom");
        if (input && input.value !== item.custom) input.value = item.custom;
      }
      const submit = dock.querySelector(".question-submit");
      if (submit) {
        submit.disabled = busy || !draftReady(entry, draft);
        submit.textContent = busy ? "Sending…" : "Answer";
      }
      const skip = dock.querySelector(".question-skip");
      if (skip) skip.disabled = busy;
      const status = dock.querySelector(".question-error");
      if (status) status.textContent = error;
      dock.classList.toggle("busy", busy);
    }

    async function send(skip = false) {
      if (!entry || busy || (!skip && !draftReady(entry, draft))) return;
      const target = entry;
      busy = true;
      error = "";
      sync();
      try {
        await answer(target.eventId, answerFromDraft(target, draft, { skip }));
        onAnswered(target, skip);
      } catch (cause) {
        if (entry === target) error = describeError(cause);
      } finally {
        busy = false;
        if (entry === target) sync();
      }
    }

    function build(waiting) {
      const head = element("div", "question-head");
      head.append(element("span", "question-pulse"), element("b", "", "The agent is asking"));
      // Folded, the card is this one line - the question in short - and the chat under it is free
      // to read and write to; the answer waits. The line, or the chevron, opens it again.
      head.append(element("span", "question-peek", entry.questions[0]?.question || ""));
      if (waiting > 1) head.append(element("small", "question-waiting", `1 of ${waiting} waiting`));
      const fold = element("button", "question-fold");
      fold.type = "button";
      const chevron = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      chevron.setAttribute("class", "ui-icon");
      const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
      use.setAttribute("href", "#icon-chevron");
      chevron.append(use);
      fold.append(chevron);
      fold.addEventListener("click", () => setFolded(!folded.has(entry.eventId)));
      head.append(fold);
      head.addEventListener("click", (event) => {
        if (!event.target.closest(".question-fold") && dock.classList.contains("collapsed")) setFolded(false);
      });
      const body = element("div", "question-body");
      entry.questions.forEach((question, index) => {
        const item = element("div", "question-item");
        item.dataset.questionId = question.id;
        if (question.header) item.append(element("small", "question-header", question.header));
        item.append(element("p", "question-text", question.question));
        if (question.detail) item.append(element("p", "question-detail", question.detail));
        if (question.options.length) {
          const options = element("div", "question-options");
          options.setAttribute("role", question.multiSelect ? "group" : "radiogroup");
          options.setAttribute("aria-label", question.question);
          for (const option of question.options) {
            const button = element("button", "question-option");
            button.type = "button";
            button.dataset.label = option.label;
            button.setAttribute("role", question.multiSelect ? "checkbox" : "radio");
            button.setAttribute("aria-checked", "false");
            const label = optionLabel(option.label);
            const copy = element("span", "question-option-text");
            const title = element("b", "", label.text);
            if (label.recommended) title.append(element("i", "question-recommended", "Recommended"));
            copy.append(title);
            if (option.description) copy.append(element("small", "", option.description));
            button.append(element("span", `question-mark${question.multiSelect ? " multi" : ""}`), copy);
            button.addEventListener("click", () => {
              if (busy) return;
              draft = toggleOption(question, draft, option.label);
              error = "";
              sync();
            });
            options.append(button);
          }
          item.append(options);
        }
        const input = element("input", "question-custom");
        input.type = "text";
        input.maxLength = 4000;
        input.placeholder = question.options.length ? "Or type your own answer…" : "Type your answer…";
        input.setAttribute("aria-label", `Your answer: ${question.question}`);
        input.addEventListener("input", () => {
          draft = setCustom(question, draft, input.value);
          error = "";
          sync();
        });
        input.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
          event.preventDefault();
          // Enter moves on to the next question's field, and answers from the last one.
          const next = body.querySelectorAll(".question-custom")[index + 1];
          if (next) next.focus(); else send(false);
        });
        item.append(input);
        body.append(item);
      });
      const actions = element("div", "question-actions");
      const status = element("small", "question-error");
      status.setAttribute("role", "alert");
      const skip = element("button", "question-skip ghost-button", "Skip");
      skip.type = "button";
      skip.title = "Send the questions back unanswered";
      skip.addEventListener("click", () => send(true));
      const submit = element("button", "question-submit", "Answer");
      submit.type = "button";
      submit.addEventListener("click", () => send(false));
      actions.append(status, skip, submit);
      dock.replaceChildren(head, body, actions);
    }

    // Same question: keep the draft, the focus and the caret. A different one starts clean.
    function update(next, waiting = next ? 1 : 0) {
      if (!next) {
        // The poll asks every 2.5 s; a dock that is already empty is not touched again.
        if (!entry && dock.hidden) return;
        entry = null;
        draft = {};
        busy = false;
        error = "";
        dock.hidden = true;
        dock.replaceChildren();
        return;
      }
      if (entry?.eventId === next.eventId) {
        const head = dock.querySelector(".question-waiting");
        const label = waiting > 1 ? `1 of ${waiting} waiting` : "";
        if (head && head.textContent !== label) head.textContent = label;
        else if (!head && label) dock.querySelector(".question-head")?.insertBefore(element("small", "question-waiting", label), dock.querySelector(".question-fold"));
        return;
      }
      entry = next;
      draft = emptyDraft(next);
      busy = false;
      error = "";
      build(waiting);
      dock.hidden = false;
      applyFolded();
      sync();
    }

    // Asked to answer (a notification, a chat opened on its question): a folded card opens.
    function focus() {
      setFolded(false);
      (dock.querySelector(".question-option") || dock.querySelector(".question-custom"))?.focus({ preventScroll: true });
    }

    return { update, focus, current: () => entry };
  }

  return { answerFromDraft, draftReady, emptyDraft, mount, optionLabel, setCustom, toggleOption };
}));
