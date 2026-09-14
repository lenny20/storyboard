import {
  DEFAULT_GENERATION_PRESET,
  GENERATION_MODELS,
  GENERATION_QUALITIES,
  GENERATION_SIZES,
  type GenerationPreset,
  type GenerationSize,
  type GenerationUsage,
} from './types';

export {
  DEFAULT_GENERATION_PRESET,
  GENERATION_MODELS as SUPPORTED_GENERATION_MODELS,
  GENERATION_QUALITIES as SUPPORTED_GENERATION_QUALITIES,
  GENERATION_SIZES as SUPPORTED_GENERATION_SIZES,
};

/**
 * Rates were verified against official OpenAI documentation on this date.
 * They are estimates for display and are not a substitute for invoice data.
 */
export const IMAGE_PRICING_AS_OF = '2026-09-10';

export const IMAGE_PRICING_SOURCES = [
  'https://developers.openai.com/api/docs/models/gpt-image-2.5-flare',
  'https://developers.openai.com/api/docs/guides/image-generation',
] as const;

export const IMAGE_TOKEN_RATES_USD_PER_MILLION = Object.freeze({
  textInput: 5,
  cachedTextInput: 1.25,
  imageInput: 8,
  cachedImageInput: 2,
  imageOutput: 30,
});

export type GenerationCostComponents = {
  textInputUsd: number | null;
  imageInputUsd: number | null;
  imageOutputUsd: number | null;
};

export type GenerationCostBreakdown = {
  status: 'known' | 'partial' | 'unknown';
  /** Complete estimated request cost. Null whenever any required usage is absent. */
  totalUsd: number | null;
  /** Sum of components that can be priced. Null when no component is known. */
  knownSubtotalUsd: number | null;
  components: GenerationCostComponents;
  missing: readonly ('inputTextTokens' | 'inputImageTokens' | 'outputTokens' | 'consistentTokenTotals')[];
  ratesAsOf: typeof IMAGE_PRICING_AS_OF;
};

export type PreRequestPricing = {
  kind: 'rate-card';
  preset: GenerationPreset;
  totalUsd: null;
  ratesUsdPerMillionTokens: typeof IMAGE_TOKEN_RATES_USD_PER_MILLION;
  note: string;
  ratesAsOf: typeof IMAGE_PRICING_AS_OF;
};

const PER_MILLION = 1_000_000;

/** Picks the supported output shape closest to the storyboard frame ratio. */
export function chooseGenerationSize(aspectRatio: number): GenerationSize {
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) return DEFAULT_GENERATION_PRESET.size;
  const candidates: readonly { size: GenerationSize; ratio: number }[] = [
    { size: '1024x1024', ratio: 1 },
    { size: '1536x1024', ratio: 1.5 },
    { size: '1536x864', ratio: 16 / 9 },
    { size: '1536x640', ratio: 2.4 },
  ];
  return candidates.reduce((closest, candidate) => (
    Math.abs(Math.log(candidate.ratio / aspectRatio)) < Math.abs(Math.log(closest.ratio / aspectRatio))
      ? candidate
      : closest
  )).size;
}

/**
 * GPT Image 2.5 output consumption varies by model, quality, and size. Before a
 * response supplies usage, expose the verified rates rather than a false total.
 */
export function getPreRequestPricing(preset: GenerationPreset): PreRequestPricing {
  return {
    kind: 'rate-card',
    preset: { ...preset },
    totalUsd: null,
    ratesUsdPerMillionTokens: IMAGE_TOKEN_RATES_USD_PER_MILLION,
    note: 'Usage-priced. Reference images and prompt tokens are additional; a total estimate appears when OpenAI returns complete token usage.',
    ratesAsOf: IMAGE_PRICING_AS_OF,
  };
}

/** Returns a complete post-response estimate, or null if usage cannot be priced safely. */
export function estimateGenerationCost(
  _preset: GenerationPreset,
  usage: GenerationUsage,
): number | null {
  return calculateGenerationCost(usage).totalUsd;
}

