'use client';

/**
 * The Split workspace.
 *
 * Splitting is the one job where a file list tells you nothing — you need to
 * see the pages to know where the break goes. This renders the document as a
 * thumbnail grid you select from directly, and states the outcome in plain
 * words before anything is produced ("จะได้ 244 ไฟล์"), because "split" can
 * mean four different things and getting the wrong one costs a re-run.
 *
 * Three modes, matching how people actually describe the task:
 *   ช่วงหน้า  — cut into a few documents at chosen boundaries
 *   รายหน้า   — every page (or the ones you tick) becomes its own file
 *   ตามขนาด   — chop into chunks under a size limit, for mail attachments
 */

import { CheckCircle2, Files, LoaderCircle, Plus, Scissors, Trash2, Weight } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { renderThumbnails, type Thumbnail } from '../lib/pdf/thumbnails';

export type SplitWorkspaceProps = {
  file: File | undefined;
  options: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
};

type Mode = 'range' | 'pages' | 'size';

const MODES: Array<{ id: Mode; label: string; icon: typeof Files; hint: string }> = [
  { id: 'range', label: 'ช่วงหน้า', icon: Scissors, hint: 'ตัดเป็นไม่กี่ไฟล์ตามช่วงที่กำหนดเอง' },
  { id: 'pages', label: 'รายหน้า', icon: Files, hint: 'แต่ละหน้ากลายเป็นไฟล์ของตัวเอง' },
  { id: 'size', label: 'ตามขนาด', icon: Weight, hint: 'ตัดเป็นก้อนที่ไม่เกินขนาดที่กำหนด' },
];

/** Turn a selected-page Set into the compact "1-3, 7, 9-12" the runner parses. */
export function toRangeString(pages: number[]): string {
  if (!pages.length) return '';
  const sorted = [...pages].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0];
  let previous = sorted[0];
  for (const page of sorted.slice(1)) {
    if (page === previous + 1) {
      previous = page;
      continue;
    }
    parts.push(start === previous ? `${start}` : `${start}-${previous}`);
    start = page;
    previous = page;
  }
  parts.push(start === previous ? `${start}` : `${start}-${previous}`);
  return parts.join(', ');
}

