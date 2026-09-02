// atlas.test.mjs — the invariants a hostile link must never break.
// Run: node --test test/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// the browser globals these modules stand on
globalThis.location = { origin: 'https://example.test', pathname: '/resonate/', hash: '' };
globalThis.history = { replaceState() {} };
globalThis.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
};
const lz = readFileSync(join(root, 'vendor/lz/lz-string.min.js'), 'utf8');
new Function(lz + '\nglobalThis.LZString = LZString;')();

const { sanePlace } = await import('../js/store.js?v=test');
const share = await import('../js/share.js?v=test');

test('a rating from a link cannot exceed five stars', () => {
  assert.equal(sanePlace({ rating: 1e9 }).rating, 5);
  assert.equal(sanePlace({ rating: -4 }).rating, 0);
  assert.equal(sanePlace({ rating: 'four' }).rating, 0);
  assert.equal(sanePlace({ rating: 3.7 }).rating, 3);
});

test('tags are always an array of strings', () => {
  assert.deepEqual(sanePlace({ tags: 5 }).tags, []);
  assert.deepEqual(sanePlace({ tags: null }).tags, []);
  assert.deepEqual(sanePlace({ tags: { a: 1 } }).tags, []);
  assert.deepEqual(sanePlace({ tags: ['a', 7, 'b'] }).tags, ['a', 'b']);
});

test('provenance is rebuilt, so sig can never leave its attribute', () => {
  const evil = sanePlace({ provenance: { name: 'x', sig: '0deg"/><img src=x onerror=alert(1)>' } });
  assert.equal(evil.provenance.sig, 0);
  assert.equal(typeof evil.provenance.sig, 'number');
});

test('a place with no provenance does not grow one', () => {
  assert.equal('provenance' in sanePlace({ name: 'a' }), false);
});

test('an ask link round-trips, carrying no places', () => {
  const url = share.makeAskUrl({ from: 'Ada', q: 'wine bars in lisbon' });
  globalThis.location.hash = url.slice(url.indexOf('#'));
  const back = share.parseShareHash();
  assert.equal(back.kind, 'ask');
  assert.equal(back.from, 'Ada');
  assert.equal(back.q, 'wine bars in lisbon');
  assert.equal(back.places, undefined);
});

test('a folio link round-trips with its places intact', () => {
  const url = share.makeFolioUrl({
    title: 'Milan', dedication: 'for you', author: 'Ada',
    tags: [{ id: 't1', name: 'wine', hue: 12, color: '#8A3B47' }],
    places: [{ id: 'p1', name: 'Enoteca', lat: 45.46, lng: 9.19, tags: ['t1'], status: 'visited', rating: 5 }],
  });
  globalThis.location.hash = url.slice(url.indexOf('#'));
  const back = share.parseShareHash();
  assert.equal(back.kind, 'folio');
  assert.equal(back.places.length, 1);
  assert.equal(back.places[0].name, 'Enoteca');
});

test('a payload that is not an atlas is refused', () => {
  globalThis.location.hash = '#m=' + globalThis.LZString.compressToEncodedURIComponent('null');
  assert.equal(share.parseShareHash(), null);
  globalThis.location.hash = '#m=notcompressedatall';
  assert.equal(share.parseShareHash(), null);
  globalThis.location.hash = '';
  assert.equal(share.parseShareHash(), null);
});

test('the evidence lines escape a hostile tag name', async () => {
  const { evidenceLines } = await import('../js/kinship.js?v=test');
  const lines = evidenceLines({
    common: [], loved: 0, alignment: 0.9, alignedTags: ['<img src=x onerror=alert(1)>'],
    expansionTags: ['<script>bad</script>'], picks: [{ expands: true }],
  }, '<b>Ada</b>');
  const all = lines.join(' ');
  assert.ok(!all.includes('<img'), 'an img tag survived into the evidence');
  assert.ok(!all.includes('<script'), 'a script tag survived into the evidence');
  assert.ok(all.includes('&lt;img'), 'the hostile name should appear as text');
});

