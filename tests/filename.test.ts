/**
 * Download filenames.
 *
 * Chromium discards a `download` attribute containing non-ASCII characters:
 * the file arrives named `download`, with no extension, and will not open by
 * double-click. Measured directly — `plain.png` survives, `รายงาน.png` does
 * not. Every filename this app produces is Thai, so without a fallback that is
 * every download.
 *
 *   a.download = 'thai-1page-หน้า-1.png'   ->  saved as "download"
 *   a.download = 'thai-1page-1.png'        ->  saved as "thai-1page-1.png"
 *
 * `asciiFallback` keeps whatever Latin text the name already had — usually the
 * user's own filename — and always keeps the extension. The Thai name is still
 * used for the File System Access picker, where it works.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { asciiFallback, safeFilename } from '../lib/download';

test('keeps the extension no matter what the base name was', () => {
  assert.equal(asciiFallback('รายงานประจำปี.pdf', 'mollypdf'), 'mollypdf.pdf');
  assert.equal(asciiFallback('เอกสาร.zip', 'mollypdf'), 'mollypdf.zip');
});

test('keeps the Latin part of a mixed name', () => {
  assert.equal(asciiFallback('thai-1page-หน้า-1.png', 'mollypdf'), 'thai-1page-1.png');
  assert.equal(asciiFallback('invoice-2026-ใบเสร็จ.pdf', 'mollypdf'), 'invoice-2026.pdf');
});

test('leaves a pure ASCII name alone', () => {
  assert.equal(asciiFallback('report-final.pdf', 'mollypdf'), 'report-final.pdf');
});

test('never returns a bare extension or an empty name', () => {
  for (const name of ['ก.pdf', '   .pdf', '---.pdf', 'ๆ.zip']) {
    const out = asciiFallback(name, 'mollypdf');
    assert.ok(out.startsWith('mollypdf'), `${name} -> ${out}`);
    assert.ok(/\.[a-z0-9]+$/i.test(out), `${name} -> ${out} has no extension`);
  }
});

test('collapses runs of separators instead of leaving them', () => {
  assert.equal(asciiFallback('a  b--c.pdf', 'mollypdf'), 'a-b-c.pdf');
});

test('the result is pure ASCII, which is the whole point', () => {
  for (const name of ['รวมไฟล์.pdf', 'หน้า-1.jpg', 'ปลดล็อกแล้ว.pdf', 'mixed ไทย 123.png']) {
    assert.ok(/^[ -~]+$/.test(asciiFallback(name, 'mollypdf')), `not ascii: ${name}`);
  }
});

test('safeFilename still strips what filesystems reject', () => {
  assert.equal(safeFilename('a/b:c*d?e"f<g>h|i.pdf'), 'a-b-c-d-e-f-g-h-i.pdf');
});

test('safeFilename keeps Thai — the picker path can still use it', () => {
  assert.equal(safeFilename('รวมไฟล์.pdf'), 'รวมไฟล์.pdf');
});
