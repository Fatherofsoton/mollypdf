# Deploy — Vercel

โปรเจกต์นี้ย้ายจาก vinext + Cloudflare Workers มาเป็น Next.js มาตรฐานแล้ว
`pnpm build` คือ `next build` ธรรมดา Vercel จึงตรวจจับและ deploy ได้เองโดยไม่ต้องตั้งค่าอะไร

## 1. Deploy ครั้งแรก

```bash
npx vercel link       # ผูกโฟลเดอร์นี้กับโปรเจกต์บน Vercel
npx vercel --prod
```

หรือเชื่อม GitHub repo ใน Vercel dashboard แล้วให้ push ไป `main` เป็นตัวสั่ง deploy

Vercel จะอ่านค่าเหล่านี้เอง ไม่ต้องตั้ง:

| ค่า | ที่มา |
| --- | --- |
| Framework | Next.js (ตรวจจากไฟล์ในโปรเจกต์) |
| Build command | `pnpm build` |
| Node version | 22 (จาก `engines` ใน `package.json`) |

`prebuild` จะรัน `scripts/sync-pdf-worker.mjs` ให้อัตโนมัติ
เพื่อคัดลอก pdf.js worker เข้า `public/pdfjs/` — โฟลเดอร์นั้นอยู่ใน `.gitignore`
เพราะสร้างใหม่ได้ทุกครั้งที่ build

## 2. ตัวแปรสภาพแวดล้อม

ทั้งหมดเป็น **ตัวเลือก** — เว็บทำงานได้ครบทุกเครื่องมือโดยไม่ต้องตั้งค่าใด ๆ
เพราะการประมวลผลทั้งหมดเกิดในเบราว์เซอร์ของผู้ใช้

### `NEXT_PUBLIC_SITE_URL` — ตั้งเมื่อมีโดเมนจริง

```
NEXT_PUBLIC_SITE_URL=https://mollypdf.com
```

ค่านี้ถูกใช้ใน canonical URL, `sitemap.xml`, JSON-LD และ `og:url`

ถ้ายังไม่ตั้ง `lib/site.ts` จะไล่หาเองตามลำดับ:

1. `NEXT_PUBLIC_SITE_URL`
2. `VERCEL_PROJECT_PRODUCTION_URL` — โดเมน production ที่ Vercel ให้มา
3. `VERCEL_URL` — โดเมนของ deployment นั้น ๆ (พรีวิว)
4. `http://localhost:3000`

ผลคือ **พรีวิวจะ canonical ไปหาตัวเอง ไม่ไปแย่ง production**
และวันที่ซื้อโดเมนจริง เปลี่ยนแค่ข้อ 1 ที่เดียว

> ตั้งค่าใน Vercel: Project → Settings → Environment Variables →
> เพิ่มเฉพาะ scope **Production** เพื่อให้พรีวิวยังใช้ URL ของตัวเอง

### `DATABASE_URL` — ตั้งเมื่อต้องการตัวนับการใช้งาน

ตัวเลขบนหน้าแรก (งานที่ทำเสร็จ / ขนาดไฟล์รวม / หน้าที่จัดการ) มาจาก Postgres

**ไม่ตั้งก็ได้** — `/api/stats` จะคืนศูนย์ และไม่มีเครื่องมือใดหยุดทำงาน
นี่เป็นการออกแบบตั้งใจ: ตัวนับเป็นของประดับ เครื่องมือคือสินค้า
โค้ดเดิมโยน exception เมื่อไม่มี D1 binding ซึ่งทำให้ deploy ที่ไม่มีฐานข้อมูล
เสิร์ฟหน้าแรกที่พังทั้งหน้า

ถ้าต้องการเปิดใช้:

```bash
# 1. สร้างฐานข้อมูล — Vercel Postgres, Neon หรือ Supabase ก็ได้
#    Vercel Storage จะใส่ตัวแปรให้เองเมื่อกด Connect

# 2. สร้างตาราง (ครั้งเดียว)
psql "$DATABASE_URL" -f drizzle/0001_init.sql
```

รองรับชื่อตัวแปร `DATABASE_URL`, `POSTGRES_URL` หรือ `POSTGRES_URL_NON_POOLING`
ตัวไหนก็ได้ที่ผู้ให้บริการใส่มาให้

## 3. หลัง deploy ครั้งแรก

- [ ] เปิด `/sitemap.xml` แล้วตรวจว่า URL ขึ้นเป็นโดเมนที่ถูกต้อง
- [ ] ส่ง sitemap เข้า Google Search Console
- [ ] เปิด DevTools → Network แล้วยืนยันว่าไม่มีคำขอไปโดเมนอื่นเลย
      (ชุดเทสต์ `pnpm test:browser` ตรวจข้อนี้อยู่แล้ว แต่ควรเห็นด้วยตาเอง)
- [ ] ลองใช้งานจริงบน iPhone — เส้นทางดาวน์โหลดบน Safari ต่างจากเดสก์ท็อป
- [ ] เพิ่ม `public/apple-touch-icon.png` ขนาด 180×180
- [ ] ย่อ `public/og.png` เป็น 1200×630 (ตอนนี้ 1731×909 และหนัก 1.5 MB)

## 4. ไฟล์ที่ต้องมีในเครื่องก่อน build

`public/fonts/Sarabun-Regular.ttf` และ `Sarabun-Bold.ttf`
ถูก commit ไว้ในโปรเจกต์แล้ว (สัญญาอนุญาต SIL OFL — แจกจ่ายพร้อมเว็บไซต์ได้)

ฟอนต์นี้ถูกใช้สองที่:

1. แสดงผลบนหน้าเว็บ ผ่าน `next/font/local` — แทนการเรียก Google Fonts
   ซึ่งจะส่ง IP ของผู้ใช้ไปให้บุคคลที่สาม ขัดกับจุดขายของเว็บนี้โดยตรง
2. ฝังลงใน PDF ที่สร้างใหม่ ผ่าน `@pdf-lib/fontkit` เพื่อทำชั้นข้อความ
   ที่ค้นหาได้

ถ้าไฟล์ฟอนต์หายไป เว็บยังทำงานได้ แต่ PDF ที่สร้างจะไม่มีชั้นข้อความที่ค้นหาได้
(`tryEmbedThaiFonts` คืน `null` แทนที่จะทำให้ทั้งงานล้มเหลว)

## 5. ย้อนกลับไป Cloudflare ถ้าต้องการ

โค้ดที่ผูกกับ Cloudflare ถูกถอดออกแล้ว (`vite.config.ts`, `wrangler`,
`@cloudflare/vite-plugin`, D1 binding) ถ้าจะกลับไป ต้องเพิ่ม
`@opennextjs/cloudflare` และเขียน driver ของ `db/drivers/` เพิ่มสำหรับ D1 —
ส่วนที่เหลือของแอปไม่รู้จักผู้ให้บริการอยู่แล้ว
