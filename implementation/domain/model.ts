/** The portable, local-first storyboard document format. */
export type ReferenceKind = 'character' | 'location' | 'prop' | 'style';

export interface ReferenceAsset {
  id: string;
  name: string;
  kind: ReferenceKind;
  dataUrl: string;
  mimeType: string;
}

export interface ImageVersion {
  id: string;
  dataUrl: string;
  createdAt: string;
  label: string;
  prompt?: string;
}

export interface CompositionMarker {
  id: string;
  label: string;
  x: number;
  y: number;
  scale: number;
}

export interface PanelArrow {
  id: string;
  kind: 'camera' | 'action';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label: string;
}

export interface Panel {
  id: string;
  title: string;
  framing: string;
  angle: string;
  description: string;
  versions: ImageVersion[];
  selectedVersionId: string | null;
  markers: CompositionMarker[];
  arrows: PanelArrow[];
}

export interface Shot {
  id: string;
  title: string;
  description: string;
  dialogue: string;
  action: string;
  camera: string;
  notes: string;
  referenceIds: string[];
  panels: Panel[];
}

export interface Scene {
  id: string;
  title: string;
  shots: Shot[];
}

export interface StoryProject {
  schemaVersion: 1;
  id: string;
  name: string;
  aspectRatio: number;
  style: string;
  styleNotes: string;
  scenes: Scene[];
  references: ReferenceAsset[];
  createdAt: string;
  updatedAt: string;
}

const REFERENCE_KINDS: ReadonlySet<string> = new Set(['character', 'location', 'prop', 'style']);
const SUPPORTED_IMAGE_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif',
]);
const BASE64_DATA_URL = /^data:([^;,\s]+);base64,([A-Za-z0-9+/]*={0,2})$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const MAX_EMBEDDED_IMAGE_BYTES = 20 * 1024 * 1024;

function now(): string {
  return new Date().toISOString();
}

/** Generates a browser-safe, collision-resistant id without relying on a server. */
export function newId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();

  if (cryptoApi?.getRandomValues) {
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  // Older browser fallback. Timestamp reduces collision likelihood where secure crypto is absent.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function createProject(name = 'Untitled storyboard'): StoryProject {
  const timestamp = now();
  const panel = createPanel('Panel 1');
  const shot = createShot('Shot 1');
  shot.panels.push(panel);
  const scene = createScene('Scene 1');
  scene.shots.push(shot);
  return {
    schemaVersion: 1,
    id: newId(),
    name,
    aspectRatio: 2.39,
    style: 'Rough pencil storyboard',
    styleNotes: '',
    scenes: [scene],
    references: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function createScene(title = 'Untitled scene'): Scene {
  return { id: newId(), title, shots: [] };
}

export function createShot(title = 'Untitled shot'): Shot {
  return {
    id: newId(),
    title,
    description: '',
    dialogue: '',
    action: '',
    camera: '',
    notes: '',
    referenceIds: [],
    panels: [],
  };
}

export function createPanel(title = 'Panel'): Panel {
  return {
    id: newId(),
    title,
    framing: '',
    angle: '',
    description: '',
    versions: [],
    selectedVersionId: null,
    markers: [],
    arrows: [],
  };
}

export function getSelectedImage(panel: Panel): ImageVersion | undefined {
  return panel.selectedVersionId
    ? panel.versions.find((version) => version.id === panel.selectedVersionId)
    : undefined;
}

/**
 * Makes a self-contained creative branch. All nested entities get new ids, while
 * image data and written direction remain unchanged.
 */
export function cloneShot(shot: Shot): Shot {
  const result: Shot = {
    ...shot,
    id: newId(),
    referenceIds: [...shot.referenceIds],
    panels: shot.panels.map((panel) => {
      const versionIds = new Map<string, string>();
      const versions = panel.versions.map((version) => {
        const id = newId();
        versionIds.set(version.id, id);
        return { ...version, id };
      });
      return {
        ...panel,
        id: newId(),
        versions,
        selectedVersionId: panel.selectedVersionId
          ? versionIds.get(panel.selectedVersionId) ?? null
          : null,
        markers: panel.markers.map((marker) => ({ ...marker, id: newId() })),
        arrows: panel.arrows.map((arrow) => ({ ...arrow, id: newId() })),
      };
    }),
  };
  return result;
}

class ProjectValidationError extends Error {
  constructor(path: string, message: string) {
    super(`Invalid storyboard project at ${path}: ${message}`);
    this.name = 'ProjectValidationError';
  }
}

function fail(path: string, message: string): never {
  throw new ProjectValidationError(path, message);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(path, 'expected an object');
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, path: string, options: { allowEmpty?: boolean } = {}): string {
  if (typeof value !== 'string') fail(path, 'expected a string');
  if (!options.allowEmpty && value.trim().length === 0) fail(path, 'must not be empty');
  return value;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, 'expected an array');
  return value;
}

function finite(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, 'expected a finite number');
  return value;
}

