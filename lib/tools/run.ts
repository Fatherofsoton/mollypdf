'use client';

/**
 * Every tool's actual work, in one dispatcher.
 *
 * Previously this lived inline in `app/page.tsx` as a single `runTool()` with
 * a 25-branch if/else chain on lines that were thousands of characters wide.
 * Nothing could be unit-tested and nothing could be read. Splitting it out
 * costs nothing at run time (the heavy libraries are still dynamically
 * imported, so nothing extra ships to a first-time visitor) and makes each
 * branch reviewable.
 *
 * Behaviour changes are annotated inline with `FIX:`.
 */

import { toolById, type Tool } from './registry';
import { assertFileTypes, assertWithinLimits, step, throwIfAborted, type RunContext } from '../runtime';
import { openPdf } from '../pdf/pdfjs';
import { parsePages, parseRangeList } from '../pdf/pages';
import { canvasToBlob, releaseCanvas, renderPages } from '../pdf/render';
import { ocrPagesToSearchablePdf, pagesToPdf, textToSearchablePdf, toPdfBlob, type OcrWord } from '../pdf/compose';
import { countWords, extractPages, joinTextItems } from '../pdf/text';
import { fitStamp, makeStamp, type Stamp } from '../pdf/stamp';
import { drawRedactions, findRedactionBoxes, NoRedactionMatchError } from '../pdf/redact';
import { compressPdf, greyscalePdf, removeBlankPages } from '../pdf/optimise';
import { htmlToText } from '../html-text';
import { saveBlob, SAVE_MESSAGE, type SaveOutcome } from '../download';

export type ToolInput = {
  files: File[];
  /** The single free-text field most tools use. */
  text: string;
  /** Per-tool extras: page ranges, positions, form field values… */
  options: Record<string, string>;
};

export type ToolResult = {
  outcome: SaveOutcome;
  message: string;
  /** Reported to /api/stats — never file contents. */
  pages: number;
  bytes: number;
};

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function baseName(files: File[]) {
  return files[0]?.name.replace(/\.[^.]+$/, '') || 'mollypdf';
}

async function loadPdfLib(file: File) {
  const { PDFDocument } = await import('pdf-lib');
  return PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: false });
}

async function deliver(blob: Blob, filename: string, pages: number, note?: string): Promise<ToolResult> {
  const outcome = await saveBlob(blob, filename);
  return {
    outcome,
    message: note ? `${SAVE_MESSAGE[outcome]} — ${note}` : SAVE_MESSAGE[outcome],
    pages,
    bytes: blob.size,
  };
}

/* ------------------------------------------------------------------ */
/* dispatcher                                                          */
/* ------------------------------------------------------------------ */

const FILELESS = new Set(['text-pdf', 'html-pdf']);

