import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_GENERATION_PRESET,
  IMAGE_PRICING_AS_OF,
  IMAGE_TOKEN_RATES_USD_PER_MILLION,
  calculateGenerationCost,
  chooseGenerationSize,
  estimateGenerationCost,
  formatUsd,
  getPreRequestPricing,
  summarizeGenerationCosts,
} from '../lib/generation/pricing';

void test('defaults to balanced Flare generation and preserves common frame shapes', () => {
  assert.deepEqual(DEFAULT_GENERATION_PRESET, {
    model: 'gpt-image-2.5-flare',
    quality: 'medium',
    size: '1536x640',
  });
  assert.equal(chooseGenerationSize(1), '1024x1024');
  assert.equal(chooseGenerationSize(1.5), '1536x1024');
  assert.equal(chooseGenerationSize(16 / 9), '1536x864');
  assert.equal(chooseGenerationSize(2.39), '1536x640');
});

void test('pre-request pricing is an honest rate card rather than a fabricated total', () => {
  const pricing = getPreRequestPricing(DEFAULT_GENERATION_PRESET);
  assert.equal(pricing.kind, 'rate-card');
  assert.equal(pricing.totalUsd, null);
  assert.equal(pricing.ratesAsOf, '2026-09-10');
  assert.equal(IMAGE_PRICING_AS_OF, '2026-09-10');
  assert.equal(pricing.ratesUsdPerMillionTokens.imageOutput, 30);
  assert.match(pricing.note, /Reference images and prompt tokens are additional/);
});

void test('post-response pricing includes text, image, cached input, and image output', () => {
  const usage = {
    inputTokens: 3_000,
    inputTextTokens: 1_000,
    inputImageTokens: 2_000,
    cachedInputTextTokens: 100,
    cachedInputImageTokens: 200,
    outputTokens: 3_000,
    totalTokens: 6_000,
  };
  const cost = calculateGenerationCost(usage);
  assert.equal(cost.status, 'known');
  assertClose(cost.components.textInputUsd, 0.004625);
  assertClose(cost.components.imageInputUsd, 0.0148);
  assertClose(cost.components.imageOutputUsd, 0.09);
  assert.ok(Math.abs((cost.totalUsd ?? 0) - 0.109425) < 1e-12);
  assert.equal(estimateGenerationCost(DEFAULT_GENERATION_PRESET, usage), cost.totalUsd);
  assert.deepEqual(IMAGE_TOKEN_RATES_USD_PER_MILLION, {
    textInput: 5,
    cachedTextInput: 1.25,
    imageInput: 8,
    cachedImageInput: 2,
    imageOutput: 30,
  });
});

void test('missing or inconsistent usage stays unknown instead of becoming zero', () => {
  const noUsage = calculateGenerationCost({});
  assert.equal(noUsage.status, 'unknown');
  assert.equal(noUsage.totalUsd, null);
  assert.equal(noUsage.knownSubtotalUsd, null);
  assert.equal(estimateGenerationCost(DEFAULT_GENERATION_PRESET, {}), null);

  const partial = calculateGenerationCost({ outputTokens: 196 });
  assert.equal(partial.status, 'partial');
  assert.equal(partial.totalUsd, null);
  assert.equal(partial.knownSubtotalUsd, 0.00588);

  const inconsistent = calculateGenerationCost({
    inputTokens: 30,
    inputTextTokens: 10,
    inputImageTokens: 10,
    outputTokens: 10,
    totalTokens: 30,
  });
  assert.equal(inconsistent.status, 'unknown');
  assert.equal(inconsistent.totalUsd, null);
  assert.deepEqual(inconsistent.missing, ['consistentTokenTotals']);

  const malformedCached = calculateGenerationCost({
    inputTextTokens: 10,
    inputImageTokens: 20,
    cachedInputImageTokens: -1,
    outputTokens: 30,
  });
  assert.equal(malformedCached.status, 'unknown');
  assert.equal(malformedCached.totalUsd, null);
  assert.deepEqual(malformedCached.missing, ['consistentTokenTotals']);
});

void test('running spend distinguishes known estimates from unknown requests', () => {
  assert.deepEqual(summarizeGenerationCosts([0.01, null, 0.025, undefined]), {
    knownUsd: 0.035,
    knownCount: 2,
    unknownCount: 2,
    requestCount: 4,
  });
  assert.equal(formatUsd(0.00588), '$0.0059');
  assert.equal(formatUsd(0.0243), '$0.0243');
  assert.equal(formatUsd(1.0243), '$1.02');
  assert.equal(formatUsd(null), 'Unknown');
});

function assertClose(actual: number | null, expected: number): void {
  assert.ok(actual !== null && Math.abs(actual - expected) < 1e-12);
}
