import { getImagePlacement } from '../storyboard/image-transform';
import type { ImageTransform } from '../storyboard/model';

export const DEFAULT_PDF_IMAGE_DPI = 200;
export const DEFAULT_PDF_JPEG_QUALITY = 0.88;

const DEFAULT_FRAME_BACKGROUND = '#f8f7f3';
const MAX_RASTER_EDGE = 8192;
const MAX_RASTER_PIXELS = 40_000_000;
const MAX_PASSTHROUGH_JPEG_BYTES = 1_500_000;
const MAX_PASSTHROUGH_PNG_BYTES = 750_000;

export type PdfSourceImageMime =
  | 'image/png'
  | 'image/jpeg'
  | 'image/jpg'
  | 'image/webp'
  | 'image/gif'
  | 'image/avif';

export type PdfImageSource = {
  bytes: Uint8Array;
  mime: PdfSourceImageMime;
};

export type PdfImageTarget = {
  /** Actual PDF draw width before frame clipping, in PDF points. */
  widthPoints: number;
  /** Actual PDF draw height before frame clipping, in PDF points. */
  heightPoints: number;
  dpi?: number;
};

export type PdfImageFrameUse = {
  widthPoints: number;
  heightPoints: number;
  transform?: ImageTransform;
};

export type PdfImageFramesTarget = {
  uses: readonly PdfImageFrameUse[];
  dpi?: number;
};

export type PdfImageEncodingOptions = {
  format?: 'image/jpeg' | 'image/png';
  jpegQuality?: number;
  /** Used to flatten transparent pixels before encoding. */
  background?: string;
};

export type EncodedPdfImage = {
  bytes: Uint8Array;
  mime: 'image/jpeg' | 'image/png';
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  reencoded: boolean;
  /** Present when optional raster optimization cannot replace valid native bytes. */
  fallbackReason?: string;
};

type Dimensions = { width: number; height: number };

/**
 * Prepares one selected image for a known PDF placement. The target should use
 * the image's drawn size before clipping, including any framing scale, so a
 * zoomed crop retains the requested print resolution. Source bytes are never
 * mutated. Repeated sources can be encoded once at their largest placement and
 * the returned bytes reused by the caller.
 */
export async function encodePdfImageForPlacement(
  source: PdfImageSource,
  target: PdfImageTarget,
  options: PdfImageEncodingOptions = {},
): Promise<EncodedPdfImage> {
  validateSourceBytes(source.bytes);
  const mime = normalizeMime(source.mime);
  const dpi = target.dpi ?? DEFAULT_PDF_IMAGE_DPI;
  positive(target.widthPoints, 'PDF image target width');
  positive(target.heightPoints, 'PDF image target height');
  positive(dpi, 'PDF image target DPI');
  const quality = encodingQuality(options);
  const required = requiredPixels(target.widthPoints, target.heightPoints, dpi);
  const nativeMime = mime === 'image/png' || mime === 'image/jpeg';
  const headerDimensions = nativeMime
    ? readNativeDimensions(source.bytes, mime)
    : undefined;

  if (
    nativeMime &&
    headerDimensions &&
    shouldPreserveNative(source.bytes, mime, headerDimensions, required)
  ) {
    return preserved(source.bytes, mime, headerDimensions);
  }

  if (!canRasterize()) {
    if (nativeMime && headerDimensions)
      return preserved(
        source.bytes,
        mime,
        headerDimensions,
        'Browser raster APIs unavailable; original native image retained.',
      );
    if (nativeMime) throw new Error(`Could not read ${mime} image dimensions.`);
    throw new Error(
      `${mime} PDF export requires browser image decoding and canvas support.`,
    );
  }

  try {
    const bitmap = await decodeBitmap(source.bytes, mime);
    try {
      const sourceDimensions = dimensions(bitmap.width, bitmap.height);
      return await encodeBitmap(
        source,
        mime,
        bitmap,
        sourceDimensions,
        required,
        quality,
        options,
      );
    } finally {
      bitmap.close();
    }
  } catch (error) {
    if (nativeMime && headerDimensions) {
      return preserved(
        source.bytes,
        mime,
        headerDimensions,
        `Browser raster optimization failed; original native image retained (${message(error)}).`,
      );
    }
    throw error;
  }
}

/**
 * Prepares one shared source for every panel that uses it. Frame sizes are PDF
 * boxes; framing transforms are resolved here so decoding and placement maths
 * happen once and the largest required rendition can be embedded once.
 */
