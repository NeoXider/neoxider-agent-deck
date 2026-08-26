const SELECT_SCHEME = "neoxider-region";

function finiteBounds(value) {
  if (!value || typeof value !== "object") return null;
  const bounds = Object.fromEntries(["x", "y", "width", "height"].map((key) => [key, Number(value[key])]));
  return Object.values(bounds).every(Number.isFinite) && bounds.width > 0 && bounds.height > 0 ? bounds : null;
}

function overlayMarkup() {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
  <style>
    * { box-sizing: border-box; user-select: none; }
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; cursor: crosshair; }
    body { background: rgba(4, 8, 16, .34); font: 13px system-ui, sans-serif; }
    #selection {
      position: fixed;
      display: none;
      border: 1px solid rgba(102, 236, 220, .98);
      background: rgba(56, 210, 196, .08);
      box-shadow: 0 0 0 99999px rgba(3, 7, 14, .42), 0 0 18px rgba(79, 223, 210, .72);
      pointer-events: none;
    }
    #hint {
      position: fixed;
      left: 50%;
      top: 22px;
      transform: translateX(-50%);
      padding: 7px 11px;
      border: 1px solid rgba(255, 255, 255, .16);
      border-radius: 10px;
      color: rgba(255, 255, 255, .9);
      background: rgba(7, 10, 18, .76);
      box-shadow: 0 8px 28px rgba(0, 0, 0, .3);
      pointer-events: none;
    }
  </style>
</head>
<body>
  <div id="selection"></div>
  <div id="hint">Drag to capture · Esc to cancel</div>
  <script>
    (() => {
      const selection = document.getElementById("selection");
      let start = null;

      const clamp = (value, max) => Math.max(0, Math.min(max, value));
      const rectFor = (point) => {
        const x = Math.min(start.x, point.x);
        const y = Math.min(start.y, point.y);
        return { x, y, width: Math.abs(point.x - start.x), height: Math.abs(point.y - start.y) };
      };
      const pointFor = (event) => ({
        x: clamp(Math.round(event.clientX), window.innerWidth),
        y: clamp(Math.round(event.clientY), window.innerHeight),
      });
      const draw = (rect) => {
        selection.style.display = "block";
        selection.style.left = rect.x + "px";
        selection.style.top = rect.y + "px";
        selection.style.width = rect.width + "px";
        selection.style.height = rect.height + "px";
      };

      addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        start = pointFor(event);
        document.body.setPointerCapture?.(event.pointerId);
        draw({ x: start.x, y: start.y, width: 0, height: 0 });
        event.preventDefault();
      });
      addEventListener("pointermove", (event) => {
        if (!start) return;
        draw(rectFor(pointFor(event)));
      });
      addEventListener("pointerup", (event) => {
        if (!start || event.button !== 0) return;
        const rect = rectFor(pointFor(event));
        start = null;
        const query = new URLSearchParams(rect).toString();
        location.href = rect.width > 0 && rect.height > 0
          ? "${SELECT_SCHEME}://select/?" + query
          : "${SELECT_SCHEME}://cancel/";
      });
      addEventListener("keydown", (event) => {
        if (event.key === "Escape") location.href = "${SELECT_SCHEME}://cancel/";
      });
      addEventListener("contextmenu", (event) => event.preventDefault());
    })();
  </script>
