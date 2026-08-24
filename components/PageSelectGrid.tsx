'use client';

/**
 * Thumbnail grid with page selection.
 *
 * Shared by every tool that acts on "some of the pages" — แยก PDF,
 * PDF เป็น JPG/PNG — because typing "1, 4-7" into a text box requires you to
 * already know what is on those pages. Seeing them and clicking is the whole
 * point.
 *
 * Pages stream in one at a time (see lib/pdf/thumbnails.ts), so a 244-page
 * document fills the grid progressively instead of blocking on all of it.
 */

import { CheckCircle2, LoaderCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { renderThumbnails, type Thumbnail } from '../lib/pdf/thumbnails';

export type PageSelectGridProps = {
  file: File | undefined;
  /** 1-based page numbers. Empty set with `selectAll` means "everything". */
  selected: Set<number>;
  selectAll: boolean;
  onToggle: (page: number) => void;
  /** Told the real page count as soon as it is known. */
  onTotal?: (total: number) => void;
  /** Read-only preview — used when the current mode does not select pages. */
  interactive?: boolean;
  maxHeight?: string;
};

export function PageSelectGrid({
  file,
  selected,
  selectAll,
  onToggle,
  onTotal,
  interactive = true,
  maxHeight = '46vh',
}: PageSelectGridProps) {
  const [thumbs, setThumbs] = useState<Thumbnail[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(Boolean(file));
  const [error, setError] = useState('');

  useEffect(() => {
    if (!file) return;
    const controller = new AbortController();

    renderThumbnails(
      file,
      { signal: controller.signal, report: () => {} },
      (thumb, count) => {
        if (controller.signal.aborted) return;
        setTotal(count);
        onTotal?.(count);
        setThumbs((current) => [...current, thumb]);
      },
    )
      .catch((e: unknown) => {
        if (!controller.signal.aborted) {
          setError(e instanceof Error ? e.message : 'อ่านไฟล์ไม่สำเร็จ');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
    // `onTotal` is deliberately not a dependency: parents pass an inline
    // function and re-rendering the whole document on every keystroke would be
    // both slow and wrong.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  if (!file) return null;
  if (error) return <p className="text-sm text-[color:var(--danger)]">{error}</p>;

  const isOn = (page: number) => selectAll || selected.has(page);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs text-subtle">
        <span>
          {total ? `${total.toLocaleString('th-TH')} หน้า` : 'กำลังอ่านเอกสาร…'}
          {interactive && !selectAll && selected.size > 0 && ` · เลือกไว้ ${selected.size}`}
        </span>
        {loading && (
          <span className="flex items-center gap-1.5">
            <LoaderCircle size={13} className="animate-spin" aria-hidden="true" />
            {thumbs.length}/{total || '…'}
          </span>
        )}
      </div>

      <div
        className="overflow-y-auto rounded-[var(--radius-lg)] border border-line bg-sunken p-3"
        style={{ maxHeight }}
      >
        <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5">
          {thumbs.map((thumb) => {
            const page = thumb.index + 1;
            const on = isOn(page);
            return (
              <li key={thumb.index} data-testid="page-thumb">
                <button
                  type="button"
                  disabled={!interactive}
                  aria-pressed={interactive ? on : undefined}
                  aria-label={`หน้า ${page}${interactive ? (on ? ' — เลือกอยู่' : ' — ยังไม่เลือก') : ''}`}
                  onClick={() => interactive && onToggle(page)}
                  className={`relative block w-full rounded-[var(--radius-md)] border-2 bg-card p-1.5 transition ${
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
  );
}
