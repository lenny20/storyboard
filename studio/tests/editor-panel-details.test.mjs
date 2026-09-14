import assert from 'node:assert/strict';
import test from 'node:test';
import { withEditor } from './editor-harness.mjs';

const framingPresets = [
  'Extreme wide',
  'Wide',
  'Full',
  'Medium wide',
  'Medium',
  'Medium close-up',
  'Close-up',
  'Extreme close-up',
  'Aerial',
  'Over the shoulder',
  'POV',
];

const withoutPanelDetails = (panel) => {
  const result = structuredClone(panel);
  delete result.title;
  delete result.framing;
  delete result.angle;
  return result;
};

test('panel detail selects keep every preset available and preserve per-panel custom values', async () => {
  await withEditor(async (api) => {
    await api.mount();
    await api.wait(850);
    const [project] = await api.readProjects();
    await api.unmount();

    const shot = project.scenes[0].shots[1];
    const [first, second] = shot.panels;
    first.title = 'First detail panel';
    first.framing = 'Medium close-up';
    first.angle = 'Eye level';
    second.title = 'Legacy detail panel';
    second.framing = 'Two-person cowboy frame';
    second.angle = 'Floor-level oblique';
    await api.writeProject(project);

    await api.mount();
    await api.click(api.shotButton(shot.title));
    await api.click(
      [...api.container.querySelectorAll('.sb-panel-tab')].find((button) =>
        button.textContent.includes(first.title),
      ),
    );
    api.container.querySelector('.sb-panel-disclosure').open = true;

    let framing = api.field('Framing');
    const angle = api.field('Angle');
    assert.equal(framing.tagName, 'SELECT');
    assert.equal(angle.tagName, 'SELECT');
    assert.equal(framing.value, 'Medium close-up');
    assert.equal(angle.value, 'Eye level');
    assert.deepEqual(
      [...framing.options].slice(1, -1).map((option) => option.value),
      framingPresets,
    );
    assert.equal(framing.options[0].textContent, 'Not set');
    assert.equal(
      framing.options[framing.options.length - 1].textContent,
      'Custom value…',
    );
    let customOption = [...framing.options].find(
      (option) => option.textContent === 'Custom value…',
    );
    await api.changeSelect(framing, customOption.value);
    assert.equal(
      api.container.querySelector('[aria-label="Custom framing"]').value,
      'Medium close-up',
      'opening Custom reflects the currently saved preset',
    );

    for (const value of ['Wide', 'Close-up', '']) {
      framing = api.field('Framing');
      await api.changeSelect(framing, value);
      framing = api.field('Framing');
      assert.equal(framing.value, value);
      assert.deepEqual(
        [...framing.options].slice(1, -1).map((option) => option.value),
        framingPresets,
      );
    }

    customOption = [...framing.options].find(
      (option) => option.textContent === 'Custom value…',
    );
    await api.changeSelect(framing, customOption.value);
    let customFraming = api.container.querySelector(
      '[aria-label="Custom framing"]',
    );
    assert.equal(customFraming.value, '');
    await api.click(api.byText('button', 'Clear panel details'));
    assert.equal(
      api.container.querySelector('[aria-label="Custom framing"]'),
      null,
      'Clear resets a blank transient Custom editor',
    );
    await api.click(
      api.container.querySelector('[aria-label="Undo last edit"]'),
    );
    assert.equal(api.field('Panel name').value, 'First detail panel');
    framing = api.field('Framing');
    customOption = [...framing.options].find(
      (option) => option.textContent === 'Custom value…',
    );
    await api.changeSelect(framing, customOption.value);
    customFraming = api.container.querySelector(
      '[aria-label="Custom framing"]',
    );
    await api.enterText(customFraming, 'Insert profile');
    customFraming = api.container.querySelector(
      '[aria-label="Custom framing"]',
    );
    await api.enterText(customFraming, '');
    assert.ok(
      api.container.querySelector('[aria-label="Custom framing"]'),
      'clearing custom text keeps the custom editor available',
    );
    await api.enterText(
      api.container.querySelector('[aria-label="Custom framing"]'),
      'Profile through glass',
    );

    await api.click(
      [...api.container.querySelectorAll('.sb-panel-tab')].find((button) =>
        button.textContent.includes(second.title),
      ),
    );
    assert.equal(
      api.container.querySelector('[aria-label="Custom framing"]').value,
      'Two-person cowboy frame',
    );
    assert.equal(
      api.container.querySelector('[aria-label="Custom angle"]').value,
      'Floor-level oblique',
    );

    await api.click(
      [...api.container.querySelectorAll('.sb-panel-tab')].find((button) =>
        button.textContent.includes(first.title),
      ),
    );
    assert.equal(
      api.container.querySelector('[aria-label="Custom framing"]').value,
      'Profile through glass',
    );
    await api.wait(850);
    const [saved] = await api.readProjects();
    assert.equal(
      saved.scenes[0].shots[1].panels[0].framing,
      'Profile through glass',
    );
    assert.equal(
      saved.scenes[0].shots[1].panels[1].framing,
      'Two-person cowboy frame',
    );
    assert.equal(
      saved.scenes[0].shots[1].panels[1].angle,
      'Floor-level oblique',
    );
    assert.ok(
      saved.scenes[0].shots[1].panels.every(
        (panel) => !panel.framing.includes('__custom-panel-detail__'),
      ),
      'the UI-only custom option is never persisted',
    );
  });
});

