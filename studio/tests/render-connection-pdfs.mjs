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

const wide = await imageDataUrl(
  new URL(
    '../.local-data/openai-results/d1d004c9-61e6-4a65-b5c8-eb2a2046ee6e.png',
    import.meta.url,
  ),
);
const close = await imageDataUrl(
  new URL(
    '../.local-data/openai-results/2804ae7a-3e1e-4282-8df3-bdfaf44bdd3b.png',
    import.meta.url,
  ),
);
const project = {
  schemaVersion: 1,
  id: 'connection-review',
  name: 'Frame connection direction review',
  aspectRatio: 2.39,
  style: 'Cinematic concept art',
  styleNotes: '',
  scenes: [
    {
      id: 'scene',
      title: 'Island approach',
      shotConnections: [
        {
          fromId: 'arrival',
          toId: 'recognition',
          type: 'match-cut',
          description:
            'Match the island silhouette to the shape in Matilda’s eye.',
          movement: 'dolly',
          movementDescription: 'Carry the forward push across the edit.',
        },
      ],
      shots: [
        makeShot('arrival', 'Island revealed', [
          makePanel('arrival-a', 'Distant island', wide),
        ]),
        makeShot('recognition', 'Recognition', [
          makePanel('recognition-a', 'Closer island', close),
        ]),
        {
          ...makeShot('move', 'Continuous approach', [
            makePanel('move-a', 'Frame 1', wide),
            makePanel('move-b', 'Frame 2', close),
          ]),
          panelConnections: [
            {
              fromId: 'move-a',
              toId: 'move-b',
              type: 'dolly',
              description:
                'Push toward the island while keeping the horizon level.',
            },
          ],
        },
        makeShot('long-destination', 'Long cue destination', [
          makePanel('long-a', 'Arrival frame', wide),
        ]),
      ],
    },
  ],
  references: [],
  createdAt: '2026-09-10T00:00:00.000Z',
  updatedAt: '2026-09-10T00:00:00.000Z',
};
project.scenes[0].shotConnections.push({
  fromId: 'move',
  toId: 'long-destination',
  type: 'dissolve',
  description: Array.from(
    { length: 95 },
    (_, index) => `LONG-CUE-${String(index + 1).padStart(3, '0')}`,
  ).join(' '),
  movement: 'static',
  movementDescription: '',
});

const output = new URL(
  '../../output/pdf/storyboard-connections-review.pdf',
  import.meta.url,
);
await mkdir(new URL('../../output/pdf/', import.meta.url), { recursive: true });
const bytes = await createStoryboardPdf(project);
await writeFile(output, bytes);
console.log(`${fileURLToPath(output)} ${bytes.length} bytes`);

function makeShot(id, title, panels) {
  return {
    id,
    title,
    description: '',
    dialogue: '',
    action: '',
    camera: '',
    notes: '',
    referenceIds: [],
    panels,
  };
}

function makePanel(id, title, dataUrl) {
  return {
    id,
    title,
    framing: 'Wide',
    angle: 'Eye level',
    description: 'Review frame for directional connection layout.',
    versions: [
      {
        id: `${id}-version`,
        dataUrl,
        label: 'Selected review frame',
        createdAt: '2026-09-10T00:00:00.000Z',
      },
    ],
    selectedVersionId: `${id}-version`,
    markers: [],
    arrows: [],
  };
}

async function imageDataUrl(url) {
  // Generated artwork under `.local-data` is not kept in the repository. Fall
  // back to a bundled fixture so this review script always renders something.
  const bytes = await readFile(url).catch(() =>
    readFile(new URL('./fixtures/review-frame-1.png', import.meta.url)),
  );
  return `data:image/png;base64,${bytes.toString('base64')}`;
}
