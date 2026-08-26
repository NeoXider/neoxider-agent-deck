// Physical-input regression for the two compact-mode gestures that broke:
//   1. a click on the brand avatar must collapse the widget to the orb;
//   2. releasing the edge handle after a drag must NOT restore the full widget.
// Both are driven with real sendInputEvent mouse events, because both bugs live in
// the pointer-capture / click ordering that synthetic click() calls cannot reproduce.
const path = require("node:path");
const { app, BrowserWindow, ipcMain } = require("electron");

const root = path.resolve(__dirname, "..");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Minimal stand-ins for the main process, so the renderer runs its real code path
// instead of silently failing on a missing handler.
let currentMode = "full";
const sentPayloads = [];
const openedSessionIds = [];
function registerStubs() {
  ipcMain.handle("set-window-mode", (_event, mode) => {
    currentMode = mode;
    return mode;
  });
  ipcMain.handle("end-compact-drag", () => ({ side: "right" }));
  ipcMain.handle("end-full-drag", () => null);
  ipcMain.handle("app-info", () => ({ version: "0.0.0-test" }));
  ipcMain.handle("set-compact-status", () => null);
  ipcMain.handle("get-preferences", () => ({}));
  ipcMain.handle("send", (_event, payload) => {
    sentPayloads.push(payload);
    return { sessionId: payload.sessionId };
  });
  ipcMain.handle("dashboard", () => ({ harness: true, sessions: [
    { sessionId: "demo-build", title: "Build review", updatedAt: 3, running: false, preview: "Windows package passed." },
    { sessionId: "demo-unity", title: "Unity gameplay", updatedAt: 2, running: false, preview: "Play Mode passed." },
    { sessionId: "demo-mcp", title: "Capability Hub", updatedAt: 1, running: false, preview: "Dynamic routing passed." },
  ] }));
  ipcMain.handle("history", (_event, sessionId) => {
    openedSessionIds.push(sessionId);
    return [];
  });
  ipcMain.handle("models", () => ({ providers: [] }));
  ipcMain.handle("commands", () => []);
  ipcMain.handle("workspaces", () => []);
  ipcMain.handle("get-queue", () => []);
  for (const channel of ["begin-compact-drag", "move-compact-drag", "begin-full-drag", "move-full-drag", "set-edge-pointer-active", "agent-complete"]) {
    ipcMain.on(channel, () => {});
  }
}

async function mode(contents) {
  return contents.executeJavaScript("document.body.className");
}

function click(contents, x, y) {
  contents.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
  contents.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
}

