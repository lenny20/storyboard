import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

const studioRoot = fileURLToPath(new URL('../', import.meta.url));
const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function withEditor(scenario, options = {}) {
  // This is a component test, not browser UI automation. Keep React external so
  // the renderer, Base UI controls, and application share the installed instance.
  const temporaryDirectory = await mkdtemp(
    path.join(studioRoot, 'tests', '.mount-'),
  );
  const bundlePath = path.join(temporaryDirectory, 'editor.mjs');
  await build({
    absWorkingDir: studioRoot,
    entryPoints: ['components/storyboard/StoryboardApp.tsx'],
    outfile: bundlePath,
    bundle: true,
    format: 'esm',
    platform: 'node',
    packages: 'external',
    jsx: 'automatic',
    loader: { '.css': 'empty' },
    logLevel: 'silent',
  });

  const dom = new JSDOM(
    '<!doctype html><html><body><div id="root"></div></body></html>',
    {
      url: 'http://localhost:4317',
      pretendToBeVisual: true,
    },
  );
  const win = dom.window;
  const previousGlobals = new Map();
  const install = (key, value) => {
    previousGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      value,
      writable: true,
      configurable: true,
    });
  };
  install('window', win);
  install('document', win.document);
  install('navigator', win.navigator);
  for (const name of [
    'Node',
    'Element',
    'HTMLElement',
    'Document',
    'ShadowRoot',
    'MutationObserver',
    'Event',
    'CustomEvent',
    'MouseEvent',
    'KeyboardEvent',
    'FocusEvent',
    'HTMLInputElement',
    'HTMLTextAreaElement',
    'HTMLSelectElement',
    'HTMLButtonElement',
  ])
    install(name, win[name]);
  install('getComputedStyle', win.getComputedStyle.bind(win));
  install('requestAnimationFrame', win.requestAnimationFrame.bind(win));
  install('cancelAnimationFrame', win.cancelAnimationFrame.bind(win));
  install('indexedDB', options.factory ?? new IDBFactory());
  const scenarioFetch = options.fetch;
  install('fetch', async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.startsWith('/api/projects') && options.folderFetch)
      return options.folderFetch(input, init);
    if (url === '/api/projects')
      return Response.json({
        projects: [],
        diagnostics: [],
        forgottenProjectIds: [],
      });
    if (url.startsWith('/api/projects/'))
      return Response.json(
        { error: `Folder project route is not mocked: ${url}` },
        { status: 501 },
      );
    if (scenarioFetch) return scenarioFetch(input, init);
    throw new Error(`Unexpected fetch request: ${url}`);
  });
  install('IDBKeyRange', IDBKeyRange);
  if (options.imageDataUrl) {
    install('FileReader', win.FileReader);
    // jsdom has no image decoder. This adapter recognises only our fixed PNG
    // fixture; real FileReader and the application import pipeline still run.
    install(
      'Image',
      class FixtureImage {
        naturalWidth = 0;
        naturalHeight = 0;
        set src(value) {
          if (!value) return;
          queueMicrotask(() => {
            if (value === options.imageDataUrl) {
              this.naturalWidth = 1;
              this.naturalHeight = 1;
              this.onload?.();
            } else this.onerror?.();
          });
        }
      },
    );
  }
  install('IS_REACT_ACT_ENVIRONMENT', true);
  win.indexedDB = globalThis.indexedDB;
  win.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false;
    },
  });
  win.HTMLElement.prototype.scrollIntoView = () => {};
  const downloads = [];
  win.HTMLAnchorElement.prototype.click = function () {
    downloads.push({ url: this.href, filename: this.download });
  };

  const errors = [];
  const originalError = console.error;
  console.error = (...arguments_) => {
    errors.push(arguments_.map(String).join(' '));
    originalError(...arguments_);
  };
  let root;
  let act;
  try {
    const React = await import('react');
    ({ act } = React);
    const { createRoot } = await import('react-dom/client');
    const { default: StoryboardApp } = await import(
      pathToFileURL(bundlePath).href
    );
    const container = win.document.getElementById('root');
    const mount = async () => {
      root = createRoot(container);
      await act(async () => {
        root.render(
          React.createElement(
            React.StrictMode,
            null,
            React.createElement(StoryboardApp),
          ),
        );
      });
      await act(async () => {
        await delay(100);
      });
    };
    const enterText = async (element, value) => {
      assert.ok(element, 'the field exists');
      const prototype =
        element.tagName === 'TEXTAREA'
          ? win.HTMLTextAreaElement.prototype
          : win.HTMLInputElement.prototype;
      await act(async () => {
        Object.getOwnPropertyDescriptor(prototype, 'value').set.call(
          element,
          value,
        );
        element.dispatchEvent(new win.Event('input', { bubbles: true }));
      });
    };
    const click = async (element) => {
      assert.ok(element, 'the button exists');
      await act(async () => {
        element.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      });
    };
    const shotButton = (title) =>
      [...container.querySelectorAll('.sb-shot-card')].find((element) =>
        element.textContent.includes(title),
      );

    const wait = async (milliseconds = 100) => {
      await act(async () => {
        await delay(milliseconds);
      });
    };
    const unmount = async () => {
      if (root)
        await act(async () => {
          root.unmount();
        });
      root = null;
    };
    const key = async (element, value) => {
      await act(async () => {
        element.dispatchEvent(
          new win.KeyboardEvent('keydown', { key: value, bubbles: true }),
        );
      });
    };
    const changeSelect = async (element, value) => {
      await act(async () => {
        element.value = value;
        element.dispatchEvent(new win.Event('change', { bubbles: true }));
      });
    };
    const upload = async (element, files) => {
      await act(async () => {
        Object.defineProperty(element, 'files', {
          value: files,
          configurable: true,
        });
        element.dispatchEvent(new win.Event('change', { bubbles: true }));
      });
    };
    const byText = (selector, text, scope = win.document) =>
      [...scope.querySelectorAll(selector)].find(
        (element) => element.textContent.trim() === text,
      );
    const field = (label, scope = win.document) =>
      [...scope.querySelectorAll('label')].find(
        (element) => element.textContent === label,
      )?.control;
    const database = async () =>
      await new Promise((resolve, reject) => {
        const request = globalThis.indexedDB.open('storyboard-studio');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    const readProjects = async () => {
      const db = await database();
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction(['projects', 'assets']);
        const request = transaction.objectStore('projects').getAll();
        const assetRequest = transaction.objectStore('assets').getAll();
        transaction.oncomplete = () => {
          const assets = new Map(
            assetRequest.result.map((asset) => [
              `asset:sha256:${asset.id}`,
              asset.dataUrl,
            ]),
          );
          const hydrate = (project) => ({
            ...project,
            references: project.references.map((reference) => ({
              ...reference,
              dataUrl: assets.get(reference.dataUrl) ?? reference.dataUrl,
            })),
            scenes: project.scenes.map((scene) => ({
              ...scene,
              shots: scene.shots.map((shot) => ({
                ...shot,
                panels: shot.panels.map((panel) => ({
                  ...panel,
                  versions: panel.versions.map((version) => ({
                    ...version,
                    dataUrl: assets.get(version.dataUrl) ?? version.dataUrl,
                  })),
                })),
              })),
            })),
          });
          db.close();
          resolve(request.result.map(hydrate));
        };
        transaction.onerror = () => {
          db.close();
          reject(transaction.error);
        };
      });
    };
    const writeProject = async (project) => {
      const db = await database();
      await new Promise((resolve, reject) => {
        const transaction = db.transaction('projects', 'readwrite');
        transaction.objectStore('projects').put(project);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });
      db.close();
    };
    // Database requests yield to animation and save callbacks in the mounted
    // editor. Keep those updates inside act, just like the UI helpers above.
    const withReactUpdates =
      (operation) =>
      async (...arguments_) => {
        let result;
        await act(async () => {
          result = await operation(...arguments_);
        });
        return result;
      };
    await scenario({
      container,
      document: win.document,
      win,
      mount,
      unmount,
      enterText,
      click,
      shotButton,
      wait,
      key,
      changeSelect,
      upload,
      byText,
      field,
      readProjects: withReactUpdates(readProjects),
      writeProject: withReactUpdates(writeProject),
      downloads,
    });
    assert.equal(
      errors.length,
      0,
      `React/runtime console errors: ${errors.join('\n')}`,
    );
  } finally {
    if (root && act)
      await act(async () => {
        root.unmount();
      });
    console.error = originalError;
    dom.window.close();
    for (const [name, descriptor] of previousGlobals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
