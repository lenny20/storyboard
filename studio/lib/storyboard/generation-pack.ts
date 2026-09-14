import { strToU8, zipSync } from 'fflate';

import {
  getSelectedImage,
  type Panel,
  type Scene,
  type Shot,
  type StoryProject,
} from './model';
import { buildPanelPrompt, buildRevisionPrompt } from './prompts';
import { hasImageFraming, renderImageFrame } from './render-image-frame';
import {
  extensionForMimeType,
  referenceDisplayName,
  referencePackFilename,
  previousPanelPackFilename,
  resolvePreviousPanelReferences,
  resolvePanelReferences,
} from './references';

export type GenerationPackOptions = {
  revisionInstruction?: string;
  /** Include the selected panel image as a revision base when one exists. */
  includeSelectedImage?: boolean;
};

export type GenerationPackFile = {
  path: string;
  label: string;
  kind: 'reference' | 'previous-panel' | 'selected-image';
  referenceId?: string;
  panelId?: string;
  imageVersionId?: string;
};

export type GenerationPack = {
  blob: Blob;
  filename: string;
  prompt: string;
  files: GenerationPackFile[];
};

function safeName(value: string, fallback: string): string {
  const cleaned = value
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return cleaned.slice(0, 80) || fallback;
}

function dataUrlBytes(dataUrl: string, label: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  if (comma < 0 || !dataUrl.slice(0, comma).toLowerCase().endsWith(';base64')) {
    throw new Error(
      `Could not add '${label}' to the generation pack: it is not base64 image data.`,
    );
  }
  try {
    const binary = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1)
      bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not add '${label}' to the generation pack: ${detail}`,
    );
  }
}

/**
 * Builds a portable ZIP for manual image generation. It contains the exact
 * prompt copied by the editor plus only the resolved reference images (and an
 * optional selected base image for revisions). No image is transmitted.
 */
export async function createGenerationPack(
  project: StoryProject,
  scene: Scene,
  shot: Shot,
  panel: Panel,
  options: GenerationPackOptions = {},
): Promise<GenerationPack> {
  const revisionInstruction = options.revisionInstruction?.trim();
  const prompt = revisionInstruction
    ? buildRevisionPrompt(project, scene, shot, panel, revisionInstruction)
    : buildPanelPrompt(project, scene, shot, panel);
  const archive: Record<string, Uint8Array> = { 'prompt.txt': strToU8(prompt) };
  const files: GenerationPackFile[] = [];
  const manifest = [
    'Generation pack attachment map',
    'Attach the files named below with prompt.txt. No files were transmitted automatically.',
    '',
  ];

  const previousPanels = resolvePreviousPanelReferences(scene, panel);
  if (previousPanels.missing.length > 0) {
    const detail = previousPanels.missing
      .map((reference) => `${reference.panelId}/${reference.imageVersionId}`)
      .join(', ');
    throw new Error(
      `Cannot create generation pack because earlier panel references are missing or no longer earlier than this panel: ${detail}.`,
    );
  }

  resolvePanelReferences(project, shot, panel).forEach((reference, index) => {
    const path = referencePackFilename(project, reference, index);
    archive[path] = dataUrlBytes(
      reference.dataUrl,
      referenceDisplayName(project, reference),
    );
    files.push({
      path,
      label: referenceDisplayName(project, reference),
      kind: 'reference',
      referenceId: reference.id,
    });
    manifest.push(
      `${path} — ${reference.kind} — ${referenceDisplayName(project, reference)} (asset ${reference.id})`,
    );
  });

  for (const [index, reference] of previousPanels.references.entries()) {
    const path = previousPanelPackFilename(reference, index);
    archive[path] = dataUrlBytes(
      await renderImageFrame(
        reference.dataUrl,
        project.aspectRatio,
        reference.transform,
      ),
      reference.label,
    );
    files.push({
      path,
      label: reference.label,
      kind: 'previous-panel',
      panelId: reference.panelId,
      imageVersionId: reference.imageVersionId,
    });
    manifest.push(
      `${path} — earlier panel continuity — ${reference.label} (panel ${reference.panelId}, image version ${reference.imageVersionId})`,
    );
  }

  const includeSelectedImage =
    options.includeSelectedImage ?? Boolean(revisionInstruction);
  if (includeSelectedImage) {
    const selected = getSelectedImage(panel);
    if (!selected)
      throw new Error(
        'Select a panel image before including it in a revision generation pack.',
      );
    const path = `current-${safeName(selected.label, 'panel-image')}-${safeName(selected.id, 'image').slice(0, 12)}.${hasImageFraming(selected.transform) ? 'png' : extensionForMimeType(selected.dataUrl.slice(5, selected.dataUrl.indexOf(';')))}`;
    archive[path] = dataUrlBytes(
      await renderImageFrame(
        selected.dataUrl,
        project.aspectRatio,
        selected.transform,
      ),
      selected.label || 'selected panel image',
    );
    files.push({
      path,
      label: selected.label || 'Selected panel image',
      kind: 'selected-image',
    });
    manifest.push(
      `${path} — selected current panel image — ${selected.label || 'Untitled image'}`,
    );
  }

  if (files.length === 0) manifest.push('No images selected for this pack.');
  archive['reference-map.txt'] = strToU8(manifest.join('\n'));
  const bytes = zipSync(archive, { level: 0 });
  const blobBytes = new Uint8Array(bytes.byteLength);
  blobBytes.set(bytes);
  const panelIndex = shot.panels.findIndex(
    (candidate) => candidate.id === panel.id,
  );
  const panelName = `panel-${String(panelIndex >= 0 ? panelIndex + 1 : 0).padStart(2, '0')}-${panel.title}`;
  return {
    blob: new Blob([blobBytes.buffer], { type: 'application/zip' }),
    filename: `${safeName(`${project.name}-${scene.title}-${shot.title}-${panelName}`, 'storyboard')}-generation-pack.zip`,
    prompt,
    files,
  };
}
