import {
  clip,
  endPath,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  type PDFDocument,
  type PDFPage,
} from 'pdf-lib';
import { getImagePlacement } from '../storyboard/image-transform';
import {
  DEFAULT_IMAGE_TRANSFORM,
  type Scene,
  type StoryProject,
} from '../storyboard/model';
import type { PageGeometry } from './geometry';
import {
  encodePdfImageForFrames,
  type PdfSourceImageMime,
} from './image-encoding';
import { joinParts, longDate, pad2, ratioLabel } from './format';
import { COLORS, TYPE, baselineFrom, type Fonts } from './theme';
import { drawLine, measureText, wrapText } from './text';

/** Section 9 proportions and spacing. */
const IMAGE_FRACTION = 0.43;
const IMAGE_TO_KICKER = 40;
const KICKER_TO_TITLE = 10;
const TITLE_TO_META = 14;
const META_TO_CONTENTS = 40;
const CONTENTS_RULE_GAP = 12;
const CONTENTS_NUMBER_COLUMN = 24;
const CONTENTS_ROW = 22;
const CONTENTS_COLUMN_GAP = 18;

const DATA_URL =
  /^data:(image\/(?:png|jpeg|jpg|webp|gif|avif));base64,([A-Za-z0-9+/=\s]+)$/i;

