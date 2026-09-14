import assert from 'node:assert/strict';
import test from 'node:test';
import { indexedDB } from 'fake-indexeddb';

import {
  cloneShot,
  createProject,
  getSelectedImage,
  type ImageVersion,
  validateProject,
} from './model.ts';
import { deleteProject, imageFileToDataUrl, importProject, listProjects, saveProject } from './storage.ts';
import { buildPanelPrompt, buildRevisionPrompt } from './prompts.ts';

Object.assign(globalThis, { indexedDB });

const imageData = 'data:image/png;base64,iVBORw0KGgo=';

function version(label = 'Selected sketch'): ImageVersion {
  return {
    id: crypto.randomUUID(),
    label,
    dataUrl: imageData,
    createdAt: '2026-09-10T01:00:00.000Z',
  };
}

test('project factory makes a blank first scene, shot, and panel', () => {
  const project = createProject('Board');
  assert.equal(project.scenes.length, 1);
  assert.equal(project.scenes[0].shots.length, 1);
  assert.equal(project.scenes[0].shots[0].panels.length, 1);
  assert.deepEqual(validateProject(project), project);
});

test('cloneShot isolates nested IDs while preserving selected-version intent', () => {
  const project = createProject();
  const source = project.scenes[0].shots[0];
  const panel = source.panels[0];
  const selected = version();
  panel.versions.push(selected);
  panel.selectedVersionId = selected.id;
  panel.markers.push({ id: crypto.randomUUID(), label: 'Matilda', x: 0.5, y: 0.5, scale: 1 });
  panel.arrows.push({ id: crypto.randomUUID(), kind: 'camera', x1: 0.2, y1: 0.5, x2: 0.8, y2: 0.5, label: 'dolly forward' });

  const copy = cloneShot(source);
  assert.notEqual(copy.id, source.id);
  assert.notEqual(copy.panels[0].id, panel.id);
  assert.notEqual(copy.panels[0].versions[0].id, selected.id);
  assert.notEqual(copy.panels[0].markers[0].id, panel.markers[0].id);
  assert.notEqual(copy.panels[0].arrows[0].id, panel.arrows[0].id);
  assert.equal(getSelectedImage(copy.panels[0])?.label, 'Selected sketch');
  copy.panels[0].markers[0].label = 'Changed';
  assert.equal(panel.markers[0].label, 'Matilda');
});

test('validation rejects unsupported or malformed embedded image data', () => {
  const project = createProject();
  project.scenes[0].shots[0].panels[0].versions.push(version());
  project.scenes[0].shots[0].panels[0].selectedVersionId = project.scenes[0].shots[0].panels[0].versions[0].id;
  project.scenes[0].shots[0].panels[0].versions[0].dataUrl = 'data:image/svg+xml;base64,PHN2Zz4=';
  assert.throws(() => validateProject(project), /PNG, JPEG, WebP, GIF, or AVIF/);
  project.scenes[0].shots[0].panels[0].versions[0].dataUrl = 'data:image/png;base64,abc';
  assert.throws(() => validateProject(project), /malformed base64/);
});

test('validation accepts temporarily empty user-editable display text', () => {
  const project = createProject();
  const shot = project.scenes[0].shots[0];
  const panel = shot.panels[0];
  project.name = '';
  project.scenes[0].title = '';
  shot.title = '';
  panel.title = '';
  project.references.push({ id: crypto.randomUUID(), name: '', kind: 'character', mimeType: 'image/png', dataUrl: imageData });
  shot.referenceIds = [project.references[0].id];
  panel.versions.push({ ...version(''), label: '' });
  panel.selectedVersionId = panel.versions[0].id;
  panel.markers.push({ id: crypto.randomUUID(), label: '', x: 0.5, y: 0.5, scale: 1 });
  panel.arrows.push({ id: crypto.randomUUID(), kind: 'action', x1: 0, y1: 0, x2: 1, y2: 1, label: '' });
  assert.doesNotThrow(() => validateProject(project));
});

test('prompts use selected references and retain panel/revision direction', () => {
  const project = createProject('Teaser');
  project.style = 'graphite pencil';
  project.references.push(
    { id: crypto.randomUUID(), name: 'Matilda turnaround', kind: 'character', mimeType: 'image/png', dataUrl: imageData },
    { id: crypto.randomUUID(), name: 'Do not attach', kind: 'style', mimeType: 'image/png', dataUrl: imageData },
  );
  const shot = project.scenes[0].shots[0];
  shot.referenceIds = [project.references[0].id];
  shot.camera = 'Dolly forward into close-up.';
  shot.dialogue = 'Hello.';
  shot.panels[0].title = 'Start';
  shot.panels[0].framing = 'Medium';
  shot.panels.push({ ...shot.panels[0], id: crypto.randomUUID(), title: 'End', framing: 'Close-up', description: 'Matilda smiles.', versions: [], selectedVersionId: null });
  const current = version('Start sketch');
  shot.panels[0].versions = [current];
  shot.panels[0].selectedVersionId = current.id;

  const prompt = buildPanelPrompt(project, project.scenes[0], shot, shot.panels[0]);
  assert.match(prompt, /Panel: 1 of 2/);
  assert.match(prompt, /Matilda turnaround/);
  assert.doesNotMatch(prompt, /Do not attach/);
  assert.match(prompt, /dolly.*zoom|zoom.*dolly/i);
  assert.match(prompt, /do not render it as text/i);
  assert.match(buildRevisionPrompt(project, project.scenes[0], shot, shot.panels[0], 'Keep her centred.'), /Start sketch/);
});

test('storage preserves selection and deletion waits for queued writes', async () => {
  const project = createProject('Persistence test');
  project.updatedAt = '2026-09-10T01:00:00.000Z';
  const selected = version();
  project.scenes[0].shots[0].panels[0].versions.push(selected);
  project.scenes[0].shots[0].panels[0].selectedVersionId = selected.id;
  const save = saveProject(project);
  const remove = deleteProject(project.id);
  await Promise.all([save, remove]);
  assert.equal((await listProjects()).some((candidate) => candidate.id === project.id), false);

  await saveProject(project);
  const saved = (await listProjects()).find((candidate) => candidate.id === project.id);
  assert.equal(saved?.scenes[0].shots[0].panels[0].selectedVersionId, selected.id);
});

test('import reports malformed backups and image upload rejects unsupported input before reading', async () => {
  const invalidJson = { name: 'bad.storyboard.json', size: 1, text: async () => '{' } as File;
  await assert.rejects(importProject(invalidJson), /not valid JSON/);
  const invalidProject = { name: 'bad.storyboard.json', size: 2, text: async () => '{}' } as File;
  await assert.rejects(importProject(invalidProject), /schemaVersion/);
  await assert.rejects(imageFileToDataUrl({ name: 'vector.svg', size: 4, type: 'image/svg+xml' } as File), /not a supported image/);
  await assert.rejects(imageFileToDataUrl({ name: 'large.png', size: 21 * 1024 * 1024, type: 'image/png' } as File), /20 MB/);
});
