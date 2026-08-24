/**
 * Shared run context for every long-running tool.
 *
 * Fixes three problems in the original single-file implementation:
 *  1. no way to cancel a job once started
 *  2. no progress reporting (a 200-page OCR looked frozen)
 *  3. everything ran in one synchronous burst, so the tab locked up
 */

export class CancelledError extends Error {
  constructor() {
    super('ยกเลิกการทำงานแล้ว');
    this.name = 'CancelledError';
  }
}

export type Progress = {
  /** 0..1, or null when the total is not yet known */
  ratio: number | null;
  label: string;
};

export type RunContext = {
  signal: AbortSignal;
  report: (progress: Progress) => void;
};

export function throwIfAborted(ctx: RunContext) {
  if (ctx.signal.aborted) throw new CancelledError();
}

/**
 * Hand a frame back to the browser so the progress bar can paint and the
 * cancel button stays clickable. Call this between pages, never inside a
 * tight pixel loop.
 */
export function breathe(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

export async function step(ctx: RunContext, done: number, total: number, label: string) {
  throwIfAborted(ctx);
  ctx.report({ ratio: total > 0 ? Math.min(1, done / total) : null, label });
  await breathe();
}

/** Guard rails so a mis-drop cannot take the tab down. */
export const LIMITS = {
  /** Largest single file we will even attempt. */
  maxFileBytes: 300 * 1024 * 1024,
  /** Largest total across a multi-file job. */
  maxTotalBytes: 600 * 1024 * 1024,
  /** Above this we warn before rasterising (rasterising is the memory hog). */
  rasterPageWarning: 150,
};

export function assertWithinLimits(files: File[]) {
  const total = files.reduce((sum, f) => sum + f.size, 0);
  const tooBig = files.find((f) => f.size > LIMITS.maxFileBytes);
  if (tooBig) {
    throw new Error(
      `ไฟล์ "${tooBig.name}" ใหญ่เกิน ${Math.round(LIMITS.maxFileBytes / 1048576)} MB ` +
        'เบราว์เซอร์จะประมวลผลไม่ไหว กรุณาแบ่งไฟล์ก่อน',
    );
  }
  if (total > LIMITS.maxTotalBytes) {
    throw new Error(
      `ไฟล์รวมกันใหญ่เกิน ${Math.round(LIMITS.maxTotalBytes / 1048576)} MB กรุณาแบ่งเป็นหลายรอบ`,
    );
  }
}

/** Drag-and-drop bypasses the file picker's `accept` filter — re-check here. */
export function assertFileTypes(files: File[], accept: string | undefined) {
  if (!files.length) throw new Error('กรุณาเลือกไฟล์ก่อน');
  const spec = (accept ?? 'application/pdf')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!spec.length) return;

  for (const file of files) {
    const name = file.name.toLowerCase();
    const type = file.type.toLowerCase();
    const ok = spec.some((rule) =>
      rule.startsWith('.') ? name.endsWith(rule) : rule.endsWith('/*') ? type.startsWith(rule.slice(0, -1)) : type === rule,
    );
    if (!ok) {
      throw new Error(`ไฟล์ "${file.name}" ไม่ใช่ชนิดที่เครื่องมือนี้รองรับ (${spec.join(', ')})`);
    }
  }
}
