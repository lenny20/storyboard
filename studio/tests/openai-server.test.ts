import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  assertLocalRequest,
  DuplicateGenerationError,
  OpenAiGenerationService,
  OpenAiProxyError,
  readBoundedJson,
  validateGenerationRequest,
} from '../lib/generation/server';
import type { GenerationRequest } from '../lib/generation/types';

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';
const PNG_RESPONSE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]).toString('base64');

function id(): string {
  return crypto.randomUUID();
}

function request(
  overrides: Partial<GenerationRequest> = {},
): GenerationRequest {
  return {
    requestId: id(),
    origin: { projectId: id(), sceneId: id(), shotId: id(), panelId: id() },
    prompt: 'A precise storyboard panel prompt.',
    mode: 'generate',
    preset: { model: 'gpt-image-2.5-flare', quality: 'low', size: '1536x640' },
    references: [],
    ...overrides,
  };
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'storyboard-openai-test-'));
  return {
    directory,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

function response(
  usage: Record<string, unknown> = {
    input_tokens: 12,
    input_tokens_details: { text_tokens: 4, image_tokens: 8 },
    output_tokens: 20,
    total_tokens: 32,
  },
) {
  return new Response(
    JSON.stringify({
      output_format: 'png',
      data: [{ b64_json: PNG_RESPONSE }],
      usage,
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'x-request-id': 'req_provider_123',
      },
    },
  );
}

void test(
  'completed results reach the project folder before return, and folder failure preserves the paid image',
  { concurrency: false },
  async () => {
    const temp = await fixture();
    try {
      const submitted = request();
      const stored: Array<{ projectId: string; dataUrl: string }> = [];
      const service = new OpenAiGenerationService({
        dataDirectory: temp.directory,
        environmentKey: () => 'sk-mocked-folder-test',
        fetchImplementation: async () => response(),
        persistProjectImage: async (projectId, dataUrl) => {
          stored.push({ projectId, dataUrl });
        },
      });
      const result = await service.generate(submitted);
      assert.equal(result.status, 'succeeded');
      assert.deepEqual(stored, [
        {
          projectId: submitted.origin.projectId,
          dataUrl: result.image?.dataUrl,
        },
      ]);
      const failingFolder = new OpenAiGenerationService({
        dataDirectory: temp.directory,
        environmentKey: () => 'sk-mocked-folder-test',
        fetchImplementation: async () => response(),
        persistProjectImage: async () => {
          throw new Error('Disk disconnected');
        },
      });
      const failure = await failingFolder.generate(request());
      assert.equal(failure.status, 'succeeded');
      assert.equal(failure.image?.dataUrl, result.image?.dataUrl);
      assert.match(
        failure.message ?? '',
        /could not be written to the project folder/,
      );
      assert.equal(
        (await failingFolder.recoverResult(failure.requestId))?.image?.dataUrl,
        failure.image?.dataUrl,
      );
    } finally {
      await temp.cleanup();
    }
  },
);

void test(
  'generation sends an allowlisted JSON request and keeps credentials and creative data out of its ledger',
  { concurrency: false },
  async () => {
    const temp = await fixture();
    let endpoint = '';
    let init: RequestInit | undefined;
    try {
      const service = new OpenAiGenerationService({
        dataDirectory: temp.directory,
        environmentKey: () => 'sk-secret-value-never-persisted',
        fetchImplementation: async (url, options) => {
          endpoint =
            typeof url === 'string'
              ? url
              : url instanceof URL
                ? url.href
                : url.url;
          init = options;
          return response();
        },
      });
      const generated = await service.generate(request());
      assert.equal(endpoint, 'https://api.openai.com/v1/images/generations');
      assert.ok(init);
      assert.equal(
        (init.headers as Record<string, string>).Authorization,
        'Bearer sk-secret-value-never-persisted',
      );
      const body = init.body;
      if (typeof body !== 'string')
        assert.fail('Expected a JSON generation request body.');
      assert.deepEqual(JSON.parse(body), {
        model: 'gpt-image-2.5-flare',
        prompt: 'A precise storyboard panel prompt.',
        n: 1,
        quality: 'low',
        size: '1536x640',
        output_format: 'png',
      });
      assert.equal(generated.status, 'succeeded');
      assert.ok(Math.abs((generated.estimatedCost ?? 0) - 0.000684) < 1e-12);
      assert.match(generated.image?.dataUrl ?? '', /^data:image\/png;base64,/);
      const ledger = await readFile(
        join(temp.directory, 'openai-usage.json'),
        'utf8',
      );
      assert.doesNotMatch(
        ledger,
        /sk-secret-value|A precise storyboard panel prompt|iVBORw0KGgo/,
      );
      assert.match(ledger, /req_provider_123/);
    } finally {
      await temp.cleanup();
    }
  },
);

void test(
  'references and the current revision image use the multipart edit endpoint as actual files',
  { concurrency: false },
  async () => {
    const temp = await fixture();
    let endpoint = '';
    let form: FormData | undefined;
    try {
      const service = new OpenAiGenerationService({
        dataDirectory: temp.directory,
        environmentKey: () => 'sk-session-test-key',
        fetchImplementation: async (url, options) => {
          endpoint =
            typeof url === 'string'
              ? url
              : url instanceof URL
                ? url.href
                : url.url;
          form = options?.body as FormData;
          return response();
        },
      });
      const reference = {
        id: id(),
        name: 'matilda-front.png',
        mimeType: 'image/png',
        dataUrl: PNG_DATA_URL,
      };
      const currentImage = {
        id: id(),
        name: 'current-panel.png',
        mimeType: 'image/png',
        dataUrl: PNG_DATA_URL,
      };
      await service.generate(
        request({ mode: 'revision', references: [reference], currentImage }),
      );
      assert.equal(endpoint, 'https://api.openai.com/v1/images/edits');
      assert.equal(form?.get('model'), 'gpt-image-2.5-flare');
      assert.equal(form?.get('prompt'), 'A precise storyboard panel prompt.');
      const images = form?.getAll('image[]') ?? [];
      assert.equal(images.length, 2);
      assert.deepEqual(
        images.map((image) => (image as File).name),
        ['current-panel.png', 'matilda-front.png'],
      );
    } finally {
      await temp.cleanup();
    }
  },
);

void test(
  'a request ID cannot be reused for a different payload and never creates a second paid call',
  { concurrency: false },
  async () => {
    const temp = await fixture();
    let calls = 0;
    try {
      const service = new OpenAiGenerationService({
        dataDirectory: temp.directory,
        environmentKey: () => 'sk-session-test-key',
        fetchImplementation: async () => {
          calls += 1;
          return response();
        },
      });
      const first = request();
      await service.generate(first);
      await assert.rejects(
        service.generate({
          ...first,
          prompt: 'A changed prompt must not receive the first image.',
        }),
        DuplicateGenerationError,
      );
      assert.equal(calls, 1);
    } finally {
      await temp.cleanup();
    }
  },
);

void test(
  'timeouts are uncertain and the same ID is never sent again automatically',
  { concurrency: false },
  async () => {
    const temp = await fixture();
    let calls = 0;
    try {
      const service = new OpenAiGenerationService({
        dataDirectory: temp.directory,
        environmentKey: () => 'sk-session-test-key',
        requestTimeoutMs: 5,
        fetchImplementation: async (_url, options) => {
          calls += 1;
          return new Promise<Response>((_resolve, reject) => {
            options?.signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            );
          });
        },
      });
      const paidRequest = request();
      const result = await service.generate(paidRequest);
      assert.equal(result.status, 'uncertain');
      await assert.rejects(
        service.generate(paidRequest),
        DuplicateGenerationError,
      );
      assert.equal(calls, 1);
    } finally {
      await temp.cleanup();
    }
  },
);

