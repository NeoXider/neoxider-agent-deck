// Keyboard ways around the widget: a switcher for chats and actions (Ctrl+K), find in the
// open chat (Ctrl+F), and stepping through chats (Ctrl+Tab). The picking and the searching
// are plain functions, tested on their own; the wiring below them runs after app.js.
(function exposeQuickNav(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.quickNav = api;
}(typeof globalThis === "object" ? globalThis : this, () => {
  const fold = (value) => String(value ?? "").toLowerCase();

  // How well an entry answers the query: every word has to be somewhere in it. A title that
  // starts with the query outranks one that contains it, which outranks a match in the
  // secondary line only. 0 means it does not match.
  function matchScore(entry, query) {
    const words = fold(query).split(/\s+/).filter(Boolean);
    if (words.length === 0) return 1;
    const title = fold(entry.title);
    const detail = fold(entry.detail);
    let score = 0;
    for (const word of words) {
      if (title.startsWith(word)) score += 8;
      else if (title.includes(` ${word}`)) score += 6;
      else if (title.includes(word)) score += 4;
      else if (detail.includes(word)) score += 1;
      else return 0;
    }
    return score;
  }

  // The entries that answer the query, best first; entries of equal merit keep the order
  // they came in, which is the order of the lists on screen.
  function rankEntries(entries, query, limit = 40) {
    return entries
      .map((entry, index) => ({ entry, index, score: matchScore(entry, query) }))
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, limit)
      .map((row) => row.entry);
  }

  // Which messages of a chat contain the text, by their index in the chat. What the user
  // and the agent wrote is searched; tool payloads are not.
  function findMessageHits(messages, query) {
    const needle = fold(query).trim();
    if (!needle || !Array.isArray(messages)) return [];
    const hits = [];
    messages.forEach((message, index) => {
      if (fold(message?.text).includes(needle)) hits.push(index);
    });
    return hits;
  }

  // The chat one step along the list from the open one, wrapping at either end.
  function stepSession(sessionIds, currentId, step) {
    if (!Array.isArray(sessionIds) || sessionIds.length === 0) return null;
    const at = sessionIds.indexOf(currentId);
    if (at < 0) return sessionIds[step > 0 ? 0 : sessionIds.length - 1];
    if (sessionIds.length === 1) return null;
    return sessionIds[(at + step + sessionIds.length) % sessionIds.length];
  }

  return { matchScore, rankEntries, findMessageHits, stepSession };
}));

