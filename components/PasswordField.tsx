'use client';

/**
 * Password input with a reveal toggle.
 *
 * Without it, a mistyped password on "ปลดล็อก PDF" is indistinguishable from
 * the wrong password — and Thai keyboards make that worse, because the layout
 * switch is easy to miss and every character comes back as a dot. Being able to
 * look at what you typed is the difference between one attempt and five.
 *
 * The field also warns about the two mistakes that actually cause a failed
 * unlock: Caps Lock, and typing Thai characters when the password was set on a
 * Latin keyboard.
 */

import { Eye, EyeOff, TriangleAlert } from 'lucide-react';
import { useId, useState } from 'react';

export type PasswordFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** `protect` sets a new password; `unlock` types an existing one. */
  mode: 'new' | 'existing';
};

const THAI = /[฀-๿]/;

export function PasswordField({ label, value, onChange, mode }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const id = useId();
  const hintId = useId();

  const hasThai = THAI.test(value);
  const tooShort = mode === 'new' && value.length > 0 && value.length < 4;

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-strong">
        {label}
      </label>

      <div className="relative mt-2">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyUp={(event) => setCapsLock(event.getModifierState?.('CapsLock') ?? false)}
          onBlur={() => setCapsLock(false)}
          autoComplete={mode === 'new' ? 'new-password' : 'current-password'}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-describedby={hintId}
          className="h-11 w-full rounded-xl border border-line bg-card pe-12 ps-3 text-body outline-none focus:border-[color:var(--brand-ring)]"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          // Not a checkbox: this reveals text, it does not change the value.
          aria-pressed={visible}
          className="absolute inset-y-0 end-0 grid w-11 place-items-center rounded-e-xl text-muted hover:text-brand"
        >
          {visible ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
          <span className="sr-only">{visible ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}</span>
        </button>
      </div>

      <div id={hintId} className="mt-1.5 space-y-1">
        {capsLock && (
          <p className="flex items-center gap-1.5 text-xs text-[color:var(--warn)]">
            <TriangleAlert size={13} aria-hidden="true" />เปิด Caps Lock อยู่
          </p>
        )}
        {hasThai && (
          <p className="flex items-start gap-1.5 text-xs text-[color:var(--warn)]">
            <TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
            มีอักษรไทยในรหัสผ่าน — ใช้ได้ แต่โปรแกรมอ่าน PDF บางตัวรองรับไม่ครบ
            {mode === 'new' && ' หากต้องเปิดไฟล์ในหลายโปรแกรม แนะนำใช้อักษรละตินกับตัวเลข'}
          </p>
        )}
        {tooShort && (
          <p className="text-xs text-[color:var(--warn)]">รหัสผ่านควรมีอย่างน้อย 4 ตัวอักษร</p>
        )}
        {mode === 'new' && !tooShort && (
          <p className="text-xs text-subtle">
            รหัสผ่านนี้ไม่ถูกส่งไปที่ใด การเข้ารหัสเกิดขึ้นในเบราว์เซอร์ — ถ้าลืมแล้วกู้คืนไม่ได้
          </p>
        )}
      </div>
    </div>
  );
}
