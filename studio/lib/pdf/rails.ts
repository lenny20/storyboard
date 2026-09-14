import type { PDFPage } from 'pdf-lib';
import type { PageGeometry } from './geometry';
import { COLORS, TYPE, type Fonts, type TextStyle } from './theme';
import { drawLine, measureText } from './text';

/** Section 6 constants. */
const SOURCE_RADIUS = 1.9;
const ARROW_LENGTH = 6;
const ARROW_HALF_WIDTH = 3;
const ENDPOINT_GAP = 5;
const LABEL_PAD = 7;
/** Endpoint text sits tight to its mark, so it clears the line by less. */
const ENDPOINT_PAD = 3;
const RAIL_LINE_WIDTH = 0.6;
/** A junction mark is an arrowhead with the next segment's circle 4 pt right. */
const CHAIN_OFFSET = 4;
const BAND_HEIGHT = 14;
const BAND_ABOVE = 4;
const BAND_BELOW = 3;
const EXTRA_LINE_HEIGHT = 11;
/** Descriptions never truncate, so a cramped segment still gets a usable measure. */
const MIN_LABEL_WIDTH = 44;

export const RAIL_SPACE_ABOVE = BAND_ABOVE;
export const RAIL_SPACE_BELOW = BAND_BELOW;

/** One word of a rail label, with the space that precedes it. */
export type RailToken = { text: string; style: TextStyle; gap: number };

export type RailSegmentInput = {
  kind: 'same-row' | 'outgoing' | 'incoming';
  /** Frame centre of the source. Ignored for an incoming half. */
  fromX: number;
  /** Frame centre of the destination. Ignored for an outgoing half. */
  toX: number;
  fromText: string;
  toText: string;
  label: RailToken[];
};

type RailLine = { tokens: RailToken[]; width: number };

export type RailSegment = RailSegmentInput & {
  /** This source shares a frame centre with an arrowhead already on the rail. */
  chainedSource: boolean;
  /** Another segment's source sits at this destination. */
  chainedDestination: boolean;
  lines: RailLine[];
};

export type RailPlan = {
  segments: RailSegment[];
  /** 4 pt above, the 14 pt line band plus any wrapped label lines, 3 pt below. */
  height: number;
};

function spaceWidth(fonts: Fonts, style: TextStyle): number {
  return measureText(' ', { ...style, tracking: 0 }, fonts);
}

/** Builds the tokens for one `TYPE  description` part of a label. */
export function labelTokens(
  parts: readonly { type: string; description: string }[],
  fonts: Fonts,
): RailToken[] {
  const space = spaceWidth(fonts, TYPE.railDescription);
  const tokens: RailToken[] = [];
  for (const part of parts) {
    if (tokens.length > 0) {
      tokens.push({ text: '·', style: TYPE.railDescription, gap: space });
    }
    if (part.type) {
      tokens.push({
        text: part.type,
        style: TYPE.railType,
        gap: tokens.length > 0 ? space : 0,
      });
    }
    const words = part.description.trim().split(/\s+/).filter(Boolean);
    words.forEach((text, index) => {
      tokens.push({
        text,
        style: TYPE.railDescription,
        // Two spaces separate the type from its description.
        gap: index === 0 && part.type ? space * 2 : tokens.length > 0 ? space : 0,
      });
    });
  }
  return tokens;
}

function tokenWidth(token: RailToken, fonts: Fonts): number {
  return measureText(token.text, token.style, fonts);
}

function wrapTokens(
  tokens: RailToken[],
  fonts: Fonts,
  available: number,
): RailLine[] {
  const width = Math.max(available, MIN_LABEL_WIDTH);
  const lines: RailLine[] = [];
  let current: RailToken[] = [];
  let used = 0;
  for (const token of tokens) {
    const step = (current.length === 0 ? 0 : token.gap) + tokenWidth(token, fonts);
    if (current.length > 0 && used + step > width) {
      lines.push({ tokens: current, width: used });
      current = [token];
      used = tokenWidth(token, fonts);
      continue;
    }
    current.push(token);
    used += step;
  }
  if (current.length > 0) lines.push({ tokens: current, width: used });
  return lines;
}

/** Horizontal room a label has between the two marks on this segment. */
function labelRoom(
  segment: RailSegmentInput,
  geometry: PageGeometry,
  fonts: Fonts,
): number {
  const left = segment.fromX + SOURCE_RADIUS;
  if (segment.kind === 'same-row')
    return segment.toX - ARROW_LENGTH - left - LABEL_PAD * 2;
  // Outgoing: `(to B)` is knocked out on the line just before the arrowhead.
  return (
    outgoingLabelRight(segment, geometry, fonts) - left - LABEL_PAD * 2
  );
}

function outgoingLabelRight(
  segment: RailSegmentInput,
  geometry: PageGeometry,
  fonts: Fonts,
): number {
  return (
    geometry.contentRight -
    ARROW_LENGTH -
    measureText(segment.toText, TYPE.railEndpoint, fonts) -
    ENDPOINT_GAP
  );
}

/**
 * Resolves marks, chain junctions and label wrapping for one row's rail. Row
 * structure is settled before pagination, so a rail's height never depends on
 * the page its row lands on.
 */
