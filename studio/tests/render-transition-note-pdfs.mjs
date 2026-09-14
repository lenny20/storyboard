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

const [cloudFrame, islandFrame] = await Promise.all([
  imageDataUrl(new URL('./fixtures/review-frame-1.png', import.meta.url)),
  imageDataUrl(new URL('./fixtures/review-frame-2.png', import.meta.url)),
]);

const sample = project('Transition cue review');
sample.scenes[0].shots = [
  {
    ...shot('cloud-shot', 'The cloud closes in'),
    panels: [
      {
        ...panel(
          'cloud-panel',
          'Cloud cover',
          cloudFrame,
          'The cloud bank closes across the lens until the frame is white.',
        ),
        camera: 'Hold the flight path and let the cloud reach camera.',
        dialogue: '',
        context: '',
        notes: '',
        transition: 'cut',
      },
    ],
  },
  {
    ...shot('island-shot', 'The island appears'),
    panels: [
      {
        ...panel(
          'island-panel',
          'Clear horizon',
          islandFrame,
          'The island resolves against a clean horizon after the cut.',
        ),
        camera: 'Resume the same forward flight path.',
        dialogue: 'MATILDA\nThere it is.',
        context: '',
        notes: '',
        transition: 'cut',
      },
    ],
  },
];
// The cue now lives on the shot connection and prints as a rail label.
sample.scenes[0].shotConnections = [
  {
    fromId: 'cloud-shot',
    toId: 'island-shot',
    type: 'cut',
    description: 'Cut when the cloud fully obscures the frame.',
    movement: 'static',
    movementDescription: '',
  },
];

const stress = project('Long transition cue pagination review');
stress.scenes[0].shots = [
  {
    ...shot('stress-shot', 'Unboarded outgoing cut'),
    panels: [
      {
        ...panel(
          'stress-panel',
          'Final boarded frame',
          cloudFrame,
          'The last supplied frame holds while the outgoing cue remains fully documented.',
        ),
        camera: '',
        dialogue: '',
        context: '',
        notes: '',
        transition: 'cut',
      },
    ],
  },
  {
    ...shot('stress-next', 'The reveal'),
    panels: [
      {
        ...panel(
          'stress-next-panel',
          'Revealed frame',
          islandFrame,
          'The next shot begins once the cloud has fully closed.',
        ),
        camera: '',
        dialogue: '',
        context: '',
        notes: '',
        transition: 'cut',
      },
    ],
  },
];
// A deliberately long rail description, to check that it wraps and never truncates.
stress.scenes[0].shotConnections = [
  {
    fromId: 'stress-shot',
    toId: 'stress-next',
    type: 'dissolve',
    description: Array.from(
      { length: 150 },
      (_, index) =>
        `CUE-${String(index + 1).padStart(3, '0')} wait until cloud cover is complete before revealing the next image.`,
    ).join(' '),
    movement: 'static',
    movementDescription: '',
  },
];

const outputDirectory = new URL('../../output/pdf/', import.meta.url);
await mkdir(outputDirectory, { recursive: true });
for (const [name, value] of [
  ['storyboard-transition-cue-sample.pdf', sample],
  ['storyboard-transition-cue-stress.pdf', stress],
]) {
  const output = new URL(name, outputDirectory);
  const bytes = await createStoryboardPdf(value);
  await writeFile(output, bytes);
  console.log(`${fileURLToPath(output)} ${bytes.length} bytes`);
}

function project(name) {
  return {
    schemaVersion: 1,
    id: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    aspectRatio: 2.39,
    style: 'Restrained cinematic pencil and tonal blocking',
    styleNotes: '',
    scenes: [{ id: 'scene', title: 'Island approach', shots: [] }],
    references: [],
    createdAt: '2026-09-10T00:00:00.000Z',
    updatedAt: '2026-09-10T00:00:00.000Z',
  };
}

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