// The commonest arrival there is: a friend hands their atlas to somebody who
// has never used this. Every rung of the lexicon is a claim about two atlases,
// and against an empty one the score is counted from an empty set, lands at
// zero and comes out `distant`. That was the first word this app said about
// somebody's friend, printed huge under their name, counted from nothing.
test('a reader with no atlas is not judged distant from anybody', async () => {
  const { resonance, verdict, evidenceLines } = await import('../js/kinship.js?v=test');
  const theirs = {
    places: [
      { id: 'a', name: 'A', lat: 47, lng: 7, city: 'Basel', status: 'visited', tags: ['t1'] },
      { id: 'b', name: 'B', lat: 48, lng: 8, city: 'Berlin', status: 'wishlist', tags: ['t1'] },
    ],
    tags: [{ id: 't1', name: 'Coffee' }],
  };
  const r = resonance({ places: [], tags: [] }, theirs);
  assert.equal(r.mySize, 0, 'the reading has to know how much the reader keeps');
  assert.equal(verdict(r).word, '', 'an empty atlas was given a kinship word');

  const lines = evidenceLines(r, 'Ada');
  assert.equal(lines.length, 1, 'nothing countable should be counted against nothing');
  assert.ok(lines[0].includes('atlas is empty'), `the true sentence is missing: ${lines[0]}`);
  assert.ok(!lines.join(' ').includes('no overlaps yet'),
    'an atlas that does not exist was told it has no overlaps');

  // and a reader who keeps something still gets the whole lexicon
  const held = resonance({ places: [theirs.places[0]], tags: theirs.tags }, theirs);
  assert.equal(held.mySize, 1);
  assert.ok(verdict(held).word, 'a real comparison lost its word');
});

// ---------- the shared protocol ----------

const schema = await import('../js/schema.js?v=test');

// ---------- one constructor, four kinds ----------
//
// The claim of the payload constructor is not that it is tidier. It is that
// what a person hands over cannot depend on which carrier it left by, and the
// second carrier now exists: js/letters.js seals bytes. So these tests bind
// the three lists that have to agree — the kinds letters.js can seal, the
// kinds share.js can build, the kinds schema.js can read — and then check the
// only thing that matters, which is that the letter and the link arrive
// carrying the same object.

const letters = await import('../js/letters.js?v=test');

test('every kind a letter can seal is a kind that can be built and read', async () => {
  // A kind in one list and not another is not a tidiness problem. A letter of
  // a kind share.js cannot build is a letter nobody can compose; a letter of
  // a kind schema.js will not read is one that arrives sealed correctly and
  // is refused at the gate, which is the worse of the two because the sender
  // is told it went.
  const parts = {
    atlas: { places: [{ id: 'p1', name: 'Kind Sentinel', lat: 47.5, lng: 7.6, status: 'visited', tags: [] }], tags: [], author: 'ada' },
    folio: { title: 'Basel', dedication: 'for you', places: [{ id: 'p1', name: 'Kind Sentinel', lat: 47.5, lng: 7.6, status: 'visited', tags: [] }], tags: [], author: 'ada' },
    ask: { from: 'ada', q: 'wine bars in lisbon' },
    thanks: { from: 'ada', pid: 'p1', name: 'Kind Sentinel', at: { lat: 47.5, lng: 7.6 }, when: '2026-08-16' },
    intro: { from: 'ada', pub: 'B' + 'A'.repeat(86),
      cap: '9c7k2m4n6p8q0r2s4t6v8w0x2y.a1b3c5d7e9f0g2h4j5k6m7n8p9' },
  };
  for (const kind of Object.keys(letters.KINDS)) {
    assert.ok(parts[kind], `letters.js can seal a ${kind} and nothing here knows how to build one`);
    const built = share.buildPayload(kind, parts[kind]);
    assert.equal(built.kind, kind, `buildPayload was asked for a ${kind} and made something else`);
    const read = schema.normPayload(built);
    assert.ok(read, `a ${kind} built here is refused at the gate`);
    assert.equal(read.kind, kind, `a ${kind} changed kind between the builder and the gate`);
  }
  // and every kind that can be built can be read, which is the other
  // direction and the one a new kind is likeliest to break
  for (const kind of Object.keys(parts)) {
    const read = schema.normPayload(share.buildPayload(kind, parts[kind]));
    assert.ok(read, `share.js builds a ${kind} and the gate refuses it`);
  }
});

