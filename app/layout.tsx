import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import { SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE, SITE_URL, url } from '../lib/site';

/**
 * Sarabun, served from our own origin.
 *
 * The site previously pulled Noto Sans Thai from `next/font/google`, which
 * issues a request to fonts.gstatic.com from the visitor's browser. That hands
 * a third party the IP address of everyone who opens a page — on a site whose
 * entire proposition is "nothing about your document leaves this device", and
 * it is the specific pattern German courts have already ruled on under GDPR.
 *
 * These are the same TTFs pdf-lib embeds into generated documents, so the
 * on-screen text and the text inside an exported PDF are now the same face.
 */
const sarabun = localFont({
  variable: '--font-thai',
  display: 'swap',
  // Sarabun's metrics, so the fallback does not reflow the page on swap.
  fallback: ['Tahoma', 'Arial', 'sans-serif'],
  adjustFontFallback: false,
  src: [
    { path: '../public/fonts/Sarabun-Regular.ttf', weight: '400', style: 'normal' },
    { path: '../public/fonts/Sarabun-Bold.ttf', weight: '700', style: 'normal' },
  ],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} — ${SITE_TAGLINE}`,
    template: `%s`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  // Was missing entirely: without a canonical, the preview host and any future
  // custom domain compete with each other for the same content.
  alternates: { canonical: url('/') },
  robots: { index: true, follow: true, 'max-image-preview': 'large' },
  openGraph: {
    siteName: SITE_NAME,
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    url: url('/'),
    // 1200x630 is what every crawler crops to; the previous 1731x909 was
    // re-scaled by each platform and the 1.5 MB PNG slowed first paint.
    images: [{ url: url('/og.png'), width: 1200, height: 630, alt: `${SITE_NAME} — ${SITE_TAGLINE}` }],
    locale: 'th_TH',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    images: [url('/og.png')],
  },
  icons: {
    icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
  },
  manifest: '/manifest.webmanifest',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f8fb' },
    { media: '(prefers-color-scheme: dark)', color: '#0a1620' },
  ],
  colorScheme: 'light dark',
};

const organisationLd = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: SITE_NAME,
  url: SITE_URL,
  inLanguage: 'th-TH',
  description: SITE_DESCRIPTION,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th" suppressHydrationWarning>
      <body className={`${sarabun.variable} antialiased`}>
        {/* Apply the stored theme before first paint so a dark-mode user never
            sees a white flash. Must run before React hydrates. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('mollypdf-theme');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t}catch(e){}",
          }}
        />
        {/* Required for WCAG 2.4.1 — there was no way to bypass the 43-card
            grid with a keyboard. */}
        <a href="#main" className="skip-link">ข้ามไปยังเนื้อหาหลัก</a>
        {children}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organisationLd) }}
        />
      </body>
    </html>
  );
}
