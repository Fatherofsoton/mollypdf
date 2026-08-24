'use client';

/**
 * Per-tool controls.
 *
 * The original dialog offered exactly one text input for every tool, which is
 * why several tools quietly did less than their card promised: "หมุน PDF" could
 * only ever turn every page 90° clockwise, "ครอป PDF" used a hard-coded 18pt
 * margin, "เพิ่มข้อความ"/"เซ็นเอกสาร" always landed on page 1, and
 * "กรอกฟอร์ม PDF" wrote the same string into every field in the document.
 *
 * These are the controls that make those descriptions true.
 */

import { useEffect, useState } from 'react';
import { Feather, Gauge, Minimize2 } from 'lucide-react';
import { SplitWorkspace } from './SplitWorkspace';
import { MergeWorkspace } from './MergeWorkspace';
import { PlacementWorkspace } from './PlacementWorkspace';
import { ImageExportWorkspace } from './ImageExportWorkspace';

export type OptionsProps = {
  toolId: string;
  files: File[];
  options: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  /** Merge needs to reorder and remove files, not just read them. */
  onFilesChange?: (files: File[]) => void;
  /** Opens the file picker again so more files can be appended. */
  onAddFiles?: () => void;
  /** The text typed into the tool's own field, for the placement preview. */
  text?: string;
};

/** Tools whose whole job is putting something at a particular spot on a page. */
const PLACEMENT: Record<string, { scope: 'single' | 'all'; x: number; y: number; size: number }> = {
  edit: { scope: 'single', x: 0.5, y: 0.5, size: 0.5 },
  sign: { scope: 'single', x: 0.75, y: 0.9, size: 0.3 },
  watermark: { scope: 'all', x: 0.5, y: 0.5, size: 0.6 },
  'header-footer': { scope: 'all', x: 0.5, y: 0.06, size: 0.5 },
};

/**
 * Compression presets, described by what the user gets rather than by the
 * codec settings behind them. "Recommended" is pre-selected because it is the
 * only one that is safe for a document that might later be printed.
 */
const COMPRESSION = [
  {
    id: 'extreme',
    label: 'บีบอัดสูงสุด',
    hint: 'ไฟล์เล็กที่สุด คุณภาพลดลงชัดเจน — เหมาะกับการอ่านบนจอเท่านั้น',
    icon: Minimize2,
  },
  {
    id: 'recommended',
    label: 'แนะนำ',
    hint: 'คุณภาพดี ขนาดลดลงมาก — เหมาะกับงานทั่วไปและยังพิมพ์ได้',
    icon: Gauge,
  },
  {
    id: 'less',
    label: 'บีบอัดน้อย',
    hint: 'คุณภาพสูงสุด ขนาดลดลงเล็กน้อย — เหมาะกับเอกสารที่ต้องพิมพ์',
    icon: Feather,
  },
] as const;

const fieldClass =
  'mt-2 h-11 w-full rounded-xl border border-line bg-card px-3 text-body outline-none focus:border-[color:var(--brand-ring)]';

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-strong">{label}</label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-subtle">{hint}</p>}
    </div>
  );
}

/** Reads the text field names out of a PDF form so each can be filled separately. */
function FormFields({ files, options, onChange }: Omit<OptionsProps, 'toolId'>) {
  const [fields, setFields] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  const file = files[0];

  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    (async () => {
      try {
        const { PDFDocument } = await import('pdf-lib');
        const doc = await PDFDocument.load(await file.arrayBuffer());
        const names = doc
          .getForm()
          .getFields()
          .filter((field) => 'setText' in (field as object))
          .map((field) => field.getName());
        if (!cancelled) {
          setFields(names);
          setError(names.length ? '' : 'ไฟล์นี้ไม่มีช่องกรอกข้อความ');
        }
      } catch {
        if (!cancelled) setError('อ่านฟอร์มจากไฟล์นี้ไม่ได้');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file]);

  if (!file) return null;
  if (error) return <p className="text-sm text-[color:var(--danger)]">{error}</p>;
  if (!fields) return <p className="text-sm text-muted">กำลังอ่านช่องกรอกในฟอร์ม…</p>;

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-semibold text-strong">
        พบ {fields.length} ช่อง — กรอกเฉพาะช่องที่ต้องการ
      </legend>
      {fields.map((name) => (
        <div key={name}>
          <label htmlFor={`field-${name}`} className="block text-xs font-medium text-muted">
            {name}
          </label>
          <input
            id={`field-${name}`}
            value={options[name] ?? ''}
            onChange={(event) => onChange({ ...options, [name]: event.target.value })}
            className={`${fieldClass} h-10`}
          />
        </div>
      ))}
    </fieldset>
  );
}

