/**
 * Self-hosted Thai font, loaded once and shared.
 *
 * Two separate consumers need it:
 *  - canvas, for the *visible* layer (the browser does full OpenType shaping,
 *    so tone marks and vowels stack correctly)
 *  - pdf-lib, for the *invisible* text layer that makes the output searchable
 *
 * Put `Sarabun-Regular.ttf` and `Sarabun-Bold.ttf` in `public/fonts/`.
 * Both are SIL Open Font License, so they can ship with the site:
 *   https://fonts.google.com/specimen/Sarabun
 * Self-hosting also keeps the privacy promise honest — no Google Fonts request
 * at run time.
 */

import type { PDFDocument, PDFFont } from 'pdf-lib';

/**
 * The canvas 2d `font` property parses a CSS font shorthand but has no cascade
 * to resolve `var()` against — passing `var(--font-thai)` there silently fails
 * to parse and leaves the previous font in place, which is exactly how you end
 * up measuring text in one face and drawing it in another. Resolve it once.
 */
let resolvedFamily: string | null = null;

export function thaiFontFamily(): string {
  if (resolvedFamily) return resolvedFamily;
  const fallback = 'Sarabun, Tahoma, sans-serif';
  if (typeof document === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue('--font-thai').trim();
  resolvedFamily = value ? `${value}, ${fallback}` : fallback;
  return resolvedFamily;
}
const REGULAR_URL = '/fonts/Sarabun-Regular.ttf';
const BOLD_URL = '/fonts/Sarabun-Bold.ttf';

const bytesCache = new Map<string, Promise<ArrayBuffer>>();

function loadBytes(url: string) {
  let promise = bytesCache.get(url);
  if (!promise) {
    promise = fetch(url).then((response) => {
      if (!response.ok) throw new Error(`โหลดฟอนต์ไทยไม่สำเร็จ (${url})`);
      return response.arrayBuffer();
    });
    bytesCache.set(url, promise);
  }
  return promise;
}

/** Make sure the canvas measurements below use the real font, not a fallback. */
export async function ensureCanvasFont() {
  if (typeof document === 'undefined' || !document.fonts) return;
  const family = thaiFontFamily();
  await Promise.all([
    document.fonts.load(`400 32px ${family}`),
    document.fonts.load(`700 32px ${family}`),
  ]).catch(() => undefined);
  await document.fonts.ready;
}

export type EmbeddedFonts = { regular: PDFFont; bold: PDFFont };

/**
 * Non-throwing variant. If the TTFs have not been added to `public/fonts/` yet,
 * the caller still produces a correct-looking PDF — it just skips the invisible
 * searchable text layer instead of failing the whole job.
 */
export async function tryEmbedThaiFonts(doc: PDFDocument): Promise<EmbeddedFonts | null> {
  try {
    return await embedThaiFonts(doc);
  } catch {
    return null;
  }
}

/**
 * Register fontkit and embed the Thai faces into a pdf-lib document.
 * `subset: true` keeps only the glyphs actually used, so a one-page Thai
 * document adds ~15 KB rather than the full ~250 KB face.
 */
export async function embedThaiFonts(doc: PDFDocument): Promise<EmbeddedFonts> {
  const fontkit = (await import('@pdf-lib/fontkit')).default;
  doc.registerFontkit(fontkit);
  const [regularBytes, boldBytes] = await Promise.all([loadBytes(REGULAR_URL), loadBytes(BOLD_URL)]);
  const [regular, bold] = await Promise.all([
    doc.embedFont(regularBytes, { subset: true }),
    doc.embedFont(boldBytes, { subset: true }),
  ]);
  return { regular, bold };
}
