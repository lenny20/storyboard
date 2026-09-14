import { listFolderProjects } from '@/lib/projects/server';
import {
  assertFolderRequest,
  projectErrorResponse,
} from '@/lib/projects/server-route';

export async function GET(request: Request): Promise<Response> {
  try {
    assertFolderRequest(request, false);
    return Response.json(await listFolderProjects());
  } catch (error) {
    return projectErrorResponse(error);
  }
}