export async function encodePdfImageForFrames(
  source: PdfImageSource,
  target: PdfImageFramesTarget,
  options: PdfImageEncodingOptions = {},
): Promise<EncodedPdfImage> {
  validateSourceBytes(source.bytes);
  if (target.uses.length === 0)
    throw new Error('PDF image frame uses must not be empty.');
  const mime = normalizeMime(source.mime);
  const dpi = target.dpi ?? DEFAULT_PDF_IMAGE_DPI;
  positive(dpi, 'PDF image target DPI');
  const quality = encodingQuality(options);
  for (const use of target.uses) {
    positive(use.widthPoints, 'PDF image frame width');
    positive(use.heightPoints, 'PDF image frame height');
  }

  const nativeMime = mime === 'image/png' || mime === 'image/jpeg';
  const headerDimensions = nativeMime
    ? readNativeDimensions(source.bytes, mime)
    : undefined;
  if (headerDimensions) {
    const drawn = largestDrawnPlacement(headerDimensions, target.uses);
    return encodePdfImageForPlacement(source, { ...drawn, dpi }, options);
  }
  if (!canRasterize()) {
    if (nativeMime) throw new Error(`Could not read ${mime} image dimensions.`);
    throw new Error(
      `${mime} PDF export requires browser image decoding and canvas support.`,
    );
  }

  const bitmap = await decodeBitmap(source.bytes, mime);
  try {
    const sourceDimensions = dimensions(bitmap.width, bitmap.height);
    const drawn = largestDrawnPlacement(sourceDimensions, target.uses);
    const required = requiredPixels(drawn.widthPoints, drawn.heightPoints, dpi);
    return encodeBitmap(
      source,
      mime,
      bitmap,
      sourceDimensions,
      required,
      quality,
      options,
    );
  } finally {
    bitmap.close();
  }
}

function normalizeMime(
  mime: PdfSourceImageMime,
): Exclude<PdfSourceImageMime, 'image/jpg'> {
  const normalized = mime.toLowerCase();
  if (normalized === 'image/jpg') return 'image/jpeg';
  if (
    normalized !== 'image/png' &&
    normalized !== 'image/jpeg' &&
    normalized !== 'image/webp' &&
    normalized !== 'image/gif' &&
    normalized !== 'image/avif'
  ) {
    throw new Error(`Unsupported PDF image type: ${mime}.`);
  }
  return normalized;
}

function positive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`${label} must be a positive finite number.`);
}

function validateSourceBytes(bytes: Uint8Array): void {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0)
    throw new Error('PDF image source bytes must not be empty.');
}

function encodingQuality(options: PdfImageEncodingOptions): number {
  const quality = options.jpegQuality ?? DEFAULT_PDF_JPEG_QUALITY;
  if (!Number.isFinite(quality) || quality <= 0 || quality > 1)
    throw new Error(
      'PDF JPEG quality must be greater than 0 and no more than 1.',
    );
  return quality;
}

function dimensions(width: number, height: number): Dimensions {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  )
    throw new Error('Decoded PDF artwork has invalid dimensions.');
  return { width, height };
}

function boundedRasterSize(width: number, height: number): Dimensions {
  const requested = dimensions(width, height);
  const edgeScale = Math.min(
    1,
    MAX_RASTER_EDGE / requested.width,
    MAX_RASTER_EDGE / requested.height,
  );
  const pixelScale = Math.min(
    1,
    Math.sqrt(MAX_RASTER_PIXELS / (requested.width * requested.height)),
  );
  const scale = Math.min(edgeScale, pixelScale);
  return {
    width: Math.max(1, Math.floor(requested.width * scale)),
    height: Math.max(1, Math.floor(requested.height * scale)),
  };
}

function requiredPixels(
  widthPoints: number,
  heightPoints: number,
  dpi: number,
): Dimensions {
  return boundedRasterSize(
    Math.ceil((widthPoints * dpi) / 72),
    Math.ceil((heightPoints * dpi) / 72),
  );
}

function largestDrawnPlacement(
  source: Dimensions,
  uses: readonly PdfImageFrameUse[],
): { widthPoints: number; heightPoints: number } {
  let largest = { widthPoints: 0, heightPoints: 0, scale: 0 };
  for (const use of uses) {
    const placement = getImagePlacement(
      source.width,
      source.height,
      use.widthPoints,
      use.heightPoints,
      use.transform,
    );
    const scale = placement.width / source.width;
    if (scale > largest.scale) {
      largest = {
        widthPoints: placement.width,
        heightPoints: placement.height,
        scale,
      };
    }
  }
  return {
    widthPoints: largest.widthPoints,
    heightPoints: largest.heightPoints,
  };
}

function downsampledSize(source: Dimensions, required: Dimensions): Dimensions {
  const scale = Math.min(
    1,
    required.width / source.width,
    required.height / source.height,
  );
  return {
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
  };
}

function fitsWithin(source: Dimensions, required: Dimensions): boolean {
  return source.width <= required.width && source.height <= required.height;
}

function shouldPreserveNative(
  bytes: Uint8Array,
  mime: 'image/png' | 'image/jpeg',
  source: Dimensions,
  required: Dimensions,
): boolean {
  const byteLimit =
    mime === 'image/jpeg'
      ? MAX_PASSTHROUGH_JPEG_BYTES
      : MAX_PASSTHROUGH_PNG_BYTES;
  return fitsWithin(source, required) && bytes.byteLength <= byteLimit;
}

