const { spawn } = require("node:child_process");
const { mkdirSync, readFileSync, rmSync, statSync } = require("node:fs");
const path = require("node:path");

const electron = require("electron");
const root = path.resolve(__dirname, "..");
const output = path.join(root, "tmp", "ui-smoke");

const cases = [
  { name: "overview", fixture: "overview", expect: { agentWorking: 1, agentIdle: 1, agentError: 1 } },
  { name: "offline", tab: "chat", fixture: "offline", expect: { offlineBanners: 1, startHarnessButtons: 1, startHarnessText: "Start", startHarnessButtonVisible: true, startHarnessButtonDisabled: false, startHarnessTextPainted: true, headerStateText: "", contextUnavailable: true }, min: { composerTextareaWidth: 220, startHarnessTextWidth: 18, startHarnessBrightPixels: 20 } },
  { name: "offline-agents", tab: "agents", fixture: "offline-agents", expect: { offlineBanners: 1, startHarnessButtons: 1, startHarnessText: "Start", startHarnessButtonVisible: true, startHarnessButtonDisabled: false, startHarnessTextPainted: true, headerStateText: "", offlineSessionText: "Start Harness to load sessions." }, min: { startHarnessTextWidth: 18, startHarnessBrightPixels: 20 } },
  { name: "focus-offline", tab: "chat", fixture: "focus-offline", width: 360, height: 500, expect: { offlineBanners: 1, startHarnessButtons: 1, startHarnessText: "Start", startHarnessButtonVisible: true, startHarnessButtonDisabled: false, startHarnessTextPainted: true, headerStateText: "", focusMode: false }, min: { startHarnessTextWidth: 18, startHarnessBrightPixels: 20 } },
  { name: "chat", tab: "chat", fixture: "chat", expect: { historicalReasoning: 0, markdownLists: 1, footer: 0, titlebarTabs: 1, setupInToolbar: true, brandUserSelect: "none", composerUtilitiesStacked: true, composerViewStacked: true, contextRingSize: 18, sendWidth: 38, sendHeight: 38, contextCenterDelta: 0 } },
  { name: "focus-chat", tab: "chat", fixture: "focus-chat", width: 360, height: 500, expect: { focusMode: true, focusChromeHidden: true, historicalReasoning: 0, composerUtilitiesStacked: true, composerViewStacked: true, contextRingSize: 18, sendWidth: 36, sendHeight: 36, contextCenterDelta: 0 } },
  { name: "commands", tab: "chat", fixture: "commands", expect: { commandRows: 6, commandAboveComposer: true, commandFitsWidth: true } },
  { name: "focus-commands", tab: "chat", fixture: "focus-commands", width: 360, height: 500, expect: { focusMode: true, focusChromeHidden: true, commandRows: 6, commandAboveComposer: true, commandFitsWidth: true } },
  { name: "queued-message", tab: "chat", fixture: "queued-message", width: 360, height: 500, expect: { queueRows: 2, queueActions: 6, queueSingleLine: true, queueAboveComposer: true } },
  { name: "live-stream", tab: "chat", fixture: "live-stream", width: 360, height: 500, expect: { liveBubbles: 1, historicalReasoning: 0 } },
  { name: "scroll-away", tab: "chat", fixture: "scroll-away", width: 360, height: 500, expect: { scrollLatestVisible: true } },
  { name: "glow-settings", tab: "chat", fixture: "glow-settings", expect: { glowControl: 1, glowIntensity: "0.82", windowLayerOptions: 3, autoStartHydrated: true } },
  { name: "model", tab: "chat", fixture: "model", expect: { modelControlLabel: "MODEL", modelControlText: "LM Studio · Qwen 3.5 9B" } },
  { name: "model-closed", tab: "chat", fixture: "model-closed", expect: { closedModelLabel: "Qwen 3.5 9B", closedModelVisible: true, closedModelUnclipped: true } },
  { name: "compact-model-closed", tab: "chat", fixture: "model-closed", width: 360, height: 500, expect: { closedModelLabel: "Qwen 3.5 9B", closedModelVisible: true, closedModelUnclipped: true } },
  { name: "model-empty", tab: "chat", fixture: "model-empty", expect: { modelControlLabel: "MODEL", modelControlText: "No models loaded", modelPickerActions: 2 } },
  { name: "model-error", tab: "chat", fixture: "model-error", expect: { modelSetupCards: 1, modelSetupActions: 2, closedModelLabel: "No model", closedModelVisible: true } },
  { name: "attachments", tab: "chat", fixture: "attachments", expect: { attachmentChips: 2, attachmentsAboveComposer: true, composerUtilitiesStacked: true } },
  { name: "compact-attachments", tab: "chat", fixture: "attachments", width: 360, height: 500, expect: { attachmentChips: 2, attachmentsAboveComposer: true, composerUtilitiesStacked: true } },
  { name: "markdown-tools", tab: "chat", fixture: "markdown-tools", expect: { toolGroups: 1, toolCalls: 2, historicalReasoning: 0 } },
  { name: "thinking-chat", tab: "chat", fixture: "thinking" },
  { name: "writing-chat", tab: "chat", fixture: "writing", expect: { liveBubbles: 1, liveCaretDisplay: "inline-block" } },
  { name: "tool-chat", tab: "chat", fixture: "tool" },
  { name: "compact-chat", tab: "chat", fixture: "chat", width: 360, height: 500, expect: { historicalReasoning: 0, footer: 0, titlebarTabs: 1, setupInToolbar: true, composerUtilitiesStacked: true, contextRingSize: 18, sendWidth: 36, sendHeight: 36 } },
  { name: "compact-tools", tab: "chat", fixture: "markdown-tools", width: 360, height: 500, expect: { toolGroups: 1, toolCalls: 2 } },
  { name: "composer-single-line", tab: "chat", fixture: "composer-single-line", width: 380, height: 400, expect: { composerInputHeight: 34, composerUtilityHeight: 38, composerInputScrollable: false, conversationBubbles: 1, shortMessageVisible: true }, max: { composerHeight: 50 } },
  { name: "composer-multiline-max", tab: "chat", fixture: "composer-multiline", width: 380, height: 400, expect: { composerInputScrollable: true, conversationBubbles: 1, shortMessageVisible: true }, max: { composerInputMaxDelta: 1 } },
  { name: "small-chat-400", tab: "chat", fixture: "small-chat", width: 400, height: 400, expect: { composerInputHeight: 34, composerUtilityHeight: 38, conversationBubbles: 1, shortMessageVisible: true }, max: { composerHeight: 50 } },
  { name: "small-chat-380", tab: "chat", fixture: "small-chat", width: 380, height: 380, expect: { composerInputHeight: 34, composerUtilityHeight: 38, conversationBubbles: 1, shortMessageVisible: true }, max: { composerHeight: 50 } },
  { name: "small-chat-360", tab: "chat", fixture: "small-chat", width: 360, height: 360, expect: { composerInputHeight: 34, composerUtilityHeight: 38, conversationBubbles: 1, shortMessageVisible: true }, max: { composerHeight: 50 } },
  { name: "thinking-orb", tab: "chat", fixture: "thinking", mode: "orb", expect: { orbUtilityButtons: 1 } },
  { name: "notification-orb", tab: "chat", fixture: "orb-notification", mode: "orb", expect: { orbUtilityButtons: 1, orbNotification: true, orbStatusShadow: "none", orbReplyShadow: "none" } },
  { name: "notification-orb-black", tab: "chat", fixture: "orb-notification", mode: "orb", backdrop: "black", expect: { orbNotification: true, orbStatusShadow: "none", orbReplyShadow: "none" } },
  { name: "notification-orb-white", tab: "chat", fixture: "orb-notification", mode: "orb", backdrop: "white", expect: { orbNotification: true, orbStatusShadow: "none", orbReplyShadow: "none" } },
  { name: "notification-orb-checkerboard", tab: "chat", fixture: "orb-notification", mode: "orb", backdrop: "checkerboard", expect: { orbNotification: true, orbStatusShadow: "none", orbReplyShadow: "none" } },
  { name: "recent-sessions-orb", tab: "chat", fixture: "orb-recent-three", mode: "orb", expect: { orbRecentRows: 3, orbRecentUniqueSessions: 3, orbHistoryOpen: true, orbQuickReplyOpen: false, orbPanelClipped: false, compactSide: "right" } },
  { name: "recent-sessions-orb-left", tab: "chat", fixture: "orb-recent-three-left", mode: "orb", side: "left", expect: { orbRecentRows: 3, orbRecentUniqueSessions: 3, orbHistoryOpen: true, orbQuickReplyOpen: false, orbPanelClipped: false, compactSide: "left" } },
  { name: "quick-reply-orb", tab: "chat", fixture: "orb-quick-reply", mode: "orb", expect: { orbRecentRows: 3, orbQuickReplyOpen: true, orbReplyTarget: "Build review", orbReplyInputVisible: true, orbPanelClipped: false } },
  { name: "edge", fixture: "edge-idle", mode: "edge", expect: { edgeLineWidth: 8, edgeState: "idle", edgePrimary: "#556273" } },
  { name: "edge-hover", fixture: "edge-hover", mode: "edge", expect: { edgeHitActive: true, edgeLineWidth: 8, edgeState: "idle", edgePrimary: "#556273" } },
  { name: "edge-thinking", fixture: "thinking", mode: "edge", expect: { edgeState: "thinking", edgePrimary: "#9b8cff" } },
  { name: "edge-writing", fixture: "writing", mode: "edge", expect: { edgeState: "writing", edgePrimary: "#49e7c6" } },
  { name: "edge-tool", fixture: "tool", mode: "edge", expect: { edgeState: "tool", edgePrimary: "#ffbd69" } },
  { name: "edge-done", fixture: "edge-done", mode: "edge", expect: { edgeState: "done", edgePrimary: "#79f0b7" } },
  { name: "edge-error", fixture: "edge-error", mode: "edge", expect: { edgeState: "error", edgePrimary: "#ff738f" } },
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
        WIDGET_SCREENSHOT_DELAY: "1800",
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

async function main() {
  mkdirSync(output, { recursive: true });
  for (const testCase of cases) {
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
    process.stdout.write(`✓ ${testCase.name} ${audit.viewport.width}x${audit.viewport.height}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
