/**
 * One place that knows how to open a PDF with pdf.js.
 *
 * The original code re-created the worker URL on every call and never released
 * the loading task, so each job leaked a worker and its parsed document until
 * the tab was closed. `destroy()` lives on the *loading task*, not on the
 * document proxy, which is easy to miss — hence the `PdfHandle` wrapper: you
 * cannot open a document here without also getting the way to close it.
 */

import './map-upsert';
import type { PDFDocumentProxy } from 'pdfjs-dist';

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;

/**
 * The worker is served from our own origin at `/pdfjs/worker.mjs` — a shim that
 * installs the upsert polyfill in the worker's global scope and then loads the
 * real pdf.js worker. Both files are copied out of node_modules by
 * `scripts/sync-pdf-worker.mjs`, which runs on `prebuild`.
 *
 * Serving it ourselves rather than from a CDN is also what lets the privacy
 * page promise that no third-party origin is contacted.
 */
export const PDF_WORKER_URL = '/pdfjs/worker.mjs';

export function getPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

export class PasswordRequiredError extends Error {
  constructor() {
    super('ไฟล์นี้ถูกล็อกด้วยรหัสผ่าน กรุณาใช้เครื่องมือ "ปลดล็อก PDF" ก่อน');
    this.name = 'PasswordRequiredError';
  }
}

export type PdfHandle = {
  doc: PDFDocumentProxy;
  /** Always call this — ideally from a `finally`. */
  close: () => Promise<void>;
};

export async function openPdf(file: File, password?: string): Promise<PdfHandle> {
  const pdfjs = await getPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({
    data,
    password,
    // Recover from a broken xref table instead of hard-failing.
    stopAtErrors: false,
  });
  try {
    const doc = await task.promise;
    return {
      doc,
      close: async () => {
        try {
          await task.destroy();
        } catch {
          /* already gone */
        }
      },
    };
  } catch (error) {
    await task.destroy().catch(() => undefined);
    if ((error as { name?: string })?.name === 'PasswordException') throw new PasswordRequiredError();
    throw new Error(`เปิดไฟล์ "${file.name}" ไม่ได้ ไฟล์อาจเสียหายหรือไม่ใช่ PDF`);
  }
}

export async function countPages(file: File): Promise<number> {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (!isPdf) return 1;
  let handle: PdfHandle | null = null;
  try {
    handle = await openPdf(file);
    return handle.doc.numPages;
  } catch {
    return 1;
  } finally {
    await handle?.close();
  }
}
