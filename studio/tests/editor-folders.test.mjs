import assert from 'node:assert/strict';
import test from 'node:test';
import { withEditor } from './editor-harness.mjs';

const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
const imageDataUrl = `data:image/png;base64,${png}`;
const assetToken = /^asset:sha256:[a-f0-9]{64}\.png$/;
const clone = (value) => structuredClone(value);

function folderApi() {
  const folders = new Map();
  const registered = new Set();
  const forgotten = new Set();
  const pending = new Map();
  const calls = [];
  const saveBodies = [];
  const assetPuts = [];

  const json = (value, status = 200) => Response.json(value, { status });
  const body = (init) => JSON.parse(String(init?.body ?? '{}'));
  const binding = (entry) => ({
    projectId: entry.projectId,
    path: entry.path,
    revision: entry.revision,
    manifestDigest: entry.manifestDigest,
    project: clone(entry.project),
  });
  const byProjectId = (projectId) =>
    [...folders.values()].find((entry) => entry.projectId === projectId);

  const fetch = async (input, init = {}) => {
    const rawUrl = typeof input === 'string' ? input : input.url;
    const url = new URL(rawUrl, 'http://localhost:4317');
    const method = init.method ?? 'GET';
    calls.push({
      method,
      url: `${url.pathname}${url.search}`,
      body: init.body,
    });

    if (method === 'GET' && url.pathname === '/api/projects') {
      return json({
        projects: [...registered].map(byProjectId).filter(Boolean).map(binding),
        diagnostics: [],
        forgottenProjectIds: [...forgotten],
      });
    }

    if (method === 'POST' && url.pathname === '/api/projects/create') {
      const request = body(init);
      const path = `${request.parentPath.replace(/\/$/, '')}/${request.name}`;
      if (folders.has(path))
        return json(
          { error: 'A project already exists in that folder.', code: 'exists' },
          409,
        );
      const token = `pending-${request.projectId}`;
      pending.set(request.projectId, {
        projectId: request.projectId,
        path,
        token,
        assets: new Map(),
      });
      return json({ projectId: request.projectId, path, token });
    }

    if (method === 'POST' && url.pathname === '/api/projects/assets/check') {
      const request = body(init);
      const staged = pending.get(request.projectId);
      const entry = byProjectId(request.projectId);
      const assets = staged?.assets ?? entry?.assets;
      if (!assets)
        return json({ error: 'Project binding was not found.' }, 404);
      return json({
        missing: request.assets
          .filter((asset) => !assets.has(asset.hash))
          .map((asset) => asset.hash),
      });
    }

    const assetMatch = /^\/api\/projects\/assets\/([a-f0-9]{64})$/.exec(
      url.pathname,
    );
    if (method === 'PUT' && assetMatch) {
      const headers = new Headers(init.headers);
      const projectId = headers.get('x-storyboard-project-id');
      const staged = pending.get(projectId);
      const entry = byProjectId(projectId);
      const assets = staged?.assets ?? entry?.assets;
      if (!assets)
        return json({ error: 'Project binding was not found.' }, 404);
      const bytes = new Uint8Array(await init.body.arrayBuffer());
      assets.set(assetMatch[1], {
        bytes,
        mimeType: headers.get('content-type'),
        extension: headers.get('x-storyboard-extension'),
      });
      assetPuts.push({ projectId, hash: assetMatch[1], bytes });
      return json({ stored: true });
    }

    if (method === 'GET' && assetMatch) {
      const entry = byProjectId(url.searchParams.get('projectId'));
      const asset = entry?.assets.get(assetMatch[1]);
      if (!asset) return json({ error: 'Image asset was not found.' }, 404);
      return new Response(asset.bytes, {
        headers: { 'content-type': asset.mimeType },
      });
    }

    if (method === 'POST' && url.pathname === '/api/projects/save') {
      const request = body(init);
      saveBodies.push(clone(request));
      const staged = pending.get(request.projectId);
      let entry = byProjectId(request.projectId);
      if (request.token) {
        if (
          !staged ||
          request.token !== staged.token ||
          request.expectedRevision !== null
        )
          return json({ error: 'The project creation token is stale.' }, 409);
        entry = {
          projectId: request.projectId,
          path: staged.path,
          revision: 0,
          manifestDigest: '',
          project: request.project,
          assets: staged.assets,
        };
        folders.set(entry.path, entry);
        pending.delete(request.projectId);
      } else if (!entry) {
        return json({ error: 'Project binding was not found.' }, 404);
      }
      if (
        !request.token &&
        (request.expectedRevision !== entry.revision ||
          request.expectedManifestDigest !== entry.manifestDigest)
      )
        return json(
          { error: 'The project changed on disk.', code: 'conflict' },
          409,
        );
      entry.project = clone(request.project);
      entry.revision += 1;
      entry.manifestDigest = `manifest-${entry.revision}`;
      registered.add(entry.projectId);
      forgotten.delete(entry.projectId);
      return json(binding(entry));
    }

    if (method === 'POST' && url.pathname === '/api/projects/open') {
      const request = body(init);
      const entry = folders.get(request.path);
      if (!entry)
        return json(
          { error: 'No storyboard project exists at that path.' },
          404,
        );
      registered.add(entry.projectId);
      forgotten.delete(entry.projectId);
      return json(binding(entry));
    }

    if (method === 'POST' && url.pathname === '/api/projects/forget') {
      const request = body(init);
      registered.delete(request.projectId);
      forgotten.add(request.projectId);
      return json({ forgotten: true });
    }

    return json(
      { error: `Unexpected folder route: ${method} ${url.pathname}` },
      501,
    );
  };

  return {
    fetch,
    folders,
    registered,
    forgotten,
    calls,
    saveBodies,
    assetPuts,
  };
}

