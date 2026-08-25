const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = readFileSync(path.join(root, "src", "renderer", "index.html"), "utf8");
const renderer = readFileSync(path.join(root, "src", "renderer", "app.js"), "utf8");
const main = readFileSync(path.join(root, "src", "main.cjs"), "utf8");
const harnessApi = readFileSync(path.join(root, "src", "harness-api.cjs"), "utf8");

test("visible widget copy is English and required controls are present", () => {
  assert.doesNotMatch(`${html}\n${renderer}`, /[\u0400-\u04ff]/);
  for (const id of [
    "contextMeter",
    "modelButton",
    "modelSearch",
    "reasoningButton",
    "commandsButton",
    "workspaceButton",
    "modeSwitch",
    "attachButton",
    "attachmentBar",
    "agentControls",
    "activityCard",
    "focusChatButton",
    "orbMode",
    "orbStatus",
    "orbHistoryButton",
    "edgeMode",
  ]) assert.match(html, new RegExp(`id="${id}"`));
});

test("compact layout uses custom pickers, expandable controls, and no useless count strip", () => {
  assert.doesNotMatch(html, /class="stats-strip"/);
  assert.doesNotMatch(html, /id="(?:model|reasoning|workspace|mode|session)Select"/);
  assert.match(html, /<details id="agentControls"/);
  assert.match(html, /class="picker-menu model-menu"/);
  assert.match(renderer, /localRank/);
});

test("composer keeps attachment, stop, send and context controls in the requested order", () => {
  const context = html.indexOf('id="contextMeter"');
  const attach = html.indexOf('id="attachButton"');
  const focus = html.indexOf('id="focusChatButton"');
  const input = html.indexOf('id="messageInput"');
  const stop = html.indexOf('id="cancelButton"');
  const send = html.indexOf('id="sendButton"');
  assert.ok(context > 0 && context < attach && attach < focus && focus < input && input < stop && stop < send);
  assert.match(renderer, /attachment-preview/);
  assert.match(renderer, /thumbnailData/);
});

test("chat is the first and default page, followed by state-aware agents", () => {
  const titlebar = html.slice(html.indexOf('<header class="titlebar'), html.indexOf("</header>") + 9);
  assert.ok(titlebar.indexOf('data-tab="chat"') < titlebar.indexOf('data-tab="agents"'));
  assert.match(titlebar, /class="tab active" data-tab="chat"/);
  assert.match(html, /id="chatPanel" class="panel chat-panel active"/);
  assert.match(renderer, /agent-avatar \$\{agentState\}/);
  assert.match(renderer, /session-state \$\{agentState\}/);
  assert.match(harnessApi, /sessionStateFromHistory/);
});

test("one composer button toggles a chat-only focus view and can restore the full UI", () => {
  assert.match(renderer, /function setFocusMode/);
  assert.match(renderer, /classList\.toggle\("focus-chat", next\)/);
  assert.match(renderer, /setFocusMode\(!state\.focusMode\)/);
  assert.match(readFileSync(path.join(root, "src", "renderer", "styles.css"), "utf8"), /\.focus-chat \.titlebar[\s\S]+\.focus-chat #chatPanel/);
});

test("collapsed pet keeps only recent messages and opens the exact notifying session", () => {
  assert.doesNotMatch(html, /id="orb(?:NewSession|Commands|Attach)"/);
  assert.match(renderer, /compactNotificationTimer = setTimeout/);
  assert.match(renderer, /\}, 2500\)/);
  assert.match(renderer, /orb-status-closing/);
  assert.match(renderer, /notifyCompletion\(nextSessions\.find/);
  assert.match(renderer, /await selectSession\(sessionId, true\)/);
  assert.match(main, /const ORB_SIZE = 128/);
});

test("window contract has no close control and supports avatar and edge modes", () => {
  assert.doesNotMatch(html, /id="(?:close|hide)Button"/);
  assert.match(main, /\["full", "orb", "edge"\]\.includes\(nextMode\)/);
  assert.match(main, /nextMode === "orb"/);
  assert.match(main, /ORB_QUICK_WIDTH/);
  assert.match(main, /set-compact-status/);
  assert.match(main, /event\.preventDefault\(\);\s*applyWindowMode\("edge"\)/);
});

test("compact modes use immediate pointer capture, native drag IPC, and magnetic snap", () => {
  assert.match(renderer, /setPointerCapture/);
  assert.match(renderer, /beginCompactDrag/);
  assert.match(renderer, /moveCompactDrag/);
  assert.match(renderer, /endCompactDrag/);
  assert.match(main, /begin-compact-drag/);
  assert.match(main, /move-compact-drag/);
  assert.match(main, /end-compact-drag/);
  assert.match(main, /wasActive !== compactStatus\.active && !compactDragOrigin/);
  assert.match(html, /data-avatar[^>]+draggable="false"/);
});

