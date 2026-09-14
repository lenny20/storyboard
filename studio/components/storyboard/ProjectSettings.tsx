'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { Scene, StoryProject } from '@/lib/storyboard/model';
import {
  getBrowserStorageEstimate,
  type BrowserStorageEstimate,
  type getProjectBudget,
} from '@/lib/storyboard/storage';
import {
  ROUGH_BLOCKING_STYLE,
  ROUGH_BLOCKING_STYLE_NOTES,
} from '@/lib/storyboard/style';
import { Field, IconButton } from './EditorControls';

const presets = [2.39, 16 / 9, 4 / 3, 1];
const formatRatio = (ratio: number) => String(Number(ratio.toFixed(4)));
type Props = {
  project: StoryProject;
  scene?: Scene;
  budget?: ReturnType<typeof getProjectBudget>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: (
    id: string,
    transform: (project: StoryProject) => StoryProject,
    key?: string,
  ) => boolean;
  onMoveScene: (delta: number) => void;
  onDeleteScene: () => void;
  onDeleteProject: () => void;
  onBackup: () => void;
  backupBusy?: boolean;
  folderPath?: string;
  onSaveToFolder?: () => void;
  onSaveNow?: () => void;
  folderBusy?: boolean;
};

export default function ProjectSettings({
  project,
  scene,
  budget,
  open,
  onOpenChange,
  onEdit,
  onMoveScene,
  onDeleteScene,
  onDeleteProject,
  onBackup,
  backupBusy = false,
  folderPath,
  onSaveToFolder,
  onSaveNow,
  folderBusy = false,
}: Props) {
  const [storageEstimate, setStorageEstimate] =
    useState<BrowserStorageEstimate | null>(null);
  useEffect(() => {
    if (!open) return;
    let active = true;
    void getBrowserStorageEstimate()
      .then((estimate) => {
        if (active) setStorageEstimate(estimate);
      })
      .catch(() => {
        if (active) setStorageEstimate(null);
      });
    return () => {
      active = false;
    };
  }, [open, budget?.bytes]);
  const [ratioDraft, setRatioDraft] = useState(
    formatRatio(project.aspectRatio),
  );
  const [customRatio, setCustomRatio] = useState(
    !presets.includes(project.aspectRatio),
  );
  const [ratioError, setRatioError] = useState('');
  const ratioInput = useRef<HTMLInputElement>(null);

  function commitRatio() {
    const ratio = Number(ratioDraft);
    if (
      !ratioDraft.trim() ||
      !Number.isFinite(ratio) ||
      ratio <= 0 ||
      ratio > 10
    ) {
      setRatioError(
        'Enter a width greater than 0 and no more than 10, such as 1.85.',
      );
      return false;
    }
    setRatioError('');
    if (ratio === project.aspectRatio) return true;
    return onEdit(
      project.id,
      (current) => ({ ...current, aspectRatio: ratio }),
      'ratio',
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sb-dialog sb-settings-dialog">
        <DialogHeader>
          <DialogTitle>Project settings</DialogTitle>
          <DialogDescription>
            Frame, style, and scene settings for this project.
          </DialogDescription>
        </DialogHeader>
        <div className="sb-settings-body">
          <Field label="Project name">
            <Input
              value={project.name}
              onChange={(event) =>
                onEdit(
                  project.id,
                  (current) => ({ ...current, name: event.target.value }),
                  'name',
                )
              }
            />
          </Field>
          <div className="sb-settings-row">
            <Field label="Frame ratio">
              <NativeSelect
                value={customRatio ? 'custom' : project.aspectRatio}
                onChange={(event) => {
                  if (event.target.value === 'custom') {
                    setCustomRatio(true);
                    ratioInput.current?.focus();
                    ratioInput.current?.select();
                    return;
                  }
                  const ratio = Number(event.target.value);
                  setCustomRatio(false);
                  setRatioDraft(formatRatio(ratio));
                  setRatioError('');
                  onEdit(project.id, (current) => ({
                    ...current,
                    aspectRatio: ratio,
                  }));
                }}
              >
                <option value={2.39}>2.39:1 · Cinema</option>
                <option value={16 / 9}>16:9 · Widescreen</option>
                <option value={4 / 3}>4:3 · Classic</option>
                <option value={1}>1:1 · Square</option>
                <option value="custom">Custom</option>
              </NativeSelect>
            </Field>
            <Field label="Width : 1 height">
              <Input
                ref={ratioInput}
                type="text"
                inputMode="decimal"
                value={ratioDraft}
                aria-invalid={Boolean(ratioError)}
                aria-describedby={ratioError ? 'sb-ratio-error' : undefined}
                onChange={(event) => {
                  setCustomRatio(true);
                  setRatioDraft(event.target.value);
                  setRatioError('');
                }}
                onBlur={commitRatio}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    commitRatio();
                  }
                }}
              />
            </Field>
          </div>
          {ratioError && (
            <p id="sb-ratio-error" className="sb-inline-error" role="alert">
              {ratioError}
            </p>
          )}
          <p className="sb-hint">
            Each image starts fitted to this ratio. Adjust its crop and scale in
            the editor.
          </p>
          <Field label="Art style">
            <Input
              value={project.style}
              placeholder="Rough pencil sketch"
              onChange={(event) =>
                onEdit(
                  project.id,
                  (current) => ({ ...current, style: event.target.value }),
                  'style',
                )
              }
            />
          </Field>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              onEdit(
                project.id,
                (current) => ({
                  ...current,
                  style: ROUGH_BLOCKING_STYLE,
                  styleNotes: ROUGH_BLOCKING_STYLE_NOTES,
                }),
                'style-preset:rough-blocking',
              )
            }
          >
            Rough blocking sketch
          </Button>
          <Field label="Style notes">
            <Textarea
              rows={3}
              value={project.styleNotes}
              placeholder="Primitive shapes, loose gesture lines, sparse backgrounds…"
              onChange={(event) =>
                onEdit(
                  project.id,
                  (current) => ({ ...current, styleNotes: event.target.value }),
                  'styleNotes',
                )
              }
            />
          </Field>
          <section className="sb-cover-settings" aria-label="Cover page fields">
            <span className="sb-eyebrow">COVER</span>
            <Field label="Subtitle">
              <Input
                value={project.subtitle ?? ''}
                placeholder="Teaser"
                onChange={(event) =>
                  onEdit(
                    project.id,
                    (current) => ({
                      ...current,
                      subtitle: event.target.value,
                    }),
                    'subtitle',
                  )
                }
              />
            </Field>
            <Field label="Draft label">
              <Input
                value={project.draftLabel ?? ''}
                placeholder="Draft 3"
                onChange={(event) =>
                  onEdit(
                    project.id,
                    (current) => ({
                      ...current,
                      draftLabel: event.target.value,
                    }),
                    'draftLabel',
                  )
                }
              />
            </Field>
            <Field label="Director">
              <Input
                value={project.director ?? ''}
                onChange={(event) =>
                  onEdit(
                    project.id,
                    (current) => ({
                      ...current,
                      director: event.target.value,
                    }),
                    'director',
                  )
                }
              />
            </Field>
            <Field label="Production">
              <Input
                value={project.production ?? ''}
                onChange={(event) =>
                  onEdit(
                    project.id,
                    (current) => ({
                      ...current,
                      production: event.target.value,
                    }),
                    'production',
                  )
                }
              />
            </Field>
            <Field label="Contact">
              <Input
                value={project.contact ?? ''}
                onChange={(event) =>
                  onEdit(
                    project.id,
                    (current) => ({
                      ...current,
                      contact: event.target.value,
                    }),
                    'contact',
                  )
                }
              />
            </Field>
            <p className="sb-hint">
              Printed on the PDF cover page. Empty fields are left off.
            </p>
          </section>
          <section className="sb-project-folder" aria-label="Project location">
            <strong>
              {folderPath ? 'Project folder' : 'Saved in this browser'}
            </strong>
            {folderPath ? (
              <>
                <span className="sb-folder-path">{folderPath}</span>
                <p>
                  The project file and all artwork save here automatically. Keep
                  this folder together when moving or backing up your project.
                </p>
                <Button
                  variant="outline"
                  onClick={onSaveNow}
                  disabled={folderBusy}
                >
                  {folderBusy ? 'Saving…' : 'Save now'}
                </Button>
              </>
            ) : (
              <>
                <p>
                  Choose a folder to keep the editable project and its images
                  together on disk.
                </p>
                <Button
                  variant="outline"
                  onClick={onSaveToFolder}
                  disabled={folderBusy}
                >
                  Save project to folder
                </Button>
              </>
            )}
          </section>
          {budget && !folderPath && (
            <section
              className={`sb-storage-budget ${budget.overBudget ? 'is-over' : ''}`}
              aria-label="Project storage usage"
            >
              <div>
                <strong>{(budget.bytes / 1048576).toFixed(1)} MB</strong>
                <span>
                  of {(budget.limitBytes / 1073741824).toFixed(0)} GB project
                  limit
                </span>
              </div>
              <meter
                min={0}
                max={100}
                value={Math.min(100, budget.percent)}
                aria-label="Working capacity used"
              />
              <p>
                {budget.overBudget
                  ? 'Recovery copy: download a backup before removing unused references or image versions. Editing resumes when this project fits the working capacity.'
                  : 'Includes artwork, references and image versions. This limit does not reserve disk space.'}
              </p>
              <p>
                {storageEstimate
                  ? `Browser storage: ${(storageEstimate.usageBytes / 1073741824).toFixed(2)} GB used of approximately ${(storageEstimate.quotaBytes / 1073741824).toFixed(1)} GB available quota across all projects.`
                  : 'Available storage depends on this browser and free disk space.'}
              </p>
              <Button
                variant="outline"
                onClick={onBackup}
                disabled={backupBusy}
              >
                {backupBusy
                  ? 'Preparing backup…'
                  : `Download ${budget.overBudget ? 'recovery ' : ''}backup`}
              </Button>
            </section>
          )}
          {scene && (
            <section className="sb-scene-settings">
              <span className="sb-eyebrow">CURRENT SCENE</span>
              <Field label="Scene name">
                <Input
                  value={scene.title}
                  onChange={(event) =>
                    onEdit(
                      project.id,
                      (current) => ({
                        ...current,
                        scenes: current.scenes.map((item) =>
                          item.id === scene.id
                            ? { ...item, title: event.target.value }
                            : item,
                        ),
                      }),
                      `scene:${scene.id}:title`,
                    )
                  }
                />
              </Field>
              <div className="sb-scene-settings-actions">
                <Button
                  variant="outline"
                  disabled={project.scenes.indexOf(scene) === 0}
                  onClick={() => onMoveScene(-1)}
                >
                  <ArrowUp /> Earlier
                </Button>
                <Button
                  variant="outline"
                  disabled={
                    project.scenes.indexOf(scene) === project.scenes.length - 1
                  }
                  onClick={() => onMoveScene(1)}
                >
                  <ArrowDown /> Later
                </Button>
                <IconButton label="Delete scene" danger onClick={onDeleteScene}>
                  <Trash2 />
                </IconButton>
              </div>
            </section>
          )}
          <div className="sb-settings-footer">
            <Button variant="destructive" onClick={onDeleteProject}>
              <Trash2 /> {folderPath ? 'Close project' : 'Delete project'}
            </Button>
            <Button
              className="sb-primary"
              onClick={() => {
                if (commitRatio()) onOpenChange(false);
              }}
            >
              Done
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
