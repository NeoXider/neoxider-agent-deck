// Persist only bounded, local raster images; never URLs or SVG markup.
function normalizeBackground(value) {
  const background = ["none", "cave", "forest", "cyberpunk", "custom"].includes(value?.background) ? value.background : "none";
  const customBackground = typeof value?.customBackground === "string" && value.customBackground.length <= 2800000
    && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value.customBackground) ? value.customBackground : "";
  const imageOpacity = typeof value?.imageOpacity === "number" && Number.isFinite(value.imageOpacity) ? Math.max(0, Math.min(1, value.imageOpacity)) : 0.30;
  return { background, customBackground, imageOpacity, overrideBackground: value?.overrideBackground === true };
}
function normalizeDesignProfiles(profiles) {
  const result = [];
  const names = new Set();
  let imageBytes = 0;
  for (const value of Array.isArray(profiles) ? profiles.slice(0, 8) : []) {
    const name = typeof value?.name === "string" ? value.name.trim().slice(0, 40) : "";
    if (!name || names.has(name)) continue;
    names.add(name);
    const background = normalizeBackground(value);
    imageBytes += background.customBackground.length;
    if (imageBytes > 12000000) continue;
    result.push({ name, theme: ["aurora", "graphite", "midnight", "cyberpunk", "cave"].includes(value.theme) ? value.theme : "aurora",
      motion: value.motion === "subtle" ? "subtle" : "fluid", inputBorder: value.inputBorder !== false,
      windowBorder: value.windowBorder === true, ...background });
  }
  return result;
}
module.exports = { normalizeBackground, normalizeDesignProfiles };
