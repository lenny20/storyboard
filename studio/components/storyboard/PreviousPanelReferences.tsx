'use client';

import { AlertTriangle, X } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import type { PreviousPanelReference } from '@/lib/storyboard/model';
import type { PreviousPanelCandidate } from '@/lib/storyboard/references';
import FrameArtwork from './FrameArtwork';

type Props = {
  candidates: PreviousPanelCandidate[];
  selected: PreviousPanelReference[];
  resolved: PreviousPanelCandidate[];
  missing: PreviousPanelReference[];
  onChange: (selected: PreviousPanelReference[]) => void;
  disabled?: boolean;
  aspectRatio?: number;
};

export default function PreviousPanelReferences({
  candidates,
  selected,
  resolved,
  missing,
  onChange,
  disabled,
  aspectRatio,
}: Props) {
  const selectedKeys = new Set(
    selected.map((item) => `${item.panelId}:${item.imageVersionId}`),
  );
  const currentKeys = new Set(
    candidates.map((item) => `${item.panelId}:${item.imageVersionId}`),
  );
  const pinnedOlder = resolved.filter(
    (item) => !currentKeys.has(`${item.panelId}:${item.imageVersionId}`),
  );

  const remove = (target: PreviousPanelReference) =>
    onChange(
      selected.filter(
        (item) =>
          item.panelId !== target.panelId ||
          item.imageVersionId !== target.imageVersionId,
      ),
    );

  return (
    <section className="sb-previous-references" aria-label="Previous panels">
      <div className="sb-previous-references-head">
        <div>
          <strong>Previous panels</strong>
          <p>
            Choose earlier frames in this scene. The exact image version stays
            pinned.
          </p>
        </div>
        <span>{selected.length} selected</span>
      </div>
      {!candidates.length && !selected.length && (
        <p className="sb-previous-reference-empty">
          Earlier panels with selected images will appear here.
        </p>
      )}
      {candidates.length > 0 && (
        <div className="sb-previous-reference-grid">
          {candidates.map((candidate) => {
            const key = `${candidate.panelId}:${candidate.imageVersionId}`;
            const checked = selectedKeys.has(key);
            const hasOlderSelection = selected.some(
              (item) =>
                item.panelId === candidate.panelId &&
                item.imageVersionId !== candidate.imageVersionId,
            );
            return (
              <label key={key} className={checked ? 'is-selected' : ''}>
                <span className="sb-previous-reference-artwork">
                  <FrameArtwork
                    aspectRatio={aspectRatio}
                    image={{
                      id: candidate.imageVersionId,
                      dataUrl: candidate.dataUrl,
                      createdAt: '',
                      label: candidate.label,
                      transform: candidate.transform,
                    }}
                    alt=""
                    loading="lazy"
                  />
                </span>
                <span>{candidate.label}</span>
                <Checkbox
                  checked={checked}
                  disabled={disabled}
                  aria-label={`Use ${candidate.label}`}
                  onCheckedChange={(value) => {
                    if (value) {
                      onChange([
                        ...selected.filter(
                          (item) => item.panelId !== candidate.panelId,
                        ),
                        {
                          panelId: candidate.panelId,
                          imageVersionId: candidate.imageVersionId,
                        },
                      ]);
                    } else remove(candidate);
                  }}
                />
                {hasOlderSelection && !checked && (
                  <small>New version available</small>
                )}
              </label>
            );
          })}
        </div>
      )}
      {pinnedOlder.map((item) => (
        <div
          className="sb-pinned-previous-reference"
          key={`${item.panelId}:${item.imageVersionId}`}
        >
          <span className="sb-previous-reference-artwork">
            <FrameArtwork
              aspectRatio={aspectRatio}
              image={{
                id: item.imageVersionId,
                dataUrl: item.dataUrl,
                createdAt: '',
                label: item.label,
                transform: item.transform,
              }}
              alt=""
              loading="lazy"
            />
          </span>
          <span>
            <strong>{item.label}</strong>
            <small>Pinned version</small>
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Remove ${item.label}`}
            onClick={() => remove(item)}
            disabled={disabled}
          >
            <X size={14} />
          </Button>
        </div>
      ))}
      {missing.map((item) => (
        <div
          className="sb-missing-previous-reference"
          role="alert"
          key={`${item.panelId}:${item.imageVersionId}`}
        >
          <AlertTriangle size={16} />
          <span>
            <strong>Previous panel image is missing</strong>
            <small>Remove it before generating.</small>
          </span>
          <Button
            variant="ghost"
            onClick={() => remove(item)}
            disabled={disabled}
          >
            Remove
          </Button>
        </div>
      ))}
    </section>
  );
}
