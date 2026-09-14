import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveObjectURL } from 'node:buffer';
import { withEditor } from './editor-harness.mjs';

const dataUrl =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
function mockLocalService(configured = true) {
  const state = {
    configured,
    keySource: configured ? 'session' : null,
    usage: [],
    usageTotals: {
      attempts: 0,
      succeeded: 0,
      uncertain: 0,
      failed: 0,
      started: 0,
      knownCost: 0,
      knownCount: 0,
      unknownCount: 0,
    },
  };
  const requests = [];
  const keys = [];
  let resolveGeneration;
  let lastResult;
  return {
    state,
    requests,
    keys,
    fetch: async (path, options) => {
      if (path === '/api/openai/status') return Response.json(state);
      if (path === '/api/openai/connection') {
        const body = JSON.parse(options.body);
        if (body.action === 'set') {
          keys.push(body.apiKey);
          state.configured = true;
          state.keySource = 'session';
        } else {
          state.configured = false;
          state.keySource = null;
        }
        return Response.json(state);
      }
      if (path === '/api/openai/generate') {
        const body = JSON.parse(options.body);
        requests.push(body);
        state.usage.push({
          requestId: body.requestId,
          requestHash: 'test',
          startedAt: new Date().toISOString(),
          status: 'started',
          mode: body.mode,
          preset: body.preset,
          origin: body.origin,
          referenceCount: body.references.length,
          hasCurrentImage: Boolean(body.currentImage),
        });
        state.usageTotals.attempts++;
        state.usageTotals.started++;
        return await new Promise((resolve) => {
          resolveGeneration = resolve;
        });
      }
      if (path.startsWith('/api/openai/results/'))
        return lastResult
          ? Response.json(lastResult)
          : Response.json(
              { error: 'No completed result yet.' },
              { status: 404 },
            );
      throw new Error(`Unexpected local request: ${path}`);
    },
    complete(message) {
      const request = requests.at(-1);
      const usage = {
        inputTextTokens: 100,
        inputImageTokens: 200,
        outputTokens: 300,
        inputTokens: 300,
        totalTokens: 600,
      };
      Object.assign(state.usage.at(-1), { status: 'succeeded', usage });
      Object.assign(state.usageTotals, {
        started: 0,
        succeeded: 1,
        knownCost: 0.0111,
        knownCount: 1,
      });
      lastResult = {
        requestId: request.requestId,
        status: 'succeeded',
        message,
        image: { mimeType: 'image/png', dataUrl },
        usage,
      };
      resolveGeneration(Response.json(lastResult));
    },
  };
}

async function seedReferences(api, withImage = false) {
  await api.mount();
  await api.wait(850);
  const [project] = await api.readProjects();
  await api.unmount();
  project.referenceGroups = [
    {
      id: 'character-matilda',
      name: 'Matilda',
      kind: 'character',
      notes: 'Preserve her short red coat.',
    },
  ];
  project.references = [
    {
      id: 'front-view',
      name: 'Front',
      groupId: 'character-matilda',
      viewLabel: 'Front',
      kind: 'character',
      mimeType: 'image/png',
      dataUrl,
    },
    {
      id: 'unselected-view',
      name: 'Elsewhere',
      kind: 'location',
      mimeType: 'image/png',
      dataUrl,
    },
  ];
  const shot = project.scenes[0].shots[1];
  shot.panels[0].referenceGroupIds = ['character-matilda'];
  shot.panels[0].dialogue = 'MATILDA\nKeep this exact line.';
  if (withImage) {
    shot.panels[0].versions = [
      {
        id: 'existing-image',
        dataUrl,
        label: 'Original image',
        createdAt: project.createdAt,
      },
    ];
    shot.panels[0].selectedVersionId = 'existing-image';
  }
  await api.writeProject(project);
  await api.mount();
  return project;
}

test('API key setup is local-memory configuration, never generation or project data', async () => {
  const service = mockLocalService(false);
  await withEditor(
    async (api) => {
      await api.mount();
      await api.click(api.byText('[role="tab"]', 'Generate'));
      assert.equal(api.byText('button', 'Generate 1 image').disabled, true);
      await api.enterText(
        api.field('OpenAI API key'),
        'sk-local-test-key-not-a-real-credential',
      );
      await api.click(api.byText('button', 'Save key locally'));
      assert.deepEqual(service.keys, [
        'sk-local-test-key-not-a-real-credential',
      ]);
      assert.equal(service.requests.length, 0);
      assert.match(api.container.textContent, /API key ready/);
      assert.match(
        api.container.textContent,
        /Connectivity is checked when you generate/,
      );
      assert.equal(api.field('OpenAI API key'), undefined);
      await api.wait(850);
      assert.doesNotMatch(
        JSON.stringify(await api.readProjects()),
        /sk-local-test-key/,
      );
      assert.doesNotMatch(
        api.win.localStorage.getItem('apiKey') ?? '',
        /sk-local-test-key/,
      );
      await api.click(api.byText('button', 'Download backup'));
      const blob = resolveObjectURL(api.downloads.at(-1).url);
      assert.doesNotMatch(await blob.text(), /sk-local-test-key/);
    },
    { fetch: service.fetch },
  );
});

