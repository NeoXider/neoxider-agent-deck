const HOTKEY_ACTIONS = Object.freeze([
  "showRestore",
  "toggleFocusChat",
  "collapseAvatar",
  "collapseEdge",
  "newSession",
  "openHarness",
  "captureDisplay",
  "captureRegion",
]);

const DEFAULT_HOTKEYS = Object.freeze({
  showRestore: Object.freeze({ enabled: true, accelerator: "CommandOrControl+Alt+Shift+Space" }),
  toggleFocusChat: Object.freeze({ enabled: true, accelerator: "CommandOrControl+Alt+Shift+F" }),
  collapseAvatar: Object.freeze({ enabled: true, accelerator: "CommandOrControl+Alt+Shift+A" }),
  collapseEdge: Object.freeze({ enabled: true, accelerator: "CommandOrControl+Alt+Shift+E" }),
  newSession: Object.freeze({ enabled: true, accelerator: "CommandOrControl+Alt+Shift+N" }),
  openHarness: Object.freeze({ enabled: true, accelerator: "CommandOrControl+Alt+Shift+H" }),
  captureDisplay: Object.freeze({ enabled: true, accelerator: "CommandOrControl+Alt+Shift+D" }),
  captureRegion: Object.freeze({ enabled: true, accelerator: "CommandOrControl+Alt+Shift+S" }),
});

const MODIFIERS = new Map([
  ["commandorcontrol", "CommandOrControl"],
  ["cmdorctrl", "CommandOrControl"],
  ["command", "Command"],
  ["cmd", "Command"],
  ["control", "Control"],
  ["ctrl", "Control"],
  ["option", "Alt"],
  ["alt", "Alt"],
  ["altgr", "AltGr"],
  ["shift", "Shift"],
  ["super", "Super"],
  ["meta", "Super"],
]);

const NAMED_KEYS = new Map(
  "Space Tab Enter Return Escape Esc Backspace Delete Insert Home End PageUp PageDown Up Down Left Right Plus VolumeUp VolumeDown VolumeMute MediaNextTrack MediaPreviousTrack MediaStop MediaPlayPause PrintScreen".split(" ")
    .map((key) => [key.toLowerCase(), key === "Esc" ? "Escape" : key === "Return" ? "Enter" : key]),
);
const MODIFIER_ORDER = new Map("CommandOrControl Command Control Alt AltGr Shift Super".split(" ").map((value, index) => [value, index]));

class HotkeyConfigurationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "HotkeyConfigurationError";
    this.code = details.code || "invalid-hotkey-configuration";
    Object.assign(this, details);
  }
}

function normalizeAccelerator(value) {
  const source = String(value || "").trim();
  if (!source) throw new HotkeyConfigurationError("Shortcut is empty", { code: "empty-accelerator" });
  const tokens = source.split("+").map((token) => token.trim()).filter(Boolean);
  const modifiers = [];
  const keys = [];
  for (const token of tokens) {
    const modifier = MODIFIERS.get(token.toLowerCase());
    if (modifier) modifiers.push(modifier);
    else keys.push(token);
  }
  if (new Set(modifiers).size !== modifiers.length) {
    throw new HotkeyConfigurationError(`Shortcut repeats a modifier: ${source}`, { code: "duplicate-modifier" });
  }
  if (keys.length !== 1) {
    throw new HotkeyConfigurationError(`Shortcut must contain exactly one key: ${source}`, { code: "invalid-key-count" });
  }
  const rawKey = keys[0];
  const lowerKey = rawKey.toLowerCase();
  const named = NAMED_KEYS.get(lowerKey);
  const functionKey = /^f(?:[1-9]|1\d|2[0-4])$/i.test(rawKey) ? rawKey.toUpperCase() : "";
  const printableKey = /^[a-z0-9]$/i.test(rawKey) ? rawKey.toUpperCase() : "";
  const key = named || functionKey || printableKey;
  if (!key) throw new HotkeyConfigurationError(`Unsupported shortcut key: ${rawKey}`, { code: "unsupported-key" });
  if (!modifiers.length && printableKey) {
    throw new HotkeyConfigurationError("Printable global shortcuts require a modifier", { code: "modifier-required" });
  }
  modifiers.sort((left, right) => MODIFIER_ORDER.get(left) - MODIFIER_ORDER.get(right));
  return [...modifiers, key].join("+");
}

function normalizeHotkeyBindings(bindings = DEFAULT_HOTKEYS) {
  const source = bindings && typeof bindings === "object" ? bindings : {};
  const unknown = Object.keys(source).filter((action) => !HOTKEY_ACTIONS.includes(action));
  if (unknown.length) {
    throw new HotkeyConfigurationError(`Unknown shortcut action: ${unknown[0]}`, { code: "unknown-action", action: unknown[0] });
  }
  const normalized = {};
  const accelerators = new Map();
  for (const action of HOTKEY_ACTIONS) {
    const fallback = DEFAULT_HOTKEYS[action];
    const configured = Object.prototype.hasOwnProperty.call(source, action) ? source[action] : fallback;
    const value = typeof configured === "string"
      ? { enabled: Boolean(configured.trim()), accelerator: configured }
      : configured === false || configured == null
        ? { enabled: false, accelerator: fallback.accelerator }
        : { enabled: configured.enabled !== false, accelerator: configured.accelerator ?? fallback.accelerator };
    const accelerator = normalizeAccelerator(value.accelerator);
    normalized[action] = { enabled: Boolean(value.enabled), accelerator };
    if (!value.enabled) continue;
    const collisionKey = accelerator.toLowerCase();
    if (accelerators.has(collisionKey)) {
      throw new HotkeyConfigurationError(`${action} conflicts with ${accelerators.get(collisionKey)}`, {
        code: "duplicate-accelerator",
        action,
        conflictingAction: accelerators.get(collisionKey),
        accelerator,
      });
    }
    accelerators.set(collisionKey, action);
  }
  return normalized;
}

