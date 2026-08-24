/**
 * Regression test for P0 #1 — redaction that silently redacted nothing.
 *
 * The original check was `item.str.toLowerCase().includes(needle)`, evaluated
 * per text item. pdf.js splits a line across items, so a phone number arriving
 * as "081", "-234", "-5678" never matched — and the tool still produced a file
 * and reported success. These tests pin down both halves of the fix: matching
 * across item boundaries, and returning nothing (so the caller can refuse to
 * produce a file) when the term genuinely is not there.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { findRedactionBoxes } from '../lib/pdf/redact';

type Item = { str: string; transform: number[]; width: number; height: number; hasEOL: boolean };

/** Build a line of text items laid out left to right on one baseline. */
function line(parts: string[], { y = 700, size = 10, startX = 50 } = {}): Item[] {
  let x = startX;
  return parts.map((str) => {
    const width = str.length * size * 0.5;
    const item: Item = {
      str,
      transform: [size, 0, 0, size, x, y],
      width,
      height: size,
      hasEOL: false,
    };
    x += width;
    return item;
  });
}

const PAGE_HEIGHT = 842;

test('finds a phone number split across three text items', () => {
  const items = line(['โทร ', '081', '-234', '-5678', ' ครับ']);
  const boxes = findRedactionBoxes(items as never, '081-234-5678', 1, PAGE_HEIGHT);

  assert.ok(boxes.length > 0, 'the split phone number was not found at all');
  // The match spans three items, so it produces a box per covered item.
  assert.equal(boxes.length, 3);
  for (const box of boxes) {
    assert.ok(box.width > 0 && box.height > 0, 'a degenerate box would cover nothing');
  }
});

test('the old per-item check would have missed it — kept as documentation', () => {
  const items = line(['โทร ', '081', '-234', '-5678', ' ครับ']);
  const oldMatch = items.some((i) => i.str.toLowerCase().includes('081-234-5678'));
  assert.equal(oldMatch, false, 'fixture no longer reproduces the original defect');
});

test('returns nothing when the term is absent, so the caller can refuse', () => {
  const items = line(['ไม่มีอะไรตรงนี้']);
  assert.deepEqual(findRedactionBoxes(items as never, 'ความลับ', 1, PAGE_HEIGHT), []);
  assert.deepEqual(findRedactionBoxes(items as never, '', 1, PAGE_HEIGHT), []);
  assert.deepEqual(findRedactionBoxes(items as never, '   ', 1, PAGE_HEIGHT), []);
});

test('covers only the matched characters, not the whole run', () => {
  // One item holds "abcSECRETdef"; only "SECRET" may be covered.
  const items = line(['abcSECRETdef']);
  const [box] = findRedactionBoxes(items as never, 'SECRET', 1, PAGE_HEIGHT);
  const full = items[0].width;

  assert.ok(box, 'no box produced');
  assert.ok(box.width < full, `box (${box.width}) should be narrower than the run (${full})`);
  assert.ok(box.x > items[0].transform[4], 'box should start after the leading "abc"');
});

test('matches every occurrence, not just the first', () => {
  const items = line(['ลับ', ' xx ', 'ลับ', ' yy ', 'ลับ']);
  const boxes = findRedactionBoxes(items as never, 'ลับ', 1, PAGE_HEIGHT);
  assert.equal(boxes.length, 3);
});

test('is case insensitive for Latin text', () => {
  const items = line(['Confidential Report']);
  assert.equal(findRedactionBoxes(items as never, 'CONFIDENTIAL', 1, PAGE_HEIGHT).length, 1);
  assert.equal(findRedactionBoxes(items as never, 'confidential', 1, PAGE_HEIGHT).length, 1);
});

test('does not join across lines — a match must be on one baseline', () => {
  const top = line(['ความ'], { y: 700 });
  const bottom = line(['ลับ'], { y: 640 });
  const boxes = findRedactionBoxes([...top, ...bottom] as never, 'ความลับ', 1, PAGE_HEIGHT);
  assert.deepEqual(boxes, [], 'text on two different lines must not be treated as contiguous');
});

test('scales boxes into viewport space and flips the y axis', () => {
  const items = line(['ลับ'], { y: 700, size: 10 });
  const at1 = findRedactionBoxes(items as never, 'ลับ', 1, PAGE_HEIGHT)[0];
  const at2 = findRedactionBoxes(items as never, 'ลับ', 2, PAGE_HEIGHT)[0];

  assert.ok(Math.abs(at2.x - at1.x * 2) < 0.001, 'x should scale linearly');
  assert.ok(Math.abs(at2.height - at1.height * 2) < 0.001, 'height should scale linearly');
  // PDF y=700 near the top of an 842pt page => small canvas y.
  assert.ok(at1.y < PAGE_HEIGHT / 2, 'y axis was not flipped into canvas space');
});
