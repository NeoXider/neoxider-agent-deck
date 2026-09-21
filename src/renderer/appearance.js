/* Settings stay mounted across tab changes: drafts, focus and control state survive. */
(() => {
  const panel = document.querySelector('#settingsPanel');
  const general = document.createElement('div');
  general.id = 'settings-general';
  general.className = 'settings-page';
  general.setAttribute('role', 'tabpanel');
  general.setAttribute('aria-labelledby', 'settings-tab-general');
  [...panel.children].slice(1).forEach(node => general.append(node));
  const tabs = document.createElement('div');
  tabs.className = 'settings-tabs';
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Settings sections');
  tabs.innerHTML = '<button id="settings-tab-general" role="tab" aria-controls="settings-general" aria-selected="true" type="button">General</button><button id="settings-tab-design" role="tab" aria-controls="settings-design" aria-selected="false" tabindex="-1" type="button">Appearance</button><button id="settings-tab-keys" role="tab" aria-controls="settings-keys" aria-selected="false" tabindex="-1" type="button">Shortcuts</button>';
  const design = document.createElement('div');
  design.id = 'settings-design';
  design.className = 'settings-page';
  design.hidden = true;
  design.setAttribute('role', 'tabpanel');
  design.setAttribute('aria-labelledby', 'settings-tab-design');
  design.innerHTML = `<p class="design-intro">Make Deck feel like yours.</p>
    <details class="theme-picker"><summary>Theme <b id="themeChoiceLabel">Aurora</b><svg class="ui-icon theme-chevron" aria-hidden="true"><use href="#icon-chevron"/></svg></summary><div class="design-themes" role="group" aria-label="Theme previews">
      <button type="button" data-theme-choice="aurora"><span class="theme-swatch swatch-aurora" aria-hidden="true"></span><b>Aurora</b><small>Soft light</small></button>
      <button type="button" data-theme-choice="graphite"><span class="theme-swatch swatch-graphite" aria-hidden="true"></span><b>Graphite</b><small>Quiet & matte</small></button>
      <button type="button" data-theme-choice="midnight"><span class="theme-swatch swatch-midnight" aria-hidden="true"></span><b>Midnight</b><small>Deep blue</small></button>
      <button type="button" data-theme-choice="cave"><span class="theme-swatch swatch-cave" aria-hidden="true"></span><b>Cave</b><small>Anime sanctuary</small></button>
      <button type="button" data-theme-choice="cyberpunk"><span class="theme-swatch swatch-cyberpunk" aria-hidden="true"></span><b>Cyberpunk</b><small>Neon city</small></button>
    </div></details>
    <label class="setting-block">My profiles<select id="designProfileChoice"><option value="">Choose saved profile…</option></select></label>
    <div class="profile-editor"><input id="designProfileName" aria-label="Profile name" maxlength="40" placeholder="Profile name" /><button id="saveDesignProfile" type="button">Save</button><button id="deleteDesignProfile" type="button">Delete</button></div>
    <label class="toggle-setting"><span>Override theme background</span><input id="overrideBackground" type="checkbox" /></label>
    <details class="background-picker theme-picker"><summary>Background <b id="backgroundChoiceLabel">No image</b><svg class="ui-icon theme-chevron" aria-hidden="true"><use href="#icon-chevron"/></svg></summary><div class="design-themes" role="group" aria-label="Background previews">
      <button type="button" data-background-choice="none"><span class="theme-swatch swatch-none" aria-hidden="true">∅</span><b>No image</b></button>
      <button type="button" data-background-choice="cave"><img class="theme-swatch" src="assets/backgrounds/cave.webp" alt="" /><b>Anime cave</b></button>
      <button type="button" data-background-choice="forest"><img class="theme-swatch" src="assets/backgrounds/forest.webp" alt="" /><b>Night forest</b></button>
      <button type="button" data-background-choice="cyberpunk"><img class="theme-swatch" src="assets/backgrounds/cyberpunk.webp" alt="" /><b>Cyberpunk city</b></button>
      <button type="button" data-background-choice="custom"><span class="theme-swatch swatch-none" aria-hidden="true">＋</span><b>Your image</b></button>
    </div></details>
    <select id="backgroundChoice" hidden aria-label="Background"><option value="none">No image</option><option value="cave">Anime cave</option><option value="forest">Night forest</option><option value="cyberpunk">Cyberpunk city</option><option value="custom">Custom image</option></select>
    <figure class="background-preview"><img id="backgroundPreview" alt="Current background preview" hidden /><figcaption id="backgroundPreviewLabel">No background image</figcaption></figure>
    <label class="setting-block">Image opacity <output id="imageOpacityValue">30%</output><input id="imageOpacityRange" type="range" min="0" max="100" value="30" /></label>
    <label class="setting-block">Choose your image<input id="backgroundFile" type="file" accept="image/png,image/jpeg,image/webp" /><small>PNG, JPEG or WebP, up to 2 MB</small></label>
    <div class="setting-block"><span>Movement</span><div class="layer-switch" role="group" aria-label="Movement"><button type="button" data-motion-choice="fluid">Fluid</button><button type="button" data-motion-choice="subtle">Subtle</button></div></div>
    <label class="toggle-setting"><span><span>Input activity border</span><small>Animated colours around the message field while working</small></span><input id="inputBorderToggle" data-border-choice="inputBorder" type="checkbox" checked /></label>
    <label class="toggle-setting"><span><span>Window activity border</span><small>The same activity colours around the whole widget</small></span><input id="windowBorderToggle" data-border-choice="windowBorder" type="checkbox" /></label>
    <small id="appearanceStatus" class="setting-hint" role="status">Changes are previewed immediately and saved.</small>`;
  for (const id of ['motionEffectsToggle', 'glowRange', 'backgroundOpacityRange', 'opacityRange']) {
    const row = general.querySelector(`#${id}`)?.closest('label');
    if (row) design.insertBefore(row, design.lastElementChild);
  }
  const keys = document.createElement('div');
  keys.id = 'settings-keys'; keys.className = 'settings-page'; keys.hidden = true;
  keys.setAttribute('role', 'tabpanel'); keys.setAttribute('aria-labelledby', 'settings-tab-keys');
  const hotkeys = general.querySelector('#hotkeySettings');
  hotkeys.open = true; keys.append(hotkeys);
  panel.append(tabs, general, design, keys);
  const backdrop = document.createElement('img');
  backdrop.className = 'deck-backdrop'; backdrop.alt = ''; backdrop.hidden = true;
  document.querySelector('.widget-shell').prepend(backdrop);
  const buttons = [...tabs.querySelectorAll('button')];
  function selectTab(index, focus = false) {
    buttons.forEach((button, i) => {
      button.setAttribute('aria-selected', String(i === index));
      button.tabIndex = i === index ? 0 : -1;
    });
    general.hidden = index !== 0;
    design.hidden = index !== 1;
    keys.hidden = index !== 2;
    tabs.style.setProperty('--tab-index', String(index));
    panel.scrollTop = 0;
    if (focus) buttons[index].focus();
  }
  buttons.forEach((button, index) => button.addEventListener('click', () => selectTab(index)));
  tabs.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = buttons.indexOf(document.activeElement);
    selectTab(event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (Math.max(0, current) + (event.key === 'ArrowRight' ? 1 : 2)) % 3, true);
  });
  const themeBackground = { aurora: 'none', graphite: 'none', midnight: 'none', cyberpunk: 'cyberpunk', cave: 'cave' };
  let profileSignature = '';
  let confirmed = { theme: 'aurora', motion: 'fluid', inputBorder: true, windowBorder: false, background: 'none', customBackground: '', imageOpacity: .30, overrideBackground: false, profiles: [] };
  let current = { ...confirmed };
  let saving = Promise.resolve();
  let revision = 0;
  function apply(value) {
    current = {
      theme: ['aurora', 'graphite', 'midnight', 'cyberpunk', 'cave'].includes(value?.theme) ? value.theme : 'aurora',
      motion: value?.motion === 'subtle' ? 'subtle' : 'fluid',
      inputBorder: value?.inputBorder !== false,
      windowBorder: value?.windowBorder === true,
      imageOpacity: typeof value?.imageOpacity === 'number' && Number.isFinite(value.imageOpacity) ? Math.max(0, Math.min(1, value.imageOpacity)) : .30,
      overrideBackground: value?.overrideBackground === true,
      profiles: Array.isArray(value?.profiles) ? value.profiles.slice(0, 8) : [],
      background: ['none', 'cave', 'forest', 'cyberpunk', 'custom'].includes(value?.background) ? value.background : 'none',
      customBackground: /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value?.customBackground || '') && value.customBackground.length <= 2800000 ? value.customBackground : '',
    };
    document.body.dataset.design = current.theme;
    design.querySelector('#themeChoiceLabel').textContent = current.theme[0].toUpperCase() + current.theme.slice(1);
    backdrop.style.opacity = String(current.imageOpacity);
    design.querySelector('#imageOpacityRange').value = Math.round(current.imageOpacity * 100);
    design.querySelector('#imageOpacityValue').textContent = `${Math.round(current.imageOpacity * 100)}%`;
    const profiles = design.querySelector('#designProfileChoice');
    const selectedProfile = profiles.value;
    const signature = JSON.stringify(current.profiles.map(profile => profile.name));
    if (signature !== profileSignature) {
      profiles.replaceChildren(new Option('Choose saved profile…', ''));
      for (const profile of current.profiles) profiles.add(new Option(profile.name, profile.name));
      profiles.value = selectedProfile;
      profileSignature = signature;
    }
    design.querySelector('#overrideBackground').checked = current.overrideBackground;
    const image = current.background === 'custom' ? current.customBackground : current.background === 'none' ? '' : `assets/backgrounds/${current.background}.webp`;
    if (image) { if (backdrop.getAttribute('src') !== image) backdrop.src = image; } else backdrop.removeAttribute('src');
    backdrop.hidden = !image;
    const preview = design.querySelector('#backgroundPreview');
    if (image) { if (preview.getAttribute('src') !== image) preview.src = image; } else preview.removeAttribute('src');
    preview.hidden = !image;
    design.querySelector('#backgroundPreviewLabel').textContent = image ? ({ cave: 'Anime cave', forest: 'Night forest', cyberpunk: 'Cyberpunk city', custom: 'Your image' }[current.background]) : 'No background image';
    document.body.dataset.background = image ? current.background : 'none';
    design.querySelector('#backgroundChoice').value = current.background;
    design.querySelector('#backgroundChoiceLabel').textContent = design.querySelector('#backgroundChoice').selectedOptions[0].textContent;
    design.querySelectorAll('[data-background-choice]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.backgroundChoice === current.background)));
    document.body.dataset.motion = current.motion;
    document.body.dataset.inputBorder = String(current.inputBorder);
    document.body.dataset.windowBorder = String(current.windowBorder);
    design.querySelectorAll('[data-border-choice]').forEach(input => { input.checked = current[input.dataset.borderChoice]; });
    design.querySelectorAll('[data-theme-choice]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.themeChoice === current.theme)));
    design.querySelectorAll('[data-motion-choice]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.motionChoice === current.motion)));
  }
  function save(next) {
    const ticket = ++revision;
    apply(next);
    const status = document.getElementById('appearanceStatus');
    status.textContent = 'Saving…';
    // Serialize writes so a slow earlier save cannot replace the last selection.
    saving = saving.then(async () => {
      try {
        confirmed = await window.widget.setAppearance(next);
        if (ticket === revision) status.textContent = 'Saved';
      } catch {
        if (ticket === revision) {
          apply(confirmed);
          status.textContent = 'Could not save. Your previous design has been restored.';
        }
      }
    });
  }
  design.addEventListener('click', event => {
    const background = event.target.closest('[data-background-choice]');
    if (background) {
      const select = design.querySelector('#backgroundChoice');
      select.value = background.dataset.backgroundChoice;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      if (select.value === 'custom' && !current.customBackground) design.querySelector('#backgroundFile').click();
    }
    if (event.target.id === 'saveDesignProfile') {
      const name = design.querySelector('#designProfileName').value.trim();
      const status = document.getElementById('appearanceStatus');
      if (!name) { status.textContent = 'Enter a profile name.'; return; }
      const { profiles, ...snapshot } = current;
      const next = [...profiles.filter(item => item.name !== name), { name, ...snapshot }];
      if (next.length > 8 || next.reduce((size, item) => size + (item.customBackground?.length || 0), 0) > 12000000) {
        status.textContent = 'Profile storage is full. Delete a profile first.'; return;
      }
      save({ ...current, profiles: next });
      design.querySelector('#designProfileChoice').value = name;
    }
    if (event.target.id === 'deleteDesignProfile') {
      const name = design.querySelector('#designProfileChoice').value;
      if (name) save({ ...current, profiles: current.profiles.filter(item => item.name !== name) });
    }
    const choice = event.target.closest('[data-theme-choice], [data-motion-choice]');
    if (choice) save({ ...current, ...(choice.dataset.themeChoice ? { theme: choice.dataset.themeChoice, ...(!current.overrideBackground ? { background: themeBackground[choice.dataset.themeChoice] } : {}) } : { motion: choice.dataset.motionChoice }) });
  });
  design.addEventListener('input', event => {
    if (event.target.id !== 'imageOpacityRange') return;
    current.imageOpacity = Number(event.target.value) / 100;
    backdrop.style.opacity = String(current.imageOpacity);
    design.querySelector('#imageOpacityValue').textContent = `${event.target.value}%`;
  });
  design.addEventListener('change', async event => {
    if (event.target.id === 'overrideBackground') save({ ...current, overrideBackground: event.target.checked, ...(!event.target.checked ? { background: themeBackground[current.theme] } : {}) });
    if (event.target.id === 'imageOpacityRange') save({ ...current, imageOpacity: Number(event.target.value) / 100 });
    if (event.target.id === 'designProfileChoice') {
      const profile = current.profiles.find(item => item.name === event.target.value);
      if (profile) {
        design.querySelector('#designProfileName').value = profile.name;
        save({ ...current, ...profile, profiles: current.profiles });
      }
    }
    if (event.target.id === 'backgroundChoice') {
      const background = event.target.value;
      save({ ...current, background, overrideBackground: true });
    }
    if (event.target.id === 'backgroundFile') {
      const file = event.target.files[0]; if (!file) return;
      const status = document.getElementById('appearanceStatus');
      if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {
        status.textContent = 'Choose PNG, JPEG or WebP up to 2 MB.'; event.target.value = ''; return;
      }
      const reader = new FileReader();
      reader.onload = () => save({ ...current, background: 'custom', overrideBackground: true, customBackground: reader.result });
      reader.onerror = () => { status.textContent = 'Could not read this image.'; };
      reader.readAsDataURL(file);
    }
    const key = event.target.dataset.borderChoice;
    if (key) save({ ...current, [key]: event.target.checked });
  });
  window.deckAppearance = { apply(value) { apply(value); confirmed = { ...current }; }, selectTab };
  apply(confirmed);
})();