void test(
  'only one paid request can run across service instances at once',
  { concurrency: false },
  async () => {
    const temp = await fixture();
    let release: (() => void) | undefined;
    let started: (() => void) | undefined;
    try {
      const first = new OpenAiGenerationService({
        dataDirectory: temp.directory,
        environmentKey: () => 'sk-session-test-key',
        fetchImplementation: async () =>
          new Promise<Response>((resolve) => {
            started = () => resolve(response());
            release = started;
          }),
      });
      const second = new OpenAiGenerationService({
        dataDirectory: temp.directory,
        environmentKey: () => 'sk-session-test-key',
        fetchImplementation: async () => response(),
      });
      const firstPromise = first.generate(request());
      await new Promise<void>((resolve) => {
        const check = () => (started ? resolve() : setTimeout(check, 1));
        check();
      });
      await assert.rejects(
        second.generate(request()),
        DuplicateGenerationError,
      );
      release?.();
      assert.equal((await firstPromise).status, 'succeeded');
    } finally {
      await temp.cleanup();
    }
  },
);

void test(
  'a completed paid image remains recoverable in RAM when its output directory cannot be created',
  { concurrency: false },
  async () => {
    const temp = await fixture();
    try {
      await mkdir(temp.directory, { recursive: true });
      await writeFile(
        join(temp.directory, 'openai-results'),
        'not a directory',
      );
      const service = new OpenAiGenerationService({
        dataDirectory: temp.directory,
        environmentKey: () => 'sk-session-test-key',
        fetchImplementation: async () => response(),
      });
      const paidRequest = request();
      const result = await service.generate(paidRequest);
      assert.equal(result.status, 'succeeded');
      assert.match(
        result.message ?? '',
        /retained until this local server stops/,
      );
      const recovered = await service.recoverResult(paidRequest.requestId);
      assert.equal(recovered?.image?.dataUrl, result.image?.dataUrl);
    } finally {
      await temp.cleanup();
    }
  },
);

