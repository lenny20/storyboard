import { PDFDocument, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { Scene, StoryProject } from '../storyboard/model';
import { embedSelectedArtwork, type EmbeddedArtwork } from './artwork';
import {
  drawCaption,
  drawFooter,
  drawFrame,
  drawKickerArrow,
  drawRunningHeader,
  drawSceneBand,
  drawShotHeading,
} from './blocks';
import { drawCover } from './cover';
import { geometryFor, type PageGeometry, type StoryboardPdfLayout } from './geometry';
import { joinParts, ratioLabel, shortDate } from './format';
import { buildPlan, captionOffset, sceneLabel, type Block } from './plan';
import { paginate, type PageLayout } from './pagination';
import { renderRail } from './rails';
import { COLORS, TYPE, baselineFrom, tinted, type Fonts } from './theme';
import { drawLine, measureText, pdfSafe } from './text';

export type { StoryboardPdfLayout };

export interface StoryboardPdfOptions {
  sceneId?: string;
  /** Production notes are omitted from the handoff PDF unless explicitly requested. */
  includeNotes?: boolean;
  /** Page orientation and storyboard grid. */
  layout?: StoryboardPdfLayout;
  /** The cover page of section 9. On by default. */
  includeCover?: boolean;
  /** `page` forces each scene to start a new page. */
  sceneBreaks?: 'flow' | 'page';
}

const FONT_FILES = {
  condensedLight: 'BarlowCondensed-Light.ttf',
  condensedMedium: 'BarlowCondensed-Medium.ttf',
  condensedSemiBold: 'BarlowCondensed-SemiBold.ttf',
  regular: 'Barlow-Regular.ttf',
  medium: 'Barlow-Medium.ttf',
  mono: 'CourierPrime-Regular.ttf',
} as const;

async function loadFont(url: URL): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(
      `Cannot export PDF: bundled font failed to load (${response.status}).`,
    );
  return new Uint8Array(await response.arrayBuffer());
}

async function embedFonts(document: PDFDocument): Promise<Fonts> {
  document.registerFontkit(fontkit);
  const roles = Object.keys(FONT_FILES) as (keyof typeof FONT_FILES)[];
  const files = await Promise.all(
    roles.map((role) =>
      loadFont(new URL(`./fonts/${FONT_FILES[role]}`, import.meta.url)),
    ),
  );
  const fonts = {} as Fonts;
  for (const [index, role] of roles.entries())
    fonts[role] = await document.embedFont(files[index], { subset: true });
  return fonts;
}

function assertProjectShape(project: StoryProject): void {
  if (!project || typeof project !== 'object')
    throw new Error('Cannot export PDF: project data is missing.');
  if (!Array.isArray(project.scenes))
    throw new Error('Cannot export PDF: project scenes are malformed.');
  if (!Number.isFinite(project.aspectRatio) || project.aspectRatio <= 0)
    throw new Error(
      'Cannot export PDF: aspect ratio must be a positive number.',
    );
  for (const scene of project.scenes) {
    if (!scene || !Array.isArray(scene.shots))
      throw new Error('Cannot export PDF: a scene has malformed shots.');
    for (const shot of scene.shots) {
      if (!shot || !Array.isArray(shot.panels))
        throw new Error('Cannot export PDF: a shot has malformed panels.');
      for (const panel of shot.panels) {
        if (
          !panel ||
          !Array.isArray(panel.versions) ||
          !Array.isArray(panel.arrows) ||
          !Array.isArray(panel.markers)
        )
          throw new Error('Cannot export PDF: a panel is malformed.');
      }
    }
  }
}

function selectScenes(
  project: StoryProject,
  sceneId: string | undefined,
): Scene[] {
  const selected = sceneId
    ? project.scenes.filter((scene) => scene.id === sceneId)
    : project.scenes;
  if (sceneId && selected.length === 0)
    throw new Error(`Cannot export PDF: scene "${sceneId}" was not found.`);
  return selected;
}

/**
 * Creates a browser-safe A4 storyboard PDF, built to `design/pdf-export-spec.md`.
 * The returned bytes can be passed straight to a Blob by the caller.
 */