function normalized(value: unknown, path: string): number {
  const result = finite(value, path);
  if (result < 0 || result > 1) fail(path, 'must be between 0 and 1');
  return result;
}

function dataUrl(value: unknown, path: string, expectedMime?: string): string {
  const result = string(value, path);
  const match = BASE64_DATA_URL.exec(result);
  if (!match) fail(path, 'expected a base64 image data URL');
  if (match[2].length % 4 !== 0) fail(path, 'has malformed base64 image data');
  const mimeType = match[1].toLowerCase();
  if (!SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) {
    fail(path, 'must use PNG, JPEG, WebP, GIF, or AVIF image data');
  }
  if (expectedMime && match[1].toLowerCase() !== expectedMime.toLowerCase()) {
    fail(path, `data URL MIME type (${match[1]}) does not match mimeType (${expectedMime})`);
  }
  const padding = match[2].endsWith('==') ? 2 : match[2].endsWith('=') ? 1 : 0;
  const bytes = Math.floor((match[2].length * 3) / 4) - padding;
  if (bytes <= 0) fail(path, 'must contain image data');
  if (bytes > MAX_EMBEDDED_IMAGE_BYTES) fail(path, 'exceeds the 20 MB embedded-image limit');
  return result;
}

function isoDate(value: unknown, path: string): string {
  const result = string(value, path);
  if (!ISO_DATE.test(result) || Number.isNaN(Date.parse(result))) {
    fail(path, 'expected an ISO UTC date');
  }
  return result;
}

function uniqueId(id: string, ids: Set<string>, path: string): string {
  if (ids.has(id)) fail(path, `duplicate id '${id}'`);
  ids.add(id);
  return id;
}

/**
 * Validates and copies an imported project. The returned value contains no
 * untrusted object references, so callers can safely mutate it after import.
 */
