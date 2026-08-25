'use client';

/**
 * The tool dialog, rebuilt for accessibility.
 *
 * What was wrong with the inline version in `app/page.tsx`:
 *  - Escape did not close it, focus was never moved in and never restored, and
 *    Tab walked straight out into the page behind. A keyboard or screen-reader
 *    user who opened a tool could not get out of it.
 *  - The drop zone was a `<div onClick>`: not focusable, not activatable by
 *    keyboard, and announced as nothing.
 *  - Status text ("กำลังประมวลผล…", "เสร็จแล้ว") lived in a plain div, so
 *    assistive tech never announced that anything had happened.
 *  - There was no progress and no cancel, so a long job was indistinguishable
 *    from a crash.
 */

import { CheckCircle2, LoaderCircle, Upload, X, XCircle, Zap } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { Tool } from '../lib/tools/registry';
import type { Progress } from '../lib/runtime';
import { FileList } from './FileList';

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export type RunState = 'idle' | 'processing' | 'done' | 'error';

export type ToolDialogProps = {
  tool: Tool;
  files: File[];
  /** New files arriving from the picker or a drop. */
  onFiles: (files: File[]) => void;
  /** The list replacing itself — reorder or remove. */
  onSetFiles: (files: File[]) => void;
  onClose: () => void;
  onRun: () => void;
  onCancel: () => void;
  state: RunState;
  message: string;
  progress: Progress | null;
  children?: React.ReactNode;
  /** Tools like text-pdf need no file at all. */
  fileless?: boolean;
  /** Merge and compare care about file order; most tools do not. */
  orderable?: boolean;
  /** Read-aloud has no "run" button — it owns its own transport controls. */
  hideRunButton?: boolean;
  /** Split and Merge render a page/file workspace and need the room. */
  wide?: boolean;
  /** Merge shows its own visual file cards, so the plain list would duplicate it. */
  hideFileList?: boolean;
  /** Lets a workspace re-open the file picker to append more files. */
  registerPicker?: (open: () => void) => void;
  /**
   * Once a result is on screen the inputs that produced it are noise — the
   * merge source cards alone filled the dialog and pushed the merged pages out
   * of sight. The result panel carries its own way back.
   */
  hideInputs?: boolean;
};

