const test = require("node:test");
const assert = require("node:assert/strict");
const {
  applyPlatformOpacity,
  applyPlatformWindowLayer,
  detectPlatformCapabilities,
  normalizeWindowLayer,
  setPlatformBounds,
} = require("../src/platform-capabilities.cjs");

function fakeWindow() {
  const calls = [];
  return {
    calls,
    isDestroyed: () => false,
    setAlwaysOnTop: (...args) => calls.push(["top", ...args]),
    setVisibleOnAllWorkspaces: (...args) => calls.push(["spaces", ...args]),
    setOpacity: (...args) => calls.push(["opacity", ...args]),
    setBounds: (...args) => calls.push(["bounds", ...args]),
    setSize: (...args) => calls.push(["size", ...args]),
  };
}

test("Windows and macOS expose native layer and opacity capabilities", () => {
  for (const platform of ["win32", "darwin"]) {
    const capabilities = detectPlatformCapabilities({ platform, env: {} });
    assert.equal(capabilities.layerLevels, true);
    assert.equal(capabilities.nativeOpacity, true);
    assert.equal(capabilities.gameLayer, true);
  }
});

test("Linux Game degrades honestly to Above without unsupported level arguments", () => {
  const capabilities = detectPlatformCapabilities({ platform: "linux", env: { XDG_SESSION_TYPE: "x11" } });
  const windowRef = fakeWindow();

  assert.equal(normalizeWindowLayer("game", capabilities), "above");
  assert.equal(applyPlatformWindowLayer(windowRef, { layer: "game", mode: "full", capabilities }), "above");
  assert.deepEqual(windowRef.calls, [["top", true]]);
});

test("macOS Game is visible on fullscreen spaces", () => {
  const capabilities = detectPlatformCapabilities({ platform: "darwin", env: {} });
  const windowRef = fakeWindow();

  assert.equal(applyPlatformWindowLayer(windowRef, { layer: "game", mode: "full", capabilities }), "game");
  assert.deepEqual(windowRef.calls, [
    ["top", true, "screen-saver"],
    ["spaces", true, { visibleOnFullScreen: true }],
  ]);
});

test("Wayland disables programmatic position and Edge mode", () => {
  const capabilities = detectPlatformCapabilities({ platform: "linux", env: { WAYLAND_DISPLAY: "wayland-0" } });
  const windowRef = fakeWindow();
  const bounds = { x: 120, y: 80, width: 400, height: 128 };

  assert.equal(capabilities.programmaticPosition, false);
  assert.equal(capabilities.edgeMode, "unavailable");
  setPlatformBounds(windowRef, bounds, true, capabilities);
  assert.deepEqual(windowRef.calls, [["size", 400, 128, true]]);
});

test("Linux opacity is reported as a non-native fallback", () => {
  const capabilities = detectPlatformCapabilities({ platform: "linux", env: {} });
  const windowRef = fakeWindow();

  assert.deepEqual(applyPlatformOpacity(windowRef, 0.8, capabilities), { opacity: 0.8, native: false });
  assert.equal(windowRef.calls.length, 0);
});
