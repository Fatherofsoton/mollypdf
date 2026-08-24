/**
 * The site had no sitemap and no robots.txt, and — more importantly — no URLs
 * to put in one. 43 tools all lived at `/`, behind client-side state, so a
 * crawler saw a single page. Every competitor that outranks mollypdf does the
 * opposite: iLovePDF has /merge_pdf, /split_pdf, /compress_pdf … each with its
 * own title, H1 and copy. That is where their traffic comes from.
 *
 * With `/tools/[slug]` in place, this exposes all of them.
 */

import { tools } from '../../lib/tools/registry';
import { url } from '../../lib/site';

export function GET() {
  const today = new Date().toISOString().slice(0, 10);
  const entries = [
    { loc: url('/'), priority: '1.0', changefreq: 'weekly' },
    { loc: url('/privacy'), priority: '0.6', changefreq: 'monthly' },
    ...tools
      .filter((tool) => tool.status === 'ready')
      .map((tool) => ({ loc: url(`/tools/${tool.id}`), priority: '0.8', changefreq: 'monthly' })),
  ];

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries
  .map(
    (entry) =>
      `  <url><loc>${entry.loc}</loc><lastmod>${today}</lastmod>` +
      `<changefreq>${entry.changefreq}</changefreq><priority>${entry.priority}</priority></url>`,
  )
  .join('\n')}
</urlset>`;

  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
