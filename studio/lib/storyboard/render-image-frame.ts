import { getImagePlacement, resolveImageTransform } from './image-transform';
import type { ImageTransform } from './model';

export function hasImageFraming(transform?: ImageTransform): boolean {
  const value = resolveImageTransform(transform);
  return (
    value.fit !== 'contain' ||
    value.scale !== 1 ||
    value.offsetX !== 0 ||
    value.offsetY !== 0 ||
    value.flipX ||
    value.flipY
  );
}

/** A temporary framed copy for image-generator inputs. Original project bytes stay untouched. */
export async function renderImageFrame(
  dataUrl: string,
  aspectRatio: number,
  transform?: ImageTransform,
): Promise<string> {
  if (!hasImageFraming(transform)) return dataUrl;
  if (typeof document === 'undefined' || typeof Image === 'undefined')
    throw new Error(
      'Framed image copies need a browser canvas. Open the project in the editor to prepare this image.',
    );
  const image = new Image();
  const canvas = document.createElement('canvas');
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () =>
        reject(new Error('The selected artwork could not be decoded.'));
      image.src = dataUrl;
    });
    if (
      !image.naturalWidth ||
      !image.naturalHeight ||
      !Number.isFinite(aspectRatio) ||
      aspectRatio <= 0
    )
      throw new Error('Image framing dimensions are invalid.');
    const longEdge = Math.min(
      4096,
      Math.max(1024, image.naturalWidth, image.naturalHeight),
    );
    canvas.width = Math.max(
      1,
      Math.round(aspectRatio >= 1 ? longEdge : longEdge * aspectRatio),
    );
    canvas.height = Math.max(
      1,
      Math.round(aspectRatio >= 1 ? longEdge / aspectRatio : longEdge),
    );
    const context = canvas.getContext('2d');
    if (!context)
      throw new Error('This browser could not prepare a framed image copy.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    const placement = getImagePlacement(
      image.naturalWidth,
      image.naturalHeight,
      canvas.width,
      canvas.height,
      transform,
    );
    context.translate(
      placement.x + (placement.flipX ? placement.width : 0),
      placement.y + (placement.flipY ? placement.height : 0),
    );
    context.scale(placement.flipX ? -1 : 1, placement.flipY ? -1 : 1);
    context.drawImage(image, 0, 0, placement.width, placement.height);
    const result = canvas.toDataURL('image/png');
    if (!result.startsWith('data:image/png;base64,'))
      throw new Error('Could not prepare the framed image.');
    return result;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    image.src = '';
  }
}
