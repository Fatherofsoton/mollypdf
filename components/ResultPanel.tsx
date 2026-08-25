'use client';

/**
 * What happens after a tool finishes.
 *
 * The app used to save the file itself, from inside the promise that finished
 * the work. That is fine in Chrome and broken in Safari: by the time the job
 * ends, the click that started it is long gone, and Safari refuses a share
 * sheet or a `window.open` outside a user gesture — silently. On iOS the tool
 * said "เสร็จแล้ว" and no file ever arrived. The download now happens from this
 * button, inside its own click, which every browser accepts.
 *
 * The second thing it buys is a look at the result before it lands. A merge of
 * two documents is exactly the moment you discover page 7 should be page 1, and
 * the fix used to be "start over". Here the finished PDF is shown page by page
 * and can be reordered, rotated or trimmed; the download applies whatever is on
 * screen.
 */

import { ArrowLeft, CheckCircle2, Download, Eye, LoaderCircle, Pencil } from 'lucide-react';
import { useMemo, useState } from 'react';
import { OrganizeWorkspace } from './OrganizeWorkspace';

export type ToolOutcome = {
  blob: Blob;
  filename: string;
  message: string;
  pages: number;
};

export type ResultPanelProps = {
  result: ToolOutcome;
  /** Passed the page edits on screen, or null when nothing was touched. */
  onDownload: (edits: { order: number[]; rotations: Map<number, number> } | null) => void;
  saving: boolean;
  savedMessage: string;
  /** Merge and organise are about page order, so open the review straight away. */
  reviewOpen?: boolean;
  /** Return to the settings that produced this, to run it again differently. */
  onBack: () => void;
};

function humanSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function ResultPanel({ result, onDownload, saving, savedMessage, reviewOpen = false, onBack }: ResultPanelProps) {
  const [editing, setEditing] = useState(reviewOpen);
  const [edits, setEdits] = useState<Record<string, string>>({});

  // A multi-page PDF is the only result worth walking through page by page.
  const reviewable = result.blob.type === 'application/pdf' && result.pages > 1;

  const file = useMemo(
    () => new File([result.blob], result.filename, { type: result.blob.type || 'application/pdf' }),
    [result.blob, result.filename],
  );

  // `undefined` means the grid was never touched; `''` means every page was
  // deleted — a very different thing, and the download must refuse it rather
  // than quietly hand back the untouched file.
  const touched = edits.pageOrder !== undefined;
  const order = (edits.pageOrder ?? '')
    .split(',')
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0);
  const rotations = new Map<number, number>();
  for (const pair of (edits.pageRotations ?? '').split(',')) {
    const [slot, angle] = pair.split(':').map((part) => Number(part.trim()));
    if (slot > 0 && Number.isFinite(angle) && angle) rotations.set(slot, angle);
  }
  const unchanged =
    !touched ||
    (rotations.size === 0 && order.length === result.pages && order.every((page, i) => page === i + 1));
  const emptied = touched && order.length === 0;

  return (
    <div className="space-y-4" data-testid="result-panel">
      <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-lg)] border border-[color:var(--feedback-success-border)] bg-[color:var(--feedback-success-bg)] px-4 py-3">
        <CheckCircle2 size={20} className="shrink-0 text-[color:var(--feedback-success-icon)]" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[color:var(--feedback-success-text)]">
            {result.filename}
          </p>
          <p className="text-xs text-[color:var(--feedback-success-text)]">
            {humanSize(result.blob.size)}
            {result.pages > 0 && ` · ${result.pages.toLocaleString('th-TH')} หน้า`}
          </p>
        </div>
        {reviewable && (
          <button
            type="button"
            onClick={() => setEditing((value) => !value)}
            aria-pressed={editing}
            data-testid="review-toggle"
            className="flex items-center gap-1.5 rounded-[var(--radius-md)] border border-line bg-card px-3 py-2 text-sm font-medium text-body hover:bg-sunken"
          >
            {editing ? <Eye size={15} aria-hidden="true" /> : <Pencil size={15} aria-hidden="true" />}
            {editing ? 'ซ่อนหน้า' : 'ดูและแก้ไขหน้า'}
          </button>
        )}
      </div>

      {editing && (
        <OrganizeWorkspace
          file={file}
          options={edits}
          onChange={setEdits}
          summary={({ kept, removed, reordered, rotated }) =>
            `จะดาวน์โหลด ${kept.toLocaleString('th-TH')} หน้า` +
            (removed ? ` · ตัดออก ${removed}` : '') +
            (reordered ? ' · สลับลำดับแล้ว' : '') +
            (rotated ? ' · หมุนบางหน้า' : '')
          }
          hint="ลากการ์ดเพื่อสลับตำแหน่ง · หรือกด Tab ไปที่หน้าที่ต้องการแล้วใช้ปุ่มลูกศรซ้าย–ขวา · สิ่งที่เห็นตรงนี้คือสิ่งที่จะถูกดาวน์โหลด"
        />
      )}

      <button
        type="button"
        onClick={() => onDownload(unchanged ? null : { order, rotations })}
        disabled={saving || emptied}
        data-testid="download-button"
        className="btn-primary w-full"
      >
        {saving ? (
          <LoaderCircle size={18} className="animate-spin" aria-hidden="true" />
        ) : (
          <Download size={18} aria-hidden="true" />
        )}
        {saving
          ? 'กำลังบันทึก…'
          : emptied
            ? 'ต้องเหลืออย่างน้อย 1 หน้า'
            : unchanged
              ? 'ดาวน์โหลดไฟล์'
              : 'ดาวน์โหลดตามที่แก้ไข'}
      </button>

      <button
        type="button"
        onClick={onBack}
        data-testid="back-to-settings"
        className="flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-md)] px-3 py-2 text-sm text-muted hover:bg-sunken"
      >
        <ArrowLeft size={15} aria-hidden="true" />กลับไปแก้ไขแล้วทำใหม่
      </button>

      {savedMessage && (
        <p role="status" data-testid="save-status" className="text-center text-sm text-[color:var(--feedback-success-text)]">
          {savedMessage}
        </p>
      )}
    </div>
  );
}