function parseDataUrl(
  dataUrl: string,
): { mime: PdfSourceImageMime; bytes: Uint8Array } | null {
  const match = DATA_URL.exec(dataUrl);
  if (!match) return null;
  const binary = globalThis.atob(match[2].replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return { mime: match[1].toLowerCase() as PdfSourceImageMime, bytes };
}

function firstSelectedArtwork(scenes: Scene[]): string | null {
  for (const scene of scenes) {
    for (const shot of scene.shots) {
      for (const panel of shot.panels) {
        if (!panel.selectedVersionId) continue;
        const version = panel.versions.find(
          (candidate) => candidate.id === panel.selectedVersionId,
        );
        if (version) return version.dataUrl;
      }
    }
  }
  return null;
}

export type CoverInput = {
  project: StoryProject;
  scenes: Scene[];
  geometry: PageGeometry;
  fonts: Fonts;
  /** Scene id to the board page it starts on, before the cover is counted. */
  sceneStarts: Map<string, number>;
};

/**
 * Section 9. Drawn onto a page the caller inserts at index 0, so the cover is
 * page 1 and carries no page number.
 */
export async function drawCover(
  document: PDFDocument,
  page: PDFPage,
  input: CoverInput,
): Promise<void> {
  const { project, scenes, geometry, fonts } = input;
  const { pageWidth, pageHeight, contentLeft, contentRight, contentWidth } =
    geometry;
  const imageHeight = pageHeight * IMAGE_FRACTION;
  const imageBottom = pageHeight - imageHeight;

  page.drawRectangle({
    x: 0,
    y: 0,
    width: pageWidth,
    height: pageHeight,
    color: COLORS.ground,
  });
  page.drawRectangle({
    x: 0,
    y: imageBottom,
    width: pageWidth,
    height: imageHeight,
    color: COLORS.pendingGround,
  });

  const source = firstSelectedArtwork(scenes);
  const parsed = source ? parseDataUrl(source) : null;
  if (parsed) {
    const transform = { ...DEFAULT_IMAGE_TRANSFORM, fit: 'cover' as const };
    const encoded = await encodePdfImageForFrames(parsed, {
      uses: [
        { widthPoints: pageWidth, heightPoints: imageHeight, transform },
      ],
    });
    const image =
      encoded.mime === 'image/png'
        ? await document.embedPng(encoded.bytes)
        : await document.embedJpg(encoded.bytes);
    const placement = getImagePlacement(
      image.width,
      image.height,
      pageWidth,
      imageHeight,
      transform,
    );
    page.pushOperators(
      pushGraphicsState(),
      rectangle(0, imageBottom, pageWidth, imageHeight),
      clip(),
      endPath(),
    );
    page.drawImage(image, {
      x: placement.x,
      y: pageHeight - placement.y - placement.height,
      width: placement.width,
      height: placement.height,
    });
    page.pushOperators(popGraphicsState());
  }

  let cursor = imageBottom - IMAGE_TO_KICKER;
  const kicker = joinParts(['STORYBOARD', project.subtitle ?? '']);
  drawLine(
    page,
    kicker,
    contentLeft,
    baselineFrom(cursor, TYPE.coverKicker),
    TYPE.coverKicker,
    fonts,
  );
  cursor -= TYPE.coverKicker.leading + KICKER_TO_TITLE;

  const title = wrapText(
    project.name || 'Untitled storyboard',
    TYPE.coverTitle,
    fonts,
    contentWidth,
  );
  for (const line of title) {
    drawLine(
      page,
      line,
      contentLeft,
      baselineFrom(cursor, TYPE.coverTitle),
      TYPE.coverTitle,
      fonts,
    );
    cursor -= TYPE.coverTitle.leading;
  }

  cursor -= TITLE_TO_META;
  const meta = joinParts([
    project.draftLabel ?? '',
    longDate(project.updatedAt),
    ratioLabel(project.aspectRatio),
    project.style ?? '',
  ]);
  for (const line of wrapText(meta, TYPE.coverMeta, fonts, contentWidth)) {
    drawLine(
      page,
      line,
      contentLeft,
      baselineFrom(cursor, TYPE.coverMeta),
      TYPE.coverMeta,
      fonts,
    );
    cursor -= TYPE.coverMeta.leading;
  }

  cursor -= META_TO_CONTENTS;
  page.drawLine({
    start: { x: contentLeft, y: cursor },
    end: { x: contentRight, y: cursor },
    thickness: 0.75,
    color: COLORS.rule,
  });
  cursor -= CONTENTS_RULE_GAP;
  drawContents(page, input, cursor);

  const shots = scenes.reduce((total, scene) => total + scene.shots.length, 0);
  const panels = scenes.reduce(
    (total, scene) =>
      total +
      scene.shots.reduce((count, shot) => count + shot.panels.length, 0),
    0,
  );
  drawLine(
    page,
    joinParts([
      `${shots} ${shots === 1 ? 'SHOT' : 'SHOTS'}`,
      `${panels} ${panels === 1 ? 'PANEL' : 'PANELS'}`,
    ]),
    contentLeft,
    geometry.footerBaseline,
    TYPE.kicker,
    fonts,
  );
  const credits = joinParts([
    project.director ?? '',
    project.production ?? '',
    project.contact ?? '',
  ]);
  if (credits)
    drawLine(
      page,
      credits,
      contentRight,
      geometry.footerBaseline,
      TYPE.kicker,
      fonts,
      { align: 'right' },
    );
}

function drawContents(page: PDFPage, input: CoverInput, top: number): void {
  const { project, scenes, geometry, fonts, sceneStarts } = input;
  const columns = geometry.landscape ? 3 : 2;
  const columnWidth =
    (geometry.contentWidth - CONTENTS_COLUMN_GAP * (columns - 1)) / columns;
  const rows = Math.ceil(scenes.length / columns);
  scenes.forEach((scene, index) => {
    const column = Math.floor(index / rows);
    const row = index % rows;
    const x = geometry.contentLeft + column * (columnWidth + CONTENTS_COLUMN_GAP);
    const y = top - row * CONTENTS_ROW;
    const sceneNumber = project.scenes.indexOf(scene) + 1 || index + 1;
    drawLine(
      page,
      String(sceneNumber),
      x,
      baselineFrom(y, TYPE.coverContentsNumber),
      TYPE.coverContentsNumber,
      fonts,
    );
    const titleX = x + CONTENTS_NUMBER_COLUMN;
    const title = (scene.title ?? '').trim() || `Scene ${sceneNumber}`;
    const shots = scene.shots.length;
    const startPage = sceneStarts.get(scene.id);
    const kicker = joinParts([
      `${shots} ${shots === 1 ? 'SHOT' : 'SHOTS'}`,
      startPage === undefined ? '' : pad2(startPage),
    ]);
    const kickerWidth = measureText(kicker, TYPE.kicker, fonts);
    drawLine(
      page,
      kicker,
      x + columnWidth,
      baselineFrom(y + 2, TYPE.kicker),
      TYPE.kicker,
      fonts,
      { align: 'right' },
    );
    const available = columnWidth - CONTENTS_NUMBER_COLUMN - kickerWidth - 10;
    const [line] = wrapText(title, TYPE.coverContentsTitle, fonts, available);
    drawLine(
      page,
      line ?? title,
      titleX,
      baselineFrom(y + 1, TYPE.coverContentsTitle),
      TYPE.coverContentsTitle,
      fonts,
    );
  });
}
