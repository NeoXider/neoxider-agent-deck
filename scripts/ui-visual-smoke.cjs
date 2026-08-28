const { spawn } = require("node:child_process");
const { mkdirSync, readFileSync, rmSync, statSync } = require("node:fs");
const path = require("node:path");

const electron = require("electron");
const root = path.resolve(__dirname, "..");
const output = path.join(root, "tmp", "ui-smoke");

const cases = [
  { name: "overview", fixture: "overview", expect: { agentWorking: 1, agentIdle: 1, agentError: 1 } },
  { name: "overview-360", fixture: "overview", width: 420, height: 360, expect: { agentWorking: 1, agentIdle: 1, agentError: 1, titlebarOverlap: false } },
  { name: "workspace-groups", tab: "agents", fixture: "workspace-groups", width: 360, height: 500, expect: { sessionGroups: 2, sessionPickerGroups: 2, agentCollapsedSessionGroups: 1, pickerCollapsedSessionGroups: 1, agentSessionGroupAddButtons: 2, pickerSessionGroupAddButtons: 2, sessionGroupHeadersSingleLine: true, uniqueSessionCards: true, uniquePickerSessions: true } },
  { name: "workspace-groups-chat", tab: "chat", fixture: "workspace-groups-chat", width: 360, height: 500, expect: { sessionGroups: 2, sessionPickerGroups: 2, agentCollapsedSessionGroups: 0, pickerCollapsedSessionGroups: 0, agentSessionGroupAddButtons: 2, pickerSessionGroupAddButtons: 2, sessionGroupHeadersSingleLine: true, uniqueSessionCards: true, uniquePickerSessions: true } },
  { name: "offline", tab: "chat", fixture: "offline", expect: { offlineBanners: 1, startHarnessButtons: 1, startHarnessText: "Start", startHarnessButtonVisible: true, startHarnessButtonDisabled: false, startHarnessTextPainted: true, headerStateText: "", contextUnavailable: true }, min: { composerTextareaWidth: 220, startHarnessTextWidth: 18, startHarnessBrightPixels: 20 } },
  { name: "empty-chat", tab: "chat", fixture: "empty-chat", width: 380, height: 400, expect: { contextUnavailable: true, contextValue: "0%", contextVisible: true, conversationBubbles: 0, titlebarOverlap: false } },
  { name: "offline-agents", tab: "agents", fixture: "offline-agents", expect: { offlineBanners: 1, startHarnessButtons: 1, startHarnessText: "Start", startHarnessButtonVisible: true, startHarnessButtonDisabled: false, startHarnessTextPainted: true, headerStateText: "", offlineSessionText: "Start Harness to load sessions." }, min: { startHarnessTextWidth: 18, startHarnessBrightPixels: 20 } },
  { name: "focus-offline", tab: "chat", fixture: "focus-offline", width: 360, height: 500, expect: { offlineBanners: 1, startHarnessButtons: 1, startHarnessText: "Start", startHarnessButtonVisible: true, startHarnessButtonDisabled: false, startHarnessTextPainted: true, headerStateText: "", focusMode: false }, min: { startHarnessTextWidth: 18, startHarnessBrightPixels: 20 } },
  { name: "chat", tab: "chat", fixture: "chat", expect: { composerRestingHeight: 44, historicalReasoning: 0, markdownLists: 1, footer: 0, titlebarTabs: 1, titlebarOverlap: false, setupInToolbar: true, brandUserSelect: "none", titlebarNativeDragDisabled: true, avatarHitWidth: 44, avatarHitHeight: 44, avatarPlateTransparent: true, avatarAuraCircular: true, avatarAuraContained: true, avatarAuraRadial: true, composerUtilitiesStacked: true, composerViewStacked: true, contextRingSize: 15, sendWidth: 36, sendHeight: 36, sendUtilityCenterDelta: 0, contextCenterDelta: 0 } },
  { name: "focus-chat", tab: "chat", fixture: "focus-chat", width: 360, height: 500, expect: { focusMode: true, focusChromeHidden: true, historicalReasoning: 0, composerUtilitiesStacked: true, composerViewStacked: true, contextRingSize: 15, sendWidth: 36, sendHeight: 36, sendUtilityCenterDelta: 0, contextCenterDelta: 0 } },
  { name: "commands", tab: "chat", fixture: "commands", expect: { commandRows: 6, commandAboveComposer: true, commandFitsWidth: true }, layout: { commandVisibleRows: 4 } },
  { name: "commands-360", tab: "chat", fixture: "commands", width: 360, height: 360, expect: { commandRows: 6, firstFourCommands: "/goal,/compact,/plan,/permission", commandAboveComposer: true, commandFitsWidth: true, titlebarOverlap: false }, layout: { commandVisibleRows: 4 } },
  { name: "focus-commands", tab: "chat", fixture: "focus-commands", width: 360, height: 500, expect: { focusMode: true, focusChromeHidden: true, commandRows: 6, commandAboveComposer: true, commandFitsWidth: true }, layout: { commandVisibleRows: 3 } },
  { name: "todo-360", tab: "chat", fixture: "todo", width: 360, height: 360, expect: { todoRows: 3, todoExpanded: true, todoAboveComposer: true, conversationBubbles: 1, shortMessageVisible: true, titlebarOverlap: false } },
  { name: "goal-result-360", tab: "chat", fixture: "goal-result", width: 360, height: 360, expect: { goalResultCards: 1, conversationBubbles: 2, titlebarOverlap: false } },
  { name: "queued-message", tab: "chat", fixture: "queued-message", width: 360, height: 500, expect: { queueRows: 2, queueActions: 6, queueSingleLine: true, queueAboveComposer: true } },
  { name: "live-stream", tab: "chat", fixture: "live-stream", width: 360, height: 500, expect: { liveBubbles: 1, historicalReasoning: 0 } },
  { name: "scroll-away", tab: "chat", fixture: "scroll-away", width: 360, height: 500, expect: { scrollLatestVisible: true } },
  { name: "glow-settings", tab: "chat", fixture: "glow-settings", expect: { glowControl: 1, glowIntensity: "0.82", showThinkingChecked: true, windowLayerOptions: 3, autoStartHydrated: true } },
  { name: "update-ready", tab: "chat", fixture: "update-ready", width: 420, height: 640, expect: { settingsOpen: true, updateStatus: "v0.6.4 is verified and ready", updateBadgeVisible: true, updateInstallVisible: true, headerUpdateVisible: true, headerProductVisible: true, headerVersionVisible: true, headerUpdateUnclipped: true, updateProgress: "100" } },
  { name: "update-ready-360", tab: "chat", fixture: "update-ready", width: 360, height: 360, expect: { settingsOpen: true, updateStatus: "v0.6.4 is verified and ready", updateBadgeVisible: true, updateInstallVisible: true, headerUpdateVisible: true, headerProductVisible: true, headerVersionVisible: true, headerUpdateUnclipped: true, titlebarOverlap: false, updateProgress: "100" } },
  { name: "managed-update-available", tab: "chat", fixture: "managed-update-available", width: 420, height: 640, expect: { settingsOpen: true, updateStatus: "v0.6.4 is available", updateBadgeVisible: true, updateInstallVisible: false, headerUpdateVisible: false } },
  { name: "hotkey-settings", tab: "chat", fixture: "hotkey-settings", width: 420, height: 640, expect: { settingsOpen: true, hotkeySettingsOpen: true, hotkeyRows: 8 } },
  { name: "capture-menu", tab: "chat", fixture: "capture-menu", expect: { captureMenuOpen: true, captureRows: 2 } },
  { name: "model", tab: "chat", fixture: "model", expect: { modelControlLabel: "MODEL", modelControlText: "LM Studio · Qwen 3.5 9B" }, layout: { modelVisibleRows: 6 } },
  { name: "model-360", tab: "chat", fixture: "model", width: 360, height: 360, expect: { modelControlLabel: "MODEL", modelControlText: "LM Studio · Qwen 3.5 9B", titlebarOverlap: false, compactModelOverlay: true, selectedModelVisible: true, modelComposerUnobscured: true }, min: { visibleModelRows: 3 }, layout: { compactModelVisibleRows: 6 } },
  { name: "model-380", tab: "chat", fixture: "model", width: 380, height: 400, expect: { modelControlLabel: "MODEL", modelControlText: "LM Studio · Qwen 3.5 9B", titlebarOverlap: false, compactModelOverlay: true, selectedModelVisible: true, modelComposerUnobscured: true }, min: { visibleModelRows: 3 }, layout: { compactModelVisibleRows: 6 } },
  { name: "model-closed", tab: "chat", fixture: "model-closed", expect: { closedModelLabel: "Qwen 3.5 9B", closedModelVisible: true, closedModelUnclipped: true } },
  { name: "compact-model-closed", tab: "chat", fixture: "model-closed", width: 360, height: 500, expect: { closedModelLabel: "Qwen 3.5 9B", closedModelVisible: true, closedModelUnclipped: true } },
  { name: "model-empty", tab: "chat", fixture: "model-empty", expect: { modelControlLabel: "MODEL", modelControlText: "No models loaded", modelPickerActions: 2 } },
  { name: "model-error", tab: "chat", fixture: "model-error", expect: { modelSetupCards: 1, modelSetupActions: 2, closedModelLabel: "No model", closedModelVisible: true } },
  { name: "attachments", tab: "chat", fixture: "attachments", expect: { attachmentChips: 3, attachmentImages: 2, attachmentVideoThumbnails: 1, attachmentFallbackIcons: 1, sentAttachmentChips: 3, sentAttachmentImages: 1, attachmentOnlyBubbles: 1, sentAttachmentsWithinBubbles: true, attachmentRemoveActions: 3, attachmentAccessibleGroups: 3, attachmentHorizontalScroll: true, attachmentListWithinBar: true, attachmentsAboveComposer: true, composerUtilitiesStacked: true }, min: { attachmentPreviewMinWidth: 44, attachmentPreviewMinHeight: 40 }, max: { attachmentBarHeight: 56, sentAttachmentMaxWidth: 116 } },
  { name: "compact-attachments", tab: "chat", fixture: "attachments", width: 360, height: 500, expect: { attachmentChips: 3, attachmentImages: 2, attachmentVideoThumbnails: 1, attachmentFallbackIcons: 1, sentAttachmentChips: 3, sentAttachmentImages: 1, attachmentOnlyBubbles: 1, sentAttachmentsWithinBubbles: true, attachmentRemoveActions: 3, attachmentAccessibleGroups: 3, attachmentHorizontalScroll: true, attachmentListWithinBar: true, attachmentsAboveComposer: true, composerUtilitiesStacked: true }, min: { attachmentPreviewMinWidth: 44, attachmentPreviewMinHeight: 40 }, max: { attachmentBarHeight: 56, sentAttachmentMaxWidth: 104 } },
  { name: "attachments-360", tab: "chat", fixture: "attachments", width: 360, height: 360, expect: { attachmentChips: 3, attachmentImages: 2, attachmentVideoThumbnails: 1, attachmentFallbackIcons: 1, sentAttachmentChips: 3, sentAttachmentImages: 1, attachmentOnlyBubbles: 1, sentAttachmentsWithinBubbles: true, attachmentRemoveActions: 3, attachmentAccessibleGroups: 3, attachmentHorizontalScroll: true, attachmentListWithinBar: true, attachmentsAboveComposer: true, composerUtilitiesStacked: true, titlebarOverlap: false }, min: { attachmentPreviewMinWidth: 44, attachmentPreviewMinHeight: 40, attachmentMessageSpace: 100 }, max: { attachmentBarHeight: 56, sentAttachmentMaxWidth: 104 } },
  { name: "markdown-tools", tab: "chat", fixture: "markdown-tools", expect: { toolGroups: 1, toolCalls: 2, historicalReasoning: 0 } },
  { name: "thinking-chat", tab: "chat", fixture: "thinking", expect: { activityCardVisible: true, showThinkingChecked: true, thinkingOverMessages: true } },
  { name: "thinking-hidden", tab: "chat", fixture: "thinking-hidden", expect: { activityCardVisible: false, showThinkingChecked: false } },
  { name: "writing-chat", tab: "chat", fixture: "writing", expect: { liveBubbles: 1, liveCaretDisplay: "inline-block" } },
  { name: "tool-chat", tab: "chat", fixture: "tool" },
  { name: "completion-chat", tab: "chat", fixture: "completion-chat", expect: { completionCelebration: true, fullSuccessGlowVisible: true } },
  { name: "compact-chat", tab: "chat", fixture: "chat", width: 360, height: 500, expect: { historicalReasoning: 0, footer: 0, titlebarTabs: 1, setupInToolbar: true, composerUtilitiesStacked: true, contextRingSize: 15, sendWidth: 36, sendHeight: 36 } },
  { name: "compact-tools", tab: "chat", fixture: "markdown-tools", width: 360, height: 500, expect: { toolGroups: 1, toolCalls: 2 } },
  { name: "mixed-tools-360", tab: "chat", fixture: "mixed-tools", width: 360, height: 360, expect: { toolGroups: 1, toolCalls: 2, partialToolGroups: 1, conversationBubbles: 1, titlebarOverlap: false } },
  { name: "composer-single-line", tab: "chat", fixture: "composer-single-line", width: 380, height: 400, expect: { composerInputHeight: 34, composerUtilityHeight: 36, composerInputScrollable: false, conversationBubbles: 1, shortMessageVisible: true }, max: { composerHeight: 46 } },
  { name: "composer-multiline-max", tab: "chat", fixture: "composer-multiline", width: 380, height: 400, expect: { composerInputScrollable: true, conversationBubbles: 1, shortMessageVisible: true }, layout: { composerFullLines: 8 } },
  { name: "small-chat-400", tab: "chat", fixture: "small-chat", width: 400, height: 400, expect: { composerInputHeight: 34, composerUtilityHeight: 36, conversationBubbles: 1, shortMessageVisible: true }, max: { composerHeight: 46 } },
  { name: "small-chat-380", tab: "chat", fixture: "small-chat", width: 380, height: 380, expect: { composerInputHeight: 34, composerUtilityHeight: 36, conversationBubbles: 1, shortMessageVisible: true }, max: { composerHeight: 46 } },
  { name: "small-chat-360", tab: "chat", fixture: "small-chat", width: 360, height: 360, expect: { composerInputHeight: 34, composerUtilityHeight: 36, conversationBubbles: 1, shortMessageVisible: true, titlebarOverlap: false, titlebarNativeDragDisabled: true, avatarHitWidth: 38, avatarHitHeight: 38, avatarPlateTransparent: true, avatarAuraCircular: true, avatarAuraContained: true, avatarAuraRadial: true }, max: { composerHeight: 46 } },
  { name: "crowded-chat-400", tab: "chat", fixture: "crowded-chat", width: 400, height: 400, expect: { crowdedChat: true, todoRows: 3, todoExpanded: true, queueRows: 2, attachmentChips: 1, activityCardVisible: true, thinkingOverMessages: true, conversationBubbles: 6, shortMessageVisible: true, messageViewportScrollable: true, crowdedSurfacesWithinPanel: true }, min: { messageViewportHeight: 62 } },
  { name: "crowded-chat-360", tab: "chat", fixture: "crowded-chat", width: 360, height: 360, expect: { crowdedChat: true, todoRows: 3, todoExpanded: true, queueRows: 2, attachmentChips: 1, activityCardVisible: true, thinkingOverMessages: true, conversationBubbles: 6, shortMessageVisible: true, messageViewportScrollable: true, crowdedSurfacesWithinPanel: true, titlebarOverlap: false }, min: { messageViewportHeight: 62 } },
  { name: "thinking-orb", tab: "chat", fixture: "thinking", mode: "orb", expect: { orbUtilityButtons: 1 } },
  { name: "offline-orb", tab: "chat", fixture: "offline", mode: "orb", expect: { orbUtilityButtons: 1, orbStatusLabel: "Harness offline", orbStatusText: "Start Harness to reconnect." } },
  { name: "notification-orb", tab: "chat", fixture: "orb-notification", mode: "orb", expect: { orbUtilityButtons: 1, orbNotification: true, orbStatusShadow: "none", orbReplyShadow: "none" } },
  { name: "notification-orb-black", tab: "chat", fixture: "orb-notification", mode: "orb", backdrop: "black", expect: { orbNotification: true, orbStatusShadow: "none", orbReplyShadow: "none" } },
  { name: "notification-orb-white", tab: "chat", fixture: "orb-notification", mode: "orb", backdrop: "white", expect: { orbNotification: true, orbStatusShadow: "none", orbReplyShadow: "none" } },
  { name: "notification-orb-checkerboard", tab: "chat", fixture: "orb-notification", mode: "orb", backdrop: "checkerboard", expect: { orbNotification: true, orbStatusShadow: "none", orbReplyShadow: "none" } },
  { name: "recent-sessions-orb", tab: "chat", fixture: "orb-recent-three", mode: "orb", expect: { orbRecentRows: 3, orbRecentUniqueSessions: 3, orbHistoryOpen: true, orbQuickReplyOpen: false, orbPanelClipped: false, compactSide: "right" } },
  { name: "recent-sessions-orb-left", tab: "chat", fixture: "orb-recent-three-left", mode: "orb", side: "left", expect: { orbRecentRows: 3, orbRecentUniqueSessions: 3, orbHistoryOpen: true, orbQuickReplyOpen: false, orbPanelClipped: false, compactSide: "left" } },
  { name: "quick-reply-orb", tab: "chat", fixture: "orb-quick-reply", mode: "orb", expect: { orbRecentRows: 3, orbQuickReplyOpen: true, orbReplyTarget: "Build review", orbReplyInputVisible: true, orbPanelClipped: false } },
  { name: "edge", fixture: "edge-idle", mode: "edge", expect: { edgeLineWidth: 8, edgeState: "idle", edgePrimary: "rgb(73, 231, 198)" } },
  { name: "edge-hover", fixture: "edge-hover", mode: "edge", expect: { edgeHitActive: true, edgeLineWidth: 8, edgeState: "idle", edgePrimary: "rgb(73, 231, 198)" } },
  { name: "edge-working", fixture: "edge-working", mode: "edge", expect: { edgeLineWidth: 8, edgeState: "working", edgePrimary: "rgb(114, 239, 160)" } },
  { name: "edge-thinking", fixture: "thinking", mode: "edge", expect: { edgeState: "thinking", edgePrimary: "rgb(155, 140, 255)" } },
  { name: "edge-writing", fixture: "writing", mode: "edge", expect: { edgeState: "writing", edgePrimary: "rgb(114, 239, 160)" } },
  { name: "edge-tool", fixture: "tool", mode: "edge", expect: { edgeState: "tool", edgePrimary: "rgb(168, 140, 255)" } },
  { name: "edge-done", fixture: "edge-done", mode: "edge", expect: { edgeState: "done", edgePrimary: "rgb(255, 227, 110)", completionCelebration: true } },
  { name: "edge-done-cleanup", fixture: "edge-done-cleanup", mode: "edge", delay: 4000, expect: { edgeState: "idle", edgePrimary: "rgb(73, 231, 198)", completionCelebration: false } },
  { name: "edge-error", fixture: "edge-error", mode: "edge", expect: { edgeState: "error", edgePrimary: "rgb(255, 115, 143)", compactErrorUnread: true, completionCelebration: false } },
  { name: "edge-error-ack", fixture: "edge-error-ack", mode: "edge", expect: { edgeState: "idle", edgePrimary: "rgb(73, 231, 198)", compactErrorUnread: false, completionCelebration: false } },
  { name: "edge-error-interrupts-done", fixture: "edge-error-interrupts-done", mode: "edge", expect: { edgeState: "error", edgePrimary: "rgb(255, 115, 143)", compactErrorUnread: true, completionCelebration: false } },
];