test('an introduction is built and read and never sealed, and that is the protocol', () => {
  // The one asymmetry, and it is load-bearing. Opening a letter is mode
  // `auth`: decapsulation needs the sender's static public key, and on a first
  // contact the recipient does not have it. An introduction that could be
  // sealed would therefore have to travel in mode `base`, which is an
  // unauthenticated letter in a box from anyone at all, claiming to be
  // someone. So it travels as a link in both directions and the box never
  // carries a stranger, and this test is what stops a later hand from adding
  // `intro` to letters.KINDS because the list looked incomplete.
  assert.equal('intro' in letters.KINDS, false,
    'letters.js can now seal an introduction, which means the box takes strangers');
  const built = share.buildPayload('intro', { from: 'ada', pub: 'B' + 'A'.repeat(86),
    cap: '9c7k2m4n6p8q0r2s4t6v8w0x2y.a1b3c5d7e9f0g2h4j5k6m7n8p9' });
  assert.ok(schema.normPayload(built), 'and it is still a payload a link can carry');
  assert.equal(built.v, 7, 'an introduction declares the version that refuses it over there');
});

test('an introduction pasted and an introduction tapped go through one gate', () => {
  // The two roads a link travels. Tapping it puts it in the address bar;
  // pasting it puts it in a field, because half the apps a link arrives in
  // will not make it tappable. Those used to be able to become two readers,
  // and a second reader is a second place a payload is normalised, which is a
  // second place it can stop being.
  //
  // A well-formed link would prove nothing here: two readers that both parse
  // the same JSON agree perfectly on it. So the link is one somebody built by
  // hand, carrying a field the gate does not know and a byline past the bound,
  // and the assertions are about what came off it rather than about the two
  // roads matching each other.
  const packed = globalThis.LZString.compressToEncodedURIComponent(JSON.stringify({
    v: 7, kind: 'intro', from: 'a'.repeat(400), pub: 'B' + 'A'.repeat(86),
    cap: '9c7k2m4n6p8q0r2s4t6v8w0x2y.a1b3c5d7e9f0g2h4j5k6m7n8p9',
    andAlso: '<img src=x onerror=alert(1)>',
  }));
  globalThis.location.hash = `#m=${packed}`;
  const tapped = share.parseShareHash();
  const pasted = share.readPayload(packed);
  globalThis.location.hash = '';
  assert.deepEqual(pasted, tapped, 'a pasted link and a tapped link read differently');
  for (const [road, got] of [['tapped', tapped], ['pasted', pasted]]) {
    assert.equal(got.kind, 'intro');
    assert.equal(got.pub, 'B' + 'A'.repeat(86));
    assert.equal('andAlso' in got, false, `a field the gate never named survived a ${road} link`);
    assert.ok(got.from.length < 400, `a byline past every bound survived a ${road} link`);
  }
  // and the same refusals, because it is the same function underneath
  assert.equal(share.readPayload('notcompressedatall'), null);
  assert.equal(share.readPayload(globalThis.LZString.compressToEncodedURIComponent('null')), null);
  assert.equal(share.readPayload(''), null);
  assert.equal(share.readPayload(undefined), null);
});

test('a letter and a link carry the same object', async () => {
  // This is the whole of it. Before there was one constructor, a sealer
  // written against the disclosure builder would have sealed an atlas where a
  // folio travels and nothing at all where a thanks travels, because three of
  // the four kinds were assembled inside the function that made the URL.
  const a = await letters.generateKeyPair();
  const b = await letters.generateKeyPair();
  const parts = { from: 'ada', pid: 'p1', name: 'Kind Sentinel', at: { lat: 47.5, lng: 7.6 }, when: '2026-08-16' };

  const payload = share.buildPayload('thanks', parts);
  const wire = await letters.sealLetter({ kind: 'thanks', to: b.publicKey, from: a, payload });
  const opened = await letters.openLetter(wire, { me: b, from: a.publicKey });

  const url = share.makeThanksUrl(parts);
  globalThis.location.hash = url.slice(url.indexOf('#'));
  const byLink = share.parseShareHash();

  assert.deepEqual(schema.normPayload(opened.payload), byLink,
    'a thanks that arrived by letter is not the thanks that arrives by link');
  globalThis.location.hash = '';
});