const imageFile = (win, name = 'frame.png') =>
  new win.File([Buffer.from(png, 'base64')], name, { type: 'image/png' });

test('a named folder project saves tokenized metadata and uploads duplicate image bytes once', async () => {
  const server = folderApi();
  await withEditor(
    async (api) => {
      await api.mount();
      await api.click(api.byText('button', 'New project'));
      const createDialog = api.document.querySelector('[role="dialog"]');
      await api.enterText(
        api.field('Project name', createDialog),
        'Night Ride',
      );
      await api.enterText(
        createDialog.querySelector('.sb-folder-location input'),
        '/boards',
      );
      await api.click(api.byText('button', 'Create project', createDialog));
      await api.wait(850);

      assert.equal(
        api.container.querySelector('#project-select option:checked')
          ?.textContent,
        'Night Ride',
      );
      assert.match(
        api.container.querySelector('.sb-save-status').textContent,
        /Saved to folder/,
      );
      const createRequest = server.calls.find(
        (call) => call.url === '/api/projects/create',
      );
      assert.deepEqual(JSON.parse(createRequest.body), {
        parentPath: '/boards',
        name: 'Night Ride',
        projectId: JSON.parse(createRequest.body).projectId,
      });

      const upload = api.container.querySelector(
        '[aria-label="Import panel image"]',
      );
      await api.upload(upload, [imageFile(api.win)]);
      await api.wait(850);
      await api.upload(upload, [imageFile(api.win, 'same-bytes.png')]);
      await api.wait(850);
      assert.equal(server.assetPuts.length, 1);
      assert.deepEqual(
        Buffer.from(server.assetPuts[0].bytes),
        Buffer.from(png, 'base64'),
      );

      await api.enterText(
        api.container.querySelector('[aria-label="Panel dialogue"]'),
        'Keep moving.',
      );
      await api.click(api.byText('button', 'Project settings'));
      const settings = api.document.querySelector('[role="dialog"]');
      assert.match(settings.textContent, /\/boards\/Night Ride/);
      await api.click(api.byText('button', 'Save now', settings));
      await api.wait(150);

      assert.equal(
        server.assetPuts.length,
        1,
        'dialogue-only saves reuse the image asset',
      );
      const metadata = server.saveBodies.findLast(
        (request) =>
          request.project.scenes[0].shots[0].panels[0].versions.length === 2,
      );
      const versions = metadata.project.scenes[0].shots[0].panels[0].versions;
      assert.equal(versions[0].dataUrl, versions[1].dataUrl);
      assert.match(versions[0].dataUrl, assetToken);
      assert.equal(
        metadata.project.scenes[0].shots[0].panels[0].dialogue,
        'Keep moving.',
      );
      assert.match(
        api.container.querySelector('.sb-save-status').textContent,
        /Saved to folder/,
      );
    },
    { folderFetch: server.fetch, imageDataUrl },
  );
});

test('attaching and closing a browser project keeps its folder, suppresses the stale browser copy, and can reopen it', async () => {
  const server = folderApi();
  await withEditor(
    async (api) => {
      await api.mount();
      await api.wait(850);
      const [browserProject] = await api.readProjects();
      assert.ok(browserProject);

      await api.click(api.byText('button', 'Project settings'));
      let dialog = api.document.querySelector('[role="dialog"]');
      await api.click(api.byText('button', 'Save project to folder', dialog));
      dialog = api.document.querySelector('[role="dialog"]');
      await api.enterText(
        dialog.querySelector('.sb-folder-location input'),
        '/team/storyboards',
      );
      await api.click(api.byText('button', 'Save to folder', dialog));
      await api.wait(150);
      const folderPath = `/team/storyboards/${browserProject.name}`;
      assert.ok(server.folders.has(folderPath));

      await api.click(api.byText('button', 'Project settings'));
      dialog = api.document.querySelector('[role="dialog"]');
      await api.click(api.byText('button', 'Close project', dialog));
      const alert = api.document.querySelector('[role="alertdialog"]');
      assert.match(alert.textContent, /project file and images stay on disk/);
      await api.click(api.byText('button', 'Close project', alert));
      await api.wait(150);
      assert.ok(server.folders.has(folderPath));
      assert.ok(server.forgotten.has(browserProject.id));
      assert.equal(
        (await api.readProjects()).some(
          (item) => item.id === browserProject.id,
        ),
        true,
        'attaching preserves the browser recovery copy',
      );

      await api.unmount();
      await api.mount();
      await api.wait(150);
      assert.notEqual(
        api.container.querySelector('#project-select')?.value,
        browserProject.id,
        'the closed browser copy does not reappear on reload',
      );

      await api.click(api.byText('button', 'Open project folder'));
      dialog = api.document.querySelector('[role="dialog"]');
      await api.enterText(
        dialog.querySelector('.sb-folder-location input'),
        '/missing/project',
      );
      await api.click(api.byText('button', 'Open project', dialog));
      await api.wait(100);
      assert.match(
        dialog.textContent,
        /Project folder could not be opened.*No storyboard project exists at that path/,
      );

      await api.enterText(
        dialog.querySelector('.sb-folder-location input'),
        folderPath,
      );
      await api.click(api.byText('button', 'Open project', dialog));
      await api.wait(150);
      assert.equal(
        api.container.querySelector('#project-select')?.value,
        browserProject.id,
      );
      assert.match(
        api.container.querySelector('.sb-save-status').textContent,
        /Saved to folder/,
      );

      await api.unmount();
      await api.mount();
      await api.wait(150);
      assert.equal(
        api.container.querySelector('#project-select')?.value,
        browserProject.id,
        'the reopened folder registration reloads on a fresh mount',
      );
    },
    { folderFetch: server.fetch },
  );
});
