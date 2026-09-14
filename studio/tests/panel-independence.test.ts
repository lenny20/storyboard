import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cloneShot,
  createPanel,
  createProject,
  getPanelDetails,
  splitShotAfterPanel,
  validateProject,
  type Panel,
} from '../lib/storyboard/model';
import { buildPanelPrompt } from '../lib/storyboard/prompts';
import {
  resolvePanelReferenceGroups,
  resolvePanelReferences,
} from '../lib/storyboard/references';

void test('new panels start independent and positional transitions remain dynamic', () => {
  const project = createProject('Independent panels');
  const shot = project.scenes[0].shots[0];
  shot.description = 'Legacy shared context';
  shot.camera = 'Legacy camera';
  shot.referenceIds = ['legacy'];
  const panel = createPanel('New panel');
  shot.panels.push(panel);

  assert.deepEqual(
    {
      context: panel.context,
      dialogue: panel.dialogue,
      camera: panel.camera,
      notes: panel.notes,
      referenceIds: panel.referenceIds,
      referenceGroupIds: panel.referenceGroupIds,
    },
    {
      context: '',
      dialogue: '',
      camera: '',
      notes: '',
      referenceIds: [],
      referenceGroupIds: [],
    },
  );
  assert.equal(getPanelDetails(shot, shot.panels[0]).transition, 'continue');
  assert.equal(getPanelDetails(shot, panel).transition, 'cut');
  assert.equal(getPanelDetails(shot, panel).context, '');
});

void test('legacy validation materializes panel metadata and selections without freezing transition', () => {
  const project = createProject('Legacy');
  const shot = project.scenes[0].shots[0];
  const panel = shot.panels[0] as Panel & Record<string, unknown>;
  shot.description = 'Authored context';
  shot.dialogue = 'Authored dialogue';
  shot.camera = 'Dolly in';
  shot.notes = 'Hold the beat';
  for (const key of [
    'context',
    'dialogue',
    'camera',
    'notes',
    'transition',
    'referenceIds',
    'referenceGroupIds',
  ])
    delete panel[key];

  const loaded = validateProject(structuredClone(project));
  const loadedShot = loaded.scenes[0].shots[0];
  const loadedPanel = loadedShot.panels[0];
  assert.deepEqual(getPanelDetails(loadedShot, loadedPanel), {
    context: 'Authored context',
    dialogue: 'Authored dialogue',
    camera: 'Dolly in',
    notes: 'Hold the beat',
    transition: 'cut',
    referenceIds: [],
    referenceGroupIds: [],
  });
  assert.equal(loadedPanel.transition, undefined);
});

void test('legacy panel action migrates into the description once, and a malformed value still throws', () => {
  const project = createProject('Legacy action');
  const shot = project.scenes[0].shots[0];
  const panel = shot.panels[0];
  panel.description = 'Wide establishing frame.';
  (panel as unknown as Record<string, unknown>).action = 'Matilda waves.';

  const loaded = validateProject(structuredClone(project));
  const loadedPanel = loaded.scenes[0].shots[0].panels[0];
  assert.equal(
    loadedPanel.description,
    'Wide establishing frame.\nMatilda waves.',
  );
  assert.equal(
    (loadedPanel as unknown as Record<string, unknown>).action,
    undefined,
  );

  // Re-loading an already-migrated document does not duplicate the appended text.
  const reloaded = validateProject(structuredClone(loaded));
  assert.equal(
    reloaded.scenes[0].shots[0].panels[0].description,
    'Wide establishing frame.\nMatilda waves.',
  );

  // A blank description takes just the action, with no leading line break.
  const secondPanel = createPanel('Second');
  (secondPanel as unknown as Record<string, unknown>).action = 'Cut to black.';
  shot.panels.push(secondPanel);
  const loadedSecond = validateProject(structuredClone(project)).scenes[0]
    .shots[0].panels[1];
  assert.equal(loadedSecond.description, 'Cut to black.');

  (panel as unknown as Record<string, unknown>).action = 42;
  assert.throws(
    () => validateProject(structuredClone(project)),
    /\.action: expected a string/,
  );
});