test('the carrier is the only difference between a link and a file', () => {
  // `forLink` is the one honest difference and it is an option on the
  // constructor rather than a fact about a kind, so a letter, which is
  // neither an address bar nor a file, can ask for either.
  const places = [{ id: 'p_long', name: 'Diet Sentinel', lat: 47.123456789, lng: 8.987654321, status: 'visited', tags: [], note: '' }];
  const link = share.buildPayload('atlas', { places, tags: [], author: 'ada' }, { forLink: true });
  const file = share.buildPayload('atlas', { places, tags: [], author: 'ada' });
  assert.equal(link.places[0].lat, 47.12346, 'the link kept more than a metre');
  assert.equal(file.places[0].lat, 47.123456789, 'the file lost precision it had no reason to lose');
  assert.equal('note' in link.places[0], false, 'an empty note travelled in a link');
  assert.equal(file.places[0].note, '', 'the file dropped a field the link diet alone may drop');
});

test('share.js hands out one payload constructor and one carrier', () => {
  // The whole export list, not a spot check. The disclosure builder is the
  // body of an atlas rather than a payload: it decides what leaves, it used
  // to be reachable from anywhere, and that is how three of the four kinds
  // came to be assembled by hand next to the function that made the URL. A
  // list that names every export goes red when a second door opens, whatever
  // the second door is called.
  assert.deepEqual(Object.keys(share).sort(), [
    'buildPayload', 'clearShareHash', 'disclosureCounts',
    'makeAskUrl', 'makeFolioUrl', 'makeIntroUrl', 'makeShareUrl', 'makeThanksUrl',
    'packPayload', 'parseShareHash', 'readPayload',
  ], 'share.js grew or lost an export: a payload has one builder and one carrier');
});

test('a kind nobody here can build is refused rather than guessed at', () => {
  assert.throws(() => share.buildPayload('invoice', {}), /no payload of kind invoice/);
  assert.throws(() => share.buildPayload('', {}), /no payload of kind/);
  assert.throws(() => share.buildPayload(undefined, {}), /no payload of kind/);
});

test('a payload naming a kind this build cannot read is refused, not renamed', () => {
  // It used to fall through to 'atlas': the sender's own word was discarded
  // without a sentence and whatever it carried was offered to a person as
  // though an atlas had been meant.
  const place = { id: 'p1', name: 'Kind Sentinel', lat: 47.5, lng: 7.6, status: 'visited', tags: [] };
  assert.equal(schema.normPayload({ v: 6, kind: 'invoice', places: [place], routes: [], tags: [] }), null);
  assert.equal(schema.normPayload({ v: 6, kind: 'ATLAS', places: [place], routes: [], tags: [] }), null);
  assert.equal(schema.normPayload({ v: 6, kind: 7, places: [place], routes: [], tags: [] }), null);
  // and a link written before the protocol had kinds is still a whole atlas
  const old = schema.normPayload({ places: [place], routes: [], tags: [] });
  assert.ok(old, 'a link from before there were kinds was refused');
  assert.equal(old.kind, 'atlas');
  assert.equal(old.v, 1);
});

test('a payload without a kind it can satisfy is refused', () => {
  assert.equal(schema.normPayload(null), null);
  assert.equal(schema.normPayload('atlas'), null);
  assert.equal(schema.normPayload({ kind: 'atlas', places: [] }), null);
  assert.equal(schema.normPayload({ kind: 'folio', title: '', places: [{ lat: 1, lng: 1 }] }), null);
  assert.equal(schema.normPayload({ kind: 'ask', q: '   ' }), null);
});

test('a place off the globe is not a place', () => {
  assert.equal(schema.normPlace({ lat: 91, lng: 0 }), null);
  assert.equal(schema.normPlace({ lat: 0, lng: 181 }), null);
  assert.equal(schema.normPlace({ lat: 'x', lng: 0 }), null);
  assert.equal(schema.normPlace({ lat: NaN, lng: 0 }), null);
  assert.ok(schema.normPlace({ lat: -89.9, lng: 179.9 }));
});

