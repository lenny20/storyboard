import { type StoryProject, validateProject } from './model';
import { Unzip, UnzipInflate, UnzipPassThrough, Zip, ZipPassThrough } from 'fflate';

const DATABASE_NAME = 'storyboard-studio';
const DATABASE_VERSION = 3;
const PROJECT_STORE = 'projects';
const DELETION_STORE = 'deletions';
const ASSET_STORE = 'assets';
const ASSET_PREFIX = 'asset:sha256:';
export const PROJECT_WORKING_LIMIT_BYTES = 2 * 1024 * 1024 * 1024;
export const PORTABLE_BACKUP_LIMIT_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']);

export type ProjectBudget = {
  bytes: number;
  limitBytes: number;
  percent: number;
  overBudget: boolean;
};

export type SaveProjectOptions = { expectedUpdatedAt: string | null };
export type DeleteProjectOptions = { expectedUpdatedAt: string };
export type ProjectConflictReason = 'changed' | 'deleted' | 'exists';

export class ProjectConflictError extends Error {
  readonly name = 'ProjectConflictError';

  constructor(readonly reason: ProjectConflictReason, message: string) {
    super(message);
  }
}

export class ProjectSizeLimitError extends Error {
  readonly name = 'ProjectSizeLimitError';

  constructor(readonly budget: ProjectBudget) {
    super(`This project is ${formatBytes(budget.bytes)}, above the ${formatBytes(budget.limitBytes)} working limit. Remove image versions or export a backup before editing further.`);
  }
}

export type StorageDiagnostic = { projectId?: string; message: string };
export type ProjectListResult = { projects: StoryProject[]; diagnostics: StorageDiagnostic[] };
type DeletionTombstone = { id: string; deletedAt: string };
export const MIN_DOWNLOAD_URL_LIFETIME_MS = 60_000;

export type ProjectBackup = { blob: Blob; filename: string; bytes: number };
export type BrowserStorageEstimate = { usageBytes: number; quotaBytes: number };
export type PreparedDownload = {
  url: string;
  filename: string;
  triggerDownload: () => void;
  markDownloadTriggered: () => void;
  release: () => void;
};

let databasePromise: Promise<IDBDatabase> | undefined;
const projectQueues = new Map<string, Promise<void>>();

function browserError(feature: string): Error {
  return new Error(`${feature} is only available in a browser.`);
}

function indexedDb(): IDBFactory {
  if (typeof indexedDB === 'undefined') throw browserError('Local project storage');
  return indexedDB;
}

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  let request: IDBOpenDBRequest;
  try {
    request = indexedDb().open(DATABASE_NAME, DATABASE_VERSION);
  } catch (error) {
    throw new Error(`Could not open local project storage: ${message(error)}`);
  }
  let wasBlocked = false;
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PROJECT_STORE)) {
        database.createObjectStore(PROJECT_STORE, { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains(DELETION_STORE)) {
        database.createObjectStore(DELETION_STORE, { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains(ASSET_STORE)) {
        database.createObjectStore(ASSET_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      if (wasBlocked) {
        database.close();
        return;
      }
      database.onversionchange = () => {
        database.close();
        if (databasePromise === opening) databasePromise = undefined;
      };
      resolve(database);
    };
    request.onerror = () => {
      if (databasePromise === opening) databasePromise = undefined;
      reject(new Error(`Could not open local project storage: ${message(request.error)}`));
    };
    request.onblocked = () => {
      wasBlocked = true;
      if (databasePromise === opening) databasePromise = undefined;
      reject(new Error('Local project storage is blocked by another open tab. Close the other tab and try again.'));
    };
  });
  databasePromise = opening;
  return opening;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatBytes(bytes: number): string {
  return `${Math.ceil(bytes / (1024 * 1024))} MB`;
}

function requestResult<T>(request: IDBRequest<T>, purpose: string): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error(`${purpose}: ${message(request.error)}`));
  });
}

function transactionDone(transaction: IDBTransaction, purpose: string): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(new Error(`${purpose}: ${message(transaction.error)}`));
    transaction.onerror = () => reject(new Error(`${purpose}: ${message(transaction.error)}`));
  });
}

function safeProject(value: unknown, context: string): StoryProject {
  try {
    return validateProject(value);
  } catch (error) {
    throw new Error(`${context}: ${message(error)}`);
  }
}

type StoredAsset = { id: string; dataUrl: string };

