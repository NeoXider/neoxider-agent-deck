const test = require("node:test");
const assert = require("node:assert/strict");

const { UNTRUSTED_SENDER_CODE, UntrustedSenderError, createSenderCheck, denyAllPermissions } = require("../src/ipc-guard.cjs");

function fakeWindow() {
  const mainFrame = { id: "main" };
  const webContents = { mainFrame };
  return { window: { isDestroyed: () => false, webContents }, webContents, mainFrame };
}

test("only the widget window's top frame is a trusted sender", () => {
  const { window, webContents, mainFrame } = fakeWindow();
  const isTrusted = createSenderCheck(() => window);
  assert.equal(isTrusted({ sender: webContents, senderFrame: mainFrame }), true);
  assert.equal(isTrusted({ sender: webContents, senderFrame: { id: "child" } }), false, "a subframe is refused");
  assert.equal(isTrusted({ sender: {}, senderFrame: mainFrame }), false, "another window is refused");
  assert.equal(isTrusted(null), false);
});

test("a disposed frame or a missing window is never trusted", () => {
  const { window, webContents } = fakeWindow();
  const isTrusted = createSenderCheck(() => window);
  const disposed = { sender: webContents, get senderFrame() { throw new Error("Render frame was disposed"); } };
  assert.equal(isTrusted(disposed), false);
  assert.equal(createSenderCheck(() => null)({ sender: webContents }), false);
  assert.equal(createSenderCheck(() => ({ isDestroyed: () => true, webContents }))({ sender: webContents }), false);
});

test("every web permission is denied, and the refusal names its channel", () => {
  const denied = [];
  const handlers = {};
  const session = {
    setPermissionRequestHandler: (handler) => { handlers.request = handler; },
    setPermissionCheckHandler: (handler) => { handlers.check = handler; },
  };
  assert.equal(denyAllPermissions(session, (permission, kind) => denied.push(`${kind}:${permission}`)), true);
  let granted = null;
  handlers.request(null, "media", (value) => { granted = value; });
  assert.equal(granted, false);
  assert.equal(handlers.check(null, "clipboard-read"), false);
  assert.deepEqual(denied, ["request:media", "check:clipboard-read"]);
  const error = new UntrustedSenderError("send");
  assert.equal(error.code, UNTRUSTED_SENDER_CODE);
  assert.equal(error.channel, "send");
});