</body>
</html>`;
}

function displayFromContract(screen, displays) {
  if (!Array.isArray(displays) || displays.length === 0) return null;
  const cursor = screen?.getCursorScreenPoint?.();
  const nearest = cursor && screen?.getDisplayNearestPoint?.(cursor);
  const candidate = nearest && displays.find((display) => String(display.id) === String(nearest.id));
  return candidate || displays.find((display) => String(display.id) === String(screen?.getPrimaryDisplay?.()?.id)) || displays[0];
}

function parseSelection(target, display) {
  let url;
  try {
    url = new URL(target);
  } catch {
    return null;
  }
  if (url.protocol !== `${SELECT_SCHEME}:` || url.hostname !== "select") return null;
  const local = finiteBounds(Object.fromEntries(["x", "y", "width", "height"].map((key) => [key, url.searchParams.get(key)])));
  if (!local) return null;
  const displayBounds = finiteBounds(display.bounds);
  if (!displayBounds) return null;
  const x = Math.max(0, Math.min(displayBounds.width, Math.round(local.x)));
  const y = Math.max(0, Math.min(displayBounds.height, Math.round(local.y)));
  const width = Math.min(Math.round(local.width), displayBounds.width - x);
  const height = Math.min(Math.round(local.height), displayBounds.height - y);
  if (width < 1 || height < 1) return null;
  return {
    displayId: display.id,
    bounds: { x: displayBounds.x + x, y: displayBounds.y + y, width, height },
  };
}

function createRegionSelector({ BrowserWindow, screen, platform = process.platform } = {}) {
  if (typeof BrowserWindow !== "function") throw new TypeError("BrowserWindow is required");
  if (!screen?.getAllDisplays) throw new TypeError("Electron screen is required");
  let active = null;

  function cancelActive(reason = "replaced") {
    if (active) active.cancel(reason);
  }

  async function selectRegion(contract = {}) {
    if (platform !== "win32") return { canceled: true, reason: "region-selection-unsupported-on-platform" };
    if (active) return { canceled: true, reason: "selection-already-active" };

    const contractDisplays = Array.isArray(contract.displays) && contract.displays.length
      ? contract.displays
      : screen.getAllDisplays().map(({ id, bounds, scaleFactor }) => ({ id, bounds: { ...bounds }, scaleFactor }));
    const display = displayFromContract(screen, contractDisplays);
    const displayBounds = finiteBounds(display?.bounds);
    if (!display || !displayBounds) return { canceled: true, reason: "no-displays" };

    return new Promise((resolve) => {
      let settled = false;
      const window = new BrowserWindow({
        ...displayBounds,
        show: false,
        frame: false,
        transparent: true,
        backgroundColor: "#00000000",
        hasShadow: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        focusable: true,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          devTools: false,
        },
      });

      const clean = () => {
        window.removeListener("ready-to-show", onReady);
        window.removeListener("closed", onClosed);
        window.webContents?.removeListener?.("will-navigate", onNavigate);
        window.webContents?.removeListener?.("before-input-event", onInput);
      };
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clean();
        if (active?.window === window) active = null;
        try {
          if (!window.isDestroyed?.()) window.destroy();
        } catch {}
        resolve(result);
      };
      const cancel = (reason = "canceled") => finish({ canceled: true, reason });
      const onReady = () => {
        if (settled) return;
        window.setBounds?.(displayBounds, false);
        window.setAlwaysOnTop?.(true, "screen-saver");
        window.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true });
        window.show?.();
        window.focus?.();
      };
      const onClosed = () => cancel("window-closed");
      const onInput = (_event, input) => {
        if (input?.type === "keyDown" && input.key === "Escape") cancel("canceled");
      };
      const onNavigate = (event, target) => {
        if (!String(target).startsWith(`${SELECT_SCHEME}:`)) return;
        event.preventDefault?.();
        let url;
        try {
          url = new URL(target);
        } catch {
          cancel("invalid-selection");
          return;
        }
        if (url.hostname === "cancel") {
          cancel("canceled");
          return;
        }
        const result = parseSelection(target, display);
        result ? finish(result) : cancel("invalid-selection");
      };

      active = { window, cancel };
      window.once("ready-to-show", onReady);
      window.once("closed", onClosed);
      window.webContents?.on?.("will-navigate", onNavigate);
      window.webContents?.on?.("before-input-event", onInput);
      const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(overlayMarkup())}`;
      try {
        Promise.resolve(window.loadURL(dataUrl)).catch(() => cancel("overlay-load-failed"));
      } catch {
        cancel("overlay-load-failed");
      }
    });
  }

  selectRegion.dispose = () => cancelActive("disposed");
  selectRegion.isActive = () => Boolean(active);
  return selectRegion;
}

module.exports = { createRegionSelector, displayFromContract, finiteBounds, parseSelection };
