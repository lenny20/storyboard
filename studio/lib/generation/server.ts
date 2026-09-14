import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

import {
  GENERATION_MODELS,
  GENERATION_QUALITIES,
  GENERATION_SIZES,
  type GenerationInputImage,
  type GenerationPreset,
  type GenerationRequest,
  type GenerationResult,
  type GenerationUsage,
  type OpenAiConnectionStatus,
  type UsageLedgerEntry,
  type UsageLedgerTotals,
} from './types';
import { estimateGenerationCost } from './pricing';
import { persistGeneratedImage } from '../projects/server';

export const MAX_GENERATION_REQUEST_BYTES = 100 * 1024 * 1024;
export const MAX_GENERATION_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_GENERATION_IMAGES = 10;
const REQUEST_TIMEOUT_MS = 180_000;
const RESTARTED_REQUEST_ERROR =
  'The local server restarted before this request was confirmed.';
const MAX_LEDGER_ENTRIES = 500;
const MAX_RECOVERY_FILES = 25;
const MAX_RECOVERY_BYTES = 250 * 1024 * 1024;
const INPUT_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
]);
const OUTPUT_FORMATS = new Set(['png', 'jpeg', 'webp']);
const IDENTIFIER = /^[a-zA-Z0-9_-]{1,128}$/;
const REQUEST_IDENTIFIER = /^[a-zA-Z0-9_-]{8,128}$/;
const BASE64_DATA_URL = /^data:([^;,\s]+);base64,([A-Za-z0-9+/]*={0,2})$/i;

export class OpenAiProxyError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly providerRequestId?: string,
  ) {
    super(message);
    this.name = 'OpenAiProxyError';
  }
}

export class DuplicateGenerationError extends OpenAiProxyError {
  constructor(message: string) {
    super(message, 409);
    this.name = 'DuplicateGenerationError';
  }
}

type PersistedLedger = {
  version: 1;
  entries: UsageLedgerEntry[];
  totals: UsageLedgerTotals;
};
type RecoveryMetadata = { mimeType: string; path?: string; bytes?: Uint8Array };
type SharedState = {
  sessionApiKey: string | null;
  inFlight: Map<string, string>;
  activeRequestId: string | null;
  recoveries: Map<string, RecoveryMetadata>;
  completed: Map<string, { requestHash: string; entry: UsageLedgerEntry }>;
  writeQueue: Promise<void>;
};

const STATE_KEY = Symbol.for('storyboard.openai-image-proxy.state');

function sharedState(): SharedState {
  const globalWithState = globalThis as typeof globalThis & {
    [STATE_KEY]?: SharedState;
  };
  const existing = globalWithState[STATE_KEY];
  if (existing) return existing;
  const created: SharedState = {
    sessionApiKey: null,
    inFlight: new Map(),
    activeRequestId: null,
    recoveries: new Map(),
    completed: new Map(),
    writeQueue: Promise.resolve(),
  };
  globalWithState[STATE_KEY] = created;
  return created;
}

export type ServerFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type OpenAiGenerationServiceOptions = {
  dataDirectory?: string;
  fetchImplementation?: ServerFetch;
  environmentKey?: () => string | undefined;
  estimateCost?: (
    preset: GenerationPreset,
    usage: GenerationUsage,
  ) => number | null;
  requestTimeoutMs?: number;
  persistProjectImage?: (
    projectId: string,
    dataUrl: string,
  ) => Promise<unknown>;
};

type ValidatedImage = GenerationInputImage & { bytes: Uint8Array };
type ValidatedRequest = Omit<
  GenerationRequest,
  'references' | 'currentImage'
> & {
  references: ValidatedImage[];
  currentImage?: ValidatedImage;
};

function isOneOf<T extends readonly string[]>(
  value: unknown,
  allowed: T,
): value is T[number] {
  return (
    typeof value === 'string' && (allowed as readonly string[]).includes(value)
  );
}

function requiredIdentifier(
  value: unknown,
  name: string,
  requestId = false,
): string {
  const expression = requestId ? REQUEST_IDENTIFIER : IDENTIFIER;
  if (typeof value !== 'string' || !expression.test(value)) {
    throw new OpenAiProxyError(
      `${name} must use only letters, numbers, underscores, or hyphens.`,
    );
  }
  return value;
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new OpenAiProxyError(`${name} must be an object.`);
  return value as Record<string, unknown>;
}

