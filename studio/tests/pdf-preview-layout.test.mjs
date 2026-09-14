import assert from 'node:assert/strict';
import test from 'node:test';

import { calculatePdfScale } from '../lib/pdf/preview-layout.ts';

test('fit page keeps an A4 page inside both viewport dimensions', () => {
  const scale = calculatePdfScale({
    pageWidth: 595.28,
    pageHeight: 841.89,
    availableWidth: 475,
    availableHeight: 470,
    mode: 'page',
  });
  assert.ok(595.28 * scale <= 475.000001);
  assert.ok(841.89 * scale <= 470.000001);
  assert.equal(scale, 470 / 841.89);
});

test('fit width uses the full available width and permits vertical scrolling', () => {
  const scale = calculatePdfScale({
    pageWidth: 595.28,
    pageHeight: 841.89,
    availableWidth: 475,
    availableHeight: 470,
    mode: 'width',
  });
  assert.equal(scale, 475 / 595.28);
  assert.ok(841.89 * scale > 470);
});

test('invalid geometry falls back to a safe natural scale', () => {
  assert.equal(calculatePdfScale({
    pageWidth: 0,
    pageHeight: 841.89,
    availableWidth: 475,
    availableHeight: 470,
    mode: 'page',
  }), 1);
});
