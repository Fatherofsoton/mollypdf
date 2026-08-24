/**
 * Building PDFs out of rendered pages and out of plain text.
 *
 * The important change versus the original `textToPdf()` is the *invisible
 * text layer*. Before, every "X เป็น PDF" tool drew the text onto a canvas and
 * embedded the canvas as a JPEG. The result looked right but was a picture:
 * you could not select, copy, search or screen-read a single word, and a page
 * of plain text weighed several hundred KB.
 *
 * pdf-lib cannot shape Thai on its own (no GSUB/GPOS), so we keep the canvas
 * for the visible layer — the browser shapes Thai correctly — and additionally
 * draw the same text with the embedded Thai font at zero opacity, aligned to
 * the same baseline. That is exactly how a searchable-scan PDF is built, and
 * it gives correct glyphs *and* selectable, searchable, indexable text.
 */

import { canvasToBlob, releaseCanvas, type RenderedPage } from './render';
import { ensureCanvasFont, tryEmbedThaiFonts, thaiFontFamily } from './fonts';
import { breathe, throwIfAborted, type RunContext } from '../runtime';

export type PdfBytes = Blob;

export function toPdfBlob(bytes: Uint8Array): Blob {
  // Copy into a fresh ArrayBuffer so the Blob is never backed by a detached
  // or shared buffer (Safari is strict about this).
  return new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
}

/**
 * Stream rendered pages into a PDF. Each canvas is encoded and released before
 * the next one is produced, so peak memory stays at one page.
 */
export async function pagesToPdf(
  pages: AsyncIterable<RenderedPage>,
  ctx: RunContext,
  options: { quality?: number; format?: 'image/jpeg' | 'image/png' } = {},
): Promise<Blob> {
  const { PDFDocument } = await import('pdf-lib');
  const out = await PDFDocument.create();
  const quality = options.quality ?? 0.82;
  const format = options.format ?? 'image/jpeg';
  let count = 0;

  for await (const rendered of pages) {
    throwIfAborted(ctx);
    const blob = await canvasToBlob(rendered.canvas, format, quality);
    const bytes = await blob.arrayBuffer();
    const image = format === 'image/png' ? await out.embedPng(bytes) : await out.embedJpg(bytes);
    const page = out.addPage([image.width, image.height]);
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
    releaseCanvas(rendered.canvas);
    count++;
    await breathe();
  }

  if (!count) throw new Error('ไม่มีหน้าเอกสารเหลือให้บันทึก');
  return toPdfBlob(await out.save());
}

/* ------------------------------------------------------------------ */
/* Text -> real, searchable PDF                                        */
/* ------------------------------------------------------------------ */

const PAGE = { width: 1240, height: 1754 }; // A4 at 150 dpi
const MARGIN = 110;
const FONT_SIZE = 30;
const LINE_HEIGHT = 46;
const LINES_PER_PAGE = Math.floor((PAGE.height - MARGIN * 2) / LINE_HEIGHT);

/**
 * Wrap on spaces where the text has them (Latin) and on characters where it
 * does not (Thai). The original wrapped character-by-character always, which
 * chopped English words in half.
 */