function decodedSize(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return (base64.length / 4) * 3 - padding;
}

function decodeInputImage(value: unknown, name: string): ValidatedImage {
  const candidate = record(value, name);
  const id = requiredIdentifier(candidate.id, `${name}.id`);
  if (typeof candidate.name !== 'string' || candidate.name.length > 160) {
    throw new OpenAiProxyError(`${name}.name must be a short filename.`);
  }
  if (
    typeof candidate.mimeType !== 'string' ||
    !INPUT_IMAGE_MIME_TYPES.has(candidate.mimeType)
  ) {
    throw new OpenAiProxyError(`${name}.mimeType must be PNG, JPEG, or WebP.`);
  }
  if (typeof candidate.dataUrl !== 'string')
    throw new OpenAiProxyError(`${name}.dataUrl must be an image data URL.`);
  const match = candidate.dataUrl.match(BASE64_DATA_URL);
  if (!match || match[1].toLowerCase() !== candidate.mimeType.toLowerCase()) {
    throw new OpenAiProxyError(
      `${name}.dataUrl must be matching base64 ${candidate.mimeType} data.`,
    );
  }
  if (decodedSize(match[2]) > MAX_GENERATION_IMAGE_BYTES) {
    throw new OpenAiProxyError(
      `${name} is larger than the 20 MB image limit.`,
      413,
    );
  }
  const bytes = Uint8Array.from(Buffer.from(match[2], 'base64'));
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_GENERATION_IMAGE_BYTES) {
    throw new OpenAiProxyError(`${name} has invalid image data.`, 413);
  }
  return {
    id,
    name: candidate.name,
    mimeType: candidate.mimeType,
    dataUrl: candidate.dataUrl,
    bytes,
  };
}

/** Parses only the fields this proxy understands; callers must not pass arbitrary OpenAI parameters. */
export function validateGenerationRequest(value: unknown): ValidatedRequest {
  const candidate = record(value, 'request');
  const origin = record(candidate.origin, 'request.origin');
  if (
    typeof candidate.prompt !== 'string' ||
    !candidate.prompt.trim() ||
    candidate.prompt.length > 32_000
  ) {
    throw new OpenAiProxyError('prompt must contain up to 32,000 characters.');
  }
  if (candidate.mode !== 'generate' && candidate.mode !== 'revision') {
    throw new OpenAiProxyError('mode must be generate or revision.');
  }
  const preset = record(candidate.preset, 'request.preset');
  if (
    !isOneOf(preset.model, GENERATION_MODELS) ||
    !isOneOf(preset.quality, GENERATION_QUALITIES) ||
    !isOneOf(preset.size, GENERATION_SIZES)
  ) {
    throw new OpenAiProxyError(
      'Choose one of the available model, quality, and size presets.',
    );
  }
  if (
    !Array.isArray(candidate.references) ||
    candidate.references.length > MAX_GENERATION_IMAGES
  ) {
    throw new OpenAiProxyError(
      `references must contain at most ${MAX_GENERATION_IMAGES} images.`,
    );
  }
  const references = candidate.references.map((image, index) =>
    decodeInputImage(image, `references[${index}]`),
  );
  const currentImage =
    candidate.currentImage === undefined
      ? undefined
      : decodeInputImage(candidate.currentImage, 'currentImage');
  if (candidate.mode === 'revision' && !currentImage) {
    throw new OpenAiProxyError(
      'A revision needs the selected current panel image.',
    );
  }
  if (references.length + (currentImage ? 1 : 0) > MAX_GENERATION_IMAGES) {
    throw new OpenAiProxyError(
      `A request can include at most ${MAX_GENERATION_IMAGES} images.`,
    );
  }
  return {
    requestId: requiredIdentifier(candidate.requestId, 'requestId', true),
    origin: {
      projectId: requiredIdentifier(origin.projectId, 'origin.projectId'),
      sceneId: requiredIdentifier(origin.sceneId, 'origin.sceneId'),
      shotId: requiredIdentifier(origin.shotId, 'origin.shotId'),
      panelId: requiredIdentifier(origin.panelId, 'origin.panelId'),
    },
    prompt: candidate.prompt,
    mode: candidate.mode,
    preset: { model: preset.model, quality: preset.quality, size: preset.size },
    references,
    currentImage,
  };
}

