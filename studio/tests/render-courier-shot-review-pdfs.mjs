import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createStoryboardPdf } from '../lib/pdf/export.ts';

const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
  if (url.protocol === 'file:') return new Response(await readFile(fileURLToPath(url)), { status: 200 });
  return nativeFetch(input, init);
};

const panel = (id, dialogue = '') => ({ id, title: id, framing: 'Wide', angle: 'Eye level', description: 'Matilda studies the distant light.', dialogue, camera: '', notes: '', referenceIds: [], referenceGroupIds: [], versions: [], selectedVersionId: null, markers: [], arrows: [] });
const shot = (id, panels, title = id) => ({ id, title, description: '', dialogue: '', action: '', camera: '', notes: '', referenceIds: [], referenceGroupIds: [], panels });
const base = (shots) => ({ schemaVersion: 1, id: 'courier-review', name: 'Courier dialogue and compact shots', aspectRatio: 2.39, style: 'QA', styleNotes: '', scenes: [{ id: 'scene', title: 'The island approach', shots, shotConnections: [] }], references: [], createdAt: '2026-09-12T00:00:00.000Z', updatedAt: '2026-09-12T00:00:00.000Z' });

const singles = base(Array.from({ length: 3 }, (_, index) => shot(`shot-${index + 1}`, [panel(`Frame ${index + 1}`, `MATILDA\n${['There it is.', 'Hold the course.', 'We are almost home.'][index]}`)], `Single-frame shot ${index + 1}`)));
const lookahead = base([
  shot('lone', [panel('Lone frame')], 'Compacted lone establishing shot'),
  shot('multi', [panel('Multi A'), panel('Multi B')], 'Following multi-panel shot'),
  shot('roomy', [panel('Roomy final frame')], 'Roomy final singleton'),
]);
lookahead.scenes.push({
  id: 'roomy-scene',
  title: 'A separate scene preserves the roomy isolated treatment',
  shots: [shot('isolated', [panel('Isolated roomy frame', 'MATILDA\nHold here.')], 'Isolated single-frame shot')],
  shotConnections: [],
});
const continued = base([shot('dialogue', [panel('Dialogue frame', Array.from({ length: 65 }, (_, index) => `MATILDA ${index + 1}: Wait—there’s more…`).join('\n'))], 'Full-width continued dialogue')]);

const outputs = [
  { layout: 'portrait-2up', project: continued },
  { layout: 'landscape-2up', project: singles },
  { layout: 'landscape-3up', project: lookahead },
];
const directory = new URL('../../output/pdf/', import.meta.url);
await mkdir(directory, { recursive: true });
for (const { layout, project } of outputs) {
  const output = new URL(`storyboard-courier-${layout}-review.pdf`, directory);
  const bytes = await createStoryboardPdf(project, { layout });
  await writeFile(output, bytes);
  console.log(`${fileURLToPath(output)} ${bytes.length} bytes`);
}