function wrap(text: string, measure: (s: string) => number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r/g, '').split('\n')) {
    if (!paragraph) {
      lines.push('');
      continue;
    }
    let line = '';
    const chunks = paragraph.split(/(\s+)/).filter((c) => c !== '');
    for (const chunk of chunks) {
      if (measure(line + chunk) <= maxWidth) {
        line += chunk;
        continue;
      }
      if (line.trim()) {
        lines.push(line.trimEnd());
        line = '';
      }
      if (measure(chunk) <= maxWidth) {
        line = chunk.trimStart();
        continue;
      }
      // A single unbreakable run (a Thai clause, or a long URL): break by char.
      for (const char of chunk) {
        if (measure(line + char) > maxWidth) {
          lines.push(line);
          line = char;
        } else line += char;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

export async function textToSearchablePdf(text: string, ctx: RunContext): Promise<Blob> {
  if (!text.trim()) throw new Error('ไม่มีข้อความให้แปลง');
  await ensureCanvasFont();

  const probe = document.createElement('canvas').getContext('2d');
  if (!probe) throw new Error('อุปกรณ์นี้ไม่รองรับ Canvas');
  probe.font = `${FONT_SIZE}px ${thaiFontFamily()}`;
  const lines = wrap(text, (s) => probe.measureText(s).width, PAGE.width - MARGIN * 2);

  const { PDFDocument, rgb } = await import('pdf-lib');
  const out = await PDFDocument.create();
  const fonts = await tryEmbedThaiFonts(out);

  const pageCount = Math.max(1, Math.ceil(lines.length / LINES_PER_PAGE));
  for (let p = 0; p < pageCount; p++) {
    throwIfAborted(ctx);
    const slice = lines.slice(p * LINES_PER_PAGE, (p + 1) * LINES_PER_PAGE);

    // --- visible layer: the browser shapes Thai correctly ---
    const canvas = document.createElement('canvas');
    canvas.width = PAGE.width;
    canvas.height = PAGE.height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('อุปกรณ์นี้ไม่รองรับ Canvas');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, PAGE.width, PAGE.height);
    context.fillStyle = '#111827';
    context.font = `${FONT_SIZE}px ${thaiFontFamily()}`;
    context.textBaseline = 'alphabetic';
    slice.forEach((line, i) => context.fillText(line, MARGIN, MARGIN + i * LINE_HEIGHT + FONT_SIZE));

    const blob = await canvasToBlob(canvas, 'image/png');
    const image = await out.embedPng(await blob.arrayBuffer());
    releaseCanvas(canvas);

    const page = out.addPage([PAGE.width, PAGE.height]);
    page.drawImage(image, { x: 0, y: 0, width: PAGE.width, height: PAGE.height });

    // --- invisible layer: real text, so the PDF is searchable ---
    if (fonts) slice.forEach((line, i) => {
      if (!line.trim()) return;
      page.drawText(line, {
        x: MARGIN,
        y: PAGE.height - (MARGIN + i * LINE_HEIGHT + FONT_SIZE),
        size: FONT_SIZE,
        font: fonts.regular,
        color: rgb(0, 0, 0),
        opacity: 0,
      });
    });
    await breathe();
  }

  out.setProducer('mollypdf');
  out.setCreator('mollypdf');
  return toPdfBlob(await out.save());
}

/**
 * OCR output -> searchable PDF: the scan stays as the picture, the recognised
 * words go underneath it invisibly at their detected bounding boxes.
 */
export type OcrWord = { text: string; x0: number; y0: number; x1: number; y1: number };

export async function ocrPagesToSearchablePdf(
  pages: Array<{ image: Blob; width: number; height: number; words: OcrWord[] }>,
  ctx: RunContext,
): Promise<Blob> {
  const { PDFDocument, rgb } = await import('pdf-lib');
  const out = await PDFDocument.create();
  const fonts = await tryEmbedThaiFonts(out);

  for (const item of pages) {
    throwIfAborted(ctx);
    const image = await out.embedJpg(await item.image.arrayBuffer());
    const page = out.addPage([item.width, item.height]);
    page.drawImage(image, { x: 0, y: 0, width: item.width, height: item.height });

    if (!fonts) continue; // no Thai font installed yet — visual layer only
    for (const word of item.words) {
      const text = word.text.trim();
      if (!text) continue;
      const height = Math.max(6, word.y1 - word.y0);
      const boxWidth = Math.max(1, word.x1 - word.x0);
      let size = height * 0.85;
      const natural = fonts.regular.widthOfTextAtSize(text, size);
      if (natural > 0) size = Math.min(size, (size * boxWidth) / natural);
      page.drawText(text, {
        x: word.x0,
        y: item.height - word.y1 + height * 0.15,
        size,
        font: fonts.regular,
        color: rgb(0, 0, 0),
        opacity: 0,
      });
    }
    await breathe();
  }

  out.setProducer('mollypdf');
  return toPdfBlob(await out.save());
}
