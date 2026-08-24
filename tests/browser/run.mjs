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

const downloadDir = join(root, 'tests', '.tmp');
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
    // protect/unlock render PasswordField, which generates its own id.
    const generic = dialog.locator('#tool-input');
    const field = (await generic.count()) ? generic : dialog.locator('input[type="password"]').first();
    await field.fill(text);
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
  const status = (await dialog.locator('[data-testid="run-status"]').innerText()).trim();
  return { download, status };
}

/**
 * A server left over from an earlier run keeps that build's manifest in memory
 * while `next build` replaces the chunk files on disk, so the browser requests
 * hashes that no longer exist and every page dies with ChunkLoadError. Refuse
 * to start until the port is genuinely ours.
 */
async function ensurePortFree() {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await fetch(BASE, { signal: AbortSignal.timeout(500) });
    } catch {
      return;
    }
    if (attempt === 0) {
      console.error(`port ${PORT} is already serving — stopping the stray server`);
      const { execSync } = await import('node:child_process');
      try {
        // Match on the process name only, so this can never hit the shell that
        // launched the test run.
        execSync(
          "ps -eo pid,comm | awk '$2 ~ /^next-server/ {print $1}' | xargs -r kill -9",
          { stdio: 'ignore', shell: '/bin/bash' },
        );
      } catch {
        /* nothing to stop */
      }
    }
    await sleep(1000);
  }
  throw new Error(
    `port ${PORT} is still in use. Stop the stray "next start -p ${PORT}" process and re-run.`,
  );
}

const { mkdir, rm } = await import('node:fs/promises');
await rm(downloadDir, { recursive: true, force: true });
await mkdir(downloadDir, { recursive: true });

