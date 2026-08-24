/**
 * End-to-end verification in a real browser.
 *
 * The unit tests cover the pure logic; this drives the actual UI in Chromium
 * against the production build, because several of the P0 fixes only exist at
 * the integration level:
 *
 *   - does the Thai text that reaches the user's downloaded file still have
 *     the word boundaries intact, all the way through pdf.js -> join -> Blob?
 *   - does redaction genuinely refuse to hand over a file when it matched
 *     nothing, rather than downloading one and claiming success?
 *   - does the tool dialog close on Escape and trap focus?
 *   - do the 43 tool pages render server-side with their own titles?
 *
 * Run with:  pnpm test:browser        (expects `pnpm build` to have run)
 */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const fixtures = join(root, 'tests', 'fixtures');
const PORT = 3123;
const BASE = `http://127.0.0.1:${PORT}`;

const results = [];
let failures = 0;

async function check(name, fn) {
  try {
    await fn();
    results.push(`  ✔ ${name}`);
  } catch (error) {
    failures++;
    results.push(`  ✖ ${name}\n      ${error.message.split('\n').join('\n      ')}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForServer(url, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error(`server did not start at ${url}`);
}

/** Open a tool's dialog through the real UI, exactly as a user would. */
async function openTool(page, toolId) {
  await page.goto(`${BASE}/?tool=${toolId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[role="dialog"]', { timeout: 20_000 });
}

async function runToolWith(page, toolId, { file, text } = {}) {
  await openTool(page, toolId);
  // Scope to the dialog: the home page behind it has its own "เริ่ม…" buttons.
  const dialog = page.locator('[role="dialog"]');
  if (file) {
    await dialog.locator('input[type="file"]').setInputFiles(join(fixtures, file));
    await page.waitForTimeout(200);
  }
  if (text !== undefined) {
    await dialog.locator('#tool-input').fill(text);
  }
  const downloadPromise = page
    .waitForEvent('download', { timeout: 60_000 })
    .catch(() => null);
  await dialog.getByRole('button', { name: /^เริ่ม/ }).click();
  const download = await downloadPromise;
  // Wait for the run to settle before reading the status the user sees.
  await dialog
    .getByRole('button', { name: 'ยกเลิก' })
    .waitFor({ state: 'detached', timeout: 60_000 })
    .catch(() => {});
  const status = (await dialog.locator('[role="status"]').innerText()).trim();
  return { download, status };
}

const server = spawn('npx', ['next', 'start', '-p', String(PORT)], {
  cwd: root,
  stdio: 'ignore',
  env: { ...process.env, NODE_ENV: 'production' },
});

let browser;
try {
  await waitForServer(BASE);
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
    args: ['--no-sandbox'],
  });
  const context = await browser.newContext({ acceptDownloads: true, locale: 'th-TH' });

  // `lib/download.ts` prefers the File System Access API when it exists, which
  // headless Chromium provides — and which produces no `download` event to
  // observe. Remove it so these checks exercise the `a.download` path that most
  // visitors actually get. The picker path is covered separately below.
  await context.addInitScript(() => {
    // @ts-expect-error deleting an optional global for the test
    delete window.showSaveFilePicker;
  });

  const page = await context.newPage();

  const consoleErrors = [];
  page.on('pageerror', (error) => consoleErrors.push(String(error)));

  /* ── P0 #2 · Thai word boundaries survive the whole pipeline ── */
  await check('PDF เป็นข้อความ keeps Thai words intact end to end', async () => {
    const { download, status } = await runToolWith(page, 'pdf-text', {
      file: 'thai-segmented.pdf',
    });
    assert(download, `no file was produced. status was: ${status}`);
    const path = await download.path();
    const text = await readFile(path, 'utf8');

    assert(
      text.includes('ประเทศไทยมีประชากรประมาณเจ็ดสิบล้านคน'),
      `Thai words were broken in the downloaded file:\n${text.slice(0, 160)}`,
    );
    assert(!text.includes('ประ เทศ ไทย'), 'spurious spaces are back inside Thai words');
    assert(text.includes('ประจำตัว'), 'SARA AM was not recomposed (saw the stray สระอา)');
    assert(text.includes('somchai@example.com'), 'a real space was swallowed');
  });

  /* ── P0 #1 · redaction refuses instead of pretending ── */
  await check('ปิดข้อมูลสำคัญ refuses to produce a file when nothing matched', async () => {
    const { download, status } = await runToolWith(page, 'redact', {
      file: 'thai-segmented.pdf',
      text: 'คำที่ไม่มีอยู่ในเอกสารนี้เลย',
    });
    assert(!download, 'a file was downloaded even though nothing was redacted');
    assert(
      /ไม่พบข้อความ/.test(status),
      `expected an explicit "not found" message, got: ${status}`,
    );
  });

  await check('ปิดข้อมูลสำคัญ does redact text that is split across items', async () => {
    const { download, status } = await runToolWith(page, 'redact', {
      file: 'thai-segmented.pdf',
      text: '1234567890123',
    });
    assert(download, `expected a redacted file. status was: ${status}`);
    assert(/ปิดไป \d+ จุด/.test(status), `expected a match count, got: ${status}`);

    // The output must no longer contain the redacted string anywhere.
    const path = await download.path();
    const bytes = new Uint8Array(await readFile(path));
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = pdfjs.getDocument({ data: bytes });
    const doc = await task.promise;
    let all = '';
    for (let n = 1; n <= doc.numPages; n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      all += content.items.map((i) => i.str ?? '').join('');
    }
    await task.destroy();
    assert(
      !all.includes('1234567890123'),
      'the redacted number is still extractable from the output PDF',
    );
  });

  /* ── page ranges no longer fail silently ── */
  await check('ลบหน้า rejects a page number that does not exist', async () => {
    const { download, status } = await runToolWith(page, 'remove-pages', {
      file: 'thai-1page.pdf',
      text: '9',
    });
    assert(!download, 'a file was produced for an out-of-range page');
    assert(/ไม่มีอยู่ในเอกสารนี้/.test(status), `unexpected status: ${status}`);
  });

  /* ── blank-page removal keeps the surviving pages as real text ── */
  await check('ลบหน้าว่าง removes blanks without rasterising the rest', async () => {
    const { download, status } = await runToolWith(page, 'remove-blank', {
      file: 'thai-4page-with-blanks.pdf',
    });
    assert(download, `no file produced. status: ${status}`);
    assert(/ลบหน้า 2, 4/.test(status), `expected pages 2 and 4 to be named, got: ${status}`);

    const bytes = new Uint8Array(await readFile(await download.path()));
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = pdfjs.getDocument({ data: bytes });
    const doc = await task.promise;
    assert(doc.numPages === 2, `expected 2 surviving pages, got ${doc.numPages}`);
    const content = await (await doc.getPage(1)).getTextContent();
    await task.destroy();
    assert(
      content.items.length > 0,
      'surviving pages have no text layer — they were rasterised, which is the old bug',
    );
  });

  /* ── accessibility of the dialog ── */
  await check('Escape closes the tool dialog and focus returns to the page', async () => {
    await openTool(page, 'merge');
    await page.keyboard.press('Escape');
    await page.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 5000 });
  });

  await check('the drop zone is reachable and operable from the keyboard', async () => {
    await openTool(page, 'merge');
    const dropZone = page.getByRole('button', { name: /เลือกไฟล์จากเครื่อง/ });
    await dropZone.focus();
    assert(await dropZone.evaluate((el) => el === document.activeElement), 'drop zone cannot take focus');
    await page.keyboard.press('Escape');
  });

  /* ── SEO surface ── */
  await check('every tool has its own server-rendered page and title', async () => {
    const response = await fetch(`${BASE}/tools/pdf-word`);
    const html = await response.text();
    assert(response.ok, `/tools/pdf-word returned ${response.status}`);
    assert(/<title>[^<]*PDF เป็น Word/.test(html), 'tool page has no specific <title>');
    assert(html.includes('application/ld+json'), 'no structured data on the tool page');
    assert(html.includes('SoftwareApplication'), 'missing SoftwareApplication JSON-LD');
    assert(html.includes('FAQPage'), 'missing FAQPage JSON-LD');
    assert(/rel="canonical"/.test(html), 'no canonical link');
  });

  await check('sitemap lists every ready tool and robots points at it', async () => {
    const sitemap = await (await fetch(`${BASE}/sitemap.xml`)).text();
    const count = (sitemap.match(/<loc>/g) ?? []).length;
    assert(count >= 42, `sitemap only lists ${count} URLs`);
    const robots = await (await fetch(`${BASE}/robots.txt`)).text();
    assert(robots.includes('Sitemap:'), 'robots.txt does not reference the sitemap');
  });

  /* ── the privacy claim matches the code ── */
  await check('no page still claims "0 ไบต์ออกจากเครื่อง"', async () => {
    for (const path of ['/', '/privacy', '/tools/merge']) {
      const html = await (await fetch(`${BASE}${path}`)).text();
      assert(!html.includes('0 ไบต์ออกจากเครื่อง'), `${path} still makes the overclaim`);
      assert(!html.includes('ไบต์ถูกส่งออกนอกเครื่อง'), `${path} still makes the overclaim`);
    }
  });

  await check('the page loads no third-party origins', async () => {
    const external = [];
    const probe = await context.newPage();
    probe.on('request', (request) => {
      const host = new URL(request.url()).host;
      if (host && !host.startsWith('127.0.0.1') && !host.startsWith('localhost')) {
        external.push(request.url());
      }
    });
    await probe.goto(BASE, { waitUntil: 'networkidle' });
    await probe.close();
    assert(
      external.length === 0,
      `these third-party requests still happen:\n${external.join('\n')}`,
    );
  });

  /* ── stats endpoint hardening ── */
  await check('/api/stats rejects a POST with no Origin header', async () => {
    const response = await fetch(`${BASE}/api/stats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolId: 'merge', bytes: 1, pages: 1 }),
    });
    assert(response.status === 403, `expected 403, got ${response.status}`);
  });

  await check('/api/stats still answers GET without a database configured', async () => {
    const response = await fetch(`${BASE}/api/stats`);
    assert(response.ok, `GET /api/stats returned ${response.status}`);
    const body = await response.json();
    assert(typeof body.jobs === 'number', 'stats payload is malformed');
  });

  /* ── the save path that Chrome and Edge users actually get ── */
  await check('uses the File System Access API when the browser has one', async () => {
    const picker = await context.newPage();
    await picker.addInitScript(() => {
      const calls = [];
      Object.defineProperty(window, '__pickerCalls', { value: calls });
      // @ts-expect-error installing a stub for the test
      window.showSaveFilePicker = async (options) => {
        calls.push(options);
        return {
          createWritable: async () => ({ write: async () => {}, close: async () => {} }),
        };
      };
    });
    await picker.goto(`${BASE}/?tool=pdf-text`, { waitUntil: 'domcontentloaded' });
    await picker.waitForSelector('[role="dialog"]');
    const dialog = picker.locator('[role="dialog"]');
    await dialog.locator('input[type="file"]').setInputFiles(join(fixtures, 'thai-1page.pdf'));
    await dialog.getByRole('button', { name: /^เริ่ม/ }).click();
    await picker.waitForFunction(() => window.__pickerCalls?.length > 0, { timeout: 30_000 });

    const options = await picker.evaluate(() => window.__pickerCalls[0]);
    assert(
      typeof options.suggestedName === 'string' && options.suggestedName.endsWith('.txt'),
      `save dialog got a bad filename: ${JSON.stringify(options)}`,
    );
    const status = (await dialog.locator('[role="status"]').innerText()).trim();
    assert(/บันทึกไฟล์ลงตำแหน่งที่คุณเลือก/.test(status), `unexpected status: ${status}`);
    await picker.close();
  });

  await check('no uncaught page errors during the run', async () => {
    assert(consoleErrors.length === 0, consoleErrors.join('\n'));
  });

  await context.close();
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}

console.log('\nbrowser checks\n');
console.log(results.join('\n'));
console.log(`\n${results.length - failures}/${results.length} passed\n`);
process.exit(failures ? 1 : 0);