function imageDataUrls(project: StoryProject): string[] {
  return [
    ...project.references.map((reference) => reference.dataUrl),
    ...project.scenes.flatMap((scene) => scene.shots.flatMap((shot) =>
      shot.panels.flatMap((panel) => panel.versions.map((version) => version.dataUrl)))),
  ].filter(Boolean);
}

function assetIdsInStoredProject(project: StoryProject): string[] {
  return [...new Set(imageDataUrls(project).filter((value) => value.startsWith(ASSET_PREFIX))
    .map((value) => value.slice(ASSET_PREFIX.length)))];
}

function replaceImageData(project: StoryProject, replacement: (dataUrl: string) => string): StoryProject {
  return {
    ...project,
    references: project.references.map((reference) => ({ ...reference, dataUrl: replacement(reference.dataUrl) })),
    scenes: project.scenes.map((scene) => ({
      ...scene,
      shots: scene.shots.map((shot) => ({
        ...shot,
        panels: shot.panels.map((panel) => ({
          ...panel,
          versions: panel.versions.map((version) => ({ ...version, dataUrl: replacement(version.dataUrl) })),
        })),
      })),
    })),
  };
}

async function hashDataUrl(dataUrl: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('This browser cannot create content-addressed image storage.');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(dataUrl));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

const recentProjectAssets = new Map<string, Map<string, string>>();

async function prepareStoredProject(project: StoryProject): Promise<{ project: StoryProject; assets: StoredAsset[] }> {
  const unique = [...new Set(imageDataUrls(project).filter(Boolean))];
  const previous = recentProjectAssets.get(project.id);
  const pairs: Array<{ dataUrl: string; id: string }> = [];
  // Hash sequentially so a large project creates only one temporary encoded image at a time.
  for (const dataUrl of unique) pairs.push({ dataUrl, id: previous?.get(dataUrl) ?? await hashDataUrl(dataUrl) });
  recentProjectAssets.set(project.id, new Map(pairs.map(({ dataUrl, id }) => [dataUrl, id])));
  const ids = new Map(pairs.map(({ dataUrl, id }) => [dataUrl, id]));
  return {
    project: replaceImageData(project, (dataUrl) => dataUrl ? `${ASSET_PREFIX}${ids.get(dataUrl)}` : ''),
    assets: pairs.map(({ id, dataUrl }) => ({ id, dataUrl })),
  };
}

async function hydrateStoredProject(store: IDBObjectStore, value: unknown, context: string): Promise<StoryProject> {
  // Version 2 records embedded their data URLs and remain readable until their next save.
  const candidate = value as StoryProject;
  const ids = assetIdsInStoredProject(candidate);
  if (ids.length === 0) return safeProject(value, context);
  const assets = await Promise.all(ids.map((id) => requestResult(store.get(id), `Could not read image asset '${id}'`)));
  const byId = new Map(assets.map((asset, index) => [ids[index], (asset as StoredAsset | undefined)?.dataUrl]));
  const hydrated = replaceImageData(candidate, (dataUrl) => {
    if (!dataUrl.startsWith(ASSET_PREFIX)) return dataUrl;
    const id = dataUrl.slice(ASSET_PREFIX.length);
    const resolved = byId.get(id);
    if (!resolved) throw new Error(`Saved image asset '${id}' is missing.`);
    return resolved;
  });
  return safeProject(hydrated, context);
}

function projectWithoutImageData(project: StoryProject): StoryProject {
  return {
    ...project,
    references: project.references.map((reference) => ({ ...reference, dataUrl: '' })),
    scenes: project.scenes.map((scene) => ({
      ...scene,
      shots: scene.shots.map((shot) => ({
        ...shot,
        panels: shot.panels.map((panel) => ({
          ...panel,
          versions: panel.versions.map((version) => ({ ...version, dataUrl: '' })),
        })),
      })),
    })),
  };
}

function embeddedImageDataLength(project: StoryProject): number {
  let length = 0;
  for (const reference of project.references) length += reference.dataUrl.length;
  for (const scene of project.scenes) {
    for (const shot of scene.shots) {
      for (const panel of shot.panels) {
        for (const version of panel.versions) length += version.dataUrl.length;
      }
    }
  }
  return length;
}

