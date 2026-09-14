import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_IMAGE_TRANSFORM,
  cloneShot,
  createProject,
  validateProject,
  type ImageVersion,
} from '../lib/storyboard/model';
import {
  getImagePlacement,
  getFrameViewport,
  resolveImageTransform,
} from '../lib/storyboard/image-transform';

const image: ImageVersion = {
  id: 'image-version',
  dataUrl: 'data:image/png;base64,AQ==',
  createdAt: '2026-09-12T00:00:00.000Z',
  label: 'Frame',
};

void test('a thumbnail preserves the cinematic crop inside a differently shaped container', () => {
  const thumb = getFrameViewport(72, 46, 2.4);
  assert.deepEqual(thumb, { x: 0, y: 8, width: 72, height: 30 });
  const transform = {
    ...DEFAULT_IMAGE_TRANSFORM,
    fit: 'cover' as const,
    scale: 1.5,
    offsetX: 0.2,
    flipX: true,
  };
  const large = getImagePlacement(1200, 900, 720, 300, transform);
  const small = getImagePlacement(
    1200,
    900,
    thumb.width,
    thumb.height,
    transform,
  );
  for (const key of ['x', 'y', 'width', 'height'] as const)
    assert.ok(Math.abs(small[key] * 10 - large[key]) < 1e-9);
  assert.equal(small.flipX, large.flipX);
});

void test('image placement applies contain and cover before scale and frame-relative offsets', () => {
  assert.deepEqual(getImagePlacement(400, 200, 300, 300), {
    x: 0,
    y: 75,
    width: 300,
    height: 150,
    flipX: false,
    flipY: false,
  });

  assert.deepEqual(
    getImagePlacement(400, 200, 300, 300, {
      fit: 'cover',
      scale: 2,
      offsetX: 0.1,
      offsetY: -0.2,
      flipX: true,
      flipY: false,
    }),
    {
      x: -420,
      y: -210,
      width: 1200,
      height: 600,
      flipX: true,
      flipY: false,
    },
  );
});

void test('legacy images resolve to defaults and framing validates without changing artwork', () => {
  assert.deepEqual(
    resolveImageTransform(image.transform),
    DEFAULT_IMAGE_TRANSFORM,
  );
  const project = createProject('Framing');
  const panel = project.scenes[0].shots[0].panels[0];
  panel.versions = [
    {
      ...image,
      transform: {
        fit: 'cover',
        scale: 1.75,
        offsetX: -0.25,
        offsetY: 0.5,
        flipX: true,
        flipY: false,
      },
    },
  ];
  panel.selectedVersionId = image.id;

  const loaded = validateProject(structuredClone(project));
  assert.deepEqual(
    loaded.scenes[0].shots[0].panels[0].versions[0],
    panel.versions[0],
  );
  assert.equal(
    loaded.scenes[0].shots[0].panels[0].versions[0].dataUrl,
    image.dataUrl,
  );

  const malformed = structuredClone(project);
  malformed.scenes[0].shots[0].panels[0].versions[0].transform!.scale = 4.01;
  assert.throws(
    () => validateProject(malformed),
    /transform\.scale.*between 0\.1 and 4/,
  );
});

void test('cloned shots preserve framing values without sharing mutable transforms', () => {
  const project = createProject('Clone framing');
  const shot = project.scenes[0].shots[0];
  shot.panels[0].versions = [
    {
      ...image,
      transform: { ...DEFAULT_IMAGE_TRANSFORM, offsetX: 0.4, flipY: true },
    },
  ];
  shot.panels[0].selectedVersionId = image.id;

  const cloned = cloneShot(shot);
  assert.deepEqual(
    cloned.panels[0].versions[0].transform,
    shot.panels[0].versions[0].transform,
  );
  assert.notEqual(
    cloned.panels[0].versions[0].transform,
    shot.panels[0].versions[0].transform,
  );
});
