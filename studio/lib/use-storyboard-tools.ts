'use client';

import { useEffect, useRef } from 'react';
import type { Panel, Scene, Shot, StoryProject } from './storyboard/model';
import {
  getPanelDetails,
  getPanelConnection,
  getShotConnection,
} from './storyboard/model';
import { buildPanelPrompt } from './storyboard/prompts';
import {
  referenceDisplayName,
  resolvePanelReferences,
  resolvePreviousPanelReferences,
} from './storyboard/references';

type RegisteredTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute(input: unknown): unknown;
};
type ModelContext = {
  registerTool(
    tool: RegisteredTool,
    options?: { signal?: AbortSignal },
  ): void | Promise<void>;
};

/** Optional agent access to the same selected shot and prompt shown in the editor. */
export function useStoryboardTools(
  project: StoryProject | null,
  scene?: Scene,
  shot?: Shot,
  panel?: Panel,
) {
  const current = useRef({ project, scene, shot, panel });
  useEffect(() => {
    current.current = { project, scene, shot, panel };
  }, [project, scene, shot, panel]);

  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContext })
      .modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const validateEmptyInput = (input: unknown) => {
      if (
        input !== undefined &&
        (input === null ||
          typeof input !== 'object' ||
          Array.isArray(input) ||
          Object.keys(input).length)
      ) {
        throw new Error('This tool accepts an empty object.');
      }
    };
    const tools: RegisteredTool[] = [
      {
        name: 'get_storyboard_selection',
        title: 'Read selected storyboard shot',
        description:
          'Read the current project, scene, shot and panel identifiers and direction. Does not change the storyboard.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute(input) {
          validateEmptyInput(input);
          const { project, scene, shot, panel } = current.current;
          if (!project) throw new Error('Open a storyboard project first.');
          const shotIndex =
            scene && shot
              ? scene.shots.findIndex((item) => item.id === shot.id)
              : -1;
          const panelIndex =
            shot && panel
              ? shot.panels.findIndex((item) => item.id === panel.id)
              : -1;
          return {
            project: {
              id: project.id,
              name: project.name,
              aspectRatio: project.aspectRatio,
              style: project.style,
            },
            scene: scene ? { id: scene.id, title: scene.title } : null,
            shot: shot
              ? {
                  id: shot.id,
                  title: shot.title,
                  incomingConnection:
                    scene && shotIndex > 0
                      ? getShotConnection(
                          scene,
                          scene.shots[shotIndex - 1].id,
                          shot.id,
                        )
                      : null,
                  outgoingConnection:
                    scene &&
                    shotIndex >= 0 &&
                    shotIndex < scene.shots.length - 1
                      ? getShotConnection(
                          scene,
                          shot.id,
                          scene.shots[shotIndex + 1].id,
                        )
                      : null,
                }
              : null,
            panel: panel
              ? {
                  id: panel.id,
                  title: panel.title,
                  framing: panel.framing,
                  angle: panel.angle,
                  description: panel.description,
                  ...(shot ? getPanelDetails(shot, panel) : {}),
                  incomingConnection:
                    shot && panelIndex > 0
                      ? getPanelConnection(
                          shot,
                          shot.panels[panelIndex - 1].id,
                          panel.id,
                        )
                      : null,
                  outgoingConnection:
                    shot &&
                    panelIndex >= 0 &&
                    panelIndex < shot.panels.length - 1
                      ? getPanelConnection(
                          shot,
                          panel.id,
                          shot.panels[panelIndex + 1].id,
                        )
                      : null,
                }
              : null,
          };
        },
      },
      {
        name: 'get_storyboard_panel_prompt',
        title: 'Read selected panel generation prompt',
        description:
          'Prepare the same generation prompt as the editor for the selected panel, with selected reference names. Does not generate an image, spend money, upload files or change the storyboard. Reference images still require attachment.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute(input) {
          validateEmptyInput(input);
          const { project, scene, shot, panel } = current.current;
          if (!project || !scene || !shot || !panel)
            throw new Error('Select a storyboard panel first.');
          const previous = resolvePreviousPanelReferences(scene, panel);
          return {
            panelId: panel.id,
            prompt: buildPanelPrompt(project, scene, shot, panel),
            references: [
              ...resolvePanelReferences(project, shot, panel).map((ref) => ({
                id: ref.id,
                name: referenceDisplayName(project, ref),
                kind: ref.kind,
              })),
              ...previous.references.map((ref) => ({
                id: ref.imageVersionId,
                panelId: ref.panelId,
                name: ref.label,
                kind: 'previous-panel',
              })),
            ],
            missingPreviousPanelReferences: previous.missing,
            attachmentRequired: true,
          };
        },
      },
    ];
    for (const tool of tools) {
      try {
        void Promise.resolve(
          context.registerTool(tool, { signal: lifecycle.signal }),
        ).catch(() => undefined);
      } catch {
        /* The editor remains usable when the optional host integration is unavailable. */
      }
    }
    return () => lifecycle.abort();
  }, []);
}