void test('a legacy transitionNote on a non-final panel migrates into the panel connection to the next panel', () => {
  const project = createProject('Legacy note within shot');
  const shot = project.scenes[0].shots[0];
  const first = shot.panels[0];
  const second = createPanel('Second');
  shot.panels.push(second);
  (first as unknown as Record<string, unknown>).transitionNote =
    'Whip pan as the door opens.';

  const loaded = validateProject(structuredClone(project));
  const loadedShot = loaded.scenes[0].shots[0];
  assert.equal(
    loadedShot.panelConnections?.[0].description,
    'Whip pan as the door opens.',
  );
  assert.equal(loadedShot.panelConnections?.[0].type, 'static');
  assert.equal(
    (loadedShot.panels[0] as unknown as Record<string, unknown>)
      .transitionNote,
    undefined,
  );

  // An existing connection description is extended rather than replaced.
  (
    project.scenes[0].shots[0] as unknown as Record<string, unknown>
  ).panelConnections = [
    {
      fromId: first.id,
      toId: second.id,
      type: 'dolly',
      description: 'Slow push in.',
    },
  ];
  const loadedWithExisting = validateProject(structuredClone(project));
  assert.equal(
    loadedWithExisting.scenes[0].shots[0].panelConnections?.[0].description,
    'Slow push in. · Whip pan as the door opens.',
  );
  assert.equal(
    loadedWithExisting.scenes[0].shots[0].panelConnections?.[0].type,
    'dolly',
  );
});

void test("a legacy transitionNote on a shot's last panel migrates into the shot connection when a shot follows", () => {
  const project = createProject('Legacy note across shots');
  const scene = project.scenes[0];
  const shot = scene.shots[0];
  const nextShot = { ...structuredClone(shot), id: 'next-shot' };
  nextShot.panels = [createPanel('Next panel')];
  scene.shots.push(nextShot);
  (
    shot.panels[0] as unknown as Record<string, unknown>
  ).transitionNote = 'Cut when the cloud fully obscures the frame.';

  const loaded = validateProject(structuredClone(project));
  const loadedScene = loaded.scenes[0];
  assert.equal(
    loadedScene.shotConnections?.[0].description,
    'Cut when the cloud fully obscures the frame.',
  );
  assert.equal(loadedScene.shotConnections?.[0].type, 'cut');
  assert.equal(loadedScene.shotConnections?.[0].fromId, loadedScene.shots[0].id);
  assert.equal(loadedScene.shotConnections?.[0].toId, loadedScene.shots[1].id);
});

void test('a legacy transitionNote with nothing following becomes an ending cue on the panel, and a malformed value still throws', () => {
  const project = createProject('Legacy note with no follow-on');
  const shot = project.scenes[0].shots[0];
  const panel = shot.panels[0];
  panel.context = 'Clouds gather';
  (panel as unknown as Record<string, unknown>).transitionNote =
    'Cut when the cloud fully obscures the frame.';

  const loaded = validateProject(structuredClone(project));
  const loadedPanel = loaded.scenes[0].shots[0].panels[0];
  assert.equal(
    loadedPanel.description,
    '\nEnding cue: Cut when the cloud fully obscures the frame.',
  );
  assert.equal(loadedPanel.context, 'Clouds gather');
  assert.equal(
    (loadedPanel as unknown as Record<string, unknown>).transitionNote,
    undefined,
  );
  assert.equal(loaded.scenes[0].shots[0].panelConnections, undefined);

  (panel as unknown as Record<string, unknown>).transitionNote = 42;
  assert.throws(
    () => validateProject(structuredClone(project)),
    /transitionNote: expected a string/,
  );
});

void test('PDF artwork width defaults compact and validates an optional per-panel override', () => {
  const project = createProject('PDF artwork width');
  const first = project.scenes[0].shots[0].panels[0];
  const second = createPanel('Wide artwork');
  project.scenes[0].shots[0].panels.push(second);

  assert.equal(first.pdfFullWidth, false);
  delete first.pdfFullWidth;
  second.pdfFullWidth = true;
  let loaded = validateProject(structuredClone(project));
  assert.equal(loaded.scenes[0].shots[0].panels[0].pdfFullWidth, undefined);
  assert.equal(loaded.scenes[0].shots[0].panels[1].pdfFullWidth, true);

  second.pdfFullWidth = false;
  loaded = validateProject(structuredClone(project));
  assert.equal(loaded.scenes[0].shots[0].panels[1].pdfFullWidth, false);

  (second as unknown as Record<string, unknown>).pdfFullWidth = 'yes';
  assert.throws(
    () => validateProject(structuredClone(project)),
    /pdfFullWidth: expected a boolean when present/,
  );
});