function requestHash(request: ValidatedRequest): string {
  const hash = createHash('sha256');
  hash
    .update(request.mode)
    .update('\0')
    .update(request.preset.model)
    .update('\0')
    .update(request.preset.quality)
    .update('\0')
    .update(request.preset.size)
    .update('\0');
  hash
    .update(request.origin.projectId)
    .update('\0')
    .update(request.origin.sceneId)
    .update('\0')
    .update(request.origin.shotId)
    .update('\0')
    .update(request.origin.panelId)
    .update('\0');
  hash.update(request.prompt);
  for (const image of [
    ...request.references,
    ...(request.currentImage ? [request.currentImage] : []),
  ]) {
    hash
      .update('\0')
      .update(image.id)
      .update('\0')
      .update(image.mimeType)
      .update('\0')
      .update(image.dataUrl);
  }
  return hash.digest('hex');
}

function emptyTotals(): UsageLedgerTotals {
  return {
    attempts: 0,
    succeeded: 0,
    uncertain: 0,
    failed: 0,
    started: 0,
    knownCost: 0,
    knownCount: 0,
    unknownCount: 0,
  };
}

function addToTotals(totals: UsageLedgerTotals, entry: UsageLedgerEntry): void {
  totals.attempts += 1;
  if (entry.status === 'succeeded') totals.succeeded += 1;
  if (entry.status === 'uncertain') totals.uncertain += 1;
  if (entry.status === 'failed') totals.failed += 1;
  if (entry.status === 'started') totals.started += 1;
  if (entry.status === 'succeeded' || entry.status === 'uncertain') {
    if (
      typeof entry.estimatedCost === 'number' &&
      Number.isFinite(entry.estimatedCost)
    ) {
      totals.knownCost += entry.estimatedCost;
      totals.knownCount += 1;
    } else totals.unknownCount += 1;
  }
}

export async function readBoundedJson(request: Request): Promise<unknown> {
  const contentType = request.headers
    .get('content-type')
    ?.split(';', 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== 'application/json')
    throw new OpenAiProxyError('The request must use application/json.', 415);
  const contentLength = request.headers.get('content-length');
  if (
    contentLength &&
    (!/^\d+$/.test(contentLength) ||
      Number(contentLength) > MAX_GENERATION_REQUEST_BYTES)
  ) {
    throw new OpenAiProxyError(
      'The generation request is larger than 100 MB.',
      413,
    );
  }
  if (!request.body)
    throw new OpenAiProxyError('The generation request must include JSON.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > MAX_GENERATION_REQUEST_BYTES) {
        await reader.cancel();
        throw new OpenAiProxyError(
          'The generation request is larger than 100 MB.',
          413,
        );
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  chunks.forEach((chunk) => {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  });
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new OpenAiProxyError('The generation request must be valid JSON.');
  }
}

export function assertLocalRequest(
  request: Request,
  requireOrigin: boolean,
): void {
  const host = request.headers.get('host');
  if (!host)
    throw new OpenAiProxyError(
      'This local endpoint requires a loopback Host header.',
      403,
    );
  let hostUrl: URL;
  try {
    hostUrl = new URL(`http://${host}`);
  } catch {
    throw new OpenAiProxyError('Invalid Host header.', 403);
  }
  const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
  if (!loopbackHosts.has(hostUrl.hostname))
    throw new OpenAiProxyError(
      'This endpoint only accepts loopback requests.',
      403,
    );
  if (!requireOrigin) return;
  const origin = request.headers.get('origin');
  if (!origin)
    throw new OpenAiProxyError(
      'This local endpoint requires a same-origin request.',
      403,
    );
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    throw new OpenAiProxyError('Invalid Origin header.', 403);
  }
  if (originUrl.protocol !== 'http:' || originUrl.host !== host) {
    throw new OpenAiProxyError(
      'This endpoint only accepts same-origin loopback requests.',
      403,
    );
  }
}

function safeError(error: unknown): string {
  const detail = error instanceof Error ? error.message : 'unknown error';
  return detail
    .replace(/\b(?:sk|sess)-[A-Za-z0-9_-]+\b/g, '[redacted]')
    .slice(0, 240);
}

