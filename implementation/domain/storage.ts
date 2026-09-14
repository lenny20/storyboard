import { type StoryProject, validateProject } from './model';

const DATABASE_NAME = 'storyboard-studio';
const DATABASE_VERSION = 1;
const PROJECT_STORE = 'projects';
const MAX_IMPORT_BYTES = 100 * 1024 * 1024;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']);

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

/** Returns local projects, newest first. Corrupt saved documents are reported rather than silently discarded. */
export async function listProjects(): Promise<StoryProject[]> {
  const database = await openDatabase();
  const transaction = database.transaction(PROJECT_STORE, 'readonly');
  const stored = await requestResult(transaction.objectStore(PROJECT_STORE).getAll(), 'Could not read local projects');
  await transactionDone(transaction, 'Could not read local projects');
  const projects = stored.map((item, index) => safeProject(item, `Saved project ${index + 1} is corrupt`));
  return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name));
}

async function saveNewest(project: StoryProject): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(PROJECT_STORE, 'readwrite');
  const store = transaction.objectStore(PROJECT_STORE);
  const existing = await requestResult(store.get(project.id), 'Could not check the saved project');

  if (existing !== undefined) {
    const existingProject = safeProject(existing, `Saved project '${project.id}' is corrupt`);
    if (existingProject.updatedAt > project.updatedAt) {
      transaction.abort();
      return;
    }
  }

  store.put(project);
  await transactionDone(transaction, 'Could not save the project');
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
 * Persists a validated copy. Saves and deletes for the same project execute in
 * call order; an older updatedAt can never replace a newer local revision.
 */
export function saveProject(project: StoryProject): Promise<void> {
  const safe = safeProject(project, 'Could not save project');
  return queueProjectOperation(safe.id, () => saveNewest(safe));
}

async function deleteStoredProject(id: string): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(PROJECT_STORE, 'readwrite');
  transaction.objectStore(PROJECT_STORE).delete(id);
  await transactionDone(transaction, 'Could not delete the project');
}

export function deleteProject(id: string): Promise<void> {
  if (typeof id !== 'string' || id.trim().length === 0) throw new Error('Could not delete project: a project id is required.');
  return queueProjectOperation(id, () => deleteStoredProject(id));
}

function downloadBlob(blob: Blob, filename: string): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') throw browserError('Downloading files');
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function filenamePart(value: string, fallback: string): string {
  const cleaned = value.trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '');
  return cleaned.slice(0, 80) || fallback;
}

/** Downloads a portable JSON backup, including embedded reference and panel images. */
export function exportProject(project: StoryProject): void {
  const safe = safeProject(project, 'Could not export project');
  try {
    const json = JSON.stringify(safe, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    if (blob.size > MAX_IMPORT_BYTES) {
      throw new Error('the backup exceeds the 100 MB portable-backup limit; remove image versions or export a smaller project');
    }
    downloadBlob(blob, `${filenamePart(safe.name, 'storyboard')}.storyboard.json`);
  } catch (error) {
    throw new Error(`Could not export project: ${message(error)}`);
  }
}

/** Reads and validates a portable JSON backup without writing it to local storage. */
export async function importProject(file: File): Promise<StoryProject> {
  if (!file || typeof file.text !== 'function') throw new Error('Could not import project: choose a JSON backup file.');
  if (file.size > MAX_IMPORT_BYTES) {
    throw new Error(`Could not import project: '${file.name}' exceeds the 100 MB backup limit.`);
  }
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
