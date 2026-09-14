import assert from 'node:assert/strict';
import test from 'node:test';
import { withEditor } from './editor-harness.mjs';

const confirmButton = (api, label = 'Delete') =>
  api.byText(
    'button',
    label,
    api.document.querySelector('[role="alertdialog"]'),
  );

test('deleting the selected panel can be cancelled and undone without disturbing unrelated work', async () => {
  await withEditor(async (api) => {
    await api.mount();
    await api.wait(850);
    const [project] = await api.readProjects();
    await api.unmount();

    const scene = project.scenes[0];
    const shot = scene.shots[0];
    const source = shot.panels[0];
    const makePanel = (id, title) => ({
      ...structuredClone(source),
      id,
      title,
      description: `${title} frame direction`,
      versions: [],
      selectedVersionId: null,
    });
    const first = makePanel('delete-panel-a', 'Arrival');
    const selected = makePanel('delete-panel-b', 'Close reaction');
    selected.versions = [
      {
        id: 'deleted-art',
        dataUrl: 'data:image/png;base64,AA==',
        createdAt: new Date().toISOString(),
        label: 'Hero frame',
      },
    ];
    selected.selectedVersionId = 'deleted-art';
    const next = makePanel('delete-panel-c', 'Doorway');
    const last = makePanel('delete-panel-d', 'Exit');
    last.versions = [
      {
        id: 'unrelated-art',
        dataUrl: 'data:image/png;base64,AQ==',
        createdAt: new Date().toISOString(),
        label: 'Unrelated frame',
      },
    ];
    last.selectedVersionId = 'unrelated-art';
    shot.panels = [first, selected, next, last];
    shot.panelConnections = [
      {
        fromId: first.id,
        toId: selected.id,
        type: 'dolly',
        description: 'into reaction',
      },
      {
        fromId: selected.id,
        toId: next.id,
        type: 'pan',
        description: 'out of reaction',
      },
      {
        fromId: next.id,
        toId: last.id,
        type: 'orbit',
        description: 'unrelated boundary',
      },
    ];
    scene.shotConnections = scene.shots.slice(1, 2).map((following) => ({
      fromId: shot.id,
      toId: following.id,
      type: 'cut',
      description: 'Unrelated shot boundary',
      movement: 'static',
      movementDescription: '',
    }));
    const originalShotConnections = structuredClone(scene.shotConnections);
    await api.writeProject(project);

    await api.mount();
    await api.click(api.shotButton(shot.title));
    await api.click(
      [...api.container.querySelectorAll('.sb-panel-tab')].find((button) =>
        button.textContent.includes('Close reaction'),
      ),
    );
    const deleteControl = api.byText('button', 'Delete panel');
    assert.ok(deleteControl, 'the visible labelled delete action exists');
    assert.match(deleteControl.getAttribute('aria-label'), /Close reaction/);

    await api.click(api.byText('button', 'Delete panel'));
    const dialog = api.document.querySelector('[role="alertdialog"]');
    assert.match(dialog.textContent, /Delete “Close reaction”\?/);
    assert.match(dialog.textContent, /Undo is available/);
    await api.click(confirmButton(api, 'Cancel'));
    assert.equal(
      (await api.readProjects())[0].scenes[0].shots[0].panels.length,
      4,
    );

    await api.click(deleteControl);
    await api.click(confirmButton(api));
    await api.wait(850);
    let saved = (await api.readProjects())[0];
    let savedShot = saved.scenes[0].shots[0];
    assert.deepEqual(
      savedShot.panels.map((panel) => panel.id),
      [first.id, next.id, last.id],
    );
    assert.equal(
      api.container.querySelector('.sb-panel-tab[aria-pressed="true"] strong')
        ?.textContent,
      'Doorway',
    );
    assert.deepEqual(savedShot.panelConnections, [shot.panelConnections[2]]);
    assert.equal(savedShot.panels[2].selectedVersionId, 'unrelated-art');
    assert.deepEqual(saved.scenes[0].shotConnections, originalShotConnections);

    await api.click(
      api.container.querySelector('[aria-label="Undo last edit"]'),
    );
    await api.wait(850);
    saved = (await api.readProjects())[0];
    savedShot = saved.scenes[0].shots[0];
    const restored = savedShot.panels.find((panel) => panel.id === selected.id);
    assert.equal(restored.description, selected.description);
    assert.deepEqual(restored.versions, selected.versions);
    assert.deepEqual(savedShot.panelConnections, shot.panelConnections);
    assert.deepEqual(saved.scenes[0].shotConnections, originalShotConnections);
  });
});

test('deleting the last panel keeps the empty shot ready for a new panel', async () => {
  await withEditor(async (api) => {
    await api.mount();
    await api.wait(850);
    const [project] = await api.readProjects();
    await api.unmount();
    const shot = project.scenes[0].shots[0];
    shot.panels = [shot.panels[0]];
    shot.panels[0].title = 'Only panel';
    shot.panelConnections = [];
    await api.writeProject(project);

    await api.mount();
    await api.click(api.shotButton(shot.title));
    await api.click(api.byText('button', 'Delete panel'));
    await api.click(confirmButton(api));
    await api.wait(850);
    const [saved] = await api.readProjects();
    assert.equal(saved.scenes[0].shots[0].id, shot.id);
    assert.deepEqual(saved.scenes[0].shots[0].panels, []);
    assert.ok(api.byText('button', 'Add panel'));
  });
});
