'use client';

/**
 * Draw-or-type signature capture.
 *
 * The tool card promises "วาดลายเซ็นด้วยนิ้วหรือเมาส์" and the original build
 * offered only a text input that stamped the typed name in an italic serif —
 * which is not a signature, and is the one affordance people look for in a
 * signing tool. Everything here stays in the page: the strokes never leave the
 * canvas element, and the result is handed to pdf-lib as a data URL.
 *
 * Pointer Events cover mouse, trackpad, touch and stylus in one code path, and
 * `setPointerCapture` keeps a stroke alive when the finger leaves the box.
 */

import { Eraser, PenLine, Type } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { thaiFontFamily } from '../lib/pdf/fonts';

export type SignatureValue = { dataUrl: string; width: number; height: number } | null;

export type SignaturePadProps = {
  typed: string;
  onTypedChange: (value: string) => void;
  onDrawnChange: (value: SignatureValue) => void;
};

const WIDTH = 560;
const HEIGHT = 200;

export function SignaturePad({ typed, onTypedChange, onDrawnChange }: SignaturePadProps) {
  const [mode, setMode] = useState<'draw' | 'type'>('draw');
  const [hasInk, setHasInk] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  const context = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.lineWidth = 3.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0d2b45';
    return ctx;
  }, []);

  // Render at device resolution so the exported signature is not soft on the
  // page it lands on.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = WIDTH * ratio;
    canvas.height = HEIGHT * ratio;
    const ctx = canvas.getContext('2d');
    ctx?.scale(ratio, ratio);
  }, []);

  const pointFrom = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * HEIGHT,
    };
  };

  const publish = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    onDrawnChange({ dataUrl: canvas.toDataURL('image/png'), width: WIDTH, height: HEIGHT });
  }, [onDrawnChange]);

  const clear = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = context();
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    setHasInk(false);
    onDrawnChange(null);
  }, [context, onDrawnChange]);

  /** Typing into the fallback field renders the same kind of image. */
  useEffect(() => {
    if (mode !== 'type') return;
    const value = typed.trim();
    if (!value) {
      onDrawnChange(null);
      return;
    }
    const canvas = document.createElement('canvas');
    const ratio = 3;
    canvas.width = WIDTH * ratio;
    canvas.height = HEIGHT * ratio;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.fillStyle = '#0d2b45';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let size = 64;
    do {
      ctx.font = `italic 600 ${size}px ${thaiFontFamily()}`;
      size -= 2;
    } while (ctx.measureText(value).width > WIDTH - 48 && size > 18);
    ctx.fillText(value, WIDTH / 2, HEIGHT / 2);
    onDrawnChange({ dataUrl: canvas.toDataURL('image/png'), width: WIDTH, height: HEIGHT });
  }, [mode, typed, onDrawnChange]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div role="tablist" aria-label="วิธีสร้างลายเซ็น" className="flex gap-1 rounded-full border border-line p-1">
          {(
            [
              ['draw', 'วาดเอง', PenLine],
              ['type', 'พิมพ์ชื่อ', Type],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              onClick={() => {
                setMode(value);
                onDrawnChange(null);
                if (value === 'draw') clear();
              }}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition ${
                mode === value
                  ? 'bg-[color:var(--action-bg)] text-[color:var(--action-fg)]'
                  : 'text-muted hover:bg-sunken'
              }`}
            >
              <Icon size={14} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>

        {mode === 'draw' && (
          <button
            type="button"
            onClick={clear}
            disabled={!hasInk}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-sunken disabled:opacity-40"
          >
            <Eraser size={14} aria-hidden="true" />
            ล้าง
          </button>
        )}
      </div>

      {mode === 'draw' ? (
        <div>
          <canvas
            ref={canvasRef}
            style={{ aspectRatio: `${WIDTH} / ${HEIGHT}`, touchAction: 'none' }}
            className="w-full cursor-crosshair rounded-xl border border-dashed border-[color:var(--line-strong)] bg-card"
            aria-label="พื้นที่วาดลายเซ็น ใช้เมาส์ นิ้ว หรือปากกาวาดได้"
            role="img"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              drawing.current = true;
              last.current = pointFrom(event);
            }}
            onPointerMove={(event) => {
              if (!drawing.current) return;
              const ctx = context();
              const point = pointFrom(event);
              if (!ctx || !last.current) return;
              ctx.beginPath();
              ctx.moveTo(last.current.x, last.current.y);
              ctx.lineTo(point.x, point.y);
              ctx.stroke();
              last.current = point;
              if (!hasInk) setHasInk(true);
            }}
            onPointerUp={(event) => {
              event.currentTarget.releasePointerCapture(event.pointerId);
              drawing.current = false;
              last.current = null;
              if (hasInk) publish();
            }}
            onPointerCancel={() => {
              drawing.current = false;
              last.current = null;
            }}
          />
          <p className="mt-2 text-xs text-subtle">
            {hasInk
              ? 'ลายเซ็นพร้อมแล้ว — เลือกหน้าที่จะวางด้านล่าง'
              : 'ลากเมาส์หรือใช้นิ้ววาดลายเซ็นในกรอบนี้'}
          </p>
        </div>
      ) : (
        <div>
          <label htmlFor="signature-typed" className="sr-only">ชื่อสำหรับลายเซ็น</label>
          <input
            id="signature-typed"
            value={typed}
            onChange={(event) => onTypedChange(event.target.value)}
            placeholder="พิมพ์ชื่อ-นามสกุล"
            className="h-12 w-full rounded-xl border border-line bg-card px-3 text-lg text-body outline-none focus:border-[color:var(--brand-ring)]"
            style={{ fontStyle: 'italic', fontWeight: 600 }}
          />
          <p className="mt-2 text-xs text-subtle">
            ลายเซ็นแบบพิมพ์เหมาะกับเอกสารภายใน ถ้าต้องใช้ยืนยันตัวตนจริง แนะนำให้วาดเอง
          </p>
        </div>
      )}
    </div>
  );
}
