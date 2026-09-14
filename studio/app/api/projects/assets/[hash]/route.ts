import {
  MAX_FOLDER_IMAGE_BYTES,
  type FolderAssetDescriptor,
} from '@/lib/projects/types';
import {
  FolderProjectError,
  readFolderAsset,
  writeFolderAsset,
} from '@/lib/projects/server';
import {
  assertFolderRequest,
  projectErrorResponse,
} from '@/lib/projects/server-route';

export async function PUT(
  request: Request,
  context: { params: Promise<{ hash: string }> | { hash: string } },
): Promise<Response> {
  try {
    assertFolderRequest(request, true);
    const { hash } = await context.params;
    const contentLength = Number(request.headers.get('content-length') ?? 0);
    if (
      !Number.isInteger(contentLength) ||
      contentLength <= 0 ||
      contentLength > MAX_FOLDER_IMAGE_BYTES
    )
      throw new FolderProjectError(
        'Image upload size is missing or invalid.',
        413,
        'asset_size',
      );
    const descriptor: FolderAssetDescriptor = {
      hash,
      extension: request.headers.get(
        'x-storyboard-extension',
      ) as FolderAssetDescriptor['extension'],
      mimeType: request.headers.get(
        'content-type',
      ) as FolderAssetDescriptor['mimeType'],
      bytes: contentLength,
    };
    const bytes = new Uint8Array(await request.arrayBuffer());
    return Response.json(
      await writeFolderAsset({
        projectId: request.headers.get('x-storyboard-project-id'),
        token: request.headers.get('x-storyboard-binding-token') || undefined,
        descriptor,
        bytes,
      }),
    );
  } catch (error) {
    return projectErrorResponse(error);
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ hash: string }> | { hash: string } },
): Promise<Response> {
  try {
    assertFolderRequest(request, false);
    const { hash } = await context.params;
    const url = new URL(request.url);
    const result = await readFolderAsset(
      url.searchParams.get('projectId'),
      hash,
      url.searchParams.get('extension'),
    );
    return new Response(new Uint8Array(result.bytes).buffer, {
      headers: {
        'content-type': result.mimeType,
        'cache-control': 'private, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    return projectErrorResponse(error);
  }
}
