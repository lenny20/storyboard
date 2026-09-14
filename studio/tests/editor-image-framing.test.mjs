import assert from 'node:assert/strict';
import test from 'node:test';
import { createProject } from '../lib/storyboard/model.ts';
import { withEditor } from './editor-harness.mjs';

const imageDataUrl = 'data:image/png;base64,AQ==';
const defaultTransform = {
  fit: 'contain',
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  flipX: false,
  flipY: false,
};

test('framing edits stay with their image version and can be undone', async () => {
  await withEditor(async (api) => {
    await api.mount();
    await api.unmount();

    const project = createProject('Framing controls');
    const panel = project.scenes[0].shots[0].panels[0];
    panel.versions = [
      {
        id: 'framing-a',
        dataUrl: imageDataUrl,
        createdAt: '2026-09-12T00:00:00.000Z',
        label: 'Wide frame',
        transform: { ...defaultTransform },
      },
      {
        id: 'framing-b',
        dataUrl: imageDataUrl,
        createdAt: '2026-09-12T00:01:00.000Z',
        label: 'Close frame',
        transform: { ...defaultTransform },
      },
    ];
    panel.selectedVersionId = 'framing-a';
    await api.writeProject(project);

    await api.mount();
    await api.click(
      api.container.querySelector('.sb-framing-controls > summary'),
    );
    const scale = api.container.querySelector('.sb-framing-scale input');
    assert.ok(scale, api.container.textContent);
    await api.enterText(scale, '175');
    assert.equal(scale.value, '175');

    await api.click(api.byText('button', 'Versions 2'));
    await api.click(
      api.document.querySelector('[aria-label="Use Close frame"]'),
    );
    const dialog = api.document.querySelector('[role="dialog"]');
    await api.click(api.byText('button', 'Close', dialog));
    const horizontal = api.container.querySelector(
      '[aria-label="Horizontal image position"]',
    );
    await api.enterText(horizontal, '35');
    await api.wait(850);

    let saved = (await api.readProjects())[0];
    let versions = saved.scenes[0].shots[0].panels[0].versions;
    assert.equal(
      versions.find((version) => version.id === 'framing-a').transform.scale,
      1.75,
    );
    assert.equal(
      versions.find((version) => version.id === 'framing-a').transform.offsetX,
      0,
    );
    assert.equal(
      versions.find((version) => version.id === 'framing-b').transform.scale,
      1,
    );
    assert.equal(
      versions.find((version) => version.id === 'framing-b').transform.offsetX,
      0.35,
    );

    await api.click(
      api.container.querySelector('[aria-label="Undo last edit"]'),
    );
    await api.wait(850);
    saved = (await api.readProjects())[0];
    versions = saved.scenes[0].shots[0].panels[0].versions;
    assert.deepEqual(
      versions.find((version) => version.id === 'framing-b').transform,
      defaultTransform,
    );
    assert.equal(
      versions.find((version) => version.id === 'framing-a').transform.scale,
      1.75,
    );
  });
});
