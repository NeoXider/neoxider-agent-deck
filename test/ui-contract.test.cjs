const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
// core.autocrlf hands these files back with CRLF on a fresh checkout, and several
// assertions here match across a line break. Normalizing on read keeps the contracts
// about the code rather than about how the tree happened to be checked out.
const readSource = (...segments) => readFileSync(path.join(root, ...segments), "utf8").split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
const html = readSource("src", "renderer", "index.html");
const renderer = readSource("src", "renderer", "app.js");
const main = readSource("src", "main.cjs");
const externalLinks = readSource("src", "external-links.cjs");
// The IPC handlers moved out of main.cjs behind one shared sender guard. Contracts about
// a channel are asserted against the file that now owns it, not against main.cjs.
const ipc = readSource("src", "ipc-handlers.cjs");
const platformCapabilities = readSource("src", "platform-capabilities.cjs");
const settingsStore = readSource("src", "settings-store.cjs");
const harnessApi = readSource("src", "harness-api.cjs");
const updateOrchestrator = readSource("src", "update-orchestrator.cjs");

// Two negative assertions here were written as `doesNotMatch(source, /name[\s\S]{0,N}…/)`.
// A character budget is a guess about how long a function is, and both functions had
// already outgrown theirs — so the very thing they forbade could be added at the tail and
// the test stayed green. This brace-matches the real body instead, and throws rather than
// silently returning "" if a declaration ever moves.
function functionBody(source, declaration) {
  const start = source.indexOf(declaration);
  if (start < 0) throw new Error(`${declaration} not found; re-anchor the test`);
  let depth = 0;
  for (let index = source.indexOf("{", start); index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`${declaration} is unbalanced`);
}

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
  const css = readSource("src", "renderer", "styles.css");
  const context = html.indexOf('id="contextMeter"');
  const attach = html.indexOf('id="attachButton"');
  const commands = html.indexOf('id="commandsButton"');
  const focus = html.indexOf('id="focusChatButton"');
  const input = html.indexOf('id="messageInput"');
  const stop = html.indexOf('id="cancelButton"');
  const send = html.indexOf('id="sendButton"');
  assert.ok(focus > 0 && focus < context && context < commands && commands < attach && attach < input && input < stop && stop < send);
  assert.match(html, /class="composer-view-stack"[\s\S]+id="focusChatButton"[\s\S]+id="contextMeter"/);
  assert.match(html, /class="composer-utility-stack"[\s\S]+id="commandsButton"[\s\S]+id="attachButton"/);
  assert.match(css, /\.composer-utility-stack \{[^}]+width:28px[^}]+height:36px[^}]+grid-template-rows:repeat\(2,17px\)/);
  assert.match(css, /\.composer-utility-stack \.composer-action \{[^}]+width:28px[^}]+height:17px/);
  assert.match(css, /\.composer-view-stack \{[^}]+height:36px[^}]+grid-template-rows:repeat\(2,17px\)/);
  assert.match(css, /\.composer-view-stack \.focus-chat-button \{[^}]+width:28px[^}]+height:17px/);
  assert.match(css, /\.context-meter \{[^}]+width:28px[^}]+height:17px/);
  assert.match(css, /\.composer #sendButton \{[^}]+width:36px[^}]+height:36px[^}]+align-self:center/);
  assert.match(css, /\.context-meter svg \{[^}]+top:50%[^}]+left:50%[^}]+translate\(-50%,-50%\)/);
  assert.match(css, /\.context-meter span \{[^}]+position:absolute[^}]+inset:0[^}]+place-items:center/);
  assert.match(css, /\.composer\.context-unavailable \{[^}]+grid-template-columns:28px 28px minmax\(0,1fr\) 36px/);
  assert.match(css, /\.context-meter\.unavailable \{ display:grid; opacity:\.64; \}/);
  assert.match(renderer, /classList\.toggle\("context-unavailable", !pressure\)/);
  assert.match(renderer, /\$\("#contextValue"\)\.textContent = "0%"/);
  assert.match(html, /id="contextMeter"[^>]+role="progressbar"[^>]+aria-valuemin="0"[^>]+aria-valuemax="100"[^>]+aria-valuenow="0"/);
  assert.match(renderer, /meter\.setAttribute\("aria-valuenow", "0"\)/);
  assert.match(renderer, /meter\.setAttribute\("aria-valuetext", `Context usage \$\{rounded\}%/);
  assert.match(renderer, /attachment-preview/);
  assert.match(renderer, /thumbnailData/);
  assert.match(renderer, /chip\.setAttribute\("role", "group"\)/);
  assert.match(renderer, /chip\.dataset\.attachmentKind = displayKind/);
  assert.match(renderer, /removeText\.textContent = "Remove"/);
  assert.match(css, /\.attachment-chip \{[^}]+flex:0 0 172px[^}]+height:46px[^}]+grid-template-columns:48px minmax\(0,1fr\) 26px/);
  assert.match(css, /\.attachment-preview \{[^}]+width:48px[^}]+height:40px/);
  assert.match(css, /\.attachment-list \{[^}]+overflow-x:auto[^}]+scroll-snap-type:x proximity/);
});

test("main composer starts on one line, grows to one third of the viewport, scrolls, and collapses after submit", () => {
  const css = readSource("src", "renderer", "styles.css");
  assert.match(css, /\.composer textarea \{[^}]+min-height:34px[^}]+height:34px[^}]+max-height:var\(--composer-input-max-height,33vh\)[^}]+overflow-y:hidden[^}]+transition:height/);
  assert.match(css, /\.composer textarea\.is-scrollable \{[^}]+overflow-y:auto/);
  const scrollableComposer = css.match(/\.composer textarea\.is-scrollable \{([^}]+)\}/)?.[1] || "";
  assert.doesNotMatch(scrollableComposer, /padding/);
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
  assert.match(renderer, /classList\.toggle\("composer-multiline", targetHeight > COMPOSER_INPUT_MIN_HEIGHT\)/);
  assert.match(renderer, /input\.value = "";\s*\n\s*resizeMessageInput\(\);/);
  assert.match(renderer, /input\.value = text;\s*\n\s*resizeMessageInput\(\);/);
  // Sliced, not spanned by a greedy [\s\S]+: the same call appears 160 lines later, so
  // deleting it from the resize listener still matched the copy and the test stayed green.
  const resizeListener = renderer.slice(renderer.indexOf('window.addEventListener("resize"'), renderer.indexOf('for (const target of [$(".titlebar")])'));
  assert.ok(resizeListener.length > 0 && resizeListener.length < 400, "the resize listener moved; re-anchor this test");
  assert.match(resizeListener, /resizeMessageInput\(\{ immediate: true \}\)/);
  assert.match(renderer, /function captureMessageLayoutSnapshot\(\)/);
  assert.match(renderer, /function restoreMessageLayoutSnapshot\(snapshot\)/);
  assert.match(renderer, /snapshot\.pinned[\s\S]+snapshot\.root\.scrollTop = snapshot\.root\.scrollHeight/);
  assert.match(renderer, /function renderAttachments\(\) \{\s*const messageLayout = captureMessageLayoutSnapshot\(\)/);
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
  assert.match(renderer, /MODEL_PICKER_COMPACT_MAX_VIEWPORT_HEIGHT = 400/);
  assert.match(renderer, /picker\.classList\.toggle\("compact-overlay", compactOverlay\)/);
  assert.match(renderer, /requestAnimationFrame\(scrollSelectedModelIntoView\)/);
  assert.match(renderer, /option\.dataset\.modelOption = "true"/);
  assert.match(renderer, /MODEL_PICKER_ROW_HEIGHT = 36/);
  assert.match(renderer, /bottomBoundary = Math\.min\(shell\.bottom - PICKER_SURFACE_GAP, composer\.top - PICKER_SURFACE_GAP\)/);
  assert.match(renderer, /--picker-options-height/);
  assert.match(readSource("src", "renderer", "styles.css"), /\.model-menu \.picker-options:not\(:empty\)[^}]+scroll-snap-type:y mandatory/);
  assert.match(readSource("src", "renderer", "styles.css"), /\.model-picker\.compact-overlay \.model-menu \{[^}]+position:fixed[^}]+top:var\(--model-sheet-top\)[^}]+width:var\(--model-sheet-width\)/);
  assert.match(renderer, /function createModelSetupCard/);
  assert.match(renderer, /Choose model/);
  assert.match(renderer, /Retry models/);
  assert.match(renderer, /Load a model in LM Studio or another Harness provider/);
  assert.match(renderer, /\["assistant", "error"\]\.includes\(message\.role\) && isMissingModelError\(message\.text\)/);
  assert.match(renderer, /if \(!modelSetupShown\) root\.append\(createModelSetupCard\(\)\)/);
  assert.match(html, /id="controlsPrimary">Auto<\/b>/);
  assert.match(renderer, /\$\("#controlsPrimary"\)\.textContent = shortModel/);
  assert.match(renderer, /shortModel = "No model"/);
  assert.match(renderer, /state\.automaticModelRoute = true;[\s\S]+?state\.pendingSelection = null;[\s\S]+?await applyModelSelection\(\)/);
  assert.match(renderer, /window\.widget\.selectModel\(selection \? \{ sessionId, selection \} : \{ sessionId \}\)/);
  assert.doesNotMatch(renderer, /selection:\s*\{[^}]*auto/i);
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
  assert.match(readSource("src", "renderer", "styles.css"), /\.focus-chat \.titlebar[\s\S]+\.focus-chat #chatPanel/);
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
  assert.match(readSource("src", "renderer", "styles.css"), /\.command-row \{[^}]+height:44px[^}]+scroll-snap-align:start/);
  assert.match(renderer, /\["ArrowDown", "ArrowUp"\]/);
  assert.match(renderer, /\["Enter", "Tab"\]/);
  assert.match(renderer, /\/\^\\\/\[\^\\s\]\*\$\//);
  assert.doesNotMatch(renderer, /command-chip/);
});

test("busy-session messages use the authoritative Harness queue with compact edit, delete, and steer controls", () => {
  const queueUpdater = renderer.slice(
    renderer.indexOf("async function updateQueuedPrompt"),
    renderer.indexOf("function renderQueuedPrompts"),
  );
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
  assert.ok(
    queueUpdater.indexOf("await window.widget.updateQueue") < queueUpdater.indexOf("state.queueEditingId = null")
      && queueUpdater.indexOf("state.queueEditingId = null") < queueUpdater.indexOf("queueSnapshotRevision(sessionId) !== expectedSnapshotRevision"),
    "a successful edit must leave edit mode before an authoritative snapshot can short-circuit local reconciliation",
  );
  assert.doesNotMatch(
    queueUpdater.slice(queueUpdater.indexOf("} catch (error)"), queueUpdater.indexOf("} finally")),
    /queueEditingId\s*=\s*null/,
    "a failed queue update must keep the editable row available for retry",
  );
  assert.match(renderer, /queueEditingSessionId/);
  assert.match(renderer, /state\.queueEditingSessionId === state\.selectedSessionId && state\.queueEditingId === item\.id/);
  assert.match(renderer, /const QUEUE_RECOVERY_DELAYS = \[180, 540, 1080\]/);
  assert.match(renderer, /recoverOptimisticQueue\(sessionId\)/);
  assert.match(renderer, /replaceOptimistic: index === delays\.length - 1/);
  assert.match(renderer, /replacesSameRevisionOptimism/);
});

test("Ctrl+V attachments reuse reviewed preparation while sent history stays compact", () => {
  const html = readSource("src", "renderer", "index.html");
  const css = readSource("src", "renderer", "styles.css");
  const clipboard = readSource("src", "renderer", "clipboard-attachments.js");
  assert.match(html, /<script src="clipboard-attachments\.js"><\/script>/);
  assert.match(renderer, /messageInput"\)\.addEventListener\("paste"/);
  assert.match(renderer, /window\.widget\.pathForFile\(file\)/);
  assert.match(renderer, /window\.widget\.prepareFiles\(paths\)/);
  assert.match(clipboard, /if \(!files\.length\) return null/);
  assert.match(clipboard, /MAX_IMAGE_BYTES = 8 \* 1024 \* 1024/);
  assert.match(clipboard, /path: `clipboard:\$\{digest\}`/);
  // Measured against the whole function, not a character budget that the function has
  // already outgrown: at 852 characters against a 900-character window, adding
  // requestSubmit() to its tail would have passed.
  const paste = functionBody(renderer, "function handleComposerPaste");
  assert.doesNotMatch(paste, /requestSubmit/);
  assert.match(renderer, /createMessageAttachmentStrip/);
  assert.match(renderer, /attachment-only/);
  assert.match(css, /\.message-attachment \{[^}]+max-width:116px[^}]+height:30px/);
  assert.match(css, /\.message-attachment-preview \{[^}]+width:30px[^}]+height:26px/);
});

test("live assistant deltas grow a bubble instead of leaving a Writing reasoning card", () => {
  const css = readSource("src", "renderer", "styles.css");
  const chunkHandler = renderer.slice(
    renderer.indexOf('if (event.type === "assistant/chunk")'),
    renderer.indexOf('if (["tool/call", "tool/code-dispatch-start"].includes(event.type))'),
  );
  assert.match(renderer, /onLiveEvent/);
  assert.match(renderer, /function handleLiveEvent/);
  assert.match(renderer, /chunk\.type === "text-delta"/);
  assert.match(renderer, /live-assistant/);
  assert.match(renderer, /function liveAssistantSnapshot/);
  assert.match(renderer, /function paintLiveAssistant/);
  assert.match(renderer, /function scheduleLivePaint/);
  assert.match(renderer, /livePaintFrame = requestAnimationFrame\(paintLiveState\)/);
  assert.doesNotMatch(chunkHandler, /renderMessages\(/);
  assert.doesNotMatch(chunkHandler, /setActivity\(/);
  assert.match(renderer, /activity\?\.active && activity\.kind === "writing" && activity\.text/);
  assert.match(renderer, /hasWritingBubble/);
  assert.match(css, /\.live-assistant::after \{[^}]+width:4px[^}]+animation:live-caret/);
  assert.match(css, /prefers-reduced-motion[\s\S]+\.live-assistant::after \{ animation:none !important/);
});

test("live tool calls become named cards and split the streaming answer around tool work", () => {
  const css = readSource("src", "renderer", "styles.css");
  const toolHandler = renderer.slice(
    renderer.indexOf('if (["tool/call", "tool/code-dispatch-start"].includes(event.type))'),
    renderer.indexOf('if (event.type === "turn/end")'),
  );
  assert.match(toolHandler, /stream\.text = ""/);
  assert.match(toolHandler, /refreshHistoryAfterLiveMessage\(sessionId\)/);
  assert.match(toolHandler, /\["tool\/result", "tool\/code-dispatch"\]\.includes\(event\.type\)/);
  assert.match(toolHandler, /tool\/code-dispatch-start/);
  assert.match(toolHandler, /tool\/code-dispatch/);
  assert.match(renderer, /const names = \[\.\.\.new Set\(run\.map/);
  assert.match(renderer, /`\$\{names\} · \$\{statusText\}`/);
  assert.match(renderer, /compactRecentText\(stream\.reasoning, 110\)/);
  assert.match(css, /\.activity-card\.thinking-activity > summary \{ min-height:30px/);
});

test("compact status IPC is skipped while its bounded presentation is unchanged", () => {
  const sync = renderer.slice(renderer.indexOf("function syncCompactStatus"), renderer.indexOf("function syncActivityCard"));
  assert.match(renderer, /compactStatusIpcSignature: ""/);
  assert.match(sync, /JSON\.stringify\(\[active, expanded, label, text\]\)/);
  assert.match(sync, /ipcSignature !== state\.compactStatusIpcSignature/);
  assert.match(sync, /state\.compactStatusIpcSignature = ipcSignature/);
  assert.match(sync, /window\.widget\.setCompactStatus\(compactStatus\)/);
});

test("manual chat scrolling is preserved and jump-to-latest stays visible away from the bottom", () => {
  assert.match(html, /id="scrollLatestButton"/);
  assert.match(html, /class="messages-wrap">[\s\S]+id="messages"[\s\S]+id="scrollLatestButton"/);
  assert.match(renderer, /messagesStickToBottom/);
  assert.match(renderer, /messagesNearBottom/);
  assert.match(renderer, /previousTop/);
  assert.match(renderer, /scrollLatestButton/);
  assert.match(renderer, /const visible = !state\.messagesStickToBottom/);
  assert.match(renderer, /state\.unseenMessages === 1 \? "New" : "Latest"/);
  assert.match(renderer, /function animateScrollLatestCompletion\(sessionId\)/);
  assert.match(renderer, /scrollLatestAutoScrolling: false/);
  assert.match(renderer, /function finishScrollLatestAutoScroll\(\)/);
  assert.match(renderer, /if \(state\.scrollLatestAutoScrolling\) \{[\s\S]+?if \(nearBottom\) finishScrollLatestAutoScroll\(\);[\s\S]+?return;/);
  const css = readSource("src", "renderer", "styles.css");
  assert.match(css, /\.scroll-latest\s*\{[^}]*position:absolute;[^}]*right:7px;[^}]*bottom:7px/);
  assert.match(css, /\.scroll-latest\.completion-pop/);
  assert.doesNotMatch(renderer, /root\.scrollTop = root\.scrollHeight;\s*\}/);
});

test("activity glow intensity is brighter by default, adjustable, and persisted", () => {
  const css = readSource("src", "renderer", "styles.css");
  assert.match(css, /--chat-glow-intensity: \.82/);
  assert.match(css, /opacity:var\(--chat-glow-intensity\)/);
  assert.match(css, /box-shadow \.55s cubic-bezier\(\.22,1,\.36,1\)/);
  assert.match(renderer, /applyGlowIntensity/);
  assert.match(renderer, /setGlowIntensity/);
  assert.match(settingsStore, /glowIntensity: 0\.82/);
  assert.match(ipc, /set-glow-intensity/);
});

test("live Think is a persistent optional overlay that cannot move the conversation viewport", () => {
  const preload = readSource("src", "preload.cjs");
  const css = readSource("src", "renderer", "styles.css");
  assert.match(html, /id="showThinkingToggle"[^>]+type="checkbox"[^>]+checked/);
  assert.match(settingsStore, /showThinking: true/);
  assert.match(settingsStore, /showThinking: source\.showThinking !== false/);
  assert.match(ipc, /handle\("set-show-thinking"/);
  assert.match(ipc, /showThinking: preferences\.showThinking !== false/);
  assert.match(preload, /setShowThinking: \(value\) => ipcRenderer\.invoke\("set-show-thinking"/);
  // The preference governs the whole live-status strip, not the word "thinking". Gating one
  // kind was the bug: every tool result clears the activity, the fallback substitutes kind
  // "working", and the card the user had just switched off came straight back as "Working".
  // This assertion used to pin that narrow predicate verbatim, so the fix had to change it.
  assert.match(renderer, /LIVE_ACTIVITY_KINDS = new Set\(\["thinking", "writing", "tool", "working"\]\)/);
  assert.match(renderer, /state\.showThinking \|\| !LIVE_ACTIVITY_KINDS\.has\(activity\?\.kind\)/);
  // Flipping the toggle must repaint the compact chrome too, which shows the same text.
  // Sliced to the end of the function itself, not to whichever function happens to follow.
  const showThinkingStart = renderer.indexOf("function applyShowThinking");
  const showThinking = renderer.slice(showThinkingStart + 1).split(/^(?:function |\/\/)/m)[0];
  assert.ok(showThinking.length > 0 && showThinking.length < 600);
  assert.match(showThinking, /syncActivityCard\(\)/);
  assert.match(showThinking, /syncCompactStatus\(\)/);
  assert.match(renderer, /const messageLayout = captureMessageLayoutSnapshot\(\)/);
  assert.match(renderer, /restoreMessageLayoutSnapshot\(messageLayout\)/);
  // Reasoning shares the one activity card instead of getting a strip of its own. The
  // strip was absolutely positioned inside .messages-wrap and reserved its room with
  // padding-top on .messages, which scrolls away — a scrolled log wore the strip on top
  // of its first visible row, and opaque paint only made the covering solid.
  assert.doesNotMatch(css, /thinking-compact/);
  assert.doesNotMatch(css, /has-thinking-overlay/);
  assert.doesNotMatch(renderer, /messagesWrap\.prepend\(card\)/);
  assert.match(css, /\.activity-card\[hidden\] \{ display:none; \}/);
  assert.match(renderer, /card\.classList\.toggle\("thinking-activity", thinking\)/);
  assert.match(renderer, /applyShowThinking\(await window\.widget\.setShowThinking\(requested\)\)/);
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
  assert.match(renderer, /await setWindowMode\("full"\);\s*await selectSession\(sessionId, true\)/);
  const quickReply = renderer.slice(renderer.indexOf("async function sendCompactReply"), renderer.indexOf("function detectCompletedSessions"));
  assert.match(quickReply, /window\.widget\.send\(\{/);
  assert.match(quickReply, /sessionId,/);
  assert.match(quickReply, /trackQueuedPrompt\(sessionId/);
  assert.doesNotMatch(quickReply, /setWindowMode\("full"\)/);
  assert.match(renderer, /if \(state\.compactReplyBusy\) return/);
  assert.match(renderer, /event\.key === "Enter" && !event\.shiftKey/);
  assert.match(renderer, /event\.key === "Escape" && state\.windowMode === "orb"/);
  // Avatar mode is dragged by the circle alone — the window around it is transparent and
  // belongs to whatever is behind it. Edge mode still excludes only its two controls.
  assert.match(renderer, /if \(state\.windowMode === "orb"\) return target\.closest\("#orbRestore"\)/);
  assert.match(renderer, /target\.closest\("#orbStatus, #orbHistoryButton"\) \? null : target/);
  const compactWindow = readSource("src", "compact-window.cjs");
  assert.match(compactWindow, /orb: \{ width: 172, height: 128 \}/);
  assert.match(compactWindow, /orbStatus: \{ width: 400, height: 128 \}/);
  assert.match(compactWindow, /orbPanel: \{ width: 460, height: 158 \}/);
  assert.match(compactWindow, /edge: \{ width: 88, height: 132 \}/);
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
  // Compact placement moved into its own module when the orb and edge branches were merged;
  // main.cjs now only wires it up.
  assert.match(main, /compactTargetBounds\(\{/);
  assert.match(main, /mode: nextMode,/);
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
  assert.match(renderer, /function scheduleCompactDragMove\(point\)[\s\S]+?requestAnimationFrame/);
  assert.match(renderer, /function flushCompactDragMove\(\)[\s\S]+?cancelAnimationFrame/);
  assert.match(renderer, /scheduleCompactDragMove\(\{ x: event\.screenX, y: event\.screenY \}\)/);
  assert.match(renderer, /if \(!nativeStarted\) return/);
  const begin = renderer.slice(renderer.indexOf("function beginCompactDrag"), renderer.indexOf("function moveCompactDrag"));
  assert.doesNotMatch(begin, /setPointerCapture|window\.widget\.beginCompactDrag/);
  assert.match(ipc, /begin-compact-drag/);
  assert.match(ipc, /move-compact-drag/);
  assert.match(ipc, /getCursorScreenPoint/);
  // Edge drags take a dedicated pointer-following path rather than freezing x. The freeze
  // stopped drift but made the opposite screen edge unreachable.
  assert.match(ipc, /if \(getWindowMode\(\) === "edge"\) \{\s*\n\s*const moved = moveEdgeDragToPointer\(/);
  assert.doesNotMatch(ipc, /edgeLocked \? compactDragOrigin\.bounds\.x/);
  assert.match(ipc, /end-compact-drag/);
  assert.match(ipc, /wasActive !== compactStatus\.active \|\| wasExpanded !== compactStatus\.expanded/);
  assert.match(ipc, /setCompactStatusResizePending\(true\)/);
  assert.match(ipc, /getWindowMode\(\) === "orb" && getCompactStatusResizePending\(\)[\s\S]+?applyWindowMode\("orb"/);
  assert.match(html, /data-avatar[^>]+draggable="false"/);
});

test("edge mode only captures the visible handle and passes transparent glow clicks through", () => {
  const preload = readSource("src", "preload.cjs");
  const css = readSource("src", "renderer", "styles.css");
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
  assert.match(css, /\.mode-edge\.state-idle \.edge-line\s*\{[^}]*animation:edge-flow 5\.4s/);
  assert.match(css, /\.edge-hit-active \.edge-line::after, \.edge-mode:focus-visible \.edge-line::after/);
  assert.match(css, /\.edge-mode\.edge-hit-active\s*\{[^}]*edge-hover-spring-right/);
  assert.match(css, /\.edge-mode\.edge-drop\s*\{[^}]*edge-drop-right/);
  assert.match(renderer, /function animateEdgeDrop\(\)/);
  assert.doesNotMatch(css, /\.edge-hit-active \.edge-line[^}]+scaleY/);
  assert.doesNotMatch(css, /\.edge-hit-active \.edge-line[^}]+translateX/);
  const endCompactDrag = renderer.match(/async function endCompactDrag\(event\) \{[\s\S]+?\n\}/)?.[0] || "";
  assert.ok(
    endCompactDrag.indexOf("if (!nativeStarted) return") < endCompactDrag.indexOf("window.widget.endCompactDrag()"),
    "a short click must not create or end a native drag",
  );
});

test("edge line keeps idle subtle and makes working, thinking, writing, tool, waiting, done, and error distinct", () => {
  const css = readSource("src", "renderer", "styles.css");
  assert.match(css, /\.mode-edge\.state-working\s*\{[^}]*--edge-primary:#72efa0;[^}]*--edge-secondary:#ffd45f/);
  assert.match(css, /\.mode-edge\.activity-thinking\s*\{/);
  assert.match(css, /\.mode-edge\.activity-writing\s*\{[^}]*--edge-primary:#72efa0/);
  assert.match(css, /\.mode-edge\.activity-tool\s*\{/);
  assert.match(css, /\.mode-edge\.state-waiting\s*\{/);
  assert.match(css, /\.mode-edge\.state-done\s*\{/);
  assert.match(css, /\.mode-edge\.state-error\s*\{/);
  assert.match(css, /@property --edge-primary/);
  assert.match(css, /transition:--edge-primary \.58s ease,--edge-secondary \.58s ease/);
  assert.match(css, /\.edge-mode\.bounce \.edge-line/);
  assert.match(css, /@keyframes edge-done-pulse/);
  assert.match(css, /@keyframes edge-working-energy/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)/);
});

test("orb activity glow distinguishes generic work and eases between all activity palettes", () => {
  const css = readSource("src", "renderer", "styles.css");
  assert.match(css, /@property --orb-ring-primary/);
  assert.match(css, /\.orb-glow[^}]+transition:--orb-ring-primary \.58s ease/);
  assert.match(css, /\.mode-orb\.state-working\s*\{[^}]*--orb-ring-primary:#72efa0;[^}]*--orb-ring-secondary:#ffd45f/);
  assert.match(css, /\.mode-orb\.activity-thinking\s*\{/);
  assert.match(css, /\.mode-orb\.activity-writing\s*\{/);
  assert.match(css, /\.mode-orb\.activity-tool\s*\{/);
  assert.match(css, /\.mode-orb\.state-waiting\s*\{/);
  assert.match(css, /\.mode-orb\.state-error\s*\{/);
  assert.match(css, /\.mode-orb\.state-done\s*\{/);
  assert.match(css, /\.orb-has-notification \.orb-status \{[^}]+box-shadow:none/);
  assert.match(css, /\.orb-history-button:hover, \.orb-history-button\.active \{[^}]+box-shadow:none/);
});

test("the custom titlebar drag excludes header controls and avoids Chromium native drag", () => {
  const css = readSource("src", "renderer", "styles.css");
  assert.match(renderer, /beginFullDrag/);
  assert.match(renderer, /moveFullDrag/);
  assert.match(renderer, /endFullDrag/);
  assert.match(renderer, /function scheduleFullDragMove\(point\)[\s\S]+?requestAnimationFrame/);
  assert.match(renderer, /function flushFullDragMove\(\)[\s\S]+?cancelAnimationFrame/);
  assert.match(renderer, /scheduleFullDragMove\(\{ x: event\.screenX, y: event\.screenY \}\)/);
  assert.match(renderer, /suppressProjectClick/);
  assert.match(ipc, /begin-full-drag/);
  assert.match(ipc, /move-full-drag/);
  assert.match(ipc, /end-full-drag/);
  assert.match(renderer, /function suppressBrandClickAfterDrag/);
  assert.match(renderer, /suppressProjectClick = false; \}, 1200/);
  assert.match(html, /class="brand no-drag"/);
  assert.match(html, /<header class="titlebar">/);
  assert.doesNotMatch(html, /<header class="titlebar drag-region">/);
  assert.match(renderer, /function canStartFullDrag\(event\)/);
  assert.match(renderer, /event\.target\.closest\("\.tabs, \.window-actions, \.picker, #headerUpdateButton"\)/);
  assert.match(renderer, /interactive\.closest\("#avatarButton, #projectLink"\)/);
  assert.match(renderer, /for \(const target of \[\$\("\.titlebar"\)\]\)/);
  assert.match(css, /\.titlebar \{[^}]+user-select:none[^}]+-webkit-user-drag:none[^}]+-webkit-app-region:no-drag/);
  assert.doesNotMatch(css, /\.drag-region\s*\{[^}]+-webkit-app-region:drag/);
});

test("first entry waits for the native show acknowledgement and honors reduced motion", () => {
  const preload = readSource("src", "preload.cjs");
  const css = readSource("src", "renderer", "styles.css");
  const readyToShow = main.slice(main.indexOf('windowRef.once("ready-to-show"'), main.indexOf('windowRef.on("close"'));
  // indexOf returns -1 for a missing needle, and -1 is less than everything: deleting the
  // show acknowledgement entirely — reintroducing the first-frame jump this exists to
  // prevent — used to satisfy the comparison below.
  const showAt = readyToShow.indexOf('windowRef.once("show"');
  assert.ok(showAt > 0, "the show acknowledgement is missing");
  assert.ok(showAt < readyToShow.indexOf("applyWindowMode("));
  assert.match(readyToShow, /sendToRenderer\("first-visible-entry"\)/);
  assert.match(preload, /onFirstVisible:[^\n]+first-visible-entry/);
  assert.match(html, /<body class="mode-full pre-native-visible">/);
  assert.match(renderer, /function playFirstVisibleEntry\(\)[\s\S]+classList\.remove\("pre-native-visible"\)[\s\S]+prefersReducedMotion\(\)/);
  assert.match(renderer, /window\.widget\.onFirstVisible\(playFirstVisibleEntry\)/);
  assert.match(css, /\.pre-native-visible \.panel\.active \{ animation:none; \}/);
  assert.match(css, /\.first-visible-entry\.mode-full \.widget-shell/);
});

test("motion is a preference, not a hard-coded flourish", () => {
  const css = readSource("src", "renderer", "styles.css");
  const settingsStore = readSource("src", "settings-store.cjs");
  const preload = readSource("src", "preload.cjs");
  const visualSmokeSource = readSource("scripts", "ui-visual-smoke.cjs");
  // The widget says what it is doing with movement - the goal rail flows, the pause glyph
  // breathes, a running tool group pulses, controls answer a press. That is a taste, so it
  // is a setting: one class on <body> takes the whole lot off, and it persists like the
  // rest. Defaulting to on keeps the widget behaving as it did for anyone who never looks.
  assert.match(settingsStore, /motionEffects: true,/);
  assert.match(settingsStore, /motionEffects: source\.motionEffects !== false,/);
  assert.match(ipc, /handle\("set-motion-effects"/);
  assert.match(ipc, /motionEffects: preferences\.motionEffects !== false,/);
  assert.match(preload, /setMotionEffects: \(value\) => ipcRenderer\.invoke\("set-motion-effects"/);
  assert.match(renderer, /function applyMotionEffects\(value\)/);
  assert.match(renderer, /classList\.toggle\("motion-off", !state\.motionEffects\)/);
  assert.match(renderer, /applyMotionEffects\(preferences\.motionEffects\)/);
  assert.match(renderer, /await window\.widget\.setMotionEffects\(requested\)/);
  assert.match(html, /id="motionEffectsToggle"/);
  assert.match(css, /body\.motion-off \*, body\.motion-off \*::before, body\.motion-off \*::after \{ animation:none !important; transition:none !important; \}/);
  // The jump pulse is a signal rather than decoration, so it keeps a still form of itself.
  assert.match(css, /body\.motion-off \.bubble\.mark-target \{[^}]*outline:/);
  // The effects themselves live on surfaces that carry state, never under the text.
  assert.match(css, /\.activity-card\.has-activity \{[^}]*animation:activity-drift/);
  assert.match(css, /\.composer:focus-within \{[^}]*box-shadow:/);
  assert.match(css, /\.tool-group\.running > summary > \.ui-icon:first-child \{[^}]*animation:tool-running/);
  assert.match(visualSmokeSource, /motionEffectsChecked: true, motionOff: false/);
});

test("the goal is a hairline strip under the composer that opens into queue-style controls", () => {
  const css = readSource("src", "renderer", "styles.css");
  const visualSmoke = readSource("scripts", "ui-visual-smoke.cjs");
  // The goal lived only as a /goal card inline in the log, so it scrolled off. It is a live
  // projection, so it gets a strip of its own. That strip sits under the composer, not above
  // the log: the activity card grows and vanishes up there and kept shoving the goal around.
  const goalIndex = html.indexOf('id="goalDock"');
  const composerIndex = html.indexOf('id="chatForm"');
  const messagesIndex = html.indexOf('class="messages-wrap"');
  assert.ok(goalIndex > composerIndex, "the goal dock must sit below the composer");
  assert.ok(goalIndex > messagesIndex, "the goal dock must sit below the log");
  assert.match(renderer, /function goalFor\(sessionId = state\.selectedSessionId\)/);
  assert.match(renderer, /session\?\.projections\?\.values\?\.goal/);
  assert.match(renderer, /function renderGoal\(\)/);
  // The controls are /goal subcommands over the command path, so Harness stays the one
  // owner of goal state rather than the widget guessing at it.
  assert.match(renderer, /runGoalCommand\(`\/goal edit \$\{text\}`\)/);
  assert.match(renderer, /runGoalCommand\(goal\.phase === "paused" \? "\/goal resume" : "\/goal pause"\)/);
  assert.match(renderer, /runGoalCommand\("\/goal clear"\)/);
  // Clearing is destructive and the projection vanishes with it, so it is a two-press
  // confirm rather than a modal over a widget this small.
  assert.match(renderer, /button\.dataset\.confirm !== "1"/);
  assert.match(renderer, /executeHarnessCommand\(line, sessionId\)/);
  // Collapsed it is an 18px hairline carrying no objective text: the orb, the rounds rail and
  // the counter. The objective is on the tooltip and behind the pencil. The bar is what the
  // space is spent on - there is no frame around the strip at all.
  assert.match(css, /\.goal-dock > summary \{[^}]*height:18px/);
  assert.match(css, /\.goal-dock \{[^}]*flex-direction:column-reverse/);
  assert.doesNotMatch(css, /\.goal-dock \{[^}]*border:/);
  assert.match(css, /\.goal-track \{[^}]*height:6px/);
  // The rail flows while the goal runs and goes still and amber once it is paused, so the
  // state reads off the strip without a word on it.
  assert.match(css, /\.goal-track-fill \{[^}]*animation:goal-flow/);
  assert.match(css, /@keyframes goal-flow/);
  assert.match(css, /\.goal-dock\[data-phase="paused"\] \.goal-track-fill \{[^}]*animation:none/);
  assert.match(css, /\.goal-dock\.goal-unbounded \.goal-track \{[^}]*animation:goal-flow/);
  // Pause and resume is the control pressed mid-run, so it sits on the strip itself and is
  // the glyph alone - no ring, no plate, no label - and its press must not also toggle the
  // panel. The panel's own controls carry no frame either.
  assert.match(html, /<summary id="goalSummary">[\s\S]{0,220}id="goalPauseResume"/);
  assert.match(css, /\.goal-strip-action \{[^}]*width:22px; height:18px/);
  assert.match(css, /\.goal-strip-action \.ui-icon \{ width:16px; height:16px; \}/);
  assert.doesNotMatch(css, /\.goal-dock-action \{[^}]*border:1px/);
  assert.match(css, /\.goal-dock-action \{[^}]*height:28px/);
  assert.match(renderer, /pauseIcon\.setAttribute\("href", paused \? "#icon-play" : "#icon-pause"\)/);
  assert.match(renderer, /\$\("#goalPauseResume"\)\.addEventListener\("click", \(event\) => \{/);
  assert.match(visualSmoke, /goalActionMinSize: 28, goalTrackHeight: 6/);
  assert.match(visualSmoke, /goalStripPauseSize: 18, goalStripPauseGlyph: "#icon-pause"/);
  assert.doesNotMatch(html, /id="goalPreview"/);
  assert.match(renderer, /summary\.title = paused \?/);
  assert.match(renderer, /\$\("#goalTrackFill"\)\.style\.width = `\$\{Math\.round\(progress \* 100\)\}%`/);
  assert.match(css, /\.goal-dock-phase\.paused/);
  assert.match(visualSmoke, /goalDockOpen: false, goalPhase: "active", goalDockBelowComposer: true, goalStripPinnedToBottom: true, goalStripHeight: 18, goalStripTextFree: true/);
  assert.match(visualSmoke, /goalActionCount: 2, goalPauseAction: "Pause the goal"/);
  assert.match(visualSmoke, /goalPhase: "paused", goalPauseAction: "Resume the goal", goalStripPauseGlyph: "#icon-play"/);
});

test("the caller's own messages are marked on the scroll rail and pull the scroll to them", () => {
  const css = readSource("src", "renderer", "styles.css");
  const visualSmoke = readSource("scripts", "ui-visual-smoke.cjs");
  // Scrolling back to "the thing I asked" meant dragging through everything the agent
  // said in between. The marks are placed against scrollHeight so a mark means what the
  // scrollbar beside it means, and the rail sits in the gutter rather than over it, so
  // dragging the scrollbar still works.
  assert.match(html, /id="messageMarks" class="message-marks no-drag"/);
  assert.match(renderer, /bubble\.offsetTop \+ bubble\.offsetHeight \/ 2\) \/ span/);
  // The click resolves the live bubble by index, never a captured node - renderMessages
  // rebuilds the log on the poll and a captured bubble is detached moments later.
  assert.match(renderer, /function scrollToUserMessage\(userIndex\)/);
  assert.match(renderer, /\$\$\("#messages \.bubble\.user"\)/);
  assert.match(renderer, /scrollToUserMessage\(Number\(tick\.dataset\.userIndex\)\)/);
  assert.doesNotMatch(renderer, /mark\.bubble\.scrollIntoView/);
  assert.match(visualSmoke, /messageMarksAllResolve: true/);
  assert.match(renderer, /function renderMessageMarks\(\)/);
  assert.match(css, /\.message-marks \{[^}]*right:5px/);
  assert.match(css, /\.message-mark:hover::after, \.message-mark:focus-visible::after/);
  // A 3px tick is a 3px click target, so the button carries transparent hit area around it
  // and the tick itself is drawn in ::after.
  assert.match(css, /\.message-mark \{[^}]*height:11px/);
  assert.match(css, /\.message-mark::after \{[^}]*height:3px/);
  // The jump-to-latest pill used to sit on top of the last marks and swallow their presses.
  assert.match(css, /\.messages-wrap\.has-marks \.scroll-latest \{ right:18px; \}/);
  // The press that "did nothing": every repaint writes the scroll offset it captured before
  // the rebuild, which both throws away the jump and cancels the smooth scroll mid-flight.
  // A short-lived pin outranks that offset until the caller scrolls for themselves.
  assert.match(renderer, /state\.messageScrollPin = \{ userIndex, expires: Date\.now\(\) \+ MESSAGE_PIN_MS \}/);
  assert.match(renderer, /function applyMessageScrollPin\(\{ smooth = false \} = \{\}\)/);
  // Every path that writes a captured offset back: the full rebuild, the live-stream
  // repaint that runs on each poll, and the shared layout snapshot.
  assert.equal((renderer.match(/if \(applyMessageScrollPin\(\)\) \{/g) || []).length, 3);
  assert.match(renderer, /for \(const eventName of \["wheel", "pointerdown", "keydown"\]\)/);
  assert.match(renderer, /if \(activeMessageScrollPin\(\)\) return;/);
  // The pulse is re-applied by index, so a repaint landing mid-flash does not swallow it.
  assert.match(renderer, /function paintMessageMarkFlash\(\)/);
  assert.match(visualSmoke, /markJumpAligned: true, markJumpFlashed: 1/);
  assert.match(visualSmoke, /messageMarkHitHeight: 11, scrollLatestVisible: true, messageMarksClearOfLatest: true/);
  // The magnet is a guarded JS pull on scroll-idle, not CSS scroll-snap: snap on the whole
  // log pulled the view off the top and hid the agent's opening reply. It never fires at
  // the top, never while following a running turn, and only within a small pull distance.
  assert.doesNotMatch(css, /\.messages(\.magnet)?[^{]*\{[^}]*scroll-snap/);
  assert.match(renderer, /function scheduleMessageMagnet\(\)/);
  assert.match(renderer, /if \(root\.scrollTop < 8\) return;/);
  assert.match(renderer, /Math\.abs\(bestDist\) > MESSAGE_MAGNET_PULL\) return;/);
  assert.match(renderer, /toggle\("magnet", !state\.messagesStickToBottom\)/);
  assert.match(visualSmoke, /messageMarkCount: 5, messageMarksMagnet: true, messageMarksClearOfBubbles: true, messageMarksOrdered: true/);
});

test("a queued prompt can be read and edited in full without touching the conversation", () => {
  const css = readSource("src", "renderer", "styles.css");
  const visualSmoke = readSource("scripts", "ui-visual-smoke.cjs");
  // A queued background job is regularly a shell command many times longer than the row.
  // Opening it prints the text whole; the room comes from the dock, which already sits
  // between the log and the composer, so nothing is covered and nothing is shrunk.
  assert.match(renderer, /queueExpandedId: null/);
  assert.match(renderer, /queueExpandedSessionId: null/);
  assert.match(renderer, /row\.classList\.toggle\("expanded", expanded \|\| editing\)/);
  assert.match(renderer, /\? \(item\.text \|\| item\.preview \|\| fallback\)/);
  assert.match(renderer, /root\.classList\.toggle\("opened", opened\)/);
  assert.match(css, /\.queue-dock\.opened \.queue-list \{ max-height:186px; \}/);
  assert.match(css, /\.queue-row\.expanded \.queue-preview \{[^}]*white-space:pre-wrap/);
  assert.match(css, /\.queue-row\.expanded \.queue-preview \{[^}]*text-overflow:clip/);
  assert.match(css, /\.queue-row\.expanded \.queue-preview \{[^}]*font-size:9px/);
  // Editing is a textarea now: one 8px line could not show a command, let alone correct it.
  assert.match(renderer, /createElement\("textarea"\);\s*$/m);
  assert.match(renderer, /if \(event\.key === "Enter" && !event\.shiftKey\)/);
  assert.match(renderer, /Math\.min\(input\.scrollHeight, QUEUE_EDIT_MAX_HEIGHT\)/);
  // The resting row is a line of text and three controls; the padding used to be most of
  // its height. Opening or editing is what earns the room.
  assert.match(css, /\.queue-row \{[^}]*min-height:26px/);
  assert.match(css, /\.queue-edit-input \{[^}]*max-height:132px/);
  assert.match(css, /\.queue-edit-input \{[^}]*resize:none/);
  // The dock may take room from the log while open; it must never reach the composer.
  assert.match(visualSmoke, /queueRowsExpanded: 1, queueExpandedNotClipped: true, queueExpandedFontPx: 9, queueDockAboveComposer: true/);
  assert.match(visualSmoke, /queueEditorTag: "TEXTAREA", queueDockAboveComposer: true/);
});

test("a rejected send keeps its reason until the user acts on it", () => {
  const css = readSource("src", "renderer", "styles.css");
  const visualSmoke = readSource("scripts", "ui-visual-smoke.cjs");
  // The composer owns this, not the activity block: applyDashboard writes that block from
  // the 2.5s poll, so a running turn overwrote a failed send's reason within one tick and
  // the 3.2s transient timer would have erased it moments later anyway.
  assert.match(html, /id="composerError" class="composer-error no-drag" role="alert" hidden/);
  assert.match(html, /id="composerErrorDismiss"/);
  assert.match(renderer, /showComposerError\(error, submittedCommand \? "Command failed" : "Message not sent"\)/);
  assert.doesNotMatch(renderer, /showTransientActivityError\(error, submittedCommand/);
  const shows = renderer.slice(renderer.indexOf("function showComposerError"), renderer.indexOf("function showTransientActivityError"));
  assert.doesNotMatch(shows, /setTimeout/);
  // Cleared only by the user dismissing it, a send that got through, or leaving the session
  // whose composer content it belongs to.
  const dismiss = renderer.indexOf('$("#composerErrorDismiss").addEventListener("click"');
  assert.ok(dismiss > 0 && renderer.slice(dismiss, dismiss + 120).includes("clearComposerError();"));
  // Anchored on the composer's own call: the orb quick reply has a second one, and it
  // already carried its own persistent feedback field.
  const beforeQueue = renderer.indexOf("trackQueuedPrompt(result.sessionId,");
  assert.ok(beforeQueue > 0 && renderer.slice(beforeQueue - 80, beforeQueue).includes("clearComposerError();"));
  const switchStart = renderer.indexOf("async function selectSession");
  assert.ok(switchStart > 0 && renderer.slice(switchStart, switchStart + 600).includes("clearComposerError();"));
  // A reason cut off mid-sentence is no reason, but it must not push the composer away.
  assert.match(css, /\.composer-error small \{[^}]*-webkit-line-clamp:2/);
  assert.doesNotMatch(css, /\.composer-error small \{[^}]*white-space:nowrap/);
  assert.match(visualSmoke, /composerErrorVisible: true, composerErrorText: "The current model does not support images/);
  assert.match(visualSmoke, /composerErrorAboveComposer: true/);
});

test("chat reports elapsed turn time and running background tasks", () => {
  const css = readSource("src", "renderer", "styles.css");
  const visualSmoke = readSource("scripts", "ui-visual-smoke.cjs");
  // Both numbers were built for the Agents session cards, so the panel the user watches
  // during a turn showed neither. The card helpers are reused rather than reimplemented:
  // that keeps one definition of "running background task" and one clock tick for the app.
  assert.match(html, /id="activityTime" class="session-time"/);
  assert.match(html, /id="activityBackground" class="session-background"/);
  assert.match(renderer, /function renderActivityMeta\(visible = !\$\("#activityCard"\)\.hidden\)/);
  assert.match(renderer, /applySessionTime\(\$\("#activityTime"\), session\)/);
  assert.match(renderer, /applyBackgroundTaskCount\(\$\("#activityBackground"\), activeBackgroundTasks\(session\)\)/);
  // Ahead of the signature early return, or a turn whose label never changes would freeze
  // its own clock and miss background tasks starting and finishing.
  const sync = renderer.slice(renderer.indexOf("function syncActivityCard"), renderer.indexOf("function setActivity"));
  assert.ok(sync.indexOf("renderActivityMeta(showCard)") < sync.indexOf("state.activityCardSignature) return false"));
  const dashboardCalls = renderer.indexOf("renderActivityMeta();");
  assert.ok(dashboardCalls > 0 && renderer.slice(dashboardCalls, dashboardCalls + 120).includes("renderSessions();"));
  assert.match(css, /\.activity-meta \{ flex:none; display:flex;/);
  assert.match(visualSmoke, /activityElapsedMinutes: 21, activityElapsedRunning: true, activityBackgroundCount: "2"/);
});

test("crowded compact chat has an explicit combined fixture and bounded surface budgets", () => {
  const css = readSource("src", "renderer", "styles.css");
  const visualSmoke = readSource("scripts", "ui-visual-smoke.cjs");
  assert.match(renderer, /function syncCrowdedChatState\(\)[\s\S]+window\.innerHeight <= 420/);
  assert.match(renderer, /screenshotFixture === "crowded-chat"/);
  assert.match(renderer, /const thinking = showCard && activity\?\.kind === "thinking";\n  syncCrowdedChatState\(\);/);
  // The log keeps its floor at 360x360 with every strip open: the panel pays for the
  // composer out of the gaps and the fixed strips instead.
  assert.match(css, /\.chat-crowded \.messages-wrap \{ min-height:62px; \}/);
  assert.match(css, /\.chat-crowded \.todo-list \{ max-height:24px/);
  assert.match(css, /\.chat-crowded \.queue-list \{ max-height:28px/);
  assert.match(css, /\.chat-crowded \.attachment-bar \{ height:30px/);
  assert.match(visualSmoke, /crowded-chat-400/);
  assert.match(visualSmoke, /crowded-chat-360/);
});

test("the full-size avatar hit target uses a contained circular aura instead of a plate", () => {
  const css = readSource("src", "renderer", "styles.css");
  assert.match(css, /\.avatar-shell \{[^}]+width:44px;[^}]+height:44px;[^}]+border-radius:50%;[^}]+background:transparent/);
  assert.match(css, /\.avatar-shell::before \{[^}]+inset:0;[^}]+border-radius:50%;[^}]+radial-gradient/);
  assert.match(css, /\.avatar-shell\.working::before \{[^}]+avatar-aura-working/);
  assert.match(css, /\.avatar-shell\.error::before \{[^}]+avatar-aura-error/);
  assert.match(css, /\.avatar-shell\.done::before \{[^}]+avatar-aura-done/);
  assert.match(css, /@media \(max-width:390px\), \(max-height:560px\)[\s\S]+?\.avatar-shell \{ width:38px; height:38px; \}/);
  assert.match(css, /\.avatar-shell img \{[^}]+width:42px; height:42px/);
  assert.match(css, /\.avatar-shell img \{ width:36px; height:36px; \}/);
});

test("full-window drag persists neither move nor resize drift", () => {
  const main = readSource("src", "main.cjs");
  assert.match(main, /function moveWindowWithinNearestDisplay\(bounds, candidate, preserveSize = false\)[\s\S]+?if \(preserveSize\) setPlatformBounds\(windowRef, moved/);
  assert.match(ipc, /moveWithinNearestDisplay\(fullDragOrigin\.bounds, candidate, true\)/);
  assert.match(main, /windowRef\.on\("resize", \(\) => \{\s+if \(windowMode !== "full" \|\| fullDragOrigin\) return;/);
  assert.match(main, /windowRef\.on\("move", \(\) => \{\s+if \(windowMode !== "full" \|\| fullDragOrigin\) return;/);
});

test("avatar click replaces the redundant collapse icon", () => {
  assert.match(html, /id="avatarButton"[^>]+Collapse to avatar/);
  assert.doesNotMatch(html, /id="orbButton"/);
  assert.match(renderer, /\$\("#avatarButton"\)\.addEventListener\("click"/);
});

test("consecutive tool activity collapses into one expandable group", () => {
  const css = readSource("src", "renderer", "styles.css");
  assert.match(renderer, /function appendActivityRun/);
  assert.match(renderer, /className = `tool-group/);
  assert.match(renderer, /partial-failure/);
  assert.match(renderer, /completed ·.*failed/);
  assert.match(renderer, /state\.currentMessages\[index\]\.role === "tool"/);
  assert.match(renderer, /tool-group-body/);
  assert.match(css, /\.tool-group\.partial-failure/);
  // A tool header is one line of text: it gets a line of box, not two.
  assert.match(css, /\.tool-group > summary \{[^}]*height:27px/);
  assert.match(css, /\.tool-call > summary \{[^}]*height:25px/);
});

