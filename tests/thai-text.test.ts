/**
 * Regression test for P0 #2 — Thai word boundaries.
 *
 * `tests/fixtures/thai-segmented.pdf` is generated with alternating font faces
 * so pdf.js emits one TextItem per 3-character run, which is what real Thai
 * documents from Word, InDesign and scanner text layers look like.
 *
 * With that input the old implementation produced:
 *   "ประ เทศ ไทย มีป ระช ากร ประ มาณ เจ็ ดสิ บล้ านค น …"
 *
 * The assertions below fail loudly if anyone ever reintroduces `join(' ')`.
 */

import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { joinTextItems, countWords } from '../lib/pdf/text';

const here = dirname(fileURLToPath(import.meta.url));

const EXPECTED_LINES = [
  'ประเทศไทยมีประชากรประมาณเจ็ดสิบล้านคน',
  'เอกสารฉบับนี้เป็นความลับ ห้ามเผยแพร่',
  'เลขประจำตัวประชาชน 1234567890123',
  'ติดต่อ somchai@example.com โทร 0812345678',
];

async function itemsFrom(fixture: string) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(await readFile(join(here, 'fixtures', fixture)));
  // `destroy()` lives on the loading task, not the document proxy — the same
  // trap that leaked a worker per job in the original app code.
  const task = pdfjs.getDocument({ data });
  const doc = await task.promise;
  const page = await doc.getPage(1);
  const content = await page.getTextContent();
  const items = content.items;
  await task.destroy();
  return items as never[];
}

test('pdf.js really does split Thai into many items (the bug is reproducible)', async () => {
  const items = await itemsFrom('thai-segmented.pdf');
  assert.ok(
    items.length > 40,
    `expected the fixture to fragment into many text items, got ${items.length}`,
  );
});

test('the old join(" ") behaviour breaks Thai words — kept as documentation', async () => {
  const items = await itemsFrom('thai-segmented.pdf');
  const old = (items as Array<{ str: string }>).map((i) => i.str).join(' ');
  assert.ok(
    old.includes('ประ เทศ ไทย'),
    'fixture no longer reproduces the original defect; regenerate it',
  );
  assert.ok(!old.includes('ประเทศไทย'), 'the old approach should not produce the intact word');
});

test('joinTextItems reconstructs Thai words with no inserted spaces', async () => {
  const items = await itemsFrom('thai-segmented.pdf');
  const text = joinTextItems(items);

  for (const line of EXPECTED_LINES) {
    assert.ok(
      text.includes(line),
      `missing line:\n  expected: ${line}\n  actual  : ${JSON.stringify(text.slice(0, 200))}`,
    );
  }
});

test('joinTextItems keeps the spaces that genuinely exist', async () => {
  const items = await itemsFrom('thai-segmented.pdf');
  const text = joinTextItems(items);
  // Latin/e-mail/number boundaries must keep their real word spaces.
  assert.ok(text.includes('somchai@example.com'), 'e-mail address was broken up');
  assert.ok(text.includes('ห้ามเผยแพร่'), 'Thai after a real space was broken up');
  assert.ok(text.includes('1234567890123'), 'digit run was broken up');
});

test('joinTextItems does not double a space that is already there', () => {
  const items = [
    { str: 'hello ', transform: [10, 0, 0, 10, 0, 700], width: 30, height: 10, hasEOL: false },
    { str: 'world', transform: [10, 0, 0, 10, 34, 700], width: 28, height: 10, hasEOL: false },
  ];
  assert.equal(joinTextItems(items as never), 'hello world');
});

test('joinTextItems starts a new line when the baseline moves', () => {
  const items = [
    { str: 'บรรทัดหนึ่ง', transform: [10, 0, 0, 10, 0, 700], width: 60, height: 10, hasEOL: false },
    { str: 'บรรทัดสอง', transform: [10, 0, 0, 10, 0, 680], width: 60, height: 10, hasEOL: false },
  ];
  assert.equal(joinTextItems(items as never), 'บรรทัดหนึ่ง\nบรรทัดสอง');
});

test('countWords uses real Thai segmentation, not whitespace splitting', () => {
  const sentence = 'ประเทศไทยมีประชากรประมาณเจ็ดสิบล้านคน';
  const naive = sentence.split(/\s+/).filter(Boolean).length;
  const { words, approximate } = countWords(sentence);

  assert.equal(naive, 1, 'sanity: whitespace splitting sees one word');
  assert.equal(approximate, false, 'Intl.Segmenter should be available on Node 22');
  assert.ok(words >= 5, `expected several Thai words, got ${words}`);
});
