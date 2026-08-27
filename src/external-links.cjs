const EXTERNAL_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

function parseExternalUrl(value) {
  try {
    const url = new URL(String(value));
    return EXTERNAL_LINK_PROTOCOLS.has(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function createExternalLinkOpener({ openExternal }) {
  if (typeof openExternal !== "function") throw new TypeError("openExternal must be a function");
  return (value) => {
    const url = parseExternalUrl(value);
    if (!url) return false;
    openExternal(url);
    return true;
  };
}

module.exports = { createExternalLinkOpener, parseExternalUrl };