void test(
  'a retained image still recovers when a fresh service cannot read its corrupt ledger',
  { concurrency: false },
  async () => {
    const temp = await fixture();
    try {
      const paidRequest = request();
      const writer = new OpenAiGenerationService({
        dataDirectory: temp.directory,
        environmentKey: () => 'sk-session-test-key',
        fetchImplementation: async () => response(),
      });
      await writer.generate(paidRequest);
      await writeFile(join(temp.directory, 'openai-usage.json'), '{not-json');
      const internals = writer as unknown as {
        state: {
          recoveries: Map<string, unknown>;
          completed: Map<string, unknown>;
        };
      };
      internals.state.recoveries.clear();
      internals.state.completed.clear();
      const restarted = new OpenAiGenerationService({
        dataDirectory: temp.directory,
        environmentKey: () => undefined,
      });
      const recovered = await restarted.recoverResult(paidRequest.requestId);
      assert.match(recovered?.image?.dataUrl ?? '', /^data:image\/png;base64,/);
      assert.match(recovered?.message ?? '', /usage ledger could not be read/);
    } finally {
      await temp.cleanup();
    }
  },
);

void test(
  'invalid provider image bytes become uncertain rather than a successful panel image',
  { concurrency: false },
  async () => {
    const temp = await fixture();
    try {
      const service = new OpenAiGenerationService({
        dataDirectory: temp.directory,
        environmentKey: () => 'sk-session-test-key',
        fetchImplementation: async () =>
          new Response(
            JSON.stringify({
              output_format: 'png',
              data: [{ b64_json: Buffer.from('not a png').toString('base64') }],
            }),
            { status: 200 },
          ),
      });
      assert.equal((await service.generate(request())).status, 'uncertain');
    } finally {
      await temp.cleanup();
    }
  },
);

void test(
  'a valid PNG response without optional output metadata remains successful',
  { concurrency: false },
  async () => {
    const temp = await fixture();
    try {
      const service = new OpenAiGenerationService({
        dataDirectory: temp.directory,
        environmentKey: () => 'sk-session-test-key',
        fetchImplementation: async () =>
          new Response(JSON.stringify({ data: [{ b64_json: PNG_RESPONSE }] }), {
            status: 200,
          }),
      });
      const result = await service.generate(request());
      assert.equal(result.status, 'succeeded');
      assert.equal(result.image?.mimeType, 'image/png');
    } finally {
      await temp.cleanup();
    }
  },
);

