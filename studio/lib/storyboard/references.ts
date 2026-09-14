import type {
  ImageTransform,
  Panel,
  ReferenceAsset,
  ReferenceGroup,
  Scene,
  Shot,
  StoryProject,
} from './model';
import { hasImageFraming } from './render-image-frame';

export type PreviousPanelCandidate = {
  panelId: string;
  imageVersionId: string;
  dataUrl: string;
  mimeType: string;
  label: string;
  transform?: ImageTransform;
};

function imageMimeType(dataUrl: string): string {
  return /^data:([^;,]+)/i.exec(dataUrl)?.[1] ?? 'application/octet-stream';
}

function earlierPanels(
  scene: Scene,
  targetPanel: Panel,
): Array<{ panel: Panel; label: string }> {
  const result: Array<{ panel: Panel; label: string }> = [];
  for (const [shotIndex, shot] of scene.shots.entries()) {
    for (const [panelIndex, panel] of shot.panels.entries()) {
      if (panel.id === targetPanel.id) return result;
      result.push({
        panel,
        label: `Shot ${shotIndex + 1} · Panel ${panelIndex + 1} — ${panel.title || 'Untitled panel'}`,
      });
    }
  }
  return [];
}

/** Earlier panels in scene order that currently have a selected image. */
export function getPreviousPanelCandidates(
  scene: Scene,
  targetPanel: Panel,
): PreviousPanelCandidate[] {
  return earlierPanels(scene, targetPanel).flatMap(({ panel, label }) => {
    const version = panel.selectedVersionId
      ? panel.versions.find(
          (candidate) => candidate.id === panel.selectedVersionId,
        )
      : undefined;
    return version
      ? [
          {
            panelId: panel.id,
            imageVersionId: version.id,
            dataUrl: version.dataUrl,
            mimeType: imageMimeType(version.dataUrl),
            label,
            ...(version.transform ? { transform: version.transform } : {}),
          },
        ]
      : [];
  });
}

