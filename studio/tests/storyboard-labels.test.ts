import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatMovementLabel,
  formatPanelCode,
  formatPanelLetter,
  formatShotCode,
} from '../lib/storyboard/labels';

void test('movement labels are sentence-cased without changing their stored codes', () => {
  assert.equal(formatMovementLabel('dolly'), 'Dolly');
  assert.equal(formatMovementLabel('aerial'), 'Aerial');
  assert.equal(formatMovementLabel('match-cut'), 'Match cut');
});

void test('frame codes distinguish the same shot position in different scenes', () => {
  assert.equal(formatShotCode(3, 4), 'SC03 · SH04');
  assert.notEqual(formatPanelCode(1, 4, 1, 1), formatPanelCode(3, 4, 1, 1));
  assert.equal(formatShotCode(101, 104), 'SC101 · SH104');
});

void test('only shots with multiple drawings display panel letters', () => {
  assert.equal(formatPanelCode(1, 1, 1, 1), 'SC01 · SH01');
  assert.equal(formatPanelCode(3, 4, 1, 2), 'SC03 · SH04 · A');
  assert.equal(formatPanelCode(3, 4, 2, 2), 'SC03 · SH04 · B');
  assert.equal(formatPanelCode(3, 5, 1, 2), 'SC03 · SH05 · A');
});

void test('long action sequences keep distinct panel letters beyond Z', () => {
  assert.equal(formatPanelLetter(26), 'Z');
  assert.equal(formatPanelLetter(27), 'AA');
  assert.equal(formatPanelLetter(52), 'AZ');
  assert.equal(formatPanelLetter(53), 'BA');
});
