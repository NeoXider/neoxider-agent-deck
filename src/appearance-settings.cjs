// Every theme Deck draws, the first being the default. Claude follows the Claude Code app:
// warm slate, ivory text and the clay accent.
const DESIGN_THEMES = Object.freeze(["claude", "aurora", "graphite", "midnight", "cyberpunk", "cave"]);
const DEFAULT_THEME = DESIGN_THEMES[0];
// Raised when a release moves everyone to a new look once. 2: the Claude theme.
const APPEARANCE_REVISION = 2;

function designTheme(value) {
  return DESIGN_THEMES.includes(value) ? value : DEFAULT_THEME;
}

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
    result.push({ name, theme: designTheme(value.theme),
      motion: value.motion === "subtle" ? "subtle" : "fluid", inputBorder: value.inputBorder !== false,
      windowBorder: value.windowBorder === true, ...background });
  }
  return result;
}
// The saved look. A file from before APPEARANCE_REVISION is moved to the default theme once,
// keeping a background the user picked by hand; after that every choice stays as made.
function normalizeAppearance(value, revision) {
  const migrate = revision !== APPEARANCE_REVISION;
  const background = normalizeBackground(value);
  return {
    theme: migrate ? DEFAULT_THEME : designTheme(value?.theme),
    motion: ["fluid", "subtle"].includes(value?.motion) ? value.motion : "fluid",
    inputBorder: value?.inputBorder !== false,
    windowBorder: value?.windowBorder === true,
    ...background,
    ...(migrate && !background.overrideBackground ? { background: "none" } : {}),
    profiles: normalizeDesignProfiles(value?.profiles),
  };
}

module.exports = { APPEARANCE_REVISION, DEFAULT_THEME, DESIGN_THEMES, designTheme, normalizeAppearance, normalizeBackground, normalizeDesignProfiles };
