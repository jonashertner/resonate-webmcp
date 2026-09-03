// share.js — the whole map compressed into a URL hash; no backend

/* global LZString */

import { normPayload, KIND_VERSION, BOOKS_RIDE_AT, LIMITS } from './schema.js?v=rf158';
import { encodePath, simplify } from './route.js?v=rf158';

// ---------- one payload ----------
//
// Four kinds travel from this app and until now only two of them were built
// by the thing that decides what leaves. An atlas and a folio went through
// buildDisclosure; an ask and a thanks were assembled inline, one object
// literal each, in the function that also made the URL. That was invisible
// while the only carrier was a link, because the URL and the payload were
// written in the same breath. It stops being invisible the moment a second
// carrier exists: a sealer written against buildDisclosure seals an atlas
// where a folio travels and nothing at all where a thanks travels, and the
// header below has been promising since it was written that "anything later
// (a code, a relay) encodes the same object".
//
// So: one constructor, four kinds, and the carrier is a separate act. What
// goes into a letter and what goes into a link are the same object built by
// the same function, and the only difference between them is `forLink`, which
// is named on the surface and is about the width of an address bar.
//
// The kinds are exactly the kinds js/schema.js can read, and four of the five
// are what js/letters.js can seal; a test binds all three lists together,
// because a kind that one of them knows and another does not is a letter that
// arrives and cannot be opened, or a link that opens onto nothing.
//
// The version each kind declares comes from the table in js/schema.js and not
// from the highest number this build can read. Those are different claims, and
// writing the reading ceiling onto every payload would make an atlas that has
// not changed since 6 announce itself as unreadable to every build shipped
// since 6. The one exception is stamped by the disclosure itself: an atlas or
// a folio that carries books declares BOOKS_RIDE_AT, because a shelf is
// invisible to older readers and the honest refusal beats the silent drop.
// The argument lives beside that constant in js/schema.js.
export function buildPayload(kind, parts = {}, { forLink = false } = {}) {
  // An introduction: a public key and an address, and a name to recognise.
  // Built here rather than beside the surface that sends it, for the reason
  // this whole file exists: what leaves is decided in one place, and an
  // introduction is the one payload where a field added carelessly would be a
  // field added to an identity.
  if (kind === 'intro') {
    return {
      v: KIND_VERSION.intro,
      kind: 'intro',
      from: String(parts.from || '').slice(0, 60),
      pub: String(parts.pub || ''),
      cap: String(parts.cap || ''),
    };
  }

  if (kind === 'ask') {
    return {
      v: KIND_VERSION.ask,
      kind: 'ask',
      from: String(parts.from || '').slice(0, 60),
      q: String(parts.q || '').slice(0, LIMITS.asking),
    };
  }

  // a thanks: one heart, for one place, carried back the way everything
  // travels here. the recipient of a folio presses it beside the place that
  // earned it; the sender opens it and the heart settles onto the record. it
  // names the place three ways (the sender's own id, the name, the point) so
  // it can land even where the road lost one of them.
  if (kind === 'thanks') {
    const at = parts.at;
    return {
      v: KIND_VERSION.thanks,
      kind: 'thanks',
      from: String(parts.from || '').slice(0, 60),
      pid: String(parts.pid || '').slice(0, 140),
      name: String(parts.name || '').slice(0, 140),
      at: at && Number.isFinite(at.lat) && Number.isFinite(at.lng)
        ? { lat: at.lat, lng: at.lng } : null,
      when: String(parts.when || '').slice(0, 40),
    };
  }

  if (kind !== 'atlas' && kind !== 'folio') {
    throw new Error(`there is no payload of kind ${kind}`);
  }

  const atlas = buildDisclosure({
    places: parts.places, routes: parts.routes, books: parts.books,
    tags: parts.tags, author: parts.author, forLink,
  });
  if (kind === 'atlas') return atlas;

  // a folio: a composed slice with a title and a dedication — the atomic
  // recommendation. It is the same disclosure under a title, and it is built
  // from the same call above for the reason that has always been written
  // here: a field that would leak from an atlas leaks from a folio too. Its
  // tags are the disclosure's own and never a second mapping, or a folio
  // would point every place at tag references the link no longer carries,
  // now that link tags travel as t0, t1.
  return {
    ...atlas,
    // the same conditional stamp the disclosure just made, in folio numbers:
    // spreading the atlas would keep its verdict but lose the kind's own
    // number on a bookless folio
    v: atlas.books.length ? BOOKS_RIDE_AT : KIND_VERSION.folio,
    kind: 'folio',
    title: String(parts.title || '').slice(0, 80),
    dedication: String(parts.dedication || '').slice(0, 140),
  };
}