function createHotkeyManager({ globalShortcut, handlers = {}, app = null, onError = () => {} } = {}) {
  if (!globalShortcut || typeof globalShortcut.register !== "function" || typeof globalShortcut.unregister !== "function") {
    throw new TypeError("Electron globalShortcut is required");
  }
  let current = {};
  let disposed = false;

  const invoke = (action) => () => {
    try {
      Promise.resolve(handlers[action]?.()).catch((error) => onError(error, action));
    } catch (error) {
      onError(error, action);
    }
  };

  const unregister = (bindings) => {
    for (const binding of Object.values(bindings)) {
      if (binding.enabled) globalShortcut.unregister(binding.accelerator);
    }
  };

  const register = (bindings) => {
    const registered = [];
    for (const action of HOTKEY_ACTIONS) {
      const binding = bindings[action];
      if (!binding?.enabled) continue;
      if (typeof handlers[action] !== "function") {
        throw new HotkeyConfigurationError(`No handler is configured for ${action}`, { code: "missing-handler", action });
      }
      let accepted = false;
      try {
        accepted = globalShortcut.register(binding.accelerator, invoke(action));
      } catch (cause) {
        throw new HotkeyConfigurationError(`Could not register ${binding.accelerator}`, { code: "registration-failed", action, accelerator: binding.accelerator, cause, registered });
      }
      if (!accepted) {
        throw new HotkeyConfigurationError(`Shortcut is unavailable: ${binding.accelerator}`, { code: "registration-conflict", action, accelerator: binding.accelerator, registered });
      }
      registered.push(binding.accelerator);
    }
    return registered;
  };

  function apply(bindings) {
    if (disposed) throw new HotkeyConfigurationError("Shortcut manager is disposed", { code: "disposed" });
    const next = normalizeHotkeyBindings(bindings);
    for (const action of HOTKEY_ACTIONS) {
      if (next[action].enabled && typeof handlers[action] !== "function") {
        throw new HotkeyConfigurationError(`No handler is configured for ${action}`, { code: "missing-handler", action });
      }
    }
    const previous = current;
    unregister(previous);
    try {
      register(next);
      current = next;
      return getBindings();
    } catch (error) {
      for (const accelerator of error.registered || []) globalShortcut.unregister(accelerator);
      try {
        register(previous);
      } catch (rollbackError) {
        for (const accelerator of rollbackError.registered || []) globalShortcut.unregister(accelerator);
        current = {};
        throw new HotkeyConfigurationError("Shortcut update failed and rollback could not be completed", {
          code: "rollback-failed",
          cause: error,
          rollbackError,
        });
      }
      current = previous;
      throw error;
    }
  }

  function applyAvailable(bindings) {
    const requested = normalizeHotkeyBindings(bindings);
    let candidate = requested;
    const conflicts = [];
    for (let attempt = 0; attempt <= HOTKEY_ACTIONS.length; attempt += 1) {
      try {
        return { requested, active: apply(candidate), conflicts };
      } catch (error) {
        if (error?.code !== "registration-conflict" || !error.action || !candidate[error.action]?.enabled) throw error;
        conflicts.push(error);
        candidate = {
          ...candidate,
          [error.action]: { ...candidate[error.action], enabled: false },
        };
      }
    }
    throw new HotkeyConfigurationError("Shortcut registration did not converge", { code: "registration-retry-limit" });
  }

  function getBindings() {
    return Object.fromEntries(Object.entries(current).map(([action, binding]) => [action, { ...binding }]));
  }

  function update(action, binding) {
    if (!HOTKEY_ACTIONS.includes(action)) {
      throw new HotkeyConfigurationError(`Unknown shortcut action: ${action}`, { code: "unknown-action", action });
    }
    const base = Object.keys(current).length ? current : normalizeHotkeyBindings();
    return apply({ ...base, [action]: binding });
  }

  function resetDefaults() {
    return apply(DEFAULT_HOTKEYS);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    unregister(current);
    current = {};
    if (app && typeof app.off === "function") app.off("will-quit", dispose);
  }

  if (app && typeof app.once === "function") app.once("will-quit", dispose);
  return { apply, applyAvailable, dispose, getBindings, resetDefaults, update };
}

module.exports = {
  DEFAULT_HOTKEYS,
  HOTKEY_ACTIONS,
  HotkeyConfigurationError,
  createHotkeyManager,
  normalizeAccelerator,
  normalizeHotkeyBindings,
};
