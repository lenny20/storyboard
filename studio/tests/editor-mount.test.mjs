import assert from 'node:assert/strict';
import test from 'node:test';
import { File, resolveObjectURL } from 'node:buffer';
import { IDBFactory } from 'fake-indexeddb';
import { withEditor } from './editor-harness.mjs';

const matildaDialogue = `MATILDA
I can see it now.`;

const normalizedText = (element) =>
  element.textContent.replace(/\s+/g, ' ').trim();

test('editor identity uses full scene-shot-panel codes and compact strip labels', async () => {
  await withEditor(async ({ container, mount, click, shotButton }) => {
    await mount();
    assert.equal(
      normalizedText(container.querySelector('.sb-shot-badge')),
      'SC01 · SH02',
    );
    assert.deepEqual(
      [...container.querySelectorAll('.sb-shot-card')].map((item) => ({
        label: item.getAttribute('aria-label'),
        compact: item.querySelector('.sb-shot-thumb > span:last-child')
          .textContent,
      })),
      [
        { label: 'SC01 · SH01 — The island', compact: 'SH01' },
        { label: 'SC01 · SH02 — Matilda smiles', compact: 'SH02' },
      ],
    );
    assert.deepEqual(
      [...container.querySelectorAll('.sb-panel-tab')].map((item) => ({
        label: item.getAttribute('aria-label'),
        compact: item.querySelector(':scope > span').textContent,
      })),
      [
        { label: 'SC01 · SH02 · A — Start frame', compact: 'A' },
        { label: 'SC01 · SH02 · B — End frame', compact: 'B' },
      ],
    );
    assert.equal(
      normalizedText(
        container.querySelector('.sb-canvas-topline > span:first-child'),
      ),
      'SC01 · SH02 · A PANEL 01 OF 02',
    );

    await click(shotButton('The island'));
    assert.equal(
      normalizedText(container.querySelector('.sb-shot-badge')),
      'SC01 · SH01',
    );
    assert.equal(
      container.querySelector('.sb-panel-tab').getAttribute('aria-label'),
      'SC01 · SH01 — The island',
    );
    assert.equal(
      container.querySelector('.sb-panel-tab > span').textContent,
      'SH01',
    );
    assert.equal(
      normalizedText(
        container.querySelector('.sb-canvas-topline > span:first-child'),
      ),
      'SC01 · SH01 PANEL 01 OF 01',
    );
  });
});

test('editor saves exact dialogue and resumes the selected panel and revision draft', async () => {
  await withEditor(
    async ({
      container,
      mount,
      unmount,
      enterText,
      click,
      shotButton,
      wait,
      byText,
      field,
      readProjects,
    }) => {
      await mount();
      assert.equal(
        container.querySelector('[aria-label="Shot title"]').value,
        'Matilda smiles',
      );
      assert.equal(container.querySelectorAll('.sb-panel-tab').length, 2);
      await enterText(
        container.querySelector('[aria-label="Panel dialogue"]'),
        matildaDialogue,
      );
      await enterText(field('Panel context'), 'Start context');
      await enterText(field('Camera direction within this frame'), 'Push in');
      await enterText(field('Production notes'), 'Keep the red coat');
      await click(shotButton('The island'));
      await enterText(
        container.querySelector('[aria-label="Panel dialogue"]'),
        'A distant voice.',
      );
      await click(shotButton('Matilda smiles'));
      await click(
        [...container.querySelectorAll('.sb-panel-tab')].find((element) =>
          element.textContent.includes('End frame'),
        ),
      );
      await enterText(
        container.querySelector('[aria-label="Panel dialogue"]'),
        'MATILDA\nThere.',
      );
      await enterText(field('Panel context'), 'Temporary end context');
      await enterText(field('Panel context'), '');
      await enterText(
        field('Camera direction within this frame'),
        'Hold still',
      );
      await enterText(field('Production notes'), 'Final beat');
      await click(byText('[role="tab"]', 'Prompt'));
      await enterText(
        container.querySelector('textarea[placeholder^="e.g. Move Matilda"]'),
        'Move Matilda left. Keep the camera angle.',
      );
      await wait(850);
      assert.match(
        container.querySelector('.sb-save-status').textContent,
        /Saved in this browser/,
      );
      await unmount();
      await mount();
      assert.equal(
        container.querySelector('[aria-label="Shot title"]').value,
        'Matilda smiles',
      );
      assert.match(
        container.querySelector('.sb-panel-tab.is-active').textContent,
        /End frame/,
      );
      assert.equal(
        container.querySelector('[aria-label="Panel dialogue"]').value,
        'MATILDA\nThere.',
      );
      assert.equal(field('Panel context').value, '');
      assert.equal(
        field('Camera direction within this frame').value,
        'Hold still',
      );
      assert.equal(field('Production notes').value, 'Final beat');
      await click(
        [...container.querySelectorAll('.sb-panel-tab')].find((element) =>
          element.textContent.includes('Start frame'),
        ),
      );
      assert.equal(
        container.querySelector('[aria-label="Panel dialogue"]').value,
        matildaDialogue,
      );
      assert.equal(field('Panel context').value, 'Start context');
      assert.equal(
        field('Camera direction within this frame').value,
        'Push in',
      );
      assert.equal(field('Production notes').value, 'Keep the red coat');
      const [saved] = await readProjects();
      assert.equal(saved.scenes[0].shots[1].panels[1].context, '');
      await click(byText('[role="tab"]', 'Prompt'));
      assert.equal(
        container.querySelector('textarea[placeholder^="e.g. Move Matilda"]')
          .value,
        '',
      );
      await click(shotButton('The island'));
      assert.equal(
        container.querySelector('[aria-label="Panel dialogue"]').value,
        'A distant voice.',
      );
      assert.equal(container.querySelector('[role="alert"]'), null);
    },
  );
});

