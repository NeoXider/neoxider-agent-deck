const { spawn } = require("node:child_process");
const { closeSync, mkdirSync, openSync, readFileSync, rmSync, statSync } = require("node:fs");
const path = require("node:path");

const electron = require("electron");
const root = path.resolve(__dirname, "..");
const output = path.join(root, "tmp", "ui-smoke");

const cases = [
  ...["wallpaper-cave", "wallpaper-cyberpunk", "background-wait"].map(fixture => ({ name: fixture, fixture, tab: "chat", motion: true, expect: { chatVisualPhase: "background" } })),
  ...["settings", "graphite", "midnight", "cyberpunk", "cave"].map(theme => ({ name: `design-${theme}`, tab: "chat", fixture: `design-${theme}`, expect: { settingsOpen: true, appearanceVisible: true, designChoices: 6, designTheme: theme === "settings" ? "claude" : theme } })),
  { name: "design-compact", tab: "chat", fixture: "design-settings", width: 360, height: 360, expect: { settingsOpen: true, appearanceVisible: true, designChoices: 6, titlebarOverlap: false } },
  ...[undefined, "orb", "edge"].map(mode => ({ name: `offline-signal-${mode || 'chat'}`, fixture: "chat", phase: "offline", mode, motion: true, expect: { chatVisualPhase: "offline", offlineAvatar: true, offlineBody: true, auroraAnimation: "none", chatBloomAnimation: "none" } })),
  ...["chat", "focus-chat"].flatMap(fixture => ["idle", "waiting"].map(phase => ({ name: `bloom-${fixture}-${phase}`, fixture, tab: "chat", phase, design: "aurora", width: 360, height: 360, motion: true, expect: { chatVisualPhase: phase, panelBackgroundOpacity: .9, auroraAnimation: "aurora-drift", chatBloomAnimation: phase === "idle" ? "none" : "chat-glow-breathe" }, min: { chatLightEnergy: phase === "idle" ? .2 : .8 } }))),
  ...[0, .5, 1].map(backgroundOpacity => ({ name: `background-${backgroundOpacity}`, fixture: "chat", tab: "chat", phase: "waiting", design: "aurora", backgroundOpacity, expect: { chatVisualPhase: "waiting", panelBackgroundOpacity: backgroundOpacity, auroraAnimation: "none", chatBloomAnimation: "none" }, ...(backgroundOpacity === 0 ? { max: { auroraOpacity: 0 } } : { min: { auroraOpacity: .1 } }) })),
  { name: "bloom-reduced-motion", fixture: "chat", phase: "waiting", design: "aurora", motion: true, reducedMotion: true, expect: { chatVisualPhase: "waiting", reducedMotion: true, auroraAnimation: "none", chatBloomAnimation: "none" } },
  { name: "overview", fixture: "overview", expect: { agentWorking: 1, agentIdle: 1, agentError: 1, tabPillIndex: "1" } },
  { name: "overview-360", fixture: "overview", width: 420, height: 360, expect: { agentWorking: 1, agentIdle: 1, agentError: 1, titlebarOverlap: false } },
  { name: "workspace-groups", tab: "agents", fixture: "workspace-groups", width: 360, height: 500, expect: { sessionGroups: 2, sessionPickerGroups: 0, agentCollapsedSessionGroups: 1, pickerCollapsedSessionGroups: 0, agentSessionGroupAddButtons: 2, pickerSessionGroupAddButtons: 0, sessionGroupHeadersSingleLine: true, uniqueSessionCards: true, uniquePickerSessions: true } },
  { name: "workspace-groups-chat", tab: "chat", fixture: "workspace-groups-chat", width: 360, height: 500, expect: { chatSessionPickerAbsent: true, sessionGroups: 2, setupInToolbar: true } },
  // Agents in 1.1: Recent above the groups, newest first, a pinned chat on top of its group,
  // the Harness chip, and the card menu with its in-place delete confirmation.
  { name: "agents-recent", tab: "agents", fixture: "agents-recent", width: 380, height: 620, expect: { recentSessionCards: 4, pinnedSessionCards: 1, firstGroupedSession: "s-docs", harnessSourceLabel: "DeepSeek Harness", titlebarOverlap: false } },
  { name: "session-menu", tab: "agents", fixture: "session-menu", width: 380, height: 620, expect: { floatingMenuItems: 3, floatingMenuConfirming: false } },
  { name: "session-delete-confirm", tab: "agents", fixture: "session-delete-confirm", width: 380, height: 620, expect: { floatingMenuConfirming: true } },
  // A chat's subagents and background jobs, and a subagent opened as a chat of its own.
  { name: "subagents-panel", tab: "chat", fixture: "subagents-panel", width: 420, height: 620, expect: { tasksPanelOpen: true, taskRows: 6, jobOutputVisible: true } },
  { name: "subagent-chat", tab: "chat", fixture: "subagent-chat", width: 420, height: 560, expect: { subagentBarVisible: true, subagentComposerHidden: false, tasksPanelOpen: false } },
  { name: "subagent-chat-once", tab: "chat", fixture: "subagent-chat-once", width: 420, height: 560, expect: { subagentBarVisible: true, subagentComposerHidden: true, tasksPanelOpen: false } },
  // The avatar's recent chats open a small chat in the panel's place.
  { name: "mini-chat", tab: "chat", fixture: "mini-chat", width: 360, height: 500, expect: { miniChat: true, miniChatBarVisible: true, titlebarVisible: false } },
  // Which Harness Deck follows, and a stable Harness release announced in the title bar.
  { name: "harness-settings", tab: "chat", fixture: "harness-settings", width: 420, height: 620, expect: { settingsOpen: true, harnessTargetOptions: 3, updateHarnessButtonText: "Update to 0.2.1", harnessUpdateChipVisible: true } },
  { name: "harness-update-chip", tab: "chat", fixture: "harness-update-chip", width: 420, height: 560, expect: { harnessUpdateChipVisible: true, harnessUpdateChipText: "DSH 0.2.1", titlebarOverlap: false } },
  { name: "harness-update-chip-360", tab: "chat", fixture: "harness-update-chip", width: 360, height: 500, expect: { harnessUpdateChipVisible: true, titlebarOverlap: false } },
  // Hovering the context meter: spend, turns, tokens, cache and time for the open chat.
  { name: "context-stats", tab: "chat", fixture: "context-stats", width: 420, height: 620, expect: { statsCardVisible: true, statsCardSpend: "~$4.36" }, min: { statsCardSections: 4 } },
  { name: "offline", tab: "chat", fixture: "offline", expect: { offlineBanners: 1, startHarnessButtons: 1, startHarnessText: "Start", startHarnessButtonVisible: true, startHarnessButtonDisabled: false, startHarnessTextPainted: true, headerStateText: "", contextUnavailable: true }, min: { composerTextareaWidth: 220, startHarnessTextWidth: 18, startHarnessBrightPixels: 20 } },
  { name: "harness-crash", tab: "chat", fixture: "harness-crash", expect: { offlineBanners: 1, startHarnessText: "Restart now", startHarnessButtonVisible: true, startHarnessButtonDisabled: false } },
  { name: "harness-crash-gave-up", tab: "chat", fixture: "harness-crash-gave-up", expect: { offlineBanners: 1, startHarnessText: "Restart", startHarnessButtonVisible: true } },
  // The crash sentence is the longest thing the status card says. At the narrowest size it
  // wraps beside its two actions, and the card still leaves the composer on screen.
  { name: "harness-crash-360", tab: "chat", fixture: "harness-crash", width: 360, height: 360, expect: { offlineBanners: 1, startHarnessText: "Restart now", startHarnessButtonVisible: true, startHarnessButtonDisabled: false, titlebarOverlap: false, headerTopClipped: false } },
  { name: "engine-crash", tab: "chat", fixture: "engine-crash", expect: { offlineBanners: 0 } },
  { name: "empty-chat", tab: "chat", fixture: "empty-chat", width: 380, height: 400, expect: { contextUnavailable: true, contextValue: "0%", contextVisible: true, conversationBubbles: 0, titlebarOverlap: false, composerEmpty: true, sendDisplay: "none", sendWidth: 0 } },
  { name: "offline-agents", tab: "agents", fixture: "offline-agents", expect: { offlineBanners: 1, startHarnessButtons: 1, startHarnessText: "Start", startHarnessButtonVisible: true, startHarnessButtonDisabled: false, startHarnessTextPainted: true, headerStateText: "", offlineSessionText: "Start Harness to load sessions." }, min: { startHarnessTextWidth: 18, startHarnessBrightPixels: 20 } },
  { name: "focus-offline", tab: "chat", fixture: "focus-offline", width: 360, height: 500, expect: { offlineBanners: 1, startHarnessButtons: 1, startHarnessText: "Start", startHarnessButtonVisible: true, startHarnessButtonDisabled: false, startHarnessTextPainted: true, headerStateText: "", focusMode: false }, min: { startHarnessTextWidth: 18, startHarnessBrightPixels: 20 } },
  { name: "chat", tab: "chat", fixture: "chat", expect: { composerRestingHeight: 48, historicalReasoning: 0, markdownLists: 1, footer: 0, titlebarTabs: 1, titlebarOverlap: false, headerTopClipped: false, setupInToolbar: true, brandUserSelect: "none", titlebarNativeDragDisabled: true, avatarHitWidth: 44, avatarHitHeight: 44, avatarPlateTransparent: true, avatarAuraCircular: true, avatarAuraContained: true, avatarAuraRadial: true, composerUtilitiesStacked: true, composerViewStacked: true, contextRingSize: 15, sendDisplay: "none", composerEmpty: true, contextCenterDelta: 0, bubbleActionGroups: 2, bubbleCopyActions: 2, bubbleReuseActions: 1, tabPillIndex: "0", auroraLayer: true, cssHeightInterpolation: true, cssDetailsContent: true, cssStartingStyle: true } },
  { name: "chat-font-135", tab: "chat", fixture: "chat", width: 380, height: 400, fontScale: 1.35, expect: { fontScale: 1.35, titlebarOverlap: false }, min: { bubbleFontPx: 14.8 } },

  // Spend is derived, never reported: the chip prices the session's own tokens at the
  // model's list rates, and the meter tooltip carries the arithmetic. A local model has no
  // list price, so its session card must stay silent rather than guess one.
  { name: "spend-chat", tab: "chat", fixture: "spend-chat", expect: {
    sessionSpendAmount: "~$14.91",
    sessionSpendTitle: "Session spend ~$14.91 · claude-opus-5-5 at list prices · input 302 · $0.0012 · output 170,791 · $3.4158 · cache read 45,477,197 · $9.0954 · cache write 480,327 · $2.4016",
    contextValue: "18%",
    contextUnavailable: false,
    contextTitle: "Context: 24k / 131k tokens · session spend ~$14.91",
  }, min: { sessionSpendWidth: 40 } },
  { name: "spend-agents", tab: "agents", fixture: "spend-agents", expect: { sessionMetaSpendCount: 1 } },
  { name: "spend-chat-360", tab: "chat", fixture: "spend-chat", width: 360, height: 500, expect: { sessionSpendAmount: "~$14.91", contextValue: "18%" }, min: { sessionSpendWidth: 40 } },
  { name: "history-loading", tab: "chat", fixture: "history-loading", width: 380, height: 400, expect: { skeletonRows: 3, emptyStateText: "", conversationBubbles: 0 } },
  { name: "toast", tab: "chat", fixture: "toast", width: 380, height: 400, expect: { toastVisible: true, toastText: "Copied to clipboard", conversationBubbles: 2 } },
  { name: "bubble-actions", tab: "chat", fixture: "bubble-actions", width: 380, height: 400, expect: { bubbleActionGroups: 2, bubbleCopyActions: 2, bubbleReuseActions: 1, bubbleActionsPlaced: true, conversationBubbles: 2 } },
  // Waits on the Markdown worker, which a cold start on a busy machine can keep past the default capture.
  { name: "live-markdown", tab: "chat", fixture: "live-markdown", width: 380, height: 400, delay: 3000, expect: { liveBubbles: 1, liveBubbleFormatted: true, liveBubbleHeadings: 1, liveBubbleListItems: 3, liveCaretInLastLine: true, liveCaretDisplay: "inline-block", activityCardVisible: false } },
  { name: "composer-recall", tab: "chat", fixture: "composer-recall", width: 380, height: 400, expect: { composerValue: "Now re-render the cover.", conversationBubbles: 4, composerEmpty: false, sendDisplay: "grid" } },
  // Motion left on: the plan strip eases open under a following log, and on every frame of
  // the move the log is still showing its last line. Several observed heights prove the
  // easing; a maximum gap of one pixel proves the anchor.
  // A followed log lands on its fractional maximum snapped to device pixels, so a pinned foot
  // reads 0-2px short depending on the display scale (CI runs at 100%). The last row sits
  // ~20px above the log edge behind its padding, so 2px never cuts a line.
  { name: "strip-easing", tab: "chat", fixture: "strip-easing", width: 380, height: 400, motion: true, expect: { todoRows: 3, todoExpanded: true, todoAboveComposer: true, stripTraceShrunk: true, messagesAtBottom: true }, min: { stripTraceSteps: 3 }, max: { stripTraceMaxGap: 2 } },
  { name: "focus-chat", tab: "chat", fixture: "focus-chat", width: 360, height: 500, expect: { focusMode: true, focusChromeHidden: true, historicalReasoning: 0, composerUtilitiesStacked: true, composerViewStacked: true, contextRingSize: 15, sendDisplay: "none", composerEmpty: true, contextCenterDelta: 0 } },
  { name: "commands", tab: "chat", fixture: "commands", expect: { commandRows: 6, commandAboveComposer: true, commandFitsWidth: true }, layout: { commandVisibleRows: 4 } },
  { name: "commands-360", tab: "chat", fixture: "commands", width: 360, height: 360, expect: { commandRows: 6, firstFourCommands: "/goal,/compact,/plan,/permission", commandAboveComposer: true, commandFitsWidth: true, titlebarOverlap: false }, layout: { commandVisibleRows: 4 } },
  { name: "focus-commands", tab: "chat", fixture: "focus-commands", width: 360, height: 500, expect: { focusMode: true, focusChromeHidden: true, commandRows: 6, commandAboveComposer: true, commandFitsWidth: true }, layout: { commandVisibleRows: 3 } },
  { name: "todo-360", tab: "chat", fixture: "todo", width: 360, height: 360, expect: { todoRows: 3, todoExpanded: true, todoAboveComposer: true, conversationBubbles: 1, shortMessageVisible: true, titlebarOverlap: false } },
  { name: "goal-result-360", tab: "chat", fixture: "goal-result", width: 360, height: 360, expect: { goalResultCards: 1, conversationBubbles: 2, titlebarOverlap: false } },
  { name: "queued-message", tab: "chat", fixture: "queued-message", width: 360, height: 500, expect: { queueRows: 2, queueActions: 8, queueSingleLine: true, queueAboveComposer: true } },
  { name: "live-stream", tab: "chat", fixture: "live-stream", width: 360, height: 500, expect: { liveBubbles: 1, historicalReasoning: 0 } },
  { name: "scroll-away", tab: "chat", fixture: "scroll-away", width: 360, height: 500, expect: { scrollLatestVisible: true } },
  { name: "glow-settings", tab: "chat", fixture: "glow-settings", expect: { motionEffectsChecked: true, motionOff: false, glowControl: 1, glowIntensity: "0.82", showThinkingChecked: true, windowLayerOptions: 4, autoStartHydrated: true } },
  { name: "update-ready", tab: "chat", fixture: "update-ready", width: 420, height: 640, expect: { settingsOpen: true, updateStatus: "v0.9.2 is verified and ready", updateBadgeVisible: true, updateInstallVisible: true, headerUpdateVisible: true, headerProductVisible: true, headerVersionVisible: true, headerUpdateUnclipped: true, updateProgress: "100" } },
  { name: "update-ready-360", tab: "chat", fixture: "update-ready", width: 360, height: 360, expect: { settingsOpen: true, updateStatus: "v0.9.2 is verified and ready", updateBadgeVisible: true, updateInstallVisible: true, headerUpdateVisible: true, headerProductVisible: true, headerVersionVisible: true, headerUpdateUnclipped: true, titlebarOverlap: false, updateProgress: "100" } },
  { name: "managed-update-available", tab: "chat", fixture: "managed-update-available", width: 420, height: 640, expect: { settingsOpen: true, updateStatus: "v0.6.9 is available", updateBadgeVisible: true, updateInstallVisible: false, headerUpdateVisible: false } },
  { name: "hotkey-settings", tab: "chat", fixture: "hotkey-settings", width: 420, height: 640, expect: { settingsOpen: true, hotkeySettingsOpen: true, hotkeyRows: 9 } },
  { name: "capture-menu", tab: "chat", fixture: "capture-menu", expect: { captureMenuOpen: true, captureRows: 3 } },
  { name: "model", tab: "chat", fixture: "model", expect: { modelControlLabel: "Model and reasoning", modelControlText: "LM Studio · Qwen 3.5 9B", agentControlsAbsent: true }, layout: { modelSheet: true } },
  { name: "model-collapsed", tab: "chat", fixture: "model-collapsed", width: 380, height: 400, expect: { visibleModelRows: 0, modelControlLabel: "Model and reasoning", agentControlsAbsent: true }, layout: { modelSheet: true } },
  { name: "model-360", tab: "chat", fixture: "model", width: 360, height: 360, expect: { modelControlLabel: "Model and reasoning", modelControlText: "LM Studio · Qwen 3.5 9B", titlebarOverlap: false, compactModelOverlay: true, selectedModelVisible: true, agentControlsAbsent: true }, min: { visibleModelRows: 3 }, layout: { modelSheet: true } },
  { name: "model-380", tab: "chat", fixture: "model", width: 380, height: 400, expect: { modelControlLabel: "Model and reasoning", modelControlText: "LM Studio · Qwen 3.5 9B", titlebarOverlap: false, compactModelOverlay: true, selectedModelVisible: true, agentControlsAbsent: true }, min: { visibleModelRows: 3 }, layout: { modelSheet: true } },
  { name: "model-font-135", tab: "chat", fixture: "model", width: 380, height: 400, fontScale: 1.35, expect: { fontScale: 1.35, titlebarOverlap: false, selectedModelVisible: true }, min: { visibleModelRows: 3 }, layout: { modelSheet: true } },
  { name: "reasoning-deep", tab: "chat", fixture: "reasoning-deep", width: 380, height: 400, motion: true, expect: { reasoningButtonIntensity: "deep", reasoningTrackIntensity: "deep", reasoningMenuIntensity: "deep", reasoningTitle: "Very high" } },
  { name: "reasoning-peak", tab: "chat", fixture: "reasoning-peak", width: 380, height: 400, motion: true, expect: { reasoningButtonIntensity: "peak", reasoningTrackIntensity: "peak", reasoningMenuIntensity: "peak", reasoningTitle: "Ultra" } },
  { name: "reasoning-qwen-high", tab: "chat", fixture: "reasoning-qwen-high", width: 380, height: 400, motion: true, expect: { reasoningButtonIntensity: "deep", reasoningTrackIntensity: "deep", reasoningMenuIntensity: "deep", reasoningTitle: "High", reasoningEffortCount: 4 } },
  { name: "reasoning-qwen-peak", tab: "chat", fixture: "reasoning-qwen-peak", width: 380, height: 400, motion: true, expect: { reasoningButtonIntensity: "peak", reasoningTrackIntensity: "peak", reasoningMenuIntensity: "peak", reasoningTitle: "Xhigh", reasoningEffortCount: 4 } },
  { name: "reasoning-qwen-high-cyberpunk", tab: "chat", fixture: "reasoning-qwen-high-cyberpunk", width: 380, height: 400, motion: true, expect: { designTheme: "cyberpunk", reasoningButtonIntensity: "deep", reasoningTrackIntensity: "deep", reasoningTitle: "High", reasoningEffortCount: 4 } },
  { name: "reasoning-qwen-peak-cyberpunk", tab: "chat", fixture: "reasoning-qwen-peak-cyberpunk", width: 380, height: 400, motion: true, expect: { designTheme: "cyberpunk", reasoningButtonIntensity: "peak", reasoningTrackIntensity: "peak", reasoningTitle: "Xhigh", reasoningEffortCount: 4 } },
  { name: "model-closed", tab: "chat", fixture: "model-closed", expect: { closedModelLabel: "Qwen 3.5 9B", closedModelVisible: true, closedModelUnclipped: true } },
  { name: "model-controls-open", tab: "chat", fixture: "model-controls-open", width: 380, height: 400, expect: { agentControlsAbsent: true, agentControlsOpen: false, agentPlanSwitchCount: 0, modelControlText: "LM Studio · Qwen 3.5 9B", titlebarOverlap: false } },
  { name: "compact-model-closed", tab: "chat", fixture: "model-closed", width: 360, height: 500, expect: { closedModelLabel: "Qwen 3.5 9B", closedModelVisible: true, closedModelUnclipped: true } },
  { name: "model-empty", tab: "chat", fixture: "model-empty", expect: { modelControlLabel: "Model and reasoning", modelControlText: "No models loaded", modelPickerActions: 2 } },
  { name: "model-error", tab: "chat", fixture: "model-error", expect: { modelSetupCards: 1, modelSetupActions: 2, closedModelLabel: "No model", closedModelVisible: true } },
  { name: "attachments", tab: "chat", fixture: "attachments", expect: { attachmentChips: 3, attachmentImages: 2, attachmentVideoThumbnails: 1, attachmentFallbackIcons: 1, sentAttachmentChips: 3, sentAttachmentImages: 1, attachmentOnlyBubbles: 1, sentAttachmentsWithinBubbles: true, attachmentRemoveActions: 3, attachmentAccessibleGroups: 3, attachmentHorizontalScroll: true, attachmentListWithinBar: true, attachmentsAboveComposer: true, composerUtilitiesStacked: true }, min: { attachmentPreviewMinWidth: 44, attachmentPreviewMinHeight: 40 }, max: { attachmentBarHeight: 56, sentAttachmentMaxWidth: 116 } },
  { name: "compact-attachments", tab: "chat", fixture: "attachments", width: 360, height: 500, expect: { attachmentChips: 3, attachmentImages: 2, attachmentVideoThumbnails: 1, attachmentFallbackIcons: 1, sentAttachmentChips: 3, sentAttachmentImages: 1, attachmentOnlyBubbles: 1, sentAttachmentsWithinBubbles: true, attachmentRemoveActions: 3, attachmentAccessibleGroups: 3, attachmentHorizontalScroll: true, attachmentListWithinBar: true, attachmentsAboveComposer: true, composerUtilitiesStacked: true }, min: { attachmentPreviewMinWidth: 44, attachmentPreviewMinHeight: 40 }, max: { attachmentBarHeight: 56, sentAttachmentMaxWidth: 104 } },
  { name: "attachments-360", tab: "chat", fixture: "attachments", width: 360, height: 360, expect: { attachmentChips: 3, attachmentImages: 2, attachmentVideoThumbnails: 1, attachmentFallbackIcons: 1, sentAttachmentChips: 3, sentAttachmentImages: 1, attachmentOnlyBubbles: 1, sentAttachmentsWithinBubbles: true, attachmentRemoveActions: 3, attachmentAccessibleGroups: 3, attachmentHorizontalScroll: true, attachmentListWithinBar: true, attachmentsAboveComposer: true, composerUtilitiesStacked: true, titlebarOverlap: false }, min: { attachmentPreviewMinWidth: 44, attachmentPreviewMinHeight: 40, attachmentMessageSpace: 100 }, max: { attachmentBarHeight: 56, sentAttachmentMaxWidth: 104 } },
  { name: "markdown-tools", tab: "chat", fixture: "markdown-tools", expect: { toolGroups: 1, toolCalls: 2, historicalReasoning: 0 } },
  { name: "thinking-chat", tab: "chat", fixture: "thinking", expect: { activityCardVisible: true, showThinkingChecked: true, thinkingClearOfMessages: true } },
  // Elapsed turn time and running background tasks in the panel the user watches during a
  // turn. Both existed only on the Agents session cards before.
  { name: "activity-meta", tab: "chat", fixture: "activity-meta", expect: { activityCardVisible: true, activityElapsedWellFormed: true, activityElapsedMinutes: 21, activityElapsedRunning: true, activityBackgroundCount: "2", activityMetaWithinCard: true } },
  // A rejected send keeps its reason on screen while the turn beside it goes on running.
  { name: "send-rejected", tab: "chat", fixture: "send-rejected", expect: { composerErrorVisible: true, composerErrorText: "The current model does not support images; switch to a model with vision support.", composerErrorDismissable: true, composerErrorAboveComposer: true, activityCardVisible: true, attachmentChips: 1 } },
  { name: "send-rejected-compact", width: 360, height: 360, tab: "chat", fixture: "send-rejected", expect: { composerErrorVisible: true, composerErrorUnclipped: true, composerErrorText: "The current model does not support images; switch to a model with vision support.", composerErrorDismissable: true, composerErrorAboveComposer: true, activityCardVisible: true, attachmentChips: 1 } },
  // A queued background job is regularly longer than its one-line row; opening it shows the
  // command whole, in the dock, without reaching into the conversation or the composer.
  { name: "queued-long", tab: "chat", fixture: "queued-long", expect: { queueRows: 2, queueRowsExpanded: 1, queueExpandedNotClipped: true, queueExpandedFontPx: 13, queueDockAboveComposer: true } },
  // Editing that same job: a textarea holding the whole command, not a one-line input.
  { name: "queued-editing", tab: "chat", fixture: "queued-editing", expect: { queueEditorTag: "TEXTAREA", queueDockAboveComposer: true }, min: { queueEditorLines: 3 } },
  // A mark per message the caller wrote, in the gutter beside the scrollbar, with the
  // magnet on because the log is scrolled away from a running turn.
  { name: "message-marks", tab: "chat", fixture: "message-marks", expect: { messageMarkCount: 5, messageMarksMagnet: false, messageMarksClearOfBubbles: true, messageMarksOrdered: true, messageMarksAllResolve: true, messageMarkHitHeight: 10, scrollLatestVisible: true, messageMarksClearOfLatest: true, messageMarksActiveCount: 1, messageMarksNonOverlapping: true } },
  { name: "message-rail-preview", tab: "chat", fixture: "message-rail-preview", width: 360, height: 420, expect: { messageMarkCount: 5, messageMarksClearOfBubbles: true, messageMarksClearOfLatest: true, messageMarksActiveCount: 1, messageRailPreview: true } },
  { name: "message-rail-long", tab: "chat", fixture: "message-rail-long", delay: 3000, expect: { messageRailInteractions: true, messageMarksNonOverlapping: true, messageMarksClearOfBubbles: true, messageMarksActiveCount: 1, messageRailTurnCount: 1200 }, max: { messageMarkCount: 60 } },
  // Press a mark, then let the poll rebuild the log on top of it: the jump has to hold.
  { name: "mark-jump", tab: "chat", fixture: "mark-jump", expect: { markJumpAligned: true, markJumpFlashed: 1, messageMarksClearOfLatest: true } },
  // The goal lives in its own strip under the composer so it never scrolls off in the log and
  // never gets shoved around by the activity card above it. Collapsed it is a hairline.
  { name: "goal-collapsed", tab: "chat", fixture: "goal-collapsed", expect: { goalChevronPointsUp: true, goalDockVisible: true, goalDockOpen: false, goalPhase: "active", goalDockBelowComposer: true, goalStripPinnedToBottom: true, goalStripHeight: 14, goalStripTextFree: true, goalRounds: "4/12", goalTrackFill: "33%", goalTrackHeight: 5 } },
  { name: "goal-expanded", tab: "chat", fixture: "goal-expanded", expect: { goalChevronPointsUp: false, goalDockVisible: true, goalDockOpen: true, goalActionCount: 2, goalPauseAction: "Pause the goal", goalStripPauseSize: 18, goalStripPauseGlyph: "#icon-pause", goalDockBelowComposer: true, goalStripPinnedToBottom: true, goalStripHeight: 18, goalStripTextFree: true, goalActionMinSize: 28, goalTrackHeight: 6 } },
  { name: "goal-paused", tab: "chat", fixture: "goal-paused", expect: { goalDockVisible: true, goalPhase: "paused", goalPauseAction: "Resume the goal", goalStripPauseGlyph: "#icon-play", goalDockBelowComposer: true } },
  { name: "thinking-hidden", tab: "chat", fixture: "thinking-hidden", expect: { activityCardVisible: false, showThinkingChecked: false } },
  // The reasoning block over a scrolled conversation is the case the old floating strip got
  // wrong: its room was reserved by padding-top on the scroll container, so scrolling took
  // the gap away and the strip covered the first visible message. The crowded fixture is
  // reused at the default size so this runs on displays that cannot render 360 px wide.
  { name: "thinking-scrolled-chat", tab: "chat", fixture: "crowded-chat", expect: { activityCardVisible: true, thinkingClearOfMessages: true, messageViewportScrollable: true, shortMessageVisible: true } },
  // "thinking" was the one kind the old gate covered. These two are what the user actually
  // saw come back above the conversation with the preference switched off.
  { name: "working-hidden", tab: "chat", fixture: "working-hidden", expect: { activityCardVisible: false, showThinkingChecked: false } },
  { name: "tool-hidden", tab: "chat", fixture: "tool-hidden", expect: { activityCardVisible: false, showThinkingChecked: false } },
  { name: "writing-chat", tab: "chat", fixture: "writing", expect: { liveBubbles: 1, liveCaretDisplay: "inline-block" } },
  { name: "tool-chat", tab: "chat", fixture: "tool", expect: { activityCardVisible: true, showThinkingChecked: true } },
  // The running clocks tick, so they are checked by shape and count; the finished session's
  // duration is static and is checked exactly.
  { name: "session-times", tab: "agents", fixture: "session-times", expect: { sessionElapsedRunning: 2, sessionElapsedWellFormed: true, sessionElapsedLastRun: "2m 08s", sessionMetaSingleLine: true, sessionBackgroundBadges: 1, sessionBackgroundCounts: "2" } },
  { name: "completion-chat", tab: "chat", fixture: "completion-chat", expect: { completionCelebration: true, fullSuccessGlowVisible: true } },
  { name: "compact-chat", tab: "chat", fixture: "chat", width: 360, height: 500, expect: { historicalReasoning: 0, footer: 0, titlebarTabs: 1, setupInToolbar: true, composerUtilitiesStacked: true, contextRingSize: 15, sendDisplay: "none", composerEmpty: true } },
  { name: "compact-tools", tab: "chat", fixture: "markdown-tools", width: 360, height: 500, expect: { toolGroups: 1, toolCalls: 2 } },
  { name: "mixed-tools-360", tab: "chat", fixture: "mixed-tools", width: 360, height: 360, expect: { toolGroups: 1, toolCalls: 2, partialToolGroups: 1, conversationBubbles: 1, titlebarOverlap: false } },
  { name: "question-wait-360", tab: "chat", fixture: "question-wait", width: 360, height: 360, expect: { toolCalls: 1, questionHandoffVisible: true, questionWaitVisible: true, titlebarOverlap: false } },
  { name: "question-dock", tab: "chat", fixture: "question-dock", width: 420, height: 640, expect: { questionDockVisible: true, questionDockOptions: 5, questionHandoffVisible: true, questionHandoffText: "Answer below", titlebarOverlap: false } },
  { name: "question-dock-360", tab: "chat", fixture: "question-dock-360", width: 360, height: 360, expect: { questionDockVisible: true, questionHandoffVisible: true, titlebarOverlap: false } },
  { name: "question-orb", tab: "chat", fixture: "question-orb", mode: "orb", expect: { orbNotification: true, orbHasStatus: true, orbStatusLabel: "Release notes is asking" } },
  { name: "question-wait-group-360", tab: "chat", fixture: "question-wait-group", width: 360, height: 360, expect: { toolGroups: 1, toolCalls: 2, questionHandoffVisible: true, questionWaitVisible: true, titlebarOverlap: false } },
  { name: "composer-single-line", tab: "chat", fixture: "composer-single-line", width: 380, height: 400, expect: { composerInputHeight: 34, composerUtilityHeight: 36, composerInputScrollable: false, conversationBubbles: 1, shortMessageVisible: true }, max: { composerHeight: 48 } },
  { name: "composer-multiline-max", tab: "chat", fixture: "composer-multiline", width: 380, height: 400, expect: { composerInputScrollable: true, conversationBubbles: 1, shortMessageVisible: true }, layout: { composerFullLines: 6 } },
  { name: "small-chat-400", tab: "chat", fixture: "small-chat", width: 400, height: 400, expect: { composerInputHeight: 34, composerUtilityHeight: 36, conversationBubbles: 1, shortMessageVisible: true }, max: { composerHeight: 48 } },
  { name: "small-chat-380", tab: "chat", fixture: "small-chat", width: 380, height: 380, expect: { composerInputHeight: 34, composerUtilityHeight: 36, conversationBubbles: 1, shortMessageVisible: true }, max: { composerHeight: 48 } },
  { name: "small-chat-360", tab: "chat", fixture: "small-chat", width: 360, height: 360, expect: { composerInputHeight: 34, composerUtilityHeight: 36, conversationBubbles: 1, shortMessageVisible: true, titlebarOverlap: false, headerTopClipped: false, titlebarNativeDragDisabled: true, avatarHitWidth: 38, avatarHitHeight: 38, avatarPlateTransparent: true, avatarAuraCircular: true, avatarAuraContained: true, avatarAuraRadial: true }, min: { titlebarTop: 9 }, max: { composerHeight: 48 } },
  { name: "crowded-chat-400", tab: "chat", fixture: "crowded-chat", width: 400, height: 400, expect: { crowdedChat: true, todoRows: 3, todoExpanded: true, queueRows: 2, attachmentChips: 1, activityCardVisible: true, thinkingClearOfMessages: true, conversationBubbles: 6, shortMessageVisible: true, messageViewportScrollable: true, crowdedSurfacesWithinPanel: true, composerEmpty: false, sendDisplay: "grid" }, min: { messageViewportHeight: 62 } },
  { name: "crowded-chat-360", tab: "chat", fixture: "crowded-chat", width: 360, height: 360, expect: { crowdedChat: true, todoRows: 3, todoExpanded: true, queueRows: 2, attachmentChips: 1, activityCardVisible: true, thinkingClearOfMessages: true, conversationBubbles: 6, shortMessageVisible: true, messageViewportScrollable: true, crowdedSurfacesWithinPanel: true, titlebarOverlap: false, headerTopClipped: false }, min: { messageViewportHeight: 62, titlebarTop: 9 } },
  { name: "thinking-orb", tab: "chat", fixture: "thinking", mode: "orb", expect: { orbUtilityButtons: 3 } },
  // A working agent must not open a 400 px panel over the screen on its own. The count goes
  // on the expand button, and only the circle and the two controls take the mouse.
  { name: "collapsed-orb", tab: "chat", fixture: "orb-collapsed", mode: "orb", expect: { orbHasStatus: false, orbStatusWidth: 0, orbPanelCountVisible: false }, max: { orbInteractiveArea: 6600 } },
  { name: "auto-expand-orb", tab: "chat", fixture: "orb-auto-expand", mode: "orb", expect: { orbHasStatus: true, orbPanelCountVisible: false }, min: { orbStatusWidth: 100 } },
  // Offline beside the avatar is a notification that leaves on its own, not a card that stays.
  { name: "offline-orb", tab: "chat", fixture: "offline", mode: "orb", expect: { orbUtilityButtons: 3, orbNotification: false, orbHasStatus: false } },
  { name: "notification-orb", tab: "chat", fixture: "orb-notification", mode: "orb", expect: { orbUtilityButtons: 3, orbNotification: true, orbStatusShadow: "none", orbReplyShadow: "none" } },
  { name: "notification-orb-black", tab: "chat", fixture: "orb-notification", mode: "orb", backdrop: "black", expect: { orbNotification: true, orbStatusShadow: "none", orbReplyShadow: "none" } },
  { name: "notification-orb-white", tab: "chat", fixture: "orb-notification", mode: "orb", backdrop: "white", expect: { orbNotification: true, orbStatusShadow: "none", orbReplyShadow: "none" } },
  { name: "notification-orb-checkerboard", tab: "chat", fixture: "orb-notification", mode: "orb", backdrop: "checkerboard", expect: { orbNotification: true, orbStatusShadow: "none", orbReplyShadow: "none" } },
  { name: "recent-sessions-orb", tab: "chat", fixture: "orb-recent-three", mode: "orb", expect: { orbRecentRows: 3, orbRecentUniqueSessions: 3, orbHistoryOpen: true, orbQuickReplyOpen: false, orbPanelClipped: false, compactSide: "right" } },
  { name: "recent-sessions-orb-left", tab: "chat", fixture: "orb-recent-three-left", mode: "orb", side: "left", expect: { orbRecentRows: 3, orbRecentUniqueSessions: 3, orbHistoryOpen: true, orbQuickReplyOpen: false, orbPanelClipped: false, compactSide: "left" } },
  { name: "quick-reply-orb", tab: "chat", fixture: "orb-quick-reply", mode: "orb", expect: { orbRecentRows: 3, orbQuickReplyOpen: true, orbReplyTarget: "Build review", orbReplyInputVisible: true, orbPanelClipped: false } },
  { name: "edge", fixture: "edge-idle", mode: "edge", expect: { edgeLineWidth: 8, edgeState: "idle", edgePrimary: "rgb(217, 119, 87)" } },
  { name: "edge-hover", fixture: "edge-hover", mode: "edge", expect: { edgeHitActive: true, edgeLineWidth: 8, edgeState: "idle", edgePrimary: "rgb(217, 119, 87)" } },
  { name: "edge-working", fixture: "edge-working", mode: "edge", expect: { edgeLineWidth: 8, edgeState: "working", edgePrimary: "rgb(188, 209, 202)" } },
  { name: "edge-thinking", fixture: "thinking", mode: "edge", expect: { edgeState: "thinking", edgePrimary: "rgb(212, 162, 127)" } },
  { name: "edge-writing", fixture: "writing", mode: "edge", expect: { edgeState: "writing", edgePrimary: "rgb(188, 209, 202)" } },
  { name: "edge-tool", fixture: "tool", mode: "edge", expect: { edgeState: "tool", edgePrimary: "rgb(150, 170, 110)" } },
  { name: "edge-done", fixture: "edge-done", mode: "edge", expect: { edgeState: "done", edgePrimary: "rgb(235, 219, 188)", completionCelebration: true } },
  { name: "edge-done-cleanup", fixture: "edge-done-cleanup", mode: "edge", delay: 4000, expect: { edgeState: "idle", edgePrimary: "rgb(217, 119, 87)", completionCelebration: false } },
  { name: "edge-error", fixture: "edge-error", mode: "edge", expect: { edgeState: "error", edgePrimary: "rgb(224, 121, 111)", compactErrorUnread: true, completionCelebration: false } },
  { name: "edge-error-ack", fixture: "edge-error-ack", mode: "edge", expect: { edgeState: "idle", edgePrimary: "rgb(217, 119, 87)", compactErrorUnread: false, completionCelebration: false } },
  { name: "edge-error-interrupts-done", fixture: "edge-error-interrupts-done", mode: "edge", expect: { edgeState: "error", edgePrimary: "rgb(224, 121, 111)", compactErrorUnread: true, completionCelebration: false } },
];

