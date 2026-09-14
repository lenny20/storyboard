import assert from 'node:assert/strict';
import test from 'node:test';
import { indexedDB } from 'fake-indexeddb';

import {
  createPanel,
  createProject,
  validateProject,
} from '../lib/storyboard/model';
import { createGenerationPack } from '../lib/storyboard/generation-pack';
import {
  assertProjectWithinWorkingBudget,
  createProjectBackup,
  deleteProject,
  getProjectBudget,
  importProject,
  isProjectDeleted,
  listProjects,
  listProjectsWithDiagnostics,
  PORTABLE_BACKUP_LIMIT_BYTES,
  PROJECT_WORKING_LIMIT_BYTES,
  ProjectConflictError,
  ProjectSizeLimitError,
  prepareBlobDownload,
  saveProject,
} from '../lib/storyboard/storage';
import { buildPanelPrompt } from '../lib/storyboard/prompts';
import {
  referencePackFilename,
  resolveShotReferences,
} from '../lib/storyboard/references';
import { strFromU8, unzipSync } from 'fflate';

Object.assign(globalThis, { indexedDB });

function later(
  project: ReturnType<typeof createProject>,
  title: string,
  timestamp: string,
) {
  return { ...structuredClone(project), name: title, updatedAt: timestamp };
}

void test('CAS rejects a newer-clock stale tab instead of silently overwriting', async () => {
  const baseline = createProject('CAS baseline');
  await saveProject(baseline, { expectedUpdatedAt: null });
  const firstTab = later(
    baseline,
    'First tab wins',
    '2030-01-01T00:00:00.000Z',
  );
  const staleSecondTab = later(
    baseline,
    'Stale tab with newer wall clock',
    '2099-01-01T00:00:00.000Z',
  );
  await saveProject(firstTab, { expectedUpdatedAt: baseline.updatedAt });

  await assert.rejects(
    saveProject(staleSecondTab, { expectedUpdatedAt: baseline.updatedAt }),
    (error: unknown) =>
      error instanceof ProjectConflictError && error.reason === 'changed',
  );
  assert.equal(
    (await listProjects()).find((project) => project.id === baseline.id)?.name,
    'First tab wins',
  );
});

void test('CAS prevents a stale save from recreating a deleted project', async () => {
  const project = createProject('Deleted project');
  await saveProject(project, { expectedUpdatedAt: null });
  const staleCopy = later(
    project,
    'Should not come back',
    '2099-01-01T00:00:00.000Z',
  );
  await deleteProject(project.id, { expectedUpdatedAt: project.updatedAt });

  await assert.rejects(
    saveProject(staleCopy, { expectedUpdatedAt: project.updatedAt }),
    (error: unknown) =>
      error instanceof ProjectConflictError && error.reason === 'deleted',
  );
  assert.equal(await isProjectDeleted(project.id), true);
  assert.equal(
    (await listProjects()).some((item) => item.id === project.id),
    false,
  );
});

void test('a duplicate create never overwrites an existing project', async () => {
  const project = createProject('Original');
  await saveProject(project, { expectedUpdatedAt: null });
  const duplicate = later(
    project,
    'Unexpected overwrite',
    '2099-01-01T00:00:00.000Z',
  );
  await assert.rejects(
    saveProject(duplicate, { expectedUpdatedAt: null }),
    (error: unknown) =>
      error instanceof ProjectConflictError && error.reason === 'exists',
  );
  assert.equal(
    (await listProjects()).find((item) => item.id === project.id)?.name,
    'Original',
  );
});

void test('image payloads are deduplicated and metadata autosaves keep lightweight project records', async () => {
  const project = createProject('Asset-backed persistence');
  const panel = project.scenes[0].shots[0].panels[0];
  const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
  panel.versions.push(
    {
      id: crypto.randomUUID(),
      label: 'One',
      dataUrl,
      createdAt: project.createdAt,
    },
    {
      id: crypto.randomUUID(),
      label: 'Duplicate',
      dataUrl,
      createdAt: project.createdAt,
    },
  );
  panel.selectedVersionId = panel.versions[0].id;
  await saveProject(project, { expectedUpdatedAt: null });

  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('storyboard-studio', 3);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const readStores = async () => {
    const transaction = database.transaction(
      ['projects', 'assets'],
      'readonly',
    );
    const projectRequest = transaction.objectStore('projects').get(project.id);
    const assetsRequest = transaction.objectStore('assets').getAll();
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    return {
      stored: projectRequest.result as typeof project,
      assets: assetsRequest.result as Array<{ dataUrl: string }>,
    };
  };
  const first = await readStores();
  assert.match(
    first.stored.scenes[0].shots[0].panels[0].versions[0].dataUrl,
    /^asset:sha256:/,
  );
  assert.equal(
    first.assets.filter((asset) => asset.dataUrl === dataUrl).length,
    1,
  );

  const edited = later(
    project,
    'Metadata only edit',
    '2031-01-01T00:00:00.000Z',
  );
  await saveProject(edited, { expectedUpdatedAt: project.updatedAt });
  const second = await readStores();
  assert.equal(
    second.assets.filter((asset) => asset.dataUrl === dataUrl).length,
    1,
  );
  assert.equal(
    (await listProjects()).find((item) => item.id === project.id)?.scenes[0]
      .shots[0].panels[0].versions[1].dataUrl,
    dataUrl,
  );
  database.close();
});