test('malformed places are dropped, not carried into a crash', () => {
  const p = schema.normPayload({
    kind: 'atlas',
    places: [null, 'nope', { lat: 1, lng: 1, name: 'real' }, { lat: 999, lng: 1 }],
    tags: [null, 7, { name: 'wine' }],
  });
  assert.equal(p.places.length, 1);
  assert.equal(p.places[0].name, 'real');
  assert.equal(p.tags.length, 1);
  // every place has an array of tags, so tags.map can never throw downstream
  assert.ok(p.places.every(x => Array.isArray(x.tags)));
});

test('the payload is bounded, however long the link', () => {
  const many = Array.from({ length: 5000 }, (_, i) => ({ lat: 1, lng: i / 1000, name: 'x' }));
  const p = schema.normPayload({ kind: 'atlas', places: many });
  assert.equal(p.places.length, schema.LIMITS.places);
  const long = schema.normPlace({ lat: 1, lng: 1, name: 'n'.repeat(9999), note: 'x'.repeat(99999) });
  assert.equal(long.name.length, schema.LIMITS.name);
  assert.equal(long.note.length, schema.LIMITS.note);
});

test('a prototype cannot be poisoned through a link', () => {
  const p = schema.normPayload(JSON.parse('{"kind":"atlas","places":[{"lat":1,"lng":1,"__proto__":{"pwned":true}}]}'));
  assert.equal({}.pwned, undefined);
  assert.equal(Object.prototype.pwned, undefined);
  assert.equal(p.places[0].pwned, undefined);
});

test('a javascript url never survives as a link', () => {
  assert.equal(schema.normPlace({ lat: 1, lng: 1, url: 'javascript:alert(1)' }).url, '');
  assert.equal(schema.normPlace({ lat: 1, lng: 1, url: 'data:text/html,x' }).url, '');
  assert.equal(schema.normPlace({ lat: 1, lng: 1, url: 'https://ok.test/x' }).url, 'https://ok.test/x');
});

test('no photograph reaches the atlas, whatever the file says', () => {
  const p = schema.normPlace({ lat: 1, lng: 1, photos: ['data:image/png;base64,AAA', 'https://x.test/a.png', 42] });
  assert.equal('photos' in p, false, 'no picture reaches the atlas at all now');
  // no witness is passed here, which pins the other half: a read with nobody
  // watching strips in silence, and only an own archive is ever told
  assert.equal(JSON.stringify(p).includes('data:image/'), false);
});

// ---------- ways ----------

const route = await import('../js/route.js?v=test');

test('the line keeps its shape and loses its noise', () => {
  // a straight run with jitter: most points say nothing and should go
  const pts = [];
  for (let i = 0; i <= 200; i++) {
    pts.push({ lat: 46 + i * 0.0002, lng: 8 + (i % 2 ? 0.000004 : -0.000004), ele: 1000 + i });
  }
  const s = route.simplify(pts, 0.012);
  assert.ok(s.length < pts.length / 5, `expected heavy thinning, got ${s.length} of ${pts.length}`);
  assert.deepEqual(s[0], pts[0]);
  assert.deepEqual(s[s.length - 1], pts[pts.length - 1]);
});

test('thinning the line does not flatten the climb', () => {
  // a walk up to a col and down the other side: simplifying from above must
  // not lose the summit, which is what makes a walk what it is
  const pts = [];
  for (let i = 0; i <= 900; i++) {
    const t = i / 900;
    const ele = t < 0.55
      ? 1180 + (2260 - 1180) * Math.pow(t / 0.55, 1.15)
      : 2260 - (2260 - 1420) * Math.pow((t - 0.55) / 0.45, 0.9);
    pts.push({ lat: 46 + i * 0.0002, lng: 8 + i * 0.00021, ele });
  }
  const full = route.measure(pts);
  const thin = route.measure(route.simplify(pts, 0.012));
  assert.ok(thin.length !== 0);
  assert.ok(Math.abs(thin.high - full.high) <= 5, `summit lost: ${thin.high} vs ${full.high}`);
  assert.ok(Math.abs(thin.ascent - full.ascent) / full.ascent < 0.08,
    `climb flattened: ${thin.ascent} vs ${full.ascent}`);
  assert.ok(Math.abs(thin.km - full.km) / full.km < 0.02, `distance drifted: ${thin.km} vs ${full.km}`);
});

