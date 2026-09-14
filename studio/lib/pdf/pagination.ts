import type { Scene } from '../storyboard/model';
import { CONTINUES_GAP, splitCaption, type CaptionPlan } from './blocks';
import type { PageGeometry } from './geometry';
import {
  SHOT_HEADING_HEIGHT,
  type Atom,
  type Block,
  type CaptionOverflowBlock,
  type RowBlock,
  type ShotHeadingBlock,
  type ShotRef,
} from './plan';
import { TYPE } from './theme';

export type PlacedBlock = { block: Block; top: number };

export type ContinuesLine = {
  code: string;
  letters: string;
  /** Top of the kicker's line box. */
  top: number;
};

export type PageLayout = {
  blocks: PlacedBlock[];
  /** The scene of the first shot on the page, for the running header. */
  scene: Scene;
  continues: ContinuesLine | null;
};

export type PaginationResult = {
  pages: PageLayout[];
  /** Scene id to the one-based board page its first block lands on. */
  sceneStarts: Map<string, number>;
};

function isRow(block: Block): block is RowBlock {
  return block.kind === 'row';
}

function letterRange(letters: string[]): string {
  if (letters.length === 0) return '';
  const first = letters[0];
  const last = letters[letters.length - 1];
  return first === last ? first : `${first}–${last}`;
}

function lettersOf(rows: RowBlock[], shotRef: ShotRef): string[] {
  return rows.flatMap((row) =>
    row.frames
      .filter((frame) => frame.shotRef === shotRef && frame.letter)
      .map((frame) => frame.letter),
  );
}

function continuationHeading(row: RowBlock): ShotHeadingBlock {
  const shotRef = row.shotRefs[0];
  return {
    kind: 'shot-heading',
    shotRef,
    code: shotRef.code,
    meta: `CONTINUED · ${letterRange(lettersOf([row], shotRef))}`,
    spaceBefore: 0,
    height: SHOT_HEADING_HEIGHT,
  };
}

/**
 * Section 8. Blocks are placed top-down and pages are filled: a row never
 * splits, a shot heading is never orphaned, and the only slack on a page is the
 * remainder below the last row that fits.
 */
export function paginate(
  atoms: Atom[],
  geometry: PageGeometry,
  sceneBreaks: 'flow' | 'page',
): PaginationResult {
  const pages: PageLayout[] = [];
  const sceneStarts = new Map<string, number>();
  /** Shots that already have at least one row on an earlier page. */
  const rowsPlaced = new Set<ShotRef>();
  let page: PageLayout | null = null;
  let cursor = geometry.bodyTop;

  const room = () => cursor - geometry.bodyBottom;

  const openPage = (scene: Scene): PageLayout => {
    const created: PageLayout = { blocks: [], scene, continues: null };
    pages.push(created);
    page = created;
    cursor = geometry.bodyTop;
    return created;
  };

  const put = (target: PageLayout, block: Block, withSpace: boolean) => {
    if (withSpace) cursor -= block.spaceBefore;
    target.blocks.push({ block, top: cursor });
    cursor -= block.height;
    if (isRow(block)) for (const ref of block.shotRefs) rowsPlaced.add(ref);
  };

  /** A scene band is silent when its scene already opens the page. */
  const blocksFor = (atom: Atom, fresh: boolean): Block[] =>
    fresh ? atom.blocks.filter((block) => block.kind !== 'scene-band') : atom.blocks;

  const measure = (blocks: Block[], suppressFirstSpace: boolean): number =>
    blocks.reduce(
      (total, block, index) =>
        total +
        (index === 0 && suppressFirstSpace ? 0 : block.spaceBefore) +
        block.height,
      0,
    );

  const queue: Atom[] = [...atoms];
  let previousScene: Scene | null = null;

  while (queue.length > 0) {
    const atom = queue.shift() as Atom;
    if (
      sceneBreaks === 'page' &&
      previousScene !== null &&
      previousScene !== atom.scene
    ) {
      page = null;
    }
    previousScene = atom.scene;

    // First try the page in hand.
    if (page !== null) {
      const open = page as PageLayout;
      const fresh = open.blocks.length === 0;
      const blocks = blocksFor(atom, fresh);
      if (measure(blocks, fresh) <= room()) {
        blocks.forEach((block, index) =>
          put(open, block, !(index === 0 && fresh)),
        );
        if (!sceneStarts.has(atom.scene.id))
          sceneStarts.set(atom.scene.id, pages.length);
        continue;
      }
      page = null;
    }

    const opened = openPage(atom.scene);
    if (!sceneStarts.has(atom.scene.id))
      sceneStarts.set(atom.scene.id, pages.length);
    const blocks = blocksFor(atom, true);

    // A shot carried onto a new page repeats its heading as CONTINUED.
    const lead = blocks[0];
    let suppressFirstSpace = true;
    if (
      lead &&
      isRow(lead) &&
      lead.shotRefs.length === 1 &&
      rowsPlaced.has(lead.shotRefs[0])
    ) {
      const heading = continuationHeading(lead);
      if (measure(blocks, true) + heading.height <= room()) {
        put(opened, heading, false);
        suppressFirstSpace = true;
      }
    }

    if (measure(blocks, suppressFirstSpace) <= room()) {
      blocks.forEach((block, index) =>
        put(opened, block, !(index === 0 && suppressFirstSpace)),
      );
      continue;
    }

    // Section 8's overflow rule: a single row taller than a whole page body.
    blocks.forEach((block, index) => {
      const withSpace = !(index === 0 && suppressFirstSpace);
      if (!isRow(block)) {
        put(opened, block, withSpace);
        return;
      }
      const overflow = splitRow(block, room() - (withSpace ? block.spaceBefore : 0));
      put(opened, block, withSpace);
      if (overflow) queue.unshift({ blocks: [overflow], scene: atom.scene });
    });
  }

  addContinuesLines(pages, geometry);
  return { pages, sceneStarts };
}

