const path = require("node:path");
const { networkInterfaces } = require("node:os");
const { createDeviceAccessServer } = require("./device-access.cjs");

function desktopHarnessUrl(harnessUrl, launchUrl) {
  const base = new URL(harnessUrl);
  if (!["http:", "https:"].includes(base.protocol)) throw new Error("Unsupported Harness URL");
  try {
    const launch = new URL(launchUrl);
    if (launch.origin === base.origin) return launch.href;
  } catch {}
  return base.href;
}

function lanAddresses(interfaces = networkInterfaces()) {
  return [...new Set(Object.values(interfaces).flat().filter((item) => item && !item.internal
    && item.family === "IPv4" && /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(item.address))
    .map((item) => item.address))].sort((a, b) => Number(b.startsWith("192.168.")) - Number(a.startsWith("192.168.")));
}

function createDesktopAccess({ app, dialog, shell, Menu, Tray, nativeImage, productName,
  getPreferences, savePreferences, getLaunchUrl, harnessUrl, showWidget, toggleWidget, requestQuit,
  createServer = createDeviceAccessServer, addresses = lanAddresses(), port = 3099 }) {
  const icon = nativeImage.createFromPath(path.join(__dirname, "renderer", "assets", "neoxider-github.png")).resize({ width: 32, height: 32 });
  const tray = new Tray(icon);
  tray.setToolTip(productName);
  let server = null;
  let starting = false;
  let disposed = false;
  let generation = 0;
  const openHarness = () => shell.openExternal(desktopHarnessUrl(harnessUrl, getLaunchUrl()));
  async function approveDevice({ address, userAgent, code }) {
    const result = await dialog.showMessageBox({
      type: "question", title: "Agent Deck — доступ устройства",
      message: "Разрешить этому устройству доступ к DeepSeek Harness?",
      detail: `Код: ${code}\nАдрес: ${address}\nБраузер: ${String(userAgent || "Unknown").slice(0, 180)}\n\nСверь код на телефоне. Доступ позволит читать чаты и запускать действия агента на этом компьютере.`,
      buttons: ["Отклонить", "Разрешить"], defaultId: 0, cancelId: 0, noLink: true,
    });
    return !disposed && result.response === 1;
  }
  function menu() {
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "Show widget", click: showWidget },
      { label: "Open Harness", click: openHarness },
      { label: "Device access on Wi-Fi", type: "checkbox", checked: Boolean(server), enabled: !starting,
        click: (item) => setEnabled(item.checked) },
      ...(server ? [{ label: "Open device sign-in", click: () => shell.openExternal(`http://127.0.0.1:${port}/`) },
        ...addresses.map((ip) => ({ label: `Phone: http://${ip}:${port}`, click: () => shell.openExternal(`http://${ip}:${port}/`) }))] : []),
      { type: "separator" }, { label: "Quit", click: requestQuit },
    ]));
  }
  async function setEnabled(enabled, persist = true) {
    const run = ++generation;
    if (persist) { getPreferences().deviceAccessEnabled = Boolean(enabled); savePreferences(); }
    if (server) { await server.close(); server = null; }
    if (!enabled || disposed) { if (!disposed) menu(); return; }
    starting = true;
    menu();
    const candidate = createServer({ upstreamUrl: harnessUrl, getLaunchUrl, approveDevice,
      host: "0.0.0.0", port, allowedHosts: ["localhost", "127.0.0.1", ...addresses] });
    try {
      await candidate.start();
      if (disposed || run !== generation) await candidate.close();
      else server = candidate;
    } catch (error) {
      await candidate.close();
      if (!disposed) await dialog.showMessageBox({ type: "error", title: "Agent Deck",
        message: "Не удалось включить доступ устройств", detail: `Порт ${port}: ${error.code || "ошибка запуска"}. DSH продолжает работать по основному адресу.` });
    } finally { starting = false; if (!disposed) menu(); }
  }
  tray.on("double-click", toggleWidget);
  menu();
  const ready = getPreferences().deviceAccessEnabled ? setEnabled(true, false) : Promise.resolve();
  return { tray, ready, openHarness, setEnabled, dispose() { disposed = true; generation++; return server?.close(); } };
}

module.exports = { createDesktopAccess, desktopHarnessUrl, lanAddresses };