test('a climb is measured, and a barometer twitch is not', () => {
  // 100 steps up 5 m each, with one metre of noise on every reading
  const pts = [];
  for (let i = 0; i <= 100; i++) {
    pts.push({ lat: 46 + i * 0.0009, lng: 8, ele: 1000 + i * 5 + (i % 2 ? 1 : -1) });
  }
  const m = route.measure(pts);
  assert.ok(m.km > 9 && m.km < 11, `distance ${m.km}`);
  assert.ok(Math.abs(m.ascent - 500) < 40, `ascent ${m.ascent} should be near 500`);
  assert.ok(m.descent < 40, `descent ${m.descent} should be near nothing`);
  // the summit is what the instrument read, not a peak flattened by smoothing
  assert.ok(Math.abs(m.high - 1500) <= 2, `high ${m.high} should be the real summit`);
  assert.ok(Math.abs(m.low - 1000) <= 2, `low ${m.low}`);
  assert.ok(m.hours > 0 && m.hours < 24);
  assert.equal(m.loop, false);
});

test('a loop knows it is a loop', () => {
  const pts = [];
  for (let i = 0; i <= 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    pts.push({ lat: 46 + Math.sin(a) * 0.01, lng: 8 + Math.cos(a) * 0.01, ele: 800 });
  }
  assert.equal(route.measure(pts).loop, true);
});

test('a line survives being carried in a link', () => {
  const pts = [
    { lat: 46.5721, lng: 8.0034, ele: 1204 },
    { lat: 46.5799, lng: 8.0121, ele: 1388 },
    { lat: 46.5844, lng: 8.0203, ele: 1502 },
  ];
  const back = route.decodePath(route.encodePath(pts));
  assert.equal(back.length, 3);
  back.forEach((p, i) => {
    assert.ok(Math.abs(p.lat - pts[i].lat) < 1e-5, `lat ${p.lat}`);
    assert.ok(Math.abs(p.lng - pts[i].lng) < 1e-5, `lng ${p.lng}`);
    assert.equal(p.ele, pts[i].ele);
  });
});

test('an encoded line is far smaller than the points it stands for', () => {
  const pts = Array.from({ length: 800 }, (_, i) => ({ lat: 46 + i * 0.0001, lng: 8 + i * 0.0001, ele: 1000 + (i % 60) }));
  const enc = route.encodePath(pts);
  assert.ok(enc.length < JSON.stringify(pts).length / 6,
    `encoded ${enc.length} vs json ${JSON.stringify(pts).length}`);
});

test('a hostile line is refused like anything else from outside', () => {
  assert.equal(schema.normRoute({ path: [{ lat: 1, lng: 1 }] }), null, 'one point is not a way');
  assert.equal(schema.normRoute({ path: 'nope' }), null);
  assert.equal(schema.normRoute(null), null);
  const r = schema.normRoute({
    path: [{ lat: 1, lng: 1 }, { lat: 99, lng: 1 }, { lat: 2, lng: 2 }],
    name: 'x'.repeat(999), url: 'javascript:alert(1)', rating: 1e9, km: 1e12,
  });
  assert.equal(r.path.length, 2, 'the off-globe point is dropped');
  assert.equal(r.url, '');
  assert.equal(r.rating, 5);
  assert.ok(r.km <= 100000);
});