export function planRail(
  inputs: RailSegmentInput[],
  geometry: PageGeometry,
  fonts: Fonts,
): RailPlan | null {
  if (inputs.length === 0) return null;
  const ordered = [...inputs].sort(
    (a, b) => anchorOf(a, geometry) - anchorOf(b, geometry),
  );
  const sources = new Set(
    ordered.filter((entry) => entry.kind !== 'incoming').map((entry) => entry.fromX),
  );
  const destinations = new Set(
    ordered.filter((entry) => entry.kind !== 'outgoing').map((entry) => entry.toX),
  );
  const segments: RailSegment[] = ordered.map((input) => {
    const chainedSource =
      input.kind !== 'incoming' && destinations.has(input.fromX);
    const chainedDestination =
      input.kind !== 'outgoing' && sources.has(input.toX);
    const shifted: RailSegmentInput = chainedSource
      ? { ...input, fromX: input.fromX + CHAIN_OFFSET }
      : input;
    const lines =
      shifted.label.length > 0
        ? wrapTokens(shifted.label, fonts, labelRoom(shifted, geometry, fonts))
        : [];
    return { ...shifted, chainedSource, chainedDestination, lines };
  });
  const extraLines = segments.reduce(
    (most, segment) => Math.max(most, Math.max(0, segment.lines.length - 1)),
    0,
  );
  return {
    segments,
    height:
      BAND_ABOVE + BAND_HEIGHT + extraLines * EXTRA_LINE_HEIGHT + BAND_BELOW,
  };
}

function anchorOf(segment: RailSegmentInput, geometry: PageGeometry): number {
  return segment.kind === 'incoming' ? geometry.contentLeft : segment.fromX;
}

function knockout(
  page: PDFPage,
  left: number,
  ruleY: number,
  width: number,
  pad: number,
): void {
  page.drawRectangle({
    x: left - pad,
    y: ruleY - 5,
    width: width + pad * 2,
    height: 10,
    color: COLORS.ground,
  });
}

function railBaseline(ruleY: number, style: TextStyle): number {
  return ruleY - style.size * 0.35;
}

function drawArrowhead(page: PDFPage, tipX: number, ruleY: number): void {
  page.drawSvgPath(
    `M 0 0 L ${-ARROW_LENGTH} ${ARROW_HALF_WIDTH} L ${-ARROW_LENGTH} ${-ARROW_HALF_WIDTH} Z`,
    { x: tipX, y: ruleY, color: COLORS.accent, borderWidth: 0 },
  );
}

/** Draws one row's rail band with its top edge at `bandTop`. */
export function renderRail(
  page: PDFPage,
  plan: RailPlan,
  geometry: PageGeometry,
  fonts: Fonts,
  bandTop: number,
): void {
  const ruleY = bandTop - BAND_ABOVE - BAND_HEIGHT / 2;
  for (const segment of plan.segments) {
    const start =
      segment.kind === 'incoming' ? geometry.contentLeft : segment.fromX;
    const end =
      segment.kind === 'outgoing' ? geometry.contentRight : segment.toX;
    page.drawLine({
      start: { x: start, y: ruleY },
      end: { x: end, y: ruleY },
      thickness: RAIL_LINE_WIDTH,
      color: COLORS.accent,
    });

    if (segment.kind === 'incoming') {
      const width = measureText(segment.fromText, TYPE.railEndpoint, fonts);
      knockout(page, geometry.contentLeft, ruleY, width, ENDPOINT_PAD);
      drawLine(
        page,
        segment.fromText,
        geometry.contentLeft,
        railBaseline(ruleY, TYPE.railEndpoint),
        TYPE.railEndpoint,
        fonts,
      );
    } else if (!segment.chainedSource) {
      drawLine(
        page,
        segment.fromText,
        segment.fromX - SOURCE_RADIUS - ENDPOINT_GAP,
        railBaseline(ruleY, TYPE.railEndpoint),
        TYPE.railEndpoint,
        fonts,
        { align: 'right' },
      );
    }

    if (segment.kind === 'outgoing') {
      const width = measureText(segment.toText, TYPE.railEndpoint, fonts);
      const right = outgoingLabelRight(segment, geometry, fonts);
      knockout(page, right, ruleY, width, ENDPOINT_PAD);
      drawLine(
        page,
        segment.toText,
        right,
        railBaseline(ruleY, TYPE.railEndpoint),
        TYPE.railEndpoint,
        fonts,
      );
    } else if (!segment.chainedDestination) {
      drawLine(
        page,
        segment.toText,
        end + ENDPOINT_GAP,
        railBaseline(ruleY, TYPE.railEndpoint),
        TYPE.railEndpoint,
        fonts,
      );
    }

    if (segment.lines.length > 0) {
      const labelLeft = segment.fromX + SOURCE_RADIUS;
      const labelRight =
        segment.kind === 'outgoing'
          ? outgoingLabelRight(segment, geometry, fonts)
          : end - ARROW_LENGTH;
      const centerX = (labelLeft + labelRight) / 2;
      segment.lines.forEach((line, index) => {
        const left = centerX - line.width / 2;
        if (index === 0) knockout(page, left, ruleY, line.width, LABEL_PAD);
        let cursor = left;
        line.tokens.forEach((token, tokenIndex) => {
          if (tokenIndex > 0) cursor += token.gap;
          cursor += drawLine(
            page,
            token.text,
            cursor,
            railBaseline(ruleY, token.style) - index * EXTRA_LINE_HEIGHT,
            token.style,
            fonts,
          );
        });
      });
    }

    // The marks go on last so that no knockout can bite into them.
    if (segment.kind !== 'incoming') {
      page.drawCircle({
        x: segment.fromX,
        y: ruleY,
        size: SOURCE_RADIUS,
        color: COLORS.accent,
        borderWidth: 0,
      });
    }
    drawArrowhead(page, end, ruleY);
  }
}
