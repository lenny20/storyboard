'use client';

/* oxlint-disable next/no-img-element -- Local data URLs are portable project artwork; routing them through a server image optimiser would break offline use. */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronDown,
  Copy,
  Download,
  Eye,
  FileDown,
  Film,
  FolderOpen,
  ImagePlus,
  Layers3,
  Loader2,
  Plus,
  Settings2,
  Trash2,
  Undo2,
  Upload,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  cloneShot,
  createPanel,
  createProject,
  createScene,
  createShot,
  getSelectedImage,
  newId,
  type Panel,
  type ReferenceAsset,
  type ReferenceKind,
  type Shot,
  type StoryProject,
} from '@/lib/storyboard/model';
import {
  deleteProject,
  exportProject,
  imageFileToDataUrl,
  importProject,
  listProjects,
  saveProject,
} from '@/lib/storyboard/storage';
import {
  buildPanelPrompt,
  buildRevisionPrompt,
} from '@/lib/storyboard/prompts';
import { useStoryboardTools } from '@/lib/use-storyboard-tools';
import './storyboard.css';

type Selection = {
  projectId: string;
  sceneId: string;
  shotId: string;
  panelId: string;
};
type SaveState = 'loading' | 'saved' | 'unsaved' | 'saving' | 'error';
type DeleteRequest = { title: string; description: string; run: () => void };
const imageAccept = 'image/png,image/jpeg,image/webp,image/gif,image/avif';
const nextTimestamp = (previous: string) =>
  new Date(Math.max(Date.now(), (Date.parse(previous) || 0) + 1)).toISOString();
const imageExtension = (mime: string) =>
  ({
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/avif': 'avif',
  })[mime.toLowerCase()] ?? 'png';
const number = (index: number) => String(index + 1).padStart(2, '0');
const messageOf = (error: unknown) =>
  error instanceof Error
    ? error.message
    : 'Something went wrong. Please try again.';

function starterProject() {
  const project = createProject('Teaser');
  project.aspectRatio = 2.39;
  project.style = 'Rough pencil sketch';
  const scene = createScene('Opening sequence');
  const island = createShot('The island');
  island.description =
    'Aerial of a small island in a vast ocean, flying through wispy clouds.';
  island.camera = 'Flying through wispy clouds.';
  const islandPanel = createPanel('The island');
  islandPanel.framing = 'Aerial';
  islandPanel.description =
    'A small island in a vast ocean, seen through wispy clouds.';
  island.panels = [islandPanel];
  const matilda = createShot('Matilda smiles');
  matilda.description =
    'Mid on Matilda, middle of frame, dollying into closeup as she smiles.';
  matilda.camera = 'Dolly forward from a medium shot to a close-up.';
  const start = createPanel('Start frame');
  start.framing = 'Medium';
  start.description = 'Matilda, centred in the frame.';
  const end = createPanel('End frame');
  end.framing = 'Close-up';
  end.description = 'Matilda, centred in the frame, smiling.';
  matilda.panels = [start, end];
  scene.shots = [island, matilda];
  project.scenes = [scene];
  return project;
}

function initialSelection(project: StoryProject, demo = false): Selection {
  const scene = project.scenes[0];
  const shot = scene?.shots[demo ? 1 : 0] ?? scene?.shots[0];
  return {
    projectId: project.id,
    sceneId: scene?.id ?? '',
    shotId: shot?.id ?? '',
    panelId: shot?.panels[0]?.id ?? '',
  };
}

function moveItem<T>(items: T[], index: number, delta: number) {
  const next = items.slice();
  const target = index + delta;
  if (index < 0 || target < 0 || target >= items.length) return items;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function Field({
  label,
  hint,
  children,
  className = '',
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`sb-field ${className}`}>
      <span className="sb-field-label">{label}</span>
      {children}
      {hint && <span className="sb-hint">{hint}</span>}
    </label>
  );
}

function IconButton({
  label,
  children,
  onClick,
  disabled,
  danger = false,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className={danger ? 'sb-icon sb-danger' : 'sb-icon'}
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </Button>
  );
}

