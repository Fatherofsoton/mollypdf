/**
 * Text stamps for watermark / signature / header / free text.
 *
 * The original `makeStamp()` always produced a 1200 x 120 canvas and drew the
 * text centred at a fixed 42px, then the caller placed it at width `w` with
 * height `w / 10`. Two consequences:
 *
 *  - a short word like "สำเนา" occupied ~8% of a very wide transparent image,
 *    so the visible watermark came out tiny and the padding did the rest
 *  - anything longer than ~28 characters ran off the canvas and was clipped
 *
 * Here the canvas is measured to the text, so the caller can scale the stamp
 * to a target width and get predictable, legible output at any length.
 */

import { ensureCanvasFont, thaiFontFamily } from './fonts';

export type Stamp = { dataUrl: string; width: number; height: number; aspect: number };

export type StampStyle = {
  color?: string;
  weight?: number;
  italic?: boolean;
  fontFamily?: string;
  /** Rendering resolution — 3 keeps edges crisp when scaled up in the PDF. */
  pixelRatio?: number;
};

export async function makeStamp(text: string, style: StampStyle = {}): Promise<Stamp> {
  const value = text.trim();
  if (!value) throw new Error('กรุณาใส่ข้อความ');
  await ensureCanvasFont();

  const {
    color = '#082a4a',
    weight = 700,
    italic = false,
    fontFamily = thaiFontFamily(),
    pixelRatio = 3,
  } = style;

  const base = 64;
  const font = `${italic ? 'italic ' : ''}${weight} ${base}px ${fontFamily}`;

  const probe = document.createElement('canvas').getContext('2d');
  if (!probe) throw new Error('อุปกรณ์นี้ไม่รองรับ Canvas');
  probe.font = font;
  const metrics = probe.measureText(value);

  // Thai stacks vowels above and tone marks above those, plus descenders like
  // สระอุ below — actual/font bounding boxes cover all of it, unlike `base`.
  const ascent = metrics.actualBoundingBoxAscent || metrics.fontBoundingBoxAscent || base * 0.9;
  const descent = metrics.actualBoundingBoxDescent || metrics.fontBoundingBoxDescent || base * 0.35;
  const padX = base * 0.12;
  const padY = base * 0.14;

  const width = Math.ceil(metrics.width + padX * 2);
  const height = Math.ceil(ascent + descent + padY * 2);

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, width * pixelRatio);
  canvas.height = Math.max(1, height * pixelRatio);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('อุปกรณ์นี้ไม่รองรับ Canvas');
  context.scale(pixelRatio, pixelRatio);
  context.font = font;
  context.fillStyle = color;
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  context.fillText(value, padX, padY + ascent);

  return { dataUrl: canvas.toDataURL('image/png'), width, height, aspect: width / height };
}

/** Fit a stamp inside a box, preserving its real aspect ratio. */
export function fitStamp(stamp: Stamp, maxWidth: number, maxHeight: number) {
  const scale = Math.min(maxWidth / stamp.width, maxHeight / stamp.height, 1);
  return { width: stamp.width * scale, height: stamp.height * scale };
}