function runElectron(testCase) {
  return new Promise((resolve, reject) => {
    const screenshot = path.join(output, `${testCase.name}.png`);
    const audit = path.join(output, `${testCase.name}.json`);
    rmSync(screenshot, { force: true });
    rmSync(audit, { force: true });
    // The child writes to a file, not a pipe. On Windows an Electron whose stdout and stderr
    // were pipes intermittently stayed alive after app.quit() - with its network and GPU
    // processes - once its window had been captured, so the case sat out the whole timeout
    // with a finished screenshot on disk. It reproduced in most runs against a live Harness
    // and never with the same output going to a file. A normal launch has no pipes at all.
    const logPath = path.join(output, `${testCase.name}.log`);
    const logFd = openSync(logPath, "w");
    const readOutput = () => { try { return readFileSync(logPath, "utf8"); } catch { return ""; } };
    const motionPreference = testCase.reducedMotion ? "--force-prefers-reduced-motion" : "--force-prefers-no-reduced-motion";
    const child = spawn(electron, [root, motionPreference], {
      cwd: root,
      env: {
        ...process.env,
        WIDGET_SCREENSHOT_PATH: screenshot,
        WIDGET_UI_AUDIT_PATH: audit,
        WIDGET_SCREENSHOT_DELAY: String(testCase.delay || 1800),
        ...(testCase.design ? { WIDGET_SCREENSHOT_DESIGN: testCase.design } : {}),
        ...(testCase.phase ? { WIDGET_SCREENSHOT_CHAT_PHASE: testCase.phase } : {}),
        ...(testCase.backgroundOpacity !== undefined ? { WIDGET_SCREENSHOT_BACKGROUND_OPACITY: String(testCase.backgroundOpacity) } : {}),
        ...(testCase.fontScale ? { WIDGET_SCREENSHOT_FONT_SCALE: String(testCase.fontScale) } : {}),
        ...(testCase.tab ? { WIDGET_SCREENSHOT_TAB: testCase.tab } : {}),
        ...(testCase.fixture ? { WIDGET_SCREENSHOT_FIXTURE: testCase.fixture } : {}),
        ...(testCase.mode ? { WIDGET_SCREENSHOT_MODE: testCase.mode } : {}),
        ...(testCase.side ? { WIDGET_SCREENSHOT_SIDE: testCase.side } : {}),
        ...(testCase.backdrop ? { WIDGET_SCREENSHOT_BACKDROP: testCase.backdrop } : {}),
        ...(testCase.motion ? { WIDGET_SCREENSHOT_MOTION: "1" } : {}),
        ...(testCase.width ? { WIDGET_SCREENSHOT_WIDTH: String(testCase.width) } : {}),
        ...(testCase.height ? { WIDGET_SCREENSHOT_HEIGHT: String(testCase.height) } : {}),
      },
      stdio: ["ignore", logFd, logFd],
      windowsHide: true,
    });
    closeSync(logFd);
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`${testCase.name} exceeded the 20 second UI smoke timeout\n${readOutput()}`));
    }, 20000);
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
      else reject(new Error(`${testCase.name} exited ${code}\n${readOutput()}`));
    });
  });
}

