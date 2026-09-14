import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { createStoryboardPdf } from '../lib/pdf/export.ts';

const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url =
    input instanceof URL
      ? input
      : new URL(typeof input === 'string' ? input : input.url);
  if (url.protocol === 'file:')
    return new Response(await readFile(fileURLToPath(url)), { status: 200 });
  return nativeFetch(input, init);
};

const [wideFrame, closeFrame] = await Promise.all([
  imageDataUrl(new URL('./fixtures/review-frame-1.png', import.meta.url)),
  imageDataUrl(new URL('./fixtures/review-frame-2.png', import.meta.url)),
]);

const project = {
  schemaVersion: 1,
  id: 'panel-direction-review',
  name: 'The Island Beyond the Rain',
  aspectRatio: 2.39,
  style: 'Restrained cinematic pencil and tonal blocking',
  styleNotes: '',
  references: [],
  createdAt: '2026-09-10T00:00:00.000Z',
  updatedAt: '2026-09-10T00:00:00.000Z',
  scenes: [
    {
      id: 'scene-1',
      title: 'Island approach',
      shots: [
        {
          ...shot('shot-1', 'Matilda finds the island'),
          panels: [
            {
              ...panel(
                'panel-1a',
                'Cloud break',
                wideFrame,
                'A small island holds the centre of a vast ocean.\nCloud banks drift right to left across the foreground.',
              ),
              camera: 'Glide forward through the thinning cloud layer.',
              dialogue: 'MATILDA\nThere—beyond the rain…',
              context: 'Generation-only detail that must not appear in print.',
              notes: 'Protect the clean horizon line.',
              transition: 'continue',
            },
            {
              ...panel(
                'panel-1b',
                'Recognition',
                closeFrame,
                'Matilda catches sight of the island and smiles.\nHer attention shifts from the chart to the horizon.',
              ),
              camera: 'Dolly toward Matilda without changing the lens.',
              dialogue: 'MATILDA\nI knew it was here.',
              context: 'Private prompt direction omitted from the PDF.',
              notes: 'Keep her eyeline just above camera.',
              transition: 'dissolve',
              markers: [
                {
                  id: 'eyes',
                  label: 'Hold Matilda on the left third',
                  x: 0.32,
                  y: 0.42,
                  scale: 1,
                },
              ],
              arrows: [
                {
                  id: 'dolly',
                  kind: 'camera',
                  x1: 0.14,
                  y1: 0.72,
                  x2: 0.8,
                  y2: 0.34,
                  label: 'Dolly forward without changing the lens',
                },
              ],
            },
          ],
        },
        {
          ...shot('shot-2', 'Crossing the reef'),
          panels: [
            {
              ...panel(
                'panel-2a',
                'Reef passage',
                wideFrame,
                `The boat crosses the pale reef while the island grows behind it.\n${Array.from(
                  { length: 12 },
                  (_, index) =>
                    `ACTION-${String(index + 1).padStart(2, '0')} spray crosses the bow in a separate beat.`,
                ).join(' ')}`,
              ),
              camera: Array.from(
                { length: 14 },
                (_, index) =>
                  `CAMERA-${String(index + 1).padStart(2, '0')} maintain the low tracking line and stable horizon.`,
              ).join(' '),
              dialogue: Array.from(
                { length: 34 },
                (_, index) =>
                  `MATILDA-${String(index + 1).padStart(2, '0')}: Keep the inlet on our port side.`,
              ).join('\n'),
              context: 'Never printed generation context.',
              notes: 'The long direction intentionally validates page continuation labels.',
              transition: 'match-cut',
            },
          ],
        },
      ],
    },
    {
      id: 'scene-2',
      title: 'Inside the cove',
      shots: [
        {
          ...shot('shot-3', 'Landfall'),
          panels: [
            {
              ...panel(
                'panel-3a',
                'Quiet water',
                closeFrame,
                'The boat settles into still water beneath the cliffs.\nThe final ripple disappears.',
              ),
              camera: 'Lock off as the wake reaches the foreground rocks.',
              dialogue: '',
              context: '',
              notes: '',
              transition: 'fade',
            },
          ],
        },
      ],
    },
  ],
};

const output = new URL(
  '../../output/pdf/storyboard-panel-details-review.pdf',
  import.meta.url,
);
await mkdir(new URL('../../output/pdf/', import.meta.url), { recursive: true });
const bytes = await createStoryboardPdf(project, { includeNotes: true });
await writeFile(output, bytes);
console.log(`${fileURLToPath(output)} ${bytes.length} bytes`);

function shot(id, title) {
  return {
    id,
    title,
    description: '',
    dialogue: '',
    action: '',
    camera: '',
    transition: 'cut',
    notes: '',
    referenceIds: [],
    referenceGroupIds: [],
    panels: [],
  };
}

function panel(id, title, dataUrl, description) {
  return {
    id,
    title,
    framing: 'Wide',
    angle: 'Eye level',
    description,
    referenceIds: [],
    referenceGroupIds: [],
    versions: [
      {
        id: `${id}-image`,
        dataUrl,
        createdAt: '2026-09-10T00:00:00.000Z',
        label: 'Selected review frame',
      },
    ],
    selectedVersionId: `${id}-image`,
    markers: [],
    arrows: [],
  };
}

async function imageDataUrl(url) {
  return `data:image/png;base64,${(await readFile(url)).toString('base64')}`;
}
