import { getSelectedImage, type Panel, type ReferenceAsset, type Scene, type Shot, type StoryProject } from './model';

function text(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed || undefined;
}

function quote(value: string): string {
  return `“${value}”`;
}

function selectedReferences(project: StoryProject, shot: Shot): ReferenceAsset[] {
  const byId = new Map(project.references.map((reference) => [reference.id, reference]));
  return shot.referenceIds.flatMap((id) => {
    const reference = byId.get(id);
    return reference ? [reference] : [];
  });
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function panelDirections(panel: Panel): string[] {
  const lines: string[] = [];
  if (text(panel.framing)) lines.push(`Framing: ${panel.framing.trim()}.`);
  if (text(panel.angle)) lines.push(`Camera angle: ${panel.angle.trim()}.`);
  if (text(panel.description)) lines.push(`Panel moment: ${panel.description.trim()}.`);

  if (panel.markers.length > 0) {
    lines.push('Composition guides (approximate, not a guarantee):');
    panel.markers.forEach((marker) => {
      lines.push(`- ${marker.label}: centre at ${formatPercent(marker.x)} from left, ${formatPercent(marker.y)} from top; scale ${marker.scale}.`);
    });
  }

  if (panel.arrows.length > 0) {
    lines.push('Annotated direction arrows:');
    panel.arrows.forEach((arrow) => {
      const type = arrow.kind === 'camera' ? 'Camera movement' : 'Action movement';
      lines.push(`- ${type}, ${formatPercent(arrow.x1)}, ${formatPercent(arrow.y1)} → ${formatPercent(arrow.x2)}, ${formatPercent(arrow.y2)}: ${arrow.label}.`);
    });
  }
  return lines;
}

function continuityDirection(shot: Shot, panel: Panel): string | undefined {
  const index = shot.panels.findIndex((candidate) => candidate.id === panel.id);
  if (index < 0 || shot.panels.length < 2) return undefined;
  const nearby: Array<[string, Panel]> = [];
  if (index > 0) nearby.push(['Previous panel', shot.panels[index - 1]]);
  if (index < shot.panels.length - 1) nearby.push(['Next panel', shot.panels[index + 1]]);
  const descriptions = nearby.map(([position, nearbyPanel]) => {
    const detail = [text(nearbyPanel.framing), text(nearbyPanel.description)].filter(Boolean).join('; ');
    return detail ? `${position}: ${detail}.` : `${position}: ${nearbyPanel.title}.`;
  });
  return descriptions.length > 0 ? `Continuous-shot context — ${descriptions.join(' ')}` : undefined;
}

/**
 * Builds a deterministic prompt from only this panel, its parent shot/scene,
 * project visual direction, and references selected for this shot. Reference
 * images are intentionally named for manual attachment, never transmitted.
 */
export function buildPanelPrompt(project: StoryProject, scene: Scene, shot: Shot, panel: Panel): string {
  const panelIndex = shot.panels.findIndex((candidate) => candidate.id === panel.id);
  const lines = [
    'Create one storyboard image.',
    `Project: ${quote(project.name)}.`,
    `Scene: ${quote(scene.title)}.`,
    `Shot: ${quote(shot.title)}.`,
    `Panel: ${panelIndex >= 0 ? panelIndex + 1 : '?'} of ${shot.panels.length} — ${quote(panel.title)}.`,
    `Canvas aspect ratio: ${project.aspectRatio}:1. Preserve this frame shape.`,
  ];

  if (text(project.style)) lines.push(`Visual style: ${project.style.trim()}.`);
  if (text(project.styleNotes)) lines.push(`Style notes: ${project.styleNotes.trim()}.`);
  if (text(shot.description)) lines.push(`Shot direction: ${shot.description.trim()}.`);
  if (text(shot.action)) lines.push(`Action: ${shot.action.trim()}.`);
  if (text(shot.camera)) lines.push(`Camera direction: ${shot.camera.trim()}.`);
  const continuity = continuityDirection(shot, panel);
  if (continuity) lines.push(continuity);
  lines.push(...panelDirections(panel));
  if (text(shot.dialogue)) lines.push(`Dialogue context only; do not render it as text: ${shot.dialogue.trim()}`);
  if (text(shot.notes)) lines.push(`Director notes: ${shot.notes.trim()}.`);

  const references = selectedReferences(project, shot);
  if (references.length > 0) {
    lines.push('Attach these selected reference images manually and use them only as visual reference:');
    references.forEach((reference) => lines.push(`- ${reference.kind}: ${reference.name}.`));
  }

  lines.push(
    'Use the stated direction exactly. Do not invent additional coverage, dialogue, setting, action, or character details.',
    'When character references are selected, preserve recognisable silhouette, proportions, and clothing where visible. Detailed faces and exact likeness are unnecessary.',
    'Keep a dolly as a camera-position move and a zoom as a focal-length move; do not substitute one for the other.',
    'Do not include labels, panels, UI, or written annotations in the artwork.',
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
): string {
  const revision = instruction.trim();
  if (!revision) throw new Error('Add a revision instruction before building a revision prompt.');
  const selected = getSelectedImage(panel);
  const baseImageDirection = selected
    ? `Attach the selected current panel image (${quote(selected.label)}) as the base image for this revision.`
    : 'No current panel image is selected; attach the intended base image before generating this revision.';
  return `${buildPanelPrompt(project, scene, shot, panel)}\n\n${baseImageDirection}\nRevision instruction: ${revision}\nApply this change while preserving all other stated direction.`;
}

function fileName(value: string, fallback: string): string {
  const cleaned = value.trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '');
  return cleaned.slice(0, 80) || fallback;
}

function extension(mimeType: string): string {
  switch (mimeType.toLowerCase()) {
    case 'image/jpeg': return 'jpg';
    case 'image/png': return 'png';
    case 'image/webp': return 'webp';
    case 'image/gif': return 'gif';
    case 'image/avif': return 'avif';
    default: return 'img';
  }
}

/**
 * Downloads one selected reference at a time. This is the portable fallback
 * when no ZIP library is bundled; browsers may ask permission for multiple
 * downloads.
 */
export async function downloadReferencePack(project: StoryProject, shot: Shot): Promise<void> {
  if (typeof document === 'undefined') throw new Error('Reference downloads are only available in a browser.');
  const references = selectedReferences(project, shot);
  if (references.length === 0) throw new Error('This shot has no selected reference images to download.');

  references.forEach((reference, index) => {
    const anchor = document.createElement('a');
    anchor.href = reference.dataUrl;
    anchor.download = `${String(index + 1).padStart(2, '0')}-${fileName(reference.name, 'reference')}.${extension(reference.mimeType)}`;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  });
}
