// Everything the main process reads about a visual-smoke run, in one place, and nothing
// from Electron: the caller passes in what it has so this stays unit testable.
//
// The scale pin is the part worth explaining. A smoke case asks for an exact window size and
// is then compared against exact pixels. On a display scaled to anything but 100% the window
// came back a few pixels wider than it asked for and the capture came back magnified, so a
// third of the suite could only ever pass on a 100% machine - which is also how several of
// its expectations quietly went stale. Pinning the device scale before the app is ready
// makes a capture identical everywhere. The real widget never takes this branch and still
// follows whatever the display does.
const isScreenshotMode = (env = process.env) => Boolean(env.WIDGET_SCREENSHOT_PATH);

function pinScreenshotRenderScale(commandLine, env = process.env) {
  if (!isScreenshotMode(env) || typeof commandLine?.appendSwitch !== "function") return false;
  commandLine.appendSwitch("force-device-scale-factor", "1");
  return true;
}

function screenshotRequest(env = process.env) {
  return {
    path: env.WIDGET_SCREENSHOT_PATH || "",
    width: Number(env.WIDGET_SCREENSHOT_WIDTH),
    height: Number(env.WIDGET_SCREENSHOT_HEIGHT),
    tab: env.WIDGET_SCREENSHOT_TAB || "",
    fixture: env.WIDGET_SCREENSHOT_FIXTURE || "",
    files: env.WIDGET_SCREENSHOT_FILES || "",
    backdrop: env.WIDGET_SCREENSHOT_BACKDROP || "",
    // A capture freezes every animation and transition so pixels are deterministic. A case
    // about motion itself - a strip easing open while the log stays anchored - asks for
    // them left on and measures the frames instead of the pixels.
    motion: Boolean(env.WIDGET_SCREENSHOT_MOTION),
  };
}

module.exports = { isScreenshotMode, pinScreenshotRenderScale, screenshotRequest };
