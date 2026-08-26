const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = readFileSync(path.join(root, "src", "renderer", "index.html"), "utf8");
const renderer = readFileSync(path.join(root, "src", "renderer", "app.js"), "utf8");
const main = readFileSync(path.join(root, "src", "main.cjs"), "utf8");
const platformCapabilities = readFileSync(path.join(root, "src", "platform-capabilities.cjs"), "utf8");
const settingsStore = readFileSync(path.join(root, "src", "settings-store.cjs"), "utf8");
const harnessApi = readFileSync(path.join(root, "src", "harness-api.cjs"), "utf8");

test("visible widget copy is English and required controls are present", () => {
  assert.doesNotMatch(`${html}\n${renderer}`, /[\u0400-\u04ff]/);
  for (const id of [
    "contextMeter",
    "modelButton",
    "modelSearch",
    "reasoningButton",
    "commandsButton",
    "commandMenu",
    "workspaceButton",
    "modeSwitch",
    "attachButton",
    "attachmentBar",
    "queueDock",
    "agentControls",
    "activityCard",
    "focusChatButton",
    "orbMode",
    "orbStatus",
    "orbHistoryButton",
    "edgeMode",
    "glowRange",
    "scrollLatestButton",
    "windowLayerSwitch",
  ]) assert.match(html, new RegExp(`id="${id}"`));
});

test("compact layout uses custom pickers, expandable controls, and no useless count strip", () => {
  assert.doesNotMatch(html, /class="stats-strip"/);
  assert.doesNotMatch(html, /id="(?:model|reasoning|workspace|mode|session)Select"/);
  assert.match(html, /<details id="agentControls"/);
  assert.match(html, /class="picker-menu model-menu"/);
  assert.match(renderer, /localRank/);
});

test("composer stacks attachment and commands beside a smaller context ring and Send", () => {
  const css = readFileSync(path.join(root, "src", "renderer", "styles.css"), "utf8");
  const context = html.indexOf('id="contextMeter"');
  const attach = html.indexOf('id="attachButton"');
  const commands = html.indexOf('id="commandsButton"');
  const focus = html.indexOf('id="focusChatButton"');
  const input = html.indexOf('id="messageInput"');
  const stop = html.indexOf('id="cancelButton"');
  const send = html.indexOf('id="sendButton"');
  assert.ok(context > 0 && context < attach && attach < commands && commands < focus && focus < input && input < stop && stop < send);
  assert.match(html, /class="composer-utility-stack"[\s\S]+id="attachButton"[\s\S]+id="commandsButton"/);
  assert.match(css, /\.composer-utility-stack \{[^}]+grid-template-rows:repeat\(2,32px\)/);
  assert.doesNotMatch(css, /\.composer-utility-stack \.composer-action \{[^}]+(?:width|height):(?:1[0-9]|2[0-9])px/);
  assert.match(css, /\.context-meter \{[^}]+width:36px[^}]+height:38px/);
  assert.match(css, /\.composer #sendButton \{[^}]+width:38px[^}]+height:38px/);
  assert.match(css, /\.context-meter svg \{[^}]+top:50%[^}]+left:50%[^}]+translate\(-50%,-50%\)/);
  assert.match(css, /\.context-meter span \{[^}]+position:absolute[^}]+inset:0[^}]+place-items:center/);
  assert.match(renderer, /attachment-preview/);
  assert.match(renderer, /thumbnailData/);
});

