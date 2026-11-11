const test = require("node:test");
const assert = require("node:assert/strict");
const { CLEAR, DEFAULT_COLOR, createWindowSurface, opaqueColor, preferSteadyPresentation } = require("../src/window-surface.cjs");

function harness({ preferences = {}, mode = "full" } = {}) {
  const calls = [];
  const state = { preferences: { opacity: 0.9, ...preferences }, mode, window: null };
  const makeWindow = () => ({
    isDestroyed: () => false,
    setBackgroundColor: (color) => calls.push(["background", color]),
  });
  state.window = makeWindow();
  const surface = createWindowSurface({
    getWindow: () => state.window,
    getPreferences: () => state.preferences,
    getMode: () => state.mode,
    applyOpacity: (_window, opacity) => calls.push(["opacity", opacity]),
  });
  return { calls, state, surface, makeWindow };
}

test("with the preference off the window is never touched", () => {
  const { calls, surface } = harness();
  assert.equal(surface.settle("#123456"), "clear");
  assert.equal(surface.release(), "clear");
  assert.equal(surface.apply(), "clear");
  assert.deepEqual(calls, []);
  assert.equal(surface.isSolid(), false);
});

test("a settled full widget becomes a solid rectangle at full native opacity", () => {
  const { calls, surface } = harness({ preferences: { solidWindow: true } });
  assert.equal(surface.apply(), "clear", "not before the renderer says the widget is at rest");
  assert.deepEqual(calls, []);
  assert.equal(surface.settle("#1A2B3C"), "solid");
  assert.deepEqual(calls, [["background", "#1a2b3c"], ["opacity", 1]]);
  assert.equal(surface.isSolid(), true);
  assert.equal(surface.settle("#1a2b3c"), "solid");
  assert.equal(calls.length, 2, "settling twice does nothing the second time");
});

test("a release gives the alpha and the user's opacity back", () => {
  const { calls, surface } = harness({ preferences: { solidWindow: true, opacity: 0.8 } });
  surface.settle("#1a2b3c");
  calls.length = 0;
  assert.equal(surface.release(), "clear");
  assert.deepEqual(calls, [["background", CLEAR], ["opacity", 0.8]]);
  assert.equal(surface.apply(), "clear", "it stays clear until it is settled again");
  assert.equal(calls.length, 2);
});

test("the avatar and the edge are never solid", () => {
  for (const mode of ["orb", "edge"]) {
    const { calls, surface } = harness({ preferences: { solidWindow: true }, mode });
    assert.equal(surface.settle("#1a2b3c"), "clear");
    assert.deepEqual(calls, []);
  }
});

test("optimized mode asks for the solid window too", () => {
  const { surface } = harness({ preferences: { performanceMode: true } });
  assert.equal(surface.settle("#1a2b3c"), "solid");
});

test("turning the preference on or off applies at once", () => {
  const { calls, state, surface } = harness();
  surface.settle("#1a2b3c");
  state.preferences.solidWindow = true;
  assert.equal(surface.apply(), "solid");
  state.preferences.solidWindow = false;
  assert.equal(surface.apply(), "clear");
  assert.deepEqual(calls, [["background", "#1a2b3c"], ["opacity", 1], ["background", CLEAR], ["opacity", 0.9]]);
});

test("a new colour repaints a window that is already solid", () => {
  const { calls, surface } = harness({ preferences: { solidWindow: true } });
  surface.settle("#1a2b3c");
  calls.length = 0;
  surface.settle("#445566");
  assert.deepEqual(calls, [["background", "#445566"]]);
});

test("a window built again starts clear and has to settle again", () => {
  const { calls, state, surface, makeWindow } = harness({ preferences: { solidWindow: true } });
  surface.settle("#1a2b3c");
  state.window = makeWindow();
  calls.length = 0;
  assert.equal(surface.apply(), "clear");
  assert.deepEqual(calls, [], "the new window is clear already");
  assert.equal(surface.settle("#1a2b3c"), "solid");
});

test("a missing or destroyed window is answered, not touched", () => {
  const { state, surface } = harness({ preferences: { solidWindow: true } });
  state.window = null;
  assert.equal(surface.settle("#1a2b3c"), "clear");
  state.window = { isDestroyed: () => true, setBackgroundColor: () => { throw new Error("touched"); } };
  assert.equal(surface.apply(), "clear");
});

test("only a plain six-digit colour is taken from the renderer", () => {
  assert.equal(opaqueColor("#AABBCC"), "#aabbcc");
  assert.equal(opaqueColor("aabbcc"), "#aabbcc");
  for (const value of ["#00000000", "transparent", "rgb(1,2,3)", "", null, "#abc", "#12345g"]) assert.equal(opaqueColor(value), DEFAULT_COLOR);
  assert.equal(opaqueColor("nonsense", "#010203"), "#010203");
});

test("Windows gets the waitable swap chain, beside whatever features were already asked for", () => {
  const switches = new Map([["enable-features", "Something"]]);
  const commandLine = { getSwitchValue: (name) => switches.get(name) || "", appendSwitch: (name, value) => switches.set(name, value) };
  assert.equal(preferSteadyPresentation(commandLine, "win32", {}), true);
  assert.equal(switches.get("enable-features"), "Something,DXGIWaitableSwapChain");
  assert.equal(preferSteadyPresentation(commandLine, "win32", {}), true);
  assert.equal(switches.get("enable-features"), "Something,DXGIWaitableSwapChain", "not added twice");
});

test("other platforms and the opt-out leave the command line alone", () => {
  const touched = [];
  const commandLine = { getSwitchValue: () => "", appendSwitch: (...args) => touched.push(args) };
  assert.equal(preferSteadyPresentation(commandLine, "darwin", {}), false);
  assert.equal(preferSteadyPresentation(commandLine, "linux", {}), false);
  assert.equal(preferSteadyPresentation(commandLine, "win32", { AGENT_DECK_PLAIN_SWAP_CHAIN: "1" }), false);
  assert.equal(preferSteadyPresentation(null, "win32", {}), false);
  assert.deepEqual(touched, []);
});
