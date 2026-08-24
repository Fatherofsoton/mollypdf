/**
 * Builds the PDF fixtures the tests run against.
 *
 * Regenerate with:  node tests/fixtures/make.mjs
 * The output files are committed so CI does not depend on this script.
 */
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const ttf = await readFile(join(root, 'public/fonts/Sarabun-Regular.ttf'));
const ttfBold = await readFile(join(root, 'public/fonts/Sarabun-Bold.ttf'));

/** Thai text with no spaces between words — the case the old code destroyed. */
export const THAI_LINES = [
  'ประเทศไทยมีประชากรประมาณเจ็ดสิบล้านคน',
  'เอกสารฉบับนี้เป็นความลับ ห้ามเผยแพร่',
  'เลขประจำตัวประชาชน 1234567890123',
  'ติดต่อ somchai@example.com โทร 0812345678',
];

/**
 * Draw one line as several separately-positioned runs, the way a real producer
 * (Word, InDesign, a scanner's text layer) emits Thai. pdf.js then hands the
 * consumer one TextItem per run, which is the situation the old
 * `items.map(i => i.str).join(' ')` turned into "ประ เท ศ ไท ย".
 */
function drawSegmented(page, text, { font, fontAlt, size, x, y, color }) {
  let cursor = x;
  let flip = false;
  // Break every 3 characters, so tone marks and vowels land mid-run exactly as
  // they do in the wild.
  for (let i = 0; i < text.length; i += 3) {
    const run = text.slice(i, i + 3);
    // Alternating faces guarantee pdf.js emits one TextItem per run instead of
    // merging them — mixing weights inline is routine in Thai documents.
    const face = (flip = !flip) ? font : fontAlt;
    page.drawText(run, { x: cursor, y, size, font: face, color });
    // A sub-pixel kerning gap, which is what stops pdf.js from merging the
    // runs back together and is exactly what happens in real documents.
    cursor += face.widthOfTextAtSize(run, size) + 0.7;
  }
}

async function build({ pages = 1, blankAt = [], segmented = false } = {}) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(ttf, { subset: false });
  const fontAlt = await doc.embedFont(ttfBold, { subset: false });

  for (let p = 0; p < pages; p++) {
    const page = doc.addPage([595, 842]);
    if (blankAt.includes(p)) continue;
    THAI_LINES.forEach((line, i) => {
      const style = { font, fontAlt, size: 18, x: 60, y: 760 - i * 40, color: rgb(0.05, 0.1, 0.15) };
      if (segmented) drawSegmented(page, line, style);
      else page.drawText(line, { ...style });
    });
    page.drawText(`page ${p + 1}`, { x: 60, y: 60, size: 12, font, color: rgb(0.4, 0.4, 0.4) });
  }
  return Buffer.from(await doc.save());
}

await writeFile(join(here, 'thai-1page.pdf'), await build({ pages: 1 }));
await writeFile(join(here, 'thai-4page-with-blanks.pdf'), await build({ pages: 4, blankAt: [1, 3] }));
await writeFile(join(here, 'thai-segmented.pdf'), await build({ pages: 1, segmented: true }));
console.log('fixtures written');
