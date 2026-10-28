// The chat the avatar's panel opens in its own place. The first click on a recent chat
// addresses the message box to it; a second click shows its newest messages where the list
// was, above that same message box, so reading a reply and answering it never leave the
// panel. The arrow beside each chat, and the one in this chat's head, open the full widget.
//
// The messages come from the same history read the full chat uses, re-read only when the
// chat's row in the poll changed, or every few seconds while it works.
//
// Loaded before app.js; app.js globals are only touched inside functions.

const ORB_CHAT_MESSAGES = 24;
const ORB_CHAT_RUNNING_RELOAD_MS = 3000;
const orbChat = { sessionId: null, revision: "", stamp: "", loadedAt: 0, loading: null, messages: [], error: "", stick: true };

function orbChatSession() {
  return (state.dashboard?.sessions || []).find((session) => session.sessionId === orbChat.sessionId) || null;
}

function orbChatStamp(session) {
  return JSON.stringify([session?.updatedAt ?? null, Boolean(session?.running), session?.preview || ""]);
}

// Screenshot fixtures have no Harness to read from: the messages are handed over as read.
function showOrbChatFixture(sessionId, messages) {
  Object.assign(orbChat, { sessionId, revision: "fixture", messages, error: "", stick: true, loadedAt: Date.now() });
  orbChat.stamp = orbChatStamp(orbChatSession());
  state.compactChatOpen = true;
  openCompactReply(sessionId);
  renderOrbChat();
}

function openOrbChat(sessionId) {
  if (!sessionId) return;
  if (orbChat.sessionId !== sessionId) Object.assign(orbChat, { sessionId, revision: "", stamp: "", messages: [], error: "", stick: true });
  state.compactChatOpen = true;
  openCompactReply(sessionId);
  renderOrbChat();
  loadOrbChat({ force: true });
}

function closeOrbChat() {
  state.compactChatOpen = false;
  syncCompactStatus();
  requestAnimationFrame(() => $("#orbSessionList .orb-session-pick")?.focus());
}

// Called on every poll and after a send. A chat that did not change is not read again.
function loadOrbChat({ force = false } = {}) {
  const sessionId = orbChat.sessionId;
  if (!state.compactChatOpen || !sessionId) return;
  const session = orbChatSession();
  renderOrbChatHead(session);
  if (orbChat.loading) return;
  const stamp = orbChatStamp(session);
  const due = force || stamp !== orbChat.stamp
    || (session?.running && Date.now() - orbChat.loadedAt >= ORB_CHAT_RUNNING_RELOAD_MS);
  if (!due) return;
  orbChat.stamp = stamp;
  orbChat.loadedAt = Date.now();
  orbChat.loading = Promise.resolve(window.widget.history(sessionId, { revision: orbChat.revision }))
    .then((view) => {
      if (orbChat.sessionId !== sessionId || view?.unchanged) return;
      orbChat.revision = typeof view?.revision === "string" ? view.revision : "";
      orbChat.messages = Array.isArray(view?.messages) ? view.messages : [];
      orbChat.error = "";
      renderOrbChat();
    })
    .catch((error) => {
      if (orbChat.sessionId !== sessionId) return;
      orbChat.error = compactText(error?.message || error || "Messages could not be loaded", 80);
      renderOrbChat();
    })
    .finally(() => { orbChat.loading = null; });
}

// A sent message shows at once; the next read replaces it with the chat's own copy.
function noteOrbChatSent(sessionId, text) {
  if (orbChat.sessionId !== sessionId) return;
  orbChat.messages = [...orbChat.messages, { role: "user", text, pending: true }];
  orbChat.stick = true;
  renderOrbChat();
  loadOrbChat({ force: true });
}

function renderOrbChatHead(session = orbChatSession()) {
  const title = session?.title || "Chat";
  const titleNode = $("#orbChatTitle");
  if (titleNode.textContent !== title) titleNode.textContent = title;
  titleNode.title = title;
  const agentState = sessionAgentState(session);
  const meta = $("#orbChatMeta");
  const since = Number(session?.runningSince);
  if (agentState === "working" && Number.isFinite(since) && since > 0) {
    meta.dataset.runningSince = String(since);
    meta.textContent = formatWorkDuration(Date.now() - since);
  } else {
    delete meta.dataset.runningSince;
    const text = hasPendingQuestion(orbChat.sessionId) ? "asking you" : agentState;
    if (meta.textContent !== text) meta.textContent = text;
  }
  $("#orbChat").dataset.state = agentState;
  const avatar = $("#orbChatAvatar");
  const source = AVATARS[agentState] || AVATARS.idle;
  if (!avatar.src.endsWith(source)) avatar.src = source;
  scheduleSessionTimers();
  $("#orbChatFull").title = `Open ${title} in the full chat`;
  $("#orbChatFull").setAttribute("aria-label", $("#orbChatFull").title);
}

function orbChatMessageNode(message) {
  if (message.role === "tool") {
    const tool = document.createElement("div");
    tool.className = `orb-chat-tool${message.isError || message.status === "failed" ? " failed" : ""}`;
    tool.textContent = message.name || "tool";
    return tool;
  }
  const node = document.createElement("div");
  node.className = `orb-chat-message ${message.role}${message.pending ? " pending" : ""}`;
  // The main process renders and sanitises Markdown for the full chat; the same HTML is used.
  if (message.role === "assistant" && message.html) node.innerHTML = message.html;
  else node.textContent = message.text || "";
  return node;
}

function renderOrbChat() {
  const log = $("#orbChatLog");
  if (!log) return;
  renderOrbChatHead();
  // Reading back through the chat is left alone; at the bottom it follows what arrives.
  const atBottom = orbChat.stick || log.scrollHeight - log.scrollTop - log.clientHeight < 24;
  const shown = orbChat.messages
    .filter((message) => message.role === "tool" || (["user", "assistant"].includes(message.role) && (message.text || message.html)))
    .slice(-ORB_CHAT_MESSAGES);
  if (!shown.length) {
    const empty = document.createElement("div");
    empty.className = "orb-chat-empty";
    empty.textContent = orbChat.error || (orbChat.loading || !orbChat.revision ? "Loading…" : "No messages yet");
    log.replaceChildren(empty);
  } else log.replaceChildren(...shown.map(orbChatMessageNode));
  if (atBottom) log.scrollTop = log.scrollHeight;
  orbChat.stick = false;
}

document.addEventListener("DOMContentLoaded", () => {
  $("#orbChatBack").addEventListener("click", closeOrbChat);
  $("#orbChatFull").addEventListener("click", () => {
    const sessionId = orbChat.sessionId;
    state.compactChatOpen = false;
    openCompactSession(sessionId, { fromAvatar: true }).catch(showError);
  });
});
