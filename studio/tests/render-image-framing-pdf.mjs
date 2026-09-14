import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { createStoryboardPdf } from '../lib/pdf/export.ts';

const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
  if (url.protocol === 'file:') return new Response(await readFile(fileURLToPath(url)), { status: 200 });
  return nativeFetch(input, init);
};

const fixtureUrl = new URL('./fixtures/review-frame-1.png', import.meta.url);
const bytes = await readFile(fixtureUrl);
const dataUrl = `data:image/png;base64,${bytes.toString('base64')}`;
const transforms = [
  ['Contain - unchanged default', undefined],
  ['Cover - centre crop', { fit: 'cover', scale: 1, offsetX: 0, offsetY: 0, flipX: false, flipY: false }],
  ['Zoom and offset', { fit: 'cover', scale: 1.45, offsetX: 0.2, offsetY: -0.15, flipX: false, flipY: false }],
  ['Flip horizontal', { fit: 'contain', scale: 1, offsetX: 0, offsetY: 0, flipX: true, flipY: false }],
  ['Flip vertical', { fit: 'contain', scale: 1, offsetX: 0, offsetY: 0, flipX: false, flipY: true }],
  ['Flip both and offset', { fit: 'cover', scale: 1.2, offsetX: -0.18, offsetY: 0.12, flipX: true, flipY: true }],
];

const panels = transforms.map(([title, transform], index) => ({
  id: `panel-${index}`,
  title,
  framing: 'Wide',
  angle: 'Eye level',
  description: 'The frame border and composition guides must remain above clipped artwork.',
  referenceIds: [],
  referenceGroupIds: [],
  versions: [{ id: `version-${index}`, label: title, dataUrl, createdAt: '2026-09-12T00:00:00.000Z', ...(transform ? { transform } : {}) }],
  selectedVersionId: `version-${index}`,
  markers: [{ id: `marker-${index}`, label: 'Guide', x: 0.5, y: 0.5, scale: 1 }],
  arrows: [],
}));

const project = {
  schemaVersion: 1,
  id: 'image-framing-review',
  name: 'Image framing and flip review',
  aspectRatio: 1.85,
  style: 'QA fixture',
  styleNotes: '',
  scenes: [{
    id: 'scene',
    title: 'Asymmetric source: LEFT EDGE / RIGHT EDGE',
    shots: [{
      id: 'shot', title: 'PDF parity', description: '', dialogue: '', action: '', camera: '', notes: '',
      referenceIds: [], referenceGroupIds: [], panels,
    }],
  }],
  references: [],
  createdAt: '2026-09-12T00:00:00.000Z',
  updatedAt: '2026-09-12T00:00:00.000Z',
};

const outputDirectory = new URL('../../output/pdf/', import.meta.url);
await mkdir(outputDirectory, { recursive: true });
const output = new URL('storyboard-image-framing-review.pdf', outputDirectory);
const pdf = await createStoryboardPdf(project);
await writeFile(output, pdf);
console.log(`${fileURLToPath(output)} ${pdf.length} bytes`);
