const assert = require("node:assert/strict");
const path = require("node:path");
const { app, BrowserWindow, ipcMain } = require("electron");
const { renderMarkdown } = require("../src/markdown.cjs");

app.disableHardwareAcceleration();

const root = path.resolve(__dirname, "..");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const deadline = setTimeout(() => {
  console.error("Queued attachment smoke timed out");
  app.exit(1);
}, 60000);
const queueEdits = [];
const attachmentReads = [];
let resolveSwitchedAttachment;
const switchedAttachment = new Promise((resolve) => { resolveSwitchedAttachment = resolve; });
const tinyPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function registerStubs() {
  const values = {
    "get-preferences": {},
    "app-info": { version: "test" },
    "get-update-state": { status: "idle" },
    "set-compact-status": {},
    "set-last-selected-session": null,
  };
  for (const [channel, value] of Object.entries(values)) ipcMain.handle(channel, () => value);
  ipcMain.handle("render-markdown", (_event, text) => renderMarkdown(text));
  ipcMain.handle("update-queue", (_event, payload) => {
    queueEdits.push(structuredClone(payload));
    return { ok: true };
  });
  ipcMain.handle("read-attachment", (_event, payload) => {
    attachmentReads.push(structuredClone(payload));
    if (payload.attachmentId === "metadata-switch") return switchedAttachment;
    return { mediaType: "image/png", data: tinyPng, name: "metadata-original.png" };
  });
}

async function snapshot(contents) {
  return contents.executeJavaScript(`(() => ({
    sentImages: document.querySelectorAll('#messages .message-attachment[data-attachment-kind="image"] img').length,
    sentFiles: document.querySelectorAll('#messages .message-attachment[data-attachment-kind="file"]').length,
    queueRows: document.querySelectorAll('#queueList .queue-row').length,
    queueImages: document.querySelectorAll('#queueList .message-attachment[data-attachment-kind="image"] img').length,
    queueClickableImages: document.querySelectorAll('#queueList .message-attachment[data-attachment-kind="image"][role="button"]').length,
    queueFiles: document.querySelectorAll('#queueList .message-attachment[data-attachment-kind="file"]').length,
    collapsedStrips: document.querySelectorAll('#queueList .queue-row:not(.expanded) .message-attachments').length,
  }))()`);
}