export function ToolDialog({
  tool, files, onFiles, onSetFiles, onClose, onRun, onCancel,
  state, message, progress, children, fileless = false,
  orderable = false, hideRunButton = false,
  wide = false, hideFileList = false, registerPicker, hideInputs = false,
}: ToolDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocusTo = useRef<HTMLElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const titleId = useId();
  const descriptionId = useId();

  const busy = state === 'processing';

  // Remember where focus came from, move it into the dialog, restore on close.
  useEffect(() => {
    returnFocusTo.current = document.activeElement as HTMLElement | null;
    // Focus the panel itself rather than the first control. Landing on the
    // close button drew a focus ring around an X the moment the sheet opened,
    // which reads as "this is the thing to press"; focusing the container lets
    // a screen reader announce the dialog's name first and leaves Tab to walk
    // the controls in order.
    panelRef.current?.focus();
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
      returnFocusTo.current?.focus?.();
    };
  }, []);

  // Escape closes; Tab is trapped inside the panel.
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        if (busy) onCancel();
        else onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const nodes = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
        .filter((node) => node.offsetParent !== null);
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [busy, onCancel, onClose],
  );

  // Hand the "open the file picker" action out, so a workspace can offer its
  // own "add more files" button without duplicating the input.
  useEffect(() => {
    registerPicker?.(() => inputRef.current?.click());
  }, [registerPicker]);

  // Warn before the tab is closed mid-job — the work is unrecoverable.
  useEffect(() => {
    if (!busy) return;
    const handler = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [busy]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[color:var(--surface-inverse)]/70 backdrop-blur-sm sm:items-center sm:p-5"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !busy) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={`max-h-[92vh] w-full overflow-auto rounded-t-[28px] bg-[color:var(--surface-raised)] shadow-[var(--shadow-4)] outline-none sm:rounded-[28px] ${
          wide ? 'max-w-[1040px]' : 'max-w-[640px]'
        }`}
      >
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-[color:var(--surface-raised)] px-5 py-4 sm:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <span className={`tool-icon tool-${tool.color} shrink-0`} aria-hidden="true">
              <tool.icon size={20} />
            </span>
            <div className="min-w-0">
              <h2 id={titleId} className="truncate text-base font-semibold text-strong">{tool.title}</h2>
              <p id={descriptionId} className="truncate text-xs text-muted">{tool.description}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={busy ? onCancel : onClose}
            className="shrink-0 rounded-xl p-2 text-muted hover:bg-sunken"
          >
            <X size={20} aria-hidden="true" />
            <span className="sr-only">{busy ? 'ยกเลิกและปิด' : 'ปิดหน้าต่างเครื่องมือ'}</span>
          </button>
        </header>

        <div className="space-y-4 p-5 sm:p-7">
          {!fileless && !hideInputs && (
            <>
              {/* A real <button>: focusable, Enter/Space activate it, and it is
                  announced with its purpose.

                  Once a file is chosen it collapses to a single row. The tall
                  version used to stay put, pushing the page preview — which is
                  the actual working area for signing, stamping and exporting —
                  below the fold, so people reported the preview as "missing"
                  when it was simply off screen. Dropping a file still works on
                  either form. */}
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  onFiles([...event.dataTransfer.files]);
                }}
                className={
                  files.length
                    ? `flex w-full items-center justify-center gap-2 rounded-[var(--radius-md)] border border-dashed px-4 py-2.5 text-sm font-medium transition ${
                        dragging
                          ? 'border-brand bg-brand-soft text-brand'
                          : 'border-[color:var(--line-strong)] text-muted hover:bg-sunken'
                      }`
                    : `w-full rounded-[22px] border-2 border-dashed px-5 py-8 text-center transition ${
                        dragging ? 'border-brand bg-brand-soft' : 'border-[color:var(--line-strong)] bg-sunken'
                      }`
                }
              >
                {files.length ? (
                  <>
                    <Upload size={15} aria-hidden="true" />
                    {tool.multiple ? 'เพิ่มไฟล์' : 'เปลี่ยนไฟล์'}
                  </>
                ) : (
                  <>
                    <Upload className="mx-auto text-brand" size={28} aria-hidden="true" />
                    <strong className="mt-3 block text-strong">
                      {tool.id === 'compare'
                        ? 'เลือก PDF 2 ไฟล์'
                        : `เลือกไฟล์จากเครื่อง${tool.multiple ? ' (เลือกได้หลายไฟล์)' : ''}`}
                    </strong>
                    <span className="mt-1 block text-xs text-subtle">
                      ลากมาวางตรงนี้ก็ได้ · ไฟล์จะไม่ถูกอัปโหลด
                    </span>
                  </>
                )}
              </button>
              <input
                ref={inputRef}
                type="file"
                accept={tool.accept ?? 'application/pdf'}
                multiple={tool.multiple}
                onChange={(event) => onFiles([...(event.target.files ?? [])])}
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
              />
            </>
          )}

          {!hideFileList && !hideInputs && <FileList files={files} onChange={onSetFiles} orderable={orderable} />}

          {children}

          {/* Every status change is announced. `role="status"` is polite, so it
              does not interrupt what the user is already doing. */}
          <div role="status" aria-live="polite" data-testid="run-status" className="min-h-0">
            {state !== 'idle' && (
              <div
                className={`flex items-start gap-2 rounded-xl px-4 py-3 text-sm ${
                  state === 'error'
                    ? 'bg-[color:var(--danger-soft)] text-[color:var(--danger)]'
                    : state === 'done'
                      ? 'bg-[color:var(--ok-soft)] text-[color:var(--ok)]'
                      : 'bg-sunken text-body'
                }`}
              >
                {state === 'processing' ? (
                  <LoaderCircle size={17} className="mt-0.5 shrink-0 animate-spin" aria-hidden="true" />
                ) : state === 'done' ? (
                  <CheckCircle2 size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
                ) : (
                  <XCircle size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
                )}
                <span>{message}</span>
              </div>
            )}
          </div>

          {busy && (
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress?.ratio != null ? Math.round(progress.ratio * 100) : undefined}
              aria-label={progress?.label ?? 'กำลังประมวลผล'}
              className="progress-track"
            >
              <span
                className="progress-fill block"
                data-indeterminate={progress?.ratio == null}
                style={{ width: progress?.ratio != null ? `${progress.ratio * 100}%` : undefined }}
              />
            </div>
          )}

          {!hideRunButton && (
            <div className="flex gap-3">
              <button
                type="button"
                disabled={(!files.length && !fileless) || busy || tool.status !== 'ready'}
                onClick={onRun}
                className="btn-primary flex-1"
              >
                {busy ? (
                  <LoaderCircle size={18} className="animate-spin" aria-hidden="true" />
                ) : (
                  <Zap size={18} aria-hidden="true" />
                )}
                {busy ? 'กำลังทำงาน…' : `เริ่ม${tool.title}`}
              </button>
              {busy && (
                <button
                  type="button"
                  onClick={onCancel}
                  className="rounded-[var(--radius-md)] border border-line px-5 font-semibold text-body hover:bg-sunken"
                >
                  ยกเลิก
                </button>
              )}
            </div>
          )}

          <p className="text-center text-xs text-subtle">
            ประมวลผลในเบราว์เซอร์ · เนื้อหาไฟล์ไม่ถูกส่งออกจากเครื่อง
          </p>
        </div>
      </div>
    </div>
  );
}