test("Harness TODO projections render as a compact collapsible current plan", () => {
  const css = readSource("src", "renderer", "styles.css");
  assert.match(html, /id="todoDock"[^>]+aria-label="Current plan"/);
  assert.match(html, /id="todoToggle"[^>]+aria-controls="todoList"/);
  assert.match(renderer, /function todosFor/);
  assert.match(renderer, /projections\?\.values\?\.todos/);
  assert.match(renderer, /event\.type === "todo\/write"/);
  assert.match(renderer, /event\.type === "turn\/start"[\s\S]+?renderTodos/);
  assert.match(renderer, /function clearLiveTodos\(sessionId\)/);
  assert.match(renderer, /event\.type === "turn\/end"[\s\S]+?clearLiveTodos\(sessionId\)/);
  assert.match(renderer, /state\.liveStreamsBySession\.delete\(sessionId\);\s*\n\s*clearLiveTodos\(sessionId\)/);
  assert.match(css, /\.todo-row\.in_progress/);
  assert.match(css, /@keyframes todo-active-pulse/);
});

test("successful Stop cleanup survives a failed follow-up refresh", () => {
  const stop = renderer.slice(renderer.indexOf("async function stopCurrentTurn"), renderer.indexOf("async function createNewSession"));
  const cancelCatch = stop.indexOf('showTransientActivityError(error, "Could not stop")');
  const cleanup = stop.indexOf("clearLiveTodos(sessionId)");
  const guardedRefresh = stop.indexOf("await refresh({ afterCurrent: true }).catch(() => {})", cleanup);
  assert.ok(cancelCatch >= 0 && cleanup > cancelCatch && guardedRefresh > cleanup);
  assert.doesNotMatch(stop.slice(cleanup, guardedRefresh), /Could not stop/);
});

