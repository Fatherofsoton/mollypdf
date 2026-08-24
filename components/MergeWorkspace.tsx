'use client';

/**
 * The Merge workspace.
 *
 * Merging is defined by *order*, and the original UI showed only a flat list of
 * filenames — which is useless when the files are called `scan_001.pdf` through
 * `scan_009.pdf` and you need the cover letter first. Each file is shown as its
 * own cover page with the position it will take in the finished document, and
 * order is changed with real buttons (so it works from a keyboard, unlike a
 * drag-only list).
 */

import { ArrowLeft, ArrowRight, FileText, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { renderCover, type Thumbnail } from '../lib/pdf/thumbnails';

export type MergeWorkspaceProps = {
  files: File[];
  onFilesChange: (files: File[]) => void;
  onAdd: () => void;
};

function fileKey(file: File) {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export function MergeWorkspace({ files, onFilesChange, onAdd }: MergeWorkspaceProps) {
  const [covers, setCovers] = useState<Record<string, Thumbnail | null>>({});
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;

    (async () => {
      for (const file of files) {
        const key = fileKey(file);
        if (controller.signal.aborted) return;
        // Render each cover once and keep it — re-rendering on every reorder
        // would make dragging the list feel broken.
        setCovers((current) => {
          if (key in current) return current;
          void renderCover(file, { signal: controller.signal, report: () => {} }).then((cover) => {
            if (!controller.signal.aborted) setCovers((c) => ({ ...c, [key]: cover }));
          });
          return { ...current, [key]: null };
        });
      }
    })();

    return () => controller.abort();
  }, [files]);

  function move(from: number, to: number) {
    if (to < 0 || to >= files.length) return;
    const next = [...files];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onFilesChange(next);
  }

  function remove(index: number) {
    onFilesChange(files.filter((_, i) => i !== index));
  }

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {files.length
            ? `${files.length} ไฟล์ · ${formatBytes(totalBytes)} — เรียงตามลำดับด้านล่าง`
            : 'ยังไม่ได้เลือกไฟล์'}
        </p>
        <button
          type="button"
          onClick={onAdd}
          className="flex shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] border border-line px-3 py-2 text-sm font-semibold text-body hover:bg-sunken"
        >
          <Plus size={15} aria-hidden="true" />เพิ่มไฟล์
        </button>
      </div>

      {files.length > 0 && (
        <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {files.map((file, index) => {
            const key = fileKey(file);
            const cover = covers[key];
            return (
              <li key={key} data-testid="merge-card" className="surface-card relative p-2.5">
                <span
                  aria-hidden="true"
                  className="absolute -left-1.5 -top-1.5 z-10 grid size-6 place-items-center rounded-full bg-[color:var(--surface-inverse)] text-[11px] font-semibold text-white"
                >
                  {index + 1}
                </span>
                <button
                  type="button"
                  onClick={() => remove(index)}
                  className="absolute -right-1.5 -top-1.5 z-10 grid size-6 place-items-center rounded-full border border-line bg-card text-muted hover:text-[color:var(--danger)]"
                >
                  <X size={13} aria-hidden="true" />
                  <span className="sr-only">เอา {file.name} ออก</span>
                </button>

                <div className="grid aspect-[1/1.32] place-items-center overflow-hidden rounded-[var(--radius-sm)] bg-sunken">
                  {cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={cover.dataUrl} alt="" className="max-h-full w-auto shadow-[var(--shadow-1)]" />
                  ) : (
                    <FileText size={26} className="text-subtle" aria-hidden="true" />
                  )}
                </div>

                <p className="mt-2 truncate text-xs font-medium text-strong" title={file.name}>
                  {file.name}
                </p>
                <p className="text-[11px] text-subtle">{formatBytes(file.size)}</p>

                <div className="mt-2 flex gap-1">
                  <button
                    type="button"
                    onClick={() => move(index, index - 1)}
                    disabled={index === 0}
                    className="flex-1 rounded-[var(--radius-sm)] border border-line py-1 text-muted disabled:opacity-35 hover:enabled:bg-sunken"
                  >
                    <ArrowLeft size={14} className="mx-auto" aria-hidden="true" />
                    <span className="sr-only">ย้าย {file.name} ขึ้นก่อน</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, index + 1)}
                    disabled={index === files.length - 1}
                    className="flex-1 rounded-[var(--radius-sm)] border border-line py-1 text-muted disabled:opacity-35 hover:enabled:bg-sunken"
                  >
                    <ArrowRight size={14} className="mx-auto" aria-hidden="true" />
                    <span className="sr-only">ย้าย {file.name} ไปหลัง</span>
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {files.length === 1 && (
        <p className="text-sm text-[color:var(--warn)]">
          ต้องมีอย่างน้อย 2 ไฟล์ถึงจะรวมได้ — กด &ldquo;เพิ่มไฟล์&rdquo; เพื่อเลือกอีกไฟล์
        </p>
      )}
    </div>
  );
}
