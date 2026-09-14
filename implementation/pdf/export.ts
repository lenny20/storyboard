import {
  PDFDocument,
  PDFFont,
  PDFImage,
  PDFPage,
  rgb,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

import type { Panel, Scene, Shot, StoryProject } from '../storyboard/model';

export interface StoryboardPdfOptions {
  sceneId?: string;
}

type Fonts = {
  regular: PDFFont;
  medium: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
};

type EmbeddedArtwork = {
  image: PDFImage;
  label: string;
};

type PageContext = {
  page: PDFPage;
  scene: Scene;
  shot?: Shot;
  continuation: boolean;
};

type PanelCopy = {
  label: string;
  heading: string;
  meta: string;
  description: string[];
};

const A4 = { width: 595.28, height: 841.89 };
const MARGIN_X = 46;
const BODY_TOP = 742;
const BODY_BOTTOM = 61;
const CONTENT_WIDTH = A4.width - MARGIN_X * 2;
const COLUMN_GAP = 18;

const ink = rgb(0.095, 0.102, 0.108);
const muted = rgb(0.36, 0.38, 0.40);
const hairline = rgb(0.79, 0.79, 0.76);
const paperTint = rgb(0.972, 0.968, 0.952);
const emptyTint = rgb(0.948, 0.944, 0.927);
const cameraAccent = rgb(0.66, 0.38, 0.07);
const actionAccent = rgb(0.18, 0.35, 0.39);

/**
 * Creates a browser-safe, A4 portrait storyboard PDF. The returned bytes can be
 * passed directly to a Blob by the caller.
 */
export async function createStoryboardPdf(
  project: StoryProject,
  options: StoryboardPdfOptions = {},
): Promise<Uint8Array> {
  assertProjectShape(project);

  const scenes = options.sceneId
    ? project.scenes.filter((scene) => scene.id === options.sceneId)
    : project.scenes;
  if (options.sceneId && scenes.length === 0) {
    throw new Error(`Cannot export PDF: scene "${options.sceneId}" was not found.`);
  }

  const document = await PDFDocument.create();
  document.setTitle(pdfSafe(project.name || 'Untitled storyboard'));
  document.setAuthor('Storyboard Studio');
  document.setSubject('Printable storyboard');
  document.setCreator('Storyboard Studio PDF export');
  document.setProducer('pdf-lib');
  document.setCreationDate(new Date());
  document.setModificationDate(new Date());

  document.registerFontkit(fontkit);
  const [regularBytes, semiboldBytes, italicBytes] = await Promise.all([
    loadFont(new URL('./fonts/NotoSans-Regular.ttf', import.meta.url)),
    loadFont(new URL('./fonts/NotoSans-SemiBold.ttf', import.meta.url)),
    loadFont(new URL('./fonts/NotoSans-Italic.ttf', import.meta.url)),
  ]);
  const fonts: Fonts = {
    regular: await document.embedFont(regularBytes, { subset: true }),
    medium: await document.embedFont(semiboldBytes, { subset: true }),
    bold: await document.embedFont(semiboldBytes, { subset: true }),
    italic: await document.embedFont(italicBytes, { subset: true }),
  };
  const artwork = await embedSelectedArtwork(document, scenes);
  const renderer = new StoryboardRenderer(document, fonts, project, artwork);

  if (scenes.length === 0) {
    renderer.drawEmptyProject();
  } else {
    scenes.forEach((scene) => renderer.drawScene(scene, project.scenes.indexOf(scene)));
  }
  renderer.finish();

  return document.save({ useObjectStreams: true });
}

class StoryboardRenderer {
  private readonly pages: PageContext[] = [];
  private current!: PageContext;
  private y = BODY_TOP;
  private activeShotNumber = '';

  constructor(
    private readonly document: PDFDocument,
    private readonly fonts: Fonts,
    private readonly project: StoryProject,
    private readonly artwork: Map<string, EmbeddedArtwork>,
  ) {}

  drawEmptyProject(): void {
    const emptyScene: Scene = { id: 'empty', title: 'No scenes', shots: [] };
    this.addPage(emptyScene);
    this.drawSceneHeading('STORYBOARD', 'No scenes have been added to this project.');
  }

  drawScene(scene: Scene, sceneIndex: number): void {
    this.addPage(scene);
    this.drawSceneHeading(
      `SCENE ${pad(sceneIndex + 1)}`,
      scene.title || 'Untitled scene',
    );

    if (scene.shots.length === 0) {
      this.drawQuietMessage('No shots in this scene.');
      return;
    }

    scene.shots.forEach((shot, shotIndex) => {
      this.activeShotNumber = pad(shotIndex + 1);
      if (this.remaining < 150) this.addPage(scene, shot, true);
      this.drawShot(scene, shot, shotIndex);
    });
  }

  private drawSceneHeading(kicker: string, title: string): void {
    this.drawTracked(kicker, MARGIN_X, this.y, 7.5, muted);
    this.y -= 27;
    let lines = wrapText(title, this.fonts.medium, 25, CONTENT_WIDTH);
    if (lines.length === 0) lines = ['Untitled scene'];
    while (lines.length > 0) {
      const capacity = Math.max(1, Math.floor((this.y - BODY_BOTTOM - 26) / 29));
      const chunk = lines.slice(0, capacity);
      chunk.forEach((line) => {
        this.drawText(line, MARGIN_X, this.y, this.fonts.medium, 25, ink);
        this.y -= 29;
      });
      lines = lines.slice(chunk.length);
      if (lines.length > 0) {
        const scene = this.current.scene;
        this.addPage(scene);
        this.drawTracked(`${kicker} / CONTINUED`, MARGIN_X, this.y, 7.5, muted);
        this.y -= 27;
      }
    }
    this.y += 5;
    this.rule(this.y);
    this.y -= 29;
  }

  private drawShot(scene: Scene, shot: Shot, shotIndex: number): void {
    this.current.shot = shot;
    this.current.continuation = false;
    const shotNumber = pad(shotIndex + 1);
    this.activeShotNumber = shotNumber;

    const titleWidth = CONTENT_WIDTH - 42 - 92;
    let titleLines = wrapText(shot.title || 'Untitled shot', this.fonts.medium, 15, titleWidth);
    this.ensureSpace(Math.min(110, 51 + titleLines.length * 18), scene, shot);
    this.drawText(shotNumber, MARGIN_X, this.y, this.fonts.medium, 20, muted);
    const countLabel = `${shot.panels.length} PANEL${shot.panels.length === 1 ? '' : 'S'}`;
    this.drawRight(countLabel, A4.width - MARGIN_X, this.y + 3, this.fonts.bold, 7.2, muted);
    let firstTitleLine = true;
    while (titleLines.length > 0) {
      const availableLines = Math.max(1, Math.floor((this.y - BODY_BOTTOM - 34) / 18));
      const chunk = titleLines.slice(0, availableLines);
      chunk.forEach((line) => {
        this.drawText(line, MARGIN_X + 42, this.y + (firstTitleLine ? 1 : 0), this.fonts.medium, 15, ink);
        this.y -= 18;
        firstTitleLine = false;
      });
      titleLines = titleLines.slice(chunk.length);
      if (titleLines.length > 0) this.addPage(scene, shot, true);
    }
    this.y -= 11;

    if (nonEmpty(shot.description)) {
      this.drawFlowField(scene, shot, 'SHOT INTENT', shot.description, {
        font: this.fonts.regular,
        size: 10.2,
        leading: 14.2,
        after: 17,
      });
    }

    if (shot.panels.length === 0) {
      this.ensureSpace(66, scene, shot);
      this.drawMissingPanels();
    } else {
      this.drawPanels(scene, shot, shot.panels);
    }

    this.drawFlowField(scene, shot, 'CAMERA', shot.camera, { after: 12 });
    this.drawFlowField(scene, shot, 'ACTION', shot.action, { after: 12 });
    this.drawFlowField(scene, shot, 'NOTES', shot.notes, { after: 12 });
    this.drawFlowField(scene, shot, 'DIALOGUE', shot.dialogue, {
      font: this.fonts.italic,
      size: 10.6,
      leading: 15.2,
      after: 18,
    });

    if (this.remaining >= 24) {
      this.rule(this.y, hairline, 0.45);
      this.y -= 25;
    } else {
      this.y = BODY_BOTTOM;
    }
  }

  private drawPanels(scene: Scene, shot: Shot, panels: Panel[]): void {
    let index = 0;
    while (index < panels.length) {
      const first = panels[index];
      const second = panels[index + 1];
      const firstCopy = this.panelCopy(first, index);
      const secondCopy = second ? this.panelCopy(second, index + 1) : undefined;
      const canPair = Boolean(
        secondCopy &&
          this.panelPairFits(firstCopy, secondCopy),
      );

      if (canPair && second && secondCopy) {
        this.drawPanelPair(scene, shot, first, firstCopy, second, secondCopy);
        index += 2;
      } else {
        this.drawSinglePanel(scene, shot, first, firstCopy);
        index += 1;
      }
    }
  }

  private panelPairFits(left: PanelCopy, right: PanelCopy): boolean {
    const width = (CONTENT_WIDTH - COLUMN_GAP) / 2;
    const leftLayout = panelLayout(left, width, this.fonts, 9.2, 12.3);
    const rightLayout = panelLayout(right, width, this.fonts, 9.2, 12.3);
    const frame = frameSize(width, this.project.aspectRatio, 238);
    const required = frame.height + 13 + Math.max(leftLayout.height, rightLayout.height) + 24;
    return leftLayout.description.length <= 7 &&
      rightLayout.description.length <= 7 &&
      required <= BODY_TOP - BODY_BOTTOM - 28;
  }

  private drawPanelPair(
    scene: Scene,
    shot: Shot,
    left: Panel,
    leftCopy: PanelCopy,
    right: Panel,
    rightCopy: PanelCopy,
  ): void {
    const width = (CONTENT_WIDTH - COLUMN_GAP) / 2;
    const leftFrame = frameSize(width, this.project.aspectRatio, 238);
    const rightFrame = frameSize(width, this.project.aspectRatio, 238);
    const leftLayout = panelLayout(leftCopy, width, this.fonts, 9.2, 12.3);
    const rightLayout = panelLayout(rightCopy, width, this.fonts, 9.2, 12.3);
    const captionHeight = Math.max(
      leftLayout.height,
      rightLayout.height,
    );
    const required = Math.max(leftFrame.height, rightFrame.height) + 13 + captionHeight + 24;
    this.ensureSpace(required, scene, shot);

    const top = this.y;
    this.drawPanelFrame(left, MARGIN_X + (width - leftFrame.width) / 2, top, leftFrame.width, leftFrame.height);
    this.drawPanelFrame(
      right,
      MARGIN_X + width + COLUMN_GAP + (width - rightFrame.width) / 2,
      top,
      rightFrame.width,
      rightFrame.height,
    );
    const captionTop = top - Math.max(leftFrame.height, rightFrame.height) - 13;
    this.drawPanelCaption(leftLayout, MARGIN_X, captionTop, 9.2, 12.3);
    this.drawPanelCaption(
      rightLayout,
      MARGIN_X + width + COLUMN_GAP,
      captionTop,
      9.2,
      12.3,
    );
    this.y -= required;
  }

  private drawSinglePanel(
    scene: Scene,
    shot: Shot,
    panel: Panel,
    copy: PanelCopy,
  ): void {
    const frame = frameSize(CONTENT_WIDTH, this.project.aspectRatio, 292);
    const layout = panelLayout(copy, CONTENT_WIDTH, this.fonts, 9.5, 13);
    this.ensureSpace(frame.height + 13 + 30, scene, shot);

    const frameX = MARGIN_X + (CONTENT_WIDTH - frame.width) / 2;
    this.drawPanelFrame(panel, frameX, this.y, frame.width, frame.height);
    this.y -= frame.height + 13;
    this.drawPanelLines(scene, shot, copy.label, layout.heading, this.fonts.bold, 9.2, 15, false);
    this.drawPanelLines(scene, shot, copy.label, layout.meta, this.fonts.bold, 6.8, 12, true);
    this.drawPanelLines(scene, shot, copy.label, layout.description, this.fonts.regular, 9.5, 13, false);
    this.y -= 22;
  }

  private drawPanelLines(
    scene: Scene,
    shot: Shot,
    panelLabel: string,
    sourceLines: string[],
    font: PDFFont,
    size: number,
    leading: number,
    tracked: boolean,
  ): void {
    let lines = sourceLines;
    while (lines.length > 0) {
      if (this.remaining < leading + 17) {
        this.addPage(scene, shot, true);
        this.drawTracked(`${panelLabel} / CAPTION CONTINUED`, MARGIN_X, this.y, 7, muted);
        this.y -= 22;
      }
      const capacity = Math.max(1, Math.floor((this.y - BODY_BOTTOM - 17) / leading));
      const chunk = lines.slice(0, capacity);
      chunk.forEach((line) => {
        if (tracked) this.drawTracked(line, MARGIN_X, this.y, size, muted);
        else this.drawText(line, MARGIN_X, this.y, font, size, ink);
        this.y -= leading;
      });
      lines = lines.slice(chunk.length);
      if (lines.length > 0) {
        this.addPage(scene, shot, true);
        this.drawTracked(`${panelLabel} / CAPTION CONTINUED`, MARGIN_X, this.y, 7, muted);
        this.y -= 22;
      }
    }
  }

  private drawPanelCaption(
    layout: ReturnType<typeof panelLayout>,
    x: number,
    top: number,
    size: number,
    leading: number,
  ): void {
    let cursor = top;
    layout.heading.forEach((line) => {
      this.drawText(line, x, cursor, this.fonts.bold, size, ink);
      cursor -= 14;
    });
    layout.meta.forEach((line) => {
      this.drawTracked(line, x, cursor, 6.4, muted);
      cursor -= 11;
    });
    layout.description.forEach((line) => {
      this.drawText(line, x, cursor, this.fonts.regular, size, ink);
      cursor -= leading;
    });
  }

  private panelCopy(panel: Panel, index: number): PanelCopy {
    const label = `${this.activeShotNumber}${alphaIndex(index)}`;
    const heading = `${label}  ${pdfSafe(panel.title || 'Untitled panel')}`;
    const meta = [panel.framing, panel.angle]
      .map((value) => pdfSafe(value.trim()).toUpperCase())
      .filter(Boolean)
      .join(' / ');
    return {
      label,
      heading,
      meta,
      description: wrapText(
        panel.description.trim(),
        this.fonts.regular,
        9.5,
        CONTENT_WIDTH,
      ),
    };
  }

  private drawPanelFrame(panel: Panel, x: number, top: number, width: number, height: number): void {
    const page = this.current.page;
    const bottom = top - height;
    page.drawRectangle({
      x,
      y: bottom,
      width,
      height,
      color: emptyTint,
      borderColor: rgb(0.57, 0.57, 0.54),
      borderWidth: 0.55,
    });

    const embedded = this.artwork.get(panel.id);
    if (embedded) {
      const scale = Math.min(width / embedded.image.width, height / embedded.image.height);
      const imageWidth = embedded.image.width * scale;
      const imageHeight = embedded.image.height * scale;
      page.drawImage(embedded.image, {
        x: x + (width - imageWidth) / 2,
        y: bottom + (height - imageHeight) / 2,
        width: imageWidth,
        height: imageHeight,
      });
    } else {
      const centerX = x + width / 2;
      const centerY = bottom + height / 2;
      page.drawLine({
        start: { x: centerX - 15, y: centerY },
        end: { x: centerX + 15, y: centerY },
        thickness: 0.5,
        color: hairline,
      });
      page.drawLine({
        start: { x: centerX, y: centerY - 15 },
        end: { x: centerX, y: centerY + 15 },
        thickness: 0.5,
        color: hairline,
      });
      const label = 'ARTWORK PENDING';
      const labelWidth = this.fonts.bold.widthOfTextAtSize(label, 6.4);
      this.drawText(label, centerX - labelWidth / 2, centerY - 29, this.fonts.bold, 6.4, muted);
    }

    panel.markers.forEach((marker) => {
      const radius = Math.max(4, Math.min(10, 5.5 * positive(marker.scale, 1)));
      const markerX = x + radius + 1 + clamp01(marker.x) * (width - radius * 2 - 2);
      const markerY = bottom + radius + 1 + (1 - clamp01(marker.y)) * (height - radius * 2 - 2);
      page.drawCircle({
        x: markerX,
        y: markerY,
        size: radius,
        borderColor: cameraAccent,
        borderWidth: 0.9,
        opacity: 0.8,
      });
      this.drawOverlayLabel(pdfSafe(marker.label), markerX + radius + 3, markerY + 2, x, bottom, width, height, cameraAccent);
    });

    panel.arrows.forEach((arrow) => {
      const inset = 8;
      const x1 = x + inset + clamp01(arrow.x1) * (width - inset * 2);
      const y1 = bottom + inset + (1 - clamp01(arrow.y1)) * (height - inset * 2);
      const x2 = x + inset + clamp01(arrow.x2) * (width - inset * 2);
      const y2 = bottom + inset + (1 - clamp01(arrow.y2)) * (height - inset * 2);
      const color = arrow.kind === 'camera' ? cameraAccent : actionAccent;
      drawArrow(page, x1, y1, x2, y2, color);
      this.drawOverlayLabel(
        pdfSafe(arrow.label || (arrow.kind === 'camera' ? 'CAMERA' : 'ACTION')),
        (x1 + x2) / 2 + 4,
        (y1 + y2) / 2 + 4,
        x,
        bottom,
        width,
        height,
        color,
      );
    });
  }

  private drawOverlayLabel(
    value: string,
    wantedX: number,
    wantedY: number,
    frameX: number,
    frameY: number,
    frameWidth: number,
    frameHeight: number,
    color: ReturnType<typeof rgb>,
  ): void {
    const label = truncateToWidth(value || 'MARK', this.fonts.bold, 7, Math.max(42, frameWidth * 0.62));
    const textWidth = this.fonts.bold.widthOfTextAtSize(safeForFont(label, this.fonts.bold), 7);
    const boxWidth = textWidth + 8;
    const boxHeight = 14;
    const x = clamp(wantedX, frameX + 2, frameX + frameWidth - boxWidth - 2);
    const y = clamp(wantedY, frameY + 2, frameY + frameHeight - boxHeight - 2);
    this.current.page.drawRectangle({
      x,
      y,
      width: boxWidth,
      height: boxHeight,
      color: paperTint,
      opacity: 0.93,
    });
    this.drawText(label, x + 4, y + 3.5, this.fonts.bold, 7, color);
  }

  private drawFlowField(
    scene: Scene,
    shot: Shot,
    label: string,
    value: string,
    options: {
      font?: PDFFont;
      size?: number;
      leading?: number;
      after?: number;
    } = {},
  ): void {
    if (!nonEmpty(value)) return;
    const font = options.font ?? this.fonts.regular;
    const size = options.size ?? 10.2;
    const leading = options.leading ?? 14.2;
    const after = options.after ?? 13;
    const labelWidth = 76;
    const textWidth = CONTENT_WIDTH - labelWidth;
    const blocks = pdfSafe(value.trim()).split(/\r?\n/).map((paragraph) => {
      const lines = wrapText(paragraph, font, size, textWidth);
      return lines.length ? lines : [''];
    });
    let continued = false;

    while (blocks.length > 0) {
      this.ensureSpace(29, scene, shot);
      let capacity = Math.max(1, Math.floor((this.y - BODY_BOTTOM - 10) / leading));
      if (blocks[0].length <= 4 && blocks[0].length > capacity && this.y < BODY_TOP - 50) {
        this.addPage(scene, shot, true);
        continued = true;
        capacity = Math.max(1, Math.floor((this.y - BODY_BOTTOM - 10) / leading));
      }
      const chunk: string[] = [];
      while (blocks.length > 0 && chunk.length < capacity) {
        const block = blocks[0];
        const available = capacity - chunk.length;
        if (block.length <= available) {
          chunk.push(...block);
          blocks.shift();
          continue;
        }
        if (chunk.length > 0) break;
        let take = available;
        if (block.length - take === 1 && take > 1) take -= 1;
        chunk.push(...block.splice(0, take));
        if (block.length === 0) blocks.shift();
        break;
      }
      this.drawTracked(`${label}${continued ? ' (CONT.)' : ''}`, MARGIN_X, this.y, 6.7, muted);
      let lineY = this.y;
      chunk.forEach((line) => {
        this.drawText(line, MARGIN_X + labelWidth, lineY, font, size, ink);
        lineY -= leading;
      });
      this.y = lineY;
      if (blocks.length > 0) {
        this.addPage(scene, shot, true);
        continued = true;
      }
    }
    this.y -= after;
  }

  private drawMissingPanels(): void {
    this.current.page.drawRectangle({
      x: MARGIN_X,
      y: this.y - 44,
      width: CONTENT_WIDTH,
      height: 44,
      color: emptyTint,
      borderColor: hairline,
      borderWidth: 0.5,
    });
    this.drawTracked('NO PANELS SUPPLIED', MARGIN_X + 15, this.y - 25, 6.8, muted);
    this.y -= 65;
  }

  private drawQuietMessage(message: string): void {
    this.drawText(message, MARGIN_X, this.y, this.fonts.italic, 10.5, muted);
    this.y -= 24;
  }

  private addPage(scene: Scene, shot?: Shot, continuation = false): void {
    const page = this.document.addPage([A4.width, A4.height]);
    page.drawRectangle({ x: 0, y: 0, width: A4.width, height: A4.height, color: paperTint });
    this.current = { page, scene, shot, continuation };
    this.pages.push(this.current);
    this.y = BODY_TOP;

    if (shot && continuation) {
      this.drawTracked(`SHOT ${this.activeShotNumber} / CONTINUED`, MARGIN_X, this.y, 7.2, muted);
      this.y -= 28;
    }
  }

  private ensureSpace(height: number, scene: Scene, shot?: Shot): void {
    if (this.remaining >= height) return;
    this.addPage(scene, shot, Boolean(shot));
  }

  private get remaining(): number {
    return this.y - BODY_BOTTOM;
  }

  finish(): void {
    const total = this.pages.length;
    const date = formatDate(this.project.updatedAt || this.project.createdAt);
    this.pages.forEach((context, index) => {
      const page = context.page;
      const headerTitle = truncateToWidth(this.project.name || 'Untitled storyboard', this.fonts.medium, 17, 315);
      this.drawTextOn(page, headerTitle, MARGIN_X, 790, this.fonts.medium, 17, ink);
      this.drawRightOn(page, date, A4.width - MARGIN_X, 792, this.fonts.regular, 7.2, muted);
      this.drawTrackedOn(page, 'STORYBOARD', MARGIN_X, 770, 6.8, muted);
      this.drawRightOn(
        page,
        truncateToWidth(pdfSafe(context.scene.title || 'Untitled scene').toUpperCase(), this.fonts.bold, 6.8, 255),
        A4.width - MARGIN_X,
        770,
        this.fonts.bold,
        6.8,
        muted,
      );
      page.drawLine({
        start: { x: MARGIN_X, y: 755 },
        end: { x: A4.width - MARGIN_X, y: 755 },
        thickness: 0.45,
        color: hairline,
      });

      page.drawLine({
        start: { x: MARGIN_X, y: 44 },
        end: { x: A4.width - MARGIN_X, y: 44 },
        thickness: 0.45,
        color: hairline,
      });
      const ratio = trimNumber(this.project.aspectRatio);
      const footerStyle = truncateTrackedToWidth(`${pdfSafe(this.project.style || 'STORYBOARD')} / ${ratio}:1`, this.fonts.bold, 6.4, 270);
      this.drawTrackedOn(page, footerStyle, MARGIN_X, 27, 6.4, muted);
      this.drawRightOn(
        page,
        `${pad(index + 1)} / ${pad(total)}`,
        A4.width - MARGIN_X,
        25,
        this.fonts.medium,
        9.5,
        ink,
      );
    });
  }

  private rule(y: number, color = hairline, thickness = 0.5): void {
    this.current.page.drawLine({
      start: { x: MARGIN_X, y },
      end: { x: A4.width - MARGIN_X, y },
      thickness,
      color,
    });
  }

  private drawText(value: string, x: number, y: number, font: PDFFont, size: number, color: ReturnType<typeof rgb>): void {
    this.drawTextOn(this.current.page, value, x, y, font, size, color);
  }

  private drawTextOn(page: PDFPage, value: string, x: number, y: number, font: PDFFont, size: number, color: ReturnType<typeof rgb>): void {
    page.drawText(safeForFont(pdfSafe(value), font), { x, y, font, size, color });
  }

  private drawRight(value: string, right: number, y: number, font: PDFFont, size: number, color: ReturnType<typeof rgb>): void {
    this.drawRightOn(this.current.page, value, right, y, font, size, color);
  }

  private drawRightOn(page: PDFPage, value: string, right: number, y: number, font: PDFFont, size: number, color: ReturnType<typeof rgb>): void {
    const safe = safeForFont(pdfSafe(value), font);
    page.drawText(safe, { x: right - font.widthOfTextAtSize(safe, size), y, font, size, color });
  }

  private drawTracked(value: string, x: number, y: number, size: number, color: ReturnType<typeof rgb>): void {
    this.drawTrackedOn(this.current.page, value, x, y, size, color);
  }

  private drawTrackedOn(page: PDFPage, value: string, x: number, y: number, size: number, color: ReturnType<typeof rgb>): void {
    const safe = safeForFont(pdfSafe(value), this.fonts.bold);
    let cursor = x;
    for (const character of safe) {
      page.drawText(character, {
        x: cursor,
        y,
        font: this.fonts.bold,
        size,
        color,
      });
      cursor += this.fonts.bold.widthOfTextAtSize(character, size) + 0.75;
    }
  }
}

async function embedSelectedArtwork(
  document: PDFDocument,
  scenes: Scene[],
): Promise<Map<string, EmbeddedArtwork>> {
  const result = new Map<string, EmbeddedArtwork>();
  for (const scene of scenes) {
    for (const shot of scene.shots) {
      for (const panel of shot.panels) {
        if (!panel.selectedVersionId) continue;
        const version = panel.versions.find((candidate) => candidate.id === panel.selectedVersionId);
        if (!version) {
          throw new Error(
            `Cannot export PDF: selected artwork for panel "${panel.title || panel.id}" no longer exists. Select another version or clear the selection.`,
          );
        }
        try {
          const parsed = await decodeImageDataUrl(version.dataUrl);
          const image = parsed.mime === 'image/png'
            ? await document.embedPng(parsed.bytes)
            : await document.embedJpg(parsed.bytes);
          result.set(panel.id, { image, label: version.label });
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          throw new Error(
            `Cannot export PDF: artwork "${version.label || version.id}" in panel "${panel.title || panel.id}" could not be read (${detail}). Replace that image and try again.`,
          );
        }
      }
    }
  }
  return result;
}

async function decodeImageDataUrl(dataUrl: string): Promise<{ mime: 'image/png' | 'image/jpeg'; bytes: Uint8Array }> {
  const match = /^data:(image\/(?:png|jpeg|jpg|webp|gif|avif));base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl);
  if (!match) throw new Error('expected a base64 PNG, JPEG, WebP, GIF, or AVIF data URL');
  const sourceMime = match[1].toLowerCase().replace('image/jpg', 'image/jpeg');
  const binary = globalThis.atob(match[2].replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  if (sourceMime === 'image/png' || sourceMime === 'image/jpeg') {
    return { mime: sourceMime, bytes };
  }
  return { mime: 'image/png', bytes: await convertBrowserImageToPng(bytes, sourceMime) };
}

async function convertBrowserImageToPng(bytes: Uint8Array, mime: string): Promise<Uint8Array> {
  if (typeof globalThis.createImageBitmap !== 'function') {
    throw new Error(`${mime} export requires a browser with createImageBitmap support`);
  }
  const copiedBytes = new Uint8Array(bytes);
  const bitmap = await globalThis.createImageBitmap(new Blob([copiedBytes.buffer], { type: mime }));
  try {
    if (typeof globalThis.OffscreenCanvas === 'function') {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('browser could not create an image conversion canvas');
      context.drawImage(bitmap, 0, 0);
      const png = await canvas.convertToBlob({ type: 'image/png' });
      return new Uint8Array(await png.arrayBuffer());
    }
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('browser could not create an image conversion canvas');
      context.drawImage(bitmap, 0, 0);
      const png = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((result) => result ? resolve(result) : reject(new Error('browser image conversion failed')), 'image/png');
      });
      return new Uint8Array(await png.arrayBuffer());
    }
    throw new Error('browser does not provide an image conversion canvas');
  } finally {
    bitmap.close();
  }
}

