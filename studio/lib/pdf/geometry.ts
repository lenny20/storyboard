import { TYPE } from './theme';

export type StoryboardPdfLayout =
  | 'portrait-2up'
  | 'landscape-2up'
  | 'landscape-3up';

const A4_SHORT = 595.28;
const A4_LONG = 841.89;

/** Clearance between the running header baseline and the first block. */
const HEADER_CLEARANCE = 22;
/** Clearance between the footer rule and the last block. */
const FOOTER_CLEARANCE = 10;
/** Gap between the footer rule and the top of the footer kicker. */
const FOOTER_RULE_GAP = 8;

export type PageGeometry = {
  layout: StoryboardPdfLayout;
  landscape: boolean;
  pageWidth: number;
  pageHeight: number;
  marginX: number;
  marginTop: number;
  marginBottom: number;
  columns: 2 | 3;
  columnGap: number;
  contentWidth: number;
  contentLeft: number;
  contentRight: number;
  /** Width of one column frame. */
  frameWidth: number;
  /** Baseline of the running header, on the top margin line. */
  headerBaseline: number;
  /** Baseline of the footer kicker, on the bottom margin line. */
  footerBaseline: number;
  footerRuleY: number;
  bodyTop: number;
  bodyBottom: number;
  bodyHeight: number;
};

/** Section 1 of the spec: page, margins and columns per layout. */
export function geometryFor(layout: StoryboardPdfLayout): PageGeometry {
  const landscape = layout !== 'portrait-2up';
  const pageWidth = landscape ? A4_LONG : A4_SHORT;
  const pageHeight = landscape ? A4_SHORT : A4_LONG;
  const marginX = 36;
  const marginTop = landscape ? 28 : 30;
  const marginBottom = landscape ? 24 : 26;
  const columns = layout === 'landscape-3up' ? 3 : 2;
  const columnGap = 10.5;
  const contentWidth = pageWidth - marginX * 2;
  const headerBaseline = pageHeight - marginTop;
  const footerBaseline = marginBottom;
  const footerRuleY =
    footerBaseline + TYPE.kicker.size * 0.82 + FOOTER_RULE_GAP;
  const bodyTop = headerBaseline - HEADER_CLEARANCE;
  const bodyBottom = footerRuleY + FOOTER_CLEARANCE;
  return {
    layout,
    landscape,
    pageWidth,
    pageHeight,
    marginX,
    marginTop,
    marginBottom,
    columns,
    columnGap,
    contentWidth,
    contentLeft: marginX,
    contentRight: marginX + contentWidth,
    frameWidth: (contentWidth - (columns - 1) * columnGap) / columns,
    headerBaseline,
    footerBaseline,
    footerRuleY,
    bodyTop,
    bodyBottom,
    bodyHeight: bodyTop - bodyBottom,
  };
}

/** Left edge of column `index` of a normal row. */
export function columnLeft(geometry: PageGeometry, index: number): number {
  return geometry.contentLeft + index * (geometry.frameWidth + geometry.columnGap);
}

/** Horizontal centre of column `index` of a normal row. */
export function columnCenter(geometry: PageGeometry, index: number): number {
  return columnLeft(geometry, index) + geometry.frameWidth / 2;
}

export function frameHeight(geometry: PageGeometry, ratio: number): number {
  return geometry.frameWidth / ratio;
}

export function fullFrameHeight(
  geometry: PageGeometry,
  ratio: number,
): number {
  return geometry.contentWidth / ratio;
}