function apiKeyFromEnvironment(): string | undefined {
  const key = process.env.OPENAI_API_KEY?.trim();
  return key || undefined;
}

function imageDataUrl(mimeType: string, bytes: Uint8Array): string {
  return `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`;
}

function hasImageSignature(format: string, bytes: Uint8Array): boolean {
  if (format === 'png')
    return (
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  if (format === 'jpeg')
    return (
      bytes.length >= 3 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff
    );
  return (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  );
}

function extractUsage(value: unknown): GenerationUsage | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const usage = value as Record<string, unknown>;
  const number = (entry: unknown) =>
    typeof entry === 'number' && Number.isFinite(entry) ? entry : undefined;
  const inputDetails =
    usage.input_tokens_details && typeof usage.input_tokens_details === 'object'
      ? (usage.input_tokens_details as Record<string, unknown>)
      : {};
  const result: GenerationUsage = {
    inputTokens: number(usage.input_tokens),
    inputImageTokens: number(inputDetails.image_tokens),
    inputTextTokens: number(inputDetails.text_tokens),
    cachedInputImageTokens: number(inputDetails.cached_image_tokens),
    cachedInputTextTokens: number(inputDetails.cached_text_tokens),
    outputTokens: number(usage.output_tokens),
    totalTokens: number(usage.total_tokens),
  };
  return Object.values(result).some((entry) => entry !== undefined)
    ? result
    : undefined;
}

function parseOpenAiImage(value: unknown): {
  bytes: Uint8Array;
  mimeType: string;
  usage?: GenerationUsage;
} {
  if (!value || typeof value !== 'object')
    throw new OpenAiProxyError(
      'OpenAI returned an invalid image response.',
      502,
    );
  const response = value as Record<string, unknown>;
  const data = response.data;
  if (
    !Array.isArray(data) ||
    data.length !== 1 ||
    !data[0] ||
    typeof data[0] !== 'object'
  ) {
    throw new OpenAiProxyError('OpenAI did not return exactly one image.', 502);
  }
  const base64 = (data[0] as Record<string, unknown>).b64_json;
  const format =
    response.output_format === undefined ? 'png' : response.output_format;
  if (
    typeof format !== 'string' ||
    !OUTPUT_FORMATS.has(format) ||
    typeof base64 !== 'string' ||
    base64.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)
  ) {
    throw new OpenAiProxyError(
      'OpenAI did not return portable image data.',
      502,
    );
  }
  const bytes = Uint8Array.from(Buffer.from(base64, 'base64'));
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > MAX_GENERATION_IMAGE_BYTES ||
    !hasImageSignature(format, bytes)
  ) {
    throw new OpenAiProxyError('OpenAI returned invalid image data.', 502);
  }
  return {
    bytes,
    mimeType: `image/${format}`,
    usage: extractUsage(response.usage),
  };
}

export class OpenAiGenerationService {
  private readonly state = sharedState();
  private readonly dataDirectory: string;
  private readonly resultsDirectory: string;
  private readonly ledgerPath: string;
  private readonly fetchImplementation: ServerFetch;
  private readonly environmentKey: () => string | undefined;
  private readonly estimateCost: (
    preset: GenerationPreset,
    usage: GenerationUsage,
  ) => number | null;
  private readonly requestTimeoutMs: number;
  private readonly persistProjectImage: (
    projectId: string,
    dataUrl: string,
  ) => Promise<unknown>;

  constructor(options: OpenAiGenerationServiceOptions = {}) {
    this.dataDirectory = resolve(
      options.dataDirectory ?? join(process.cwd(), '.local-data'),
    );
    this.resultsDirectory = join(this.dataDirectory, 'openai-results');
    this.ledgerPath = join(this.dataDirectory, 'openai-usage.json');
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.environmentKey = options.environmentKey ?? apiKeyFromEnvironment;
    this.estimateCost = options.estimateCost ?? estimateGenerationCost;
    this.requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
    this.persistProjectImage =
      options.persistProjectImage ?? persistGeneratedImage;
  }