export function makeFolioUrl({ title, dedication, author, tags, places, routes = [], books = [] }) {
  return packPayload(buildPayload('folio',
    { title, dedication, author, tags, places, routes, books }, { forLink: true }));
}

export function makeThanksUrl({ from, pid, name, at, when }) {
  return packPayload(buildPayload('thanks', { from, pid, name, at, when }));
}

// an ask: a request-letter — the recipient's atlas pre-composes the reply
export function makeAskUrl({ from, q }) {
  return packPayload(buildPayload('ask', { from, q }));
}

// an introduction: the one thing that cannot arrive as a letter, because
// opening a letter needs the sender's key and this is how it is first learned
export function makeIntroUrl({ from, pub, cap }) {
  return packPayload(buildPayload('intro', { from, pub, cap }));
}

// ---------- one disclosure ----------
//
// What the recipient gets must not depend on how it reached them.
//
// The link was an explicit field list. The file was a spread of whole records
// plus every tag in the atlas, and it sat under the same review panel and the
// same sentence. So "send it as a file" quietly added the creation and update
// dates of every place, the tags a person had never used or had used only
// on places that never leave, and any field a future release happened to add
// to a record. The preview described the link. The file was something else.
//
// buildDisclosure is now the only thing that decides what leaves. The link
// encodes it, the file writes it, and anything later (a code, a relay) encodes
// the same object. Transport may change the shape of the carrier. It may not
// change what the person on the other end receives.
//
// The one honest difference is geometry: a link has to fit in an address bar,
// so a way in a link is coarser. That difference is named on the surface
// rather than hidden, and `wayPoints` says which of the two this object is.
//
// It is not exported. Everything outside this file asks buildPayload for a
// payload of a named kind, so there is one door rather than two, and no
// caller can build the body of an atlas while forgetting which kind it is.
function buildDisclosure({ places = [], routes = [], books = [], tags = [], author = '', forLink = false } = {}) {
  // The link diet, three honest levers, none of which changes what the
  // recipient receives at the gate. A missing field and an empty one arrive
  // as the same value from normPayload, so a link carries no empty strings,
  // no zero rating, no empty lists. Coordinates in a link are rounded to five
  // decimals, about a metre, which extends the sentence the surface already
  // says about paths: a link is coarser than the file. And tag ids, which are
  // payload-internal references and nothing more, travel as t0, t1 rather
  // than as twelve incompressible characters each. Place ids are never
  // remapped: they are the rail a thanks travels back on.
  const r5 = (n) => (forLink ? Math.round(n * 1e5) / 1e5 : n);
  // zero is empty for a rating or a climb; it is a coordinate on the
  // equator. the two keys where zero is a place on earth are exempt, or a
  // record at 0 latitude would arrive at the gate without one and be refused.
  const keepZero = new Set(['lat', 'lng']);
  const slim = forLink
    ? (o) => Object.fromEntries(Object.entries(o).filter(([k, v]) =>
      v !== '' && v !== undefined && !(v === 0 && !keepZero.has(k))
      && !(Array.isArray(v) && !v.length)))
    : (o) => o;
  const tagId = forLink
    ? new Map(tags.map((t, i) => [t.id, `t${i}`]))
    : null;
  const retag = (ids) => (tagId ? (ids || []).map(id => tagId.get(id) || id) : ids);
  // a book's tie travels only when the place it names travels in the same
  // payload. the id of a place a person chose not to hand over is a pointer
  // to something withheld, and a disclosure does not carry pointers to what
  // it withheld.
  const carried = new Set(places.map(p => p.id));

  return {
    // the conditional stamp: carrying books announces the number that makes
    // an older build refuse the whole payload out loud rather than open it
    // and drop the shelf in silence. carrying none, the shape is the one
    // every shipped build already reads, and it says so.
    v: books.length ? BOOKS_RIDE_AT : KIND_VERSION.atlas,
    kind: 'atlas',
    author: String(author || '').slice(0, 60),
    // only the tags these records actually use: an unused tag, or one
    // used solely on a place that never leaves, has no business travelling
    tags: tags.map(t => slim({ id: tagId ? tagId.get(t.id) : t.id, name: t.name, emoji: t.emoji, color: t.color, hue: t.hue })),
    // an explicit field list, because a record may grow a field that a link
    // must not carry. nothing travels that is not named here.
    places: places.map(p => slim({
      id: p.id, name: p.name, lat: r5(p.lat), lng: r5(p.lng),
      address: p.address, city: p.city, country: p.country, countryCode: p.countryCode,
      tags: retag(p.tags), status: p.status, rating: p.rating, note: p.note, url: p.url,
      // where it has been: the names, oldest first, so a place keeps its road
      prov: p.provenance ? [...(p.provenance.chain || []), { name: p.provenance.name, at: p.provenance.adoptedAt }] : undefined,
    })),
    books: books.map(b => slim({
      id: b.id, title: b.title, author: b.author, year: b.year,
      placeId: carried.has(b.placeId) ? b.placeId : undefined,
      tags: retag(b.tags), status: b.status, note: b.note, url: b.url,
      // where it has been: the names, oldest first, exactly as a place's road
      prov: b.provenance ? [...(b.provenance.chain || []), { name: b.provenance.name, at: b.provenance.adoptedAt }] : undefined,
    })),
    routes: routes.map(r => {
      const base = {
        id: r.id, name: r.name, city: r.city, country: r.country,
        tags: retag(r.tags), status: r.status, rating: r.rating, note: r.note, url: r.url,
        km: r.km, ascent: r.ascent, descent: r.descent, high: r.high, low: r.low,
        hours: r.hours, loop: r.loop,
      };
      // a link has to fit in an address bar, so a way in a link is coarser.
      // a file has no such trouble and carries the shape plainly, which is
      // the same information in a form a person can read. the surface says
      // which is which rather than leaving the recipient to find out.
      return forLink
        ? slim({ ...base, p: encodePath(simplify(r.path, 0.03).slice(0, 900)) })
        : { ...base, path: r.path };
    }),
  };
}

