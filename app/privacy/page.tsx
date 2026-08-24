/**
 * The honesty page.
 *
 * The home page currently claims, in three places, "0 ไบต์ออกจากเครื่อง".
 * That is not what the code does, and on a site whose entire proposition is
 * privacy, an overclaim is the most expensive kind of bug — one screenshot of
 * a devtools Network tab and the trust is gone permanently.
 *
 * What actually leaves the browser today:
 *   - GET/POST /api/stats  — tool id, file size in bytes, page count
 *   - Google Fonts         — the Noto Sans Thai webfont (next/font)
 *   - jsDelivr             — Tesseract's Thai language model, on OCR only
 *
 * None of that is document *content*. The right response is not to hide it,
 * it is to say it plainly and precisely — which is a stronger claim than the
 * vague one, because it is checkable. Self-hosting the font and the OCR model
 * (see the report) removes two of the three entirely.
 */

import type { Metadata } from 'next';
import { CheckCircle2, Info } from 'lucide-react';
import { SITE_NAME, url } from '../../lib/site';

export const metadata: Metadata = {
  title: `ความเป็นส่วนตัว — สิ่งที่ออกจากเบราว์เซอร์ของคุณจริง ๆ | ${SITE_NAME}`,
  description:
    'รายการคำขอเครือข่ายทั้งหมดที่ mollypdf ทำ พร้อมเหตุผล — ตรวจสอบได้เองจากแท็บ Network ในเบราว์เซอร์',
  alternates: { canonical: url('/privacy') },
};

const neverSent = [
  'เนื้อหาในเอกสาร ข้อความ รูปภาพ หรือหน้าใด ๆ',
  'ชื่อไฟล์',
  'รหัสผ่านที่ใช้ล็อกหรือปลดล็อกไฟล์',
  'ลายเซ็นที่คุณวาดหรือพิมพ์',
  'ข้อความที่คุณพิมพ์ในช่องลายน้ำ ค้นหา หรือปิดข้อมูล',
];

const requests = [
  {
    what: 'ตัวเว็บไซต์ (HTML, JavaScript, CSS)',
    when: 'ตอนเปิดหน้าเว็บ',
    why: 'โค้ดที่ประมวลผลเอกสารทั้งหมดถูกดาวน์โหลดมาทำงานในเครื่องคุณ',
    contains: 'ไม่มีข้อมูลของคุณ',
  },
  {
    what: 'ฟอนต์ Sarabun / Noto Sans Thai',
    when: 'ตอนเปิดหน้าเว็บ',
    why: 'ใช้แสดงผลภาษาไทยและฝังลงใน PDF ที่สร้างใหม่',
    contains: 'ไม่มีข้อมูลของคุณ (โฮสต์บนโดเมนเดียวกัน)',
  },
  {
    what: 'โมเดลภาษาไทยของ Tesseract (~15 MB)',
    when: 'ครั้งแรกที่ใช้ OCR เท่านั้น',
    why: 'ใช้อ่านตัวอักษรจากภาพสแกน โมเดลถูกโหลดมาทำงานในเครื่อง',
    contains: 'ไม่มีข้อมูลของคุณ — ภาพสแกนไม่ถูกส่งออกไป',
  },
  {
    what: 'ตัวนับการใช้งาน (/api/stats)',
    when: 'หลังทำงานเสร็จแต่ละครั้ง',
    why: 'ใช้แสดงยอดรวมบนหน้าแรก',
    contains: 'รหัสเครื่องมือ · ขนาดไฟล์เป็นตัวเลข · จำนวนหน้า — เท่านั้น',
    highlight: true,
  },
];

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-[760px] px-5 py-14 lg:px-8">
      <h1 className="section-title">สิ่งที่ออกจากเบราว์เซอร์ของคุณจริง ๆ</h1>
      <p className="lede mt-4">
        เราเลือกบอกให้ครบแทนที่จะบอกว่า &ldquo;ไม่มีอะไรออกไปเลย&rdquo; เพราะคำกล่าวอ้างที่ตรวจสอบได้
        มีน้ำหนักกว่าคำกล่าวอ้างที่ฟังดูดี ทุกบรรทัดด้านล่างคุณตรวจเองได้จากแท็บ Network
        ในเครื่องมือนักพัฒนาของเบราว์เซอร์
      </p>

      <section className="mt-10" aria-labelledby="never">
        <h2 id="never" className="section-title text-2xl">สิ่งที่ไม่เคยถูกส่งออกไป</h2>
        <ul className="mt-5 space-y-3">
          {neverSent.map((item) => (
            <li key={item} className="flex items-start gap-3 text-body">
              <CheckCircle2 size={18} className="mt-1 shrink-0 text-[color:var(--ok)]" aria-hidden="true" />
              {item}
            </li>
          ))}
        </ul>
        <p className="mt-5 text-sm leading-7 text-muted">
          เหตุผลทางเทคนิค: ไม่มี endpoint ใดในระบบที่รับไฟล์ การประมวลผลทั้งหมดใช้ API ของเบราว์เซอร์
          (Canvas, Web Crypto, File) ซึ่งทำงานในหน่วยความจำของแท็บนี้ และหายไปเมื่อคุณปิดแท็บ
        </p>
      </section>

      <section className="mt-12" aria-labelledby="requests">
        <h2 id="requests" className="section-title text-2xl">คำขอเครือข่ายทั้งหมดที่เกิดขึ้น</h2>
        <div className="mt-5 space-y-3">
          {requests.map((item) => (
            <div
              key={item.what}
              className="surface-card p-5"
              style={item.highlight ? { borderColor: 'var(--brand-ring)' } : undefined}
            >
              <div className="flex items-start justify-between gap-4">
                <h3 className="font-semibold text-strong">{item.what}</h3>
                <span className="chip shrink-0 text-xs">{item.when}</span>
              </div>
              <p className="mt-2 text-sm leading-7 text-muted">{item.why}</p>
              <p className="mt-2 text-sm font-medium text-body">ส่งอะไรไป: {item.contains}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-12" aria-labelledby="stats">
        <h2 id="stats" className="section-title text-2xl">เรื่องตัวนับการใช้งาน</h2>
        <div className="mt-5 flex gap-3 rounded-[var(--radius-lg)] border border-line bg-sunken p-5">
          <Info size={20} className="mt-0.5 shrink-0 text-brand" aria-hidden="true" />
          <div className="text-sm leading-7 text-body">
            <p>
              ตัวเลขบนหน้าแรกเป็นยอดรวมจากผู้ใช้ทุกคน ไม่ใช่สถิติของเครื่องคุณ
              เราส่งไปสามค่าเท่านั้น คือรหัสเครื่องมือ ขนาดไฟล์เป็นตัวเลข และจำนวนหน้า
              ไม่มีคุกกี้ ไม่มีรหัสประจำตัวผู้ใช้ ไม่มีการเก็บ IP ไว้ต่อจากคำขอนั้น
            </p>
            <p className="mt-3">
              ถ้าคุณไม่อยากส่งแม้แต่สามค่านี้ ตัวบล็อกโฆษณาทั่วไปที่บล็อก
              <code className="mx-1 rounded bg-card px-1.5 py-0.5 text-xs">/api/stats</code>
              จะไม่กระทบการทำงานของเครื่องมือใด ๆ เลย
            </p>
          </div>
        </div>
      </section>

      <p className="mt-12 text-sm text-subtle">
        ปรับปรุงล่าสุด: {new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long' })}
      </p>
    </main>
  );
}