function drawArrow(
  page: PDFPage,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: ReturnType<typeof rgb>,
): void {
  page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 1.35, color, opacity: 0.92 });
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const head = 7;
  const spread = Math.PI / 7;
  page.drawLine({
    start: { x: x2, y: y2 },
    end: { x: x2 - head * Math.cos(angle - spread), y: y2 - head * Math.sin(angle - spread) },
    thickness: 1.35,
    color,
  });
  page.drawLine({
    start: { x: x2, y: y2 },
    end: { x: x2 - head * Math.cos(angle + spread), y: y2 - head * Math.sin(angle + spread) },
    thickness: 1.35,
    color,
  });
}

function panelLayout(copy: PanelCopy, width: number, fonts: Fonts, size: number, leading: number): {
  heading: string[];
  meta: string[];
  description: string[];
  height: number;
} {
  const heading = wrapText(copy.heading, fonts.bold, size, width);
  const meta = wrapTrackedText(copy.meta, fonts.bold, 6.4, width);
  const description = wrapText(copy.description.join(' '), fonts.regular, size, width);
  return {
    heading,
    meta,
    description,
    height: heading.length * 14 + meta.length * 11 + Math.max(size, description.length * leading),
  };
}

function frameSize(maxWidth: number, ratio: number, maxHeight: number): { width: number; height: number } {
  const widthAtMax = maxWidth;
  const heightAtMax = widthAtMax / ratio;
  if (heightAtMax <= maxHeight) return { width: widthAtMax, height: heightAtMax };
  return { width: maxHeight * ratio, height: maxHeight };
}

