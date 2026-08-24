'use client';

/**
 * Header navigation.
 *
 * The old header linked to four page anchors, so the only way to reach any of
 * the 42 tools was to scroll to the grid and search it. That is fine for a
 * landing page and wrong for a toolbox: the three jobs people come for — merge,
 * split, compress — should be one click from anywhere, and the rest should be
 * browsable by category rather than by scrolling.
 *
 * The dropdowns are real disclosure widgets: `aria-expanded`, Escape to close,
 * click-outside to close, and every item is a real link so middle-click and
 * "open in new tab" work.
 */

import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { readyTools, type Tool } from '../lib/tools/registry';

const QUICK = ['merge', 'split', 'compress'];

/** Tools whose id ends in `-pdf` produce a PDF; `pdf-` ones consume one. */
const toPdf = readyTools.filter((t) => t.category === 'แปลงไฟล์' && t.id.endsWith('-pdf'));
const fromPdf = readyTools.filter((t) => t.category === 'แปลงไฟล์' && t.id.startsWith('pdf-'));

const CATEGORY_ORDER = [
  'จัดหน้า',
  'ปรับไฟล์',
  'แก้ไขและเซ็น',
  'ความปลอดภัย',
  'อ่านและตรวจสอบ',
] as const;

function ToolLink({ tool, onNavigate }: { tool: Tool; onNavigate: () => void }) {
  return (
    <Link
      href={`/tools/${tool.id}`}
      onClick={onNavigate}
      className="group flex items-start gap-3 rounded-[var(--radius-md)] p-2.5 transition hover:bg-sunken"
    >
      <span className={`tool-icon tool-${tool.color} size-9 shrink-0`} aria-hidden="true">
        <tool.icon size={17} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-strong">{tool.title}</span>
        <span className="mt-0.5 block truncate text-xs text-muted">{tool.description}</span>
      </span>
    </Link>
  );
}

function Dropdown({
  label,
  children,
  width,
}: {
  label: string;
  children: (close: () => void) => React.ReactNode;
  width: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onClick = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1 py-2 text-sm font-medium transition hover:text-brand ${
          open ? 'text-brand' : 'text-muted'
        }`}
      >
        {label}
        <ChevronDown
          size={15}
          aria-hidden="true"
          className={`transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          id={panelId}
          className={`absolute left-1/2 top-full z-50 mt-2 -translate-x-1/2 rounded-[var(--radius-xl)] border border-line bg-card p-4 shadow-[var(--shadow-4)] ${width}`}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function ToolNav() {
  const quick = QUICK.map((id) => readyTools.find((t) => t.id === id)).filter(Boolean) as Tool[];

  return (
    <nav aria-label="เมนูหลัก" className="hidden items-center gap-6 lg:flex">
      {quick.map((tool) => (
        <Link
          key={tool.id}
          href={`/tools/${tool.id}`}
          className="py-2 text-sm font-medium text-muted transition hover:text-brand"
        >
          {tool.title}
        </Link>
      ))}

      <Dropdown label="แปลงไฟล์" width="w-[540px]">
        {(close) => (
          <div className="grid grid-cols-2 gap-x-4">
            <div>
              <p className="eyebrow px-2.5 pb-1.5">แปลงเป็น PDF</p>
              {toPdf.map((tool) => (
                <ToolLink key={tool.id} tool={tool} onNavigate={close} />
              ))}
            </div>
            <div>
              <p className="eyebrow px-2.5 pb-1.5">แปลงจาก PDF</p>
              {fromPdf.map((tool) => (
                <ToolLink key={tool.id} tool={tool} onNavigate={close} />
              ))}
            </div>
          </div>
        )}
      </Dropdown>

      <Dropdown label="เครื่องมือทั้งหมด" width="w-[min(88vw,900px)]">
        {(close) => (
          <div className="grid max-h-[70vh] grid-cols-3 gap-x-4 gap-y-5 overflow-y-auto">
            {CATEGORY_ORDER.map((category) => {
              const tools = readyTools.filter((t) => t.category === category);
              if (!tools.length) return null;
              return (
                <div key={category}>
                  <p className="eyebrow px-2.5 pb-1.5">{category}</p>
                  {tools.map((tool) => (
                    <ToolLink key={tool.id} tool={tool} onNavigate={close} />
                  ))}
                </div>
              );
            })}
            <div>
              <p className="eyebrow px-2.5 pb-1.5">แปลงไฟล์</p>
              {readyTools
                .filter((t) => t.category === 'แปลงไฟล์')
                .slice(0, 6)
                .map((tool) => (
                  <ToolLink key={tool.id} tool={tool} onNavigate={close} />
                ))}
              <Link
                href="/#tools"
                onClick={close}
                className="block px-2.5 pt-1 text-xs font-semibold text-brand hover:underline"
              >
                ดูทั้งหมด →
              </Link>
            </div>
          </div>
        )}
      </Dropdown>

      <Link href="/privacy" className="py-2 text-sm font-medium text-muted transition hover:text-brand">
        ความเป็นส่วนตัว
      </Link>
    </nav>
  );
}
