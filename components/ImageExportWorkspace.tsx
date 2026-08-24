'use client';

/**
 * PDF → JPG / PNG.
 *
 * The old behaviour was "every page, one quality, take it or leave it", which
 * is wrong for the common case: you scanned twelve pages and want page four as
 * an image. This shows the pages, lets you pick, states how many images you
 * will get before anything runs, and offers the one setting that actually
 * matters — resolution.
 */

import { CheckCircle2, Trash2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { PageSelectGrid } from './PageSelectGrid';

export type ImageExportWorkspaceProps = {
  file: File | undefined;
  format: 'jpg' | 'png';
  options: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
};

/**
 * Scale multiplies pdf.js's 72 dpi page box. 2 ≈ 150 dpi, which is the floor
 * for anything that will be printed; 3 ≈ 216 dpi is for reading fine print.
 */
const QUALITY = [
  { id: 'normal', label: 'ปกติ', hint: 'ประมาณ 150 dpi — เหมาะกับดูบนจอและพิมพ์ทั่วไป', scale: 2 },
  { id: 'high', label: 'สูง', hint: 'ประมาณ 220 dpi — ไฟล์ใหญ่ขึ้น เหมาะกับตัวหนังสือเล็ก', scale: 3 },
] as const;

export function ImageExportWorkspace({ file, format, options, onChange }: ImageExportWorkspaceProps) {
  const [total, setTotal] = useState(0);

  const selectAll = (options.exportMode ?? 'all') === 'all';
  const selected = options.selectedPages
    ? new Set(options.selectedPages.split(',').map(Number).filter(Boolean))
    : new Set<number>();
  const quality = options.imageQuality ?? 'normal';

  const set = useCallback(
    (patch: Record<string, string>) => onChange({ ...options, ...patch }),
    [onChange, options],
  );

  const toggle = (page: number) => {
    const next = new Set(selectAll ? [] : selected);
    if (next.has(page)) next.delete(page);
    else next.add(page);
    set({ exportMode: 'selected', selectedPages: [...next].sort((a, b) => a - b).join(',') });
  };

  const count = selectAll ? total : selected.size;
  const label = format.toUpperCase();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => set({ exportMode: 'all', selectedPages: '' })}
          aria-pressed={selectAll}
          className={`rounded-[var(--radius-md)] border px-4 py-2.5 text-sm font-semibold transition ${
            selectAll ? 'border-brand bg-brand-soft text-brand' : 'border-line text-muted'
          }`}
        >
          ทุกหน้า
        </button>
        <button
          type="button"
          onClick={() => set({ exportMode: 'selected' })}
          aria-pressed={!selectAll}
          className={`rounded-[var(--radius-md)] border px-4 py-2.5 text-sm font-semibold transition ${
            !selectAll ? 'border-brand bg-brand-soft text-brand' : 'border-line text-muted'
          }`}
        >
          เลือกหน้าเอง
        </button>
        {!selectAll && selected.size > 0 && (
          <button
            type="button"
            onClick={() => set({ exportMode: 'selected', selectedPages: '' })}
            className="ml-auto flex items-center gap-1.5 rounded-[var(--radius-md)] border border-line px-3 py-2.5 text-sm text-muted hover:bg-sunken"
          >
            <Trash2 size={15} aria-hidden="true" />ล้างที่เลือก
          </button>
        )}
      </div>

      {total > 0 && (
        <p
          role="status"
          data-testid="export-outcome"
          className="flex items-start gap-2.5 rounded-[var(--radius-md)] border border-line bg-sunken px-4 py-3 text-sm text-body"
        >
          <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-brand" aria-hidden="true" />
          {count
            ? `แต่ละหน้าจะถูกแปลงเป็นภาพ ${label} — จะได้ ${count.toLocaleString('th-TH')} ภาพ` +
              (count > 1 ? ' รวมอยู่ในไฟล์ ZIP' : '')
            : 'ยังไม่ได้เลือกหน้าใดเลย'}
        </p>
      )}

      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-strong">ความละเอียดของภาพ</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {QUALITY.map((item) => {
            const active = quality === item.id;
            return (
              <label
                key={item.id}
                className={`flex cursor-pointer items-start gap-3 rounded-[var(--radius-md)] border p-3.5 transition ${
                  active ? 'border-brand bg-brand-soft' : 'border-line bg-card hover:border-[color:var(--line-strong)]'
                }`}
              >
                <input
                  type="radio"
                  name="imageQuality"
                  value={item.id}
                  checked={active}
                  onChange={() => set({ imageQuality: item.id })}
                  className="mt-0.5 size-4 shrink-0 accent-[color:var(--brand)]"
                />
                <span>
                  <span className="block text-sm font-semibold text-strong">{item.label}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-muted">{item.hint}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <PageSelectGrid
        file={file}
        selected={selected}
        selectAll={selectAll}
        onToggle={toggle}
        onTotal={setTotal}
      />
    </div>
  );
}