function wrapText(value: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const safe = safeForFont(pdfSafe(value), font);
  if (!safe) return [];
  const result: string[] = [];
  for (const paragraph of safe.split(/\r?\n/)) {
    if (!paragraph.trim()) {
      if (result.length > 0 && result[result.length - 1] !== '') result.push('');
      continue;
    }
    const words = paragraph.trim().split(/\s+/);
    let line = '';
    for (const originalWord of words) {
      const pieces = splitLongWord(originalWord, font, size, maxWidth);
      for (const word of pieces) {
        const candidate = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
          line = candidate;
        } else {
          if (line) result.push(line);
          line = word;
        }
      }
    }
    if (line) result.push(line);
  }
  return result;
}

function splitLongWord(word: string, font: PDFFont, size: number, maxWidth: number): string[] {
  if (font.widthOfTextAtSize(word, size) <= maxWidth) return [word];
  const pieces: string[] = [];
  let part = '';
  for (const character of word) {
    const candidate = part + character;
    if (part && font.widthOfTextAtSize(`${candidate}-`, size) > maxWidth) {
      pieces.push(`${part}-`);
      part = character;
    } else {
      part = candidate;
    }
  }
  if (part) pieces.push(part);
  return pieces;
}

function truncateToWidth(value: string, font: PDFFont, size: number, maxWidth: number): string {
  const safe = safeForFont(pdfSafe(value), font);
  if (font.widthOfTextAtSize(safe, size) <= maxWidth) return safe;
  let output = safe;
  while (output.length > 1 && font.widthOfTextAtSize(`${output}...`, size) > maxWidth) {
    output = output.slice(0, -1);
  }
  return `${output.trimEnd()}...`;
}

