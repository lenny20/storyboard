import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  constants as fsConstants,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rmdir,
  stat,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { validateProject, type StoryProject } from '@/lib/storyboard/model';
import {
  FOLDER_ASSET_PREFIX,
  FOLDER_PROJECT_FORMAT,
  FOLDER_PROJECT_VERSION,
  MAX_FOLDER_IMAGE_BYTES,
  type FolderAssetDescriptor,
  type FolderProjectBinding,
  type FolderProjectDiagnostic,
  type FolderProjectManifest,
  type FolderProjectsResponse,
  type PendingFolderBinding,
} from './types';

const execFileAsync = promisify(execFile);
const MANIFEST_NAME = 'project.storyboard.json';
const ASSETS_DIRECTORY = 'images';
const REGISTRY_VERSION = 1;
const MAX_METADATA_BYTES = 10 * 1024 * 1024;
const TOKEN = /^asset:sha256:([a-f0-9]{64})\.(png|jpg|webp|gif|avif)$/;
const HASH = /^[a-f0-9]{64}$/;
const MIME_BY_EXTENSION = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
} as const;

type RegistryEntry = { projectId: string; path: string; registeredAt: string };
type Registry = {
  version: typeof REGISTRY_VERSION;
  projects: RegistryEntry[];
  forgottenProjectIds: string[];
};
type Pending = PendingFolderBinding & { createdAt: number };

export class FolderProjectError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = 'folder_project_error',
  ) {
    super(message);
    this.name = 'FolderProjectError';
  }
}

export class FolderProjectConflictError extends FolderProjectError {
  constructor(message: string) {
    super(message, 409, 'revision_conflict');
    this.name = 'FolderProjectConflictError';
  }
}

const pendingBindings = new Map<string, Pending>();
const projectQueues = new Map<string, Promise<void>>();
let registryQueue: Promise<void> = Promise.resolve();
let dataDirectoryOverride: string | null = null;

function appDataDirectory(): string {
  return dataDirectoryOverride ?? path.resolve(process.cwd(), '.local-data');
}

/** Test-only isolation hook. Production callers should use the default app data directory. */
export function configureFolderProjectStorageForTests(
  dataDirectory: string | null,
): void {
  if (dataDirectory !== null && !path.isAbsolute(dataDirectory)) {
    throw new Error('Folder project test data directory must be absolute.');
  }
  dataDirectoryOverride = dataDirectory;
  pendingBindings.clear();
  projectQueues.clear();
  registryQueue = Promise.resolve();
}

function registryPath(): string {
  return path.join(appDataDirectory(), 'project-folders.json');
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new FolderProjectError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string, max = 1000): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new FolderProjectError(`${label} is required.`);
  }
  if (value.length > max) throw new FolderProjectError(`${label} is too long.`);
  return value;
}

function absolutePath(value: unknown, label: string): string {
  const result = requiredString(value, label, 4096);
  if (!path.isAbsolute(result)) {
    throw new FolderProjectError(`${label} must be an absolute path.`);
  }
  if (result.includes('\0'))
    throw new FolderProjectError(`${label} is invalid.`);
  return path.normalize(result);
}

function safeFolderName(value: unknown): string {
  const name = requiredString(value, 'Project name', 120).trim();
  if (
    name === '.' ||
    name === '..' ||
    /[\\/:]/.test(name) ||
    name.includes('\0') ||
    /[. ]$/.test(name)
  ) {
    throw new FolderProjectError(
      'Project name contains characters that cannot be used in a folder name.',
    );
  }
  return name;
}

function assetPath(
  root: string,
  descriptor: Pick<FolderAssetDescriptor, 'hash' | 'extension'>,
): string {
  if (
    !HASH.test(descriptor.hash) ||
    !(descriptor.extension in MIME_BY_EXTENSION)
  ) {
    throw new FolderProjectError('Invalid image asset identifier.');
  }
  return path.join(
    root,
    ASSETS_DIRECTORY,
    `${descriptor.hash}.${descriptor.extension}`,
  );
}

function mimeForExtension(
  extension: FolderAssetDescriptor['extension'],
): FolderAssetDescriptor['mimeType'] {
  return MIME_BY_EXTENSION[extension];
}