void test('corrupt records report diagnostics without hiding healthy projects', async () => {
  const healthy = createProject('Healthy alongside corrupt');
  await saveProject(healthy, { expectedUpdatedAt: null });
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('storyboard-studio', 3);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction('projects', 'readwrite');
    transaction
      .objectStore('projects')
      .put({ id: 'corrupt-project', schemaVersion: 1 });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();

  const result = await listProjectsWithDiagnostics();
  assert.equal(
    result.projects.some((project) => project.id === healthy.id),
    true,
  );
  assert.equal(
    result.diagnostics.some(
      (diagnostic) => diagnostic.projectId === 'corrupt-project',
    ),
    true,
  );
});

void test(
  'an over-budget prospective save rejects before IndexedDB mutation',
  { concurrency: false },
  async () => {
    const project = createProject('Too large to save');
    const NativeBlob = globalThis.Blob;
    class OversizedBlob {
      readonly size = PROJECT_WORKING_LIMIT_BYTES + 1;
    }
    Object.defineProperty(globalThis, 'Blob', {
      configurable: true,
      value: OversizedBlob,
    });
    try {
      assert.equal(getProjectBudget(project).overBudget, true);
      assert.throws(
        () => assertProjectWithinWorkingBudget(project),
        ProjectSizeLimitError,
      );
      await assert.rejects(
        saveProject(project, { expectedUpdatedAt: null }),
        ProjectSizeLimitError,
      );
    } finally {
      Object.defineProperty(globalThis, 'Blob', {
        configurable: true,
        value: NativeBlob,
      });
    }
    assert.equal(
      (await listProjects()).some((item) => item.id === project.id),
      false,
    );
    assert.ok(PORTABLE_BACKUP_LIMIT_BYTES >= PROJECT_WORKING_LIMIT_BYTES);
  },
);

void test('legacy JSON recovery backups remain importable', async () => {
  const legacy = createProject('Recoverable legacy project');
  const json = JSON.stringify(legacy);
  const file = {
    name: 'legacy.storyboard.json',
    size: json.length,
    text: async () => json,
    slice: () => new Blob(['{']),
  } as File;
  const imported = await importProject(file);
  assert.equal(imported.id, legacy.id);
});

void test('budget measurement includes embedded image payloads', () => {
  const project = createProject('Exact budget');
  const panel = project.scenes[0].shots[0].panels[0];
  panel.versions.push({
    id: crypto.randomUUID(),
    label: 'Sketch',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    createdAt: project.createdAt,
  });
  panel.selectedVersionId = panel.versions[0].id;
  assert.ok(
    getProjectBudget(project).bytes >
      JSON.stringify({ ...project, scenes: [] }).length,
  );
});

void test(
  'compact backup roundtrips and download URLs outlive a trigger for cleanup',
  { concurrency: false },
  async () => {
    const project = createProject('Portable backup');
    const shot = project.scenes[0].shots[0];
    shot.panels[0].pdfFullWidth = true;
    const aerialPanel = createPanel('Aerial destination');
    shot.panels.push(aerialPanel);
    shot.panelConnections = [
      {
        fromId: shot.panels[0].id,
        toId: aerialPanel.id,
        type: 'aerial',
        description: 'Keep this exact authored description.',
      },
    ];
    const backup = await createProjectBackup(project);
    const imported = await importProject(
      new File([backup.blob], backup.filename),
    );
    assert.equal(imported.id, project.id);
    assert.equal(imported.scenes[0].shots[0].panels[0].pdfFullWidth, true);
    assert.equal(
      imported.scenes[0].shots[0].panelConnections?.[0].type,
      'aerial',
    );
    assert.equal(
      imported.scenes[0].shots[0].panelConnections?.[0].description,
      'Keep this exact authored description.',
    );

    const originalDocument = globalThis.document;
    const originalUrl = globalThis.URL;
    const originalWindow = globalThis.window;
    const timers: Array<() => void> = [];
    let revoked = 0;
    let clicked = 0;
    Object.assign(globalThis, {
      document: {
        createElement: () => ({
          href: '',
          download: '',
          style: {},
          click: () => {
            clicked += 1;
          },
          remove: () => undefined,
        }),
        body: { appendChild: () => undefined },
      },
      URL: {
        createObjectURL: () => 'blob:test',
        revokeObjectURL: () => {
          revoked += 1;
        },
      },
      window: {
        setTimeout: (callback: () => void) => {
          timers.push(callback);
          return timers.length;
        },
      },
    });
    try {
      const prepared = prepareBlobDownload(backup.blob, backup.filename);
      prepared.triggerDownload();
      prepared.release();
      assert.equal(clicked, 1);
      assert.equal(revoked, 0);
      assert.equal(timers.length, 1);
      timers[0]();
      assert.equal(revoked, 1);
    } finally {
      Object.assign(globalThis, {
        document: originalDocument,
        URL: originalUrl,
        window: originalWindow,
      });
    }
  },
);

