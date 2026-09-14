'use client';
/* oxlint-disable next/no-img-element -- Embedded artwork remains local and portable. */
import { useRef, useState } from 'react';
import {
  ArrowLeft,
  Download,
  ImagePlus,
  Plus,
  Trash2,
  Upload,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  newId,
  type ReferenceKind,
  type StoryProject,
} from '@/lib/storyboard/model';
import { Field, IconButton } from './EditorControls';

export type ProjectEdit = (
  id: string,
  change: (project: StoryProject) => StoryProject,
  key?: string,
) => boolean;
const labels: Record<ReferenceKind, string> = {
  character: 'Character',
  location: 'Location',
  prop: 'Prop',
  style: 'Style',
};
const extension = (mime: string) =>
  ({
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/avif': 'avif',
  })[mime] ?? 'png';
type Props = {
  project: StoryProject;
  onEdit: ProjectEdit;
  onBack: () => void;
  onUpload: (
    files: File[],
    groupId: string | undefined,
    kind: ReferenceKind,
  ) => void;
  onDownload: (url: string, name: string) => void;
};

export default function ReferenceLibrary({
  project,
  onEdit,
  onBack,
  onUpload,
  onDownload,
}: Props) {
  const [kind, setKind] = useState<ReferenceKind>('character');
  const [selectedId, setSelectedId] = useState('');
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [removal, setRemoval] = useState<{
    title: string;
    description: string;
    run: () => void;
  } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const groups = project.referenceGroups ?? [];
  const visibleGroups = groups.filter((group) => group.kind === kind);
  const selected = groups.find((group) => group.id === selectedId);
  const artwork = project.references.filter((ref) =>
    selected ? ref.groupId === selected.id : !ref.groupId && ref.kind === kind,
  );
  const shots = project.scenes.flatMap((scene) => scene.shots);
  const usage = selected
    ? shots.flatMap((shot) => shot.panels).filter(
        (panel) =>
          panel.referenceGroupIds?.includes(selected.id) ||
          artwork.some((ref) => panel.referenceIds?.includes(ref.id)),
      ).length
    : 0;

  function createGroup() {
    if (!newName.trim()) return;
    const group = { id: newId(), name: newName.trim(), kind, notes: '' };
    if (
      onEdit(project.id, (current) => ({
        ...current,
        referenceGroups: [...(current.referenceGroups ?? []), group],
      }))
    ) {
      setSelectedId(group.id);
      setAdding(false);
      setNewName('');
    }
  }
  function removeArtwork(ids: string[], groupId?: string) {
    onEdit(project.id, (current) => {
      const removed = new Set(
        groupId
          ? current.references
              .filter((ref) => ref.groupId === groupId)
              .map((ref) => ref.id)
          : ids,
      );
      return {
        ...current,
        referenceGroups: (current.referenceGroups ?? []).filter(
          (group) => group.id !== groupId,
        ),
        references: current.references.filter((ref) => !removed.has(ref.id)),
        scenes: current.scenes.map((scene) => ({
          ...scene,
          shots: scene.shots.map((shot) => ({
            ...shot,
            referenceIds: shot.referenceIds.filter((id) => !removed.has(id)),
            referenceGroupIds: (shot.referenceGroupIds ?? []).filter(
              (id) => id !== groupId,
            ),
            panels: shot.panels.map((panel) => ({
              ...panel,
              referenceIds: panel.referenceIds?.filter(
                (id) => !removed.has(id),
              ),
              referenceGroupIds: panel.referenceGroupIds?.filter(
                (id) => id !== groupId,
              ),
            })),
          })),
        })),
      };
    });
  }

  return (
    <section className="sb-library" aria-label="Project reference library">
      <input
        ref={input}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
        className="sb-hidden"
        aria-label="Upload library artwork"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length) onUpload(files, selected?.id, kind);
          event.target.value = '';
        }}
      />
      <header className="sb-library-header">
        <div>
          <span className="sb-eyebrow">
            {project.name || 'UNTITLED PROJECT'}
          </span>
          <h1>Reference library</h1>
          <p>
            Keep character views and visual references together. Use them across
            this project’s scenes and panels.
          </p>
        </div>
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft /> Back to boards
        </Button>
      </header>
      <div className="sb-library-layout">
        <aside className="sb-library-index" aria-label="Reference entries">
          <Field label="Reference category">
            <NativeSelect
              value={kind}
              onChange={(event) => {
                setKind(event.target.value as ReferenceKind);
                setSelectedId('');
                setAdding(false);
                setNewName('');
              }}
            >
              <option value="character">Characters</option>
              <option value="location">Locations</option>
              <option value="prop">Props</option>
              <option value="style">Style</option>
            </NativeSelect>
          </Field>
          <Button
            className="sb-primary sb-full-width"
            onClick={() => setAdding(true)}
          >
            <Plus /> Add {labels[kind].toLowerCase()}
          </Button>
          {adding && (
            <form
              className="sb-library-create"
              onSubmit={(event) => {
                event.preventDefault();
                createGroup();
              }}
            >
              <Field label={`New ${labels[kind].toLowerCase()} name`}>
                <Input
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  placeholder={kind === 'character' ? 'e.g. Matilda' : 'Name'}
                />
              </Field>
              <div>
                <Button type="submit" disabled={!newName.trim()}>
                  Create
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setAdding(false);
                    setNewName('');
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          )}
          <div className="sb-library-entry-list">
            {visibleGroups.map((group) => {
              const images = project.references.filter(
                (ref) => ref.groupId === group.id,
              );
              return (
                <button
                  key={group.id}
                  className={`sb-library-entry ${selected?.id === group.id ? 'is-active' : ''}`}
                  onClick={() => setSelectedId(group.id)}
                >
                  {images[0] ? (
                    <img
                      loading="lazy"
                      decoding="async"
                      src={images[0].dataUrl}
                      alt=""
                    />
                  ) : (
                    <Users size={25} />
                  )}
                  <span>
                    <strong>{group.name || 'Untitled'}</strong>
                    <small>
                      {images.length} view{images.length === 1 ? '' : 's'}
                    </small>
                  </span>
                </button>
              );
            })}
            <button
              className={`sb-library-entry ${!selected ? 'is-active' : ''}`}
              onClick={() => setSelectedId('')}
            >
              <ImagePlus size={25} />
              <span>
                <strong>Ungrouped artwork</strong>
                <small>
                  {
                    project.references.filter(
                      (ref) => !ref.groupId && ref.kind === kind,
                    ).length
                  }{' '}
                  images
                </small>
              </span>
            </button>
          </div>
        </aside>
        <div className="sb-library-detail">
          {selected ? (
            <div className="sb-library-profile">
              <div className="sb-library-profile-heading">
                <Field label={`${labels[selected.kind]} name`}>
                  <Input
                    value={selected.name}
                    onChange={(event) =>
                      onEdit(
                        project.id,
                        (current) => ({
                          ...current,
                          referenceGroups: (current.referenceGroups ?? []).map(
                            (group) =>
                              group.id === selected.id
                                ? { ...group, name: event.target.value }
                                : group,
                          ),
                        }),
                        `group:${selected.id}:name`,
                      )
                    }
                  />
                </Field>
                <IconButton
                  label={`Delete ${selected.name || 'reference entry'}`}
                  danger
                  onClick={() =>
                    setRemoval({
                      title: `Remove ${selected.name || 'this entry'}?`,
                      description: `Its ${artwork.length} views will be removed from the library and ${usage} panel${usage === 1 ? '' : 's'}. Existing storyboard images stay in place. Undo can restore the entry and its associations.`,
                      run: () =>
                        removeArtwork(
                          artwork.map((ref) => ref.id),
                          selected.id,
                        ),
                    })
                  }
                >
                  <Trash2 />
                </IconButton>
              </div>
              <Field
                label="Identity & continuity notes"
                hint="Details to preserve whenever this entry is selected for a panel."
              >
                <Textarea
                  rows={2}
                  value={selected.notes}
                  placeholder="e.g. Short red coat, triangular silhouette, hair swept to the left…"
                  onChange={(event) =>
                    onEdit(
                      project.id,
                      (current) => ({
                        ...current,
                        referenceGroups: (current.referenceGroups ?? []).map(
                          (group) =>
                            group.id === selected.id
                              ? { ...group, notes: event.target.value }
                              : group,
                        ),
                      }),
                      `group:${selected.id}:notes`,
                    )
                  }
                />
              </Field>
              <p className="sb-library-usage">
                Used in {usage} panel{usage === 1 ? '' : 's'}. Select this entry
                in a panel to include all its views.
              </p>
            </div>
          ) : (
            <div className="sb-library-profile">
              <h2>Ungrouped artwork</h2>
              <p>
                Existing references stay available. Move a character’s images
                into one named entry to keep its views together.
              </p>
            </div>
          )}
          <div className="sb-library-art-heading">
            <h2>{selected ? 'Reference views' : `${labels[kind]} artwork`}</h2>
            <Button variant="outline" onClick={() => input.current?.click()}>
              <Upload /> {selected ? 'Add views' : 'Upload artwork'}
            </Button>
          </div>
          {!artwork.length ? (
            <div className="sb-library-empty">
              <ImagePlus size={36} strokeWidth={1.3} />
              <h3>
                {selected
                  ? `Add ${selected.name || 'this entry'}’s reference art`
                  : visibleGroups.length
                    ? 'No ungrouped artwork'
                    : `Start with a named ${labels[kind].toLowerCase()}`}
              </h3>
              <p>
                {selected
                  ? 'Upload front, side, three-quarter views, or a model sheet. Give each image a clear view label.'
                  : `Add a ${labels[kind].toLowerCase()} on the left, then bring in its artwork. Your references will remain available throughout the project.`}
              </p>
              {selected && (
                <Button
                  className="sb-primary"
                  onClick={() => input.current?.click()}
                >
                  <Plus /> Add views
                </Button>
              )}
            </div>
          ) : (
            <div className="sb-library-art-grid">
              {artwork.map((ref) => (
                <article className="sb-library-art-card" key={ref.id}>
                  <img
                    loading="lazy"
                    decoding="async"
                    src={ref.dataUrl}
                    alt={ref.viewLabel || ref.name}
                  />
                  <div className="sb-library-art-fields">
                    <Field label={selected ? 'View label' : 'Image name'}>
                      <Input
                        value={
                          selected ? (ref.viewLabel ?? ref.name) : ref.name
                        }
                        placeholder="e.g. Front view"
                        onChange={(event) =>
                          onEdit(
                            project.id,
                            (current) => ({
                              ...current,
                              references: current.references.map((item) =>
                                item.id === ref.id
                                  ? {
                                      ...item,
                                      ...(selected
                                        ? { viewLabel: event.target.value }
                                        : { name: event.target.value }),
                                    }
                                  : item,
                              ),
                            }),
                            `ref:${ref.id}:label`,
                          )
                        }
                      />
                    </Field>
                    {!ref.groupId && (
                      <Field label="Image category">
                        <NativeSelect
                          value={ref.kind}
                          onChange={(event) =>
                            onEdit(project.id, (current) => ({
                              ...current,
                              references: current.references.map((item) =>
                                item.id === ref.id
                                  ? {
                                      ...item,
                                      kind: event.target.value as ReferenceKind,
                                    }
                                  : item,
                              ),
                            }))
                          }
                        >
                          <option value="character">Character</option>
                          <option value="location">Location</option>
                          <option value="prop">Prop</option>
                          <option value="style">Style</option>
                        </NativeSelect>
                      </Field>
                    )}
                    <Field label="Library entry">
                      <NativeSelect
                        value={ref.groupId ?? ''}
                        onChange={(event) => {
                          const group = groups.find(
                            (item) => item.id === event.target.value,
                          );
                          onEdit(project.id, (current) => ({
                            ...current,
                            references: current.references.map((item) =>
                              item.id === ref.id
                                ? {
                                    ...item,
                                    groupId: group?.id,
                                    kind: group?.kind ?? item.kind,
                                  }
                                : item,
                            ),
                          }));
                        }}
                      >
                        <option value="">Ungrouped</option>
                        {groups
                          .filter((group) => group.kind === ref.kind)
                          .map((group) => (
                            <option key={group.id} value={group.id}>
                              {group.name || 'Untitled'}
                            </option>
                          ))}
                      </NativeSelect>
                    </Field>
                    <div className="sb-library-art-actions">
                      <Button
                        variant="ghost"
                        onClick={() =>
                          onDownload(
                            ref.dataUrl,
                            `${(selected?.name ? `${selected.name}-` : '') + (ref.viewLabel || ref.name || 'reference')}.${extension(ref.mimeType)}`,
                          )
                        }
                      >
                        <Download /> Download
                      </Button>
                      <IconButton
                        label={`Delete view ${ref.viewLabel || ref.name}`}
                        danger
                        onClick={() =>
                          setRemoval({
                            title: 'Remove this reference image?',
                            description:
                              'This image will be removed from the library and all panels that use it. Existing storyboard images stay in place. You can undo this change.',
                            run: () => removeArtwork([ref.id]),
                          })
                        }
                      >
                        <Trash2 />
                      </IconButton>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
      <AlertDialog
        open={Boolean(removal)}
        onOpenChange={(open) => {
          if (!open) setRemoval(null);
        }}
      >
        <AlertDialogContent className="sb-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{removal?.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {removal?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="sb-dialog-actions">
            <Button variant="outline" onClick={() => setRemoval(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                removal?.run();
                setRemoval(null);
              }}
            >
              Remove
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
