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
