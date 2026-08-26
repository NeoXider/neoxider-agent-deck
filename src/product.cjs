const PRODUCT_NAME = "NeoXider Agent Deck";
const PACKAGE_NAME = "neoxider-agent-deck";
const APP_ID = "dev.neoxider.agentdeck";
const REPOSITORY_SLUG = "NeoXider/neoxider-agent-deck";
const REPOSITORY_URL = `https://github.com/${REPOSITORY_SLUG}`;
const USER_DATA_SEGMENTS = Object.freeze(["NeoXider", "AgentDeck"]);

const LEGACY = Object.freeze({
  appId: "dev.neoxider.deepseekHarnessWidget",
  loginItemNames: Object.freeze([
    "electron.app.DeepSeek Harness Widget",
    "dev.neoxider.deepseekHarnessWidget",
  ]),
  userDataDirectoryNames: Object.freeze([
    "deepseek-harness-widget",
    "DeepSeek Harness Widget",
  ]),
});

module.exports = {
  APP_ID,
  LEGACY,
  PACKAGE_NAME,
  PRODUCT_NAME,
  REPOSITORY_SLUG,
  REPOSITORY_URL,
  USER_DATA_SEGMENTS,
};