test("command execution stays visible in full and compact modes until it settles", () => {
  const css = readSource("src", "renderer", "styles.css");
  assert.match(renderer, /function commandFeedbackFor/);
  assert.match(renderer, /label: `Running \$\{command\}`/);
  assert.match(renderer, /Waiting for Harness/);
  assert.match(renderer, /settleCommandFeedback/);
  assert.match(renderer, /commandFeedbackFor\(sessionId\)\?\.activity \|\| view\.activity/);
  assert.match(css, /\.bubble\.command \{[^}]+max-height:140px;[^}]+overflow:auto/);
});

test("session picker uses the same idle, working, and error state as the Agents list", () => {
  const css = readSource("src", "renderer", "styles.css");
  assert.match(renderer, /function updatePickerSessionOption[\s\S]+const agentState = sessionAgentState\(session\)/);
  assert.match(renderer, /option\.classList\.add\(`state-\$\{agentState\}`\)/);
  assert.match(renderer, /agentState === "error"[\s\S]+\? "error"/);
  const pickerRender = renderer.slice(renderer.indexOf("function renderSessionSelect"), renderer.indexOf("function modelSelectionValue"));
  assert.match(pickerRender, /sessionAgentState\(session\)/);
  assert.match(css, /\.picker-session-group \.picker-option\.state-error small/);
});

