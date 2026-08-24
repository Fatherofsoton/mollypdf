/**
 * The token pipeline, checked without a browser.
 *
 * `scripts/build-tokens.mjs --check` does the real work: it refuses an alias
 * that points nowhere, a semantic token written as a raw hex, and — the one
 * that matters — a token defined in some themes but not all. That last rule is
 * the shape of the bug that shipped: `--action-bg` existed in both dark blocks
 * and in neither light one, so every primary button rendered transparent and
 * nothing anywhere complained.
 *
 * These tests also pin the two structural rules that a generator cannot infer:
 * the CSS on disk must match what the JSON produces (or a JSON edit silently
 * does nothing), and no component may reach past the semantic tier to name a
 * primitive or a literal hex.
 */

import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

test('tokens/colors.json is valid and app/tokens.css is not stale', () => {
  // Throws — with the generator's own diagnostics — on any of: bad alias,
  // raw hex in the semantic tier, missing token in a theme, stale CSS.
  execFileSync('node', ['scripts/build-tokens.mjs', '--check'], { cwd: root, stdio: 'pipe' });
});

test('every semantic token exists in all three theme states', () => {
  const css = read('app/tokens.css');
  const blocks = css.split(/^:root/m).slice(2); // [light, prefers-dark, data-theme=dark]
  assert.equal(blocks.length, 3, 'expected exactly three semantic theme blocks');

  const names = blocks.map((block) => new Set([...block.matchAll(/(--[a-z0-9-]+):/g)].map((m) => m[1])));
  const [light, media, explicit] = names;
  for (const name of light) {
    if (name.startsWith('--p-')) continue;
    assert.ok(media.has(name), `${name} is missing from the prefers-color-scheme block`);
    assert.ok(explicit.has(name), `${name} is missing from the [data-theme="dark"] block`);
  }
});

test('components never name a primitive or a literal colour', () => {
  // globals.css owns the component tier. Primitives may appear there only in
  // the compatibility block and the inverted-band scopes, which re-point
  // semantic names — never as a value a component reads directly.
  const css = read('app/globals.css');
  const rules = css
    .replace(/\/\*[\s\S]*?\*\//g, '') // comments quote old hexes on purpose
    .split('\n')
    .filter((line) => /^\s+(background|color|border-color|fill|stroke)\s*:/.test(line));

  for (const rule of rules) {
    assert.ok(!/#[0-9a-f]{3,8}\b/i.test(rule), `literal colour in a component rule: ${rule.trim()}`);
    assert.ok(!/var\(--p-/.test(rule), `component reaches past the semantic tier: ${rule.trim()}`);
  }
});

test('the dark surface ramp is actually separated', () => {
  const css = read('app/tokens.css');
  const dark = css.split(":root[data-theme='dark']")[1];
  const primitives = Object.fromEntries(
    [...css.matchAll(/(--p-[a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]),
  );
  const surface = (name: string) => {
    const alias = new RegExp(`--surface-${name}:\\s*var\\((--p-[a-z0-9-]+)\\)`).exec(dark);
    assert.ok(alias, `--surface-${name} is not defined in the dark theme`);
    return primitives[alias[1]];
  };

  const luminance = (hex: string) => {
    const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };
  const ratio = (a: string, b: string) => {
    const [x, y] = [luminance(a), luminance(b)];
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };

  // Below roughly 1.2:1 two dark surfaces read as one flat plane and every
  // panel edge has to come from a shadow instead. page/card used to sit at
  // 1.13:1, which is why dark mode looked like one sheet of paper.
  const pageToCard = ratio(surface('page'), surface('card'));
  const cardToRaised = ratio(surface('card'), surface('raised'));
  assert.ok(pageToCard >= 1.2, `dark page -> card is only ${pageToCard.toFixed(3)}:1`);
  assert.ok(cardToRaised >= 1.2, `dark card -> raised is only ${cardToRaised.toFixed(3)}:1`);
});

test('no two tool categories share a colour in either theme', () => {
  const css = read('app/tokens.css');
  // The generator writes one banner per theme block; splitting on it is the
  // only division that survives the file being reformatted.
  const sections = css.split('/* ── Tier 2');
  assert.equal(sections.length, 4, 'expected three semantic theme sections');
  for (const [label, block] of [
    ['light', sections[1]],
    ['dark', sections[3]],
  ] as const) {
    const values = [...block.matchAll(/--category-([a-z]+):\s*var\((--p-[a-z0-9-]+)\)/g)];
    assert.ok(values.length >= 6, `${label}: expected at least 6 category tokens, saw ${values.length}`);
    const seen = new Map<string, string>();
    for (const [, name, primitive] of values) {
      const clash = seen.get(primitive);
      assert.ok(!clash, `${label}: category ${name} and ${clash} both resolve to ${primitive}`);
      seen.set(primitive, name);
    }
  }
});