function runElectron(testCase) {
  return new Promise((resolve, reject) => {
    const screenshot = path.join(output, `${testCase.name}.png`);
    const audit = path.join(output, `${testCase.name}.json`);
    rmSync(screenshot, { force: true });
    rmSync(audit, { force: true });
    const child = spawn(electron, [root], {
      cwd: root,
      env: {
        ...process.env,
        WIDGET_SCREENSHOT_PATH: screenshot,
        WIDGET_UI_AUDIT_PATH: audit,
        WIDGET_SCREENSHOT_DELAY: String(testCase.delay || 1800),
        ...(testCase.tab ? { WIDGET_SCREENSHOT_TAB: testCase.tab } : {}),
        ...(testCase.fixture ? { WIDGET_SCREENSHOT_FIXTURE: testCase.fixture } : {}),
        ...(testCase.mode ? { WIDGET_SCREENSHOT_MODE: testCase.mode } : {}),
        ...(testCase.side ? { WIDGET_SCREENSHOT_SIDE: testCase.side } : {}),
        ...(testCase.backdrop ? { WIDGET_SCREENSHOT_BACKDROP: testCase.backdrop } : {}),
        ...(testCase.width ? { WIDGET_SCREENSHOT_WIDTH: String(testCase.width) } : {}),
        ...(testCase.height ? { WIDGET_SCREENSHOT_HEIGHT: String(testCase.height) } : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let outputText = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`${testCase.name} exceeded the 20 second UI smoke timeout\n${outputText}`));
    }, 20000);
    child.stdout.on("data", (chunk) => { outputText += chunk; });
    child.stderr.on("data", (chunk) => { outputText += chunk; });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve({ screenshot, audit });
      else reject(new Error(`${testCase.name} exited ${code}\n${outputText}`));
    });
  });
}

