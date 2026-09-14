import { beginFolderProject } from '@/lib/projects/server';
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
      await beginFolderProject({
        parentPath: body?.parentPath,
        name: body?.name,
        projectId: body?.projectId,
      }),
      { status: 201 },
    );
  } catch (error) {
    return projectErrorResponse(error);
  }
}