function projectByteSize(project: StoryProject): number {
  try {
    // Valid image data URLs are ASCII and JSON-safe. Replacing every payload
    // with an empty string lets normal autosaves measure exact bytes without
    // allocating a second 30–96 MB JSON string on each text edit.
    const metadataBytes = new Blob([JSON.stringify(projectWithoutImageData(project))]).size;
    return metadataBytes + embeddedImageDataLength(project);
  } catch (error) {
    throw new Error(`Could not measure project size: ${message(error)}`);
  }
}

/** Measures a project at persistence boundaries, rather than during rendering. */
export function getProjectBudget(project: StoryProject): ProjectBudget {
  const bytes = projectByteSize(project);
  return {
    bytes,
    limitBytes: PROJECT_WORKING_LIMIT_BYTES,
    percent: Math.round((bytes / PROJECT_WORKING_LIMIT_BYTES) * 100),
    overBudget: bytes > PROJECT_WORKING_LIMIT_BYTES,
  };
}

/** Reports current origin-wide browser storage. Browsers may revise this quota at any time. */
export async function getBrowserStorageEstimate(): Promise<BrowserStorageEstimate | null> {
  const estimate = await globalThis.navigator?.storage?.estimate?.();
  if (!estimate || typeof estimate.usage !== 'number' || typeof estimate.quota !== 'number') return null;
  return { usageBytes: estimate.usage, quotaBytes: estimate.quota };
}

function ensureWorkingBudget(project: StoryProject): void {
  const budget = getProjectBudget(project);
  if (budget.overBudget) throw new ProjectSizeLimitError(budget);
}

/** Rejects an invalid or over-budget prospective project before it is committed. */
export function assertProjectWithinWorkingBudget(project: StoryProject): void {
  ensureWorkingBudget(safeProject(project, 'Could not check project size'));
}

function diagnosticFor(value: unknown, error: unknown): StorageDiagnostic {
  const rawId = typeof value === 'object' && value !== null && 'id' in value
    ? (value as { id?: unknown }).id
    : undefined;
  return {
    ...(typeof rawId === 'string' && rawId ? { projectId: rawId } : {}),
    message: `A saved project could not be opened: ${message(error)}`,
  };
}

/** Reads valid local projects and reports corrupt records without hiding healthy ones. */
export async function listProjectsWithDiagnostics(): Promise<ProjectListResult> {
  const database = await openDatabase();
  const transaction = database.transaction([PROJECT_STORE, ASSET_STORE], 'readonly');
  const stored = await requestResult(transaction.objectStore(PROJECT_STORE).getAll(), 'Could not read local projects');
  const results = await Promise.allSettled(stored.map((item, index) =>
    hydrateStoredProject(transaction.objectStore(ASSET_STORE), item, `Saved project ${index + 1} is corrupt`)));
  await transactionDone(transaction, 'Could not read local projects');
  const projects: StoryProject[] = [];
  const diagnostics: StorageDiagnostic[] = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') projects.push(result.value);
    else diagnostics.push(diagnosticFor(stored[index], result.reason));
  });
  projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name));
  return { projects, diagnostics };
}

/** Returns valid local projects, newest first. Use listProjectsWithDiagnostics to surface damaged records. */
export async function listProjects(): Promise<StoryProject[]> {
  return (await listProjectsWithDiagnostics()).projects;
}

function abort(transaction: IDBTransaction): void {
  try {
    transaction.abort();
  } catch {
    // The transaction may already have completed while reporting a conflict.
  }
}

async function tombstoneFor(store: IDBObjectStore, id: string): Promise<DeletionTombstone | undefined> {
  return requestResult(store.get(id), 'Could not check project deletion status');
}

function assertExpectedRevision(expectedUpdatedAt: string | null): void {
  if (expectedUpdatedAt !== null && (typeof expectedUpdatedAt !== 'string' || expectedUpdatedAt.trim().length === 0)) {
    throw new Error('A save revision must be an ISO timestamp or null for a new project.');
  }
}