  connectionStatus(): OpenAiConnectionStatus {
    return this.environmentKey()
      ? { configured: true, keySource: 'environment' }
      : this.state.sessionApiKey
        ? { configured: true, keySource: 'session' }
        : { configured: false, keySource: null };
  }

  setSessionKey(apiKey: unknown): OpenAiConnectionStatus {
    if (
      typeof apiKey !== 'string' ||
      apiKey.trim().length < 16 ||
      apiKey.length > 512
    ) {
      throw new OpenAiProxyError('Enter a valid OpenAI API key.');
    }
    this.state.sessionApiKey = apiKey.trim();
    return this.connectionStatus();
  }

  clearSessionKey(): OpenAiConnectionStatus {
    this.state.sessionApiKey = null;
    return this.connectionStatus();
  }

  async usage(): Promise<UsageLedgerEntry[]> {
    const ledger = await this.readLedger();
    const orphaned = ledger.entries.filter(
      (entry) => entry.error === RESTARTED_REQUEST_ERROR,
    );
    if (orphaned.length > 0)
      await Promise.all(orphaned.map((entry) => this.upsertLedger(entry)));
    return ledger.entries;
  }

  async usageTotals(): Promise<UsageLedgerTotals> {
    const ledger = await this.readLedger();
    const totals = { ...ledger.totals };
    ledger.entries.forEach((entry) => addToTotals(totals, entry));
    return totals;
  }

  async generate(rawRequest: unknown): Promise<GenerationResult> {
    const request = validateGenerationRequest(rawRequest);
    const hash = requestHash(request);
    const existing = (await this.readLedger()).entries.find(
      (entry) => entry.requestId === request.requestId,
    );
    if (existing) {
      if (existing.requestHash && existing.requestHash !== hash)
        throw new DuplicateGenerationError(
          'This request ID belongs to a different image request. Start a new request.',
        );
      return this.existingRequestResult(existing);
    }
    const completed = this.state.completed.get(request.requestId);
    if (completed) {
      if (completed.requestHash !== hash)
        throw new DuplicateGenerationError(
          'This request ID belongs to a different image request. Start a new request.',
        );
      return this.existingRequestResult(completed.entry);
    }
    const inFlightHash = this.state.inFlight.get(request.requestId);
    if (inFlightHash) {
      if (inFlightHash !== hash)
        throw new DuplicateGenerationError(
          'This request ID belongs to a different image request. Start a new request.',
        );
      throw new DuplicateGenerationError(
        'This generation request is already running. Wait for it or recover its result.',
      );
    }
    if (this.state.activeRequestId) {
      throw new DuplicateGenerationError(
        'Another image generation is already running. Wait for it before starting a new paid request.',
      );
    }
    const apiKey = this.environmentKey() ?? this.state.sessionApiKey;
    if (!apiKey)
      throw new OpenAiProxyError(
        'Connect an OpenAI API key before generating an image.',
        401,
      );

    this.state.inFlight.set(request.requestId, hash);
    this.state.activeRequestId = request.requestId;
    const started: UsageLedgerEntry = {
      requestId: request.requestId,
      requestHash: hash,
      startedAt: new Date().toISOString(),
      status: 'started',
      mode: request.mode,
      preset: request.preset,
      origin: request.origin,
      referenceCount: request.references.length,
      hasCurrentImage: Boolean(request.currentImage),
    };
    try {
      await this.upsertLedger(started);
      const response = await this.requestImage(apiKey, request);
      let parsed: ReturnType<typeof parseOpenAiImage>;
      try {
        parsed = parseOpenAiImage(response.body);
      } catch (error) {
        if (error instanceof OpenAiProxyError)
          throw new OpenAiProxyError(
            error.message,
            error.status,
            response.providerRequestId,
          );
        throw error;
      }
      const recovery = await this.storeRecovery(
        request.requestId,
        parsed.mimeType,
        parsed.bytes,
      );
      const dataUrl = imageDataUrl(parsed.mimeType, parsed.bytes);
      const warnings = recovery.warning ? [recovery.warning] : [];
      try {
        await this.persistProjectImage(request.origin.projectId, dataUrl);
      } catch {
        warnings.push(
          'The image completed, but could not be written to the project folder. Keep the image using Download result and check that the folder is available.',
        );
      }
      const estimatedCost = parsed.usage
        ? this.estimateCost(request.preset, parsed.usage)
        : null;
      const succeeded: UsageLedgerEntry = {
        ...started,
        status: 'succeeded',
        finishedAt: new Date().toISOString(),
        usage: parsed.usage,
        estimatedCost,
        providerRequestId: response.providerRequestId,
      };
      this.state.completed.set(request.requestId, {
        requestHash: hash,
        entry: succeeded,
      });
      const result: GenerationResult = {
        requestId: request.requestId,
        status: 'succeeded',
        image: { mimeType: parsed.mimeType, dataUrl },
        recoveryUrl: recovery.url,
        usage: parsed.usage,
        estimatedCost,
      };
      try {
        await this.upsertLedger(succeeded);
      } catch {
        // The paid image is safely retained before the ledger write; return it instead of losing it.
        return {
          ...result,
          message: [...warnings, 'The usage ledger could not be updated.'].join(
            ' ',
          ),
        };
      }
      return warnings.length
        ? { ...result, message: warnings.join(' ') }
        : result;
    } catch (error) {
      if (error instanceof OpenAiProxyError && error.status !== 502) {
        await this.upsertLedger({
          ...started,
          status: 'failed',
          finishedAt: new Date().toISOString(),
          providerRequestId: error.providerRequestId,
          error: safeError(error),
        });
        throw error;
      }
      const uncertain: GenerationResult = {
        requestId: request.requestId,
        status: 'uncertain',
        message:
          'The image request may have reached OpenAI, but its result was not confirmed. It was not retried to avoid a duplicate charge.',
      };
      try {
        await this.upsertLedger({
          ...started,
          status: 'uncertain',
          finishedAt: new Date().toISOString(),
          providerRequestId:
            error instanceof OpenAiProxyError
              ? error.providerRequestId
              : undefined,
          error: safeError(error),
        });
      } catch {
        // The in-memory request ID remains blocked for this server lifetime.
      }
      return uncertain;
    } finally {
      this.state.inFlight.delete(request.requestId);
      if (this.state.activeRequestId === request.requestId)
        this.state.activeRequestId = null;
    }
  }

