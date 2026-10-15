// The sender check and the permission denial that ipc-handlers.cjs applies to every
// channel. They live apart from the handlers so the registration module has room for the
// channels themselves; ipc-handlers.cjs re-exports them for its callers.
//
// Nothing in here reaches for Electron: the window and the session arrive as parameters.

const UNTRUSTED_SENDER_CODE = "untrusted-sender";

class UntrustedSenderError extends Error {
  constructor(channel) {
    super(`Refused an IPC message on "${channel}" from an untrusted sender`);
    this.name = "UntrustedSenderError";
    this.code = UNTRUSTED_SENDER_CODE;
    this.channel = channel;
  }
}

// The widget is one window showing one local file, so the only legitimate sender is that
// window's top frame. A second window, a subframe, a webview that slipped past
// will-attach-webview, or a frame that has already been disposed are all refused before
// the handler body runs.
function createSenderCheck(getWindow) {
  return function isTrustedSender(event) {
    const target = typeof getWindow === "function" ? getWindow() : null;
    if (!target || target.isDestroyed?.()) return false;
    const contents = target.webContents;
    if (!contents || !event || event.sender !== contents) return false;
    let frame = null;
    try {
      frame = event.senderFrame;
    } catch {
      // Electron throws when the render frame is already gone. A message from a dead
      // frame cannot be attributed to anyone, so it is not trusted either.
      return false;
    }
    return !frame || !contents.mainFrame || frame === contents.mainFrame;
  };
}

// Deny by default. The renderer loads local files under `default-src 'none'` and asks for
// no web permission at all, so every request is either a bug or an injection attempt.
// The checklist's position is that this handler exists before something needs it.
function denyAllPermissions(session, onDenied = () => {}) {
  if (!session) return false;
  session.setPermissionRequestHandler?.((_contents, permission, callback) => {
    onDenied(permission, "request");
    callback(false);
  });
  session.setPermissionCheckHandler?.((_contents, permission) => {
    onDenied(permission, "check");
    return false;
  });
  return true;
}

module.exports = { UNTRUSTED_SENDER_CODE, UntrustedSenderError, createSenderCheck, denyAllPermissions };