void test('prompt assembly avoids doubled punctuation in director direction', () => {
  const project = createProject('Prompt punctuation');
  const shot = project.scenes[0].shots[0];
  shot.camera = 'Dolly forward.';
  shot.panels[0].camera = shot.camera;
  const prompt = buildPanelPrompt(
    project,
    project.scenes[0],
    shot,
    shot.panels[0],
  );
  assert.match(prompt, /Camera direction: Dolly forward\./);
  assert.doesNotMatch(prompt, /Dolly forward\.\./);
});

void test('reference groups preserve legacy order, add all views, and include future views', () => {
  const project = createProject('Reference groups');
  const shot = project.scenes[0].shots[0];
  const groupId = crypto.randomUUID();
  project.referenceGroups = [
    {
      id: groupId,
      name: 'Matilda',
      kind: 'character',
      notes: 'Keep her blue coat.',
    },
  ];
  const front = {
    id: crypto.randomUUID(),
    name: 'turnaround.png',
    viewLabel: 'Front',
    groupId,
    kind: 'character' as const,
    mimeType: 'image/png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
  };
  const side = {
    id: crypto.randomUUID(),
    name: 'turnaround.png',
    viewLabel: 'Side',
    groupId,
    kind: 'character' as const,
    mimeType: 'image/png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
  };
  const prop = {
    id: crypto.randomUUID(),
    name: 'Lantern',
    kind: 'prop' as const,
    mimeType: 'image/png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
  };
  project.references.push(front, side, prop);
  shot.referenceIds = [side.id, prop.id];
  shot.referenceGroupIds = [groupId];
  shot.panels[0].referenceIds = [...shot.referenceIds];
  shot.panels[0].referenceGroupIds = [...shot.referenceGroupIds];
  assert.deepEqual(
    resolveShotReferences(project, shot).map((reference) => reference.id),
    [side.id, prop.id, front.id],
  );
  const back = { ...front, id: crypto.randomUUID(), viewLabel: 'Back' };
  project.references.push(back);
  assert.deepEqual(
    resolveShotReferences(project, shot).map((reference) => reference.id),
    [side.id, prop.id, front.id, back.id],
  );
  const prompt = buildPanelPrompt(
    project,
    project.scenes[0],
    shot,
    shot.panels[0],
  );
  assert.match(prompt, /Reference group “Matilda” notes: Keep her blue coat\./);
  assert.match(prompt, /Matilda — Front/);
  assert.match(prompt, /same named reference group depict the same entity/);
  assert.match(
    prompt,
    new RegExp(
      referencePackFilename(project, side, 0).replace(
        /[.*+?^${}()|[\]\\]/g,
        '\\$&',
      ),
    ),
  );
  shot.referenceGroupIds = [];
  shot.panels[0].referenceGroupIds = [];
  const directOnlyPrompt = buildPanelPrompt(
    project,
    project.scenes[0],
    shot,
    shot.panels[0],
  );
  assert.match(
    directOnlyPrompt,
    /Reference group “Matilda” notes: Keep her blue coat\./,
  );
  assert.match(
    directOnlyPrompt,
    /same named reference group depict the same entity/,
  );
  assert.doesNotMatch(directOnlyPrompt, /Matilda — Front/);
});

void test('legacy projects validate with empty optional group selections', () => {
  const legacy = createProject('Legacy reference project');
  delete legacy.referenceGroups;
  delete legacy.scenes[0].shots[0].referenceGroupIds;
  delete legacy.scenes[0].shots[0].transition;
  const validated = validateProject(legacy);
  assert.deepEqual(validated.referenceGroups, []);
  assert.deepEqual(validated.scenes[0].shots[0].referenceGroupIds, []);
  assert.equal(validated.scenes[0].shots[0].transition, undefined);
});