test('single generation sends only selected real references and returns to its original panel after navigation', async () => {
  const service = mockLocalService();
  await withEditor(
    async (api) => {
      const project = await seedReferences(api);
      await api.click(api.byText('[role="tab"]', 'Generate'));
      await api.click(api.byText('button', 'Generate 1 image'));
      assert.equal(service.requests.length, 1);
      const request = service.requests[0];
      assert.equal(request.preset.quality, 'medium');
      assert.equal(request.preset.size, '1536x640');
      assert.equal(request.references.length, 1);
      assert.equal(request.references[0].dataUrl, dataUrl);
      assert.equal(request.references[0].id, 'front-view');
      assert.match(request.prompt, /Preserve her short red coat/);
      assert.match(
        request.prompt,
        /Input image 1: character — Matilda — Front/,
      );
      assert.doesNotMatch(request.prompt, /Attach these.*manually|\(file:/);
      assert.equal(
        request.origin.panelId,
        project.scenes[0].shots[1].panels[0].id,
      );
      assert.equal(request.apiKey, undefined);
      await api.click(api.shotButton('The island'));
      await api.enterText(
        api.container.querySelector('[aria-label="Panel dialogue"]'),
        'Island dialogue written during generation.',
      );
      service.complete(
        'Recovery file could not be saved. Download the image to retain a separate copy.',
      );
      await api.wait(100);
      assert.match(
        api.container.querySelector('.sb-generation-warning').textContent,
        /Image generated.*Recovery file could not be saved/,
      );
      await api.wait(850);
      const [saved] = await api.readProjects();
      assert.equal(saved.scenes[0].shots[1].panels[0].versions.length, 1);
      assert.equal(saved.scenes[0].shots[0].panels[0].versions.length, 0);
      assert.equal(
        saved.scenes[0].shots[1].panels[0].dialogue,
        'MATILDA\nKeep this exact line.',
      );
      assert.equal(
        saved.scenes[0].shots[0].panels[0].dialogue,
        'Island dialogue written during generation.',
      );
      assert.match(
        api.container.querySelector('[aria-label="API usage on this Mac"]')
          .textContent,
        /\$0\.0111/,
      );
      service.state.usage[0].estimatedCost = 0.4321;
      Object.assign(service.state.usageTotals, {
        attempts: 35,
        knownCount: 20,
        unknownCount: 15,
        knownCost: 1.25,
      });
      await api.click(
        api.container.querySelector('[aria-label="Refresh API usage"]'),
      );
      const ledger = api.container.querySelector(
        '[aria-label="API usage on this Mac"]',
      ).textContent;
      assert.match(ledger, /35 attempts/);
      assert.match(ledger, /\$1\.25/);
      assert.match(
        api.container.querySelector('.sb-generation-attempt').textContent,
        /\$0\.4321 USD/,
      );
      assert.match(ledger, /15 attempts have unknown or partial charges/);
    },
    { fetch: service.fetch },
  );
});

test('previous-panel selection persists and sends the pinned image bytes after remount', async () => {
  const service = mockLocalService();
  await withEditor(
    async (api) => {
      const project = await seedReferences(api);
      const shot = project.scenes[0].shots[1];
      shot.panels[0].versions = [
        {
          id: 'continuity-source-v1',
          dataUrl,
          label: 'Continuity source',
          createdAt: project.createdAt,
        },
      ];
      shot.panels[0].selectedVersionId = 'continuity-source-v1';
      shot.panels.push({
        id: 'continuity-target',
        title: 'Reaction',
        framing: '',
        angle: '',
        description: 'Matilda reacts in the next frame.',
        versions: [],
        selectedVersionId: null,
        markers: [],
        arrows: [],
      });
      await api.unmount();
      await api.writeProject(project);
      await api.mount();
      await api.click(
        [...api.container.querySelectorAll('.sb-panel-tab')].find((item) =>
          item.textContent.includes('Reaction'),
        ),
      );
      await api.click(api.byText('[role="tab"]', 'Generate'));
      const continuityToggle = api.container.querySelector(
        '[aria-label^="Use Shot 2"]',
      );
      assert.ok(continuityToggle);
      await api.click(continuityToggle);
      assert.equal(continuityToggle.getAttribute('data-checked'), '');
      await api.wait(850);
      const [saved] = await api.readProjects();
      assert.deepEqual(
        saved.scenes[0].shots[1].panels.find(
          (item) => item.id === 'continuity-target',
        ).previousPanelReferences,
        [
          {
            panelId: shot.panels[0].id,
            imageVersionId: 'continuity-source-v1',
          },
        ],
      );

      await api.unmount();
      await api.mount();
      await api.click(
        [...api.container.querySelectorAll('.sb-panel-tab')].find((item) =>
          item.textContent.includes('Reaction'),
        ),
      );
      await api.click(api.byText('[role="tab"]', 'Generate'));
      assert.equal(
        api.container
          .querySelector('[aria-label^="Use Shot 2"]')
          .getAttribute('data-checked'),
        '',
      );
      await api.click(api.byText('button', 'Generate 1 image'));
      assert.equal(service.requests.length, 1);
      assert.equal(
        service.requests[0].references.at(-1).id,
        'continuity-source-v1',
      );
      assert.equal(service.requests[0].references.at(-1).dataUrl, dataUrl);
      assert.match(
        service.requests[0].references.at(-1).name,
        /Shot 2 · Panel 1 — Start frame/,
      );
      service.complete();
      await api.wait(100);
    },
    { fetch: service.fetch },
  );
});

test('missing and over-limit previous-panel references cannot start a paid request', async () => {
  const service = mockLocalService();
  await withEditor(
    async (api) => {
      const project = await seedReferences(api);
      const shot = project.scenes[0].shots[1];
      const target = {
        id: 'guarded-target',
        title: 'Guarded target',
        framing: '',
        angle: '',
        description: 'A guarded frame.',
        versions: [],
        selectedVersionId: null,
        markers: [],
        arrows: [],
        previousPanelReferences: [
          { panelId: shot.panels[0].id, imageVersionId: 'deleted-version' },
        ],
      };
      shot.panels.push(target);
      await api.unmount();
      await api.writeProject(project);
      await api.mount();
      await api.click(
        [...api.container.querySelectorAll('.sb-panel-tab')].find((item) =>
          item.textContent.includes('Guarded target'),
        ),
      );
      await api.click(api.byText('[role="tab"]', 'Generate'));
      assert.match(
        api.container.textContent,
        /Previous panel image is missing/,
      );
      assert.equal(api.byText('button', 'Generate 1 image').disabled, true);
      assert.equal(service.requests.length, 0);

      await api.click(api.byText('button', 'Remove'));
      await api.unmount();
      const [updated] = await api.readProjects();
      const updatedShot = updated.scenes[0].shots[1];
      updated.references = Array.from({ length: 11 }, (_, index) => ({
        id: `limit-${index}`,
        name: `Limit ${index}`,
        kind: 'style',
        mimeType: 'image/png',
        dataUrl,
      }));
      updatedShot.referenceIds = updated.references.map((item) => item.id);
      await api.writeProject(updated);
      await api.mount();
      await api.click(api.byText('[role="tab"]', 'Generate'));
      assert.match(api.container.textContent, /10-image input limit/);
      assert.equal(api.byText('button', 'Generate 1 image').disabled, true);
      assert.equal(service.requests.length, 0);
    },
    { fetch: service.fetch },
  );
});

test('a new panel starts with a blank required frame direction while quality stays selected', async () => {
  const service = mockLocalService();
  await withEditor(
    async (api) => {
      const project = await seedReferences(api);
      await api.click(api.byText('[role="tab"]', 'Generate'));
      await api.changeSelect(api.field('Quality'), 'high');
      await api.click(api.byText('[role="tab"]', 'Direction'));
      await api.click(api.byText('button', 'Add panel'));
      await api.click(api.byText('[role="tab"]', 'Generate'));

      const frameDirection = api.field('Frame direction');
      assert.equal(frameDirection.value, '');
      assert.equal(api.field('Quality').value, 'high');
      assert.equal(api.byText('button', 'Generate 1 image').disabled, true);
      assert.match(
        api.container.textContent,
        /newly added panel starts blank/i,
      );
      assert.equal(
        api.byText('button', 'Use panel context for this frame'),
        undefined,
      );
      assert.equal(service.requests.length, 0);

      await api.enterText(
        frameDirection,
        'Matilda turns toward the island, seen waist up.',
      );
      await api.click(api.byText('button', 'Generate 1 image'));
      const request = service.requests[0];
      assert.equal(request.preset.quality, 'high');
      assert.notEqual(
        request.origin.panelId,
        project.scenes[0].shots[1].panels[0].id,
      );
      const frameIndex = request.prompt.indexOf(
        'Primary frame direction: Matilda turns toward the island',
      );
      assert.ok(frameIndex >= 0);
      service.complete();
      await api.wait(100);
    },
    { fetch: service.fetch },
  );
});

test('revision includes the current image and preserves a downloadable result if its original shot is deleted', async () => {
  const service = mockLocalService();
  await withEditor(
    async (api) => {
      await seedReferences(api, true);
      await api.click(api.byText('[role="tab"]', 'Generate'));
      await api.changeSelect(api.field('Generation mode'), 'revision');
      await api.enterText(
        api.field('Revision direction'),
        'Move Matilda left.',
      );
      await api.click(api.byText('button', 'Generate 1 revision'));
      assert.equal(service.requests[0].mode, 'revision');
      assert.equal(service.requests[0].currentImage.dataUrl, dataUrl);
      assert.match(service.requests[0].prompt, /Move Matilda left/);
      assert.match(
        service.requests[0].prompt,
        /^Input image 1: current panel image/,
      );
      assert.match(
        service.requests[0].prompt,
        /Input image 2: character — Matilda — Front/,
      );
      await api.click(
        api.container.querySelector('[aria-label="Delete shot"]'),
      );
      await api.click(
        api.byText(
          'button',
          'Delete',
          api.document.querySelector('[role="alertdialog"]'),
        ),
      );
      service.complete();
      await api.wait(100);
      assert.match(
        api.document.querySelector('[role="dialog"]').textContent,
        /File ready to download/,
      );
      assert.equal(api.downloads.at(-1).url, dataUrl);
      assert.match(api.container.textContent, /original panel was removed/);
      await api.wait(850);
      const [saved] = await api.readProjects();
      assert.equal(saved.scenes[0].shots.length, 1);
      assert.equal(saved.scenes[0].shots[0].panels[0].versions.length, 0);
    },
    { fetch: service.fetch },
  );
});

test('generation result is offered as a download after a project save conflict, without replacing newer disk work', async () => {
  const service = mockLocalService();
  await withEditor(
    async (api) => {
      await seedReferences(api);
      await api.click(api.byText('[role="tab"]', 'Generate'));
      await api.click(api.byText('button', 'Generate 1 image'));
      const [external] = await api.readProjects();
      external.updatedAt = new Date(
        Date.parse(external.updatedAt) + 1000,
      ).toISOString();
      external.scenes[0].shots[1].panels[0].dialogue =
        'Newer text saved by another tab.';
      await api.writeProject(external);
      await api.enterText(
        api.container.querySelector('[aria-label="Panel dialogue"]'),
        'Local unsaved direction.',
      );
      await api.wait(850);
      assert.match(api.container.textContent, /Save conflict/);
      service.complete();
      await api.wait(100);
      assert.equal(api.downloads.at(-1).url, dataUrl);
      const [saved] = await api.readProjects();
      assert.equal(
        saved.scenes[0].shots[1].panels[0].dialogue,
        'Newer text saved by another tab.',
      );
      assert.equal(saved.scenes[0].shots[1].panels[0].versions.length, 0);
      assert.equal(
        api.container.querySelector('[aria-label="Panel dialogue"]').value,
        'Local unsaved direction.',
      );
    },
    { fetch: service.fetch },
  );
});

test('an orphaned attempt can become uncertain after refresh without blocking a new explicit request', async () => {
  const service = mockLocalService();
  service.state.usage.push({
    requestId: 'orphaned',
    requestHash: 'test',
    startedAt: new Date().toISOString(),
    status: 'started',
    mode: 'generate',
    preset: { model: 'gpt-image-2.5-flare', quality: 'low', size: '1536x640' },
    origin: { projectId: 'old', sceneId: 'old', shotId: 'old', panelId: 'old' },
    referenceCount: 0,
    hasCurrentImage: false,
  });
  Object.assign(service.state.usageTotals, { attempts: 1, started: 1 });
  await withEditor(
    async (api) => {
      await api.mount();
      await api.click(api.byText('[role="tab"]', 'Generate'));
      assert.equal(api.byText('button', 'Generating…').disabled, true);
      service.state.usage[0].status = 'uncertain';
      Object.assign(service.state.usageTotals, {
        started: 0,
        uncertain: 1,
        unknownCount: 1,
      });
      await api.click(
        api.container.querySelector('[aria-label="Refresh API usage"]'),
      );
      assert.equal(
        api.byText('button', 'Generate another image (new charge)').disabled,
        false,
      );
      assert.ok(api.byText('button', 'Check last result'));
      assert.match(
        api.container.querySelector('.sb-generation-uncertain').textContent,
        /new request may incur another charge/,
      );
      assert.match(
        api.container.textContent,
        /1 attempt have unknown or partial charges/,
      );
      await api.click(
        api.container.querySelector('[aria-label="Recover result orphaned"]'),
      );
      assert.equal(
        service.requests.length,
        0,
        'recovery lookup never submits another paid generation',
      );
    },
    { fetch: service.fetch },
  );
});