// app.js loads after this file and defines what the wiring calls, so it waits for the page.
if (typeof document !== "undefined") document.addEventListener("DOMContentLoaded", () => {
  if (!document.querySelector("#quickNav")) return;
  const { rankEntries, findMessageHits, stepSession } = globalThis.quickNav;
  const icon = (name) => `<svg class="ui-icon" aria-hidden="true"><use href="#icon-${name}"/></svg>`;
  const usable = () => state.windowMode === "full" && !document.body.classList.contains("mode-transition-out");

  // ---- The switcher --------------------------------------------------------------------
  const nav = $("#quickNav");
  const navInput = $("#quickNavInput");
  const navList = $("#quickNavList");
  let navRows = [];
  let navIndex = 0;
  let navReturnFocus = null;

  function chatEntries() {
    return visibleSessions().map((session) => {
      const working = sessionAgentState(session);
      return {
        kind: "chat", sessionId: session.sessionId, state: working,
        title: session.title || "Untitled chat",
        detail: session.preview || (working === "working" ? "Working" : ""),
        note: session.sessionId === state.selectedSessionId ? "open" : working === "working" ? "working" : working === "error" ? "failed" : "",
        run: () => selectSession(session.sessionId, true),
      };
    });
  }

  function actionEntries() {
    const focused = document.body.classList.contains("focus-chat");
    const entries = [
      { icon: "plus", title: "New chat", detail: "start empty", run: () => createNewSession({ workspaceId: null }) },
      { icon: "agents", title: state.tab === "agents" ? "Back to the chat" : "All chats", detail: "agents list", run: () => setTab(state.tab === "agents" ? "chat" : "agents") },
      { icon: "search", title: "Find in this chat", detail: "search messages", note: "Ctrl+F", run: () => openFind() },
      { icon: "focus", title: focused ? "Leave focus mode" : "Focus mode", detail: "chat only", run: () => setFocusMode(!focused) },
      { icon: "capture", title: "Capture a region", detail: "screenshot attach", run: () => document.querySelector('[data-capture="region"]')?.click() },
      { icon: "display", title: state.solidWindow ? "See-through window" : "Solid window", detail: "opaque transparent smooth", note: state.performanceMode ? "optimized mode keeps it solid" : "", run: () => setSurfacePreference("solidWindow", !state.solidWindow) },
      { icon: "play", title: state.performanceMode ? "Leave optimized mode" : "Optimized mode", detail: "fast performance no animation solid", run: () => setSurfacePreference("performanceMode", !state.performanceMode) },
      { icon: "settings", title: "Settings", detail: "preferences appearance shortcuts", run: () => setSettingsOpen(true) },
      { icon: "dock", title: "Collapse to the avatar", detail: "compact", run: () => setWindowMode("orb") },
    ];
    if (state.platformPresentation?.edgeAvailable !== false) entries.push({ icon: "dock", title: "Dock to the screen edge", detail: "compact line", run: () => setWindowMode("edge") });
    if (!$("#openSessionButton").disabled) entries.push({ icon: "open", title: "Open this chat in Harness", detail: "browser", run: () => $("#openSessionButton").click() });
    return entries.map((entry) => ({ kind: "action", ...entry }));
  }

  function renderNav() {
    const query = navInput.value;
    const chats = rankEntries(chatEntries(), query, 30);
    const actions = rankEntries(actionEntries(), query, 12);
    navRows = [...chats, ...actions];
    navIndex = Math.min(navIndex, Math.max(0, navRows.length - 1));
    navList.replaceChildren();
    if (navRows.length === 0) {
      const empty = document.createElement("div");
      empty.className = "quick-nav-empty";
      empty.textContent = "Nothing matches.";
      navList.append(empty);
      return;
    }
    const addGroup = (label, rows, offset) => {
      if (rows.length === 0) return;
      const heading = document.createElement("div");
      heading.className = "quick-nav-group";
      heading.textContent = label;
      navList.append(heading);
      rows.forEach((row, index) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "quick-nav-item";
        item.setAttribute("role", "option");
        item.dataset.index = String(offset + index);
        item.innerHTML = row.kind === "chat" ? `<span class="quick-nav-dot ${row.state}"></span>` : icon(row.icon);
        const text = document.createElement("span");
        const title = document.createElement("b");
        title.textContent = row.title;
        text.append(title);
        if (row.kind === "chat" && row.detail) {
          const detail = document.createElement("small");
          detail.textContent = compactText(row.detail, 90);
          text.append(detail);
        }
        item.append(text);
        if (row.note) {
          const note = document.createElement("em");
          note.textContent = row.note;
          item.append(note);
        }
        navList.append(item);
      });
    };
    addGroup("Chats", chats, 0);
    addGroup("Actions", actions, chats.length);
    paintNavActive();
  }

  function paintNavActive() {
    for (const item of navList.querySelectorAll(".quick-nav-item")) {
      const active = Number(item.dataset.index) === navIndex;
      if (item.classList.contains("active") !== active) item.classList.toggle("active", active);
      item.setAttribute("aria-selected", String(active));
      if (active) item.scrollIntoView({ block: "nearest" });
    }
  }

  function openNav() {
    if (!usable() || !nav.hidden) return;
    closePickers();
    if ($("#settingsPanel").classList.contains("open")) setSettingsOpen(false, { restoreFocus: false });
    navReturnFocus = document.activeElement;
    navInput.value = "";
    navIndex = 0;
    nav.hidden = false;
    renderNav();
    navInput.focus();
  }

  function closeNav({ restoreFocus = true } = {}) {
    if (nav.hidden) return false;
    nav.hidden = true;
    navList.replaceChildren();
    if (restoreFocus) (navReturnFocus?.isConnected && navReturnFocus !== document.body ? navReturnFocus : $("#messageInput"))?.focus?.();
    navReturnFocus = null;
    return true;
  }

  function runNavRow(row) {
    if (!row) return;
    closeNav({ restoreFocus: false });
    Promise.resolve().then(() => row.run()).then(() => {
      // A chat that was just opened is ready to be typed into.
      if (row.kind === "chat" && state.tab === "chat") $("#messageInput").focus();
    }).catch((error) => globalThis.showError?.(error));
  }

  navInput.addEventListener("input", () => { navIndex = 0; renderNav(); });
  navInput.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (navRows.length === 0) return;
      navIndex = (navIndex + (event.key === "ArrowDown" ? 1 : -1) + navRows.length) % navRows.length;
      paintNavActive();
    } else if (event.key === "Enter") {
      event.preventDefault();
      runNavRow(navRows[navIndex]);
    }
  });
  navList.addEventListener("click", (event) => {
    const item = event.target.closest(".quick-nav-item");
    if (item) runNavRow(navRows[Number(item.dataset.index)]);
  });
  navList.addEventListener("pointermove", (event) => {
    const item = event.target.closest(".quick-nav-item");
    if (!item || Number(item.dataset.index) === navIndex) return;
    navIndex = Number(item.dataset.index);
    paintNavActive();
  });
  document.addEventListener("pointerdown", (event) => {
    if (!nav.hidden && !nav.contains(event.target)) closeNav({ restoreFocus: false });
  }, true);

  // ---- Find in the open chat -------------------------------------------------------------
  const findBar = $("#findBar");
  const findInput = $("#findInput");
  const findCount = $("#findCount");
  const highlights = typeof CSS !== "undefined" && CSS.highlights && typeof Highlight === "function" ? CSS.highlights : null;
  let findHits = [];
  let findAt = -1;
  let findKey = "";
  let findQuery = "";
  let findSession = null;
  let findObserver = null;
  let findPaintTimer = 0;

  function paintFindHighlights() {
    if (!highlights) return;
    highlights.delete("deck-find");
    highlights.delete("deck-find-current");
    const needle = findInput.value.trim().toLowerCase();
    if (findBar.hidden || !needle) return;
    const root = $("#messages");
    const current = findAt >= 0 ? root.querySelector(`[data-vmsg="${findHits[findAt]}"]`) : null;
    const all = [];
    const here = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node && all.length < 600; node = walker.nextNode()) {
      const text = node.nodeValue.toLowerCase();
      for (let from = text.indexOf(needle); from >= 0 && all.length < 600; from = text.indexOf(needle, from + needle.length)) {
        const range = new Range();
        range.setStart(node, from);
        range.setEnd(node, from + needle.length);
        (current?.contains(node) ? here : all).push(range);
      }
    }
    if (all.length) highlights.set("deck-find", new Highlight(...all));
    if (here.length) highlights.set("deck-find-current", new Highlight(...here));
  }

  function scheduleFindPaint(delay = 90) {
    clearTimeout(findPaintTimer);
    findPaintTimer = setTimeout(paintFindHighlights, delay);
  }

  function renderFindCount() {
    const query = findInput.value.trim();
    const text = !query ? "" : findHits.length === 0 ? "No matches" : `${findAt + 1}/${findHits.length}`;
    if (findCount.textContent !== text) findCount.textContent = text;
    findBar.classList.toggle("no-match", Boolean(query) && findHits.length === 0);
    $("#findPrev").disabled = $("#findNext").disabled = findHits.length < 2;
  }

  // Recomputed when the query, the chat or its length changes; the place in the list is
  // kept by message, so a reply arriving mid-search does not move the reader.
  function refreshFind({ jump = false } = {}) {
    const messages = state.currentMessages || [];
    const query = findInput.value.trim().toLowerCase();
    const key = JSON.stringify([state.selectedSessionId, messages.length, query]);
    if (key !== findKey) {
      const held = findAt >= 0 ? findHits[findAt] : null;
      const sameQuery = findKey !== "" && query === findQuery && state.selectedSessionId === findSession;
      findKey = key;
      findQuery = query;
      findSession = state.selectedSessionId;
      findHits = findMessageHits(messages, findInput.value);
      // A new search starts at the newest match, where the reader is; an old one stays put.
      findAt = sameQuery && held !== null && findHits.includes(held) ? findHits.indexOf(held) : findHits.length - 1;
      if (!sameQuery) jump = true;
    }
    renderFindCount();
    if (jump && findAt >= 0) scrollToUserMessage(findHits[findAt]);
    scheduleFindPaint(jump ? 260 : 90);
  }

  function stepFind(step) {
    if (findHits.length === 0) return;
    findAt = (findAt + step + findHits.length) % findHits.length;
    renderFindCount();
    scrollToUserMessage(findHits[findAt]);
    scheduleFindPaint(260);
  }

  function openFind() {
    if (!usable()) return;
    closeNav({ restoreFocus: false });
    if (state.tab !== "chat") setTab("chat");
    findBar.hidden = false;
    findInput.focus();
    findInput.select();
    if (!findObserver) {
      findObserver = new MutationObserver(() => { if (!findBar.hidden) refreshFind(); });
      findObserver.observe($("#messages"), { childList: true, subtree: true, characterData: true });
    }
    refreshFind();
  }

  function closeFind({ restoreFocus = true } = {}) {
    if (findBar.hidden) return false;
    findBar.hidden = true;
    findObserver?.disconnect();
    findObserver = null;
    clearTimeout(findPaintTimer);
    highlights?.delete("deck-find");
    highlights?.delete("deck-find-current");
    findKey = "";
    if (restoreFocus) $("#messageInput").focus();
    return true;
  }

  findInput.addEventListener("input", () => refreshFind());
  findInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    // Enter walks back through the chat, toward older matches; Shift+Enter comes forward.
    stepFind(event.shiftKey ? 1 : -1);
  });
  $("#findPrev").addEventListener("click", () => stepFind(-1));
  $("#findNext").addEventListener("click", () => stepFind(1));
  $("#findClose").addEventListener("click", () => closeFind());

  // ---- Keys ------------------------------------------------------------------------------
  function stepChat(step) {
    const ids = visibleSessions().map((session) => session.sessionId);
    const next = stepSession(ids, state.selectedSessionId, step);
    if (!next) return;
    selectSession(next, true).then(() => { if (state.tab === "chat") $("#messageInput").focus(); }).catch((error) => globalThis.showError?.(error));
  }

  // Ahead of the page's own key handling, so Escape closes these before it closes anything
  // under them.
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (closeNav() || (findBar.contains(document.activeElement) && closeFind())) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      return;
    }
    if (!event.ctrlKey || event.altKey || event.metaKey || !usable()) return;
    const key = event.key.toLowerCase();
    if (key === "k" && !event.shiftKey) {
      event.preventDefault();
      if (nav.hidden) openNav(); else closeNav();
    } else if (key === "f" && !event.shiftKey) {
      event.preventDefault();
      openFind();
    } else if (event.key === "Tab") {
      event.preventDefault();
      event.stopImmediatePropagation();
      stepChat(event.shiftKey ? -1 : 1);
    }
  }, true);

  globalThis.quickNavView = { openNav, closeNav, openFind, closeFind, stepChat };
}, { once: true });