test('an internal panel starts a new shot atomically and undo restores the strip', async () => {
  await withEditor(
    async ({ container, mount, click, byText, wait, readProjects }) => {
      await mount();
      assert.match(container.textContent, /Start a new shot after this panel/);
      await click(byText('button', 'Start a new shot after this panel'));
      assert.equal(container.querySelectorAll('.sb-shot-card').length, 3);
      assert.equal(container.querySelectorAll('.sb-panel-tab').length, 1);

      await click(container.querySelector('[aria-label="Undo last edit"]'));
      assert.equal(container.querySelectorAll('.sb-shot-card').length, 2);
      assert.equal(container.querySelectorAll('.sb-panel-tab').length, 2);
      await wait(850);
      const [saved] = await readProjects();
      assert.equal(saved.scenes[0].shots[1].panels.length, 2);
    },
  );
});

test('PDF full-width is an independent panel setting that autosaves and can be undone', async () => {
  await withEditor(
    async ({ container, mount, unmount, click, wait, readProjects }) => {
      await mount();
      const details = container.querySelector('.sb-panel-disclosure');
      details.open = true;
      const checkbox = container.querySelector(
        '[aria-label="Full-width in PDF"]',
      );
      assert.ok(checkbox);
      assert.equal(checkbox.getAttribute('aria-checked'), 'false');
      assert.match(
        details.textContent,
        /Use a large frame in the PDF\. Smaller frames are the default\./,
      );

      await click(checkbox);
      assert.equal(checkbox.getAttribute('aria-checked'), 'true');
      await click(
        [...container.querySelectorAll('.sb-panel-tab')].find((element) =>
          element.textContent.includes('End frame'),
        ),
      );
      assert.equal(
        container
          .querySelector('[aria-label="Full-width in PDF"]')
          .getAttribute('aria-checked'),
        'false',
      );
      await wait(850);
      let saved = (await readProjects())[0];
      assert.equal(saved.scenes[0].shots[1].panels[0].pdfFullWidth, true);
      assert.equal(saved.scenes[0].shots[1].panels[1].pdfFullWidth, false);

      await click(
        [...container.querySelectorAll('.sb-panel-tab')].find((element) =>
          element.textContent.includes('Start frame'),
        ),
      );
      assert.equal(
        container
          .querySelector('[aria-label="Full-width in PDF"]')
          .getAttribute('aria-checked'),
        'true',
      );
      await click(container.querySelector('[aria-label="Undo last edit"]'));
      await wait(850);
      saved = (await readProjects())[0];
      assert.equal(saved.scenes[0].shots[1].panels[0].pdfFullWidth, false);
      assert.equal(saved.scenes[0].shots[1].panels[1].pdfFullWidth, false);

      await click(container.querySelector('[aria-label="Full-width in PDF"]'));
      await wait(850);
      await unmount();
      await mount();
      assert.equal(
        container
          .querySelector('[aria-label="Full-width in PDF"]')
          .getAttribute('aria-checked'),
        'true',
      );
      await click(container.querySelector('[aria-label="Duplicate panel"]'));
      assert.equal(
        container
          .querySelector('[aria-label="Full-width in PDF"]')
          .getAttribute('aria-checked'),
        'true',
      );
      await wait(850);
      saved = (await readProjects())[0];
      assert.deepEqual(
        saved.scenes[0].shots[1].panels.map((item) => item.pdfFullWidth),
        [true, true, false],
      );
    },
  );
});

