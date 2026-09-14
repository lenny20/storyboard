'use client';
/* oxlint-disable next/no-img-element -- Embedded artwork remains local and portable. */
import { useId } from 'react';
import { Library, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import type { Panel, StoryProject } from '@/lib/storyboard/model';

type Props = {
  project: StoryProject;
  referenceIds: string[];
  referenceGroupIds: string[];
  onChange: (patch: Partial<Panel>) => void;
  onLibrary: () => void;
};
export default function ShotReferences({
  project,
  referenceIds,
  referenceGroupIds,
  onChange,
  onLibrary,
}: Props) {
  const prefix = useId();
  const groups = project.referenceGroups ?? [];
  const ungrouped = project.references.filter(
    (ref) => !ref.groupId || referenceIds.includes(ref.id),
  );
  const selectedGroups = referenceGroupIds;
  return (
    <div className="sb-shot-references">
      <div className="sb-inspector-intro">
        <span className="sb-eyebrow">THIS PANEL’S REFERENCES</span>
        <p>Choose the characters and artwork for this panel.</p>
      </div>
      <Button variant="outline" className="sb-full-width" onClick={onLibrary}>
        <Library /> Open reference library
      </Button>
      {!groups.length && !ungrouped.length ? (
        <div className="sb-empty-references">
          <Users size={30} strokeWidth={1.25} />
          <strong>Add your cast to the library.</strong>
          <p>
            Each character can have several views. Select a character once here
            to use its artwork in this panel.
          </p>
        </div>
      ) : (
        <div className="sb-shot-reference-list">
          {groups.map((group) => {
            const art = project.references.filter(
              (ref) => ref.groupId === group.id,
            );
            return (
              <label
                className="sb-shot-reference-row"
                key={group.id}
                htmlFor={`${prefix}-group-${group.id}`}
              >
                <Checkbox
                  id={`${prefix}-group-${group.id}`}
                  aria-label={`Use ${group.name || 'Untitled'} in this panel`}
                  checked={selectedGroups.includes(group.id)}
                  onCheckedChange={(checked) =>
                    onChange({
                      referenceGroupIds: checked
                        ? [...selectedGroups, group.id]
                        : selectedGroups.filter((id) => id !== group.id),
                      referenceIds: referenceIds.filter(
                        (id) => !art.some((ref) => ref.id === id),
                      ),
                    })
                  }
                />
                {art[0] ? (
                  <img
                    loading="lazy"
                    decoding="async"
                    src={art[0].dataUrl}
                    alt=""
                  />
                ) : (
                  <Users size={26} />
                )}
                <span>
                  <strong>{group.name || 'Untitled'}</strong>
                  <small>
                    {group.kind} ·{' '}
                    {art.length
                      ? `${art.length} view${art.length === 1 ? '' : 's'}`
                      : 'No artwork yet — add views in Library'}
                  </small>
                </span>
              </label>
            );
          })}
          {ungrouped.length > 0 && (
            <>
              <h3>Individual artwork</h3>
              <p className="sb-hint">
                Previously selected images remain selected.
              </p>
              {ungrouped.map((ref) => (
                <label
                  className="sb-shot-reference-row"
                  key={ref.id}
                  htmlFor={`${prefix}-ref-${ref.id}`}
                >
                  <Checkbox
                    id={`${prefix}-ref-${ref.id}`}
                    aria-label={`Use ${ref.viewLabel || ref.name} in this panel`}
                    checked={referenceIds.includes(ref.id)}
                    onCheckedChange={(checked) =>
                      onChange({
                        referenceIds: checked
                          ? [...referenceIds, ref.id]
                          : referenceIds.filter((id) => id !== ref.id),
                      })
                    }
                  />
                  <img
                    loading="lazy"
                    decoding="async"
                    src={ref.dataUrl}
                    alt=""
                  />
                  <span>
                    <strong>{ref.viewLabel || ref.name || 'Untitled'}</strong>
                    <small>{ref.kind}</small>
                  </span>
                </label>
              ))}
            </>
          )}
        </div>
      )}
      <p className="sb-hint">
        New views added to a selected entry are included automatically. Download
        a generation pack from Prompt to take the actual files to your image
        tool.
      </p>
    </div>
  );
}
