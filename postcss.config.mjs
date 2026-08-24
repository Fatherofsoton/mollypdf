/**
 * Tailwind v4 runs through PostCSS on the standard Next.js pipeline.
 * The Vite config that used to configure this is gone — see DEPLOY.md.
 */
const config = { plugins: { '@tailwindcss/postcss': {} } };
export default config;