async function saveProjectCas(project: StoryProject, expectedUpdatedAt: string | null): Promise<{ updatedAt: string }> {
  assertExpectedRevision(expectedUpdatedAt);
  const prepared = await prepareStoredProject(project);
  const database = await openDatabase();
  const transaction = database.transaction([PROJECT_STORE, DELETION_STORE, ASSET_STORE], 'readwrite');
  const store = transaction.objectStore(PROJECT_STORE);
  const deletionStore = transaction.objectStore(DELETION_STORE);
  const deleted = await tombstoneFor(deletionStore, project.id);
  if (deleted) {
    abort(transaction);
    throw new ProjectConflictError('deleted', 'This project was deleted in another tab. Reload the workspace before continuing.');
  }
  const existing = await requestResult(store.get(project.id), 'Could not check the saved project');

  if (existing === undefined && expectedUpdatedAt !== null) {
    abort(transaction);
    throw new ProjectConflictError('deleted', 'This project is no longer present on this device. Reload before saving.');
  }
  if (existing !== undefined && expectedUpdatedAt === null) {
    abort(transaction);
    throw new ProjectConflictError('exists', 'A project with this id already exists on this device. Reload before saving.');
  }
  if (existing !== undefined) {
    const existingUpdatedAt = (existing as { updatedAt?: unknown }).updatedAt;
    if (typeof existingUpdatedAt !== 'string') {
      abort(transaction);
      throw new Error(`Saved project '${project.id}' is corrupt: updatedAt is missing.`);
    }
    if (existingUpdatedAt !== expectedUpdatedAt) {
      abort(transaction);
      throw new ProjectConflictError('changed', 'This project changed in another tab. Reload before saving your local edits.');
    }
  }

  const assetStore = transaction.objectStore(ASSET_STORE);
  const existingAssetKeys = await Promise.all(prepared.assets.map((asset) =>
    requestResult(assetStore.getKey(asset.id), `Could not check image asset '${asset.id}'`)));
  prepared.assets.forEach((asset, index) => {
    if (existingAssetKeys[index] === undefined) assetStore.put(asset);
  });
  store.put(prepared.project);
  await transactionDone(transaction, 'Could not save the project');
  return { updatedAt: project.updatedAt };
}

function queueProjectOperation<T>(id: string, operation: () => Promise<T>): Promise<T> {
  const previous = projectQueues.get(id) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(operation);
  const tail = result.then(() => undefined, () => undefined);
  projectQueues.set(id, tail);
  void tail.finally(() => {
    if (projectQueues.get(id) === tail) projectQueues.delete(id);
  });
  return result;
}

/**
 * Creates a project when expectedUpdatedAt is null, or atomically updates only
 * the exact local revision the caller last read. A conflict never looks saved.
 */
export function saveProject(project: StoryProject, options: SaveProjectOptions = { expectedUpdatedAt: null }): Promise<{ updatedAt: string }> {
  try {
    const safe = safeProject(project, 'Could not save project');
    ensureWorkingBudget(safe);
    return queueProjectOperation(safe.id, () => saveProjectCas(safe, options.expectedUpdatedAt));
  } catch (error) {
    return Promise.reject(error);
  }
}

function nextDeletionTimestamp(current?: StoryProject, prior?: DeletionTombstone): string {
  const currentTime = current ? Date.parse(current.updatedAt) : 0;
  const priorTime = prior ? Date.parse(prior.deletedAt) : 0;
  return new Date(Math.max(Date.now(), currentTime + 1, priorTime + 1)).toISOString();
}

async function deleteStoredProject(id: string, expectedUpdatedAt: string): Promise<void> {
  assertExpectedRevision(expectedUpdatedAt);
  const database = await openDatabase();
  const transaction = database.transaction([PROJECT_STORE, DELETION_STORE, ASSET_STORE], 'readwrite');
  const projectStore = transaction.objectStore(PROJECT_STORE);
  const deletionStore = transaction.objectStore(DELETION_STORE);
  const priorDeletion = await tombstoneFor(deletionStore, id);
  if (priorDeletion) {
    abort(transaction);
    throw new ProjectConflictError('deleted', 'This project was already deleted in another tab. Reload the workspace.');
  }
  const existing = await requestResult(projectStore.get(id), 'Could not check the saved project');
  if (existing === undefined) {
    abort(transaction);
    throw new ProjectConflictError('deleted', 'This project is no longer present on this device. Reload the workspace.');
  }
  const existingUpdatedAt = (existing as { updatedAt?: unknown }).updatedAt;
  if (typeof existingUpdatedAt !== 'string') {
    abort(transaction);
    throw new Error(`Saved project '${id}' is corrupt: updatedAt is missing.`);
  }
  if (existingUpdatedAt !== expectedUpdatedAt) {
    abort(transaction);
    throw new ProjectConflictError('changed', 'This project changed in another tab. Reload before deleting it.');
  }
  deletionStore.put({ id, deletedAt: nextDeletionTimestamp(existing as StoryProject, priorDeletion) } satisfies DeletionTombstone);
  projectStore.delete(id);
  await transactionDone(transaction, 'Could not delete the project');
}