void test('splitting a shot is atomic, preserves nested identities, and keeps tail boundary metadata', () => {
  const project = createProject('Split');
  const scene = project.scenes[0];
  const shot = scene.shots[0];
  shot.title = 'Cloud cover';
  shot.transition = 'dissolve';
  shot.referenceIds = ['shot-reference'];
  const middle = createPanel('Middle');
  const tail = createPanel('Tail');
  middle.previousPanelReferences = [
    { panelId: shot.panels[0].id, imageVersionId: 'version-a' },
  ];
  tail.versions = [
    {
      id: 'version-tail',
      dataUrl: 'data:image/png;base64,AQ==',
      createdAt: project.createdAt,
      label: 'Tail image',
    },
  ];
  tail.selectedVersionId = 'version-tail';
  shot.panels.push(middle, tail);

  const split = splitShotAfterPanel(scene, shot.id, middle.id);
  assert.notEqual(split, scene);
  assert.equal(split.shots.length, 2);
  assert.deepEqual(
    split.shots.flatMap((item) => item.panels.map((panel) => panel.id)),
    shot.panels.map((panel) => panel.id),
  );
  assert.equal(split.shots[0].panels[1].transition, 'cut');
  assert.equal(split.shots[1].title, 'Cloud cover — next shot');
  assert.equal(split.shots[1].transition, 'dissolve');
  assert.equal(split.shots[1].panels[0], tail);
  assert.equal(split.shots[1].panels[0].versions[0].id, 'version-tail');
  assert.deepEqual(
    split.shots[0].panels[1].previousPanelReferences,
    middle.previousPanelReferences,
  );
  assert.deepEqual(scene.shots, [shot], 'input remains unchanged');
  assert.equal(splitShotAfterPanel(scene, 'missing', middle.id), scene);
  assert.equal(splitShotAfterPanel(scene, shot.id, 'missing'), scene);
  assert.equal(splitShotAfterPanel(scene, shot.id, tail.id), scene);

  middle.transition = 'wipe';
  assert.equal(
    splitShotAfterPanel(scene, shot.id, middle.id).shots[0].panels[1]
      .transition,
    'wipe',
  );
});

void test('explicit empty panel fields and reference selections override the shot', () => {
  const project = createProject('Overrides');
  const shot = project.scenes[0].shots[0];
  const panel = shot.panels[0];
  shot.description = 'Shared context must not leak';
  shot.dialogue = 'Shared dialogue must not leak';
  shot.camera = 'Shared camera must not leak';
  shot.notes = 'Shared notes must not leak';
  panel.context = '';
  panel.dialogue = '';
  panel.camera = '';
  panel.notes = '';

  const prompt = buildPanelPrompt(project, project.scenes[0], shot, panel);
  for (const leaked of [
    'Shared context',
    'Shared dialogue',
    'Shared camera',
    'Shared notes',
  ])
    assert.doesNotMatch(prompt, new RegExp(leaked));
});

void test('panel reference overrides resolve assets and groups independently and clone immutably', () => {
  const project = createProject('References');
  const shot = project.scenes[0].shots[0];
  const panel = shot.panels[0];
  project.referenceGroups = [
    { id: 'hero', name: 'Hero', kind: 'character', notes: 'Blue coat' },
  ];
  project.references = [
    {
      id: 'front',
      name: 'Front',
      kind: 'character',
      groupId: 'hero',
      mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,AQ==',
    },
    {
      id: 'prop',
      name: 'Prop',
      kind: 'prop',
      mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,Ag==',
    },
  ];
  shot.referenceIds = ['prop'];
  panel.referenceIds = [];
  panel.referenceGroupIds = ['hero'];

  assert.deepEqual(
    resolvePanelReferences(project, shot, panel).map(({ id }) => id),
    ['front'],
  );
  assert.deepEqual(
    resolvePanelReferenceGroups(project, shot, panel).map(({ id }) => id),
    ['hero'],
  );
  const cloned = cloneShot(shot);
  assert.deepEqual(cloned.panels[0].referenceGroupIds, ['hero']);
  assert.notEqual(cloned.panels[0].referenceGroupIds, panel.referenceGroupIds);
});
