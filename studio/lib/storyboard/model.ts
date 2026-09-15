/** The portable, local-first storyboard document format. */
export type ReferenceKind = 'character' | 'location' | 'prop' | 'style';

export interface ReferenceAsset {
  id: string;
  name: string;
  kind: ReferenceKind;
  dataUrl: string;
  mimeType: string;
  /** Optional per-project entity grouping, for example a character with several views. */
  groupId?: string;
  /** Human-readable view name within a group, for example “Front” or “Side”. */
  viewLabel?: string;
}

export interface ReferenceGroup {
  id: string;
  name: string;
  kind: ReferenceKind;
  notes: string;
}

export interface ImageTransform {
  fit: 'contain' | 'cover';
  /** Multiplier applied after the selected fit mode. */
  scale: number;
  /** Horizontal offset as a fraction of the frame width; positive moves right. */
  offsetX: number;
  /** Vertical offset as a fraction of the frame height; positive moves down. */
  offsetY: number;
  flipX: boolean;
  flipY: boolean;
}

export const DEFAULT_IMAGE_TRANSFORM: Readonly<ImageTransform> = {
  fit: 'contain',
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  flipX: false,
  flipY: false,
};

export interface ImageVersion {
  id: string;
  dataUrl: string;
  createdAt: string;
  label: string;
  prompt?: string;
  /** Frame presentation only. The original image data remains unchanged. */
  transform?: ImageTransform;
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
  /** Print layout only. Missing legacy values use the compact PDF artwork size. */
  pdfFullWidth?: boolean;
  /** Panel-specific direction. Missing values in legacy documents inherit the shot. */
  context?: string;
  dialogue?: string;
  camera?: string;
  notes?: string;
  /** Continue means the next panel remains within the same shot. */
  transition?: 'continue' | ShotTransition;
  /** Missing legacy selections inherit the shot; an empty array explicitly selects none. */
  referenceIds?: string[];
  referenceGroupIds?: string[];
  versions: ImageVersion[];
  selectedVersionId: string | null;
  markers: CompositionMarker[];
  arrows: PanelArrow[];
  /** Pinned image versions from panels that preceded this panel when selected. */
  previousPanelReferences?: PreviousPanelReference[];
}

export interface PreviousPanelReference {
  panelId: string;
  imageVersionId: string;
}

export const SHOT_TRANSITIONS = [
  'cut',
  'dissolve',
  'fade',
  'wipe',
  'match-cut',
] as const;
export type ShotTransition = (typeof SHOT_TRANSITIONS)[number];

export const SHOT_CONNECTION_TYPES = SHOT_TRANSITIONS;
export const PANEL_CONNECTION_TYPES = [
  'static',
  'dolly',
  'pan',
  'tilt',
  'truck',
  'pedestal',
  'zoom',
  'orbit',
  'aerial',
  'custom',
] as const;
export type PanelConnectionType = (typeof PANEL_CONNECTION_TYPES)[number];

/** Direction attached to a stable pair of timeline item ids. */
export interface TimelineConnection {
  fromId: string;
  toId: string;
  type: string;
  description: string;
  /** Shot boundaries may carry an independent camera movement. */
  movement?: string;
  movementDescription?: string;
}

export interface Shot {
  id: string;
  title: string;
  description: string;
  dialogue: string;
  action: string;
  camera: string;
  /** Editorial transition after this shot. Missing legacy values mean a cut. */
  transition?: ShotTransition;
  notes: string;
  referenceIds: string[];
  /** Group selections expand to every current and future view in that group. */
  referenceGroupIds?: string[];
  panels: Panel[];
  panelConnections?: TimelineConnection[];
}

export interface Scene {
  id: string;
  title: string;
  shots: Shot[];
  shotConnections?: TimelineConnection[];
}

/** An image the user picked from disk for the PDF cover page. */
export interface CoverImage {
  dataUrl: string;
  mimeType: string;
  /** The chosen file's name, shown beside the thumbnail in project settings. */
  label: string;
}

export interface StoryProject {
  schemaVersion: 1;
  id: string;
  name: string;
  aspectRatio: number;
  style: string;
  styleNotes: string;
  /** Cover page fields for the PDF export. All optional; empty values are omitted from the cover. */
  subtitle?: string;
  draftLabel?: string;
  director?: string;
  production?: string;
  contact?: string;
  /** Cover artwork chosen by the user. Absent means the cover uses the first selected artwork. */
  coverImage?: CoverImage;
  scenes: Scene[];
  references: ReferenceAsset[];
  referenceGroups?: ReferenceGroup[];
  createdAt: string;
  updatedAt: string;
}

const REFERENCE_KINDS: ReadonlySet<string> = new Set([
  'character',
  'location',
  'prop',
  'style',
]);
const SUPPORTED_IMAGE_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
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
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
      '',
    );
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
    style: 'Rough blocking sketch',
    styleNotes:
      'Professional one-to-two-minute storyboard thumbnail: confident, economical gesture and staging marks; primitive shapes and faceless mannequins; only enough detail to read the action; sparse backgrounds showing only major masses; loose, unfinished pencil with no rendering, shading, textures, fine features, colour, or detailed costumes. Keep characters recognisable through simple silhouettes and proportions.',
    subtitle: '',
    draftLabel: '',
    director: '',
    production: '',
    contact: '',
    scenes: [scene],
    references: [],
    referenceGroups: [],
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
    transition: 'cut',
    notes: '',
    referenceIds: [],
    referenceGroupIds: [],
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
    pdfFullWidth: false,
    context: '',
    dialogue: '',
    camera: '',
    notes: '',
    referenceIds: [],
    referenceGroupIds: [],
    versions: [],
    selectedVersionId: null,
    markers: [],
    arrows: [],
  };
}