test('boundary editors save independent shot and panel connections', async () => {
  await withEditor(
    async ({
      document,
      container,
      mount,
      click,
      byText,
      field,
      enterText,
      changeSelect,
      wait,
      readProjects,
    }) => {
      await mount();
      const shotConnection = container.querySelector(
        '[aria-label="Edit transition and camera movement from The island to Matilda smiles"]',
      );
      await click(shotConnection);
      let dialog = document.querySelector('[role="dialog"]');
      assert.match(dialog.textContent, /The island/);
      assert.match(dialog.textContent, /Matilda smiles/);
      await changeSelect(field('Editorial transition', dialog), 'match-cut');
      await enterText(
        field('Transition direction', dialog),
        'Match on the horizon.',
      );
      const expectedMovementOptions = [
        ['static', 'No camera movement'],
        ['dolly', 'Dolly'],
        ['pan', 'Pan'],
        ['tilt', 'Tilt'],
        ['truck', 'Truck'],
        ['pedestal', 'Pedestal'],
        ['zoom', 'Zoom'],
        ['orbit', 'Orbit'],
        ['aerial', 'Aerial'],
        ['custom', 'Custom'],
      ];
      assert.deepEqual(
        [...field('Camera movement across the cut', dialog).options].map(
          (option) => [option.value, option.textContent],
        ),
        expectedMovementOptions,
      );
      await changeSelect(
        field('Camera movement across the cut', dialog),
        'aerial',
      );
      await enterText(
        field('Movement direction', dialog),
        'keep the horizon exactly as authored.',
      );
      await click(byText('button', 'Save connection', dialog));

      const panelConnection = container.querySelector(
        '[aria-label="Edit camera movement from Start frame to End frame"]',
      );
      await click(panelConnection);
      dialog = document.querySelector('[role="dialog"]');
      assert.deepEqual(
        [...field('Camera movement', dialog).options].map((option) => [
          option.value,
          option.textContent,
        ]),
        expectedMovementOptions,
      );
      await changeSelect(field('Camera movement', dialog), 'aerial');
      await enterText(
        field('Movement direction', dialog),
        'drift overhead without changing this authored case.',
      );
      await click(byText('button', 'Save connection', dialog));
      assert.equal(
        container.querySelector(
          '[aria-label="Edit camera movement from Start frame to End frame"] strong',
        ).textContent,
        'Aerial',
      );
      await click(container.querySelector('[aria-label="Move panel later"]'));
      await wait(850);

      const [saved] = await readProjects();
      const savedScene = saved.scenes[0];
      assert.deepEqual(
        savedScene.shots[1].panels.map((item) => item.title),
        ['End frame', 'Start frame'],
      );
      assert.deepEqual(
        savedScene.shotConnections.map(
          ({ type, description, movement, movementDescription }) => ({
            type,
            description,
            movement,
            movementDescription,
          }),
        ),
        [
          {
            type: 'match-cut',
            description: 'Match on the horizon.',
            movement: 'aerial',
            movementDescription: 'keep the horizon exactly as authored.',
          },
        ],
      );
      assert.deepEqual(
        savedScene.shots[1].panelConnections.map(({ type, description }) => ({
          type,
          description,
        })),
        [
          {
            type: 'aerial',
            description: 'drift overhead without changing this authored case.',
          },
        ],
      );
      const movedConnection = savedScene.shots[1].panelConnections[0];
      assert.equal(movedConnection.fromId, savedScene.shots[1].panels[1].id);
      assert.equal(movedConnection.toId, savedScene.shots[1].panels[0].id);

      await click(container.querySelector('[aria-label="Undo last edit"]'));
      await wait(850);
      const [undone] = await readProjects();
      assert.deepEqual(
        undone.scenes[0].shots[1].panels.map((item) => item.title),
        ['Start frame', 'End frame'],
      );
      assert.equal(
        undone.scenes[0].shots[1].panelConnections[0].type,
        'aerial',
      );
    },
  );
});

