// Agents beyond a plain list: the most recent chats on top, pinned chats first in their
// group, and a menu on every card to pin, open in Harness or delete it.
//
// Loaded before app.js. Everything here reaches app.js (state, $, renderSessions, ...) only
// from inside functions, which run after both files have loaded.
//
// DSH has no way to erase a chat over its API; deleting one in its own sidebar archives it,
// and so does Deck. The chat leaves every list at once, and Undo brings it back.

const RECENT_SESSION_LIMIT = 4;
// Below this many chats every one of them is in sight already, and Recent would only repeat them.
const RECENT_SESSION_MIN_LIST = 9;
// Chats whose delete is on its way to Harness: hidden already, so the list answers the click.
const deletingSessionIds = new Set();

function hiddenSessionIds() {
  return [...(state.dashboard?.archivedSessionIds || []), ...deletingSessionIds];
}

function pinnedSessionIds() {
  return Array.isArray(state.dashboard?.pinnedSessionIds) ? state.dashboard.pinnedSessionIds : [];
}

function isSessionPinned(sessionId) {
  return pinnedSessionIds().includes(sessionId);
}

// "Recent" above the groups: the chats touched last, wherever they are filed. It only shows
// when it adds something: a list long enough that the newest chats are not all in sight.
function recentSessionGroup() {
  const sessions = window.sessionGroups.recentSessions(state.dashboard?.sessions || [], {
    archivedSessionIds: hiddenSessionIds(),
    selectedSessionId: state.selectedSessionId,
    limit: RECENT_SESSION_LIMIT,
  });
  if (sessions.length < 2 || visibleSessions().length < RECENT_SESSION_MIN_LIST) return null;
  return { key: "recent", workspaceId: null, label: "Recent", path: "", sessions, recent: true };
}

// Remembered across launches: the user folds Recent away once and it stays folded.
function setRecentSessionsOpen(open) {
  if (open) state.collapsedSessionGroupKeys.delete("recent");
  else state.collapsedSessionGroupKeys.add("recent");
  window.widget.setRecentSessionsOpen?.(open)?.catch?.(() => {});
}

// Cards slide to their new places when the order changes, instead of jumping.
function captureSessionCardPositions(root) {
  const positions = new Map();
  for (const card of root.querySelectorAll(".session-card[data-flip-key]")) positions.set(card.dataset.flipKey, card.getBoundingClientRect().top);
  return positions;
}

function playSessionCardFlip(root, before) {
  if (!before?.size || prefersReducedMotion()) return;
  for (const card of root.querySelectorAll(".session-card[data-flip-key]")) {
    const previous = before.get(card.dataset.flipKey);
    if (previous === undefined) {
      card.animate([{ opacity: 0, transform: "translateY(-4px)" }, { opacity: 1, transform: "none" }], { duration: 220, easing: "cubic-bezier(.16,1,.3,1)" });
      continue;
    }
    const delta = previous - card.getBoundingClientRect().top;
    if (Math.abs(delta) < 1) continue;
    card.animate([{ transform: `translateY(${delta}px)` }, { transform: "none" }], { duration: 300, easing: "cubic-bezier(.2,0,0,1)" });
  }
}

// --- The card menu ---------------------------------------------------------------------

let floatingMenu = null;

function closeFloatingMenu({ restoreFocus = false } = {}) {
  if (!floatingMenu) return;
  const { element, anchor } = floatingMenu;
  floatingMenu = null;
  if (anchor?.getAttribute?.("aria-haspopup")) anchor.setAttribute("aria-expanded", "false");
  else anchor?.removeAttribute?.("aria-expanded");
  element.classList.add("leaving");
  setTimeout(() => element.remove(), 140);
  if (restoreFocus && anchor?.isConnected) anchor.focus({ preventScroll: true });
}

// A small menu floating over the widget, anchored to an element or to a point.
function openFloatingMenu(anchor, build, { at = null, label = "Menu" } = {}) {
  closeFloatingMenu();
  closePickers?.();
  const shell = document.querySelector(".widget-shell");
  anchor?.setAttribute?.("aria-expanded", "true");
  const element = document.createElement("div");
  element.className = "floating-menu no-drag";
  element.setAttribute("role", "menu");
  element.setAttribute("aria-label", label);
  shell.append(element);
  floatingMenu = { element, anchor };
  const place = () => {
    const box = shell.getBoundingClientRect();
    const target = at ? { left: at.x, right: at.x, top: at.y, bottom: at.y } : anchor.getBoundingClientRect();
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    let left = Math.min(target.right - width, box.right - width - 8);
    left = Math.max(box.left + 8, left);
    let top = target.bottom + 4;
    if (top + height > box.bottom - 8) top = Math.max(box.top + 8, target.top - height - 4);
    element.style.left = `${Math.round(left - box.left)}px`;
    element.style.top = `${Math.round(top - box.top)}px`;
  };
  build(element, place);
  place();
  element.querySelector("button:not([disabled])")?.focus({ preventScroll: true });
  return element;
}