export type PanelDetails = {
  context: string;
  dialogue: string;
  camera: string;
  notes: string;
  transition: 'continue' | ShotTransition;
  referenceIds: string[];
  referenceGroupIds: string[];
};

/** Resolves panel direction for both new independent panels and legacy shot-owned data. */
export function getPanelDetails(shot: Shot, panel: Panel): PanelDetails {
  const panelIndex = shot.panels.findIndex(
    (candidate) => candidate.id === panel.id,
  );
  const isFinal = panelIndex < 0 || panelIndex === shot.panels.length - 1;
  return {
    context: panel.context === undefined ? shot.description : panel.context,
    dialogue: panel.dialogue === undefined ? shot.dialogue : panel.dialogue,
    camera: panel.camera === undefined ? shot.camera : panel.camera,
    notes: panel.notes === undefined ? shot.notes : panel.notes,
    transition:
      panel.transition === undefined
        ? isFinal
          ? (shot.transition ?? 'cut')
          : 'continue'
        : panel.transition,
    referenceIds: panel.referenceIds ?? shot.referenceIds,
    referenceGroupIds: panel.referenceGroupIds ?? shot.referenceGroupIds ?? [],
  };
}

const connectionKey = (fromId: string, toId: string) => `${fromId}\0${toId}`;

/**
 * Folds a legacy `transitionNote` into a connection between the given endpoints: creates
 * one with the given default type when absent, or appends the note to an existing
 * non-empty description. Used only while migrating legacy documents on load.
 */
function upsertLegacyNote(
  connections: TimelineConnection[],
  fromId: string,
  toId: string,
  note: string,
  absentType: string,
): TimelineConnection[] {
  const key = connectionKey(fromId, toId);
  const index = connections.findIndex(
    (connection) => connectionKey(connection.fromId, connection.toId) === key,
  );
  if (index < 0) {
    return [...connections, { fromId, toId, type: absentType, description: note }];
  }
  const existing = connections[index];
  const description = existing.description.trim()
    ? `${existing.description} · ${note}`
    : note;
  return connections.map((connection, connectionIndex) =>
    connectionIndex === index ? { ...connection, description } : connection,
  );
}

function legacyPanelConnections(shot: Shot): TimelineConnection[] {
  return shot.panels.slice(0, -1).map((panel, index) => {
    const camera = getPanelDetails(shot, panel).camera.trim();
    return {
      fromId: panel.id,
      toId: shot.panels[index + 1].id,
      type: camera ? 'custom' : 'static',
      description: camera,
    };
  });
}

function legacyShotConnections(scene: Scene): TimelineConnection[] {
  return scene.shots.slice(0, -1).map((shot, index) => {
    const finalPanel = shot.panels.at(-1);
    const panelTransition = finalPanel?.transition;
    return {
      fromId: shot.id,
      toId: scene.shots[index + 1].id,
      type:
        panelTransition && panelTransition !== 'continue'
          ? panelTransition
          : (shot.transition ?? 'cut'),
      description: '',
      movement: 'static',
      movementDescription: '',
    };
  });
}

export function materializePanelConnections(shot: Shot): Shot {
  return shot.panelConnections === undefined
    ? { ...shot, panelConnections: legacyPanelConnections(shot) }
    : shot;
}

export function materializeShotConnections(scene: Scene): Scene {
  if (scene.shotConnections !== undefined) return scene;
  return {
    ...scene,
    shotConnections: legacyShotConnections(scene),
    shots: scene.shots.map(materializePanelConnections),
  };
}

export function getPanelConnection(
  shot: Shot,
  fromId: string,
  toId: string,
): TimelineConnection {
  const connections = shot.panelConnections ?? legacyPanelConnections(shot);
  return (
    connections.find(
      (connection) => connection.fromId === fromId && connection.toId === toId,
    ) ?? { fromId, toId, type: 'static', description: '' }
  );
}

export function getShotConnection(
  scene: Scene,
  fromId: string,
  toId: string,
): TimelineConnection {
  const connections = scene.shotConnections ?? legacyShotConnections(scene);
  const connection = connections.find(
    (candidate) => candidate.fromId === fromId && candidate.toId === toId,
  );
  return connection
    ? {
        ...connection,
        movement: connection.movement ?? 'static',
        movementDescription: connection.movementDescription ?? '',
      }
    : {
        fromId,
        toId,
        type: 'cut',
        description: '',
        movement: 'static',
        movementDescription: '',
      };
}

function upsertConnection(
  connections: TimelineConnection[],
  connection: TimelineConnection,
): TimelineConnection[] {
  const index = connections.findIndex(
    (candidate) =>
      candidate.fromId === connection.fromId &&
      candidate.toId === connection.toId,
  );
  if (index < 0) return [...connections, { ...connection }];
  return connections.map((candidate, candidateIndex) =>
    candidateIndex === index ? { ...connection } : candidate,
  );
}

export function setPanelConnection(
  shot: Shot,
  connection: TimelineConnection,
): Shot {
  return {
    ...shot,
    panelConnections: upsertConnection(
      shot.panelConnections ?? legacyPanelConnections(shot),
      connection,
    ),
  };
}

export function setShotConnection(
  scene: Scene,
  connection: TimelineConnection,
): Scene {
  return {
    ...scene,
    shotConnections: upsertConnection(
      scene.shotConnections ?? legacyShotConnections(scene),
      {
        ...connection,
        movement: connection.movement ?? 'static',
        movementDescription: connection.movementDescription ?? '',
      },
    ),
  };
}

