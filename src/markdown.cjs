const MarkdownIt = require("markdown-it");
const sanitizeHtml = require("sanitize-html");

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  typographer: false,
});

function renderMarkdown(value) {
  const source = String(value || "");
  return sanitizeHtml(markdown.render(source), {
    allowedTags: [
      "p", "br", "strong", "em", "s", "blockquote", "code", "pre", "hr",
      "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6",
      "table", "thead", "tbody", "tr", "th", "td", "a",
    ],
    allowedAttributes: { a: ["href", "title", "target", "rel"] },
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
