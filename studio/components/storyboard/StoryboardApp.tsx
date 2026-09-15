'use client';

/* oxlint-disable next/no-img-element -- Local data URLs are portable project artwork; routing them through a server image optimiser would break offline use. */

import {
  useCallback,
  useEffect,
  Fragment,
  useRef,
  useState,
  lazy,
  Suspense,
} from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Copy,
  Download,
  Eye,
  FileDown,
  Film,
  FolderOpen,
  GripVertical,
  ImagePlus,
  Layers3,
  Library,
  Loader2,
  Plus,
  Save,
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
  DEFAULT_IMAGE_TRANSFORM,
  getPanelConnection,
  getShotConnection,
  materializePanelConnections,
  materializeShotConnections,
  getPanelDetails,
  getSelectedImage,
  newId,
  PANEL_CONNECTION_TYPES,
  reorderPanels,
  reorderShots,
  setPanelConnection,
  setShotConnection,
  SHOT_CONNECTION_TYPES,
  splitShotAfterPanel,
  type Panel,
  type ImageTransform,
  type ReferenceAsset,
  type ReferenceKind,
  type Shot,
  type StoryProject,
  type TimelineConnection,
} from '@/lib/storyboard/model';
import {
  createProjectBackup,
  imageFileToDataUrl,
  getProjectBudget,
  importProject,
} from '@/lib/storyboard/storage';
import {
  buildPanelPrompt,
  buildRevisionPrompt,
} from '@/lib/storyboard/prompts';
import {
  ROUGH_BLOCKING_STYLE,
  ROUGH_BLOCKING_STYLE_NOTES,
} from '@/lib/storyboard/style';
import { useStoryboardTools } from '@/lib/use-storyboard-tools';
import { Field, IconButton } from './EditorControls';
import ProjectSettings from './ProjectSettings';
import WorkspaceNavigation from './WorkspaceNavigation';
import FolderLocationField from './FolderLocationField';
import {
  hasImageFraming,
  renderImageFrame,
} from '@/lib/storyboard/render-image-frame';
import { useStoryboardProjects } from './useStoryboardProjects';
import { useDownload } from './useDownload';
import ReferenceLibrary from './ReferenceLibrary';
import ShotReferences from './ShotReferences';
import GenerationPanel from './GenerationPanel';
import { useOpenAiGeneration } from './useOpenAiGeneration';
import { prepareGenerationImages } from './generationInputs';
import type {
  GenerationPreset,
  GenerationRequest,
  GenerationResult,
} from '@/lib/generation/types';
import {
  getPreviousPanelCandidates,
  resolvePreviousPanelReferences,
  resolvePanelReferences,
  referenceDisplayName,
} from '@/lib/storyboard/references';
import {
  formatMovementLabel,
  formatPanelCode,
  formatPanelLetter,
  formatShotCode,
} from '@/lib/storyboard/labels';
import PreviousPanelReferences from './PreviousPanelReferences';
import FrameArtwork from './FrameArtwork';
import ImageFramingControls from './ImageFramingControls';
import type { StoryboardPdfLayout } from '@/lib/pdf/export';
import './storyboard.css';

const PdfPreview = lazy(() => import('./PdfPreview'));
function readEditorSession<T extends object>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const value = JSON.parse(window.sessionStorage.getItem(key) ?? 'null');
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value
      : fallback;
  } catch {
    return fallback;
  }
}

type Selection = {
  projectId: string;
  sceneId: string;
  shotId: string;
  panelId: string;
};
type DeleteRequest = {
  confirmLabel?: string;
  title: string;
  description: string;
  run: () => void;
};
type ConnectionDraft = {
  kind: 'shot' | 'panel';
  projectId: string;
  sceneId: string;
  shotId: string;
  fromId: string;
  toId: string;
  fromTitle: string;
  toTitle: string;
  type: string;
  description: string;
  movement: string;
  movementDescription: string;
};
const imageAccept = 'image/png,image/jpeg,image/webp,image/gif,image/avif';
const panelFramingOptions = [
  'Extreme wide',
  'Wide',
  'Full',
  'Medium wide',
  'Medium',
  'Medium close-up',
  'Close-up',
  'Extreme close-up',
  'Aerial',
  'Over the shoulder',
  'POV',
] as const;
const panelAngleOptions = [
  'Eye level',
  'Low angle',
  'High angle',
  'Overhead',
  'Dutch angle',
] as const;
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
  project.style = ROUGH_BLOCKING_STYLE;
  project.styleNotes = ROUGH_BLOCKING_STYLE_NOTES;
  const scene = createScene('Opening sequence');
  const island = createShot('The island');
  island.description =
    'Aerial of a small island in a vast ocean, flying through wispy clouds.';
  island.camera = 'Flying through wispy clouds.';
  const islandPanel = createPanel('The island');
  islandPanel.framing = 'Aerial';
  islandPanel.description =
    'A small island in a vast ocean, seen through wispy clouds.';
  islandPanel.context = island.description;
  islandPanel.camera = island.camera;
  island.panels = [islandPanel];
  const matilda = createShot('Matilda smiles');
  matilda.description =
    'Mid on Matilda, middle of frame, dollying into closeup as she smiles.';
  matilda.camera = 'Dolly forward from a medium shot to a close-up.';
  const start = createPanel('Start frame');
  start.framing = 'Medium';
  start.description = 'Matilda, centred in the frame.';
  start.context = matilda.description;
  start.camera = matilda.camera;
  const end = createPanel('End frame');
  end.framing = 'Close-up';
  end.description = 'Matilda, centred in the frame, smiling.';
  end.context = matilda.description;
  end.camera = matilda.camera;
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

function fileName(value: string) {
  return value.replace(/[^a-z0-9 _.-]/gi, '').trim() || 'storyboard';
}

function PanelDetailChoice({
  scopeKey,
  label,
  value,
  options,
  onChange,
  id,
  'aria-describedby': describedBy,
}: {
  scopeKey: string;
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
  id?: string;
  'aria-describedby'?: string;
}) {
  const isCustomValue = value !== '' && !options.includes(value);
  const [editingCustom, setEditingCustom] = useState(isCustomValue);
  const [customDraft, setCustomDraft] = useState(isCustomValue ? value : '');
  const previousScope = useRef(scopeKey);
  const localChange = useRef<string | null>(null);
  let customOptionValue = '__custom-panel-detail__';
  while (customOptionValue === value || options.includes(customOptionValue))
    customOptionValue += '_';

  useEffect(() => {
    if (previousScope.current !== scopeKey) {
      previousScope.current = scopeKey;
      localChange.current = null;
      setEditingCustom(isCustomValue);
      setCustomDraft(isCustomValue ? value : '');
      return;
    }
    if (localChange.current === value) {
      localChange.current = null;
      return;
    }
    setEditingCustom(isCustomValue);
    setCustomDraft(isCustomValue ? value : '');
  }, [isCustomValue, scopeKey, value]);

  const commit = (nextValue: string) => {
    localChange.current = nextValue;
    onChange(nextValue);
  };

  return (
    <div className="sb-panel-detail-choice">
      <NativeSelect
        id={id}
        aria-describedby={describedBy}
        value={editingCustom ? customOptionValue : value}
        onChange={(event) => {
          const nextValue = event.target.value;
          if (nextValue === customOptionValue) {
            setEditingCustom(true);
            setCustomDraft(value);
            return;
          }
          setEditingCustom(false);
          setCustomDraft('');
          commit(nextValue);
        }}
      >
        <option value="">Not set</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
        <option value={customOptionValue}>Custom value…</option>
      </NativeSelect>
      {editingCustom && (
        <Input
          aria-label={`Custom ${label.toLowerCase()}`}
          value={customDraft}
          placeholder={`Enter custom ${label.toLowerCase()}`}
          onChange={(event) => {
            const nextValue = event.target.value;
            setCustomDraft(nextValue);
            commit(nextValue);
          }}
        />
      )}
    </div>
  );
}

function connectionLabel(value: TimelineConnection, kind: 'shot' | 'panel') {
  const labels: string[] = [];
  if (kind === 'shot' && value.type !== 'cut')
    labels.push(value.type.replace('-', ' '));
  if (kind === 'panel' && value.type !== 'static')
    labels.push(formatMovementLabel(value.type));
  if (kind === 'shot' && value.movement && value.movement !== 'static')
    labels.push(formatMovementLabel(value.movement));
  if (!labels.length && value.description.trim())
    labels.push(kind === 'shot' ? 'cut cue' : 'movement note');
  if (!labels.length && value.movementDescription?.trim())
    labels.push('movement note');
  return labels.length ? labels.join(' + ') : '';
}

function ConnectionButton({
  connection,
  kind,
  fromTitle,
  toTitle,
  onClick,
}: {
  connection: TimelineConnection;
  kind: 'shot' | 'panel';
  fromTitle: string;
  toTitle: string;
  onClick: () => void;
}) {
  const label = connectionLabel(connection, kind);
  return (
    <button
      type="button"
      className={`sb-connection ${label ? 'is-authored' : ''}`}
      aria-label={`Edit ${kind === 'shot' ? 'transition and camera movement' : 'camera movement'} from ${fromTitle} to ${toTitle}`}
      title={
        [label, connection.description, connection.movementDescription]
          .filter(Boolean)
          .join(' · ') ||
        `Add ${kind === 'shot' ? 'transition or movement' : 'camera movement'}`
      }
      onClick={onClick}
    >
      <span aria-hidden="true">{label ? '→' : '+'}</span>
      {label ? <strong>{label}</strong> : null}
    </button>
  );
}