await ensurePortFree();

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

  await check('every download arrives with a real, openable filename', async () => {
    // Split names its output in Thai ("<ชื่อ>-แยกหน้า.zip"), which is exactly
    // the case Chromium used to discard, leaving a file called "download".
    const { download, status } = await runToolWith(page, 'split', {
      file: 'thai-4page-with-blanks.pdf',
    });
    assert(download, `nothing downloaded. status: ${status}`);
    const saved = download.suggestedFilename();
    assert(saved !== 'download', 'the browser discarded the filename entirely');
    assert(/\.[a-z0-9]+$/i.test(saved), `no extension: ${saved}`);
    assert(/^[ -~]+$/.test(saved), `not ascii, so browsers may discard it: ${saved}`);
  });

  await check('no uncaught page errors during the run', async () => {
    assert(consoleErrors.length === 0, consoleErrors.join('\n'));
  });


  /* ── the invisible-text regression ─────────────────────────────────────
     Two separate bugs lived here, and neither was visible in the markup:

     1. `.section-title` and the utility meant to override it had equal
        specificity, so the component class won and painted near-black navy on
        the near-black navy band.
     2. The fix's own dark-mode block used `:root:not([data-theme='light'])`
        *outside* a `prefers-color-scheme` media query, so it matched the
        default (un-stamped) document and painted near-white text on the white
        card inside the band — measured at 1.13:1.

     Both only showed in one theme, which is why eyeballing missed them.
     Measuring every piece of text in the band, in both themes, is the check
     that actually holds. */
  await check('every piece of text in the privacy band meets AA in both themes', async () => {
    const failures = [];

    for (const scheme of ['light', 'dark']) {
      const themed = await context.newPage();
      await themed.emulateMedia({ colorScheme: scheme });
      await themed.goto(BASE, { waitUntil: 'domcontentloaded' });

      // An unstyled snapshot reports black-on-transparent and looks like a
      // failure, so wait until the stylesheet has actually landed.
      await themed.waitForFunction(() => {
        const band = document.querySelector('.on-inverse');
        const bg = band && getComputedStyle(band).backgroundColor;
        return Boolean(bg) && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
      }, { timeout: 20_000 });

      const samples = await themed.evaluate(() => {
        const band = document.querySelector('.on-inverse');
        const nodes = band.querySelectorAll('h2, p, dt, dd, span, a');
        return Array.from(nodes)
          .filter((el) => (el.textContent ?? '').trim().length > 2)
          .filter((el) => !Array.from(el.children).some((c) => (c.textContent ?? '').trim()))
          .map((el) => {
            let probe = el;
            let bg = 'rgba(0, 0, 0, 0)';
            while (probe && (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent')) {
              bg = getComputedStyle(probe).backgroundColor;
              probe = probe.parentElement;
            }
            return {
              text: (el.textContent ?? '').trim().slice(0, 24),
              fg: getComputedStyle(el).color,
              bg,
              size: parseFloat(getComputedStyle(el).fontSize),
              weight: Number(getComputedStyle(el).fontWeight) || 400,
            };
          });
      });

      const toRgb = (value) => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
      const lum = ([r, g, b]) => {
        const f = [r, g, b].map((v) => {
          const c = v / 255;
          return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
      };

      for (const sample of samples) {
        const a = lum(toRgb(sample.fg));
        const b = lum(toRgb(sample.bg));
        const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        // AA allows 3:1 for large text (>=24px, or >=18.66px bold).
        const large = sample.size >= 24 || (sample.size >= 18.66 && sample.weight >= 700);
        const required = large ? 3 : 4.5;
        if (ratio < required) {
          failures.push(
            `[${scheme}] "${sample.text}" ${ratio.toFixed(2)}:1 (needs ${required}:1) — ${sample.fg} on ${sample.bg}`,
          );
        }
      }
      assert(samples.length >= 5, `[${scheme}] only sampled ${samples.length} elements — selector is wrong`);
      await themed.close();
    }

    assert(failures.length === 0, `\n      ${failures.join('\n      ')}`);
  });

  await check('the step section says "ดำเนินการเสร็จในสามขั้นตอน"', async () => {
    const html = await (await fetch(`${BASE}/`)).text();
    assert(html.includes('ดำเนินการเสร็จในสามขั้นตอน'), 'new wording not found');
    assert(!html.includes('สามจังหวะก็เสร็จ'), 'old wording still present');
  });

  /* ── Split workspace ── */
  await check('Split shows page thumbnails and states the outcome up front', async () => {
    await openTool(page, 'split');
    const dialog = page.locator('[role="dialog"]');
    await dialog.locator('input[type="file"]').setInputFiles(join(fixtures, 'thai-4page-with-blanks.pdf'));

    // Thumbnails stream in one page at a time, so wait for the last one.
    await dialog.locator('[data-testid="page-thumb"]').nth(3).waitFor({ timeout: 45_000 });
    const thumbs = await dialog.locator('[data-testid="page-thumb"]').count();
    assert(thumbs === 4, `expected 4 page thumbnails, saw ${thumbs}`);

    const status = await dialog.locator('[data-testid="split-outcome"]').innerText();
    assert(/จะได้ 4 ไฟล์/.test(status), `outcome sentence was: ${status}`);
    await page.keyboard.press('Escape');
  });

  await check('Split range mode reports one file per range', async () => {
    await openTool(page, 'split');
    const dialog = page.locator('[role="dialog"]');
    await dialog.locator('input[type="file"]').setInputFiles(join(fixtures, 'thai-4page-with-blanks.pdf'));
    await dialog.locator('[data-testid="page-thumb"]').first().waitFor({ timeout: 45_000 });
    await dialog.getByRole('tab', { name: 'ช่วงหน้า' }).click();
    await dialog.locator('#split-ranges').fill('1-2, 3-4');

    const outcome = dialog.locator('[data-testid="split-outcome"]');
    await outcome.waitFor({ timeout: 15_000 });
    const status = await outcome.innerText();
    assert(/จะได้ 2 ไฟล์/.test(status), `outcome sentence was: ${status}`);
    await page.keyboard.press('Escape');
  });

  await check('Split by range really produces one PDF per range', async () => {
    await openTool(page, 'split');
    const dialog = page.locator('[role="dialog"]');
    await dialog.locator('input[type="file"]').setInputFiles(join(fixtures, 'thai-4page-with-blanks.pdf'));
    await dialog.getByRole('tab', { name: 'ช่วงหน้า' }).click();
    await dialog.locator('#split-ranges').fill('1-2, 3-4');

    const downloadPromise = page.waitForEvent('download', { timeout: 60_000 }).catch(() => null);
    await dialog.getByRole('button', { name: /^เริ่ม/ }).click();
    const download = await downloadPromise;
    assert(download, 'no archive produced');

    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(await readFile(await download.path()));
    const names = Object.keys(zip.files).filter((n) => n.endsWith('.pdf'));
    assert(names.length === 2, `expected 2 PDFs in the archive, got ${names.length}: ${names}`);
  });

  /* ── Compress levels ── */
  await check('Compress offers three named quality levels', async () => {
    await openTool(page, 'compress');
    const dialog = page.locator('[role="dialog"]');
    for (const label of ['บีบอัดสูงสุด', 'แนะนำ', 'บีบอัดน้อย']) {
      assert(await dialog.getByText(label, { exact: true }).isVisible(), `missing level: ${label}`);
    }
    const checked = await dialog.locator('input[name="compressLevel"]:checked').getAttribute('value');
    assert(checked === 'recommended', `default level should be recommended, was ${checked}`);
    await page.keyboard.press('Escape');
  });

  /* ── Merge workspace ── */
  await check('Merge shows a cover card per file with reorder controls', async () => {
    await openTool(page, 'merge');
    const dialog = page.locator('[role="dialog"]');
    await dialog.locator('input[type="file"]').setInputFiles([
      join(fixtures, 'thai-1page.pdf'),
      join(fixtures, 'thai-segmented.pdf'),
    ]);
    const cards = dialog.locator('[data-testid="merge-card"]');
    await cards.first().waitFor({ timeout: 20_000 });
    const count = await cards.count();
    const names = await cards.locator('p[title]').allTextContents();
    assert(count === 2, `expected 2 file cards, saw ${count}: ${names.join(', ')}`);
    // Picking files twice must append, not duplicate.
    assert(new Set(names).size === names.length, `duplicate cards: ${names.join(', ')}`);
    await page.keyboard.press('Escape');
  });

  /* ── Category navigation ── */
  await check('the header exposes tool categories with icons', async () => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.setViewportSize({ width: 1280, height: 900 });
    const trigger = page.getByRole('button', { name: 'แปลงไฟล์' });
    assert(await trigger.getAttribute('aria-expanded') === 'false', 'menu should start closed');
    await trigger.click();
    assert(await trigger.getAttribute('aria-expanded') === 'true', 'menu did not open');
    assert(await page.getByText('แปลงเป็น PDF', { exact: true }).isVisible(), 'missing to-PDF column');
    assert(await page.getByText('แปลงจาก PDF', { exact: true }).isVisible(), 'missing from-PDF column');
    await page.keyboard.press('Escape');
    assert(await trigger.getAttribute('aria-expanded') === 'false', 'Escape did not close the menu');
  });


  /* ── the four tools reported broken ──────────────────────────────────────
     They failed together with "undefined is not a function", and what they
     share is pdf.js — merge, the one that kept working, is the only one that
     never touches it. These run each of them end to end so a pdf.js loading
     failure can never again pass review. */
  for (const [toolId, label, fixture] of [
    ['pdf-word', 'PDF เป็น Word', 'thai-segmented.pdf'],
    ['word-count', 'นับคำใน PDF', 'thai-segmented.pdf'],
    ['compress', 'บีบอัด PDF', 'thai-4page-with-blanks.pdf'],
  ]) {
    await check(`${label} produces a file (pdf.js loads)`, async () => {
      const { download, status } = await runToolWith(page, toolId, { file: fixture });
      assert(download, `no file produced. status: ${status}`);
      assert(
        !/undefined is not a function|is not a function|เปิดตัวอ่าน PDF ไม่สำเร็จ/.test(status),
        `pdf.js failed to load: ${status}`,
      );
      const bytes = await readFile(await download.path());
      assert(bytes.length > 0, 'produced an empty file');
    });
  }

  await check('เปรียบเทียบ PDF works across two files', async () => {
    await openTool(page, 'compare');
    const dialog = page.locator('[role="dialog"]');
    await dialog.locator('input[type="file"]').setInputFiles([
      join(fixtures, 'thai-1page.pdf'),
      join(fixtures, 'thai-segmented.pdf'),
    ]);
    const downloadPromise = page.waitForEvent('download', { timeout: 90_000 }).catch(() => null);
    await dialog.getByRole('button', { name: /^เริ่ม/ }).click();
    const download = await downloadPromise;
    const status = (await dialog.locator('[data-testid="run-status"]').innerText()).trim();
    assert(download, `no comparison produced. status: ${status}`);
    assert(!/is not a function/.test(status), `pdf.js failed: ${status}`);
  });

  /* ── password ── */
  await check('the password field can reveal what was typed', async () => {
    await openTool(page, 'protect');
    const dialog = page.locator('[role="dialog"]');
    const field = dialog.locator('input[type="password"], input[type="text"]').first();
    await field.fill('ทดสอบ1234');
    assert(await field.getAttribute('type') === 'password', 'should start masked');

    await dialog.getByRole('button', { name: 'แสดงรหัสผ่าน' }).click();
    assert(await field.getAttribute('type') === 'text', 'reveal did not unmask the field');
    assert(await field.inputValue() === 'ทดสอบ1234', 'value changed when revealed');

    await dialog.getByRole('button', { name: 'ซ่อนรหัสผ่าน' }).click();
    assert(await field.getAttribute('type') === 'password', 'hide did not re-mask the field');
    await page.keyboard.press('Escape');
  });

  await check('protect then unlock returns a file that needs no password', async () => {
    // Lock it.
    const locked = await runToolWith(page, 'protect', {
      file: 'thai-1page.pdf',
      text: 'ทดสอบ1234',
    });
    assert(locked.download, `protect produced nothing. status: ${locked.status}`);
    const lockedPath = join(downloadDir, 'locked.pdf');
    await locked.download.saveAs(lockedPath);

    const lockedBytes = await readFile(lockedPath);
    assert(lockedBytes.includes(Buffer.from('/Encrypt')), 'protect did not actually encrypt');

    // Unlock it, through the real UI, with the file it just produced.
    await openTool(page, 'unlock');
    const dialog = page.locator('[role="dialog"]');
    await dialog.locator('input[type="file"]').setInputFiles(lockedPath);
    await dialog.locator('input[type="password"]').fill('ทดสอบ1234');
    const downloadPromise = page.waitForEvent('download', { timeout: 60_000 }).catch(() => null);
    await dialog.getByRole('button', { name: /^เริ่ม/ }).click();
    const download = await downloadPromise;
    const status = (await dialog.locator('[data-testid="run-status"]').innerText()).trim();
    assert(download, `unlock produced nothing. status: ${status}`);

    const out = await readFile(await download.path());
    assert(
      !out.includes(Buffer.from('/Encrypt')),
      'the "unlocked" file is still encrypted — this is the original bug',
    );

    // The real proof: pdf-lib opens it with no password.
    const lib = await import('pdf-lib');
    const reopened = await lib.PDFDocument.load(new Uint8Array(out));
    assert(reopened.getPageCount() === 1, 'unlocked file lost its pages');
  });

  await check('unlock reports a wrong password clearly instead of failing silently', async () => {
    const locked = await runToolWith(page, 'protect', { file: 'thai-1page.pdf', text: 'ทดสอบ1234' });
    const lockedPath = join(downloadDir, 'locked2.pdf');
    await locked.download.saveAs(lockedPath);

    await openTool(page, 'unlock');
    const dialog = page.locator('[role="dialog"]');
    await dialog.locator('input[type="file"]').setInputFiles(lockedPath);
    await dialog.locator('input[type="password"]').fill('ผิดแน่นอน');
    const downloadPromise = page.waitForEvent('download', { timeout: 20_000 }).catch(() => null);
    await dialog.getByRole('button', { name: /^เริ่ม/ }).click();
    const download = await downloadPromise;
    const status = (await dialog.locator('[data-testid="run-status"]').innerText()).trim();
    assert(!download, 'produced a file despite the wrong password');
    assert(/รหัสผ่านไม่ถูกต้อง/.test(status), `unhelpful message: ${status}`);
  });

  /* ── featured tools ── */
  await check('the four popular tools are starred and listed first', async () => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    const featured = page.locator('#featured-heading').locator('xpath=..').locator('li');
    await featured.first().waitFor({ timeout: 10_000 });
    const names = await featured.locator('span.font-semibold').allTextContents();
    for (const expected of ['รวม PDF', 'แยก PDF', 'PDF เป็น JPG', 'PDF เป็น PNG']) {
      assert(names.some((n) => n.trim() === expected), `missing from the starred row: ${expected}`);
    }
  });

  /* ── drag to place ── */
  await check('a stamp can be dragged to a new position and the PDF follows', async () => {
    await openTool(page, 'watermark');
    const dialog = page.locator('[role="dialog"]');
    await dialog.locator('input[type="file"]').setInputFiles(join(fixtures, 'thai-1page.pdf'));

    const marker = dialog.getByRole('button', { name: /ตำแหน่ง .* จากซ้าย/ });
    await marker.waitFor({ timeout: 45_000 });
    const before = await marker.getAttribute('aria-label');

    // Keyboard nudge — the same code path a drag uses, and deterministic.
    await marker.focus();
    for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowLeft');
    const after = await marker.getAttribute('aria-label');
    assert(before !== after, `position did not change: ${before}`);
    assert(/10% จากซ้าย|20% จากซ้าย/.test(after), `unexpected position: ${after}`);

    // And a real pointer drag moves it too.
    const stage = await dialog.locator('img[alt^="ตัวอย่างหน้า"]').boundingBox();
    const handle = await marker.boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(stage.x + stage.width * 0.8, stage.y + stage.height * 0.25, { steps: 8 });
    await page.mouse.up();
    const dragged = await marker.getAttribute('aria-label');
    assert(/(7[0-9]|8[0-9])% จากซ้าย/.test(dragged), `drag did not land where expected: ${dragged}`);
  });


  /* ── PDF → image: preview, page picking, quality ── */
  await check('PDF เป็น JPG shows pages and says how many images you will get', async () => {
    await openTool(page, 'pdf-jpg');
    const dialog = page.locator('[role="dialog"]');
    await dialog.locator('input[type="file"]').setInputFiles(join(fixtures, 'thai-4page-with-blanks.pdf'));
    await dialog.locator('[data-testid="page-thumb"]').nth(3).waitFor({ timeout: 45_000 });

    const outcome = await dialog.locator('[data-testid="export-outcome"]').innerText();
    assert(/จะได้ 4 ภาพ/.test(outcome), `outcome was: ${outcome}`);

    for (const label of ['ปกติ', 'สูง']) {
      assert(await dialog.getByText(label, { exact: true }).isVisible(), `missing quality: ${label}`);
    }
    await page.keyboard.press('Escape');
  });

  await check('picking two pages exports exactly those two', async () => {
    await openTool(page, 'pdf-jpg');
    const dialog = page.locator('[role="dialog"]');
    await dialog.locator('input[type="file"]').setInputFiles(join(fixtures, 'thai-4page-with-blanks.pdf'));
    await dialog.locator('[data-testid="page-thumb"]').nth(3).waitFor({ timeout: 45_000 });

    await dialog.getByRole('button', { name: 'เลือกหน้าเอง' }).click();
    await dialog.getByRole('button', { name: /^หน้า 1/ }).click();
    await dialog.getByRole('button', { name: /^หน้า 3/ }).click();

    const outcome = await dialog.locator('[data-testid="export-outcome"]').innerText();
    assert(/จะได้ 2 ภาพ/.test(outcome), `outcome was: ${outcome}`);

    const downloadPromise = page.waitForEvent('download', { timeout: 90_000 }).catch(() => null);
    await dialog.getByRole('button', { name: /^เริ่ม/ }).click();
    const download = await downloadPromise;
    assert(download, 'no archive produced');

    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(await readFile(await download.path()));
    const names = Object.keys(zip.files).filter((n) => n.endsWith('.jpg')).sort();
    assert(names.length === 2, `expected 2 images, got ${names.length}: ${names}`);
    assert(names[0].includes('1') && names[1].includes('3'), `wrong pages exported: ${names}`);
  });

  await check('exporting a single page returns the image itself, not a zip', async () => {
    await openTool(page, 'pdf-png');
    const dialog = page.locator('[role="dialog"]');
    await dialog.locator('input[type="file"]').setInputFiles(join(fixtures, 'thai-1page.pdf'));
    await dialog.locator('[data-testid="page-thumb"]').first().waitFor({ timeout: 45_000 });

    const downloadPromise = page.waitForEvent('download', { timeout: 60_000 }).catch(() => null);
    await dialog.getByRole('button', { name: /^เริ่ม/ }).click();
    const download = await downloadPromise;
    assert(download, 'nothing produced');
    const saved = download.suggestedFilename();
    // The name must be ASCII with a real extension, or the browser drops it
    // and the user gets a file called "download" that will not open.
    assert(saved.endsWith('.png'), `got ${saved}`);
    assert(/^[ -~]+$/.test(saved), `filename is not ascii, browsers discard it: ${saved}`);
  });

  /* ── the sign preview, which was reported missing ── */
  await check('เซ็นเอกสาร shows the page preview without scrolling past a huge dropzone', async () => {
    await openTool(page, 'sign');
    const dialog = page.locator('[role="dialog"]');
    await dialog.locator('input[type="file"]').setInputFiles(join(fixtures, 'thai-1page.pdf'));

    const marker = dialog.getByRole('button', { name: /ตำแหน่ง .* จากซ้าย/ });
    await marker.waitFor({ timeout: 45_000 });

    // Once a file is chosen the dropzone must collapse, otherwise the preview
    // ends up below the fold — which is exactly why it was reported missing.
    const dropzone = dialog.getByRole('button', { name: /เปลี่ยนไฟล์|เพิ่มไฟล์/ });
    const box = await dropzone.boundingBox();
    assert(box.height < 80, `dropzone is still ${Math.round(box.height)}px tall after choosing a file`);
    await page.keyboard.press('Escape');
  });

  await check('the starred row now includes all eight everyday tools', async () => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    const featured = page.locator('#featured-heading').locator('xpath=..').locator('li');
    await featured.first().waitFor({ timeout: 10_000 });
    const names = (await featured.locator('span.font-semibold').allTextContents()).map((n) => n.trim());
    for (const expected of [
      'รวม PDF', 'แยก PDF', 'จัดเรียงหน้า', 'PDF เป็น JPG',
      'PDF เป็น PNG', 'JPG เป็น PDF', 'PNG เป็น PDF', 'เซ็นเอกสาร',
    ]) {
      assert(names.includes(expected), `missing from the starred row: ${expected} (saw ${names.join(', ')})`);
    }
  });

  await check('จัดเรียงหน้า shows real pages, not a text box', async () => {
    await page.goto(`${BASE}/?tool=organize`, { waitUntil: 'domcontentloaded' });
    const dialog = page.locator('[role="dialog"]');
    await dialog.waitFor();
    await dialog.locator('input[type="file"]').setInputFiles(join(fixtures, 'thai-4page-with-blanks.pdf'));
    await dialog.locator('[data-testid="organize-card"]').nth(3).waitFor({ timeout: 45_000 });
    const cards = await dialog.locator('[data-testid="organize-card"]').count();
    assert(cards === 4, `expected 4 page cards, saw ${cards}`);
    assert(
      (await dialog.locator('#tool-input').count()) === 0,
      'the old "ลำดับหน้าใหม่" text box is still there competing with the grid',
    );
    await page.keyboard.press('Escape');
  });

  await check('a page can be moved without dragging — WCAG 2.5.7', async () => {
    await page.goto(`${BASE}/?tool=organize`, { waitUntil: 'domcontentloaded' });
    const dialog = page.locator('[role="dialog"]');
    await dialog.waitFor();
    await dialog.locator('input[type="file"]').setInputFiles(join(fixtures, 'thai-4page-with-blanks.pdf'));
    await dialog.locator('[data-testid="organize-card"]').nth(3).waitFor({ timeout: 45_000 });

    // Move page 1 right twice using the button alternative, then check the
    // order the runner will actually receive.
    await dialog.locator('[data-testid="organize-card"]').first()
      .locator('button[aria-label*="ไปทางขวา"]').click();
    await dialog.locator('[data-testid="organize-card"]').nth(1)
      .locator('button[aria-label*="ไปทางขวา"]').click();
    const label = await dialog.locator('[data-testid="organize-card"]').nth(2)
      .locator('[role="group"]').getAttribute('aria-label');
    assert(/หน้า 1 ของต้นฉบับ/.test(label ?? ''), `page 1 did not land in slot 3 (label: ${label})`);
    await page.keyboard.press('Escape');
  });

  await check('reordering really changes the produced PDF', async () => {
    await page.goto(`${BASE}/?tool=organize`, { waitUntil: 'domcontentloaded' });
    const dialog = page.locator('[role="dialog"]');
    await dialog.waitFor();
    await dialog.locator('input[type="file"]').setInputFiles(join(fixtures, 'thai-4page-with-blanks.pdf'));
    await dialog.locator('[data-testid="organize-card"]').nth(3).waitFor({ timeout: 45_000 });
    // Drop the last page, then save.
    await dialog.locator('[data-testid="organize-card"]').last()
      .locator('button[aria-label*="ลบหน้า"]').click();
    const downloadPromise = page.waitForEvent('download', { timeout: 60_000 }).catch(() => null);
    await dialog.getByRole('button', { name: /เริ่มจัดเรียงหน้า/ }).click();
    const file = await downloadPromise;
    assert(file, 'no file produced by จัดเรียงหน้า');
    const bytes = new Uint8Array(await readFile(await file.path()));
    assert(bytes.length > 400, 'organize produced an empty file');
    assert(Buffer.from(bytes.subarray(0, 5)).toString() === '%PDF-', 'organize did not produce a PDF');

    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = pdfjs.getDocument({ data: bytes });
    const doc = await task.promise;
    const pages = doc.numPages;
    await task.destroy();
    assert(pages === 3, `dropping one page of four should leave 3, got ${pages}`);
    await page.keyboard.press('Escape');
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
