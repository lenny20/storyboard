'use client';

import { validateProject, type StoryProject } from '@/lib/storyboard/model';
import {
  FOLDER_ASSET_PREFIX,
  MAX_FOLDER_IMAGE_BYTES,
  type FolderAssetDescriptor,
  type FolderProjectBinding,
  type FolderProjectsResponse,
  type PendingFolderBinding,
} from './types';

const DATA_URL =
  /^data:(image\/(?:png|jpeg|webp|gif|avif));base64,([A-Za-z0-9+/]*={0,2})$/i;
const ASSET_TOKEN = /^asset:sha256:([a-f0-9]{64})\.(png|jpg|webp|gif|avif)$/;

export class FolderProjectClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'FolderProjectClientError';
  }
}

type PreparedAsset = FolderAssetDescriptor & { dataUrl: string };
type PreparedProject = { project: StoryProject; assets: PreparedAsset[] };
const projectAssetCache = new Map<string, Map<string, FolderAssetDescriptor>>();

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    let detail: { error?: unknown; code?: unknown } = {};
    try {
      detail = (await response.json()) as typeof detail;
    } catch {
      // The HTTP status remains useful when a proxy returned a non-JSON error.
    }
    throw new FolderProjectClientError(
      typeof detail.error === 'string'
        ? detail.error
        : `Folder project request failed (${response.status}).`,
      response.status,
      typeof detail.code === 'string' ? detail.code : undefined,
    );
  }
  return response.json() as Promise<T>;
}

function json(value: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(value),
  };
}

function projectImageValues(project: StoryProject): string[] {
  return [
    ...(project.coverImage ? [project.coverImage.dataUrl] : []),
    ...project.references.map((reference) => reference.dataUrl),
    ...project.scenes.flatMap((scene) =>
      scene.shots.flatMap((shot) =>
        shot.panels.flatMap((panel) =>
          panel.versions.map((version) => version.dataUrl),
        ),
      ),
    ),
  ].filter(Boolean);
}

function replaceProjectImages(
  project: StoryProject,
  replace: (value: string) => string,
): StoryProject {
  return {
    ...project,
    ...(project.coverImage
      ? {
          coverImage: {
            ...project.coverImage,
            dataUrl: replace(project.coverImage.dataUrl),
          },
        }
      : {}),
    references: project.references.map((reference) => ({
      ...reference,
      dataUrl: replace(reference.dataUrl),
    })),
    scenes: project.scenes.map((scene) => ({
      ...scene,
      shots: scene.shots.map((shot) => ({
        ...shot,
        panels: shot.panels.map((panel) => ({
          ...panel,
          versions: panel.versions.map((version) => ({
            ...version,
            dataUrl: replace(version.dataUrl),
          })),
        })),
      })),
    })),
  };
}

function decodeDataUrl(dataUrl: string): {
  bytes: Uint8Array;
  mimeType: FolderAssetDescriptor['mimeType'];
  extension: FolderAssetDescriptor['extension'];
} {
  const match = DATA_URL.exec(dataUrl);
  if (!match)
    throw new Error('A project image is not a supported base64 data URL.');
  const mimeType = match[1].toLowerCase() as FolderAssetDescriptor['mimeType'];
  const decoded = atob(match[2]);
  if (decoded.length <= 0 || decoded.length > MAX_FOLDER_IMAGE_BYTES)
    throw new Error('Each project image must be between 1 byte and 20 MB.');
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1)
    bytes[index] = decoded.charCodeAt(index);
  return {
    bytes,
    mimeType,
    extension: (mimeType === 'image/jpeg'
      ? 'jpg'
      : mimeType.slice(6)) as FolderAssetDescriptor['extension'],
  };
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new Uint8Array(bytes).buffer,
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function prepareProject(project: StoryProject): Promise<PreparedProject> {
  validateProject(project);
  const unique = [...new Set(projectImageValues(project))];
  const assets: PreparedAsset[] = [];
  const tokenByDataUrl = new Map<string, string>();
  const previous = projectAssetCache.get(project.id);
  const nextCache = new Map<string, FolderAssetDescriptor>();
  for (const dataUrl of unique) {
    const cached = previous?.get(dataUrl);
    const decoded = cached ? undefined : decodeDataUrl(dataUrl);
    const hash = cached?.hash ?? (await sha256(decoded!.bytes));
    const descriptor: PreparedAsset = {
      hash,
      extension: cached?.extension ?? decoded!.extension,
      mimeType: cached?.mimeType ?? decoded!.mimeType,
      bytes: cached?.bytes ?? decoded!.bytes.byteLength,
      dataUrl,
    };
    const prior = assets.find((asset) => asset.hash === hash);
    if (
      prior &&
      (prior.extension !== descriptor.extension ||
        prior.bytes !== descriptor.bytes)
    ) {
      throw new Error(
        'Two project images have an unexpected content hash collision.',
      );
    }
    if (!prior) assets.push(descriptor);
    tokenByDataUrl.set(
      dataUrl,
      `${FOLDER_ASSET_PREFIX}${hash}.${descriptor.extension}`,
    );
    nextCache.set(dataUrl, descriptor);
  }
  projectAssetCache.set(project.id, nextCache);
  return {
    project: replaceProjectImages(
      project,
      (value) => tokenByDataUrl.get(value) ?? value,
    ),
    assets,
  };
}