function moveToTarget<T extends { id: string }>(
  items: T[],
  fromId: string,
  toId: string,
): T[] | undefined {
  const fromIndex = items.findIndex((item) => item.id === fromId);
  const toIndex = items.findIndex((item) => item.id === toId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return undefined;
  const result = [...items];
  const [item] = result.splice(fromIndex, 1);
  result.splice(toIndex, 0, item);
  return result;
}

export function reorderPanels(shot: Shot, fromId: string, toId: string): Shot {
  const panels = moveToTarget(shot.panels, fromId, toId);
  if (!panels) return shot;
  return {
    ...shot,
    panels,
    panelConnections: shot.panelConnections ?? legacyPanelConnections(shot),
  };
}

export function reorderShots(
  scene: Scene,
  fromId: string,
  toId: string,
): Scene {
  const shots = moveToTarget(scene.shots, fromId, toId);
  if (!shots) return scene;
  const materializedShots = scene.shots.map((shot) =>
    shot.panelConnections === undefined
      ? { ...shot, panelConnections: legacyPanelConnections(shot) }
      : shot,
  );
  const byId = new Map(materializedShots.map((shot) => [shot.id, shot]));
  const reordered = shots.map((shot) => byId.get(shot.id)!);
  return {
    ...scene,
    shots: reordered,
    shotConnections: scene.shotConnections ?? legacyShotConnections(scene),
  };
}

/** Starts a following shot after a panel without cloning its nested artwork. */
export function splitShotAfterPanel(
  scene: Scene,
  shotId: string,
  panelId: string,
): Scene {
  const shotIndex = scene.shots.findIndex((shot) => shot.id === shotId);
  if (shotIndex < 0) return scene;
  const shot = scene.shots[shotIndex];
  const panelIndex = shot.panels.findIndex((panel) => panel.id === panelId);
  if (panelIndex < 0 || panelIndex === shot.panels.length - 1) return scene;

  const selected = shot.panels[panelIndex];
  const materializedScene = materializeShotConnections(scene);
  const materializedShot = materializePanelConnections(
    materializedScene.shots[shotIndex],
  );
  const boundary = getPanelConnection(
    materializedShot,
    selected.id,
    shot.panels[panelIndex + 1].id,
  );
  const outgoing =
    selected.transition === undefined || selected.transition === 'continue'
      ? { ...selected, transition: 'cut' as const }
      : selected;
  const nextShot: Shot = {
    ...materializedShot,
    id: newId(),
    title: `${shot.title} — next shot`,
    referenceIds: [...shot.referenceIds],
    referenceGroupIds: [...(shot.referenceGroupIds ?? [])],
    panels: materializedShot.panels.slice(panelIndex + 1),
    panelConnections: materializedShot.panelConnections?.filter(
      (connection) =>
        materializedShot.panels
          .slice(panelIndex + 1)
          .some((panel) => panel.id === connection.fromId) &&
        materializedShot.panels
          .slice(panelIndex + 1)
          .some((panel) => panel.id === connection.toId),
    ),
  };

  const headIds = new Set(
    materializedShot.panels.slice(0, panelIndex + 1).map(({ id }) => id),
  );
  const priorNextShot = materializedScene.shots[shotIndex + 1];
  let shotConnections = materializedScene.shotConnections!.map((connection) =>
    priorNextShot &&
    connection.fromId === shot.id &&
    connection.toId === priorNextShot.id
      ? { ...connection, fromId: nextShot.id }
      : connection,
  );
  shotConnections = upsertConnection(shotConnections, {
    fromId: shot.id,
    toId: nextShot.id,
    type:
      boundary && SHOT_TRANSITIONS.includes(boundary.type as ShotTransition)
        ? boundary.type
        : outgoing.transition === 'continue'
          ? 'cut'
          : (outgoing.transition ?? 'cut'),
    description: '',
    movement:
      boundary &&
      PANEL_CONNECTION_TYPES.includes(boundary.type as PanelConnectionType)
        ? boundary.type
        : 'static',
    movementDescription:
      boundary &&
      PANEL_CONNECTION_TYPES.includes(boundary.type as PanelConnectionType)
        ? boundary.description
        : '',
  });

  return {
    ...materializedScene,
    shotConnections,
    shots: [
      ...materializedScene.shots.slice(0, shotIndex),
      {
        ...materializedShot,
        panels: [...materializedShot.panels.slice(0, panelIndex), outgoing],
        panelConnections: materializedShot.panelConnections?.filter(
          (connection) =>
            headIds.has(connection.fromId) && headIds.has(connection.toId),
        ),
      },
      nextShot,
      ...materializedScene.shots.slice(shotIndex + 1),
    ],
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
  const panelIds = new Map(shot.panels.map((panel) => [panel.id, newId()]));
  const allVersionIds = new Map<string, string>();
  shot.panels.forEach((panel) =>
    panel.versions.forEach((version) => allVersionIds.set(version.id, newId())),
  );
  const result: Shot = {
    ...shot,
    id: newId(),
    referenceIds: [...shot.referenceIds],
    referenceGroupIds: [...(shot.referenceGroupIds ?? [])],
    panels: shot.panels.map((panel) => {
      const versions = panel.versions.map((version) => {
        const id = allVersionIds.get(version.id)!;
        return {
          ...version,
          id,
          ...(version.transform ? { transform: { ...version.transform } } : {}),
        };
      });
      return {
        ...panel,
        id: panelIds.get(panel.id)!,
        ...(panel.referenceIds === undefined
          ? {}
          : { referenceIds: [...panel.referenceIds] }),
        ...(panel.referenceGroupIds === undefined
          ? {}
          : { referenceGroupIds: [...panel.referenceGroupIds] }),
        versions,
        selectedVersionId: panel.selectedVersionId
          ? (allVersionIds.get(panel.selectedVersionId) ?? null)
          : null,
        ...(panel.previousPanelReferences === undefined
          ? {}
          : {
              previousPanelReferences: panel.previousPanelReferences.map(
                (reference) => {
                  const remappedPanelId = panelIds.get(reference.panelId);
                  const remappedVersionId = allVersionIds.get(
                    reference.imageVersionId,
                  );
                  return remappedPanelId && remappedVersionId
                    ? {
                        panelId: remappedPanelId,
                        imageVersionId: remappedVersionId,
                      }
                    : { ...reference };
                },
              ),
            }),
        markers: panel.markers.map((marker) => ({ ...marker, id: newId() })),
        arrows: panel.arrows.map((arrow) => ({ ...arrow, id: newId() })),
      };
    }),
    ...(shot.panelConnections === undefined
      ? {}
      : {
          panelConnections: shot.panelConnections.map((connection) => ({
            ...connection,
            fromId: panelIds.get(connection.fromId) ?? connection.fromId,
            toId: panelIds.get(connection.toId) ?? connection.toId,
          })),
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

function string(
  value: unknown,
  path: string,
  options: { allowEmpty?: boolean } = {},
): string {
  if (typeof value !== 'string') fail(path, 'expected a string');
  if (!options.allowEmpty && value.trim().length === 0)
    fail(path, 'must not be empty');
  return value;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, 'expected an array');
  return value;
}

function finite(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    fail(path, 'expected a finite number');
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
    fail(
      path,
      `data URL MIME type (${match[1]}) does not match mimeType (${expectedMime})`,
    );
  }
  const padding = match[2].endsWith('==') ? 2 : match[2].endsWith('=') ? 1 : 0;
  const bytes = Math.floor((match[2].length * 3) / 4) - padding;
  if (bytes <= 0) fail(path, 'must contain image data');
  if (bytes > MAX_EMBEDDED_IMAGE_BYTES)
    fail(path, 'exceeds the 20 MB embedded-image limit');
  return result;
}

function coverImage(value: unknown): CoverImage | undefined {
  if (value === undefined) return undefined;
  const path = '$.coverImage';
  const source = record(value, path);
  const mimeType = string(source.mimeType, `${path}.mimeType`);
  if (!SUPPORTED_IMAGE_MIME_TYPES.has(mimeType.toLowerCase())) {
    fail(`${path}.mimeType`, 'must be PNG, JPEG, WebP, GIF, or AVIF');
  }
  return {
    dataUrl: dataUrl(source.dataUrl, `${path}.dataUrl`, mimeType),
    mimeType,
    label: string(source.label, `${path}.label`, { allowEmpty: true }),
  };
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

function validatedConnections(
  value: unknown,
  path: string,
  endpointIds: Set<string>,
  types: readonly string[],
  allowMovement: boolean,
): TimelineConnection[] {
  const pairs = new Set<string>();
  return array(value, path).map((item, index) => {
    const itemPath = `${path}[${index}]`;
    const source = record(item, itemPath);
    const fromId = string(source.fromId, `${itemPath}.fromId`);
    const toId = string(source.toId, `${itemPath}.toId`);
    if (fromId === toId) fail(itemPath, 'must not link an item to itself');
    if (!endpointIds.has(fromId))
      fail(`${itemPath}.fromId`, 'does not refer to an endpoint');
    if (!endpointIds.has(toId))
      fail(`${itemPath}.toId`, 'does not refer to an endpoint');
    const key = connectionKey(fromId, toId);
    if (pairs.has(key)) fail(itemPath, 'duplicates a connection pair');
    pairs.add(key);
    const type = string(source.type, `${itemPath}.type`);
    if (!types.includes(type))
      fail(`${itemPath}.type`, `must be one of ${types.join(', ')}`);
    const description = string(source.description, `${itemPath}.description`, {
      allowEmpty: true,
    });
    if (!allowMovement) {
      return { fromId, toId, type, description };
    }
    const movement =
      source.movement === undefined
        ? undefined
        : string(source.movement, `${itemPath}.movement`);
    if (
      movement !== undefined &&
      !PANEL_CONNECTION_TYPES.includes(movement as PanelConnectionType)
    ) {
      fail(
        `${itemPath}.movement`,
        `must be one of ${PANEL_CONNECTION_TYPES.join(', ')}`,
      );
    }
    const movementDescription =
      source.movementDescription === undefined
        ? undefined
        : string(
            source.movementDescription,
            `${itemPath}.movementDescription`,
            { allowEmpty: true },
          );
    return {
      fromId,
      toId,
      type,
      description,
      ...(movement === undefined ? {} : { movement }),
      ...(movementDescription === undefined ? {} : { movementDescription }),
    };
  });
}

/**
 * Validates and copies an imported project. The returned value contains no
 * untrusted object references, so callers can safely mutate it after import.
 */
export function validateProject(value: unknown): StoryProject {
  const source = record(value, '$');
  if (source.schemaVersion !== 1)
    fail('$.schemaVersion', 'only schema version 1 is supported');

  const projectIds = new Set<string>();
  const projectId = uniqueId(string(source.id, '$.id'), projectIds, '$.id');
  const aspectRatio = finite(source.aspectRatio, '$.aspectRatio');
  if (aspectRatio <= 0 || aspectRatio > 10)
    fail('$.aspectRatio', 'must be greater than 0 and no more than 10');

  const referenceGroups =
    source.referenceGroups === undefined
      ? []
      : array(source.referenceGroups, '$.referenceGroups').map(
          (item, index): ReferenceGroup => {
            const path = `$.referenceGroups[${index}]`;
            const itemSource = record(item, path);
            const id = uniqueId(
              string(itemSource.id, `${path}.id`),
              projectIds,
              `${path}.id`,
            );
            const kind = string(itemSource.kind, `${path}.kind`);
            if (!REFERENCE_KINDS.has(kind))
              fail(
                `${path}.kind`,
                'must be character, location, prop, or style',
              );
            return {
              id,
              name: string(itemSource.name, `${path}.name`, {
                allowEmpty: true,
              }),
              kind: kind as ReferenceKind,
              notes: string(itemSource.notes, `${path}.notes`, {
                allowEmpty: true,
              }),
            };
          },
        );
  const referenceGroupIds = new Set(referenceGroups.map((group) => group.id));

  const references = array(source.references, '$.references').map(
    (item, index): ReferenceAsset => {
      const path = `$.references[${index}]`;
      const itemSource = record(item, path);
      const id = uniqueId(
        string(itemSource.id, `${path}.id`),
        projectIds,
        `${path}.id`,
      );
      const kind = string(itemSource.kind, `${path}.kind`);
      if (!REFERENCE_KINDS.has(kind))
        fail(`${path}.kind`, 'must be character, location, prop, or style');
      const mimeType = string(itemSource.mimeType, `${path}.mimeType`);
      if (!SUPPORTED_IMAGE_MIME_TYPES.has(mimeType.toLowerCase())) {
        fail(`${path}.mimeType`, 'must be PNG, JPEG, WebP, GIF, or AVIF');
      }
      const groupId = itemSource.groupId;
      if (groupId !== undefined && typeof groupId !== 'string')
        fail(`${path}.groupId`, 'expected a group id when present');
      if (typeof groupId === 'string' && !referenceGroupIds.has(groupId)) {
        fail(`${path}.groupId`, 'does not exist in referenceGroups');
      }
      const viewLabel = itemSource.viewLabel;
      if (viewLabel !== undefined && typeof viewLabel !== 'string')
        fail(`${path}.viewLabel`, 'expected a string when present');
      return {
        id,
        name: string(itemSource.name, `${path}.name`, { allowEmpty: true }),
        kind: kind as ReferenceKind,
        mimeType,
        dataUrl: dataUrl(itemSource.dataUrl, `${path}.dataUrl`, mimeType),
        ...(groupId === undefined ? {} : { groupId }),
        ...(viewLabel === undefined ? {} : { viewLabel }),
      };
    },
  );
  const referenceIds = new Set(references.map((reference) => reference.id));

  const scenes = array(source.scenes, '$.scenes').map(
    (scene, sceneIndex): Scene => {
      const scenePath = `$.scenes[${sceneIndex}]`;
      const sceneSource = record(scene, scenePath);
      const sceneId = uniqueId(
        string(sceneSource.id, `${scenePath}.id`),
        projectIds,
        `${scenePath}.id`,
      );
      /** Legacy per-panel `transitionNote` values that land on the scene's last shot's last
       * panel with no following shot (case c of the migration below). */
      const endingTransitionNotes: Array<{ shotIndex: number; note: string }> =
        [];
      const shots = array(sceneSource.shots, `${scenePath}.shots`).map(
        (shot, shotIndex): Shot => {
          const shotPath = `${scenePath}.shots[${shotIndex}]`;
          const shotSource = record(shot, shotPath);
          const shotId = uniqueId(
            string(shotSource.id, `${shotPath}.id`),
            projectIds,
            `${shotPath}.id`,
          );
          const selectedReferenceIds = array(
            shotSource.referenceIds,
            `${shotPath}.referenceIds`,
          ).map((id, refIndex) => {
            const referenceId = string(
              id,
              `${shotPath}.referenceIds[${refIndex}]`,
            );
            if (!referenceIds.has(referenceId))
              fail(
                `${shotPath}.referenceIds[${refIndex}]`,
                `does not exist in references`,
              );
            return referenceId;
          });
          if (
            new Set(selectedReferenceIds).size !== selectedReferenceIds.length
          ) {
            fail(
              `${shotPath}.referenceIds`,
              'contains a duplicate reference id',
            );
          }
          const selectedReferenceGroupIds =
            shotSource.referenceGroupIds === undefined
              ? []
              : array(
                  shotSource.referenceGroupIds,
                  `${shotPath}.referenceGroupIds`,
                ).map((id, groupIndex) => {
                  const groupId = string(
                    id,
                    `${shotPath}.referenceGroupIds[${groupIndex}]`,
                  );
                  if (!referenceGroupIds.has(groupId))
                    fail(
                      `${shotPath}.referenceGroupIds[${groupIndex}]`,
                      'does not exist in referenceGroups',
                    );
                  return groupId;
                });
          if (
            new Set(selectedReferenceGroupIds).size !==
            selectedReferenceGroupIds.length
          ) {
            fail(
              `${shotPath}.referenceGroupIds`,
              'contains a duplicate group id',
            );
          }
          const transition = shotSource.transition;
          if (
            transition !== undefined &&
            (typeof transition !== 'string' ||
              !SHOT_TRANSITIONS.includes(transition as ShotTransition))
          ) {
            fail(
              `${shotPath}.transition`,
              'must be cut, dissolve, fade, wipe, or match-cut when present',
            );
          }
          /** Legacy per-panel `transitionNote` values, captured for the migration below
           * without persisting the field itself. Parallel to `panels`, by panel index. */
          const legacyTransitionNotes: string[] = [];
          const panels = array(shotSource.panels, `${shotPath}.panels`).map(
            (panel, panelIndex): Panel => {
              const panelPath = `${shotPath}.panels[${panelIndex}]`;
              const panelSource = record(panel, panelPath);
              const panelId = uniqueId(
                string(panelSource.id, `${panelPath}.id`),
                projectIds,
                `${panelPath}.id`,
              );
              const versions = array(
                panelSource.versions,
                `${panelPath}.versions`,
              ).map((version, versionIndex): ImageVersion => {
                const versionPath = `${panelPath}.versions[${versionIndex}]`;
                const versionSource = record(version, versionPath);
                const id = uniqueId(
                  string(versionSource.id, `${versionPath}.id`),
                  projectIds,
                  `${versionPath}.id`,
                );
                const prompt = versionSource.prompt;
                if (prompt !== undefined && typeof prompt !== 'string')
                  fail(
                    `${versionPath}.prompt`,
                    'expected a string when present',
                  );
                const transformSource = versionSource.transform;
                let transform: ImageTransform | undefined;
                if (transformSource !== undefined) {
                  const value = record(
                    transformSource,
                    `${versionPath}.transform`,
                  );
                  if (value.fit !== 'contain' && value.fit !== 'cover')
                    fail(
                      `${versionPath}.transform.fit`,
                      'must be contain or cover',
                    );
                  const scale = finite(
                    value.scale,
                    `${versionPath}.transform.scale`,
                  );
                  if (scale < 0.1 || scale > 4)
                    fail(
                      `${versionPath}.transform.scale`,
                      'must be between 0.1 and 4',
                    );
                  const offsetX = finite(
                    value.offsetX,
                    `${versionPath}.transform.offsetX`,
                  );
                  const offsetY = finite(
                    value.offsetY,
                    `${versionPath}.transform.offsetY`,
                  );
                  if (offsetX < -1 || offsetX > 1)
                    fail(
                      `${versionPath}.transform.offsetX`,
                      'must be between -1 and 1',
                    );
                  if (offsetY < -1 || offsetY > 1)
                    fail(
                      `${versionPath}.transform.offsetY`,
                      'must be between -1 and 1',
                    );
                  if (typeof value.flipX !== 'boolean')
                    fail(
                      `${versionPath}.transform.flipX`,
                      'expected a boolean',
                    );
                  if (typeof value.flipY !== 'boolean')
                    fail(
                      `${versionPath}.transform.flipY`,
                      'expected a boolean',
                    );
                  transform = {
                    fit: value.fit,
                    scale,
                    offsetX,
                    offsetY,
                    flipX: value.flipX,
                    flipY: value.flipY,
                  };
                }
                return {
                  id,
                  dataUrl: dataUrl(
                    versionSource.dataUrl,
                    `${versionPath}.dataUrl`,
                  ),
                  createdAt: isoDate(
                    versionSource.createdAt,
                    `${versionPath}.createdAt`,
                  ),
                  label: string(versionSource.label, `${versionPath}.label`, {
                    allowEmpty: true,
                  }),
                  ...(prompt === undefined ? {} : { prompt }),
                  ...(transform === undefined ? {} : { transform }),
                };
              });
              const versionIds = new Set(versions.map((version) => version.id));
              const selectedVersionId = panelSource.selectedVersionId;
              if (
                selectedVersionId !== null &&
                typeof selectedVersionId !== 'string'
              ) {
                fail(
                  `${panelPath}.selectedVersionId`,
                  'expected a version id or null',
                );
              }
              if (
                typeof selectedVersionId === 'string' &&
                !versionIds.has(selectedVersionId)
              ) {
                fail(
                  `${panelPath}.selectedVersionId`,
                  'does not refer to a panel version',
                );
              }
              const markers = array(
                panelSource.markers,
                `${panelPath}.markers`,
              ).map((marker, markerIndex): CompositionMarker => {
                const markerPath = `${panelPath}.markers[${markerIndex}]`;
                const markerSource = record(marker, markerPath);
                const scale = finite(markerSource.scale, `${markerPath}.scale`);
                if (scale <= 0 || scale > 10)
                  fail(
                    `${markerPath}.scale`,
                    'must be greater than 0 and no more than 10',
                  );
                return {
                  id: uniqueId(
                    string(markerSource.id, `${markerPath}.id`),
                    projectIds,
                    `${markerPath}.id`,
                  ),
                  label: string(markerSource.label, `${markerPath}.label`, {
                    allowEmpty: true,
                  }),
                  x: normalized(markerSource.x, `${markerPath}.x`),
                  y: normalized(markerSource.y, `${markerPath}.y`),
                  scale,
                };
              });
              const arrows = array(
                panelSource.arrows,
                `${panelPath}.arrows`,
              ).map((arrow, arrowIndex): PanelArrow => {
                const arrowPath = `${panelPath}.arrows[${arrowIndex}]`;
                const arrowSource = record(arrow, arrowPath);
                const kind = string(arrowSource.kind, `${arrowPath}.kind`);
                if (kind !== 'camera' && kind !== 'action')
                  fail(`${arrowPath}.kind`, 'must be camera or action');
                return {
                  id: uniqueId(
                    string(arrowSource.id, `${arrowPath}.id`),
                    projectIds,
                    `${arrowPath}.id`,
                  ),
                  kind,
                  x1: normalized(arrowSource.x1, `${arrowPath}.x1`),
                  y1: normalized(arrowSource.y1, `${arrowPath}.y1`),
                  x2: normalized(arrowSource.x2, `${arrowPath}.x2`),
                  y2: normalized(arrowSource.y2, `${arrowPath}.y2`),
                  label: string(arrowSource.label, `${arrowPath}.label`, {
                    allowEmpty: true,
                  }),
                };
              });
              const previousPanelReferences =
                panelSource.previousPanelReferences === undefined
                  ? undefined
                  : array(
                      panelSource.previousPanelReferences,
                      `${panelPath}.previousPanelReferences`,
                    ).map((item, referenceIndex) => {
                      const referencePath = `${panelPath}.previousPanelReferences[${referenceIndex}]`;
                      const reference = record(item, referencePath);
                      return {
                        panelId: string(
                          reference.panelId,
                          `${referencePath}.panelId`,
                        ),
                        imageVersionId: string(
                          reference.imageVersionId,
                          `${referencePath}.imageVersionId`,
                        ),
                      };
                    });
              const panelText = (
                key: 'context' | 'dialogue' | 'camera' | 'notes' | 'action',
                legacyKey:
                  | 'description'
                  | 'dialogue'
                  | 'camera'
                  | 'notes'
                  | 'action',
              ) =>
                string(
                  panelSource[key] === undefined
                    ? shotSource[legacyKey]
                    : panelSource[key],
                  `${panelPath}.${key}`,
                  { allowEmpty: true },
                );
              const panelTransition = panelSource.transition;
              if (
                panelTransition !== undefined &&
                (typeof panelTransition !== 'string' ||
                  (panelTransition !== 'continue' &&
                    !SHOT_TRANSITIONS.includes(
                      panelTransition as ShotTransition,
                    )))
              ) {
                fail(
                  `${panelPath}.transition`,
                  'must be continue, cut, dissolve, fade, wipe, or match-cut when present',
                );
              }
              // Legacy `transitionNote` is validated for a clear error on malformed data,
              // then folded into panel/shot connections or the description (see below);
              // it is never written back onto the parsed panel.
              const panelTransitionNote =
                panelSource.transitionNote === undefined
                  ? ''
                  : string(
                      panelSource.transitionNote,
                      `${panelPath}.transitionNote`,
                      { allowEmpty: true },
                    );
              legacyTransitionNotes[panelIndex] = panelTransitionNote.trim();
              const pdfFullWidth = panelSource.pdfFullWidth;
              if (
                pdfFullWidth !== undefined &&
                typeof pdfFullWidth !== 'boolean'
              ) {
                fail(
                  `${panelPath}.pdfFullWidth`,
                  'expected a boolean when present',
                );
              }
              const panelReferenceIds =
                panelSource.referenceIds === undefined
                  ? [...selectedReferenceIds]
                  : array(
                      panelSource.referenceIds,
                      `${panelPath}.referenceIds`,
                    ).map((id, refIndex) => {
                      const referenceId = string(
                        id,
                        `${panelPath}.referenceIds[${refIndex}]`,
                      );
                      if (!referenceIds.has(referenceId))
                        fail(
                          `${panelPath}.referenceIds[${refIndex}]`,
                          'does not exist in references',
                        );
                      return referenceId;
                    });
              if (new Set(panelReferenceIds).size !== panelReferenceIds.length)
                fail(
                  `${panelPath}.referenceIds`,
                  'contains a duplicate reference id',
                );
              const panelReferenceGroupIds =
                panelSource.referenceGroupIds === undefined
                  ? [...selectedReferenceGroupIds]
                  : array(
                      panelSource.referenceGroupIds,
                      `${panelPath}.referenceGroupIds`,
                    ).map((id, groupIndex) => {
                      const groupId = string(
                        id,
                        `${panelPath}.referenceGroupIds[${groupIndex}]`,
                      );
                      if (!referenceGroupIds.has(groupId))
                        fail(
                          `${panelPath}.referenceGroupIds[${groupIndex}]`,
                          'does not exist in referenceGroups',
                        );
                      return groupId;
                    });
              if (
                new Set(panelReferenceGroupIds).size !==
                panelReferenceGroupIds.length
              )
                fail(
                  `${panelPath}.referenceGroupIds`,
                  'contains a duplicate group id',
                );
              const rawDescription = string(
                panelSource.description,
                `${panelPath}.description`,
                { allowEmpty: true },
              );
              // Legacy `action` is validated the same way as before removal, then folded
              // into the description (never written back as its own field).
              const legacyAction = panelText('action', 'action').trim();
              const description =
                legacyAction && !rawDescription.includes(legacyAction)
                  ? rawDescription.trim()
                    ? `${rawDescription.trim()}\n${legacyAction}`
                    : legacyAction
                  : rawDescription;
              return {
                id: panelId,
                title: string(panelSource.title, `${panelPath}.title`, {
                  allowEmpty: true,
                }),
                framing: string(panelSource.framing, `${panelPath}.framing`, {
                  allowEmpty: true,
                }),
                angle: string(panelSource.angle, `${panelPath}.angle`, {
                  allowEmpty: true,
                }),
                description,
                ...(pdfFullWidth === undefined ? {} : { pdfFullWidth }),
                context: panelText('context', 'description'),
                dialogue: panelText('dialogue', 'dialogue'),
                camera: panelText('camera', 'camera'),
                notes: panelText('notes', 'notes'),
                ...(panelTransition === undefined
                  ? {}
                  : {
                      transition: panelTransition as
                        | 'continue'
                        | ShotTransition,
                    }),
                referenceIds: panelReferenceIds,
                referenceGroupIds: panelReferenceGroupIds,
                versions,
                selectedVersionId,
                markers,
                arrows,
                ...(previousPanelReferences === undefined
                  ? {}
                  : { previousPanelReferences }),
              };
            },
          );
          const panelConnections =
            shotSource.panelConnections === undefined
              ? undefined
              : validatedConnections(
                  shotSource.panelConnections,
                  `${shotPath}.panelConnections`,
                  new Set(panels.map((panel) => panel.id)),
                  PANEL_CONNECTION_TYPES,
                  false,
                );
          // Migration: a legacy transitionNote on a panel that is not the shot's last
          // panel becomes (or extends) the panel connection to the next panel (case a).
          // A note on the last panel is resolved once the scene's shots are all known
          // (case b/c, below), so it is only collected here.
          const legacyNoteEntries = panels
            .map((panel, index) => ({
              panel,
              index,
              note: legacyTransitionNotes[index] ?? '',
            }))
            .filter((entry) => entry.note);
          const withinShotNotes = legacyNoteEntries.filter(
            (entry) => entry.index < panels.length - 1,
          );
          const endingNoteEntry = legacyNoteEntries.find(
            (entry) => entry.index === panels.length - 1,
          );
          let finalPanelConnections = panelConnections;
          if (withinShotNotes.length) {
            let connections = finalPanelConnections ?? [];
            for (const { panel, index, note } of withinShotNotes) {
              connections = upsertLegacyNote(
                connections,
                panel.id,
                panels[index + 1].id,
                note,
                'static',
              );
            }
            finalPanelConnections = connections;
          }
          if (endingNoteEntry) {
            endingTransitionNotes.push({ shotIndex, note: endingNoteEntry.note });
          }
          return {
            id: shotId,
            title: string(shotSource.title, `${shotPath}.title`, {
              allowEmpty: true,
            }),
            description: string(
              shotSource.description,
              `${shotPath}.description`,
              { allowEmpty: true },
            ),
            dialogue: string(shotSource.dialogue, `${shotPath}.dialogue`, {
              allowEmpty: true,
            }),
            action: string(shotSource.action, `${shotPath}.action`, {
              allowEmpty: true,
            }),
            camera: string(shotSource.camera, `${shotPath}.camera`, {
              allowEmpty: true,
            }),
            ...(transition === undefined
              ? {}
              : { transition: transition as ShotTransition }),
            notes: string(shotSource.notes, `${shotPath}.notes`, {
              allowEmpty: true,
            }),
            referenceIds: selectedReferenceIds,
            referenceGroupIds: selectedReferenceGroupIds,
            panels,
            ...(finalPanelConnections === undefined
              ? {}
              : { panelConnections: finalPanelConnections }),
          };
        },
      );
      let shotConnections =
        sceneSource.shotConnections === undefined
          ? undefined
          : validatedConnections(
              sceneSource.shotConnections,
              `${scenePath}.shotConnections`,
              new Set(shots.map((shot) => shot.id)),
              SHOT_CONNECTION_TYPES,
              true,
            );
      // Migration, continued: a legacy transitionNote on a shot's last panel becomes
      // (or extends) the shot connection to the next shot (case b), or, when there is
      // no next shot, an "Ending cue" appended to that panel's description (case c).
      let finalShots = shots;
      for (const { shotIndex, note } of endingTransitionNotes) {
        if (shotIndex < finalShots.length - 1) {
          shotConnections = upsertLegacyNote(
            shotConnections ?? [],
            finalShots[shotIndex].id,
            finalShots[shotIndex + 1].id,
            note,
            'cut',
          );
        } else {
          finalShots = finalShots.map((shot, index) => {
            if (index !== shotIndex) return shot;
            const lastPanelIndex = shot.panels.length - 1;
            if (lastPanelIndex < 0) return shot;
            return {
              ...shot,
              panels: shot.panels.map((panel, panelIndex) =>
                panelIndex === lastPanelIndex
                  ? {
                      ...panel,
                      description: `${panel.description}\nEnding cue: ${note}`,
                    }
                  : panel,
              ),
            };
          });
        }
      }
      return {
        id: sceneId,
        title: string(sceneSource.title, `${scenePath}.title`, {
          allowEmpty: true,
        }),
        shots: finalShots,
        ...(shotConnections === undefined ? {} : { shotConnections }),
      };
    },
  );

  const cover = coverImage(source.coverImage);

  return {
    schemaVersion: 1,
    id: projectId,
    name: string(source.name, '$.name', { allowEmpty: true }),
    aspectRatio,
    style: string(source.style, '$.style', { allowEmpty: true }),
    styleNotes: string(source.styleNotes, '$.styleNotes', { allowEmpty: true }),
    subtitle:
      source.subtitle === undefined
        ? ''
        : string(source.subtitle, '$.subtitle', { allowEmpty: true }),
    draftLabel:
      source.draftLabel === undefined
        ? ''
        : string(source.draftLabel, '$.draftLabel', { allowEmpty: true }),
    director:
      source.director === undefined
        ? ''
        : string(source.director, '$.director', { allowEmpty: true }),
    production:
      source.production === undefined
        ? ''
        : string(source.production, '$.production', { allowEmpty: true }),
    contact:
      source.contact === undefined
        ? ''
        : string(source.contact, '$.contact', { allowEmpty: true }),
    ...(cover === undefined ? {} : { coverImage: cover }),
    scenes,
    references,
    referenceGroups,
    createdAt: isoDate(source.createdAt, '$.createdAt'),
    updatedAt: isoDate(source.updatedAt, '$.updatedAt'),
  };
}