export default function StoryboardApp() {
  const [selection, setSelection] = useState<Selection>(() =>
    readEditorSession('storyboard-selection', {
      projectId: '',
      sceneId: '',
      shotId: '',
      panelId: '',
    }),
  );
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(0);
  const [tab, setTab] = useState('direction');
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newFolder, setNewFolder] = useState('');
  const [folderAction, setFolderAction] = useState<'open' | 'attach' | null>(
    null,
  );
  const [folderPathDraft, setFolderPathDraft] = useState('');
  const [folderBusy, setFolderBusy] = useState(false);
  const folderBusyRef = useRef(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [packBusy, setPackBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [deleteRequest, setDeleteRequest] = useState<DeleteRequest | null>(
    null,
  );
  const [connectionDraft, setConnectionDraft] =
    useState<ConnectionDraft | null>(null);
  const [dragItem, setDragItem] = useState<{
    kind: 'shot' | 'panel';
    id: string;
  } | null>(null);
  const [dropTarget, setDropTarget] = useState<string>('');
  const [panelDetailResetVersions, setPanelDetailResetVersions] = useState<
    Record<string, number>
  >({});
  const [revisionDrafts, setRevisionDrafts] = useState<Record<string, string>>(
    () => {
      const drafts = readEditorSession<Record<string, string>>(
        'storyboard-revision-drafts',
        {},
      );
      const previous = readEditorSession<Partial<Selection>>(
        'storyboard-selection',
        {},
      );
      return Object.fromEntries(
        Object.entries(drafts).flatMap(([key, value]) =>
          key.includes(':')
            ? [[key, value]]
            : previous.projectId
              ? [[`${previous.projectId}:${key}`, value]]
              : [],
        ),
      );
    },
  );
  const refKind: ReferenceKind = 'character';
  const [dragging, setDragging] = useState(false);
  const [guidesVisible, setGuidesVisible] = useState(true);
  const [pdfScope, setPdfScope] = useState('scene');
  const [pdfOpen, setPdfOpen] = useState(false);
  const [pdfUrl, setPdfUrl] = useState('');
  const [pdfName, setPdfName] = useState('storyboard.pdf');
  const [pdfBusy, setPdfBusy] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const backupBusyRef = useRef(false);
  const [pdfIncludeNotes, setPdfIncludeNotes] = useState(false);
  const [pdfIncludeCover, setPdfIncludeCover] = useState(true);
  const [pdfSceneBreaks, setPdfSceneBreaks] =
    useState<'flow' | 'page'>('flow');
  const [pdfLayout, setPdfLayout] =
    useState<StoryboardPdfLayout>('portrait-2up');
  const [pdfError, setPdfError] = useState('');
  const { download, downloadDialog } = useDownload();
  const imageInput = useRef<HTMLInputElement>(null);
  const referenceInput = useRef<HTMLInputElement>(null);
  const backupInput = useRef<HTMLInputElement>(null);
  const pdfUrlRef = useRef('');

  const {
    projects,
    budgets,
    getProjects,
    hasProjectConflict,
    replaceProjects,
    editProject,
    undoProject,
    undoCounts,
    removeProject,
    reloadProject,
    loadState,
    saveState,
    persistenceError,
    diagnostics,
    createdDemo,
    retryLoad,
    retrySave,
    dismissPersistenceError,
    folderBindings,
    createFolderProject,
    attachProjectToFolder,
    openFolderProject,
    saveNow,
  } = useStoryboardProjects(starterProject);
  const generation = useOpenAiGeneration();
  const [generationPreparing, setGenerationPreparing] = useState(false);
  const generationPreparingRef = useRef(false);
  const loaded = loadState === 'ready';
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
  useEffect(() => {
    try {
      window.sessionStorage.setItem(
        'storyboard-revision-drafts',
        JSON.stringify(revisionDrafts),
      );
    } catch {
      /* Drafts remain available in this tab if session storage is disabled. */
    }
  }, [revisionDrafts]);

  const project =
    projects.find((item) => item.id === selection.projectId) ?? projects[0];
  useEffect(() => {
    const projectId = project?.id;
    const handleSave = (event: KeyboardEvent) => {
      if (
        !projectId ||
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== 's'
      )
        return;
      event.preventDefault();
      void saveNow(projectId).then((saved) => {
        if (saved) setNotice('Project saved');
      });
    };
    window.addEventListener('keydown', handleSave);
    return () => window.removeEventListener('keydown', handleSave);
  }, [project?.id, saveNow]);
  const scene =
    project?.scenes.find((item) => item.id === selection.sceneId) ??
    project?.scenes[0];
  const shot =
    scene?.shots.find((item) => item.id === selection.shotId) ??
    (createdDemo && !selection.projectId
      ? (scene?.shots[1] ?? scene?.shots[0])
      : scene?.shots[0]);
  const panel =
    shot?.panels.find((item) => item.id === selection.panelId) ??
    shot?.panels[0];
  const sceneIndex =
    project?.scenes.findIndex((item) => item.id === scene?.id) ?? 0;
  const shotIndex = scene?.shots.findIndex((item) => item.id === shot?.id) ?? 0;
  const panelIndex =
    shot?.panels.findIndex((item) => item.id === panel?.id) ?? 0;
  const image = panel ? getSelectedImage(panel) : undefined;
  const revisionKey = project && panel ? `${project.id}:${panel.id}` : '';
  const revision = revisionDrafts[revisionKey] ?? '';
  const setRevision = (value: string) => {
    if (revisionKey)
      setRevisionDrafts((drafts) => ({ ...drafts, [revisionKey]: value }));
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
      return editProject(
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
      return editShotAt(
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
  useEffect(() => {
    if (!loaded || !target.projectId) return;
    try {
      window.sessionStorage.setItem(
        'storyboard-selection',
        JSON.stringify({
          projectId: target.projectId,
          sceneId: target.sceneId,
          shotId: target.shotId,
          panelId: target.panelId,
        }),
      );
    } catch {
      /* The editor remains usable without session storage. */
    }
  }, [loaded, target.projectId, target.sceneId, target.shotId, target.panelId]);
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
  const updateImageTransform = (
    transform: ImageTransform,
    historyKey: string,
  ) => {
    if (!image) return;
    const imageId = image.id;
    editPanelAt(
      target,
      (current) => ({
        ...current,
        versions: current.versions.map((version) =>
          version.id === imageId ? { ...version, transform } : version,
        ),
      }),
      `image:${imageId}:${historyKey}`,
    );
  };
  const editPanelStructure = (change: (value: Shot) => Shot) =>
    editProject(target.projectId, (current) => ({
      ...current,
      scenes: current.scenes.map((item) => {
        if (item.id !== target.sceneId) return item;
        const frozen = materializeShotConnections(item);
        return {
          ...frozen,
          shots: frozen.shots.map((value) =>
            value.id === target.shotId
              ? change(materializePanelConnections(value))
              : value,
          ),
        };
      }),
    }));

  function chooseShot(value: Shot) {
    setSelection({
      ...target,
      shotId: value.id,
      panelId: value.panels[0]?.id ?? '',
    });
  }
  async function addProject() {
    if (!loaded) {
      setError('Open the local workspace before creating a project.');
      return;
    }
    if (folderBusyRef.current) return;
    folderBusyRef.current = true;
    setFolderBusy(true);
    try {
      let created = createProject(newName.trim() || 'Untitled project');
      if (newFolder.trim()) {
        const saved = await createFolderProject(created, newFolder.trim());
        if (!saved) return;
        created = saved;
      } else replaceProjects([...getProjects(), created]);
      setSelection(initialSelection(created));
      setNewName('');
      setNewFolder('');
      setNewProjectOpen(false);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      folderBusyRef.current = false;
      setFolderBusy(false);
    }
  }
  function beginFolderAction(action: 'open' | 'attach') {
    setSettingsOpen(false);
    setFolderPathDraft('');
    setFolderAction(action);
  }
  async function completeFolderAction() {
    if (!folderPathDraft.trim() || folderBusyRef.current) return;
    folderBusyRef.current = true;
    setFolderBusy(true);
    try {
      if (folderAction === 'open') {
        const opened = await openFolderProject(folderPathDraft.trim());
        if (!opened) return;
        setSelection(initialSelection(opened));
      } else if (project) {
        if (!(await attachProjectToFolder(project.id, folderPathDraft.trim())))
          return;
      } else return;
      setFolderAction(null);
      setNotice(
        folderAction === 'open'
          ? 'Project opened from its folder'
          : 'Project and artwork saved to folder',
      );
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      folderBusyRef.current = false;
      setFolderBusy(false);
    }
  }
  async function saveCurrentProject() {
    if (!project || folderBusyRef.current) return;
    folderBusyRef.current = true;
    setFolderBusy(true);
    try {
      if (await saveNow(project.id)) setNotice('Project saved');
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      folderBusyRef.current = false;
      setFolderBusy(false);
    }
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
      scenes: current.scenes.map((item) => {
        if (item.id !== scene.id) return item;
        const frozen = materializeShotConnections(item);
        return { ...frozen, shots: [...frozen.shots, created] };
      }),
    }));
    chooseShot(created);
  }
  function addPanel() {
    if (!shot) return;
    const created = createPanel(`Panel ${shot.panels.length + 1}`);
    editProject(target.projectId, (current) => ({
      ...current,
      scenes: current.scenes.map((item) => {
        if (item.id !== target.sceneId) return item;
        const frozen = materializeShotConnections(item);
        return {
          ...frozen,
          shots: frozen.shots.map((value) => {
            if (value.id !== target.shotId) return value;
            const frozenShot = materializePanelConnections(value);
            return { ...frozenShot, panels: [...frozenShot.panels, created] };
          }),
        };
      }),
    }));
    setSelection({ ...target, panelId: created.id });
  }
  function requestDeletePanel() {
    if (!shot || !panel) return;
    const selectedPanelId = panel.id;
    const selectedPanelName = panel.title || `Panel ${panelIndex + 1}`;
    const nextPanelId =
      shot.panels[panelIndex + 1]?.id ?? shot.panels[panelIndex - 1]?.id ?? '';
    setDeleteRequest({
      title: `Delete “${selectedPanelName}”?`,
      description:
        'This selected panel, its creative details, and image versions will be removed. Undo is available.',
      run: () => {
        const applied = editPanelStructure((current) => ({
          ...current,
          panels: current.panels.filter((item) => item.id !== selectedPanelId),
          panelConnections: current.panelConnections?.filter(
            (item) =>
              item.fromId !== selectedPanelId && item.toId !== selectedPanelId,
          ),
        }));
        if (applied) setSelection({ ...target, panelId: nextPanelId });
      },
    });
  }
  function startNewShotAfterPanel() {
    if (
      !project ||
      !scene ||
      !shot ||
      !panel ||
      panelIndex === shot.panels.length - 1
    )
      return;
    const applied = editProject(project.id, (current) => ({
      ...current,
      scenes: current.scenes.map((item) =>
        item.id === scene.id
          ? splitShotAfterPanel(item, shot.id, panel.id)
          : item,
      ),
    }));
    if (applied) setNotice('New shot started after this panel');
  }
  function openShotConnection(from: Shot, to: Shot) {
    if (!scene) return;
    const value = getShotConnection(scene, from.id, to.id);
    setConnectionDraft({
      kind: 'shot',
      projectId: project?.id ?? '',
      sceneId: scene.id,
      shotId: '',
      fromId: from.id,
      toId: to.id,
      fromTitle: from.title || 'Untitled shot',
      toTitle: to.title || 'Untitled shot',
      type: value.type,
      description: value.description,
      movement: value.movement ?? 'static',
      movementDescription: value.movementDescription ?? '',
    });
  }
  function openPanelConnection(from: Panel, to: Panel) {
    if (!shot) return;
    const value = getPanelConnection(shot, from.id, to.id);
    setConnectionDraft({
      kind: 'panel',
      projectId: project?.id ?? '',
      sceneId: scene?.id ?? '',
      shotId: shot.id,
      fromId: from.id,
      toId: to.id,
      fromTitle: from.title || 'Untitled panel',
      toTitle: to.title || 'Untitled panel',
      type: value.type,
      description: value.description,
      movement: 'static',
      movementDescription: '',
    });
  }
  function saveConnection() {
    if (!connectionDraft) return;
    const ownerProject = getProjects().find(
      (item) => item.id === connectionDraft.projectId,
    );
    const ownerScene = ownerProject?.scenes.find(
      (item) => item.id === connectionDraft.sceneId,
    );
    const ownerShot = ownerScene?.shots.find(
      (item) => item.id === connectionDraft.shotId,
    );
    const endpoints =
      connectionDraft.kind === 'shot' ? ownerScene?.shots : ownerShot?.panels;
    const fromIndex =
      endpoints?.findIndex((item) => item.id === connectionDraft.fromId) ?? -1;
    const toIndex =
      endpoints?.findIndex((item) => item.id === connectionDraft.toId) ?? -1;
    if (
      !ownerProject ||
      !ownerScene ||
      fromIndex < 0 ||
      toIndex !== fromIndex + 1
    ) {
      setConnectionDraft(null);
      setError('That timeline boundary changed. Open its connector again.');
      return;
    }
    const connection: TimelineConnection = {
      fromId: connectionDraft.fromId,
      toId: connectionDraft.toId,
      type: connectionDraft.type,
      description: connectionDraft.description,
      ...(connectionDraft.kind === 'shot'
        ? {
            movement: connectionDraft.movement,
            movementDescription: connectionDraft.movementDescription,
          }
        : {}),
    };
    if (connectionDraft.kind === 'shot') {
      const applied = editProject(ownerProject.id, (current) => ({
        ...current,
        scenes: current.scenes.map((item) =>
          item.id === ownerScene.id
            ? setShotConnection(item, connection)
            : item,
        ),
      }));
      if (!applied) return;
    } else {
      if (!ownerShot) return;
      const applied = editShotAt(
        ownerProject.id,
        ownerScene.id,
        ownerShot.id,
        (current) => setPanelConnection(current, connection),
      );
      if (!applied) return;
    }
    setConnectionDraft(null);
    setNotice('Timeline connection saved');
  }
  function dropReorder(kind: 'shot' | 'panel', toId: string) {
    if (!dragItem || dragItem.kind !== kind || dragItem.id === toId) return;
    if (kind === 'shot' && project && scene) {
      const applied = editProject(project.id, (current) => ({
        ...current,
        scenes: current.scenes.map((item) =>
          item.id === scene.id ? reorderShots(item, dragItem.id, toId) : item,
        ),
      }));
      if (applied)
        setNotice('Order updated · connections stay with their original pairs');
    } else if (kind === 'panel' && project && scene && shot) {
      const applied = editPanelStructure((current) =>
        reorderPanels(current, dragItem.id, toId),
      );
      if (applied)
        setNotice('Order updated · connections stay with their original pairs');
    }
    setDropTarget('');
    setDragItem(null);
  }
  function undo() {
    if (project && undoProject(project.id)) setNotice('Last change undone');
  }
  async function backupCurrent(value = project) {
    if (!value || backupBusyRef.current) return;
    backupBusyRef.current = true;
    setBackupBusy(true);
    try {
      const artifact = await createProjectBackup(value);
      download(artifact.blob, artifact.filename);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      backupBusyRef.current = false;
      setBackupBusy(false);
    }
  }
  function deleteCurrentScene() {
    if (!project || !scene) return;
    setSettingsOpen(false);
    setDeleteRequest({
      title: 'Delete this scene?',
      description:
        'All shots and panels in this scene will be removed. You can undo this change.',
      run: () =>
        editProject(project.id, (current) => ({
          ...current,
          scenes: current.scenes.filter((item) => item.id !== scene.id),
        })),
    });
  }
  function deleteCurrentProject() {
    if (!project) return;
    setSettingsOpen(false);
    setDeleteRequest({
      title: `${folderBindings[project.id] ? 'Close' : 'Delete'} “${project.name || 'Untitled project'}”?`,
      confirmLabel: folderBindings[project.id] ? 'Close project' : 'Delete',
      description: folderBindings[project.id]
        ? 'This removes the project from the workspace. Its folder, project file and images stay on disk, ready to open again.'
        : 'This removes the project and its artwork from this browser. Download a backup first. Project deletion cannot be undone.',
      run: () => {
        void removeProject(project.id).then((removed) => {
          if (removed)
            setNotice(
              folderBindings[project.id]
                ? 'Project closed · folder kept'
                : 'Project deleted',
            );
        });
      },
    });
  }
  function preflightFiles(files: File[], projectId: string) {
    const destination = getProjects().find((item) => item.id === projectId);
    if (!destination)
      throw new Error('Select an existing project before importing artwork.');
    if (folderBindings[projectId]) return;
    const budget = getProjectBudget(destination);
    const incomingBytes = files.reduce(
      (sum, file) =>
        sum + 4 * Math.ceil(file.size / 3) + 2048 + file.name.length * 3,
      0,
    );
    if (budget.bytes + incomingBytes > budget.limitBytes)
      throw new Error(
        'These files would exceed this project’s working capacity. Choose fewer images or remove unused image versions first. Your existing work is unchanged.',
      );
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
      preflightFiles([file], destination.projectId);
      const dataUrl = await imageFileToDataUrl(file);
      const version = {
        id: newId(),
        dataUrl,
        createdAt: new Date().toISOString(),
        label: file.name,
        transform: { ...DEFAULT_IMAGE_TRANSFORM },
      };
      const exists = getProjects()
        .find((item) => item.id === destination.projectId)
        ?.scenes.find((item) => item.id === destination.sceneId)
        ?.shots.find((item) => item.id === destination.shotId)
        ?.panels.some((item) => item.id === destination.panelId);
      if (!exists)
        throw new Error(
          'The destination panel was removed while the image was loading. Add the image to another panel.',
        );
      const applied = editPanelAt(destination, (current) => ({
        ...current,
        versions: [...current.versions, version],
        selectedVersionId: version.id,
      }));
      if (applied) setNotice('Image added · previous versions kept');
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy((count) => count - 1);
    }
  }

  async function chooseCoverImage(file: File, projectId: string) {
    setBusy((count) => count + 1);
    try {
      preflightFiles([file], projectId);
      const dataUrl = await imageFileToDataUrl(file);
      const applied = editProject(projectId, (current) => ({
        ...current,
        coverImage: {
          dataUrl,
          mimeType: file.type.toLowerCase(),
          label: file.name,
        },
      }));
      if (applied) setNotice('Cover image set');
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy((count) => count - 1);
    }
  }

  async function addReferences(
    files: FileList | File[] | null,
    options: { library?: boolean; groupId?: string; kind?: ReferenceKind } = {},
  ) {
    if (!files?.length || !project) return;
    const destination = { ...target };
    const kind = options.kind ?? refKind;
    setBusy((count) => count + 1);
    try {
      const selectedFiles = Array.from(files);
      preflightFiles(selectedFiles, destination.projectId);
      const results: PromiseSettledResult<ReferenceAsset>[] = [];
      for (const file of selectedFiles) {
        try {
          results.push({
            status: 'fulfilled',
            value: {
              id: newId(),
              name: file.name.replace(/\.[^.]+$/, ''),
              kind,
              dataUrl: await imageFileToDataUrl(file),
              mimeType: file.type,
              ...(options.groupId
                ? {
                    groupId: options.groupId,
                    viewLabel: file.name.replace(/\.[^.]+$/, ''),
                  }
                : {}),
            },
          });
        } catch (reason) {
          results.push({ status: 'rejected', reason });
        }
      }
      const added = results.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : [],
      );
      const failures = results.filter((result) => result.status === 'rejected');
      if (added.length) {
        const currentDestination = getProjects().find(
          (item) => item.id === destination.projectId,
        );
        if (
          !currentDestination ||
          (options.groupId &&
            !currentDestination.referenceGroups?.some(
              (group) => group.id === options.groupId,
            ))
        )
          throw new Error(
            'The destination library entry was removed while artwork was loading. Select an existing entry and upload again.',
          );
        const destinationShot = currentDestination.scenes
          .find((item) => item.id === destination.sceneId)
          ?.shots.find((item) => item.id === destination.shotId);
        if (
          !options.library &&
          !destinationShot?.panels.some(
            (item) => item.id === destination.panelId,
          )
        )
          throw new Error(
            'The destination panel was removed while references were loading. Select another panel and upload again.',
          );
        const applied = editProject(destination.projectId, (current) => ({
          ...current,
          references: [...current.references, ...added],
          scenes: options.library
            ? current.scenes
            : current.scenes.map((item) =>
                item.id === destination.sceneId
                  ? {
                      ...item,
                      shots: item.shots.map((value) => {
                        if (value.id !== destination.shotId) return value;
                        return {
                          ...value,
                          panels: value.panels.map((candidate) => {
                            if (candidate.id !== destination.panelId)
                              return candidate;
                            return {
                              ...candidate,
                              referenceIds: [
                                ...(candidate.referenceIds ??
                                  value.referenceIds),
                                ...added.map((ref) => ref.id),
                              ],
                              referenceGroupIds:
                                candidate.referenceGroupIds ??
                                value.referenceGroupIds ??
                                [],
                            };
                          }),
                        };
                      }),
                    }
                  : item,
              ),
        }));
        if (applied)
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
      if (getProjects().some((item) => item.id === restored.id)) {
        restored.name = `${restored.name} (imported)`;
      }
      restored.id = newId();
      replaceProjects([...getProjects(), restored]);
      setSelection(initialSelection(restored));
      setNotice('Project imported with its artwork');
    } catch (cause) {
      setError(`Could not import this backup. ${messageOf(cause)}`);
    } finally {
      setBusy((count) => count - 1);
    }
  }

  function receiveGeneratedImage(
    result: GenerationResult,
    request: GenerationRequest,
  ) {
    if (!result.image) return;
    const destination = request.origin;
    const filename = `generated-${destination.panelId.slice(0, 8)}.${imageExtension(result.image.mimeType)}`;
    const current = getProjects().find(
      (item) => item.id === destination.projectId,
    );
    const originalPanel = current?.scenes
      .find((item) => item.id === destination.sceneId)
      ?.shots.find((item) => item.id === destination.shotId)
      ?.panels.find((item) => item.id === destination.panelId);
    if (!originalPanel || hasProjectConflict(destination.projectId)) {
      setError(
        'Your generated image is ready, but its original panel was removed or the project has a save conflict. Download the image to keep it, then import it into the panel you choose.',
      );
      download(result.image.dataUrl, filename);
      return;
    }
    const version = {
      id: newId(),
      dataUrl: result.image.dataUrl,
      label: `AI ${request.mode === 'revision' ? 'revision' : 'image'} · ${request.preset.quality}`,
      createdAt: new Date().toISOString(),
      prompt: request.prompt,
      transform: { ...DEFAULT_IMAGE_TRANSFORM },
    };
    const applied = editPanelAt(destination, (currentPanel) => ({
      ...currentPanel,
      versions: [...currentPanel.versions, version],
      selectedVersionId: version.id,
    }));
    if (applied)
      setNotice(
        'Generated image added to its original panel · earlier versions kept',
      );
    else {
      setError(
        'The generated image could not be added within this project’s working capacity. Download it now to keep it, then free space and import it.',
      );
      download(result.image.dataUrl, filename);
    }
  }

  async function generateImage(
    mode: GenerationRequest['mode'],
    preset: GenerationPreset,
  ) {
    if (
      !project ||
      !scene ||
      !shot ||
      !panel ||
      generationPreparingRef.current ||
      generation.pending
    )
      return;
    const origin = { ...target };
    const sourceImage = image;
    const requestPrompt =
      mode === 'revision'
        ? buildRevisionPrompt(project, scene, shot, panel, revision, {
            attachmentMode: 'api',
          })
        : buildPanelPrompt(project, scene, shot, panel, {
            attachmentMode: 'api',
          });
    const references = resolvePanelReferences(project, shot, panel).map(
      (ref) => ({
        id: ref.id,
        name: referenceDisplayName(project, ref),
        mimeType: ref.mimeType,
        dataUrl: ref.dataUrl,
      }),
    );
    if (mode === 'revision' && (!sourceImage || !revision.trim())) return;
    const previous = resolvePreviousPanelReferences(scene, panel);
    if (previous.missing.length) {
      setError(
        'Remove the missing previous-panel reference before generating. No paid request was sent.',
      );
      return;
    }
    const imageCount =
      references.length +
      previous.references.length +
      (mode === 'revision' ? 1 : 0);
    if (imageCount > 10) {
      setError(
        'OpenAI accepts at most 10 input images here. Remove references before generating. No paid request was sent.',
      );
      return;
    }
    generationPreparingRef.current = true;
    setGenerationPreparing(true);
    try {
      if (hasProjectConflict(origin.projectId))
        throw new Error(
          'Resolve this project’s save conflict before generating.',
        );
      const framedReferences = [...references];
      for (const reference of previous.references) {
        const dataUrl = await renderImageFrame(
          reference.dataUrl,
          project.aspectRatio,
          reference.transform,
        );
        framedReferences.push({
          id: reference.imageVersionId,
          name:
            dataUrl === reference.dataUrl
              ? reference.label.slice(0, 160)
              : `${reference.label.slice(0, 145)}-framed.png`,
          dataUrl,
          mimeType: dataUrl.match(/^data:([^;,]+)/)?.[1] ?? reference.mimeType,
        });
      }
      const prepared = await prepareGenerationImages(framedReferences);
      const currentDataUrl =
        mode === 'revision' && sourceImage
          ? await renderImageFrame(
              sourceImage.dataUrl,
              project.aspectRatio,
              sourceImage.transform,
            )
          : undefined;
      const currentImage =
        mode === 'revision' && sourceImage && currentDataUrl
          ? (
              await prepareGenerationImages([
                {
                  id: sourceImage.id,
                  name:
                    currentDataUrl === sourceImage.dataUrl
                      ? sourceImage.label || 'Current panel'
                      : `${(sourceImage.label || 'Current panel').slice(0, 145)}-framed.png`,
                  mimeType:
                    currentDataUrl.match(/^data:([^;,]+)/)?.[1] ?? 'image/png',
                  dataUrl: currentDataUrl,
                },
              ])
            )[0]
          : undefined;
      const request: GenerationRequest = {
        requestId: newId(),
        origin,
        prompt: requestPrompt,
        mode,
        preset,
        references: prepared,
        ...(currentImage ? { currentImage } : {}),
      };
      if (new Blob([JSON.stringify(request)]).size > 20 * 1024 * 1024)
        throw new Error(
          'This request exceeds the 20 MB app upload limit. Choose fewer reference views or upload smaller copies before generating. No paid request was sent.',
        );
      await generation.generate(request, receiveGeneratedImage);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      generationPreparingRef.current = false;
      setGenerationPreparing(false);
    }
  }

  async function recoverGeneration(requestId: string) {
    const result = await generation.recover(requestId);
    if (result?.image)
      download(
        result.image.dataUrl,
        `recovered-${requestId.slice(0, 8)}.${imageExtension(result.image.mimeType)}`,
      );
  }

  async function buildGenerationPack(asRevision = false) {
    if (!project || !scene || !shot || !panel) return;
    setPackBusy(true);
    try {
      const { createGenerationPack } =
        await import('@/lib/storyboard/generation-pack');
      const pack = await createGenerationPack(
        project,
        scene,
        shot,
        panel,
        asRevision
          ? { revisionInstruction: revision, includeSelectedImage: true }
          : undefined,
      );
      download(pack.blob, pack.filename);
    } catch (cause) {
      setError(`Could not prepare the generation pack. ${messageOf(cause)}`);
    } finally {
      setPackBusy(false);
    }
  }

  async function buildPdf(
    includeNotes = pdfIncludeNotes,
    layout: StoryboardPdfLayout = pdfLayout,
    includeCover = pdfIncludeCover,
    sceneBreaks: 'flow' | 'page' = pdfSceneBreaks,
  ) {
    if (!project) return;
    setPdfBusy(true);
    setPdfError('');
    try {
      const { createStoryboardPdf } = await import('@/lib/pdf/export');
      const bytes = await createStoryboardPdf(project, {
        ...(pdfScope === 'scene' && scene ? { sceneId: scene.id } : {}),
        includeNotes,
        layout,
        includeCover,
        sceneBreaks,
      });
      const blob = new Blob([new Uint8Array(bytes)], {
        type: 'application/pdf',
      });
      const url = URL.createObjectURL(blob);
      if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
      pdfUrlRef.current = url;
      setPdfUrl(url);
      setPdfIncludeNotes(includeNotes);
      setPdfLayout(layout);
      setPdfIncludeCover(includeCover);
      setPdfSceneBreaks(sceneBreaks);
      setPdfName(
        `${fileName(project.name)}${pdfScope === 'scene' && scene ? ` - ${fileName(scene.title)}` : ''}.pdf`,
      );
      setPdfOpen(true);
    } catch (cause) {
      const message = `Could not create the PDF. ${messageOf(cause)}`;
      setError(message);
      setPdfError(message);
    } finally {
      setPdfBusy(false);
    }
  }

  const prompt =
    project && scene && shot && panel
      ? buildPanelPrompt(project, scene, shot, panel)
      : '';
  const panelDetails = shot && panel ? getPanelDetails(shot, panel) : undefined;
  const selectedRefs =
    project && shot && panel
      ? resolvePanelReferences(project, shot, panel)
      : [];
  const previousPanelCandidates =
    scene && panel ? getPreviousPanelCandidates(scene, panel) : [];
  const previousPanelResolution =
    scene && panel
      ? resolvePreviousPanelReferences(scene, panel)
      : { references: [], missing: [] };
  const previousPanelSelections = panel?.previousPanelReferences ?? [];
  const setPreviousPanelReferences = (
    value: NonNullable<Panel['previousPanelReferences']>,
  ) => updatePanel({ previousPanelReferences: value }, 'previous-references');
  const saveLabel = {
    loading: 'Opening projects',
    saved:
      project && folderBindings[project.id]
        ? 'Saved to folder'
        : 'Saved in this browser',
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
        accept=".storyboard,.json,application/json,application/vnd.storyboard+zip,application/zip"
        className="sb-hidden"
        aria-label="Import project backup"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void restoreBackup(file);
          event.target.value = '';
        }}
      />

      <WorkspaceNavigation
        projects={projects}
        project={project}
        scene={scene}
        canUndo={Boolean(project && undoCounts[project.id])}
        onProject={(value) => setSelection(initialSelection(value))}
        onScene={(value) => {
          setLibraryOpen(false);
          if (project)
            setSelection({
              projectId: project.id,
              sceneId: value.id,
              shotId: value.shots[0]?.id ?? '',
              panelId: value.shots[0]?.panels[0]?.id ?? '',
            });
        }}
        onNewProject={() => setNewProjectOpen(true)}
        onImport={() => backupInput.current?.click()}
        onOpenFolder={() => beginFolderAction('open')}
        onSave={() => void saveCurrentProject()}
        canSave={Boolean(project && folderBindings[project.id] && !folderBusy)}
        onAddScene={addScene}
        onLibrary={() => setLibraryOpen(true)}
        onSettings={() => setSettingsOpen(true)}
        onBackup={() => backupCurrent()}
        onUndo={undo}
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
        <Button
          variant="ghost"
          className="sb-sidebar-library"
          onClick={() => beginFolderAction('open')}
        >
          <FolderOpen /> Open project folder
        </Button>
        <Button
          variant="ghost"
          className={`sb-sidebar-library ${libraryOpen ? 'is-active' : ''}`}
          disabled={!project}
          onClick={() => setLibraryOpen(true)}
        >
          <Library /> Reference library
        </Button>
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
              onClick={() => {
                setLibraryOpen(false);
                setSelection({
                  projectId: project.id,
                  sceneId: item.id,
                  shotId: item.shots[0]?.id ?? '',
                  panelId: item.shots[0]?.panels[0]?.id ?? '',
                });
              }}
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
                onClick={() => backupCurrent()}
              >
                <Download /> Download backup
              </Button>
            </>
          )}
          <p className="sb-local-note">
            {project && folderBindings[project.id]
              ? 'This project and its artwork live in your chosen folder.'
              : 'This project lives in this browser.'}
            <br />
            Keep a backup for safekeeping.
          </p>
        </div>
      </aside>

      <main className="sb-main">
        {backupBusy && (
          <output className="sb-generation-running">
            <Loader2 className="sb-spin" size={16} />
            Preparing project backup with all artwork…
          </output>
        )}
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
            {project && folderBindings[project.id] && (
              <Button
                variant="ghost"
                onClick={() => void saveCurrentProject()}
                disabled={folderBusy || saveState === 'loading'}
              >
                <Save /> Save
              </Button>
            )}
            {persistenceError?.kind === 'save' && (
              <Button variant="outline" onClick={retrySave}>
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

        {(generation.active || generationPreparing) && (
          <output className="sb-generation-running">
            <Loader2 size={16} className="sb-spin" />{' '}
            {generation.active
              ? 'Generating one image for its original panel…'
              : 'Preparing selected artwork for generation…'}
          </output>
        )}
        {generation.warning && (
          <output className="sb-generation-warning">
            <span>Image generated. {generation.warning}</span>
            <IconButton
              label="Dismiss generation notice"
              onClick={generation.dismissWarning}
            >
              <X />
            </IconButton>
          </output>
        )}
        {error && (
          <div className="sb-error" role="alert">
            <span>{error}</span>
            <IconButton label="Dismiss error" onClick={() => setError('')}>
              <X />
            </IconButton>
          </div>
        )}
        {persistenceError && (
          <div className="sb-persistence-error" role="alert">
            <strong>
              {persistenceError.kind === 'conflict'
                ? 'Save conflict — your edits are still here'
                : persistenceError.kind === 'load'
                  ? 'Projects could not be opened'
                  : 'Changes need attention'}
            </strong>
            <p>{persistenceError.message}</p>
            <div>
              {persistenceError.kind === 'load' ? (
                <Button variant="outline" onClick={retryLoad}>
                  Retry opening projects
                </Button>
              ) : (
                <>
                  <Button
                    variant="outline"
                    onClick={() =>
                      backupCurrent(
                        getProjects().find(
                          (item) => item.id === persistenceError.projectId,
                        ) ?? project,
                      )
                    }
                  >
                    Download my backup
                  </Button>
                  {persistenceError.kind === 'conflict' &&
                    persistenceError.projectId && (
                      <Button
                        variant="outline"
                        onClick={() =>
                          setDeleteRequest({
                            title: 'Reload the saved version?',
                            description:
                              'This replaces unsaved edits in this tab with the version on this device. Download your backup first if you want to keep both versions.',
                            confirmLabel: 'Reload saved version',
                            run: () => {
                              void reloadProject(
                                persistenceError.projectId!,
                              ).then((reloaded) => {
                                if (reloaded)
                                  setNotice('Saved version reloaded');
                              });
                            },
                          })
                        }
                      >
                        Reload saved version
                      </Button>
                    )}
                  {persistenceError.kind === 'save' && (
                    <Button variant="outline" onClick={retrySave}>
                      Retry save
                    </Button>
                  )}
                  {persistenceError.kind === 'budget' && (
                    <Button
                      variant="outline"
                      onClick={() => setSettingsOpen(true)}
                    >
                      View capacity
                    </Button>
                  )}
                </>
              )}
              {!['load', 'conflict'].includes(persistenceError.kind) && (
                <IconButton
                  label="Dismiss save message"
                  onClick={dismissPersistenceError}
                >
                  <X />
                </IconButton>
              )}
            </div>
          </div>
        )}
        {diagnostics.length > 0 && (
          <div className="sb-persistence-error">
            <strong>Some saved projects need attention</strong>
            {diagnostics.map((item, index) => (
              <p key={index}>{item}</p>
            ))}
            <p>
              Your valid projects are available. Invalid records have not been
              removed.
            </p>
          </div>
        )}
        {project &&
          !folderBindings[project.id] &&
          budgets[project.id]?.overBudget && (
            <div className="sb-budget-banner">
              <span>
                This recovery project exceeds working capacity. Download a
                backup, then remove unused artwork or versions to resume
                editing.
              </span>
              <Button variant="outline" onClick={() => backupCurrent()}>
                Recovery backup
              </Button>
            </div>
          )}
        {loadState === 'error' ? (
          <div className="sb-empty-workspace">
            <FolderOpen size={32} />
            <h1>Your saved work has not been changed.</h1>
            <p>
              Retry opening projects to reconnect to this browser’s storage.
            </p>
            <Button onClick={retryLoad} className="sb-primary">
              Retry opening projects
            </Button>
          </div>
        ) : loadState === 'loading' ? (
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
        ) : libraryOpen ? (
          <ReferenceLibrary
            key={project.id}
            project={project}
            onEdit={editProject}
            onBack={() => setLibraryOpen(false)}
            onUpload={(files, groupId, kind) =>
              void addReferences(files, { library: true, groupId, kind })
            }
            onDownload={download}
          />
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
                    <Fragment key={item.id}>
                      {index > 0 ? (
                        <ConnectionButton
                          connection={getShotConnection(
                            scene,
                            scene.shots[index - 1].id,
                            item.id,
                          )}
                          kind="shot"
                          fromTitle={
                            scene.shots[index - 1].title ||
                            `Shot ${number(index - 1)}`
                          }
                          toTitle={item.title || `Shot ${number(index)}`}
                          onClick={() =>
                            openShotConnection(scene.shots[index - 1], item)
                          }
                        />
                      ) : null}
                      <div
                        className={`sb-timeline-item ${
                          dropTarget === `shot:${item.id}`
                            ? dragItem?.kind === 'shot' &&
                              scene.shots.findIndex(
                                (candidate) => candidate.id === dragItem.id,
                              ) < index
                              ? 'is-drop-target is-drop-after'
                              : 'is-drop-target'
                            : ''
                        }`}
                        onDragOver={(event) => {
                          if (dragItem?.kind !== 'shot') return;
                          event.preventDefault();
                          event.dataTransfer.dropEffect = 'move';
                          setDropTarget(`shot:${item.id}`);
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          dropReorder('shot', item.id);
                        }}
                      >
                        <button
                          className={`sb-drag-handle ${dragItem?.kind === 'shot' && dragItem.id === item.id ? 'is-dragging' : ''}`}
                          draggable
                          aria-label={`Drag ${item.title || 'shot'} to reorder`}
                          title="Drag to reorder"
                          onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = 'move';
                            event.dataTransfer.setData(
                              'application/x-storyboard-shot',
                              item.id,
                            );
                            setDragItem({ kind: 'shot', id: item.id });
                          }}
                          onDragEnd={() => {
                            setDragItem(null);
                            setDropTarget('');
                          }}
                        >
                          <GripVertical />
                        </button>
                        <button
                          className={`sb-shot-card ${shot?.id === item.id ? 'is-active' : ''}`}
                          onClick={() => chooseShot(item)}
                          aria-pressed={shot?.id === item.id}
                          aria-label={`${formatShotCode(sceneIndex + 1, index + 1)} — ${item.title || 'Untitled shot'}`}
                          title={`${formatShotCode(sceneIndex + 1, index + 1)} — ${item.title || 'Untitled shot'}`}
                        >
                          <span className="sb-shot-thumb">
                            {art ? (
                              <FrameArtwork
                                aspectRatio={project.aspectRatio}
                                key={art.id}
                                image={art}
                                alt=""
                                loading="lazy"
                              />
                            ) : (
                              <span className="sb-shot-placeholder">
                                <Film size={18} />
                              </span>
                            )}
                            <span>SH{number(index)}</span>
                          </span>
                          <span className="sb-shot-info">
                            <strong>{item.title || 'Untitled shot'}</strong>
                            <small>
                              {item.panels.length} panel
                              {item.panels.length === 1 ? '' : 's'}
                            </small>
                          </span>
                        </button>
                      </div>
                    </Fragment>
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
                      {formatShotCode(sceneIndex + 1, shotIndex + 1)}
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
                              ? reorderShots(
                                  item,
                                  shot.id,
                                  item.shots[shotIndex - 1].id,
                                )
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
                              ? reorderShots(
                                  item,
                                  shot.id,
                                  item.shots[shotIndex + 1].id,
                                )
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
                                  ...materializeShotConnections(item),
                                  shots: [
                                    ...materializeShotConnections(
                                      item,
                                    ).shots.slice(0, shotIndex + 1),
                                    duplicate,
                                    ...materializeShotConnections(
                                      item,
                                    ).shots.slice(shotIndex + 1),
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
                                      ...materializeShotConnections(item),
                                      shots: materializeShotConnections(
                                        item,
                                      ).shots.filter(
                                        (value) => value.id !== shot.id,
                                      ),
                                      shotConnections:
                                        materializeShotConnections(
                                          item,
                                        ).shotConnections?.filter(
                                          (value) =>
                                            value.fromId !== shot.id &&
                                            value.toId !== shot.id,
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
                        {formatPanelCode(
                          sceneIndex + 1,
                          shotIndex + 1,
                          panelIndex + 1,
                          shot.panels.length,
                        )}{' '}
                        <span className="sb-muted">
                          PANEL {number(panelIndex)} OF{' '}
                          {number(shot.panels.length - 1)}
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
                        <FrameArtwork
                          aspectRatio={project.aspectRatio}
                          key={image.id}
                          image={image}
                          alt={panel.title || `Panel ${panelIndex + 1}`}
                          interactive
                          onTransformChange={updateImageTransform}
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
                          ? hasImageFraming(image.transform)
                            ? 'Framing adjusted · original kept'
                            : 'Full artwork fitted within frame'
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
                    {image ? (
                      <ImageFramingControls
                        transform={image.transform}
                        onChange={updateImageTransform}
                      />
                    ) : null}

                    <div className="sb-panel-timeline-row">
                      <div className="sb-panel-strip">
                        {shot.panels.map((item, index) => (
                          <Fragment key={item.id}>
                            {index > 0 ? (
                              <ConnectionButton
                                connection={getPanelConnection(
                                  shot,
                                  shot.panels[index - 1].id,
                                  item.id,
                                )}
                                kind="panel"
                                fromTitle={
                                  shot.panels[index - 1].title ||
                                  `Panel ${number(index - 1)}`
                                }
                                toTitle={item.title || `Panel ${number(index)}`}
                                onClick={() =>
                                  openPanelConnection(
                                    shot.panels[index - 1],
                                    item,
                                  )
                                }
                              />
                            ) : null}
                            <div
                              className={`sb-timeline-item ${
                                dropTarget === `panel:${item.id}`
                                  ? dragItem?.kind === 'panel' &&
                                    shot.panels.findIndex(
                                      (candidate) =>
                                        candidate.id === dragItem.id,
                                    ) < index
                                    ? 'is-drop-target is-drop-after'
                                    : 'is-drop-target'
                                  : ''
                              }`}
                              onDragOver={(event) => {
                                if (dragItem?.kind !== 'panel') return;
                                event.preventDefault();
                                event.dataTransfer.dropEffect = 'move';
                                setDropTarget(`panel:${item.id}`);
                              }}
                              onDrop={(event) => {
                                event.preventDefault();
                                dropReorder('panel', item.id);
                              }}
                            >
                              <button
                                className={`sb-drag-handle ${dragItem?.kind === 'panel' && dragItem.id === item.id ? 'is-dragging' : ''}`}
                                draggable
                                aria-label={`Drag ${item.title || 'panel'} to reorder`}
                                title="Drag to reorder"
                                onDragStart={(event) => {
                                  event.dataTransfer.effectAllowed = 'move';
                                  event.dataTransfer.setData(
                                    'application/x-storyboard-panel',
                                    item.id,
                                  );
                                  setDragItem({ kind: 'panel', id: item.id });
                                }}
                                onDragEnd={() => {
                                  setDragItem(null);
                                  setDropTarget('');
                                }}
                              >
                                <GripVertical />
                              </button>
                              <button
                                className={`sb-panel-tab ${item.id === panel.id ? 'is-active' : ''}`}
                                onClick={() =>
                                  setSelection({ ...target, panelId: item.id })
                                }
                                aria-pressed={item.id === panel.id}
                                aria-label={`${formatPanelCode(
                                  sceneIndex + 1,
                                  shotIndex + 1,
                                  index + 1,
                                  shot.panels.length,
                                )} — ${item.title || 'Untitled panel'}`}
                                title={`${formatPanelCode(
                                  sceneIndex + 1,
                                  shotIndex + 1,
                                  index + 1,
                                  shot.panels.length,
                                )} — ${item.title || 'Untitled panel'}`}
                              >
                                <span>
                                  {shot.panels.length > 1
                                    ? formatPanelLetter(index + 1)
                                    : `SH${number(shotIndex)}`}
                                </span>
                                <strong>
                                  {item.title || 'Untitled panel'}
                                </strong>
                                <small>{item.framing || 'Framing unset'}</small>
                              </button>
                            </div>
                          </Fragment>
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
                      <Button
                        variant="ghost"
                        className="sb-delete-panel"
                        aria-label={`Delete selected panel ${panel.title || `Panel ${panelIndex + 1}`}`}
                        onClick={requestDeletePanel}
                      >
                        <Trash2 />
                        <span>Delete panel</span>
                      </Button>
                    </div>
                    <section className="sb-dialogue-block">
                      <div className="sb-section-title">
                        <span className="sb-eyebrow">DIALOGUE</span>
                        <span>This panel</span>
                      </div>
                      <Textarea
                        aria-label="Panel dialogue"
                        className="sb-dialogue-input"
                        rows={3}
                        value={panelDetails?.dialogue ?? ''}
                        placeholder={
                          'CHARACTER\nEnter dialogue exactly as it should appear beneath this panel…'
                        }
                        onChange={(event) =>
                          updatePanel(
                            { dialogue: event.target.value },
                            'dialogue',
                          )
                        }
                      />
                      <span className="sb-hint">
                        Character name on its own line in CAPITALS, dialogue
                        on the lines beneath. (V.O.) and (beat) are fine. Line
                        breaks are preserved.
                      </span>
                    </section>
                    <details className="sb-panel-disclosure">
                      <summary>
                        <span>Panel details</span>
                        <span>
                          {[panel.title, panel.framing, panel.angle]
                            .map((value) => value?.trim())
                            .filter(Boolean)
                            .join(' · ') || 'Name, framing & angle not set'}
                        </span>
                        <ChevronDown size={16} />
                      </summary>
                      <div className="sb-panel-details">
                        <Field label="Panel name">
                          <Input
                            value={panel.title}
                            onChange={(event) =>
                              updatePanel(
                                { title: event.target.value },
                                'title',
                              )
                            }
                          />
                        </Field>
                        <Field label="Framing">
                          <PanelDetailChoice
                            key={`${panel.id}:framing:${panelDetailResetVersions[panel.id] ?? 0}`}
                            scopeKey={`${panel.id}:framing`}
                            label="Framing"
                            value={panel.framing}
                            options={panelFramingOptions}
                            onChange={(value) =>
                              updatePanel({ framing: value }, 'framing')
                            }
                          />
                        </Field>
                        <Field label="Angle">
                          <PanelDetailChoice
                            key={`${panel.id}:angle:${panelDetailResetVersions[panel.id] ?? 0}`}
                            scopeKey={`${panel.id}:angle`}
                            label="Angle"
                            value={panel.angle}
                            options={panelAngleOptions}
                            onChange={(value) =>
                              updatePanel({ angle: value }, 'angle')
                            }
                          />
                        </Field>
                        <div className="sb-panel-details-clear">
                          <span className="sb-hint">
                            Clears panel name, framing and angle. Empty values
                            are omitted from the PDF.
                          </span>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                              if (
                                updatePanel({
                                  title: '',
                                  framing: '',
                                  angle: '',
                                })
                              )
                                setPanelDetailResetVersions((versions) => ({
                                  ...versions,
                                  [panel.id]: (versions[panel.id] ?? 0) + 1,
                                }));
                            }}
                            disabled={
                              !panel.title && !panel.framing && !panel.angle
                            }
                          >
                            Clear panel details
                          </Button>
                        </div>
                        <div className="sb-panel-pdf-width">
                          <Checkbox
                            id="sb-panel-pdf-full-width"
                            aria-label="Full-width in PDF"
                            aria-describedby="sb-panel-pdf-full-width-description"
                            checked={panel.pdfFullWidth === true}
                            onCheckedChange={(checked) =>
                              updatePanel(
                                { pdfFullWidth: checked === true },
                                'pdf-full-width',
                              )
                            }
                          />
                          <div>
                            <label htmlFor="sb-panel-pdf-full-width">
                              Full-width in PDF
                            </label>
                            <p id="sb-panel-pdf-full-width-description">
                              Use a large frame in the PDF. Smaller frames are
                              the default.
                            </p>
                          </div>
                        </div>
                        <div className="sb-panel-order">
                          <IconButton
                            label="Move panel earlier"
                            disabled={panelIndex === 0}
                            onClick={() =>
                              editPanelStructure((current) =>
                                reorderPanels(
                                  current,
                                  panel.id,
                                  current.panels[panelIndex - 1].id,
                                ),
                              )
                            }
                          >
                            <ArrowLeft />
                          </IconButton>
                          <IconButton
                            label="Move panel later"
                            disabled={panelIndex === shot.panels.length - 1}
                            onClick={() =>
                              editPanelStructure((current) =>
                                reorderPanels(
                                  current,
                                  panel.id,
                                  current.panels[panelIndex + 1].id,
                                ),
                              )
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
                              duplicate.arrows = duplicate.arrows.map(
                                (item) => ({
                                  ...item,
                                  id: newId(),
                                }),
                              );
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
                              editPanelStructure((current) => ({
                                ...current,
                                panels: [
                                  ...current.panels.slice(0, panelIndex + 1),
                                  duplicate,
                                  ...current.panels.slice(panelIndex + 1),
                                ],
                              }));
                              setSelection({
                                ...target,
                                panelId: duplicate.id,
                              });
                            }}
                          >
                            <Copy />
                          </IconButton>
                        </div>
                      </div>
                    </details>
                  </section>

                  <aside className="sb-inspector" aria-label="Panel inspector">
                    <Tabs
                      value={tab}
                      onValueChange={(value) => setTab(String(value))}
                    >
                      <TabsList className="sb-inspector-tabs">
                        <TabsTrigger value="direction">Direction</TabsTrigger>
                        <TabsTrigger value="generate">Generate</TabsTrigger>
                        <TabsTrigger value="prompt">Prompt</TabsTrigger>
                        <TabsTrigger value="references">References</TabsTrigger>
                      </TabsList>
                      <TabsContent value="direction" className="sb-tab-body">
                        <div className="sb-inspector-intro">
                          <span className="sb-eyebrow">THIS FRAME</span>
                          <p>
                            Describe the image you want for the selected panel.
                          </p>
                        </div>
                        <Field
                          label="Frame direction"
                          hint="Only this panel. A newly added panel starts blank."
                        >
                          <Textarea
                            className="sb-direction-input"
                            rows={5}
                            value={panel.description}
                            placeholder="e.g. Matilda centred, waist up, smiling toward camera…"
                            onChange={(event) =>
                              updatePanel(
                                { description: event.target.value },
                                'description',
                              )
                            }
                          />
                        </Field>
                        <Field
                          label="Panel context"
                          hint="Optional context included with this panel."
                        >
                          <Textarea
                            rows={3}
                            value={panelDetails?.context ?? ''}
                            placeholder="Intent or continuity for this panel…"
                            onChange={(event) =>
                              updatePanel(
                                { context: event.target.value },
                                'context',
                              )
                            }
                          />
                        </Field>
                        <Field
                          label="Camera direction within this frame"
                          hint="Describe camera intent shown by this single panel. Use the timeline connector for movement into the next panel or shot."
                        >
                          <Textarea
                            rows={2}
                            value={panelDetails?.camera ?? ''}
                            placeholder="e.g. Dolly forward into a close-up"
                            onChange={(event) =>
                              updatePanel(
                                { camera: event.target.value },
                                'camera',
                              )
                            }
                          />
                        </Field>
                        <div className="sb-boundary-guidance">
                          <strong>Timeline connections</strong>
                          <p>
                            Use the connector between panels for camera
                            movement, or between shots for the edit and any
                            movement across the cut.
                          </p>
                        </div>
                        {panelIndex !== shot.panels.length - 1 ? (
                          <Button
                            type="button"
                            variant="outline"
                            onClick={startNewShotAfterPanel}
                          >
                            Start a new shot after this panel
                          </Button>
                        ) : null}
                        <Field label="Production notes">
                          <Textarea
                            rows={2}
                            value={panelDetails?.notes ?? ''}
                            placeholder="Continuity, props, sound, or handoff notes…"
                            onChange={(event) =>
                              updatePanel(
                                { notes: event.target.value },
                                'notes',
                              )
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

                      <TabsContent value="generate" className="sb-tab-body">
                        <GenerationPanel
                          key={`${project.id}:${panel.id}:${project.aspectRatio}`}
                          controller={generation}
                          aspectRatio={project.aspectRatio}
                          referenceNames={selectedRefs.map((ref) =>
                            referenceDisplayName(project, ref),
                          )}
                          previousPanelCandidates={previousPanelCandidates}
                          previousPanelReferences={previousPanelSelections}
                          resolvedPreviousPanelReferences={
                            previousPanelResolution.references
                          }
                          missingPreviousPanelReferences={
                            previousPanelResolution.missing
                          }
                          onPreviousPanelReferences={setPreviousPanelReferences}
                          hasImage={Boolean(image)}
                          frameDirection={panel.description}
                          onFrameDirection={(value) =>
                            updatePanel({ description: value }, 'description')
                          }
                          panelContext={panelDetails?.context ?? ''}
                          revision={revision}
                          onRevision={setRevision}
                          onGenerate={(mode, preset) =>
                            void generateImage(mode, preset)
                          }
                          onRecover={(requestId) =>
                            void recoverGeneration(requestId)
                          }
                          preparing={generationPreparing}
                          blocked={Boolean(
                            (!folderBindings[project.id] &&
                              budgets[project.id]?.overBudget) ||
                            (persistenceError?.kind === 'conflict' &&
                              persistenceError.projectId === project.id),
                          )}
                        />
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
                        <PreviousPanelReferences
                          aspectRatio={project.aspectRatio}
                          candidates={previousPanelCandidates}
                          selected={previousPanelSelections}
                          resolved={previousPanelResolution.references}
                          missing={previousPanelResolution.missing}
                          onChange={setPreviousPanelReferences}
                        />
                        <div className="sb-prompt-references">
                          <strong>
                            {selectedRefs.length +
                              previousPanelResolution.references.length}{' '}
                            reference
                            {selectedRefs.length +
                              previousPanelResolution.references.length ===
                            1
                              ? ''
                              : 's'}{' '}
                            to attach manually
                          </strong>
                          {selectedRefs.length +
                          previousPanelResolution.references.length ? (
                            <>
                              {selectedRefs.map((ref) => (
                                <button
                                  key={ref.id}
                                  onClick={() =>
                                    download(
                                      ref.dataUrl,
                                      `${fileName(ref.name)}.${imageExtension(ref.mimeType)}`,
                                    )
                                  }
                                >
                                  <Download size={13} />
                                  {referenceDisplayName(project, ref)}
                                </button>
                              ))}
                              {previousPanelResolution.references.map((ref) => (
                                <button
                                  key={`${ref.panelId}:${ref.imageVersionId}`}
                                  onClick={() =>
                                    download(
                                      ref.dataUrl,
                                      `${fileName(ref.label)}.${imageExtension(ref.mimeType)}`,
                                    )
                                  }
                                >
                                  <Download size={13} />
                                  {ref.label} · previous panel
                                </button>
                              ))}
                            </>
                          ) : (
                            <p>
                              Select artwork in the References tab when you have
                              it.
                            </p>
                          )}
                        </div>
                        <Button
                          variant="outline"
                          className="sb-full-width sb-pack-button"
                          disabled={packBusy}
                          onClick={() => void buildGenerationPack()}
                        >
                          {packBusy ? (
                            <Loader2 className="sb-spin" />
                          ) : (
                            <Download />
                          )}{' '}
                          {packBusy
                            ? 'Preparing pack…'
                            : 'Download generation pack'}
                        </Button>
                        <p className="sb-hint">
                          ZIP with this panel’s prompt and selected reference
                          files. Unzip it and attach the images in your image
                          tool.
                        </p>
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
                          <Button
                            variant="outline"
                            className="sb-full-width"
                            disabled={!image || !revision.trim() || packBusy}
                            onClick={() => void buildGenerationPack(true)}
                          >
                            <Download /> Download revision pack
                          </Button>
                          {!image && (
                            <p className="sb-hint">
                              Import an image to start revising it.
                            </p>
                          )}
                        </div>
                      </TabsContent>

                      <TabsContent value="references" className="sb-tab-body">
                        <ShotReferences
                          project={project}
                          referenceIds={panel.referenceIds ?? shot.referenceIds}
                          referenceGroupIds={
                            panel.referenceGroupIds ??
                            shot.referenceGroupIds ??
                            []
                          }
                          onChange={updatePanel}
                          onLibrary={() => setLibraryOpen(true)}
                        />
                      </TabsContent>
                    </Tabs>
                  </aside>
                </div>
              </>
            )}
          </>
        )}
      </main>

      <Dialog
        open={Boolean(connectionDraft)}
        onOpenChange={(open) => {
          if (!open) setConnectionDraft(null);
        }}
      >
        <DialogContent className="sb-dialog sb-connection-dialog">
          <DialogHeader>
            <DialogTitle>
              {connectionDraft?.kind === 'shot'
                ? 'Shot transition and camera move'
                : 'Camera move between panels'}
            </DialogTitle>
            <DialogDescription>
              Set the direction from one timeline item into the next.
            </DialogDescription>
          </DialogHeader>
          {connectionDraft ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                saveConnection();
              }}
            >
              <div
                className="sb-connection-route"
                aria-label="Connection endpoints"
              >
                <span>
                  <small>FROM</small>
                  {connectionDraft.fromTitle}
                </span>
                <ArrowRight aria-hidden="true" />
                <span>
                  <small>TO</small>
                  {connectionDraft.toTitle}
                </span>
              </div>
              <Field
                label={
                  connectionDraft.kind === 'shot'
                    ? 'Editorial transition'
                    : 'Camera movement'
                }
              >
                <NativeSelect
                  value={connectionDraft.type}
                  onChange={(event) =>
                    setConnectionDraft((current) =>
                      current ? { ...current, type: event.target.value } : null,
                    )
                  }
                >
                  {(connectionDraft.kind === 'shot'
                    ? SHOT_CONNECTION_TYPES
                    : PANEL_CONNECTION_TYPES
                  ).map((value) => (
                    <option key={value} value={value}>
                      {value === 'static'
                        ? 'No camera movement'
                        : connectionDraft.kind === 'panel'
                          ? formatMovementLabel(value)
                          : value.replace('-', ' ')}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field
                label={
                  connectionDraft.kind === 'shot'
                    ? 'Transition direction'
                    : 'Movement direction'
                }
              >
                <Textarea
                  rows={2}
                  value={connectionDraft.description}
                  placeholder={
                    connectionDraft.kind === 'shot'
                      ? 'Optional timing or editorial note…'
                      : 'Describe how the camera travels between these frames…'
                  }
                  onChange={(event) =>
                    setConnectionDraft((current) =>
                      current
                        ? { ...current, description: event.target.value }
                        : null,
                    )
                  }
                />
              </Field>
              {connectionDraft.kind === 'shot' ? (
                <>
                  <Field label="Camera movement across the cut">
                    <NativeSelect
                      value={connectionDraft.movement}
                      onChange={(event) =>
                        setConnectionDraft((current) =>
                          current
                            ? { ...current, movement: event.target.value }
                            : null,
                        )
                      }
                    >
                      {PANEL_CONNECTION_TYPES.map((value) => (
                        <option key={value} value={value}>
                          {value === 'static'
                            ? 'No camera movement'
                            : formatMovementLabel(value)}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field label="Movement direction">
                    <Textarea
                      rows={2}
                      value={connectionDraft.movementDescription}
                      placeholder="Optional movement or continuity note…"
                      onChange={(event) =>
                        setConnectionDraft((current) =>
                          current
                            ? {
                                ...current,
                                movementDescription: event.target.value,
                              }
                            : null,
                        )
                      }
                    />
                  </Field>
                </>
              ) : null}
              <div className="sb-dialog-actions sb-connection-actions">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() =>
                    setConnectionDraft((current) =>
                      current
                        ? {
                            ...current,
                            type: current.kind === 'shot' ? 'cut' : 'static',
                            description: '',
                            movement: 'static',
                            movementDescription: '',
                          }
                        : null,
                    )
                  }
                >
                  Reset to default
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setConnectionDraft(null)}
                >
                  Cancel
                </Button>
                <Button type="submit" className="sb-primary">
                  Save connection
                </Button>
              </div>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>

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

      <Dialog
        open={newProjectOpen}
        onOpenChange={(open) => {
          if (!folderBusy) setNewProjectOpen(open);
        }}
      >
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
              void addProject();
            }}
          >
            <Field label="Project name">
              <Input
                value={newName}
                placeholder="Untitled project"
                onChange={(event) => setNewName(event.target.value)}
              />
            </Field>
            <FolderLocationField
              value={newFolder}
              onChange={setNewFolder}
              disabled={folderBusy}
            />
            {newFolder.trim() && persistenceError && (
              <p className="sb-inline-error">{persistenceError.message}</p>
            )}
            {!newFolder.trim() && (
              <p className="sb-hint">
                Leave the folder blank to keep this project in the browser for
                now.
              </p>
            )}
            <div className="sb-dialog-actions">
              <Button
                variant="outline"
                onClick={() => setNewProjectOpen(false)}
                disabled={folderBusy}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="sb-primary"
                disabled={folderBusy}
              >
                {folderBusy ? 'Creating…' : 'Create project'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={folderAction !== null}
        onOpenChange={(open) => {
          if (!open && !folderBusy) setFolderAction(null);
        }}
      >
        <DialogContent className="sb-dialog">
          <DialogHeader>
            <DialogTitle>
              {folderAction === 'open'
                ? 'Open project folder'
                : 'Save project to folder'}
            </DialogTitle>
            <DialogDescription>
              {folderAction === 'open'
                ? 'Open an editable project and the artwork stored with it.'
                : 'Keep this project, its references and all image versions together on disk.'}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void completeFolderAction();
            }}
          >
            <FolderLocationField
              value={folderPathDraft}
              onChange={setFolderPathDraft}
              purpose={folderAction === 'open' ? 'project' : 'parent'}
              disabled={folderBusy}
            />
            {persistenceError && (
              <p className="sb-inline-error">{persistenceError.message}</p>
            )}
            <div className="sb-dialog-actions">
              <Button
                type="button"
                variant="outline"
                disabled={folderBusy}
                onClick={() => setFolderAction(null)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="sb-primary"
                disabled={folderBusy || !folderPathDraft.trim()}
              >
                {folderBusy
                  ? 'Working…'
                  : folderAction === 'open'
                    ? 'Open project'
                    : 'Save to folder'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {project && (
        <ProjectSettings
          key={`${project.id}:${settingsOpen}`}
          project={project}
          scene={scene}
          budget={budgets[project.id]}
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          onEdit={editProject}
          onChooseCoverImage={(file) => void chooseCoverImage(file, project.id)}
          onBackup={() => backupCurrent()}
          backupBusy={backupBusy}
          folderPath={folderBindings[project.id]?.path}
          onSaveToFolder={() => beginFolderAction('attach')}
          onSaveNow={() => void saveCurrentProject()}
          folderBusy={folderBusy}
          onDeleteScene={deleteCurrentScene}
          onDeleteProject={deleteCurrentProject}
          onMoveScene={(delta) => {
            if (scene)
              editProject(project.id, (current) => ({
                ...current,
                scenes: moveItem(
                  current.scenes,
                  current.scenes.findIndex((item) => item.id === scene.id),
                  delta,
                ),
              }));
          }}
        />
      )}

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
                    <FrameArtwork
                      aspectRatio={project.aspectRatio}
                      image={version}
                      alt={version.label}
                      loading="lazy"
                    />
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
                        download(version.dataUrl, version.label || 'panel.png')
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
              {deleteRequest?.confirmLabel ?? 'Delete'}
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={pdfOpen} onOpenChange={setPdfOpen}>
        <DialogContent className="sb-dialog sb-pdf-dialog">
          <DialogHeader>
            <DialogTitle>Storyboard preview</DialogTitle>
            <DialogDescription>
              {pdfName} · A4{' '}
              {pdfLayout === 'portrait-2up' ? 'portrait' : 'landscape'} ·
              current snapshot
            </DialogDescription>
          </DialogHeader>
          <div className="sb-pdf-toolbar">
            <label className="sb-pdf-layout" htmlFor="sb-pdf-layout">
              <span>Page layout</span>
              <NativeSelect
                id="sb-pdf-layout"
                value={pdfLayout}
                disabled={pdfBusy}
                onChange={(event) =>
                  void buildPdf(
                    pdfIncludeNotes,
                    event.target.value as StoryboardPdfLayout,
                  )
                }
              >
                <option value="portrait-2up">Portrait · 2 frames across</option>
                <option value="landscape-2up">
                  Landscape · 2 frames across
                </option>
                <option value="landscape-3up">
                  Landscape · 3 frames across
                </option>
              </NativeSelect>
            </label>
            <label className="sb-check-line" htmlFor="sb-pdf-include-notes">
              <Checkbox
                id="sb-pdf-include-notes"
                checked={pdfIncludeNotes}
                disabled={pdfBusy}
                onCheckedChange={(checked) => void buildPdf(Boolean(checked))}
              />
              {pdfBusy ? 'Updating preview…' : 'Include production notes'}
            </label>
            <label className="sb-check-line" htmlFor="sb-pdf-include-cover">
              <Checkbox
                id="sb-pdf-include-cover"
                checked={pdfIncludeCover}
                disabled={pdfBusy}
                onCheckedChange={(checked) =>
                  void buildPdf(
                    pdfIncludeNotes,
                    pdfLayout,
                    Boolean(checked),
                  )
                }
              />
              Include cover page
            </label>
            <label className="sb-pdf-layout" htmlFor="sb-pdf-scene-breaks">
              <span>Scene breaks</span>
              <NativeSelect
                id="sb-pdf-scene-breaks"
                value={pdfSceneBreaks}
                disabled={pdfBusy}
                onChange={(event) =>
                  void buildPdf(
                    pdfIncludeNotes,
                    pdfLayout,
                    pdfIncludeCover,
                    event.target.value as 'flow' | 'page',
                  )
                }
              >
                <option value="flow">Flow</option>
                <option value="page">New page per scene</option>
              </NativeSelect>
            </label>
            <Button
              variant="outline"
              disabled={pdfBusy}
              onClick={() =>
                window.open(pdfUrl, '_blank', 'noopener,noreferrer')
              }
            >
              <Eye /> Open in new tab
            </Button>
            <Button
              className="sb-primary"
              disabled={pdfBusy}
              onClick={() => download(pdfUrl, pdfName)}
            >
              <Download /> Download PDF
            </Button>
          </div>
          {pdfError && (
            <p className="sb-inline-error" role="alert">
              {pdfError}
            </p>
          )}
          {pdfUrl && (
            <Suspense
              fallback={<p className="sb-hint">Opening PDF preview…</p>}
            >
              <PdfPreview url={pdfUrl} title="Storyboard PDF preview" />
            </Suspense>
          )}
        </DialogContent>
      </Dialog>
      {downloadDialog}
    </div>
  );
}
