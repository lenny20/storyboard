import assert from 'node:assert/strict';
import test from 'node:test';
import { createProject } from '../lib/storyboard/model';
import {
  buildPanelPrompt,
  buildRevisionPrompt,
} from '../lib/storyboard/prompts';

function fixture() {
  const project = createProject('Teaser');
  const scene = project.scenes[0];
  const shot = scene.shots[0];
  const panel = shot.panels[0];
  project.referenceGroups = [
    { id: 'matilda', name: 'Matilda', kind: 'character', notes: '' },
  ];
  project.references = [
    {
      id: 'front',
      name: 'front.png',
      kind: 'character',
      groupId: 'matilda',
      viewLabel: 'Front',
      mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,AQ==',
    },
    {
      id: 'location',
      name: 'Island',
      kind: 'location',
      mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,Ag==',
    },
    {
      id: 'side',
      name: 'side.png',
      kind: 'character',
      groupId: 'matilda',
      viewLabel: 'Side',
      mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,Aw==',
    },
  ];
  shot.referenceIds = ['location', 'front'];
  shot.referenceGroupIds = ['matilda'];
  panel.referenceIds = [...shot.referenceIds];
  panel.referenceGroupIds = [...shot.referenceGroupIds];
  panel.versions = [
    {
      id: 'current',
      label: 'Current image',
      dataUrl: 'data:image/png;base64,BA==',
      createdAt: project.createdAt,
    },
  ];
  panel.selectedVersionId = 'current';
  return { project, scene, shot, panel };
}

void test('API prompt input numbers match explicit-first deduplicated group reference order', () => {
  const { project, scene, shot, panel } = fixture();
  const prompt = buildPanelPrompt(project, scene, shot, panel, {
    attachmentMode: 'api',
  });
  assert.deepEqual(
    prompt.split('\n').filter((line) => line.startsWith('- Input image')),
    [
      '- Input image 1: location — Island.',
      '- Input image 2: character — Matilda — Front.',
      '- Input image 3: character — Matilda — Side.',
    ],
  );
  assert.doesNotMatch(prompt, /manually|\(file:/);
  const manual = buildPanelPrompt(project, scene, shot, panel);
  assert.match(manual, /Attach these selected reference images manually/);
  assert.match(manual, /\(file:/);
  assert.doesNotMatch(manual, /Input image 1:/);
});

void test('API revision reserves first input for current artwork and shifts references in transport order', () => {
  const { project, scene, shot, panel } = fixture();
  const prompt = buildRevisionPrompt(
    project,
    scene,
    shot,
    panel,
    'Move her left.',
    { attachmentMode: 'api' },
  );
  assert.match(
    prompt,
    /^Input image 1: current panel image .*already attached/,
  );
  assert.deepEqual(
    prompt.split('\n').filter((line) => line.startsWith('- Input image')),
    [
      '- Input image 2: location — Island.',
      '- Input image 3: character — Matilda — Front.',
      '- Input image 4: character — Matilda — Side.',
    ],
  );
  assert.doesNotMatch(
    prompt,
    /Attach the selected current panel image|manually|\(file:/,
  );
  assert.match(
    buildRevisionPrompt(project, scene, shot, panel, 'Move her left.'),
    /Attach the selected current panel image/,
  );
});

void test('text-only API generation claims no attachments and API revision requires a selected base', () => {
  const { project, scene, shot, panel } = fixture();
  shot.referenceIds = [];
  shot.referenceGroupIds = [];
  panel.referenceIds = [];
  panel.referenceGroupIds = [];
  assert.doesNotMatch(
    buildPanelPrompt(project, scene, shot, panel, { attachmentMode: 'api' }),
    /already attached|Input image/,
  );
  panel.selectedVersionId = null;
  assert.throws(
    () =>
      buildRevisionPrompt(project, scene, shot, panel, 'Move her left.', {
        attachmentMode: 'api',
      }),
    /Select a current panel image/,
  );
});

void test('the selected panel direction leads shared shot context in a generation prompt', () => {
  const { project, scene, shot } = fixture();
  shot.description = 'The whole shot remains calm and observational.';
  shot.panels[0].description = 'The earlier frame looks out across the water.';
  const panel = {
    ...shot.panels[0],
    id: crypto.randomUUID(),
    title: 'New frame',
    description: 'Matilda enters from frame right and stops in profile.',
    versions: [],
    selectedVersionId: null,
    context: shot.description,
  };
  shot.panels.push(panel);

  const prompt = buildPanelPrompt(project, scene, shot, panel, {
    attachmentMode: 'api',
  });
  const frameIndex = prompt.indexOf(
    'Primary frame direction: Matilda enters from frame right',
  );
  const contextIndex = prompt.indexOf('Context: The whole shot remains calm');
  assert.ok(frameIndex >= 0, 'current frame direction is explicit');
  assert.ok(contextIndex > frameIndex, 'current frame direction has priority');
});

void test('rough blocking rules override detailed references and revisions for the preset and legacy defaults', () => {
  for (const style of [
    'Rough blocking sketch',
    ' rough pencil sketch ',
    'ROUGH PENCIL STORYBOARD',
  ]) {
    const { project, scene, shot, panel } = fixture();
    project.style = style;
    const prompt = buildPanelPrompt(project, scene, shot, panel, {
      attachmentMode: 'api',
    });
    assert.match(prompt, /ROUGH BLOCKING STYLE IS MANDATORY/);
    assert.match(prompt, /professional storyboard artist’s one-to-two-minute/);
    assert.match(prompt, /only enough detail to read the action/);
    assert.match(prompt, /photorealistic, 3D rendered/);
    assert.match(prompt, /silhouette and proportions only/);

    const revision = buildRevisionPrompt(
      project,
      scene,
      shot,
      panel,
      'Turn this into a detailed photorealistic 3D render.',
      { attachmentMode: 'api' },
    );
    assert.match(revision, /must preserve the mandatory rough blocking style/);
  }
});

void test('custom detailed styles remain configurable without rough blocking rules', () => {
  const { project, scene, shot, panel } = fixture();
  project.style = 'Photoreal cinematic 3D render';
  project.styleNotes = 'Detailed materials and dramatic lighting.';
  const prompt = buildPanelPrompt(project, scene, shot, panel, {
    attachmentMode: 'api',
  });
  assert.match(prompt, /Visual style: Photoreal cinematic 3D render/);
  assert.doesNotMatch(prompt, /ROUGH BLOCKING STYLE|mandatory rough blocking/);
});