export function validateProject(value: unknown): StoryProject {
  const source = record(value, '$');
  if (source.schemaVersion !== 1) fail('$.schemaVersion', 'only schema version 1 is supported');

  const projectIds = new Set<string>();
  const projectId = uniqueId(string(source.id, '$.id'), projectIds, '$.id');
  const aspectRatio = finite(source.aspectRatio, '$.aspectRatio');
  if (aspectRatio <= 0 || aspectRatio > 10) fail('$.aspectRatio', 'must be greater than 0 and no more than 10');

  const references = array(source.references, '$.references').map((item, index): ReferenceAsset => {
    const path = `$.references[${index}]`;
    const itemSource = record(item, path);
    const id = uniqueId(string(itemSource.id, `${path}.id`), projectIds, `${path}.id`);
    const kind = string(itemSource.kind, `${path}.kind`);
    if (!REFERENCE_KINDS.has(kind)) fail(`${path}.kind`, 'must be character, location, prop, or style');
    const mimeType = string(itemSource.mimeType, `${path}.mimeType`);
    if (!SUPPORTED_IMAGE_MIME_TYPES.has(mimeType.toLowerCase())) {
      fail(`${path}.mimeType`, 'must be PNG, JPEG, WebP, GIF, or AVIF');
    }
    return {
      id,
      name: string(itemSource.name, `${path}.name`, { allowEmpty: true }),
      kind: kind as ReferenceKind,
      mimeType,
      dataUrl: dataUrl(itemSource.dataUrl, `${path}.dataUrl`, mimeType),
    };
  });
  const referenceIds = new Set(references.map((reference) => reference.id));

  const scenes = array(source.scenes, '$.scenes').map((scene, sceneIndex): Scene => {
    const scenePath = `$.scenes[${sceneIndex}]`;
    const sceneSource = record(scene, scenePath);
    const sceneId = uniqueId(string(sceneSource.id, `${scenePath}.id`), projectIds, `${scenePath}.id`);
    const shots = array(sceneSource.shots, `${scenePath}.shots`).map((shot, shotIndex): Shot => {
      const shotPath = `${scenePath}.shots[${shotIndex}]`;
      const shotSource = record(shot, shotPath);
      const shotId = uniqueId(string(shotSource.id, `${shotPath}.id`), projectIds, `${shotPath}.id`);
      const selectedReferenceIds = array(shotSource.referenceIds, `${shotPath}.referenceIds`).map((id, refIndex) => {
        const referenceId = string(id, `${shotPath}.referenceIds[${refIndex}]`);
        if (!referenceIds.has(referenceId)) fail(`${shotPath}.referenceIds[${refIndex}]`, `does not exist in references`);
        return referenceId;
      });
      if (new Set(selectedReferenceIds).size !== selectedReferenceIds.length) {
        fail(`${shotPath}.referenceIds`, 'contains a duplicate reference id');
      }
      const panels = array(shotSource.panels, `${shotPath}.panels`).map((panel, panelIndex): Panel => {
        const panelPath = `${shotPath}.panels[${panelIndex}]`;
        const panelSource = record(panel, panelPath);
        const panelId = uniqueId(string(panelSource.id, `${panelPath}.id`), projectIds, `${panelPath}.id`);
        const versions = array(panelSource.versions, `${panelPath}.versions`).map((version, versionIndex): ImageVersion => {
          const versionPath = `${panelPath}.versions[${versionIndex}]`;
          const versionSource = record(version, versionPath);
          const id = uniqueId(string(versionSource.id, `${versionPath}.id`), projectIds, `${versionPath}.id`);
          const prompt = versionSource.prompt;
          if (prompt !== undefined && typeof prompt !== 'string') fail(`${versionPath}.prompt`, 'expected a string when present');
          return {
            id,
            dataUrl: dataUrl(versionSource.dataUrl, `${versionPath}.dataUrl`),
            createdAt: isoDate(versionSource.createdAt, `${versionPath}.createdAt`),
            label: string(versionSource.label, `${versionPath}.label`, { allowEmpty: true }),
            ...(prompt === undefined ? {} : { prompt }),
          };
        });
        const versionIds = new Set(versions.map((version) => version.id));
        const selectedVersionId = panelSource.selectedVersionId;
        if (selectedVersionId !== null && typeof selectedVersionId !== 'string') {
          fail(`${panelPath}.selectedVersionId`, 'expected a version id or null');
        }
        if (typeof selectedVersionId === 'string' && !versionIds.has(selectedVersionId)) {
          fail(`${panelPath}.selectedVersionId`, 'does not refer to a panel version');
        }
        const markers = array(panelSource.markers, `${panelPath}.markers`).map((marker, markerIndex): CompositionMarker => {
          const markerPath = `${panelPath}.markers[${markerIndex}]`;
          const markerSource = record(marker, markerPath);
          const scale = finite(markerSource.scale, `${markerPath}.scale`);
          if (scale <= 0 || scale > 10) fail(`${markerPath}.scale`, 'must be greater than 0 and no more than 10');
          return {
            id: uniqueId(string(markerSource.id, `${markerPath}.id`), projectIds, `${markerPath}.id`),
            label: string(markerSource.label, `${markerPath}.label`, { allowEmpty: true }),
            x: normalized(markerSource.x, `${markerPath}.x`),
            y: normalized(markerSource.y, `${markerPath}.y`),
            scale,
          };
        });
        const arrows = array(panelSource.arrows, `${panelPath}.arrows`).map((arrow, arrowIndex): PanelArrow => {
          const arrowPath = `${panelPath}.arrows[${arrowIndex}]`;
          const arrowSource = record(arrow, arrowPath);
          const kind = string(arrowSource.kind, `${arrowPath}.kind`);
          if (kind !== 'camera' && kind !== 'action') fail(`${arrowPath}.kind`, 'must be camera or action');
          return {
            id: uniqueId(string(arrowSource.id, `${arrowPath}.id`), projectIds, `${arrowPath}.id`),
            kind,
            x1: normalized(arrowSource.x1, `${arrowPath}.x1`),
            y1: normalized(arrowSource.y1, `${arrowPath}.y1`),
            x2: normalized(arrowSource.x2, `${arrowPath}.x2`),
            y2: normalized(arrowSource.y2, `${arrowPath}.y2`),
            label: string(arrowSource.label, `${arrowPath}.label`, { allowEmpty: true }),
          };
        });
        return {
          id: panelId,
          title: string(panelSource.title, `${panelPath}.title`, { allowEmpty: true }),
          framing: string(panelSource.framing, `${panelPath}.framing`, { allowEmpty: true }),
          angle: string(panelSource.angle, `${panelPath}.angle`, { allowEmpty: true }),
          description: string(panelSource.description, `${panelPath}.description`, { allowEmpty: true }),
          versions,
          selectedVersionId,
          markers,
          arrows,
        };
      });
      return {
        id: shotId,
        title: string(shotSource.title, `${shotPath}.title`, { allowEmpty: true }),
        description: string(shotSource.description, `${shotPath}.description`, { allowEmpty: true }),
        dialogue: string(shotSource.dialogue, `${shotPath}.dialogue`, { allowEmpty: true }),
        action: string(shotSource.action, `${shotPath}.action`, { allowEmpty: true }),
        camera: string(shotSource.camera, `${shotPath}.camera`, { allowEmpty: true }),
        notes: string(shotSource.notes, `${shotPath}.notes`, { allowEmpty: true }),
        referenceIds: selectedReferenceIds,
        panels,
      };
    });
    return { id: sceneId, title: string(sceneSource.title, `${scenePath}.title`, { allowEmpty: true }), shots };
  });

  return {
    schemaVersion: 1,
    id: projectId,
    name: string(source.name, '$.name', { allowEmpty: true }),
    aspectRatio,
    style: string(source.style, '$.style', { allowEmpty: true }),
    styleNotes: string(source.styleNotes, '$.styleNotes', { allowEmpty: true }),
    scenes,
    references,
    createdAt: isoDate(source.createdAt, '$.createdAt'),
    updatedAt: isoDate(source.updatedAt, '$.updatedAt'),
  };
}
