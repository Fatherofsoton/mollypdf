/**
 * Thai-aware text extraction.
 *
 * The original code did:
 *     content.items.map(i => i.str).join(' ')
 *
 * pdf.js splits a line into several text items whenever the font, size or
 * horizontal position changes — which for Thai happens constantly, because
 * tone marks and vowels are often placed with explicit positioning. Joining
 * those runs with a space injects spurious spaces *inside* Thai words:
 *
 *     "ประเทศไทย"  ->  "ประ เท ศ ไท ย"
 *
 * That single character is why "PDF เป็น Word", "PDF เป็นข้อความ" and
 * "นับคำใน PDF" all produced garbage for Thai documents (and why the word
 * count was wildly inflated — every run counted as a word).
 *
 * Two further Thai-specific problems surfaced once the regression test in
 * `tests/thai-text.test.ts` ran against a realistic fixture:
 *
 *  1. pdf.js *synthesises* its own whitespace items when it sees a horizontal
 *     gap. Its gap heuristic is tuned for scripts that separate words with
 *     spaces, so on Thai it invents spaces mid-word ("เอกสารฉบับนี้ เป็ นความลับ").
 *     Those items have to be dropped when both neighbours are Thai.
 *
 *  2. SARA AM (ำ, U+0E33) is stored in most fonts as two glyphs — NIKHAHIT
 *     plus SARA AA — and comes back out of the text layer as two code points,
 *     so "ประจำ" extracts as "ประจำา" with a stray extra vowel. Recomposing it
 *     is what makes the extracted text actually match the document.
 */

import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { openPdf, type PdfHandle } from './pdfjs';
import { step, type RunContext } from '../runtime';

const THAI = /[฀-๿]/;

function isThai(char: string | undefined) {
  return !!char && THAI.test(char);
}

/**
 * Undo the ways a PDF text layer mangles SARA AM.
 *
 * NIKHAHIT (U+0E4D) + SARA AA (U+0E32) is the decomposed form; a tone mark can
 * sit between the two, because the tone mark is applied to the base consonant
 * before the vowel is drawn. And some producers emit the composed SARA AM *and*
 * the trailing SARA AA, which is never valid Thai.
 */
export function normaliseThai(text: string): string {
  return text
    .replace(/ํ([่-๋])า/g, '$1ำ')
    .replace(/ํา/g, 'ำ')
    .replace(/ำา/g, 'ำ')
    // NIKHAHIT left stranded without its SARA AA is still SARA AM's first half.
    .normalize('NFC');
}

type Positioned = {
  str: string;
  x: number;
  y: number;
  width: number;
  size: number;
  hasEOL: boolean;
  blank: boolean;
};

function toPositioned(item: TextItem): Positioned {
  // transform = [scaleX, skewX, skewY, scaleY, translateX, translateY]
  const [, , , scaleY, x, y] = item.transform as number[];
  return {
    str: item.str,
    x,
    y,
    width: item.width,
    size: Math.abs(scaleY) || 10,
    hasEOL: Boolean(item.hasEOL),
    blank: item.str.trim() === '',
  };
}

export function joinTextItems(rawItems: TextItem[]): string {
  const items = rawItems
    .filter((item) => 'str' in item && item.str !== '')
    .map(toPositioned);
  if (!items.length) return '';

  /** Last non-space character emitted so far. */
  const lastRealChar = (s: string) => {
    for (let i = s.length - 1; i >= 0; i--) if (!/\s/.test(s[i])) return s[i];
    return undefined;
  };
  /** First non-space character of the next non-blank item. */
  const nextRealChar = (from: number) => {
    for (let i = from; i < items.length; i++) {
      const trimmed = items[i].str.trim();
      if (trimmed) return trimmed[0];
    }
    return undefined;
  };

  let out = '';
  let previous: Positioned | null = null;

  for (const [index, item] of items.entries()) {
    // pdf.js invents whitespace items whenever it sees a horizontal gap, and
    // its threshold is tuned for space-separated scripts, so on Thai it invents
    // spaces mid-word. A *real* space glyph carries the font's space advance
    // (~0.28em); a synthesised one is only as wide as the kerning gap that
    // triggered it. That width is the signal that tells them apart.
    if (item.blank) {
      const em = Math.max(item.size, previous?.size ?? item.size);
      const isRealSpaceGlyph = item.width >= em * 0.15;
      const left = lastRealChar(out);
      const right = nextRealChar(index + 1);
      if (previous && !item.hasEOL && !isRealSpaceGlyph && isThai(left) && isThai(right)) continue;
      if (item.hasEOL) {
        out += '\n';
        previous = item;
        continue;
      }
      if (!/\s$/.test(out) && out !== '') out += ' ';
      previous = item;
      continue;
    }

    if (previous) {
      const sameLine = Math.abs(item.y - previous.y) < previous.size * 0.5;
      if (!sameLine) {
        out += '\n';
      } else {
        const gap = item.x - (previous.x + previous.width);
        const left = lastRealChar(out);
        const right = item.str.trimStart()[0];
        const bothThai = isThai(left) && isThai(right);
        const alreadySpaced = /\s$/.test(out) || /^\s/.test(item.str);
        // A real word space is ~0.25em. Thai never needs one inserted, so only
        // bridge the gap at Latin/digit boundaries.
        if (!bothThai && !alreadySpaced && gap > previous.size * 0.22) out += ' ';
      }
    }

    out += item.str;
    if (item.hasEOL) out += '\n';
    previous = item;
  }

  return normaliseThai(out)
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Text of every page, in order. */
export async function extractPages(
  file: File,
  ctx: RunContext,
  options: { password?: string } = {},
): Promise<string[]> {
  let handle: PdfHandle | null = null;
  try {
    handle = await openPdf(file, options.password);
    const total = handle.doc.numPages;
    const pages: string[] = [];
    for (let n = 1; n <= total; n++) {
      const page = await handle.doc.getPage(n);
      const content = await page.getTextContent();
      pages.push(joinTextItems(content.items as TextItem[]));
      page.cleanup();
      await step(ctx, n, total, `กำลังอ่านข้อความหน้า ${n} จาก ${total}`);
    }
    return pages;
  } finally {
    await handle?.close();
  }
}

/**
 * Word counting that is correct for Thai.
 *
 * Splitting on whitespace counts an entire Thai sentence as one word. When the
 * platform ships `Intl.Segmenter` (every current browser does) we use the real
 * ICU Thai dictionary; otherwise we fall back to counting Thai character runs
 * so the number is at least in the right order of magnitude.
 */
export function countWords(text: string): {
  words: number;
  characters: number;
  approximate: boolean;
} {
  const characters = [...text.replace(/\s/g, '')].length;
  const Segmenter = (Intl as unknown as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (Segmenter) {
    const segmenter = new Segmenter('th', { granularity: 'word' });
    let words = 0;
    for (const segment of segmenter.segment(text)) if (segment.isWordLike) words++;
    return { words, characters, approximate: false };
  }
  const latin = text.match(/[A-Za-z0-9]+/g)?.length ?? 0;
  const thai = Math.ceil((text.match(/[฀-๿]/g)?.length ?? 0) / 4);
  return { words: latin + thai, characters, approximate: true };
}
