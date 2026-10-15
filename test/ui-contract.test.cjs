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

test("visible widget copy stays English", () => {
  assert.doesNotMatch(html + renderer, /[\u0400-\u04ff]/);
  for (const id of [
    "contextMeter",
    "modelMenu",
    "modelSearch",
    "reasoningButton",
    "commandsButton",
    "commandMenu",
    "workspaceButton",
    "attachButton",
    "attachmentBar",
    "queueDock",
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
  assert.doesNotMatch(html + renderer, /agentControls|Agent settings|controlsPrimary|controlsSummary|modelButton/);
  assert.doesNotMatch(renderer, /event\.target\.closest\("#reasoningModelName"\)\) openModelPicker/);
  assert.match(renderer, /modelsButton\.className = "reasoning-model-choice"/);
  assert.match(renderer, /event\.key !== "ArrowDown"/);
  assert.match(html, /class="picker-menu model-menu"/);
  assert.match(renderer, /localRank/);
});

test("Agent/Plan switch is hidden while slash plan commands remain available", () => {
  assert.doesNotMatch(html, /id="modeSwitch"|class="mode-option"/);
  assert.doesNotMatch(renderer, /setAgentMode\(|renderMode\(|\.mode-option/);
  assert.match(renderer, /modeFromCommand\(line\)/);
  assert.match(renderer, /\/plan\(\?:\\s\+\(off\)\)/);
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
  const resizeListener = renderer.slice(renderer.indexOf('window.addEventListener("resize"'), renderer.indexOf('for (const target of [$(".titlebar"), $("#collapseHandle")])'));
  assert.ok(resizeListener.length > 0 && resizeListener.length < 400, "the resize listener moved; re-anchor this test");
  assert.match(resizeListener, /resizeMessageInput\(\{ immediate: true \}\)/);
  assert.match(renderer, /function captureMessageLayoutSnapshot\(\)/);
  assert.match(renderer, /function restoreMessageLayoutSnapshot\(snapshot\)/);
  assert.match(renderer, /snapshot\.pinned[\s\S]+settleTranscriptScroll\(snapshot\.root, snapshot\.root\.scrollHeight\)/);
  // The foot of a spacer is not the foot of the conversation.
  assert.match(functionBody(renderer, "function restoreMessageLayoutSnapshot(snapshot)"), /state\.messagesStickToBottom = messagesNearBottom\(snapshot\.root\) && transcriptAtLatest\(\);/);
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
  assert.match(renderer, /setAttribute\("aria-label", `Model and reasoning: \$\{fullLabel\}`\)/);
  assert.match(html, /id="modelSearch"[^>]+aria-label="Search models or providers"/);
  assert.match(renderer, /modelLoadState === "loading"/);
  assert.match(renderer, /state\.modelLoadState === "loading" && !modelCount\(catalog\)/);
  assert.match(renderer, /No models loaded/);
  assert.match(renderer, /Models unavailable/);
  assert.match(renderer, /function retryModels/);
  assert.match(renderer, /function positionPickerMenu/);
  assert.match(html, /id="modelMenu"[^>]+popover="manual"/);
  assert.match(html, /id="reasoningButton"[^>]+aria-controls="reasoningMenu"/);
  assert.match(html, /id="reasoningModelName"[^>]*>Model<\/span><span id="reasoningButtonText"/);
  assert.match(renderer, /requestAnimationFrame\(scrollSelectedModelIntoView\)/);
  assert.match(renderer, /option\.dataset\.modelOption = "true"/);
  assert.match(renderer, /const anchor = \$\("#reasoningButton"\)\.getBoundingClientRect\(\)/);
  assert.match(renderer, /--model-list-max-height/);
  assert.match(readSource("src", "renderer", "appearance.css"), /#modelMenu \.picker-options:not\(:empty\)[^}]+scroll-snap-type:none/);
  assert.match(readSource("src", "renderer", "styles.css"), /\.model-picker\.compact-overlay \.model-menu \{[^}]+position:fixed[^}]+top:var\(--model-sheet-top\)[^}]+width:var\(--model-sheet-width\)/);
  assert.match(readSource("src", "renderer", "appearance.css"), /\.model-picker\.compact-overlay\.open-up #modelMenu \{[^}]+bottom:var\(--model-sheet-bottom\)/);
  assert.match(readSource("src", "renderer", "appearance.css"), /#modelMenu \.picker-option \.picker-check \{[^}]+order:3/);
  assert.match(renderer, /function createModelSetupCard/);
  assert.match(renderer, /Choose model/);
  assert.match(renderer, /Retry models/);
  assert.match(renderer, /Load a model in LM Studio or another Harness provider/);
  assert.match(renderer, /\["assistant", "error"\]\.includes\(message\.role\) && isMissingModelError\(message\.text\)/);
  assert.match(renderer, /if \(!modelSetupShown\) blocks\.push\(\{ key: "model-setup", signature: messageSignature\(message\), count: 0, build: \(\) => createModelSetupCard\(message\) \}\)/);
  assert.match(renderer, /original\.textContent = String\(message\.text \|\| ""\)/);
  assert.match(html, /id="reasoningModelName">Model<\/span>/);
  assert.match(renderer, /\$\("#reasoningModelName"\)\.textContent = shortModel/);
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
  // The caret is an element, not ::after, so it can sit inside the last paragraph of a
  // formatted answer rather than on a line of its own underneath it.
  assert.match(css, /\.live-caret \{[^}]+width:4px[^}]+animation:live-caret/);
  assert.match(css, /prefers-reduced-motion[\s\S]+\.live-caret \{ animation:none !important/);
  assert.match(renderer, /function liveCaret\(\)/);
  assert.match(renderer, /caret\.className = "live-caret"/);
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
  // The jump itself is a smooth scrollTo, never a bare offset write. When hidden
  // rows arrived below the window, the pill refreshes first so the jump lands on
  // the messages it promised.
  const latestClick = renderer.slice(renderer.indexOf('$("#scrollLatestButton").addEventListener("click"'), renderer.indexOf('$("#todoToggle").addEventListener'));
  assert.match(latestClick, /try \{ await refreshHistory\(\); \} catch \{\}/);
  assert.match(latestClick, /jumpToLatestTranscript\(\);/);
  assert.match(latestClick, /\$\("#messages"\)\.scrollTo\(\{ top: \$\("#messages"\)\.scrollHeight, behavior:/);
  assert.doesNotMatch(latestClick, /root\.scrollTop = root\.scrollHeight;\s*\}/);
});

test("a failed command load retries instead of emptying the slash menu", () => {
  // One blip used to mark the session as loaded with an empty catalog, making every
  // slash command permanently "unknown" until the session was switched.
  const load = renderer.slice(renderer.indexOf("async function loadCommands"), renderer.indexOf("async function applyModelSelection"));
  assert.match(load, /state\.commandCatalog = commands;/);
  const failure = load.slice(load.indexOf("} catch {"), load.indexOf("} finally {"));
  assert.doesNotMatch(failure, /state\.commandsLoadedSessionId/);
  assert.doesNotMatch(failure, /state\.commandCatalog = \[\];/);
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

test("widget text-size slider changes readable text and persists its choice", () => {
  const appearance = readSource("src", "renderer", "appearance.css");
  const preload = readSource("src", "preload.cjs");
  assert.match(html, /id="fontScaleRange"[^>]+type="range"/);
  assert.match(renderer, /applyFontScale\(preferences\.fontScale\)/);
  assert.match(renderer, /setFontScale\(scale\)/);
  // 14px body text at the default scale: the conversation reads at the size of a document.
  assert.match(appearance, /\.bubble \{ font-size:calc\(14px \* var\(--font-scale\)\)/);
  assert.match(preload, /setFontScale: \(value\) => ipcRenderer\.invoke\("set-font-scale"/);
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
  assert.match(renderer, /LIVE_ACTIVITY_KINDS = new Set\(\["thinking", "writing", "tool", "working", "waiting"\]\)/);
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

test("collapsed pet exposes a scrolling list of recent sessions and inline quick reply without restoring full mode", () => {
  assert.doesNotMatch(html, /id="orb(?:NewSession|Commands|Attach)"/);
  assert.match(html, /id="orbSessionList"[^>]+role="list"/);
  assert.match(html, /id="orbReplyForm"[^>]+aria-label="Quick reply"/);
  assert.match(html, /id="orbReplyInput"[^>]+aria-label="Quick reply message"/);
  assert.match(renderer, /compactNotificationTimer = setTimeout/);
  // Notifications leave on their own: six seconds for a reply, longer for a question.
  assert.match(renderer, /const COMPACT_NOTIFICATION_MS = \{ notification: 6000, question: 12000, error: 8000 \};/);
  assert.match(renderer, /orb-status-closing/);
  assert.match(renderer, /else notifyCompletion\(session\)/);
  // Four rows show and the rest scroll; the chat button counts working agents only.
  assert.match(renderer, /recentReplySessions\(state\.dashboard\?\.sessions, COMPACT_RECENT_LIMIT\)/);
  assert.match(renderer, /const COMPACT_RECENT_LIMIT = 8;/);
  assert.match(renderer, /const badgeCount = runningCount;/);
  // The arrow opens the chat; so does a second click on the chat already addressed. Either way
  // the chat remembers it came from the avatar, so it can fold back into it.
  assert.match(renderer, /openCompactSession\(session\.sessionId, \{ fromAvatar: true \}\)/);
  assert.match(renderer, /if \(state\.compactReplyOpen && session\.sessionId === state\.compactReplySessionId\) openCompactSession\(session\.sessionId, \{ fromAvatar: true \}\)/);
  assert.match(renderer, /if \(state\.collapseAfterSend && state\.windowMode === "full" && state\.returnToAvatarSessionId === result\.sessionId\)/);
  assert.match(renderer, /openCompactReply\(session\.sessionId\)/);
  // The chat is selected (briefly awaited) before the unfold, and from the avatar opens small.
  assert.match(renderer, /const selecting = sessionId && sessionId !== state\.selectedSessionId \? selectSession\(sessionId, true\) : null;[\s\S]+?await setWindowMode\("full", \{ mini: fromAvatar \}\);\s*if \(selecting\) await selecting;/);
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
  assert.match(compactWindow, /orbStatus: \{ width: 340, height: 128 \}/);
  assert.match(compactWindow, /orbPanel: \{ width: 396, height: 184 \}/);
  assert.match(compactWindow, /edge: \{ width: 88, height: 132 \}/);
  assert.match(ipc, /preserveCompactPosition: true/);
});

test("window layers distinguish desktop, above, and enhanced above without a fullscreen guarantee", () => {
  assert.match(html, /data-layer="normal"/);
  assert.match(html, /data-layer="normal"[^>]+>Desktop<\/button>/);
  assert.match(html, /every normal app window covers the widget/);
  assert.match(html, /data-layer="above"/);
  assert.match(html, /data-layer="game"[^>]+>Always on top\+<\/button>/);
  assert.match(html, /Enhanced always-on-top mode\. Does not guarantee visibility over exclusive fullscreen games\./);
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
  // stopped drift but made the opposite screen edge unreachable. The mover takes the
  // whole drag origin: it needs where the pointer grabbed, not just the bounds.
  assert.match(ipc, /const moved = moveEdgeDragToPointer\(compactDragOrigin, \{ x: screenX, y: screenY \}\);/);
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
  assert.match(css, /--edge-primary:rgb\(var\(--status-idle-primary\)\)/);
  assert.match(css, /--edge-secondary:rgb\(var\(--status-idle-secondary\)\)/);
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
  assert.match(css, /\.mode-edge\.state-working\s*\{[^}]*--edge-primary:rgb\(var\(--status-writing-primary\)\);[^}]*--edge-secondary:rgb\(var\(--status-writing-secondary\)\)/);
  assert.match(css, /\.mode-edge\.activity-thinking\s*\{/);
  assert.match(css, /\.mode-edge\.activity-writing\s*\{[^}]*--edge-primary:rgb\(var\(--status-writing-primary\)\)/);
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
  assert.match(css, /\.mode-orb\.state-working\s*\{[^}]*--orb-ring-primary:rgb\(var\(--status-writing-primary\)\);[^}]*--orb-ring-secondary:rgb\(var\(--status-writing-secondary\)\)/);
  assert.match(css, /\.mode-orb\.activity-thinking\s*\{/);
  assert.match(css, /\.mode-orb\.activity-writing\s*\{/);
  assert.match(css, /\.mode-orb\.activity-tool\s*\{/);
  assert.match(css, /\.mode-orb\.state-waiting\s*\{/);
  assert.match(css, /\.mode-orb\.state-error\s*\{/);
  assert.match(css, /\.mode-orb\.state-done\s*\{/);
  assert.match(css, /\.orb-has-notification \.orb-status \{[^}]+box-shadow:none/);
  assert.match(css, /\.orb-history-button:hover::before, \.orb-history-button\.active::before \{[^}]+border-color:/);
  assert.match(css, /\.orb-history-button::after \{[^}]*mask-composite:exclude/);
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
  assert.match(renderer, /for \(const target of \[\$\("\.titlebar"\), \$\("#collapseHandle"\)\]\)/);
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
  assert.match(visualSmoke, /goalDockOpen: false, goalPhase: "active", goalDockBelowComposer: true, goalStripPinnedToBottom: true, goalStripHeight: 14, goalStripTextFree: true/);
  assert.match(visualSmoke, /goalActionCount: 2, goalPauseAction: "Pause the goal"/);
  assert.match(visualSmoke, /goalPhase: "paused", goalPauseAction: "Resume the goal", goalStripPauseGlyph: "#icon-play"/);
});

test("the caller's own messages are marked on the scroll rail and pull the scroll to them", () => {
  const css = readSource("src", "renderer", "styles.css");
  const visualSmoke = readSource("scripts", "ui-visual-smoke.cjs");
  // Scrolling back to "the thing I asked" meant dragging through everything the agent
  // said in between. Like Harness, every question has an evenly spaced tick in
  // a separate scroller. Only the visible slice is mounted, not a sampled history.
  assert.match(html, /id="messageMarks" class="message-marks no-drag"/);
  assert.match(renderer, /const MESSAGE_MARK_SPACING = 10;/);
  assert.match(renderer, /function drawMessageMarks\(\)/);
  assert.match(renderer, /function syncMessageMarksPosition\(\)/);
  assert.match(renderer, /tick\.setAttribute\("aria-current", "true"\)/);
  assert.match(renderer, /!messageMarksPointerInside && !rail\.contains\(document\.activeElement\)/);
  assert.match(renderer, /\["ArrowUp", "ArrowDown", "Home", "End"\]/);
  // The click resolves the live node by message index, never a captured node - and the
  // window expands to include an unloaded row first, so a jump cannot land on nothing.
  assert.match(renderer, /function scrollToUserMessage\(msgIndex\)/);
  assert.match(renderer, /function ensureMessageRendered\(msgIndex\)/);
  assert.match(renderer, /scrollToUserMessage\(Number\(tick\.dataset\.msgIndex\)\)/);
  assert.doesNotMatch(renderer, /mark\.bubble\.scrollIntoView/);
  assert.match(visualSmoke, /messageMarksAllResolve: true/);
  assert.match(renderer, /function renderMessageMarks\(\)/);
  // The mounted rail is bounded, but every question remains addressable.
  assert.match(renderer, /const MESSAGE_MARKS_MAX = 400;/);
  assert.match(renderer, /start \+ MESSAGE_MARKS_MAX - 1/);
  assert.doesNotMatch(renderer, /Math\.ceil\(userEntries\.length \/ MESSAGE_MARKS_MAX\)/);
  assert.match(css, /\.message-marks \{[^}]*right:5px/);
  assert.match(css, /\.message-marks \{[^}]*overscroll-behavior:contain/);
  assert.match(css, /\.message-mark:hover::after, \.message-mark:focus-visible::after/);
  // A 2px tick is a 2px click target, so the button carries transparent hit area around it
  // and the tick itself is drawn in ::after.
  assert.match(css, /\.message-mark \{[^}]*width:24px; height:10px/);
  assert.match(css, /\.message-mark::after \{[^}]*height:2px/);
  // The jump-to-latest pill used to sit on top of the last marks and swallow their presses.
  assert.match(css, /\.messages-wrap\.has-marks \.scroll-latest \{ right:34px; \}/);
  // The press that "did nothing": every repaint writes the scroll offset it captured before
  // the rebuild, which both throws away the jump and cancels the smooth scroll mid-flight.
  // A short-lived pin outranks that offset until the caller scrolls for themselves.
  assert.match(renderer, /state\.messageScrollPin = \{ msgIndex, sessionId: state\.selectedSessionId, expires: Date\.now\(\) \+ MESSAGE_PIN_MS \}/);
  assert.match(renderer, /function applyMessageScrollPin\(\{ smooth = false \} = \{\}\)/);
  // Every path that writes a captured offset back: the full rebuild, the live-stream
  // repaint that runs on each poll, and the shared layout snapshot.
  assert.equal((renderer.match(/if \(applyMessageScrollPin\(\)\) \{/g) || []).length, 3);
  assert.match(renderer, /for \(const eventName of \["wheel", "pointerdown", "keydown"\]\)/);
  assert.match(renderer, /activeMessageScrollPin\(\)/);
  // The pulse is re-applied by index, so a repaint landing mid-flash does not swallow it.
  assert.match(renderer, /function paintMessageMarkFlash\(\)/);
  assert.match(visualSmoke, /markJumpAligned: true, markJumpFlashed: 1/);
  assert.match(visualSmoke, /messageMarkHitHeight: 10, scrollLatestVisible: true, messageMarksClearOfLatest: true/);
  assert.match(visualSmoke, /messageRailInteractions: true/);
  // Idle scrolling must never snap the reader to a nearby message.
  assert.doesNotMatch(css, /\.messages(\.magnet)?[^{]*\{[^}]*scroll-snap/);
  assert.doesNotMatch(renderer, /function scheduleMessageMagnet/);
  assert.match(renderer, /classList\.remove\("magnet"\)/);

});

test("bounded transcripts retain real row geometry", () => {
  const css = readSource("src", "renderer", "styles.css");
  assert.match(css, /#messages > \* \{[^}]*content-visibility:visible/);
  assert.match(css, /\.messages \{[^}]*overflow-anchor:none/);
  assert.match(renderer, /const TRANSCRIPT_WINDOW_INITIAL = 80;/);
});

test("the transcript is a Telegram-style window, not pages", () => {
  // Pages hid everything outside them behind Older/Newer/Latest buttons: an older
  // page never showed the live bubble and arrivals never replaced the page being
  // read, so a chat left on an old page looked frozen. The log is one continuous
  // window now: scrolling up materializes older rows, distant rows unload into
  // spacers, and the pill counts what arrived below the window.
  assert.doesNotMatch(renderer, /TRANSCRIPT_PAGE_SIZE/);
  assert.doesNotMatch(renderer, /history-navigation/);
  assert.doesNotMatch(renderer, /showTranscriptPage/);
  assert.match(renderer, /Older messages load as you scroll up/);
  assert.match(renderer, /const TRANSCRIPT_WINDOW_MAX = 320;/);
  assert.match(renderer, /function transcriptWindow\(total\)/);
  assert.match(renderer, /function growTranscriptWindowUp\(keepFollowing = false\)/);
  assert.match(renderer, /function jumpToLatestTranscript\(\)/);
  assert.match(renderer, /function transcriptSpacer\(height, label\)/);
  assert.match(renderer, /function ensureMessageRendered\(msgIndex\)/);
  assert.match(renderer, /maybeGrowTranscriptWindow\(\);/);
  assert.match(renderer, /transcriptHiddenNewerCount\(\)/);
  const css = readSource("src", "renderer", "styles.css");
  assert.match(css, /\.transcript-spacer/);
  assert.match(css, /\.transcript-window-edge/);
  assert.doesNotMatch(css, /\.history-navigation/);
});

test("a gated Harness offers Connect with its launch URL instead of plain offline", () => {
  // A foreign token-gated Harness keeps serving the browser from its own cookie
  // while the widget holds none: the browser shows everything and the widget
  // shows nothing new. The banner says which offline it is and connects by URL.
  assert.match(html, /id="harnessConnectRow"/);
  assert.match(html, /id="harnessLaunchUrlInput"/);
  assert.match(html, /id="harnessConnectButton"[^>]*>Connect<\/button>/);
  assert.match(html, /id="harnessRestartButton"[^>]*>Restart<\/button>/);
  assert.match(html, /id="harnessConnectError"/);
  assert.match(renderer, /harnessNeedsAuth: false/);
  assert.match(renderer, /function renderOfflineBanner\(\)/);
  assert.match(renderer, /Harness is running, but the widget lost access/);
  assert.match(renderer, /startButton\.textContent = state\.harnessNeedsAuth \? "Restart" : \(state\.harnessDegraded/);
  assert.match(renderer, /if \(state\.harnessNeedsAuth\) \{\s+await restartHarnessFromBanner\(\)/);
  assert.match(renderer, /await window\.widget\.setHarnessLaunchUrl\(value\)/);
  assert.match(renderer, /await window\.widget\.restartHarness\(\)/);
  assert.match(renderer, /result\?\.reason === "token-required"/);
  const preload = readSource("src", "preload.cjs");
  assert.match(preload, /setHarnessLaunchUrl: \(url\) => ipcRenderer\.invoke\("set-harness-launch-url", url\)/);
  assert.match(preload, /restartHarness: \(\) => ipcRenderer\.invoke\("restart-harness"\)/);
  assert.match(ipc, /handle\("set-harness-launch-url"/);
  assert.match(ipc, /handle\("restart-harness"/);
  assert.match(ipc, /needsAuth: dashboardNeedsAuth\(error\)/);
  assert.match(settingsStore, /harnessLaunchUrl: ""/);
});

test("explicit startup can launch Harness while ordinary and smoke launches remain non-mutating", () => {
  assert.match(main, /if \(!ISOLATED_SMOKE_MODE\) \{[\s\S]*?if \(process\.argv\.includes\("--start-harness"\)\) startHarnessConnection/);
  assert.match(main, /api, launcher: harnessLauncher, persistCapturedLaunchUrl: \(\) => \{\}, invalidateDashboard: dashboardReader\.invalidate/);
});

test("history failures have a persistent recovery surface and model reads are bounded and coalesced", () => {
  for (const id of ["historyLoadError", "historyLoadErrorText", "historyRetryButton", "historyOpenHarnessButton", "historyNewChatButton"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(renderer, /recordHistoryLoadError\(sessionId, error\)/);
  assert.match(renderer, /previousError\?\.retryAt > Date\.now\(\)/);
  assert.match(renderer, /state\.modelsLoadingSessionId === sessionId && state\.modelsLoadPromise/);
  assert.match(renderer, /timeoutMs = 25000/);
});

test("a mark jump lands exactly even with skipped transcript rows", () => {
  const visualSmoke = readSource("scripts", "ui-visual-smoke.cjs");
  // Skipped rows report remembered sizes, so scrollTop math computed up front lands
  // off target with nothing left to correct it. The jump rides scrollIntoView, which
  // resolves the real geometry on the way, and a scrollend settle snaps the remainder.
  assert.match(renderer, /node\.scrollIntoView\(\{ block: "start", behavior: reduceMotion \? "auto" : "smooth" \}\)/);
  // Marks address the full history by message index and expand the window first, so a
  // jump to an unloaded row cannot land on a detached node the way captured bubbles did.
  assert.match(renderer, /function ensureMessageRendered\(msgIndex\)/);
  assert.match(renderer, /document\.querySelector\(`#messages \[data-vmsg="\$\{msgIndex\}"\]`\)/);
  assert.match(renderer, /\$\("#messages"\)\.addEventListener\("scrollend", \(\) => \{/);
  // scrollIntoView also scrolls overflow:hidden ancestors, which would drag the whole
  // widget - titlebar included - up behind the jump. Those containers never scroll by
  // design, so every programmatic jump pins them back to zero.
  assert.match(renderer, /function pinTranscriptAncestors\(\) \{/);
  assert.match(renderer, /for \(const selector of \["\.widget-shell", "\.chat-panel", "\.messages-wrap"\]\) \{/);
  // While the pin owns the scroll, passing near the bottom must not re-pin to it:
  // landing on an underestimated bottom used to stick the log there and hide the jump.
  // And the bottom only counts as the bottom of the conversation when the virtualized
  // window actually holds the newest message, or the log follows the foot of a spacer.
  assert.match(renderer, /if \(!activeMessageScrollPin\(\)\) \{[\s\S]{0,1100}?if \(!ownScroll && leaving\) state\.messagesStickToBottom = nearBottom && transcriptAtLatest\(\);/);
  // Only a hand moving up pauses following; a layout correction or a hand moving down does not.
  assert.match(renderer, /const leaving = nearBottom \|\| \(userScroll && movedUp\) \|\| !state\.messagesStickToBottom;/);
  assert.match(visualSmoke, /markJumpAligned: true, markJumpFlashed: 1/);
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
  assert.match(css, /\.queue-row\.expanded \.queue-preview \{[^}]*font-size:13px/);
  // A size up from the resting line, never smaller than it.
  assert.match(css, /\.queue-preview \{[^}]*font-size:12px/);
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
  assert.match(visualSmoke, /queueRowsExpanded: 1, queueExpandedNotClipped: true, queueExpandedFontPx: 13, queueDockAboveComposer: true/);
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
  const nextFunction = renderer.slice(switchStart).search(/\n(?:async )?function /);
  const switchEnd = switchStart + nextFunction;
  assert.ok(switchStart > 0 && switchEnd > switchStart && renderer.slice(switchStart, switchEnd).includes("clearComposerError();"));
  // A reason cut off mid-sentence is no reason, but it must not push the composer away.
  assert.match(css, /\.composer-error \{[^}]*flex:none/);
  assert.match(css, /\.composer-error small \{[^}]*max-height:64px;[^}]*overflow:auto/);
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
  // The meta is a span beside the label column; only the label column may grow, or an empty
  // meta takes half of the row and the preview is cut to a couple of words.
  assert.match(css, /\.activity-card > summary > span:not\(\.activity-meta\) \{[^}]*flex:1;/);
  assert.doesNotMatch(css, /\.activity-card > summary > span \{/);
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
  assert.match(renderer, /function createActivityRun\(run\)/);
  assert.match(renderer, /className = `tool-group/);
  assert.match(renderer, /partial-failure/);
  assert.match(renderer, /completed ·.*failed/);
  assert.match(renderer, /visibleMessages\[index\]\.role === "tool"/);
  assert.match(renderer, /tool-group-body/);
  assert.match(css, /\.tool-group\.partial-failure/);
  // A tool header is one line of text: it gets a line of box, not two.
  assert.match(css, /\.tool-group > summary \{[^}]*height:30px/);
  assert.match(css, /\.tool-call > summary \{[^}]*height:28px/);
  // The glyph carries the state: a running call says so without another line of text.
  assert.match(renderer, /message\.status === "running" && !message\.isError \? " running" : ""/);
  assert.match(css, /\.tool-call\.running > summary > \.ui-icon:first-child \{[^}]*animation:tool-running/);
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

test("appearance initializes before app preference hydration", () => {
  assert.ok(html.indexOf('src="appearance.js"') < html.indexOf('src="app.js"'));
});

test("session switching lives in Agents without a duplicate chat picker", () => {
  assert.doesNotMatch(html, /id="sessionButton"|id="sessionMenu"|id="sessionOptions"/);
  assert.match(renderer, /const activate = \(\) => selectSession\(card.dataset.sessionId, true\)/);
});

test("a transient workspace picker refresh preserves the last successful projection", () => {
  const loadWorkspaces = renderer.slice(renderer.indexOf("async function loadWorkspaces"), renderer.indexOf("function renderAttachments"));
  assert.doesNotMatch(loadWorkspaces, /catch \{\s*state\.workspaces = \[\]/);
  assert.match(loadWorkspaces, /catch \{\s*state\.workspacesLoaded = true/);
});

test("queue snapshots win send races and steer preserves the in-flight response", () => {
  assert.match(renderer, /queueSnapshotRevisions/);
  assert.match(renderer, /expectedSnapshotRevision/);
  assert.match(renderer, /queueSnapshotRevision\(sessionId\) !== expectedSnapshotRevision/);
  assert.match(renderer, /function beginSteeredTurn/);
  assert.match(renderer, /steeringPromptsBySession/);
  assert.match(renderer, /steering-message/);
  assert.doesNotMatch(renderer, /steeredSessionsAwaitingTurnStart/);
  const steer = renderer.slice(renderer.indexOf("function beginSteeredTurn"), renderer.indexOf("function trackQueuedPrompt"));
  assert.doesNotMatch(steer, /liveStreamsBySession\.delete/);
  assert.match(steer, /next agent step/);
});

test("completed reasoning is omitted and live activity remains a collapsed card", () => {
  assert.match(renderer, /if \(message\.role === "reasoning"\)/);
  assert.match(html, /<details id="activityCard"/);
  assert.doesNotMatch(harnessApi, /Last reasoning/);
});

test("view switch lives in the titlebar and chat actions share one toolbar", () => {
  const titlebar = html.slice(html.indexOf('<header class="titlebar'), html.indexOf("</header>") + 9);
  assert.match(titlebar, /<nav class="tabs/);
  const toolbar = html.slice(html.indexOf('<div class="chat-heading'), html.indexOf('<details id="activityCard"'));
  assert.match(toolbar, /id="newSessionButton"/);
  assert.match(toolbar, /id="reasoningButton"/);
});

test("the session toolbar has a DeepSeek button for the selected Harness session", () => {
  const toolbar = html.slice(html.indexOf('<div class="chat-heading'), html.indexOf('<details id="activityCard"'));
  assert.match(toolbar, /id="openSessionButton"[\s\S]{0,300}assets\/deepseek\.svg/);
  assert.match(renderer, /openHarnessSession\(state\.selectedSessionId\)/);
  assert.match(ipc, /open-harness-session/);
  assert.match(ipc, /harnessSessionUrl\(harnessBrowserBase\(\), sessionId\)/);
  assert.match(ipc, /harnessBrowserBase/);
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
  assert.match(ipc, /await renderMarkdownBatch\(formattedMessages\.map/);
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

test("ordinary screen capture prepares reviewed chat attachments", () => {
  const preload = readSource("src", "preload.cjs");
  assert.match(html, /id="captureButton"/);
  assert.match(html, /data-capture="region"/);
  assert.match(html, /data-capture="display"/);
  assert.match(html, /data-capture="display-send"/);
  assert.match(renderer, /button\.dataset\.capture === "display-send"/);
  assert.match(renderer, /captureDisplaySendHint/);
  assert.match(preload, /captureScreenshot: \(kind\) => ipcRenderer\.invoke\("capture-screenshot", kind\)/);
  assert.match(ipc, /handle\("capture-screenshot"/);
  assert.match(main, /gate: screenshotCaptureGate/);
  assert.match(readFileSync(path.join(__dirname, "../src/chat-capture.cjs"), "utf8"), /await service\.removeCapture\(result\.path\)/);
  assert.match(ipc, /await cleanupSentCaptureFiles\(attachments\)/);
  assert.match(renderer, /addAttachments\(result\.prepared\)/);
  assert.match(renderer, /Screenshot attached above the message field\. Review it before sending\./);
  // Same reason as the paste guard: this function is 709 characters and the budget was 700,
  // so its last nine characters were already outside the window this was meant to police.
  assert.doesNotMatch(functionBody(renderer, "function handleScreenshotResult"), /requestSubmit\(/);
});

test("all global shortcuts can be rebound, disabled, reset, and persisted", () => {
  const preload = readSource("src", "preload.cjs");
  const store = readSource("src", "settings-store.cjs");
  for (const action of ["showRestore", "toggleFocusChat", "collapseAvatar", "collapseEdge", "newSession", "openHarness", "captureDisplay", "captureDisplaySend", "captureRegion"]) {
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
  // Which service a build gets is decided in its own module, where it can be tested.
  assert.match(main, /require\("\.\/update-service-factory\.cjs"\)/);
  const updateFactory = readSource("src", "update-service-factory.cjs");
  assert.match(updateFactory, /createUpdateService/);
  assert.match(updateFactory, /createInstalledUpdateService/);
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
  assert.match(renderer, /MODE_EXIT_DURATION = 100/);
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
  assert.match(renderer, /await setWindowMode\("full", \{ mini: fromAvatar \}\);\s*if \(selecting\) await selecting;/);
  assert.match(renderer, /state\.avatarMode === "error" && !state\.compactErrorUnread && !state\.harnessOffline/);
  const clearError = renderer.slice(renderer.indexOf("function clearAcknowledgedErrorPresentation"), renderer.indexOf("function signalSessionError"));
  assert.doesNotMatch(clearError, /state\.currentActivity\?\.kind !== "error"/);
  assert.match(clearError, /commandFeedback\?\.avatarMode === "error"[\s\S]+setCommandFeedback\(state\.selectedSessionId, null\)/);
  assert.match(renderer, /if \(mode !== "full"\) clearAcknowledgedErrorPresentation\(\);[\s\S]+?window\.widget\.setWindowMode\(mode, options\)/);
  assert.match(renderer, /session\?\.state === "error"\) signalSessionError\(session\)/);
  assert.match(renderer, /if \(state\.windowMode === "full"\) \{[\s\S]+?\["error", "warning"\]\.includes\(latest\?\.role\)/);
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
  assert.doesNotMatch(submit, /agentControls/);
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
  assert.match(renderer, /setAvatar\("offline"\)/);
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
  // The readable grey is the solid token; --dim is that grey at the text opacity, 100% by default.
  assert.match(styles, /--dim-solid: #8b97a9;/);
  assert.match(styles, /--dim: color-mix\(in srgb, var\(--dim-solid\) calc\(var\(--text-alpha\) \* 100%\), transparent\);/);
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
  for (const action of ["set-opacity", "set-glow-intensity", "set-font-scale", "set-background-opacity"]) {
    const start = ipc.indexOf(`handle("${action}"`);
    const body = ipc.slice(start, ipc.indexOf('  handle("', start + 1));
    assert.match(body, /schedulePreferenceSave\(\)/);
    assert.doesNotMatch(body, /\n\s*savePreferences\(\);/);
  }
});

test("a dead renderer is recovered instead of left on screen", () => {
  assert.match(main, /require\("\.\/renderer-recovery\.cjs"\)/);
  assert.match(main, /on\("render-process-gone"/);
  // A reloaded renderer has no memory of the gesture it was mid-flight in, so the
  // load handler releases stranded drag origins before marking recovery loaded.
  assert.match(main, /on\("did-finish-load", \(\) => \{ releaseDragOrigins\(\); rendererRecovery\.loaded\(\); \}\)/);
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
  // The guard itself lives in ipc-guard.cjs; ipc-handlers.cjs applies it to every channel.
  assert.match(ipc, /const isTrustedSender = createSenderCheck\(getWindow\);/);
  assert.match(readSource("src", "ipc-guard.cjs"), /if \(!target \|\| target\.isDestroyed\?\.\(\)\) return false/);
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
  assert.match(history, /const skipReconciliation = rendererAlreadyHasRevision && sameRevision/);
  assert.match(history, /if \(skipReconciliation\) \{\s*paintLiveAssistant\(\);\s*return "unchanged"/);
  assert.match(refresh, /!selectedStreamUsable && \(!selectedHistoryIsCurrent\(selectedSession\) \|\| selectedPreviewChanged\(selectedSession\)\)/);
  // session.list need not bump updatedAt for every message, but the preview always
  // carries the newest assistant text, so a moved preview refreshes history too.
  assert.match(renderer, /function selectedPreviewChanged\(session\)/);
  assert.match(renderer, /function latestAssistantPreview\(messages\)/);
  // A stream the dashboard reports as idle, silent for two poll intervals, is a
  // dropped turn/end: it is retired instead of suppressing history refreshes forever.
  assert.match(refresh, /selectedStream\?\.active && !selectedRunning && Date\.now\(\) - \(selectedStream\.lastEventAt \|\| 0\) > 8000/);
  assert.match(live, /event\.type === "user\/message"[\s\S]+refreshHistoryAfterLiveMessage\(sessionId\)/);
  assert.match(live, /event\.type === "assistant\/message"[\s\S]+refreshHistoryAfterLiveMessage\(sessionId\)/);
  assert.match(live, /event\.type === "turn\/end"[\s\S]+refreshHistory\(\{ priority: true \}\)/);
  // The turn/end follow-up waits 90ms, and the session may have changed while it
  // waited: its refresh must bail instead of writing another chat's history here.
  assert.match(live, /if \(sessionId !== state\.selectedSessionId\) \{\s*if \(state\.liveStreamsBySession\.get\(sessionId\) === completedStream\) \{\s*state\.liveStreamsBySession\.delete\(sessionId\);\s*\}\s*return;\s*\}/);
});

test("a tap on the brand is resolved by the drag handler, not by a stolen click", () => {
  // Pointer capture on .titlebar retargets the click away from the child button, so the
  // gesture end must act on the element the pointer went down on.
  assert.match(renderer, /origin: event\.target/);
  assert.match(renderer, /function activateBrandTarget\(origin\)/);
  assert.match(renderer, /origin\.closest\("#avatarButton"\)\) setWindowMode\("orb"\)/);
  assert.match(renderer, /origin\.closest\("#projectLink"\)\) window\.widget\.openProject\(\)/);
  const endFull = renderer.slice(renderer.indexOf("function endFullDrag"), renderer.indexOf("function activateBrandTarget"));
  assert.match(endFull, /\} else if \(event\.type !== "pointercancel"\) \{\s*\n\s*activateBrandTarget\(origin\);/);
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
  assert.match(body, /if \(!image\.src\.endsWith\(nextAvatar\)\) image\.src = nextAvatar;/);
});

test("dashboard polls cannot replace Deck's own selected session", () => {
  const start = renderer.indexOf("const dashboardVisibleSessions");
  const end = renderer.indexOf("if (!selectionChangedWhileLoading && state.selectedSessionId !== selectedAtRequest)");
  assert.ok(start > 0 && end > start, "the selection block moved; re-anchor this test");
  const refresh = renderer.slice(start, end);
  assert.ok(refresh.length < 1400, `selection block grew to ${refresh.length} chars`);
  assert.doesNotMatch(refresh, /state\.selectedSessionId = null/);
  assert.doesNotMatch(refresh, /missingSelectionPolls/);
  // Auto-selection may not run against an offline dashboard at all.
  assert.match(refresh, /!state\.selectedSessionId && dashboard\.harness && dashboardVisibleSessions\.length/);
  // Recovery restores what the user had chosen before guessing.
  assert.match(refresh, /const remembered = dashboardVisibleSessions\.find\(\(session\) => session\.sessionId === state\.lastSelectedSessionId\)/);
  assert.match(refresh, /\(remembered \|\| dashboardVisibleSessions\.find\(\(session\) => session\.running\) \|\| dashboardVisibleSessions\[0\]\)/);
  assert.match(refresh, /if \(state\.selectedSessionId\) state\.lastSelectedSessionId = state\.selectedSessionId;/);
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
  assert.match(renderer, /const since = live \? String\(runningSince\) : "";/);
  assert.match(renderer, /if \(node\.dataset\.runningSince !== since\) node\.dataset\.runningSince = since;/);
  // The ticking value must stay out of the render signature, or the list rebuilds every
  // second; and the interval must stop when nothing is running.
  const signature = renderer.slice(renderer.indexOf("function renderSessions"), renderer.indexOf("function renderSessionToolbar"));
  assert.doesNotMatch(signature, /runningSince|lastRunMs/);
  assert.match(renderer, /\} else if \(!live && state\.sessionTimerTick\) \{\s*clearInterval\(state\.sessionTimerTick\);/);
});

test("the orb window only takes the mouse where it draws something", () => {
  // A 172x128 transparent window for a 68px circle used to swallow every click that landed
  // near the avatar. The renderer measures its live controls; everything else forwards.
  assert.match(renderer, /function publishCompactHitAreas\(\)/);
  // The relay's questions reach the renderer: pushed as they change and read once at start.
  assert.match(renderer, /window\.widget\.onPendingQuestions\(\(list\) => applyPendingQuestions\(list\)\);/);
  assert.match(renderer, /window\.widget\.getPendingQuestions\(\)\.then\(applyPendingQuestions\)/);
  // The pet's body is measured too: on its edge it is drawn beyond the button's own box.
  assert.match(renderer, /for \(const selector of \["#orbRestore", "#orbRestore \.pet-body", "#orbHistoryButton", "#orbFeedButton", "#orbDockButton", "#orbStatus"\]\)/);
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
  // Standing status (working, offline) waits for the setting; a notification - a reply, a
  // question, a failure - always shows, and leaves on its own.
  assert.match(renderer, /const active = Boolean\(expanded \|\| state\.compactStatusClosing \|\| preview \|\| \(state\.compactAutoExpand && offline && autoActive\)\)/);
  // Status on shows each of the agent's messages, never its tools or thinking.
  assert.match(renderer, /announceAssistantMessage\(sessionId, event\.data\?\.message\);/);
  assert.match(renderer, /\.filter\(\(part\) => part\?\.type === "text" && typeof part\.text === "string"\)/);
  // One number only: new replies on the avatar. Agents at work show as the chat button's
  // turning ring, not as a second count beside the first.
  assert.match(html, /id="orbPanelCount"/);
  assert.match(renderer, /\$\("#orbPanelCount"\)\.classList\.remove\("visible"\);/);
  // The eye beside the chat button is the same preference as the settings toggle.
  assert.match(html, /id="orbFeedButton"[^>]+aria-pressed="false"/);
  assert.match(renderer, /feed\.setAttribute\("aria-pressed", String\(state\.compactAutoExpand\)\)/);
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
  const signature = renderer.slice(renderer.indexOf("function renderSessions"), renderer.indexOf("function renderSessionToolbar"));
  assert.match(signature, /activeBackgroundTasks\(session\)/);
  // Written into the <b>, never onto the wrapper, which also holds the icon.
  assert.match(renderer, /const value = node\.querySelector\("b"\);/);
  const css = readSource("src", "renderer", "styles.css");
  assert.match(css, /\.session-background \{ display:none; \}/, "zero running tasks must take no width");
  assert.match(css, /\.session-background b \{[^}]*font-variant-numeric:tabular-nums/);
});

test("the transcript is reconciled by key instead of rebuilt on every change", () => {
  // The log used to be thrown away on every change - each poll while a tool ran, each
  // result that landed - so entry animations replayed, images reloaded and a selection had
  // to be re-resolved by offset. A block whose signature did not change keeps its node.
  const body = functionBody(renderer, "function renderMessages(messages)");
  assert.doesNotMatch(body, /root\.replaceChildren\(\)/, "the whole log is never cleared");
  assert.doesNotMatch(body, /root\.innerHTML/, "the empty state is a keyed block like any other");
  assert.match(body, /const cache = transcriptCache\(\);/);
  assert.match(body, /if \(cached && cached\.signature === block\.signature\) \{\s*node = cached\.node;/);
  assert.match(body, /reconcileChildren\(root, nodes\);/);
  const reconcile = functionBody(renderer, "function reconcileChildren(root, nodes)");
  assert.match(reconcile, /if \(current !== node\) root\.insertBefore\(node, current \|\| null\);/);
  // The cache is per session: sequence numbers repeat across sessions.
  assert.match(renderer, /if \(state\.transcriptCacheSessionId !== state\.selectedSessionId\) \{\s*state\.transcriptCache = new Map\(\);/);
  // Only newcomers slide in, and only once the log is already on screen for this session.
  // History grown by scrolling up arrives silently: eighty rows sliding in at once
  // is a wave, not a signal.
  assert.match(body, /if \(settled && !cached && !transcriptSilentGrow\) \{\s*if \(key\.startsWith\("tools:"\) \|\| block\.message\?\.role === "assistant"\) markTranscriptArrival\(node, \{ fresh: !transcriptRunGrew\(key, cache\) \}\);\s*else markTranscriptEntry\(node\);/);
  const css = readSource("src", "renderer", "styles.css");
  assert.match(css, /#messages > \.enter \{ animation:transcript-enter/);
  // The bubble that streamed the answer becomes the answer, rather than vanishing and
  // sliding back in as a new node with the same text.
  assert.match(body, /node = createMessageBubble\(block\.message, liveBubble\);/);
  assert.match(renderer, /function liveDuplicatesFinalAnswer\(text\)/);
  // A selection that survived in a reused node is left alone.
  const restore = functionBody(renderer, "function restoreMessageSelection(root, snapshot)");
  assert.match(restore, /root\.contains\(live\.anchorNode\) && root\.contains\(live\.focusNode\)\) return;/);
  // A card reopened after a rebuild does not replay its reveal.
  assert.match(renderer, /details\.dataset\.restored = "1";/);
  assert.match(css, /details\[data-restored\]::details-content \{ transition:none; \}/);
});

test("the strips around the log ease open and shut while the log stays anchored", () => {
  const css = readSource("src", "renderer", "styles.css");
  assert.match(css, /\.activity-card, \.todo-dock, \.queue-dock, \.command-menu, \.command-hint-bar, \.composer-error, \.goal-dock, \.offline-banner \{ interpolate-size:allow-keywords; transition:height [^}]*display \.24s allow-discrete; \}/);
  // Previews reserve their complete row immediately even while the composer grows.
  // The Chromium attachment-layout smoke checks actual clipping during that motion.
  assert.match(css, /\.attachment-bar \{ flex:none;/);
  assert.match(css, /\.attachment-bar\.has-items \{ display:grid; animation:attachment-reveal \.18s ease-out;/);
  // Hidden is a state the strip animates to: zero height, the flex gap swallowed by a
  // negative margin, and display kept until the exit is over.
  assert.match(css, /\.activity-card:not\(\.has-activity\), \.activity-card\[hidden\], \.todo-dock\[hidden\], \.queue-dock:not\(\.has-items\)[^{]*\{ display:none; height:0;[^}]*margin-top:calc\(-1 \* var\(--strip-gap,0px\)\)/);
  assert.match(css, /@starting-style \{\s*\.activity-card\.has-activity:not\(\[hidden\]\), \.todo-dock:not\(\[hidden\]\)[^{]*\{ height:0;/);
  // The gap the margin swallows is the gap the panel actually uses, crowded or not.
  assert.match(css, /\.chat-panel\.active \{ --strip-gap:7px; \}/);
  assert.match(css, /\.chat-crowded \.chat-panel\.active \{ --strip-gap:1px; \}/);
  // Drawers: tool cards, the activity card and the goal panel reveal their content.
  assert.match(css, /\.tool-call::details-content, \.tool-group::details-content, \.activity-card::details-content, \.goal-dock::details-content, \.hotkey-settings::details-content \{ interpolate-size:allow-keywords; height:0; overflow:clip;/);
  assert.doesNotMatch(css, /\.agent-controls/);
  assert.match(css, /\.model-picker\.compact-overlay \.model-menu \{[^}]*position:fixed/, "the model dialog escapes the toolbar without a setup disclosure");
  // The old one-frame entrances are gone; the strip's own height is the entrance now.
  for (const name of ["queue-in", "command-menu-in", "thinking-activity-in", "goal-open", "live-bubble-in"]) {
    assert.doesNotMatch(css, new RegExp(`@keyframes ${name} `), `${name} is replaced by the eased strip`);
  }
  // Whatever moves the log's edges, a log following the conversation keeps following it.
  assert.match(renderer, /restoreTranscriptAnchor\(root, transcriptReadingPosition\.anchor\)/);
  // The smoke suite checks the platform actually has the three features this leans on, and
  // one case leaves motion on to watch the strip ease under a following log: several
  // observed heights prove the easing, a one-pixel ceiling on the gap proves the anchor.
  const visualSmokeSource = readSource("scripts", "ui-visual-smoke.cjs");
  assert.match(visualSmokeSource, /cssHeightInterpolation: true, cssDetailsContent: true, cssStartingStyle: true/);
  assert.match(visualSmokeSource, /name: "strip-easing"[^}]*motion: true[^}]*stripTraceShrunk: true, messagesAtBottom: true \}, min: \{ stripTraceSteps: 3 \}, max: \{ stripTraceMaxGap: 2 \}/);
  assert.match(visualSmokeSource, /WIDGET_SCREENSHOT_MOTION: "1"/);
  assert.match(main, /\.\.\.\(screenshotPath && !screenshotMotion \? \{ screenshotStatic: "1" \} : \{\}\)/);
});

test("the streaming answer is formatted as it arrives, through the same sanitizer as history", () => {
  const preload = readSource("src", "preload.cjs");
  assert.match(preload, /renderMarkdown: \(text\) => ipcRenderer\.invoke\("render-markdown", String\(text \?\? ""\)\)/);
  assert.match(ipc, /handle\("render-markdown", \(_event, text\) => renderMarkdownAsync\(typeof text === "string" \? text : ""\)\)/);
  // The first chunk is painted as text at once; nothing waits on IPC.
  const paint = functionBody(renderer, "function paintLiveText(bubble, text)");
  assert.match(paint, /if \(!bubble\.dataset\.formatted \|\| text\.length > LIVE_MARKDOWN_MAX_CHARS\)/);
  assert.match(paint, /bubble\.textContent = text\.length > LIVE_MARKDOWN_MAX_CHARS/);
  assert.match(paint, /text\.slice\(-LIVE_MARKDOWN_MAX_CHARS\)/);
  assert.match(paint, /scheduleLiveMarkdown\(bubble, text\);/);
  // One request in flight, and only the newest text may land - on a bubble that is still
  // the live one.
  const schedule = functionBody(renderer, "function scheduleLiveMarkdown(bubble, text)");
  assert.match(schedule, /if \(liveMarkdownInFlight\) return;/);
  assert.match(schedule, /job\.bubble\.isConnected && liveBubbleText\.get\(job\.bubble\) === job\.text\) applyLiveMarkdown\(job\.bubble, html\);/);
  assert.match(renderer, /const LIVE_MARKDOWN_MAX_CHARS = 60000;/);
  // The caret goes inside the last paragraph or list item, not on a line of its own.
  assert.match(renderer, /liveCaretHost\(bubble\)\.append\(liveCaret\(\)\);/);
  const visualSmokeSource = readSource("scripts", "ui-visual-smoke.cjs");
  assert.match(visualSmokeSource, /liveBubbleFormatted: true, liveBubbleHeadings: 1, liveBubbleListItems: 3, liveCaretInLastLine: true/);
});

test("a chosen session shows a loading skeleton, never a wrong empty state", () => {
  const select = functionBody(renderer, "async function selectSession(sessionId, openChat = false)");
  assert.match(select, /state\.historyPendingSessionId = state\.selectedSessionId;/);
  const history = renderer.slice(renderer.indexOf("async function refreshHistory("), renderer.indexOf("function refreshHistoryAfterLiveMessage"));
  assert.match(history, /if \(state\.historyPendingSessionId === sessionId\) state\.historyPendingSessionId = null;/);
  // A failed load clears the skeleton too, or it would sit there forever.
  assert.match(history, /if \(state\.historyPendingSessionId === sessionId\) \{\s*state\.historyPendingSessionId = null;\s*renderMessages\(state\.currentMessages\);/);
  const render = functionBody(renderer, "function renderMessages(messages)");
  assert.match(render, /awaitingHistory\s*\? \{ key: "skeleton", signature: "skeleton", build: transcriptSkeleton \}/);
  const css = readSource("src", "renderer", "styles.css");
  assert.match(css, /\.skeleton-bubble \{[^}]*animation:skeleton-sweep/);
  const skeleton = functionBody(renderer, "function transcriptSkeleton()");
  assert.match(skeleton, /node\.setAttribute\("aria-hidden", "true"\);/);
});

test("messages carry copy and reuse actions with a toast for feedback", () => {
  assert.match(html, /<symbol id="icon-copy"/);
  assert.match(html, /<symbol id="icon-reuse"/);
  assert.match(html, /<div id="toastStack" class="toast-stack" role="status" aria-live="polite"><\/div>/);
  const actions = functionBody(renderer, "function createBubbleActions(message)");
  assert.match(actions, /bubbleActionButton\("copy", "Copy message"/);
  assert.match(actions, /if \(message\.role === "user"\) actions\.append\(bubbleActionButton\("reuse"/);
  assert.match(renderer, /await navigator\.clipboard\.writeText\(String\(text \|\| ""\)\);/);
  // The action's press never reaches the log's own click handling.
  const button = functionBody(renderer, "function bubbleActionButton(icon, title, onClick)");
  assert.match(button, /event\.stopPropagation\(\);/);
  // Reuse appends to a composer that already has text rather than throwing it away.
  const reuse = functionBody(renderer, "function reuseMessageText(text)");
  assert.match(reuse, /input\.value = current \? `\$\{current\}\\n\$\{text\}` : String\(text \|\| ""\);/);
  const toast = renderer.slice(renderer.indexOf("function showToast("), renderer.indexOf("const GOAL_TOASTS"));
  assert.match(toast, /while \(stack\.childElementCount >= 2\) stack\.firstElementChild\.remove\(\);/);
  // With motion off there is no animation to end, so a timer removes the toast.
  assert.match(toast, /setTimeout\(\(\) => toast\.remove\(\), 320\);/);
  const css = readSource("src", "renderer", "styles.css");
  assert.match(css, /\.bubble:hover \.bubble-actions, \.bubble:focus-within \.bubble-actions, \.bubble\.actions-visible \.bubble-actions \{ opacity:1; transform:none; pointer-events:auto; \}/);
  // Interior floats reserve text space without an invisible footer in small chats.
  assert.match(css, /\.bubble-actions \{ position:relative; float:right;[^}]*width:auto;[^}]*flex-direction:row;/);
  // One line tall: a button-tall float also notched the second line of every answer.
  assert.match(css, /\.bubble-actions \{[^}]*height:20px;[^}]*margin:0 0 0 10px;/);
  assert.match(renderer, /bubble\.prepend\(createBubbleActions\(message\)\)/);
  // The assistant's prose spans the log; your own messages are bubbles hugging the right
  // edge, and their actions wait in the gutter the bubble leaves on its left - never over a
  // word and never as a reserved footer.
  assert.match(css, /\.bubble \{[^}]*width:100%; max-width:none;/);
  assert.match(css, /\.bubble\.user \{[^}]*width:fit-content; max-width:calc\(100% - 60px\); margin-left:auto;/);
  assert.match(css, /\.bubble\.user > \.bubble-actions \{ position:absolute;[^}]*right:calc\(100% \+ 6px\);[^}]*float:none;/);
  assert.match(css, /\.messages \{[^}]*overflow:hidden auto;/);
  // Goal and queue actions say what they did the same way.
  assert.match(renderer, /showToast\(GOAL_TOASTS\.find/);
  assert.match(renderer, /showToast\(action\.kind === "steer" \? "Sent now"/);
});

test("the composer keeps a draft per session and recalls sent messages with the arrows", () => {
  const select = functionBody(renderer, "async function selectSession(sessionId, openChat = false)");
  assert.match(select, /stashComposerDraft\(previousSessionId\);\s*restoreComposerDraft\(state\.selectedSessionId\);/);
  // Both the send path and the command path remember what went out, under the session it
  // actually went to - a first message creates the session it is then filed under.
  assert.match(renderer, /rememberSentMessage\(result\.sessionId, text\);/);
  assert.match(renderer, /rememberSentMessage\(targetSessionId, text\);/);
  assert.match(renderer, /const COMPOSER_HISTORY_LIMIT = 50;/);
  const recall = functionBody(renderer, "function recallComposerHistory(step)");
  // Only an empty composer answers the arrows; a message being written keeps them.
  assert.match(recall, /if \(!recalling && \(input\.value !== "" \|\| step > 0\)\) return false;/);
  // A recalled multi-line message can still be edited with the keyboard.
  assert.match(recall, /if \(recalling && step < 0 && input\.value\.slice\(0, input\.selectionStart\)\.includes\("\\n"\)\) return false;/);
  assert.match(renderer, /recallComposerHistory\(event\.key === "ArrowUp" \? -1 : 1\)/);
  // Typing ends the walk.
  assert.match(renderer, /addEventListener\("input", async \(event\) => \{\s*resetComposerRecall\(\);/);
  const visualSmokeSource = readSource("scripts", "ui-visual-smoke.cjs");
  assert.match(visualSmokeSource, /composerValue: "Now re-render the cover\."/);
});

test("the wow is on the surfaces that carry state, and every bit of it obeys the motion switch", () => {
  const css = readSource("src", "renderer", "styles.css");
  // The aurora drifts behind everything, follows the glow slider, and brightens with work.
  assert.match(css, /\.widget-shell::before \{[^}]*z-index:-1;[^}]*opacity:calc\(var\(--chat-glow-intensity\) \* var\(--panel-background-opacity\)/);
  for (const phase of ["waiting", "thinking", "writing", "tool", "done", "error"]) {
    assert.ok(css.includes(`body[data-chat-state="${phase}"] { --chat-light-primary:`));
  }
  assert.match(css, /animation:aurora-drift 28s/);
  // One plate slides between the tabs.
  assert.match(css, /\.tabs::before \{[^}]*transform:translateX\(calc\(var\(--tab-index,0\) \* \(100% \+ 3px\)\)\); transition:transform \.3s/);
  assert.match(renderer, /style\.setProperty\("--tab-index", tab === "agents" \? "1" : "0"\)/);
  // The plane leaves with the message; the ring beats when the context is critical; a
  // working card carries a sweep of light; settings rows arrive one after another.
  assert.match(css, /\.composer #sendButton\.launch \.ui-icon \{ animation:send-launch/);
  assert.match(renderer, /function launchSendButton\(\)/);
  assert.match(css, /\.context-arc \{ stroke:url\(#context-ring-gradient\); \}/);
  assert.match(html, /<linearGradient id="context-ring-gradient"/);
  assert.match(css, /\.context-meter\.critical \.context-arc \{ animation:ring-alarm/);
  assert.match(css, /\.session-card\.state-working::after \{[^}]*animation:card-sweep/);
  assert.match(css, /\.settings-panel\.open > \* \{ animation:settings-row/);
  // All of it is animation or transition, and the switch turns both off wholesale.
  assert.match(css, /body\.motion-off \*, body\.motion-off \*::before, body\.motion-off \*::after \{ animation:none !important; transition:none !important; \}/);
  assert.match(html, /Aurora, easing strips, message entrances, hover and press feedback/);
});

test("the compact handles carry no native tooltip", () => {
  // A native title tooltip popped "Restore widget" over the game whenever the pointer rested
  // on the edge line or the orb. The handle's meaning is the handle itself; the label stays
  // for assistive technology only.
  assert.match(html, /<button id="edgeMode" class="edge-mode no-drag" type="button" aria-label="Restore widget">/);
  assert.match(html, /<button id="orbRestore" class="orb-avatar" type="button" aria-label="Restore widget">/);
  assert.doesNotMatch(html, /title="Restore widget"/);
});

test("the virtualized transcript grows towards the newest message, not only backwards", () => {
  // The window only ever grew upwards, so a few chunks of scrollback left the newest
  // messages below it behind a spacer. Scrolling back down landed on the foot of that
  // spacer: a blank region where arrivals never appeared and the only way out was the pill.
  assert.match(renderer, /function growTranscriptWindowDown\(\)/);
  const grow = functionBody(renderer, "function maybeGrowTranscriptWindow(repairBlankViewport = false)");
  assert.match(grow, /transcriptViewStart > 0/);
  assert.match(grow, /transcriptViewEnd < state\.currentMessages\.length/);
  assert.match(grow, /if \(towardsOlder\) growTranscriptWindowUp\(\);\s*\n\s*else growTranscriptWindowDown\(\);/);
  // Growing down trims the top of the window to stay under the DOM cap, so the reading
  // position is held against a row that survives the grow rather than against a height.
  const down = functionBody(renderer, "function growTranscriptWindowDown()");
  assert.match(renderer, /captureTranscriptAnchor\(root\)/);
  assert.match(renderer, /restoreTranscriptAnchor\(root, anchor\)/);
  // The scroll a grow causes is its own correction, not a request for another grow.
  const settle = functionBody(renderer, "function settleTranscriptScroll(root, top)");
  assert.match(settle, /if \(root\.scrollTop !== before\) transcriptProgrammaticScrollAt = Date\.now\(\);/);
  assert.match(grow, /if \(ownScroll && !repairBlankViewport\) return;/);
  assert.match(down, /transcriptViewEnd = Math\.min\(total, transcriptViewEnd \+ TRANSCRIPT_WINDOW_GROW\);/);
});

test("a spacer in the viewport is replaced by its rows even when the history is unchanged", () => {
  const repair = functionBody(renderer, "function scheduleTranscriptViewportRepair()");
  assert.match(repair, /transcriptViewportRepairFrame/);
  assert.match(repair, /fillTranscriptViewport\(\)/);
  // The repair used to act only when no row at all was visible, so one row over a screen
  // of spacer - the "91 new" report - stayed blank until the next wheel tick.
  const fill = functionBody(renderer, "function fillTranscriptViewport()");
  assert.match(fill, /state\.windowMode !== "full"/);
  assert.match(fill, /const newer = transcriptViewEnd < state\.currentMessages\.length && spacer\(root\.lastElementChild\);/);
  assert.match(fill, /const older = transcriptViewStart > 0 && spacer\(root\.firstElementChild\);/);
  assert.match(fill, /if \(!rows\.some\(node => shows\(node\)\)\) maybeGrowTranscriptWindow\(true\);\s*\n\s*else if \(newer\) growTranscriptWindowDown\(\);\s*\n\s*else growTranscriptWindowUp\(transcriptFollowing\(\)\);/);
  // Bounded: a full window that still cannot cover the viewport stops instead of trading
  // rows between its edges every frame, and so does a pass that changed nothing.
  assert.match(fill, /for \(let pass = 0; pass < 8; pass \+= 1\)/);
  assert.match(fill, /transcriptViewEnd - transcriptViewStart >= TRANSCRIPT_WINDOW_MAX\) \{\s*\n\s*transcriptFillStall = before;/);
  assert.match(fill, /if \(geometry\(\) === before\) \{\s*\n\s*transcriptFillStall = before;/);
  const render = functionBody(renderer, "function renderMessages(messages)");
  assert.match(render, /if \(unchanged\) \{\s*scheduleTranscriptViewportRepair\(\);/);
  assert.match(render, /reconcileChildren\(root, nodes\);\s*\n\s*observeTranscriptRows\(nodes\);/);
  // Rows that change height on their own (a tool card folding, markdown, images) reach the
  // fill through their own observer; the log's box observer never hears of them.
  const resized = functionBody(renderer, "function transcriptRowsResized()");
  assert.match(resized, /scheduleTranscriptViewportRepair\(\);/);
  const scroll = renderer.slice(renderer.indexOf('$("#messages").addEventListener("scroll"'), renderer.indexOf('$("#messages").addEventListener("scrollend"'));
  assert.match(scroll, /scheduleTranscriptViewportRepair\(\);/);
});

test("only a hand scrolling up stops following the conversation", () => {
  // A short window - reasoning renders nothing and tool runs fold into one row - put the top
  // edge in reach of every scroll at the foot, and growing up dropped the follow flag.
  const grow = functionBody(renderer, "function maybeGrowTranscriptWindow(repairBlankViewport = false)");
  assert.match(grow, /const towardsOlder = !transcriptFollowing\(\) && first\.top > viewport\.top - TRANSCRIPT_TOP_LOAD_PX/);
  // A long streaming answer below the newest row is real content, not a spacer to seek out of.
  assert.match(grow, /if \(\(first\.top > viewport\.bottom && transcriptViewStart > 0\) \|\| \(last\.bottom < viewport\.top && transcriptViewEnd < total\)\) \{/);
  // Arrivals reach a reader at the foot of the newest message whatever lowered the flag.
  const windowBody = functionBody(renderer, "function transcriptWindow(total)");
  assert.match(windowBody, /if \(!state\.messagesStickToBottom && transcriptReaderAtFoot\(\$\("#messages"\)\)\) \{/);
  assert.match(functionBody(renderer, "function renderMessages(messages)"), /wasPinned \|\|= view\.recovered \|\| view\.refollowed;/);
  assert.match(functionBody(renderer, "function paintLiveAssistant()"), /const wasPinned = transcriptAtLatest\(\) && \(state\.messagesStickToBottom \|\| transcriptReaderAtFoot\(root\)\);/);
  // The jump glide lands on the newest message even if the foot moved during the flight.
  const finish = functionBody(renderer, "function finishScrollLatestAutoScroll()");
  assert.match(finish, /if \(state\.messagesStickToBottom && transcriptAtLatest\(\) && !messagesNearBottom\(root\)\) settleTranscriptScroll\(root, root\.scrollHeight\);/);
  // A scrollbar press never delivers pointerup.
  assert.match(renderer, /window\.addEventListener\("pointermove", event => \{ if \(!event\.buttons\) transcriptUserPointerActive = false; \}/);
});

test("a drag interrupted by a mode change, a reload or a hidden element still ends", () => {
  // The element a drag started on is display:none the moment the mode changes, and a hidden
  // element delivers neither pointerup nor pointercancel. A stranded full origin silently
  // stopped Full from recording its position for the rest of the session; a stranded compact
  // one froze the orb's size and left its whole window eating clicks.
  assert.match(main, /function releaseDragOrigins\(\) \{ compactDragOrigin = null; fullDragOrigin = null; compactGlide\.stop\(\); \}/);
  assert.match(main, /if \(nextMode !== windowMode\) releaseDragOrigins\(\);/);
  assert.match(main, /on\("did-finish-load", \(\) => \{ releaseDragOrigins\(\); rendererRecovery\.loaded\(\); \}\)/);
  assert.match(renderer, /for \(const eventName of \["pointerup", "pointercancel"\]\) \{\s*\n\s*window\.addEventListener\(eventName, \(event\) => \{\s*\n\s*if \(compactDrag\) endCompactDrag\(event\);\s*\n\s*if \(fullDrag\) endFullDrag\(event\);/);
});

test("the avatar's click rectangles follow its dock side and its settled layout", () => {
  // A side flip moves every orb control ~44px inside the window and republished nothing,
  // so the visible circle forwarded its clicks to the desktop after being dragged across.
  const side = functionBody(renderer, "function applyCompactSide(side)");
  assert.match(side, /schedulePublishCompactHitAreas\(\);/);
  const schedule = functionBody(renderer, "function schedulePublishCompactHitAreas()");
  assert.match(schedule, /requestAnimationFrame\(publishCompactHitAreas\);/);
  // Measured again once the entry animation has settled, not only on its first frame.
  assert.match(schedule, /MODE_ENTER_DURATION \+ 40/);
});

test("the avatar's click rectangles are measured again once its panel has finished growing", () => {
  // The recent-replies panel eases from a 64px card to 142px. Measured mid-move, the rows
  // outside the half-grown panel forwarded their clicks to the desktop: Quick reply on the
  // first row did nothing.
  assert.match(renderer, /for \(const eventName of \["transitionend", "animationend"\]\) \{\s*\n\s*\$\("#orbMode"\)\.addEventListener\(eventName, \(\) => \{\s*\n\s*if \(state\.windowMode === "orb"\) publishCompactHitAreas\(\);/);
  const sync = functionBody(renderer, "function syncCompactStatus()");
  assert.match(sync, /publishCompactHitAreas\(\);\s*\n(?:\s*\/\/[^\n]*\n)*\s*schedulePublishCompactHitAreas\(\);/);
});

test("the avatar's mood is not held hostage by old failures", () => {
  const apply = functionBody(renderer, "function applyWindowMode(mode)");
  // Opening the widget acknowledges every pending failure, not only the selected chat's.
  assert.match(apply, /for \(const sessionId of \[\.\.\.state\.unacknowledgedErrorSessionIds\]\) acknowledgeSessionError\(sessionId\);/);
  // A chat working right now outranks an older failure when the widget collapses.
  assert.match(apply, /state\.compactErrorUnread && !state\.harnessOffline && !state\.runningSessionIds\.has\(state\.selectedSessionId\)/);
  // The first poll raises only recent failures.
  const detect = functionBody(renderer, "function detectCompletedSessions(nextSessions)");
  assert.match(detect, /const recent = Date\.now\(\) - STARTUP_ERROR_RECENT_MS;/);
  assert.match(detect, /timestamp\(session\.replyAt \?\? session\.updatedAt\) >= recent\) signalSessionError\(session\)/);
});

test("folds and unfolds aim at the compact handle and animate the clip or a transform, not an inheriting property", () => {
  const motion = readSource("src", "renderer", "motion.css");
  assert.match(html, /<link rel="stylesheet" href="motion\.css" \/>/);
  assert.match(html, /<div class="mode-morph-rim" aria-hidden="true"><\/div>\s*<\/main>/);
  // An inheriting registered property restyles the whole transcript on every frame.
  assert.match(motion, /@property --morph-r \{ syntax:"<length>"; inherits:false;/);
  assert.match(motion, /@keyframes mode-fold-orb \{[\s\S]*?clip-path:circle\(/);
  assert.match(motion, /@keyframes mode-bloom-full \{[\s\S]*?clip-path:circle\(/);
  // The widget shrinks into where it goes and grows back out, the way a Mac window does,
  // instead of being wiped by a mask: a scale toward the avatar, and toward the edge.
  assert.match(motion, /@keyframes mode-fold-orb \{[\s\S]*?transform:scale\(\.16\)/);
  assert.match(motion, /@keyframes mode-bloom-full \{[\s\S]*?transform:scale\(\.16\)/);
  assert.match(motion, /@keyframes mode-retract-edge \{[\s\S]*?transform:scale\(\.02,\.2\)/);
  assert.match(motion, /@keyframes mode-unfurl-edge \{[\s\S]*?transform:scale\(\.02,\.2\)/);
  // Opening springs; the spring is a linear() curve, so it costs nothing per frame.
  assert.match(motion, /--morph-spring: linear\(/);
  assert.doesNotMatch(motion, /@keyframes mode-(?:fold|bloom|retract|unfurl)[^{]*\{[^@]*filter:/);
  const exit = functionBody(renderer, "function animateModeExit(targetMode, requestSequence)");
  assert.match(exit, /if \(!folding\) rememberCompactAnchor\(\);/);
  assert.match(exit, /const exitDuration = folding \? MODE_FOLD_DURATION : MODE_EXIT_DURATION;/);
  assert.match(renderer, /if \(unfolding && previousMode === "orb"\) followModeMorphOrigin\(compactAnchors\.orb\);/);
});

test("the release snap flies to the edge, with the side applied first", () => {
  const snap = main.slice(main.indexOf("function snapCurrentCompactWindow("), main.indexOf("function applyWindowMode("));
  const sideAt = snap.indexOf('sendToRenderer("compact-side"');
  const glideAt = snap.indexOf("compactGlide.glide(");
  assert.ok(sideAt > 0 && glideAt > 0, "both the side and the flight are in the snap");
  assert.ok(sideAt < glideAt, "the side goes before the flight");
  assert.doesNotMatch(snap, /setPlatformBounds\(windowRef, \{ x: snapped\.x/, "no single-frame teleport");
  // A new drag must not fight a flight in progress.
  assert.match(main, /setCompactDragOrigin: \(value\) => \{ if \(value\) compactGlide\.stop\(false\); compactDragOrigin = value; \}/);
});

test("mode transitions keep their fade across the IPC and honour the motion switch", () => {
  const exit = functionBody(renderer, "function animateModeExit(targetMode, requestSequence)");
  const exitTimer = exit.slice(exit.indexOf("setTimeout(() => {"), exit.indexOf("}, exitDuration);"));
  assert.ok(exitTimer.length > 0, "the exit timer is found");
  assert.doesNotMatch(exitTimer, /clearModeTransitionClasses/, "the timer must not clear the fade before the window changes");
  const set = functionBody(renderer, "async function setWindowMode(mode, options)");
  assert.match(set, /\} finally \{[\s\S]*clearModeTransitionClasses\("out"\);/);
  const authoritative = functionBody(renderer, "function applyAuthoritativeWindowMode(mode)");
  assert.match(authoritative, /if \(mode !== state\.windowMode\) \{\s*\n\s*modeRequestSequence \+= 1;/);
  assert.match(renderer, /return Boolean\(window\.matchMedia\?\.\("\(prefers-reduced-motion: reduce\)"\)\.matches\)\s*\n\s*\|\| document\.body\.classList\.contains\("motion-off"\);/);
  // Entrances do not pile up while motion is off and replay when it comes back.
  const entry = functionBody(renderer, "function markTranscriptEntry(node)");
  assert.match(entry, /if \(prefersReducedMotion\(\)\) return;/);
  assert.match(entry, /timer = setTimeout\(settle, TRANSCRIPT_ENTER_FALLBACK_MS\);/);
});

test("the transcript commits its signature only once the DOM matches it", () => {
  const render = functionBody(renderer, "function renderMessages(messages)");
  assert.ok(render.indexOf('state.historySignature = "";') < render.indexOf("reconcileChildren(root, nodes);"));
  assert.ok(render.indexOf("reconcileChildren(root, nodes);") < render.indexOf("state.historySignature = signature;"));
  assert.doesNotMatch(render, /const window = /, "the global window must not be shadowed");
  // The foot of a spacer is not the foot of the conversation.
  assert.match(render, /\} else if \(wasPinned && view\.latest\) \{/);
});

test("the jump-to-latest pill counts only what actually arrived", () => {
  assert.match(renderer, /function transcriptArrivedCount\(\)/);
  const pill = functionBody(renderer, "function updateScrollLatestButton()");
  assert.match(pill, /const label = arrived > 1\s*\n\s*\? `\$\{arrived\} new`/);
  // Reaching the newest message is not reading it: rows filled in below a reader stay new
  // until they have been on screen.
  assert.match(renderer, /if \(end === total && state\.messagesStickToBottom\) transcriptSeenTotal = total;/);
  assert.match(functionBody(renderer, "function transcriptArrivedCount()"), /return Math\.max\(0, state\.currentMessages\.length - transcriptSeenTotal\);/);
  assert.match(functionBody(renderer, "function noteTranscriptSeen(root)"), /const seen = low < rows\.length \? Number\(rows\[low\]\.dataset\.vmsg\) : transcriptViewEnd;/);
});

test("per-session bookkeeping is released when a session leaves a healthy dashboard", () => {
  const sweep = functionBody(renderer, "function detectCompletedSessions(nextSessions)");
  for (const name of ["queuedPromptsBySession", "steeringPromptsBySession", "queueSnapshotRevisions", "queueHandoffEpochs", "queueRecoveryGenerations", "liveSessionRevisions", "turnGenerationsBySession", "commandFeedbackBySession", "todoExpandedSessionIds", "cancelPendingSessionIds"]) {
    assert.match(sweep, new RegExp(`state\.${name}`), `${name} is swept`);
  }
  assert.match(sweep, /const keep = \(sessionId\) => existing\.has\(sessionId\) \|\| sessionId === state\.selectedSessionId;/);
  // Drafts and live streams are the user's text and a just-created session's output.
  assert.doesNotMatch(sweep, /composerDraftsBySession|liveStreamsBySession/);
});

test("the version badge stays legible at every width", () => {
  const css = readSource("src", "renderer", "styles.css");
  const sizes = [...css.matchAll(/\.version-badge \{[^}]*font-size:([\d.]+)px/g)].map((match) => Number(match[1]));
  assert.ok(sizes.length >= 3, "the base rule and both narrow overrides set a size");
  assert.ok(sizes.every((size) => size >= 7.5), `every badge size is readable: ${sizes.join(", ")}`);
  assert.match(css, /\.version-badge \{[^}]*font-variant-numeric:tabular-nums/);
});

test("the main process survives a stray throw", () => {
  assert.match(main, /require\("\.\/process-guards\.cjs"\)/);
  assert.match(main, /\ninstallProcessGuards\(\);\n/);
});

test("the main process reaps launcher children, gates the legacy socket, and bounds its caches", () => {
  const cleanup = functionBody(main, "function cleanupApplication()");
  // Probe and failed launches leave npx/node trees behind unless the launcher reaps them.
  assert.match(cleanup, /harnessLauncher\?\.dispose\(\);/);
  // A gated Harness can never authenticate the legacy mux, which then retried forever.
  assert.match(main, /shouldConnect: async \(\) => \(await api\.detectGeneration\(\)\) === "legacy",/);
  // Per-session API caches follow the dashboard, keeping the open chat.
  assert.match(main, /api\.retainSessions\(\[\.\.\.sessionIds, preferences\.lastSelectedSessionId\]\.filter\(Boolean\)\);/);
  // Only a saved URL for this Harness is a way into it.
  assert.match(ipc, /if \(persisted && isSameHarnessOrigin\(persisted, harnessUrl\)\) return persisted;/);
});

test("a refused Harness restart says what to do next", () => {
  const failure = functionBody(renderer, "function harnessRestartFailure(result)");
  for (const reason of ["remote-url", "restart-unsupported", "restart-failed", "disposed"]) {
    assert.match(failure, new RegExp(`case "${reason}":`));
  }
  assert.match(failure, /result\.blockedBy/);
  assert.match(renderer, /if \(!result\?\.ok\) throw new Error\(harnessRestartFailure\(result\)\);/);
});

test("a crashed owned Harness says why it is offline and offers Restart now and Open log", () => {
  assert.match(html, /id="harnessOpenLogButton"[^>]*hidden>Open log<\/button>/);
  const banner = functionBody(renderer, "function harnessCrashBanner()");
  assert.match(banner, /`Harness keeps crashing\$\{exit\}`, action: "Restart"/);
  assert.match(banner, /`Harness stopped unexpectedly\$\{exit\} — restarting in \$\{seconds\}s…`, action: "Restart now"/);
  assert.match(banner, /`Harness stopped unexpectedly\$\{exit\} — restarting…`, action: "Restarting…", busy: true/);
  const render = functionBody(renderer, "function renderOfflineBanner()");
  // Only ever an explanation of "offline", never a banner of its own over a working Harness.
  assert.match(render, /const crash = state\.harnessOffline \? harnessCrashBanner\(\) : null;/);
  assert.match(render, /openLogButton\.hidden = !crash && !state\.harnessStartError;/);
  // One dot says which kind of offline it is: busy while a restart is under way, red for a
  // crash or a failed start, amber for plainly down.
  assert.match(render, /banner\.dataset\.tone = state\.harnessStarting \|\| state\.harnessDegraded \|\| crash\?\.busy \? "busy"/);
  const bannerCss = readSource("src", "renderer", "styles.css");
  assert.match(bannerCss, /\.offline-banner\[data-tone="error"\] \{ --banner-tone:var\(--danger\); \}/);
  // The sentence keeps its natural width so a long one pushes the actions onto their own row,
  // the dot hangs beside its first line, and a short window cannot squeeze the card shut.
  assert.match(bannerCss, /\.offline-banner \{[^}]*flex:none;[^}]*padding:6px 6px 6px 28px;/);
  assert.match(bannerCss, /#offlineBannerText \{ position:relative; min-width:0; flex:1 1 auto;/);
  assert.match(bannerCss, /#offlineBannerText::before \{[^}]*position:absolute;[^}]*left:-18px;/);
  assert.match(readSource("scripts", "ui-visual-smoke.cjs"), /name: "harness-crash-360", tab: "chat", fixture: "harness-crash", width: 360, height: 360/);
  assert.match(functionBody(renderer, "async function startHarnessFromBanner()"), /if \(state\.harnessOffline && harnessCrashBanner\(\)\) \{\s+await restartHarnessNowFromBanner\(\);/);
  assert.match(renderer, /await window\.widget\.restartHarnessNow\(\)/);
  assert.match(renderer, /window\.widget\.openHarnessLog\(\)/);
  assert.match(renderer, /window\.widget\.onHarnessSupervisorState\(applyHarnessSupervisorState\);/);
  assert.match(renderer, /window\.widget\.getHarnessSupervisorState\(\)\.then\(applyHarnessSupervisorState\)/);
  const preload = readSource("src", "preload.cjs");
  assert.match(preload, /getHarnessSupervisorState: \(\) => ipcRenderer\.invoke\("get-harness-supervisor-state"\)/);
  assert.match(preload, /restartHarnessNow: \(\) => ipcRenderer\.invoke\("restart-harness-now"\)/);
  assert.match(preload, /openHarnessLog: \(\) => ipcRenderer\.invoke\("open-harness-log"\)/);
  // The push channel main sends on must be the one the preload listens to.
  assert.match(preload, /onHarnessSupervisorState: \(listener\) => ipcRenderer\.on\("harness-supervisor-state"/);
  assert.match(main, /onState: \(value\) => sendToRenderer\("harness-supervisor-state", value\)/);
  assert.match(main, /harnessSupervisor\?\.dispose\(\);\n  harnessLauncher\?\.dispose\(\);/);
  assert.match(ipc, /handle\("open-harness-log", \(\) => getHarnessSupervisor\(\)\?\.openLog\(\)/);
});

test("a model engine crash reads as the engine's, with Retry, compaction and the original kept", () => {
  assert.match(html, /<script src="engine-crash\.js"><\/script>\s*<script src="appearance\.js"><\/script>\s*<script src="app\.js"><\/script>/);
  const bubble = functionBody(renderer, "function createMessageBubble(message, bubble = document.createElement(\"div\"))");
  assert.match(bubble, /const engineCrash = message\.role === "error" \? describeSelectedEngineCrash\(message\.text\) : null;/);
  const card = functionBody(renderer, "function createEngineCrashBubble(message, bubble, crash)");
  assert.match(card, /retry\.textContent = state\.continuedCutoffs\.has\(retryKey\) \? "Retry sent" : "Retry";/);
  assert.match(card, /text: window\.engineCrash\.RETRY_PROMPT/);
  assert.match(card, /if \(crash\.compactSuggested && sessionId\)/);
  assert.match(card, /executeHarnessCommand\("\/compact", sessionId\)/);
  assert.match(card, /detailsSummary\.textContent = "Provider message";\s+original\.textContent = crash\.original;/);
  assert.match(functionBody(renderer, "function describeSelectedEngineCrash(text)"), /contextUsed: pressure\?\.used, contextWindow: pressure\?\.total/);
  assert.match(functionBody(renderer, "function showComposerError(error, label)"), /describeSelectedEngineCrash\(original\)/);
});

test("the visual runner forgives one flaky frame, loudly, and never a repeatable failure", () => {
  const runner = readSource("scripts", "ui-visual-smoke.cjs");
  // A case is booted and photographed on a timer, so a loaded machine can capture it before
  // its first paint. One failure used to abort the run and silently skip every later case.
  assert.match(runner, /async function verifyCase\(testCase\)/);
  assert.match(runner, /retried after: /);
  assert.match(runner, /Passed on a second attempt: /);
  // The second failure is the one that is thrown, with the first one attached.
  assert.ok(runner.includes("secondError.message = `${secondError.message}\\n(first attempt: "), "the second failure carries the first");
  // And a strict run can refuse the second chance entirely.
  assert.match(runner, /const SMOKE_RETRIES = process\.env\.UI_SMOKE_RETRIES === "0" \? 0 : 1;/);
});

test("the README cover names the release it was rendered from", () => {
  // The eyebrow was typed into the HTML, nothing checked it, and it said 0.7.2 through two
  // later releases. The renderer fills it from package.json instead.
  const coverSource = readSource("docs", "cover-source.html");
  const coverRenderer = readSource("scripts", "render-readme-cover.cjs");
  assert.match(coverSource, /<span data-release-version>/);
  assert.doesNotMatch(coverSource, /Agent Deck · \d+\.\d+\.\d+/);
  assert.match(coverRenderer, /const \{ version \} = require\(path\.join\(root, "package\.json"\)\);/);
  assert.match(coverRenderer, /querySelectorAll\("\[data-release-version\]"\)/);
});

test("visual cases write their output to a file, never through a pipe", () => {
  // With stdout and stderr piped, a captured case on Windows intermittently stayed alive
  // after app.quit() and sat out the whole timeout; the same output to a file never did.
  const runner = readSource("scripts", "ui-visual-smoke.cjs");
  assert.match(runner, /const logFd = openSync\(logPath, "w"\);/);
  assert.match(runner, /stdio: \["ignore", logFd, logFd\],/);
  assert.match(runner, /closeSync\(logFd\);/);
  assert.doesNotMatch(runner, /stdio: \["ignore", "pipe", "pipe"\]/);
  assert.doesNotMatch(runner, /child\.stdout\.on\("data"/);
});

test("the two top efforts move only cheap properties, hold still without motion and burst once", () => {
  const appearance = readSource("src", "renderer", "appearance.css");
  // Every effort keyframe moves a background, an opacity or a transform: no filter, no
  // shadow, no size or position that would repaint the menu or lay anything out again.
  const frames = [...appearance.matchAll(/@keyframes (reasoning-[\w-]+) \{((?:\s*[^{}]+\{[^}]*\})+)\s*\}/g)];
  assert.ok(frames.length >= 10, "the effort keyframes are found");
  for (const [, name, body] of frames) {
    const properties = [...body.matchAll(/([\w-]+)\s*:/g)].map((match) => match[1]);
    for (const property of properties) assert.ok(["background-position", "opacity", "transform"].includes(property), `${name} animates ${property}`);
  }
  for (const name of ["reasoning-tide", "reasoning-sheen", "reasoning-breathe", "reasoning-current", "reasoning-sweep", "reasoning-spark", "reasoning-rim", "reasoning-badge-flow", "reasoning-burst"]) {
    assert.ok(frames.some(([, frameName]) => frameName === name), `${name} exists`);
  }
  // Sparks belong to the top effort alone, and on the chip they never cross the text line.
  assert.match(appearance, /\.reasoning-track\[data-intensity="peak"\] \.reasoning-starfield i,#reasoningButton\[data-intensity="peak"\] > \.reasoning-starfield i \{ display:block; animation:reasoning-spark/);
  // Still means still: with reduced motion every effort layer drops its animation.
  assert.match(appearance, /@media\(prefers-reduced-motion:reduce\) \{\s*\.reasoning-fill::before,[^{]*\.reasoning-starfield i,[^{]*\{ animation:none !important; \}/);
  assert.match(appearance, /body\.motion-off \.reasoning-starfield i \{ opacity:\.7;/);
  // The burst is a single moment: entering the top level, never a re-render of it, never
  // with motion off; a menu rebuilt mid-burst carries it on rather than replaying it.
  assert.match(renderer, /function playEffortBurst\(node, startedAt = performance\.now\(\)\) \{\s+if \(prefersReducedMotion\(\) \|\| performance\.now\(\) - startedAt >= EFFORT_BURST_MS\) return;/);
  assert.match(renderer, /if \(intensity === "peak" && previousIntensity !== "peak"\) \{\s+if \(previousIntensity\) effortTrackBurstAt = performance\.now\(\);\s+playEffortBurst\(track, effortTrackBurstAt\);/);
  assert.match(renderer, /if \(!wasPeak && \$\("#reasoningButton"\)\.dataset\.intensity === "peak"\) playEffortBurst\(\$\("#reasoningButton"\)\);/);
  assert.match(appearance, /\.reasoning-track\.effort-burst::after \{[^}]*animation:reasoning-burst \.76s[^;]*var\(--burst-delay,0ms\) both;/);
  assert.match(renderer, /const EFFORT_BURST_MS = 760;/);
});
