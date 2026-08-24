'use client';

/**
 * จัดเรียงหน้า — visual page organiser.
 *
 * The old tool was a text box: you typed "1, 2, 3" and hoped. That asks you to
 * already know what is on every page and to hold the new order in your head,
 * which is the whole job the tool was supposed to do for you. This shows the
 * pages, lets you drag them into place, rotate or drop any of them, and only
 * writes the result when you press save.
 *
 * Dragging is not the only way to move a page. WCAG 2.2 §2.5.7 (Dragging
 * Movements, AA) requires a single-pointer alternative for every drag, so each
 * card also carries ← → buttons and responds to the arrow keys when focused.
 * That is not a consolation prize for keyboard users — it is the precise way to
 * move one page by one position, which dragging is bad at.
 */

import { RotateCw, Trash2, Undo2, ChevronLeft, ChevronRight, GripVertical } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { renderThumbnails, type Thumbnail } from '../lib/pdf/thumbnails';

export type OrganizeWorkspaceProps = {
  file: File | undefined;
  options: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
};

/** One slot in the working order. `page` is the 1-based page in the source. */
type Slot = { page: number; rotation: number };

/**
 * A quarter turn swaps the page's width and height, so the rotated image has to
 * shrink to keep fitting the portrait slot it sits in — otherwise the preview
 * spills out of its card and reads as broken rather than rotated.
 */
const rotationClass: Record<number, string> = {
  0: 'rotate-0',
  90: 'rotate-90 scale-[0.74]',
  180: 'rotate-180',
  270: '-rotate-90 scale-[0.74]',
};

