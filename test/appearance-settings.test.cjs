const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeBackground, normalizeDesignProfiles } = require('../src/appearance-settings.cjs');
const { normalizePreferences, createSettingsStore } = require('../src/settings-store.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('backgrounds reject remote URLs, SVG and oversized data', () => {
  for (const image of ['https://example.com/a.png', 'data:image/svg+xml;base64,AAAA', 'data:image/png;base64,' + 'A'.repeat(2800000)]) {
    assert.equal(normalizeBackground({ background: 'custom', customBackground: image }).customBackground, '');
  }
  assert.equal(normalizeBackground({ background: '../bad' }).background, 'none');
  assert.equal(normalizeBackground({ imageOpacity: -1 }).imageOpacity, 0);
  assert.equal(normalizeBackground({ imageOpacity: 2 }).imageOpacity, 1);
});

test('named profiles persist bounded appearance snapshots without recursive profiles', () => {
  const profiles = normalizeDesignProfiles([{ name: ' Cave ', theme: 'cyberpunk', background: 'cave', imageOpacity: .67, profiles: [{ name: 'nested' }] }, { name: 'Cave' }]);
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].name, 'Cave');
  assert.equal(profiles[0].imageOpacity, .67);
  assert.equal(profiles[0].profiles, undefined);
  assert.deepEqual(normalizePreferences({ appearance: { profiles } }).appearance.profiles, profiles);
});

test('cyberpunk and custom image survive disk save/reload, including disabling the picture', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-background-'));
  const filePath = path.join(directory, 'settings.json');
  try {
    const appearance = { theme: 'cyberpunk', motion: 'fluid', inputBorder: true, windowBorder: false,
      background: 'custom', customBackground: 'data:image/png;base64,AAAA', imageOpacity: .42, profiles: [] };
    createSettingsStore({ filePath }).save(normalizePreferences({ appearance }));
    assert.deepEqual(createSettingsStore({ filePath }).load().appearance, appearance);
    appearance.background = 'none';
    createSettingsStore({ filePath }).save(normalizePreferences({ appearance }));
    assert.deepEqual(createSettingsStore({ filePath }).load().appearance, appearance);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
