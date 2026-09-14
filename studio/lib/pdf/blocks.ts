import {
  clip,
  concatTransformationMatrix,
  endPath,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  type PDFPage,
} from 'pdf-lib';
import { getImagePlacement } from '../storyboard/image-transform';
import type { EmbeddedArtwork } from './artwork';
import type { Panel } from '../storyboard/model';
import type { PageGeometry } from './geometry';
import { parseDialogue } from './dialogue';
import {
  COLORS,
  TYPE,
  baselineFrom,
  tinted,
  type Color,
  type Fonts,
  type TextStyle,
} from './theme';
import { drawLine, measureText, wrapText } from './text';

/** Section 7: the panel letter sits in its own narrow column. */
const LETTER_COLUMN = 20;
const LETTER_GAP = 8;
/** Vertical space between the items of a caption. */
const ITEM_GAP = 5;
/** Gap between a `CAM` or `NOTE` kicker and the text that follows it. */
const PREFIX_GAP = 6;
/** A blank line in the dialogue field. */
const DIALOGUE_BLANK = 6;

/** Section 5.2 spacing. */
export const SHOT_HEADING_SPACE_ABOVE = 30;
export const SHOT_HEADING_SPACE_BELOW = 10;
export const SHOT_HEADING_META_GAP = 12;
/** Section 5.1. */
export const SCENE_BAND_HEIGHT = 30;
/** Section 5.3. */
export const ROW_GAP = 16;
/** Section 5.4. */
export const CONTINUES_GAP = 12;

export type CaptionLine = {
  text: string;
  style: TextStyle;
  /** Offset from the left of the caption's text column. */
  indent: number;
  spaceBefore: number;
  height: number;
  prefix?: { text: string; style: TextStyle };
};

export type CaptionPlan = {
  letter: string;
  width: number;
  textWidth: number;
  lines: CaptionLine[];
  height: number;
};

function isAutomaticPanelTitle(value: string): boolean {
  return /^panel(?:\s+\d+)?$/i.test(value.trim());
}

function captionHeight(lines: CaptionLine[]): number {
  return lines.reduce(
    (total, line, index) =>
      total + (index === 0 ? 0 : line.spaceBefore) + line.height,
    0,
  );
}

function prefixedItem(
  label: string,
  labelStyle: TextStyle,
  body: string,
  bodyStyle: TextStyle,
  fonts: Fonts,
  textWidth: number,
  spaceBefore: number,
): CaptionLine[] {
  const indent = measureText(label, labelStyle, fonts) + PREFIX_GAP;
  const wrapped = wrapText(body, bodyStyle, fonts, textWidth - indent);
  return wrapped.map((text, index) => ({
    text,
    style: bodyStyle,
    indent,
    spaceBefore: index === 0 ? spaceBefore : 0,
    height: bodyStyle.leading,
    prefix: index === 0 ? { text: label, style: labelStyle } : undefined,
  }));
}

export type CaptionSource = {
  panel: Panel;
  letter: string;
  camera: string;
  dialogue: string;
  notes: string;
};

