import { checkFolderAssets } from '@/lib/projects/server';
import {
  assertFolderRequest,
  projectErrorResponse,
  readProjectJson,
} from '@/lib/projects/server-route';

export async function POST(request: Request): Promise<Response> {
  try {
    assertFolderRequest(request, true);
    const body = (await readProjectJson(request)) as Record<string, unknown>;
    return Response.json(
      await checkFolderAssets({
        projectId: body?.projectId,
        token: body?.token,
        assets: body?.assets,
      }),
    );
  } catch (error) {
    return projectErrorResponse(error);
  }
}