export function OrganizeWorkspace({ file, options, onChange }: OrganizeWorkspaceProps) {
  const [thumbs, setThumbs] = useState<Thumbnail[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(Boolean(file));
  const [error, setError] = useState('');
  const [slots, setSlots] = useState<Slot[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

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
        setSlots((current) =>
          current.length === thumb.index
            ? [...current, { page: thumb.index + 1, rotation: 0 }]
            : current,
        );
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
  }, [file]);

  // The runner reads these two strings; the grid above is the only thing that
  // writes them. Kept as plain text so the order survives a reload and so the
  // existing `parsePages` path still understands it.
  const publish = useCallback(
    (next: Slot[]) => {
      const rotations = next
        .map((slot, index) => (slot.rotation ? `${index + 1}:${slot.rotation}` : ''))
        .filter(Boolean)
        .join(',');
      onChange({
        ...options,
        pageOrder: next.map((slot) => slot.page).join(','),
        pageRotations: rotations,
      });
    },
    [onChange, options],
  );

  const apply = useCallback(
    (next: Slot[]) => {
      setSlots(next);
      publish(next);
    },
    [publish],
  );

  const move = (from: number, to: number) => {
    if (to < 0 || to >= slots.length || from === to) return;
    const next = [...slots];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    apply(next);
  };

  const rotate = (index: number) => {
    const next = slots.map((slot, i) =>
      i === index ? { ...slot, rotation: (slot.rotation + 90) % 360 } : slot,
    );
    apply(next);
  };

  const drop = (index: number) => apply(slots.filter((_, i) => i !== index));

  const reset = () => apply(thumbs.map((thumb) => ({ page: thumb.index + 1, rotation: 0 })));

  const thumbFor = (page: number) => thumbs.find((thumb) => thumb.index + 1 === page);
  const removed = total - slots.length;
  const reordered = slots.some((slot, index) => slot.page !== index + 1);
  const rotated = slots.some((slot) => slot.rotation !== 0);

  if (!file) return null;
  if (error) return <p className="text-sm text-[color:var(--danger)]">{error}</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p role="status" data-testid="organize-outcome" className="text-sm text-body">
          {total === 0
            ? 'กำลังอ่านเอกสาร…'
            : slots.length === 0
              ? 'ลบหมดทุกหน้าแล้ว — ต้องเหลืออย่างน้อย 1 หน้า'
              : `จะบันทึกเป็นเอกสาร ${slots.length.toLocaleString('th-TH')} หน้า` +
                (removed ? ` · ลบออก ${removed}` : '') +
                (reordered ? ' · สลับลำดับแล้ว' : '') +
                (rotated ? ' · หมุนบางหน้า' : '')}
        </p>
        {(removed > 0 || reordered || rotated) && (
          <button
            type="button"
            onClick={reset}
            className="flex items-center gap-1.5 rounded-[var(--radius-md)] border border-line px-3 py-2 text-sm text-muted hover:bg-sunken"
          >
            <Undo2 size={15} aria-hidden="true" />เริ่มใหม่
          </button>
        )}
      </div>

      <ul
        className="grid max-h-[52vh] grid-cols-2 gap-3 overflow-y-auto rounded-[var(--radius-lg)] border border-line bg-sunken p-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
        aria-label="หน้าในเอกสาร ลากเพื่อสลับตำแหน่ง หรือใช้ปุ่มลูกศร"
      >
        {slots.map((slot, index) => {
          const thumb = thumbFor(slot.page);
          const isDragging = dragIndex === index;
          const isTarget = overIndex === index && dragIndex !== null && dragIndex !== index;
          return (
            <li
              key={`${slot.page}-${index}`}
              data-testid="organize-card"
              draggable
              onDragStart={(event) => {
                setDragIndex(index);
                event.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setOverIndex(index);
              }}
              onDragEnd={() => {
                setDragIndex(null);
                setOverIndex(null);
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragIndex !== null) move(dragIndex, index);
                setDragIndex(null);
                setOverIndex(null);
              }}
              className={`group relative rounded-[var(--radius-md)] border-2 bg-card p-2 transition ${
                isTarget
                  ? 'border-[color:var(--brand)] ring-2 ring-[color:var(--brand-ring)]'
                  : 'border-transparent'
              } ${isDragging ? 'opacity-40' : ''}`}
            >
              <div
                role="group"
                tabIndex={0}
                aria-label={`ตำแหน่งที่ ${index + 1} จาก ${slots.length} — หน้า ${slot.page} ของต้นฉบับ${
                  slot.rotation ? ` หมุน ${slot.rotation} องศา` : ''
                } · กดลูกศรซ้ายขวาเพื่อย้าย`}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowLeft') {
                    event.preventDefault();
                    move(index, index - 1);
                  } else if (event.key === 'ArrowRight') {
                    event.preventDefault();
                    move(index, index + 1);
                  } else if (event.key === 'Delete' || event.key === 'Backspace') {
                    event.preventDefault();
                    drop(index);
                  }
                }}
                className="cursor-grab rounded-[var(--radius-sm)] outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--brand-ring)] active:cursor-grabbing"
              >
                <div className="relative grid h-[168px] place-items-center overflow-hidden rounded-[var(--radius-sm)] bg-white">
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={thumb.dataUrl}
                      alt=""
                      loading="lazy"
                      className={`max-h-full max-w-full object-contain transition-transform ${rotationClass[slot.rotation]}`}
                    />
                  ) : (
                    <div className="size-full animate-pulse bg-sunken" />
                  )}
                  <span
                    aria-hidden="true"
                    className="absolute left-1 top-1 grid size-6 place-items-center rounded-md bg-[color:var(--surface-inverse)]/80 text-[11px] font-semibold text-white"
                  >
                    {index + 1}
                  </span>
                  <GripVertical
                    size={15}
                    aria-hidden="true"
                    className="absolute right-1 top-1 text-[color:var(--text-subtle)] opacity-0 transition group-hover:opacity-100"
                  />
                </div>
              </div>

              {/* The non-dragging alternative WCAG 2.5.7 asks for — and the
                  only precise way to move a page by exactly one place. */}
              <div className="mt-1.5 flex items-center justify-between gap-0.5">
                <button
                  type="button"
                  onClick={() => move(index, index - 1)}
                  disabled={index === 0}
                  aria-label={`ย้ายหน้า ${slot.page} ไปทางซ้าย`}
                  className="grid size-7 place-items-center rounded-md text-muted hover:bg-sunken disabled:opacity-30"
                >
                  <ChevronLeft size={15} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => rotate(index)}
                  aria-label={`หมุนหน้า ${slot.page} ตามเข็ม 90 องศา`}
                  className="grid size-7 place-items-center rounded-md text-muted hover:bg-sunken"
                >
                  <RotateCw size={15} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => drop(index)}
                  aria-label={`ลบหน้า ${slot.page} ออกจากเอกสาร`}
                  className="grid size-7 place-items-center rounded-md text-[color:var(--danger)] hover:bg-[color:var(--danger-soft)]"
                >
                  <Trash2 size={15} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => move(index, index + 1)}
                  disabled={index === slots.length - 1}
                  aria-label={`ย้ายหน้า ${slot.page} ไปทางขวา`}
                  className="grid size-7 place-items-center rounded-md text-muted hover:bg-sunken disabled:opacity-30"
                >
                  <ChevronRight size={15} aria-hidden="true" />
                </button>
              </div>
            </li>
          );
        })}

        {loading &&
          Array.from({ length: Math.max(0, Math.min(8, (total || 8) - thumbs.length)) }).map((_, i) => (
            <li
              key={`skeleton-${i}`}
              className="h-[168px] animate-pulse rounded-[var(--radius-md)] bg-card"
              aria-hidden="true"
            />
          ))}
      </ul>

      <p className="text-xs text-subtle">
        ลากการ์ดเพื่อสลับตำแหน่ง · หรือกด Tab ไปที่หน้าที่ต้องการแล้วใช้ปุ่มลูกศรซ้าย–ขวา ·
        การเปลี่ยนแปลงยังไม่ถูกบันทึกจนกว่าจะกดปุ่มด้านล่าง
      </p>
    </div>
  );
}
