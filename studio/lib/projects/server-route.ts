import { assertLocalRequest, OpenAiProxyError } from '@/lib/generation/server';
import { FolderProjectError } from './server';

const MAX_REQUEST_BYTES = 11 * 1024 * 1024;

export function assertFolderRequest(request: Request, mutation: boolean): void {
  assertLocalRequest(request, mutation);
}

export async function readProjectJson(request: Request): Promise<unknown> {
  const contentType = request.headers
    .get('content-type')
    ?.split(';', 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== 'application/json')
    throw new FolderProjectError('Request must use application/json.');
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES)
    throw new FolderProjectError(
      'Request metadata is too large.',
      413,
      'request_too_large',
    );
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_REQUEST_BYTES)
    throw new FolderProjectError(
      'Request metadata is too large.',
      413,
      'request_too_large',
    );
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new FolderProjectError('Request must contain valid JSON.');
  }
}

export function projectErrorResponse(error: unknown): Response {
  const status =
    error instanceof FolderProjectError || error instanceof OpenAiProxyError
      ? error.status
      : 500;
  const code =
    error instanceof FolderProjectError ? error.code : 'internal_error';
  const detail = error instanceof Error ? error.message : 'Unknown error';
  return Response.json({ error: detail.slice(0, 500), code }, { status });
}
