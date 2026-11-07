// The agent preset chip in the chat heading. DSH fixes a session's preset when the session is
// created, so the chip chooses what a NEW chat starts with:
// - with no chat open, the choice waits for the first message (and "+" uses it too);
// - a blank chat is re-created in place with the chosen preset;
// - in a chat that has started, picking a preset opens a new chat with it in the same workspace.
// The renderer globals it uses ($, state, closePickers, togglePicker, positionPickerMenu,
// createIcon, createNewSession, selectedSessionRow) come from app.js, which loads after it.

const PRESET_STORAGE_KEY = "deck.newChatPreset";
const PRESET_RETRY_MS = 15000;
// Harness's own presets publish no display name; these read better than the bare ids.
const PRESET_LABELS = { standard: "Standard", ptc: "PTC", minimal: "Minimal", cordis: "Cordis" };
const presetPicker = { list: [], loaded: false, loading: null, error: "", triedAt: 0 };

function presetById(id) {
  return presetPicker.list.find((preset) => preset.id === id) || null;
}

function defaultPreset() {
  return presetPicker.list.find((preset) => preset.isDefault) || presetPicker.list[0] || null;
}

function presetLabel(preset) {
  if (!preset?.id) return "Preset";
  return preset.name || PRESET_LABELS[preset.id] || preset.id.charAt(0).toUpperCase() + preset.id.slice(1);
}

function storedNewChatPreset() {
  try { return localStorage.getItem(PRESET_STORAGE_KEY) || ""; } catch { return ""; }
}

function rememberNewChatPreset(id) {
  try {
    if (id) localStorage.setItem(PRESET_STORAGE_KEY, id);
    else localStorage.removeItem(PRESET_STORAGE_KEY);
  } catch {}
}

/** The preset a new chat starts with, or "" for Harness's default. */
function newChatPresetId() {
  const stored = storedNewChatPreset();
  // Before the roster arrives the remembered choice still holds; after, only while Harness
  // can still compose it.
  if (!presetPicker.loaded) return stored;
  const preset = presetById(stored);
  return preset && !preset.broken ? preset.id : "";
}

/** The preset a session runs, as its projection records it; "" when it records none. */
function sessionPresetId(session) {
  const id = session?.projections?.values?.agentPreset;
  return typeof id === "string" ? id : "";
}

let presetRetryTimer = null;

function loadAgentPresets({ force = false } = {}) {
  if (presetPicker.loading) return presetPicker.loading;
  if (!force && (presetPicker.loaded || Date.now() - presetPicker.triedAt < PRESET_RETRY_MS)) return Promise.resolve(presetPicker.list);
  presetPicker.triedAt = Date.now();
  presetPicker.loading = window.widget.agentPresets()
    .then((list) => {
      presetPicker.list = Array.isArray(list) ? list : [];
      // An empty roster usually means Harness was not up yet when Deck asked (Deck often
      // starts first), not that it has none, so it is asked again.
      presetPicker.loaded = presetPicker.list.length > 0;
      presetPicker.error = "";
    })
    .catch((error) => { presetPicker.error = String(error?.message || error); })
    .finally(() => {
      presetPicker.loading = null;
      // Asking again on a timer rather than on the next render: a quiet chat may not render.
      if (!presetPicker.loaded && !presetRetryTimer) {
        presetRetryTimer = setTimeout(() => {
          presetRetryTimer = null;
          loadAgentPresets({ force: true });
        }, PRESET_RETRY_MS);
      }
      renderPresetButton();
    });
  return presetPicker.loading;
}

function presetContext() {
  const session = typeof selectedSessionRow === "function" ? selectedSessionRow() : null;
  const started = Boolean(session && !session.blank);
  const fallback = defaultPreset()?.id || "";
  const currentId = started ? sessionPresetId(session) || fallback : (session && sessionPresetId(session)) || newChatPresetId() || fallback;
  return { session, started, currentId };
}

// Every poll calls this, and an unchanged poll must leave the DOM untouched, so each value
// is written only when it differs: assigning even the same `hidden` or text is a mutation.
function setIfChanged(element, property, value) {
  if (element[property] !== value) element[property] = value;
}

