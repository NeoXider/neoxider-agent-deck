const MarkdownIt = require("markdown-it");
const sanitizeHtml = require("sanitize-html");
const hljs = require("highlight.js/lib/common");

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  typographer: false,
  highlight(code, language) {
    const requestedLanguage = String(language || "").trim().toLowerCase();
    if (requestedLanguage && hljs.getLanguage(requestedLanguage)) {
      return hljs.highlight(code, {
        language: requestedLanguage,
        ignoreIllegals: true,
      }).value;
    }
    return hljs.highlightAuto(code).value;
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

module.exports = { renderMarkdown };
