function harnessSessionUrl(baseUrl, sessionId) {
  const url = new URL(baseUrl);
  const normalized = String(sessionId || "").trim();
  if (normalized) url.searchParams.set("sessionId", normalized);
  return url.href;
}

module.exports = { harnessSessionUrl };