function wrapTrackedText(value: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const safe = safeForFont(pdfSafe(value), font);
  if (!safe) return [];
  const result: string[] = [];
  let line = '';
  for (const originalWord of safe.trim().split(/\s+/)) {
    const pieces = splitLongTrackedWord(originalWord, font, size, maxWidth);
    for (const word of pieces) {
      const candidate = line ? `${line} ${word}` : word;
      if (trackedWidth(candidate, font, size) <= maxWidth) line = candidate;
      else {
        if (line) result.push(line);
        line = word;
      }
    }
  }
  if (line) result.push(line);
  return result;
}

function splitLongTrackedWord(word: string, font: PDFFont, size: number, maxWidth: number): string[] {
  if (trackedWidth(word, font, size) <= maxWidth) return [word];
  const pieces: string[] = [];
  let part = '';
  for (const character of word) {
    const candidate = part + character;
    if (part && trackedWidth(`${candidate}-`, font, size) > maxWidth) {
      pieces.push(`${part}-`);
      part = character;
    } else part = candidate;
  }
  if (part) pieces.push(part);
  return pieces;
}

function truncateTrackedToWidth(value: string, font: PDFFont, size: number, maxWidth: number): string {
  const safe = safeForFont(pdfSafe(value), font);
  if (trackedWidth(safe, font, size) <= maxWidth) return safe;
  let output = safe;
  while (output.length > 1 && trackedWidth(`${output}...`, font, size) > maxWidth) output = output.slice(0, -1);
  return `${output.trimEnd()}...`;
}

