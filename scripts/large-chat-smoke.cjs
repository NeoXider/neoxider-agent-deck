const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { app, BrowserWindow, ipcMain } = require("electron");

// Exercise the real renderer in Chromium, including layout and composer input.
// A hidden fixture keeps this repeatable without a running Harness or user data.
const root = path.resolve(__dirname, "..");
const deadline = setTimeout(() => { console.error("Large chat smoke timed out"); app.exit(1); }, 60000);

async function main() {
  await app.whenReady();
  for (const [channel, result] of Object.entries({
    "get-preferences": {}, "app-info": { version: "test" },
    "get-update-state": { status: "idle" }, "set-compact-status": {},
    "set-last-selected-session": null,
  })) ipcMain.handle(channel, () => result);
  const win = new BrowserWindow({
    width: 420, height: 640, show: false,
    webPreferences: {
      preload: path.join(root, "src", "preload.cjs"),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      backgroundThrottling: false,
    },
  });
  await win.loadFile(path.join(root, "src", "renderer", "index.html"), {
    query: { screenshotFixture: "chat", screenshotStatic: "1" },
  });
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const result = await win.webContents.executeJavaScript(`(async () => {
    const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const messages = Array.from({ length: 10000 }, (_, index) => ({
      role: index % 2 ? "assistant" : "user", seq: index + 1,
      text: "Message " + index + "\\n" + "Long conversation text. ".repeat(40),
    }));
    const start = performance.now();
    renderMessages(messages);
    const renderMs = performance.now() - start;
    const log = document.querySelector("#messages");
    void log.offsetHeight;
    const firstNode = log.querySelector(".bubble");
    const repeatStart = performance.now();
    for (let i = 0; i < 30; i++) renderMessages(state.currentMessages);
    const repeatMs = performance.now() - repeatStart;
    const input = document.querySelector("#messageInput");
    const typingStart = performance.now();
    for (let i = 0; i < 30; i++) {
      input.value += "typed text ";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      void input.offsetHeight;
    }
    const typingMs = performance.now() - typingStart;
    const result = {
      totalMessages: state.currentMessages.length,
      bubbles: log.querySelectorAll(".bubble").length,
      nodes: log.querySelectorAll("*").length,
      latestVisible: log.textContent.includes("Message 9999"),
      stableNode: firstNode === log.querySelector(".bubble"),
      renderMs, repeatMs, typingMs,
    };
    // Telegram-style: scrolling to the top loads older history above the reading
    // position and unloads the newest rows once the window exceeds its cap.
    for (let i = 0; i < 5; i++) {
      log.scrollTop = 0;
      await frames();
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
    result.grownStart = transcriptViewStart;
    result.grownEnd = transcriptViewEnd;
    result.grownBubbles = log.querySelectorAll(".bubble").length;
    result.olderVisible = log.textContent.includes("Message 9520");
    result.unloadedLatest = !log.textContent.includes("Message 9999");
    result.pillVisible = !document.querySelector("#scrollLatestButton").hidden;
    // Rows that were read and scrolled away from are not new.
    result.pillTextAway = document.querySelector("#scrollLatestCount").textContent;
    // Three answers arrive while the reader is up in the history: only those are new.
    renderMessages([...state.currentMessages, ...[10000, 10001, 10002].map((index) => ({ role: "assistant", seq: index + 1, text: "Message " + index }))]);
    await frames();
    result.pillTextArrived = document.querySelector("#scrollLatestCount").textContent;
    document.querySelector("#scrollLatestButton").click();
    await frames();
    result.returnedToLatest = log.textContent.includes("Message 10002");
    result.returnedBubbles = log.querySelectorAll(".bubble").length;
    const session = state.dashboard.sessions.find((session) => session.sessionId === state.selectedSessionId);
    session.subagents = Array.from({ length: 10 }, (_, index) => ({ kind: "child", activity: index < 3 ? "running" : "inactive" }));
    renderContext();
    const subagents = document.querySelector("#subagentsButton");
    result.subagentCount = subagents.textContent.trim();
    result.subagentsVisible = !subagents.hidden;
    setFocusMode(true);
    result.subagentsVisibleInFocus = getComputedStyle(subagents).display !== "none";
    setFocusMode(false);
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return result;
  })()`);
  console.log(JSON.stringify(result, null, 2));
  assert.equal(result.totalMessages, 10000, "history remains available");
  assert.equal(result.latestVisible, true, "latest answer is shown");
  assert.equal(result.stableNode, true, "unchanged refresh preserves DOM nodes");
  assert.ok(result.bubbles <= 100, "the initial window stays small");
  assert.equal(result.olderVisible, true, "older history loads by scrolling up, with no page buttons");
  assert.ok(result.grownBubbles <= 330, "the grown window must not accumulate DOM");
  assert.equal(result.unloadedLatest, true, "distant newest rows unload once the window exceeds its cap");
  assert.equal(result.pillVisible, true, "the pill offers the way back");
  assert.equal(result.pillTextAway, "Latest", "history scrolled away from is not called new");
  assert.equal(result.pillTextArrived, "3 new", "the pill counts only what arrived while away");
  assert.equal(result.returnedToLatest, true, "the pill returns to the current answer");
  assert.ok(result.returnedBubbles <= 100, "returning to latest restores the small window");
  assert.equal(result.subagentCount, "10 subagents · 3 running");
  assert.equal(result.subagentsVisible, true);
  assert.equal(result.subagentsVisibleInFocus, true);
  assert.ok(result.renderMs < 2500, "initial rendering must finish promptly");
  assert.ok(result.repeatMs < 1000, "unchanged refresh must stay inexpensive");
  assert.ok(result.typingMs < 1500, "composer editing must remain responsive");
  fs.mkdirSync(path.join(root, "tmp"), { recursive: true });
  await new Promise((resolve) => setTimeout(resolve, 150));
  fs.writeFileSync(path.join(root, "tmp", "large-chat-smoke.png"), (await win.webContents.capturePage()).toPNG());
  win.destroy();
  clearTimeout(deadline);
  app.exit(0);
}

main().catch((error) => { console.error(error); clearTimeout(deadline); app.exit(1); });
