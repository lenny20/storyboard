import { DEFAULT_IMAGE_TRANSFORM, type ImageTransform } from './model';

export interface ImagePlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  flipX: boolean;
  flipY: boolean;
}

/** Fits the cinematic frame inside a differently shaped thumbnail without changing its crop. */
export function getFrameViewport(
  width: number,
  height: number,
  aspectRatio?: number,
) {
  if (!aspectRatio || !Number.isFinite(aspectRatio) || aspectRatio <= 0)
    return { x: 0, y: 0, width, height };
  const frameWidth = Math.min(width, height * aspectRatio);
  const frameHeight = frameWidth / aspectRatio;
  return {
    x: (width - frameWidth) / 2,
    y: (height - frameHeight) / 2,
    width: frameWidth,
    height: frameHeight,
  };
}

export function resolveImageTransform(
  transform?: ImageTransform,
): ImageTransform {
  return transform ? { ...transform } : { ...DEFAULT_IMAGE_TRANSFORM };
}

/** Computes image bounds in frame pixels without modifying the source artwork. */
export function getImagePlacement(
  imageW: number,
  imageH: number,
  frameW: number,
  frameH: number,
  transform?: ImageTransform,
): ImagePlacement {
  const safeImageW = imageW > 0 && Number.isFinite(imageW) ? imageW : 1;
  const safeImageH = imageH > 0 && Number.isFinite(imageH) ? imageH : 1;
  const safeFrameW = frameW > 0 && Number.isFinite(frameW) ? frameW : 0;
  const safeFrameH = frameH > 0 && Number.isFinite(frameH) ? frameH : 0;
  const value = resolveImageTransform(transform);
  const fitScale =
    value.fit === 'cover'
      ? Math.max(safeFrameW / safeImageW, safeFrameH / safeImageH)
      : Math.min(safeFrameW / safeImageW, safeFrameH / safeImageH);
  const width = safeImageW * fitScale * value.scale;
  const height = safeImageH * fitScale * value.scale;

  return {
    x: (safeFrameW - width) / 2 + value.offsetX * safeFrameW,
    y: (safeFrameH - height) / 2 + value.offsetY * safeFrameH,
    width,
    height,
    flipX: value.flipX,
    flipY: value.flipY,
  };
}