function findBox(audit, selector) {
  return audit.boxes.find((box) => box.selector === selector);
}

function assertSnappedLayout(testCase, audit) {
  if (testCase.layout?.compactModelVisibleRows) {
    const menu = findBox(audit, ".picker.open .picker-menu");
    const composer = findBox(audit, ".composer");
    const expectedHeight = 47 + testCase.layout.compactModelVisibleRows * 30;
    if (!menu || Math.abs(menu.height - expectedHeight) > 1) throw new Error(`${testCase.name} expected a ${expectedHeight}px compact model sheet, got ${JSON.stringify(menu)}`);
    if (!composer || menu.bottom > composer.top - 1) throw new Error(`${testCase.name} compact model sheet overlaps the composer: ${JSON.stringify({ menu, composer })}`);
  }
  if (testCase.layout?.composerFullLines) {
    const expectedHeight = testCase.layout.composerFullLines * 15;
    if (Math.abs(audit.semantic.composerInputHeight - expectedHeight) > 1) {
      throw new Error(`${testCase.name} expected ${testCase.layout.composerFullLines} complete composer lines (${expectedHeight}px), got ${audit.semantic.composerInputHeight}px`);
    }
  }
  if (testCase.layout?.commandVisibleRows) {
    const menu = findBox(audit, ".command-menu.open");
    const compactViewport = audit.viewport.height <= 420;
    const expectedHeight = (compactViewport ? 36 : 46) + testCase.layout.commandVisibleRows * (compactViewport ? 34 : 44);
    if (!menu || Math.abs(menu.height - expectedHeight) > 1) {
      throw new Error(`${testCase.name} expected a ${expectedHeight}px command menu ending on ${testCase.layout.commandVisibleRows} full rows, got ${JSON.stringify(menu)}`);
    }
  }
  if (testCase.layout?.modelVisibleRows) {
    const menu = findBox(audit, ".picker.open .picker-menu");
    const composer = findBox(audit, ".composer");
    const expectedHeight = 57 + testCase.layout.modelVisibleRows * 36;
    if (!menu || Math.abs(menu.height - expectedHeight) > 1) {
      throw new Error(`${testCase.name} expected a ${expectedHeight}px model picker ending on ${testCase.layout.modelVisibleRows} full rows, got ${JSON.stringify(menu)}`);
    }
    if (!composer || menu.bottom > composer.top - 1) {
      throw new Error(`${testCase.name} model picker overlaps the composer: ${JSON.stringify({ menu, composer })}`);
    }
  }
}