function downloadUrl(url: string, name: string) {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function fileName(value: string) {
  return value.replace(/[^a-z0-9 _.-]/gi, '').trim() || 'storyboard';
}

export default function StoryboardApp() {
  const [projects, setProjects] = useState<StoryProject[]>([]);
  const projectStore = useRef<StoryProject[]>([]);
  const [selection, setSelection] = useState<Selection>({
    projectId: '',
    sceneId: '',
    shotId: '',
    panelId: '',
  });
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('loading');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(0);
  const [tab, setTab] = useState('direction');
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [deleteRequest, setDeleteRequest] = useState<DeleteRequest | null>(
    null,
  );
  const [revisionDrafts, setRevisionDrafts] = useState<Record<string, string>>(
    {},
  );
  const [refKind, setRefKind] = useState<ReferenceKind>('character');
  const [dragging, setDragging] = useState(false);
  const [guidesVisible, setGuidesVisible] = useState(true);
  const [pdfScope, setPdfScope] = useState('scene');
  const [pdfOpen, setPdfOpen] = useState(false);
  const [pdfUrl, setPdfUrl] = useState('');
  const [pdfName, setPdfName] = useState('storyboard.pdf');
  const [pdfBusy, setPdfBusy] = useState(false);
  const [saveRetry, setSaveRetry] = useState(0);
  const [undoCounts, setUndoCounts] = useState<Record<string, number>>({});
  const imageInput = useRef<HTMLInputElement>(null);
  const referenceInput = useRef<HTMLInputElement>(null);
  const backupInput = useRef<HTMLInputElement>(null);
  const savedVersions = useRef(new Map<string, string>());
  const deletedIds = useRef(new Set<string>());
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const undoStacks = useRef(new Map<string, StoryProject[]>());
  const lastChange = useRef({ key: '', time: 0 });
  const pdfUrlRef = useRef('');

  useEffect(() => {
    let active = true;
    listProjects()
      .then((items) => {
        if (!active) return;
        const demo = items.length === 0;
        for (const item of items)
          savedVersions.current.set(item.id, item.updatedAt);
        const initial = demo ? [starterProject()] : items;
        projectStore.current = initial;
        setProjects(initial);
        setSelection(initialSelection(initial[0], demo));
        setSaveState(demo ? 'unsaved' : 'saved');
        setLoaded(true);
      })
      .catch((cause) => {
        if (!active) return;
        setError(`Could not open local projects. ${messageOf(cause)}`);
        setSaveState('error');
        setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const dirty = projects.filter(
      (item) => savedVersions.current.get(item.id) !== item.updatedAt,
    );
    if (!dirty.length) {
      setSaveState('saved');
      return;
    }
    setSaveState('unsaved');
    const timer = window.setTimeout(() => {
      setSaveState('saving');
      saveQueue.current = saveQueue.current
        .then(async () => {
          for (const item of dirty) {
            if (deletedIds.current.has(item.id)) continue;
            await saveProject(item);
            savedVersions.current.set(item.id, item.updatedAt);
          }
          const clean = projectStore.current.every(
            (item) => savedVersions.current.get(item.id) === item.updatedAt,
          );
          setSaveState(clean ? 'saved' : 'unsaved');
        })
        .catch((cause) => {
          setSaveState('error');
          setError(
            `Autosave failed. Keep this window open and download a backup. ${messageOf(cause)}`,
          );
        });
    }, 550);
    return () => window.clearTimeout(timer);
  }, [projects, loaded, saveRetry]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (
        projectStore.current.some(
          (item) => savedVersions.current.get(item.id) !== item.updatedAt,
        )
      ) {
        event.preventDefault();
        // oxlint-disable-next-line typescript/no-deprecated -- Older WebKit versions require returnValue for unsaved-change protection.
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 3500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(
    () => () => {
      if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
    },
    [],
  );

  const replaceProjects = useCallback((items: StoryProject[]) => {
    projectStore.current = items;
    setProjects(items);
  }, []);

  const editProject = useCallback(
    (
      id: string,
      change: (project: StoryProject) => StoryProject,
      historyKey = '',
    ) => {
      const previous = projectStore.current.find((item) => item.id === id);
      if (!previous) return;
      const next = change(previous);
      if (next === previous) return;
      const now = Date.now();
      const key = `${id}:${historyKey}`;
      if (
        !historyKey ||
        lastChange.current.key !== key ||
        now - lastChange.current.time > 1100
      ) {
        const stack = undoStacks.current.get(id) ?? [];
        const nextStack = [...stack.slice(-29), previous];
        undoStacks.current.set(id, nextStack);
        setUndoCounts((counts) => ({ ...counts, [id]: nextStack.length }));
      }
      lastChange.current = { key, time: now };
      replaceProjects(
        projectStore.current.map((item) =>
          item.id === id
            ? { ...next, updatedAt: nextTimestamp(previous.updatedAt) }
            : item,
        ),
      );
    },
    [replaceProjects],
  );

  const project =
    projects.find((item) => item.id === selection.projectId) ?? projects[0];
  const scene =
    project?.scenes.find((item) => item.id === selection.sceneId) ??
    project?.scenes[0];
  const shot =
    scene?.shots.find((item) => item.id === selection.shotId) ??
    scene?.shots[0];
  const panel =
    shot?.panels.find((item) => item.id === selection.panelId) ??
    shot?.panels[0];
  const shotIndex = scene?.shots.findIndex((item) => item.id === shot?.id) ?? 0;
  const panelIndex =
    shot?.panels.findIndex((item) => item.id === panel?.id) ?? 0;
  const image = panel ? getSelectedImage(panel) : undefined;
  const revision = panel ? (revisionDrafts[panel.id] ?? '') : '';
  const setRevision = (value: string) => {
    if (panel)
      setRevisionDrafts((drafts) => ({ ...drafts, [panel.id]: value }));
  };
  useStoryboardTools(project ?? null, scene, shot, panel);

  const editShotAt = useCallback(
    (
      projectId: string,
      sceneId: string,
      shotId: string,
      change: (shot: Shot) => Shot,
      key = '',
    ) => {
      editProject(
        projectId,
        (current) => ({
          ...current,
          scenes: current.scenes.map((item) =>
            item.id === sceneId
              ? {
                  ...item,
                  shots: item.shots.map((value) =>
                    value.id === shotId ? change(value) : value,
                  ),
                }
              : item,
          ),
        }),
        key,
      );
    },
    [editProject],
  );

  const editPanelAt = useCallback(
    (target: Selection, change: (panel: Panel) => Panel, key = '') => {
      editShotAt(
        target.projectId,
        target.sceneId,
        target.shotId,
        (current) => ({
          ...current,
          panels: current.panels.map((item) =>
            item.id === target.panelId ? change(item) : item,
          ),
        }),
        key,
      );
    },
    [editShotAt],
  );

  const target: Selection = {
    projectId: project?.id ?? '',
    sceneId: scene?.id ?? '',
    shotId: shot?.id ?? '',
    panelId: panel?.id ?? '',
  };
  const updateShot = (patch: Partial<Shot>, key = '') =>
    editShotAt(
      target.projectId,
      target.sceneId,
      target.shotId,
      (current) => ({ ...current, ...patch }),
      key ? `shot:${shot?.id}:${key}` : '',
    );
  const updatePanel = (patch: Partial<Panel>, key = '') =>
    editPanelAt(
      target,
      (current) => ({ ...current, ...patch }),
      key ? `panel:${panel?.id}:${key}` : '',
    );

  function chooseShot(value: Shot) {
    setSelection({
      ...target,
      shotId: value.id,
      panelId: value.panels[0]?.id ?? '',
    });
  }
  function addProject() {
    const created = createProject(newName.trim() || 'Untitled project');
    replaceProjects([...projectStore.current, created]);
    setSelection(initialSelection(created));
    setNewName('');
    setNewProjectOpen(false);
  }
  function addScene() {
    if (!project) return;
    const created = createScene(`Scene ${project.scenes.length + 1}`);
    editProject(project.id, (current) => ({
      ...current,
      scenes: [...current.scenes, created],
    }));
    setSelection({
      projectId: project.id,
      sceneId: created.id,
      shotId: created.shots[0]?.id ?? '',
      panelId: created.shots[0]?.panels[0]?.id ?? '',
    });
  }
  function addShot() {
    if (!project || !scene) return;
    const created = createShot(`Shot ${scene.shots.length + 1}`);
    created.panels = [createPanel('Panel 1')];
    editProject(project.id, (current) => ({
      ...current,
      scenes: current.scenes.map((item) =>
        item.id === scene.id
          ? { ...item, shots: [...item.shots, created] }
          : item,
      ),
    }));
    chooseShot(created);
  }
  function addPanel() {
    if (!shot) return;
    const created = createPanel(`Panel ${shot.panels.length + 1}`);
    editShotAt(target.projectId, target.sceneId, target.shotId, (current) => ({
      ...current,
      panels: [...current.panels, created],
    }));
    setSelection({ ...target, panelId: created.id });
  }
  function undo() {
    if (!project) return;
    const stack = undoStacks.current.get(project.id) ?? [];
    const previous = stack.pop();
    if (!previous) return;
    setUndoCounts((counts) => ({ ...counts, [project.id]: stack.length }));
    lastChange.current = { key: '', time: 0 };
    replaceProjects(
      projectStore.current.map((item) =>
        item.id === previous.id
          ? { ...previous, updatedAt: nextTimestamp(item.updatedAt) }
          : item,
      ),
    );
    setNotice('Last change undone');
  }

  async function copyText(text: string, label = 'Prompt copied') {
    try {
      await navigator.clipboard.writeText(text);
      setNotice(label);
    } catch {
      setError(
        'Clipboard access was unavailable. Select the prompt text and copy it with ⌘C.',
      );
    }
  }

  async function addImage(file: File, destination = target) {
    setBusy((count) => count + 1);
    try {
      const dataUrl = await imageFileToDataUrl(file);
      const version = {
        id: newId(),
        dataUrl,
        createdAt: new Date().toISOString(),
        label: file.name,
      };
      const exists = projectStore.current
        .find((item) => item.id === destination.projectId)
        ?.scenes.find((item) => item.id === destination.sceneId)
        ?.shots.find((item) => item.id === destination.shotId)
        ?.panels.some((item) => item.id === destination.panelId);
      if (!exists)
        throw new Error(
          'The destination panel was removed while the image was loading. Add the image to another panel.',
        );
      editPanelAt(destination, (current) => ({
        ...current,
        versions: [...current.versions, version],
        selectedVersionId: version.id,
      }));
      setNotice('Image added · previous versions kept');
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy((count) => count - 1);
    }
  }

  async function addReferences(files: FileList | null) {
    if (!files?.length || !project) return;
    const destination = { ...target };
    const kind = refKind;
    setBusy((count) => count + 1);
    try {
      const results = await Promise.allSettled(
        Array.from(files).map(
          async (file) =>
            ({
              id: newId(),
              name: file.name.replace(/\.[^.]+$/, ''),
              kind,
              dataUrl: await imageFileToDataUrl(file),
              mimeType: file.type,
            }) satisfies ReferenceAsset,
        ),
      );
      const added = results.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : [],
      );
      const failures = results.filter((result) => result.status === 'rejected');
      if (added.length) {
        const exists = projectStore.current
          .find((item) => item.id === destination.projectId)
          ?.scenes.find((item) => item.id === destination.sceneId)
          ?.shots.some((item) => item.id === destination.shotId);
        if (!exists)
          throw new Error(
            'The destination shot was removed while the references were loading. Select another shot and upload them again.',
          );
        editProject(destination.projectId, (current) => ({
          ...current,
          references: [...current.references, ...added],
          scenes: current.scenes.map((item) =>
            item.id === destination.sceneId
              ? {
                  ...item,
                  shots: item.shots.map((value) =>
                    value.id === destination.shotId
                      ? {
                          ...value,
                          referenceIds: [
                            ...value.referenceIds,
                            ...added.map((ref) => ref.id),
                          ],
                        }
                      : value,
                  ),
                }
              : item,
          ),
        }));
        setNotice(
          `${added.length} reference${added.length === 1 ? '' : 's'} added`,
        );
      }
      if (failures.length)
        setError(
          `${failures.length} reference upload${failures.length === 1 ? '' : 's'} failed. ${messageOf((failures[0] as PromiseRejectedResult).reason)}`,
        );
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy((count) => count - 1);
    }
  }

  async function restoreBackup(file: File) {
    setBusy((count) => count + 1);
    try {
      const restored = await importProject(file);
      if (projectStore.current.some((item) => item.id === restored.id)) {
        restored.id = newId();
        restored.name = `${restored.name} (imported)`;
      }
      deletedIds.current.delete(restored.id);
      replaceProjects([...projectStore.current, restored]);
      setSelection(initialSelection(restored));
      setNotice('Project imported with its artwork');
    } catch (cause) {
      setError(`Could not import this backup. ${messageOf(cause)}`);
    } finally {
      setBusy((count) => count - 1);
    }
  }

  async function buildPdf() {
    if (!project) return;
    setPdfBusy(true);
    try {
      const { createStoryboardPdf } = await import('@/lib/pdf/export');
      const bytes = await createStoryboardPdf(
        project,
        pdfScope === 'scene' && scene ? { sceneId: scene.id } : undefined,
      );
      const blob = new Blob([new Uint8Array(bytes)], {
        type: 'application/pdf',
      });
      const url = URL.createObjectURL(blob);
      if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
      pdfUrlRef.current = url;
      setPdfUrl(url);
      setPdfName(
        `${fileName(project.name)}${pdfScope === 'scene' && scene ? ` - ${fileName(scene.title)}` : ''}.pdf`,
      );
      setPdfOpen(true);
    } catch (cause) {
      setError(`Could not create the PDF. ${messageOf(cause)}`);
    } finally {
      setPdfBusy(false);
    }
  }

  const prompt =
    project && scene && shot && panel
      ? buildPanelPrompt(project, scene, shot, panel)
      : '';
  const selectedRefs =
    project?.references.filter((ref) => shot?.referenceIds.includes(ref.id)) ??
    [];
  const saveLabel = {
    loading: 'Opening projects',
    saved: 'Saved on this device',
    unsaved: 'Unsaved changes',
    saving: 'Saving…',
    error: 'Save needs attention',
  }[saveState];

  return (
    <div className="storyboard-app">
      <input
        ref={imageInput}
        type="file"
        accept={imageAccept}
        className="sb-hidden"
        aria-label="Import panel image"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void addImage(file, { ...target });
          event.target.value = '';
        }}
      />
      <input
        ref={referenceInput}
        type="file"
        multiple
        accept={imageAccept}
        className="sb-hidden"
        aria-label="Upload reference images"
        onChange={(event) => {
          void addReferences(event.target.files);
          event.target.value = '';
        }}
      />
      <input
        ref={backupInput}
        type="file"
        accept=".json,application/json"
        className="sb-hidden"
        aria-label="Import project backup"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void restoreBackup(file);
          event.target.value = '';
        }}
      />

      <aside className="sb-sidebar">
        <div className="sb-brand">
          <span className="sb-brand-mark">
            <Film size={20} />
          </span>
          <span>
            Storyboard<span className="sb-brand-sub">DIRECTOR’S WORKSPACE</span>
          </span>
        </div>
        <div className="sb-project-select">
          <label htmlFor="project-select" className="sb-eyebrow">
            PROJECT
          </label>
          <div className="sb-select-wrap">
            <NativeSelect
              id="project-select"
              value={project?.id ?? ''}
              onChange={(event) => {
                const next = projects.find(
                  (item) => item.id === event.target.value,
                );
                if (next) setSelection(initialSelection(next));
              }}
              disabled={!projects.length}
            >
              {!projects.length && <option value="">No projects yet</option>}
              {projects.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="sb-project-actions">
            <Button variant="ghost" onClick={() => setNewProjectOpen(true)}>
              <Plus /> New project
            </Button>
            <IconButton
              label="Import project backup"
              onClick={() => backupInput.current?.click()}
            >
              <FolderOpen />
            </IconButton>
          </div>
        </div>
        <div className="sb-sidebar-section-head">
          <span className="sb-eyebrow">SCENES</span>
          <IconButton label="Add scene" onClick={addScene} disabled={!project}>
            <Plus />
          </IconButton>
        </div>
        <nav className="sb-scenes" aria-label="Scenes">
          {project?.scenes.map((item, index) => (
            <button
              className={`sb-scene ${scene?.id === item.id ? 'is-active' : ''}`}
              key={item.id}
              onClick={() =>
                setSelection({
                  projectId: project.id,
                  sceneId: item.id,
                  shotId: item.shots[0]?.id ?? '',
                  panelId: item.shots[0]?.panels[0]?.id ?? '',
                })
              }
              aria-current={scene?.id === item.id ? 'true' : undefined}
            >
              <span className="sb-scene-number">{number(index)}</span>
              <span className="sb-scene-text">
                {item.title || 'Untitled scene'}
                <small>
                  {item.shots.length} shot{item.shots.length === 1 ? '' : 's'}
                </small>
              </span>
            </button>
          ))}
        </nav>
        <div className="sb-sidebar-bottom">
          {project && (
            <>
              <div className="sb-project-summary">
                <span>
                  {project.scenes.reduce(
                    (sum, item) => sum + item.shots.length,
                    0,
                  )}{' '}
                  shots
                </span>
                <span>
                  {project.scenes.reduce(
                    (sum, item) =>
                      sum +
                      item.shots.reduce(
                        (count, value) => count + value.panels.length,
                        0,
                      ),
                    0,
                  )}{' '}
                  panels
                </span>
              </div>
              <Button
                className="sb-sidebar-link"
                variant="ghost"
                onClick={() => setSettingsOpen(true)}
              >
                <Settings2 /> Project settings
              </Button>
              <Button
                className="sb-sidebar-link"
                variant="ghost"
                onClick={() => {
                  try {
                    exportProject(project);
                  } catch (cause) {
                    setError(messageOf(cause));
                  }
                }}
              >
                <Download /> Download backup
              </Button>
            </>
          )}
          <p className="sb-local-note">
            Your projects live in this browser.
            <br />
            Keep a backup for safekeeping.
          </p>
        </div>
      </aside>

      <main className="sb-main">
        <header className="sb-topbar">
          <div className="sb-breadcrumb">
            <span>{project?.name ?? 'Your workspace'}</span>
            <span className="sb-slash">/</span>
            <strong>{scene?.title ?? 'Storyboard'}</strong>
          </div>
          <div className="sb-top-actions">
            <output className={`sb-save-status is-${saveState}`}>
              {saveState === 'saving' || saveState === 'loading' ? (
                <Loader2 className="sb-spin" size={14} />
              ) : (
                <span className="sb-status-dot" />
              )}
              {saveLabel}
            </output>
            {saveState === 'error' && (
              <Button
                variant="outline"
                onClick={() => setSaveRetry((value) => value + 1)}
              >
                Retry save
              </Button>
            )}
            <IconButton
              label="Undo last edit"
              onClick={undo}
              disabled={!project || !undoCounts[project.id]}
            >
              <Undo2 />
            </IconButton>
            <div className="sb-export-group">
              <NativeSelect
                aria-label="PDF export scope"
                value={pdfScope}
                onChange={(event) => setPdfScope(event.target.value)}
              >
                <option value="scene">This scene</option>
                <option value="project">Entire project</option>
              </NativeSelect>
              <Button
                className="sb-primary"
                onClick={() => void buildPdf()}
                disabled={!project || pdfBusy}
              >
                {pdfBusy ? <Loader2 className="sb-spin" /> : <FileDown />}
                <span>{pdfBusy ? 'Preparing…' : 'Preview PDF'}</span>
              </Button>
            </div>
          </div>
        </header>

        {error && (
          <div className="sb-error" role="alert">
            <span>{error}</span>
            <IconButton label="Dismiss error" onClick={() => setError('')}>
              <X />
            </IconButton>
          </div>
        )}
        {!loaded ? (
          <div className="sb-empty-workspace">
            <Loader2 className="sb-spin" />
            <h1>Opening your workspace</h1>
          </div>
        ) : !project ? (
          <div className="sb-empty-workspace">
            <Film size={38} />
            <h1>A place for your next scene.</h1>
            <p>Create a project or bring back a saved backup.</p>
            <Button
              className="sb-primary"
              onClick={() => setNewProjectOpen(true)}
            >
              <Plus /> Create project
            </Button>
            <Button
              variant="outline"
              onClick={() => backupInput.current?.click()}
            >
              Import backup
            </Button>
          </div>
        ) : (
          <>
            <section className="sb-sequence" aria-label="Shots in this scene">
              <div className="sb-sequence-heading">
                <span className="sb-eyebrow">SHOT SEQUENCE</span>
                <span>{scene?.shots.length ?? 0} shots</span>
              </div>
              <div className="sb-shot-strip">
                {scene?.shots.map((item, index) => {
                  const art = item.panels[0]
                    ? getSelectedImage(item.panels[0])
                    : undefined;
                  return (
                    <button
                      key={item.id}
                      className={`sb-shot-card ${shot?.id === item.id ? 'is-active' : ''}`}
                      onClick={() => chooseShot(item)}
                      aria-pressed={shot?.id === item.id}
                    >
                      <span className="sb-shot-thumb">
                        {art ? (
                          <img src={art.dataUrl} alt="" />
                        ) : (
                          <span className="sb-shot-placeholder">
                            <Film size={18} />
                          </span>
                        )}
                        <span>{number(index)}</span>
                      </span>
                      <span className="sb-shot-info">
                        <strong>{item.title || 'Untitled shot'}</strong>
                        <small>
                          {item.panels.length} panel
                          {item.panels.length === 1 ? '' : 's'}
                        </small>
                      </span>
                    </button>
                  );
                })}
                <Button
                  variant="ghost"
                  className="sb-add-shot"
                  onClick={addShot}
                  disabled={!scene}
                >
                  <Plus />
                  <span>Add shot</span>
                </Button>
              </div>
            </section>

            {!scene || !shot || !panel ? (
              <div className="sb-empty-workspace">
                <Layers3 size={32} />
                <h1>
                  {!scene
                    ? 'Begin with a scene.'
                    : !shot
                      ? 'Your first shot starts here.'
                      : 'Add a panel to this shot.'}
                </h1>
                <p>Describe what you see, then bring in the artwork.</p>
                <Button
                  className="sb-primary"
                  onClick={!scene ? addScene : !shot ? addShot : addPanel}
                >
                  <Plus />
                  {!scene ? 'Add scene' : !shot ? 'Add shot' : 'Add panel'}
                </Button>
              </div>
            ) : (
              <>
                <div className="sb-shot-heading">
                  <div className="sb-shot-heading-main">
                    <span className="sb-shot-badge">
                      SHOT {number(shotIndex)}
                    </span>
                    <Input
                      className="sb-title-input"
                      aria-label="Shot title"
                      value={shot.title}
                      placeholder="Untitled shot"
                      onChange={(event) =>
                        updateShot({ title: event.target.value }, 'title')
                      }
                    />
                  </div>
                  <div className="sb-shot-tools">
                    <IconButton
                      label="Move shot earlier"
                      disabled={shotIndex === 0}
                      onClick={() =>
                        editProject(project.id, (current) => ({
                          ...current,
                          scenes: current.scenes.map((item) =>
                            item.id === scene.id
                              ? {
                                  ...item,
                                  shots: moveItem(item.shots, shotIndex, -1),
                                }
                              : item,
                          ),
                        }))
                      }
                    >
                      <ArrowLeft />
                    </IconButton>
                    <IconButton
                      label="Move shot later"
                      disabled={shotIndex === scene.shots.length - 1}
                      onClick={() =>
                        editProject(project.id, (current) => ({
                          ...current,
                          scenes: current.scenes.map((item) =>
                            item.id === scene.id
                              ? {
                                  ...item,
                                  shots: moveItem(item.shots, shotIndex, 1),
                                }
                              : item,
                          ),
                        }))
                      }
                    >
                      <ArrowRight />
                    </IconButton>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        const duplicate = cloneShot(shot);
                        duplicate.title = `${shot.title || 'Shot'} — alternative`;
                        editProject(project.id, (current) => ({
                          ...current,
                          scenes: current.scenes.map((item) =>
                            item.id === scene.id
                              ? {
                                  ...item,
                                  shots: [
                                    ...item.shots.slice(0, shotIndex + 1),
                                    duplicate,
                                    ...item.shots.slice(shotIndex + 1),
                                  ],
                                }
                              : item,
                          ),
                        }));
                        chooseShot(duplicate);
                      }}
                    >
                      <Copy /> Duplicate
                    </Button>
                    <IconButton
                      label="Delete shot"
                      danger
                      onClick={() =>
                        setDeleteRequest({
                          title: 'Delete this shot?',
                          description:
                            'Its panels and image versions will be removed from this project. You can undo this change.',
                          run: () =>
                            editProject(project.id, (current) => ({
                              ...current,
                              scenes: current.scenes.map((item) =>
                                item.id === scene.id
                                  ? {
                                      ...item,
                                      shots: item.shots.filter(
                                        (value) => value.id !== shot.id,
                                      ),
                                    }
                                  : item,
                              ),
                            })),
                        })
                      }
                    >
                      <Trash2 />
                    </IconButton>
                  </div>
                </div>

                <div className="sb-editor-grid">
                  <section
                    className="sb-panel-workspace"
                    aria-label="Panel artwork and dialogue"
                  >
                    <div className="sb-canvas-topline">
                      <span>
                        PANEL {number(panelIndex)}{' '}
                        <span className="sb-muted">
                          OF {number(shot.panels.length - 1)}
                        </span>
                      </span>
                      <span>
                        {project.aspectRatio.toFixed(2)}:1{' '}
                        <span className="sb-dot-separator">·</span>{' '}
                        {project.style}
                      </span>
                    </div>
                    <div
                      className={`sb-canvas ${dragging ? 'is-dragging' : ''}`}
                      style={{ aspectRatio: project.aspectRatio }}
                      onDragOver={(event) => {
                        event.preventDefault();
                        setDragging(true);
                      }}
                      onDragLeave={(event) => {
                        if (
                          !event.currentTarget.contains(
                            event.relatedTarget as Node,
                          )
                        )
                          setDragging(false);
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        setDragging(false);
                        const file = event.dataTransfer.files[0];
                        if (file) void addImage(file, { ...target });
                      }}
                    >
                      {image ? (
                        <img
                          className="sb-artwork"
                          src={image.dataUrl}
                          alt={panel.title || `Panel ${panelIndex + 1}`}
                        />
                      ) : (
                        <div className="sb-empty-canvas">
                          <span className="sb-corner sb-corner-tl" />
                          <span className="sb-corner sb-corner-tr" />
                          <span className="sb-corner sb-corner-bl" />
                          <span className="sb-corner sb-corner-br" />
                          <ImagePlus size={30} strokeWidth={1.25} />
                          <h2>Your frame, ready to take shape.</h2>
                          <p>Drop an image here, or add one from your files.</p>
                          <Button
                            onClick={() => imageInput.current?.click()}
                            className="sb-canvas-import"
                          >
                            <Plus /> Add image
                          </Button>
                        </div>
                      )}
                      {guidesVisible &&
                        (panel.markers.length > 0 ||
                          panel.arrows.length > 0) && (
                          <svg
                            className="sb-guides-overlay"
                            viewBox="0 0 1000 500"
                            preserveAspectRatio="none"
                            aria-label="Composition guides"
                          >
                            <defs>
                              <marker
                                id="sb-arrow-camera"
                                markerWidth="9"
                                markerHeight="9"
                                refX="7"
                                refY="4"
                                orient="auto"
                              >
                                <path
                                  d="M0,0 L8,4 L0,8"
                                  fill="none"
                                  stroke="#b07222"
                                  strokeWidth="1.5"
                                />
                              </marker>
                              <marker
                                id="sb-arrow-action"
                                markerWidth="9"
                                markerHeight="9"
                                refX="7"
                                refY="4"
                                orient="auto"
                              >
                                <path
                                  d="M0,0 L8,4 L0,8"
                                  fill="none"
                                  stroke="#416e78"
                                  strokeWidth="1.5"
                                />
                              </marker>
                            </defs>
                            {panel.markers.map((marker) => (
                              <g
                                key={marker.id}
                                transform={`translate(${marker.x * 1000},${marker.y * 500})`}
                              >
                                <ellipse
                                  rx={24 * marker.scale}
                                  ry={42 * marker.scale}
                                  fill="#b0722222"
                                  stroke="#a97023"
                                  strokeWidth="2"
                                  strokeDasharray="5 4"
                                />
                                <text
                                  y={-(42 * marker.scale + 10)}
                                  textAnchor="middle"
                                  fill="#704918"
                                  fontSize="20"
                                  paintOrder="stroke"
                                  stroke="#fbf7ec"
                                  strokeWidth="4"
                                >
                                  {marker.label}
                                </text>
                              </g>
                            ))}
                            {panel.arrows.map((arrow) => (
                              <g key={arrow.id}>
                                <line
                                  x1={arrow.x1 * 1000}
                                  y1={arrow.y1 * 500}
                                  x2={arrow.x2 * 1000}
                                  y2={arrow.y2 * 500}
                                  stroke={
                                    arrow.kind === 'camera'
                                      ? '#b07222'
                                      : '#416e78'
                                  }
                                  strokeWidth="3"
                                  markerEnd={`url(#sb-arrow-${arrow.kind})`}
                                />
                                <text
                                  x={(arrow.x1 + arrow.x2) * 500}
                                  y={(arrow.y1 + arrow.y2) * 250 - 13}
                                  textAnchor="middle"
                                  fill={
                                    arrow.kind === 'camera'
                                      ? '#704918'
                                      : '#315763'
                                  }
                                  fontSize="18"
                                  paintOrder="stroke"
                                  stroke="#fbf7ec"
                                  strokeWidth="4"
                                >
                                  {arrow.kind.toUpperCase()}: {arrow.label}
                                </text>
                              </g>
                            ))}
                          </svg>
                        )}
                      {dragging && (
                        <div className="sb-drop-overlay">
                          <Upload />
                          <strong>
                            Drop to {image ? 'replace' : 'add'} this panel’s
                            image
                          </strong>
                        </div>
                      )}
                    </div>
                    <div className="sb-canvas-actions">
                      <span className="sb-hint">
                        {image
                          ? 'Full image · fit within frame'
                          : 'No artwork yet'}
                      </span>
                      <div>
                        <Button
                          variant="ghost"
                          onClick={() => imageInput.current?.click()}
                        >
                          <Upload />
                          {image ? 'Replace image' : 'Import image'}
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => setHistoryOpen(true)}
                          disabled={!panel.versions.length}
                        >
                          <Layers3 /> Versions{' '}
                          <span className="sb-count">
                            {panel.versions.length}
                          </span>
                        </Button>
                      </div>
                    </div>

                    <div className="sb-panel-strip">
                      {shot.panels.map((item, index) => (
                        <button
                          key={item.id}
                          className={`sb-panel-tab ${item.id === panel.id ? 'is-active' : ''}`}
                          onClick={() =>
                            setSelection({ ...target, panelId: item.id })
                          }
                          aria-pressed={item.id === panel.id}
                        >
                          <span>{number(index)}</span>
                          <strong>{item.title || 'Untitled panel'}</strong>
                          <small>{item.framing || 'Framing unset'}</small>
                        </button>
                      ))}
                      <Button
                        variant="ghost"
                        className="sb-add-panel"
                        onClick={addPanel}
                      >
                        <Plus />
                        <span>Add panel</span>
                      </Button>
                    </div>
                    <div className="sb-panel-details">
                      <Field label="Panel name">
                        <Input
                          value={panel.title}
                          onChange={(event) =>
                            updatePanel({ title: event.target.value }, 'title')
                          }
                        />
                      </Field>
                      <Field label="Framing">
                        <Input
                          list="sb-framing-options"
                          value={panel.framing}
                          placeholder="e.g. Medium"
                          onChange={(event) =>
                            updatePanel(
                              { framing: event.target.value },
                              'framing',
                            )
                          }
                        />
                      </Field>
                      <Field label="Angle">
                        <Input
                          list="sb-angle-options"
                          value={panel.angle}
                          placeholder="e.g. Eye level"
                          onChange={(event) =>
                            updatePanel({ angle: event.target.value }, 'angle')
                          }
                        />
                      </Field>
                      <div className="sb-panel-order">
                        <IconButton
                          label="Move panel earlier"
                          disabled={panelIndex === 0}
                          onClick={() =>
                            updateShot({
                              panels: moveItem(shot.panels, panelIndex, -1),
                            })
                          }
                        >
                          <ArrowLeft />
                        </IconButton>
                        <IconButton
                          label="Move panel later"
                          disabled={panelIndex === shot.panels.length - 1}
                          onClick={() =>
                            updateShot({
                              panels: moveItem(shot.panels, panelIndex, 1),
                            })
                          }
                        >
                          <ArrowRight />
                        </IconButton>
                        <IconButton
                          label="Duplicate panel"
                          onClick={() => {
                            const duplicate: Panel = {
                              ...structuredClone(panel),
                              id: newId(),
                              title: `${panel.title || 'Panel'} — copy`,
                            };
                            duplicate.markers = duplicate.markers.map(
                              (item) => ({ ...item, id: newId() }),
                            );
                            duplicate.arrows = duplicate.arrows.map((item) => ({
                              ...item,
                              id: newId(),
                            }));
                            const versionMap = new Map(
                              duplicate.versions.map((item) => [
                                item.id,
                                newId(),
                              ]),
                            );
                            duplicate.versions = duplicate.versions.map(
                              (item) => ({
                                ...item,
                                id: versionMap.get(item.id)!,
                              }),
                            );
                            duplicate.selectedVersionId =
                              duplicate.selectedVersionId
                                ? (versionMap.get(
                                    duplicate.selectedVersionId,
                                  ) ?? null)
                                : null;
                            updateShot({
                              panels: [
                                ...shot.panels.slice(0, panelIndex + 1),
                                duplicate,
                                ...shot.panels.slice(panelIndex + 1),
                              ],
                            });
                            setSelection({ ...target, panelId: duplicate.id });
                          }}
                        >
                          <Copy />
                        </IconButton>
                        <IconButton
                          label={
                            shot.panels.length === 1
                              ? 'A shot needs at least one panel'
                              : 'Delete panel'
                          }
                          disabled={shot.panels.length === 1}
                          danger
                          onClick={() =>
                            setDeleteRequest({
                              title: 'Delete this panel?',
                              description:
                                'The panel and its image versions will be removed. The shot’s dialogue and direction will stay in place.',
                              run: () =>
                                editShotAt(
                                  target.projectId,
                                  target.sceneId,
                                  target.shotId,
                                  (current) => ({
                                    ...current,
                                    panels: current.panels.filter(
                                      (item) => item.id !== panel.id,
                                    ),
                                  }),
                                ),
                            })
                          }
                        >
                          <Trash2 />
                        </IconButton>
                      </div>
                    </div>
                    <Field
                      className="sb-panel-moment"
                      label="This moment"
                      hint="Describe what changes in this panel. The shot’s overall direction stays shared."
                    >
                      <Textarea
                        rows={2}
                        value={panel.description}
                        placeholder="Describe the pose, expression, or movement at this moment…"
                        onChange={(event) =>
                          updatePanel(
                            { description: event.target.value },
                            'description',
                          )
                        }
                      />
                    </Field>
                    <section className="sb-dialogue-block">
                      <div className="sb-section-title">
                        <span className="sb-eyebrow">DIALOGUE</span>
                        <span>Shared across this shot</span>
                      </div>
                      <Textarea
                        aria-label="Shot dialogue"
                        className="sb-dialogue-input"
                        rows={3}
                        value={shot.dialogue}
                        placeholder={
                          'CHARACTER\nEnter dialogue exactly as it should appear beneath this shot…'
                        }
                        onChange={(event) =>
                          updateShot(
                            { dialogue: event.target.value },
                            'dialogue',
                          )
                        }
                      />
                      <span className="sb-hint">
                        Printed once beneath the shot. Line breaks are
                        preserved.
                      </span>
                    </section>
                  </section>

                  <aside className="sb-inspector" aria-label="Shot inspector">
                    <Tabs
                      value={tab}
                      onValueChange={(value) => setTab(String(value))}
                    >
                      <TabsList className="sb-inspector-tabs">
                        <TabsTrigger value="direction">Direction</TabsTrigger>
                        <TabsTrigger value="prompt">Prompt</TabsTrigger>
                        <TabsTrigger value="references">References</TabsTrigger>
                      </TabsList>
                      <TabsContent value="direction" className="sb-tab-body">
                        <div className="sb-inspector-intro">
                          <span className="sb-eyebrow">THE SHOT</span>
                          <p>Describe the image in your mind.</p>
                        </div>
                        <Field label="Director’s description">
                          <Textarea
                            className="sb-direction-input"
                            rows={5}
                            value={shot.description}
                            placeholder="Describe the shot, in your own words…"
                            onChange={(event) =>
                              updateShot(
                                { description: event.target.value },
                                'description',
                              )
                            }
                          />
                        </Field>
                        <Field label="Camera movement">
                          <Textarea
                            rows={2}
                            value={shot.camera}
                            placeholder="e.g. Dolly forward into a close-up"
                            onChange={(event) =>
                              updateShot(
                                { camera: event.target.value },
                                'camera',
                              )
                            }
                          />
                        </Field>
                        <Field label="Action & performance">
                          <Textarea
                            rows={2}
                            value={shot.action}
                            placeholder="What happens throughout this shot?"
                            onChange={(event) =>
                              updateShot(
                                { action: event.target.value },
                                'action',
                              )
                            }
                          />
                        </Field>
                        <Field label="Production notes">
                          <Textarea
                            rows={2}
                            value={shot.notes}
                            placeholder="Continuity, props, sound, or handoff notes…"
                            onChange={(event) =>
                              updateShot({ notes: event.target.value }, 'notes')
                            }
                          />
                        </Field>
                        <details className="sb-guides-editor">
                          <summary>
                            <span>Composition guides</span>
                            <span className="sb-muted">Optional</span>
                            <ChevronDown size={14} />
                          </summary>
                          <p className="sb-hint">
                            Simple positions and labelled movement arrows.
                            Included in prompts and PDF exports.
                          </p>
                          <label
                            className="sb-check-line"
                            htmlFor="sb-guides-visible"
                          >
                            <Checkbox
                              id="sb-guides-visible"
                              checked={guidesVisible}
                              onCheckedChange={(checked) =>
                                setGuidesVisible(Boolean(checked))
                              }
                            />
                            Show guides on canvas
                          </label>
                          {panel.markers.map((marker) => (
                            <div className="sb-guide-card" key={marker.id}>
                              <div className="sb-inline-field">
                                <Input
                                  aria-label="Marker label"
                                  value={marker.label}
                                  placeholder="Character or object"
                                  onChange={(event) =>
                                    updatePanel(
                                      {
                                        markers: panel.markers.map((item) =>
                                          item.id === marker.id
                                            ? {
                                                ...item,
                                                label: event.target.value,
                                              }
                                            : item,
                                        ),
                                      },
                                      `marker:${marker.id}:label`,
                                    )
                                  }
                                />
                                <IconButton
                                  label={`Remove ${marker.label || 'marker'}`}
                                  onClick={() =>
                                    updatePanel({
                                      markers: panel.markers.filter(
                                        (item) => item.id !== marker.id,
                                      ),
                                    })
                                  }
                                >
                                  <X />
                                </IconButton>
                              </div>
                              {(['x', 'y', 'scale'] as const).map((axis) => (
                                <label className="sb-range" key={axis}>
                                  <span>
                                    {axis === 'x'
                                      ? 'Left / right'
                                      : axis === 'y'
                                        ? 'Top / bottom'
                                        : 'Size'}
                                  </span>
                                  <input
                                    type="range"
                                    min={axis === 'scale' ? 0.3 : 0.05}
                                    max={axis === 'scale' ? 4 : 0.95}
                                    step={0.01}
                                    value={marker[axis]}
                                    onChange={(event) =>
                                      updatePanel(
                                        {
                                          markers: panel.markers.map((item) =>
                                            item.id === marker.id
                                              ? {
                                                  ...item,
                                                  [axis]: Number(
                                                    event.target.value,
                                                  ),
                                                }
                                              : item,
                                          ),
                                        },
                                        `marker:${marker.id}:${axis}`,
                                      )
                                    }
                                  />
                                </label>
                              ))}
                            </div>
                          ))}
                          <Button
                            variant="outline"
                            className="sb-full-width"
                            onClick={() =>
                              updatePanel({
                                markers: [
                                  ...panel.markers,
                                  {
                                    id: newId(),
                                    label: 'Subject',
                                    x: 0.5,
                                    y: 0.55,
                                    scale: 1,
                                  },
                                ],
                              })
                            }
                          >
                            <Plus /> Add position marker
                          </Button>
                          {panel.arrows.map((arrow) => (
                            <div className="sb-guide-card" key={arrow.id}>
                              <div className="sb-inline-field">
                                <NativeSelect
                                  aria-label="Arrow type"
                                  value={arrow.kind}
                                  onChange={(event) =>
                                    updatePanel({
                                      arrows: panel.arrows.map((item) =>
                                        item.id === arrow.id
                                          ? {
                                              ...item,
                                              kind: event.target.value as
                                                | 'camera'
                                                | 'action',
                                            }
                                          : item,
                                      ),
                                    })
                                  }
                                >
                                  <option value="camera">Camera</option>
                                  <option value="action">Action</option>
                                </NativeSelect>
                                <IconButton
                                  label="Remove arrow"
                                  onClick={() =>
                                    updatePanel({
                                      arrows: panel.arrows.filter(
                                        (item) => item.id !== arrow.id,
                                      ),
                                    })
                                  }
                                >
                                  <X />
                                </IconButton>
                              </div>
                              <Input
                                aria-label="Arrow label"
                                placeholder="e.g. Pan right"
                                value={arrow.label}
                                onChange={(event) =>
                                  updatePanel(
                                    {
                                      arrows: panel.arrows.map((item) =>
                                        item.id === arrow.id
                                          ? {
                                              ...item,
                                              label: event.target.value,
                                            }
                                          : item,
                                      ),
                                    },
                                    `arrow:${arrow.id}:label`,
                                  )
                                }
                              />
                              <div className="sb-arrow-coordinates">
                                {(['x1', 'y1', 'x2', 'y2'] as const).map(
                                  (axis) => (
                                    <Field
                                      key={axis}
                                      label={
                                        {
                                          x1: 'Start X',
                                          y1: 'Start Y',
                                          x2: 'End X',
                                          y2: 'End Y',
                                        }[axis]
                                      }
                                    >
                                      <Input
                                        type="number"
                                        min={0}
                                        max={100}
                                        value={Math.round(arrow[axis] * 100)}
                                        onChange={(event) => {
                                          const value =
                                            Math.max(
                                              0,
                                              Math.min(
                                                100,
                                                Number(event.target.value),
                                              ),
                                            ) / 100;
                                          updatePanel(
                                            {
                                              arrows: panel.arrows.map(
                                                (item) =>
                                                  item.id === arrow.id
                                                    ? { ...item, [axis]: value }
                                                    : item,
                                              ),
                                            },
                                            `arrow:${arrow.id}:${axis}`,
                                          );
                                        }}
                                      />
                                    </Field>
                                  ),
                                )}
                              </div>
                            </div>
                          ))}
                          <Button
                            variant="outline"
                            className="sb-full-width"
                            onClick={() =>
                              updatePanel({
                                arrows: [
                                  ...panel.arrows,
                                  {
                                    id: newId(),
                                    kind: 'camera',
                                    x1: 0.2,
                                    y1: 0.8,
                                    x2: 0.8,
                                    y2: 0.8,
                                    label: 'Move right',
                                  },
                                ],
                              })
                            }
                          >
                            <Plus /> Add movement arrow
                          </Button>
                        </details>
                      </TabsContent>

                      <TabsContent value="prompt" className="sb-tab-body">
                        <div className="sb-inspector-intro">
                          <span className="sb-eyebrow">IMAGE WORKFLOW</span>
                          <p>Take your direction to your image tool.</p>
                        </div>
                        <ol className="sb-workflow">
                          <li>Copy this panel’s prompt.</li>
                          <li>Attach the selected reference images.</li>
                          <li>Generate, then import the result here.</li>
                        </ol>
                        <div className="sb-prompt-references">
                          <strong>
                            {selectedRefs.length} reference
                            {selectedRefs.length === 1 ? '' : 's'} to attach
                            manually
                          </strong>
                          {selectedRefs.length ? (
                            selectedRefs.map((ref) => (
                              <button
                                key={ref.id}
                                onClick={() =>
                                  downloadUrl(
                                    ref.dataUrl,
                                    `${fileName(ref.name)}.${imageExtension(ref.mimeType)}`,
                                  )
                                }
                              >
                                <Download size={13} />
                                {ref.name}
                              </button>
                            ))
                          ) : (
                            <p>
                              Select artwork in the References tab when you have
                              it.
                            </p>
                          )}
                        </div>
                        <Textarea
                          className="sb-prompt-text"
                          aria-label="Assembled panel prompt"
                          readOnly
                          rows={10}
                          value={prompt}
                        />
                        <Button
                          className="sb-primary sb-full-width"
                          onClick={() => void copyText(prompt)}
                        >
                          <Copy /> Copy panel prompt
                        </Button>
                        <div className="sb-revision-block">
                          <Field
                            label="Revise the selected image"
                            hint="Attach the current image as well as the references when using this revision prompt."
                          >
                            <Textarea
                              rows={3}
                              placeholder="e.g. Move Matilda slightly left. Keep everything else."
                              value={revision}
                              onChange={(event) =>
                                setRevision(event.target.value)
                              }
                            />
                          </Field>
                          <Button
                            variant="outline"
                            className="sb-full-width"
                            disabled={!revision.trim() || !image}
                            onClick={() =>
                              void copyText(
                                buildRevisionPrompt(
                                  project,
                                  scene,
                                  shot,
                                  panel,
                                  revision,
                                ),
                                'Revision prompt copied',
                              )
                            }
                          >
                            <Copy /> Copy revision prompt
                          </Button>
                          {!image && (
                            <p className="sb-hint">
                              Import an image to start revising it.
                            </p>
                          )}
                        </div>
                      </TabsContent>

                      <TabsContent value="references" className="sb-tab-body">
                        <div className="sb-inspector-intro">
                          <span className="sb-eyebrow">REFERENCE LIBRARY</span>
                          <p>Select the artwork this shot should use.</p>
                        </div>
                        <div className="sb-ref-upload">
                          <NativeSelect
                            value={refKind}
                            aria-label="New reference category"
                            onChange={(event) =>
                              setRefKind(event.target.value as ReferenceKind)
                            }
                          >
                            <option value="character">Character</option>
                            <option value="location">Location</option>
                            <option value="prop">Prop</option>
                            <option value="style">Style</option>
                          </NativeSelect>
                          <Button
                            variant="outline"
                            onClick={() => referenceInput.current?.click()}
                          >
                            <Upload /> Upload
                          </Button>
                        </div>
                        <p className="sb-hint">
                          PNG, JPEG, WebP, GIF, or AVIF. Added to this project
                          and selected for this shot.
                        </p>
                        {!project.references.length ? (
                          <div className="sb-empty-references">
                            <ImagePlus size={30} strokeWidth={1.25} />
                            <strong>Start with your character art.</strong>
                            <p>
                              Add character views, locations, props, and a
                              visual style reference.
                            </p>
                          </div>
                        ) : (
                          <div className="sb-reference-list">
                            {project.references.map((ref) => (
                              <div
                                className={`sb-reference-card ${shot.referenceIds.includes(ref.id) ? 'is-selected' : ''}`}
                                key={ref.id}
                              >
                                <label className="sb-ref-select">
                                  <Checkbox
                                    aria-label={`Use ${ref.name} in this shot`}
                                    checked={shot.referenceIds.includes(ref.id)}
                                    onCheckedChange={(checked) =>
                                      updateShot({
                                        referenceIds: checked
                                          ? [...shot.referenceIds, ref.id]
                                          : shot.referenceIds.filter(
                                              (id) => id !== ref.id,
                                            ),
                                      })
                                    }
                                  />
                                  <img src={ref.dataUrl} alt={ref.name} />
                                  <span className="sb-reference-kind">
                                    {ref.kind}
                                  </span>
                                </label>
                                <Input
                                  aria-label="Reference name"
                                  value={ref.name}
                                  onChange={(event) =>
                                    editProject(
                                      project.id,
                                      (current) => ({
                                        ...current,
                                        references: current.references.map(
                                          (item) =>
                                            item.id === ref.id
                                              ? {
                                                  ...item,
                                                  name: event.target.value,
                                                }
                                              : item,
                                        ),
                                      }),
                                      `ref:${ref.id}:name`,
                                    )
                                  }
                                />
                                <div className="sb-ref-actions">
                                  <NativeSelect
                                    aria-label={`Category for ${ref.name}`}
                                    value={ref.kind}
                                    onChange={(event) =>
                                      editProject(project.id, (current) => ({
                                        ...current,
                                        references: current.references.map(
                                          (item) =>
                                            item.id === ref.id
                                              ? {
                                                  ...item,
                                                  kind: event.target
                                                    .value as ReferenceKind,
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
                                  <IconButton
                                    label={`Download ${ref.name}`}
                                    onClick={() =>
                                      downloadUrl(
                                        ref.dataUrl,
                                        `${fileName(ref.name)}.${imageExtension(ref.mimeType)}`,
                                      )
                                    }
                                  >
                                    <Download />
                                  </IconButton>
                                  <IconButton
                                    label={`Delete ${ref.name} from project`}
                                    danger
                                    onClick={() =>
                                      setDeleteRequest({
                                        title: 'Remove this reference?',
                                        description:
                                          'It will be removed from this project and every shot that uses it. Existing panel images will stay in place.',
                                        run: () =>
                                          editProject(
                                            project.id,
                                            (current) => ({
                                              ...current,
                                              references:
                                                current.references.filter(
                                                  (item) => item.id !== ref.id,
                                                ),
                                              scenes: current.scenes.map(
                                                (item) => ({
                                                  ...item,
                                                  shots: item.shots.map(
                                                    (value) => ({
                                                      ...value,
                                                      referenceIds:
                                                        value.referenceIds.filter(
                                                          (id) => id !== ref.id,
                                                        ),
                                                    }),
                                                  ),
                                                }),
                                              ),
                                            }),
                                          ),
                                      })
                                    }
                                  >
                                    <Trash2 />
                                  </IconButton>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </TabsContent>
                    </Tabs>
                  </aside>
                </div>
              </>
            )}
          </>
        )}
      </main>

      <datalist id="sb-framing-options" aria-label="Suggested shot framing">
        <option value="Extreme wide">Extreme wide</option>
        <option value="Wide">Wide</option>
        <option value="Full">Full</option>
        <option value="Medium wide">Medium wide</option>
        <option value="Medium">Medium</option>
        <option value="Medium close-up">Medium close-up</option>
        <option value="Close-up">Close-up</option>
        <option value="Extreme close-up">Extreme close-up</option>
        <option value="Aerial">Aerial</option>
        <option value="Over the shoulder">Over the shoulder</option>
        <option value="POV">POV</option>
      </datalist>
      <datalist id="sb-angle-options" aria-label="Suggested camera angles">
        <option value="Eye level">Eye level</option>
        <option value="Low angle">Low angle</option>
        <option value="High angle">High angle</option>
        <option value="Overhead">Overhead</option>
        <option value="Dutch angle">Dutch angle</option>
      </datalist>
      {notice && (
        <output className="sb-toast">
          <Check size={17} />
          {notice}
        </output>
      )}
      {busy > 0 && (
        <output className="sb-import-status">
          <Loader2 size={15} className="sb-spin" /> Importing artwork…
        </output>
      )}

      <Dialog open={newProjectOpen} onOpenChange={setNewProjectOpen}>
        <DialogContent className="sb-dialog">
          <DialogHeader>
            <DialogTitle>Create a project</DialogTitle>
            <DialogDescription>
              A fresh workspace for your scenes, shots, and reference art.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              addProject();
            }}
          >
            <Field label="Project name">
              <Input
                value={newName}
                placeholder="Untitled project"
                onChange={(event) => setNewName(event.target.value)}
              />
            </Field>
            <div className="sb-dialog-actions">
              <Button
                variant="outline"
                onClick={() => setNewProjectOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" className="sb-primary">
                Create project
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sb-dialog sb-settings-dialog">
          <DialogHeader>
            <DialogTitle>Project settings</DialogTitle>
            <DialogDescription>
              These choices apply across the project. Changes save
              automatically.
            </DialogDescription>
          </DialogHeader>
          {project && (
            <div className="sb-settings-body">
              <Field label="Project name">
                <Input
                  value={project.name}
                  onChange={(event) =>
                    editProject(
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
                    value={
                      [2.39, 16 / 9, 4 / 3, 1].includes(project.aspectRatio)
                        ? project.aspectRatio
                        : 'custom'
                    }
                    onChange={(event) => {
                      if (event.target.value !== 'custom')
                        editProject(project.id, (current) => ({
                          ...current,
                          aspectRatio: Number(event.target.value),
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
                    type="number"
                    min={0.25}
                    max={4}
                    step={0.01}
                    value={Number(project.aspectRatio.toFixed(4))}
                    onChange={(event) => {
                      const ratio = Number(event.target.value);
                      if (ratio >= 0.25 && ratio <= 4)
                        editProject(
                          project.id,
                          (current) => ({ ...current, aspectRatio: ratio }),
                          'ratio',
                        );
                    }}
                  />
                </Field>
              </div>
              <p className="sb-hint">
                Imported artwork fits inside the frame without cropping or
                stretching.
              </p>
              <Field label="Art style">
                <Input
                  value={project.style}
                  placeholder="Rough pencil sketch"
                  onChange={(event) =>
                    editProject(
                      project.id,
                      (current) => ({ ...current, style: event.target.value }),
                      'style',
                    )
                  }
                />
              </Field>
              <Field label="Style notes">
                <Textarea
                  rows={3}
                  value={project.styleNotes}
                  placeholder="e.g. Loose graphite lines, restrained shading, readable silhouettes."
                  onChange={(event) =>
                    editProject(
                      project.id,
                      (current) => ({
                        ...current,
                        styleNotes: event.target.value,
                      }),
                      'styleNotes',
                    )
                  }
                />
              </Field>
              {scene && (
                <section className="sb-scene-settings">
                  <span className="sb-eyebrow">CURRENT SCENE</span>
                  <Field label="Scene name">
                    <Input
                      value={scene.title}
                      onChange={(event) =>
                        editProject(
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
                      onClick={() =>
                        editProject(project.id, (current) => ({
                          ...current,
                          scenes: moveItem(
                            current.scenes,
                            current.scenes.findIndex(
                              (item) => item.id === scene.id,
                            ),
                            -1,
                          ),
                        }))
                      }
                    >
                      <ArrowUp /> Move earlier
                    </Button>
                    <Button
                      variant="outline"
                      disabled={
                        project.scenes.indexOf(scene) ===
                        project.scenes.length - 1
                      }
                      onClick={() =>
                        editProject(project.id, (current) => ({
                          ...current,
                          scenes: moveItem(
                            current.scenes,
                            current.scenes.findIndex(
                              (item) => item.id === scene.id,
                            ),
                            1,
                          ),
                        }))
                      }
                    >
                      <ArrowDown /> Move later
                    </Button>
                    <IconButton
                      label="Delete scene"
                      danger
                      onClick={() => {
                        setSettingsOpen(false);
                        setDeleteRequest({
                          title: 'Delete this scene?',
                          description:
                            'All shots, panels, and image versions in this scene will be removed. You can undo this change.',
                          run: () =>
                            editProject(project.id, (current) => ({
                              ...current,
                              scenes: current.scenes.filter(
                                (item) => item.id !== scene.id,
                              ),
                            })),
                        });
                      }}
                    >
                      <Trash2 />
                    </IconButton>
                  </div>
                </section>
              )}
              <div className="sb-settings-footer">
                <Button
                  variant="destructive"
                  onClick={() => {
                    setSettingsOpen(false);
                    const id = project.id;
                    setDeleteRequest({
                      title: `Delete “${project.name}”?`,
                      description:
                        'This removes the project from this browser, including all artwork. Download a backup first if you want to restore it later. Project deletion cannot be undone.',
                      run: () => {
                        deletedIds.current.add(id);
                        replaceProjects(
                          projectStore.current.filter((item) => item.id !== id),
                        );
                        saveQueue.current = saveQueue.current
                          .then(() => deleteProject(id))
                          .then(() => {
                            savedVersions.current.delete(id);
                            undoStacks.current.delete(id);
                            setNotice('Project deleted');
                          })
                          .catch((cause) => {
                            deletedIds.current.delete(id);
                            if (
                              !projectStore.current.some(
                                (item) => item.id === id,
                              )
                            )
                              replaceProjects([
                                ...projectStore.current,
                                project,
                              ]);
                            setError(
                              `Could not delete the project. ${messageOf(cause)}`,
                            );
                          });
                      },
                    });
                  }}
                >
                  <Trash2 /> Delete project
                </Button>
                <Button
                  className="sb-primary"
                  onClick={() => setSettingsOpen(false)}
                >
                  Done
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="sb-dialog sb-history-dialog">
          <DialogHeader>
            <DialogTitle>Image versions</DialogTitle>
            <DialogDescription>
              Choose the image used in this panel. Your written direction stays
              unchanged.
            </DialogDescription>
          </DialogHeader>
          <div className="sb-version-list">
            {panel &&
              [...panel.versions].reverse().map((version) => (
                <div
                  className={`sb-version-card ${version.id === panel.selectedVersionId ? 'is-selected' : ''}`}
                  key={version.id}
                >
                  <button
                    className="sb-version-preview"
                    aria-label={`Use ${version.label}`}
                    onClick={() =>
                      updatePanel({ selectedVersionId: version.id })
                    }
                  >
                    <img src={version.dataUrl} alt={version.label} />
                  </button>
                  <div className="sb-version-info">
                    <strong>{version.label}</strong>
                    <small>
                      {new Date(version.createdAt).toLocaleString()}
                    </small>
                    {version.id === panel.selectedVersionId ? (
                      <span className="sb-selected-label">
                        <Check size={14} /> Selected
                      </span>
                    ) : (
                      <Button
                        variant="outline"
                        onClick={() =>
                          updatePanel({ selectedVersionId: version.id })
                        }
                      >
                        Use this version
                      </Button>
                    )}
                  </div>
                  <div className="sb-version-actions">
                    <IconButton
                      label={`Download ${version.label}`}
                      onClick={() =>
                        downloadUrl(
                          version.dataUrl,
                          version.label || 'panel.png',
                        )
                      }
                    >
                      <Download />
                    </IconButton>
                    <IconButton
                      label={`Delete version ${version.label}`}
                      danger
                      onClick={() => {
                        const remaining = panel.versions.filter(
                          (item) => item.id !== version.id,
                        );
                        updatePanel({
                          versions: remaining,
                          selectedVersionId:
                            panel.selectedVersionId === version.id
                              ? (remaining.at(-1)?.id ?? null)
                              : panel.selectedVersionId,
                        });
                      }}
                    >
                      <Trash2 />
                    </IconButton>
                  </div>
                </div>
              ))}
          </div>
          {!panel?.versions.length && (
            <p className="sb-hint">No image versions yet.</p>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(deleteRequest)}
        onOpenChange={(open) => {
          if (!open) setDeleteRequest(null);
        }}
      >
        <AlertDialogContent className="sb-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{deleteRequest?.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteRequest?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="sb-dialog-actions">
            <Button variant="outline" onClick={() => setDeleteRequest(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                deleteRequest?.run();
                setDeleteRequest(null);
              }}
            >
              Delete
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={pdfOpen} onOpenChange={setPdfOpen}>
        <DialogContent className="sb-dialog sb-pdf-dialog">
          <DialogHeader>
            <DialogTitle>Storyboard preview</DialogTitle>
            <DialogDescription>
              {pdfName} · A4 portrait · current snapshot
            </DialogDescription>
          </DialogHeader>
          <div className="sb-pdf-toolbar">
            <Button
              variant="outline"
              onClick={() =>
                window.open(pdfUrl, '_blank', 'noopener,noreferrer')
              }
            >
              <Eye /> Open in new tab
            </Button>
            <Button
              className="sb-primary"
              onClick={() => downloadUrl(pdfUrl, pdfName)}
            >
              <Download /> Download PDF
            </Button>
          </div>
          {pdfUrl && (
            <iframe
              src={pdfUrl}
              title="Storyboard PDF preview"
              className="sb-pdf-frame"
            />
          )}
          <p className="sb-hint">
            If your browser cannot display PDFs here, use Open in new tab or
            Download PDF.
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}