test('clearing panel details is atomic, leaves unrelated panel data intact, and can be undone', async () => {
  await withEditor(async (api) => {
    await api.mount();
    await api.wait(850);
    const [project] = await api.readProjects();
    await api.unmount();

    const shot = project.scenes[0].shots[1];
    const panel = shot.panels[0];
    panel.title = 'Named panel';
    panel.framing = 'Handheld two-shot';
    panel.angle = 'Shoulder height';
    panel.dialogue = 'MATILDA\nKeep this dialogue.';
    panel.description = 'Keep this visual direction.';
    panel.camera = 'Keep this camera direction.';
    panel.pdfFullWidth = true;
    panel.versions = [
      {
        id: 'panel-details-art',
        dataUrl: 'data:image/png;base64,AA==',
        createdAt: new Date().toISOString(),
        label: 'Protected artwork',
      },
    ];
    panel.selectedVersionId = 'panel-details-art';
    const originalPanel = structuredClone(panel);
    const otherPanels = structuredClone(shot.panels.slice(1));
    await api.writeProject(project);

    await api.mount();
    await api.click(api.shotButton(shot.title));
    await api.click(
      [...api.container.querySelectorAll('.sb-panel-tab')].find((button) =>
        button.textContent.includes('Named panel'),
      ),
    );
    const details = api.container.querySelector('.sb-panel-disclosure');
    details.open = true;
    assert.match(
      details.textContent,
      /Clears panel name, framing and angle\. Empty values are omitted from the PDF\./,
    );

    await api.click(api.byText('button', 'Clear panel details', details));
    assert.match(details.querySelector('summary').textContent, /not set/);
    assert.equal(api.field('Panel name').value, '');
    assert.equal(api.field('Framing').value, '');
    assert.equal(api.field('Angle').value, '');
    assert.equal(
      api.container
        .querySelector('[aria-label="Full-width in PDF"]')
        .getAttribute('aria-checked'),
      'true',
    );

    await api.wait(850);
    let saved = (await api.readProjects())[0];
    let savedPanel = saved.scenes[0].shots[1].panels[0];
    assert.deepEqual(
      [savedPanel.title, savedPanel.framing, savedPanel.angle],
      ['', '', ''],
    );
    assert.deepEqual(
      withoutPanelDetails(savedPanel),
      withoutPanelDetails(originalPanel),
    );
    assert.deepEqual(saved.scenes[0].shots[1].panels.slice(1), otherPanels);

    await api.changeSelect(api.field('Framing'), 'Wide');
    await api.click(
      api.container.querySelector('[aria-label="Undo last edit"]'),
    );
    assert.equal(api.field('Panel name').value, '');
    assert.equal(api.field('Framing').value, '');
    assert.equal(api.field('Angle').value, '');
    assert.equal(
      api.container.querySelector('[aria-label="Custom framing"]'),
      null,
      'clear resets custom editing state',
    );

    await api.click(
      api.container.querySelector('[aria-label="Undo last edit"]'),
    );
    await api.wait(850);
    saved = (await api.readProjects())[0];
    savedPanel = saved.scenes[0].shots[1].panels[0];
    assert.deepEqual(savedPanel, originalPanel);
    assert.deepEqual(saved.scenes[0].shots[1].panels.slice(1), otherPanels);
    assert.equal(api.field('Panel name').value, 'Named panel');
    assert.equal(
      api.container.querySelector('[aria-label="Custom framing"]').value,
      'Handheld two-shot',
    );
    assert.equal(
      api.container.querySelector('[aria-label="Custom angle"]').value,
      'Shoulder height',
    );
  });
});
