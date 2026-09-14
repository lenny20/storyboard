import { OpenAiProxyError } from './server';

/** Safe JSON errors for local routes. Provider response bodies and credentials never leave the server. */
export function proxyErrorResponse(error: unknown): Response {
  if (error instanceof OpenAiProxyError) {
    return Response.json({ error: error.message }, { status: error.status, headers: { 'Cache-Control': 'no-store' } });
  }
  return Response.json(
    { error: 'The local image service could not complete that request.' },
    { status: 500, headers: { 'Cache-Control': 'no-store' } },
  );
}

export function proxyJson(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}