/** Section 7: measures one caption block into placeable lines. */
export function planCaption(
  source: CaptionSource,
  width: number,
  fonts: Fonts,
  includeNotes: boolean,
): CaptionPlan {
  const textWidth = width - LETTER_COLUMN - LETTER_GAP;
  const lines: CaptionLine[] = [];
  const push = (items: CaptionLine[]) => {
    if (items.length === 0) return;
    const gap = lines.length === 0 ? 0 : ITEM_GAP;
    items[0] = { ...items[0], spaceBefore: items[0].spaceBefore + gap };
    lines.push(...items);
  };

  const { panel } = source;
  const metaParts = [panel.framing, panel.angle]
    .map((part) => (part ?? '').trim())
    .filter(Boolean);
  const title = (panel.title ?? '').trim();
  if (title && !isAutomaticPanelTitle(title)) metaParts.push(title);
  if (metaParts.length > 0) {
    push(
      wrapText(metaParts.join(' · '), TYPE.kicker, fonts, textWidth).map(
        (text) => ({
          text,
          style: TYPE.kicker,
          indent: 0,
          spaceBefore: 0,
          height: TYPE.kicker.leading,
        }),
      ),
    );
  }

  push(
    wrapText(panel.description ?? '', TYPE.action, fonts, textWidth).map(
      (text) => ({
        text,
        style: TYPE.action,
        indent: 0,
        spaceBefore: 0,
        height: TYPE.action.leading,
      }),
    ),
  );

  if (source.camera.trim()) {
    push(
      prefixedItem(
        'CAM',
        tinted(TYPE.kicker, COLORS.accent),
        source.camera,
        TYPE.cameraNote,
        fonts,
        textWidth,
        0,
      ),
    );
  }

  const dialogue = parseDialogue(source.dialogue);
  if (dialogue.length > 0) {
    const items: CaptionLine[] = [];
    let pendingGap = 0;
    for (const entry of dialogue) {
      if (entry.kind === 'blank') {
        pendingGap = DIALOGUE_BLANK;
        continue;
      }
      const style =
        entry.kind === 'cue'
          ? tinted(TYPE.dialogue, COLORS.accent)
          : entry.kind === 'parenthetical'
            ? tinted(TYPE.dialogue, COLORS.muted)
            : TYPE.dialogue;
      const wrapped = wrapText(entry.text, style, fonts, textWidth);
      wrapped.forEach((text, index) => {
        items.push({
          text,
          style,
          indent: 0,
          spaceBefore: index === 0 ? pendingGap : 0,
          height: style.leading,
        });
      });
      pendingGap = 0;
    }
    push(items);
  }

  if (includeNotes && source.notes.trim()) {
    push(
      prefixedItem(
        'NOTE',
        TYPE.kicker,
        source.notes,
        TYPE.cameraNote,
        fonts,
        textWidth,
        0,
      ),
    );
  }

  return {
    letter: source.letter,
    width,
    textWidth,
    lines,
    height: Math.max(TYPE.panelLetter.leading, captionHeight(lines)),
  };
}

/** Splits a caption so that the head fits in `available`; the tail continues. */
export function splitCaption(
  plan: CaptionPlan,
  available: number,
): { head: CaptionPlan; tail: CaptionPlan | null } {
  if (plan.height <= available) return { head: plan, tail: null };
  const head: CaptionLine[] = [];
  let used = 0;
  for (const line of plan.lines) {
    const step = (head.length === 0 ? 0 : line.spaceBefore) + line.height;
    if (used + step > available) break;
    head.push(line);
    used += step;
  }
  const tail = plan.lines.slice(head.length);
  if (tail.length === 0) return { head: plan, tail: null };
  return {
    head: {
      ...plan,
      lines: head,
      height: Math.max(TYPE.panelLetter.leading, captionHeight(head)),
    },
    tail: {
      ...plan,
      lines: tail,
      height: captionHeight(tail),
    },
  };
}

/** Draws a caption block with its top edge at `top`. */
export function drawCaption(
  page: PDFPage,
  plan: CaptionPlan,
  x: number,
  top: number,
  fonts: Fonts,
  options: { letter?: boolean } = {},
): void {
  if (options.letter !== false && plan.letter) {
    drawLine(
      page,
      plan.letter,
      x,
      baselineFrom(top, TYPE.panelLetter),
      TYPE.panelLetter,
      fonts,
    );
  }
  const textLeft = x + LETTER_COLUMN + LETTER_GAP;
  let cursor = top;
  plan.lines.forEach((line, index) => {
    if (index > 0) cursor -= line.spaceBefore;
    const baseline = baselineFrom(cursor, line.style);
    if (line.prefix) {
      drawLine(
        page,
        line.prefix.text,
        textLeft,
        baselineFrom(cursor, line.prefix.style),
        line.prefix.style,
        fonts,
      );
    }
    if (line.text)
      drawLine(page, line.text, textLeft + line.indent, baseline, line.style, fonts);
    cursor -= line.height;
  });
}

