const test = require("node:test");
const assert = require("node:assert/strict");
const { TARGET_PREFERENCES, createHarnessTarget, normalizeHarnessTarget } = require("../src/harness-target.cjs");

const WEB = "http://127.0.0.1:3080";
const DESKTOP = "http://127.0.0.1:43129";
const TOKEN_URL = (token) => `${DESKTOP}/?token=${token}`;

function rig({ web = false, desktop = false, token = "t1", preference = "auto" } = {}) {
  const world = { web, desktop, token, preference };
  const switches = [];
  const target = createHarnessTarget({
    webUrl: WEB,
    locator: {
      current: () => null,
      locate: async () => ({ installed: true, running: world.desktop, url: DESKTOP, launchUrl: world.desktop ? TOKEN_URL(world.token) : "" }),
    },
    probeWeb: async () => world.web,
    getPreference: () => world.preference,
    onSwitch: async (state) => { switches.push([state.kind, state.url, state.launchUrl]); },
    setTimer: () => 0,
    clearTimer: () => {},
  });
  return { world, switches, target };
}

test("auto follows whichever Harness is running, and Deck's own when neither is", async () => {
  const onlyDesktop = rig({ desktop: true });
  assert.equal((await onlyDesktop.target.refresh()).kind, "desktop");
  assert.deepEqual(onlyDesktop.switches, [["desktop", DESKTOP, TOKEN_URL("t1")]]);
  assert.equal(onlyDesktop.target.launchUrl(), TOKEN_URL("t1"));

  const neither = rig();
  assert.equal((await neither.target.refresh()).kind, "web");
  assert.deepEqual(neither.switches, [], "already on the web Harness");

  const both = rig({ web: true, desktop: true });
  assert.equal((await both.target.refresh()).kind, "web", "Deck's own wins a first tie");
});

test("auto stays put while its Harness runs, and moves when it stops", async () => {
  const { world, switches, target } = rig({ desktop: true });
  await target.refresh();
  world.web = true;
  assert.equal((await target.refresh()).kind, "desktop", "both running: no flip");
  world.desktop = false;
  assert.equal((await target.refresh()).kind, "web");
  assert.deepEqual(switches.map(([kind]) => kind), ["desktop", "web"]);
});

test("a new DSH Desktop launch token is a switch of its own", async () => {
  const { world, switches, target } = rig({ desktop: true, preference: "desktop" });
  await target.refresh();
  world.token = "t2";
  await target.refresh();
  assert.deepEqual(switches.map(([, , launchUrl]) => launchUrl), [TOKEN_URL("t1"), TOKEN_URL("t2")]);
  await target.refresh();
  assert.equal(switches.length, 2, "the same token again changes nothing");
});

test("an explicit choice is kept even while that Harness is down", async () => {
  const { world, target } = rig({ web: true, preference: "desktop" });
  const state = await target.refresh();
  assert.equal(state.kind, "desktop");
  assert.equal(state.launchUrl, "");
  world.preference = "web";
  assert.equal((await target.refresh()).kind, "web");
});

test("preferences outside the three are read as auto, and the inputs are required", () => {
  assert.deepEqual(TARGET_PREFERENCES, ["auto", "web", "desktop"]);
  assert.equal(normalizeHarnessTarget("desktop"), "desktop");
  assert.equal(normalizeHarnessTarget("anything"), "auto");
  assert.throws(() => createHarnessTarget({ locator: { locate() {} } }), /web Harness URL/);
  assert.throws(() => createHarnessTarget({ webUrl: WEB }), /locator/);
});
