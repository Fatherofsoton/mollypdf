/**
 * Redaction.
 *
 * This is the highest-stakes tool on the site: a user is trusting it with an
 * ID card number or a salary figure. The original implementation had a silent
 * failure mode that made it actively dangerous:
 *
 *   item.str.toLowerCase().includes(needle)
 *
 * pdf.js hands back a *line* split across many text items. A phone number is
 * routinely delivered as "081", "-234", "-5678" in three separate items, so
 * `includes` never matched, no black box was drawn — and the tool still said
 * "เสร็จแล้ว" and downloaded a file the user believed was redacted.
 *
 * Fixes here:
 *  1. match against the reconstructed line, not individual items, so text that
 *     spans items is found
 *  2. map the match back to the character range inside each item, so the box
 *     covers exactly the matched characters instead of the whole run
 *  3. refuse to produce a file when nothing matched, and report the count when
 *     it did — no silent "success"
 */

import type { TextItem } from 'pdfjs-dist/types/src/display/api';

export type RedactBox = { x: number; y: number; width: number; height: number };

type Placed = {
  item: TextItem;
  start: number; // index of this item's first char within the line string
  end: number;
};

/** Group text items into visual lines using their baseline y position. */
function groupLines(items: TextItem[]) {
  const lines: Placed[][] = [];
  let current: Placed[] = [];
  let cursor = 0;
  let lastY: number | null = null;

  for (const item of items) {
    if (!('str' in item) || item.str === '') continue;
    const transform = item.transform as number[];
    const y = transform[5];
    const size = Math.abs(transform[3]) || 10;
    if (lastY !== null && Math.abs(y - lastY) > size * 0.5) {
      if (current.length) lines.push(current);
      current = [];
      cursor = 0;
    }
    current.push({ item, start: cursor, end: cursor + item.str.length });
    cursor += item.str.length;
    lastY = y;
  }
  if (current.length) lines.push(current);
  return lines;
}

/**
 * Find every occurrence of `needle` on a page and return viewport-space boxes.
 * `convert` maps a PDF user-space point to viewport pixels.
 */
export function findRedactionBoxes(
  items: TextItem[],
  needle: string,
  scale: number,
  pageHeight: number,
): RedactBox[] {
  const target = needle.trim().toLowerCase();
  if (!target) return [];
  const boxes: RedactBox[] = [];

  for (const line of groupLines(items)) {
    const text = line.map((p) => p.item.str).join('');
    const haystack = text.toLowerCase();
    let from = 0;
    for (;;) {
      const hit = haystack.indexOf(target, from);
      if (hit === -1) break;
      const hitEnd = hit + target.length;
      from = hit + 1;

      for (const placed of line) {
        if (placed.end <= hit || placed.start >= hitEnd) continue;
        const transform = placed.item.transform as number[];
        const size = Math.abs(transform[3]) || 10;
        const chars = placed.item.str.length || 1;
        const perChar = placed.item.width / chars;

        const localStart = Math.max(0, hit - placed.start);
        const localEnd = Math.min(chars, hitEnd - placed.start);
        const x = transform[4] + perChar * localStart;
        const width = Math.max(perChar, perChar * (localEnd - localStart));
        const y = transform[5];

        // PDF origin is bottom-left, canvas origin is top-left.
        boxes.push({
          x: (x - size * 0.08) * scale,
          y: (pageHeight - y - size * 0.92) * scale,
          width: (width + size * 0.16) * scale,
          height: size * 1.28 * scale,
        });
      }
    }
  }
  return boxes;
}

export function drawRedactions(canvas: HTMLCanvasElement, boxes: RedactBox[]) {
  if (!boxes.length) return;
  const context = canvas.getContext('2d');
  if (!context) return;
  context.fillStyle = '#000000';
  for (const box of boxes) context.fillRect(box.x, box.y, box.width, box.height);
}

export class NoRedactionMatchError extends Error {
  constructor(needle: string) {
    super(
      `ไม่พบข้อความ "${needle}" ในเอกสารนี้ จึงไม่สร้างไฟล์ให้ ` +
        'เพื่อไม่ให้เข้าใจผิดว่าปิดข้อมูลสำเร็จแล้ว — ลองตรวจตัวสะกด ' +
        'หรือถ้าเป็นไฟล์สแกน ให้ใช้ OCR ก่อน',
    );
    this.name = 'NoRedactionMatchError';
  }
}
