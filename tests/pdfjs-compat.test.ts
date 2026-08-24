/**
 * Browser-compatibility regression test for pdf.js.
 *
 * Reported symptom: บีบอัด, PDF เป็น Word, นับคำ and เปรียบเทียบ all failed with
 *
 *     undefined is not a function (near '...t of e...')
 *
 * while รวม PDF kept working. That split is the tell — merge is the only one of
 * those that never touches pdf.js. The cause is in pdfjs-dist 6.2's *default*
 * bundle, which runs this at module scope:
 *
 *     "function" != typeof Iterator.prototype.join && (Iterator.prototype.join = …)
 *
 * The global `Iterator` object comes from the iterator-helpers proposal and
 * only shipped in Safari 18.4. On anything older the module throws while it is
 * still being evaluated, so `import('pdfjs-dist')` rejects and every dependent
 * tool dies at once.
 *
 * These tests pin the fix — using the legacy build — by removing each modern
 * global and asserting text extraction still works. Deleting a global is a
 * blunt simulation of an older engine, but it is exactly the condition that
 * broke, and it fails loudly if anyone points the app back at the default
 * bundle.
 *
 * Each case runs in its own child process: the deletions are global and
 * pdf.js can only be imported once per process.
 */

import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

/** Engine features pdfjs-dist reaches for that older Safari does not have. */
const MISSING_FEATURES = ['Iterator', 'withResolvers', 'getOrInsertComputed', 'IteratorHelpers'] as const;

// Values come in through the environment: with \`node -e\`, positional
// arguments land at different argv indices across Node versions.
const RUNNER = `
import { readFile } from 'node:fs/promises';

const remove = process.env.REMOVE_FEATURE;
if (remove === 'Iterator') delete globalThis.Iterator;
if (remove === 'withResolvers') delete Promise.withResolvers;
if (remove === 'getOrInsertComputed') {
  delete Map.prototype.getOrInsertComputed;
  delete WeakMap.prototype.getOrInsertComputed;
}
if (remove === 'IteratorHelpers' && globalThis.Iterator) {
  for (const method of ['map','filter','take','drop','flatMap','reduce','toArray','forEach','some','every','find','join']) {
    delete Iterator.prototype[method];
  }
}

const pdfjs = await import(process.env.PDFJS_BUILD);
const data = new Uint8Array(await readFile(process.env.FIXTURE));
const task = pdfjs.getDocument({ data });
const doc = await task.promise;
const page = await doc.getPage(1);
const content = await page.getTextContent();
await task.destroy();
process.stdout.write(String(content.items.length));
`;

function extractWith(build: string, without: string): { ok: boolean; detail: string } {
  try {
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', RUNNER], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        REMOVE_FEATURE: without,
        PDFJS_BUILD: build,
        FIXTURE: join(root, 'tests/fixtures/thai-segmented.pdf'),
      },
    });
    return { ok: Number(out) > 0, detail: `items=${out}` };
  } catch (error) {
    const message = (error as { stderr?: string }).stderr ?? String(error);
    return { ok: false, detail: message.split('\n').find((l) => /Error/.test(l)) ?? 'failed' };
  }
}

test('the legacy build survives every engine feature older Safari lacks', () => {
  const failures: string[] = [];
  for (const feature of MISSING_FEATURES) {
    const result = extractWith('pdfjs-dist/legacy/build/pdf.mjs', feature);
    if (!result.ok) failures.push(`without ${feature}: ${result.detail}`);
  }
  assert.equal(failures.length, 0, `legacy build broke:\n  ${failures.join('\n  ')}`);
});

test('the default build really does break without global Iterator', () => {
  // Documents *why* the app is pinned to the legacy build. If pdfjs-dist ever
  // drops this dependency, this test starts failing and the pin can be
  // reconsidered — which is the point.
  const result = extractWith('pdfjs-dist', 'Iterator');
  assert.equal(
    result.ok,
    false,
    'the default build no longer needs global Iterator — re-evaluate the legacy pin in lib/pdf/pdfjs.ts',
  );
});

test('the app imports pdf.js from the legacy build', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(join(root, 'lib/pdf/pdfjs.ts'), 'utf8');
  assert.match(
    source,
    /import\('pdfjs-dist\/legacy\/build\/pdf\.mjs'\)/,
    'lib/pdf/pdfjs.ts must load the legacy build',
  );
});

test('the worker shim is built from the legacy worker', async () => {
  const { readFile } = await import('node:fs/promises');
  const script = await readFile(join(root, 'scripts/sync-pdf-worker.mjs'), 'utf8');
  assert.match(
    script,
    /pdfjs-dist\/legacy\/build\/pdf\.worker\.min\.mjs/,
    'the worker must be copied from the legacy build too — a worker that fails ' +
      'to boot takes every render and OCR down with it',
  );
});