function preserved(
  bytes: Uint8Array,
  mime: 'image/png' | 'image/jpeg',
  size: Dimensions,
  fallbackReason?: string,
): EncodedPdfImage {
  return {
    bytes: new Uint8Array(bytes),
    mime,
    width: size.width,
    height: size.height,
    sourceWidth: size.width,
    sourceHeight: size.height,
    reencoded: false,
    ...(fallbackReason ? { fallbackReason } : {}),
  };
}

function readNativeDimensions(
  bytes: Uint8Array,
  mime: 'image/png' | 'image/jpeg',
): Dimensions | undefined {
  return mime === 'image/png'
    ? readPngDimensions(bytes)
    : readJpegDimensions(bytes);
}

function readPngDimensions(bytes: Uint8Array): Dimensions | undefined {
  if (
    bytes.byteLength < 24 ||
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47 ||
    bytes[4] !== 0x0d ||
    bytes[5] !== 0x0a ||
    bytes[6] !== 0x1a ||
    bytes[7] !== 0x0a
  )
    return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  return width > 0 && height > 0 ? { width, height } : undefined;
}

function readJpegDimensions(bytes: Uint8Array): Dimensions | undefined {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8)
    return undefined;
  let offset = 2;
  while (offset + 3 < bytes.byteLength) {
    while (offset < bytes.byteLength && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 1 >= bytes.byteLength) break;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.byteLength) break;
    if (isStartOfFrame(marker) && length >= 7) {
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      return width > 0 && height > 0 ? { width, height } : undefined;
    }
    offset += length;
  }
  return undefined;
}

function isStartOfFrame(marker: number): boolean {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  );
}

function canRasterize(): boolean {
  return (
    typeof globalThis.createImageBitmap === 'function' &&
    (typeof globalThis.OffscreenCanvas === 'function' ||
      typeof document !== 'undefined')
  );
}

async function decodeBitmap(
  bytes: Uint8Array,
  mime: Exclude<PdfSourceImageMime, 'image/jpg'>,
): Promise<ImageBitmap> {
  try {
    return await globalThis.createImageBitmap(
      new Blob([copiedBuffer(bytes)], { type: mime }),
    );
  } catch (error) {
    throw new Error(
      `Could not decode ${mime} artwork for PDF export (${message(error)}).`,
    );
  }
}

async function encodeBitmap(
  source: PdfImageSource,
  mime: Exclude<PdfSourceImageMime, 'image/jpg'>,
  bitmap: ImageBitmap,
  sourceDimensions: Dimensions,
  required: Dimensions,
  quality: number,
  options: PdfImageEncodingOptions,
): Promise<EncodedPdfImage> {
  if (
    (mime === 'image/png' || mime === 'image/jpeg') &&
    shouldPreserveNative(source.bytes, mime, sourceDimensions, required)
  ) {
    return preserved(source.bytes, mime, sourceDimensions);
  }
  const output = downsampledSize(sourceDimensions, required);
  const format = options.format ?? 'image/jpeg';
  const blob = await drawAndEncode(bitmap, output, format, quality, {
    background: options.background ?? DEFAULT_FRAME_BACKGROUND,
  });
  const outputMime = normalizedEncodedMime(blob.type, format);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.byteLength === 0)
    throw new Error('Browser image encoding returned an empty image.');
  return {
    bytes,
    mime: outputMime,
    width: output.width,
    height: output.height,
    sourceWidth: sourceDimensions.width,
    sourceHeight: sourceDimensions.height,
    reencoded: true,
  };
}

async function drawAndEncode(
  bitmap: ImageBitmap,
  size: Dimensions,
  format: 'image/jpeg' | 'image/png',
  quality: number,
  style: { background: string },
): Promise<Blob> {
  if (typeof globalThis.OffscreenCanvas === 'function') {
    const canvas = new OffscreenCanvas(size.width, size.height);
    const context = canvas.getContext('2d');
    if (!context)
      throw new Error('Browser could not create a PDF image canvas.');
    context.fillStyle = style.background;
    context.fillRect(0, 0, size.width, size.height);
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    return canvas.convertToBlob({
      type: format,
      ...(format === 'image/jpeg' ? { quality } : {}),
    });
  }

  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  try {
    const context = canvas.getContext('2d');
    if (!context)
      throw new Error('Browser could not create a PDF image canvas.');
    context.fillStyle = style.background;
    context.fillRect(0, 0, size.width, size.height);
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error('Browser PDF image encoding failed.')),
        format,
        format === 'image/jpeg' ? quality : undefined,
      );
    });
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

function normalizedEncodedMime(
  actual: string,
  requested: 'image/jpeg' | 'image/png',
): 'image/jpeg' | 'image/png' {
  const normalized = actual.toLowerCase().replace('image/jpg', 'image/jpeg');
  if (normalized === 'image/jpeg' || normalized === 'image/png')
    return normalized;
  if (!normalized) return requested;
  throw new Error(`Browser returned unsupported PDF image type: ${actual}.`);
}

function copiedBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes);
  return copy.buffer;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
