import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_PDF_IMAGE_DPI,
  DEFAULT_PDF_JPEG_QUALITY,
  encodePdfImageForFrames,
  encodePdfImageForPlacement,
} from '../lib/pdf/image-encoding';

void test('small native JPEG artwork keeps its exact source encoding without canvas', async () => {
  const bytes = jpegHeader(640, 360);
  const before = new Uint8Array(bytes);
  const result = await encodePdfImageForPlacement(
    { bytes, mime: 'image/jpeg' },
    { widthPoints: 360, heightPoints: 203 },
  );

  assert.equal(DEFAULT_PDF_IMAGE_DPI, 200);
  assert.equal(result.mime, 'image/jpeg');
  assert.equal(result.reencoded, false);
  assert.deepEqual(
    { width: result.width, height: result.height },
    { width: 640, height: 360 },
  );
  assert.deepEqual(result.bytes, bytes);
  assert.notEqual(result.bytes, bytes);
  assert.deepEqual(bytes, before, 'source bytes remain untouched');
});

void test('large artwork downsamples to its 200 DPI placement and flattens before JPEG encoding', async () => {
  const calls: unknown[][] = [];
  await withRasterizer({ width: 4000, height: 2000 }, calls, async () => {
    const bytes = pngHeader(4000, 2000);
    const before = new Uint8Array(bytes);
    const result = await encodePdfImageForPlacement(
      { bytes, mime: 'image/png' },
      { widthPoints: 360, heightPoints: 180 },
    );

    assert.equal(result.mime, 'image/jpeg');
    assert.equal(result.reencoded, true);
    assert.deepEqual(
      { width: result.width, height: result.height },
      { width: 1000, height: 500 },
    );
    assert.deepEqual(result.bytes, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
    assert.deepEqual(bytes, before, 'temporary PDF encoding is non-mutating');
  });
  assert.deepEqual(calls, [
    ['decode'],
    ['canvas', 1000, 500],
    ['fillStyle', '#f8f7f3'],
    ['fillRect', 0, 0, 1000, 500],
    ['drawImage', 0, 0, 1000, 500],
    ['encode', 'image/jpeg', DEFAULT_PDF_JPEG_QUALITY],
    ['close'],
  ]);
});

void test('shared frame uses include zoomed crops and decode the source only once', async () => {
  const calls: unknown[][] = [];
  await withRasterizer({ width: 4000, height: 2000 }, calls, async () => {
    const result = await encodePdfImageForFrames(
      { bytes: pngHeader(4000, 2000), mime: 'image/png' },
      {
        uses: [
          { widthPoints: 360, heightPoints: 180 },
          {
            widthPoints: 180,
            heightPoints: 180,
            transform: {
              fit: 'cover',
              scale: 2,
              offsetX: 0,
              offsetY: 0,
              flipX: false,
              flipY: false,
            },
          },
        ],
      },
    );
    assert.deepEqual(
      { width: result.width, height: result.height },
      { width: 2000, height: 1000 },
    );
  });
  assert.equal(calls.filter(([name]) => name === 'decode').length, 1);
  assert.deepEqual(calls[1], ['canvas', 2000, 1000]);
});

void test('large compressed files are optimized even when their pixel dimensions are already adequate', async () => {
  const calls: unknown[][] = [];
  await withRasterizer({ width: 640, height: 360 }, calls, async () => {
    const source = new Uint8Array(800_000);
    source.set(pngHeader(640, 360));
    const result = await encodePdfImageForFrames(
      { bytes: source, mime: 'image/png' },
      { uses: [{ widthPoints: 360, heightPoints: 203 }] },
    );
    assert.equal(result.reencoded, true);
    assert.deepEqual(
      { width: result.width, height: result.height },
      { width: 640, height: 360 },
    );
  });
  assert.equal(calls.filter(([name]) => name === 'decode').length, 1);
});

void test('valid native artwork is retained when optional raster optimization fails', async () => {
  for (const failure of ['decode', 'encode'] as const) {
    const calls: unknown[][] = [];
    await withRasterizer(
      { width: 4000, height: 2000 },
      calls,
      async () => {
        const bytes = pngHeader(4000, 2000);
        const before = new Uint8Array(bytes);
        const result = await encodePdfImageForPlacement(
          { bytes, mime: 'image/png' },
          { widthPoints: 72, heightPoints: 36 },
        );

        assert.equal(result.reencoded, false);
        assert.equal(result.mime, 'image/png');
        assert.deepEqual(
          { width: result.width, height: result.height },
          { width: 4000, height: 2000 },
        );
        assert.match(
          result.fallbackReason ?? '',
          new RegExp(
            `raster optimization failed.*Synthetic ${failure} failure`,
          ),
        );
        assert.deepEqual(result.bytes, before);
        assert.notStrictEqual(result.bytes, bytes);
      },
      failure,
    );
  }
});

void test('Node QA falls back to original native bytes when raster APIs are unavailable', async () => {
  const bytes = pngHeader(4000, 2000);
  const result = await encodePdfImageForPlacement(
    { bytes, mime: 'image/png' },
    { widthPoints: 72, heightPoints: 36 },
  );
  assert.equal(result.reencoded, false);
  assert.equal(result.mime, 'image/png');
  assert.match(result.fallbackReason ?? '', /raster APIs unavailable/);
  assert.deepEqual(result.bytes, bytes);
});

void test('invalid inputs and unsupported Node conversions fail with actionable errors', async () => {
  await assert.rejects(
    encodePdfImageForPlacement(
      { bytes: new Uint8Array(), mime: 'image/png' },
      { widthPoints: 100, heightPoints: 50 },
    ),
    /source bytes must not be empty/,
  );
  await assert.rejects(
    encodePdfImageForPlacement(
      { bytes: new Uint8Array([1]), mime: 'image/webp' },
      { widthPoints: 100, heightPoints: 50 },
    ),
    /requires browser image decoding and canvas support/,
  );
  await assert.rejects(
    encodePdfImageForPlacement(
      { bytes: pngHeader(10, 10), mime: 'image/png' },
      { widthPoints: 0, heightPoints: 50 },
    ),
    /target width must be a positive finite number/,
  );
  await assert.rejects(
    encodePdfImageForFrames(
      { bytes: pngHeader(10, 10), mime: 'image/png' },
      { uses: [] },
    ),
    /frame uses must not be empty/,
  );
});

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function jpegHeader(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03,
    0x01,
    0x11,
    0x00,
    0x02,
    0x11,
    0x00,
    0x03,
    0x11,
    0x00,
    0xff,
    0xd9,
  ]);
}

