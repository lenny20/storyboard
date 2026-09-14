import {
  getPanelDetails,
  getSelectedImage,
  type Panel,
  type Scene,
  type Shot,
  type StoryProject,
} from './model';
import {
  extensionForMimeType,
  referenceDisplayName,
  referencePackFilename,
  previousPanelPackFilename,
  resolvePreviousPanelReferences,
  resolvePanelReferenceGroups,
  resolvePanelReferences,
  resolveShotReferences,
} from './references';
import { isRoughBlockingStyle, ROUGH_BLOCKING_PROMPT_RULES } from './style';

function text(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed || undefined;
}

function quote(value: string): string {
  return `“${value}”`;
}

function sentence(value: string): string {
  const trimmed = value.trim();
  return /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function panelDirections(panel: Panel): string[] {
  const lines: string[] = [];
  if (text(panel.description))
    lines.push(`Primary frame direction: ${sentence(panel.description)}`);
  if (text(panel.framing)) lines.push(`Framing: ${sentence(panel.framing)}`);
  if (text(panel.angle)) lines.push(`Camera angle: ${sentence(panel.angle)}`);

  if (panel.markers.length > 0) {
    lines.push('Composition guides (approximate, not a guarantee):');
    panel.markers.forEach((marker) => {
      lines.push(
        `- ${marker.label}: centre at ${formatPercent(marker.x)} from left, ${formatPercent(marker.y)} from top; scale ${marker.scale}.`,
      );
    });
  }

  if (panel.arrows.length > 0) {
    lines.push('Annotated direction arrows:');
    panel.arrows.forEach((arrow) => {
      const type =
        arrow.kind === 'camera' ? 'Camera movement' : 'Action movement';
      lines.push(
        `- ${type}, ${formatPercent(arrow.x1)}, ${formatPercent(arrow.y1)} → ${formatPercent(arrow.x2)}, ${formatPercent(arrow.y2)}: ${arrow.label}.`,
      );
    });
  }
  return lines;
}

function continuityDirection(shot: Shot, panel: Panel): string | undefined {
  const index = shot.panels.findIndex((candidate) => candidate.id === panel.id);
  if (index < 0 || shot.panels.length < 2) return undefined;
  const nearby: Array<[string, Panel]> = [];
  if (index > 0) nearby.push(['Previous panel', shot.panels[index - 1]]);
  if (index < shot.panels.length - 1)
    nearby.push(['Next panel', shot.panels[index + 1]]);
  const descriptions = nearby.map(([position, nearbyPanel]) => {
    const detail = [text(nearbyPanel.framing), text(nearbyPanel.description)]
      .filter(Boolean)
      .join('; ');
    return detail
      ? `${position}: ${sentence(detail)}`
      : `${position}: ${sentence(nearbyPanel.title)}`;
  });
  return descriptions.length > 0
    ? `Continuous-shot context — ${descriptions.join(' ')}`
    : undefined;
}

/**
 * Builds a deterministic prompt from only this panel, its parent shot/scene,
 * project visual direction, and references selected for this panel. Reference
 * images are named for manual attachment by default, or mapped to ordered API inputs.
 */
export type PromptAttachmentOptions = { attachmentMode?: 'manual' | 'api' };

export function buildPanelPrompt(
  project: StoryProject,
  scene: Scene,
  shot: Shot,
  panel: Panel,
  options: PromptAttachmentOptions = {},
): string {
  return assemblePanelPrompt(project, scene, shot, panel, options, 1);
}

function assemblePanelPrompt(
  project: StoryProject,
  scene: Scene,
  shot: Shot,
  panel: Panel,
  options: PromptAttachmentOptions,
  firstReferenceInput: number,
): string {
  const panelIndex = shot.panels.findIndex(
    (candidate) => candidate.id === panel.id,
  );
  const lines = [
    'Create one storyboard image.',
    `Project: ${quote(project.name)}.`,
    `Scene: ${quote(scene.title)}.`,
    `Shot: ${quote(shot.title)}.`,
    `Panel: ${panelIndex >= 0 ? panelIndex + 1 : '?'} of ${shot.panels.length} — ${quote(panel.title)}.`,
    `Canvas aspect ratio: ${project.aspectRatio}:1. Preserve this frame shape.`,
  ];

  if (text(project.style))
    lines.push(`Visual style: ${sentence(project.style)}`);
  if (text(project.styleNotes))
    lines.push(`Style notes: ${sentence(project.styleNotes)}`);
  const roughBlocking = isRoughBlockingStyle(project.style);
  if (roughBlocking) lines.push(...ROUGH_BLOCKING_PROMPT_RULES);
  lines.push(...panelDirections(panel));
  const details = getPanelDetails(shot, panel);
  if (text(details.context))
    lines.push(`Context: ${sentence(details.context)}`);
  if (text(details.camera))
    lines.push(`Camera direction: ${sentence(details.camera)}`);
  const continuity = continuityDirection(shot, panel);
  if (continuity) lines.push(continuity);
  if (text(details.dialogue))
    lines.push(
      `Dialogue context only; do not render it as text: ${details.dialogue.trim()}`,
    );
  if (text(details.notes))
    lines.push(`Director notes: ${sentence(details.notes)}`);

  const referenceGroups = resolvePanelReferenceGroups(project, shot, panel);
  referenceGroups.forEach((group) => {
    if (text(group.notes))
      lines.push(
        `Reference group ${quote(group.name || 'Untitled group')} notes: ${sentence(group.notes)}`,
      );
  });
  const references = resolvePanelReferences(project, shot, panel);
  if (references.length > 0) {
    if (options.attachmentMode === 'api') {
      lines.push(
        'These input images are already attached, in this order. Use them as visual references:',
      );
      references.forEach((reference, index) =>
        lines.push(
          `- Input image ${firstReferenceInput + index}: ${reference.kind} — ${sentence(referenceDisplayName(project, reference))}`,
        ),
      );
    } else {
      lines.push(
        'Attach these selected reference images manually and use them only as visual reference:',
      );
      references.forEach((reference, index) =>
        lines.push(
          `- ${reference.kind}: ${sentence(referenceDisplayName(project, reference))} (file: ${referencePackFilename(project, reference, index)})`,
        ),
      );
    }
    if (referenceGroups.length > 0)
      lines.push(
        'Views in the same named reference group depict the same entity from different angles; do not treat them as separate people or objects.',
      );
  }

  const previousPanelResolution = resolvePreviousPanelReferences(scene, panel);
  const previousPanels = previousPanelResolution.references;
  if (previousPanels.length > 0) {
    if (options.attachmentMode === 'api') {
      lines.push(
        'These earlier panel images are also attached, in this order. Use them to preserve visual continuity:',
      );
      previousPanels.forEach((reference, index) =>
        lines.push(
          `- Input image ${firstReferenceInput + references.length + index}: earlier panel — ${sentence(reference.label)}`,
        ),
      );
    } else {
      lines.push(
        'Attach these earlier panel images and use them to preserve visual continuity:',
      );
      previousPanels.forEach((reference, index) =>
        lines.push(
          `- Earlier panel: ${sentence(reference.label)} (file: ${previousPanelPackFilename(reference, index)})`,
        ),
      );
    }
    lines.push(
      roughBlocking
        ? 'Preserve recurring characters through simple silhouettes and proportions, plus prop placement, major setting masses, and screen direction. The selected frame’s new composition, action, framing, and camera direction take precedence. Translate all continuity into the mandatory rough blocking style.'
        : 'Preserve recurring characters, wardrobe, props, setting details, lighting, and screen direction from the earlier panel images where they remain visible. The selected frame’s new composition, action, framing, and camera direction take precedence.',
    );
  }
  if (previousPanelResolution.missing.length > 0) {
    lines.push(
      `Warning: ${previousPanelResolution.missing.length} pinned earlier-panel image reference${previousPanelResolution.missing.length === 1 ? ' is' : 's are'} unavailable. Resolve the missing reference before generation.`,
    );
  }

  lines.push(
    'Depict only the selected frame. Its primary frame direction takes precedence over panel context or descriptions of nearby panels.',
    'Use the stated direction exactly. Do not invent additional coverage, dialogue, setting, action, or character details.',
    roughBlocking
      ? 'When character references are selected, preserve recognisable silhouette and proportions only; reduce clothing to the simplest identity cues.'
      : 'When character references are selected, preserve recognisable silhouette, proportions, and clothing where visible. Detailed faces and exact likeness are unnecessary.',
    'Keep a dolly as a camera-position move and a zoom as a focal-length move; do not substitute one for the other.',
    'Do not include labels, panels, UI, or written annotations in the artwork.',
  );
  if (roughBlocking)
    lines.push(
      'Final style check: the result must remain a loose, minimal rough blocking sketch regardless of the finish or detail in any input image.',
    );
  return lines.join('\n');
}

/** Adds a precise revision request while retaining the original panel direction. */
export function buildRevisionPrompt(
  project: StoryProject,
  scene: Scene,
  shot: Shot,
  panel: Panel,
  instruction: string,
  options: PromptAttachmentOptions = {},
): string {
  const revision = instruction.trim();
  if (!revision)
    throw new Error(
      'Add a revision instruction before building a revision prompt.',
    );
  const selected = getSelectedImage(panel);
  if (options.attachmentMode === 'api') {
    if (!selected)
      throw new Error(
        'Select a current panel image before generating an API revision.',
      );
    const base = `Input image 1: current panel image (${quote(selected.label)}), already attached as the base for this revision.`;
    return `${base}\n\n${assemblePanelPrompt(project, scene, shot, panel, options, 2)}\n\nRevision instruction: ${revision}\nApply this change while preserving all other stated direction.${isRoughBlockingStyle(project.style) ? '\nThe revision must preserve the mandatory rough blocking style even if the instruction or base image requests or depicts a detailed, photorealistic, or 3D-rendered finish.' : ''}`;
  }
  const baseImageDirection = selected
    ? `Attach the selected current panel image (${quote(selected.label)}) as the base image for this revision.`
    : 'No current panel image is selected; attach the intended base image before generating this revision.';
  return `${buildPanelPrompt(project, scene, shot, panel)}\n\n${baseImageDirection}\nRevision instruction: ${revision}\nApply this change while preserving all other stated direction.${isRoughBlockingStyle(project.style) ? '\nThe revision must preserve the mandatory rough blocking style even if the instruction or base image requests or depicts a detailed, photorealistic, or 3D-rendered finish.' : ''}`;
}

function fileName(value: string, fallback: string): string {
  const cleaned = value
    .trim()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned.slice(0, 80) || fallback;
}

/**
 * Downloads one selected reference at a time. This is the portable fallback
 * when no ZIP library is bundled; browsers may ask permission for multiple
 * downloads.
 */
export async function downloadReferencePack(
  project: StoryProject,
  shot: Shot,
): Promise<void> {
  if (typeof document === 'undefined')
    throw new Error('Reference downloads are only available in a browser.');
  const references = resolveShotReferences(project, shot);
  if (references.length === 0)
    throw new Error('This shot has no selected reference images to download.');

  references.forEach((reference, index) => {
    const anchor = document.createElement('a');
    anchor.href = reference.dataUrl;
    anchor.download = `${String(index + 1).padStart(2, '0')}-${fileName(reference.name, 'reference')}.${extensionForMimeType(reference.mimeType)}`;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  });
}
