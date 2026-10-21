// The small chat the avatar's recent chats open: the panel grown up into a conversation
// (compact-window.cjs places it), with nothing in it but the way back, the chat's name, its
// messages and the message box. The full widget is one press away.
//
// Loaded before app.js; app.js globals are only touched inside functions.

function miniChatActive() {
  return document.body.classList.contains("mini-chat") && state.windowMode === "full";
}

// main.cjs says whether the full window it opened is the small one. The class is also set
// ahead of time by openCompactSession, so the chrome never shows for a frame.
function applyMiniChat(value) {
  const on = Boolean(value);
  document.body.classList.toggle("mini-chat", on);
  if (on && state.tab !== "chat") setTab("chat");
  if (on && state.focusMode) setFocusMode(false);
  renderMiniChatBar();
}

function renderMiniChatBar() {
  const bar = $("#miniChatBar");
  if (!bar) return;
  const on = miniChatActive();
  if (bar.hidden === on) bar.hidden = !on;
  if (!on) return;
  const session = (state.dashboard?.sessions || []).find((item) => item.sessionId === state.selectedSessionId);
  const agentState = sessionAgentState(session);
  const title = session?.title || "New chat";
  const titleNode = $("#miniChatTitle");
  if (titleNode.textContent !== title) titleNode.textContent = title;
  titleNode.title = title;
  const meta = $("#miniChatMeta");
  const since = Number(session?.runningSince);
  if (agentState === "working" && Number.isFinite(since) && since > 0) {
    meta.dataset.runningSince = String(since);
    meta.textContent = formatWorkDuration(Date.now() - since);
  } else {
    delete meta.dataset.runningSince;
    const text = hasPendingQuestion(state.selectedSessionId) ? "asking you" : agentState;
    if (meta.textContent !== text) meta.textContent = text;
  }
  bar.dataset.state = agentState;
  const avatar = $("#miniChatAvatar");
  const source = AVATARS[agentState] || AVATARS.idle;
  if (!avatar.src.endsWith(source)) avatar.src = source;
  scheduleSessionTimers();
}

async function leaveMiniChat() {
  if (!state.returnToAvatarSessionId) state.returnToAvatarSessionId = state.selectedSessionId;
  await returnToAvatar({ panel: true });
}

document.addEventListener("DOMContentLoaded", () => {
  window.widget.onMiniChat?.((value) => applyMiniChat(value));
  $("#miniChatBack").addEventListener("click", () => leaveMiniChat().catch(showError));
  $("#miniChatExpand").addEventListener("click", () => {
    document.body.classList.remove("mini-chat");
    renderMiniChatBar();
    setWindowMode("full").catch(showError);
  });
});
