const { spawn } = require("node:child_process");
const { mkdirSync, readFileSync, rmSync, statSync } = require("node:fs");
const path = require("node:path");

const electron = require("electron");
const root = path.resolve(__dirname, "..");
const output = path.join(root, "tmp", "ui-smoke");

const cases = [
  { name: "overview", fixture: "overview" },
  { name: "chat", tab: "chat", fixture: "chat" },
  { name: "model", tab: "chat", fixture: "model" },
  { name: "markdown-tools", tab: "chat", fixture: "markdown-tools" },
  { name: "thinking-chat", tab: "chat", fixture: "thinking" },
  { name: "writing-chat", tab: "chat", fixture: "writing" },
  { name: "tool-chat", tab: "chat", fixture: "tool" },
  { name: "thinking-orb", tab: "chat", fixture: "thinking", mode: "orb" },
  { name: "edge", mode: "edge" },
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
    if (audit.scroll.width !== audit.viewport.width || audit.scroll.height !== audit.viewport.height) {
      throw new Error(`${testCase.name} viewport scroll mismatch: ${JSON.stringify(audit.scroll)} vs ${JSON.stringify(audit.viewport)}`);
    }
    if (audit.offenders.length) throw new Error(`${testCase.name} has clipped UI: ${JSON.stringify(audit.offenders)}`);
    process.stdout.write(`✓ ${testCase.name} ${audit.viewport.width}x${audit.viewport.height}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
