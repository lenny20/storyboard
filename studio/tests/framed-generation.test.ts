import assert from 'node:assert/strict';
import test from 'node:test';
import { strFromU8, unzipSync } from 'fflate';

import { createPanel, createProject } from '../lib/storyboard/model';
import { createGenerationPack } from '../lib/storyboard/generation-pack';
import { renderImageFrame } from '../lib/storyboard/render-image-frame';

const original = 'data:image/jpeg;base64,T1JJR0lOQUw=';
const framed = 'data:image/png;base64,RlJBTUVE';

void test('an untransformed image keeps exact original bytes without using canvas', async () => {
  assert.equal(await renderImageFrame(original, 2.39), original);
});

void test('framed copies use shared crop, offset, scale, and flip geometry', async () => {
  const calls: unknown[][] = [];
  await withMockCanvas(calls, async () => {
    const result = await renderImageFrame(original, 1, {
      fit: 'cover',
      scale: 1.5,
      offsetX: 0.25,
      offsetY: -0.1,
      flipX: true,
      flipY: false,
    });
    assert.equal(result, framed);
  });
  assert.deepEqual(calls, [
    ['fillRect', 0, 0, 1200, 1200],
    ['translate', 3060, -420],
    ['scale', -1, 1],
    ['drawImage', 0, 0, 4320, 1800],
  ]);
});

void test('manual packs contain framed PNG copies while project originals stay untouched', async () => {
  const calls: unknown[][] = [];
  await withMockCanvas(calls, async () => {
    const project = createProject('Framed pack');
    project.aspectRatio = 1;
    const shot = project.scenes[0].shots[0];
    const source = shot.panels[0];
    source.versions = [{
      id: 'source-version',
      label: 'Previous JPEG',
      dataUrl: original,
      createdAt: project.createdAt,
      transform: { fit: 'cover', scale: 1, offsetX: 0, offsetY: 0, flipX: true, flipY: false },
    }];
    source.selectedVersionId = 'source-version';
    const target = createPanel('Target');
    target.previousPanelReferences = [{ panelId: source.id, imageVersionId: 'source-version' }];
    target.versions = [{
      id: 'target-version',
      label: 'Current JPEG',
      dataUrl: original,
      createdAt: project.createdAt,
      transform: { fit: 'contain', scale: 1, offsetX: 0.1, offsetY: 0, flipX: false, flipY: false },
    }];
    target.selectedVersionId = 'target-version';
    shot.panels.push(target);

    const before = structuredClone(project);
    const pack = await createGenerationPack(project, project.scenes[0], shot, target, {
      includeSelectedImage: true,
    });
    const files = unzipSync(new Uint8Array(await pack.blob.arrayBuffer()));
    const imagePaths = pack.files.map((file) => file.path);
    assert.equal(imagePaths.length, 2);
    assert.ok(imagePaths.every((path) => path.endsWith('.png')));
    for (const path of imagePaths) assert.equal(strFromU8(files[path]), 'FRAMED');
    assert.deepEqual(project, before, 'temporary rendering never changes source image bytes or transforms');
  });
  assert.equal(calls.filter(([name]) => name === 'drawImage').length, 2);
});

async function withMockCanvas(calls: unknown[][], run: () => Promise<void>) {
  const originalDocument = globalThis.document;
  const OriginalImage = globalThis.Image;
  const context = {
    fillStyle: '',
    fillRect: (...args: unknown[]) => calls.push(['fillRect', ...args]),
    translate: (...args: unknown[]) => calls.push(['translate', ...args]),
    scale: (...args: unknown[]) => calls.push(['scale', ...args]),
    drawImage: (_image: unknown, ...args: unknown[]) => calls.push(['drawImage', ...args]),
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context,
    toDataURL: () => framed,
  };
  class MockImage {
    naturalWidth = 1200;
    naturalHeight = 500;
    onload?: () => void;
    onerror?: () => void;
    set src(value: string) { if (value) queueMicrotask(() => this.onload?.()); }
  }
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => canvas } });
  Object.defineProperty(globalThis, 'Image', { configurable: true, value: MockImage });
  try { await run(); }
  finally {
    Object.defineProperty(globalThis, 'document', { configurable: true, value: originalDocument });
    Object.defineProperty(globalThis, 'Image', { configurable: true, value: OriginalImage });
  }
}