export function calculateGenerationCost(usage: GenerationUsage): GenerationCostBreakdown {
  const textTokens = tokenCount(usage.inputTextTokens);
  const imageTokens = tokenCount(usage.inputImageTokens);
  const outputTokens = tokenCount(usage.outputTokens);
  const cachedTextTokens = tokenCount(usage.cachedInputTextTokens) ?? 0;
  const cachedImageTokens = tokenCount(usage.cachedInputImageTokens) ?? 0;

  const invalidTotals = (
    usageFields(usage).some((value) => value !== undefined && tokenCount(value) === null) ||
    (textTokens !== null && cachedTextTokens > textTokens) ||
    (imageTokens !== null && cachedImageTokens > imageTokens) ||
    (usage.inputTokens !== undefined && (
      tokenCount(usage.inputTokens) === null ||
      (textTokens !== null && imageTokens !== null && usage.inputTokens !== textTokens + imageTokens)
    )) ||
    (usage.totalTokens !== undefined && (
      tokenCount(usage.totalTokens) === null ||
      (textTokens !== null && imageTokens !== null && outputTokens !== null &&
        usage.totalTokens !== textTokens + imageTokens + outputTokens)
    ))
  );

  if (invalidTotals) {
    return {
      status: 'unknown',
      totalUsd: null,
      knownSubtotalUsd: null,
      components: { textInputUsd: null, imageInputUsd: null, imageOutputUsd: null },
      missing: ['consistentTokenTotals'],
      ratesAsOf: IMAGE_PRICING_AS_OF,
    };
  }

  const textInputUsd = textTokens === null ? null : tokenCost(
    textTokens - cachedTextTokens,
    IMAGE_TOKEN_RATES_USD_PER_MILLION.textInput,
  ) + tokenCost(cachedTextTokens, IMAGE_TOKEN_RATES_USD_PER_MILLION.cachedTextInput);
  const imageInputUsd = imageTokens === null ? null : tokenCost(
    imageTokens - cachedImageTokens,
    IMAGE_TOKEN_RATES_USD_PER_MILLION.imageInput,
  ) + tokenCost(cachedImageTokens, IMAGE_TOKEN_RATES_USD_PER_MILLION.cachedImageInput);
  const imageOutputUsd = outputTokens === null ? null : tokenCost(
    outputTokens,
    IMAGE_TOKEN_RATES_USD_PER_MILLION.imageOutput,
  );

  const components = { textInputUsd, imageInputUsd, imageOutputUsd };
  const known = Object.values(components).filter((value): value is number => value !== null);
  const missing: GenerationCostBreakdown['missing'][number][] = [];
  if (textInputUsd === null) missing.push('inputTextTokens');
  if (imageInputUsd === null) missing.push('inputImageTokens');
  if (imageOutputUsd === null) missing.push('outputTokens');
  const complete = missing.length === 0;

  return {
    status: complete ? 'known' : known.length > 0 ? 'partial' : 'unknown',
    totalUsd: complete ? sum(known) : null,
    knownSubtotalUsd: known.length > 0 ? sum(known) : null,
    components,
    missing,
    ratesAsOf: IMAGE_PRICING_AS_OF,
  };
}

export function summarizeGenerationCosts(costs: readonly (number | null | undefined)[]) {
  const known = costs.filter((value): value is number => (
    typeof value === 'number' && Number.isFinite(value) && value >= 0
  ));
  return {
    knownUsd: known.length > 0 ? sum(known) : null,
    knownCount: known.length,
    unknownCount: costs.length - known.length,
    requestCount: costs.length,
  };
}

export function formatUsd(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 'Unknown';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: value < 1 ? 4 : 2,
    maximumFractionDigits: value < 1 ? 4 : 2,
  }).format(value);
}

function tokenCount(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function usageFields(usage: GenerationUsage): (number | undefined)[] {
  return [
    usage.inputTokens,
    usage.inputImageTokens,
    usage.inputTextTokens,
    usage.cachedInputImageTokens,
    usage.cachedInputTextTokens,
    usage.outputTokens,
    usage.totalTokens,
  ];
}

function tokenCost(tokens: number, rateUsdPerMillion: number): number {
  return tokens * rateUsdPerMillion / PER_MILLION;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
