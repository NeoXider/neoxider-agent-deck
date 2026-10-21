// The viewer window's page: draws the item main sends (viewer-window.cjs) - an image to
// zoom and pan, a Markdown document to read or see as source, text or code with line
// numbers, or a card for what it cannot show - and asks main for everything else.

const $ = (selector) => document.querySelector(selector);
const params = new URLSearchParams(location.search);
document.documentElement.classList.add(`platform-${params.get("platform") || "win32"}`);

const KIND_ICONS = { image: "v-image", markdown: "v-doc", text: "v-code", folder: "v-folder", missing: "v-missing", unknown: "v-file" };
let item = null;
let view = { markdownSource: false, zoom: null };

function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#${name}`);
  svg.append(use);
  return svg;
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

let toastTimer = 0;
function toast(text, error = false) {
  const node = $("#toast");
  node.textContent = text;
  node.classList.toggle("error", error);
  node.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("show"), 2200);
}

function tool(iconName, label, onClick, { title = label, pressed = null, showLabel = true } = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "tool";
  button.title = title;
  button.setAttribute("aria-label", title);
  if (pressed !== null) button.setAttribute("aria-pressed", String(pressed));
  if (iconName) button.append(icon(iconName));
  if (label && showLabel) button.append(Object.assign(document.createElement("span"), { className: iconName ? "label" : "", textContent: label }));
  button.addEventListener("click", onClick);
  return button;
}

function separator() {
  return Object.assign(document.createElement("span"), { className: "tool-sep" });
}

async function copyItem() {
  const result = await window.viewer.copy().catch(() => null);
  if (result?.ok) toast(result.what === "image" ? "Image copied" : result.what === "path" ? "Path copied" : "Copied");
  else toast("Nothing to copy", true);
}

async function openExternally() {
  const result = await window.viewer.openExternally().catch((error) => ({ ok: false, error: error?.message }));
  if (!result?.ok) toast(result?.error || "Could not open it", true);
}

async function reveal() {
  const result = await window.viewer.reveal().catch(() => null);
  if (!result?.ok) toast("No folder to show", true);
}

// Copy, Open with, Show in folder: on every kind that has them.
function commonTools() {
  const tools = [];
  if (["image", "markdown", "text"].includes(item.kind)) tools.push(tool("v-copy", "Copy", copyItem, { title: item.kind === "image" ? "Copy image" : "Copy text" }));
  if (item.canOpenExternally && item.kind !== "folder") tools.push(tool("v-open", "Open with", openExternally, { title: "Open with the default app" }));
  if (item.canReveal) tools.push(tool("v-reveal", "", reveal, { title: "Show in folder", showLabel: false }));
  return tools;
}

// --- Images -----------------------------------------------------------------------------