test("a transient workspace picker refresh preserves the last successful projection", () => {
  const loadWorkspaces = renderer.slice(renderer.indexOf("async function loadWorkspaces"), renderer.indexOf("function renderAttachments"));
  assert.doesNotMatch(loadWorkspaces, /catch \{\s*state\.workspaces = \[\]/);
  assert.match(loadWorkspaces, /catch \{\s*state\.workspacesLoaded = true/);
});

test("queue snapshots win send races and steer interrupts the previous live bubble", () => {
  assert.match(renderer, /queueSnapshotRevisions/);
  assert.match(renderer, /expectedSnapshotRevision/);
  assert.match(renderer, /queueSnapshotRevision\(sessionId\) !== expectedSnapshotRevision/);
  assert.match(renderer, /function beginSteeredTurn/);
  assert.match(renderer, /steeringPromptsBySession/);
  assert.match(renderer, /steering-message/);
  assert.doesNotMatch(renderer, /steeredSessionsAwaitingTurnStart/);
  assert.match(renderer, /Interrupting the previous response/);
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
  assert.match(readSource("src", "markdown.cjs"), /highlight\.js\/lib\/common/);
  assert.match(readSource("src", "renderer", "styles.css"), /\.hljs-keyword/);
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
  assert.match(readSource("src", "renderer", "styles.css"), /send-spring|compact-enter|panel-enter|prefers-reduced-motion/);
  assert.match(renderer, /matchMedia\?\.\("\(prefers-reduced-motion: reduce\)"\)\.matches/);
  assert.match(renderer, /behavior: reduceMotion \? "auto" : "smooth"/);
});

test("screen capture is a visible header action and only prepares reviewed chat attachments", () => {
  const preload = readSource("src", "preload.cjs");
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
  // Same reason as the paste guard: this function is 709 characters and the budget was 700,
  // so its last nine characters were already outside the window this was meant to police.
  assert.doesNotMatch(functionBody(renderer, "function handleScreenshotResult"), /requestSubmit\(/);
});

test("all eight global shortcuts can be rebound, disabled, reset, and persisted", () => {
  const preload = readSource("src", "preload.cjs");
  const store = readSource("src", "settings-store.cjs");
  for (const action of ["showRestore", "toggleFocusChat", "collapseAvatar", "collapseEdge", "newSession", "openHarness", "captureDisplay", "captureRegion"]) {
    assert.match(html, new RegExp(`data-hotkey-action="${action}"`));
    assert.match(html, new RegExp(`data-hotkey-enabled="${action}"`));
  }
  assert.match(html, /id="resetHotkeysButton"/);
  assert.match(preload, /setHotkeys/);
  assert.match(preload, /resetHotkeys/);
  assert.match(main, /createHotkeyManager/);
  assert.match(main, /showRestore: \(\) => applyWindowMode\("full"\)/);
  assert.match(main, /registerConfiguredHotkeys\(preferences\.hotkeys\)/);
  assert.match(main, /shortcut remains enabled and will be retried next launch/);
  assert.doesNotMatch(main, /preferences\.hotkeys = registerConfiguredHotkeys/);
  assert.match(store, /hotkeys: DEFAULT_HOTKEYS/);
  assert.match(renderer, /function hotkeyDisplayName\(accelerator\)/);
  assert.match(renderer, /replaceAll\("CommandOrControl", commandKey\)/);
  assert.match(renderer, /duplicate|conflict|Shortcut is unavailable/i);
});

test("updates download in the background and expose install only after verification", () => {
  const preload = readSource("src", "preload.cjs");
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
  assert.match(main, /createUpdateOrchestrator/);
  assert.match(main, /checkForUpdates: \(\) => updateOrchestrator\?\.checkAndStage\(\)/);
  assert.match(main, /updateOrchestrator\.start\(\)/);
  assert.match(main, /updateOrchestrator\?\.stop\(\)/);
  assert.match(updateOrchestrator, /result\?\.status === "available"[\s\S]+\["portable-replace", "managed"\]\.includes\(result\.installMode\)[\s\S]+service\.download\(\)/);
  assert.match(updateOrchestrator, /6 \* 60 \* 60_000/);
  assert.match(renderer, /function renderUpdateState\(value\)/);
  assert.match(renderer, /Install & restart/);
  assert.match(renderer, /headerInstallButton\.hidden = value\.status !== "ready"/);
  assert.match(renderer, /\$\("#headerUpdateButton"\)\.addEventListener\("click", \(\) => runUpdateAction\("install"\)\)/);
  assert.match(html, /<\/div>\s*<button id="headerUpdateButton"/);
  assert.doesNotMatch(html, /downloadUpdateButton/);
  assert.doesNotMatch(preload, /downloadUpdate|download-update/);
  assert.doesNotMatch(renderer, /runUpdateAction\("download"\)/);
});

test("full, avatar, and edge transitions use a short renderer handoff without touching saved geometry", () => {
  const css = readSource("src", "renderer", "styles.css");
  assert.match(renderer, /MODE_EXIT_DURATION = 145/);
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
  assert.match(css, /@keyframes mode-content-enter/);
  assert.match(css, /\.mode-transition-in\.mode-full \.composer \{ animation:mode-content-enter/);
  assert.doesNotMatch(css, /@keyframes mode-(?:exit|enter)-(?:full|orb|edge) \{[^}]*filter:/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)/);
  assert.doesNotMatch(css, /(?:^|\n)\.mode-full \.widget-shell \{[^}]*animation:/);
  assert.doesNotMatch(css, /(?:^|\n)\.mode-orb \.orb-mode \{[^}]*animation:/);
  assert.doesNotMatch(css, /(?:^|\n)\.mode-edge \.edge-mode \{[^}]*animation:/);
  assert.doesNotMatch(css, /@keyframes (?:shell|compact|edge)-enter/);
  const transitionBlock = renderer.slice(renderer.indexOf("const MODE_EXIT_DURATION"), renderer.indexOf("function applyCompactSide"));
  assert.doesNotMatch(transitionBlock, /setPosition|setBounds|windowState|compactSide/);
});

test("compact errors are acknowledged in full chat and completion feedback is finite and interruptible", () => {
  const css = readSource("src", "renderer", "styles.css");
  assert.match(renderer, /compactErrorUnread: false/);
  assert.match(renderer, /unacknowledgedErrorSessionIds: new Set\(\)/);
  assert.match(renderer, /function signalSessionError\(session/);
  assert.match(renderer, /if \(mode !== "done"\) clearCompletionSignal\(\)/);
  assert.match(renderer, /clearTimeout\(state\.compactNotificationTimer\)[\s\S]+?state\.compactNotification = null/);
  assert.match(renderer, /state\.unacknowledgedErrorSessionIds\.add\(sessionId\)/);
  assert.match(renderer, /acknowledgeSessionError\(state\.selectedSessionId\)/);
  assert.match(renderer, /await setWindowMode\("full"\);\s*await selectSession\(sessionId, true\)/);
  assert.match(renderer, /state\.avatarMode === "error" && !state\.compactErrorUnread && !state\.harnessOffline/);
  const clearError = renderer.slice(renderer.indexOf("function clearAcknowledgedErrorPresentation"), renderer.indexOf("function signalSessionError"));
  assert.doesNotMatch(clearError, /state\.currentActivity\?\.kind !== "error"/);
  assert.match(clearError, /commandFeedback\?\.avatarMode === "error"[\s\S]+setCommandFeedback\(state\.selectedSessionId, null\)/);
  assert.match(renderer, /if \(mode !== "full"\) clearAcknowledgedErrorPresentation\(\);[\s\S]+?window\.widget\.setWindowMode\(mode\)/);
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
  assert.match(renderer, /offline \? "Harness offline"/);
  assert.match(renderer, /offline \? "Start Harness to reconnect\."/);
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
  const styles = readSource("src", "renderer", "styles.css");
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
  assert.match(main, /function writePreferences\(options\) \{\s*\n\s*try \{[\s\S]*?\} catch \(error\) \{/);
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
  const store = readSource("src", "settings-store.cjs");
  const write = store.slice(store.indexOf("function write(normalized)"), store.indexOf("function retryable"));
  assert.match(write, /fileSystem\.renameSync\(temporaryPath, filePath\)/);
  assert.doesNotMatch(write, /rmSync\(filePath/);
});

test("visible polling skips stable or actively streamed history while priority events stay authoritative", () => {
  const history = renderer.slice(renderer.indexOf("function invalidateSelectedHistoryVersion"), renderer.indexOf("function updateLiveSessionState"));
  const refresh = renderer.slice(renderer.indexOf("async function performRefresh"), renderer.indexOf("function startRefreshPass"));
  const live = renderer.slice(renderer.indexOf("async function handleLiveEvent"), renderer.indexOf("function setTab"));
  assert.match(history, /historyLoadedSessionId/);
  assert.match(history, /historyLoadedUpdatedAt/);
  assert.match(history, /historyLoadedRevision/);
  assert.match(history, /view\.unchanged === true \|\| sameRevision/);
  assert.match(history, /if \(skipReconciliation\) return "unchanged"/);
  assert.match(refresh, /!selectedLiveStreamIsActive\(\) && !selectedHistoryIsCurrent\(selectedSession\)/);
  assert.match(live, /event\.type === "user\/message"[\s\S]+refreshHistoryAfterLiveMessage\(sessionId\)/);
  assert.match(live, /event\.type === "turn\/end"[\s\S]+refreshHistory\(\{ priority: true \}\)/);
});

test("a tap on the brand is resolved by the drag handler, not by a stolen click", () => {
  // Pointer capture on .titlebar retargets the click away from the child button, so the
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
  const preload = readSource("src", "preload.cjs");
  // `sendSync` comes before `send` because the alternation is tried left to right and
  // `send` would match the prefix of `sendSync` and then fail on the paren. Omitting it is
  // what made this check call `register-selected-file` orphaned while the preload was
  // calling it — a blind spot on exactly the synchronous, privileged channels this test
  // exists to watch.
  const bridged = [...preload.matchAll(/ipcRenderer\.(?:invoke|sendSync|send)\("([^"]+)"/g)].map((match) => match[1]);
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
  const muxClient = readSource("src", "mux-client.cjs");
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
  const attachments = readSource("src", "attachments.cjs");
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
  const store = readSource("src", "settings-store.cjs");
  assert.match(store, /const SCHEMA_VERSION = 2;/);
  assert.match(store, /version > SCHEMA_VERSION/);
  assert.match(store, /SETTINGS_TOO_NEW/);
});

test("the window is re-clamped when the display layout changes", () => {
  assert.match(main, /screen\.on\("display-metrics-changed", reclampToCurrentDisplays\)/);
  assert.match(main, /screen\.on\("display-removed", reclampToCurrentDisplays\)/);
});

test("harness launch survives a minimal PATH on macOS and Linux", () => {
  const launcher = readSource("src", "harness-launcher.cjs");
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

test("a single unhealthy poll cannot take the session and its transcript away", () => {
  // One failed dashboard read answers {harness:false, sessions:[]}. That used to be treated
  // as authoritative: the selection was dropped, the chat re-rendered empty, and the next
  // healthy poll re-selected whichever session happened to be running — so a one-second blip
  // left the user reading a different conversation.
  const start = renderer.indexOf("const dashboardVisibleSessions");
  const end = renderer.indexOf("if (!selectionChangedWhileLoading && state.selectedSessionId !== selectedAtRequest)");
  assert.ok(start > 0 && end > start, "the selection block moved; re-anchor this test");
  const refresh = renderer.slice(start, end);
  assert.ok(refresh.length < 2400, `selection block grew to ${refresh.length} chars`);
  // Forgetting requires a HEALTHY dashboard to miss the session twice.
  assert.match(refresh, /if \(present \|\| !dashboard\.harness\) \{\s*state\.missingSelectionPolls = 0;/);
  assert.match(refresh, /state\.missingSelectionPolls \+= 1;/);
  assert.match(refresh, /if \(state\.missingSelectionPolls >= 2\)/);
  // Auto-selection may not run against an offline dashboard at all.
  assert.match(refresh, /!state\.selectedSessionId && dashboard\.harness && dashboardVisibleSessions\.length/);
  // Recovery restores what the user had chosen before guessing.
  assert.match(refresh, /const remembered = dashboardVisibleSessions\.find\(\(session\) => session\.sessionId === state\.lastSelectedSessionId\)/);
  assert.match(refresh, /\(remembered \|\| dashboardVisibleSessions\.find\(\(session\) => session\.running\) \|\| dashboardVisibleSessions\[0\]\)/);
  // And the id has to be remembered before it is cleared, or there is nothing to restore.
  assert.ok(refresh.indexOf("state.lastSelectedSessionId = state.selectedSessionId;") < refresh.indexOf("state.selectedSessionId = null;"));
});

test("skills appear in the slash menu and are sent as prompts, not host commands", () => {
  // Harness feeds its own "/" menu from two sources; the widget read only commands/list, so
  // a skill installed in the workspace showed up in Harness and was missing here.
  const api = readSource("src", "harness-api.cjs");
  assert.match(api, /async skills\(sessionId\) \{[\s\S]*?this\.rpc\("skill\.list", \{ sessionId \}/);
  assert.match(api, /async commandCatalog\(sessionId\)/);
  assert.match(api, /this\.skills\(sessionId\)\.catch\(\(\) => \[\]\)/, "a Harness without the skill plugin still lists its commands");
  assert.match(ipc, /handle\("commands", async \(_event, sessionId\) => api\.commandCatalog\(sessionId\)\)/);
  // A skill is not a host command: commands/execute would reject it.
  assert.match(renderer, /if \(commandEntry && commandEntry\.kind !== "skill"\)/);
  assert.match(renderer, /command\.kind === "skill" \? "skill" :/);
});

test("the session list shows how long each agent has been working", () => {
  const sessionActivity = readSource("src", "session-activity.cjs");
  assert.match(sessionActivity, /function turnTimingFromHistory\(entries\)/);
  assert.match(sessionActivity, /return \{ runningSince: openedAt, lastRunMs \};/);
  // Taken from the turn's own events, so it survives a widget restart.
  assert.match(renderer, /function formatWorkDuration\(ms\)/);
  assert.match(renderer, /node\.dataset\.runningSince = live \? String\(runningSince\) : "";/);
  // The ticking value must stay out of the render signature, or the list rebuilds every
  // second; and the interval must stop when nothing is running.
  const signature = renderer.slice(renderer.indexOf("function renderSessions"), renderer.indexOf("function renderSessionSelect"));
  assert.doesNotMatch(signature, /runningSince|lastRunMs/);
  assert.match(renderer, /\} else if \(!live && state\.sessionTimerTick\) \{\s*clearInterval\(state\.sessionTimerTick\);/);
});

test("the orb window only takes the mouse where it draws something", () => {
  // A 172x128 transparent window for a 68px circle used to swallow every click that landed
  // near the avatar. The renderer measures its live controls; everything else forwards.
  assert.match(renderer, /function publishCompactHitAreas\(\)/);
  assert.match(renderer, /for \(const selector of \["#orbRestore", "#orbHistoryButton", "#orbStatus"\]\)/);
  assert.match(renderer, /if \(!element \|\| element\.hidden \|\| !element\.offsetParent\) continue;/);
  const preload = readSource("src", "preload.cjs");
  assert.match(preload, /setCompactHitAreas: \(areas\) => ipcRenderer\.send\("set-compact-hit-areas", areas\)/);
  assert.match(ipc, /on\("set-compact-hit-areas"/);
  const tracker = readSource("src", "compact-hit-tracker.cjs");
  // No measurement yet must mean "everything is live", never "nothing is clickable".
  assert.match(tracker, /if \(!areas\) \{\s*publish\(true\);/);
  assert.match(main, /const compact = windowMode === "edge" \|\| windowMode === "orb";/);
});

test("avatar mode is collapsed until the user opens it", () => {
  assert.match(settingsStore, /compactAutoExpand: false,/);
  assert.match(settingsStore, /compactAutoExpand: source\.compactAutoExpand === true/);
  assert.match(ipc, /handle\("set-compact-auto-expand"/);
  assert.match(html, /id="compactAutoExpandToggle" type="checkbox" \/>/, "off by default, with no checked attribute");
  assert.match(renderer, /const active = Boolean\(expanded \|\| state\.compactStatusClosing \|\| \(state\.compactAutoExpand && autoActive\)\)/);
  // The count moves onto the expand button so the collapsed orb still says something.
  assert.match(html, /id="orbPanelCount"/);
  assert.match(renderer, /badge\.classList\.toggle\("visible", !expanded && badgeCount > 0\)/);
});

test("the compact status commits its signature only after the DOM is painted", () => {
  // Caching the signature first meant one throw anywhere in the block froze the orb at its
  // last painted state for the rest of the session: every later call matched and returned.
  const body = renderer.slice(renderer.indexOf("if (domSignature !== state.compactStatusDomSignature)"), renderer.indexOf("const compactStatus = { active"));
  assert.ok(body.indexOf("$(\"#orbStatusLabel\").textContent") < body.indexOf("state.compactStatusDomSignature = domSignature;"));
  // A failed setCompactStatus has to roll the expanded flag back too, or the retry computes
  // "no resize", never holds the panel back, and the resize jerk returns.
  assert.match(renderer, /state\.compactStatusExpanded = previousExpanded;/);
});

test("background tasks are a count of what is running, not a roster size", () => {
  // The card used to spell out "2 subagents" — the size of the roster, including children
  // that had already finished — spending most of a narrow card's width on something that
  // was often no longer true.
  assert.match(renderer, /function activeBackgroundTasks\(session\)/);
  assert.match(renderer, /child\.kind === "child" && child\.activity === "running"/);
  assert.doesNotMatch(renderer, /subagent\$\{childCount === 1 \? "" : "s"\}/, "the old sentence is gone");
  // The count has to reach the render signature, or a task starting or finishing would not
  // repaint the list.
  const signature = renderer.slice(renderer.indexOf("function renderSessions"), renderer.indexOf("function renderSessionSelect"));
  assert.match(signature, /activeBackgroundTasks\(session\)/);
  // Written into the <b>, never onto the wrapper, which also holds the icon.
  assert.match(renderer, /const value = node\.querySelector\("b"\);/);
  const css = readSource("src", "renderer", "styles.css");
  assert.match(css, /\.session-background \{ display:none; \}/, "zero running tasks must take no width");
  assert.match(css, /\.session-background b \{[^}]*font-variant-numeric:tabular-nums/);
});
