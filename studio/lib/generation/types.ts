/** Public, credential-free contract for the local OpenAI image proxy. */
export const GENERATION_MODELS = ['gpt-image-2.5-flare'] as const;
export const GENERATION_QUALITIES = ['low', 'medium', 'high'] as const;
export const GENERATION_SIZES = ['1024x1024', '1536x1024', '1536x864', '1536x640'] as const;

export type GenerationModel = (typeof GENERATION_MODELS)[number];
export type GenerationQuality = (typeof GENERATION_QUALITIES)[number];
export type GenerationSize = (typeof GENERATION_SIZES)[number];

export type GenerationPreset = {
  model: GenerationModel;
  quality: GenerationQuality;
  size: GenerationSize;
};

export const DEFAULT_GENERATION_PRESET: GenerationPreset = {
  model: 'gpt-image-2.5-flare',
  quality: 'medium',
  size: '1536x640',
};

export type GenerationOrigin = {
  projectId: string;
  sceneId: string;
  shotId: string;
  panelId: string;
};

/** A browser-local data URL. It is sent only to the local proxy for this request. */
export type GenerationInputImage = {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
};

export type GenerationRequest = {
  requestId: string;
  origin: GenerationOrigin;
  prompt: string;
  mode: 'generate' | 'revision';
  preset: GenerationPreset;
  references: GenerationInputImage[];
  /** Required for revisions; included with references in the OpenAI edit request. */
  currentImage?: GenerationInputImage;
};

export type GenerationUsage = {
  inputTokens?: number;
  inputImageTokens?: number;
  inputTextTokens?: number;
  cachedInputImageTokens?: number;
  cachedInputTextTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type GenerationResultImage = {
  mimeType: string;
  dataUrl: string;
};

export type GenerationResult = {
  requestId: string;
  status: 'succeeded' | 'uncertain';
  image?: GenerationResultImage;
  /** Same-origin local path for a retained successful output. */
  recoveryUrl?: string;
  usage?: GenerationUsage;
  /** Null means the API response did not provide enough usage to price safely. */
  estimatedCost?: number | null;
  message?: string;
};

export type OpenAiConnectionStatus = {
  configured: boolean;
  keySource: 'environment' | 'session' | null;
};

export type UsageLedgerEntry = {
  requestId: string;
  /** Hash of the submitted request, used only to reject request-ID reuse with different content. */
  requestHash: string;
  startedAt: string;
  finishedAt?: string;
  status: 'started' | 'succeeded' | 'failed' | 'uncertain';
  mode: GenerationRequest['mode'];
  preset: GenerationPreset;
  origin: GenerationOrigin;
  referenceCount: number;
  hasCurrentImage: boolean;
  usage?: GenerationUsage;
  estimatedCost?: number | null;
  /** OpenAI's request identifier when it was supplied in response headers. */
  providerRequestId?: string;
  /** Sanitized transport or API error; it never contains a credential, prompt, or image. */
  error?: string;
};

export type UsageLedgerTotals = {
  attempts: number;
  succeeded: number;
  uncertain: number;
  failed: number;
  started: number;
  knownCost: number;
  knownCount: number;
  unknownCount: number;
};

export type OpenAiStatusResponse = OpenAiConnectionStatus & {
  usage: UsageLedgerEntry[];
  usageTotals: UsageLedgerTotals;
};
