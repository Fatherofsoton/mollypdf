/**
 * Site-wide constants.
 *
 * `metadataBase` used to be hard-coded to the generated preview host. That
 * costs real ranking and real credibility: a random-looking subdomain on
 * someone else's apex has no domain authority, cannot be branded, and reads as
 * disposable to anyone deciding whether to trust it with a document.
 *
 * Resolution order, so that no deploy ever emits a wrong canonical:
 *   1. NEXT_PUBLIC_SITE_URL   — set this once you have a real domain
 *   2. VERCEL_PROJECT_PRODUCTION_URL — the stable production host on Vercel
 *   3. VERCEL_URL             — the per-deployment preview host
 *   4. localhost              — development
 *
 * Preview deployments therefore canonicalise to themselves instead of claiming
 * to be production, and the day a custom domain is bought only step 1 changes.
 */

function fromEnv(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit;

  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (production) return `https://${production}`;

  const preview = process.env.VERCEL_URL?.trim();
  if (preview) return `https://${preview}`;

  return 'http://localhost:3000';
}

export const SITE_URL = fromEnv().replace(/\/+$/, '');

/** Preview deployments must not be indexed — they would compete with production. */
export const IS_PREVIEW =
  process.env.VERCEL_ENV === 'preview' ||
  (!process.env.NEXT_PUBLIC_SITE_URL && !process.env.VERCEL_PROJECT_PRODUCTION_URL);

export const SITE_NAME = 'mollypdf';

export const SITE_TAGLINE = 'จัดการ PDF ได้ โดยไม่ต้องอัปโหลด';

export const SITE_DESCRIPTION =
  'เครื่องมือ PDF ที่ทำงานในเบราว์เซอร์ของคุณ รวม แยก บีบอัด แปลง เซ็น และ OCR ภาษาไทย ' +
  'เนื้อหาไฟล์ไม่ถูกอัปโหลดไปที่เซิร์ฟเวอร์ ใช้ฟรี ไม่ต้องสมัคร';

export function url(path = '/') {
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}
