const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = readFileSync(path.join(root, "src", "renderer", "index.html"), "utf8");
const renderer = readFileSync(path.join(root, "src", "renderer", "app.js"), "utf8");
const main = readFileSync(path.join(root, "src", "main.cjs"), "utf8");
const externalLinks = readFileSync(path.join(root, "src", "external-links.cjs"), "utf8");
// The IPC handlers moved out of main.cjs behind one shared sender guard. Contracts about
// a channel are asserted against the file that now owns it, not against main.cjs.
const ipc = readFileSync(path.join(root, "src", "ipc-handlers.cjs"), "utf8");
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
  assert.ok(focus > 0 && focus < context && context < attach && attach < commands && commands < input && input < stop && stop < send);
  assert.match(html, /class="composer-view-stack"[\s\S]+id="focusChatButton"[\s\S]+id="contextMeter"/);
  assert.match(html, /class="composer-utility-stack"[\s\S]+id="attachButton"[\s\S]+id="commandsButton"/);
  assert.match(css, /\.composer-utility-stack \{[^}]+width:28px[^}]+height:50px[^}]+grid-template-rows:repeat\(2,24px\)/);
  assert.match(css, /\.composer-utility-stack \.composer-action \{[^}]+width:28px[^}]+height:24px/);
  assert.match(css, /\.composer-view-stack \{[^}]+height:50px[^}]+grid-template-rows:repeat\(2,24px\)/);
  assert.match(css, /\.composer-view-stack \.focus-chat-button \{[^}]+width:28px[^}]+height:24px/);
  assert.match(css, /\.context-meter \{[^}]+width:28px[^}]+height:18px/);
  assert.match(css, /\.composer #sendButton \{[^}]+width:38px[^}]+height:38px/);
  assert.match(css, /\.context-meter svg \{[^}]+top:50%[^}]+left:50%[^}]+translate\(-50%,-50%\)/);
  assert.match(css, /\.context-meter span \{[^}]+position:absolute[^}]+inset:0[^}]+place-items:center/);
  assert.match(css, /\.composer\.context-unavailable \{[^}]+grid-template-columns:28px 28px minmax\(0,1fr\) 38px/);
  assert.match(css, /\.context-meter\.unavailable \{ display:grid; opacity:\.64; \}/);
  assert.match(renderer, /classList\.toggle\("context-unavailable", !pressure\)/);
  assert.match(renderer, /\$\("#contextValue"\)\.textContent = "0%"/);
  assert.match(html, /id="contextMeter"[^>]+role="progressbar"[^>]+aria-valuemin="0"[^>]+aria-valuemax="100"[^>]+aria-valuenow="0"/);
  assert.match(renderer, /meter\.setAttribute\("aria-valuenow", "0"\)/);
  assert.match(renderer, /meter\.setAttribute\("aria-valuetext", `Context usage \$\{rounded\}%/);
  assert.match(renderer, /attachment-preview/);
  assert.match(renderer, /thumbnailData/);
});

test("main composer starts on one line, grows to one third of the viewport, scrolls, and collapses after submit", () => {
  const css = readFileSync(path.join(root, "src", "renderer", "styles.css"), "utf8");
  assert.match(css, /\.composer textarea \{[^}]+min-height:34px[^}]+height:34px[^}]+max-height:var\(--composer-input-max-height,33vh\)[^}]+overflow-y:hidden[^}]+transition:height/);
  assert.match(css, /\.composer textarea\.is-scrollable \{[^}]+overflow-y:auto/);
  assert.match(renderer, /COMPOSER_INPUT_MIN_HEIGHT = 34/);
  assert.match(renderer, /COMPOSER_INPUT_MAX_VIEWPORT_RATIO = 1 \/ 3/);
  assert.match(renderer, /function resizeMessageInput\(\{ immediate = false \} = \{\}\)/);
  assert.match(renderer, /Math\.floor\(window\.innerHeight \* COMPOSER_INPUT_MAX_VIEWPORT_RATIO\)/);
  assert.match(renderer, /Math\.floor\(viewportMaximum \/ lineHeight\) \* lineHeight/);
  assert.match(renderer, /function restoreMessageInputViewport/);
  assert.match(renderer, /selectionStart: input\.selectionStart/);
  assert.match(renderer, /scrollTop: input\.scrollTop/);
  assert.match(renderer, /Math\.round\(snapshot\.scrollTop \/ snapshot\.lineHeight\) \* snapshot\.lineHeight/);
  assert.match(renderer, /input\.setSelectionRange\(snapshot\.selectionStart, snapshot\.selectionEnd, snapshot\.selectionDirection\)/);
  assert.match(renderer, /classList\.toggle\("is-scrollable", isScrollable\)/);
  assert.match(renderer, /input\.value = "";\s*\n\s*resizeMessageInput\(\);/);
  assert.match(renderer, /input\.value = text;\s*\n\s*resizeMessageInput\(\);/);
  assert.match(renderer, /window\.addEventListener\("resize", \(\) => \{[\s\S]+resizeMessageInput\(\{ immediate: true \}\)/);
});

test("the full chat has a verified 360px minimum height and a 380 by 400 compact preset", () => {
  assert.match(main, /compact: \[380, 400\]/);
  assert.match(main, /const FULL_MIN_WIDTH = 360/);
  assert.match(main, /const FULL_MIN_HEIGHT = 360/);
  assert.match(main, /Math\.min\(FULL_MIN_WIDTH, display\.width\)/);
  assert.match(main, /Math\.min\(FULL_MIN_HEIGHT, display\.height\)/);
});

test("model picker names the control and provides loading, empty, error, retry, and model-recovery UI", () => {
  assert.match(html, /class="model-button-copy"><small>MODEL<\/small><b id="modelButtonText">Loading providers…<\/b>/);
  assert.match(html, /id="modelSearch"[^>]+aria-label="Search models or providers"/);
  assert.match(renderer, /modelLoadState === "loading"/);
  assert.match(renderer, /No models loaded/);
  assert.match(renderer, /Models unavailable/);
  assert.match(renderer, /function retryModels/);
  assert.match(renderer, /function positionPickerMenu/);
  assert.match(renderer, /MODEL_PICKER_ROW_HEIGHT = 36/);
  assert.match(renderer, /bottomBoundary = Math\.min\(shell\.bottom - PICKER_SURFACE_GAP, composer\.top - PICKER_SURFACE_GAP\)/);
  assert.match(renderer, /--picker-options-height/);
  assert.match(readFileSync(path.join(root, "src", "renderer", "styles.css"), "utf8"), /\.model-menu \.picker-options:not\(:empty\)[^}]+scroll-snap-type:y mandatory/);
  assert.match(renderer, /function createModelSetupCard/);
  assert.match(renderer, /Choose model/);
  assert.match(renderer, /Retry models/);
  assert.match(renderer, /Load a model in LM Studio or another Harness provider/);
  assert.match(renderer, /\["assistant", "error"\]\.includes\(message\.role\) && isMissingModelError\(message\.text\)/);
  assert.match(renderer, /if \(!modelSetupShown\) root\.append\(createModelSetupCard\(\)\)/);
  assert.match(html, /id="controlsPrimary">Auto<\/b>/);
  assert.match(renderer, /\$\("#controlsPrimary"\)\.textContent = shortModel/);
  assert.match(renderer, /shortModel = "No model"/);
  assert.doesNotMatch(html, /<b>Model \/ Setup<\/b>/);
});

test("chat is the first and default page, followed by state-aware agents", () => {
  const titlebar = html.slice(html.indexOf('<header class="titlebar'), html.indexOf("</header>") + 9);
  assert.ok(titlebar.indexOf('data-tab="chat"') < titlebar.indexOf('data-tab="agents"'));
  assert.match(titlebar, /class="tab active" data-tab="chat"/);
  assert.match(html, /id="chatPanel" class="panel chat-panel active"/);
  assert.match(renderer, /agent-avatar \$\{agentState\}/);
  assert.match(renderer, /session-state \$\{agentState\}/);
  assert.match(renderer, /card\.tabIndex = 0/);
  assert.match(renderer, /card\.setAttribute\("role", "button"\)/);
  assert.match(renderer, /card\.setAttribute\("aria-label", `Open \$\{session\.title \|\| "New session"\}`\)/);
  assert.match(renderer, /\["Enter", " "\]\.includes\(event\.key\)/);
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
  assert.match(renderer, /COMMAND_MENU_ROW_HEIGHT = 44/);
  assert.match(renderer, /--command-menu-max-height/);
  assert.match(readFileSync(path.join(root, "src", "renderer", "styles.css"), "utf8"), /\.command-row \{[^}]+height:44px[^}]+scroll-snap-align:start/);
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
  const css = readFileSync(path.join(root, "src", "renderer", "styles.css"), "utf8");
  assert.match(renderer, /onLiveEvent/);
  assert.match(renderer, /function handleLiveEvent/);
  assert.match(renderer, /chunk\.type === "text-delta"/);
  assert.match(renderer, /live-assistant/);
  assert.match(renderer, /function liveAssistantSnapshot/);
  assert.match(renderer, /activity\?\.active && activity\.kind === "writing" && activity\.text/);
  assert.match(renderer, /hasWritingBubble/);
  assert.match(css, /\.live-assistant::after \{[^}]+width:4px[^}]+animation:live-caret/);
  assert.match(css, /prefers-reduced-motion[\s\S]+\.live-assistant::after \{ animation:none !important/);
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
  assert.match(ipc, /set-glow-intensity/);
});

test("collapsed pet exposes three exact recent sessions and inline quick reply without restoring full mode", () => {
  assert.doesNotMatch(html, /id="orb(?:NewSession|Commands|Attach)"/);
  assert.match(html, /id="orbSessionList"[^>]+role="list"/);
  assert.match(html, /id="orbReplyForm"[^>]+aria-label="Quick reply"/);
  assert.match(html, /id="orbReplyInput"[^>]+aria-label="Quick reply message"/);
  assert.match(renderer, /compactNotificationTimer = setTimeout/);
  assert.match(renderer, /\}, 2500\)/);
  assert.match(renderer, /orb-status-closing/);
  assert.match(renderer, /else notifyCompletion\(session\)/);
  assert.match(renderer, /recentReplySessions\(state\.dashboard\?\.sessions, 3\)/);
  assert.match(renderer, /openCompactSession\(session\.sessionId\)/);
  assert.match(renderer, /openCompactReply\(session\.sessionId\)/);
  assert.match(renderer, /await selectSession\(sessionId, true\)/);
  const quickReply = renderer.slice(renderer.indexOf("async function sendCompactReply"), renderer.indexOf("function detectCompletedSessions"));
  assert.match(quickReply, /window\.widget\.send\(\{/);
  assert.match(quickReply, /sessionId,/);
  assert.match(quickReply, /trackQueuedPrompt\(sessionId/);
  assert.doesNotMatch(quickReply, /setWindowMode\("full"\)/);
  assert.match(renderer, /if \(state\.compactReplyBusy\) return/);
  assert.match(renderer, /event\.key === "Enter" && !event\.shiftKey/);
  assert.match(renderer, /event\.key === "Escape" && state\.windowMode === "orb"/);
  assert.match(renderer, /event\.target\.closest\("#orbStatus, #orbHistoryButton"\)/);
  assert.match(main, /const ORB_SIZE = 128/);
  assert.match(main, /const ORB_EXPANDED_HEIGHT = 158/);
  assert.match(main, /const ORB_EXPANDED_WIDTH = 460/);
  assert.match(ipc, /preserveCompactPosition: true/);
});

test("window layer has normal, above-by-default, and fullscreen-game modes", () => {
  assert.match(html, /data-layer="normal"/);
  assert.match(html, /data-layer="normal"[^>]+>Desktop<\/button>/);
  assert.match(html, /every normal app window covers the widget/);
  assert.match(html, /data-layer="above"/);
  assert.match(html, /data-layer="game"/);
  assert.match(settingsStore, /windowLayer: "above"/);
  assert.match(main, /applyPlatformWindowLayer/);
  assert.match(main, /preferences\.windowLayer = normalizeWindowLayer\(preferences\.windowLayer, PLATFORM_CAPABILITIES\)/);
  assert.match(platformCapabilities, /"screen-saver"/);
  assert.match(platformCapabilities, /"floating"/);
  assert.match(ipc, /set-window-layer/);
  assert.match(renderer, /setWindowLayer/);
});

test("production autostart uses the stable portable launcher controller", () => {
  assert.match(main, /createAutoStartController/);
  assert.match(main, /autoStartController\.migrateLegacy\(\)/);
  assert.match(ipc, /getAutoStartController\(\)\.setEnabled\(enabled\)/);
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
  assert.match(ipc, /autoStartAvailable: autoStart\.available/);
});

test("saved native mode and side are authoritative before renderer startup", () => {
  const loadPreferences = main.slice(main.indexOf("function loadPreferences"), main.indexOf("function savePreferences"));
  const readyToShow = main.slice(main.indexOf('windowRef.once("ready-to-show"'), main.indexOf('windowRef.on("close"'));
  const getPreferences = ipc.slice(ipc.indexOf('handle("get-preferences"'), ipc.indexOf('handle("app-info"'));

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
  assert.match(ipc, /set-compact-status/);
  assert.match(main, /quitCoordinator\.handleWindowClose\(event, \(\) => applyWindowMode\("edge"\)\)/);
});

test("compact modes preserve short clicks and start native drag only after the movement threshold", () => {
  assert.match(renderer, /setPointerCapture/);
  assert.match(renderer, /beginCompactDrag/);
  assert.match(renderer, /moveCompactDrag/);
  assert.match(renderer, /endCompactDrag/);
  assert.match(renderer, /Math\.hypot\(dx, dy\) < 4/);
  assert.match(renderer, /if \(!compactDrag\.nativeStarted\)/);
  assert.match(renderer, /window\.widget\.beginCompactDrag\(\{ x: compactDrag\.startX, y: compactDrag\.startY \}\)/);
  assert.match(renderer, /if \(!nativeStarted\) return/);
  const begin = renderer.slice(renderer.indexOf("function beginCompactDrag"), renderer.indexOf("function moveCompactDrag"));
  assert.doesNotMatch(begin, /setPointerCapture|window\.widget\.beginCompactDrag/);
  assert.match(ipc, /begin-compact-drag/);
  assert.match(ipc, /move-compact-drag/);
  assert.match(ipc, /end-compact-drag/);
  assert.match(ipc, /wasActive !== compactStatus\.active \|\| wasExpanded !== compactStatus\.expanded/);
  assert.match(ipc, /setCompactStatusResizePending\(true\)/);
  assert.match(ipc, /getWindowMode\(\) === "orb" && getCompactStatusResizePending\(\)[\s\S]+?applyWindowMode\("orb"/);
  assert.match(html, /data-avatar[^>]+draggable="false"/);
});

test("edge mode only captures the visible handle and passes transparent glow clicks through", () => {
  const preload = readFileSync(path.join(root, "src", "preload.cjs"), "utf8");
  const css = readFileSync(path.join(root, "src", "renderer", "styles.css"), "utf8");
  assert.match(main, /setIgnoreMouseEvents\(true, \{ forward: true \}\)/);
  assert.match(ipc, /set-edge-pointer-active/);
  assert.match(preload, /setEdgePointerActive/);
  assert.match(renderer, /const EDGE_HIT_PADDING = 5/);
  assert.match(renderer, /getBoundingClientRect\(\)/);
  assert.match(renderer, /rect\.left - EDGE_HIT_PADDING/);
  assert.match(renderer, /document\.addEventListener\("mousemove", updateEdgePointerHit, true\)/);
  assert.match(css, /--edge-primary:#49e7c6/);
  assert.match(css, /--edge-secondary:#48bfff/);
  assert.match(css, /--edge-halo-opacity:\.22/);
  assert.doesNotMatch(css, /\.mode-edge\.state-idle \.edge-line[^\{]*\{[^\}]*animation/);
  assert.match(css, /\.edge-hit-active \.edge-line::after, \.edge-mode:focus-visible \.edge-line::after/);
  assert.doesNotMatch(css, /\.edge-hit-active \.edge-line[^}]+scaleY/);
  assert.doesNotMatch(css, /\.edge-hit-active \.edge-line[^}]+translateX/);
  const endCompactDrag = renderer.match(/async function endCompactDrag\(event\) \{[\s\S]+?\n\}/)?.[0] || "";
  assert.ok(
    endCompactDrag.indexOf("if (!nativeStarted) return") < endCompactDrag.indexOf("window.widget.endCompactDrag()"),
    "a short click must not create or end a native drag",
  );
});

test("edge line mirrors thinking, writing, tool, waiting, done, and error states", () => {
  const css = readFileSync(path.join(root, "src", "renderer", "styles.css"), "utf8");
  assert.match(css, /\.mode-edge\.activity-thinking\s*\{/);
  assert.match(css, /\.mode-edge\.activity-writing\s*\{/);
  assert.match(css, /\.mode-edge\.activity-tool\s*\{/);
  assert.match(css, /\.mode-edge\.state-waiting\s*\{/);
  assert.match(css, /\.mode-edge\.state-done\s*\{/);
  assert.match(css, /\.mode-edge\.state-error\s*\{/);
  assert.match(css, /@property --edge-primary/);
  assert.match(css, /transition:--edge-primary \.58s ease,--edge-secondary \.58s ease/);
  assert.match(css, /\.edge-mode\.bounce \.edge-line/);
  assert.match(css, /@keyframes edge-done-pulse/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)/);
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
  assert.match(css, /\.orb-has-notification \.orb-status \{[^}]+box-shadow:none/);
  assert.match(css, /\.orb-history-button:hover, \.orb-history-button\.active \{[^}]+box-shadow:none/);
});

test("the clickable NeoXider brand becomes a full-window drag target after movement", () => {
  const css = readFileSync(path.join(root, "src", "renderer", "styles.css"), "utf8");
  assert.match(renderer, /beginFullDrag/);
  assert.match(renderer, /moveFullDrag/);
  assert.match(renderer, /endFullDrag/);
  assert.match(renderer, /suppressProjectClick/);
  assert.match(ipc, /begin-full-drag/);
  assert.match(ipc, /move-full-drag/);
  assert.match(ipc, /end-full-drag/);
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
  assert.match(ipc, /open-harness-session/);
  assert.match(ipc, /harnessSessionUrl\(harnessUrl, sessionId\)/);
});

test("widget-created and widget-prompted sessions enforce Full access", () => {
  const matches = ipc.match(/api\.ensureFullAccess\(sessionId\)/g) || [];
  assert.equal(matches.length, 2);
  assert.match(ipc, /create-session[\s\S]{0,300}ensureFullAccess/);
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
  assert.match(ipc, /renderMarkdown\(message\.text\)/);
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
  assert.match(renderer, /matchMedia\?\.\("\(prefers-reduced-motion: reduce\)"\)\.matches/);
  assert.match(renderer, /behavior: reduceMotion \? "auto" : "smooth"/);
});

test("screen capture is a visible header action and only prepares reviewed chat attachments", () => {
  const preload = readFileSync(path.join(root, "src", "preload.cjs"), "utf8");
  assert.match(html, /id="captureButton"/);
  assert.match(html, /data-capture="region"/);
  assert.match(html, /data-capture="display"/);
  assert.match(preload, /captureScreenshot: \(kind\) => ipcRenderer\.invoke\("capture-screenshot", kind\)/);
  assert.match(ipc, /handle\("capture-screenshot"/);
  assert.match(main, /screenshotCaptureGate\.run/);
  assert.match(main, /await screenshotService\.removeCapture\(result\.path\)/);
  assert.match(ipc, /await cleanupSentCaptureFiles\(attachments\)/);
  assert.match(renderer, /addAttachments\(result\.prepared\)/);
  assert.match(renderer, /Screenshot attached above the message field\. Review it before sending\./);
  assert.doesNotMatch(renderer, /handleScreenshotResult[\s\S]{0,700}requestSubmit\(/);
});

test("all six global shortcuts can be rebound, disabled, reset, and persisted", () => {
  const preload = readFileSync(path.join(root, "src", "preload.cjs"), "utf8");
  const store = readFileSync(path.join(root, "src", "settings-store.cjs"), "utf8");
  for (const action of ["showRestore", "collapseAvatar", "collapseEdge", "newSession", "captureDisplay", "captureRegion"]) {
    assert.match(html, new RegExp(`data-hotkey-action="${action}"`));
    assert.match(html, new RegExp(`data-hotkey-enabled="${action}"`));
  }
  assert.match(html, /id="resetHotkeysButton"/);
  assert.match(preload, /setHotkeys/);
  assert.match(preload, /resetHotkeys/);
  assert.match(main, /createHotkeyManager/);
  assert.match(main, /registerConfiguredHotkeys\(preferences\.hotkeys\)/);
  assert.match(main, /shortcut remains enabled and will be retried next launch/);
  assert.doesNotMatch(main, /preferences\.hotkeys = registerConfiguredHotkeys/);
  assert.match(store, /hotkeys: DEFAULT_HOTKEYS/);
  assert.match(renderer, /function hotkeyDisplayName\(accelerator\)/);
  assert.match(renderer, /replaceAll\("CommandOrControl", commandKey\)/);
  assert.match(renderer, /duplicate|conflict|Shortcut is unavailable/i);
});

test("updates download in the background and expose install only after verification", () => {
  const preload = readFileSync(path.join(root, "src", "preload.cjs"), "utf8");
  for (const id of ["updateSettings", "updateStatus", "updateProgress", "checkUpdateButton", "installUpdateButton", "headerUpdateButton"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const api of ["getUpdateState", "checkForUpdates", "installUpdate", "onUpdateState"]) {
    assert.match(preload, new RegExp(api));
  }
  assert.match(main, /createApplicationUpdateService/);
  assert.match(main, /createUpdateService/);
  assert.match(main, /createInstalledUpdateService/);
  assert.match(main, /sendToRenderer\("update-state", state\)/);
  assert.match(main, /async function checkAndStageUpdate\(\)/);
  assert.match(main, /result\?\.status === "available"[\s\S]+\["portable-replace", "managed"\]\.includes\(result\.installMode\)[\s\S]+updateService\.download\(\)/);
  assert.match(main, /setTimeout\(\(\) => checkAndStageUpdate\(\)/);
  assert.match(renderer, /function renderUpdateState\(value\)/);
  assert.match(renderer, /Install & restart/);
  assert.match(renderer, /headerInstallButton\.hidden = value\.status !== "ready"/);
  assert.match(renderer, /\$\("#headerUpdateButton"\)\.addEventListener\("click", \(\) => runUpdateAction\("install"\)\)/);
  assert.doesNotMatch(html, /downloadUpdateButton/);
  assert.doesNotMatch(preload, /downloadUpdate|download-update/);
  assert.doesNotMatch(renderer, /runUpdateAction\("download"\)/);
});

test("full, avatar, and edge transitions use a short renderer handoff without touching saved geometry", () => {
  const css = readFileSync(path.join(root, "src", "renderer", "styles.css"), "utf8");
  assert.match(renderer, /MODE_EXIT_DURATION = 105/);
  assert.match(renderer, /await animateModeExit\(mode, requestSequence\)/);
  assert.match(renderer, /requestSequence !== modeRequestSequence/);
  assert.match(renderer, /function applyAuthoritativeWindowMode\(mode\)/);
  assert.match(renderer, /function animateModeEnter\(previousMode\)/);
  assert.match(renderer, /prefersReducedMotion\(\)/);
  assert.match(css, /\.mode-transition-out\.mode-full \.widget-shell/);
  assert.match(css, /\.mode-transition-in\.mode-orb \.orb-mode/);
  assert.match(css, /\.mode-transition-in\.mode-edge \.edge-mode/);
  assert.match(css, /@keyframes mode-enter-full/);
  assert.match(css, /@keyframes mode-enter-orb/);
  assert.match(css, /@keyframes mode-enter-edge/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)/);
  assert.doesNotMatch(css, /(?:^|\n)\.mode-full \.widget-shell \{[^}]*animation:/);
  assert.doesNotMatch(css, /(?:^|\n)\.mode-orb \.orb-mode \{[^}]*animation:/);
  assert.doesNotMatch(css, /(?:^|\n)\.mode-edge \.edge-mode \{[^}]*animation:/);
  assert.doesNotMatch(css, /@keyframes (?:shell|compact|edge)-enter/);
  const transitionBlock = renderer.slice(renderer.indexOf("const MODE_EXIT_DURATION"), renderer.indexOf("function applyCompactSide"));
  assert.doesNotMatch(transitionBlock, /setPosition|setBounds|windowState|compactSide/);
});

test("compact errors are acknowledged in full chat and completion feedback is finite and interruptible", () => {
  const css = readFileSync(path.join(root, "src", "renderer", "styles.css"), "utf8");
  assert.match(renderer, /compactErrorUnread: false/);
  assert.match(renderer, /unacknowledgedErrorSessionIds: new Set\(\)/);
  assert.match(renderer, /function signalSessionError\(session/);
  assert.match(renderer, /if \(mode !== "done"\) clearCompletionSignal\(\)/);
  assert.match(renderer, /clearTimeout\(state\.compactNotificationTimer\)[\s\S]+?state\.compactNotification = null/);
  assert.match(renderer, /state\.unacknowledgedErrorSessionIds\.add\(sessionId\)/);
  assert.match(renderer, /acknowledgeSessionError\(state\.selectedSessionId\)/);
  assert.match(renderer, /state\.selectedSessionId = sessionId;[\s\S]+?await setWindowMode\("full"\)/);
  assert.match(renderer, /state\.avatarMode === "error" && !state\.compactErrorUnread && !state\.harnessOffline/);
  assert.match(renderer, /session\?\.state === "error"\) signalSessionError\(session\)/);
  assert.match(renderer, /if \(state\.windowMode === "full"\) \{[\s\S]+?if \(latest\?\.role === "error"\) setAvatar\("error", "model error"\)/);
  assert.match(renderer, /function clearCompletionSignal\(\)/);
  assert.match(renderer, /document\.body\.classList\.add\("completion-celebration"\)/);
  assert.match(renderer, /state\.completionSignalTimer = setTimeout[\s\S]+?\}, 2600\)/);
  assert.match(css, /\.completion-celebration\.mode-full \.widget-shell::after/);
  assert.match(css, /\.completion-celebration\.mode-orb \.orb-avatar/);
  assert.match(css, /\.completion-celebration\.mode-edge \.edge-line/);
  assert.doesNotMatch(css, /\.completion-celebration[^\{]*\{[^\}]*infinite/);
  assert.doesNotMatch(css, /\.mode-edge\.state-error \.edge-line[^\{]*\{[^\}]*infinite/);
});

test("settings keeps keyboard focus inside its modal surface", () => {
  assert.match(renderer, /function trapSettingsFocus/);
  assert.match(renderer, /event\.key !== "Tab"/);
  assert.match(renderer, /document\.activeElement === first/);
  assert.match(renderer, /document\.activeElement === last/);
  assert.match(renderer, /if \(trapSettingsFocus\(event\)\) return/);
  assert.match(renderer, /if \(element !== panel\) element\.inert = next/);
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
  assert.match(renderer, /Start Harness to load sessions\./);
  assert.match(renderer, /!dashboard\.harness && state\.focusMode\) setFocusMode\(false\)/);
  assert.doesNotMatch(renderer, /empty\.textContent = [^\n]+: "Harness is offline\."/);
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
  assert.match(main, /createExternalLinkOpener/);
  assert.match(externalLinks, /EXTERNAL_LINK_PROTOCOLS = new Set\(\["http:", "https:", "mailto:"\]\)/);
  assert.match(externalLinks, /function parseExternalUrl/);
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
  const opacity = ipc.slice(ipc.indexOf('handle("set-opacity"'), ipc.indexOf('handle("set-size"'));
  assert.match(opacity, /schedulePreferenceSave\(\)/);
  assert.doesNotMatch(opacity, /\n\s*savePreferences\(\);/);
});

test("a dead renderer is recovered instead of left on screen", () => {
  assert.match(main, /require\("\.\/renderer-recovery\.cjs"\)/);
  assert.match(main, /on\("render-process-gone"/);
  assert.match(main, /on\("did-finish-load", \(\) => rendererRecovery\.loaded\(\)\)/);
  assert.match(main, /on\("did-fail-load"/);
  assert.match(main, /on\("unresponsive"/);
});

test("shutdown releases the tray and guards a destroyed window", () => {
  assert.match(main, /tray\?\.destroy\(\)/);
  assert.match(main, /rendererRecovery\?\.dispose\(\)/);
  assert.match(main, /app\.on\("activate", \(\) => quitCoordinator\.handleActivation/);
  // The encoder pool has to be torn down before the coordinator runs, so this is a block
  // now rather than a one-liner. Both calls must still be there, in that order.
  assert.match(main, /app\.on\("before-quit", \(\) => \{[^}]*imageEncoder\.shutdown\(\);[^}]*quitCoordinator\.beforeQuit\(\);/);
  assert.match(main, /requestQuit\("tray"\)/);
  // agent-complete is registered through the shared guard, and that guard refuses a
  // destroyed window before any handler body runs — for this channel and every other.
  assert.match(ipc, /\n\s*on\("agent-complete"/);
  assert.match(ipc, /if \(!target \|\| target\.isDestroyed\?\.\(\)\) return false/);
});

test("the settings swap never deletes the destination first", () => {
  const store = readFileSync(path.join(root, "src", "settings-store.cjs"), "utf8");
  const save = store.slice(store.indexOf("save(value)"));
  assert.match(save, /fileSystem\.renameSync\(temporaryPath, filePath\)/);
  assert.doesNotMatch(save, /rmSync\(filePath/);
});

test("a tap on the brand is resolved by the drag handler, not by a stolen click", () => {
  // Pointer capture on .brand retargets the click away from the child button, so the
  // gesture end must act on the element the pointer went down on.
  assert.match(renderer, /origin: event\.target/);
  assert.match(renderer, /function activateBrandTarget\(origin\)/);
  assert.match(renderer, /origin\.closest\("#avatarButton"\)\) setWindowMode\("orb"\)/);
  assert.match(renderer, /origin\.closest\("#projectLink"\)\) window\.widget\.openProject\(\)/);
  const endFull = renderer.slice(renderer.indexOf("function endFullDrag"), renderer.indexOf("function activateBrandTarget"));
  assert.match(endFull, /\} else \{\s*\n\s*activateBrandTarget\(origin\);/);
  // Keyboard activation must still work, and must not double-fire with the tap path.
  assert.match(renderer, /if \(event\.detail !== 0 \|\| suppressProjectClick\) return;\s*\n\s*setWindowMode\("orb"\);/);
});

test("releasing a compact drag arms the click guard before any await", () => {
  const endCompact = renderer.slice(
    renderer.indexOf("async function endCompactDrag"),
    renderer.indexOf("function initials"),
  );
  const guardAt = endCompact.indexOf("suppressCompactClick = true");
  const awaitAt = endCompact.indexOf("await window.widget.endCompactDrag()");
  assert.ok(guardAt > 0 && awaitAt > 0, "both the guard and the IPC call must be present");
  assert.ok(
    guardAt < awaitAt,
    "the click fires synchronously after pointerup, so the guard must be set before awaiting IPC",
  );
});

test("every bridged IPC channel has a handler and no handler is orphaned", () => {
  const preload = readFileSync(path.join(root, "src", "preload.cjs"), "utf8");
  const bridged = [...preload.matchAll(/ipcRenderer\.(?:invoke|send)\("([^"]+)"/g)].map((match) => match[1]);
  // Registration goes through the guarded handle()/on() helpers, so a channel that is
  // wired any other way — and therefore unguarded — would not be counted as handled.
  const handled = new Set([...ipc.matchAll(/^\s*(?:handle|on)\("([^"]+)"/gm)].map((match) => match[1]));
  const missing = bridged.filter((channel) => !handled.has(channel));
  assert.deepEqual(missing, [], `preload exposes channels the main process does not handle: ${missing.join(", ")}`);
  // A handler nothing can reach is dead weight and drifts out of sync with reality.
  const orphaned = [...handled].filter((channel) => !bridged.includes(channel));
  assert.deepEqual(orphaned, [], `main process handles channels no caller uses: ${orphaned.join(", ")}`);
});

test("the live event socket detects a half-open connection", () => {
  const muxClient = readFileSync(path.join(root, "src", "mux-client.cjs"), "utf8");
  assert.match(muxClient, /MUX_SILENCE_TIMEOUT = 60000/);
  assert.match(muxClient, /current\.onopen = \(\) => \{/);
  assert.match(muxClient, /silenceTimer = setTimeoutImpl\(\(\) => \{\s*\n\s*if \(socket === current\) current\.close\(\);/);
  // Reconnect must back off instead of retrying an offline Harness forever at 1.5s.
  assert.match(muxClient, /reconnectDelay = Math\.min\(reconnectDelay \* 2, reconnectMax\)/);
  // Wherever the logic lives, the widget still owns the socket's lifetime.
  assert.match(main, /muxClient\.connect\(\)/);
  assert.match(main, /muxClient\.stop\(\)/);
});

test("attachment preparation is asynchronous and reports failures per file", () => {
  const attachments = readFileSync(path.join(root, "src", "attachments.cjs"), "utf8");
  assert.doesNotMatch(attachments, /readFileSync\(resolved\)|statSync\(resolved\)/);
  assert.match(attachments, /await fileSystem\.stat\(resolved\)/);
  // Encoding is injected now, so the read lives in the default encoder rather than
  // inline. What matters is unchanged: it is awaited, never synchronous.
  assert.match(attachments, /await fileSystem\.readFile\(filePath\)/);
  assert.match(attachments, /encodeImage/);
  assert.match(attachments, /Promise\.allSettled\(resolved\.map\(prepareFile\)\)/);
  assert.match(attachments, /return \{ attachments, failures \}/);
  assert.match(renderer, /prepared\.failures \|\| \[\]/);
});

test("full access is negotiated once per session, not on every send", () => {
  assert.match(harnessApi, /this\.fullAccessSessions = new Set\(\)/);
  assert.match(harnessApi, /if \(this\.fullAccessSessions\.has\(key\)\) return null;/);
  assert.match(harnessApi, /this\.fullAccessSessions\.add\(key\)/);
});

test("a renderer payload cannot retarget a call at another session", () => {
  // The spread has to come first, otherwise selection.sessionId overwrites the real id.
  assert.match(harnessApi, /"session\.selectModel", \{ \.\.\.\(selection \|\| \{\}\), sessionId \}/);
  assert.match(ipc, /function requireSessionId\(value\)/);
  assert.match(ipc, /requireSessionId\(payload\?\.sessionId\)/);
});

test("settings written by a newer build are preserved, not overwritten", () => {
  const store = readFileSync(path.join(root, "src", "settings-store.cjs"), "utf8");
  assert.match(store, /const SCHEMA_VERSION = 2;/);
  assert.match(store, /version > SCHEMA_VERSION/);
  assert.match(store, /SETTINGS_TOO_NEW/);
});

test("the window is re-clamped when the display layout changes", () => {
  assert.match(main, /screen\.on\("display-metrics-changed", reclampToCurrentDisplays\)/);
  assert.match(main, /screen\.on\("display-removed", reclampToCurrentDisplays\)/);
});

test("harness launch survives a minimal PATH on macOS and Linux", () => {
  const launcher = readFileSync(path.join(root, "src", "harness-launcher.cjs"), "utf8");
  assert.match(launcher, /const loginShell = typeof env\.SHELL === "string"/);
  assert.match(launcher, /args: \["-lc", \["npx", \.\.\.args\]\.map\(shellQuote\)\.join\(" "\)\]/);
  assert.match(launcher, /function shellQuote\(value\)/);
});

test("re-asserting the same avatar state does not touch the DOM", () => {
  // The dashboard poll calls setAvatar("error", "") every 2.5s while Harness is down.
  // Rewriting the body state class each time restarted the avatar-shake animation, so a
  // failed agent made the whole widget twitch about once every three seconds.
  const body = renderer.slice(renderer.indexOf("function setAvatar"), renderer.indexOf("function renderNotifications"));
  assert.match(body, /if \(state\.avatarMode !== mode \|\| state\.avatarLabel !== text\)/);
  // The guard has to wrap the class churn, not sit beside it.
  const guardAt = body.indexOf("state.avatarLabel !== text");
  for (const churn of ['shell.className = `avatar-shell ${mode}`', 'classList.remove("state-idle"', "classList.add(`state-${mode}`)"]) {
    assert.ok(body.indexOf(churn) > guardAt, `${churn} must run only when the state actually changed`);
  }
  // An identical image src is a needless decode on every poll.
  assert.match(body, /if \(!image\.src\.endsWith\(next\)\) image\.src = next;/);
});
