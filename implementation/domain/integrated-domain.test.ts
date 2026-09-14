import assert from 'node:assert/strict';
import test from 'node:test';
import { indexedDB } from 'fake-indexeddb';

import { createProject, validateProject } from '../../studio/lib/storyboard/model.ts';
import { buildPanelPrompt } from '../../studio/lib/storyboard/prompts.ts';
import { deleteProject, listProjects, saveProject } from '../../studio/lib/storyboard/storage.ts';

Object.assign(globalThis, { indexedDB });
const imageData = 'data:image/png;base64,iVBORw0KGgo=';

test('integrated model permits live-cleared display strings and rejects invalid selected images', () => {
  const project = createProject();
  project.name = '';
  project.scenes[0].title = '';
  project.scenes[0].shots[0].title = '';
  project.scenes[0].shots[0].panels[0].title = '';
  assert.doesNotThrow(() => validateProject(project));

  project.scenes[0].shots[0].panels[0].versions.push({
    id: crypto.randomUUID(), label: 'bad', dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=', createdAt: '2026-09-10T01:00:00.000Z',
  });
  assert.throws(() => validateProject(project), /PNG, JPEG, WebP, GIF, or AVIF/);
});

test('integrated persistence retains an image selection and honours queued deletion', async () => {
  const project = createProject('Integrated persistence');
  const panel = project.scenes[0].shots[0].panels[0];
  const id = crypto.randomUUID();
  panel.versions.push({ id, label: 'Sketch', dataUrl: imageData, createdAt: '2026-09-10T01:00:00.000Z' });
  panel.selectedVersionId = id;
  await saveProject(project, { expectedUpdatedAt: null });
  const saved = (await listProjects()).find((item) => item.id === project.id);
  assert.equal(saved?.scenes[0].shots[0].panels[0].selectedVersionId, id);
  await Promise.all([
    saveProject(project, { expectedUpdatedAt: project.updatedAt }),
    deleteProject(project.id, { expectedUpdatedAt: project.updatedAt }),
  ]);
  assert.equal((await listProjects()).some((item) => item.id === project.id), false);
});

test('integrated prompt includes only a panel’s selected references', () => {
  const project = createProject('Integrated prompt');
  const selected = { id: crypto.randomUUID(), name: 'Hero turnaround', kind: 'character' as const, mimeType: 'image/png', dataUrl: imageData };
  const hidden = { id: crypto.randomUUID(), name: 'Unused location', kind: 'location' as const, mimeType: 'image/png', dataUrl: imageData };
  project.references.push(selected, hidden);
  const shot = project.scenes[0].shots[0];
  shot.referenceIds = [selected.id];
  shot.camera = 'Dolly forward.';
  shot.panels[0].referenceIds = [selected.id];
  shot.panels[0].camera = shot.camera;
  const prompt = buildPanelPrompt(project, project.scenes[0], shot, shot.panels[0]);
  assert.match(prompt, /Hero turnaround/);
  assert.doesNotMatch(prompt, /Unused location/);
  assert.match(prompt, /dolly.*zoom|zoom.*dolly/i);
});