async function centerOf(contents, selector) {
  return contents.executeJavaScript(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
}

async function hitAt(contents, point) {
  return contents.executeJavaScript(`(() => {
    const point = ${JSON.stringify(point)};
    const target = document.elementFromPoint(point.x, point.y);
    return {
      target: target?.className?.baseVal || target?.className || target?.tagName || null,
      body: document.body.className,
      active: document.activeElement?.id || document.activeElement?.className || document.activeElement?.tagName || null,
    };
  })()`);
}

async function main() {
  await app.whenReady();
  registerStubs();
  const win = new BrowserWindow({
    width: 420,
    height: 640,
    show: false,
    webPreferences: {
      preload: path.join(root, "src", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const contents = win.webContents;
  await win.loadFile(path.join(root, "src", "renderer", "index.html"), {
    query: { screenshotFixture: "chat", screenshotStatic: "1" },
  });
  await wait(1200);

  const failures = [];

  // --- 1. avatar click must collapse to orb -------------------------------
  const avatar = await centerOf(contents, "#avatarButton");
  if (!avatar) throw new Error("avatarButton not found");
  currentMode = "full";
  click(contents, avatar.x, avatar.y);
  await wait(500);
  if (currentMode !== "orb") {
    failures.push(`avatar click did not collapse to orb (mode stayed "${currentMode}")`);
  }

  // Back to full for the next case.
  await contents.executeJavaScript('document.body.className = "mode-full"');
  await wait(200);

  // --- 2. dragging the edge handle must not restore the widget ------------
  await contents.executeJavaScript('document.body.className = "mode-edge side-right"');
  currentMode = "edge";
  await wait(300);
  const line = await centerOf(contents, "#edgeMode .edge-line");
  if (!line) throw new Error("edge line not found");
  contents.sendInputEvent({ type: "mouseDown", x: line.x, y: line.y, button: "left", clickCount: 1 });
  for (let step = 1; step <= 6; step += 1) {
    contents.sendInputEvent({ type: "mouseMove", x: line.x, y: line.y + step * 9, button: "left" });
    await wait(30);
  }
  contents.sendInputEvent({ type: "mouseUp", x: line.x, y: line.y + 54, button: "left", clickCount: 1 });
  await wait(600);
  if (currentMode === "full") {
    failures.push("releasing the edge handle after a drag restored the widget");
  }

  // --- 3. a per-session chat icon replies inline without restoring full --
  await win.loadFile(path.join(root, "src", "renderer", "index.html"), {
    query: { screenshotFixture: "orb-recent-three", screenshotStatic: "1" },
  });
  await wait(1200);
  await contents.executeJavaScript(`(() => {
    document.body.classList.remove("mode-full", "mode-edge", "side-left");
    document.body.classList.add("mode-orb", "side-right");
  })()`);
  currentMode = "orb";
  const reply = await centerOf(contents, ".orb-session-row:first-child .orb-session-reply");
  if (!reply) throw new Error("quick reply button not found");
  const replyHit = await hitAt(contents, reply);
  click(contents, reply.x, reply.y);
  await wait(350);
  const quickReplyState = await contents.executeJavaScript(`(() => {
    const input = document.querySelector('#orbReplyInput');
    const rect = input.getBoundingClientRect();
    return { visible: rect.width > 0 && rect.height > 0, focused: document.activeElement === input };
  })()`);
  if (currentMode !== "orb") failures.push("quick reply restored the full widget");
  if (!quickReplyState.visible || !quickReplyState.focused) failures.push(`quick reply input was not visible and focused; hit=${JSON.stringify(replyHit)}`);
  contents.insertText("Reply from the pet");
  contents.sendInputEvent({ type: "keyDown", keyCode: "ENTER" });
  contents.sendInputEvent({ type: "keyUp", keyCode: "ENTER" });
  await wait(600);
  if (sentPayloads.length !== 1 || sentPayloads[0]?.sessionId !== "demo-build" || sentPayloads[0]?.text !== "Reply from the pet") {
    failures.push(`quick reply routed incorrectly: ${JSON.stringify(sentPayloads)}`);
  }

  // --- 4. clicking a reply preview opens that exact session ---------------
  await win.loadFile(path.join(root, "src", "renderer", "index.html"), {
    query: { screenshotFixture: "orb-recent-three", screenshotStatic: "1" },
  });
  await wait(1200);
  await contents.executeJavaScript(`(() => {
    document.body.classList.remove("mode-full", "mode-edge", "side-left");
    document.body.classList.add("mode-orb", "side-right");
  })()`);
  currentMode = "orb";
  openedSessionIds.length = 0;
  const preview = await centerOf(contents, ".orb-session-row:first-child .orb-session-open");
  if (!preview) throw new Error("recent session preview not found");
  const previewHit = await hitAt(contents, preview);
  click(contents, preview.x, preview.y);
  await wait(600);
  if (currentMode !== "full") failures.push(`recent session preview did not restore the full widget; hit=${JSON.stringify(previewHit)}`);
  if (!openedSessionIds.includes("demo-build")) failures.push(`recent session opened the wrong id: ${JSON.stringify(openedSessionIds)}`);

  for (const failure of failures) console.error(`FAIL ${failure}`);
  if (failures.length === 0) console.log("PASS compact drag, exact-session open, and inline quick reply behave correctly");
  app.exit(failures.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