export async function createStoryboardPdf(
  project: StoryProject,
  options: StoryboardPdfOptions = {},
): Promise<Uint8Array> {
  assertProjectShape(project);
  const scenes = selectScenes(project, options.sceneId);
  const geometry = geometryFor(options.layout ?? 'portrait-2up');
  const includeCover = options.includeCover !== false;

  const document = await PDFDocument.create();
  document.setTitle(pdfSafe(project.name || 'Untitled storyboard'));
  document.setAuthor('Storyboard Studio');
  document.setSubject('Printable storyboard');
  document.setCreator('Storyboard Studio PDF export');
  document.setProducer('pdf-lib');
  document.setCreationDate(new Date());
  document.setModificationDate(new Date());

  const fonts = await embedFonts(document);
  const artwork = await embedSelectedArtwork(document, scenes, project.aspectRatio, {
    contentWidth: geometry.contentWidth,
    columns: geometry.columns,
    columnGap: geometry.columnGap,
    // The flag only picks encoding height caps, and the ones it reserves for
    // landscape were cut for the old 98 pt compact rows. Version 2 draws
    // landscape frames near 159 pt, so the portrait caps are the right ones.
    landscape: false,
  });

  const plan = buildPlan({
    project,
    scenes,
    geometry,
    fonts,
    includeNotes: options.includeNotes === true,
    sceneBreaks: options.sceneBreaks ?? 'flow',
  });
  const { pages, sceneStarts } = paginate(
    plan.atoms,
    geometry,
    options.sceneBreaks ?? 'flow',
  );

  const offset = includeCover ? 1 : 0;
  const total = pages.length + offset;
  const footerLeft = joinParts([
    project.draftLabel ?? '',
    shortDate(project.updatedAt),
    ratioLabel(project.aspectRatio),
  ]);

  pages.forEach((layout, index) => {
    const page = document.addPage([geometry.pageWidth, geometry.pageHeight]);
    renderPage(page, layout, {
      geometry,
      fonts,
      artwork,
      project,
      footerLeft,
      number: `Page ${index + 1 + offset} of ${total}`,
    });
  });

  if (includeCover) {
    const cover = document.insertPage(0, [
      geometry.pageWidth,
      geometry.pageHeight,
    ]);
    const shifted = new Map<string, number>();
    for (const [id, start] of sceneStarts) shifted.set(id, start + offset);
    await drawCover(document, cover, {
      project,
      scenes,
      geometry,
      fonts,
      sceneStarts: shifted,
    });
  }

  return document.save({ useObjectStreams: true });
}

type RenderContext = {
  geometry: PageGeometry;
  fonts: Fonts;
  artwork: Map<string, EmbeddedArtwork>;
  project: StoryProject;
  footerLeft: string;
  number: string;
};

function renderPage(
  page: PDFPage,
  layout: PageLayout,
  context: RenderContext,
): void {
  const { geometry, fonts, project } = context;
  page.drawRectangle({
    x: 0,
    y: 0,
    width: geometry.pageWidth,
    height: geometry.pageHeight,
    color: COLORS.ground,
  });
  const sceneNumber = project.scenes.indexOf(layout.scene) + 1;
  drawRunningHeader(
    page,
    geometry,
    fonts,
    project.name || 'Untitled storyboard',
    sceneLabel(layout.scene, sceneNumber),
  );
  drawFooter(page, geometry, fonts, context.footerLeft, context.number);

  for (const placed of layout.blocks)
    renderBlock(page, placed.block, placed.top, context);

  if (layout.continues) drawContinues(page, layout.continues, context);
}

function renderBlock(
  page: PDFPage,
  block: Block,
  top: number,
  context: RenderContext,
): void {
  const { geometry, fonts, artwork } = context;
  switch (block.kind) {
    case 'scene-band':
      drawSceneBand(page, geometry, fonts, block.label, top);
      return;
    case 'shot-heading':
      drawShotHeading(page, geometry, fonts, block.code, block.meta, top);
      return;
    case 'no-shots':
      drawLine(
        page,
        'NO SHOTS',
        geometry.contentLeft,
        baselineFrom(top, TYPE.kicker),
        TYPE.kicker,
        fonts,
      );
      return;
    case 'caption-overflow': {
      drawLine(
        page,
        block.label,
        geometry.contentLeft,
        baselineFrom(top, TYPE.kicker),
        TYPE.kicker,
        fonts,
      );
      const body = top - TYPE.kicker.leading - 8;
      for (const column of block.columns)
        drawCaption(page, column.caption, column.x, body, fonts, {
          letter: false,
        });
      return;
    }
    case 'row': {
      let cursor = top;
      if (block.headingHeight > 0) {
        for (const frame of block.frames) {
          if (!frame.heading) continue;
          drawShotHeading(
            page,
            geometry,
            fonts,
            frame.heading.code,
            frame.heading.meta,
            cursor,
            TYPE.shotNumeralShared,
            frame.x,
          );
        }
        cursor -= block.headingHeight;
      }
      for (const frame of block.frames) {
        drawFrame(
          page,
          frame.panel,
          frame.panel ? artwork.get(frame.panel.id) : undefined,
          frame.x,
          cursor,
          frame.width,
          block.frameHeight,
          fonts,
        );
      }
      cursor -= block.frameHeight;
      if (block.rail) renderRail(page, block.rail, geometry, fonts, cursor);
      cursor -= captionOffset(block);
      for (const frame of block.frames)
        drawCaption(page, frame.caption, frame.x, cursor, fonts);
      return;
    }
  }
}

/** Section 5.4. The arrow is a vector: no bundled family carries U+2192. */
function drawContinues(
  page: PDFPage,
  line: PageLayout['continues'],
  context: RenderContext,
): void {
  if (!line) return;
  const { geometry, fonts } = context;
  const style = tinted(TYPE.kicker, COLORS.muted);
  const lead = `${line.code} CONTINUES`;
  const gap = 5;
  const arrowWidth = 7;
  const width =
    measureText(lead, style, fonts) +
    gap +
    arrowWidth +
    gap +
    measureText(line.letters, style, fonts);
  const baseline = baselineFrom(line.top, style);
  let cursor = geometry.contentRight - width;
  cursor += drawLine(page, lead, cursor, baseline, style, fonts) + gap;
  cursor += drawKickerArrow(page, cursor, baseline, COLORS.muted) + gap;
  drawLine(page, line.letters, cursor, baseline, style, fonts);
}
