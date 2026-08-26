// The screenshot and layout-audit harness used by scripts/ui-visual-smoke.cjs.
//
// This is test-only machinery: it drives the window into a fixture state, measures every
// visible surface against the viewport, and writes a PNG plus a JSON audit. It used to
// live inside createWindow(), where 150 lines of QA code sat in the middle of production
// window setup. It runs only when WIDGET_SCREENSHOT_PATH is set.
const { mkdirSync, writeFileSync } = require("node:fs");
const path = require("node:path");

function attachScreenshotHarness({ window, app, applyWindowMode, screenshotPath, getDragTrace = () => [] }) {
  window.webContents.once("did-finish-load", () => {
    const requestedDelay = Number(process.env.WIDGET_SCREENSHOT_DELAY);
    const captureDelay = Number.isFinite(requestedDelay) && requestedDelay >= 1200 ? requestedDelay : 5000;
    const requestedMode = process.env.WIDGET_SCREENSHOT_MODE;
    if (["orb", "edge"].includes(requestedMode)) {
      setTimeout(() => applyWindowMode(requestedMode), Math.min(3500, captureDelay - 650));
    }
    setTimeout(async () => {
      const auditPath = process.env.WIDGET_UI_AUDIT_PATH;
      let audit = null;
      if (auditPath) {
        audit = await window.webContents.executeJavaScript(`(() => {
          const selectors = ['.widget-shell','.titlebar','.tabs','.panel.active','.chat-heading','.agent-controls','.activity-card.has-activity','.messages','.model-setup-card','.model-picker-status','.tool-group','.tool-call','.queue-dock.has-items','.attachment-bar.has-items','.command-menu.open','.scroll-latest:not([hidden])','.composer','.picker.open .picker-menu','.settings-panel.open','.orb-mode','.orb-status','.orb-history-button','.edge-mode'];
          const boxes = selectors.flatMap((selector) => [...document.querySelectorAll(selector)].map((element) => {
            const rect = element.getBoundingClientRect();
            const visible = rect.width > 0 && rect.height > 0 && getComputedStyle(element).display !== 'none';
            return { selector, visible, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
          })).filter((item) => item.visible);
          const tolerance = 1;
          const offenders = boxes.filter((box) => box.left < -tolerance || box.top < -tolerance || box.right > innerWidth + tolerance || box.bottom > innerHeight + tolerance);
          const semantic = {
            toolGroups: document.querySelectorAll('.tool-group').length,
            toolCalls: document.querySelectorAll('.tool-call').length,
            historicalReasoning: document.querySelectorAll('.reasoning-bubble').length,
            markdownLists: document.querySelectorAll('#messages ul, #messages ol').length,
            footer: document.querySelectorAll('footer').length,
            titlebarTabs: document.querySelectorAll('.titlebar > .tabs').length,
            setupInToolbar: document.querySelector('#agentControls')?.parentElement?.classList.contains('chat-heading') || false,
            focusMode: document.body.classList.contains('focus-chat'),
            focusChromeHidden: ['.titlebar','.chat-heading','.activity-card','.settings-panel'].every((selector) => getComputedStyle(document.querySelector(selector)).display === 'none'),
            commandRows: document.querySelectorAll('.command-row').length,
            commandAboveComposer: !document.querySelector('.command-menu.open') || document.querySelector('.command-menu.open').getBoundingClientRect().bottom <= document.querySelector('.composer').getBoundingClientRect().top + 1,
            commandFitsWidth: !document.querySelector('.command-menu.open') || document.querySelector('.command-menu.open').scrollWidth <= document.querySelector('.command-menu.open').clientWidth + 1,
            queueRows: document.querySelectorAll('.queue-row').length,
            queueActions: document.querySelectorAll('.queue-action').length,
            queueSingleLine: [...document.querySelectorAll('.queue-row')].every((row) => row.getBoundingClientRect().height <= 40),
            queueAboveComposer: !document.querySelector('.queue-dock.has-items') || document.querySelector('.queue-dock.has-items').getBoundingClientRect().bottom <= document.querySelector('.composer').getBoundingClientRect().top + 1,
            attachmentChips: document.querySelectorAll('.attachment-chip').length,
            attachmentsAboveComposer: !document.querySelector('.attachment-bar.has-items') || document.querySelector('.attachment-bar.has-items').getBoundingClientRect().bottom <= document.querySelector('.composer').getBoundingClientRect().top + 1,
            liveBubbles: document.querySelectorAll('.live-assistant').length,
             offlineBanners: document.querySelectorAll('.offline-banner.show').length,
             startHarnessButtons: document.querySelectorAll('#offlineBanner.show #startHarnessButton').length,
             startHarnessText: document.querySelector('#startHarnessButton')?.textContent?.trim() || '',
             startHarnessButtonVisible: (() => {
               const button = document.querySelector('#startHarnessButton');
               const rect = button?.getBoundingClientRect();
               const style = button && getComputedStyle(button);
               return Boolean(rect && rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility === 'visible' && Number(style.opacity) > 0);
             })(),
             startHarnessButtonDisabled: Boolean(document.querySelector('#startHarnessButton')?.disabled),
             startHarnessTextPainted: (() => {
               const style = getComputedStyle(document.querySelector('#startHarnessButton'));
               const alpha = (color) => {
                 if (!color || color === 'transparent') return 0;
                 return color.endsWith(', 0)') ? 0 : 1;
               };
               return Number(style.opacity) > 0 && alpha(style.color) > 0 && alpha(style.webkitTextFillColor || style.color) > 0;
             })(),
             startHarnessTextWidth: (() => {
               const button = document.querySelector('#startHarnessButton');
               const range = document.createRange();
               range.selectNodeContents(button);
               return Math.round(range.getBoundingClientRect().width * 100) / 100;
             })(),
             startHarnessButtonRect: (() => {
               const rect = document.querySelector('#startHarnessButton').getBoundingClientRect();
               return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
             })(),
             headerStateText: document.querySelector('#avatarState')?.textContent || '',
            scrollLatestVisible: Boolean(document.querySelector('.scroll-latest:not([hidden])')),
            glowControl: document.querySelectorAll('#glowRange').length,
            glowIntensity: getComputedStyle(document.documentElement).getPropertyValue('--chat-glow-intensity').trim(),
            windowLayerOptions: document.querySelectorAll('#windowLayerSwitch [data-layer]').length,
            agentWorking: document.querySelectorAll('.session-card.state-working').length,
            agentIdle: document.querySelectorAll('.session-card.state-idle').length,
            agentError: document.querySelectorAll('.session-card.state-error').length,
            orbUtilityButtons: document.querySelectorAll('#orbMode > button:not(#orbRestore):not(#orbStatus)').length,
            orbNotification: document.body.classList.contains('orb-has-notification'),
            orbStatusShadow: getComputedStyle(document.querySelector('#orbStatus')).boxShadow,
            orbReplyShadow: getComputedStyle(document.querySelector('#orbHistoryButton')).boxShadow,
            edgeHitActive: document.querySelector('#edgeMode')?.classList.contains('edge-hit-active') || false,
            edgeLineWidth: Math.round(document.querySelector('.edge-line')?.getBoundingClientRect().width || 0),
            edgeHaloOpacity: getComputedStyle(document.querySelector('.edge-line'), '::before').opacity,
            brandUserSelect: getComputedStyle(document.querySelector('.brand')).userSelect,
            composerUtilitiesStacked: (() => {
              const attach = document.querySelector('#attachButton').getBoundingClientRect();
              const commands = document.querySelector('#commandsButton').getBoundingClientRect();
              return Math.abs((attach.left + attach.right - commands.left - commands.right) / 2) <= 1 && attach.bottom <= commands.top + 1;
            })(),
            contextRingSize: Math.round(document.querySelector('#contextMeter svg').getBoundingClientRect().width),
            contextUnavailable: document.querySelector('#contextMeter').classList.contains('unavailable'),
            composerTextareaWidth: Math.round(document.querySelector('#messageInput').getBoundingClientRect().width),
            sendWidth: Math.round(document.querySelector('#sendButton').getBoundingClientRect().width),
            sendHeight: Math.round(document.querySelector('#sendButton').getBoundingClientRect().height),
            modelControlLabel: document.querySelector('.model-button-copy small')?.textContent || '',
            modelControlText: document.querySelector('#modelButtonText')?.textContent || '',
            closedModelLabel: document.querySelector('#controlsPrimary')?.textContent || '',
            closedModelVisible: (() => {
              const label = document.querySelector('#controlsPrimary')?.getBoundingClientRect();
              const summary = document.querySelector('#agentControls > summary')?.getBoundingClientRect();
              return Boolean(label && summary && label.width > 0 && label.left >= summary.left && label.right <= summary.right);
            })(),
            closedModelUnclipped: (() => {
              const label = document.querySelector('#controlsPrimary');
              return Boolean(label && label.clientWidth > 0 && label.scrollWidth <= label.clientWidth + 1);
            })(),
            modelPickerActions: document.querySelectorAll('.model-picker-actions button').length,
            modelSetupCards: document.querySelectorAll('.model-setup-card').length,
            modelSetupActions: document.querySelectorAll('.model-setup-actions button').length,
            autoStartHydrated: !document.querySelector('#autoStartToggle').disabled,
            autoStartStatus: document.querySelector('#autoStartStatus').textContent,
            offlineSessionText: document.querySelector('#sessions .empty-state')?.textContent || '',
            liveCaretDisplay: getComputedStyle(document.querySelector('.live-assistant') || document.body, '::after').display,
            contextCenterDelta: (() => {
              const meter = document.querySelector('#contextMeter').getBoundingClientRect();
              const value = document.querySelector('#contextValue').getBoundingClientRect();
              return Math.round(Math.max(
                Math.abs((meter.left + meter.right - value.left - value.right) / 2),
                Math.abs((meter.top + meter.bottom - value.top - value.bottom) / 2),
              ) * 100) / 100;
            })(),
          };
          return { viewport: { width: innerWidth, height: innerHeight }, scroll: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }, boxes, offenders, semantic };
        })()`);
        audit.compactDragTrace = getDragTrace();
        audit.windowBounds = window.getBounds();
      }
      const image = await window.webContents.capturePage();
      if (auditPath) {
        const rect = audit.semantic.startHarnessButtonRect;
        let brightPixels = 0;
        if (rect?.width > 0 && rect?.height > 0) {
          const size = image.getSize();
          const x = Math.max(0, Math.min(size.width - 1, Math.floor(rect.x)));
          const y = Math.max(0, Math.min(size.height - 1, Math.floor(rect.y)));
          const width = Math.max(1, Math.min(size.width - x, Math.ceil(rect.width)));
          const height = Math.max(1, Math.min(size.height - y, Math.ceil(rect.height)));
          const bitmap = image.crop({ x, y, width, height }).toBitmap();
          for (let offset = 0; offset + 3 < bitmap.length; offset += 4) {
            if (bitmap[offset] >= 205 && bitmap[offset + 1] >= 205 && bitmap[offset + 2] >= 205 && bitmap[offset + 3] >= 205) brightPixels += 1;
          }
        }
        audit.semantic.startHarnessBrightPixels = brightPixels;
        mkdirSync(path.dirname(auditPath), { recursive: true });
        writeFileSync(auditPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
      }
      mkdirSync(path.dirname(screenshotPath), { recursive: true });
      writeFileSync(screenshotPath, image.toPNG());
      app.isQuitting = true;
      app.quit();
    }, captureDelay);
  });
}

module.exports = { attachScreenshotHarness };