function renderImage(stage, tools) {
  stage.className = "stage image-stage";
  const image = new Image();
  image.alt = item.name;
  image.draggable = false;
  image.decoding = "async";
  stage.append(image);
  const zoomValue = Object.assign(document.createElement("span"), { className: "zoom-value", textContent: "" });
  let scale = 1;
  let fit = true;
  let x = 0;
  let y = 0;
  const fitScale = () => Math.min(1, (stage.clientWidth - 48) / image.naturalWidth, (stage.clientHeight - 48) / image.naturalHeight);
  const apply = () => {
    image.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    zoomValue.textContent = `${Math.round(scale * 100)}%`;
    zoomValue.title = fit ? "Fitted to the window" : "";
    stage.classList.toggle("pixelated", scale >= 3);
  };
  const centre = () => {
    x = (stage.clientWidth - image.naturalWidth * scale) / 2;
    y = (stage.clientHeight - image.naturalHeight * scale) / 2;
  };
  const toFit = () => { fit = true; scale = fitScale(); centre(); apply(); };
  // Zoom about a point of the stage, so what is under the pointer stays under it.
  const zoomTo = (next, at = { x: stage.clientWidth / 2, y: stage.clientHeight / 2 }) => {
    const clamped = Math.max(0.05, Math.min(32, next));
    x = at.x - ((at.x - x) * clamped) / scale;
    y = at.y - ((at.y - y) * clamped) / scale;
    scale = clamped;
    fit = false;
    apply();
  };
  view.zoom = { fit: toFit, in: () => zoomTo(scale * 1.25), out: () => zoomTo(scale / 1.25), actual: () => { zoomTo(1); centre(); apply(); } };
  image.addEventListener("load", () => {
    toFit();
    setMeta([`${image.naturalWidth} × ${image.naturalHeight}`, item.size ? formatBytes(item.size) : "", item.path || ""]);
  });
  image.addEventListener("error", () => renderEmpty(stage, { title: "This image could not be shown", text: item.path || item.name, iconName: "v-missing" }));
  image.src = item.dataUrl;
  stage.addEventListener("wheel", (event) => {
    event.preventDefault();
    const box = stage.getBoundingClientRect();
    zoomTo(scale * Math.exp(-event.deltaY * 0.0015), { x: event.clientX - box.left, y: event.clientY - box.top });
  }, { passive: false });
  let drag = null;
  stage.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    drag = { pointerX: event.clientX, pointerY: event.clientY, x, y };
    stage.setPointerCapture(event.pointerId);
    stage.classList.add("dragging");
  });
  stage.addEventListener("pointermove", (event) => {
    if (!drag) return;
    x = drag.x + event.clientX - drag.pointerX;
    y = drag.y + event.clientY - drag.pointerY;
    fit = false;
    apply();
  });
  const endDrag = () => { drag = null; stage.classList.remove("dragging"); };
  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);
  stage.addEventListener("dblclick", (event) => {
    const box = stage.getBoundingClientRect();
    if (fit) zoomTo(1, { x: event.clientX - box.left, y: event.clientY - box.top });
    else toFit();
  });
  new ResizeObserver(() => { if (fit && image.naturalWidth) toFit(); }).observe(stage);
  tools.push(
    tool("v-minus", "", () => view.zoom.out(), { title: "Zoom out (−)", showLabel: false }),
    zoomValue,
    tool("v-plus", "", () => view.zoom.in(), { title: "Zoom in (+)", showLabel: false }),
    tool("v-fit", "Fit", () => view.zoom.fit(), { title: "Fit to window (0)" }),
    tool("", "100%", () => view.zoom.actual(), { title: "Actual size (1)" }),
    separator(),
  );
}

// --- Documents and code -----------------------------------------------------------------