test("the clickable NeoXider brand becomes a full-window drag target after movement", () => {
  assert.match(renderer, /beginFullDrag/);
  assert.match(renderer, /moveFullDrag/);
  assert.match(renderer, /endFullDrag/);
  assert.match(renderer, /suppressProjectClick/);
  assert.match(main, /begin-full-drag/);
  assert.match(main, /move-full-drag/);
  assert.match(main, /end-full-drag/);
  assert.match(renderer, /function suppressBrandClickAfterDrag/);
  assert.match(renderer, /suppressProjectClick = false; \}, 1200/);
  assert.match(renderer, /\[\$\("#avatarButton"\), \$\("#projectLink"\)\]/);
});

test("avatar click replaces the redundant collapse icon", () => {
  assert.match(html, /id="avatarButton"[^>]+Collapse to avatar/);
  assert.doesNotMatch(html, /id="orbButton"/);
  assert.match(renderer, /\$\("#avatarButton"\)\.addEventListener\("click"/);
});

test("consecutive tool activity collapses into one expandable group", () => {
  assert.match(renderer, /function appendActivityRun/);
  assert.match(renderer, /className = `tool-group/);
  assert.match(renderer, /messages\[index\]\.role === "tool"/);
  assert.match(renderer, /tool-group-body/);
});

test("completed reasoning is omitted and live activity remains a collapsed card", () => {
  assert.match(renderer, /if \(message\.role === "reasoning"\)/);
  assert.match(html, /<details id="activityCard"/);
  assert.doesNotMatch(harnessApi, /Last reasoning/);
});

test("view switch lives in the titlebar and session plus setup share one toolbar", () => {
  const titlebar = html.slice(html.indexOf('<header class="titlebar'), html.indexOf("</header>") + 9);
  assert.match(titlebar, /<nav class="tabs/);
  const toolbar = html.slice(html.indexOf('<div class="chat-heading'), html.indexOf('<div id="commandMenu"'));
  assert.match(toolbar, /id="sessionButton"/);
  assert.match(toolbar, /id="agentControls"/);
});

test("the session toolbar has a DeepSeek button for the selected Harness session", () => {
  const toolbar = html.slice(html.indexOf('<div class="chat-heading'), html.indexOf('<div id="commandMenu"'));
  assert.match(toolbar, /id="openSessionButton"[\s\S]{0,300}assets\/deepseek\.svg/);
  assert.match(renderer, /openHarnessSession\(state\.selectedSessionId\)/);
  assert.match(main, /open-harness-session/);
  assert.match(main, /harnessSessionUrl\(HARNESS_URL, sessionId\)/);
});

test("widget-created and widget-prompted sessions enforce Full access", () => {
  const matches = main.match(/api\.ensureFullAccess\(sessionId\)/g) || [];
  assert.equal(matches.length, 2);
  assert.match(main, /create-session[\s\S]{0,300}ensureFullAccess/);
});

test("the widget is single-instance and has no redundant footer clock or refresh button", () => {
  assert.match(main, /requestSingleInstanceLock/);
  assert.match(main, /second-instance/);
  assert.doesNotMatch(html, /id="lastUpdate"|id="refreshButton"|<footer/);
});

test("Markdown and tool calls have dedicated safe, collapsed render paths", () => {
  assert.match(renderer, /message\.role === "tool"/);
  assert.match(renderer, /details\.className = `tool-call/);
  assert.match(renderer, /bubble\.innerHTML = message\.html/);
  assert.match(main, /renderMarkdown\(message\.text\)/);
  assert.match(html, /id="messages"/);
});

test("chat glow distinguishes thinking, writing and tool activity and clears on idle", () => {
  assert.match(renderer, /activity-thinking/);
  assert.match(renderer, /activity-writing/);
  assert.match(renderer, /activity-tool/);
  assert.match(renderer, /classList\.remove\("activity-thinking", "activity-writing", "activity-tool"\)/);
});

test("interactive controls, view transitions, compact modes, and send have reduced-motion-safe animation hooks", () => {
  assert.match(renderer, /classList\.add\("sending"\)/);
  assert.match(renderer, /classList\.remove\("sending"\)/);
  assert.match(html, /id="sendButton"/);
  assert.match(readFileSync(path.join(root, "src", "renderer", "styles.css"), "utf8"), /send-spring|compact-enter|panel-enter|prefers-reduced-motion/);
});

test("sending a message automatically collapses transient setup surfaces", () => {
  const submitStart = renderer.indexOf('$("#chatForm").addEventListener("submit"');
  const submitEnd = renderer.indexOf('$("#messageInput").addEventListener("keydown"', submitStart);
  const submit = renderer.slice(submitStart, submitEnd);
  assert.match(submit, /\$\("#agentControls"\)\.open = false/);
  assert.match(submit, /\$\("#settingsPanel"\)\.classList\.remove\("open"\)/);
  assert.match(submit, /\$\("#commandMenu"\)\.classList\.remove\("open"\)/);
  assert.match(submit, /closePickers\(\)/);
});