export function SplitWorkspace({ file, options, onChange }: SplitWorkspaceProps) {
  // The parent remounts this component when the chosen file changes (see the
  // `key` in ToolOptions), so per-file state can simply be initial state —
  // no effect needs to reset it, which is both simpler and one less render.
  const [thumbs, setThumbs] = useState<Thumbnail[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(Boolean(file));
  const [error, setError] = useState('');

  const mode = (options.splitMode as Mode) ?? 'pages';
  const extractAll = (options.extractMode ?? 'all') === 'all';
  const selected = options.selectedPages
    ? new Set(options.selectedPages.split(',').map(Number).filter(Boolean))
    : new Set<number>();

  const set = useCallback(
    (patch: Record<string, string>) => onChange({ ...options, ...patch }),
    [onChange, options],
  );

  useEffect(() => {
    if (!file) return;
    const controller = new AbortController();

    renderThumbnails(
      file,
      { signal: controller.signal, report: () => {} },
      (thumb, count) => {
        if (controller.signal.aborted) return;
        setTotal(count);
        setThumbs((current) => [...current, thumb]);
      },
    )
      .catch((e: unknown) => {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'อ่านไฟล์ไม่สำเร็จ');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [file]);

  const ranges = options.ranges ?? '';
  const rangeCount = ranges.split(',').map((r) => r.trim()).filter(Boolean).length;

  /** The sentence that tells the user exactly what they are about to get. */
  const outcome = (() => {
    if (!total) return null;
    if (mode === 'pages') {
      const count = extractAll ? total : selected.size;
      if (!count) return 'ยังไม่ได้เลือกหน้าใดเลย';
      return `หน้าที่เลือกจะถูกแยกเป็นไฟล์ PDF คนละไฟล์ — จะได้ ${count.toLocaleString('th-TH')} ไฟล์`;
    }
    if (mode === 'range') {
      if (!rangeCount) return 'ใส่ช่วงหน้าอย่างน้อยหนึ่งช่วง เช่น 1-10';
      return options.mergeRanges === 'true'
        ? `ทุกช่วงจะถูกรวมเป็นไฟล์เดียว — จะได้ 1 ไฟล์`
        : `แต่ละช่วงจะกลายเป็นไฟล์ของตัวเอง — จะได้ ${rangeCount} ไฟล์`;
    }
    const mb = Number(options.maxSizeMb || '10');
    return `เอกสารจะถูกตัดเป็นก้อนที่แต่ละก้อนไม่เกิน ${mb} MB`;
  })();

  function toggle(page: number) {
    const next = new Set(selected);
    if (next.has(page)) next.delete(page);
    else next.add(page);
    set({ extractMode: 'selected', selectedPages: [...next].sort((a, b) => a - b).join(',') });
  }

  function selectAll() {
    set({ extractMode: 'all', selectedPages: '' });
  }

  function clearAll() {
    set({ extractMode: 'selected', selectedPages: '' });
  }

  const isSelected = (page: number) => (extractAll ? true : selected.has(page));

  return (
    <div className="space-y-5">
      {/* ── mode tabs ── */}
      <div role="tablist" aria-label="รูปแบบการแยกไฟล์" className="grid grid-cols-3 gap-2">
        {MODES.map((item) => {
          const active = mode === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => set({ splitMode: item.id })}
              className={`flex flex-col items-center gap-1.5 rounded-[var(--radius-md)] border px-3 py-3 text-center transition ${
                active
                  ? 'border-brand bg-brand-soft text-strong'
                  : 'border-line bg-card text-muted hover:border-[color:var(--line-strong)]'
              }`}
            >
              <item.icon size={20} aria-hidden="true" className={active ? 'text-brand' : undefined} />
              <span className="text-sm font-semibold">{item.label}</span>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-subtle">{MODES.find((m) => m.id === mode)?.hint}</p>

      {/* ── per-mode controls ── */}
      {mode === 'pages' && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={selectAll}
            aria-pressed={extractAll}
            className={`rounded-[var(--radius-md)] border px-4 py-2.5 text-sm font-semibold transition ${
              extractAll ? 'border-brand bg-brand-soft text-brand' : 'border-line text-muted'
            }`}
          >
            แยกทุกหน้า
          </button>
          <button
            type="button"
            onClick={() => set({ extractMode: 'selected' })}
            aria-pressed={!extractAll}
            className={`rounded-[var(--radius-md)] border px-4 py-2.5 text-sm font-semibold transition ${
              !extractAll ? 'border-brand bg-brand-soft text-brand' : 'border-line text-muted'
            }`}
          >
            เลือกเอง
          </button>
          {!extractAll && (
            <button
              type="button"
              onClick={clearAll}
              className="ml-auto flex items-center gap-1.5 rounded-[var(--radius-md)] border border-line px-3 py-2.5 text-sm text-muted hover:bg-sunken"
            >
              <Trash2 size={15} aria-hidden="true" />ล้างที่เลือก
            </button>
          )}
        </div>
      )}

      {mode === 'range' && (
        <div className="space-y-3">
          <div>
            <label htmlFor="split-ranges" className="block text-sm font-semibold text-strong">
              ช่วงหน้า
            </label>
            <input
              id="split-ranges"
              value={ranges}
              onChange={(event) => set({ ranges: event.target.value })}
              placeholder="เช่น 1-10, 11-25, 26-40"
              className="mt-2 h-11 w-full rounded-xl border border-line bg-card px-3 text-body outline-none focus:border-[color:var(--brand-ring)]"
            />
            <p className="mt-1.5 text-xs text-subtle">คั่นแต่ละช่วงด้วยเครื่องหมายจุลภาค</p>
          </div>
          <label className="flex items-start gap-2.5 text-sm text-body">
            <input
              type="checkbox"
              checked={options.mergeRanges === 'true'}
              onChange={(event) => set({ mergeRanges: String(event.target.checked) })}
              className="mt-1 size-4 accent-[color:var(--brand)]"
            />
            รวมทุกช่วงเป็นไฟล์เดียว แทนที่จะแยกเป็นไฟล์ละช่วง
          </label>
        </div>
      )}

      {mode === 'size' && (
        <div>
          <label htmlFor="split-size" className="block text-sm font-semibold text-strong">
            ขนาดสูงสุดต่อไฟล์ (MB)
          </label>
          <input
            id="split-size"
            type="number"
            min={1}
            max={100}
            value={options.maxSizeMb ?? '10'}
            onChange={(event) => set({ maxSizeMb: event.target.value })}
            className="mt-2 h-11 w-full rounded-xl border border-line bg-card px-3 text-body outline-none focus:border-[color:var(--brand-ring)]"
          />
          <p className="mt-1.5 text-xs text-subtle">
            เหมาะกับการส่งอีเมลที่จำกัดขนาดไฟล์แนบ ระบบจะไม่ตัดกลางหน้า
          </p>
        </div>
      )}

      {/* ── outcome, stated before anything is produced ── */}
      {outcome && (
        <p
          className="flex items-start gap-2.5 rounded-[var(--radius-md)] border border-line bg-sunken px-4 py-3 text-sm text-body"
          role="status"
          data-testid="split-outcome"
        >
          <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-brand" aria-hidden="true" />
          {outcome}
        </p>
      )}

      {/* ── page grid ── */}
      {error && <p className="text-sm text-[color:var(--danger)]">{error}</p>}

      {file && (
        <div>
          <div className="mb-2 flex items-center justify-between text-xs text-subtle">
            <span>
              {total ? `${total.toLocaleString('th-TH')} หน้า` : 'กำลังอ่านเอกสาร…'}
              {mode === 'pages' && !extractAll && selected.size > 0 && ` · เลือกไว้ ${selected.size}`}
            </span>
            {loading && (
              <span className="flex items-center gap-1.5">
                <LoaderCircle size={13} className="animate-spin" aria-hidden="true" />
                {thumbs.length}/{total || '…'}
              </span>
            )}
          </div>

          <div className="max-h-[46vh] overflow-y-auto rounded-[var(--radius-lg)] border border-line bg-sunken p-3">
            <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5">
              {thumbs.map((thumb) => {
                const page = thumb.index + 1;
                const on = isSelected(page);
                const interactive = mode === 'pages' && !extractAll;
                return (
                  <li key={thumb.index} data-testid="page-thumb">
                    <button
                      type="button"
                      disabled={!interactive}
                      aria-pressed={interactive ? on : undefined}
                      aria-label={`หน้า ${page}${interactive ? (on ? ' — เลือกอยู่' : ' — ยังไม่เลือก') : ''}`}
                      onClick={() => interactive && toggle(page)}
                      className={`group relative block w-full rounded-[var(--radius-md)] border-2 bg-card p-1.5 transition ${
                        on ? 'border-brand' : 'border-transparent'
                      } ${interactive ? 'cursor-pointer hover:border-[color:var(--brand-ring)]' : 'cursor-default'}`}
                    >
                      {on && (
                        <span
                          aria-hidden="true"
                          className="absolute -left-1 -top-1 z-10 grid size-5 place-items-center rounded-full bg-[color:var(--ok)] text-white"
                        >
                          <CheckCircle2 size={13} />
                        </span>
                      )}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={thumb.dataUrl}
                        alt=""
                        loading="lazy"
                        className={`w-full rounded-sm shadow-[var(--shadow-1)] transition ${on ? '' : 'opacity-55'}`}
                      />
                      <span className="mt-1.5 block text-center text-[11px] font-medium text-muted">{page}</span>
                    </button>
                  </li>
                );
              })}

              {loading &&
                Array.from({ length: Math.max(0, Math.min(10, (total || 10) - thumbs.length)) }).map((_, i) => (
                  <li
                    key={`skeleton-${i}`}
                    className="aspect-[1/1.35] animate-pulse rounded-[var(--radius-md)] bg-card"
                    aria-hidden="true"
                  />
                ))}
            </ul>
          </div>
        </div>
      )}

      {!file && (
        <p className="flex items-center gap-2 text-sm text-subtle">
          <Plus size={15} aria-hidden="true" />เลือกไฟล์ก่อน แล้วหน้าเอกสารจะแสดงขึ้นมาให้เลือก
        </p>
      )}
    </div>
  );
}