function trackedWidth(value: string, font: PDFFont, size: number): number {
  return font.widthOfTextAtSize(value, size) + Math.max(0, Array.from(value).length - 1) * 0.75;
}

function assertProjectShape(project: StoryProject): void {
  if (!project || typeof project !== 'object') throw new Error('Cannot export PDF: project data is missing.');
  if (!Array.isArray(project.scenes)) throw new Error('Cannot export PDF: project scenes are malformed.');
  if (!Number.isFinite(project.aspectRatio) || project.aspectRatio <= 0) {
    throw new Error('Cannot export PDF: aspect ratio must be a positive number.');
  }
  for (const scene of project.scenes) {
    if (!scene || !Array.isArray(scene.shots)) throw new Error('Cannot export PDF: a scene has malformed shots.');
    for (const shot of scene.shots) {
      if (!shot || !Array.isArray(shot.panels)) throw new Error('Cannot export PDF: a shot has malformed panels.');
      for (const panel of shot.panels) {
        if (!panel || !Array.isArray(panel.versions) || !Array.isArray(panel.arrows) || !Array.isArray(panel.markers)) {
          throw new Error('Cannot export PDF: a panel is malformed.');
        }
      }
    }
  }
}

function pdfSafe(value: string): string {
  const replacements: Record<string, string> = {
    '\u2010': '-', '\u2011': '-', '\u2012': '-', '\u2013': '-', '\u2014': '-', '\u2212': '-',
    '\u00A0': ' ',
  };
  const normalized = String(value ?? '').normalize('NFC');
  let output = '';
  for (const character of normalized) {
    if (replacements[character]) {
      output += replacements[character];
      continue;
    }
    const code = character.codePointAt(0) ?? 0;
    output += code >= 32 || character === '\n' || character === '\r' || character === '\t' ? character : '';
  }
  return output.replace(/\t/g, '    ');
}