function assertImageSignature(mimeType: string, bytes: Uint8Array): void {
  const okay =
    mimeType === 'image/png'
      ? bytes.length >= 8 &&
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4e &&
        bytes[3] === 0x47 &&
        bytes[4] === 0x0d &&
        bytes[5] === 0x0a &&
        bytes[6] === 0x1a &&
        bytes[7] === 0x0a
      : mimeType === 'image/jpeg'
        ? bytes.length >= 3 &&
          bytes[0] === 0xff &&
          bytes[1] === 0xd8 &&
          bytes[2] === 0xff
        : mimeType === 'image/webp'
          ? bytes.length >= 12 &&
            Buffer.from(bytes.subarray(0, 4)).toString('ascii') === 'RIFF' &&
            Buffer.from(bytes.subarray(8, 12)).toString('ascii') === 'WEBP'
          : mimeType === 'image/gif'
            ? bytes.length >= 6 &&
              ['GIF87a', 'GIF89a'].includes(
                Buffer.from(bytes.subarray(0, 6)).toString('ascii'),
              )
            : mimeType === 'image/avif'
              ? bytes.length >= 12 &&
                Buffer.from(bytes.subarray(4, 8)).toString('ascii') ===
                  'ftyp' &&
                Buffer.from(bytes.subarray(8, 12))
                  .toString('ascii')
                  .includes('avif')
              : false;
  if (!okay)
    throw new FolderProjectError(
      'The image bytes do not match the declared image type.',
    );
}

function assertMetadataSize(value: unknown): void {
  const bytes = Buffer.byteLength(JSON.stringify(value));
  if (bytes > MAX_METADATA_BYTES) {
    throw new FolderProjectError(
      'Project metadata is larger than 10 MB.',
      413,
      'metadata_too_large',
    );
  }
}

async function atomicJsonWrite(
  filePath: string,
  value: unknown,
): Promise<void> {
  const contents = serializeJson(value);
  const temporary = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, filePath);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function readRegistry(): Promise<Registry> {
  try {
    const parsed = JSON.parse(
      await readFile(registryPath(), 'utf8'),
    ) as unknown;
    const value = record(parsed, 'Folder project registry');
    if (value.version !== REGISTRY_VERSION || !Array.isArray(value.projects)) {
      throw new Error('unsupported registry format');
    }
    const projects = value.projects.map((entry, index) => {
      const item = record(entry, `Registry project ${index + 1}`);
      return {
        projectId: requiredString(item.projectId, 'Registry project id', 200),
        path: absolutePath(item.path, 'Registry project path'),
        registeredAt: requiredString(
          item.registeredAt,
          'Registry timestamp',
          100,
        ),
      };
    });
    const forgottenProjectIds = Array.isArray(value.forgottenProjectIds)
      ? value.forgottenProjectIds.map((id) =>
          requiredString(id, 'Forgotten project id', 200),
        )
      : [];
    return { version: REGISTRY_VERSION, projects, forgottenProjectIds };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return {
        version: REGISTRY_VERSION,
        projects: [],
        forgottenProjectIds: [],
      };
    throw new FolderProjectError(
      `Could not read the folder project registry: ${message(error)}`,
      500,
      'registry_error',
    );
  }
}

async function writeRegistry(registry: Registry): Promise<void> {
  await mkdir(appDataDirectory(), { recursive: true });
  await atomicJsonWrite(registryPath(), registry);
}

async function withRegistryLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = registryQueue.catch(() => undefined).then(operation);
  registryQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function registerProject(
  projectId: string,
  folderPath: string,
): Promise<void> {
  return withRegistryLock(async () => {
    const registry = await readRegistry();
    const conflicts = registry.projects.filter((entry) =>
      entry.projectId === projectId
        ? entry.path !== folderPath
        : entry.path === folderPath,
    );
    if (conflicts.length) {
      throw new FolderProjectConflictError(
        'That project id or folder is already registered to a different project.',
      );
    }
    const projects = registry.projects.filter(
      (entry) => entry.projectId !== projectId,
    );
    projects.push({
      projectId,
      path: folderPath,
      registeredAt: new Date().toISOString(),
    });
    await writeRegistry({
      version: REGISTRY_VERSION,
      projects,
      forgottenProjectIds: registry.forgottenProjectIds.filter(
        (id) => id !== projectId,
      ),
    });
  });
}

