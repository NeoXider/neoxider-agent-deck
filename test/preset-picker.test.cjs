const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Loads the renderer's preset picker with just enough of the page around it to run choosePreset.
function picker({ rows, selected, queued = {} }) {
  const calls = [];
  const element = () => ({ querySelector: () => element(), hidden: false, textContent: "", dataset: {}, title: "", classList: { contains: () => false }, setAttribute() {}, getAttribute: () => "", addEventListener() {}, replaceChildren() {}, append() {} });
  const context = {
    console, setTimeout, clearTimeout,
    localStorage: { getItem: () => "", setItem() {}, removeItem() {} },
    document: { addEventListener() {}, createElement: element },
    $: element, createIcon: element, closePickers() {}, togglePicker() {},
    window: { widget: { agentPresets: async () => [] } },
    state: { dashboard: { sessions: rows } },
    selectedSessionRow: () => rows.find((row) => row.sessionId === selected),
    queuedPromptsFor: (id) => queued[id] || [],
    createNewSession: async (options) => { calls.push(JSON.parse(JSON.stringify(options))); },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "src", "renderer", "preset-picker.js"), "utf8"), context);
  vm.runInContext('presetPicker.list = [{ id: "standard", isDefault: true }, { id: "deep" }, { id: "stale", broken: "never started" }]; presetPicker.loaded = true;', context);
  return { calls, choose: (id) => vm.runInContext(`choosePreset(${JSON.stringify(id)})`, context) };
}

const row = (sessionId, extra = {}) => ({ sessionId, blank: true, running: false, updatedAt: 1, projections: { values: { agentPreset: "standard" } }, ...extra });

test("a blank chat takes the picked preset in place, in its own folder", async () => {
  const mine = row("A", { cwd: "C:/harness-workspace" });
  const { calls, choose } = picker({ rows: [mine], selected: "A" });
  await choose("deep");
  assert.deepEqual(calls, [{ workspaceId: null, cwd: "C:/harness-workspace", agentPreset: "deep", reuseSessionId: "A" }]);
  const inFolder = picker({ rows: [row("W", { workspaceId: "ws-1", cwd: "D:/AI" })], selected: "W" });
  await inFolder.choose("deep");
  assert.deepEqual(inFolder.calls, [{ workspaceId: "ws-1", cwd: "", agentPreset: "deep", reuseSessionId: "W" }]);
});

test("a started chat hands the pick to the newest empty chat of its folder instead of minting one", async () => {
  const started = row("S", { blank: false, cwd: "C:/harness-workspace" });
  const rows = [
    started,
    row("old", { updatedAt: 10, cwd: "C:/harness-workspace" }),
    row("new", { updatedAt: 20, cwd: "C:/harness-workspace" }),
    row("elsewhere", { updatedAt: 30, workspaceId: "ws-1", cwd: "D:/AI" }),
    row("busy", { updatedAt: 40, running: true, cwd: "C:/harness-workspace" }),
    row("waiting", { updatedAt: 50, cwd: "C:/harness-workspace" }),
    row("child", { updatedAt: 60, origin: "subagent", cwd: "C:/harness-workspace" }),
    row("other-folder", { updatedAt: 70, cwd: "C:/elsewhere" }),
    row("used", { updatedAt: 80, blank: false, cwd: "C:/harness-workspace" }),
  ];
  const { calls, choose } = picker({ rows, selected: "S", queued: { waiting: [{ id: "q1" }] } });
  await choose("deep");
  assert.deepEqual(calls, [{ workspaceId: null, cwd: "C:/harness-workspace", agentPreset: "deep", reuseSessionId: "new" }]);
});

test("a started chat with no empty chat beside it opens a new one, and its own preset changes nothing", async () => {
  const started = row("S", { blank: false, workspaceId: "ws-1", cwd: "D:/AI" });
  const { calls, choose } = picker({ rows: [started], selected: "S" });
  await choose("deep");
  assert.deepEqual(calls, [{ workspaceId: "ws-1", cwd: "", agentPreset: "deep", reuseSessionId: null }]);
  calls.length = 0;
  await choose("standard");
  assert.deepEqual(calls, [], "the chat already runs it");
  await choose("stale");
  assert.deepEqual(calls, [], "a preset Harness cannot compose is not offered");
});
