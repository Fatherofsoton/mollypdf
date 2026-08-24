/**
 * The polyfill that keeps pdfjs-dist 6.2 working on Safari and on any Chrome
 * older than 142. Without it every rasterising tool throws
 * "getOrInsertComputed is not a function" — see lib/pdf/map-upsert.ts.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import '../lib/pdf/map-upsert';

type UpsertMap<K, V> = Map<K, V> & {
  getOrInsert(key: K, value: V): V;
  getOrInsertComputed(key: K, fn: (key: K) => V): V;
};

test('getOrInsert returns the existing value and does not overwrite', () => {
  const map = new Map([['a', 1]]) as UpsertMap<string, number>;
  assert.equal(map.getOrInsert('a', 99), 1);
  assert.equal(map.get('a'), 1);
});

test('getOrInsert inserts when the key is missing', () => {
  const map = new Map() as UpsertMap<string, number>;
  assert.equal(map.getOrInsert('b', 7), 7);
  assert.equal(map.get('b'), 7);
});

test('getOrInsertComputed only calls the callback when needed', () => {
  const map = new Map([['a', 1]]) as UpsertMap<string, number>;
  let calls = 0;
  assert.equal(map.getOrInsertComputed('a', () => { calls++; return 99; }), 1);
  assert.equal(calls, 0, 'callback must not run for a present key');

  assert.equal(map.getOrInsertComputed('b', (key) => { calls++; return key.length; }), 1);
  assert.equal(calls, 1);
  assert.equal(map.get('b'), 1);
});

test('getOrInsertComputed rejects a non-callable', () => {
  const map = new Map() as UpsertMap<string, number>;
  assert.throws(() => map.getOrInsertComputed('x', undefined as never), TypeError);
});

test('WeakMap gets the same methods', () => {
  const key = {};
  const weak = new WeakMap() as WeakMap<object, string> & {
    getOrInsertComputed(k: object, fn: (k: object) => string): string;
  };
  assert.equal(weak.getOrInsertComputed(key, () => 'made'), 'made');
  assert.equal(weak.getOrInsertComputed(key, () => 'other'), 'made');
});

test('the methods are non-enumerable, like real built-ins', () => {
  assert.ok(!Object.keys(Map.prototype).includes('getOrInsert'));
  for (const k in new Map()) assert.notEqual(k, 'getOrInsertComputed');
});
