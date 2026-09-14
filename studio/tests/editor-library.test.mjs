import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveObjectURL } from 'node:buffer';
import { unzipSync, strFromU8 } from 'fflate';
import { withEditor } from './editor-harness.mjs';

const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
const imageDataUrl = `data:image/png;base64,${png}`;
const imageFile = (win, name) =>
  new win.File([Buffer.from(png, 'base64')], name, { type: 'image/png' });

async function addCharacter(api, name = 'Matilda') {
  await api.click(api.byText('button', 'Reference library'));
  await api.click(api.byText('button', 'Add character'));
  await api.enterText(api.field('New character name'), name);
  await api.click(api.byText('button', 'Create'));
}

test('named character views follow shot selection, travel in a real ZIP, and deletion can be undone', async () => {
  await withEditor(
    async (api) => {
      const {
        container,
        document,
        win,
        mount,
        click,
        byText,
        upload,
        wait,
        downloads,
        readProjects,
      } = api;
      await mount();
      await addCharacter(api);
      await upload(
        container.querySelector('[aria-label="Upload library artwork"]'),
        [imageFile(win, 'Front.png'), imageFile(win, 'Side.png')],
      );
      await wait();
      assert.equal(
        container.querySelectorAll('.sb-library-art-card').length,
        2,
      );
      await click(byText('button', 'Back to boards'));
      await click(byText('[role="tab"]', 'References'));
      await click(
        container.querySelector('[aria-label="Use Matilda in this panel"]'),
      );
      await click(byText('[role="tab"]', 'Prompt'));
      assert.match(
        container.querySelector('[aria-label="Assembled panel prompt"]').value,
        /Matilda/,
      );
      assert.match(
        container.querySelector('.sb-prompt-references strong').textContent,
        /2 references/,
      );
      await click(container.querySelectorAll('.sb-panel-tab')[1]);
      assert.match(
        container.querySelector('.sb-prompt-references strong').textContent,
        /0 references/,
      );
      await click(container.querySelectorAll('.sb-panel-tab')[0]);
      await click(byText('button', 'Reference library'));
      await click(
        [...container.querySelectorAll('.sb-library-entry')].find((item) =>
          item.textContent.includes('Matilda'),
        ),
      );
      await upload(
        container.querySelector('[aria-label="Upload library artwork"]'),
        [imageFile(win, 'Three-quarter.png')],
      );
      await wait();
      await click(byText('button', 'Back to boards'));
      assert.match(
        container.querySelector('.sb-prompt-references strong').textContent,
        /3 references/,
      );
      await click(byText('button', 'Download generation pack'));
      await wait();
      const file = resolveObjectURL(downloads.at(-1).url);
      const zip = unzipSync(new Uint8Array(await file.arrayBuffer()));
      assert.equal(
        strFromU8(zip['prompt.txt']),
        container.querySelector('[aria-label="Assembled panel prompt"]').value,
      );
      const images = Object.entries(zip).filter(([name]) =>
        name.endsWith('.png'),
      );
      assert.equal(images.length, 3);
      for (const [, bytes] of images)
        assert.deepEqual(Buffer.from(bytes), Buffer.from(png, 'base64'));
      await click(
        byText('button', 'Done', document.querySelector('[role="dialog"]')),
      );
      await upload(
        container.querySelector('[aria-label="Import panel image"]'),
        [imageFile(win, 'Current-panel.png')],
      );
      await wait();
      await api.enterText(
        container.querySelector('textarea[placeholder^="e.g. Move Matilda"]'),
        'Move Matilda to the left.',
      );
      await click(byText('button', 'Download revision pack'));
      await wait();
      const revisionBlob = resolveObjectURL(downloads.at(-1).url);
      const revisionZip = unzipSync(
        new Uint8Array(await revisionBlob.arrayBuffer()),
      );
      assert.match(
        strFromU8(revisionZip['prompt.txt']),
        /Move Matilda to the left/,
      );
      assert.equal(
        Object.keys(revisionZip).filter((name) => name.endsWith('.png')).length,
        4,
        'revision pack includes the selected panel image alongside all reference views',
      );
      await click(
        byText('button', 'Done', document.querySelector('[role="dialog"]')),
      );

      await click(byText('button', 'Reference library'));
      await click(
        [...container.querySelectorAll('.sb-library-entry')].find((item) =>
          item.textContent.includes('Matilda'),
        ),
      );
      await click(container.querySelector('[aria-label="Delete Matilda"]'));
      await click(
        byText(
          'button',
          'Remove',
          document.querySelector('[role="alertdialog"]'),
        ),
      );
      await click(container.querySelector('[aria-label="Undo last edit"]'));
      assert.equal(
        container.querySelectorAll('.sb-library-art-card').length,
        3,
      );
      await wait(850);
      const [saved] = await readProjects();
      assert.equal(
        saved.scenes[0].shots[1].panels[0].referenceGroupIds[0],
        saved.referenceGroups[0].id,
      );
      assert.equal(saved.references.length, 3);
    },
    { imageDataUrl },
  );
});

