const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

app.disableHardwareAcceleration();
app.commandLine.appendSwitch("force-prefers-no-reduced-motion");
const deadline = setTimeout(() => { console.error("Disclosure motion smoke timed out"); app.exit(1); }, 30000);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 600, height: 800, webPreferences: { backgroundThrottling: false, offscreen: true } });
  win.webContents.on("paint", () => {});
  const css = ["styles.css", "appearance.css"].map(file => fs.readFileSync(path.join(__dirname, "../src/renderer", file), "utf8")).join("\n");
  const html = `<style>${css}\nbody{padding:20px;overflow:auto}details{width:350px;margin-bottom:12px} .fixture-body{height:120px;background:#182838}</style>
    <details class="goal-dock"><summary>Goal</summary><div class="fixture-body">Objective</div></details>
    <details class="agent-controls"><summary>Setup</summary><div class="fixture-body">Model and workspace</div></details>
    <details class="tool-call"><summary>Tool output</summary><div class="fixture-body">Result</div></details>`;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  const result = await win.webContents.executeJavaScript(`(async () => {
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const reports = [];
    await wait(400);
    for (const item of document.querySelectorAll('details')) {
      const height = () => item.getBoundingClientRect().height;
      const closed = height();
      if (item.classList.contains('agent-controls')) item.dataset.disclosureMoving = '1';
      item.open = true;
      const opening = [height()];
      for (let i = 0; i < 8; i++) { await wait(35); opening.push(height()); }
      const full = height();
      item.open = false;
      const closing = [height()];
      for (let i = 0; i < 8; i++) { await wait(35); closing.push(height()); }
      item.open = true;
      await wait(60);
      item.open = false;
      await wait(40);
      item.open = true;
      await wait(280);
      delete item.dataset.disclosureMoving;
      reports.push({ name:item.className, closed, full, opening, closing, reopened:height(), overflow:getComputedStyle(item,'::details-content').overflow });
    }
    return reports;
  })()`);
  const failures = [];
  for (const report of result) {
    const intermediate = samples => samples.some(height => height > report.closed + 2 && height < report.full - 2);
    const monotonic = (samples, sign) => samples.every((height, index) => index === 0 || (height - samples[index - 1]) * sign >= -1);
    if (report.full < report.closed + 100 || !intermediate(report.opening) || !intermediate(report.closing)
        || !monotonic(report.opening, 1) || !monotonic(report.closing, -1)
        || Math.abs(report.closing.at(-1) - report.closed) > 1 || Math.abs(report.reopened - report.full) > 1
        || (report.name === "agent-controls" && report.overflow !== "visible")) failures.push(report);
  }
  if (failures.length) throw new Error(`Disclosure motion snapped, overshot, or failed to reverse: ${JSON.stringify(failures)}`);
  console.log(`PASS Goal, Setup and tool drawers animate both ways, reverse cleanly, and restore menu overflow: ${JSON.stringify(result.map(({ name, closed, full }) => ({ name, closed, full })))}`);
  win.destroy();
  clearTimeout(deadline);
  app.quit();
}).catch(error => { console.error(error); clearTimeout(deadline); app.exit(1); });
