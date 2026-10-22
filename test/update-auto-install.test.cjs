const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../src/renderer/app.js"), "utf8");
const snippet = source.slice(source.indexOf("const UPDATE_AUTO_INSTALL_MS"), source.indexOf("async function runUpdateAction"));

function widget({ windowMode = "orb", typed = "", screenshot = false } = {}) {
  const timers = [];
  const installs = [];
  const state = {
    windowMode,
    updateState: { status: "ready", installMode: "managed" },
    composerDraftsBySession: new Map(),
    pendingAttachments: [],
    pendingSendsBySession: new Map(),
  };
  const context = vm.createContext({
    state,
    $: () => ({ value: typed }),
    deckScreenshotMode: () => screenshot,
    runUpdateAction: (action) => installs.push(action),
    setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length; },
  });
  vm.runInContext(snippet, context);
  const fire = () => timers.shift()?.callback();
  return { state, timers, installs, fire, schedule: () => vm.runInContext("scheduleUpdateAutoInstall()", context) };
}

test("a verified update installs itself while the widget is a pet with nothing to lose", () => {
  const deck = widget();
  deck.schedule();
  deck.schedule();
  assert.equal(deck.timers.length, 1, "one pending attempt, however often the state is rendered");
  assert.equal(deck.timers[0].delay, 30_000);
  deck.fire();
  assert.deepEqual(deck.installs, ["install"]);
});

test("the install waits while a restart would lose a typed message, an attachment or a send", () => {
  const deck = widget({ windowMode: "full" });
  deck.schedule();
  deck.fire();
  assert.deepEqual(deck.installs, [], "the full widget is in use");
  deck.state.windowMode = "orb";
  deck.state.composerDraftsBySession.set("other", "half a thought");
  deck.fire();
  deck.state.composerDraftsBySession.clear();
  deck.state.pendingAttachments.push({ path: "shot.png" });
  deck.fire();
  deck.state.pendingAttachments.length = 0;
  deck.state.pendingSendsBySession.set("first", [{ status: "sending" }]);
  deck.fire();
  assert.deepEqual(deck.installs, []);
  deck.state.pendingSendsBySession.clear();
  deck.fire();
  assert.deepEqual(deck.installs, ["install"], "it goes as soon as nothing is held");

  const typing = widget({ typed: "not sent yet" });
  typing.schedule();
  typing.fire();
  assert.deepEqual(typing.installs, []);
});

test("nothing installs for a manual release, a state that moved on, or a docs capture", () => {
  const manual = widget();
  manual.state.updateState = { status: "ready", installMode: "manual" };
  manual.schedule();
  assert.equal(manual.timers.length, 0);

  const moved = widget();
  moved.schedule();
  moved.state.updateState = { status: "error", installMode: "managed" };
  moved.fire();
  assert.deepEqual(moved.installs, []);
  assert.equal(moved.timers.length, 0);

  const capture = widget({ screenshot: true });
  capture.schedule();
  assert.equal(capture.timers.length, 0);
});
