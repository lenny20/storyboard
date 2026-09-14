import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { embedSelectedArtwork } from '../lib/pdf/artwork';
import { createPanel, createProject } from '../lib/storyboard/model';

void test('embeds repeated selected artwork once while retaining each panel transform and original', async () => {
  const project = createProject('Repeated artwork');
  const shot = project.scenes[0].shots[0];
  const first = shot.panels[0];
  const second = createPanel('Different framing');
  second.pdfFullWidth = true;
  shot.panels.push(second);
  const bytes = await readFile(
    new URL('./fixtures/review-frame-1.png', import.meta.url),
  );
  const source = `data:image/png;base64,${bytes.toString('base64')}`;
  const transform = {
    fit: 'cover' as const,
    scale: 1.8,
    offsetX: 0.1,
    offsetY: -0.2,
    flipX: true,
    flipY: false,
  };
  first.versions = [
    {
      id: 'first',
      label: 'Original',
      dataUrl: source,
      createdAt: project.createdAt,
    },
    {
      id: 'unused',
      label: 'Unused bad version',
      dataUrl: 'not an image',
      createdAt: project.createdAt,
    },
  ];
  first.selectedVersionId = 'first';
  second.versions = [
    {
      id: 'second',
      label: 'Closer',
      dataUrl: source,
      createdAt: project.createdAt,
      transform,
    },
  ];
  second.selectedVersionId = 'second';
  const before = structuredClone(project);
  const document = await PDFDocument.create();
  const artwork = await embedSelectedArtwork(
    document,
    project.scenes,
    project.aspectRatio,
    { contentWidth: 503.28, columns: 2, columnGap: 86, landscape: false },
  );
  const left = artwork.get(first.id)!;
  const right = artwork.get(second.id)!;
  assert.equal(artwork.size, 2);
  assert.strictEqual(
    left.image,
    right.image,
    'the same encoded image is shared across selected panels',
  );
  assert.equal(left.transform, undefined);
  assert.deepEqual(right.transform, transform);
  assert.equal(right.label, 'Closer');
  const page = document.addPage();
  page.drawImage(left.image, { x: 0, y: 0, width: 100, height: 40 });
  page.drawImage(right.image, { x: 0, y: 50, width: 200, height: 80 });
  const saved = await PDFDocument.load(await document.save());
  const images = saved.context
    .enumerateIndirectObjects()
    .filter(
      ([, value]) =>
        value instanceof PDFRawStream &&
        value.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'),
    );
  assert.equal(
    images.length,
    1,
    'the exported file contains one image stream rather than duplicated artwork',
  );
  assert.deepEqual(
    project,
    before,
    'export does not alter originals, selections, transforms, or unused versions',
  );
});

void test('reports the affected panel when selected artwork is unreadable', async () => {
  const project = createProject();
  const panel = project.scenes[0].shots[0].panels[0];
  panel.title = 'The lighthouse';
  panel.versions = [
    {
      id: 'broken',
      label: 'Damaged scan',
      dataUrl: 'data:image/png;base64,AQ==',
      createdAt: project.createdAt,
    },
  ];
  panel.selectedVersionId = 'broken';
  await assert.rejects(
    embedSelectedArtwork(await PDFDocument.create(), project.scenes, 2.39, {
      contentWidth: 503.28,
      columns: 2,
      columnGap: 86,
      landscape: false,
    }),
    /Damaged scan.*The lighthouse.*could not be read/,
  );
});

void test('requests enough raster detail for single-panel pair layouts and full-width frames', async () => {
  const bytes = await readFile(
    new URL('./fixtures/review-frame-1.png', import.meta.url),
  );
  const source = `data:image/png;base64,${bytes.toString('base64')}`;
  const canvasSizes: Array<[number, number]> = [];

  await withArtworkRasterizer(bytes, canvasSizes, async () => {
    const cases = [
      {
        aspectRatio: 0.8,
        geometry: {
          contentWidth: 503.28,
          columns: 2,
          columnGap: 86,
          landscape: false,
        },
      },
      {
        aspectRatio: 4,
        geometry: {
          contentWidth: 757.89,
          columns: 3,
          columnGap: 48,
          landscape: true,
        },
        transform: {
          fit: 'cover' as const,
          scale: 1,
          offsetX: 0,
          offsetY: 0,
          flipX: false,
          flipY: false,
        },
      },
      {
        aspectRatio: 0.8,
        geometry: {
          contentWidth: 503.28,
          columns: 2,
          columnGap: 86,
          landscape: false,
        },
        pdfFullWidth: true,
      },
      {
        aspectRatio: 0.8,
        geometry: {
          contentWidth: 503.28,
          columns: 2,
          columnGap: 86,
          landscape: false,
        },
        multiPanel: true,
      },
    ];

    for (const example of cases) {
      const project = createProject('Frame estimate');
      const shot = project.scenes[0].shots[0];
      const panel = shot.panels[0];
      panel.pdfFullWidth = example.pdfFullWidth;
      panel.versions = [
        {
          id: 'selected',
          label: 'Selected',
          dataUrl: source,
          createdAt: project.createdAt,
          transform: example.transform,
        },
      ];
      panel.selectedVersionId = 'selected';
      if (example.multiPanel) shot.panels.push(createPanel('Second drawing'));

      const artwork = await embedSelectedArtwork(
        await PDFDocument.create(),
        project.scenes,
        example.aspectRatio,
        example.geometry,
      );
      assert.equal(artwork.size, 1);
    }
  });

  assert.deepEqual(canvasSizes, [
    [529, 221],
    [889, 372],
    [649, 272],
    [423, 177],
  ]);
});

async function withArtworkRasterizer(
  bytes: Uint8Array,
  canvasSizes: Array<[number, number]>,
  run: () => Promise<void>,
): Promise<void> {
  const originalBitmap = globalThis.createImageBitmap;
  const OriginalCanvas = globalThis.OffscreenCanvas;
  const bitmap = {
    width: 1195,
    height: 500,
    close: () => undefined,
  } as ImageBitmap;
  const context = {
    set fillStyle(_value: string | CanvasGradient | CanvasPattern) {},
    fillRect: () => undefined,
    drawImage: () => undefined,
  };
  class MockCanvas {
    constructor(width: number, height: number) {
      canvasSizes.push([width, height]);
    }
    getContext() {
      return context;
    }
    convertToBlob() {
      return Promise.resolve(
        new Blob([Uint8Array.from(bytes)], { type: 'image/png' }),
      );
    }
  }
  Object.defineProperty(globalThis, 'createImageBitmap', {
    configurable: true,
    value: async () => bitmap,
  });
  Object.defineProperty(globalThis, 'OffscreenCanvas', {
    configurable: true,
    value: MockCanvas,
  });
  try {
    await run();
  } finally {
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: originalBitmap,
    });
    Object.defineProperty(globalThis, 'OffscreenCanvas', {
      configurable: true,
      value: OriginalCanvas,
    });
  }
}