function codeView(html, lineCount, line = null) {
  const wrap = document.createElement("div");
  wrap.className = "code-view";
  const gutter = document.createElement("div");
  gutter.className = "gutter";
  gutter.textContent = Array.from({ length: Math.max(1, lineCount) }, (_, index) => index + 1).join("\n");
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.className = "hljs";
  code.innerHTML = html; // highlight.js output or escaped text, made in main
  pre.append(code);
  wrap.append(gutter, pre);
  if (Number.isFinite(line) && line > 0) {
    const mark = Object.assign(document.createElement("div"), { className: "line-mark" });
    mark.style.top = `${14 + (line - 1) * 20}px`;
    wrap.style.position = "relative";
    wrap.append(mark);
    requestAnimationFrame(() => { $("#stage").scrollTop = Math.max(0, (line - 1) * 20 - $("#stage").clientHeight / 3); });
  }
  return wrap;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function renderMarkdown(stage, tools) {
  const segmented = document.createElement("div");
  segmented.className = "segmented";
  const preview = tool("", "Preview", () => { view.markdownSource = false; render(); }, { pressed: !view.markdownSource });
  const source = tool("", "Source", () => { view.markdownSource = true; render(); }, { pressed: view.markdownSource });
  segmented.append(preview, source);
  tools.push(segmented, separator());
  if (view.markdownSource) {
    stage.append(codeView(escapeHtml(item.text || ""), item.lineCount));
    return;
  }
  const doc = document.createElement("article");
  doc.className = "doc";
  doc.innerHTML = item.html; // markdown.cjs output, sanitized in main
  stage.append(doc);
}

function renderText(stage) {
  stage.append(codeView(item.html, item.lineCount, item.line));
  if (item.truncated) stage.append(Object.assign(document.createElement("div"), { className: "truncated-note", textContent: `Showing the first ${formatBytes(item.text.length)} of ${formatBytes(item.size)}. Open it with the default app for the rest.` }));
}

function renderEmpty(stage, { title, text, iconName, actions = [] }) {
  stage.className = "stage";
  stage.replaceChildren();
  const wrap = document.createElement("div");
  wrap.className = "empty";
  const card = document.createElement("div");
  card.className = "empty-card";
  const big = Object.assign(document.createElement("span"), { className: "big" });
  big.append(icon(iconName));
  card.append(big, Object.assign(document.createElement("b"), { textContent: title }), Object.assign(document.createElement("p"), { textContent: text }));
  if (actions.length) {
    const row = document.createElement("div");
    row.className = "empty-actions";
    for (const [label, run, accent] of actions) {
      const button = Object.assign(document.createElement("button"), { type: "button", className: `button${accent ? " accent" : ""}`, textContent: label });
      button.addEventListener("click", run);
      row.append(button);
    }
    card.append(row);
  }
  wrap.append(card);
  stage.append(wrap);
}

// --- The page ---------------------------------------------------------------------------

// The line under the name. It is cut from the left, so a long path keeps its file end.
function setMeta(parts) {
  const metaNode = $("#itemMeta");
  metaNode.replaceChildren(Object.assign(document.createElement("bdi"), { textContent: parts.filter(Boolean).join(" · ") }));
  metaNode.title = item?.path || "";
}

function render() {
  if (!item) return;
  document.title = item.name || "Viewer";
  const kindIcon = $("#kindIcon");
  kindIcon.className = `kind-icon ${item.kind}`;
  kindIcon.replaceChildren(icon(KIND_ICONS[item.kind] || "v-file"));
  $("#itemName").textContent = item.name || "Untitled";
  const meta = [];
  if (item.kind === "text" && item.language) meta.push(item.language);
  if (["text", "markdown"].includes(item.kind) && item.lineCount) meta.push(`${item.lineCount.toLocaleString("en-US")} lines`);
  if (item.size) meta.push(formatBytes(item.size));
  if (item.path) meta.push(item.path);
  setMeta(meta);
  const stage = $("#stage");
  stage.className = "stage";
  stage.replaceChildren();
  stage.scrollTop = 0;
  stage.scrollLeft = 0;
  // Restart the entrance for every new item.
  stage.style.animation = "none";
  void stage.offsetWidth;
  stage.style.animation = "";
  const tools = [];
  view.zoom = null;
  if (item.kind === "image") renderImage(stage, tools);
  else if (item.kind === "markdown") renderMarkdown(stage, tools);
  else if (item.kind === "text") renderText(stage);
  else if (item.kind === "missing") renderEmpty(stage, { title: "File not found", text: item.path || item.name, iconName: "v-missing" });
  else if (item.kind === "folder") renderEmpty(stage, { title: "This is a folder", text: item.path, iconName: "v-folder", actions: [["Open folder", openExternally, true]] });
  else renderEmpty(stage, {
    title: "Deck cannot show this file",
    text: `${item.reason ? `${item.reason}. ` : ""}${item.path || item.name}`,
    iconName: "v-file",
    actions: [...(item.canOpenExternally ? [["Open with default app", openExternally, true]] : []), ...(item.canReveal ? [["Show in folder", reveal, false]] : [])],
  });
  $("#tools").replaceChildren(...tools, ...commonTools());
  stage.focus({ preventScroll: true });
}

function show(next) {
  item = next;
  view = { markdownSource: false, zoom: null };
  render();
}

// Links in a document: the web goes to the browser, a file opens here.
document.addEventListener("click", (event) => {
  const link = event.target.closest?.("a[href]");
  if (!link) return;
  event.preventDefault();
  const target = link.dataset.file || link.getAttribute("href") || "";
  if (!target || target.startsWith("#")) {
    const anchor = target.length > 1 ? document.getElementById(decodeURIComponent(target.slice(1))) : null;
    anchor?.scrollIntoView({ block: "start" });
    return;
  }
  window.viewer.openLink(target).catch((error) => toast(String(error?.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), true));
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") { event.preventDefault(); window.viewer.close(); return; }
  const mod = event.ctrlKey || event.metaKey;
  if (mod && event.key.toLowerCase() === "c" && !String(getSelection())) { event.preventDefault(); copyItem(); return; }
  if (mod && event.key.toLowerCase() === "w") { event.preventDefault(); window.viewer.close(); return; }
  if (!view.zoom || mod || event.altKey) return;
  if (["+", "="].includes(event.key)) view.zoom.in();
  else if (event.key === "-") view.zoom.out();
  else if (event.key === "0") view.zoom.fit();
  else if (event.key === "1") view.zoom.actual();
});

window.viewer.onItem(show);
window.viewer.getItem().then((value) => { if (value && !item) show(value); }).catch(() => {});
