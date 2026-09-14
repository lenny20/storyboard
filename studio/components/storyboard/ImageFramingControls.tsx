'use client';

import {
  ChevronDown,
  FlipHorizontal2,
  FlipVertical2,
  RotateCcw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ImageTransform } from '@/lib/storyboard/model';
import { resolveImageTransform } from '@/lib/storyboard/image-transform';
import './image-framing.css';

export default function ImageFramingControls({
  transform,
  onChange,
}: {
  transform?: ImageTransform;
  onChange: (transform: ImageTransform, historyKey: string) => void;
}) {
  const value = resolveImageTransform(transform);
  const update = (patch: Partial<ImageTransform>, historyKey: string) =>
    onChange({ ...value, ...patch }, historyKey);
  const adjusted =
    value.offsetX !== 0 || value.offsetY !== 0 || value.flipX || value.flipY;

  return (
    <details className="sb-framing-controls">
      <summary>
        <span className="sb-framing-summary-label">
          <ChevronDown aria-hidden="true" />
          <strong>Image framing</strong>
        </span>
        <span className="sb-framing-summary-state">
          {value.fit === 'cover' ? 'Crop' : 'Fit'} ·{' '}
          {Math.round(value.scale * 100)}%{adjusted ? ' · Adjusted' : ''}
        </span>
      </summary>
      <div className="sb-framing-content">
        <p className="sb-framing-hint">
          Drag artwork in the frame to position it
        </p>
        <div className="sb-framing-toolbar">
          <fieldset className="sb-fit-options" aria-label="Image fit">
            <button
              type="button"
              className={value.fit === 'contain' ? 'is-active' : ''}
              aria-pressed={value.fit === 'contain'}
              onClick={() => update({ fit: 'contain' }, 'fit')}
            >
              Fit
            </button>
            <button
              type="button"
              className={value.fit === 'cover' ? 'is-active' : ''}
              aria-pressed={value.fit === 'cover'}
              onClick={() => update({ fit: 'cover' }, 'fit')}
            >
              Crop to fill
            </button>
          </fieldset>
          <label className="sb-framing-slider sb-framing-scale">
            <span>Scale</span>
            <input
              type="range"
              min="10"
              max="400"
              step="1"
              value={Math.round(value.scale * 100)}
              onChange={(event) =>
                update({ scale: Number(event.target.value) / 100 }, 'scale')
              }
            />
            <output>{Math.round(value.scale * 100)}%</output>
          </label>
          <div className="sb-framing-position">
            <label className="sb-framing-slider">
              <span>X</span>
              <input
                aria-label="Horizontal image position"
                type="range"
                min="-100"
                max="100"
                step="1"
                value={Math.round(value.offsetX * 100)}
                onChange={(event) =>
                  update(
                    { offsetX: Number(event.target.value) / 100 },
                    'position-x',
                  )
                }
              />
              <output>{Math.round(value.offsetX * 100)}</output>
            </label>
            <label className="sb-framing-slider">
              <span>Y</span>
              <input
                aria-label="Vertical image position"
                type="range"
                min="-100"
                max="100"
                step="1"
                value={Math.round(value.offsetY * 100)}
                onChange={(event) =>
                  update(
                    { offsetY: Number(event.target.value) / 100 },
                    'position-y',
                  )
                }
              />
              <output>{Math.round(value.offsetY * 100)}</output>
            </label>
          </div>
          <div className="sb-framing-buttons">
            <Button
              type="button"
              variant="ghost"
              aria-pressed={value.flipX}
              title="Flip horizontally"
              onClick={() => update({ flipX: !value.flipX }, 'flip-x')}
            >
              <FlipHorizontal2 /> <span>Flip H</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              aria-pressed={value.flipY}
              title="Flip vertically"
              onClick={() => update({ flipY: !value.flipY }, 'flip-y')}
            >
              <FlipVertical2 /> <span>Flip V</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              title="Reset image framing"
              onClick={() => onChange(resolveImageTransform(), 'reset')}
            >
              <RotateCcw /> <span>Reset</span>
            </Button>
          </div>
        </div>
      </div>
    </details>
  );
}
