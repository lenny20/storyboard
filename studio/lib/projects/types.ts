import type { StoryProject } from '@/lib/storyboard/model';

export const FOLDER_PROJECT_FORMAT = 'storyboard-folder-project' as const;
export const FOLDER_PROJECT_VERSION = 1 as const;
export const FOLDER_ASSET_PREFIX = 'asset:sha256:';
export const MAX_FOLDER_IMAGE_BYTES = 20 * 1024 * 1024;

export type FolderAssetDescriptor = {
  hash: string;
  extension: 'png' | 'jpg' | 'webp' | 'gif' | 'avif';
  mimeType:
    | 'image/png'
    | 'image/jpeg'
    | 'image/webp'
    | 'image/gif'
    | 'image/avif';
  bytes: number;
};

/** On disk, image dataUrl fields contain asset:sha256:<hash>.<extension> tokens. */
export type FolderProjectManifest = {
  format: typeof FOLDER_PROJECT_FORMAT;
  formatVersion: typeof FOLDER_PROJECT_VERSION;
  revision: number;
  savedAt: string;
  project: StoryProject;
  assets: Record<string, Omit<FolderAssetDescriptor, 'hash'>>;
};

export type FolderProjectBinding = {
  projectId: string;
  path: string;
  revision: number;
  manifestDigest: string;
  project: StoryProject;
};

export type FolderProjectDiagnostic = {
  projectId?: string;
  path: string;
  message: string;
};

export type FolderProjectsResponse = {
  projects: FolderProjectBinding[];
  diagnostics: FolderProjectDiagnostic[];
  forgottenProjectIds: string[];
};

export type PendingFolderBinding = {
  projectId: string;
  path: string;
  token: string;
};
