const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { app, BrowserWindow, ipcMain } = require("electron");

// Use the real renderer and Chromium layout: a mocked DOM cannot reproduce the
// flex shrinking that hid attachment previews beneath a multiline composer.
app.disableHardwareAcceleration();
const root = path.resolve(__dirname, "..");
const deadline = setTimeout(() => { console.error("Attachment layout smoke timed out"); app.exit(1); }, 60000);

async function main() {
  await app.whenReady();
  for (const [channel, result] of Object.entries({
    "get-preferences": {}, "app-info": { version: "test" },
    "get-update-state": { status: "idle" }, "set-compact-status": {},
    "set-last-selected-session": null,
  })) ipcMain.handle(channel, () => result);

  const win = new BrowserWindow({
    width: 420, height: 640, show: false, frame: false,
    webPreferences: {
      preload: path.join(root, "src", "preload.cjs"),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      backgroundThrottling: false, offscreen: true,
    },
  });
  win.webContents.on("paint", () => {});
  await win.webContents.debugger.attach("1.3");
  const reports = [];
  for (const reducedMotion of [false, true]) {
    for (const [width, height, fixture] of [[420, 640, "attachments"], [360, 360, "attachments"], [360, 360, "crowded-chat"]]) {
      win.setContentSize(width, height);
      await win.loadFile(path.join(root, "src", "renderer", "index.html"), { query: { screenshotFixture: fixture } });
      await win.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-reduced-motion", value: reducedMotion ? "reduce" : "no-preference" }],
      });
      await new Promise(resolve => setTimeout(resolve, 500));
      const report = await win.webContents.executeJavaScript(`(async () => {
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
        const input = document.querySelector('#messageInput');
        const list = document.querySelector('#attachmentList');
        const bar = document.querySelector('#attachmentBar');
        const original = state.pendingAttachments[0];
        state.pendingAttachments = [];
        renderAttachments();
        await wait(250);
        state.pendingAttachments = Array.from({ length:12 }, (_, i) => ({ ...original, path:'fixture-'+i, name:'File '+i+'.png' }));
        renderAttachments();
        const samples = [];
        for (let i = 0; i < 10; i++) {
          input.value = 'Long prompt with attachments. '.repeat(i * 20);
          input.dispatchEvent(new Event('input', { bubbles:true }));
          await wait(30);
          const bounds = bar.getBoundingClientRect();
          const preview = list.querySelector('.attachment-preview').getBoundingClientRect();
          const remove = list.querySelector('.attachment-remove').getBoundingClientRect();
          samples.push({ bar:bounds.height, preview:preview.height, previewInside:preview.top >= bounds.top && preview.bottom <= bounds.bottom + 1, removeInside:remove.top >= bounds.top && remove.bottom <= bounds.bottom + 1 });
        }
        list.scrollLeft = 170;
        await wait(200);
        const scrollBefore = list.scrollLeft;
        const first = list.firstElementChild;
        const focused = list.children[1].querySelector('.attachment-remove');
        focused.focus({ preventScroll:true });
        renderAttachments();
        const stableNode = first === list.firstElementChild;
        const stableFocus = document.activeElement === focused;
        const stableScroll = Math.abs(list.scrollLeft - scrollBefore) <= 1;
        // After one removal the reused button must resolve its current index.
        first.querySelector('.attachment-remove').click();
        focused.click();
        const correctRemoval = state.pendingAttachments.length === 10 && state.pendingAttachments[0].path === 'fixture-2';
        const focusedAfterRemoval = document.activeElement === list.firstElementChild.querySelector('.attachment-remove');
        state.pendingAttachments = [];
        renderAttachments();
        const emptyHidden = getComputedStyle(bar).display === 'none';
        return { samples, stableNode, stableFocus, stableScroll, correctRemoval, focusedAfterRemoval, emptyHidden, reducedMotion:matchMedia('(prefers-reduced-motion:reduce)').matches };
      })()`);
      assert.equal(report.reducedMotion, reducedMotion);
      for (const key of ["stableNode", "stableFocus", "stableScroll", "correctRemoval", "focusedAfterRemoval", "emptyHidden"]) {
        assert.equal(report[key], true, `${fixture} ${width}x${height}: ${key}`);
      }
      for (const sample of report.samples) {
        assert.ok(sample.bar >= 30, `Attachment strip collapsed: ${JSON.stringify(sample)}`);
        assert.ok(sample.preview >= 22 && sample.previewInside && sample.removeInside,
          `Attachment preview or removal button clipped: ${JSON.stringify(sample)}`);
      }
      reports.push({ width, height, fixture, reducedMotion, minimumHeight: Math.min(...report.samples.map(sample => sample.bar)) });
    }
  }
  fs.mkdirSync(path.join(root, "tmp"), { recursive: true });
  fs.writeFileSync(path.join(root, "tmp", "attachment-layout-smoke.json"), JSON.stringify(reports, null, 2));
  console.log(`PASS attachment previews, controls, focus and horizontal scroll remain stable: ${JSON.stringify(reports)}`);
  win.destroy();
  clearTimeout(deadline);
  app.exit(0);
}

main().catch(error => { console.error(error); clearTimeout(deadline); app.exit(1); });
