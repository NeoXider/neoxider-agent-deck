// Measures what actually sets the resting height of the composer.
//
// "The empty input is too tall" can mean the textarea, or the controls beside it. Those
// are different fixes, so this reports each part rather than guessing which one is wrong.
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

const root = path.resolve(__dirname, "..");

app.whenReady().then(async () => {
  const window = new BrowserWindow({
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
  await window.loadFile(path.join(root, "src", "renderer", "index.html"), {
    query: { screenshotFixture: "empty-chat", screenshotStatic: "1" },
  });
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const measured = await window.webContents.executeJavaScript(`(() => {
    const box = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return {
        h: Math.round(r.height),
        w: Math.round(r.width),
        lineHeight: s.lineHeight,
        paddingY: s.paddingTop + " / " + s.paddingBottom,
      };
    };
    return {
      composer: box(".composer"),
      textarea: box("#messageInput"),
      viewStack: box(".composer-view-stack"),
      utilityStack: box(".composer-utility-stack"),
      send: box("#sendButton"),
    };
  })()`);

  console.log(JSON.stringify(measured, null, 2));
  app.exit(0);
});
