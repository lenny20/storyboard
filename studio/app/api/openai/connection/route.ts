import { assertLocalRequest, openAiGenerationService, OpenAiProxyError, readBoundedJson } from '@/lib/generation/server';
import { proxyErrorResponse, proxyJson } from '@/lib/generation/server-route';

export async function POST(request: Request): Promise<Response> {
  try {
    assertLocalRequest(request, true);
    const body = await readBoundedJson(request);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new OpenAiProxyError('The connection request must be an object.');
    const action = (body as { action?: unknown }).action;
    if (action === 'set') {
      const status = openAiGenerationService.setSessionKey((body as { apiKey?: unknown }).apiKey);
      return proxyJson({ ...status, usage: await openAiGenerationService.usage(), usageTotals: await openAiGenerationService.usageTotals() });
    }
    if (action === 'clear') {
      const status = openAiGenerationService.clearSessionKey();
      return proxyJson({ ...status, usage: await openAiGenerationService.usage(), usageTotals: await openAiGenerationService.usageTotals() });
    }
    throw new OpenAiProxyError('The connection action must be set or clear.');
  } catch (error) {
    return proxyErrorResponse(error);
  }
}
