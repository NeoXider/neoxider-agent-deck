const MarkdownIt = require("markdown-it");
const sanitizeHtml = require("sanitize-html");
const hljs = require("highlight.js/lib/common");

// Highlighting is decoration: never run language detection over an entire pasted log.
const MAX_HIGHLIGHT_CHARS = 20000;
const MAX_AUTO_HIGHLIGHT_CHARS = 2000;

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  typographer: false,
  highlight(code, language) {
    if (code.length > MAX_HIGHLIGHT_CHARS) return "";
    const requestedLanguage = String(language || "").trim().toLowerCase();
    if (requestedLanguage && hljs.getLanguage(requestedLanguage)) {
      return hljs.highlight(code, {
        language: requestedLanguage,
        ignoreIllegals: true,
      }).value;
    }
    return code.length <= MAX_AUTO_HIGHLIGHT_CHARS ? hljs.highlightAuto(code).value : "";
  },
});

function renderMarkdown(value) {
  const source = String(value || "");
  return sanitizeHtml(markdown.render(source), {
    allowedTags: [
      "p", "br", "strong", "em", "s", "blockquote", "code", "pre", "hr",
      "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6",
      "table", "thead", "tbody", "tr", "th", "td", "a", "span",
    ],
    allowedAttributes: {
      a: ["href", "title", "target", "rel"],
      code: ["class"],
      span: ["class"],
    },
    allowedClasses: {
      code: ["hljs", "language-*"],
      span: ["hljs-*"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowProtocolRelative: false,
    transformTags: {
      a: (_tagName, attributes) => ({
        tagName: "a",
        attribs: { ...attributes, target: "_blank", rel: "noopener noreferrer" },
      }),
    },
  });
}

function createMarkdownCache({ maxEntries = 256, maxBytes = 8 * 1024 * 1024, render = renderMarkdown } = {}) {
  const entries = new Map();
  let bytes = 0;
  return function cachedMarkdown(value) {
    const source = String(value || "");
    const found = entries.get(source);
    if (found) {
      entries.delete(source);
      entries.set(source, found);
      return found.html;
    }
    const html = render(source);
    // Strings can take two bytes per code unit. Oversized answers are rendered intact,
    // but must not evict every useful short answer or stay retained in memory.
    const size = 2 * (source.length + html.length);
    if (size <= maxBytes && maxEntries > 0) {
      while (entries.size && (entries.size >= maxEntries || bytes + size > maxBytes)) {
        const oldest = entries.keys().next().value;
        bytes -= entries.get(oldest).size;
        entries.delete(oldest);
      }
      entries.set(source, { html, size });
      bytes += size;
    }
    return html;
  };
}

module.exports = { renderMarkdown, createMarkdownCache };