/** Section 5.3: one frame, its artwork or the pending ground, and its overlays. */
export function drawFrame(
  page: PDFPage,
  panel: Panel | null,
  artwork: EmbeddedArtwork | undefined,
  x: number,
  top: number,
  width: number,
  height: number,
  fonts: Fonts,
): void {
  const bottom = top - height;
  page.drawRectangle({
    x,
    y: bottom,
    width,
    height,
    color: artwork ? COLORS.frameGround : COLORS.pendingGround,
  });

  if (artwork) {
    const placement = getImagePlacement(
      artwork.image.width,
      artwork.image.height,
      width,
      height,
      artwork.transform,
    );
    const imageX = x + placement.x;
    const imageY = top - placement.y - placement.height;
    page.pushOperators(
      pushGraphicsState(),
      rectangle(x, bottom, width, height),
      clip(),
      endPath(),
    );
    if (placement.flipX || placement.flipY) {
      page.pushOperators(
        concatTransformationMatrix(
          placement.flipX ? -1 : 1,
          0,
          0,
          placement.flipY ? -1 : 1,
          placement.flipX ? imageX * 2 + placement.width : 0,
          placement.flipY ? imageY * 2 + placement.height : 0,
        ),
      );
    }
    page.drawImage(artwork.image, {
      x: imageX,
      y: imageY,
      width: placement.width,
      height: placement.height,
    });
    page.pushOperators(popGraphicsState());
  } else {
    drawLine(
      page,
      'ARTWORK PENDING',
      x + width / 2,
      bottom + height / 2 - TYPE.kicker.size * 0.36,
      TYPE.kicker,
      fonts,
      { align: 'center' },
    );
  }

  if (panel) drawOverlays(page, panel, x, bottom, width, height, fonts);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function positive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Composition markers keep their vector rendering; camera accent, action ink. */
function drawOverlays(
  page: PDFPage,
  panel: Panel,
  x: number,
  bottom: number,
  width: number,
  height: number,
  fonts: Fonts,
): void {
  panel.markers.forEach((marker, index) => {
    const radius = Math.max(4, Math.min(10, 5.5 * positive(marker.scale, 1)));
    const markerX =
      x + radius + 1 + clamp01(marker.x) * (width - radius * 2 - 2);
    const markerY =
      bottom + radius + 1 + (1 - clamp01(marker.y)) * (height - radius * 2 - 2);
    page.drawCircle({
      x: markerX,
      y: markerY,
      size: radius,
      borderColor: COLORS.accent,
      borderWidth: 0.9,
    });
    drawOverlayLabel(
      page,
      `M${index + 1}`,
      markerX + radius + 3,
      markerY - 4,
      x,
      bottom,
      width,
      height,
      COLORS.accent,
      fonts,
    );
  });

  panel.arrows.forEach((arrow, index, arrows) => {
    const inset = 8;
    const x1 = x + inset + clamp01(arrow.x1) * (width - inset * 2);
    const y1 = bottom + inset + (1 - clamp01(arrow.y1)) * (height - inset * 2);
    const x2 = x + inset + clamp01(arrow.x2) * (width - inset * 2);
    const y2 = bottom + inset + (1 - clamp01(arrow.y2)) * (height - inset * 2);
    const color = arrow.kind === 'camera' ? COLORS.accent : COLORS.ink;
    drawVectorArrow(page, x1, y1, x2, y2, color);
    const ordinal = arrows
      .slice(0, index + 1)
      .filter((candidate) => candidate.kind === arrow.kind).length;
    drawOverlayLabel(
      page,
      `${arrow.kind === 'camera' ? 'C' : 'A'}${ordinal}`,
      x1 + 5 + (ordinal - 1) * 16,
      y1 + (arrow.kind === 'camera' ? 6 : -14),
      x,
      bottom,
      width,
      height,
      color,
      fonts,
    );
  });
}

function drawOverlayLabel(
  page: PDFPage,
  value: string,
  wantedX: number,
  wantedY: number,
  frameX: number,
  frameY: number,
  frameWidth: number,
  frameHeight: number,
  color: Color,
  fonts: Fonts,
): void {
  const style = tinted(TYPE.kicker, color);
  const width = measureText(value, style, fonts);
  const x = Math.max(
    frameX + 3,
    Math.min(wantedX, frameX + frameWidth - width - 3),
  );
  const y = Math.max(
    frameY + 3,
    Math.min(wantedY, frameY + frameHeight - style.size - 3),
  );
  page.drawRectangle({
    x: x - 2,
    y: y - 2.5,
    width: width + 4,
    height: style.size + 3,
    color: COLORS.frameGround,
    opacity: 0.7,
  });
  drawLine(page, value, x, y, style, fonts);
}

function drawVectorArrow(
  page: PDFPage,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: Color,
): void {
  page.drawLine({
    start: { x: x1, y: y1 },
    end: { x: x2, y: y2 },
    thickness: 1.1,
    color,
  });
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const head = 7;
  const spread = Math.PI / 7;
  for (const sign of [-1, 1]) {
    page.drawLine({
      start: { x: x2, y: y2 },
      end: {
        x: x2 - head * Math.cos(angle + sign * spread),
        y: y2 - head * Math.sin(angle + sign * spread),
      },
      thickness: 1.1,
      color,
    });
  }
}

/**
 * A small right arrow drawn as a vector. None of the three bundled families
 * carries U+2192, and the spec's `CONTINUES` kicker needs one.
 */
export function drawKickerArrow(
  page: PDFPage,
  x: number,
  baseline: number,
  color: Color,
): number {
  const width = 7;
  const midY = baseline + TYPE.kicker.size * 0.3;
  page.drawLine({
    start: { x, y: midY },
    end: { x: x + width - 2.4, y: midY },
    thickness: 0.7,
    color,
  });
  page.drawSvgPath('M 0 0 L -2.8 1.7 L -2.8 -1.7 Z', {
    x: x + width,
    y: midY,
    color,
    borderWidth: 0,
  });
  return width;
}

/** Section 4: the running header, on the top margin line. */
export function drawRunningHeader(
  page: PDFPage,
  geometry: PageGeometry,
  fonts: Fonts,
  projectName: string,
  sceneLabel: string,
): void {
  drawLine(
    page,
    projectName,
    geometry.contentLeft,
    geometry.headerBaseline,
    tinted(TYPE.kicker, COLORS.ink),
    fonts,
  );
  if (sceneLabel) {
    drawLine(
      page,
      sceneLabel,
      geometry.contentRight,
      geometry.headerBaseline,
      TYPE.kicker,
      fonts,
      { align: 'right' },
    );
  }
}

/** Section 4: the footer rule, the draft kicker and the page number. */
export function drawFooter(
  page: PDFPage,
  geometry: PageGeometry,
  fonts: Fonts,
  left: string,
  pageNumber: string,
): void {
  page.drawLine({
    start: { x: geometry.contentLeft, y: geometry.footerRuleY },
    end: { x: geometry.contentRight, y: geometry.footerRuleY },
    thickness: 0.75,
    color: COLORS.rule,
  });
  if (left)
    drawLine(
      page,
      left,
      geometry.contentLeft,
      geometry.footerBaseline,
      TYPE.kicker,
      fonts,
    );
  drawLine(
    page,
    pageNumber,
    geometry.contentRight,
    geometry.footerBaseline - 1,
    TYPE.pageNumber,
    fonts,
    { align: 'right' },
  );
}

/** Section 5.1: the rule and kicker that mark a scene change inside a page. */
export function drawSceneBand(
  page: PDFPage,
  geometry: PageGeometry,
  fonts: Fonts,
  label: string,
  top: number,
): void {
  // 30 pt overall: 10 pt clearance, the rule, 5 pt, then the 11 pt kicker line.
  page.drawLine({
    start: { x: geometry.contentLeft, y: top - 10 },
    end: { x: geometry.contentRight, y: top - 10 },
    thickness: 0.75,
    color: COLORS.rule,
  });
  drawLine(
    page,
    label,
    geometry.contentLeft,
    baselineFrom(top - 15, TYPE.kicker),
    tinted(TYPE.kicker, COLORS.ink),
    fonts,
  );
}

/** Section 5.2: the shot numeral with its meta kicker on the same baseline. */
export function drawShotHeading(
  page: PDFPage,
  geometry: PageGeometry,
  fonts: Fonts,
  code: string,
  meta: string,
  top: number,
  style: TextStyle = TYPE.shotNumeral,
  left = geometry.contentLeft,
): void {
  const baseline = baselineFrom(top, style);
  const width = drawLine(page, code, left, baseline, style, fonts);
  if (meta) {
    drawLine(
      page,
      meta,
      left + width + SHOT_HEADING_META_GAP,
      baseline,
      TYPE.kicker,
      fonts,
    );
  }
}
