import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createPanel, createProject } from '../lib/storyboard/model';
import {
  beginFolderProject,
  checkFolderAssets,
  configureFolderProjectStorageForTests,
  FolderProjectConflictError,
  forgetFolderProject,
  listFolderProjects,
  openFolderProject,
  readFolderAsset,
  saveFolderProject,
  writeFolderAsset,
} from '../lib/projects/server';
import type {
  FolderAssetDescriptor,
  FolderProjectBinding,
} from '../lib/projects/types';

const pngPath = new URL('./fixtures/review-frame-1.png', import.meta.url);

void test(
  'folder projects round-trip every image reference and metadata saves do not rewrite artwork',
  { concurrency: false },
  async () =>
    withIsolatedFolders(async ({ parent, registry }) => {
      const bytes = await readFile(pngPath);
      const descriptor = imageDescriptor(bytes);
      const project = tokenProject('folder-roundtrip', descriptor);
      const pending = await beginFolderProject({
        parentPath: parent,
        name: 'Roundtrip',
        projectId: project.id,
      });
      await writeFolderAsset({
        projectId: project.id,
        token: pending.token,
        descriptor,
        bytes,
      });
      const first = await saveFolderProject({
        projectId: project.id,
        token: pending.token,
        expectedRevision: null,
        project,
        assets: [descriptor],
      });

      const manifest = JSON.parse(
        await readFile(
          path.join(pending.path, 'project.storyboard.json'),
          'utf8',
        ),
      );
      const token = assetToken(descriptor);
      assert.equal(manifest.project.references[0].dataUrl, token);
      assert.deepEqual(
        manifest.project.scenes[0].shots[0].panels[0].versions.map(
          (version: { dataUrl: string }) => version.dataUrl,
        ),
        [token, token],
      );
      assert.equal(
        manifest.project.scenes[0].shots[0].panels[0].pdfFullWidth,
        true,
      );
      assert.equal(
        manifest.project.scenes[0].shots[0].panelConnections[0].type,
        'aerial',
      );
      configureFolderProjectStorageForTests(registry);
      assert.deepEqual(
        (
          await readFolderAsset(
            project.id,
            descriptor.hash,
            descriptor.extension,
          )
        ).bytes,
        bytes,
      );
      assert.equal(
        (await listFolderProjects()).projects[0].manifestDigest,
        first.manifestDigest,
      );
      const reopened = await openFolderProject(pending.path);
      assert.equal(reopened.revision, 1);
      assert.equal(
        reopened.project.scenes[0].shots[0].panelConnections?.[0].type,
        'aerial',
      );

      const artworkPath = path.join(
        pending.path,
        'images',
        `${descriptor.hash}.${descriptor.extension}`,
      );
      const before = await stat(artworkPath);
      const edited = {
        ...project,
        name: 'Metadata edit',
        updatedAt: '2031-01-01T00:00:00.000Z',
      };
      const second = await saveFolderProject({
        projectId: project.id,
        expectedRevision: first.revision,
        expectedManifestDigest: first.manifestDigest,
        project: edited,
        assets: [descriptor],
      });
      const after = await stat(artworkPath);
      assert.equal(after.ino, before.ino);
      assert.equal(after.mtimeMs, before.mtimeMs);
      assert.equal(second.revision, 2);
    }),
);

void test(
  'revision and manifest digest CAS reject stale and externally edited saves',
  { concurrency: false },
  async () =>
    withIsolatedFolders(async ({ parent }) => {
      const project = createProject('CAS folder');
      const first = await createEmptyFolderProject(parent, project, 'CAS');
      const winnerProject = {
        ...project,
        name: 'Winner',
        updatedAt: '2031-01-01T00:00:00.000Z',
      };
      const winner = await saveFolderProject({
        projectId: project.id,
        expectedRevision: first.revision,
        expectedManifestDigest: first.manifestDigest,
        project: winnerProject,
        assets: [],
      });
      await assert.rejects(
        saveFolderProject({
          projectId: project.id,
          expectedRevision: first.revision,
          expectedManifestDigest: first.manifestDigest,
          project: { ...project, name: 'Stale' },
          assets: [],
        }),
        FolderProjectConflictError,
      );

      const manifestPath = path.join(first.path, 'project.storyboard.json');
      const external = JSON.parse(await readFile(manifestPath, 'utf8'));
      external.project.name = 'External same-revision edit';
      await writeFile(manifestPath, `${JSON.stringify(external, null, 2)}\n`);
      await assert.rejects(
        saveFolderProject({
          projectId: project.id,
          expectedRevision: winner.revision,
          expectedManifestDigest: winner.manifestDigest,
          project: { ...winnerProject, name: 'Would overwrite external edit' },
          assets: [],
        }),
        FolderProjectConflictError,
      );
    }),
);