test('compact workspace menu retains essential actions and custom ratio accepts drafts', async () => {
  await withEditor(
    async ({
      document,
      container,
      mount,
      click,
      byText,
      field,
      enterText,
      changeSelect,
      key,
      wait,
    }) => {
      await mount();
      await click(document.querySelector('[aria-label="Workspace actions"]'));
      for (const label of [
        'New project',
        'Import backup',
        'Add scene',
        'Project settings',
        'Download backup',
        'Undo last edit',
      ])
        assert.ok(
          byText('[role="menuitem"]', label),
          `${label} is available in the compact action menu`,
        );
      await click(byText('[role="menuitem"]', 'Project settings'));
      const dialog = document.querySelector('[role="dialog"]');
      assert.ok(dialog, 'settings opened through the compact action menu');
      const ratioLabel = [...dialog.querySelectorAll('label')].find(
        (element) => element.textContent === 'Frame ratio',
      );
      assert.equal(
        ratioLabel.control,
        field('Frame ratio', dialog),
        'exact visible label names its select without including the option text',
      );
      const ids = [...document.querySelectorAll('[id]')].map(
        (element) => element.id,
      );
      assert.equal(
        new Set(ids).size,
        ids.length,
        'form and dialog IDs remain unique',
      );
      await changeSelect(field('Frame ratio', dialog), 'custom');
      assert.equal(field('Frame ratio', dialog).value, 'custom');
      await enterText(field('Width : 1 height', dialog), '');
      assert.equal(field('Width : 1 height', dialog).value, '');
      await key(field('Width : 1 height', dialog), 'Enter');
      assert.match(
        dialog.querySelector('[role="alert"]').textContent,
        /Enter a width/,
      );
      await enterText(field('Width : 1 height', dialog), '1.85');
      await key(field('Width : 1 height', dialog), 'Enter');
      await click(byText('button', 'Done', dialog));
      assert.match(
        container.querySelector('.sb-canvas-topline').textContent,
        /1.85:1/,
      );
      await wait(850);
      assert.match(
        container.querySelector('.sb-save-status').textContent,
        /Saved in this browser/,
      );
    },
  );
});

test('storage opening failure stays an error and Retry opening reconnects safely', async () => {
  const actual = new IDBFactory();
  let blocked = true;
  const factory = {
    open(...arguments_) {
      if (blocked) throw new Error('Storage denied for test');
      return actual.open(...arguments_);
    },
  };
  await withEditor(
    async ({ container, mount, click, byText, wait }) => {
      await mount();
      assert.match(container.textContent, /Storage denied for test/);
      assert.doesNotMatch(
        container.querySelector('.sb-save-status').textContent,
        /Saved in this browser/,
      );
      blocked = false;
      await click(byText('button', 'Retry opening projects'));
      await wait();
      assert.equal(
        container.querySelector('[aria-label="Shot title"]').value,
        'Matilda smiles',
      );
      await wait(850);
      assert.match(
        container.querySelector('.sb-save-status').textContent,
        /Saved in this browser/,
      );
    },
    { factory },
  );
});

test('concurrent saved changes stay intact until the director explicitly reloads', async () => {
  await withEditor(
    async ({
      container,
      document,
      mount,
      enterText,
      wait,
      readProjects,
      writeProject,
      click,
      byText,
    }) => {
      await mount();
      await wait(850);
      const [external] = await readProjects();
      external.updatedAt = new Date(
        Date.parse(external.updatedAt) + 1000,
      ).toISOString();
      external.scenes[0].shots[1].panels[0].dialogue = 'Saved by another tab.';
      await writeProject(external);
      await enterText(
        container.querySelector('[aria-label="Panel dialogue"]'),
        'My unsaved local draft.',
      );
      await wait(850);
      assert.match(container.textContent, /Save conflict/);
      assert.doesNotMatch(
        container.querySelector('.sb-save-status').textContent,
        /Saved in this browser/,
      );
      assert.equal(
        container.querySelector('[aria-label="Panel dialogue"]').value,
        'My unsaved local draft.',
      );
      const [persisted] = await readProjects();
      assert.equal(
        persisted.scenes[0].shots[1].panels[0].dialogue,
        'Saved by another tab.',
      );
      await click(byText('button', 'Reload saved version'));
      const confirmation = document.querySelector('[role="alertdialog"]');
      assert.ok(
        confirmation,
        'reload requires an explicit choice before discarding local edits',
      );
      await click(byText('button', 'Reload saved version', confirmation));
      await wait();
      assert.equal(
        container.querySelector('[aria-label="Panel dialogue"]').value,
        'Saved by another tab.',
      );
      assert.match(
        container.querySelector('.sb-save-status').textContent,
        /Saved in this browser/,
      );
    },
  );
});

