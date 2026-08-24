#!/usr/bin/env node
/**
 * tokens/colors.json  ->  app/tokens.css
 *
 * The colour system used to live only in CSS, which meant nothing could check
 * it. A stylesheet has no idea that `--action-bg` was declared in two of the
 * three theme blocks and forgotten in the third, and that is exactly the bug
 * that shipped: every primary button in light mode rendered transparent.
 *
 * With the tokens in DTCG JSON the same question becomes answerable before the
 * browser ever runs — `validate` below refuses to build if a theme is missing a
 * token the other themes have, if an alias points nowhere, or if a semantic
 * token is written as a raw hex instead of pointing at a primitive.
 *
 *   node scripts/build-tokens.mjs           write app/tokens.css
 *   node scripts/build-tokens.mjs --check   fail if the file on disk is stale
 *
 * The CSS is generated, so it is never hand-edited. `--check` runs in CI and in
 * the test suite so a JSON edit that was not rebuilt cannot merge.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(root, 'tokens', 'colors.json');
const TARGET = join(root, 'app', 'tokens.css');

const HEX = /^#[0-9a-f]{6}$/i;
const ALIAS = /^\{([a-z0-9.-]+)\}$/i;

/** Walk a DTCG group, yielding [dotted.path, token] for every leaf. */
function* leaves(node, path = []) {
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith('$')) continue;
    if (value && typeof value === 'object' && '$value' in value) yield [[...path, key].join('.'), value];
    else if (value && typeof value === 'object') yield* leaves(value, [...path, key]);
  }
}

/** `semantic.action.bg` -> `--action-bg`; `primitive.azure.800` -> `--p-azure-800`. */
function cssName(path) {
  const parts = path.split('.');
  if (parts[0] === 'primitive') return `--p-${parts.slice(1).join('-')}`;
  const rest = parts.slice(1);
  // `brand.base` and `line.base` read better as the bare group name.
  if (rest.at(-1) === 'base') rest.pop();
  return `--${rest.join('-')}`;
}

function validate(doc) {
  const problems = [];
  const primitives = new Set([...leaves(doc.primitive ?? {}, ['primitive'])].map(([p]) => p));

  for (const tier of ['primitive', 'semantic', 'dark']) {
    for (const [path, token] of leaves(doc[tier] ?? {}, [tier])) {
      if (token.$type !== 'color') problems.push(`${path}: $type must be "color", got ${token.$type}`);
      const value = token.$value;
      const alias = ALIAS.exec(value ?? '');

      if (tier === 'primitive') {
        if (!HEX.test(value ?? '')) problems.push(`${path}: primitives must be a literal hex, got ${value}`);
        continue;
      }
      if (!alias) {
        problems.push(`${path}: must point at a primitive, e.g. {primitive.azure.800} — got ${value}`);
        continue;
      }
      if (!primitives.has(alias[1])) problems.push(`${path}: alias {${alias[1]}} does not exist`);
    }
  }

  // Every theme must define the same set. This is the check that would have
  // caught the transparent-button bug at build time.
  const light = new Set([...leaves(doc.semantic ?? {})].map(([p]) => p));
  const dark = new Set([...leaves(doc.dark ?? {})].map(([p]) => p));
  for (const path of light) {
    if (!dark.has(path)) problems.push(`dark theme is missing ${path}, which the light theme defines`);
  }
  for (const path of dark) {
    if (!light.has(path)) problems.push(`light theme is missing ${path}, which the dark theme defines`);
  }
  return problems;
}

function resolve(alias) {
  return `var(${cssName(ALIAS.exec(alias)[1])})`;
}

function block(node, indent) {
  const pad = ' '.repeat(indent);
  return [...leaves(node)]
    .map(([path, token]) => {
      const name = cssName(`semantic.${path}`);
      const line = `${pad}${name}: ${resolve(token.$value)};`;
      return token.$description ? `${pad}/* ${token.$description} */\n${line}` : line;
    })
    .join('\n');
}

function render(doc) {
  const primitives = [...leaves(doc.primitive, ['primitive'])]
    .map(([path, token]) => {
      const line = `  ${cssName(path)}: ${token.$value};`;
      return token.$description ? `  /* ${token.$description} */\n${line}` : line;
    })
    .join('\n');

  const lightBody = block(doc.semantic, 2);
  const darkBody = block(doc.dark, 4);
  const darkRoot = block(doc.dark, 2);

  return `/* GENERATED FILE — do not edit.
   Source: tokens/colors.json · Rebuild: node scripts/build-tokens.mjs
   Editing this file directly will be overwritten and will fail \`--check\` in CI.

   Three tiers, per the DTCG model:
     1. primitive  raw palette, identical in every theme
     2. semantic   purpose-named aliases — the only tier a component may name
     3. component  written in app/globals.css, references tier 2 only

   The theme blocks below cover all three states a viewer can be in: an explicit
   light choice, the un-stamped default where only the OS preference speaks, and
   an explicit dark choice. A token defined in fewer than all of them is the bug
   this pipeline exists to prevent. */

/* ── Tier 1 — primitives ─────────────────────────────────────────────────── */
:root {
${primitives}
}

/* ── Tier 2 — semantic, light ────────────────────────────────────────────── */
:root {
${lightBody}

  color-scheme: light;
}

/* ── Tier 2 — semantic, dark by OS preference (an explicit light choice wins) ─ */
:root:not([data-theme='light']) {
  @media (prefers-color-scheme: dark) {
${darkBody}

    color-scheme: dark;
  }
}

/* ── Tier 2 — semantic, dark by explicit choice ──────────────────────────── */
:root[data-theme='dark'] {
${darkRoot}

  color-scheme: dark;
}
`;
}

const doc = JSON.parse(await readFile(SOURCE, 'utf8'));
const problems = validate(doc);
if (problems.length) {
  console.error(`tokens/colors.json has ${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  · ${problem}`);
  process.exit(1);
}

const css = render(doc);

if (process.argv.includes('--check')) {
  const current = await readFile(TARGET, 'utf8').catch(() => null);
  if (current !== css) {
    console.error('app/tokens.css is out of date — run: node scripts/build-tokens.mjs');
    process.exit(1);
  }
  console.log(`tokens/colors.json is valid and app/tokens.css is up to date (${[...leaves(doc.primitive)].length} primitives, ${[...leaves(doc.semantic)].length} semantic tokens per theme)`);
} else {
  await writeFile(TARGET, css);
  console.log(`wrote app/tokens.css — ${[...leaves(doc.primitive)].length} primitives, ${[...leaves(doc.semantic)].length} semantic tokens × 3 theme states`);
}