test('an atlas link carries no diary of when', () => {
  const url = share.makeShareUrl(
    [{ id: 't1', name: 'Wine', hue: 12 }],
    [{ id: 'p1', name: 'Septime', lat: 48.85, lng: 2.38, tags: ['t1'], status: 'visited',
       rating: 5, note: 'book ahead', url: '', address: '', city: 'Paris', country: 'France',
       countryCode: 'fr', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z' }],
    'Ada', []);
  location.hash = new URL(url).hash;
  const back = share.parseShareHash();
  assert.ok(back && back.places.length === 1, 'the link round-trips');
  const raw = JSON.stringify(back.places[0]);
  assert.ok(!raw.includes('2024-01-01'), 'no created date travels');
  assert.ok(!raw.includes('2026-08-01'), 'no updated date travels');
});

test('a way in a link is bounded', () => {
  const many = Array.from({ length: 9000 }, (_, i) => ({ lat: 46 + i * 1e-5, lng: 8 }));
  const r = schema.normRoute({ path: many });
  assert.equal(r.path.length, schema.LIMITS.routePoints);
});


test('a place keeps its whole road, not only its last carrier', () => {
  // Ana found it, Mira passed it on, and it reaches a third atlas
  const fromMira = schema.normPlace({
    name: 'Septime', lat: 48.85, lng: 2.38,
    prov: [{ name: 'Ana', at: '2026-01-01' }, { name: 'Mira', at: '2026-06-01' }],
  });
  assert.equal(fromMira.provenance.name, 'Mira', 'the last hand is the one that gave it to you');
  assert.deepEqual(fromMira.provenance.chain.map(h => h.name), ['Ana'], 'and Ana is not forgotten');
});

test('the road is bounded, however long the journey', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ name: `Carrier ${i}`, at: '2026-01-01' }));
  const p = schema.normPlace({ name: 'Much travelled', lat: 46, lng: 8, prov: many });
  assert.ok(p.provenance.chain.length <= 4, 'four before the last, five in all');
  assert.equal(p.provenance.name, 'Carrier 11');
});

test('a hostile road is filtered rather than trusted', () => {
  const p = schema.normPlace({
    name: 'Suspect', lat: 46, lng: 8,
    prov: [{ name: '' }, 'not an object', { name: 'x'.repeat(500) }, { name: 'Real' }],
  });
  const names = [...p.provenance.chain.map(h => h.name), p.provenance.name];
  assert.ok(names.every(n => n && n.length <= 60), names.join('|'));
});

// ---------- common ground speaks the app's own two words ----------
//
// "you both love" stood in the evidence line and claimed a feeling nobody
// recorded. What an atlas actually says is been-and-kept or want-to-go, and
// the line now says exactly that, with a third clause for pairs split
// between the words, so the count always adds up to the ground.

test('the evidence line distinguishes been-and-kept from want-to-go', async () => {
  const { resonance, evidenceLines } = await import('../js/kinship.js?v=test2');
  const mine = {
    tags: [],
    places: [
      { id: 'a', name: 'Both Been', lat: 46, lng: 8, status: 'visited', tags: [] },
      { id: 'b', name: 'Both Want', lat: 47, lng: 9, status: 'wishlist', tags: [] },
      { id: 'c', name: 'Split Pair', lat: 48, lng: 10, status: 'visited', tags: [] },
    ],
  };
  const theirs = {
    tags: [],
    places: [
      { id: 'x', name: 'Both Been', lat: 46, lng: 8, status: 'visited', tags: [] },
      { id: 'y', name: 'Both Want', lat: 47, lng: 9, status: 'wishlist', tags: [] },
      { id: 'z', name: 'Split Pair', lat: 48, lng: 10, status: 'wishlist', tags: [] },
    ],
  };
  const r = resonance(mine, theirs);
  assert.equal(r.common.length, 3);
  assert.equal(r.loved, 1, 'been-and-kept counted wrong');
  assert.equal(r.wanted, 1, 'want-to-go counted wrong');

  const line = evidenceLines(r, 'Marta')[0];
  // the atlas has exactly two words, and the line uses them and no others:
  // both went, both want, and the split pair named by who did which
  assert.equal(line,
    '<b>1</b> you both went \u00b7 <b>1</b> you both want to go \u00b7 <b>1</b> you went, Marta wants to go',
    'the line is not spoken in the two words');
  assert.equal(/love|hold|atlases/.test(line), false, 'jargon crept back into the evidence');

  // the other split direction, and the nameless fallback
  const theirLead = resonance(
    { tags: [], places: [{ id: 'c', name: 'Split Pair', lat: 48, lng: 10, status: 'wishlist', tags: [] }] },
    { tags: [], places: [{ id: 'z', name: 'Split Pair', lat: 48, lng: 10, status: 'visited', tags: [] }] });
  assert.equal(evidenceLines(theirLead, 'Marta')[0], '<b>1</b> Marta went, you want to go');
  assert.equal(evidenceLines(theirLead, '')[0], '<b>1</b> they went, you want to go');

  // one bucket alone stands alone, with no dangling clauses
  const wantOnly = resonance(
    { tags: [], places: [{ id: 'b', name: 'Both Want', lat: 47, lng: 9, status: 'wishlist', tags: [] }] },
    { tags: [], places: [{ id: 'y', name: 'Both Want', lat: 47, lng: 9, status: 'wishlist', tags: [] }] });
  assert.equal(evidenceLines(wantOnly, '')[0], '<b>1</b> you both want to go');
});

