/**
 * Token contrast gate.
 *
 * Every colour pair the interface actually renders, measured in a real browser
 * in both themes. Reading a stylesheet is not enough: the bug this test was
 * written for was `--action-bg` being declared only inside the two dark blocks,
 * so in light mode every primary button resolved to `background: rgba(0,0,0,0)`
 * — a transparent button with body-coloured text. It looked like a link. No
 * amount of looking at the token list would have shown that; asking the browser
 * what it computed did, immediately.
 *
 * Thresholds are WCAG 2.2: 4.5:1 for text, 3:1 for focus rings, selected
 * borders and essential control edges (1.4.11 Non-text Contrast).
 */

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 3178;
const BASE = `http://127.0.0.1:${PORT}`;

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
        execSync("ps -eo pid,comm | awk '$2 ~ /^next-server/ {print $1}' | xargs -r kill -9", {
          stdio: 'ignore',
          shell: '/bin/bash',
        });
      } catch {
        /* nothing to stop */
      }
    }
    await sleep(1000);
  }
  throw new Error(`port ${PORT} never came free`);
}

await ensurePortFree();
const server = spawn('npx', ['next', 'start', '-p', String(PORT)], {
  cwd: new URL('../..', import.meta.url).pathname,
  stdio: 'ignore',
  env: { ...process.env, NODE_ENV: 'production' },
});
for (let i = 0; i < 120; i++) {
  try {
    if ((await fetch(BASE)).ok) break;
  } catch {
    /* not up yet */
  }
  await sleep(500);
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const PAIRS = [
  ['primary button text', '--action-fg', '--action-bg', 4.5],
  ['primary button hover', '--action-fg', '--action-bg-hover', 4.5],
  ['primary button active', '--action-fg', '--action-bg-active', 4.5],
  ['destructive button text', '--action-destructive-fg', '--action-destructive', 4.5],
  ['focus ring on page', '--focus-ring', '--surface-page', 3],
  ['focus ring on card', '--focus-ring', '--surface-card', 3],
  ['body text on page', '--text-body', '--surface-page', 4.5],
  ['muted text on card', '--text-muted', '--surface-card', 4.5],
  ['subtle text on page', '--text-subtle', '--surface-page', 4.5],
  ['strong text on card', '--text-strong', '--surface-card', 4.5],
  ['success text', '--feedback-success-text', '--feedback-success-bg', 4.5],
  ['warning text', '--feedback-warning-text', '--feedback-warning-bg', 4.5],
  ['error text', '--feedback-error-text', '--feedback-error-bg', 4.5],
  ['selected border on card', '--interactive-selected-border', '--surface-card', 3],
  ['brand on brand-soft', '--brand', '--brand-soft', 4.5],
  ['line-strong on card (control edge)', '--line-strong', '--surface-card', 3],
  ['on-inverse text on inverse band', '--text-on-inverse', '--surface-inverse', 4.5],
];
let bad = 0;
for (const scheme of ['light', 'dark']) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: scheme });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const res = await page.evaluate((pairs) => {
    const probe = document.createElement('div');
    document.body.appendChild(probe);
    const hex = (name) => {
      probe.style.color = 'transparent';
      probe.style.color = `var(${name})`;
      const m = getComputedStyle(probe).color.match(/\d+/g);
      return m ? '#' + m.slice(0, 3).map((n) => (+n).toString(16).padStart(2, '0')).join('') : null;
    };
    const lum = (h) => { const [r,g,b] = [1,3,5].map(i => parseInt(h.slice(i,i+2),16)/255);
      const f = c => c <= 0.03928 ? c/12.92 : ((c+0.055)/1.055)**2.4;
      return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b); };
    const out = pairs.map(([name, a, b, min]) => {
      const [ha, hb] = [hex(a), hex(b)];
      if (!ha || !hb) return { name, ratio: null, min, pass: false, note: 'unresolved' };
      const [x, y] = [lum(ha), lum(hb)];
      const ratio = +(((Math.max(x,y)+0.05)/(Math.min(x,y)+0.05)).toFixed(2));
      return { name, ratio, min, pass: ratio >= min, fg: ha, bg: hb };
    });
    probe.remove();
    const btn = document.querySelector('.btn-primary');
    return { button: btn && getComputedStyle(btn).backgroundColor, out };
  }, PAIRS);
  console.log(`\n=== ${scheme} ===  .btn-primary background: ${res.button}`);
  for (const r of res.out) {
    if (!r.pass) bad++;
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${String(r.ratio ?? r.note).padStart(6)}:1 (need ${r.min})  ${r.name}  ${r.fg ?? ''} on ${r.bg ?? ''}`);
  }
  await page.close();
}
await browser.close();
server.kill('SIGKILL');
console.log(`\n${bad === 0 ? 'all pairs meet their target' : bad + ' pair(s) below target'}`);
process.exit(bad ? 1 : 0);