// what a person is about to hand over, counted, so the panel and the payload
// can never disagree: both read this, and it reads the disclosure
export function disclosureCounts(d) {
  const books = d.books || [];
  const bylines = new Set([...d.places, ...d.routes, ...books]
    .flatMap(r => (r.prov || []).map(h => h.name)).filter(Boolean));
  return {
    places: d.places.length,
    routes: d.routes.length,
    books: books.length,
    tags: d.tags.length,
    notes: d.places.filter(p => p.note).length + d.routes.filter(r => r.note).length
      + books.filter(b => b.note).length,
    links: d.places.filter(p => p.url).length + d.routes.filter(r => r.url).length
      + books.filter(b => b.url).length,
    bylines: bylines.size,
    author: d.author,
  };
}

// The carrier, and only the carrier. It takes any payload the constructor
// above returns, which is why it is no longer called packDisclosure: it packs
// an ask and a thanks as readily as an atlas, and it used to have a twin
// called `pack` that did exactly this for the three kinds that had no builder.
export function packPayload(p) {
  const packed = LZString.compressToEncodedURIComponent(JSON.stringify(p));
  return `${location.origin}${location.pathname}#m=${packed}`;
}

export function makeShareUrl(tags, places, author = '', routes = [], books = []) {
  return packPayload(buildPayload('atlas', { places, routes, books, tags, author }, { forLink: true }));
}

// The reader, and only the reader. It takes the part after `#m=` from wherever
// that part came from: the address bar, or a link a person pasted into a field
// because the app it arrived in would not let them tap it. Both roads are the
// same road and the gate on it is the same gate, which is the point of there
// being one function rather than a second parser beside the first.
export function readPayload(packed) {
  try {
    const json = LZString.decompressFromEncodedURIComponent(String(packed || ''));
    if (!json) return null;
    // one gate: a payload is normalized and bounded, or it is not a payload
    return normPayload(JSON.parse(json));
  } catch {
    return null;
  }
}

export function parseShareHash() {
  const h = location.hash;
  if (!h.startsWith('#m=')) return null;
  return readPayload(h.slice(3));
}

export function clearShareHash() {
  history.replaceState(null, '', location.pathname + location.search);
}
