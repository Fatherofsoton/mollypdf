/**
 * Regression test for "ปลดล็อก PDF" — the tool that reported success while
 * handing back a file that was still locked.
 *
 * The original implementation was:
 *
 *     const doc = await PDFDocument.load(bytes, { password });
 *     return doc.save();
 *
 * Loading with a password decrypts the document *in memory*, but saving writes
 * the /Encrypt dictionary back out, so the "unlocked" file still demanded the
 * password. The user had no way to tell except by opening it.
 *
 * The fix copies every page into a fresh document, which carries no encryption
 * dictionary at all. Both halves are asserted below: that the naive approach
 * really does leave the file encrypted, and that the fix really does not.
 */

import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, 'fixtures', 'thai-1page.pdf');

/** A Thai password with digits — the realistic case, and the one most likely to expose an encoding bug. */
const PASSWORD = 'ทดสอบ1234';

async function lock(password = PASSWORD) {
  const cantoo = await import('@cantoo/pdf-lib');
  const doc = await cantoo.PDFDocument.load(new Uint8Array(await readFile(FIXTURE)));
  doc.encrypt({
    userPassword: password,
    ownerPassword: `${password}-mollypdf-owner`,
    permissions: {
      printing: 'highResolution',
      modifying: false,
      copying: false,
      annotating: false,
      fillingForms: true,
      contentAccessibility: true,
      documentAssembly: false,
    },
  });
  return new Uint8Array(await doc.save());
}

function hasEncryptDictionary(bytes: Uint8Array) {
  return Buffer.from(bytes).toString('latin1').includes('/Encrypt');
}

test('protect actually encrypts the document', async () => {
  const locked = await lock();
  assert.ok(hasEncryptDictionary(locked), 'no /Encrypt dictionary in the output');
});

test('a locked file refuses the wrong password', async () => {
  const cantoo = await import('@cantoo/pdf-lib');
  const locked = await lock();
  await assert.rejects(
    () => cantoo.PDFDocument.load(locked, { password: 'ไม่ใช่รหัสนี้' }),
    /password/i,
  );
});

test('a locked file accepts a Thai password round-trip', async () => {
  const cantoo = await import('@cantoo/pdf-lib');
  const locked = await lock();
  const doc = await cantoo.PDFDocument.load(locked, { password: PASSWORD });
  assert.equal(doc.getPageCount(), 1);
});

test('the OLD unlock approach left the file encrypted — kept as documentation', async () => {
  const cantoo = await import('@cantoo/pdf-lib');
  const locked = await lock();
  const doc = await cantoo.PDFDocument.load(locked, { password: PASSWORD });
  const resaved = new Uint8Array(await doc.save());
  assert.ok(
    hasEncryptDictionary(resaved),
    'load-then-save no longer preserves encryption — the unlock fix may be simplifiable',
  );
});

test('unlock produces a file that opens with no password at all', async () => {
  const cantoo = await import('@cantoo/pdf-lib');
  const lib = await import('pdf-lib');
  const locked = await lock();

  const source = await cantoo.PDFDocument.load(locked, { password: PASSWORD });
  const out = await cantoo.PDFDocument.create();
  const copied = await out.copyPages(source, source.getPageIndices());
  copied.forEach((page) => out.addPage(page));
  const unlocked = new Uint8Array(await out.save());

  assert.equal(hasEncryptDictionary(unlocked), false, 'output still carries /Encrypt');
  assert.equal(out.isEncrypted, false, 'document still reports itself as encrypted');

  // The real proof: a different library, given no password, can open it.
  const reopened = await lib.PDFDocument.load(unlocked);
  assert.equal(reopened.getPageCount(), 1);
});

test('unlocking preserves every page', async () => {
  const cantoo = await import('@cantoo/pdf-lib');
  const multi = await cantoo.PDFDocument.load(
    new Uint8Array(await readFile(join(here, 'fixtures', 'thai-4page-with-blanks.pdf'))),
  );
  multi.encrypt({ userPassword: PASSWORD, ownerPassword: `${PASSWORD}-x` });
  const locked = new Uint8Array(await multi.save());

  const source = await cantoo.PDFDocument.load(locked, { password: PASSWORD });
  const out = await cantoo.PDFDocument.create();
  const copied = await out.copyPages(source, source.getPageIndices());
  copied.forEach((page) => out.addPage(page));

  assert.equal(out.getPageCount(), 4);
});
