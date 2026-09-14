import { assertLocalRequest, openAiGenerationService } from '@/lib/generation/server';
import { proxyErrorResponse, proxyJson } from '@/lib/generation/server-route';

export async function GET(request: Request): Promise<Response> {
  try {
    assertLocalRequest(request, false);
    return proxyJson({
      ...openAiGenerationService.connectionStatus(),
      usage: await openAiGenerationService.usage(),
      usageTotals: await openAiGenerationService.usageTotals(),
    });
  } catch (error) {
    return proxyErrorResponse(error);
  }
}