/** Deletes only the exact revision the caller last saved or loaded. */
export function deleteProject(id: string, options: DeleteProjectOptions): Promise<void> {
  if (typeof id !== 'string' || id.trim().length === 0) return Promise.reject(new Error('Could not delete project: a project id is required.'));
  if (!options || typeof options.expectedUpdatedAt !== 'string' || !options.expectedUpdatedAt.trim()) {
    return Promise.reject(new Error('Could not delete project: the saved revision is required.'));
  }
  return queueProjectOperation(id, async () => {
    await deleteStoredProject(id, options.expectedUpdatedAt);
    recentProjectAssets.delete(id);
  });
}

/** Lets import flows mint a fresh id instead of reviving a deliberately deleted project. */
export async function isProjectDeleted(id: string): Promise<boolean> {
  if (typeof id !== 'string' || id.trim().length === 0) return false;
  const database = await openDatabase();
  const transaction = database.transaction(DELETION_STORE, 'readonly');
  const deleted = await tombstoneFor(transaction.objectStore(DELETION_STORE), id);
  await transactionDone(transaction, 'Could not check project deletion status');
  return Boolean(deleted);
}

/**
 * Creates an object URL for a browser download. Release it on replacement or
 * unmount; once a download is triggered, release waits at least one minute so
 * embedded webviews have time to consume the URL.
 */
export function prepareBlobDownload(blob: Blob, filename: string): PreparedDownload {
  if (typeof document === 'undefined' || typeof URL === 'undefined') throw browserError('Downloading files');
  const url = URL.createObjectURL(blob);
  let triggeredAt: number | undefined;
  let released = false;
  let releaseRequested = false;
  let cleanupTimer: number | undefined;
  const revoke = () => {
    if (released) return;
    released = true;
    URL.revokeObjectURL(url);
  };
  const scheduleRelease = () => {
    if (released || !releaseRequested) return;
    const remaining = Math.max(0, MIN_DOWNLOAD_URL_LIFETIME_MS - (Date.now() - (triggeredAt ?? Date.now())));
    if (remaining === 0) revoke();
    else cleanupTimer = window.setTimeout(revoke, remaining);
  };
  const release = () => {
    if (released) return;
    if (triggeredAt === undefined) {
      revoke();
      return;
    }
    releaseRequested = true;
    if (cleanupTimer) window.clearTimeout(cleanupTimer);
    scheduleRelease();
  };
  const markDownloadTriggered = () => {
    if (released) return;
    triggeredAt = Date.now();
    if (cleanupTimer) window.clearTimeout(cleanupTimer);
    scheduleRelease();
  };
  const triggerDownload = () => {
    if (released) throw new Error('This prepared download has been released. Prepare it again before downloading.');
    markDownloadTriggered();
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };
  return { url, filename, triggerDownload, markDownloadTriggered, release };
}

function filenamePart(value: string, fallback: string): string {
  const cleaned = value.trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '');
  return cleaned.slice(0, 80) || fallback;
}

const BACKUP_MANIFEST = 'manifest.json';
const BACKUP_ASSET_PATH = /^assets\/([a-f0-9]{64})\.txt$/;
const LEGACY_JSON_LIMIT_BYTES = 512 * 1024 * 1024;
const MAX_BACKUP_ENTRIES = 10_001;
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
const MAX_ARCHIVED_DATA_URL_BYTES = Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 1024;

function streamedZip(manifest: StoryProject, assets: StoredAsset[]): Blob {
  const chunks: Uint8Array[] = [];
  let failure: Error | undefined;
  const zip = new Zip((error, chunk) => {
    if (error) failure = error;
    else if (chunk?.length) chunks.push(chunk);
  });
  const add = (name: string, value: string) => {
    const stream = new ZipPassThrough(name);
    zip.add(stream);
    // Encode and release one entry at a time; images are individually capped.
    stream.push(new TextEncoder().encode(value), true);
    if (failure) throw failure;
  };
  add(BACKUP_MANIFEST, JSON.stringify(manifest));
  for (const asset of assets) add(`assets/${asset.id}.txt`, asset.dataUrl);
  zip.end();
  if (failure) throw failure;
  // fflate emits ordinary ArrayBuffer-backed Uint8Arrays accepted by Blob;
  // its generic type also permits SharedArrayBuffer, hence the narrow cast.
  return new Blob(chunks as unknown as BlobPart[], { type: 'application/vnd.storyboard+zip' });
}

