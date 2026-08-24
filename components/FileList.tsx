'use client';

/**
 * The selected-files list.
 *
 * "รวม PDF" says "เรียงหลายไฟล์เป็นเอกสารเดียว" and the tool page says
 * "จัดลำดับตามต้องการ", but the original UI rendered a read-only list and
 * merged in whatever order the file picker happened to return — which on most
 * systems is neither alphabetical nor the order you clicked. Reordering is the
 * whole job for a merge tool, so it belongs here.
 *
 * Buttons rather than drag-and-drop as the primary control: they work with a
 * keyboard, with a screen reader and on a phone, all of which drag misses.
 */

import { ArrowDown, ArrowUp, FileText, X } from 'lucide-react';

export type FileListProps = {
  files: File[];
  onChange: (files: File[]) => void;
  /** Merge cares about order; a page-extract does not. */
  orderable?: boolean;
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export function FileList({ files, onChange, orderable = false }: FileListProps) {
  if (!files.length) return null;

  const move = (from: number, to: number) => {
    if (to < 0 || to >= files.length) return;
    const next = [...files];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
  };

  return (
    <ol
      className="max-h-56 space-y-2 overflow-auto"
      aria-label={`ไฟล์ที่เลือก ${files.length} ไฟล์${orderable ? ' เรียงตามลำดับที่จะรวม' : ''}`}
    >
      {files.map((file, index) => (
        <li
          key={`${file.name}-${file.size}-${file.lastModified}`}
          className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm"
        >
          {orderable && (
            <span
              className="grid size-6 shrink-0 place-items-center rounded-full bg-sunken text-xs font-semibold text-muted"
              aria-hidden="true"
            >
              {index + 1}
            </span>
          )}
          <FileText size={16} className="shrink-0 text-brand" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-body" title={file.name}>
            {file.name}
          </span>
          <span className="shrink-0 text-xs text-subtle">{formatBytes(file.size)}</span>

          {orderable && files.length > 1 && (
            <span className="flex shrink-0">
              <button
                type="button"
                onClick={() => move(index, index - 1)}
                disabled={index === 0}
                className="rounded-md p-1.5 text-muted hover:bg-sunken disabled:opacity-30"
              >
                <ArrowUp size={14} aria-hidden="true" />
                <span className="sr-only">เลื่อน {file.name} ขึ้น</span>
              </button>
              <button
                type="button"
                onClick={() => move(index, index + 1)}
                disabled={index === files.length - 1}
                className="rounded-md p-1.5 text-muted hover:bg-sunken disabled:opacity-30"
              >
                <ArrowDown size={14} aria-hidden="true" />
                <span className="sr-only">เลื่อน {file.name} ลง</span>
              </button>
            </span>
          )}

          <button
            type="button"
            onClick={() => onChange(files.filter((_, i) => i !== index))}
            className="shrink-0 rounded-md p-1.5 text-muted hover:bg-sunken"
          >
            <X size={14} aria-hidden="true" />
            <span className="sr-only">เอา {file.name} ออก</span>
          </button>
        </li>
      ))}
    </ol>
  );
}
