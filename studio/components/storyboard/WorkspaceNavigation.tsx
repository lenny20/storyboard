'use client';

import {
  Download,
  FolderOpen,
  Menu,
  Library,
  Plus,
  Settings2,
  Save,
  Undo2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import type { Scene, StoryProject } from '@/lib/storyboard/model';

type Props = {
  projects: StoryProject[];
  project?: StoryProject;
  scene?: Scene;
  canUndo: boolean;
  onProject: (project: StoryProject) => void;
  onScene: (scene: Scene) => void;
  onNewProject: () => void;
  onImport: () => void;
  onOpenFolder: () => void;
  onSave: () => void;
  canSave: boolean;
  onAddScene: () => void;
  onSettings: () => void;
  onLibrary: () => void;
  onBackup: () => void;
  onUndo: () => void;
};

/** Compact navigation exposes the same actions as the spacious desktop sidebar. */
export default function WorkspaceNavigation({
  projects,
  project,
  scene,
  canUndo,
  onProject,
  onScene,
  onNewProject,
  onImport,
  onOpenFolder,
  onSave,
  canSave,
  onAddScene,
  onSettings,
  onLibrary,
  onBackup,
  onUndo,
}: Props) {
  return (
    <nav className="sb-compact-nav" aria-label="Compact workspace navigation">
      <label className="sb-compact-selector">
        <span>Project</span>
        <NativeSelect
          aria-label="Current project"
          value={project?.id ?? ''}
          onChange={(event) => {
            const next = projects.find(
              (item) => item.id === event.target.value,
            );
            if (next) onProject(next);
          }}
          disabled={!projects.length}
        >
          {!projects.length && <option value="">No projects</option>}
          {projects.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name || 'Untitled project'}
            </option>
          ))}
        </NativeSelect>
      </label>
      <label className="sb-compact-selector">
        <span>Scene</span>
        <NativeSelect
          aria-label="Current scene"
          value={scene?.id ?? ''}
          onChange={(event) => {
            const next = project?.scenes.find(
              (item) => item.id === event.target.value,
            );
            if (next) onScene(next);
          }}
          disabled={!project?.scenes.length}
        >
          {!project?.scenes.length && <option value="">No scenes yet</option>}
          {project?.scenes.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title || 'Untitled scene'}
            </option>
          ))}
        </NativeSelect>
      </label>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              className="sb-workspace-menu-trigger"
              variant="outline"
              size="icon"
              aria-label="Workspace actions"
            />
          }
        >
          <Menu />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="sb-workspace-menu" align="end">
          <DropdownMenuItem onClick={onNewProject}>
            <Plus /> New project
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onImport}>
            <FolderOpen /> Import backup
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onOpenFolder}>
            <FolderOpen /> Open project folder
          </DropdownMenuItem>
          {canSave && (
            <DropdownMenuItem onClick={onSave}>
              <Save /> Save project
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!project} onClick={onAddScene}>
            <Plus /> Add scene
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!project} onClick={onLibrary}>
            <Library /> Reference library
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!project} onClick={onSettings}>
            <Settings2 /> Project settings
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!project} onClick={onBackup}>
            <Download /> Download backup
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!canUndo} onClick={onUndo}>
            <Undo2 /> Undo last edit
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  );
}