function descriptor(asset: PreparedAsset): FolderAssetDescriptor {
  return {
    hash: asset.hash,
    extension: asset.extension,
    mimeType: asset.mimeType,
    bytes: asset.bytes,
  };
}

async function uploadMissingAssets(
  projectId: string,
  token: string | undefined,
  assets: PreparedAsset[],
): Promise<void> {
  const descriptors = assets.map(descriptor);
  const result = await api<{ missing: string[] }>(
    '/api/projects/assets/check',
    json({ projectId, token, assets: descriptors }),
  );
  const missing = new Set(result.missing);
  for (const asset of assets) {
    if (!missing.has(asset.hash)) continue;
    const decoded = decodeDataUrl(asset.dataUrl);
    const response = await fetch(`/api/projects/assets/${asset.hash}`, {
      method: 'PUT',
      headers: {
        'content-type': asset.mimeType,
        'x-storyboard-project-id': projectId,
        'x-storyboard-extension': asset.extension,
        ...(token ? { 'x-storyboard-binding-token': token } : {}),
      },
      body: new Blob([new Uint8Array(decoded.bytes).buffer], {
        type: asset.mimeType,
      }),
    });
    if (!response.ok) {
      let error = `Could not store image '${asset.hash.slice(0, 12)}'.`;
      let code: string | undefined;
      try {
        const body = (await response.json()) as {
          error?: unknown;
          code?: unknown;
        };
        if (typeof body.error === 'string') error = body.error;
        if (typeof body.code === 'string') code = body.code;
      } catch {
        // Use the stable fallback above.
      }
      throw new FolderProjectClientError(error, response.status, code);
    }
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 32 * 1024;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }
  return btoa(binary);
}

async function hydrateBinding(
  binding: FolderProjectBinding,
): Promise<FolderProjectBinding> {
  const tokens = [...new Set(projectImageValues(binding.project))];
  const dataByToken = new Map<string, string>();
  for (const token of tokens) {
    const match = ASSET_TOKEN.exec(token);
    if (!match)
      throw new Error(
        'Folder project metadata contains an invalid image reference.',
      );
    const response = await fetch(
      `/api/projects/assets/${match[1]}?projectId=${encodeURIComponent(binding.projectId)}&extension=${match[2]}`,
    );
    if (!response.ok) {
      const detail = (await response.json().catch(() => ({}))) as {
        error?: unknown;
      };
      throw new Error(
        typeof detail.error === 'string'
          ? detail.error
          : `Image asset '${match[1]}' could not be opened.`,
      );
    }
    const mimeType = response.headers.get('content-type');
    const bytes = new Uint8Array(await response.arrayBuffer());
    dataByToken.set(token, `data:${mimeType};base64,${bytesToBase64(bytes)}`);
  }
  return {
    ...binding,
    project: validateProject(
      replaceProjectImages(
        binding.project,
        (token) => dataByToken.get(token) ?? token,
      ),
    ),
  };
}

export async function listFolderProjectsClient(): Promise<FolderProjectsResponse> {
  const raw = await api<FolderProjectsResponse>('/api/projects');
  const projects: FolderProjectBinding[] = [];
  const diagnostics = [...raw.diagnostics];
  for (const binding of raw.projects) {
    try {
      projects.push(await hydrateBinding(binding));
    } catch (error) {
      diagnostics.push({
        projectId: binding.projectId,
        path: binding.path,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return {
    projects,
    diagnostics,
    forgottenProjectIds: raw.forgottenProjectIds ?? [],
  };
}

export async function chooseFolder(
  purpose: 'parent' | 'project',
): Promise<{ path: string | null; available: boolean }> {
  return api('/api/projects/choose-folder', json({ purpose }));
}

export async function chooseProjectFolder(
  purpose: 'parent' | 'project',
): Promise<string | null> {
  const result = await chooseFolder(purpose);
  if (!result.available) {
    throw new Error(
      'A native folder chooser is not available on this computer.',
    );
  }
  return result.path;
}

export async function createFolderProjectClient(
  project: StoryProject,
  parentPath: string,
): Promise<FolderProjectBinding> {
  const pending = await api<PendingFolderBinding>(
    '/api/projects/create',
    json({ parentPath, name: project.name, projectId: project.id }),
  );
  return savePreparedProject(project, null, pending.token);
}

export async function saveFolderProjectClient(
  project: StoryProject,
  expectedRevision: number,
  expectedManifestDigest: string,
): Promise<FolderProjectBinding> {
  return savePreparedProject(
    project,
    expectedRevision,
    undefined,
    expectedManifestDigest,
  );
}

async function savePreparedProject(
  project: StoryProject,
  expectedRevision: number | null,
  token?: string,
  expectedManifestDigest?: string,
): Promise<FolderProjectBinding> {
  const prepared = await prepareProject(project);
  await uploadMissingAssets(project.id, token, prepared.assets);
  const binding = await api<FolderProjectBinding>(
    '/api/projects/save',
    json({
      projectId: project.id,
      token,
      expectedRevision,
      expectedManifestDigest,
      project: prepared.project,
      assets: prepared.assets.map(descriptor),
    }),
  );
  return { ...binding, project };
}

export async function openFolderProjectClient(
  folderPath: string,
): Promise<FolderProjectBinding> {
  return hydrateBinding(
    await api<FolderProjectBinding>(
      '/api/projects/open',
      json({ path: folderPath }),
    ),
  );
}

export async function forgetFolderProjectClient(
  projectId: string,
): Promise<void> {
  await api('/api/projects/forget', json({ projectId }));
}
