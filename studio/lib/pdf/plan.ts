import {
  getPanelConnection,
  getPanelDetails,
  getShotConnection,
  type Panel,
  type Scene,
  type Shot,
  type StoryProject,
  type TimelineConnection,
} from '../storyboard/model';
import {
  planCaption,
  ROW_GAP,
  SCENE_BAND_HEIGHT,
  SHOT_HEADING_SPACE_ABOVE,
  SHOT_HEADING_SPACE_BELOW,
  type CaptionPlan,
} from './blocks';
import {
  columnLeft,
  frameHeight as columnFrameHeight,
  fullFrameHeight,
  type PageGeometry,
} from './geometry';
import {
  labelTokens,
  planRail,
  type RailPlan,
  type RailSegmentInput,
} from './rails';
import { TYPE, type Fonts } from './theme';

/** Space between a shared row's small numerals and its frames. */
const SHARED_HEADING_GAP = 8;
export const SHARED_HEADING_HEIGHT =
  TYPE.shotNumeralShared.leading + SHARED_HEADING_GAP;
/** Space above a scene band, so its rule clears the captions before it. */
const SCENE_BAND_SPACE_ABOVE = 16;
/** A block that opens a scene sits close under the band that announced it. */
const AFTER_SCENE_BAND_SPACE = 12;

export const SHOT_HEADING_HEIGHT =
  TYPE.shotNumeral.leading + SHOT_HEADING_SPACE_BELOW;

export type ShotRef = {
  scene: Scene;
  shot: Shot;
  sceneNumber: number;
  shotNumber: number;
  /** `2.01`: scene number, then the shot number in two digits. */
  code: string;
  meta: string;
  letters: Map<string, string>;
};

export type FrameSlot = {
  panel: Panel | null;
  shotRef: ShotRef;
  letter: string;
  x: number;
  width: number;
  center: number;
  caption: CaptionPlan;
  /** A shared row carries a small numeral above each column instead of a heading. */
  heading: { code: string; meta: string } | null;
};

export type RowBlock = {
  kind: 'row';
  index: number;
  shotRefs: ShotRef[];
  frames: FrameSlot[];
  frameHeight: number;
  headingHeight: number;
  rail: RailPlan | null;
  spaceBefore: number;
  height: number;
};

export type SceneBandBlock = {
  kind: 'scene-band';
  scene: Scene;
  label: string;
  spaceBefore: number;
  height: number;
};

export type ShotHeadingBlock = {
  kind: 'shot-heading';
  shotRef: ShotRef;
  code: string;
  meta: string;
  spaceBefore: number;
  height: number;
};

export type NoShotsBlock = {
  kind: 'no-shots';
  spaceBefore: number;
  height: number;
};

export type CaptionOverflowBlock = {
  kind: 'caption-overflow';
  label: string;
  columns: { x: number; caption: CaptionPlan }[];
  spaceBefore: number;
  height: number;
};

export type Block =
  | SceneBandBlock
  | ShotHeadingBlock
  | RowBlock
  | NoShotsBlock
  | CaptionOverflowBlock;

/** Blocks that must stay on one page together, in order. */
export type Atom = {
  blocks: Block[];
  scene: Scene;
};

export type DocumentPlan = {
  atoms: Atom[];
  rows: RowBlock[];
  shotRefs: ShotRef[];
};

function isAutomatic(value: string, word: 'scene' | 'shot'): boolean {
  return new RegExp(`^${word}(?:\\s+\\d+)?$`, 'i').test(value.trim());
}

export function sceneLabel(scene: Scene, sceneNumber: number): string {
  const title = (scene.title ?? '').trim();
  const named = title && !isAutomatic(title, 'scene') ? ` · ${title}` : '';
  return `SCENE ${sceneNumber}${named}`;
}