async function registeredPath(projectId: string): Promise<string> {
  const entry = (await readRegistry()).projects.find(
    (item) => item.projectId === projectId,
  );
  if (!entry)
    throw new FolderProjectError(
      'This project is no longer registered in the workspace.',
      404,
      'not_registered',
    );
  return canonicalProjectRoot(entry.path);
}

async function canonicalExistingDirectory(
  input: string,
  label: string,
): Promise<string> {
  let resolved: string;
  try {
    resolved = await realpath(input);
    if (!(await stat(resolved)).isDirectory())
      throw new Error('not a directory');
  } catch (error) {
    throw new FolderProjectError(
      `${label} could not be opened: ${message(error)}`,
      404,
      'missing_folder',
    );
  }
  return resolved;
}

async function canonicalProjectRoot(input: string): Promise<string> {
  const root = await canonicalExistingDirectory(input, 'Project folder');
  const imageDirectory = path.join(root, ASSETS_DIRECTORY);
  try {
    const imageRealPath = await realpath(imageDirectory);
    if (
      path.dirname(imageRealPath) !== root ||
      !(await stat(imageRealPath)).isDirectory()
    ) {
      throw new Error(
        'images must be a real directory inside the project folder',
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new FolderProjectError(
        `Project image folder is unsafe: ${message(error)}`,
        400,
        'unsafe_folder',
      );
    }
  }
  return root;
}

async function safeExistingAssetPath(
  root: string,
  descriptor: Pick<FolderAssetDescriptor, 'hash' | 'extension'>,
): Promise<string> {
  const imageDirectory = path.join(root, ASSETS_DIRECTORY);
  const actualImageDirectory = await realpath(imageDirectory);
  if (actualImageDirectory !== imageDirectory) {
    throw new FolderProjectError(
      'Project image folder resolves outside the project.',
      400,
      'unsafe_folder',
    );
  }
  const actualAsset = await realpath(assetPath(root, descriptor));
  if (path.dirname(actualAsset) !== actualImageDirectory) {
    throw new FolderProjectError(
      'Project image asset resolves outside the image folder.',
      400,
      'unsafe_folder',
    );
  }
  return actualAsset;
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

function parseAssetToken(value: string): {
  hash: string;
  extension: FolderAssetDescriptor['extension'];
} {
  const match = TOKEN.exec(value);
  if (!match)
    throw new FolderProjectError(
      'Project metadata contains an invalid or remote image reference.',
    );
  return {
    hash: match[1],
    extension: match[2] as FolderAssetDescriptor['extension'],
  };
}

function validateMetadataProject(value: unknown): StoryProject {
  assertMetadataSize(value);
  const raw = record(value, 'Project metadata');
  requiredString(raw.id, 'Project id', 200);
  if (!Array.isArray(raw.references) || !Array.isArray(raw.scenes)) {
    throw new FolderProjectError(
      'Project metadata has an invalid document shape.',
    );
  }
  const project = value as StoryProject;
  try {
    projectImageValues(project).forEach(parseAssetToken);
    const validationCopy = replaceProjectImages(project, (token) => {
      const { extension } = parseAssetToken(token);
      return `data:${mimeForExtension(extension)};base64,AQ==`;
    });
    validateProject(validationCopy);
  } catch (error) {
    if (error instanceof FolderProjectError) throw error;
    throw new FolderProjectError(
      `Project metadata has an invalid document shape: ${message(error)}`,
    );
  }
  return project;
}

function validateDescriptor(value: unknown): FolderAssetDescriptor {
  const raw = record(value, 'Image asset');
  const hash = requiredString(raw.hash, 'Image hash', 64);
  const extension = requiredString(
    raw.extension,
    'Image extension',
    8,
  ) as FolderAssetDescriptor['extension'];
  const mimeType = requiredString(
    raw.mimeType,
    'Image MIME type',
    40,
  ) as FolderAssetDescriptor['mimeType'];
  const bytes = raw.bytes;
  if (
    !HASH.test(hash) ||
    !(extension in MIME_BY_EXTENSION) ||
    mimeForExtension(extension) !== mimeType
  ) {
    throw new FolderProjectError('Image asset metadata is invalid.');
  }
  if (
    !Number.isInteger(bytes) ||
    (bytes as number) <= 0 ||
    (bytes as number) > MAX_FOLDER_IMAGE_BYTES
  ) {
    throw new FolderProjectError('Image asset size is invalid.');
  }
  return { hash, extension, mimeType, bytes: bytes as number };
}

async function readManifest(
  folderPath: string,
  hydrate = true,
  verifyAssets = true,
): Promise<FolderProjectManifest & { manifestDigest: string }> {
  const root = await canonicalProjectRoot(folderPath);
  const manifestPath = path.join(root, MANIFEST_NAME);
  let parsed: unknown;
  let manifestDigest: string;
  try {
    const actualManifestPath = await realpath(manifestPath);
    if (path.dirname(actualManifestPath) !== root) {
      throw new Error('manifest resolves outside the project folder');
    }
    const contents = await readFile(actualManifestPath, 'utf8');
    parsed = JSON.parse(contents);
    manifestDigest = createHash('sha256').update(contents).digest('hex');
  } catch (error) {
    throw new FolderProjectError(
      `Could not read ${MANIFEST_NAME}: ${message(error)}`,
      404,
      'missing_manifest',
    );
  }
  const raw = record(parsed, 'Project manifest');
  if (
    raw.format !== FOLDER_PROJECT_FORMAT ||
    raw.formatVersion !== FOLDER_PROJECT_VERSION ||
    !Number.isInteger(raw.revision) ||
    (raw.revision as number) < 1
  ) {
    throw new FolderProjectError(
      'The folder contains an unsupported or invalid storyboard manifest.',
    );
  }
  const assetsRaw = record(raw.assets, 'Project asset index');
  const assets: FolderProjectManifest['assets'] = {};
  for (const [hash, descriptorValue] of Object.entries(assetsRaw)) {
    const descriptor = validateDescriptor({
      ...record(descriptorValue, `Asset ${hash}`),
      hash,
    });
    assets[hash] = {
      extension: descriptor.extension,
      mimeType: descriptor.mimeType,
      bytes: descriptor.bytes,
    };
  }
  const metadataProject = validateMetadataProject(raw.project);
  const cache = new Map<string, string>();
  const hydrated = replaceProjectImages(metadataProject, (token) => token);
  for (const token of new Set(projectImageValues(metadataProject))) {
    const { hash, extension } = parseAssetToken(token);
    const descriptor = assets[hash];
    if (!descriptor || descriptor.mimeType !== mimeForExtension(extension)) {
      throw new FolderProjectError(
        `Image asset '${hash}' is missing from the manifest index.`,
        422,
        'missing_asset',
      );
    }
    if (!verifyAssets) {
      cache.set(token, token);
      continue;
    }
    const filePath = assetPath(root, { hash, extension });
    let bytes: Buffer;
    try {
      const actualPath = await safeExistingAssetPath(root, {
        hash,
        extension,
      });
      bytes = await readFile(actualPath);
    } catch (error) {
      throw new FolderProjectError(
        `Image asset '${path.basename(filePath)}' is missing or unsafe: ${message(error)}`,
        422,
        'missing_asset',
      );
    }
    if (
      bytes.byteLength !== descriptor.bytes ||
      createHash('sha256').update(bytes).digest('hex') !== hash
    ) {
      throw new FolderProjectError(
        `Image asset '${path.basename(filePath)}' does not match its manifest.`,
        422,
        'damaged_asset',
      );
    }
    assertImageSignature(descriptor.mimeType, bytes);
    cache.set(
      token,
      hydrate
        ? `data:${descriptor.mimeType};base64,${bytes.toString('base64')}`
        : token,
    );
  }
  const replaced = replaceProjectImages(
    hydrated,
    (token) => cache.get(token) ?? token,
  );
  const project = hydrate ? validateProject(replaced) : replaced;
  return {
    format: FOLDER_PROJECT_FORMAT,
    formatVersion: FOLDER_PROJECT_VERSION,
    revision: raw.revision as number,
    savedAt: requiredString(raw.savedAt, 'Manifest savedAt', 100),
    project,
    assets,
    manifestDigest,
  };
}

async function queueProject<T>(
  projectId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const prior = projectQueues.get(projectId) ?? Promise.resolve();
  const result = prior.catch(() => undefined).then(operation);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  projectQueues.set(projectId, tail);
  void tail.finally(() => {
    if (projectQueues.get(projectId) === tail) projectQueues.delete(projectId);
  });
  return result;
}

export async function listFolderProjects(): Promise<FolderProjectsResponse> {
  const registry = await readRegistry();
  const projects: FolderProjectBinding[] = [];
  const diagnostics: FolderProjectDiagnostic[] = [];
  for (const entry of registry.projects) {
    try {
      const root = await canonicalProjectRoot(entry.path);
      const manifest = await readManifest(root, false);
      if (manifest.project.id !== entry.projectId) {
        throw new FolderProjectError(
          'The registered folder now contains a different project.',
          409,
          'project_mismatch',
        );
      }
      projects.push({
        projectId: entry.projectId,
        path: root,
        revision: manifest.revision,
        manifestDigest: manifest.manifestDigest,
        project: manifest.project,
      });
    } catch (error) {
      diagnostics.push({
        projectId: entry.projectId,
        path: entry.path,
        message: message(error),
      });
    }
  }
  projects.sort((a, b) =>
    b.project.updatedAt.localeCompare(a.project.updatedAt),
  );
  return {
    projects,
    diagnostics,
    forgottenProjectIds: registry.forgottenProjectIds,
  };
}

export async function beginFolderProject(input: {
  parentPath: unknown;
  name: unknown;
  projectId: unknown;
}): Promise<PendingFolderBinding> {
  const parentInput = absolutePath(input.parentPath, 'Parent folder');
  const parent = await canonicalExistingDirectory(parentInput, 'Parent folder');
  const name = safeFolderName(input.name);
  const projectId = requiredString(input.projectId, 'Project id', 200);
  const folderPath = path.join(parent, name);
  if (path.dirname(folderPath) !== parent)
    throw new FolderProjectError(
      'Project folder resolves outside the selected parent.',
    );
  let createdRoot = false;
  try {
    await mkdir(folderPath, { recursive: false, mode: 0o700 });
    createdRoot = true;
    await mkdir(path.join(folderPath, ASSETS_DIRECTORY), {
      recursive: false,
      mode: 0o700,
    });
  } catch (error) {
    if (createdRoot) await rmdir(folderPath).catch(() => undefined);
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new FolderProjectConflictError(
        `A file or folder already exists at '${folderPath}'. Choose another project name or parent folder.`,
      );
    }
    throw new FolderProjectError(
      `Could not create the project folder: ${message(error)}`,
      500,
      'create_failed',
    );
  }
  const token = randomUUID();
  pendingBindings.set(token, {
    token,
    projectId,
    path: folderPath,
    createdAt: Date.now(),
  });
  return { token, projectId, path: folderPath };
}

function pendingPath(token: string, projectId: string): string | undefined {
  const pending = pendingBindings.get(token);
  if (
    !pending ||
    pending.projectId !== projectId ||
    Date.now() - pending.createdAt > 30 * 60_000
  )
    return undefined;
  return pending.path;
}

async function targetRoot(projectId: string, token?: string): Promise<string> {
  const pending = token ? pendingPath(token, projectId) : undefined;
  return pending ? canonicalProjectRoot(pending) : registeredPath(projectId);
}

export async function checkFolderAssets(input: {
  projectId: unknown;
  token?: unknown;
  assets: unknown;
}): Promise<{ missing: string[] }> {
  const projectId = requiredString(input.projectId, 'Project id', 200);
  const token =
    input.token === undefined
      ? undefined
      : requiredString(input.token, 'Binding token', 200);
  if (!Array.isArray(input.assets) || input.assets.length > 10_000)
    throw new FolderProjectError('Image asset list is invalid.');
  const descriptors = input.assets.map(validateDescriptor);
  const root = await targetRoot(projectId, token);
  const missing: string[] = [];
  for (const descriptor of descriptors) {
    try {
      const details = await stat(await safeExistingAssetPath(root, descriptor));
      if (!details.isFile() || details.size !== descriptor.bytes)
        missing.push(descriptor.hash);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        missing.push(descriptor.hash);
      else throw error;
    }
  }
  return { missing };
}

export async function writeFolderAsset(input: {
  projectId: unknown;
  token?: unknown;
  descriptor: unknown;
  bytes: Uint8Array;
}): Promise<{ created: boolean }> {
  const projectId = requiredString(input.projectId, 'Project id', 200);
  const token =
    input.token === undefined
      ? undefined
      : requiredString(input.token, 'Binding token', 200);
  const descriptor = validateDescriptor(input.descriptor);
  if (
    input.bytes.byteLength !== descriptor.bytes ||
    input.bytes.byteLength > MAX_FOLDER_IMAGE_BYTES
  ) {
    throw new FolderProjectError(
      'Uploaded image size does not match its metadata.',
      400,
      'asset_size_mismatch',
    );
  }
  assertImageSignature(descriptor.mimeType, input.bytes);
  if (
    createHash('sha256').update(input.bytes).digest('hex') !== descriptor.hash
  ) {
    throw new FolderProjectError(
      'Uploaded image hash does not match its metadata.',
      400,
      'asset_hash_mismatch',
    );
  }
  const root = await targetRoot(projectId, token);
  const destination = assetPath(root, descriptor);
  try {
    const existing = await readFile(
      await safeExistingAssetPath(root, descriptor),
    );
    if (
      existing.byteLength !== descriptor.bytes ||
      createHash('sha256').update(existing).digest('hex') !== descriptor.hash
    ) {
      throw new FolderProjectError(
        `Existing immutable image '${path.basename(destination)}' is damaged.`,
        422,
        'damaged_asset',
      );
    }
    return { created: false };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const temporary = path.join(
    path.dirname(destination),
    `.${descriptor.hash}.${randomUUID()}.tmp`,
  );
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(input.bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, destination);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      return { created: false };
    throw error;
  }
  return { created: true };
}

export async function saveFolderProject(input: {
  projectId: unknown;
  token?: unknown;
  expectedRevision: unknown;
  expectedManifestDigest?: unknown;
  project: unknown;
  assets: unknown;
}): Promise<FolderProjectBinding> {
  const projectId = requiredString(input.projectId, 'Project id', 200);
  const token =
    input.token === undefined
      ? undefined
      : requiredString(input.token, 'Binding token', 200);
  const expectedRevision = input.expectedRevision;
  if (
    expectedRevision !== null &&
    (!Number.isInteger(expectedRevision) || (expectedRevision as number) < 1)
  ) {
    throw new FolderProjectError(
      'Expected revision must be null for a new folder project or a positive integer.',
    );
  }
  const expectedManifestDigest =
    expectedRevision === null
      ? null
      : requiredString(
          input.expectedManifestDigest,
          'Expected manifest digest',
          64,
        );
  if (expectedManifestDigest !== null && !HASH.test(expectedManifestDigest)) {
    throw new FolderProjectError('Expected manifest digest is invalid.');
  }
  const metadataProject = validateMetadataProject(input.project);
  if (metadataProject.id !== projectId)
    throw new FolderProjectError('Project id does not match its metadata.');
  if (!Array.isArray(input.assets))
    throw new FolderProjectError('Project asset index is invalid.');
  const descriptors = (input.assets as unknown[]).map(validateDescriptor);
  const byHash = new Map(
    descriptors.map((descriptor) => [descriptor.hash, descriptor]),
  );
  for (const tokenValue of projectImageValues(metadataProject)) {
    const parsed = parseAssetToken(tokenValue);
    const descriptor = byHash.get(parsed.hash);
    if (!descriptor || descriptor.extension !== parsed.extension) {
      throw new FolderProjectError(
        `Image asset '${parsed.hash}' is absent from the save request.`,
        422,
        'missing_asset',
      );
    }
  }
  return queueProject(projectId, async () => {
    const root = await targetRoot(projectId, token);
    const manifestPath = path.join(root, MANIFEST_NAME);
    let revision = 0;
    let currentManifestDigest: string | null = null;
    try {
      const existing = await readManifest(root, false, false);
      revision = existing.revision;
      currentManifestDigest = existing.manifestDigest;
      if (existing.project.id !== projectId)
        throw new FolderProjectConflictError(
          'The folder contains a different project.',
        );
    } catch (error) {
      if (
        !(error instanceof FolderProjectError) ||
        error.code !== 'missing_manifest'
      )
        throw error;
    }
    if (
      expectedRevision === null
        ? revision !== 0
        : revision !== expectedRevision ||
          currentManifestDigest !== expectedManifestDigest
    ) {
      throw new FolderProjectConflictError(
        `The folder project changed on disk (expected revision ${String(expectedRevision)}, found ${revision || 'none'}). Reload it before saving.`,
      );
    }
    for (const descriptor of descriptors) {
      const file = assetPath(root, descriptor);
      try {
        const details = await stat(
          await safeExistingAssetPath(root, descriptor),
        );
        if (!details.isFile() || details.size !== descriptor.bytes) {
          throw new Error('size does not match');
        }
      } catch (error) {
        throw new FolderProjectError(
          `Image asset '${path.basename(file)}' is missing or incomplete: ${message(error)}`,
          422,
          'missing_asset',
        );
      }
    }
    const nextRevision = revision + 1;
    const assets = Object.fromEntries(
      descriptors.map(({ hash, extension, mimeType, bytes }) => [
        hash,
        { extension, mimeType, bytes },
      ]),
    );
    const manifest: FolderProjectManifest = {
      format: FOLDER_PROJECT_FORMAT,
      formatVersion: FOLDER_PROJECT_VERSION,
      revision: nextRevision,
      savedAt: new Date().toISOString(),
      project: metadataProject,
      assets,
    };
    if (token) await registerProject(projectId, root);
    await atomicJsonWrite(manifestPath, manifest);
    if (token) pendingBindings.delete(token);
    return {
      projectId,
      path: root,
      revision: nextRevision,
      manifestDigest: createHash('sha256')
        .update(serializeJson(manifest))
        .digest('hex'),
      project: metadataProject,
    };
  });
}

export async function openFolderProject(
  folderInput: unknown,
): Promise<FolderProjectBinding> {
  const root = await canonicalProjectRoot(
    absolutePath(folderInput, 'Project folder'),
  );
  const manifest = await readManifest(root, false);
  await registerProject(manifest.project.id, root);
  return {
    projectId: manifest.project.id,
    path: root,
    revision: manifest.revision,
    manifestDigest: manifest.manifestDigest,
    project: manifest.project,
  };
}

export async function forgetFolderProject(
  projectIdInput: unknown,
): Promise<void> {
  const projectId = requiredString(projectIdInput, 'Project id', 200);
  await withRegistryLock(async () => {
    const registry = await readRegistry();
    const projects = registry.projects.filter(
      (entry) => entry.projectId !== projectId,
    );
    if (projects.length === registry.projects.length)
      throw new FolderProjectError(
        'This folder project is not registered.',
        404,
        'not_registered',
      );
    await writeRegistry({
      version: REGISTRY_VERSION,
      projects,
      forgottenProjectIds: [
        ...new Set([...registry.forgottenProjectIds, projectId]),
      ],
    });
  });
}

export async function readFolderAsset(
  projectIdInput: unknown,
  hashInput: unknown,
  extensionInput: unknown,
): Promise<{ bytes: Buffer; mimeType: FolderAssetDescriptor['mimeType'] }> {
  const projectId = requiredString(projectIdInput, 'Project id', 200);
  const hash = requiredString(hashInput, 'Image hash', 64);
  const extension = requiredString(
    extensionInput,
    'Image extension',
    8,
  ) as FolderAssetDescriptor['extension'];
  if (!HASH.test(hash) || !(extension in MIME_BY_EXTENSION))
    throw new FolderProjectError('Invalid image asset identifier.');
  const root = await registeredPath(projectId);
  const manifest = await readManifest(root, false);
  if (
    manifest.project.id !== projectId ||
    !projectImageValues(manifest.project).includes(
      `${FOLDER_ASSET_PREFIX}${hash}.${extension}`,
    )
  ) {
    throw new FolderProjectError(
      'Image asset is not referenced by this project.',
      404,
      'missing_asset',
    );
  }
  const indexed = manifest.assets[hash];
  if (!indexed || indexed.mimeType !== mimeForExtension(extension))
    throw new FolderProjectError(
      'Image asset is absent from the manifest.',
      404,
      'missing_asset',
    );
  const bytes = await readFile(
    await safeExistingAssetPath(root, { hash, extension }),
  );
  if (
    bytes.byteLength !== indexed.bytes ||
    createHash('sha256').update(bytes).digest('hex') !== hash
  ) {
    throw new FolderProjectError(
      'Image asset changed after the project manifest was read.',
      422,
      'damaged_asset',
    );
  }
  assertImageSignature(indexed.mimeType, bytes);
  return { bytes, mimeType: indexed.mimeType };
}

/** Stores a paid/generated result immediately if the project is folder-bound. Callers should surface failures as warnings. */
export async function persistGeneratedImage(
  projectId: string,
  dataUrl: string,
): Promise<FolderAssetDescriptor | null> {
  try {
    await registeredPath(projectId);
  } catch (error) {
    if (error instanceof FolderProjectError && error.code === 'not_registered')
      return null;
    throw error;
  }
  const match =
    /^data:(image\/(?:png|jpeg|webp|gif|avif));base64,([A-Za-z0-9+/]*={0,2})$/i.exec(
      dataUrl,
    );
  if (!match)
    throw new FolderProjectError(
      'Generated image is not a supported base64 image.',
    );
  const mimeType = match[1].toLowerCase() as FolderAssetDescriptor['mimeType'];
  const extension = (
    mimeType === 'image/jpeg' ? 'jpg' : mimeType.slice(6)
  ) as FolderAssetDescriptor['extension'];
  const bytes = Buffer.from(match[2], 'base64');
  const descriptor: FolderAssetDescriptor = {
    hash: createHash('sha256').update(bytes).digest('hex'),
    extension,
    mimeType,
    bytes: bytes.byteLength,
  };
  await writeFolderAsset({ projectId, descriptor, bytes });
  return descriptor;
}

export async function chooseNativeFolder(
  purpose: unknown,
): Promise<{ path: string | null; available: boolean }> {
  if (purpose !== 'parent' && purpose !== 'project')
    throw new FolderProjectError('Folder chooser purpose is invalid.');
  if (process.platform === 'darwin') {
    try {
      const prompt =
        purpose === 'parent'
          ? 'Choose where to create the storyboard project'
          : 'Choose a storyboard project folder';
      const { stdout } = await execFileAsync(
        '/usr/bin/osascript',
        ['-e', `POSIX path of (choose folder with prompt "${prompt}")`],
        { timeout: 5 * 60_000, maxBuffer: 8192 },
      );
      return {
        path: await canonicalExistingDirectory(
          stdout.trim(),
          'Selected folder',
        ),
        available: true,
      };
    } catch (error) {
      if (
        (error as { code?: unknown }).code === 1 ||
        /User canceled/i.test(message(error))
      )
        return { path: null, available: true };
      throw new FolderProjectError(
        `Could not open the folder chooser: ${message(error)}`,
        500,
        'chooser_failed',
      );
    }
  }
  if (process.platform === 'linux') {
    for (const command of ['/usr/bin/zenity', '/usr/bin/kdialog']) {
      try {
        await stat(command);
        const args = command.endsWith('zenity')
          ? ['--file-selection', '--directory']
          : ['--getexistingdirectory'];
        const { stdout } = await execFileAsync(command, args, {
          timeout: 5 * 60_000,
          maxBuffer: 8192,
        });
        return {
          path: await canonicalExistingDirectory(
            stdout.trim(),
            'Selected folder',
          ),
          available: true,
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        if ((error as { code?: unknown }).code === 1)
          return { path: null, available: true };
        throw new FolderProjectError(
          `Could not open the folder chooser: ${message(error)}`,
          500,
          'chooser_failed',
        );
      }
    }
  }
  return { path: null, available: false };
}

export async function assertWritableFolder(
  folderInput: unknown,
): Promise<{ path: string }> {
  const folder = await canonicalExistingDirectory(
    absolutePath(folderInput, 'Folder'),
    'Folder',
  );
  try {
    await stat(folder);
    await import('node:fs/promises').then(({ access }) =>
      access(folder, fsConstants.R_OK | fsConstants.W_OK),
    );
  } catch (error) {
    throw new FolderProjectError(
      `Folder is not readable and writable: ${message(error)}`,
      403,
      'folder_permissions',
    );
  }
  return { path: folder };
}
