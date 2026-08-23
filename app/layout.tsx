import type { Metadata } from 'next';
import { Noto_Sans_Thai } from 'next/font/google';
import './globals.css';

const notoSansThai = Noto_Sans_Thai({
  variable: '--font-noto-thai',
  subsets: ['thai', 'latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://mollypdf.g3tz418240.chatgpt.site'),
  title: 'mollypdf — จัดการ PDF โดยไม่ต้องส่งไฟล์ให้ใคร',
  description: '43 เครื่องมือสำหรับรวม แยก บีบอัด แปลง เซ็น และ OCR ภาษาไทยบนเบราว์เซอร์ ฟรี ไม่ต้องสมัคร',
  openGraph: {
    title: 'mollypdf — จัดการ PDF ได้ โดยไม่ต้องส่งไฟล์ให้ใคร',
    description: '43 เครื่องมือ · ทำงานบนเบราว์เซอร์ · ใช้ฟรี',
    images: [{ url: 'https://mollypdf.g3tz418240.chatgpt.site/og.png', width: 1731, height: 909, alt: 'mollypdf — จัดการ PDF ได้ โดยไม่ต้องส่งไฟล์ให้ใคร' }],
    locale: 'th_TH',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'mollypdf — จัดการ PDF ได้ โดยไม่ต้องส่งไฟล์ให้ใคร',
    description: '43 เครื่องมือ · ทำงานบนเบราว์เซอร์ · ใช้ฟรี',
    images: ['https://mollypdf.g3tz418240.chatgpt.site/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th">
      <body className={`${notoSansThai.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