function letterAt(index: number): string {
  let value = index;
  let output = '';
  do {
    output = String.fromCharCode(65 + (value % 26)) + output;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return output;
}

function shotMeta(shot: Shot): string {
  const panels = shot.panels;
  const count = `${panels.length} ${panels.length === 1 ? 'PANEL' : 'PANELS'}`;
  const connections = panels
    .slice(0, -1)
    .map((panel, index) =>
      getPanelConnection(shot, panel.id, panels[index + 1].id),
    );
  const moves = connections.some((connection) => connection.type !== 'static');
  // "Static camera" is only claimed when the director recorded it: every adjacent
  // pair has an explicit static connection and no panel carries a camera note.
  // Missing connection data says nothing about the camera.
  const explicit = new Set(
    (shot.panelConnections ?? []).map(
      (connection) => `${connection.fromId}\0${connection.toId}`,
    ),
  );
  const recordedStatic =
    connections.length > 0 &&
    connections.every((connection) =>
      explicit.has(`${connection.fromId}\0${connection.toId}`),
    );
  const quiet =
    recordedStatic &&
    panels.every((panel) => !getPanelDetails(shot, panel).camera.trim());
  const motion = moves ? 'CONTINUOUS' : quiet ? 'STATIC CAMERA' : '';
  const title = (shot.title ?? '').trim();
  const named = title && !isAutomatic(title, 'shot') ? title : '';
  return [count, motion, named].filter(Boolean).join(' · ');
}

function buildShotRef(
  scene: Scene,
  shot: Shot,
  sceneNumber: number,
  shotNumber: number,
): ShotRef {
  return {
    scene,
    shot,
    sceneNumber,
    shotNumber,
    code: `${sceneNumber}.${String(shotNumber).padStart(2, '0')}`,
    meta: shotMeta(shot),
    letters: new Map(
      shot.panels.map((panel, index) => [panel.id, letterAt(index)]),
    ),
  };
}

export type PlanInput = {
  project: StoryProject;
  scenes: Scene[];
  geometry: PageGeometry;
  fonts: Fonts;
  includeNotes: boolean;
  sceneBreaks: 'flow' | 'page';
};

function captionFor(
  shotRef: ShotRef,
  panel: Panel | null,
  letter: string,
  width: number,
  fonts: Fonts,
  includeNotes: boolean,
): CaptionPlan {
  if (!panel)
    return {
      letter: '',
      width,
      textWidth: width,
      lines: [],
      height: TYPE.panelLetter.leading,
    };
  const details = getPanelDetails(shotRef.shot, panel);
  return planCaption(
    {
      panel,
      letter,
      camera: details.camera,
      dialogue: details.dialogue,
      notes: details.notes,
    },
    width,
    fonts,
    includeNotes,
  );
}

function rowHeight(row: RowBlock): number {
  const captions = row.frames.reduce(
    (tallest, frame) => Math.max(tallest, frame.caption.height),
    0,
  );
  return (
    row.headingHeight + row.frameHeight + (row.rail?.height ?? 0) + captions
  );
}

/** Section 6: which connections draw, and with what label. */
function panelRailLabel(
  connection: TimelineConnection,
  fonts: Fonts,
): ReturnType<typeof labelTokens> | null {
  const description = (connection.description ?? '').trim();
  if (connection.type === 'static' && !description) return null;
  return labelTokens(
    [{ type: connection.type.replaceAll('-', ' ').toUpperCase(), description }],
    fonts,
  );
}

function shotRailLabel(
  connection: TimelineConnection,
  fonts: Fonts,
): ReturnType<typeof labelTokens> | null {
  const description = (connection.description ?? '').trim();
  const movement = connection.movement ?? 'static';
  const movementDescription = (connection.movementDescription ?? '').trim();
  const plainCut = connection.type === 'cut' && !description;
  const noMovement = movement === 'static' && !movementDescription;
  if (plainCut && noMovement) return null;
  const parts: { type: string; description: string }[] = [];
  if (!plainCut)
    parts.push({
      type: connection.type.replaceAll('-', ' ').toUpperCase(),
      description,
    });
  if (!noMovement)
    parts.push({
      type: movement.replaceAll('-', ' ').toUpperCase(),
      description: movementDescription,
    });
  return labelTokens(parts, fonts);
}

/** Builds every block of the document, with rails resolved against the rows. */
export function buildPlan(input: PlanInput): DocumentPlan {
  const { project, scenes, geometry, fonts, includeNotes } = input;
  const ratio = project.aspectRatio;
  const columnHeight = columnFrameHeight(geometry, ratio);
  const wideHeight = fullFrameHeight(geometry, ratio);

  const shotRefs: ShotRef[] = [];
  const rows: RowBlock[] = [];
  const atoms: Atom[] = [];
  /** Panel id to the row it sits in and the horizontal centre of its frame. */
  const placement = new Map<string, { row: RowBlock; center: number }>();

  const newRow = (
    shotRefsForRow: ShotRef[],
    frames: FrameSlot[],
    height: number,
    headingHeight: number,
    spaceBefore: number,
  ): RowBlock => {
    const row: RowBlock = {
      kind: 'row',
      index: rows.length,
      shotRefs: shotRefsForRow,
      frames,
      frameHeight: height,
      headingHeight,
      rail: null,
      spaceBefore,
      height: 0,
    };
    row.height = rowHeight(row);
    rows.push(row);
    for (const frame of frames) {
      if (frame.panel)
        placement.set(frame.panel.id, { row, center: frame.center });
    }
    return row;
  };

  const slot = (
    shotRef: ShotRef,
    panel: Panel | null,
    column: number,
    wide: boolean,
    heading: FrameSlot['heading'],
  ): FrameSlot => {
    const width = wide ? geometry.contentWidth : geometry.frameWidth;
    const x = wide ? geometry.contentLeft : columnLeft(geometry, column);
    const letter = panel ? (shotRef.letters.get(panel.id) ?? '') : '';
    return {
      panel,
      shotRef,
      letter,
      x,
      width,
      center: x + width / 2,
      caption: captionFor(
        shotRef,
        panel,
        letter,
        width,
        fonts,
        includeNotes,
      ),
      heading,
    };
  };

  scenes.forEach((scene, sceneOrder) => {
    const sceneNumber = project.scenes.indexOf(scene) + 1 || sceneOrder + 1;
    const bandNeeded = sceneOrder > 0;
    let pending: Block[] = [];
    if (bandNeeded) {
      pending.push({
        kind: 'scene-band',
        scene,
        label: sceneLabel(scene, sceneNumber),
        spaceBefore: SCENE_BAND_SPACE_ABOVE,
        height: SCENE_BAND_HEIGHT,
      });
    }

    if (scene.shots.length === 0) {
      pending.push({
        kind: 'no-shots',
        spaceBefore: pending.length > 0 ? AFTER_SCENE_BAND_SPACE : 0,
        height: TYPE.kicker.leading,
      });
      atoms.push({ blocks: pending, scene });
      return;
    }

    const refs = scene.shots.map((shot, index) =>
      buildShotRef(scene, shot, sceneNumber, index + 1),
    );
    shotRefs.push(...refs);

    const openingSpace = () =>
      pending.length > 0 ? AFTER_SCENE_BAND_SPACE : SHOT_HEADING_SPACE_ABOVE;

    let index = 0;
    let first = true;
    while (index < scene.shots.length) {
      const shareable: number[] = [];
      for (
        let probe = index;
        probe < scene.shots.length && shareable.length < geometry.columns;
        probe += 1
      ) {
        const shot = scene.shots[probe];
        if (shot.panels.length !== 1) break;
        if (shot.panels[0].pdfFullWidth === true) break;
        shareable.push(probe);
      }

      if (shareable.length >= 2) {
        const shared = shareable.map((probe) => refs[probe]);
        const frames = shared.map((shotRef, column) =>
          slot(shotRef, shotRef.shot.panels[0], column, false, {
            code: shotRef.code,
            meta: shotRef.meta,
          }),
        );
        // A shared row stands in for the shot headings it replaces, so it takes
        // the same space above one would have.
        const row = newRow(
          shared,
          frames,
          columnHeight,
          SHARED_HEADING_HEIGHT,
          first ? openingSpace() : SHOT_HEADING_SPACE_ABOVE,
        );
        atoms.push({ blocks: [...pending, row], scene });
        pending = [];
        first = false;
        index += shared.length;
        continue;
      }

      const shotRef = refs[index];
      const heading: ShotHeadingBlock = {
        kind: 'shot-heading',
        shotRef,
        code: shotRef.code,
        meta: shotRef.meta,
        spaceBefore: first ? openingSpace() : SHOT_HEADING_SPACE_ABOVE,
        height: SHOT_HEADING_HEIGHT,
      };

      const shotRows: RowBlock[] = [];
      const panels = shotRef.shot.panels;
      if (panels.length === 0) {
        shotRows.push(
          newRow([shotRef], [slot(shotRef, null, 0, false, null)], columnHeight, 0, 0),
        );
      } else {
        let group: Panel[] = [];
        const flush = () => {
          if (group.length === 0) return;
          const frames = group.map((panel, column) =>
            slot(shotRef, panel, column, false, null),
          );
          shotRows.push(
            newRow(
              [shotRef],
              frames,
              columnHeight,
              0,
              shotRows.length === 0 ? 0 : ROW_GAP,
            ),
          );
          group = [];
        };
        for (const panel of panels) {
          if (panel.pdfFullWidth === true) {
            flush();
            shotRows.push(
              newRow(
                [shotRef],
                [slot(shotRef, panel, 0, true, null)],
                wideHeight,
                0,
                shotRows.length === 0 ? 0 : ROW_GAP,
              ),
            );
            continue;
          }
          group.push(panel);
          if (group.length === geometry.columns) flush();
        }
        flush();
      }

      atoms.push({ blocks: [...pending, heading, shotRows[0]], scene });
      pending = [];
      for (const row of shotRows.slice(1))
        atoms.push({ blocks: [row], scene });
      first = false;
      index += 1;
    }
  });

  attachRails(scenes, placement, geometry, fonts);
  for (const row of rows) row.height = rowHeight(row);

  return { atoms, rows, shotRefs };
}

type Placement = Map<string, { row: RowBlock; center: number }>;

function attachRails(
  scenes: Scene[],
  placement: Placement,
  geometry: PageGeometry,
  fonts: Fonts,
): void {
  const byRow = new Map<RowBlock, RailSegmentInput[]>();
  const add = (row: RowBlock, segment: RailSegmentInput) => {
    const list = byRow.get(row);
    if (list) list.push(segment);
    else byRow.set(row, [segment]);
  };

  const connect = (
    fromPanel: Panel,
    toPanel: Panel,
    fromText: string,
    toText: string,
    label: RailSegmentInput['label'],
  ) => {
    const from = placement.get(fromPanel.id);
    const to = placement.get(toPanel.id);
    if (!from || !to) return;
    if (from.row === to.row) {
      add(from.row, {
        kind: 'same-row',
        fromX: from.center,
        toX: to.center,
        fromText,
        toText,
        label,
      });
      return;
    }
    add(from.row, {
      kind: 'outgoing',
      fromX: from.center,
      toX: geometry.contentRight,
      fromText,
      toText: `(to ${toText})`,
      label,
    });
    add(to.row, {
      kind: 'incoming',
      fromX: geometry.contentLeft,
      toX: to.center,
      fromText: `(from ${fromText})`,
      toText,
      label: [],
    });
  };

  for (const scene of scenes) {
    scene.shots.forEach((shot, shotIndex) => {
      const letters = shot.panels.map((_, index) => letterAt(index));
      shot.panels.slice(0, -1).forEach((panel, index) => {
        const next = shot.panels[index + 1];
        const connection = getPanelConnection(shot, panel.id, next.id);
        const label = panelRailLabel(connection, fonts);
        if (!label) return;
        connect(panel, next, letters[index], letters[index + 1], label);
      });

      const nextShot = scene.shots[shotIndex + 1];
      if (!nextShot) return;
      const source = shot.panels.at(-1);
      const destination = nextShot.panels[0];
      if (!source || !destination) return;
      const connection = getShotConnection(scene, shot.id, nextShot.id);
      const label = shotRailLabel(connection, fonts);
      if (!label) return;
      connect(
        source,
        destination,
        shotCodeOf(placement, source) ?? '',
        shotCodeOf(placement, destination) ?? '',
        label,
      );
    });
  }

  for (const [row, segments] of byRow)
    row.rail = planRail(segments, geometry, fonts);
}

function shotCodeOf(placement: Placement, panel: Panel): string | null {
  const entry = placement.get(panel.id);
  if (!entry) return null;
  const frame = entry.row.frames.find(
    (candidate) => candidate.panel?.id === panel.id,
  );
  return frame ? frame.shotRef.code : null;
}
