const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = readFileSync(path.join(root, "src", "renderer", "index.html"), "utf8");
const renderer = readFileSync(path.join(root, "src", "renderer", "app.js"), "utf8");
const main = readFileSync(path.join(root, "src", "main.cjs"), "utf8");

test("visible widget copy is English and required controls are present", () => {
  assert.doesNotMatch(`${html}\n${renderer}`, /[\u0400-\u04ff]/);
  for (const id of [
    "contextMeter",
    "modelButton",
    "modelSearch",
    "reasoningButton",
    "commandsButton",
    "workspaceButton",
    "modeSwitch",
    "attachButton",
    "attachmentBar",
    "agentControls",
    "activityCard",
    "orbMode",
    "orbNewSession",
    "orbCommands",
    "orbAttach",
    "edgeMode",
  ]) assert.match(html, new RegExp(`id="${id}"`));
});

test("compact layout uses custom pickers, expandable controls, and no useless count strip", () => {
  assert.doesNotMatch(html, /class="stats-strip"/);
  assert.doesNotMatch(html, /id="(?:model|reasoning|workspace|mode|session)Select"/);
  assert.match(html, /<details id="agentControls"/);
  assert.match(html, /class="picker-menu model-menu"/);
  assert.match(renderer, /localRank/);
});

test("composer keeps attachment, stop, send and context controls in the requested order", () => {
  const attach = html.indexOf('id="attachButton"');
  const stop = html.indexOf('id="cancelButton"');
  const send = html.indexOf('id="sendButton"');
  const context = html.indexOf('id="contextMeter"');
  assert.ok(attach > 0 && attach < stop && stop < send && send < context);
  assert.match(renderer, /attachment-preview/);
  assert.match(renderer, /thumbnailData/);
});

test("window contract has no close control and supports avatar and edge modes", () => {
  assert.doesNotMatch(html, /id="(?:close|hide)Button"/);
  assert.match(main, /\["full", "orb", "edge"\]\.includes\(nextMode\)/);
  assert.match(main, /nextMode === "orb"/);
  assert.match(main, /ORB_QUICK_WIDTH/);
  assert.match(main, /set-compact-status/);
  assert.match(main, /event\.preventDefault\(\);\s*applyWindowMode\("edge"\)/);
});

test("compact modes use immediate pointer capture, native drag IPC, and magnetic snap", () => {
  assert.match(renderer, /setPointerCapture/);
  assert.match(renderer, /beginCompactDrag/);
  assert.match(renderer, /moveCompactDrag/);
  assert.match(renderer, /endCompactDrag/);
  assert.match(main, /begin-compact-drag/);
  assert.match(main, /move-compact-drag/);
  assert.match(main, /end-compact-drag/);
  assert.match(main, /wasActive !== compactStatus\.active && !compactDragOrigin/);
  assert.match(html, /data-avatar[^>]+draggable="false"/);
});

test("Markdown and tool calls have dedicated safe, collapsed render paths", () => {
  assert.match(renderer, /message\.role === "tool"/);
  assert.match(renderer, /details\.className = `tool-call/);
  assert.match(renderer, /body\.innerHTML = message\.html/);
  assert.match(main, /renderMarkdown\(message\.text\)/);
  assert.match(html, /id="messages"/);
});

test("chat glow distinguishes thinking, writing and tool activity and clears on idle", () => {
  assert.match(renderer, /activity-thinking/);
  assert.match(renderer, /activity-writing/);
  assert.match(renderer, /activity-tool/);
  assert.match(renderer, /classList\.remove\("activity-thinking", "activity-writing", "activity-tool"\)/);
});