function menuItem(icon, text, onClick, { danger = false, hint = "" } = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `floating-menu-item${danger ? " danger" : ""}`;
  button.setAttribute("role", "menuitem");
  const copy = document.createElement("span");
  copy.append(Object.assign(document.createElement("b"), { textContent: text }));
  if (hint) copy.append(Object.assign(document.createElement("small"), { textContent: hint }));
  button.append(createIcon(icon), copy);
  button.addEventListener("click", (event) => { event.stopPropagation(); onClick(); });
  return button;
}

function sessionById(sessionId) {
  return (state.dashboard?.sessions || []).find((session) => session.sessionId === sessionId) || null;
}

function openSessionMenu(sessionId, anchor, { at = null, confirmDelete = false } = {}) {
  const session = sessionById(sessionId);
  if (!session) return;
  const title = session.title || "New session";
  openFloatingMenu(anchor, (menu, place) => {
    const showActions = () => {
      menu.replaceChildren();
      menu.classList.remove("confirming");
      const pinned = isSessionPinned(sessionId);
      menu.append(
        menuItem("pin", pinned ? "Unpin" : "Pin to top", () => { closeFloatingMenu(); togglePinnedSession(sessionId).catch(() => {}); }),
        menuItem("open", "Open in Harness", () => { closeFloatingMenu(); window.widget.openHarnessSession(sessionId).catch(showError); }),
        menuItem("trash", "Delete chat", showConfirm, { danger: true }),
      );
      place();
    };
    const showConfirm = () => {
      menu.replaceChildren();
      menu.classList.add("confirming");
      const working = Boolean(session.running) || sessionAgentState(session) === "working";
      const heading = Object.assign(document.createElement("b"), { className: "floating-menu-title", textContent: `Delete “${compactText(title, 34)}”?` });
      const text = Object.assign(document.createElement("small"), {
        className: "floating-menu-text",
        textContent: working
          ? "It is working right now: deleting stops it first. It goes to Harness's archive, and Undo brings it back."
          : "It goes to Harness's archive, like Delete in DSH. Undo brings it back.",
      });
      const actions = document.createElement("div");
      actions.className = "floating-menu-actions";
      const cancel = Object.assign(document.createElement("button"), { type: "button", textContent: "Cancel" });
      cancel.addEventListener("click", (event) => { event.stopPropagation(); if (confirmDelete) closeFloatingMenu({ restoreFocus: true }); else showActions(); });
      const remove = Object.assign(document.createElement("button"), { type: "button", className: "danger", textContent: working ? "Stop and delete" : "Delete" });
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        closeFloatingMenu();
        deleteSession(sessionId, { stopActivity: working }).catch(() => {});
      });
      actions.append(cancel, remove);
      menu.append(heading, text, actions);
      place();
      remove.focus({ preventScroll: true });
    };
    if (confirmDelete) showConfirm(); else showActions();
  }, { at, label: `${title} actions` });
}

function createSessionMenuButton() {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "session-menu-button";
  button.title = "More";
  button.setAttribute("aria-label", "Chat actions");
  button.setAttribute("aria-haspopup", "menu");
  button.append(createIcon("more"));
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    const card = button.closest(".session-card");
    if (floatingMenu?.anchor === button) closeFloatingMenu();
    else openSessionMenu(card?.dataset.sessionId, button);
  });
  button.addEventListener("keydown", (event) => event.stopPropagation());
  return button;
}

// The menu button, right-click, and Delete on a focused card.
function attachSessionCardActions(card) {
  const pin = createIcon("pin", "ui-icon session-pin");
  pin.setAttribute("aria-hidden", "true");
  card.querySelector(".agent-avatar")?.append(pin);
  card.append(createSessionMenuButton());
  card.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    openSessionMenu(card.dataset.sessionId, card, { at: { x: event.clientX, y: event.clientY } });
  });
  card.addEventListener("keydown", (event) => {
    if (event.key !== "Delete" || event.target !== card) return;
    event.preventDefault();
    openSessionMenu(card.dataset.sessionId, card, { confirmDelete: true });
  });
}

function syncSessionCardActions(card, session) {
  const pinned = isSessionPinned(session.sessionId);
  if (card.classList.contains("pinned") !== pinned) card.classList.toggle("pinned", pinned);
}

// --- Delete, undo, pin -----------------------------------------------------------------

async function deleteSession(sessionId, { stopActivity = false } = {}) {
  const session = sessionById(sessionId);
  const title = compactText(session?.title || "Chat", 30);
  const wasSelected = state.selectedSessionId === sessionId;
  deletingSessionIds.add(sessionId);
  state.sessionListSignature = "";
  state.compactSessionSignature = "";
  renderSessions();
  syncCompactStatus();
  if (wasSelected) {
    const next = visibleSessions().find((item) => item.sessionId !== sessionId)?.sessionId || null;
    await selectSession(next, false);
  }
  try {
    await window.widget.archiveSession(sessionId, { stopActivity });
    showActionToast(`Deleted “${title}”`, { icon: "trash", duration: 8000, action: { label: "Undo", run: () => restoreSession(sessionId, title) } });
    await refresh({ afterCurrent: true });
  } catch (error) {
    const message = String(error?.message || error || "");
    showActionToast(/session-active|active/i.test(message) && !stopActivity
      ? "Not deleted: it is still working. Use Stop and delete."
      : `Not deleted: ${compactText(message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), 70)}`, { kind: "error", icon: "alert", duration: 4200 });
  } finally {
    deletingSessionIds.delete(sessionId);
    state.sessionListSignature = "";
    renderSessions();
  }
}