  async getRecovery(
    requestId: string,
  ): Promise<{ mimeType: string; bytes: Uint8Array } | null> {
    requiredIdentifier(requestId, 'requestId', true);
    const metadata =
      this.state.recoveries.get(requestId) ??
      (await this.recoveryMetadataFromDisk(requestId));
    if (!metadata) return null;
    try {
      if (metadata.bytes)
        return { mimeType: metadata.mimeType, bytes: metadata.bytes.slice() };
      if (!metadata.path) return null;
      return {
        mimeType: metadata.mimeType,
        bytes: new Uint8Array(await readFile(metadata.path)),
      };
    } catch {
      return null;
    }
  }

  async recoverResult(requestId: string): Promise<GenerationResult | null> {
    const recovered = await this.getRecovery(requestId);
    if (!recovered) return null;
    let entry = this.state.completed.get(requestId)?.entry;
    let message: string | undefined;
    if (!entry) {
      try {
        entry = (await this.readLedger()).entries.find(
          (candidate) => candidate.requestId === requestId,
        );
      } catch {
        message =
          'Image recovered locally, but its usage ledger could not be read.';
      }
    }
    return {
      requestId,
      status: 'succeeded',
      image: {
        mimeType: recovered.mimeType,
        dataUrl: imageDataUrl(recovered.mimeType, recovered.bytes),
      },
      recoveryUrl: `/api/openai/results/${encodeURIComponent(requestId)}`,
      usage: entry?.usage,
      estimatedCost: entry?.estimatedCost,
      message,
    };
  }

  private async existingRequestResult(
    entry: UsageLedgerEntry,
  ): Promise<GenerationResult> {
    if (entry.status === 'succeeded') {
      const recovered = await this.getRecovery(entry.requestId);
      if (recovered) {
        return {
          requestId: entry.requestId,
          status: 'succeeded',
          image: {
            mimeType: recovered.mimeType,
            dataUrl: imageDataUrl(recovered.mimeType, recovered.bytes),
          },
          recoveryUrl: `/api/openai/results/${encodeURIComponent(entry.requestId)}`,
          usage: entry.usage,
          estimatedCost: entry.estimatedCost,
        };
      }
      throw new DuplicateGenerationError(
        'This request already succeeded, but its retained result has expired. It was not sent again.',
      );
    }
    if (entry.status === 'uncertain' || entry.status === 'started') {
      throw new DuplicateGenerationError(
        'This request has an uncertain result and was not sent again to avoid a duplicate charge.',
      );
    }
    throw new DuplicateGenerationError(
      'This request ID was already used. Start a new request instead of retrying automatically.',
    );
  }

