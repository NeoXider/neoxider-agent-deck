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
  tabs.innerHTML = '<button id="settings-tab-general" role="tab" aria-controls="settings-general" aria-selected="true" type="button">General</button><button id="settings-tab-design" role="tab" aria-controls="settings-design" aria-selected="false" tabindex="-1" type="button">Appearance</button>';
  const design = document.createElement('div');
  design.id = 'settings-design';
  design.className = 'settings-page';
  design.hidden = true;
  design.setAttribute('role', 'tabpanel');
  design.setAttribute('aria-labelledby', 'settings-tab-design');
  design.innerHTML = `<p class="design-intro">Make Deck feel like yours.</p>
    <div class="design-themes" role="group" aria-label="Design">
      <button type="button" data-theme-choice="aurora"><span class="theme-swatch swatch-aurora" aria-hidden="true"></span><b>Aurora</b><small>Soft light</small></button>
      <button type="button" data-theme-choice="graphite"><span class="theme-swatch swatch-graphite" aria-hidden="true"></span><b>Graphite</b><small>Quiet & matte</small></button>
      <button type="button" data-theme-choice="midnight"><span class="theme-swatch swatch-midnight" aria-hidden="true"></span><b>Midnight</b><small>Deep blue</small></button>
    </div>
    <div class="setting-block"><span>Movement</span><div class="layer-switch" role="group" aria-label="Movement"><button type="button" data-motion-choice="fluid">Fluid</button><button type="button" data-motion-choice="subtle">Subtle</button></div></div>
    <small id="appearanceStatus" class="setting-hint" role="status">Changes are previewed immediately and saved.</small>`;
  for (const id of ['motionEffectsToggle', 'glowRange', 'backgroundOpacityRange', 'opacityRange']) {
    const row = general.querySelector(`#${id}`)?.closest('label');
    if (row) design.insertBefore(row, design.lastElementChild);
  }
  panel.append(tabs, general, design);
  const buttons = [...tabs.querySelectorAll('button')];
  function selectTab(index, focus = false) {
    buttons.forEach((button, i) => {
      button.setAttribute('aria-selected', String(i === index));
      button.tabIndex = i === index ? 0 : -1;
    });
    general.hidden = index !== 0;
    design.hidden = index !== 1;
    panel.scrollTop = 0;
    if (focus) buttons[index].focus();
  }
  buttons.forEach((button, index) => button.addEventListener('click', () => selectTab(index)));
  tabs.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = buttons.indexOf(document.activeElement);
    selectTab(event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - Math.max(0, current), true);
  });
  let confirmed = { theme: 'aurora', motion: 'fluid' };
  let current = { ...confirmed };
  let saving = Promise.resolve();
  let revision = 0;
  function apply(value) {
    current = {
      theme: ['aurora', 'graphite', 'midnight'].includes(value?.theme) ? value.theme : 'aurora',
      motion: value?.motion === 'subtle' ? 'subtle' : 'fluid',
    };
    document.body.dataset.design = current.theme;
    document.body.dataset.motion = current.motion;
    design.querySelectorAll('[data-theme-choice]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.themeChoice === current.theme)));
    design.querySelectorAll('[data-motion-choice]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.motionChoice === current.motion)));
  }
  design.addEventListener('click', event => {
    const choice = event.target.closest('[data-theme-choice], [data-motion-choice]');
    if (!choice) return;
    const next = { ...current, ...(choice.dataset.themeChoice ? { theme: choice.dataset.themeChoice } : { motion: choice.dataset.motionChoice }) };
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
  });
  window.deckAppearance = { apply(value) { apply(value); confirmed = { ...current }; }, selectTab };
  apply(confirmed);
})();
