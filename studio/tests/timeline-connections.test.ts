import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cloneShot,
  createPanel,
  createProject,
  createShot,
  getPanelConnection,
  getShotConnection,
  reorderPanels,
  reorderShots,
  setPanelConnection,
  setShotConnection,
  splitShotAfterPanel,
  validateProject,
} from '../lib/storyboard/model';

void test('legacy connections materialize on edit and remain tied to id pairs', () => {
  const project = createProject('Connections');
  const scene = project.scenes[0];
  const first = scene.shots[0];
  const second = createShot('Second');
  const third = createShot('Third');
  second.panels.push(createPanel('Second panel'));
  third.panels.push(createPanel('Third panel'));
  first.transition = 'dissolve';
  scene.shots.push(second, third);

  const edited = setShotConnection(scene, {
    fromId: second.id,
    toId: third.id,
    type: 'wipe',
    description: 'Screen right',
    movement: 'pan',
    movementDescription: 'Follow the car',
  });
  assert.deepEqual(getShotConnection(edited, first.id, second.id), {
    fromId: first.id,
    toId: second.id,
    type: 'dissolve',
    description: '',
    movement: 'static',
    movementDescription: '',
  });

  const away = reorderShots(edited, first.id, third.id);
  const restored = reorderShots(away, first.id, second.id);
  assert.equal(
    getShotConnection(restored, first.id, second.id).type,
    'dissolve',
  );
  assert.equal(
    getShotConnection(restored, second.id, third.id).movement,
    'pan',
  );
});

void test('panel reorder preserves dormant pair cues and defaults novel pairs', () => {
  const shot = createShot('Move');
  const a = createPanel('A');
  const b = createPanel('B');
  const c = createPanel('C');
  a.camera = 'Drift closer';
  shot.panels.push(a, b, c);
  const authored = setPanelConnection(shot, {
    fromId: b.id,
    toId: c.id,
    type: 'orbit',
    description: 'Clockwise',
  });
  const away = reorderPanels(authored, a.id, c.id);
  assert.deepEqual(getPanelConnection(away, b.id, a.id), {
    fromId: b.id,
    toId: a.id,
    type: 'static',
    description: '',
  });
  const restored = reorderPanels(away, a.id, b.id);
  assert.equal(
    getPanelConnection(restored, a.id, b.id).description,
    'Drift closer',
  );
  assert.equal(getPanelConnection(restored, b.id, c.id).type, 'orbit');
  const repeated = reorderPanels(
    reorderPanels(restored, a.id, c.id),
    a.id,
    b.id,
  );
  assert.equal(
    repeated.panelConnections?.length,
    restored.panelConnections?.length,
  );
});

void test('validation accepts dormant pairs and rejects malformed connections', () => {
  const project = createProject('Validation');
  const shot = project.scenes[0].shots[0];
  const second = createPanel('Second');
  const third = createPanel('Third');
  shot.panels.push(second, third);
  shot.panelConnections = [
    {
      fromId: shot.panels[0].id,
      toId: third.id,
      type: 'aerial',
      description: '',
    },
  ];
  assert.equal(
    validateProject(structuredClone(project)).scenes[0].shots[0]
      .panelConnections?.[0].type,
    'aerial',
  );

  shot.panelConnections.push({ ...shot.panelConnections[0] });
  assert.throws(
    () => validateProject(structuredClone(project)),
    /duplicates a connection pair/,
  );
  shot.panelConnections = [
    { fromId: second.id, toId: second.id, type: 'static', description: '' },
  ];
  assert.throws(
    () => validateProject(structuredClone(project)),
    /must not link an item to itself/,
  );
  shot.panelConnections = [
    { fromId: second.id, toId: third.id, type: 'crane', description: '' },
  ];
  assert.throws(
    () => validateProject(structuredClone(project)),
    /panelConnections.*type/,
  );

  const following = createShot('Following');
  following.panels.push(createPanel());
  project.scenes[0].shots.push(following);
  delete shot.panelConnections;
  project.scenes[0].shotConnections = [
    {
      fromId: shot.id,
      toId: following.id,
      type: 'cut',
      description: '',
      movement: 'aerial',
    },
  ];
  assert.equal(
    validateProject(structuredClone(project)).scenes[0].shotConnections?.[0]
      .movement,
    'aerial',
  );
  project.scenes[0].shotConnections[0].movement = 'crane';
  assert.throws(
    () => validateProject(structuredClone(project)),
    /shotConnections.*movement/,
  );
  project.scenes[0].shotConnections[0] = {
    fromId: shot.id,
    toId: 'missing',
    type: 'cut',
    description: '',
  };
  assert.throws(
    () => validateProject(structuredClone(project)),
    /toId: does not refer to an endpoint/,
  );
  project.scenes[0].shotConnections[0] = {
    fromId: shot.id,
    toId: following.id,
    type: 'cut',
    description: 42 as unknown as string,
  };
  assert.throws(
    () => validateProject(structuredClone(project)),
    /description: expected a string/,
  );
});

void test('clone remaps panel pairs and split partitions cues without losing outgoing shot direction', () => {
  const project = createProject('Clone and split');
  const scene = project.scenes[0];
  const shot = scene.shots[0];
  const middle = createPanel('Middle');
  const tail = createPanel('Tail');
  shot.panels.push(middle, tail);
  shot.panelConnections = [
    {
      fromId: shot.panels[0].id,
      toId: middle.id,
      type: 'dolly',
      description: 'Slowly',
    },
    { fromId: middle.id, toId: tail.id, type: 'pan', description: 'Reveal' },
  ];
  const cloned = cloneShot(shot);
  assert.deepEqual(
    cloned.panelConnections?.map(({ fromId, toId }) => [fromId, toId]),
    [
      [cloned.panels[0].id, cloned.panels[1].id],
      [cloned.panels[1].id, cloned.panels[2].id],
    ],
  );

  middle.transition = 'fade';
  const following = createShot('Following');
  following.panels.push(createPanel());
  scene.shots.push(following);
  scene.shotConnections = [
    {
      fromId: shot.id,
      toId: following.id,
      type: 'wipe',
      description: 'Old exit',
      movement: 'zoom',
      movementDescription: 'Punch in',
    },
  ];
  const split = splitShotAfterPanel(scene, shot.id, middle.id);
  const newShot = split.shots[1];
  assert.equal(getShotConnection(split, shot.id, newShot.id).description, '');
  assert.equal(getShotConnection(split, shot.id, newShot.id).movement, 'pan');
  assert.equal(
    getShotConnection(split, shot.id, newShot.id).movementDescription,
    'Reveal',
  );
  assert.equal(
    getShotConnection(split, newShot.id, following.id).description,
    'Old exit',
  );
  assert.equal(
    getShotConnection(split, newShot.id, following.id).movement,
    'zoom',
  );
  assert.deepEqual(
    split.shots[0].panelConnections?.map(({ type }) => type),
    ['dolly'],
  );
  assert.deepEqual(newShot.panelConnections, []);
});
