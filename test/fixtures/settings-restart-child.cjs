const { createSettingsStore } = require("../../src/settings-store.cjs");

const [action, filePath] = process.argv.slice(2);
const store = createSettingsStore({ filePath });

if (action === "save") {
  store.save(JSON.parse(process.env.WIDGET_TEST_PREFERENCES || "{}"));
} else if (action === "load") {
  process.stdout.write(JSON.stringify(store.load()));
} else {
  process.exitCode = 2;
}
