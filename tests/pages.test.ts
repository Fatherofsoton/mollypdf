/**
 * Page-range parsing.
 *
 * The original silently dropped out-of-range input, so "ลบหน้า 9" on a
 * five-page file removed nothing and still reported success — the same class
 * of silent failure as the redaction bug, just less dangerous.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parsePages } from '../lib/pdf/pages';

test('parses single pages and ranges, zero-indexed', () => {
  assert.deepEqual(parsePages('1', 5), [0]);
  assert.deepEqual(parsePages('1, 3', 5), [0, 2]);
  assert.deepEqual(parsePages('2-4', 5), [1, 2, 3]);
  assert.deepEqual(parsePages(' 1 , 3 - 5 ', 5), [0, 2, 3, 4]);
});

test('de-duplicates and sorts by default', () => {
  assert.deepEqual(parsePages('3, 1, 3, 2', 5), [0, 1, 2]);
});

test('preserves the user order for "จัดเรียงหน้า", including repeats', () => {
  assert.deepEqual(parsePages('3, 1, 3', 5, true), [2, 0, 2]);
  assert.deepEqual(parsePages('5-1', 5, true), [4, 3, 2, 1, 0], 'a reversed range should reverse');
});

test('rejects pages that do not exist instead of ignoring them', () => {
  assert.throws(() => parsePages('9', 5), /ไม่มีอยู่ในเอกสารนี้/);
  assert.throws(() => parsePages('1, 9', 5), /9/);
  assert.throws(() => parsePages('10-20', 5), /10-20/);
  assert.throws(() => parsePages('abc', 5), /abc/);
});

test('rejects empty input with an actionable message', () => {
  assert.throws(() => parsePages('', 5), /กรุณาระบุเลขหน้า/);
  assert.throws(() => parsePages('  ,  ', 5), /กรุณาระบุเลขหน้า/);
});

test('clamps a range that starts inside the document and runs past the end', () => {
  // "4-99" on a 5-page file is a reasonable "from here to the end" intent.
  assert.deepEqual(parsePages('4-99', 5), [3, 4]);
});
