'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { validateProject, type StoryProject } from '@/lib/storyboard/model';
import {
  createFolderProjectClient,
  FolderProjectClientError,
  forgetFolderProjectClient,
  listFolderProjectsClient,
  openFolderProjectClient,
  saveFolderProjectClient,
} from '@/lib/projects/client';
import type { FolderProjectBinding } from '@/lib/projects/types';
import {
  assertProjectWithinWorkingBudget,
  deleteProject,
  getProjectBudget,
  listProjectsWithDiagnostics,
  ProjectConflictError,
  saveProject,
} from '@/lib/storyboard/storage';

export type SaveState = 'loading' | 'saved' | 'unsaved' | 'saving' | 'error';
export type PersistenceError = {
  kind: 'load' | 'save' | 'conflict' | 'budget' | 'folder';
  message: string;
  projectId?: string;
};
const errorMessage = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);
const nextTimestamp = (previous: string) =>
  new Date(Math.max(Date.now(), (Date.parse(previous) || 0) + 1)).toISOString();

/** Owns document revisions, persistence, and undo independently of editor layout. */
export function useStoryboardProjects(makeInitialProject: () => StoryProject) {
  const [projects, setProjects] = useState<StoryProject[]>([]);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  );
  const [saveState, setSaveState] = useState<SaveState>('loading');
  const [persistenceError, setPersistenceError] =
    useState<PersistenceError | null>(null);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const [createdDemo, setCreatedDemo] = useState(false);
  const [budgets, setBudgets] = useState<
    Record<string, ReturnType<typeof getProjectBudget>>
  >({});
  const budgetCache = useRef(
    new Map<string, ReturnType<typeof getProjectBudget>>(),
  );
  const [undoCounts, setUndoCounts] = useState<Record<string, number>>({});
  const [folderBindings, setFolderBindings] = useState<
    Record<string, FolderProjectBinding>
  >({});
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [saveAttempt, setSaveAttempt] = useState(0);
  const store = useRef<StoryProject[]>([]);
  const revisions = useRef(new Map<string, string>());
  const folderBindingStore = useRef(new Map<string, FolderProjectBinding>());
  const conflicts = useRef(new Set<string>());
  const deleted = useRef(new Set<string>());
  const undoStacks = useRef(new Map<string, StoryProject[]>());
  const lastEdit = useRef({ key: '', time: 0 });
  const queue = useRef<Promise<void>>(Promise.resolve());

  const replaceProjects = useCallback((next: StoryProject[]) => {
    let changedBudget = false;
    for (const project of next) {
      if (!budgetCache.current.has(project.id)) {
        budgetCache.current.set(project.id, getProjectBudget(project));
        changedBudget = true;
      }
    }
    if (changedBudget) setBudgets(Object.fromEntries(budgetCache.current));
    store.current = next;
    setProjects(next);
    const dirty = next.filter(
      (project) => revisions.current.get(project.id) !== project.updatedAt,
    );
    setSaveState(
      dirty.length
        ? dirty.some((project) => conflicts.current.has(project.id))
          ? 'error'
          : 'unsaved'
        : 'saved',
    );
  }, []);
  const getProjects = useCallback(() => store.current, []);

  useEffect(() => {
    let active = true;
    Promise.allSettled([
      listProjectsWithDiagnostics(),
      listFolderProjectsClient(),
    ])
      .then(([browserOutcome, folderOutcome]) => {
        if (!active) return;
        if (
          browserOutcome.status === 'rejected' &&
          (folderOutcome.status === 'rejected' ||
            folderOutcome.value.projects.length === 0)
        ) {
          throw new Error(
            `Browser storage: ${errorMessage(browserOutcome.reason)}${
              folderOutcome.status === 'rejected'
                ? ` Folder storage: ${errorMessage(folderOutcome.reason)}`
                : ''
            }`,
          );
        }
        const browserResult =
          browserOutcome.status === 'fulfilled'
            ? browserOutcome.value
            : { projects: [], diagnostics: [] };
        const folderResult =
          folderOutcome.status === 'fulfilled'
            ? folderOutcome.value
            : { projects: [], diagnostics: [], forgottenProjectIds: [] };
        const folderIds = new Set([
          ...folderResult.projects.map((binding) => binding.projectId),
          ...folderResult.diagnostics.flatMap((diagnostic) =>
            diagnostic.projectId ? [diagnostic.projectId] : [],
          ),
        ]);
        const forgottenIds = new Set(folderResult.forgottenProjectIds ?? []);
        const existing = [
          ...folderResult.projects.map((binding) => binding.project),
          ...browserResult.projects.filter(
            (project) =>
              !folderIds.has(project.id) && !forgottenIds.has(project.id),
          ),
        ].sort(
          (a, b) =>
            b.updatedAt.localeCompare(a.updatedAt) ||
            a.name.localeCompare(b.name),
        );
        const warnings = [
          ...(browserOutcome.status === 'rejected'
            ? [
                `Browser project storage could not be read: ${errorMessage(browserOutcome.reason)}`,
              ]
            : []),
          ...(folderOutcome.status === 'rejected'
            ? [
                `Folder project registry could not be read: ${errorMessage(folderOutcome.reason)}`,
              ]
            : []),
          ...browserResult.diagnostics.map((warning) => warning.message),
          ...folderResult.diagnostics.map(
            (warning) => `${warning.path}: ${warning.message}`,
          ),
        ];
        revisions.current.clear();
        for (const project of existing)
          revisions.current.set(project.id, project.updatedAt);
        folderBindingStore.current = new Map(
          folderResult.projects.map((binding) => [binding.projectId, binding]),
        );
        setFolderBindings(Object.fromEntries(folderBindingStore.current));
        // A read error is never treated as an empty, successfully opened database.
        const hasSavedProjectReadWarning =
          browserResult.diagnostics.length > 0 ||
          (folderOutcome.status === 'fulfilled' &&
            folderResult.diagnostics.length > 0);
        const demo = existing.length === 0 && !hasSavedProjectReadWarning;
        const initial = demo ? [makeInitialProject()] : existing;
        replaceProjects(initial);
        setCreatedDemo(demo);
        setDiagnostics(warnings);
        setPersistenceError(null);
        setLoadState('ready');
        setSaveState(demo ? 'unsaved' : 'saved');
      })
      .catch((cause) => {
        if (!active) return;
        setLoadState('error');
        setSaveState('error');
        setPersistenceError({
          kind: 'load',
          message: `Could not open local projects. ${errorMessage(cause)}`,
        });
      });
    return () => {
      active = false;
    };
  }, [loadAttempt, makeInitialProject, replaceProjects]);

  const persistProjects = useCallback(async (candidates: StoryProject[]) => {
    let allSaved = true;
    for (const project of candidates) {
      if (
        deleted.current.has(project.id) ||
        conflicts.current.has(project.id)
      ) {
        allSaved = false;
        continue;
      }
      if (revisions.current.get(project.id) === project.updatedAt) continue;
      try {
        const folderBinding = folderBindingStore.current.get(project.id);
        if (folderBinding) {
          const saved = await saveFolderProjectClient(
            project,
            folderBinding.revision,
            folderBinding.manifestDigest,
          );
          folderBindingStore.current.set(project.id, saved);
          setFolderBindings(Object.fromEntries(folderBindingStore.current));
        } else {
          await saveProject(project, {
            expectedUpdatedAt: revisions.current.get(project.id) ?? null,
          });
        }
        revisions.current.set(project.id, project.updatedAt);
        setPersistenceError((previous) =>
          previous?.projectId === project.id && previous.kind !== 'conflict'
            ? null
            : previous,
        );
      } catch (cause) {
        allSaved = false;
        const isConflict =
          cause instanceof ProjectConflictError ||
          (cause instanceof FolderProjectClientError && cause.status === 409);
        if (isConflict) conflicts.current.add(project.id);
        setPersistenceError({
          kind: isConflict
            ? 'conflict'
            : !folderBindingStore.current.has(project.id) &&
                budgetCache.current.get(project.id)?.overBudget
              ? 'budget'
              : folderBindingStore.current.has(project.id)
                ? 'folder'
                : 'save',
          projectId: project.id,
          message: isConflict
            ? 'This project changed on disk or in another tab. Your edits remain open and have not replaced the saved version. Reload the saved version before saving again.'
            : `Changes have not been saved. ${errorMessage(cause)}`,
        });
      }
    }
    const remaining = store.current.filter(
      (project) => revisions.current.get(project.id) !== project.updatedAt,
    );
    setSaveState(
      remaining.length
        ? remaining.some(
            (project) =>
              conflicts.current.has(project.id) ||
              (!folderBindingStore.current.has(project.id) &&
                budgetCache.current.get(project.id)?.overBudget),
          )
          ? 'error'
          : 'unsaved'
        : 'saved',
    );
    return allSaved;
  }, []);

  useEffect(() => {
    if (loadState !== 'ready') return;
    const dirty = projects.filter(
      (project) => revisions.current.get(project.id) !== project.updatedAt,
    );
    if (!dirty.length) return;
    const eligible = dirty.filter(
      (project) => !conflicts.current.has(project.id),
    );
    if (!eligible.length) return;
    const timer = window.setTimeout(() => {
      setSaveState('saving');
      queue.current = queue.current
        .then(async () => {
          await persistProjects(eligible);
        })
        .catch((cause) => {
          setSaveState('error');
          setPersistenceError({
            kind: 'save',
            message: `Changes have not been saved. ${errorMessage(cause)}`,
          });
        });
    }, 550);
    return () => window.clearTimeout(timer);
  }, [projects, loadState, persistProjects, saveAttempt]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (
        store.current.some(
          (project) => revisions.current.get(project.id) !== project.updatedAt,
        )
      ) {
        event.preventDefault();
        // oxlint-disable-next-line typescript/no-deprecated -- Older WebKit needs this for unsaved-change protection.
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);

  const editProject = useCallback(
    (
      id: string,
      transform: (project: StoryProject) => StoryProject,
      historyKey = '',
    ) => {
      const previous = store.current.find((project) => project.id === id);
      if (!previous) return false;
      const next = transform(previous);
      if (next === previous) return true;
      try {
        // A legacy over-budget project may be reduced in several steps. All other
        // changes must fit before they reach state, including async image uploads.
        const previousBudget = budgetCache.current.get(id);
        const isFolderProject = folderBindingStore.current.has(id);
        if (historyKey) {
          if (!isFolderProject && previousBudget?.overBudget)
            throw new Error(
              'This imported project exceeds the working limit. Download its recovery backup, then remove unused references or image versions before editing.',
            );
        } else {
          const nextBudget = getProjectBudget(next);
          if (
            !isFolderProject &&
            (!previousBudget?.overBudget ||
              nextBudget.bytes >= (previousBudget?.bytes ?? 0))
          )
            assertProjectWithinWorkingBudget(next);
          if (isFolderProject) validateProject(next);
          budgetCache.current.set(id, nextBudget);
          setBudgets((current) => ({ ...current, [id]: nextBudget }));
        }
      } catch (cause) {
        setPersistenceError({
          kind: 'budget',
          projectId: id,
          message: errorMessage(cause),
        });
        return false;
      }
      const now = Date.now();
      const key = `${id}:${historyKey}`;
      if (
        !historyKey ||
        lastEdit.current.key !== key ||
        now - lastEdit.current.time > 1100
      ) {
        const history = [
          ...(undoStacks.current.get(id) ?? []).slice(-29),
          previous,
        ];
        undoStacks.current.set(id, history);
        setUndoCounts((counts) => ({ ...counts, [id]: history.length }));
      }
      lastEdit.current = { key, time: now };
      replaceProjects(
        store.current.map((project) =>
          project.id === id
            ? { ...next, updatedAt: nextTimestamp(previous.updatedAt) }
            : project,
        ),
      );
      return true;
    },
    [replaceProjects],
  );

  const undoProject = useCallback(
    (id: string) => {
      const history = undoStacks.current.get(id) ?? [];
      const previous = history.pop();
      if (!previous) return false;
      budgetCache.current.set(id, getProjectBudget(previous));
      setBudgets((current) => ({
        ...current,
        [id]: budgetCache.current.get(id)!,
      }));
      setUndoCounts((counts) => ({ ...counts, [id]: history.length }));
      lastEdit.current = { key: '', time: 0 };
      replaceProjects(
        store.current.map((project) =>
          project.id === id
            ? { ...previous, updatedAt: nextTimestamp(project.updatedAt) }
            : project,
        ),
      );
      return true;
    },
    [replaceProjects],
  );

  const removeProject = useCallback(
    async (id: string) => {
      let removed = false;
      const wasFolderProject = folderBindingStore.current.has(id);
      try {
        queue.current = queue.current
          .catch(() => undefined)
          .then(async () => {
            const folderBinding = folderBindingStore.current.get(id);
            if (folderBinding) {
              const latest = store.current.find((project) => project.id === id);
              if (
                latest &&
                revisions.current.get(id) !== latest.updatedAt &&
                !(await persistProjects([latest]))
              ) {
                throw new Error(
                  'Latest changes could not be saved, so the project remains open.',
                );
              }
              deleted.current.add(id);
              await forgetFolderProjectClient(id);
              folderBindingStore.current.delete(id);
              setFolderBindings(Object.fromEntries(folderBindingStore.current));
            } else {
              deleted.current.add(id);
              const baseline = revisions.current.get(id);
              if (baseline)
                await deleteProject(id, { expectedUpdatedAt: baseline });
              else if (conflicts.current.has(id))
                throw new Error('Reload the saved project before deleting it.');
            }
            replaceProjects(
              store.current.filter((project) => project.id !== id),
            );
            revisions.current.delete(id);
            undoStacks.current.delete(id);
            conflicts.current.delete(id);
            setPersistenceError((previous) =>
              previous?.projectId === id ? null : previous,
            );
            removed = true;
          });
        await queue.current;
        return removed;
      } catch (cause) {
        deleted.current.delete(id);
        const conflict =
          cause instanceof ProjectConflictError || conflicts.current.has(id);
        if (conflict) conflicts.current.add(id);
        setPersistenceError({
          kind: conflict ? 'conflict' : 'save',
          projectId: id,
          message: `Project was not ${wasFolderProject ? 'closed' : 'deleted'}. ${errorMessage(cause)}`,
        });
        setSaveState('error');
        return false;
      }
    },
    [persistProjects, replaceProjects],
  );

  const reloadProject = useCallback(
    async (id: string) => {
      try {
        await queue.current;
        const folderBinding = folderBindingStore.current.get(id);
        if (folderBinding) {
          const saved = await openFolderProjectClient(folderBinding.path);
          folderBindingStore.current.set(id, saved);
          setFolderBindings(Object.fromEntries(folderBindingStore.current));
          revisions.current.set(id, saved.project.updatedAt);
          budgetCache.current.set(id, getProjectBudget(saved.project));
          conflicts.current.delete(id);
          deleted.current.delete(id);
          undoStacks.current.delete(id);
          setUndoCounts((counts) => ({ ...counts, [id]: 0 }));
          replaceProjects(
            store.current.map((project) =>
              project.id === id ? saved.project : project,
            ),
          );
          setPersistenceError(null);
          return true;
        }
        const result = await listProjectsWithDiagnostics();
        const saved = result.projects.find((project) => project.id === id);
        if (!saved && result.diagnostics.length)
          throw new Error(
            'The saved project could not be read. Keep your local copy and download a backup.',
          );
        if (saved) {
          revisions.current.set(id, saved.updatedAt);
          budgetCache.current.set(id, getProjectBudget(saved));
          setBudgets((current) => ({
            ...current,
            [id]: budgetCache.current.get(id)!,
          }));
        } else revisions.current.delete(id);
        conflicts.current.delete(id);
        deleted.current.delete(id);
        undoStacks.current.delete(id);
        setUndoCounts((counts) => ({ ...counts, [id]: 0 }));
        replaceProjects(
          store.current.flatMap((project) =>
            project.id === id ? (saved ? [saved] : []) : [project],
          ),
        );
        setPersistenceError(null);
        return true;
      } catch (cause) {
        setPersistenceError({
          kind: 'conflict',
          projectId: id,
          message: `Could not reload the saved project. ${errorMessage(cause)}`,
        });
        return false;
      }
    },
    [replaceProjects],
  );

  const createFolderProject = useCallback(
    async (project: StoryProject, parentPath: string) => {
      let created: StoryProject | null = null;
      try {
        queue.current = queue.current
          .catch(() => undefined)
          .then(async () => {
            const binding = await createFolderProjectClient(
              project,
              parentPath,
            );
            folderBindingStore.current.set(project.id, binding);
            setFolderBindings(Object.fromEntries(folderBindingStore.current));
            revisions.current.set(project.id, project.updatedAt);
            deleted.current.delete(project.id);
            conflicts.current.delete(project.id);
            undoStacks.current.delete(project.id);
            setUndoCounts((counts) => ({ ...counts, [project.id]: 0 }));
            const liveProject =
              store.current.find((candidate) => candidate.id === project.id) ??
              project;
            budgetCache.current.set(project.id, getProjectBudget(liveProject));
            const next = [
              liveProject,
              ...store.current.filter(
                (candidate) => candidate.id !== project.id,
              ),
            ];
            replaceProjects(next);
            setCreatedDemo(false);
            setPersistenceError(null);
            created = liveProject;
          });
        await queue.current;
        return created;
      } catch (cause) {
        setPersistenceError({
          kind:
            cause instanceof FolderProjectClientError && cause.status === 409
              ? 'conflict'
              : 'folder',
          projectId: project.id,
          message: `Project folder was not created. ${errorMessage(cause)}`,
        });
        setSaveState('error');
        return null;
      }
    },
    [replaceProjects],
  );

  const attachProjectToFolder = useCallback(
    async (id: string, parentPath: string) => {
      const project = store.current.find((candidate) => candidate.id === id);
      if (!project) return false;
      return Boolean(await createFolderProject(project, parentPath));
    },
    [createFolderProject],
  );

  const openFolderProject = useCallback(
    async (folderPath: string) => {
      let opened: StoryProject | null = null;
      try {
        queue.current = queue.current
          .catch(() => undefined)
          .then(async () => {
            const dirty = store.current.filter(
              (project) =>
                revisions.current.get(project.id) !== project.updatedAt,
            );
            if (dirty.length && !(await persistProjects(dirty))) {
              throw new Error(
                'Unsaved edits could not be stored, so the project folder was not opened.',
              );
            }
            let binding = await openFolderProjectClient(folderPath);
            const liveSameProject = store.current.find(
              (project) => project.id === binding.projectId,
            );
            if (
              liveSameProject &&
              revisions.current.get(binding.projectId) !==
                liveSameProject.updatedAt
            ) {
              binding = await saveFolderProjectClient(
                liveSameProject,
                binding.revision,
                binding.manifestDigest,
              );
            }
            folderBindingStore.current.set(binding.projectId, binding);
            setFolderBindings(Object.fromEntries(folderBindingStore.current));
            revisions.current.set(binding.projectId, binding.project.updatedAt);
            deleted.current.delete(binding.projectId);
            conflicts.current.delete(binding.projectId);
            undoStacks.current.delete(binding.projectId);
            setUndoCounts((counts) => ({
              ...counts,
              [binding.projectId]: 0,
            }));
            budgetCache.current.set(
              binding.projectId,
              getProjectBudget(binding.project),
            );
            replaceProjects([
              binding.project,
              ...store.current.filter(
                (project) => project.id !== binding.projectId,
              ),
            ]);
            setCreatedDemo(false);
            setPersistenceError(null);
            opened = binding.project;
          });
        await queue.current;
        return opened;
      } catch (cause) {
        setPersistenceError({
          kind:
            cause instanceof FolderProjectClientError && cause.status === 409
              ? 'conflict'
              : 'folder',
          message: `Project folder could not be opened. ${errorMessage(cause)}`,
        });
        setSaveState('error');
        return null;
      }
    },
    [persistProjects, replaceProjects],
  );

  const saveNow = useCallback(
    async (projectId?: string) => {
      setSaveState('saving');
      let result = false;
      queue.current = queue.current
        .catch(() => undefined)
        .then(async () => {
          const candidates = store.current.filter(
            (project) =>
              (!projectId || project.id === projectId) &&
              revisions.current.get(project.id) !== project.updatedAt,
          );
          result = await persistProjects(candidates);
        });
      try {
        await queue.current;
        return result;
      } catch (cause) {
        setSaveState('error');
        setPersistenceError({
          kind: 'save',
          projectId,
          message: `Changes have not been saved. ${errorMessage(cause)}`,
        });
        return false;
      }
    },
    [persistProjects],
  );

  return {
    projects,
    folderBindings,
    budgets,
    getProjects,
    hasProjectConflict: (id: string) => conflicts.current.has(id),
    replaceProjects,
    editProject,
    undoProject,
    undoCounts,
    removeProject,
    reloadProject,
    createFolderProject,
    attachProjectToFolder,
    openFolderProject,
    saveNow,
    isFolderProject: (id: string) => folderBindingStore.current.has(id),
    folderPath: (id: string) => folderBindingStore.current.get(id)?.path,
    getFolderPath: (id: string) => folderBindingStore.current.get(id)?.path,
    loadState,
    saveState,
    persistenceError,
    diagnostics,
    createdDemo,
    retryLoad: () => {
      setLoadState('loading');
      setSaveState('loading');
      setLoadAttempt((attempt) => attempt + 1);
    },
    retrySave: () => setSaveAttempt((attempt) => attempt + 1),
    dismissPersistenceError: () =>
      setPersistenceError((previous) =>
        previous?.kind === 'conflict' || previous?.kind === 'load'
          ? previous
          : null,
      ),
  };
}
