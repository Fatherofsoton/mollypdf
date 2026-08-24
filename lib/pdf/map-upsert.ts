/**
 * Polyfill for the TC39 "upsert" proposal: `Map.prototype.getOrInsert`,
 * `Map.prototype.getOrInsertComputed` and the `WeakMap` equivalents.
 *
 * Why this exists
 * ---------------
 * pdfjs-dist 6.2 calls `getOrInsertComputed` in both its main-thread and worker
 * bundles — including the legacy build, which is normally the compatibility
 * escape hatch. The method only shipped in Chrome 142 / Firefox 145 and is not
 * in any released Safari, so on the browsers a large share of real visitors use
 * (every iPhone, and any Chrome more than a few months old) **every tool that
 * rasterises a page** — บีบอัด, ขาวดำ, PDF เป็น JPG/PNG, OCR, ปิดข้อมูล,
 * ลบหน้าว่าง, เปรียบเทียบ, PDF เป็น PowerPoint — throws
 *
 *     this[#rZ].getOrInsertComputed is not a function
 *
 * and the user sees a meaningless error. The browser test in
 * `tests/browser/run.mjs` caught this against Chromium 141.
 *
 * This module is imported for its side effect from `lib/pdf/pdfjs.ts` (main
 * thread) and from `lib/pdf/worker-entry.ts` (the pdf.js worker, which is a
 * separate global scope and needs its own copy).
 *
 * Spec: https://github.com/tc39/proposal-upsert
 */

type Upsertable<K, V> = {
  has(key: K): boolean;
  get(key: K): V | undefined;
  set(key: K, value: V): unknown;
};

function define(target: object, name: string, value: (...args: never[]) => unknown) {
  if (name in target) return;
  Object.defineProperty(target, name, {
    value,
    writable: true,
    enumerable: false,
    configurable: true,
  });
}

function getOrInsert<K, V>(this: Upsertable<K, V>, key: K, value: V): V {
  if (this.has(key)) return this.get(key) as V;
  this.set(key, value);
  return value;
}

function getOrInsertComputed<K, V>(this: Upsertable<K, V>, key: K, callbackfn: (key: K) => V): V {
  if (typeof callbackfn !== 'function') {
    throw new TypeError('getOrInsertComputed: callbackfn is not a function');
  }
  if (this.has(key)) return this.get(key) as V;
  const value = callbackfn(key);
  // Re-check: the callback may have inserted the key itself. The spec keeps the
  // freshly computed value, so this mirrors it rather than the earlier insert.
  this.set(key, value);
  return value;
}

export function installMapUpsert() {
  for (const ctor of [Map, WeakMap]) {
    define(ctor.prototype, 'getOrInsert', getOrInsert as never);
    define(ctor.prototype, 'getOrInsertComputed', getOrInsertComputed as never);
  }
}

installMapUpsert();
