'use client';

/**
 * Home page.
 *
 * Rewritten from the original single 54 KB file. What changed, beyond moving
 * the tool registry and every processing routine into `lib/`:
 *
 *  - COPY. Three separate places claimed "0 ไบต์ออกจากเครื่อง" while the code
 *    posts to /api/stats, downloads a Google font, and pulls a 15 MB Tesseract
 *    model from a CDN. On a site sold on privacy that is the most damaging
 *    possible inaccuracy. The claim is now the true and stronger one —
 *    *เนื้อหาไฟล์* never leaves — with a /privacy page listing every request.
 *  - The nav said "สถิติบนเครื่องนี้" and the privacy pills said
 *    "สถิติเก็บในเครื่อง", but the section itself said
 *    "สถิติรวมจากผู้ใช้งานทุกคน" and the numbers come from a shared D1 table.
 *    Fixed to match reality.
 *  - Each tool card is now an `<a href="/tools/…">` that the router intercepts,
 *    so the grid is crawlable and every tool is deep-linkable, while clicking
 *    still opens the dialog in place.
 *  - Type weights dropped from 900 to 500–700, and every muted colour now
 *    passes AA. See app/globals.css.
 */

import {
  ArrowRight, BarChart3, Check, Heart, Menu, Moon, Search, ShieldCheck, Star, Sun, Upload, X, Zap,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { categories, featuredTools, readyTools, toolById, tools, type Tool } from '../lib/tools/registry';
import { runTool, extractForSpeech, applyPageEdits, type ToolInput } from '../lib/tools/run';
import { CancelledError, type Progress } from '../lib/runtime';
import { ToolDialog, type RunState } from '../components/ToolDialog';
import { ToolOptions, PLACEMENT_TOOLS } from '../components/ToolOptions';
import { ToolNav } from '../components/ToolNav';
import { PasswordField } from '../components/PasswordField';
import { saveBlob, SAVE_MESSAGE } from '../lib/download';
import { ResultPanel, type ToolOutcome } from '../components/ResultPanel';
import { SignaturePad, type SignatureValue } from '../components/SignaturePad';
import { ReadAloud } from '../components/ReadAloud';

type GlobalStats = { jobs: number; bytes: number; pages: number; popular: Array<{ toolId: string; count: number }> };

const FILELESS = new Set(['text-pdf', 'html-pdf']);

const inputLabels: Record<string, string> = {
  'page-numbers': 'รูปแบบเลขหน้า',
  organize: 'ลำดับหน้าใหม่',
  'remove-pages': 'หน้าที่ต้องการลบ',
  'extract-pages': 'หน้าที่ต้องการดึง',
  protect: 'รหัสผ่านใหม่',
  unlock: 'รหัสผ่านเดิม',
  redact: 'คำหรือข้อความที่ต้องการปิด',
  edit: 'ข้อความที่จะเพิ่ม',
  watermark: 'ข้อความลายน้ำ',
  'header-footer': 'ข้อความส่วนหัว',
  'create-form': 'ชื่อช่องกรอก',
  sign: 'ชื่อหรือลายเซ็นแบบพิมพ์',
  'text-pdf': 'ข้อความ',
  'html-pdf': 'โค้ด HTML',
};

const defaults: Record<string, string> = {
  organize: '1, 2, 3',
  'remove-pages': '1',
  'extract-pages': '1',
  watermark: 'สำเนา',
  'header-footer': 'เอกสารส่วนตัว',
  'create-form': 'ชื่อ-นามสกุล',
};

function formatBytes(bytes: number) {
  if (!bytes) return '0 KB';
  if (bytes < 1048576) return `${Math.max(1, bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}

/* ------------------------------------------------------------------ */

/**
 * Theme toggling with no hydration mismatch and no flash.
 *
 * The stored preference is applied by an inline script in `app/layout.tsx`
 * before first paint, so React never has to know about it: both icons are
 * rendered and CSS decides which one is visible. That keeps the server and
 * client markup identical, which a `useState`/`useEffect` pair could not.
 */
function toggleTheme() {
  const root = document.documentElement;
  const current =
    root.dataset.theme ??
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = current === 'dark' ? 'light' : 'dark';
  root.dataset.theme = next;
  try {
    localStorage.setItem('mollypdf-theme', next);
  } catch {
    /* private mode */
  }
}

/* ------------------------------------------------------------------ */

export default function Home() {
  const [activeCategory, setActiveCategory] = useState<(typeof categories)[number]>('ทั้งหมด');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Tool | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [toolText, setToolText] = useState('');
  const [toolOptions, setToolOptions] = useState<Record<string, string>>({});
  const [signature, setSignature] = useState<SignatureValue>(null);
  const [result, setResult] = useState<ToolOutcome | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState('');
  const [speechText, setSpeechText] = useState('');
  const [state, setState] = useState<RunState>('idle');
  const [message, setMessage] = useState('');
  const [progress, setProgress] = useState<Progress | null>(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [stats, setStats] = useState<GlobalStats>({ jobs: 0, bytes: 0, pages: 0, popular: [] });
  const [statsReady, setStatsReady] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const openPickerRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    fetch('/api/stats')
      .then((response) => (response.ok ? (response.json() as Promise<GlobalStats>) : Promise.reject()))
      .then((data) => {
        setStats(data);
        setStatsReady(true);
      })
      .catch(() => setStatsReady(false));
  }, []);

  const openTool = useCallback((tool: Tool) => {
    setSelected(tool);
    setFiles([]);
    setState('idle');
    setMessage('');
    setProgress(null);
    setToolText(defaults[tool.id] ?? '');
    setToolOptions({});
    setSignature(null);
    setSpeechText('');
  }, []);

  // Deep link: /tools/<id> links here with ?tool=<id>, so one implementation
  // serves both the crawlable page and the in-place dialog.
  //
  // This has to happen in an effect rather than in a lazy `useState`
  // initialiser: `window.location` does not exist during the server render, so
  // reading it at render time would make the client markup differ from the
  // server's and break hydration. Reading an external system on mount is
  // exactly the case the rule below is too blunt for.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('tool');
    const tool = id ? toolById.get(id) : null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (tool) openTool(tool);
  }, [openTool]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return tools.filter(
      (tool) =>
        (activeCategory === 'ทั้งหมด' || tool.category === activeCategory) &&
        (!query ||
          `${tool.title} ${tool.description} ${tool.keywords.join(' ')}`.toLowerCase().includes(query)),
    );
  }, [activeCategory, search]);

  const popular = useMemo(
    () => stats.popular.map(({ toolId, count }) => ({ tool: toolById.get(toolId), count })),
    [stats],
  );

  function record(tool: Tool, bytes: number, pages: number) {
    fetch('/api/stats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolId: tool.id, bytes, pages }),
    })
      .then((response) => (response.ok ? (response.json() as Promise<GlobalStats>) : Promise.reject()))
      .then((data) => {
        setStats(data);
        setStatsReady(true);
      })
      .catch(() => undefined);
  }

  /** Read-aloud is a live control surface, so it loads its text up front. */
  async function loadSpeechText() {
    if (!selected || !files.length) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setState('processing');
    setMessage('กำลังอ่านข้อความจากเอกสาร…');
    try {
      const { text, pages } = await extractForSpeech(files[0], {
        signal: controller.signal,
        report: setProgress,
      });
      setSpeechText(text);
      setState('idle');
      setMessage('');
      record(selected, files[0].size, pages);
    } catch (error) {
      if (error instanceof CancelledError) {
        setState('idle');
        setMessage('');
      } else {
        setState('error');
        setMessage(error instanceof Error ? error.message : 'อ่านข้อความไม่สำเร็จ');
      }
    } finally {
      abortRef.current = null;
      setProgress(null);
    }
  }

  async function handleRun() {
    if (!selected) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setState('processing');
    setResult(null);
    setSavedMessage('');
    setProgress({ ratio: null, label: 'กำลังเริ่ม' });
    setMessage('กำลังประมวลผลบนอุปกรณ์ของคุณ…');

    const options = { ...toolOptions };
    if (selected.id === 'sign' && signature) {
      options.signatureImage = signature.dataUrl;
      options.signatureWidth = String(signature.width);
      options.signatureHeight = String(signature.height);
    }
    const input: ToolInput = { files, text: toolText, options };

    try {
      const finished = await runTool(selected.id, input, {
        signal: controller.signal,
        report: setProgress,
      });
      setState('done');
      setMessage(finished.message);
      setResult({
        blob: finished.blob,
        filename: finished.filename,
        message: finished.message,
        pages: finished.pages,
      });
      setSavedMessage('');
      record(selected, finished.bytes, finished.pages);
    } catch (error) {
      if (error instanceof CancelledError) {
        setState('idle');
        setMessage('');
      } else {
        setState('error');
        setMessage(error instanceof Error ? error.message : 'ประมวลผลไม่สำเร็จ กรุณาลองไฟล์อื่น');
      }
    } finally {
      abortRef.current = null;
      setProgress(null);
    }
  }

  /**
   * Changing anything about the job invalidates the result that is on screen —
   * otherwise the download button keeps offering the file from the settings you
   * just moved away from, and the run button is nowhere to be seen.
   */
  function changeText(value: string) {
    setToolText(value);
    if (result) { setResult(null); setSavedMessage(''); setState('idle'); setMessage(''); }
  }

  function changeOptions(next: Record<string, string> | ((current: Record<string, string>) => Record<string, string>)) {
    setToolOptions(next);
    if (result) { setResult(null); setSavedMessage(''); setState('idle'); setMessage(''); }
  }

  /**
   * Saving runs from the button's own click, never from the end of the job.
   * Safari only grants file-system and share access inside a user gesture, and
   * a promise continuation minutes later does not count as one.
   */
  async function handleDownload(edits: { order: number[]; rotations: Map<number, number> } | null) {
    if (!result) return;
    setSaving(true);
    setSavedMessage('');
    try {
      const blob = edits ? await applyPageEdits(result.blob, edits.order, edits.rotations) : result.blob;
      const outcome = await saveBlob(blob, result.filename);
      setSavedMessage(SAVE_MESSAGE[outcome]);
    } catch (error) {
      setState('error');
      setMessage(error instanceof Error ? error.message : 'บันทึกไฟล์ไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-line bg-card/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[var(--content)] items-center justify-between gap-4 px-5 lg:px-8">
          <Link href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight text-strong">
            <span className="grid size-9 place-items-center rounded-xl bg-[color:var(--surface-inverse)] text-sm text-white">M</span>
            <span>molly<span className="text-brand">pdf</span></span>
          </Link>

          <ToolNav />

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleTheme}
              className="rounded-xl border border-line p-2 text-muted hover:bg-sunken"
            >
              <Moon size={18} aria-hidden="true" className="theme-icon-light" />
              <Sun size={18} aria-hidden="true" className="theme-icon-dark" />
              <span className="sr-only">สลับโหมดสว่าง/มืด</span>
            </button>
            <button
              type="button"
              aria-expanded={mobileMenu}
              aria-controls="mobile-menu"
              onClick={() => setMobileMenu(!mobileMenu)}
              className="rounded-xl border border-line p-2 text-muted lg:hidden"
            >
              {mobileMenu ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
              <span className="sr-only">{mobileMenu ? 'ปิดเมนู' : 'เปิดเมนู'}</span>
            </button>
          </div>
        </div>

        {mobileMenu && (
          <nav id="mobile-menu" aria-label="เมนูบนมือถือ" className="border-t border-line bg-card px-5 py-3 text-sm font-medium lg:hidden">
            {/* The old mobile menu was missing "วิธีใช้" and never closed on tap. */}
            {[
              ['/tools/merge', 'รวม PDF'],
              ['/tools/split', 'แยก PDF'],
              ['/tools/compress', 'บีบอัด PDF'],
              ['#tools', 'เครื่องมือทั้งหมด'],
              ['/privacy', 'ความเป็นส่วนตัว'],
              ['#how', 'วิธีใช้'],
              ['#stats', 'สถิติการใช้งาน'],
            ].map(
              ([href, label]) => (
                <a key={href} href={href} onClick={() => setMobileMenu(false)} className="block py-2.5 text-body">
                  {label}
                </a>
              ),
            )}
          </nav>
        )}
      </header>

      <main id="main">
        {/* ───────────── hero ───────────── */}
        <section className="mx-auto max-w-[var(--content)] px-5 pb-14 pt-10 lg:px-8 lg:pb-20 lg:pt-16">
          <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_.95fr] lg:gap-16">
            <div>
              <p className="chip">
                <ShieldCheck size={15} className="text-[color:var(--ok)]" aria-hidden="true" />
                พื้นที่ทำงาน PDF ที่เคารพความเป็นส่วนตัว
              </p>
              {/* No max-width in ch: Thai has no spaces, so the browser can only
                  break at the points we give it. Two deliberate lines beat a
                  measure that forces a break mid-clause. */}
              <h1 className="display mt-6 text-balance">
                จัดการ PDF ได้
                <br />
                <span className="headline-accent">โดยไม่ต้องอัปโหลด</span>
              </h1>
              <p className="lede mt-6 max-w-[52ch] text-balance">
                รวม แยก แปลง เซ็น หรืออ่านเอกสารสำคัญให้เสร็จในเบราว์เซอร์ของคุณ
                เนื้อหาไฟล์ไม่ถูกส่งไปที่เซิร์ฟเวอร์ไหนทั้งสิ้น
              </p>
              <div className="mt-7 flex flex-wrap gap-x-6 gap-y-3 text-sm font-medium text-muted">
                <span className="flex items-center gap-2">
                  <ShieldCheck size={16} className="text-[color:var(--ok)]" aria-hidden="true" />ไฟล์อยู่บนอุปกรณ์
                </span>
                <span className="flex items-center gap-2">
                  <Zap size={16} className="text-brand" aria-hidden="true" />ไม่ต้องติดตั้ง
                </span>
                <span className="flex items-center gap-2">
                  <Heart size={16} className="text-[color:var(--danger)]" aria-hidden="true" />ฟรี ไม่ต้องสมัคร
                </span>
              </div>
              <div className="mt-9 flex flex-wrap gap-3">
                <button type="button" onClick={() => openTool(readyTools[0])} className="btn-primary">
                  เริ่มจากรวมไฟล์ PDF <ArrowRight size={17} aria-hidden="true" />
                </button>
                <a href="#tools" className="chip px-5 py-3.5 hover:border-[color:var(--line-strong)]">
                  ดูทั้ง {readyTools.length} เครื่องมือ
                </a>
              </div>
            </div>

            <div className="surface-card p-4 sm:p-5" style={{ boxShadow: 'var(--shadow-4)' }}>
              <button
                type="button"
                onClick={() => openTool(readyTools[0])}
                className="group block w-full rounded-[22px] border border-line bg-sunken px-5 py-12 text-center"
              >
                <span className="mx-auto grid size-16 place-items-center rounded-2xl bg-[color:var(--surface-inverse)] text-white transition group-hover:-translate-y-1">
                  <Upload size={26} aria-hidden="true" />
                </span>
                <strong className="mt-6 block text-xl font-semibold text-strong">เริ่มจากไฟล์ของคุณ</strong>
                <span className="mt-2 block text-sm text-muted">เลือกเครื่องมือ แล้วเปิดไฟล์จากอุปกรณ์</span>
              </button>
              <p className="mt-4 flex items-center justify-center gap-2 text-xs font-medium text-muted">
                <span className="grid size-5 place-items-center rounded-full bg-[color:var(--ok-soft)] text-[color:var(--ok)]">
                  <Check size={12} aria-hidden="true" />
                </span>
                เอกสารไม่ถูกส่งไปประมวลผลบนเซิร์ฟเวอร์
              </p>
            </div>
          </div>
        </section>

        {/* ───────────── tools ───────────── */}
        <section id="tools" className="bg-card py-20">
          <div className="mx-auto max-w-[var(--content)] px-5 lg:px-8">
            <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
              <div>
                <p className="eyebrow">{readyTools.length} เครื่องมือในพื้นที่เดียว</p>
                <h2 className="section-title mt-2">เลือกงานที่ต้องทำ แล้วลงมือได้เลย</h2>
                <p className="lede mt-3 max-w-[58ch]">
                  ตั้งแต่งานหน้าเอกสารไปจนถึง OCR ภาษาไทย ทุกขั้นตอนทำบนอุปกรณ์ของคุณ
                </p>
              </div>
              <div className="lg:w-[320px]">
                <label htmlFor="tool-search" className="sr-only">ค้นหาเครื่องมือ</label>
                <div className="flex h-12 items-center gap-3 rounded-2xl border border-line bg-sunken px-4 text-muted focus-within:border-[color:var(--brand-ring)]">
                  <Search size={18} aria-hidden="true" />
                  <input
                    id="tool-search"
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="ค้นหาเครื่องมือ…"
                    className="min-w-0 flex-1 bg-transparent text-sm text-strong outline-none"
                  />
                </div>
              </div>
            </div>

            {/* The four jobs that bring most people here. Putting them above
                the 42-card grid saves the scan for the common case; the star
                repeats on the card below so the two views agree. */}
            <section className="mt-8" aria-labelledby="featured-heading">
              <h3
                id="featured-heading"
                className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted"
              >
                <Star size={13} aria-hidden="true" className="fill-[color:var(--warn)] text-[color:var(--warn)]" />
                ใช้บ่อยที่สุด
              </h3>
              <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {featuredTools.map((tool) => (
                  <li key={tool.id}>
                    <Link
                      href={`/tools/${tool.id}`}
                      onClick={(event) => {
                        if (event.metaKey || event.ctrlKey || event.shiftKey) return;
                        event.preventDefault();
                        openTool(tool);
                      }}
                      className="tool-card flex h-full items-center gap-3 p-4"
                    >
                      <span className={`tool-icon tool-${tool.color} shrink-0`} aria-hidden="true">
                        <tool.icon size={19} />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-strong">{tool.title}</span>
                        <span className="mt-0.5 block truncate text-xs text-muted">{tool.description}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>

            <div className="hide-scrollbar mt-8 flex gap-2 overflow-x-auto pb-2" role="tablist" aria-label="หมวดเครื่องมือ">
              {categories.map((category) => (
                <button
                  key={category}
                  type="button"
                  role="tab"
                  aria-selected={activeCategory === category}
                  onClick={() => setActiveCategory(category)}
                  className={`whitespace-nowrap rounded-full px-4 py-2.5 text-sm font-medium transition ${
                    activeCategory === category
                      ? 'bg-[color:var(--action-bg)] text-[color:var(--action-fg)]'
                      : 'border border-line bg-card text-muted hover:border-[color:var(--line-strong)]'
                  }`}
                >
                  {category}
                </button>
              ))}
            </div>

            <ul className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filtered.map((tool) => (
                <li key={tool.id}>
                  {/* A real link: crawlable, middle-clickable, and still opens
                      the dialog in place on a plain left click. */}
                  <Link
                    href={`/tools/${tool.id}`}
                    onClick={(event) => {
                      if (event.metaKey || event.ctrlKey || event.shiftKey) return;
                      event.preventDefault();
                      openTool(tool);
                    }}
                    className="tool-card block h-full min-h-[176px] p-5"
                  >
                    {tool.badge && (
                      <span
                        className={`absolute right-4 top-4 rounded-full px-2.5 py-1 text-[11px] font-medium ${
                          tool.status === 'ready'
                            ? 'bg-[color:var(--ok-soft)] text-[color:var(--ok)]'
                            : 'bg-sunken text-subtle'
                        }`}
                      >
                        {tool.badge}
                      </span>
                    )}
                    <span className={`tool-icon tool-${tool.color}`} aria-hidden="true">
                      <tool.icon size={20} />
                    </span>
                    <h3 className="mt-5 flex items-center gap-1.5">
                      {tool.featured && (
                        <Star
                          size={14}
                          aria-hidden="true"
                          className="shrink-0 fill-[color:var(--warn)] text-[color:var(--warn)]"
                        />
                      )}
                      {tool.title}
                      {tool.featured && <span className="sr-only">(เครื่องมือยอดนิยม)</span>}
                    </h3>
                    <p className="mt-1.5 pr-4">{tool.description}</p>
                  </Link>
                </li>
              ))}
            </ul>

            {!filtered.length && (
              <p className="py-20 text-center text-muted">ไม่พบเครื่องมือที่ค้นหา — ลองคำอื่น เช่น &ldquo;รวม&rdquo; หรือ &ldquo;ocr&rdquo;</p>
            )}
          </div>
        </section>

        {/* ───────────── privacy ───────────── */}
        <section className="on-inverse relative overflow-hidden bg-[color:var(--surface-inverse)] py-24">
          <div className="mx-auto grid max-w-[var(--content)] items-center gap-14 px-5 lg:grid-cols-[1fr_.85fr] lg:px-8">
            <div>
              <p className="flex items-center gap-2 text-sm font-semibold text-[color:var(--ok)]">
                <ShieldCheck size={18} aria-hidden="true" />ความเป็นส่วนตัวที่อธิบายได้
              </p>
              <h2 className="section-title mt-5">
                เปิดไฟล์เพื่อทำงาน<br />ไม่ใช่ส่งไฟล์ไปฝากไว้
              </h2>
              <p className="lede mt-6 max-w-[54ch]">
                เบราว์เซอร์อ่านข้อมูลชั่วคราวและสร้างผลลัพธ์บนอุปกรณ์ของคุณเอง
                ไม่มี API รับไฟล์ ไม่มีคลาวด์เก็บเอกสาร และไม่มีเนื้อหาเอกสารถูกนำไปวิเคราะห์
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                {['ไม่ต้องมีบัญชี', 'ไม่มีพื้นที่เก็บไฟล์', 'ไม่มีคุกกี้ติดตาม'].map((item) => (
                  <span
                    key={item}
                    className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3.5 py-2 text-sm"
                  >
                    <Check size={14} aria-hidden="true" />
                    {item}
                  </span>
                ))}
              </div>
              {/* The honest version of the old "0 ไบต์" claim. */}
              <Link
                href="/privacy"
                className="mt-8 inline-flex items-center gap-2 text-sm font-semibold text-[color:var(--ok)] underline underline-offset-4"
              >
                ดูรายการคำขอเครือข่ายทั้งหมดที่เราทำ <ArrowRight size={15} aria-hidden="true" />
              </Link>
            </div>

            <div className="rounded-[28px] border border-white/12 bg-white/6 p-5 backdrop-blur">
              <div className="on-inverse-reset rounded-[20px] bg-[color:var(--surface-card)] p-6">
                <p className="text-sm font-semibold text-strong">สิ่งที่ออกจากเครื่องคุณ</p>
                <dl className="mt-4 space-y-3 text-sm">
                  {[
                    ['เนื้อหาเอกสาร', 'ไม่ส่ง'],
                    ['ชื่อไฟล์', 'ไม่ส่ง'],
                    ['รหัสผ่านที่คุณตั้ง', 'ไม่ส่ง'],
                    ['รหัสเครื่องมือ + ขนาดไฟล์ + จำนวนหน้า', 'ส่งไปนับยอดรวม'],
                  ].map(([key, value]) => (
                    <div key={key} className="flex items-start justify-between gap-4 border-b border-line pb-3 last:border-0">
                      <dt className="text-muted">{key}</dt>
                      <dd className={`shrink-0 font-semibold ${value === 'ไม่ส่ง' ? 'text-[color:var(--ok)]' : 'text-muted'}`}>
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          </div>
        </section>

        {/* ───────────── how ───────────── */}
        <section id="how" className="py-20">
          <div className="mx-auto max-w-[var(--content)] px-5 lg:px-8">
            <div className="text-center">
              <p className="eyebrow">ดำเนินการเสร็จในสามขั้นตอน</p>
              <h2 className="section-title mt-2">ไม่ต้องเรียนระบบใหม่ ไม่ต้องติดตั้งอะไรเพิ่ม</h2>
            </div>
            <ol className="mt-12 grid gap-5 md:grid-cols-3">
              {[
                ['01', 'เลือกเครื่องมือ', 'ค้นหางานที่ต้องการจากหมวดที่จัดไว้ชัดเจน'],
                ['02', 'เปิดไฟล์จากอุปกรณ์', 'ไฟล์ถูกอ่านชั่วคราวภายในแท็บนี้เท่านั้น'],
                ['03', 'รับไฟล์ใหม่ทันที', 'ดาวน์โหลดผลลัพธ์ แล้วปิดแท็บได้อย่างสบายใจ'],
              ].map(([n, title, body]) => (
                <li key={n} className="step-card">
                  <span aria-hidden="true">{n}</span>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ───────────── stats ───────────── */}
        <section id="stats" className="bg-card px-5 py-20 lg:px-8">
          <div className="mx-auto max-w-[1136px] rounded-[var(--radius-xl)] border border-line bg-sunken p-7 sm:p-12">
            <div className="grid gap-8 lg:grid-cols-[.9fr_1.1fr]">
              <div>
                <p className="eyebrow flex items-center gap-2">
                  <BarChart3 size={16} aria-hidden="true" />สถิติรวมจากผู้ใช้งานทุกคน
                </p>
                <h2 className="section-title mt-3">ทุกครั้งที่ใช้งาน ช่วยให้ตัวเลขนี้เติบโต</h2>
                <p className="lede mt-4 max-w-[44ch]">
                  เราส่งเฉพาะรหัสเครื่องมือ ขนาดไฟล์ และจำนวนหน้าไปบวกเป็นยอดรวม
                  ไม่มีชื่อไฟล์ เนื้อหาเอกสาร หรือไฟล์แม้แต่ไบต์เดียวถูกส่งไปเก็บ
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="stat-card">
                  <span>งานที่ผู้ใช้ทำเสร็จทั้งหมด</span>
                  <strong>{stats.jobs.toLocaleString('th-TH')}</strong>
                  <small>{statsReady ? 'ยอดรวมจากทุกอุปกรณ์' : 'กำลังเชื่อมต่อสถิติรวม…'}</small>
                </div>
                <div className="stat-card">
                  <span>ขนาดไฟล์ที่ประมวลผลรวม</span>
                  <strong>{formatBytes(stats.bytes)}</strong>
                  <small>เก็บเฉพาะตัวเลขขนาดไฟล์</small>
                </div>
                <div className="stat-card">
                  <span>หน้าที่จัดการแบบดิจิทัลรวม</span>
                  <strong>{stats.pages.toLocaleString('th-TH')}</strong>
                  <small>อาจช่วยลดการพิมพ์ซ้ำได้</small>
                </div>
                <div className="stat-card">
                  <span>เนื้อหาไฟล์ที่เก็บบนเซิร์ฟเวอร์</span>
                  <strong>0 B</strong>
                  <small>ไม่มีการส่งหรือจัดเก็บไฟล์เอกสาร</small>
                </div>
              </div>
            </div>

            {popular.length > 0 && (
              <div className="mt-8 border-t border-line pt-6">
                <p className="eyebrow">เครื่องมือยอดนิยม</p>
                <div className="mt-4 flex flex-wrap gap-3">
                  {popular.map(({ tool, count }, index) =>
                    tool ? (
                      <button key={tool.id} type="button" onClick={() => openTool(tool)} className="chip">
                        <span className="grid size-6 place-items-center rounded-full bg-[color:var(--surface-inverse)] text-[10px] text-white">
                          {index + 1}
                        </span>
                        {tool.title}
                        <small className="text-subtle">{count} ครั้ง</small>
                      </button>
                    ) : null,
                  )}
                </div>
              </div>
            )}
          </div>
        </section>
      </main>

      <footer className="border-t border-line bg-card">
        <div className="mx-auto flex max-w-[var(--content)] flex-col items-center justify-between gap-5 px-5 py-8 text-center text-sm text-muted sm:flex-row sm:text-start lg:px-8">
          <div className="flex items-center gap-2 font-bold text-strong">
            <span className="grid size-7 place-items-center rounded-lg bg-[color:var(--surface-inverse)] text-xs text-white">M</span>
            mollypdf
          </div>
          <nav aria-label="ลิงก์ท้ายหน้า" className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            <Link href="/privacy" className="hover:text-brand">ความเป็นส่วนตัว</Link>
            <a href="#tools" className="hover:text-brand">เครื่องมือทั้งหมด</a>
          </nav>
          <p className="text-subtle">© {new Date().getFullYear()} mollypdf</p>
        </div>
      </footer>

      {selected && (
        <ToolDialog
          tool={selected}
          files={files}
          fileless={FILELESS.has(selected.id)}
          // Split shows a page grid and Merge shows cover cards; both need room.
          // Anything with a page preview needs the room: a 640px column makes
          // the preview too small to place a signature accurately.
          // Anything with a page preview needs the room: a 640px column makes
          // the preview too small to place a stamp accurately. Every result
          // with a page grid needs it too.
          wide={
            PLACEMENT_TOOLS.has(selected.id) ||
            Boolean(result) ||
            ['split', 'merge', 'organize', 'pdf-jpg', 'pdf-png'].includes(selected.id)
          }
          // Merge renders its own visual cards, so the plain list would be a
          // second, competing set of reorder controls for the same files.
          hideFileList={selected.id === 'merge'}
          hideInputs={Boolean(result)}
          registerPicker={(open) => {
            openPickerRef.current = open;
          }}
          onFiles={(incoming) => {
            setResult(null);
            setSavedMessage('');
            // Adding to a merge list should extend it, not throw away what is
            // already there — and the same file must not land twice.
            setFiles((current) => {
              if (!selected.multiple) return incoming.slice(0, 1);
              const seen = new Set(current.map((f) => `${f.name}:${f.size}:${f.lastModified}`));
              const added = incoming.filter(
                (f) => !seen.has(`${f.name}:${f.size}:${f.lastModified}`),
              );
              return [...current, ...added];
            });
            setState('idle');
            setMessage('');
            setSpeechText('');
          }}
          onSetFiles={(next) => {
            setFiles(next);
            setResult(null);
            setSavedMessage('');
            setState('idle');
            setMessage('');
            setSpeechText('');
          }}
          orderable={selected.id === 'merge' || selected.id === 'compare'}
          hideRunButton={selected.id === 'read-aloud' || Boolean(result)}
          onClose={() => {
            setSelected(null);
            setResult(null);
            setSavedMessage('');
          }}
          onRun={handleRun}
          onCancel={() => abortRef.current?.abort()}
          state={state}
          message={message}
          progress={progress}
        >
          {['protect', 'unlock'].includes(selected.id) && (
            <PasswordField
              label={inputLabels[selected.id]}
              value={toolText}
              onChange={changeText}
              mode={selected.id === 'protect' ? 'new' : 'existing'}
            />
          )}


          {/* Every stamping tool is two jobs at once — write the thing, then
              say where it goes — and stacking them pushed the page preview
              below the fold on a laptop. Side by side on a wide screen both are
              visible together; the grid collapses back to a stack on narrow
              ones. เซ็นเอกสาร proved the shape; ข้อความ, เลขหน้า, ลายน้ำ and
              หัว–ท้ายกระดาษ are the same job and now get the same treatment. */}
          <div
            hidden={Boolean(result)}
            className={
              PLACEMENT_TOOLS.has(selected.id)
                ? 'grid items-start gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]'
                : 'space-y-4'
            }
          >
            <div className="space-y-4">
          {inputLabels[selected.id] &&
            selected.id !== 'sign' &&
            selected.id !== 'organize' &&
            !['protect', 'unlock'].includes(selected.id) && (
              <div>
                <label htmlFor="tool-input" className="block text-sm font-semibold text-strong">
                  {inputLabels[selected.id]}
                </label>
                {FILELESS.has(selected.id) ? (
                  <textarea
                    id="tool-input"
                    value={toolText}
                    onChange={(event) => changeText(event.target.value)}
                    rows={7}
                    placeholder={
                      selected.id === 'html-pdf' ? '<h1>หัวข้อ</h1><p>เนื้อหา</p>' : 'พิมพ์หรือวางข้อความที่นี่'
                    }
                    className="mt-2 w-full rounded-xl border border-line bg-card px-3 py-3 text-body outline-none focus:border-[color:var(--brand-ring)]"
                  />
                ) : (
                  <input
                    id="tool-input"
                    type="text"
                    autoComplete="off"
                    value={toolText}
                    onChange={(event) => changeText(event.target.value)}
                    placeholder={
                      selected.id === 'page-numbers'
                        ? 'หน้า {n} จาก {total}'
                        : ['organize', 'remove-pages', 'extract-pages'].includes(selected.id)
                          ? 'เช่น 1, 3-5, 2'
                          : 'พิมพ์ที่นี่'
                    }
                    className="mt-2 h-11 w-full rounded-xl border border-line bg-card px-3 text-body outline-none focus:border-[color:var(--brand-ring)]"
                  />
                )}
              </div>
            )}

          {selected.id === 'sign' && (
            <SignaturePad
              typed={toolText}
              onTypedChange={changeText}
              onDrawnChange={(value) => {
                setSignature(value);
                // Mirror it into the options so the drag-to-place preview shows
                // the real signature rather than a placeholder.
                setToolOptions((current) => {
                  const next = { ...current };
                  if (value) {
                    next.signatureImage = value.dataUrl;
                    next.signatureWidth = String(value.width);
                    next.signatureHeight = String(value.height);
                  } else {
                    delete next.signatureImage;
                    delete next.signatureWidth;
                    delete next.signatureHeight;
                  }
                  return next;
                });
              }}
            />
          )}

          {selected.id === 'read-aloud' && files.length > 0 && (
            speechText ? (
              <ReadAloud text={speechText} />
            ) : (
              <button
                type="button"
                onClick={loadSpeechText}
                disabled={state === 'processing'}
                className="btn-primary w-full"
              >
                เตรียมข้อความสำหรับอ่านออกเสียง
              </button>
            )
          )}

            </div>

          <ToolOptions
            toolId={selected.id}
            files={files}
            options={toolOptions}
            onChange={changeOptions}
            onFilesChange={setFiles}
            onAddFiles={() => openPickerRef.current?.()}
            text={toolText}
          />
          </div>

          {result && (
            <ResultPanel
              // A new result is a new review: remount so no page edit survives it.
              key={`${result.filename}-${result.blob.size}`}
              result={result}
              onDownload={handleDownload}
              saving={saving}
              savedMessage={savedMessage}
              reviewOpen={['merge', 'organize'].includes(selected.id)}
              onBack={() => {
                setResult(null);
                setSavedMessage('');
                setState('idle');
                setMessage('');
              }}
            />
          )}

          {selected.id === 'ocr' && (
            <p className="text-xs leading-6 text-muted">
              ครั้งแรกจะดาวน์โหลดโมเดลภาษาไทยประมาณ 15 MB จากนั้นทำงานในเครื่องทั้งหมด — ภาพเอกสารไม่ถูกส่งออกไป
            </p>
          )}
          {selected.id === 'redact' && (
            <p className="text-xs leading-6 text-[color:var(--danger)]">
              ผลลัพธ์จะถูกแปลงเป็นภาพเพื่อลบข้อความต้นฉบับออกจริง ถ้าหาคำที่ระบุไม่พบ ระบบจะไม่สร้างไฟล์ให้
              โปรดเปิดไฟล์ตรวจก่อนส่งต่อทุกครั้ง
            </p>
          )}
        </ToolDialog>
      )}
    </>
  );
}
