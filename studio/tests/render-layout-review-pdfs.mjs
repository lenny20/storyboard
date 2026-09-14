import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { createStoryboardPdf } from '../lib/pdf/export.ts';

const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
  if (url.protocol === 'file:') return new Response(await readFile(fileURLToPath(url)), { status: 200 });
  return nativeFetch(input, init);
};

const panels = Array.from({ length: 7 }, (_, index) => ({
  id: `panel-${index + 1}`,
  title: `Beat ${index + 1}: ${['Arrival', 'Recognition', 'Approach', 'Reveal', 'Reaction', 'Decision', 'Exit'][index]}`,
  framing: index % 2 ? 'Medium' : 'Wide',
  angle: 'Eye level',
  description: 'A concise composition note keeps the contact sheet easy to scan.',
  dialogue: index === 2 ? 'MATILDA\nThere it is.' : '',
  referenceIds: [],
  referenceGroupIds: [],
  versions: [],
  selectedVersionId: null,
  markers: [],
  arrows: [],
}));

const project = {
  schemaVersion: 1,
  id: 'layout-review',
  name: 'The Lighthouse Return — storyboard layout review',
  aspectRatio: 2.39,
  style: 'QA fixture',
  styleNotes: '',
  scenes: [{
    id: 'scene',
    title: 'EXT. LIGHTHOUSE COVE — BLUE HOUR',
    shots: [{
      id: 'shot', title: 'One continuous move across the cove', description: '', dialogue: '', action: '', camera: '', notes: '',
      referenceIds: [], referenceGroupIds: [], panels,
      panelConnections: panels.slice(0, -1).map((panel, index) => ({
        fromId: panel.id,
        toId: panels[index + 1].id,
        type: index === 1 || index === 2 ? 'pan' : index === 4 ? 'dolly' : 'static',
        description: index === 1 ? 'Pan with Matilda as she crosses the path.' : index === 2 ? 'Return the eye to the next row as the beacon turns.' : index === 4 ? 'Push gently toward the lighthouse door.' : '',
      })),
    }],
  }],
  references: [],
  createdAt: '2026-09-12T00:00:00.000Z',
  updatedAt: '2026-09-12T00:00:00.000Z',
};

const outputDirectory = new URL('../../output/pdf/', import.meta.url);
await mkdir(outputDirectory, { recursive: true });
for (const layout of ['portrait-2up', 'landscape-2up', 'landscape-3up']) {
  const layoutProject = structuredClone(project);
  if (layout === 'landscape-2up') {
    layoutProject.scenes[0].shots = panels.slice(0, 4).map((panel, index) => ({
      id: `single-shot-${index + 1}`,
      title: `Single-frame shot ${index + 1}`,
      description: '', dialogue: '', action: '', camera: '', notes: '',
      referenceIds: [], referenceGroupIds: [], panels: [structuredClone(panel)],
    }));
    layoutProject.scenes[0].shotConnections = [];
  }
  const output = new URL(`storyboard-${layout}-review.pdf`, outputDirectory);
  const pdf = await createStoryboardPdf(layoutProject, { layout });
  await writeFile(output, pdf);
  console.log(`${fileURLToPath(output)} ${pdf.length} bytes`);
}
