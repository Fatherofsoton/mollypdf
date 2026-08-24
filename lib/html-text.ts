/**
 * HTML -> plain text for the "HTML เป็น PDF" tool.
 *
 * The original used:
 *     new DOMParser().parseFromString(html, 'text/html').body.innerText
 *
 * A document produced by DOMParser is never rendered, and the HTML spec says
 * `innerText` on a non-rendered element falls back to `textContent`. So all the
 * block structure disappeared: `<h1>หัวข้อ</h1><p>เนื้อหา</p>` came out as the
 * single run "หัวข้อเนื้อหา", and every list turned into one long line.
 *
 * This walks the tree instead and reconstructs breaks, list markers and table
 * cells — and drops <script>/<style> so their source never lands in the PDF.
 */

const BLOCK = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DIV', 'DL', 'DT', 'FIELDSET',
  'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'HEADER', 'HR', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TFOOT', 'UL',
]);
const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD']);

export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const parts: string[] = [];

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? '').replace(/\s+/g, ' ');
      if (text) parts.push(text);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as Element;
    const tag = element.tagName.toUpperCase();
    if (SKIP.has(tag)) return;

    if (tag === 'BR') {
      parts.push('\n');
      return;
    }
    if (tag === 'HR') {
      parts.push('\n──────────\n');
      return;
    }
    if (tag === 'IMG') {
      const alt = element.getAttribute('alt');
      if (alt) parts.push(`[ภาพ: ${alt}]`);
      return;
    }
    if (tag === 'PRE') {
      parts.push(`\n${element.textContent ?? ''}\n`);
      return;
    }

    const isBlock = BLOCK.has(tag) || tag === 'LI' || tag === 'TR';
    if (isBlock) parts.push('\n');
    if (tag === 'LI') parts.push('• ');

    for (const child of Array.from(element.childNodes)) walk(child);

    if (tag === 'TD' || tag === 'TH') parts.push('\t');
    if (isBlock) parts.push('\n');
    // Give headings a blank line so the PDF has visible structure.
    if (/^H[1-6]$/.test(tag)) parts.push('\n');
  };

  walk(doc.body);

  return parts
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\t+$/gm, '')
    .trim();
}
