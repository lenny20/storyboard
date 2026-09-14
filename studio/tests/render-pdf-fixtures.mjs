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

const frame1 = await imageDataUrl(
  new URL('./fixtures/review-frame-1.png', import.meta.url),
);
const frame2 = await imageDataUrl(
  new URL('./fixtures/review-frame-2.png', import.meta.url),
);
const islandWide = await imageDataUrl(
  new URL(
    '../.local-data/openai-results/d1d004c9-61e6-4a65-b5c8-eb2a2046ee6e.png',
    import.meta.url,
  ),
);
const islandCloser = await imageDataUrl(
  new URL(
    '../.local-data/openai-results/2804ae7a-3e1e-4282-8df3-bdfaf44bdd3b.png',
    import.meta.url,
  ),
);
const outputDirectory = new URL('../../output/pdf/', import.meta.url);
await mkdir(outputDirectory, { recursive: true });

const realistic = baseProject('Teaser — The Island Beyond the Rain…', 2.39);
realistic.scenes = [
  {
    id: 'scene-1',
    title: 'Island approach',
    shots: [
      {
        ...shot('shot-1', 'Island reveal'),
        description:
          'Aerial of a small island in a vast ocean, flying through wispy clouds.',
        camera:
          'Fly forward through the cloud layer, keeping the horizon stable.',
        action: 'Wispy clouds drift right to left across the foreground.',
        panels: [
          panel(
            'panel-1',
            'Island',
            frame1,
            'A small island holds the centre of a vast ocean.',
          ),
        ],
      },
      {
        ...shot('shot-2', 'Matilda sees the island'),
        description:
          'One continuous shot from a medium composition into a close-up.',
        camera: 'Dolly forward toward Matilda. Do not substitute a zoom.',
        action: 'Matilda notices the island and smiles.',
        dialogue: 'MATILDA\nWait—there it is… I can see it now.',
        panels: [
          panel(
            'panel-2a',
            'Start',
            frame1,
            'Medium on Matilda, centred in frame.',
          ),
          {
            ...panel(
              'panel-2b',
              'End',
              frame2,
              'Close-up on Matilda, still centred, smiling.',
            ),
            markers: [
              {
                id: 'marker-face',
                label: 'Keep Matilda centred throughout the move',
                x: 0.5,
                y: 0.48,
                scale: 1,
              },
            ],
            arrows: [
              {
                id: 'camera',
                kind: 'camera',
                x1: 0.15,
                y1: 0.72,
                x2: 0.78,
                y2: 0.32,
                label: 'Dolly forward toward Matilda without changing the lens',
              },
              {
                id: 'action',
                kind: 'action',
                x1: 0.18,
                y1: 0.22,
                x2: 0.84,
                y2: 0.22,
                label: 'Her smile develops during the move',
              },
            ],
          },
        ],
      },
    ],
  },
];

const stress = baseProject(
  'A Very Long Storyboard Project Title That Must Remain Completely Visible in the Printed Document',
  1.33,
);
stress.scenes = [
  { id: 'empty', title: 'Unused empty scene', shots: [] },
  {
    id: 'scene-4',
    title:
      'Rain clears as the camera crosses the shoreline and discovers the distant mountain range',
    shots: [
      {
        ...shot(
          'stress-shot',
          'A continuous multi-panel move designed to cross several pages without losing its written direction',
        ),
        description:
          'Keep the geography exact: ocean, shoreline, settlement, then mountain range. The move remains continuous.',
        camera:
          'Track inland at constant height, then tilt up only after the settlement passes beneath frame.',
        action:
          'Rain trails clear from the lens while birds cross in the opposite direction.',
        notes: 'Maintain screen direction and do not invent coverage.',
        dialogue: Array.from(
          { length: 80 },
          (_, index) =>
            `DIALOGUE-${String(index + 1).padStart(3, '0')} ÉLODIE: The next landmark is directly ahead of us.`,
        ).join('\n'),
        panels: Array.from({ length: 12 }, (_, index) => ({
          ...panel(
            `stress-panel-${index}`,
            `Geographic beat ${index + 1}`,
            index % 3 === 0 ? frame1 : null,
            index === 2
              ? Array.from(
                  { length: 36 },
                  (_, line) =>
                    `CAPTION-${String(line + 1).padStart(2, '0')} The relationship between shoreline and settlement remains explicit.`,
                ).join(' ')
              : `The camera advances through geographic beat ${index + 1}.`,
          ),
          arrows:
            index === 0
              ? [
                  {
                    id: 'stress-camera',
                    kind: 'camera',
                    x1: 0.08,
                    y1: 0.7,
                    x2: 0.82,
                    y2: 0.28,
                    label:
                      'Track inland at constant height before tilting up beyond the settlement',
                  },
                ]
              : [],
        })),
      },
    ],
  },
];

const motionReview = baseProject('Motion and transition export review', 2.4);
motionReview.scenes = [
  {
    id: 'motion-scene',
    title: 'PDF fixture - sample copy only',
    shots: [
      {
        ...shot('motion-shot', 'Island approach - visual treatment test'),
        description:
          'Review example for checking how an authored camera move reads between two generated frames.',
        camera:
          'Dolly forward from the distant island view into the closer island view, keeping the horizon stable.',
        action: 'Cloud banks pass through the foreground during the move.',
        transition: 'dissolve',
        panels: [
          panel(
            'motion-panel-a',
            'Panel 1',
            islandWide,
            'Distant island view. Sample caption for export review.',
          ),
          panel(
            'motion-panel-b',
            'Panel 2',
            islandCloser,
            'Closer island view. Sample caption for export review.',
          ),
        ],
      },
      {
        ...shot('boundary-shot', 'Separate shot - transition treatment test'),
        description:
          'This shot exists only to verify the DISSOLVE boundary treatment in the PDF fixture.',
        panels: [
          panel(
            'boundary-panel',
            'Panel 1',
            islandWide,
            'Separate-shot artwork used for layout review.',
          ),
        ],
      },
    ],
  },
];

const outputs = [
  ['storyboard-round2-realistic.pdf', realistic],
  ['storyboard-round2-stress.pdf', stress],
  ['storyboard-motion-review.pdf', motionReview],
];
for (const [name, project] of outputs) {
  const bytes = await createStoryboardPdf(project);
  const url = new URL(name, outputDirectory);
  await writeFile(url, bytes);
  console.log(`${fileURLToPath(url)} ${bytes.length} bytes`);
}

function baseProject(name, aspectRatio) {
  return {
    schemaVersion: 1,
    id: `project-${aspectRatio}`,
    name,
    aspectRatio,
    style: 'Rough pencil / restrained tonal blocking',
    styleNotes: '',
    scenes: [],
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
    notes: '',
    referenceIds: [],
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
    versions: dataUrl
      ? [
          {
            id: `${id}-image`,
            dataUrl,
            createdAt: '2026-09-10T00:00:00.000Z',
            label: 'Selected review frame',
          },
        ]
      : [],
    selectedVersionId: dataUrl ? `${id}-image` : null,
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
