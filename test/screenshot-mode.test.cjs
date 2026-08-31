const test = require("node:test");
const assert = require("node:assert/strict");

const { isScreenshotMode, pinScreenshotRenderScale, screenshotRequest } = require("../src/screenshot-mode.cjs");

function recorder() {
  const switches = [];
  return { switches, appendSwitch: (name, value) => switches.push([name, value]) };
}

test("a run is a screenshot run only when it has somewhere to write the capture", () => {
  assert.equal(isScreenshotMode({}), false);
  assert.equal(isScreenshotMode({ WIDGET_SCREENSHOT_PATH: "" }), false);
  assert.equal(isScreenshotMode({ WIDGET_SCREENSHOT_PATH: "tmp/shot.png" }), true);
});

test("the render scale is pinned for a capture and left alone for the real widget", () => {
  // A case asks for an exact window size and is compared against exact pixels, so the
  // capture must not depend on the scaling of whichever display runs it.
  const capture = recorder();
  assert.equal(pinScreenshotRenderScale(capture, { WIDGET_SCREENSHOT_PATH: "tmp/shot.png" }), true);
  assert.deepEqual(capture.switches, [["force-device-scale-factor", "1"]]);

  const widget = recorder();
  assert.equal(pinScreenshotRenderScale(widget, {}), false);
  assert.deepEqual(widget.switches, []);
});

test("pinning tolerates a caller without a command line rather than throwing at startup", () => {
  assert.equal(pinScreenshotRenderScale(undefined, { WIDGET_SCREENSHOT_PATH: "tmp/shot.png" }), false);
  assert.equal(pinScreenshotRenderScale({}, { WIDGET_SCREENSHOT_PATH: "tmp/shot.png" }), false);
});

test("the request reads every screenshot input and defaults the absent ones", () => {
  assert.deepEqual(screenshotRequest({}), {
    path: "",
    width: Number.NaN,
    height: Number.NaN,
    tab: "",
    fixture: "",
    files: "",
    backdrop: "",
  });

  const request = screenshotRequest({
    WIDGET_SCREENSHOT_PATH: "tmp/goal.png",
    WIDGET_SCREENSHOT_WIDTH: "360",
    WIDGET_SCREENSHOT_HEIGHT: "500",
    WIDGET_SCREENSHOT_TAB: "chat",
    WIDGET_SCREENSHOT_FIXTURE: "goal-collapsed",
    WIDGET_SCREENSHOT_FILES: "a.png,b.png",
    WIDGET_SCREENSHOT_BACKDROP: "black",
  });
  assert.deepEqual(request, {
    path: "tmp/goal.png",
    width: 360,
    height: 500,
    tab: "chat",
    fixture: "goal-collapsed",
    files: "a.png,b.png",
    backdrop: "black",
  });
});