/** Resolves pinned versions without following a source panel's newer selection. */
export function resolvePreviousPanelReferences(
  scene: Scene,
  targetPanel: Panel,
): {
  references: PreviousPanelCandidate[];
  missing: Array<{ panelId: string; imageVersionId: string }>;
} {
  const earlier = new Map(
    earlierPanels(scene, targetPanel).map((item) => [item.panel.id, item]),
  );
  const references: PreviousPanelCandidate[] = [];
  const missing: Array<{ panelId: string; imageVersionId: string }> = [];
  const seen = new Set<string>();
  for (const pinned of targetPanel.previousPanelReferences ?? []) {
    const key = `${pinned.panelId}\0${pinned.imageVersionId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const source = earlier.get(pinned.panelId);
    const version = source?.panel.versions.find(
      (candidate) => candidate.id === pinned.imageVersionId,
    );
    if (!source || !version) missing.push({ ...pinned });
    else
      references.push({
        panelId: pinned.panelId,
        imageVersionId: version.id,
        dataUrl: version.dataUrl,
        mimeType: imageMimeType(version.dataUrl),
        label: source.label,
        ...(version.transform ? { transform: version.transform } : {}),
      });
  }
  return { references, missing };
}

/**
 * Resolves the actual image assets a shot needs. Explicit legacy selections stay
 * first in their written order; selected groups then add every current view in
 * library order. An asset selected both ways appears only once.
 */
export function resolveShotReferences(
  project: StoryProject,
  shot: Shot,
): ReferenceAsset[] {
  const byId = new Map(
    project.references.map((reference) => [reference.id, reference]),
  );
  const resolved: ReferenceAsset[] = [];
  const seen = new Set<string>();
  const add = (reference: ReferenceAsset | undefined) => {
    if (reference && !seen.has(reference.id)) {
      seen.add(reference.id);
      resolved.push(reference);
    }
  };
  shot.referenceIds.forEach((id) => add(byId.get(id)));
  const selectedGroups = new Set(shot.referenceGroupIds ?? []);
  project.references.forEach((reference) => {
    if (reference.groupId && selectedGroups.has(reference.groupId))
      add(reference);
  });
  return resolved;
}

/** Resolves this panel's assets, falling back to shot selections for legacy panels. */
export function resolvePanelReferences(
  project: StoryProject,
  shot: Shot,
  panel: Panel,
): ReferenceAsset[] {
  return resolveReferences(
    project,
    panel.referenceIds ?? shot.referenceIds,
    panel.referenceGroupIds ?? shot.referenceGroupIds ?? [],
  );
}

function resolveReferences(
  project: StoryProject,
  selectedReferenceIds: readonly string[],
  selectedReferenceGroupIds: readonly string[],
): ReferenceAsset[] {
  const byId = new Map(
    project.references.map((reference) => [reference.id, reference]),
  );
  const resolved: ReferenceAsset[] = [];
  const seen = new Set<string>();
  const add = (reference: ReferenceAsset | undefined) => {
    if (reference && !seen.has(reference.id)) {
      seen.add(reference.id);
      resolved.push(reference);
    }
  };
  selectedReferenceIds.forEach((id) => add(byId.get(id)));
  const selectedGroups = new Set(selectedReferenceGroupIds);
  project.references.forEach((reference) => {
    if (reference.groupId && selectedGroups.has(reference.groupId))
      add(reference);
  });
  return resolved;
}

export function resolveShotReferenceGroups(
  project: StoryProject,
  shot: Shot,
): ReferenceGroup[] {
  const byId = new Map(
    (project.referenceGroups ?? []).map((group) => [group.id, group]),
  );
  const assetById = new Map(
    project.references.map((reference) => [reference.id, reference]),
  );
  const orderedIds: string[] = [];
  const seen = new Set<string>();
  const add = (id: string | undefined) => {
    if (id && !seen.has(id)) {
      seen.add(id);
      orderedIds.push(id);
    }
  };
  // A manually selected grouped asset should still carry its entity notes, but
  // must not implicitly select the entity’s other views.
  shot.referenceIds.forEach((id) => add(assetById.get(id)?.groupId));
  (shot.referenceGroupIds ?? []).forEach(add);
  return orderedIds.flatMap((id) => {
    const group = byId.get(id);
    return group ? [group] : [];
  });
}

export function resolvePanelReferenceGroups(
  project: StoryProject,
  shot: Shot,
  panel: Panel,
): ReferenceGroup[] {
  const selectedReferenceIds = panel.referenceIds ?? shot.referenceIds;
  const selectedReferenceGroupIds =
    panel.referenceGroupIds ?? shot.referenceGroupIds ?? [];
  const byId = new Map(
    (project.referenceGroups ?? []).map((group) => [group.id, group]),
  );
  const assetById = new Map(
    project.references.map((reference) => [reference.id, reference]),
  );
  const orderedIds: string[] = [];
  const seen = new Set<string>();
  const add = (id: string | undefined) => {
    if (id && !seen.has(id)) {
      seen.add(id);
      orderedIds.push(id);
    }
  };
  selectedReferenceIds.forEach((id) => add(assetById.get(id)?.groupId));
  selectedReferenceGroupIds.forEach(add);
  return orderedIds.flatMap((id) => {
    const group = byId.get(id);
    return group ? [group] : [];
  });
}

/** Selected groups with no views let the UI warn without pretending art is attached. */
export function getEmptyReferenceGroupIds(
  project: StoryProject,
  shot: Shot,
): string[] {
  const selected = new Set(shot.referenceGroupIds ?? []);
  const populated = new Set(
    project.references.flatMap((reference) =>
      reference.groupId ? [reference.groupId] : [],
    ),
  );
  return [...selected].filter((id) => !populated.has(id));
}

export function referenceDisplayName(
  project: StoryProject,
  reference: ReferenceAsset,
): string {
  const group = reference.groupId
    ? (project.referenceGroups ?? []).find(
        (candidate) => candidate.id === reference.groupId,
      )
    : undefined;
  const view =
    reference.viewLabel?.trim() || reference.name.trim() || 'Untitled view';
  return group ? `${group.name.trim() || 'Untitled group'} — ${view}` : view;
}

function safeName(value: string, fallback: string): string {
  const cleaned = value
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return cleaned.slice(0, 72) || fallback;
}

export function extensionForMimeType(mimeType: string): string {
  switch (mimeType.toLowerCase()) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    case 'image/avif':
      return 'avif';
    default:
      return 'img';
  }
}

/** A path-safe, deterministic name unique within one resolved reference list. */
export function referencePackFilename(
  project: StoryProject,
  reference: ReferenceAsset,
  index: number,
): string {
  return `${String(index + 1).padStart(2, '0')}-${safeName(referenceDisplayName(project, reference), 'reference')}-${safeName(reference.id, 'asset').slice(0, 12)}.${extensionForMimeType(reference.mimeType)}`;
}

export function previousPanelPackFilename(
  reference: PreviousPanelCandidate,
  index: number,
): string {
  return `previous-${String(index + 1).padStart(2, '0')}-${safeName(reference.label, 'panel')}-${safeName(reference.panelId, 'panel').slice(0, 12)}-${safeName(reference.imageVersionId, 'image').slice(0, 12)}.${hasImageFraming(reference.transform) ? 'png' : extensionForMimeType(reference.mimeType)}`;
}