void test(
  'ledger pruning preserves lifetime cost and count totals',
  { concurrency: false },
  async () => {
    const temp = await fixture();
    try {
      const template = request();
      const entries = Array.from({ length: 500 }, () => ({
        requestId: id(),
        requestHash: 'historic-request',
        startedAt: '2026-01-01T00:00:00.000Z',
        finishedAt: '2026-01-01T00:00:01.000Z',
        status: 'succeeded' as const,
        mode: template.mode,
        preset: template.preset,
        origin: template.origin,
        referenceCount: 0,
        hasCurrentImage: false,
        estimatedCost: 1,
      }));
      await writeFile(
        join(temp.directory, 'openai-usage.json'),
        JSON.stringify({
          version: 1,
          entries,
          totals: {
            attempts: 0,
            succeeded: 0,
            uncertain: 0,
            failed: 0,
            started: 0,
            knownCost: 0,
            knownCount: 0,
            unknownCount: 0,
          },
        }),
      );
      const service = new OpenAiGenerationService({
        dataDirectory: temp.directory,
        environmentKey: () => 'sk-session-test-key',
        fetchImplementation: async () => response(),
      });
      await service.generate(request());
      const totals = await service.usageTotals();
      assert.equal(totals.attempts, 501);
      assert.equal(totals.succeeded, 501);
      assert.equal(totals.knownCount, 501);
      assert.ok(Math.abs(totals.knownCost - 500.000684) < 1e-12);
    } finally {
      await temp.cleanup();
    }
  },
);

void test(
  'a started ledger record from a prior server process is reported as uncertain',
  { concurrency: false },
  async () => {
    const temp = await fixture();
    try {
      const historic = request();
      await writeFile(
        join(temp.directory, 'openai-usage.json'),
        JSON.stringify({
          version: 1,
          entries: [
            {
              requestId: historic.requestId,
              requestHash: 'historic-request',
              startedAt: '2026-01-01T00:00:00.000Z',
              status: 'started',
              mode: historic.mode,
              preset: historic.preset,
              origin: historic.origin,
              referenceCount: 0,
              hasCurrentImage: false,
            },
          ],
          totals: {
            attempts: 0,
            succeeded: 0,
            uncertain: 0,
            failed: 0,
            started: 0,
            knownCost: 0,
            knownCount: 0,
            unknownCount: 0,
          },
        }),
      );
      const service = new OpenAiGenerationService({
        dataDirectory: temp.directory,
        environmentKey: () => undefined,
      });
      assert.equal((await service.usage())[0].status, 'uncertain');
      assert.equal(
        JSON.parse(
          await readFile(join(temp.directory, 'openai-usage.json'), 'utf8'),
        ).entries[0].status,
        'uncertain',
      );
      assert.equal((await service.usageTotals()).uncertain, 1);
      assert.equal((await service.usageTotals()).started, 0);
    } finally {
      await temp.cleanup();
    }
  },
);

void test('local routes require loopback host, same-origin JSON posts, and bounded valid data', async () => {
  assert.throws(
    () =>
      assertLocalRequest(
        new Request('http://evil.example/api', {
          headers: { host: 'evil.example' },
        }),
        false,
      ),
    OpenAiProxyError,
  );
  assert.throws(
    () =>
      assertLocalRequest(
        new Request('http://127.0.0.1:4317/api', {
          method: 'POST',
          headers: { host: '127.0.0.1:4317' },
        }),
        true,
      ),
    OpenAiProxyError,
  );
  const body = JSON.stringify({ okay: true });
  const parsed = await readBoundedJson(
    new Request('http://127.0.0.1:4317/api', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    }),
  );
  assert.deepEqual(parsed, { okay: true });
  await assert.rejects(
    readBoundedJson(
      new Request('http://127.0.0.1:4317/api', {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body,
      }),
    ),
    OpenAiProxyError,
  );
  assert.throws(
    () =>
      validateGenerationRequest({
        ...request(),
        preset: { model: 'anything', quality: 'ultra', size: 'tiny' },
      }),
    OpenAiProxyError,
  );
});
