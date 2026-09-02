// canonical.test.mjs — one byte form for one meaning, proven.
//
// The strict form is what protocol hashes will be built over; the persisted
// form is what the restore comparison reads. The two differ on exactly one
// question, what to do with a value JSON would quietly rewrite, and these
// tests pin both answers.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { canonicalJSON, canonicalPersisted, semanticallyEqual } =
  await import('../js/canonical.js?v=test');

test('key insertion order does not exist in the canonical form', () => {
  const a = { name: 'A', lat: 46, lng: 8, tags: [] };
  const b = { tags: [], lng: 8, lat: 46, name: 'A' };
  assert.equal(canonicalJSON(a), canonicalJSON(b));
  assert.ok(semanticallyEqual(a, b));
  // and nested keys canonicalize too, or a record's provenance would still
  // carry the trap one level down
  const n1 = { p: { chain: [{ name: 'M', at: 'T' }], name: 'J' } };
  const n2 = { p: { name: 'J', chain: [{ at: 'T', name: 'M' }] } };
  assert.equal(canonicalJSON(n1), canonicalJSON(n2));
});

test('array order is meaning and survives', () => {
  assert.notEqual(canonicalJSON([1, 2]), canonicalJSON([2, 1]));
  assert.notEqual(canonicalJSON({ path: ['a', 'b'] }), canonicalJSON({ path: ['b', 'a'] }));
});

test('the order of keys is code units, never the locale', () => {
  // localeCompare in most locales sorts a before Z and ä beside a; code-unit
  // order is Z, a, ä in every browser language, which is the promise a
  // comparison that runs on two people's devices has to make
  const s = canonicalJSON({ 'ä': 1, a: 2, Z: 3 });
  assert.equal(s, '{"Z":3,"a":2,"ä":1}');
});

test('string escaping is JSON escaping, stably', () => {
  assert.equal(canonicalJSON({ q: 'a "quote" and a \\ and a \n' }),
    '{"q":"a \\"quote\\" and a \\\\ and a \\n"}');
});

test('one zero is all a canonical form may have', () => {
  assert.equal(canonicalJSON(-0), '0');
  assert.equal(canonicalJSON(0), '0');
  assert.ok(semanticallyEqual({ lat: -0 }, { lat: 0 }));
});

test('the strict form refuses everything JSON would quietly rewrite', () => {
  for (const bad of [NaN, Infinity, -Infinity]) {
    assert.throws(() => canonicalJSON(bad), TypeError, `${bad} was encoded`);
    assert.throws(() => canonicalJSON({ n: bad }), TypeError);
  }
  assert.throws(() => canonicalJSON(undefined), TypeError);
  assert.throws(() => canonicalJSON({ a: undefined }), TypeError,
    'an undefined property slipped into what could become a hash');
  assert.throws(() => canonicalJSON(() => {}), TypeError);
  assert.throws(() => canonicalJSON(Symbol('s')), TypeError);
  assert.throws(() => canonicalJSON(1n), TypeError);
  assert.throws(() => canonicalJSON([1, , 3]), TypeError, 'a sparse array was read as if whole');
  assert.throws(() => canonicalJSON(new Date()), TypeError, 'a non-plain object canonicalized');
  const loop = {}; loop.self = loop;
  assert.throws(() => canonicalJSON(loop), TypeError);
});

test('the persisted form answers the storage question instead', () => {
  // an undefined property does not survive persistence, so two values that
  // differ only by one are the same stored value
  assert.ok(semanticallyEqual({ a: 1, b: undefined }, { a: 1 }));
  // and a value with no JSON form at all is still refused, not read as null
  assert.throws(() => canonicalPersisted(undefined), TypeError);
});

test('the canonical form is itself JSON, and parses back to the same value', () => {
  const v = { name: 'Ünïcode "x"', tags: ['a', 'b'], n: 1.5, deep: { z: true, a: null } };
  const s = canonicalJSON(v);
  assert.deepEqual(JSON.parse(s), v);
  // idempotent: canonicalizing the parse of the canonical form changes nothing
  assert.equal(canonicalJSON(JSON.parse(s)), s);
});
