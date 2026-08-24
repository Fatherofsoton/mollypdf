/**
 * One indexable page per tool.
 *
 * This is the single highest-leverage change for reach. Search demand for PDF
 * work is overwhelmingly task-shaped — people type "รวมไฟล์ pdf", not "เว็บ
 * จัดการ pdf" — and a single-page app has nowhere to rank for 43 different
 * tasks. Every page here gets its own title, H1, description, breadcrumb and
 * SoftwareApplication + FAQPage structured data, and hands off to the same
 * client tool UI, so nothing is duplicated.
 *
 * Note this is a server component: the tool copy is rendered as real HTML that
 * a crawler sees without executing any JavaScript.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronRight, ShieldCheck } from 'lucide-react';
import { tools, toolById, readyTools } from '../../../lib/tools/registry';
import { SITE_NAME, url } from '../../../lib/site';

export function generateStaticParams() {
  return tools.map((tool) => ({ slug: tool.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const tool = toolById.get(slug);
  if (!tool) return { title: 'ไม่พบเครื่องมือ' };
  const title = `${tool.title} ออนไลน์ ฟรี — ทำในเบราว์เซอร์ ไม่ต้องอัปโหลด | ${SITE_NAME}`;
  return {
    title,
    description: tool.detail.slice(0, 158),
    keywords: tool.keywords,
    alternates: { canonical: url(`/tools/${tool.id}`) },
    openGraph: {
      title,
      description: tool.detail.slice(0, 158),
      url: url(`/tools/${tool.id}`),
      locale: 'th_TH',
      type: 'website',
    },
  };
}

const faqFor = (title: string) => [
  {
    q: `${title} ต้องอัปโหลดไฟล์ไหม`,
    a: 'ไม่ต้อง เอกสารถูกเปิดและประมวลผลด้วยโค้ดที่ทำงานในเบราว์เซอร์ของคุณ เนื้อหาไฟล์ไม่เคยถูกส่งไปที่เซิร์ฟเวอร์',
  },
  { q: `${title} ฟรีหรือไม่`, a: 'ฟรี ไม่มีลายน้ำ ไม่จำกัดจำนวนครั้ง และไม่ต้องสมัครสมาชิก' },
  {
    q: 'รองรับเอกสารภาษาไทยไหม',
    a: 'รองรับ ระบบตัดคำและฝังฟอนต์ไทยไว้โดยเฉพาะ ผลลัพธ์จึงไม่มีช่องว่างแทรกกลางคำและยังค้นหาข้อความได้',
  },
  { q: 'ใช้บนมือถือได้ไหม', a: 'ได้ ทั้ง iOS และ Android ไฟล์ขนาดใหญ่มากอาจใช้เวลานานกว่าบนคอมพิวเตอร์' },
];

export default async function ToolPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tool = toolById.get(slug);
  if (!tool) notFound();

  const related = readyTools.filter((t) => t.category === tool.category && t.id !== tool.id).slice(0, 6);
  const faq = faqFor(tool.title);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'SoftwareApplication',
        name: `${tool.title} — ${SITE_NAME}`,
        applicationCategory: 'UtilitiesApplication',
        operatingSystem: 'Web',
        description: tool.detail,
        url: url(`/tools/${tool.id}`),
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'THB' },
        inLanguage: 'th-TH',
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'หน้าแรก', item: url('/') },
          { '@type': 'ListItem', position: 2, name: tool.category, item: url('/') },
          { '@type': 'ListItem', position: 3, name: tool.title, item: url(`/tools/${tool.id}`) },
        ],
      },
      {
        '@type': 'FAQPage',
        mainEntity: faq.map((item) => ({
          '@type': 'Question',
          name: item.q,
          acceptedAnswer: { '@type': 'Answer', text: item.a },
        })),
      },
    ],
  };

  return (
    <main className="mx-auto max-w-[820px] px-5 py-14 lg:px-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <nav aria-label="เส้นทางนำทาง" className="flex items-center gap-1.5 text-sm text-muted">
        <Link href="/" className="hover:text-brand">หน้าแรก</Link>
        <ChevronRight size={14} aria-hidden="true" />
        <span>{tool.category}</span>
        <ChevronRight size={14} aria-hidden="true" />
        <span className="text-strong">{tool.title}</span>
      </nav>

      <header className="mt-6 flex items-start gap-4">
        <span className={`tool-icon tool-${tool.color} shrink-0`} aria-hidden="true">
          <tool.icon size={22} />
        </span>
        <div>
          <h1 className="section-title">{tool.title} ออนไลน์ ฟรี</h1>
          <p className="lede mt-3">{tool.detail}</p>
        </div>
      </header>

      <p className="chip mt-6">
        <ShieldCheck size={15} className="text-[color:var(--ok)]" aria-hidden="true" />
        ประมวลผลในเบราว์เซอร์ · เนื้อหาไฟล์ไม่ถูกอัปโหลด
      </p>

      {/* The interactive tool itself opens from the home page grid; deep-linking
          `?tool=<id>` there keeps one implementation instead of two. */}
      <Link href={`/?tool=${tool.id}`} className="btn-primary mt-8 w-full sm:w-auto">
        เปิด{tool.title}
      </Link>

      <section className="mt-14" aria-labelledby="faq-heading">
        <h2 id="faq-heading" className="section-title text-2xl">คำถามที่พบบ่อย</h2>
        <dl className="mt-6 space-y-5">
          {faq.map((item) => (
            <div key={item.q} className="surface-card p-5">
              <dt className="font-semibold text-strong">{item.q}</dt>
              <dd className="mt-2 text-sm leading-7 text-muted">{item.a}</dd>
            </div>
          ))}
        </dl>
      </section>

      {related.length > 0 && (
        <section className="mt-14" aria-labelledby="related-heading">
          <h2 id="related-heading" className="section-title text-2xl">เครื่องมือใกล้เคียง</h2>
          <ul className="mt-6 grid gap-3 sm:grid-cols-2">
            {related.map((item) => (
              <li key={item.id}>
                <Link href={`/tools/${item.id}`} className="tool-card block p-4">
                  <h3>{item.title}</h3>
                  <p className="mt-1">{item.description}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
