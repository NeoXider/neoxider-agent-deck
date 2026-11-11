// Keeps a fullscreen game in front while its player uses the widget.
//
// The widget sits above fullscreen windows, and a click on it used to make it the active
// window. A game that minimises itself when it loses focus (many borderless-fullscreen ones
// do) dropped to the taskbar on the first press of a button in the widget. While a fullscreen
// application is in the foreground the widget's window is therefore made non-focusable:
// buttons, scrolling and switching chats work, and the game keeps the focus. Typing needs
// the keyboard, and Windows gives the keyboard only to the active window, so a click in a
// text field (or a shortcut that opens the widget) takes the focus on purpose, knowing the
// game may step aside for it.
//
// Two things here were found by trying them against a stand-in game (a fullscreen window
// that minimises on blur) with real clicks:
//
//  - Electron cannot say whether a fullscreen application is in front. Windows can
//    (SHQueryUserNotificationState, the call that decides whether notifications are held
//    back for a game or a presentation), so a small PowerShell watcher asks it and prints
//    each change. It runs only on Windows, only while the widget is on a layer above other
//    windows and the preference is on, and it ends with the widget.
//
//  - BrowserWindow.setFocusable() ends by handing the foreground to the next window in the
//    z-order whenever the window is visible, which took it from the game 8 ms after the
//    call. A hidden window is exempt, so the switch is made between a hide() and a
//    showInactive(), four milliseconds apart; the game never notices. Setting
//    WS_EX_NOACTIVATE from outside is not enough either: Chromium answers a click by its
//    own flag and activates the window anyway.

const { spawn: nodeSpawn } = require("node:child_process");
const path = require("node:path");

// QUNS_BUSY (a fullscreen application), QUNS_RUNNING_D3D_FULL_SCREEN, QUNS_PRESENTATION_MODE.
const FULLSCREEN_STATES = new Set([2, 3, 4]);
const POLL_MS = 400;

function watcherScript(ownerPid) {
  return [
    "$ErrorActionPreference = 'Stop'",
    "$shell = Add-Type -PassThru -Namespace NeoXiderDeck -Name Shell -MemberDefinition '[DllImport(\"shell32.dll\")] public static extern int SHQueryUserNotificationState(out int state);'",
    `$owner = ${Number(ownerPid) || 0}`,
    "$last = -1; $tick = 0",
    "while ($true) {",
    "  $state = 0; [void]$shell::SHQueryUserNotificationState([ref]$state)",
    "  if ($state -ne $last) { $last = $state; [Console]::Out.WriteLine($state); [Console]::Out.Flush() }",
    "  $tick++",
    "  if ($tick % 12 -eq 0 -and $owner -gt 0 -and -not (Get-Process -Id $owner -ErrorAction SilentlyContinue)) { break }",
    `  Start-Sleep -Milliseconds ${POLL_MS}`,
    "}",
  ].join("\n");
}

function powershellPath(env = process.env) {
  return env.SystemRoot ? path.win32.join(env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe") : "powershell.exe";
}

// Starts the watcher and reports each state it prints. Never throws: a machine where
// PowerShell cannot start simply never reports a fullscreen application.
function startNotificationWatcher({ spawn = nodeSpawn, env = process.env, pid = process.pid, onState = () => {}, onExit = () => {} } = {}) {
  let child;
  try {
    const encoded = Buffer.from(watcherScript(pid), "utf16le").toString("base64");
    child = spawn(powershellPath(env), ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    onExit();
    return { stop() {} };
  }
  let buffered = "";
  let stopped = false;
  child.stdout?.on("data", (chunk) => {
    buffered += String(chunk);
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop();
    for (const line of lines) {
      const state = /^\d+$/.test(line.trim()) ? Number(line.trim()) : null;
      if (state !== null && !stopped) onState(state);
    }
  });
  const ended = () => { if (!stopped) { stopped = true; onExit(); } };
  child.on?.("error", ended);
  child.on?.("exit", ended);
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      try { child.kill(); } catch { /* already gone */ }
    },
  };
}

// Changes whether the window can be focused without touching the foreground: Electron only
// leaves the foreground alone when the window is hidden at the time.
function setFocusableQuietly(windowRef, focusable) {
  const visible = windowRef.isVisible();
  if (visible) windowRef.hide();
  windowRef.setFocusable(focusable);
  if (visible) windowRef.showInactive();
}

function createFullscreenGuard({
  platform = process.platform,
  getWindow,
  isEnabled = () => true,
  getLayer = () => "above",
  restoreTaskbar = () => {},
  startWatcher = startNotificationWatcher,
} = {}) {
  if (typeof getWindow !== "function") throw new TypeError("getWindow must be a function");
  let watcher = null;
  let fullscreen = false;
  let guarding = false;
  let attached = null;

  const liveWindow = () => {
    const windowRef = getWindow();
    return windowRef && !windowRef.isDestroyed?.() ? windowRef : null;
  };
  // "normal" is the desktop layer: every window covers the widget there, a game included.
  const wanted = () => platform === "win32" && Boolean(isEnabled()) && getLayer() !== "normal";

  function setGuarding(next) {
    const windowRef = liveWindow();
    if (!windowRef || next === guarding) return;
    guarding = next;
    setFocusableQuietly(windowRef, !next);
    // setFocusable also decides the window's place in the taskbar; put that back.
    restoreTaskbar(windowRef);
  }

  // The window stops taking focus only while it does not have it: a widget the user is
  // typing in is never pulled out from under their hands.
  function apply() {
    const windowRef = liveWindow();
    if (!windowRef) return;
    setGuarding(wanted() && fullscreen && !windowRef.isFocused());
  }

  function sync() {
    if (wanted()) {
      if (!watcher) {
        const started = startWatcher({
          onState: (state) => { if (watcher === started) { fullscreen = FULLSCREEN_STATES.has(state); apply(); } },
          onExit: () => { if (watcher === started) { watcher = null; fullscreen = false; apply(); } },
        });
        watcher = started;
      }
    } else {
      watcher?.stop();
      watcher = null;
      fullscreen = false;
    }
    apply();
    return Boolean(watcher);
  }

  // The user asked for the keyboard: a click in a text field, or a shortcut that opens the
  // widget. The window becomes an ordinary one again and takes the focus.
  function takeFocus() {
    const windowRef = liveWindow();
    if (!windowRef) return false;
    setGuarding(false);
    windowRef.show();
    windowRef.focus();
    return true;
  }

  function attach(windowRef = getWindow()) {
    if (windowRef !== attached) {
      attached?.removeListener?.("blur", apply);
      attached = windowRef || null;
      guarding = false;
      attached?.on?.("blur", apply);
    }
    return sync();
  }

  function stop() {
    watcher?.stop();
    watcher = null;
    fullscreen = false;
    attached?.removeListener?.("blur", apply);
    attached = null;
  }

  return Object.freeze({ attach, sync, stop, takeFocus, isGuarding: () => guarding });
}

module.exports = { FULLSCREEN_STATES, createFullscreenGuard, setFocusableQuietly, startNotificationWatcher, watcherScript };