/** Creates a portable archive whose image entries remain independently bounded. */
export async function createProjectBackup(project: StoryProject): Promise<ProjectBackup> {
  const safe = safeProject(project, 'Could not export project');
  try {
    const prepared = await prepareStoredProject(safe);
    const manifest = JSON.stringify(prepared.project);
    const manifestBytes = new Blob([manifest]).size;
    if (manifestBytes > MAX_MANIFEST_BYTES) throw new Error('project metadata exceeds the 16 MB archive manifest limit');
    if (prepared.assets.length + 1 > MAX_BACKUP_ENTRIES) throw new Error('the backup contains more than 10,000 distinct image assets');
    if (prepared.assets.some((asset) => asset.dataUrl.length > MAX_ARCHIVED_DATA_URL_BYTES)) {
      throw new Error('an image asset exceeds the portable archive entry limit');
    }
    const expandedBytes = manifestBytes
      + prepared.assets.reduce((sum, asset) => sum + asset.dataUrl.length, 0);
    if (expandedBytes > PORTABLE_BACKUP_LIMIT_BYTES) {
      throw new Error('the backup exceeds the 2 GB portable archive limit; remove image versions before exporting');
    }
    const blob = streamedZip(prepared.project, prepared.assets);
    if (blob.size > PORTABLE_BACKUP_LIMIT_BYTES) {
      throw new Error('the backup exceeds the 2 GB portable archive limit; remove image versions before exporting');
    }
    return {
      blob,
      filename: `${filenamePart(safe.name, 'storyboard')}.storyboard`,
      bytes: blob.size,
    };
  } catch (error) {
    throw new Error(`Could not export project: ${message(error)}`);
  }
}

/**
 * Compatibility wrapper for direct backup downloads. A click is a request to
 * the browser, not proof that a file reached disk; callers needing feedback can
 * use createProjectBackup plus prepareBlobDownload to present a retained link.
 */
export async function exportProject(project: StoryProject): Promise<void> {
  const backup = await createProjectBackup(project);
  const download = prepareBlobDownload(backup.blob, backup.filename);
  download.triggerDownload();
  download.release();
}

async function importArchive(file: File): Promise<StoryProject> {
  const entries = new Map<string, string>();
  const entryNames = new Set<string>();
  let totalBytes = 0;
  let entryCount = 0;
  let archiveError: Error | undefined;
  const unzip = new Unzip((entry) => {
    entryCount += 1;
    if (entryCount > MAX_BACKUP_ENTRIES || (entry.name !== BACKUP_MANIFEST && !BACKUP_ASSET_PATH.test(entry.name))) {
      archiveError = new Error(`unsafe or excessive archive entry '${entry.name}'`);
      return;
    }
    if (entryNames.has(entry.name)) {
      archiveError = new Error(`duplicate archive entry '${entry.name}'`);
      return;
    }
    entryNames.add(entry.name);
    const chunks: Uint8Array[] = [];
    let entryBytes = 0;
    entry.ondata = (error, chunk, final) => {
      if (error) archiveError = error;
      if (chunk?.length) {
        totalBytes += chunk.length;
        entryBytes += chunk.length;
        if (totalBytes > PORTABLE_BACKUP_LIMIT_BYTES) archiveError = new Error('expanded archive exceeds the 2 GB portable limit');
        const entryLimit = entry.name === BACKUP_MANIFEST ? MAX_MANIFEST_BYTES : MAX_ARCHIVED_DATA_URL_BYTES;
        if (entryBytes > entryLimit) archiveError = new Error(`archive entry '${entry.name}' exceeds its size limit`);
        if (!archiveError) chunks.push(chunk);
      }
      if (!error && !archiveError && final) entries.set(entry.name, new TextDecoder().decode(joinBytes(chunks)));
    };
    entry.start();
  });
  unzip.register(UnzipPassThrough);
  unzip.register(UnzipInflate);
  const reader = file.stream().getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (archiveError) {
      await reader.cancel();
      throw archiveError;
    }
    unzip.push(value ?? new Uint8Array(), done);
    if (done) break;
  }
  if (archiveError) throw archiveError;
  const manifest = entries.get(BACKUP_MANIFEST);
  if (!manifest) throw new Error('archive is missing manifest.json');
  let stored: StoryProject;
  try { stored = JSON.parse(manifest) as StoryProject; }
  catch (error) { throw new Error(`manifest.json is not valid JSON (${message(error)})`); }
  const ids = assetIdsInStoredProject(stored);
  const assets = new Map<string, string>();
  for (const id of ids) {
    const dataUrl = entries.get(`assets/${id}.txt`);
    if (!dataUrl) throw new Error(`archive is missing image asset '${id}'`);
    if (await hashDataUrl(dataUrl) !== id) throw new Error(`image asset '${id}' failed its integrity check`);
    assets.set(id, dataUrl);
  }
  const expectedEntries = new Set([BACKUP_MANIFEST, ...ids.map((id) => `assets/${id}.txt`)]);
  for (const name of entryNames) if (!expectedEntries.has(name)) throw new Error(`archive contains unreferenced entry '${name}'`);
  return safeProject(replaceImageData(stored, (value) => value.startsWith(ASSET_PREFIX)
    ? assets.get(value.slice(ASSET_PREFIX.length)) ?? value : value), `Could not import project '${file.name}'`);
}