  private async requestImage(
    apiKey: string,
    request: ValidatedRequest,
  ): Promise<{ body: unknown; providerRequestId?: string }> {
    // The current artwork is the edit base. Reference files follow in the same
    // resolved order that the exact prompt lists them.
    const images = [
      ...(request.currentImage ? [request.currentImage] : []),
      ...request.references,
    ];
    const endpoint =
      images.length > 0
        ? 'https://api.openai.com/v1/images/edits'
        : 'https://api.openai.com/v1/images/generations';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const init: RequestInit =
        images.length > 0
          ? {
              method: 'POST',
              headers: { Authorization: `Bearer ${apiKey}` },
              body: this.editForm(request, images),
              signal: controller.signal,
            }
          : {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model: request.preset.model,
                prompt: request.prompt,
                n: 1,
                quality: request.preset.quality,
                size: request.preset.size,
                output_format: 'png',
              }),
              signal: controller.signal,
            };
      const response = await this.fetchImplementation(endpoint, init);
      const providerRequestId =
        response.headers.get('x-request-id') ?? undefined;
      if (!response.ok) {
        const message =
          response.status === 401
            ? 'OpenAI did not accept the configured API key.'
            : response.status === 429
              ? 'OpenAI is rate-limiting image requests. Wait before starting a new request.'
              : response.status >= 400 && response.status < 500
                ? 'OpenAI rejected this image request. It was not retried.'
                : 'OpenAI did not confirm this image request. Its charge status is uncertain.';
        throw new OpenAiProxyError(
          message,
          response.status >= 500 ? 502 : 400,
          providerRequestId,
        );
      }
      try {
        return { body: await response.json(), providerRequestId };
      } catch {
        throw new OpenAiProxyError(
          'OpenAI returned an unreadable response. The request was not retried.',
          502,
          providerRequestId,
        );
      }
    } catch (error) {
      if (error instanceof OpenAiProxyError) throw error;
      if (controller.signal.aborted)
        throw new OpenAiProxyError(
          'The image request timed out. Its charge status is uncertain.',
          502,
        );
      throw new OpenAiProxyError(
        'The image request did not complete. Its charge status is uncertain.',
        502,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private editForm(
    request: ValidatedRequest,
    images: ValidatedImage[],
  ): FormData {
    const form = new FormData();
    form.set('model', request.preset.model);
    form.set('prompt', request.prompt);
    form.set('n', '1');
    form.set('quality', request.preset.quality);
    form.set('size', request.preset.size);
    form.set('output_format', 'png');
    images.forEach((image) => {
      const bytes = new Uint8Array(image.bytes.byteLength);
      bytes.set(image.bytes);
      form.append(
        'image[]',
        new Blob([bytes.buffer], { type: image.mimeType }),
        image.name || `${image.id}.png`,
      );
    });
    return form;
  }

  private async readLedger(): Promise<PersistedLedger> {
    try {
      const parsed: unknown = JSON.parse(
        await readFile(this.ledgerPath, 'utf8'),
      );
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        (parsed as { version?: unknown }).version !== 1 ||
        !Array.isArray((parsed as { entries?: unknown }).entries)
      ) {
        throw new Error('Invalid ledger shape.');
      }
      const legacy = parsed as Partial<PersistedLedger>;
      const totals =
        legacy.totals && typeof legacy.totals === 'object'
          ? { ...emptyTotals(), ...legacy.totals }
          : emptyTotals();
      const entries = (legacy.entries ?? [])
        .filter((entry) => entry && typeof entry.requestId === 'string')
        .map((entry) =>
          entry.status === 'started' &&
          !this.state.inFlight.has(entry.requestId)
            ? {
                ...entry,
                status: 'uncertain' as const,
                finishedAt: entry.finishedAt ?? new Date().toISOString(),
                error: RESTARTED_REQUEST_ERROR,
              }
            : entry,
        );
      return { version: 1, totals, entries };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { version: 1, entries: [], totals: emptyTotals() };
      throw new OpenAiProxyError(
        'The local usage ledger could not be read. Generation was not started.',
        500,
      );
    }
  }

  private async upsertLedger(entry: UsageLedgerEntry): Promise<void> {
    this.state.writeQueue = this.state.writeQueue
      .catch(() => undefined)
      .then(async () => {
        const ledger = await this.readLedger();
        const index = ledger.entries.findIndex(
          (candidate) => candidate.requestId === entry.requestId,
        );
        if (index === -1) ledger.entries.push(entry);
        else ledger.entries[index] = entry;
        const pruned = ledger.entries.slice(
          0,
          Math.max(0, ledger.entries.length - MAX_LEDGER_ENTRIES),
        );
        pruned.forEach((removed) => addToTotals(ledger.totals, removed));
        ledger.entries = ledger.entries.slice(-MAX_LEDGER_ENTRIES);
        await mkdir(this.dataDirectory, { recursive: true });
        const temporary = `${this.ledgerPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify(ledger), { mode: 0o600 });
        await rename(temporary, this.ledgerPath);
      });
    return this.state.writeQueue;
  }

  private async storeRecovery(
    requestId: string,
    mimeType: string,
    bytes: Uint8Array,
  ): Promise<{ url?: string; warning?: string }> {
    const memoryCopy = new Uint8Array(bytes.byteLength);
    memoryCopy.set(bytes);
    const metadata: RecoveryMetadata = { mimeType, bytes: memoryCopy };
    this.state.recoveries.set(requestId, metadata);
    try {
      await mkdir(this.resultsDirectory, { recursive: true });
      const extension =
        mimeType === 'image/jpeg'
          ? 'jpg'
          : mimeType === 'image/webp'
            ? 'webp'
            : 'png';
      const path = join(this.resultsDirectory, `${requestId}.${extension}`);
      const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
      await writeFile(temporary, bytes, { mode: 0o600 });
      await rename(temporary, path);
      metadata.path = path;
      delete metadata.bytes;
      await this.cleanupRecoveries();
      return { url: `/api/openai/results/${encodeURIComponent(requestId)}` };
    } catch {
      return {
        url: `/api/openai/results/${encodeURIComponent(requestId)}`,
        warning:
          'Image completed and is retained until this local server stops; its recovery file could not be written.',
      };
    }
  }

  private async recoveryMetadataFromDisk(
    requestId: string,
  ): Promise<RecoveryMetadata | null> {
    for (const [extension, mimeType] of [
      ['png', 'image/png'],
      ['jpg', 'image/jpeg'],
      ['webp', 'image/webp'],
    ] as const) {
      const path = join(this.resultsDirectory, `${requestId}.${extension}`);
      try {
        await stat(path);
        const metadata: RecoveryMetadata = { mimeType, path };
        this.state.recoveries.set(requestId, metadata);
        return metadata;
      } catch {
        // Try the next supported output extension.
      }
    }
    return null;
  }

  private async cleanupRecoveries(): Promise<void> {
    try {
      const files = await Promise.all(
        (await readdir(this.resultsDirectory))
          .filter((name) =>
            /^[a-zA-Z0-9_-]{8,128}\.(?:png|jpg|webp)$/.test(name),
          )
          .map(async (name) => ({
            name,
            path: join(this.resultsDirectory, name),
            info: await stat(join(this.resultsDirectory, name)),
          })),
      );
      files.sort((left, right) => right.info.mtimeMs - left.info.mtimeMs);
      let retained = 0;
      let size = 0;
      for (const file of files) {
        retained += 1;
        size += file.info.size;
        if (retained > MAX_RECOVERY_FILES || size > MAX_RECOVERY_BYTES) {
          await unlink(file.path);
          this.state.recoveries.delete(
            file.name.replace(/\.(?:png|jpg|webp)$/, ''),
          );
        }
      }
    } catch {
      // The image response is already retained in memory for this request; cleanup must not affect it.
    }
  }
}

/** Resolves a route-shared service; global state preserves session credentials across route bundles. */
export const openAiGenerationService = new OpenAiGenerationService();
