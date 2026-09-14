import { assertLocalRequest, openAiGenerationService, readBoundedJson } from '@/lib/generation/server';
import { proxyErrorResponse, proxyJson } from '@/lib/generation/server-route';

export async function POST(request: Request): Promise<Response> {
  try {
    assertLocalRequest(request, true);
    return proxyJson(await openAiGenerationService.generate(await readBoundedJson(request)));
  } catch (error) {
    return proxyErrorResponse(error);
  }
}
