import assert from 'node:assert/strict';
import test from 'node:test';
import { strFromU8, unzipSync } from 'fflate';

import { createGenerationPack } from '../lib/storyboard/generation-pack';
import {
  buildPanelPrompt,
  buildRevisionPrompt,
} from '../lib/storyboard/prompts';
import {
  cloneShot,
  createPanel,
  createProject,
  createShot,
  validateProject,
} from '../lib/storyboard/model';
import {
  getPreviousPanelCandidates,
  previousPanelPackFilename,
  resolvePreviousPanelReferences,
} from '../lib/storyboard/references';

const PNG_A = 'data:image/png;base64,AQID';
const PNG_B = 'data:image/png;base64,BAUG';

function fixture() {
  const project = createProject('Continuity');
  const scene = project.scenes[0];
  const firstShot = scene.shots[0];
  const first = firstShot.panels[0];
  first.id = 'panel-first';
  first.title = 'Wide arrival';
  first.versions = [
    {
      id: 'version-old',
      dataUrl: PNG_A,
      createdAt: project.createdAt,
      label: 'Old',
    },
    {
      id: 'version-new',
      dataUrl: PNG_B,
      createdAt: project.createdAt,
      label: 'New',
    },
  ];
  first.selectedVersionId = 'version-old';
  const secondShot = createShot('Second shot');
  const target = createPanel('Close-up');
  target.id = 'panel-target';
  secondShot.panels.push(target);
  scene.shots.push(secondShot);
  return { project, scene, firstShot, first, secondShot, target };
}

void test('candidates are selected images from earlier panels across shots', () => {
  const { scene, first, target } = fixture();
  assert.deepEqual(
    getPreviousPanelCandidates(scene, target).map(
      ({ panelId, imageVersionId }) => ({ panelId, imageVersionId }),
    ),
    [{ panelId: first.id, imageVersionId: 'version-old' }],
  );
  assert.deepEqual(getPreviousPanelCandidates(scene, first), []);
});

void test('resolution pins a version, preserves order, deduplicates, and reports invalid chronology', () => {
  const { scene, first, target } = fixture();
  target.previousPanelReferences = [
    { panelId: first.id, imageVersionId: 'version-old' },
    { panelId: first.id, imageVersionId: 'version-old' },
  ];
  first.selectedVersionId = 'version-new';
  let result = resolvePreviousPanelReferences(scene, target);
  assert.equal(result.references[0].dataUrl, PNG_A);
  assert.equal(result.references.length, 1);
  scene.shots.reverse();
  result = resolvePreviousPanelReferences(scene, target);
  assert.deepEqual(result.references, []);
  assert.deepEqual(result.missing, [
    { panelId: first.id, imageVersionId: 'version-old' },
  ]);
});

void test('validation roundtrips optional pins, rejects malformed values, and permits dangling ids', () => {
  const { project, first, target } = fixture();
  target.previousPanelReferences = [
    { panelId: first.id, imageVersionId: 'deleted-version' },
  ];
  assert.deepEqual(
    validateProject(structuredClone(project)).scenes[0].shots[1].panels[0]
      .previousPanelReferences,
    target.previousPanelReferences,
  );
  const malformed = structuredClone(project);
  Object.assign(malformed.scenes[0].shots[1].panels[0], {
    previousPanelReferences: [{ panelId: 4, imageVersionId: 'x' }],
  });
  assert.throws(
    () => validateProject(malformed),
    /previousPanelReferences\[0\]\.panelId/,
  );
});

void test('cloneShot remaps internal panel and version pins and preserves external pins', () => {
  const { firstShot, first } = fixture();
  const target = createPanel('Later');
  target.previousPanelReferences = [
    { panelId: first.id, imageVersionId: 'version-old' },
    { panelId: 'external-panel', imageVersionId: 'external-version' },
  ];
  firstShot.panels.push(target);
  const cloned = cloneShot(firstShot);
  assert.deepEqual(cloned.panels[1].previousPanelReferences?.[0], {
    panelId: cloned.panels[0].id,
    imageVersionId: cloned.panels[0].versions[0].id,
  });
  assert.deepEqual(
    cloned.panels[1].previousPanelReferences?.[1],
    target.previousPanelReferences[1],
  );
});

void test('prompts order library then previous panels and revisions retain base as input one', () => {
  const { project, scene, first, secondShot, target } = fixture();
  project.references.push({
    id: 'library',
    name: 'Hero',
    kind: 'character',
    dataUrl: PNG_A,
    mimeType: 'image/png',
  });
  secondShot.referenceIds = ['library'];
  target.referenceIds = ['library'];
  target.previousPanelReferences = [
    { panelId: first.id, imageVersionId: 'version-old' },
  ];
  const prompt = buildPanelPrompt(project, scene, secondShot, target, {
    attachmentMode: 'api',
  });
  assert.ok(
    prompt.indexOf('Input image 1: character') <
      prompt.indexOf('Input image 2: earlier panel'),
  );
  target.versions = [
    {
      id: 'current',
      dataUrl: PNG_B,
      createdAt: project.createdAt,
      label: 'Current',
    },
  ];
  target.selectedVersionId = 'current';
  const revision = buildRevisionPrompt(
    project,
    scene,
    secondShot,
    target,
    'Move left.',
    { attachmentMode: 'api' },
  );
  assert.match(revision, /^Input image 1: current panel image/);
  assert.match(revision, /Input image 2: character/);
  assert.match(revision, /Input image 3: earlier panel/);
  assert.match(
    revision,
    /new composition, action, framing, and camera direction take precedence/,
  );
});

void test('generation pack contains exact pinned bytes and refuses missing pins', async () => {
  const { project, scene, first, secondShot, target } = fixture();
  target.previousPanelReferences = [
    { panelId: first.id, imageVersionId: 'version-old' },
  ];
  first.selectedVersionId = 'version-new';
  const resolved = resolvePreviousPanelReferences(scene, target).references[0];
  const path = previousPanelPackFilename(resolved, 0);
  const pack = await createGenerationPack(project, scene, secondShot, target);
  const archive = unzipSync(new Uint8Array(await pack.blob.arrayBuffer()));
  assert.deepEqual([...archive[path]], [1, 2, 3]);
  assert.match(
    pack.prompt,
    new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  );
  assert.match(
    strFromU8(archive['reference-map.txt']),
    /image version version-old/,
  );
  target.previousPanelReferences = [
    { panelId: first.id, imageVersionId: 'gone' },
  ];
  await assert.rejects(
    createGenerationPack(project, scene, secondShot, target),
    /earlier panel references are missing/,
  );
});
