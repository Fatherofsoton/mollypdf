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

export type OptionsProps = {
  toolId: string;
  files: File[];
  options: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
};

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

export function ToolOptions({ toolId, files, options, onChange }: OptionsProps) {
  const set = (key: string, value: string) => onChange({ ...options, [key]: value });

  switch (toolId) {
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
