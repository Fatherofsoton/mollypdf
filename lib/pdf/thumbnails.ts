/**
 * Page thumbnails for the visual tool workspaces.
 *
 * A 244-page document is exactly the case that killed the original app, so this
 * never holds more than one canvas at a time: each page is rendered, encoded to
 * a small JPEG data URL, and its canvas released before the next page starts.
 * Results are streamed back through `onPage` so the grid fills in progressively
 * instead of the user staring at a blank screen for thirty seconds.
 */

import { openPdf, type PdfHandle } from './pdfjs';
import { releaseCanvas } from './render';
import { breathe, throwIfAborted, type RunContext } from '../runtime';

export type Thumbnail = {
  index: number;
  dataUrl: string;
  width: number;
  height: number;
};

/** Long edge of a thumbnail in CSS pixels — enough to read a heading at a glance. */
const TARGET = 260;

export async function renderThumbnails(
  file: File,
  ctx: RunContext,
  onPage: (thumb: Thumbnail, total: number) => void,
  options: { limit?: number; password?: string } = {},
): Promise<number> {
  let handle: PdfHandle | null = null;
  try {
    handle = await openPdf(file, options.password);
    const total = handle.doc.numPages;
    const last = Math.min(total, options.limit ?? total);

    for (let n = 1; n <= last; n++) {
      throwIfAborted(ctx);
      const page = await handle.doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const scale = TARGET / Math.max(base.width, base.height);
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('อุปกรณ์นี้ไม่รองรับ Canvas');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: context, viewport }).promise;

      onPage(
        {
          index: n - 1,
          dataUrl: canvas.toDataURL('image/jpeg', 0.7),
          width: canvas.width,
          height: canvas.height,
        },
        total,
      );

      releaseCanvas(canvas);
      page.cleanup();
      ctx.report({ ratio: n / last, label: `กำลังสร้างภาพย่อหน้า ${n} จาก ${last}` });
      await breathe();
    }
    return total;
  } finally {
    await handle?.close();
  }
}

/** Just the cover, for the file cards in the merge workspace. */
export async function renderCover(file: File, ctx: RunContext): Promise<Thumbnail | null> {
  try {
    let cover: Thumbnail | null = null;
    await renderThumbnails(file, ctx, (thumb) => {
      cover = thumb;
    }, { limit: 1 });
    return cover;
  } catch {
    return null;
  }
}

export async function pageCount(file: File): Promise<number> {
  let handle: PdfHandle | null = null;
  try {
    handle = await openPdf(file);
    return handle.doc.numPages;
  } catch {
    return 0;
  } finally {
    await handle?.close();
  }
}