test('library uploads work without scenes and existing artwork can move into a character without reupload', async () => {
  await withEditor(
    async (api) => {
      const {
        container,
        win,
        mount,
        unmount,
        wait,
        readProjects,
        writeProject,
        click,
        byText,
        upload,
        field,
        changeSelect,
      } = api;
      await mount();
      await wait(850);
      const [empty] = await readProjects();
      await unmount();
      empty.scenes = [];
      empty.references = [
        {
          id: 'legacy-art',
          name: 'Original render',
          kind: 'character',
          mimeType: 'image/png',
          dataUrl: imageDataUrl,
        },
      ];
      await writeProject(empty);
      await mount();
      await addCharacter(api);
      await upload(
        container.querySelector('[aria-label="Upload library artwork"]'),
        [imageFile(win, 'Back.png')],
      );
      await wait();
      assert.equal(
        container.querySelectorAll('.sb-library-art-card').length,
        1,
      );
      await click(
        [...container.querySelectorAll('.sb-library-entry')].find((item) =>
          item.textContent.includes('Ungrouped artwork'),
        ),
      );
      const option = [...field('Library entry').options].find(
        (item) => item.textContent === 'Matilda',
      );
      await changeSelect(field('Library entry'), option.value);
      await click(
        [...container.querySelectorAll('.sb-library-entry')].find((item) =>
          item.textContent.includes('Matilda'),
        ),
      );
      assert.equal(
        container.querySelectorAll('.sb-library-art-card').length,
        2,
      );
      await wait(850);
      const [saved] = await readProjects();
      assert.equal(saved.scenes.length, 0);
      assert.equal(
        saved.references.find((ref) => ref.id === 'legacy-art').dataUrl,
        imageDataUrl,
      );
      assert.equal(
        saved.references.find((ref) => ref.id === 'legacy-art').groupId,
        saved.referenceGroups[0].id,
      );
      assert.match(
        container.querySelector('.sb-save-status').textContent,
        /Saved in this browser/,
      );
      assert.ok(byText('button', 'Back to boards'));
    },
    { imageDataUrl },
  );
});

test('character group toggle removes inherited individual selections when switching it off', async () => {
  await withEditor(async (api) => {
    const {
      container,
      mount,
      unmount,
      wait,
      readProjects,
      writeProject,
      click,
      byText,
      field,
      changeSelect,
    } = api;
    await mount();
    await wait(850);
    const [legacy] = await readProjects();
    await unmount();
    legacy.references = [
      {
        id: 'legacy-selected',
        name: 'Original render',
        kind: 'character',
        mimeType: 'image/png',
        dataUrl: imageDataUrl,
      },
    ];
    legacy.scenes[0].shots[1].referenceIds = ['legacy-selected'];
    await writeProject(legacy);
    await mount();
    await addCharacter(api);
    await click(
      [...container.querySelectorAll('.sb-library-entry')].find((item) =>
        item.textContent.includes('Ungrouped artwork'),
      ),
    );
    await changeSelect(
      field('Library entry'),
      [...field('Library entry').options].find(
        (item) => item.textContent === 'Matilda',
      ).value,
    );
    await click(byText('button', 'Back to boards'));
    await click(byText('[role="tab"]', 'References'));
    await click(
      container.querySelector('[aria-label="Use Matilda in this panel"]'),
    );
    await click(
      container.querySelector('[aria-label="Use Matilda in this panel"]'),
    );
    await click(byText('[role="tab"]', 'Prompt'));
    assert.match(
      container.querySelector('.sb-prompt-references strong').textContent,
      /0 references/,
    );
    await wait(850);
    const [saved] = await readProjects();
    assert.deepEqual(saved.scenes[0].shots[1].referenceIds, [
      'legacy-selected',
    ]);
    assert.deepEqual(
      saved.scenes[0].shots[1].panels[0].referenceIds,
      [],
    );
    assert.deepEqual(
      saved.scenes[0].shots[1].panels[0].referenceGroupIds,
      [],
    );
  });
});
