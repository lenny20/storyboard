import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';

import { createStoryboardPdf } from './export';

const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
  if (url.protocol === 'file:') {
    const bytes = await readFile(fileURLToPath(url));
    return new Response(bytes, { status: 200 });
  }
  return nativeFetch(input, init);
};

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mNkYPj/n4GBgYGJAQoAHgQCAf2cQMsAAAAASUVORK5CYII=';
const longDialogue = Array.from({ length: 120 }, (_, index) => {
  const line = String(index + 1).padStart(3, '0');
  return `DIALOGUE-LINE-${line} — Élodie: “Keep the horizon level; we’re almost through the cloud bank.”`;
}).join('\n');

const makePanel = (index: number, long = false) => ({
  id: `panel-${index}`,
  title: index === 2
    ? 'The coastline resolves through the cloud bank while the foreground vapour crosses frame'
    : `Beat ${String(index + 1).padStart(2, '0')}`,
  framing: index === 2
    ? 'Extremely wide aerial establishing composition with foreground cloud layers'
    : index % 2 ? 'Close-up' : 'Wide',
  angle: index === 2
    ? 'High oblique angle tracking south-west above the waterline'
    : 'Eye level',
  description: long
    ? Array.from({ length: 52 }, (_, line) => `CAPTION-${String(line + 1).padStart(2, '0')} The island remains small against a broad field of ocean while translucent clouds cross at different depths.`).join(' ')
    : `The ${index % 2 ? 'near' : 'far'} beat preserves the island silhouette and clear horizon.`,
  versions: index === 0 ? [{ id: 'selected-art', dataUrl: png, createdAt: '2026-09-10T00:00:00.000Z', label: 'Selected pencil pass' }] : [],
  selectedVersionId: index === 0 ? 'selected-art' : null,
  markers: index === 0 ? [{ id: 'marker-1', label: 'Island', x: 0.5, y: 0.57, scale: 1 }] : [],
  arrows: index === 0 ? [
    { id: 'arrow-camera', kind: 'camera' as const, x1: 0.12, y1: 0.72, x2: 0.74, y2: 0.32, label: 'DOLLY FORWARD' },
    { id: 'arrow-action', kind: 'action' as const, x1: 0.18, y1: 0.23, x2: 0.88, y2: 0.23, label: 'CLOUD DRIFT' },
  ] : [],
});

const fillerScene = (index: number) => ({ id: `scene-${index}`, title: `Earlier scene ${index}`, shots: [] });
const project = {
  schemaVersion: 1 as const,
  id: 'stress-project',
  name: 'The Long Way Across the Water: A Storyboard Pagination and Print Fidelity Study',
  aspectRatio: 2.39,
  style: 'Rough pencil and restrained graphite tonal blocking with a deliberately overlong footer style description used to verify safe truncation',
  styleNotes: 'Loose graphite line, readable silhouettes, no detailed faces.',
  scenes: [
    {
      id: 'scene-1',
      title: 'Island approach',
      shots: [{
        id: 'shot-opening',
        title: 'Island reveal',
        description: 'Aerial of a small island in a vast ocean, flying through wispy clouds.',
        dialogue: '',
        action: 'Clouds drift across the foreground.',
        camera: 'Fly forward, keeping the horizon stable.',
        notes: '',
        referenceIds: [],
        panels: [makePanel(30), makePanel(31)],
      }],
    },
    fillerScene(2), fillerScene(3),
    {
      id: 'scene-4',
      title: 'Cloud passage over the island as the weather opens and a distant coastline emerges beyond the rain',
      shots: [
        {
          id: 'shot-long',
          title: 'A sustained aerial move from an almost abstract ocean texture into a precise island reveal while cloud layers cross in opposing directions',
          description: 'A continuous shot. The island must remain centred and small until the final third of the move. Preserve the director’s specified scale and do not invent coverage.',
          dialogue: longDialogue,
          action: 'Wispy cloud layers drift right to left. The sea remains calm beneath them.',
          camera: 'Dolly forward through cloud layers, maintaining a stable horizon. This is a physical move, not a zoom.',
          notes: 'The first frame may feel nearly empty. Keep the reveal patient.',
          referenceIds: [],
          panels: Array.from({ length: 14 }, (_, index) => makePanel(index, index === 2)),
        },
        {
          id: 'shot-empty',
          title: 'A deliberately empty shot record with an exceptionally descriptive title that must wrap cleanly without colliding with its shot number or panel count',
          description: '', dialogue: '', action: '', camera: '', notes: '', referenceIds: [], panels: [],
        },
      ],
    },
    {
      id: 'scene-5',
      title: 'Interior - late afternoon',
      shots: [{
        id: 'shot-final', title: 'Matilda turns', description: 'A quiet reaction.', dialogue: 'MATILDA\nI can see it now.', action: 'She smiles.', camera: '', notes: '', referenceIds: [], panels: [makePanel(20)],
      }],
    },
  ],
  references: [],
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-10T00:00:00.000Z',
};

const bytes = await createStoryboardPdf(project);
const output = new URL('./storyboard-stress-fixture.pdf', import.meta.url);
await writeFile(output, bytes);
const loaded = await PDFDocument.load(bytes);
if (loaded.getPageCount() < 7) throw new Error(`Expected at least 7 stress pages, received ${loaded.getPageCount()}.`);

const selectedBytes = await createStoryboardPdf(project, { sceneId: 'scene-4' });
const selected = await PDFDocument.load(selectedBytes);
if (selected.getPageCount() < 5) throw new Error('Selected-scene stress export did not paginate.');

await assertRejects(
  createStoryboardPdf({ ...project, scenes: [{ ...project.scenes[3], shots: [{ ...project.scenes[3].shots[0], panels: [{ ...makePanel(0), selectedVersionId: 'orphan' }] }] }] }),
  'no longer exists',
);
await assertRejects(
  createStoryboardPdf({
    ...project,
    scenes: [{
      ...project.scenes[3],
      shots: [{
        ...project.scenes[3].shots[0],
        panels: [{
          ...makePanel(0),
          versions: [{ id: 'broken-art', dataUrl: 'data:image/png;base64,bm90LWEtcG5n', createdAt: '2026-09-10T00:00:00.000Z', label: 'Broken image' }],
          selectedVersionId: 'broken-art',
        }],
      }],
    }],
  }),
  'could not be read',
);

console.log(JSON.stringify({ output: fileURLToPath(output), pages: loaded.getPageCount(), selectedScenePages: selected.getPageCount(), bytes: bytes.length }));

async function assertRejects(promise: Promise<Uint8Array>, expected: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    if (String(error).includes(expected)) return;
    throw error;
  }
  throw new Error(`Expected rejection containing "${expected}".`);
}