test("model picker names the control and provides loading, empty, error, retry, and model-recovery UI", () => {
  assert.match(html, /class="model-button-copy"><small>MODEL<\/small><b id="modelButtonText">Loading providers…<\/b>/);
  assert.match(renderer, /modelLoadState === "loading"/);
  assert.match(renderer, /No models loaded/);
  assert.match(renderer, /Models unavailable/);
  assert.match(renderer, /function retryModels/);
  assert.match(renderer, /function createModelSetupCard/);
  assert.match(renderer, /Choose model/);
  assert.match(renderer, /Retry models/);
  assert.match(renderer, /Load a model in LM Studio or another Harness provider/);
  assert.match(renderer, /\["assistant", "error"\]\.includes\(message\.role\) && isMissingModelError\(message\.text\)/);
  assert.match(renderer, /if \(!modelSetupShown\) root\.append\(createModelSetupCard\(\)\)/);
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

test("slash commands render as a vertical filtered palette immediately above the composer", () => {
  const messages = html.indexOf('id="messages"');
  const attachments = html.indexOf('id="attachmentBar"');
  const commands = html.indexOf('id="commandMenu"');
  const composer = html.indexOf('id="chatForm"');
  assert.ok(messages > 0 && messages < attachments && attachments < commands && commands < composer);
  assert.match(renderer, /function filteredCommands/);
  assert.match(renderer, /className = `command-row/);
  assert.match(renderer, /command-description/);
  assert.match(renderer, /\["ArrowDown", "ArrowUp"\]/);
  assert.match(renderer, /\["Enter", "Tab"\]/);
  assert.match(renderer, /\/\^\\\/\[\^\\s\]\*\$\//);
  assert.doesNotMatch(renderer, /command-chip/);
});

test("busy-session messages use the authoritative Harness queue with compact edit, delete, and steer controls", () => {
  assert.match(harnessApi, /mode: "queue"/);
  assert.match(renderer, /queueingBehindTurn/);
  assert.match(renderer, /trackQueuedPrompt/);
  assert.match(renderer, /onQueueUpdate/);
  assert.match(renderer, /window\.widget\.updateQueue/);
  assert.match(renderer, /kind: "edit"/);
  assert.match(renderer, /kind: "remove"/);
  assert.match(renderer, /kind: "steer"/);
  assert.match(harnessApi, /session\.updateQueue/);
  assert.doesNotMatch(html, /queue-dock-heading/);
});

test("live assistant deltas grow a bubble instead of leaving a Writing reasoning card", () => {
  assert.match(renderer, /onLiveEvent/);
  assert.match(renderer, /function handleLiveEvent/);
  assert.match(renderer, /chunk\.type === "text-delta"/);
  assert.match(renderer, /live-assistant/);
  assert.match(renderer, /function liveAssistantSnapshot/);
  assert.match(renderer, /activity\?\.active && activity\.kind === "writing" && activity\.text/);
  assert.match(renderer, /hasWritingBubble/);
});

test("manual chat scrolling is preserved and a jump-to-latest control appears for new output", () => {
  assert.match(html, /id="scrollLatestButton"/);
  assert.match(renderer, /messagesStickToBottom/);
  assert.match(renderer, /messagesNearBottom/);
  assert.match(renderer, /previousTop/);
  assert.match(renderer, /scrollLatestButton/);
  assert.doesNotMatch(renderer, /root\.scrollTop = root\.scrollHeight;\s*\}/);
});

test("activity glow intensity is brighter by default, adjustable, and persisted", () => {
  const css = readFileSync(path.join(root, "src", "renderer", "styles.css"), "utf8");
  assert.match(css, /--chat-glow-intensity: \.82/);
  assert.match(css, /opacity:var\(--chat-glow-intensity\)/);
  assert.match(renderer, /applyGlowIntensity/);
  assert.match(renderer, /setGlowIntensity/);
  assert.match(settingsStore, /glowIntensity: 0\.82/);
  assert.match(main, /set-glow-intensity/);
});

test("collapsed pet keeps only recent messages and opens the exact notifying session", () => {
  assert.doesNotMatch(html, /id="orb(?:NewSession|Commands|Attach)"/);
  assert.match(renderer, /compactNotificationTimer = setTimeout/);
  assert.match(renderer, /\}, 2500\)/);
  assert.match(renderer, /orb-status-closing/);
  assert.match(renderer, /notifyCompletion\(nextSessions\.find/);
  assert.match(renderer, /await selectSession\(sessionId, true\)/);
  assert.match(renderer, /compactReplySessionId/);
  assert.match(renderer, /openCompactReplySession/);
  assert.match(renderer, /#icon-send/);
  assert.match(main, /const ORB_SIZE = 128/);
});

test("window layer has normal, above-by-default, and fullscreen-game modes", () => {
  assert.match(html, /data-layer="normal"/);
  assert.match(html, /data-layer="above"/);
  assert.match(html, /data-layer="game"/);
  assert.match(settingsStore, /windowLayer: "above"/);
  assert.match(main, /applyPlatformWindowLayer/);
  assert.match(main, /preferences\.windowLayer = normalizeWindowLayer\(preferences\.windowLayer, PLATFORM_CAPABILITIES\)/);
  assert.match(platformCapabilities, /"screen-saver"/);
  assert.match(platformCapabilities, /"floating"/);
  assert.match(main, /set-window-layer/);
  assert.match(renderer, /setWindowLayer/);
});

test("production autostart uses the stable portable launcher controller", () => {
  assert.match(main, /createAutoStartController/);
  assert.match(main, /autoStartController\.migrateLegacy\(\)/);
  assert.match(main, /autoStartController\.setEnabled\(enabled\)/);
  assert.match(main, /autoStartController\?\.getEnabled\(\)/);
  assert.doesNotMatch(main, /setLoginItemSettings\(\{ openAtLogin: Boolean\(enabled\), path: process\.execPath/);
});

test("autostart stays disabled until hydration and rolls back to the last confirmed state on failure", () => {
  assert.match(html, /id="autoStartStatus"[^>]+role="status"/);
  assert.match(html, /id="autoStartToggle"[^>]+disabled/);
  assert.match(renderer, /async function hydratePreferences/);
  assert.match(renderer, /autoStartToggle\.disabled = true/);
  assert.match(renderer, /confirmedAutoStart = Boolean\(preferences\.autoStart\)/);
  assert.match(renderer, /toggle\.checked = confirmedAutoStart/);
  assert.match(renderer, /Could not update startup/);
  assert.match(renderer, /Could not read startup setting/);
  assert.match(main, /autoStartAvailable: autoStart\.available/);
});

test("saved native mode and side are authoritative before renderer startup", () => {
  const loadPreferences = main.slice(main.indexOf("function loadPreferences"), main.indexOf("function savePreferences"));
  const readyToShow = main.slice(main.indexOf('windowRef.once("ready-to-show"'), main.indexOf('windowRef.on("close"'));
  const getPreferences = main.slice(main.indexOf('ipcMain.handle("get-preferences"'), main.indexOf('ipcMain.handle("app-info"'));

  assert.match(loadPreferences, /windowMode = preferences\.windowState\.mode/);
  assert.match(loadPreferences, /preferences\.windowState\[windowMode\]\?\.side \|\| preferences\.compactSide/);
  assert.match(readyToShow, /applyWindowMode\(preferences\.windowState\.mode, \{ captureCurrent: false, persist: false \}\)/);
  assert.match(getPreferences, /windowMode/);
  assert.match(getPreferences, /compactSide: preferences\.compactSide/);
  assert.match(renderer, /applyCompactSide\(preferences\.compactSide \|\| "right"\)/);
  assert.match(renderer, /applyWindowMode\(preferences\.windowMode \|\| "full"\)/);
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

test("edge mode only captures the visible handle and passes transparent glow clicks through", () => {
  const preload = readFileSync(path.join(root, "src", "preload.cjs"), "utf8");
  const css = readFileSync(path.join(root, "src", "renderer", "styles.css"), "utf8");
  assert.match(main, /setIgnoreMouseEvents\(true, \{ forward: true \}\)/);
  assert.match(main, /set-edge-pointer-active/);
  assert.match(preload, /setEdgePointerActive/);
  assert.match(renderer, /const EDGE_HIT_PADDING = 5/);
  assert.match(renderer, /getBoundingClientRect\(\)/);
  assert.match(renderer, /rect\.left - EDGE_HIT_PADDING/);
  assert.match(renderer, /document\.addEventListener\("mousemove", updateEdgePointerHit, true\)/);
  assert.match(css, /\.edge-hit-active \.edge-line[^}]+scaleY\(1\.035\)/);
  assert.doesNotMatch(css, /\.edge-hit-active \.edge-line[^}]+translateX/);
  const endCompactDrag = renderer.match(/async function endCompactDrag\(event\) \{[\s\S]+?\n\}/)?.[0] || "";
  assert.ok(
    endCompactDrag.indexOf("window.widget.endCompactDrag()") < endCompactDrag.indexOf("if (!moved) return"),
    "a click without movement must still clear the native compact drag origin",
  );
});

test("orb activity glow eases between idle, thinking, writing, tool, waiting, error, and done palettes", () => {
  const css = readFileSync(path.join(root, "src", "renderer", "styles.css"), "utf8");
  assert.match(css, /@property --orb-ring-primary/);
  assert.match(css, /\.orb-glow[^}]+transition:--orb-ring-primary \.58s ease/);
  assert.match(css, /\.mode-orb\.activity-thinking\s*\{/);
  assert.match(css, /\.mode-orb\.activity-writing\s*\{/);
  assert.match(css, /\.mode-orb\.activity-tool\s*\{/);
  assert.match(css, /\.mode-orb\.state-waiting\s*\{/);
  assert.match(css, /\.mode-orb\.state-error\s*\{/);
  assert.match(css, /\.mode-orb\.state-done\s*\{/);
});

test("the clickable NeoXider brand becomes a full-window drag target after movement", () => {
  const css = readFileSync(path.join(root, "src", "renderer", "styles.css"), "utf8");
  assert.match(renderer, /beginFullDrag/);
  assert.match(renderer, /moveFullDrag/);
  assert.match(renderer, /endFullDrag/);
  assert.match(renderer, /suppressProjectClick/);
  assert.match(main, /begin-full-drag/);
  assert.match(main, /move-full-drag/);
  assert.match(main, /end-full-drag/);
  assert.match(renderer, /function suppressBrandClickAfterDrag/);
  assert.match(renderer, /suppressProjectClick = false; \}, 1200/);
  assert.match(html, /class="brand no-drag"/);
  assert.match(renderer, /for \(const target of \[\$\("\.brand"\)\]\)/);
  assert.match(css, /\.brand \{[^}]+user-select:none[^}]+-webkit-user-drag:none/);
});

test("avatar click replaces the redundant collapse icon", () => {
  assert.match(html, /id="avatarButton"[^>]+Collapse to avatar/);
  assert.doesNotMatch(html, /id="orbButton"/);
  assert.match(renderer, /\$\("#avatarButton"\)\.addEventListener\("click"/);
});

test("consecutive tool activity collapses into one expandable group", () => {
  assert.match(renderer, /function appendActivityRun/);
  assert.match(renderer, /className = `tool-group/);
  assert.match(renderer, /state\.currentMessages\[index\]\.role === "tool"/);
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
  const toolbar = html.slice(html.indexOf('<div class="chat-heading'), html.indexOf('<details id="activityCard"'));
  assert.match(toolbar, /id="sessionButton"/);
  assert.match(toolbar, /id="agentControls"/);
});

test("the session toolbar has a DeepSeek button for the selected Harness session", () => {
  const toolbar = html.slice(html.indexOf('<div class="chat-heading'), html.indexOf('<details id="activityCard"'));
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
  assert.match(readFileSync(path.join(root, "src", "markdown.cjs"), "utf8"), /highlight\.js\/lib\/common/);
  assert.match(readFileSync(path.join(root, "src", "renderer", "styles.css"), "utf8"), /\.hljs-keyword/);
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
  assert.match(submit, /setSettingsOpen\(false, \{ restoreFocus: false \}\)/);
  assert.match(submit, /setCommandMenuOpen\(false\)/);
  assert.match(submit, /closePickers\(\)/);
});

test("offline status is shown once with an explicit guarded Start action", () => {
  assert.match(html, /id="offlineBanner"[^>]+role="status"/);
  assert.match(html, /id="offlineBannerText">Harness is offline/);
  assert.match(html, /id="startHarnessButton"[^>]*>Start<\/button>/);
  assert.match(renderer, /async function startHarnessFromBanner/);
  assert.match(renderer, /state\.harnessStarting/);
  assert.match(renderer, /await window\.widget\.startHarness\(\)/);
  assert.match(renderer, /setAvatar\("error", ""\)/);
  assert.doesNotMatch(renderer, /setAvatar\("error", "Harness offline"\)/);
});

test("the renderer runs under a strict content security policy", () => {
  const policy = html.match(/http-equiv="Content-Security-Policy"[\s\S]*?content="([^"]+)"/);
  assert.ok(policy, "index.html must declare a Content-Security-Policy");
  const directives = new Map(
    policy[1].split(";").map((entry) => entry.trim()).filter(Boolean)
      .map((entry) => [entry.split(/\s+/)[0], entry]),
  );
  assert.equal(directives.get("default-src"), "default-src 'none'");
  assert.equal(directives.get("script-src"), "script-src 'self'");
  assert.equal(directives.get("object-src"), "object-src 'none'");
  assert.equal(directives.get("base-uri"), "base-uri 'none'");
  // Attachment thumbnails are inlined as base64, everything else stays local.
  assert.equal(directives.get("img-src"), "img-src 'self' data:");
  assert.doesNotMatch(policy[1], /unsafe-inline|unsafe-eval/);
});

test("remote content can never replace the widget or open its own window", () => {
  assert.match(main, /setWindowOpenHandler\(\(\{ url \}\) => \{[\s\S]*?action: "deny"/);
  assert.match(main, /on\("will-navigate", \(event, url\) => \{[\s\S]*?event\.preventDefault\(\)/);
  assert.match(main, /on\("will-attach-webview", \(event\) => event\.preventDefault\(\)\)/);
  assert.match(main, /EXTERNAL_LINK_PROTOCOLS = new Set\(\["http:", "https:", "mailto:"\]\)/);
  assert.match(main, /function parseExternalUrl/);
});

test("every dimmed label and focus ring keeps a readable contrast token", () => {
  const styles = readFileSync(path.join(root, "src", "renderer", "styles.css"), "utf8");
  assert.match(styles, /--dim: #8b97a9;/);
  assert.match(styles, /--focus-ring: #7defd2;/);
  assert.match(styles, /:focus-visible \{ outline:2px solid var\(--focus-ring\); outline-offset:2px; \}/);
  // The low-contrast greys these replaced must not come back.
  for (const retired of ["#6f7b8d", "#697487", "#6f7b8e", "#657387"]) {
    assert.doesNotMatch(styles, new RegExp(retired), `${retired} fails WCAG AA on the widget surface`);
  }
  // Focus must stay visible on controls that only tinted their background before.
  assert.doesNotMatch(styles, /:focus-visible \{[^}]*outline:none/);
});

test("the conversation is announced to assistive technology", () => {
  assert.match(html, /id="messages"[^>]+role="log"/);
  assert.match(html, /id="messages"[^>]+aria-live="polite"/);
});

test("polling backs off while the widget is hidden", () => {
  assert.match(renderer, /POLL_INTERVAL_VISIBLE = 2500/);
  assert.match(renderer, /POLL_INTERVAL_HIDDEN = 10000/);
  assert.match(renderer, /document\.hidden \? POLL_INTERVAL_HIDDEN : POLL_INTERVAL_VISIBLE/);
  assert.match(renderer, /addEventListener\("visibilitychange"/);
  assert.doesNotMatch(renderer, /setInterval\(refresh, 2500\)/);
});

test("the shipped product name is used everywhere the user can see it", () => {
  assert.match(html, /<title>NeoXider Agent Deck<\/title>/);
  assert.doesNotMatch(`${html}\n${renderer}`, /deepseek-harness-widget/);
  assert.doesNotMatch(html, /DeepSeek Harness Widget/);
});

test("a losing second instance stops before it can build a window", () => {
  assert.match(main, /if \(!hasSingleInstanceLock\) \{\s*\n\s*app\.quit\(\);\s*\n\s*return;\s*\n\}/);
});

test("a failed settings write can never crash the main process", () => {
  assert.match(main, /function writePreferences\(\) \{\s*\n\s*try \{[\s\S]*?\} catch \(error\) \{/);
  // Both the immediate and the debounced path must go through the guarded writer.
  assert.doesNotMatch(main, /preferenceSaveTimer = setTimeout\(\(\) => \{\s*\n\s*preferenceSaveTimer = null;\s*\n\s*preferences = settingsStore\.save/);
});

test("continuous slider input is debounced instead of rewritten per tick", () => {
  const opacity = main.slice(main.indexOf('ipcMain.handle("set-opacity"'), main.indexOf('ipcMain.handle("set-size"'));
  assert.match(opacity, /schedulePreferenceSave\(\)/);
  assert.doesNotMatch(opacity, /\n\s*savePreferences\(\);/);
});

test("a dead renderer is recovered instead of left on screen", () => {
  assert.match(main, /on\("render-process-gone"/);
  assert.match(main, /MAX_RENDERER_RECOVERIES = 3/);
  assert.match(main, /windowRef\.webContents\.reload\(\)/);
});

test("shutdown releases the tray and guards a destroyed window", () => {
  assert.match(main, /tray\?\.destroy\(\)/);
  assert.match(main, /app\.on\("activate", \(\) => \(windowRef && !windowRef\.isDestroyed\(\)/);
  assert.match(main, /ipcMain\.on\("agent-complete"[\s\S]*?!windowRef \|\| windowRef\.isDestroyed\(\)/);
});

test("the settings swap never deletes the destination first", () => {
  const store = readFileSync(path.join(root, "src", "settings-store.cjs"), "utf8");
  const save = store.slice(store.indexOf("save(value)"));
  assert.match(save, /fileSystem\.renameSync\(temporaryPath, filePath\)/);
  assert.doesNotMatch(save, /rmSync\(filePath/);
});