void test('shot transitions round-trip while legacy absence means cut to consumers', () => {
  const project = createProject('Transitions');
  const shot = project.scenes[0].shots[0];
  shot.transition = 'match-cut';
  assert.equal(
    validateProject(structuredClone(project)).scenes[0].shots[0].transition,
    'match-cut',
  );

  const invalid = structuredClone(project) as unknown as {
    scenes: Array<{ shots: Array<{ transition?: string }> }>;
  };
  invalid.scenes[0].shots[0].transition = 'star-wipe';
  assert.throws(
    () => validateProject(invalid),
    /\.transition: must be cut, dissolve, fade, wipe, or match-cut/,
  );
});

void test('generation ZIP maps exact prompt references and optional current revision image', async () => {
  const project = createProject('ZIP pack');
  const shot = project.scenes[0].shots[0];
  const panel = shot.panels[0];
  const groupId = crypto.randomUUID();
  project.referenceGroups = [
    { id: groupId, name: 'Matilda', kind: 'character', notes: '' },
  ];
  const reference = {
    id: crypto.randomUUID(),
    name: 'matilda.png',
    viewLabel: 'Front',
    groupId,
    kind: 'character' as const,
    mimeType: 'image/png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
  };
  project.references.push(reference);
  shot.referenceGroupIds = [groupId];
  panel.referenceGroupIds = [groupId];
  panel.versions.push({
    id: crypto.randomUUID(),
    label: 'Current sketch',
    dataUrl: reference.dataUrl,
    createdAt: project.createdAt,
  });
  panel.selectedVersionId = panel.versions[0].id;
  const pack = await createGenerationPack(
    project,
    project.scenes[0],
    shot,
    panel,
    { revisionInstruction: 'Move Matilda left.', includeSelectedImage: true },
  );
  const archive = unzipSync(new Uint8Array(await pack.blob.arrayBuffer()));
  const referencePath = referencePackFilename(project, reference, 0);
  assert.match(pack.filename, /panel-01/);
  assert.equal(strFromU8(archive['prompt.txt']), pack.prompt);
  assert.ok(archive[referencePath]);
  assert.ok(
    pack.files.some(
      (file) =>
        file.path === referencePath && file.referenceId === reference.id,
    ),
  );
  assert.ok(pack.files.some((file) => file.kind === 'selected-image'));
  assert.match(
    strFromU8(archive['reference-map.txt']),
    new RegExp(referencePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  );
});

void test('an empty generation pack says that no images were selected', async () => {
  const project = createProject('Empty ZIP pack');
  const shot = project.scenes[0].shots[0];
  const pack = await createGenerationPack(
    project,
    project.scenes[0],
    shot,
    shot.panels[0],
    { includeSelectedImage: false },
  );
  const archive = unzipSync(new Uint8Array(await pack.blob.arrayBuffer()));
  assert.match(
    strFromU8(archive['reference-map.txt']),
    /No images selected for this pack\./,
  );
});

void test('cover fields default empty and round-trip through validation', () => {
  const created = createProject('Cover fields');
  assert.deepEqual(
    {
      subtitle: created.subtitle,
      draftLabel: created.draftLabel,
      director: created.director,
      production: created.production,
      contact: created.contact,
    },
    { subtitle: '', draftLabel: '', director: '', production: '', contact: '' },
  );

  const empty = validateProject(structuredClone(created));
  assert.deepEqual(
    {
      subtitle: empty.subtitle,
      draftLabel: empty.draftLabel,
      director: empty.director,
      production: empty.production,
      contact: empty.contact,
    },
    { subtitle: '', draftLabel: '', director: '', production: '', contact: '' },
  );

  const filled = {
    ...created,
    subtitle: 'Teaser',
    draftLabel: 'Draft 3',
    director: 'Alex Rivera',
    production: 'Big Trimpy',
    contact: 'alex@example.com',
  };
  const loaded = validateProject(structuredClone(filled));
  assert.equal(loaded.subtitle, 'Teaser');
  assert.equal(loaded.draftLabel, 'Draft 3');
  assert.equal(loaded.director, 'Alex Rivera');
  assert.equal(loaded.production, 'Big Trimpy');
  assert.equal(loaded.contact, 'alex@example.com');

  // Legacy documents predating these fields validate with empty defaults.
  const legacy = structuredClone(created) as unknown as Record<
    string,
    unknown
  >;
  delete legacy.subtitle;
  delete legacy.draftLabel;
  delete legacy.director;
  delete legacy.production;
  delete legacy.contact;
  const loadedLegacy = validateProject(legacy);
  assert.equal(loadedLegacy.subtitle, '');
  assert.equal(loadedLegacy.contact, '');

  (filled as unknown as Record<string, unknown>).subtitle = 42;
  assert.throws(
    () => validateProject(structuredClone(filled)),
    /subtitle: expected a string/,
  );
});
