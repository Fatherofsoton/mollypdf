/**
 * Page-range parsing, kept pure and dependency-free so it can be unit tested.
 *
 * The original `parsePages` silently dropped anything out of range, so
 * "ลบหน้า 9" on a five-page document removed nothing and the UI still reported
 * success. Out-of-range input is now an error the user can act on.
 */

export function parsePages(raw: string, total: number, preserveOrder = false): number[] {
  const values: number[] = [];
  const bad: string[] = [];

  for (const part of raw.split(',')) {
    const token = part.trim();
    if (!token) continue;

    const range = token.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      const stepBy = from <= to ? 1 : -1;
      let added = false;
      for (let i = from; stepBy > 0 ? i <= to : i >= to; i += stepBy) {
        if (i >= 1 && i <= total) {
          values.push(i - 1);
          added = true;
        }
      }
      if (!added) bad.push(token);
      continue;
    }

    const n = Number(token);
    if (Number.isInteger(n) && n >= 1 && n <= total) values.push(n - 1);
    else bad.push(token);
  }

  if (bad.length) {
    throw new Error(`หน้า ${bad.join(', ')} ไม่มีอยู่ในเอกสารนี้ (มีทั้งหมด ${total} หน้า)`);
  }
  if (!values.length) throw new Error('กรุณาระบุเลขหน้า เช่น 1, 3-5');

  // `organize` needs duplicates and the user's order preserved; everything else
  // wants a de-duplicated ascending list.
  return preserveOrder ? values : [...new Set(values)].sort((a, b) => a - b);
}

export type PageRange = { from: number; to: number };

/**
 * Parse the split tool's range list: "1-10, 11-25, 40" -> three ranges.
 *
 * Unlike `parsePages` this keeps the ranges as ranges, because in the split
 * workspace each one becomes its own output file — flattening them into a page
 * list would lose exactly the information the user is expressing.
 */
export function parseRangeList(raw: string, total: number): PageRange[] {
  const ranges: PageRange[] = [];
  const bad: string[] = [];

  for (const part of (raw ?? '').split(',')) {
    const token = part.trim();
    if (!token) continue;

    const match = token.match(/^(\d+)\s*(?:-\s*(\d+))?$/);
    if (!match) {
      bad.push(token);
      continue;
    }
    const from = Number(match[1]);
    const to = match[2] ? Number(match[2]) : from;
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    if (lo < 1 || lo > total) {
      bad.push(token);
      continue;
    }
    ranges.push({ from: lo, to: Math.min(hi, total) });
  }

  if (bad.length) {
    throw new Error(`ช่วง ${bad.join(', ')} ไม่ถูกต้องหรือเกินจำนวนหน้า (เอกสารมี ${total} หน้า)`);
  }
  if (!ranges.length) throw new Error('กรุณาระบุช่วงหน้าอย่างน้อยหนึ่งช่วง เช่น 1-10');
  return ranges;
}
