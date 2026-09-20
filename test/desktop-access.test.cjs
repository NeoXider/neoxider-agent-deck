const test = require("node:test");
const assert = require("node:assert/strict");
const { createDesktopAccess, desktopHarnessUrl, lanAddresses } = require("../src/desktop-access.cjs");

test("desktop links keep same-origin launch authentication and reject foreign persisted links", () => {
  assert.equal(desktopHarnessUrl("http://127.0.0.1:3080", "http://127.0.0.1:3080/?token=sample"), "http://127.0.0.1:3080/?token=sample");
  assert.equal(desktopHarnessUrl("http://127.0.0.1:3080", "http://evil.example/?token=sample"), "http://127.0.0.1:3080/");
  assert.throws(() => desktopHarnessUrl("file:///tmp/anything", ""), /Unsupported/);
});

test("phone addresses exclude public, internal and link-local interfaces", () => {
  const item = (address, extra = {}) => ({ address, family: "IPv4", internal: false, ...extra });
  assert.deepEqual(lanAddresses({ wifi: [item("192.168.1.115")], vpn: [item("26.1.2.3"), item("10.0.1.2")],
    other: [item("127.0.0.1", { internal: true }), item("169.254.2.3"), item("172.31.1.2"), item("172.32.1.2")] }),
  ["192.168.1.115", "10.0.1.2", "172.31.1.2"]);
});

function fixture({ enabled = false } = {}) {
  const prefs = { deviceAccessEnabled: enabled };
  const opened = [], dialogs = [], servers = [];
  let saved = 0;
  let quits = 0;
  class Tray {
    setToolTip() {}
    setContextMenu(menu) { this.menu = menu; }
    on() {}
  }
  const controller = createDesktopAccess({
    dialog: { showMessageBox: async (options) => { dialogs.push(options); return { response: 0 }; } },
    shell: { openExternal: (url) => opened.push(url) }, Menu: { buildFromTemplate: (items) => items }, Tray,
    nativeImage: { createFromPath: () => ({ resize: () => ({}) }) }, productName: "Deck",
    getPreferences: () => prefs, savePreferences: () => saved++,
    getLaunchUrl: () => "http://127.0.0.1:3080/?token=sample", harnessUrl: "http://127.0.0.1:3080",
    showWidget() {}, toggleWidget() {}, requestQuit() { quits++; }, addresses: ["192.168.1.115"],
    createServer(options) {
      const server = { options, starts: 0, closes: 0, async start() { this.starts++; }, async close() { this.closes++; } };
      servers.push(server); return server;
    },
  });
  return { controller, prefs, opened, dialogs, servers, saved: () => saved, quits: () => quits };
}

test("device access is opt-in, exposes the phone address, and stops when disabled", async () => {
  const f = fixture();
  await f.controller.ready;
  assert.equal(f.servers.length, 0);
  f.controller.tray.menu.find((item) => item.label === "Open Harness").click();
  assert.equal(f.opened[0], "http://127.0.0.1:3080/?token=sample");
  await f.controller.setEnabled(true);
  assert.equal(f.prefs.deviceAccessEnabled, true);
  assert.equal(f.servers[0].starts, 1);
  assert.deepEqual(f.servers[0].options.allowedHosts, ["localhost", "127.0.0.1", "192.168.1.115"]);
  assert.ok(f.controller.tray.menu.some((item) => item.label === "Phone: http://192.168.1.115:3099"));
  assert.equal(await f.servers[0].options.approveDevice({ address: "192.168.1.20", userAgent: "Phone", code: "123456" }), false);
  assert.match(f.dialogs[0].detail, /123456/);
  assert.equal(f.dialogs[0].defaultId, 0);
  await f.controller.setEnabled(false);
  assert.equal(f.servers[0].closes, 1);
  assert.equal(f.prefs.deviceAccessEnabled, false);
  assert.equal(f.saved(), 2);
  f.controller.tray.menu.find((item) => item.label === "Quit").click();
  assert.equal(f.quits(), 1);
  await f.controller.dispose();
});

test("saved opt-in starts on launch and shutdown closes access", async () => {
  const f = fixture({ enabled: true });
  await f.controller.ready;
  assert.equal(f.servers[0].starts, 1);
  assert.equal(f.saved(), 0);
  await f.controller.dispose();
  assert.equal(f.servers[0].closes, 1);
  assert.equal(await f.servers[0].options.approveDevice({ address: "127.0.0.1", code: "654321" }), false);
});