const fontCharacters = new WeakMap<PDFFont, Set<number>>();

function safeForFont(value: string, font: PDFFont): string {
  let characters = fontCharacters.get(font);
  if (!characters) {
    characters = new Set(font.getCharacterSet());
    fontCharacters.set(font, characters);
  }
  let output = '';
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (characters.has(code) || character === '\n' || character === '\r') {
      output += character;
      continue;
    }
    const codeLabel = `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
    throw new Error(
      `Cannot export PDF: the bundled font cannot render character "${character}" (${codeLabel}). Replace that character and try again.`,
    );
  }
  return output;
}

async function loadFont(url: URL): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Cannot export PDF: bundled font failed to load (${response.status}).`);
  return new Uint8Array(await response.arrayBuffer());
}

function nonEmpty(value: string): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function positive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clamp01(value: number): number {
  return clamp(Number.isFinite(value) ? value : 0, 0, 1);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function alphaIndex(value: number): string {
  let index = value;
  let output = '';
  do {
    output = String.fromCharCode(65 + (index % 26)) + output;
    index = Math.floor(index / 26) - 1;
  } while (index >= 0);
  return output;
}

function trimNumber(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function formatDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '');
  if (!match) return 'UNDATED';
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const month = months[Number(match[2]) - 1] ?? match[2];
  return `${Number(match[3])} ${month} ${match[1]}`;
}