export async function runTool(toolId: string, input: ToolInput, ctx: RunContext): Promise<ToolResult> {
  const tool: Tool | undefined = toolById.get(toolId);
  if (!tool) throw new Error('ไม่รู้จักเครื่องมือนี้');
  if (tool.status !== 'ready') {
    throw new Error('เครื่องมือนี้ยังไม่เปิดใช้งาน เพราะยังตรวจสอบผลลัพธ์ให้ถูกต้องไม่ได้');
  }

  const { files, text, options } = input;
  const fileless = FILELESS.has(toolId);
  if (!fileless) {
    // FIX: drag-and-drop bypasses the picker's `accept`, so a dropped .exe used
    // to reach pdf-lib and surface as a meaningless parse error.
    assertFileTypes(files, tool.accept);
    assertWithinLimits(files);
  }

  const name = baseName(files);
  throwIfAborted(ctx);

  switch (toolId) {
    /* ---------------- page layout ---------------- */
    case 'merge': {
      if (files.length < 2) throw new Error('กรุณาเลือกอย่างน้อย 2 ไฟล์');
      const { PDFDocument } = await import('pdf-lib');
      const out = await PDFDocument.create();
      let pages = 0;
      // The card promises "จัดลำดับตามต้องการ"; the UI reorders `files` before
      // handing them over, so the order here is already the user's.
      for (const [i, file] of files.entries()) {
        const source = await PDFDocument.load(await file.arrayBuffer());
        const copied = await out.copyPages(source, source.getPageIndices());
        copied.forEach((page) => out.addPage(page));
        pages += copied.length;
        await step(ctx, i + 1, files.length, `กำลังรวมไฟล์ ${i + 1} จาก ${files.length}`);
      }
      return deliver(toPdfBlob(await out.save()), 'mollypdf-รวมไฟล์.pdf', pages, `รวม ${pages} หน้า`);
    }

    case 'split': {
      const JSZip = (await import('jszip')).default;
      const { PDFDocument } = await import('pdf-lib');
      const source = await loadPdfLib(files[0]);
      const total = source.getPageCount();
      const zip = new JSZip();

      /** Copy a 1-based inclusive page span into a fresh document. */
      const slice = async (from: number, to: number) => {
        const out = await PDFDocument.create();
        const indices = [];
        for (let i = from - 1; i <= to - 1; i++) indices.push(i);
        const copied = await out.copyPages(source, indices);
        copied.forEach((page) => out.addPage(page));
        return out;
      };

      const mode = options.splitMode ?? 'pages';

      /* ── by range ── */
      if (mode === 'range') {
        const ranges = parseRangeList(options.ranges ?? '', total);

        if (options.mergeRanges === 'true') {
          const out = await PDFDocument.create();
          for (const [i, range] of ranges.entries()) {
            const indices = [];
            for (let n = range.from - 1; n <= range.to - 1; n++) indices.push(n);
            const copied = await out.copyPages(source, indices);
            copied.forEach((page) => out.addPage(page));
            await step(ctx, i + 1, ranges.length, `กำลังรวมช่วงที่ ${i + 1}`);
          }
          return deliver(
            toPdfBlob(await out.save()),
            `${name}-ช่วงที่เลือก.pdf`,
            out.getPageCount(),
            `รวม ${ranges.length} ช่วง เป็น ${out.getPageCount()} หน้า`,
          );
        }

        for (const [i, range] of ranges.entries()) {
          const out = await slice(range.from, range.to);
          zip.file(`หน้า-${range.from}-ถึง-${range.to}.pdf`, await out.save());
          await step(ctx, i + 1, ranges.length, `กำลังแยกช่วงที่ ${i + 1} จาก ${ranges.length}`);
        }
        return deliver(
          await zip.generateAsync({ type: 'blob' }),
          `${name}-แยกตามช่วง.zip`,
          total,
          `ได้ ${ranges.length} ไฟล์`,
        );
      }

      /* ── by size ──
         Saving after every added page to measure it would be O(n²) on a large
         document. Estimate from the average page weight instead, then verify
         each chunk once and report anything that still came out over. */
      if (mode === 'size') {
        const maxBytes = Math.max(1, Number(options.maxSizeMb || '10')) * 1024 * 1024;
        const perPage = Math.max(1, files[0].size / total);
        const pagesPerChunk = Math.max(1, Math.floor(maxBytes / perPage));
        const chunks: Array<{ from: number; to: number }> = [];
        for (let from = 1; from <= total; from += pagesPerChunk) {
          chunks.push({ from, to: Math.min(total, from + pagesPerChunk - 1) });
        }

        let oversize = 0;
        for (const [i, chunk] of chunks.entries()) {
          const out = await slice(chunk.from, chunk.to);
          const bytes = await out.save();
          if (bytes.byteLength > maxBytes) oversize++;
          zip.file(`ส่วนที่-${i + 1}_หน้า-${chunk.from}-${chunk.to}.pdf`, bytes);
          await step(ctx, i + 1, chunks.length, `กำลังแยกส่วนที่ ${i + 1} จาก ${chunks.length}`);
        }
        const note =
          `ได้ ${chunks.length} ไฟล์` +
          (oversize ? ` — มี ${oversize} ไฟล์ที่ยังเกินขนาดที่ตั้งไว้ เพราะหน้าเดียวก็ใหญ่เกินแล้ว` : '');
        return deliver(await zip.generateAsync({ type: 'blob' }), `${name}-แยกตามขนาด.zip`, total, note);
      }

      /* ── page by page ── */
      const wanted =
        options.extractMode === 'selected'
          ? parsePages(options.selectedPages ?? '', total)
          : source.getPageIndices();
      if (!wanted.length) throw new Error('ยังไม่ได้เลือกหน้าที่ต้องการแยก');

      for (const [i, index] of wanted.entries()) {
        const out = await slice(index + 1, index + 1);
        zip.file(`หน้า-${index + 1}.pdf`, await out.save());
        await step(ctx, i + 1, wanted.length, `กำลังแยกหน้า ${index + 1}`);
      }
      return deliver(
        await zip.generateAsync({ type: 'blob' }),
        `${name}-แยกหน้า.zip`,
        wanted.length,
        `ได้ ${wanted.length} ไฟล์`,
      );
    }

    case 'organize': {
      const doc = await loadPdfLib(files[0]);
      // The workspace writes `pageOrder`; the old text field is still honoured
      // so a saved link or a typed "1, 3, 2" keeps working.
      const source = options.pageOrder?.trim() || text;
      const order = parsePages(source, doc.getPageCount(), true);
      if (!order.length) throw new Error('ต้องเหลืออย่างน้อย 1 หน้า');
      const { PDFDocument, degrees } = await import('pdf-lib');
      const out = await PDFDocument.create();
      const copied = await out.copyPages(doc, order);

      // "3:90,5:180" — keyed by the position in the NEW document, because that
      // is what the user was looking at when they pressed rotate.
      const turns = new Map<number, number>();
      for (const pair of (options.pageRotations ?? '').split(',')) {
        const [slot, angle] = pair.split(':').map((part) => Number(part.trim()));
        if (slot > 0 && Number.isFinite(angle)) turns.set(slot, ((angle % 360) + 360) % 360);
      }

      copied.forEach((page, index) => {
        const turn = turns.get(index + 1);
        if (turn) page.setRotation(degrees((page.getRotation().angle + turn) % 360));
        out.addPage(page);
      });

      const changed = [
        order.length !== doc.getPageCount() ? `เหลือ ${order.length} หน้า` : '',
        turns.size ? `หมุน ${turns.size} หน้า` : '',
      ].filter(Boolean).join(' · ');
      return deliver(toPdfBlob(await out.save()), `${name}-จัดหน้า.pdf`, order.length, changed || undefined);
    }

    case 'remove-pages': {
      const doc = await loadPdfLib(files[0]);
      const indices = parsePages(text, doc.getPageCount());
      if (indices.length >= doc.getPageCount()) {
        throw new Error('ลบทุกหน้าไม่ได้ — จะไม่เหลือเอกสาร');
      }
      for (const index of [...indices].reverse()) doc.removePage(index);
      return deliver(
        toPdfBlob(await doc.save()),
        `${name}-ลบหน้า.pdf`,
        doc.getPageCount(),
        `ลบ ${indices.length} หน้า เหลือ ${doc.getPageCount()} หน้า`,
      );
    }

    case 'extract-pages': {
      const doc = await loadPdfLib(files[0]);
      const indices = parsePages(text, doc.getPageCount());
      const { PDFDocument } = await import('pdf-lib');
      const out = await PDFDocument.create();
      const copied = await out.copyPages(doc, indices);
      copied.forEach((page) => out.addPage(page));
      return deliver(toPdfBlob(await out.save()), `${name}-หน้าที่เลือก.pdf`, indices.length);
    }

    case 'rotate': {
      // FIX: was hard-coded to +90 on every page with no choice of direction
      // or of which pages, despite the card promising control.
      const { degrees } = await import('pdf-lib');
      const doc = await loadPdfLib(files[0]);
      const turn = Number(options.angle ?? '90');
      const scope = options.pages?.trim()
        ? new Set(parsePages(options.pages, doc.getPageCount()))
        : null;
      doc.getPages().forEach((page, index) => {
        if (scope && !scope.has(index)) return;
        page.setRotation(degrees((page.getRotation().angle + turn + 360) % 360));
      });
      return deliver(toPdfBlob(await doc.save()), `${name}-หมุน.pdf`, doc.getPageCount());
    }

    case 'crop': {
      // FIX: margin was hard-coded to min(18, w/20, h/20) and the crop box was
      // positioned from (0,0) rather than from the page's real MediaBox origin,
      // so any page whose origin was not zero cropped the wrong region.
      const doc = await loadPdfLib(files[0]);
      const margin = Math.max(0, Number(options.margin ?? '18'));
      doc.getPages().forEach((page) => {
        const box = page.getMediaBox();
        const m = Math.min(margin, box.width / 3, box.height / 3);
        page.setCropBox(box.x + m, box.y + m, box.width - m * 2, box.height - m * 2);
      });
      return deliver(toPdfBlob(await doc.save()), `${name}-ครอป.pdf`, doc.getPageCount());
    }

    case 'scan':
    case 'jpg-pdf':
    case 'png-pdf': {
      const { PDFDocument, rgb } = await import('pdf-lib');
      const out = await PDFDocument.create();
      for (const [i, file] of files.entries()) {
        const bytes = await file.arrayBuffer();
        const isPng = file.type === 'image/png' || file.name.toLowerCase().endsWith('.png');
        const image = isPng ? await out.embedPng(bytes) : await out.embedJpg(bytes);
        const page = out.addPage([image.width, image.height]);
        // FIX: transparent PNGs came out with a black background when printed.
        if (isPng) {
          page.drawRectangle({ x: 0, y: 0, width: image.width, height: image.height, color: rgb(1, 1, 1) });
        }
        page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
        await step(ctx, i + 1, files.length, `กำลังเพิ่มภาพ ${i + 1} จาก ${files.length}`);
      }
      return deliver(toPdfBlob(await out.save()), `${name}-ภาพเป็น-pdf.pdf`, files.length);
    }

    /* ---------------- file tuning ---------------- */
    case 'compress': {
      const level = (options.compressLevel ?? 'recommended') as 'extreme' | 'recommended' | 'less';
      const result = await compressPdf(files[0], ctx, level);
      const saved = Math.max(0, result.before - result.after);
      const percent = result.before ? Math.round((saved / result.before) * 100) : 0;
      const note =
        result.method === 'unchanged'
          ? 'ไฟล์นี้บีบอัดต่อไม่ได้แล้ว เราจึงคืนไฟล์ที่จัดโครงสร้างใหม่ให้แทน (ไม่ได้ทำให้ใหญ่ขึ้น)'
          : `เล็กลง ${percent}% — จาก ${(result.before / 1048576).toFixed(1)} MB เหลือ ${(result.after / 1048576).toFixed(1)} MB`;
      return deliver(result.blob, `${name}-บีบอัด.pdf`, 1, note);
    }

    case 'grayscale':
      return deliver(await greyscalePdf(files[0], ctx), `${name}-ขาวดำ.pdf`, 1);

    case 'remove-blank': {
      const result = await removeBlankPages(files[0], ctx);
      return deliver(
        result.blob,
        `${name}-ไม่มีหน้าว่าง.pdf`,
        result.kept,
        `ลบหน้า ${result.removed.join(', ')} เหลือ ${result.kept} หน้า`,
      );
    }

    case 'repair': {
      // FIX: the original just loaded and re-saved, which does nothing for a
      // file pdf-lib can already parse and fails outright for one it cannot.
      // pdf.js is far more tolerant, so recover through it and rebuild.
      try {
        const doc = await loadPdfLib(files[0]);
        const blob = toPdfBlob(await doc.save({ useObjectStreams: true }));
        return deliver(blob, `${name}-ซ่อมแล้ว.pdf`, doc.getPageCount(), 'เขียนโครงสร้างไฟล์ใหม่เรียบร้อย');
      } catch {
        const blob = await pagesToPdf(
          renderPages(files[0], ctx, { scale: 2, label: 'กำลังกู้หน้า' }),
          ctx,
          { quality: 0.9 },
        );
        return deliver(
          blob,
          `${name}-กู้คืน.pdf`,
          1,
          'ไฟล์เสียหายเกินกว่าจะซ่อมโครงสร้างได้ จึงกู้เป็นภาพหน้าแทน — ข้อความจะเลือกไม่ได้',
        );
      }
    }

    case 'ocr': {
      const { createWorker } = await import('tesseract.js');
      const worker = await createWorker('tha+eng');
      try {
        const pages: Array<{ image: Blob; width: number; height: number; words: OcrWord[] }> = [];
        for await (const rendered of renderPages(files[0], ctx, { scale: 2, label: 'กำลังอ่านหน้า' })) {
          const result = await worker.recognize(rendered.canvas, {}, { blocks: true });
          const words: OcrWord[] = [];
          type Bbox = { x0: number; y0: number; x1: number; y1: number };
          type Word = { text: string; bbox: Bbox };
          for (const block of (result.data as { blocks?: Array<{ paragraphs?: Array<{ lines?: Array<{ words?: Word[] }> }> }> }).blocks ?? []) {
            for (const paragraph of block.paragraphs ?? []) {
              for (const line of paragraph.lines ?? []) {
                for (const word of line.words ?? []) {
                  words.push({ text: word.text, ...word.bbox });
                }
              }
            }
          }
          pages.push({
            image: await canvasToBlob(rendered.canvas, 'image/jpeg', 0.82),
            width: rendered.canvas.width,
            height: rendered.canvas.height,
            words,
          });
          releaseCanvas(rendered.canvas);
        }
        // FIX: OCR used to produce a .txt file only. A searchable PDF — the scan
        // as-is, with the recognised text hidden underneath — is what people
        // actually want, and it is what every paid competitor sells.
        const blob = await ocrPagesToSearchablePdf(pages, ctx);
        return deliver(blob, `${name}-ค้นหาได้.pdf`, pages.length, 'ข้อความในไฟล์นี้ค้นหาและคัดลอกได้แล้ว');
      } finally {
        // FIX: the original never terminated the worker on failure, leaking a
        // web worker and its ~15 MB language model for the life of the tab.
        await worker.terminate();
      }
    }

    /* ---------------- conversions out of PDF ---------------- */
    case 'pdf-text':
    case 'pdf-markdown':
    case 'pdf-word':
    case 'word-count': {
      const pages = await extractPages(files[0], ctx);
      const plain = pages.join('\n\n');
      if (!plain.trim()) {
        throw new Error(
          'ไม่พบข้อความในไฟล์นี้ — น่าจะเป็นไฟล์สแกน กรุณาใช้เครื่องมือ "OCR ภาษาไทย" ก่อน',
        );
      }
      if (toolId === 'pdf-text') {
        return deliver(new Blob([plain], { type: 'text/plain;charset=utf-8' }), `${name}.txt`, pages.length);
      }
      if (toolId === 'pdf-markdown') {
        const md = pages.map((page, i) => `## หน้า ${i + 1}\n\n${page}`).join('\n\n---\n\n');
        return deliver(new Blob([md], { type: 'text/markdown;charset=utf-8' }), `${name}.md`, pages.length);
      }
      if (toolId === 'word-count') {
        const { words, characters, approximate } = countWords(plain);
        const report = [
          'รายงานจาก mollypdf',
          '',
          `ชื่อไฟล์: ${files[0].name}`,
          `จำนวนหน้า: ${pages.length}`,
          `จำนวนคำ: ${words.toLocaleString('th-TH')}${approximate ? ' (ประมาณการ)' : ''}`,
          `จำนวนตัวอักษร (ไม่นับช่องว่าง): ${characters.toLocaleString('th-TH')}`,
        ].join('\n');
        return deliver(
          new Blob([report], { type: 'text/plain;charset=utf-8' }),
          `${name}-นับคำ.txt`,
          pages.length,
          `${words.toLocaleString('th-TH')} คำ`,
        );
      }
      const { Document, Packer, PageBreak, Paragraph, TextRun } = await import('docx');
      const children = pages.flatMap((page, i) => [
        ...(i ? [new Paragraph({ children: [new PageBreak()] })] : []),
        ...page.split('\n').map(
          (line) =>
            new Paragraph({
              children: [new TextRun({ text: line, font: 'Sarabun', size: 28 })],
              spacing: { line: 360 },
            }),
        ),
      ]);
      const blob = await Packer.toBlob(new Document({ sections: [{ properties: {}, children }] }));
      return deliver(blob, `${name}.docx`, pages.length);
    }

    case 'pdf-jpg':
    case 'pdf-png': {
      const JSZip = (await import('jszip')).default;
      const jpg = toolId === 'pdf-jpg';

      // Only the pages the user ticked, at the resolution they chose.
      // 2x the 72 dpi page box is ~150 dpi (print floor); 3x is ~220 dpi.
      const scale = options.imageQuality === 'high' ? 3 : 2;
      const wanted =
        options.exportMode === 'selected' && options.selectedPages
          ? new Set(options.selectedPages.split(',').map(Number).filter(Boolean))
          : null;
      if (options.exportMode === 'selected' && !wanted?.size) {
        throw new Error('ยังไม่ได้เลือกหน้าที่ต้องการแปลงเป็นภาพ');
      }

      const zip = new JSZip();
      let single: { blob: Blob; page: number } | null = null;
      let count = 0;

      for await (const rendered of renderPages(files[0], ctx, { scale, label: 'กำลังแปลงหน้า' })) {
        const page = rendered.index + 1;
        if (wanted && !wanted.has(page)) {
          releaseCanvas(rendered.canvas);
          continue;
        }
        const blob = await canvasToBlob(rendered.canvas, jpg ? 'image/jpeg' : 'image/png', 0.92);
        zip.file(`หน้า-${page}.${jpg ? 'jpg' : 'png'}`, blob);
        if (count === 0) single = { blob, page };
        releaseCanvas(rendered.canvas);
        count++;
      }

      if (!count) throw new Error('ไม่มีหน้าที่ตรงกับที่เลือกไว้');

      // One page should come back as the image itself, not a zip holding one file.
      if (count === 1 && single) {
        return deliver(
          single.blob,
          `${name}-หน้า-${single.page}.${jpg ? 'jpg' : 'png'}`,
          1,
          'ได้ 1 ภาพ',
        );
      }

      const archive = await zip.generateAsync({ type: 'blob' });
      return deliver(archive, `${name}-${jpg ? 'jpg' : 'png'}.zip`, count, `ได้ ${count} ภาพ`);
    }

    case 'pdf-ppt': {
      const PptxGenJS = (await import('pptxgenjs')).default;
      const pptx = new PptxGenJS();
      pptx.layout = 'LAYOUT_WIDE';
      let count = 0;
      for await (const rendered of renderPages(files[0], ctx, { scale: 1.6, label: 'กำลังสร้างสไลด์' })) {
        const slide = pptx.addSlide();
        slide.background = { color: 'FFFFFF' };
        slide.addImage({
          data: rendered.canvas.toDataURL('image/jpeg', 0.9),
          sizing: { type: 'contain', x: 0, y: 0, w: 13.333, h: 7.5 },
        });
        releaseCanvas(rendered.canvas);
        count++;
      }
      return deliver((await pptx.write({ outputType: 'blob' })) as Blob, `${name}.pptx`, count);
    }

    case 'pdf-excel': {
      const ExcelJS = (await import('exceljs')).default;
      const book = new ExcelJS.Workbook();
      const pages = await extractPages(files[0], ctx);
      pages.forEach((page, i) => {
        const sheet = book.addWorksheet(`หน้า ${i + 1}`);
        page.split('\n').filter(Boolean).forEach((line) => sheet.addRow([line]));
        sheet.getColumn(1).width = 90;
      });
      const blob = new Blob([new Uint8Array(await book.xlsx.writeBuffer())], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      return deliver(blob, `${name}.xlsx`, pages.length);
    }

    /* ---------------- conversions into PDF ---------------- */
    case 'word-pdf': {
      const mammoth = await import('mammoth');
      const { value } = await mammoth.extractRawText({ arrayBuffer: await files[0].arrayBuffer() });
      return deliver(await textToSearchablePdf(value, ctx), `${name}.pdf`, 1);
    }

    case 'excel-pdf': {
      const ExcelJS = (await import('exceljs')).default;
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(await files[0].arrayBuffer());
      const blocks: string[] = [];
      book.eachSheet((sheet) => {
        blocks.push(sheet.name, '');
        sheet.eachRow((row) => {
          const values = Array.isArray(row.values) ? row.values.slice(1) : [];
          blocks.push(values.map((v) => (v == null ? '' : String(v))).join('   '));
        });
        blocks.push('');
      });
      return deliver(await textToSearchablePdf(blocks.join('\n'), ctx), `${name}.pdf`, 1);
    }

    case 'ppt-pdf': {
      const JSZip = (await import('jszip')).default;
      const zip = await JSZip.loadAsync(await files[0].arrayBuffer());
      const slides = Object.keys(zip.files)
        .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
        .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
      const parts: string[] = [];
      for (const [i, slide] of slides.entries()) {
        const xml = await zip.file(slide)!.async('text');
        const texts = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((match) =>
          match[1]
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'")
            .replace(/&amp;/g, '&'),
        );
        parts.push(`สไลด์ ${i + 1}\n${texts.join(' ')}`);
      }
      return deliver(
        await textToSearchablePdf(parts.join('\n\n──────────\n\n'), ctx),
        `${name}.pdf`,
        slides.length,
      );
    }

    case 'text-pdf':
      return deliver(await textToSearchablePdf(text, ctx), 'mollypdf-เอกสาร.pdf', 1);

    case 'html-pdf': {
      // FIX: `DOMParser(...).body.innerText` returns textContent for a document
      // that was never rendered, so all block structure collapsed into one run.
      const content = htmlToText(text);
      if (!content.trim()) throw new Error('ไม่พบข้อความใน HTML ที่วางมา');
      return deliver(await textToSearchablePdf(content, ctx), 'mollypdf-เอกสาร.pdf', 1);
    }

    /* ---------------- editing and signing ---------------- */
    case 'edit':
    case 'watermark':
    case 'header-footer':
    case 'sign': {
      const { degrees, rgb, StandardFonts } = await import('pdf-lib');
      const doc = await loadPdfLib(files[0]);

      // `sign` can carry a hand-drawn signature from the pad; everything else
      // renders its text to a stamp measured to that text (see lib/pdf/stamp.ts).
      let stamp: Stamp;
      if (toolId === 'sign' && options.signatureImage) {
        const width = Number(options.signatureWidth) || 560;
        const height = Number(options.signatureHeight) || 200;
        stamp = { dataUrl: options.signatureImage, width, height, aspect: width / height };
      } else {
        const made = await makeStamp(text, {
          color: toolId === 'watermark' ? '#8a97a6' : '#082a4a',
          italic: toolId === 'sign',
          weight: toolId === 'watermark' ? 700 : 600,
        }).catch(() => null);
        if (!made) throw new Error('กรุณาใส่ข้อความ');
        stamp = made;
      }

      const embedded = await doc.embedPng(stamp.dataUrl);
      const pageIndexes =
        toolId === 'edit' || toolId === 'sign'
          ? parsePages(options.pages?.trim() || '1', doc.getPageCount())
          : doc.getPageIndices();

      // The placement workspace stores position and size normalised to the page
      // box (0–1), so the same numbers apply to any page size. When it has not
      // been touched, fall back to the sensible default for each tool.
      const DEFAULTS: Record<string, { x: number; y: number; size: number }> = {
        edit: { x: 0.5, y: 0.5, size: 0.5 },
        watermark: { x: 0.5, y: 0.5, size: 0.6 },
        'header-footer': { x: 0.5, y: 0.06, size: 0.5 },
        sign: { x: 0.75, y: 0.9, size: 0.3 },
      };
      const fallback = DEFAULTS[toolId];
      const relX = Number(options.posX ?? fallback.x);
      const relY = Number(options.posY ?? fallback.y);
      const relSize = Number(options.size ?? fallback.size);

      for (const index of pageIndexes) {
        const page = doc.getPage(index);
        const targetWidth = page.getWidth() * Math.min(0.95, Math.max(0.05, relSize));
        const size = fitStamp(stamp, targetWidth, page.getHeight() * 0.45);

        // The marker is centred on its position in the preview, and the PDF
        // origin is bottom-left while the preview's is top-left.
        const x = Math.min(
          page.getWidth() - size.width,
          Math.max(0, relX * page.getWidth() - size.width / 2),
        );
        const y = Math.min(
          page.getHeight() - size.height,
          Math.max(0, (1 - relY) * page.getHeight() - size.height / 2),
        );
        page.drawImage(embedded, {
          x,
          y,
          width: size.width,
          height: size.height,
          opacity: toolId === 'watermark' ? 0.3 : 1,
          rotate: toolId === 'watermark' ? degrees(-25) : undefined,
        });
      }

      // FIX: the card said "เติมข้อความส่วนหัวและเลขหน้า" but the original code
      // only ever drew the header — the page numbers were never added.
      if (toolId === 'header-footer') {
        const font = await doc.embedFont(StandardFonts.Helvetica);
        const total = doc.getPageCount();
        doc.getPages().forEach((page, i) => {
          const label = `${i + 1} / ${total}`;
          page.drawText(label, {
            x: page.getWidth() / 2 - font.widthOfTextAtSize(label, 9) / 2,
            y: 22,
            size: 9,
            font,
            color: rgb(0.35, 0.42, 0.5),
          });
        });
      }

      return deliver(toPdfBlob(await doc.save()), `${name}-${toolId}.pdf`, doc.getPageCount());
    }

    case 'page-numbers': {
      const { rgb, StandardFonts } = await import('pdf-lib');
      const doc = await loadPdfLib(files[0]);
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const total = doc.getPageCount();
      doc.getPages().forEach((page, i) => {
        const label = `${i + 1} / ${total}`;
        page.drawText(label, {
          x: page.getWidth() / 2 - font.widthOfTextAtSize(label, 10) / 2,
          y: 22,
          size: 10,
          font,
          color: rgb(0.15, 0.24, 0.33),
        });
      });
      return deliver(toPdfBlob(await doc.save()), `${name}-เลขหน้า.pdf`, total);
    }

    case 'create-form': {
      const { rgb } = await import('pdf-lib');
      const doc = await loadPdfLib(files[0]);
      const page = doc.getPage(0);
      const field = doc.getForm().createTextField(text.trim() || 'field-1');
      field.addToPage(page, {
        x: 52,
        y: page.getHeight() - 120,
        width: Math.min(300, page.getWidth() - 104),
        height: 34,
        borderWidth: 1,
        borderColor: rgb(0.08, 0.3, 0.48),
      });
      return deliver(toPdfBlob(await doc.save()), `${name}-ฟอร์ม.pdf`, doc.getPageCount());
    }

    case 'fill-form': {
      // FIX: the original wrote the *same* string into every text field, which
      // is never what anyone wants from a form filler.
      const doc = await loadPdfLib(files[0]);
      const form = doc.getForm();
      const fields = form.getFields();
      if (!fields.length) throw new Error('ไม่พบช่องกรอกใน PDF นี้');
      let filled = 0;
      for (const field of fields) {
        const value = options[field.getName()];
        if (value == null || value === '') continue;
        const candidate = field as unknown as { setText?: (v: string) => void };
        if (candidate.setText) {
          candidate.setText(value);
          filled++;
        }
      }
      if (!filled) throw new Error('ยังไม่ได้กรอกช่องใดเลย');
      return deliver(toPdfBlob(await doc.save()), `${name}-กรอกแล้ว.pdf`, doc.getPageCount(), `กรอก ${filled} ช่อง`);
    }

    /* ---------------- security ---------------- */
    case 'protect': {
      if (!text) throw new Error('กรุณากรอกรหัสผ่าน');
      if (text.length < 4) throw new Error('รหัสผ่านสั้นเกินไป ควรมีอย่างน้อย 4 ตัวอักษร');
      const cantoo = await import('@cantoo/pdf-lib');
      const doc = await cantoo.PDFDocument.load(await files[0].arrayBuffer());
      doc.encrypt({
        userPassword: text,
        ownerPassword: `${text}-mollypdf-owner`,
        permissions: {
          printing: 'highResolution',
          modifying: false,
          copying: false,
          annotating: false,
          fillingForms: true,
          contentAccessibility: true,
          documentAssembly: false,
        },
      });
      return deliver(
        toPdfBlob(await doc.save()),
        `${name}-ล็อกแล้ว.pdf`,
        doc.getPageCount(),
        'เก็บรหัสผ่านไว้ให้ดี — ถ้าลืมแล้วจะเปิดไฟล์ไม่ได้อีกเลย',
      );
    }

    case 'unlock': {
      if (!text) throw new Error('กรุณากรอกรหัสผ่าน');
      const cantoo = await import('@cantoo/pdf-lib');

      let source: import('@cantoo/pdf-lib').PDFDocument;
      try {
        source = await cantoo.PDFDocument.load(await files[0].arrayBuffer(), { password: text });
      } catch (error) {
        const message = String((error as Error)?.message ?? '');
        if (/password/i.test(message)) {
          throw new Error(
            'รหัสผ่านไม่ถูกต้อง — ลองกดไอคอนรูปตาเพื่อดูรหัสที่พิมพ์ ' +
              'และตรวจว่าไม่ได้เปิด Caps Lock หรือสลับภาษาแป้นพิมพ์อยู่',
          );
        }
        throw new Error('เปิดไฟล์นี้ไม่ได้ ไฟล์อาจเสียหายหรือใช้การเข้ารหัสที่ยังไม่รองรับ');
      }

      // FIX: the original loaded the document with the password and saved it
      // straight back — which keeps the /Encrypt dictionary, so the "unlocked"
      // file still asked for a password. Copying every page into a brand-new
      // document is what actually drops the encryption. Both sides must be the
      // same library; mixing pdf-lib and @cantoo/pdf-lib fails at copyPages.
      const out = await cantoo.PDFDocument.create();
      const copied = await out.copyPages(source, source.getPageIndices());
      copied.forEach((page) => out.addPage(page));

      const bytes = await out.save();
      // Verify rather than assume: this tool has already shipped once claiming
      // success while doing nothing.
      if (out.isEncrypted) {
        throw new Error('ถอดการเข้ารหัสไม่สำเร็จ ไฟล์นี้อาจใช้การป้องกันแบบที่ยังไม่รองรับ');
      }

      return deliver(
        toPdfBlob(bytes),
        `${name}-ปลดล็อกแล้ว.pdf`,
        out.getPageCount(),
        'ไฟล์นี้เปิดได้โดยไม่ต้องใส่รหัสผ่านแล้ว',
      );
    }

    case 'redact': {
      const needle = text.trim();
      if (!needle) throw new Error('กรุณาระบุข้อความที่ต้องการปิด');
      const { doc, close } = await openPdf(files[0]);
      let matches = 0;
      try {
        const { PDFDocument } = await import('pdf-lib');
        const out = await PDFDocument.create();
        const scale = 2;
        for (let n = 1; n <= doc.numPages; n++) {
          throwIfAborted(ctx);
          const page = await doc.getPage(n);
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const context = canvas.getContext('2d', { alpha: false })!;
          context.fillStyle = '#fff';
          context.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvas, canvasContext: context, viewport }).promise;

          const content = await page.getTextContent();
          const unscaled = page.getViewport({ scale: 1 });
          const boxes = findRedactionBoxes(
            content.items as never,
            needle,
            scale,
            unscaled.height,
          );
          matches += boxes.length;
          drawRedactions(canvas, boxes);

          const blob = await canvasToBlob(canvas, 'image/jpeg', 0.88);
          const image = await out.embedJpg(await blob.arrayBuffer());
          const outPage = out.addPage([image.width, image.height]);
          outPage.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
          releaseCanvas(canvas);
          page.cleanup();
          await step(ctx, n, doc.numPages, `กำลังปิดข้อมูลหน้า ${n} จาก ${doc.numPages}`);
        }
        // FIX: the original produced a file and said "เสร็จแล้ว" even when it
        // had matched nothing at all — the worst possible failure mode here.
        if (!matches) throw new NoRedactionMatchError(needle);
        return deliver(
          toPdfBlob(await out.save()),
          `${name}-ปิดข้อมูล.pdf`,
          doc.numPages,
          `ปิดไป ${matches} จุด — กรุณาเปิดไฟล์ตรวจก่อนส่งต่อ`,
        );
      } finally {
        await close();
      }
    }

    case 'metadata': {
      const doc = await loadPdfLib(files[0]);
      doc.setTitle('');
      doc.setAuthor('');
      doc.setSubject('');
      doc.setKeywords([]);
      doc.setProducer('mollypdf');
      doc.setCreator('mollypdf');
      // FIX: creation/modification dates leak just as much as the author name.
      doc.setCreationDate(new Date(0));
      doc.setModificationDate(new Date(0));
      return deliver(toPdfBlob(await doc.save()), `${name}-ลบข้อมูลแฝง.pdf`, doc.getPageCount());
    }

    case 'flatten': {
      const doc = await loadPdfLib(files[0]);
      const fields = doc.getForm().getFields();
      if (!fields.length) throw new Error('ไฟล์นี้ไม่มีช่องฟอร์มให้ล็อก');
      doc.getForm().flatten();
      return deliver(toPdfBlob(await doc.save()), `${name}-ล็อกฟอร์ม.pdf`, doc.getPageCount());
    }

    /* ---------------- reading and checking ---------------- */
    case 'compare': {
      if (files.length < 2) throw new Error('กรุณาเลือก PDF 2 ไฟล์');
      // FIX: the original only pasted the two renders side by side and called it
      // a comparison. Extracting text for both lets us say which pages differ.
      const [leftText, rightText] = await Promise.all([
        extractPages(files[0], ctx),
        extractPages(files[1], ctx),
      ]);
      const differing: number[] = [];
      const max = Math.max(leftText.length, rightText.length);
      for (let i = 0; i < max; i++) {
        if ((leftText[i] ?? '') !== (rightText[i] ?? '')) differing.push(i + 1);
      }

      const { PDFDocument, rgb } = await import('pdf-lib');
      const out = await PDFDocument.create();
      const leftPages = renderPages(files[0], ctx, { scale: 1.2, label: 'กำลังเทียบหน้า' });
      const rightBuffer: HTMLCanvasElement[] = [];
      for await (const rendered of renderPages(files[1], ctx, { scale: 1.2 })) {
        const clone = document.createElement('canvas');
        clone.width = rendered.canvas.width;
        clone.height = rendered.canvas.height;
        clone.getContext('2d')!.drawImage(rendered.canvas, 0, 0);
        rightBuffer.push(clone);
        releaseCanvas(rendered.canvas);
      }

      let i = 0;
      for await (const rendered of leftPages) {
        const right = rightBuffer[i];
        const width = rendered.canvas.width + (right?.width ?? rendered.canvas.width) + 24;
        const height = Math.max(rendered.canvas.height, right?.height ?? 0);
        const sheet = document.createElement('canvas');
        sheet.width = width;
        sheet.height = height;
        const context = sheet.getContext('2d')!;
        context.fillStyle = '#e9eef3';
        context.fillRect(0, 0, width, height);
        context.drawImage(rendered.canvas, 0, 0);
        if (right) context.drawImage(right, rendered.canvas.width + 24, 0);

        const blob = await canvasToBlob(sheet, 'image/jpeg', 0.85);
        const image = await out.embedJpg(await blob.arrayBuffer());
        const page = out.addPage([image.width, image.height]);
        page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
        if (differing.includes(i + 1)) {
          page.drawRectangle({
            x: 4,
            y: 4,
            width: image.width - 8,
            height: image.height - 8,
            borderColor: rgb(0.85, 0.25, 0.25),
            borderWidth: 6,
            opacity: 0,
            borderOpacity: 0.9,
          });
        }
        releaseCanvas(rendered.canvas);
        releaseCanvas(sheet);
        i++;
      }
      rightBuffer.forEach(releaseCanvas);

      const note = differing.length
        ? `พบข้อความต่างกัน ${differing.length} หน้า (หน้า ${differing.slice(0, 8).join(', ')}${differing.length > 8 ? '…' : ''})`
        : 'ข้อความทั้งสองไฟล์ตรงกันทุกหน้า';
      return deliver(toPdfBlob(await out.save()), 'mollypdf-เปรียบเทียบ.pdf', max, note);
    }

    case 'read-aloud':
      // Speech is a live control surface, not a file to hand back, so the UI
      // owns it end to end (see components/ReadAloud.tsx).
      throw new Error('เครื่องมืออ่านออกเสียงทำงานจากแผงควบคุมบนหน้าจอ');

    default:
      throw new Error('ยังไม่รองรับเครื่องมือนี้');
  }
}

/** Exported for the read-aloud control in the UI. */
export async function extractForSpeech(file: File, ctx: RunContext) {
  const pages = await extractPages(file, ctx);
  const text = pages.join('\n\n');
  if (!text.trim()) {
    throw new Error('ไม่พบข้อความในไฟล์นี้ — ถ้าเป็นไฟล์สแกน กรุณาใช้ OCR ก่อน');
  }
  return { text, pages: pages.length };
}

export { joinTextItems, parsePages };