test('oversized reference batch is rejected before decoding and preserves the current draft', async () => {
  await withEditor(
    async ({
      container,
      win,
      mount,
      enterText,
      upload,
      wait,
      readProjects,
    }) => {
      await mount();
      await enterText(
        container.querySelector('[aria-label="Panel dialogue"]'),
        matildaDialogue,
      );
      const files = Array.from({ length: 103 }, (_, index) => {
        const file = new win.File(['not decoded'], `reference-${index}.png`, {
          type: 'image/png',
        });
        Object.defineProperty(file, 'size', { value: 20 * 1024 * 1024 });
        return file;
      });
      await upload(
        container.querySelector('[aria-label="Upload reference images"]'),
        files,
      );
      assert.match(
        container.textContent,
        /would exceed this project’s working capacity/,
      );
      assert.equal(
        container.querySelector('[aria-label="Panel dialogue"]').value,
        matildaDialogue,
      );
      await wait(850);
      const [persisted] = await readProjects();
      assert.equal(persisted.references.length, 0);
      assert.equal(
        persisted.scenes[0].shots[1].panels[0].dialogue,
        matildaDialogue,
      );
    },
  );
});

test('backup exposes a live portable file link and leaves browser save status truthful', async () => {
  await withEditor(
    async ({
      container,
      document,
      mount,
      enterText,
      click,
      byText,
      wait,
      downloads,
    }) => {
      await mount();
      await enterText(
        container.querySelector('[aria-label="Panel dialogue"]'),
        matildaDialogue,
      );
      await wait(850);
      await click(document.querySelector('[aria-label="Workspace actions"]'));
      await click(byText('[role="menuitem"]', 'Download backup'));
      // Complete the async archive handoff and dialog opening inside React act.
      await wait(300);
      assert.equal(downloads.length, 1);
      const dialog = document.querySelector('[role="dialog"]');
      const link = dialog.querySelector('a[download]');
      assert.equal(link.download, 'Teaser.storyboard');
      assert.equal(link.href, downloads[0].url);
      assert.match(dialog.textContent, /A download was requested/);
      const artifact = resolveObjectURL(link.href);
      assert.ok(artifact, 'the fallback link retains a real Blob');
      const backup = await import('../lib/storyboard/storage.ts').then(
        ({ importProject }) =>
          importProject(new File([artifact], link.download)),
      );
      assert.equal(
        backup.scenes[0].shots[1].panels[0].dialogue,
        matildaDialogue,
      );
      assert.match(
        container.querySelector('.sb-save-status').textContent,
        /Saved in this browser/,
      );
    },
  );
});

test('imported project copy has an independent revision draft even when panel IDs match', async () => {
  await withEditor(
    async ({
      container,
      document,
      mount,
      click,
      byText,
      enterText,
      wait,
      readProjects,
      upload,
      shotButton,
      changeSelect,
    }) => {
      await mount();
      await click(byText('[role="tab"]', 'Prompt'));
      await enterText(
        container.querySelector('textarea[placeholder^="e.g. Move Matilda"]'),
        'Original direction.',
      );
      await wait(850);
      const [original] = await readProjects();
      const json = JSON.stringify(original);
      await upload(
        container.querySelector('[aria-label="Import project backup"]'),
        [
          {
            name: 'teaser.json',
            type: 'application/json',
            size: json.length,
            text: async () => json,
          },
        ],
      );
      await click(shotButton('Matilda smiles'));
      assert.equal(
        container.querySelector('textarea[placeholder^="e.g. Move Matilda"]')
          .value,
        '',
      );
      await enterText(
        container.querySelector('textarea[placeholder^="e.g. Move Matilda"]'),
        'Copy direction.',
      );
      await changeSelect(
        document.querySelector('[aria-label="Current project"]'),
        original.id,
      );
      await click(shotButton('Matilda smiles'));
      assert.equal(
        container.querySelector('textarea[placeholder^="e.g. Move Matilda"]')
          .value,
        'Original direction.',
      );
    },
  );
});
