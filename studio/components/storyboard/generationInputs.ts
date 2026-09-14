import type { GenerationInputImage } from '@/lib/generation/types';

/** Preserve originals; only adapt GIF/AVIF copies for the provider's upload formats. */
export async function prepareGenerationImages(
  images: GenerationInputImage[],
): Promise<GenerationInputImage[]> {
  const prepared: GenerationInputImage[] = [];
  for (const image of images) {
    if (
      ['image/png', 'image/jpeg', 'image/webp'].includes(
        image.mimeType.toLowerCase(),
      )
    ) {
      prepared.push(image);
      continue;
    }
    if (!['image/gif', 'image/avif'].includes(image.mimeType.toLowerCase()))
      throw new Error(
        `Convert ${image.name} to PNG, JPEG, or WebP before generating.`,
      );
    try {
      const decoded = await new Promise<HTMLImageElement>((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error('Image could not be decoded'));
        element.src = image.dataUrl;
      });
      const canvas = document.createElement('canvas');
      canvas.width = decoded.naturalWidth;
      canvas.height = decoded.naturalHeight;
      const context = canvas.getContext('2d');
      if (!context || !canvas.width || !canvas.height)
        throw new Error('Image conversion is unavailable');
      context.drawImage(decoded, 0, 0);
      const dataUrl = canvas.toDataURL('image/png');
      if (!dataUrl.startsWith('data:image/png;'))
        throw new Error('Image conversion failed');
      prepared.push({
        ...image,
        mimeType: 'image/png',
        dataUrl,
        name: `${image.name.replace(/\.[^.]+$/, '')}.png`,
      });
      canvas.width = 0;
      canvas.height = 0;
      decoded.src = '';
    } catch {
      throw new Error(
        `Could not convert ${image.name} for the API. Upload a PNG, JPEG, or WebP copy to the library, then try again. No paid request was sent.`,
      );
    }
  }
  return prepared;
}