// ---------- books on a link: the conditional stamp ----------
//
// The version a payload declares is decided by its own contents. These four
// pin both directions at the builder, because the gate's half of the claim
// (in test/schema.test.mjs) cannot see what the builder chose to write.

const stampPlace = { id: 'p1', name: 'Sentinel', lat: 46.1, lng: 8.1, tags: [] };
const stampBook = (over = {}) => ({ id: 'b1', title: 'A Moveable Feast', author: 'Ernest Hemingway',
  year: '1964', placeId: '', tags: [], status: 'wishlist', note: '', url: '', ...over });

test('a bookless payload declares the number every shipped build already reads', () => {
  const atlas = share.buildPayload('atlas', { places: [stampPlace], routes: [], tags: [] }, { forLink: true });
  assert.equal(atlas.v, 6);
  const folio = share.buildPayload('folio', { title: 'T', places: [stampPlace], routes: [], tags: [] }, { forLink: true });
  assert.equal(folio.v, 6);
});

test('a payload carrying books announces the number an older build refuses out loud', () => {
  const atlas = share.buildPayload('atlas', { places: [], routes: [], books: [stampBook()], tags: [] }, { forLink: true });
  assert.equal(atlas.v, 8);
  const folio = share.buildPayload('folio', { title: 'T', places: [], routes: [], books: [stampBook()], tags: [] }, { forLink: true });
  assert.equal(folio.v, 8);
  // and the stamp is the same claim off the link as on it: the file is the
  // same disclosure, so the same rule decides its number
  const file = share.buildPayload('atlas', { places: [], routes: [], books: [stampBook()], tags: [] });
  assert.equal(file.v, 8);
});

test('a book\u2019s tie travels only beside the place it names', () => {
  const tied = stampBook({ placeId: 'p1' });
  const with_ = share.buildPayload('atlas', { places: [stampPlace], books: [tied], routes: [], tags: [] }, { forLink: true });
  assert.equal(with_.books[0].placeId, 'p1');
  // the place stayed home: its id is a pointer to something withheld, and a
  // disclosure does not carry pointers to what it withheld. checked on the
  // wire shape, because that is what the recipient actually receives.
  const without = JSON.parse(JSON.stringify(
    share.buildPayload('atlas', { places: [], books: [tied], routes: [], tags: [] })));
  assert.equal('placeId' in without.books[0], false);
});

test('a shelf rides the whole trip: built, packed, read back, road and all', () => {
  const book = stampBook({
    placeId: 'p1', note: 'the caf\u00e9 pages', url: 'https://example.test/feast',
    provenance: { chain: [{ name: 'Ada', at: '2024-05-01' }], name: 'L\u00e9a', sig: 40,
      adoptedAt: '2026-02-11', srcId: 'their_secret_id_9' },
  });
  const url = share.makeShareUrl([], [stampPlace], 'Marta', [], [book]);
  globalThis.location.hash = url.slice(url.indexOf('#'));
  const back = share.parseShareHash();
  assert.ok(back, 'this build must read what it just wrote');
  assert.equal(back.v, 8);
  assert.equal(back.books.length, 1);
  const b = back.books[0];
  assert.equal(b.title, 'A Moveable Feast');
  assert.equal(b.year, '1964');
  assert.equal(b.placeId, 'p1');
  assert.equal(b.note, 'the caf\u00e9 pages');
  // the road arrived rebuilt, the sender\u2019s last hand as the byline
  assert.equal(b.provenance.name, 'L\u00e9a');
  assert.deepEqual(b.provenance.chain, [{ name: 'Ada', at: '2024-05-01' }]);
  // and the id the book wore in the sender\u2019s atlas never left home
  const packed = url.slice(url.indexOf('#m=') + 3);
  const raw = LZString.decompressFromEncodedURIComponent(packed);
  assert.ok(!raw.includes('srcId'), 'srcId is local bookkeeping and must never travel');
  assert.ok(!raw.includes('their_secret_id_9'));
});
