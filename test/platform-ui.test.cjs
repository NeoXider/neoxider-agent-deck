const test = require("node:test");
const assert = require("node:assert/strict");
const { createPlatformPresentation } = require("../src/renderer/platform-presentation.js");

const fixtures = {
  windows: {
    platform: "win32",
    nativeOpacity: true,
    gameLayer: true,
    programmaticPosition: true,
    edgeMode: "click-through",
  },
  macOS: {
    platform: "darwin",
    nativeOpacity: true,
    gameLayer: true,
    programmaticPosition: true,
    edgeMode: "click-through",
  },
  linuxX11: {
    platform: "linux",
    nativeOpacity: false,
    gameLayer: false,
    programmaticPosition: true,
    edgeMode: "interactive-wide",
  },
  linuxWayland: {
    platform: "linux",
    wayland: true,
    nativeOpacity: false,
    gameLayer: false,
    programmaticPosition: false,
    edgeMode: "unavailable",
  },
};

test("Windows and macOS expose every native settings control", () => {
  for (const key of ["windows", "macOS"]) {
    const view = createPlatformPresentation(fixtures[key]);
    assert.equal(view.startupLabel, "Start at login");
    assert.equal(view.opacityAvailable, true);
    assert.equal(view.gameLayerAvailable, true);
    assert.equal(view.positionAvailable, true);
    assert.equal(view.edgeAvailable, true);
    assert.equal(view.platformHint, "");
  }
});

test("Linux X11 disables unsupported settings and labels its wider Edge input honestly", () => {
  const view = createPlatformPresentation(fixtures.linuxX11);
  assert.equal(view.opacityAvailable, false);
  assert.equal(view.gameLayerAvailable, false);
  assert.equal(view.positionAvailable, true);
  assert.equal(view.edgeAvailable, true);
  assert.equal(view.edgeMode, "interactive-wide");
  assert.match(view.opacityHint, /Unavailable on Linux/);
  assert.match(view.platformHint, /Game layer is unavailable/);
  assert.match(view.platformHint, /not click-through/);
  assert.match(view.dockTitle, /wider interactive area/);
});

test("Wayland disables Edge and position controls instead of silently substituting Orb", () => {
  const view = createPlatformPresentation(fixtures.linuxWayland);
  assert.equal(view.opacityAvailable, false);
  assert.equal(view.gameLayerAvailable, false);
  assert.equal(view.positionAvailable, false);
  assert.equal(view.edgeAvailable, false);
  assert.match(view.platformHint, /Wayland manages window position/);
  assert.match(view.dockTitle, /unavailable on Wayland/);
});
