import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // Vendored by scripts/sync-pdf-worker.mjs — not our source.
    'public/pdfjs/**',
    'tests/fixtures/**',
  ]),
  {
    // Node-side scripts and the browser harness are plain ESM, not app code.
    files: ['scripts/**/*.mjs', 'tests/**/*.mjs'],
    rules: { '@typescript-eslint/no-unused-expressions': 'off' },
  },
]);

export default eslintConfig;