async function restoreSession(sessionId, title = "Chat") {
  try {
    await window.widget.unarchiveSession(sessionId);
    await refresh({ afterCurrent: true });
    showActionToast(`Restored “${title}”`, { icon: "reuse" });
  } catch (error) {
    showActionToast(`Not restored: ${compactText(String(error?.message || error), 70)}`, { kind: "error", icon: "alert", duration: 4200 });
  }
}

async function togglePinnedSession(sessionId) {
  const pinned = isSessionPinned(sessionId);
  const previous = pinnedSessionIds();
  if (state.dashboard) state.dashboard.pinnedSessionIds = pinned ? previous.filter((id) => id !== sessionId) : [sessionId, ...previous];
  state.sessionListSignature = "";
  renderSessions();
  try {
    const result = await window.widget.pinSession(sessionId, !pinned);
    if (state.dashboard && Array.isArray(result?.pinnedSessionIds)) state.dashboard.pinnedSessionIds = result.pinnedSessionIds;
    showActionToast(pinned ? "Unpinned" : "Pinned to the top", { icon: "pin" });
  } catch (error) {
    if (state.dashboard) state.dashboard.pinnedSessionIds = previous;
    showActionToast(`Could not ${pinned ? "unpin" : "pin"}: ${compactText(String(error?.message || error), 60)}`, { kind: "error", icon: "alert", duration: 4200 });
  }
  state.sessionListSignature = "";
  renderSessions();
}

// --- Feedback that works on every tab --------------------------------------------------

// A toast over the whole widget (the chat's own toast stack lives inside the conversation,
// out of sight on Agents), optionally with one action such as Undo.
function showActionToast(text, { icon = "check", kind = "", duration = 2600, action = null } = {}) {
  const stack = $("#actionToastStack");
  if (!stack) return null;
  const toast = document.createElement("div");
  toast.className = `toast action-toast${kind ? ` ${kind}` : ""}`;
  toast.append(createIcon(icon), Object.assign(document.createElement("span"), { textContent: text }));
  let timer = 0;
  const leave = () => {
    clearTimeout(timer);
    if (!toast.isConnected || toast.classList.contains("leaving")) return;
    toast.classList.add("leaving");
    toast.addEventListener("animationend", () => toast.remove(), { once: true });
    setTimeout(() => toast.remove(), 320);
  };
  if (action) {
    const button = Object.assign(document.createElement("button"), { type: "button", className: "toast-action", textContent: action.label });
    button.addEventListener("click", () => { leave(); action.run(); });
    toast.append(button);
  }
  while (stack.childElementCount >= 2) stack.firstElementChild.remove();
  stack.append(toast);
  timer = setTimeout(leave, duration);
  toast.addEventListener("pointerenter", () => clearTimeout(timer));
  toast.addEventListener("pointerleave", () => { timer = setTimeout(leave, 1600); });
  return toast;
}

// An in-widget confirmation: a native dialog would pop up over the desktop, away from the
// widget it is about.
function deckConfirm({ title, text = "", okLabel = "OK", cancelLabel = "Cancel", danger = false }) {
  const dialog = $("#deckConfirm");
  if (!dialog) return Promise.resolve(window.confirm(`${title}\n\n${text}`));
  return new Promise((resolve) => {
    $("#deckConfirmTitle").textContent = title;
    $("#deckConfirmText").textContent = text;
    const ok = $("#deckConfirmOk");
    const cancel = $("#deckConfirmCancel");
    ok.textContent = okLabel;
    cancel.textContent = cancelLabel;
    ok.classList.toggle("danger", danger);
    dialog.hidden = false;
    dialog.classList.remove("leaving");
    const finish = (value) => {
      ok.removeEventListener("click", accept);
      cancel.removeEventListener("click", decline);
      document.removeEventListener("keydown", onKey, true);
      dialog.classList.add("leaving");
      setTimeout(() => { dialog.hidden = true; dialog.classList.remove("leaving"); }, 160);
      resolve(value);
    };
    const accept = () => finish(true);
    const decline = () => finish(false);
    const onKey = (event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); decline(); }
    };
    ok.addEventListener("click", accept);
    cancel.addEventListener("click", decline);
    document.addEventListener("keydown", onKey, true);
    requestAnimationFrame(() => ok.focus({ preventScroll: true }));
  });
}

document.addEventListener("pointerdown", (event) => {
  if (floatingMenu && !floatingMenu.element.contains(event.target) && !floatingMenu.anchor?.contains?.(event.target)) closeFloatingMenu();
}, true);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && floatingMenu) {
    event.preventDefault();
    event.stopPropagation();
    closeFloatingMenu({ restoreFocus: true });
  }
}, true);
window.addEventListener("blur", () => closeFloatingMenu());