function renderPresetButton() {
  const button = $("#presetButton");
  if (!button) return;
  if (!presetPicker.loaded) loadAgentPresets();
  // The legacy generation has no roster: no chip rather than a chip that cannot work. The
  // model menu's preset row (app.js renderReasoning) follows the chip.
  const row = $("#reasoningPresetChoice");
  setIfChanged(button, "hidden", !presetPicker.list.length);
  if (row) setIfChanged(row, "hidden", button.hidden);
  if (button.hidden) return;
  const { started, currentId } = presetContext();
  const label = presetLabel(presetById(currentId) || { id: currentId });
  setIfChanged($("#presetButtonText"), "textContent", label);
  if (row) setIfChanged(row.querySelector("b"), "textContent", label);
  setIfChanged(button, "title", started ? `This chat runs the ${label} preset. Pick another to start a new chat with it.` : `New chats start with the ${label} preset`);
  if (button.getAttribute("aria-label") !== `Agent preset: ${label}`) button.setAttribute("aria-label", `Agent preset: ${label}`);
  if ($(".preset-picker")?.classList.contains("open")) renderPresetMenu();
}

function presetOption(preset, selected) {
  const option = document.createElement("button");
  option.type = "button";
  option.className = `picker-option preset-option${selected ? " selected" : ""}`;
  option.setAttribute("role", "option");
  option.setAttribute("aria-selected", String(selected));
  option.dataset.presetId = preset.id;
  option.disabled = Boolean(preset.broken);
  option.title = preset.broken ? `Harness cannot compose this preset: ${preset.broken}` : preset.description || presetLabel(preset);
  const mark = document.createElement("i");
  mark.className = "picker-check";
  if (selected) mark.append(createIcon("check"));
  const copy = document.createElement("span");
  copy.className = "preset-option-copy";
  const name = document.createElement("b");
  name.textContent = presetLabel(preset);
  copy.append(name);
  const note = preset.broken ? "Broken in Harness" : preset.description;
  if (note) {
    const small = document.createElement("small");
    small.textContent = note;
    copy.append(small);
  }
  option.append(mark, copy);
  if (preset.isDefault) {
    const badge = document.createElement("em");
    badge.className = "preset-default";
    badge.textContent = "default";
    option.append(badge);
  }
  option.addEventListener("click", () => choosePreset(preset.id));
  return option;
}

function renderPresetMenu() {
  const { started, currentId } = presetContext();
  const current = presetLabel(presetById(currentId) || { id: currentId });
  const hint = presetPicker.error && !presetPicker.list.length
    ? `Presets could not be loaded: ${presetPicker.error}`
    : started
      ? `This chat runs ${current}; a chat keeps its preset. Pick one to start a new chat with it.`
      : "New chats start with the chosen preset.";
  const root = $("#presetOptions");
  const signature = JSON.stringify([hint, currentId, presetPicker.list]);
  if (root.dataset.signature === signature) return;
  root.dataset.signature = signature;
  $("#presetHint").textContent = hint;
  root.replaceChildren(...presetPicker.list.map((preset) => presetOption(preset, preset.id === currentId)));
}

async function choosePreset(id) {
  const { session, started, currentId } = presetContext();
  closePickers();
  if (!presetById(id) || presetById(id).broken) return;
  rememberNewChatPreset(id);
  renderPresetButton();
  if (!session || (started && id === currentId)) return;
  // A blank chat takes the preset in place; a started one keeps its own and a new chat opens.
  await createNewSession({
    workspaceId: session.workspaceId || null,
    agentPreset: id,
    reuseSessionId: started ? null : session.sessionId,
  });
}

function openPresetMenu() {
  const button = $("#presetButton");
  if (button.hidden) return;
  loadAgentPresets({ force: !presetPicker.loaded });
  renderPresetMenu();
  togglePicker(button);
}

document.addEventListener("DOMContentLoaded", () => {
  $("#presetButton").addEventListener("click", (event) => {
    event.stopPropagation();
    openPresetMenu();
  });
  loadAgentPresets({ force: true });
});
