import assert from 'node:assert/strict';
import test from 'node:test';
import { createProject } from '../lib/storyboard/model.ts';
import { withEditor } from './editor-harness.mjs';

function boundFolderApi() {
  const project = createProject('Bound project');
  let revision = 1;
  let manifestDigest = 'manifest-1';
  let savesFail = false;
  let failOpen = false;
  const saveBodies = [];
  const calls = [];

  const binding = () => ({
    projectId: project.id,
    path: '/boards/Bound project',
    revision,
    manifestDigest,
    project: structuredClone(project),
  });

  const fetch = async (input, init = {}) => {
    const rawUrl = typeof input === 'string' ? input : input.url;
    const url = new URL(rawUrl, 'http://localhost:4317');
    const method = init.method ?? 'GET';
    calls.push(`${method} ${url.pathname}`);

    if (method === 'GET' && url.pathname === '/api/projects') {
      return Response.json({
        projects: [binding()],
        diagnostics: [],
        forgottenProjectIds: [],
      });
    }
    if (method === 'POST' && url.pathname === '/api/projects/assets/check') {
      return Response.json({ missing: [] });
    }
    if (method === 'POST' && url.pathname === '/api/projects/save') {
      const body = JSON.parse(String(init.body));
      saveBodies.push(body);
      if (savesFail) {
        return Response.json(
          { error: 'The disk is temporarily unavailable.' },
          { status: 500 },
        );
      }
      Object.assign(project, structuredClone(body.project));
      revision += 1;
      manifestDigest = `manifest-${revision}`;
      return Response.json(binding());
    }
    if (method === 'POST' && url.pathname === '/api/projects/forget') {
      return Response.json({ ok: true });
    }
    if (method === 'POST' && url.pathname === '/api/projects/open') {
      if (failOpen) {
        failOpen = false;
        return Response.json(
          { error: 'That folder cannot be opened.' },
          { status: 500 },
        );
      }
      return Response.json(binding());
    }
    return Response.json(
      { error: `Unexpected folder route: ${method} ${url.pathname}` },
      { status: 501 },
    );
  };

  return {
    project,
    fetch,
    calls,
    saveBodies,
    setSaveFailure: (value) => {
      savesFail = value;
    },
    failOpen: () => {
      failOpen = true;
    },
  };
}

test('closing a dirty folder project saves first and keeps it open when saving fails', async () => {
  const server = boundFolderApi();
  // Keep the disk unavailable through both a possible debounced autosave and
  // the close attempt, even when a busy test runner delays the UI clicks.
  server.setSaveFailure(true);
  await withEditor(
    async (api) => {
      await api.mount();
      await api.enterText(
        api.container.querySelector('[aria-label="Panel dialogue"]'),
        'Do not lose this line.',
      );

      await api.click(api.byText('button', 'Project settings'));
      let dialog = api.document.querySelector('[role="dialog"]');
      await api.click(api.byText('button', 'Close project', dialog));
      const alert = api.document.querySelector('[role="alertdialog"]');
      await api.click(api.byText('button', 'Close project', alert));
      await api.wait(120);

      assert.ok(
        server.saveBodies.length >= 1,
        'closing dirty work attempts to save',
      );
      for (const body of server.saveBodies) {
        assert.equal(
          body.project.scenes[0].shots[0].panels[0].dialogue,
          'Do not lose this line.',
        );
      }
      assert.equal(
        server.calls.filter((call) => call === 'POST /api/projects/forget')
          .length,
        0,
      );
      assert.equal(
        api.container.querySelector('#project-select')?.value,
        server.project.id,
      );

      const failedAttempts = server.saveBodies.length;
      server.setSaveFailure(false);
      await api.click(api.byText('button', 'Project settings'));
      dialog = api.document.querySelector('[role="dialog"]');
      await api.click(api.byText('button', 'Save now', dialog));
      await api.wait(100);
      assert.equal(
        server.saveBodies.length,
        failedAttempts + 1,
        'the failed close does not poison a later explicit save',
      );
      assert.match(
        api.container.querySelector('.sb-save-status').textContent,
        /Saved to folder/,
      );
    },
    { folderFetch: server.fetch },
  );
});

test('a failed folder open does not poison the next explicit save', async () => {
  const server = boundFolderApi();
  server.failOpen();
  await withEditor(
    async (api) => {
      await api.mount();
      await api.click(api.byText('button', 'Open project folder'));
      let dialog = api.document.querySelector('[role="dialog"]');
      await api.enterText(
        dialog.querySelector('.sb-folder-location input'),
        '/missing/project',
      );
      await api.click(api.byText('button', 'Open project', dialog));
      await api.wait(80);
      assert.match(dialog.textContent, /That folder cannot be opened/);
      await api.click(api.byText('button', 'Cancel', dialog));

      await api.enterText(
        api.container.querySelector('[aria-label="Panel dialogue"]'),
        'Save after failure.',
      );
      await api.click(api.byText('button', 'Project settings'));
      dialog = api.document.querySelector('[role="dialog"]');
      await api.click(api.byText('button', 'Save now', dialog));
      await api.wait(100);

      assert.equal(server.saveBodies.length, 1);
      assert.equal(
        server.saveBodies[0].project.scenes[0].shots[0].panels[0].dialogue,
        'Save after failure.',
      );
      assert.match(
        api.container.querySelector('.sb-save-status').textContent,
        /Saved to folder/,
      );
    },
    { folderFetch: server.fetch },
  );
});

test('closing and reopening in one mount permits later edits to save', async () => {
  const server = boundFolderApi();
  await withEditor(
    async (api) => {
      await api.mount();
      await api.click(api.byText('button', 'Project settings'));
      let dialog = api.document.querySelector('[role="dialog"]');
      await api.click(api.byText('button', 'Close project', dialog));
      const alert = api.document.querySelector('[role="alertdialog"]');
      await api.click(api.byText('button', 'Close project', alert));
      await api.wait(80);

      await api.click(api.byText('button', 'Open project folder'));
      dialog = api.document.querySelector('[role="dialog"]');
      await api.enterText(
        dialog.querySelector('.sb-folder-location input'),
        '/boards/Bound project',
      );
      await api.click(api.byText('button', 'Open project', dialog));
      await api.wait(80);

      await api.enterText(
        api.container.querySelector('[aria-label="Panel dialogue"]'),
        'Saved after same-mount reopen.',
      );
      await api.click(api.byText('button', 'Project settings'));
      dialog = api.document.querySelector('[role="dialog"]');
      await api.click(api.byText('button', 'Save now', dialog));
      await api.wait(100);

      assert.equal(server.saveBodies.length, 1);
      assert.equal(
        server.saveBodies[0].project.scenes[0].shots[0].panels[0].dialogue,
        'Saved after same-mount reopen.',
      );
      assert.match(
        api.container.querySelector('.sb-save-status').textContent,
        /Saved to folder/,
      );
    },
    { folderFetch: server.fetch },
  );
});
