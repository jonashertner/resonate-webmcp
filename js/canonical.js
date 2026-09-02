// canonical.js — one byte form for one meaning.
//
// JSON.stringify equality was this app's idea of "the same record", and key
// insertion order is part of that. A field added to a normalizer but emitted
// at a different position by a builder made a stored record and the same
// record rebuilt serialise differently, so the panel a person reads before a
// restore reported differences that did not exist. That defect was met twice
// before this file: once over photographs, once over a folio round trip.
//
// Two entry points, deliberately distinct, because they answer two questions.
//
// canonicalJSON answers: what are the exact bytes of this value, for a hash
// or a signature? It refuses everything JSON would quietly rewrite or drop:
// undefined, functions, symbols, bigints, numbers JSON cannot carry, arrays
// with holes, objects that are not plain, values that contain themselves. A
// protocol hash over a value that JSON.stringify would have silently changed
// is a hash of something other than what was meant, and the refusal is the
// point: nothing enters a signature by accident.
//
// canonicalPersisted answers the narrower storage question: would these two
// values become the same JSON value after a round trip through persistence?
// It lets JSON do what JSON does (drop undefined properties, honour toJSON,
// turn -0 into 0) and then canonicalizes what actually survives, because what
// survives is what a restore compares against.
//
// Key order is code-unit order, never locale order. A comparison that sorted
// differently in a different browser language would be a comparison that
// disagrees with itself across the people it serves.

function encode(value, seen) {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'string') return JSON.stringify(value);
  if (t === 'boolean') return value ? 'true' : 'false';
  if (t === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`a number JSON cannot carry: ${value}`);
    // JSON.stringify(-0) is "0", and one zero is all a canonical form may have
    return JSON.stringify(value);
  }
  if (t === 'bigint') throw new TypeError('a bigint has no JSON form');
  if (t === 'undefined') throw new TypeError('undefined has no JSON form');
  if (t === 'function' || t === 'symbol') throw new TypeError(`a ${t} has no JSON form`);

  if (seen.has(value)) throw new TypeError('a value that contains itself has no finite form');
  seen.add(value);
  let out;
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) {
      // a hole reads as undefined and JSON would write null in its place,
      // which is an invented value where the author wrote nothing
      if (!(i in value)) throw new TypeError('a sparse array has no honest JSON form');
      parts.push(encode(value[i], seen));
    }
    out = `[${parts.join(',')}]`;
  } else {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new TypeError('only a plain object canonicalizes; anything else hides behaviour');
    }
    // sort() with no comparator orders by UTF-16 code unit: the same order in
    // every locale, which localeCompare does not promise
    const keys = Object.keys(value).sort();
    out = `{${keys.map(k => `${JSON.stringify(k)}:${encode(value[k], seen)}`).join(',')}}`;
  }
  seen.delete(value);
  return out;
}

export function canonicalJSON(value) {
  return encode(value, new Set());
}

export function canonicalPersisted(value) {
  const ordinary = JSON.stringify(value);
  if (ordinary === undefined) throw new TypeError('this value has no JSON representation at all');
  return canonicalJSON(JSON.parse(ordinary));
}

export function semanticallyEqual(a, b) {
  return canonicalPersisted(a) === canonicalPersisted(b);
}