export function ToolOptions({
  toolId,
  files,
  options,
  onChange,
  onFilesChange,
  onAddFiles,
  text = '',
}: OptionsProps) {
  const set = (key: string, value: string) => onChange({ ...options, [key]: value });

  const placement = PLACEMENT[toolId];
  if (placement) {
    return (
      <PlacementWorkspace
        key={files[0] ? `${files[0].name}-${files[0].size}-${files[0].lastModified}` : 'empty'}
        file={files[0]}
        options={options}
        onChange={onChange}
        scope={placement.scope}
        defaults={{ x: placement.x, y: placement.y, size: placement.size }}
        preview={
          options.signatureImage
            ? { kind: 'image', dataUrl: options.signatureImage }
            : { kind: 'text', value: text }
        }
      />
    );
  }

  if (toolId === 'pdf-jpg' || toolId === 'pdf-png') {
    return (
      <ImageExportWorkspace
        key={files[0] ? `${files[0].name}-${files[0].size}-${files[0].lastModified}` : 'empty'}
        file={files[0]}
        format={toolId === 'pdf-jpg' ? 'jpg' : 'png'}
        options={options}
        onChange={onChange}
      />
    );
  }

  switch (toolId) {
    case 'split':
      return (
        <SplitWorkspace
          // Remounting on a new file resets the thumbnail grid without an
          // effect that has to undo the previous document's state.
          key={files[0] ? `${files[0].name}-${files[0].size}-${files[0].lastModified}` : 'empty'}
          file={files[0]}
          options={options}
          onChange={onChange}
        />
      );

    case 'merge':
      return onFilesChange && onAddFiles ? (
        <MergeWorkspace files={files} onFilesChange={onFilesChange} onAdd={onAddFiles} />
      ) : null;

    case 'compress': {
      const current = options.compressLevel ?? 'recommended';
      return (
        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-strong">ระดับการบีบอัด</legend>
          <div className="space-y-2">
            {COMPRESSION.map((item) => {
              const active = current === item.id;
              return (
                <label
                  key={item.id}
                  className={`flex cursor-pointer items-start gap-3 rounded-[var(--radius-md)] border p-3.5 transition ${
                    active
                      ? 'border-brand bg-brand-soft'
                      : 'border-line bg-card hover:border-[color:var(--line-strong)]'
                  }`}
                >
                  <input
                    type="radio"
                    name="compressLevel"
                    value={item.id}
                    checked={active}
                    onChange={() => set('compressLevel', item.id)}
                    className="mt-1 size-4 shrink-0 accent-[color:var(--brand)]"
                  />
                  <item.icon
                    size={18}
                    aria-hidden="true"
                    className={`mt-0.5 shrink-0 ${active ? 'text-brand' : 'text-subtle'}`}
                  />
                  <span>
                    <span className="block text-sm font-semibold text-strong">{item.label}</span>
                    <span className="mt-0.5 block text-xs leading-5 text-muted">{item.hint}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      );
    }

    case 'rotate':
      return (
        <div className="space-y-4">
          <Row label="ทิศทางการหมุน">
            <select
              value={options.angle ?? '90'}
              onChange={(event) => set('angle', event.target.value)}
              className={fieldClass}
            >
              <option value="90">ขวา 90°</option>
              <option value="-90">ซ้าย 90°</option>
              <option value="180">กลับหัว 180°</option>
            </select>
          </Row>
          <Row label="หน้าที่ต้องการหมุน" hint="เว้นว่างไว้ = หมุนทุกหน้า">
            <input
              value={options.pages ?? ''}
              onChange={(event) => set('pages', event.target.value)}
              placeholder="เช่น 1, 3-5"
              className={fieldClass}
            />
          </Row>
        </div>
      );

    case 'crop':
      return (
        <Row label="ระยะขอบที่ตัดออก (พอยต์)" hint="72 พอยต์ ≈ 1 นิ้ว">
          <input
            type="number"
            min={0}
            max={200}
            value={options.margin ?? '18'}
            onChange={(event) => set('margin', event.target.value)}
            className={fieldClass}
          />
        </Row>
      );

    case 'edit':
    case 'sign':
      return (
        <Row label="หน้าที่จะวาง" hint="ระบุได้หลายหน้า เช่น 1, 4-6">
          <input
            value={options.pages ?? '1'}
            onChange={(event) => set('pages', event.target.value)}
            className={fieldClass}
          />
        </Row>
      );

    case 'fill-form':
      return <FormFields files={files} options={options} onChange={onChange} />;

    default:
      return null;
  }
}