async function withRasterizer(
  bitmapSize: { width: number; height: number },
  calls: unknown[][],
  run: () => Promise<void>,
  failure?: 'decode' | 'encode',
): Promise<void> {
  const originalBitmap = globalThis.createImageBitmap;
  const OriginalCanvas = globalThis.OffscreenCanvas;
  const bitmap = {
    ...bitmapSize,
    close: () => calls.push(['close']),
  } as ImageBitmap;
  const context = {
    set fillStyle(value: string | CanvasGradient | CanvasPattern) {
      calls.push(['fillStyle', value]);
    },
    fillRect: (...values: number[]) => calls.push(['fillRect', ...values]),
    drawImage: (_image: ImageBitmap, ...values: number[]) =>
      calls.push(['drawImage', ...values]),
  };
  class MockCanvas {
    constructor(width: number, height: number) {
      calls.push(['canvas', width, height]);
    }
    getContext() {
      return context;
    }
    convertToBlob(options: { type: string; quality?: number }) {
      calls.push(['encode', options.type, options.quality]);
      if (failure === 'encode')
        return Promise.reject(new Error('Synthetic encode failure'));
      return Promise.resolve(
        new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], {
          type: 'image/jpeg',
        }),
      );
    }
  }
  Object.defineProperty(globalThis, 'createImageBitmap', {
    configurable: true,
    value: async () => {
      calls.push(['decode']);
      if (failure === 'decode') throw new Error('Synthetic decode failure');
      return bitmap;
    },
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