function findBox(audit, selector) {
  return audit.boxes.find((box) => box.selector === selector);
}

function assertSnappedLayout(testCase, audit) {
  if (testCase.layout?.modelSheet) {
    const menu = findBox(audit, ".picker.open .picker-menu");
    // A temporary top-layer sheet can cover the composer, but not leave the viewport.
    if (!menu || menu.height < 186 || menu.height > 381 || menu.left < 0 || menu.top < 0 || menu.right > audit.viewport.width + 1 || menu.bottom > audit.viewport.height + 1) {
      throw new Error(`${testCase.name} expected a readable, viewport-bounded model sheet, got ${JSON.stringify(menu)}`);
    }
  }
  if (testCase.layout?.composerFullLines) {
    const expectedHeight = testCase.layout.composerFullLines * 20;
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
  const retried = [];
  for (const testCase of selectedCases) {
    let audit;
    try {
      audit = await verifyCase(testCase);
    } catch (firstError) {
      // One re-run, loudly. Each case boots a whole Electron and is captured on a timer, so on
      // a loaded machine a case can be photographed before its first paint or before an async
      // reply lands. A real defect fails the second run too; a flake does not, and one stray
      // frame no longer aborts the suite and silently skips every case after it.
      if (!SMOKE_RETRIES) throw firstError;
      process.stdout.write(`\u21bb ${testCase.name} retried after: ${firstError.message.split("\n")[0]}\n`);
      try {
        audit = await verifyCase(testCase);
      } catch (secondError) {
        secondError.message = `${secondError.message}\n(first attempt: ${firstError.message.split("\n")[0]})`;
        throw secondError;
      }
      retried.push(testCase.name);
    }
    process.stdout.write(`✓ ${testCase.name} ${audit.viewport.width}x${audit.viewport.height}\n`);
  }
  if (retried.length) process.stdout.write(`Passed on a second attempt: ${retried.join(", ")}\n`);
}

// Strict mode for a run that must not forgive a single flaky frame: UI_SMOKE_RETRIES=0.
const SMOKE_RETRIES = process.env.UI_SMOKE_RETRIES === "0" ? 0 : 1;

async function verifyCase(testCase) {
  const files = await runElectron(testCase);
  if (statSync(files.screenshot).size < 500) throw new Error(`${testCase.name} screenshot is unexpectedly small`);
  const audit = JSON.parse(readFileSync(files.audit, "utf8"));
  if (audit.semantic.reducedMotion !== Boolean(testCase.reducedMotion)) throw new Error(`${testCase.name} did not apply its explicit motion preference`);
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
    if (!(audit.semantic?.[key] <= maximum)) {
      const trace = key.startsWith("stripTrace") ? ` trace=${JSON.stringify(audit.semantic?.stripTrace)}` : "";
      throw new Error(`${testCase.name} expected ${key}<=${maximum}, got ${JSON.stringify(audit.semantic?.[key])}${trace}`);
    }
  }
  assertSnappedLayout(testCase, audit);
  return audit;
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
