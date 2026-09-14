import type { PDFDocument, PDFImage } from 'pdf-lib';
import type { ImageTransform, Panel, Scene } from '../storyboard/model';
import {
  encodePdfImageForFrames,
  type PdfImageFrameUse,
  type PdfSourceImageMime,
} from './image-encoding';

export type EmbeddedArtwork = {
  image: PDFImage;
  label: string;
  transform?: ImageTransform;
};

export type PdfArtworkGeometry = {
  contentWidth: number;
  columns: number;
  columnGap: number;
  landscape: boolean;
};

type SelectedUse = {
  panel: Panel;
  label: string;
  transform?: ImageTransform;
  frame: PdfImageFrameUse;
};

/** Embed each selected source once, sized for its largest printed use. */
export async function embedSelectedArtwork(
  document: PDFDocument,
  scenes: Scene[],
  aspectRatio: number,
  geometry: PdfArtworkGeometry,
): Promise<Map<string, EmbeddedArtwork>> {
  const groups = new Map<string, SelectedUse[]>();
  const result = new Map<string, EmbeddedArtwork>();
  for (const scene of scenes) {
    for (const shot of scene.shots) {
      for (const panel of shot.panels) {
        if (!panel.selectedVersionId) continue;
        const version = panel.versions.find(
          (value) => value.id === panel.selectedVersionId,
        );
        if (!version) {
          throw new Error(
            `Cannot export PDF: selected artwork for panel "${panel.title || panel.id}" no longer exists. Select another version or clear the selection.`,
          );
        }
        const use: SelectedUse = {
          panel,
          label: version.label,
          transform: version.transform,
          frame: frameFor(
            panel,
            shot.panels.length === 1,
            aspectRatio,
            geometry,
            version.transform,
          ),
        };
        const group = groups.get(version.dataUrl);
        if (group) group.push(use);
        else groups.set(version.dataUrl, [use]);
      }
    }
  }

  // Sequential encoding bounds temporary raster memory for large projects.
  for (const [dataUrl, uses] of groups) {
    try {
      const encoded = await encodePdfImageForFrames(parseDataUrl(dataUrl), {
        uses: uses.map((use) => use.frame),
      });
      const image =
        encoded.mime === 'image/png'
          ? await document.embedPng(encoded.bytes)
          : await document.embedJpg(encoded.bytes);
      for (const use of uses) {
        result.set(use.panel.id, {
          image,
          label: use.label,
          transform: use.transform,
        });
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const first = uses[0];
      throw new Error(
        `Cannot export PDF: artwork "${first.label || first.panel.selectedVersionId}" in panel "${first.panel.title || first.panel.id}" could not be read (${detail}). Replace that image and try again.`,
      );
    }
  }
  return result;
}

function frameFor(
  panel: Panel,
  singlePanelShot: boolean,
  ratio: number,
  geometry: PdfArtworkGeometry,
  transform?: ImageTransform,
): PdfImageFrameUse {
  const wide = panel.pdfFullWidth === true;
  const compactWidth =
    (geometry.contentWidth - geometry.columnGap * (geometry.columns - 1)) /
    geometry.columns;
  const pairWidth = (geometry.contentWidth - geometry.columnGap) / 2;
  const availableWidth = wide
    ? geometry.contentWidth
    : singlePanelShot
      ? pairWidth
      : compactWidth;
  const maxHeight = wide
    ? 292
    : singlePanelShot && !geometry.landscape
      ? 238
      : !geometry.landscape
        ? 190
        : geometry.columns === 2
          ? 98
          : 80;
  const heightPoints = Math.min(availableWidth / ratio, maxHeight);
  return { widthPoints: heightPoints * ratio, heightPoints, transform };
}

function parseDataUrl(dataUrl: string): {
  mime: PdfSourceImageMime;
  bytes: Uint8Array;
} {
  const match =
    /^data:(image\/(?:png|jpeg|jpg|webp|gif|avif));base64,([A-Za-z0-9+/=\s]+)$/i.exec(
      dataUrl,
    );
  if (!match)
    throw new Error('expected a base64 PNG, JPEG, WebP, GIF, or AVIF data URL');
  const binary = globalThis.atob(match[2].replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return { mime: match[1].toLowerCase() as PdfSourceImageMime, bytes };
}