/** Trims a row's captions to `available` and returns what has to carry over. */
function splitRow(
  row: RowBlock,
  available: number,
): CaptionOverflowBlock | null {
  const captionRoom =
    available - row.headingHeight - row.frameHeight - (row.rail?.height ?? 0);
  if (captionRoom <= TYPE.panelLetter.leading) return null;
  const columns: { x: number; caption: CaptionPlan }[] = [];
  let tallest = 0;
  for (const frame of row.frames) {
    const { head, tail } = splitCaption(frame.caption, captionRoom);
    frame.caption = head;
    tallest = Math.max(tallest, head.height);
    if (tail) columns.push({ x: frame.x, caption: tail });
  }
  row.height =
    row.headingHeight + row.frameHeight + (row.rail?.height ?? 0) + tallest;
  if (columns.length === 0) return null;
  const shotRef = row.shotRefs[0];
  const letters = row.frames
    .filter((frame) => frame.letter)
    .map((frame) => frame.letter);
  const body = columns.reduce(
    (most, column) => Math.max(most, column.caption.height),
    0,
  );
  return {
    kind: 'caption-overflow',
    label: `${shotRef.code} ${letterRange(letters)} · CONTINUED`,
    columns,
    spaceBefore: 0,
    height: TYPE.kicker.leading + 8 + body,
  };
}

/** Section 5.4: the right-aligned kicker at the foot of an interrupted shot. */
function addContinuesLines(pages: PageLayout[], geometry: PageGeometry): void {
  pages.forEach((page, index) => {
    const rows = page.blocks.map((placed) => placed.block).filter(isRow);
    const lastRow = rows.at(-1);
    if (!lastRow || lastRow.shotRefs.length !== 1) return;
    const shotRef = lastRow.shotRefs[0];
    const later = pages
      .slice(index + 1)
      .flatMap((following) => following.blocks.map((placed) => placed.block))
      .filter(isRow)
      .filter((row) => row.shotRefs.includes(shotRef));
    const letters = lettersOf(later, shotRef);
    if (letters.length === 0) return;
    const last = page.blocks.at(-1);
    if (!last) return;
    const top = last.top - last.block.height - CONTINUES_GAP;
    if (top - TYPE.kicker.leading < geometry.bodyBottom) return;
    page.continues = { code: shotRef.code, letters: letterRange(letters), top };
  });
}
