'use client';

/**
 * Drag-to-place workspace for the tools that stamp something onto a page —
 * ข้อความ, ลายเซ็น, ลายน้ำ, หัว–ท้ายกระดาษ, เลขหน้า.
 *
 * Until now these tools guessed: text landed in the middle of page 1, a
 * signature bottom-right, a watermark across the centre. If that was not where
 * you wanted it, there was nothing to do about it. Position is most of the job
 * for a signature, so this shows the real page and lets you put the thing
 * exactly where it goes.
 *
 * Coordinates are stored normalised (0–1 of the page box) rather than in
 * points, so the same placement survives a page of any size and the runner can
 * multiply by the real MediaBox without knowing anything about the preview.
 *
 * Accessibility: dragging is not the only way to move it. The marker is a
 * focusable control and the arrow keys nudge it — 1% a press, 10% with Shift —
 * which is also the precise way to do it on a laptop trackpad.
 */

import { Move } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { renderThumbnails, type Thumbnail } from '../lib/pdf/thumbnails';

export type PlacementWorkspaceProps = {
  file: File | undefined;
  options: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  /** What the marker should show — the typed text, or a drawn signature. */
  preview: { kind: 'text'; value: string } | { kind: 'image'; dataUrl: string } | null;
  /** Watermarks cover every page; a signature usually goes on one. */
  scope: 'single' | 'all';
  defaults?: { x?: number; y?: number; size?: number };
};

const clamp = (value: number) => Math.min(1, Math.max(0, value));

export function PlacementWorkspace({
  file,
  options,
  onChange,
  preview,
  scope,
  defaults,
}: PlacementWorkspaceProps) {
  const [pages, setPages] = useState<Thumbnail[]>([]);
  const [loading, setLoading] = useState(Boolean(file));
  const [dragging, setDragging] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);

  const pageIndex = Math.max(0, Number(options.previewPage ?? '1') - 1);
  const x = Number(options.posX ?? defaults?.x ?? 0.5);
  const y = Number(options.posY ?? defaults?.y ?? 0.5);
  const size = Number(options.size ?? defaults?.size ?? 0.35);

  const set = useCallback(
    (patch: Record<string, string>) => onChange({ ...options, ...patch }),
    [onChange, options],
  );

  useEffect(() => {
    if (!file) return;
    const controller = new AbortController();
    // Only the first few pages: this is a placement preview, not a page browser.
    renderThumbnails(
      file,
      { signal: controller.signal, report: () => {} },
      (thumb) => {
        if (!controller.signal.aborted) setPages((current) => [...current, thumb]);
      },
      { limit: 8 },
    )
      .catch(() => undefined)
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [file]);

  const page = pages[pageIndex] ?? pages[0];

  const moveTo = useCallback(
    (clientX: number, clientY: number) => {
      const stage = stageRef.current?.getBoundingClientRect();
      if (!stage || stage.width === 0) return;
      set({
        posX: clamp((clientX - stage.left) / stage.width).toFixed(4),
        posY: clamp((clientY - stage.top) / stage.height).toFixed(4),
      });
    },
    [set],
  );

  function onPointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  }

  function onPointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    if (!dragging) return;
    moveTo(event.clientX, event.clientY);
  }

  function onPointerUp(event: React.PointerEvent<HTMLButtonElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const stepSize = event.shiftKey ? 0.1 : 0.01;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-stepSize, 0],
      ArrowRight: [stepSize, 0],
      ArrowUp: [0, -stepSize],
      ArrowDown: [0, stepSize],
    };
    const delta = moves[event.key];
    if (!delta) return;
    event.preventDefault();
    set({ posX: clamp(x + delta[0]).toFixed(4), posY: clamp(y + delta[1]).toFixed(4) });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-strong">
          <Move size={15} aria-hidden="true" className="text-brand" />
          ลากเพื่อจัดตำแหน่ง
        </p>
        {scope === 'single' && pages.length > 1 && (
          <label className="flex items-center gap-2 text-sm text-muted">
            หน้า
            <select
              value={String(pageIndex + 1)}
              onChange={(event) => set({ previewPage: event.target.value, pages: event.target.value })}
              className="h-9 rounded-lg border border-line bg-card px-2 text-body outline-none focus:border-[color:var(--brand-ring)]"
            >
              {pages.map((_, index) => (
                <option key={index} value={index + 1}>
                  {index + 1}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="rounded-[var(--radius-lg)] border border-line bg-sunken p-4">
        {loading && !page && (
          <p className="py-16 text-center text-sm text-muted">กำลังเตรียมหน้าตัวอย่าง…</p>
        )}
        {!file && <p className="py-16 text-center text-sm text-subtle">เลือกไฟล์ก่อนเพื่อดูตัวอย่าง</p>}

        {page && (
          <div
            ref={stageRef}
            className="relative mx-auto touch-none select-none overflow-hidden rounded-[var(--radius-sm)] bg-white shadow-[var(--shadow-2)]"
            /**
             * Sized from the height, not the width: the sign tool stacks a
             * signature pad above this, and a full-width A4 preview pushed the
             * placement marker off screen. Fixing the height and letting
             * `aspect-ratio` derive the width keeps the whole page visible in
             * the dialog at any viewport.
             */
            style={{
              aspectRatio: `${page.width} / ${page.height}`,
              height: 'min(52vh, 520px)',
              width: 'auto',
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={page.dataUrl} alt={`ตัวอย่างหน้า ${pageIndex + 1}`} className="absolute inset-0 h-full w-full" />

            <button
              type="button"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onKeyDown={onKeyDown}
              aria-label={`ตำแหน่ง ${Math.round(x * 100)}% จากซ้าย ${Math.round(y * 100)}% จากบน — ลากหรือใช้ปุ่มลูกศรเพื่อย้าย`}
              className={`absolute z-10 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-md border-2 px-2 py-1 text-center text-[10px] font-semibold shadow-[var(--shadow-2)] ${
                dragging ? 'cursor-grabbing border-brand' : 'border-[color:var(--brand-ring)]'
              } bg-white/85 text-[#082a4a] backdrop-blur-[1px]`}
              style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${size * 100}%` }}
            >
              {preview?.kind === 'image' ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview.dataUrl} alt="" className="w-full" />
              ) : (
                <span className="block truncate">{preview?.value?.trim() || 'ข้อความ'}</span>
              )}
            </button>
          </div>
        )}
      </div>

      <div>
        <label htmlFor="placement-size" className="flex items-center justify-between text-sm font-semibold text-strong">
          ขนาด
          <span className="font-normal text-muted">{Math.round(size * 100)}% ของความกว้างหน้า</span>
        </label>
        <input
          id="placement-size"
          type="range"
          min={5}
          max={90}
          value={Math.round(size * 100)}
          onChange={(event) => set({ size: (Number(event.target.value) / 100).toFixed(4) })}
          className="mt-2 w-full accent-[color:var(--brand)]"
        />
      </div>

      <p className="text-xs text-subtle">
        {scope === 'all'
          ? 'ตำแหน่งนี้จะถูกใช้กับทุกหน้าในเอกสาร'
          : 'ตำแหน่งนี้จะถูกใช้กับหน้าที่เลือกไว้ด้านบน · ใช้ปุ่มลูกศรเพื่อขยับทีละน้อย (กด Shift เพื่อขยับเร็วขึ้น)'}
      </p>
    </div>
  );
}
