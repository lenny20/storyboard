import assert from 'node:assert/strict';
import test from 'node:test';
import { withEditor } from './editor-harness.mjs';

test('agent prompt handoff lists the same grouped reference views as the editor prompt', async () => {
  await withEditor(
    async ({
      document,
      mount,
      unmount,
      readProjects,
      writeProject,
      wait,
      click,
      shotButton,
    }) => {
      const registered = new Map();
      document.modelContext = {
        registerTool(tool, { signal }) {
          registered.set(tool.name, tool);
          signal.addEventListener('abort', () => registered.delete(tool.name), {
            once: true,
          });
        },
      };
      await mount();
      await wait(850);
      const [project] = await readProjects();
      await unmount();
      project.referenceGroups = [
        {
          id: 'matilda-group',
          name: 'Matilda',
          kind: 'character',
          notes: 'Keep the round glasses.',
        },
      ];
      project.references = [
        {
          id: 'matilda-front',
          name: 'Original illustration',
          kind: 'character',
          groupId: 'matilda-group',
          viewLabel: 'Front',
          mimeType: 'image/png',
          dataUrl:
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
        },
      ];
      for (const scene of project.scenes) {
        for (const shot of scene.shots) {
          shot.referenceGroupIds = ['matilda-group'];
          for (const panel of shot.panels)
            panel.referenceGroupIds = ['matilda-group'];
        }
      }
      await writeProject(project);
      await mount();
      await wait();
      const handoff = registered.get('get_storyboard_panel_prompt');
      assert.ok(handoff, 'the optional agent tool is registered');
      const result = handoff.execute({});
      assert.deepEqual(result.references, [
        { id: 'matilda-front', name: 'Matilda — Front', kind: 'character' },
      ]);
      assert.match(result.prompt, /Matilda — Front/);
      assert.match(result.prompt, /Keep the round glasses/);
      assert.equal(result.attachmentRequired, true);
      assert.deepEqual(result.missingPreviousPanelReferences, []);
      assert.throws(() => handoff.execute({ upload: true }), /empty object/);
      await unmount();
      const source = project.scenes[0].shots[0].panels[0];
      source.versions = [
        {
          id: 'continuity-art',
          dataUrl: project.references[0].dataUrl,
          label: 'Chosen island',
          createdAt: new Date().toISOString(),
        },
      ];
      source.selectedVersionId = 'continuity-art';
      const target = structuredClone(source);
      Object.assign(target, {
        id: 'continuity-target',
        title: 'Second continuity frame',
        versions: [],
        selectedVersionId: null,
        markers: [],
        arrows: [],
        context: 'Only the second frame context.',
        dialogue: 'MATILDA\nOnly this frame.',
        camera: 'Dolly gently forward.',
        notes: 'Only this frame note.',
        previousPanelReferences: [
          { panelId: source.id, imageVersionId: 'continuity-art' },
        ],
      });
      project.scenes[0].shots[0].panels.push(target);
      project.scenes[0].shots[0].panelConnections = [
        {
          fromId: source.id,
          toId: target.id,
          type: 'aerial',
          description: 'Ease forward between these two frames.',
        },
      ];
      project.scenes[0].shotConnections = [
        {
          fromId: project.scenes[0].shots[0].id,
          toId: project.scenes[0].shots[1].id,
          type: 'match-cut',
          description: 'Match the cloud outline.',
          movement: 'aerial',
          movementDescription: 'Keep moving forward across the edit.',
        },
      ];
      await writeProject(project);
      await mount();
      await click(shotButton(project.scenes[0].shots[0].title));
      await click(
        [...document.querySelectorAll('.sb-panel-tab')].find((element) =>
          element.textContent.includes('Second continuity frame'),
        ),
      );
      const continuity = registered
        .get('get_storyboard_panel_prompt')
        .execute({});
      assert.equal(continuity.panelId, target.id);
      assert.equal(continuity.references.at(-1).id, 'continuity-art');
      assert.equal(continuity.references.at(-1).kind, 'previous-panel');
      assert.equal(continuity.references.at(-1).panelId, source.id);
      assert.match(continuity.prompt, /continuity/i);
      assert.deepEqual(continuity.missingPreviousPanelReferences, []);
      const selection = registered.get('get_storyboard_selection').execute({});
      assert.equal(selection.panel.context, target.context);
      assert.equal(selection.panel.dialogue, target.dialogue);
      assert.equal(selection.panel.camera, target.camera);
      assert.deepEqual(
        selection.panel.incomingConnection,
        project.scenes[0].shots[0].panelConnections[0],
      );
      assert.equal(selection.panel.outgoingConnection, null);
      assert.deepEqual(
        selection.shot.outgoingConnection,
        project.scenes[0].shotConnections[0],
      );
      assert.equal(selection.shot.incomingConnection, null);
      assert.match(continuity.prompt, /Only the second frame context/);
      assert.match(continuity.prompt, /Dolly gently forward/);
      await unmount();
      assert.equal(
        registered.size,
        0,
        'tools are removed when the editor closes',
      );
    },
  );
});