async function main() {
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  const requested = new Set(process.argv.slice(2));
  const selectedCases = requested.size ? cases.filter(({ name }) => requested.has(name)) : cases;
  if (requested.size && selectedCases.length !== requested.size) {
    const known = new Set(selectedCases.map(({ name }) => name));
    throw new Error(`Unknown UI smoke case: ${[...requested].filter((name) => !known.has(name)).join(", ")}`);
  }
  for (const testCase of selectedCases) {
    const files = await runElectron(testCase);
    if (statSync(files.screenshot).size < 500) throw new Error(`${testCase.name} screenshot is unexpectedly small`);
    const audit = JSON.parse(readFileSync(files.audit, "utf8"));
    if (!testCase.mode && testCase.width && audit.viewport.width !== testCase.width) {
      throw new Error(`${testCase.name} expected viewport width ${testCase.width}, got ${audit.viewport.width}`);
    }
    if (!testCase.mode && testCase.height && audit.viewport.height !== testCase.height) {
      throw new Error(`${testCase.name} expected viewport height ${testCase.height}, got ${audit.viewport.height}`);
    }
    if (audit.scroll.width !== audit.viewport.width || audit.scroll.height !== audit.viewport.height) {
      throw new Error(`${testCase.name} viewport scroll mismatch: ${JSON.stringify(audit.scroll)} vs ${JSON.stringify(audit.viewport)}`);
    }
    if (audit.offenders.length) throw new Error(`${testCase.name} has clipped UI: ${JSON.stringify(audit.offenders)}`);
    for (const [key, expected] of Object.entries(testCase.expect || {})) {
      if (audit.semantic?.[key] !== expected) throw new Error(`${testCase.name} expected ${key}=${JSON.stringify(expected)}, got ${JSON.stringify(audit.semantic?.[key])}`);
    }
    for (const [key, minimum] of Object.entries(testCase.min || {})) {
      if (!(audit.semantic?.[key] >= minimum)) throw new Error(`${testCase.name} expected ${key}>=${minimum}, got ${JSON.stringify(audit.semantic?.[key])}`);
    }
    for (const [key, maximum] of Object.entries(testCase.max || {})) {
      if (!(audit.semantic?.[key] <= maximum)) throw new Error(`${testCase.name} expected ${key}<=${maximum}, got ${JSON.stringify(audit.semantic?.[key])}`);
    }
    assertSnappedLayout(testCase, audit);
    process.stdout.write(`✓ ${testCase.name} ${audit.viewport.width}x${audit.viewport.height}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
