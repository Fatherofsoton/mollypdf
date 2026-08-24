/**
 * Memory-safe page rasteriser.
 *
 * The original `renderPdf()` built an array of every page canvas before
 * returning. An A4 page at scale 1.7 is roughly 1400 x 2000 x 4 bytes ≈ 11 MB
 * of canvas backing store, so a 100-page scan asked the tab for >1 GB and the
 * browser killed it. This version yields one page at a time and frees the
 * previous canvas before decoding the next.
 */

import { openPdf, type PdfHandle } from './pdfjs';
import { step, throwIfAborted, type RunContext } from '../runtime';

export type RenderedPage = {
  canvas: HTMLCanvasElement;
  index: number;
  total: number;
  /** PDF user-space size, needed to place an invisible text layer later. */
  viewport: { width: number; height: number; scale: number };
};

/** Shrink the canvas to nothing so the compositor can reclaim it immediately. */
export function releaseCanvas(canvas: HTMLCanvasElement) {
  canvas.width = 0;
  canvas.height = 0;
}

function makeCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: false });
  if (!ctx) throw new Error('อุปกรณ์นี้ไม่รองรับ Canvas');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return { canvas, ctx };
}

/**
 * Cap the rendering scale so one page never exceeds ~40 megapixels, which is
 * roughly where mobile Safari starts refusing to allocate a canvas.
 */
const MAX_PIXELS = 40_000_000;

export async function* renderPages(
  file: File,
  ctx: RunContext,
  options: { scale?: number; label?: string; password?: string } = {},
): AsyncGenerator<RenderedPage> {
  const scale = options.scale ?? 1.45;
  const label = options.label ?? 'กำลังแปลงหน้าเอกสาร';
  let handle: PdfHandle | null = null;
  try {
    handle = await openPdf(file, options.password);
    const total = handle.doc.numPages;
    for (let n = 1; n <= total; n++) {
      throwIfAborted(ctx);
      const page = await handle.doc.getPage(n);
      let viewport = page.getViewport({ scale });
      const pixels = viewport.width * viewport.height;
      if (pixels > MAX_PIXELS) {
        viewport = page.getViewport({ scale: scale * Math.sqrt(MAX_PIXELS / pixels) });
      }
      const { canvas, ctx: context } = makeCanvas(viewport.width, viewport.height);
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      yield {
        canvas,
        index: n - 1,
        total,
        viewport: { width: viewport.width, height: viewport.height, scale: viewport.scale },
      };
      // The consumer owns the canvas while the generator is suspended; once it
      // resumes we can safely drop pdf.js's own page cache for this page.
      page.cleanup();
      await step(ctx, n, total, `${label} ${n} จาก ${total}`);
    }
  } finally {
    await handle?.close();
  }
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  type = 'image/png',
  quality = 0.86,
): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('สร้างภาพจากหน้าเอกสารไม่สำเร็จ'))),
      type,
      quality,
    ),
  );
}

/** In-place greyscale, kept out of the render loop so it can be skipped. */
export function toGreyscale(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return;
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const grey = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    data[i] = grey;
    data[i + 1] = grey;
    data[i + 2] = grey;
  }
  context.putImageData(image, 0, 0);
}

/**
 * Rough "is this page blank?" test. Samples every 20th pixel and calls the page
 * blank when almost nothing is darker than near-white.
 */
export function looksBlank(canvas: HTMLCanvasElement, threshold = 0.003): boolean {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return false;
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  let dark = 0;
  let sampled = 0;
  for (let i = 0; i < data.length; i += 80) {
    sampled++;
    if (data[i] < 238 || data[i + 1] < 238 || data[i + 2] < 238) dark++;
  }
  return sampled > 0 && dark / sampled <= threshold;
}