function joinBytes(parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { joined.set(part, offset); offset += part.length; }
  return joined;
}

/** Reads current archives and legacy JSON backups without writing local storage. */
export async function importProject(file: File): Promise<StoryProject> {
  if (!file || typeof file.text !== 'function') throw new Error('Could not import project: choose a storyboard backup file.');
  if (file.size > PORTABLE_BACKUP_LIMIT_BYTES) {
    throw new Error(`Could not import project: '${file.name}' exceeds the 2 GB portable archive limit.`);
  }
  if (typeof file.slice === 'function') {
    const signature = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    if (signature[0] === 0x50 && signature[1] === 0x4b) return importArchive(file);
  }
  if (file.size > LEGACY_JSON_LIMIT_BYTES) throw new Error(`Could not import project: legacy JSON backups are limited to 512 MB; use the .storyboard archive format for larger projects.`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch (error) {
    throw new Error(`Could not import project: '${file.name}' is not valid JSON (${message(error)}).`);
  }
  return safeProject(parsed, `Could not import project '${file.name}'`);
}

/** Converts a supported image to a portable data URL suitable for JSON backups. */
export function imageFileToDataUrl(file: File): Promise<string> {
  if (!file || typeof file.size !== 'number') {
    return Promise.reject(new Error('Choose an image file to upload.'));
  }
  const type = file.type.toLowerCase();
  if (!ACCEPTED_IMAGE_TYPES.has(type)) {
    return Promise.reject(new Error(`'${file.name || 'Selected file'}' is not a supported image. Use PNG, JPEG, WebP, GIF, or AVIF.`));
  }
  if (file.size === 0) return Promise.reject(new Error(`'${file.name || 'Selected file'}' is empty.`));
  if (file.size > MAX_IMAGE_BYTES) {
    return Promise.reject(new Error(`'${file.name || 'Selected file'}' exceeds the 20 MB image limit.`));
  }
  if (typeof FileReader === 'undefined') return Promise.reject(browserError('Image uploads'));

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read '${file.name || 'selected image'}': ${message(reader.error)}`));
    reader.onload = async () => {
      if (typeof reader.result !== 'string' || !reader.result.startsWith(`data:${type}`)) {
        reject(new Error(`Could not read '${file.name || 'selected image'}' as an image.`));
        return;
      }
      try {
        await ensureDecodableImage(reader.result, file.name || 'selected image');
        resolve(reader.result);
      } catch (error) {
        reject(error);
      }
    };
    reader.readAsDataURL(file);
  });
}

function ensureDecodableImage(dataUrl: string, name: string): Promise<void> {
  if (typeof Image === 'undefined') return Promise.reject(browserError('Image validation'));
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const valid = image.naturalWidth > 0 && image.naturalHeight > 0;
      void (image.src = '');
      if (valid) resolve();
      else reject(new Error(`'${name}' does not contain a decodable image.`));
    };
    image.onerror = () => {
      void (image.src = '');
      reject(new Error(`'${name}' does not contain a decodable image.`));
    };
    image.src = dataUrl;
  });
}
