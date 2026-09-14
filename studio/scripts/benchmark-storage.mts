// Synthetic storage stress check; does not open a browser or call an image API.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { indexedDB, IDBObjectStore } from 'fake-indexeddb';
import {
  createProject,
  createShot,
  createPanel,
} from '../lib/storyboard/model';
import {
  createProjectBackup,
  getProjectBudget,
  importProject,
  listProjects,
  saveProject,
} from '../lib/storyboard/storage';

Object.assign(globalThis, { indexedDB });
const project = createProject('Synthetic 300 image storage check');
const shot = createShot('Storage fixture');
project.scenes[0].shots = [shot];
for (let index = 0; index < 300; index += 1) {
  const panel = createPanel(`Frame ${index + 1}`);
  // Distinct image-shaped data payloads exercise persistence, not raster decoding.
  const bytes = Buffer.alloc(512 * 1024, index % 256);
  bytes.writeUInt32BE(index, 0);
  const id = `version-${index}`;
  panel.versions = [
    {
      id,
      dataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
      label: 'Synthetic payload',
      createdAt: project.createdAt,
    },
  ];
  panel.selectedVersionId = id;
  shot.panels.push(panel);
}
let assetWrites = 0;
// Preserve the receiver explicitly with apply below while counting writes.
// eslint-disable-next-line @typescript-eslint/unbound-method
const originalPut = IDBObjectStore.prototype.put;
IDBObjectStore.prototype.put = function (
  ...args: Parameters<typeof originalPut>
) {
  if (this.name === 'assets') assetWrites += 1;
  return originalPut.apply(this, args);
};
const timings: Record<string, number> = {};
async function timed<T>(label: string, action: () => Promise<T>) {
  const start = performance.now();
  const result = await action();
  timings[label] = Math.round(performance.now() - start);
  return result;
}
await timed('initialSaveMs', () =>
  saveProject(project, { expectedUpdatedAt: null }),
);
assert.equal(assetWrites, 300);
const updated = {
  ...project,
  updatedAt: new Date(Date.now() + 1000).toISOString(),
  name: 'Metadata edit',
};
await timed('metadataSaveMs', () =>
  saveProject(updated, { expectedUpdatedAt: project.updatedAt }),
);
assert.equal(assetWrites, 300, 'metadata-only save must not rewrite artwork');
const [loaded] = await timed('loadMs', () => listProjects());
assert.equal(loaded.name, 'Metadata edit');
const backup = await timed('backupMs', () => createProjectBackup(loaded));
const restored = await timed('importMs', () =>
  importProject(new File([backup.blob], backup.filename)),
);
assert.equal(restored.scenes[0].shots[0].panels.length, 300);
for (let index = 0; index < 300; index += 1) {
  assert.equal(
    restored.scenes[0].shots[0].panels[index].versions[0].dataUrl,
    shot.panels[index].versions[0].dataUrl,
  );
}
console.log(
  JSON.stringify(
    {
      images: 300,
      logicalMiB: +(getProjectBudget(project).bytes / 1048576).toFixed(1),
      archiveMiB: +(backup.bytes / 1048576).toFixed(1),
      assetWrites,
      ...timings,
      peakRssMiB: +(process.resourceUsage().maxRSS / 1024).toFixed(1),
      note: 'Node + fake IndexedDB; synthetic payloads, not a browser render or a 2 GiB capacity guarantee.',
    },
    null,
    2,
  ),
);
