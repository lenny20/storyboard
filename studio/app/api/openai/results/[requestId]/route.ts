import { assertLocalRequest, openAiGenerationService } from '@/lib/generation/server';
import { proxyErrorResponse, proxyJson } from '@/lib/generation/server-route';

export async function GET(request: Request, context: { params: Promise<{ requestId: string }> }): Promise<Response> {
  try {
    assertLocalRequest(request, false);
    const recovered = await openAiGenerationService.recoverResult((await context.params).requestId);
    if (!recovered) return proxyJson({ error: 'That retained generation result is unavailable.' }, 404);
    return proxyJson(recovered);
  } catch (error) {
    return proxyErrorResponse(error);
  }
}
