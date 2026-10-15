const test = require("node:test");
const assert = require("node:assert/strict");

const { answerFromDraft, draftReady, emptyDraft, optionLabel, setCustom, toggleOption } = require("../src/renderer/question-dock.js");

const single = { id: "service", question: "Which service?", options: [{ label: "Pay (Recommended)" }, { label: "Auth" }], multiSelect: false };
const multi = { id: "targets", question: "Which targets?", options: [{ label: "Windows" }, { label: "Linux" }], multiSelect: true };
const open = { id: "name", question: "What name?", options: [], multiSelect: false };
const entry = { eventId: "e1", questions: [single, multi, open] };

test("nothing is ready until one question has an answer; the rest go as skipped", () => {
  let draft = emptyDraft(entry);
  assert.equal(draftReady(entry, draft), false);
  draft = toggleOption(single, draft, "Auth");
  assert.equal(draftReady(entry, draft), true);
  assert.deepEqual(answerFromDraft(entry, draft), { answers: [
    { id: "service", selected: ["Auth"] },
    { id: "targets", selected: [] },
    { id: "name", selected: [] },
  ] });
});

test("a single-choice question keeps one answer, a multi-choice one collects", () => {
  let draft = emptyDraft(entry);
  draft = toggleOption(single, draft, "Auth");
  draft = toggleOption(single, draft, "Pay (Recommended)");
  assert.deepEqual(draft.service.selected, ["Pay (Recommended)"]);
  draft = setCustom(single, draft, "Neither, the gateway");
  assert.deepEqual(draft.service, { selected: [], custom: "Neither, the gateway" }, "typing replaces the picked option");
  draft = toggleOption(single, draft, "Auth");
  assert.deepEqual(draft.service, { selected: ["Auth"], custom: "" }, "picking replaces the typed text");
  draft = toggleOption(multi, draft, "Windows");
  draft = toggleOption(multi, draft, "Linux");
  draft = setCustom(multi, draft, " macOS ");
  draft = toggleOption(multi, draft, "Windows");
  assert.deepEqual(answerFromDraft(entry, draft).answers[1], { id: "targets", selected: ["Linux"], custom: "macOS" });
});

test("skip sends every question back unanswered, and the recommended tag is only presentation", () => {
  let draft = toggleOption(single, emptyDraft(entry), "Auth");
  draft = setCustom(open, draft, "Deck");
  assert.deepEqual(answerFromDraft(entry, draft, { skip: true }).answers.map((item) => [item.selected, item.custom]), [[[], undefined], [[], undefined], [[], undefined]]);
  assert.deepEqual(optionLabel("Pay (Recommended)"), { text: "Pay", recommended: true });
  assert.deepEqual(optionLabel("Auth"), { text: "Auth", recommended: false });
});