async function main() {
  await app.whenReady();
  registerStubs();
  const win = new BrowserWindow({
    width: 420,
    height: 640,
    show: false,
    frame: false,
    webPreferences: {
      preload: path.join(root, "src", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  const contents = win.webContents;
  await win.loadFile(path.join(root, "src", "renderer", "index.html"), {
    query: { screenshotFixture: "attachments", screenshotStatic: "1" },
  });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await contents.executeJavaScript("Boolean(state.pendingAttachments.find(item => item.kind === 'image')?.data)")) break;
    if (attempt === 99) throw new Error("Attachment fixture did not finish loading");
    await wait(50);
  }

  await contents.executeJavaScript(`(() => {
    const image = state.pendingAttachments.find((item) => item.kind === 'image');
    const attachments = [
      { kind: 'image', mediaType: image.mediaType, data: image.data, name: image.name },
      { kind: 'reference', previewKind: 'file', name: 'queue-notes.md' },
    ];
    state.selectedSessionId = 'queued-attachments';
    state.queuedPromptsBySession.set('queued-attachments', [
      { id: 'edit-text', placement: 'queued', text: 'Original queued text', preview: 'Original queued text', attachmentCount: 2, attachments },
      { id: 'edit-empty', placement: 'queued', text: null, preview: null, attachmentCount: 2, attachments },
      { id: 'metadata-original', placement: 'queued', text: 'Read original on demand', preview: 'Read original on demand', attachmentCount: 1, attachments: [
        { kind: 'image', attachmentId: 'metadata-original', mediaType: 'image/png', name: 'metadata-original.png' },
      ] },
      { id: 'metadata-switch', placement: 'queued', text: 'Do not cross sessions', preview: 'Do not cross sessions', attachmentCount: 1, attachments: [
        { kind: 'image', attachmentId: 'metadata-switch', mediaType: 'image/png', name: 'metadata-switch.png' },
      ] },
    ]);
    state.queueSnapshotRevisions.set('queued-attachments', 1);
    state.queueSignature = '';
    renderQueuedPrompts();
  })()`);

  assert.deepEqual(await snapshot(contents), {
    sentImages: 1,
    sentFiles: 1,
    queueRows: 4,
    queueImages: 2,
    queueClickableImages: 4,
    queueFiles: 2,
    collapsedStrips: 4,
  }, "sent bubbles and collapsed queue rows should show image and file attachments");

  const dialogChecks = await contents.executeJavaScript(`(async () => {
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const opener = document.querySelector('#queueList [data-queue-id="edit-text"] .message-attachment[data-attachment-kind="image"]');
    opener.focus();
    opener.click();
    await wait(20);
    const clickOpened = Boolean(document.querySelector('.message-image-dialog[open]'));
    document.querySelector('.message-image-close').click();
    while (document.querySelector('.message-image-dialog')) await wait(5);
    await new Promise(resolve => requestAnimationFrame(resolve));
    await new Promise(resolve => requestAnimationFrame(resolve));
    const clickRestored = document.activeElement === opener && !document.querySelector('.message-image-dialog');
    opener.click();
    await wait(20);
    return { clickOpened, clickRestored, escapeOpened: Boolean(document.querySelector('.message-image-dialog[open]')) };
  })()`);
  assert.deepEqual(dialogChecks, { clickOpened: true, clickRestored: true, escapeOpened: true });
  const escapeDispatch = await contents.executeJavaScript(`(() => {
    const dialog = document.querySelector('.message-image-dialog');
    const accepted = dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    return { accepted, open: dialog.open };
  })()`);
  assert.deepEqual(escapeDispatch, { accepted: false, open: false }, "Escape should be handled and close the modal immediately");
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!await contents.executeJavaScript("Boolean(document.querySelector('.message-image-dialog'))")) break;
    await wait(5);
  }
  assert.deepEqual(await contents.executeJavaScript(`(() => {
    const opener = document.querySelector('#queueList [data-queue-id="edit-text"] .message-attachment[data-attachment-kind="image"]');
    return { closed: !document.querySelector('.message-image-dialog'), focusRestored: document.activeElement === opener };
  })()`), { closed: true, focusRestored: true }, "Escape should close the preview and restore focus");

  const metadataPreview = await contents.executeJavaScript(`(async () => {
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const opener = document.querySelector('[data-queue-id="metadata-original"] .message-attachment[data-attachment-kind="image"]');
    opener.focus();
    opener.click();
    for (let attempt = 0; attempt < 100 && !document.querySelector('.message-image-dialog[open]'); attempt += 1) await wait(5);
    const dialog = document.querySelector('.message-image-dialog[open]');
    const result = {
      opened: Boolean(dialog),
      source: dialog?.querySelector('img')?.src || '',
      label: dialog?.getAttribute('aria-label') || '',
    };
    dialog?.querySelector('.message-image-close')?.click();
    for (let attempt = 0; attempt < 100 && document.querySelector('.message-image-dialog'); attempt += 1) await wait(5);
    await new Promise(resolve => requestAnimationFrame(resolve));
    return { ...result, removed: !document.querySelector('.message-image-dialog'), focusRestored: document.activeElement === opener };
  })()`);
  assert.deepEqual(metadataPreview, {
    opened: true,
    source: `data:image/png;base64,${tinyPng}`,
    label: "metadata-original.png",
    removed: true,
    focusRestored: true,
  }, "metadata-only images should load the original, preview it, and clean up the dialog");
  assert.deepEqual(attachmentReads, [{ sessionId: "queued-attachments", attachmentId: "metadata-original" }], "one click should read the metadata-only image once");

  await contents.executeJavaScript(`document.querySelector('[data-queue-id="metadata-switch"] .message-attachment[data-attachment-kind="image"]').click()`);
  for (let attempt = 0; attempt < 100 && attachmentReads.length < 2; attempt += 1) await wait(5);
  await contents.executeJavaScript("state.selectedSessionId = 'another-session'");
  resolveSwitchedAttachment({ mediaType: "image/png", data: tinyPng, name: "metadata-switch.png" });
  await wait(50);
  assert.deepEqual(attachmentReads[1], { sessionId: "queued-attachments", attachmentId: "metadata-switch" }, "attachment reads should stay bound to the row's original session");
  assert.equal(await contents.executeJavaScript("Boolean(document.querySelector('.message-image-dialog'))"), false, "an attachment read finishing after a session switch should not open a preview");
  await contents.executeJavaScript("state.selectedSessionId = 'queued-attachments'");

  const stableEditor = await contents.executeJavaScript(`(async () => {
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    document.querySelector('[data-queue-id="edit-text"] [aria-label="Edit queued message"]').click();
    await wait(30);
    const editor = document.querySelector('[data-queue-id="edit-text"] .queue-edit-input');
    editor.value = 'Unsaved draft survives';
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.focus();
    window.__queueEditor = editor;
    return { attachments: editor.closest('.queue-row').querySelectorAll('.message-attachment').length, focused: document.activeElement === editor };
  })()`);
  assert.deepEqual(stableEditor, { attachments: 2, focused: true }, "editing row should retain its attachment strip");

  contents.send("queue-update", {
    sessionId: "queued-attachments",
    revision: 2,
    items: await contents.executeJavaScript(`queuedPromptsFor('queued-attachments').map(item => JSON.parse(JSON.stringify(item)))`),
  });
  await wait(50);
  assert.deepEqual(await contents.executeJavaScript(`(() => {
    const editor = document.querySelector('[data-queue-id="edit-text"] .queue-edit-input');
    return { sameNode: editor === window.__queueEditor, value: editor?.value, focused: document.activeElement === editor };
  })()`), { sameNode: true, value: "Unsaved draft survives", focused: true }, "same queue refresh should not destroy the active editor");

  await contents.executeJavaScript(`(() => {
    const editor = document.querySelector('[data-queue-id="edit-text"] .queue-edit-input');
    editor.setSelectionRange(7, 12);
  })()`);
  const hydratedItems = await contents.executeJavaScript(`queuedPromptsFor('queued-attachments').map(item => JSON.parse(JSON.stringify(item)))`);
  hydratedItems.find((item) => item.id === "edit-text").attachments[0].data += "AAAA";
  contents.send("queue-update", { sessionId: "queued-attachments", revision: 3, items: hydratedItems });
  await wait(50);
  await contents.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  assert.deepEqual(await contents.executeJavaScript(`(() => {
    const editor = document.querySelector('[data-queue-id="edit-text"] .queue-edit-input');
    return {
      rebuilt: editor !== window.__queueEditor,
      value: editor?.value,
      selectionStart: editor?.selectionStart,
      selectionEnd: editor?.selectionEnd,
      focused: document.activeElement === editor,
      attachments: editor?.closest('.queue-row')?.querySelectorAll('.message-attachment').length,
    };
  })()`), {
    rebuilt: true,
    value: "Unsaved draft survives",
    selectionStart: 7,
    selectionEnd: 12,
    focused: true,
    attachments: 2,
  }, "attachment hydration rebuild should preserve the queue editor draft, caret, and focus");

  await contents.executeJavaScript(`(() => {
    const editor = document.querySelector('[data-queue-id="edit-text"] .queue-edit-input');
    editor.value = 'Updated queued text';
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  })()`);
  await wait(50);
  await contents.executeJavaScript(`(async () => {
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    document.querySelector('[data-queue-id="edit-empty"] [aria-label="Edit queued message"]').click();
    await wait(30);
    const editor = document.querySelector('[data-queue-id="edit-empty"] .queue-edit-input');
    const save = document.querySelector('[data-queue-id="edit-empty"] [aria-label="Save queued message"]');
    window.__emptySaveEnabled = !save.disabled;
    editor.value = '   ';
    save.click();
  })()`);
  await wait(50);

  assert.equal(await contents.executeJavaScript("window.__emptySaveEnabled"), true, "attachment-only queued messages should allow saving empty text");
  assert.deepEqual(queueEdits.map(({ sessionId, itemId, action }) => ({ sessionId, itemId, action })), [
    { sessionId: "queued-attachments", itemId: "edit-text", action: { kind: "edit", text: "Updated queued text" } },
    { sessionId: "queued-attachments", itemId: "edit-empty", action: { kind: "edit", text: "" } },
  ]);

  console.log("PASS queued image/file strips, on-demand originals, attachment-only editing, preview focus restoration, and stable queue refresh");
  clearTimeout(deadline);
  win.destroy();
  app.exit(0);
}

main().catch((error) => {
  clearTimeout(deadline);
  console.error(error);
  app.exit(1);
});
