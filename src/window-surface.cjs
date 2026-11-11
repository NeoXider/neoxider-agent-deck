// How Windows composes the widget's window: with per-pixel alpha, or as a solid rectangle.
//
// The window is created transparent, so the avatar and the edge line can stand alone on the
// desktop and the full widget can have round corners and a see-through panel. The price is
// paid on every frame: a surface with alpha (and any window with a native opacity under 1)
// has to be blended by the desktop compositor, and on some machines that compositor stalls.
// Measured on a hybrid AMD + NVIDIA laptop at 144 Hz, one dot moving in a 420x640 window:
//
//   transparent window ............ 53-73 frames a second, 17-24 pauses of 100-480 ms in 6 s
//   the same window, solid colour .. 144 frames a second, no pause over 12 ms
//   solid, native opacity 96% ...... 43 frames a second, 27 pauses
//
// A transparent window whose page background is opaque gets an opaque swap chain, and the
// compositor can hand it straight to the display. So "solid" is a state the window can be
// put into and taken out of while it lives: an opaque background colour and a native opacity
// of 1. It only ever applies to the full widget at rest. A fold shrinks the widget inside
// its own window and the avatar floats, so both need the alpha back: the renderer releases
// the surface before a fold and settles it again once an unfold has finished.

const CLEAR = "#00000000";
const DEFAULT_COLOR = "#10141b";

function opaqueColor(value, fallback = DEFAULT_COLOR) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(value ?? "").trim());
  return match ? `#${match[1].toLowerCase()}` : fallback;
}

// While the window is transparent, a frame that the compositor is slow to take used to block
// the GPU process inside Present for 100-500 ms. With a waitable swap chain Chromium waits
// for the compositor before it draws instead: the same machine went from 18-42 pauses over
// 25 ms in six seconds to 8-17, none longer than 105 ms. AGENT_DECK_PLAIN_SWAP_CHAIN=1 turns
// it off for a machine where it does harm.
function preferSteadyPresentation(commandLine, platform = process.platform, env = process.env) {
  if (platform !== "win32" || env.AGENT_DECK_PLAIN_SWAP_CHAIN === "1" || typeof commandLine?.appendSwitch !== "function") return false;
  const current = typeof commandLine.getSwitchValue === "function" ? String(commandLine.getSwitchValue("enable-features") || "") : "";
  const features = current.split(",").map((value) => value.trim()).filter(Boolean);
  if (!features.includes("DXGIWaitableSwapChain")) features.push("DXGIWaitableSwapChain");
  commandLine.appendSwitch("enable-features", features.join(","));
  return true;
}

function createWindowSurface({ getWindow, getPreferences, getMode, applyOpacity }) {
  let owner = null;
  let settled = false;
  let solid = false;
  let color = DEFAULT_COLOR;

  const wanted = () => {
    const preferences = getPreferences() || {};
    return preferences.solidWindow === true || preferences.performanceMode === true;
  };

  // A window built again starts clear, whatever the last one was left as.
  function current() {
    const windowRef = getWindow();
    if (!windowRef || windowRef.isDestroyed?.()) return null;
    if (windowRef !== owner) { owner = windowRef; settled = false; solid = false; }
    return windowRef;
  }

  function apply() {
    const windowRef = current();
    if (!windowRef) return "clear";
    const next = wanted() && settled && getMode() === "full";
    // Nothing is touched while the answer stays the same: with the preference off this never
    // calls into the window at all.
    if (next !== solid) {
      solid = next;
      windowRef.setBackgroundColor(next ? color : CLEAR);
      applyOpacity(windowRef, next ? 1 : getPreferences()?.opacity);
    }
    return solid ? "solid" : "clear";
  }

  return {
    apply,
    // The full widget is at rest: nothing in it is folding, unfolding or making its entrance.
    settle(nextColor) {
      const windowRef = current();
      if (!windowRef) return "clear";
      const previous = color;
      color = opaqueColor(nextColor, color);
      settled = true;
      if (solid && color !== previous) windowRef.setBackgroundColor(color);
      return apply();
    },
    // Something is about to move that needs the desktop to show through.
    release() {
      if (!current()) return "clear";
      settled = false;
      return apply();
    },
    isSolid: () => solid,
  };
}

module.exports = { CLEAR, DEFAULT_COLOR, createWindowSurface, opaqueColor, preferSteadyPresentation };
