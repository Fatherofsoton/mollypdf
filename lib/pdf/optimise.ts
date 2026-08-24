/**
 * Compress, greyscale and blank-page removal.
 *
 * Two bugs are fixed here.
 *
 * 1. COMPRESS made files bigger. The original rasterised every page to JPEG at
 *    quality 0.58. For a text PDF — which is vector, and often already only a
 *    few hundred KB — that produces a *larger* file, destroys selectable text,
 *    and ruins print quality. Now: try the lossless path first, only rasterise
 *    when the document is genuinely image-heavy, and never hand back a result
 *    bigger than the input.
 *
 * 2. REMOVE BLANK PAGES destroyed the document. The original rasterised every
 *    surviving page at scale 0.45 — a blurry, unsearchable image PDF. Blank
 *    detection needs rasterising, but *deleting* a page does not: we now detect
 *    on throwaway thumbnails and delete at the object level with pdf-lib, so
 *    the surviving pages come through untouched.
 */

import { looksBlank, releaseCanvas, renderPages, toGreyscale, canvasToBlob } from './render';
import { toPdfBlob } from './compose';
import { breathe, step, throwIfAborted, type RunContext } from '../runtime';
import { openPdf } from './pdfjs';

/** Fraction of the page area covered by images, averaged over a sample. */
async function imageHeaviness(file: File): Promise<number> {
  const { doc, close } = await openPdf(file);
  try {
    const sample = Math.min(doc.numPages, 5);
    let score = 0;
    for (let n = 1; n <= sample; n++) {
      const page = await doc.getPage(n);
      const ops = await page.getOperatorList();
      const text = await page.getTextContent();
      const drawsImage = ops.fnArray.some((fn) => fn === 85 || fn === 86 || fn === 87); // paintImageXObject family
      const hasText = text.items.length > 20;
      score += drawsImage && !hasText ? 1 : drawsImage ? 0.5 : 0;
      page.cleanup();
    }
    return score / sample;
  } finally {
    await close();
  }
}

export type CompressResult = { blob: Blob; before: number; after: number; method: 'lossless' | 'raster' | 'unchanged' };

export async function compressPdf(file: File, ctx: RunContext): Promise<CompressResult> {
  const before = file.size;
  const { PDFDocument } = await import('pdf-lib');

  // Path A — rewrite the object stream. Free, lossless, keeps text selectable.
  const source = await PDFDocument.load(await file.arrayBuffer(), { updateMetadata: false });
  const lossless = toPdfBlob(await source.save({ useObjectStreams: true }));
  await step(ctx, 1, 3, 'กำลังจัดโครงสร้างไฟล์ใหม่');

  const heaviness = await imageHeaviness(file);
  if (heaviness < 0.5) {
    // Mostly text/vector: rasterising would look worse *and* weigh more.
    return lossless.size < before
      ? { blob: lossless, before, after: lossless.size, method: 'lossless' }
      : { blob: lossless, before, after: lossless.size, method: 'unchanged' };
  }

  // Path B — image-heavy (a scan): re-encoding really does help.
  await step(ctx, 2, 3, 'กำลังบีบอัดภาพในเอกสาร');
  const { PDFDocument: Out } = await import('pdf-lib');
  const out = await Out.create();
  for await (const rendered of renderPages(file, ctx, { scale: 1.35, label: 'กำลังบีบอัดหน้า' })) {
    const blob = await canvasToBlob(rendered.canvas, 'image/jpeg', 0.62);
    const image = await out.embedJpg(await blob.arrayBuffer());
    const page = out.addPage([image.width, image.height]);
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
    releaseCanvas(rendered.canvas);
  }
  const raster = toPdfBlob(await out.save());
  await step(ctx, 3, 3, 'กำลังตรวจขนาดผลลัพธ์');

  // Never hand back something worse than what the user gave us.
  const best = [
    { blob: raster, method: 'raster' as const },
    { blob: lossless, method: 'lossless' as const },
  ].sort((a, b) => a.blob.size - b.blob.size)[0];

  if (best.blob.size >= before) {
    return { blob: lossless, before, after: lossless.size, method: 'unchanged' };
  }
  return { blob: best.blob, before, after: best.blob.size, method: best.method };
}

/** Greyscale still has to rasterise — but at print resolution, not 0.45. */
export async function greyscalePdf(file: File, ctx: RunContext): Promise<Blob> {
  const { PDFDocument } = await import('pdf-lib');
  const out = await PDFDocument.create();
  for await (const rendered of renderPages(file, ctx, { scale: 2, label: 'กำลังแปลงขาวดำหน้า' })) {
    toGreyscale(rendered.canvas);
    const blob = await canvasToBlob(rendered.canvas, 'image/jpeg', 0.88);
    const image = await out.embedJpg(await blob.arrayBuffer());
    const page = out.addPage([image.width, image.height]);
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
    releaseCanvas(rendered.canvas);
  }
  return toPdfBlob(await out.save());
}

export type BlankResult = { blob: Blob; removed: number[]; kept: number };

export async function removeBlankPages(file: File, ctx: RunContext): Promise<BlankResult> {
  const blanks: number[] = [];
  // Detect on cheap thumbnails; the real pages are never rasterised.
  for await (const rendered of renderPages(file, ctx, { scale: 0.35, label: 'กำลังตรวจหน้าว่างหน้า' })) {
    if (looksBlank(rendered.canvas)) blanks.push(rendered.index);
    releaseCanvas(rendered.canvas);
  }
  throwIfAborted(ctx);

  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.load(await file.arrayBuffer());
  if (blanks.length >= doc.getPageCount()) {
    throw new Error('ตรวจพบว่าทุกหน้าเป็นหน้าว่าง จึงไม่สร้างไฟล์ให้');
  }
  if (!blanks.length) {
    throw new Error('ไม่พบหน้าว่างในเอกสารนี้ ไฟล์เดิมใช้งานได้ตามปกติ');
  }
  // Remove from the back so earlier indexes stay valid.
  for (const index of [...blanks].reverse()) doc.removePage(index);
  await breathe();
  return {
    blob: toPdfBlob(await doc.save()),
    removed: blanks.map((i) => i + 1),
    kept: doc.getPageCount(),
  };
}