void test(
  'missing assets and symlinked image directories are rejected',
  { concurrency: false },
  async () =>
    withIsolatedFolders(async ({ root, parent }) => {
      const bytes = await readFile(pngPath);
      const descriptor = imageDescriptor(bytes);
      const project = tokenProject('unsafe-folder', descriptor);
      const pending = await beginFolderProject({
        parentPath: parent,
        name: 'Unsafe',
        projectId: project.id,
      });
      await assert.rejects(
        saveFolderProject({
          projectId: project.id,
          token: pending.token,
          expectedRevision: null,
          project,
          assets: [descriptor],
        }),
        /missing or incomplete/i,
      );

      const images = path.join(pending.path, 'images');
      const moved = path.join(pending.path, 'real-images');
      const outside = path.join(root, 'outside');
      await mkdir(outside);
      await rename(images, moved);
      await symlink(outside, images, 'dir');
      await assert.rejects(
        checkFolderAssets({
          projectId: project.id,
          token: pending.token,
          assets: [descriptor],
        }),
        /unsafe/i,
      );
    }),
);

void test(
  'forget preserves folder files and concurrent project registration loses no entries',
  { concurrency: false },
  async () =>
    withIsolatedFolders(async ({ parent }) => {
      const firstProject = createProject('Registry one');
      const secondProject = createProject('Registry two');
      const [firstPending, secondPending] = await Promise.all([
        beginFolderProject({
          parentPath: parent,
          name: 'One',
          projectId: firstProject.id,
        }),
        beginFolderProject({
          parentPath: parent,
          name: 'Two',
          projectId: secondProject.id,
        }),
      ]);
      const [first, second] = await Promise.all([
        saveFolderProject({
          projectId: firstProject.id,
          token: firstPending.token,
          expectedRevision: null,
          project: firstProject,
          assets: [],
        }),
        saveFolderProject({
          projectId: secondProject.id,
          token: secondPending.token,
          expectedRevision: null,
          project: secondProject,
          assets: [],
        }),
      ]);
      assert.deepEqual(
        new Set(
          (await listFolderProjects()).projects.map(
            (binding) => binding.projectId,
          ),
        ),
        new Set([first.projectId, second.projectId]),
      );
      await forgetFolderProject(first.projectId);
      assert.equal(
        (await stat(path.join(first.path, 'project.storyboard.json'))).isFile(),
        true,
      );
      const listed = await listFolderProjects();
      assert.deepEqual(
        listed.projects.map((binding) => binding.projectId),
        [second.projectId],
      );
      assert.ok(listed.forgottenProjectIds?.includes(first.projectId));
    }),
);

async function withIsolatedFolders(
  run: (paths: {
    root: string;
    parent: string;
    registry: string;
  }) => Promise<void>,
) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'storyboard-folders-'));
  const parent = path.join(root, 'projects');
  await mkdir(parent);
  const registry = path.join(root, 'registry');
  configureFolderProjectStorageForTests(registry);
  try {
    await run({ root, parent, registry });
  } finally {
    configureFolderProjectStorageForTests(null);
    await rm(root, { recursive: true, force: true });
  }
}

async function createEmptyFolderProject(
  parent: string,
  project: ReturnType<typeof createProject>,
  name: string,
): Promise<FolderProjectBinding> {
  const pending = await beginFolderProject({
    parentPath: parent,
    name,
    projectId: project.id,
  });
  return saveFolderProject({
    projectId: project.id,
    token: pending.token,
    expectedRevision: null,
    project,
    assets: [],
  });
}

function imageDescriptor(bytes: Uint8Array): FolderAssetDescriptor {
  return {
    hash: createHash('sha256').update(bytes).digest('hex'),
    extension: 'png',
    mimeType: 'image/png',
    bytes: bytes.byteLength,
  };
}

function assetToken(descriptor: FolderAssetDescriptor): string {
  return `asset:sha256:${descriptor.hash}.${descriptor.extension}`;
}

function tokenProject(name: string, descriptor: FolderAssetDescriptor) {
  const project = createProject(name);
  const token = assetToken(descriptor);
  project.references.push({
    id: 'reference',
    name: 'Reference',
    kind: 'style',
    mimeType: 'image/png',
    dataUrl: token,
  });
  const panel = project.scenes[0].shots[0].panels[0];
  panel.pdfFullWidth = true;
  panel.versions = [
    {
      id: 'version-one',
      label: 'One',
      dataUrl: token,
      createdAt: project.createdAt,
    },
    {
      id: 'version-two',
      label: 'Two',
      dataUrl: token,
      createdAt: project.createdAt,
    },
  ];
  panel.selectedVersionId = 'version-two';
  const aerialPanel = createPanel('Aerial destination');
  project.scenes[0].shots[0].panels.push(aerialPanel);
  project.scenes[0].shots[0].panelConnections = [
    {
      fromId: panel.id,
      toId: aerialPanel.id,
      type: 'aerial',
      description: 'Keep this exact authored description.',
    },
  ];
  return project;
}
