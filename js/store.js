// store.js — persistence, models, demo data

import { normImport, readArchive, readLocal, losses, setAside, normPlace, normRoute, normRoutes, normFolioRefs, normLetters, normPost, isMsgId, POST_KEPT, ARCHIVE_VERSION, PORTABLE_SETTINGS } from './schema.js?v=rf158';
import { semanticallyEqual } from './canonical.js?v=rf158';
import { cityLabel, oneSpelling, PLACELESS } from './find.js?v=rf158';
import { measure } from './route.js?v=rf158';
import { buildPayload } from './share.js?v=rf158';
import { inlinePicturesHeld, inlinePicturesByPlace, carryKeys } from './photos.js?v=rf158';

const K_PLACES = 'resonate.places.v1';
const K_TAGS = 'resonate.tags.v1';
const K_SETTINGS = 'resonate.settings.v1';
const K_CORR = 'resonate.correspondents.v1';
const K_ROUTES = 'resonate.routes.v1';
const K_BOOKS = 'resonate.books.v1';
const K_FOLIOS = 'resonate.folios.v1';
// Removing a tag spans four localStorage records. The old bytes are journalled
// before the first write so a refusal, reload or tab death can finish the
// rollback before any atlas record is read.
const K_TAG_DELETE = 'resonate.tag-delete.v1';
// A whole-device erase crosses localStorage and two IndexedDB databases. The
// local half stays journalled until the other two have committed, so any
// refusal before that point can restore the exact bytes this act began with.
const K_ERASE = 'resonate.erase.v1';
// the identity, the box address and the pairings. its own key, because none of
// it is part of an archive and the separation is what keeps it out of one.
const K_LETTERS = 'resonate.letters.v1';

// The letters this device has finished with: message ids and nothing else.
//
// Its own key, and deliberately not part of `letters`. That slice travels in
// the vault and holds an identity; this one is a note to self about a box, is
// worth nothing to anybody, and would only make the sealed slice larger every
// time somebody read their post. A second device restoring the vault therefore
// arrives with an empty ledger, which is right: it has finished with nothing.
const K_POST = 'resonate.post.v1';

// The address written inside every copy handed to an assistant, naming what
// the copy is held to. It is a promise in a file rather than a lever, and the
// document at the other end says so plainly.
//
// It travels, which is the whole reason `agents` is still answered at that
// page: copies written before the document was renamed name the old word, and
// they are past reach.
export const ASSISTANT_TERMS = 'https://resonate.select/read.html?d=assistant';

// A parsed resonate file, reduced to the atlas inside it. Only one shape is
// wrapped: the assistant copy, which nests its disclosure under a named kind
// so nothing has to guess. A handover and an archive are already the atlas and
// are returned untouched, and anything else is left exactly as it arrived for
// the gates to refuse in their own words.
//
// Nothing in the app calls this, and that is not an oversight. No door here
// takes a handover as a file: an atlas from somebody else arrives as a link,
// and the one file input this app has asks for an archive, which a handover is
// not. So there is nowhere honest to wire it in, and wiring it in anyway would
// have moved a refusal from one sentence to an identical one while looking in
// the diff like a door had opened.
//
// It is written and exported because the contract now publishes this wrapper
// to whoever parses these files, and the unwrapping belongs beside the code
// that does the wrapping rather than in six readers that each guess at it.
export function unwrapFile(parsed) {
  if (parsed && typeof parsed === 'object'
    && parsed.kind === 'assistant_copy'
    && parsed.disclosure && typeof parsed.disclosure === 'object') {
    return parsed.disclosure;
  }
  return parsed;
}

// the tag wheel: eight hue stations that survive full-viewport takeover.
// hue is the stored truth; hex is kept only for interop with old exports/links.
export const TAG_STATIONS = [
  { hue: 12, name: 'rosewood', hex: '#8A3B47' },
  { hue: 42, name: 'ember', hex: '#8A5226' },
  { hue: 95, name: 'moss', hex: '#6E6320' },
  { hue: 155, name: 'spruce', hex: '#2F6B4F' },
  { hue: 205, name: 'petrol', hex: '#2A6578' },
  { hue: 242, name: 'cobalt', hex: '#3D5A9E' },
  { hue: 278, name: 'iris', hex: '#5F4DA8' },
  { hue: 318, name: 'orchid', hex: '#8A3F86' },
];
export const TAG_COLORS = TAG_STATIONS.map(s => s.hex);

export function hexToHue(hex) {
  const m = /^#([0-9a-fA-F]{6})/.exec(String(hex || ''));
  if (!m) return 205;
  const [r, g, b] = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16) / 255);
  const M = Math.max(r, g, b), mn = Math.min(r, g, b), d = M - mn;
  if (!d) return 205;
  let h = M === r ? ((g - b) / d) % 6 : M === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return ((h * 60) + 360) % 360;
}

export function nearestStation(hue) {
  return TAG_STATIONS.reduce((best, s) => {
    const dist = Math.min(Math.abs(s.hue - hue), 360 - Math.abs(s.hue - hue));
    return dist < best.dist ? { dist, s } : best;
  }, { dist: 361, s: TAG_STATIONS[4] }).s;
}

export function uid() {
  return (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9));
}

// ---------- unreadable keys ----------
//
// A key that will not parse is not an empty key.
//
// This used to catch the error and hand back an empty array. The app then
// drew an empty atlas, and the very next edit called savePlaces(), which
// wrote that empty array over the damaged bytes. One corrupt byte became a
// blank life, permanently, on the next keystroke, and nobody was told.
//
// Now the damaged bytes are left exactly where they are. A copy is set aside
// under a name that says what it is, the key is sealed against writing, and
// the app is expected to say so out loud. An atlas that cannot be read is a
// bad day. An atlas that cannot be read and is then overwritten is the end of
// the thing this app is for.
const sealed = new Map(); // key -> { at, bytes }

export function unreadableKeys() {
  return [...sealed.entries()].map(([key, v]) => ({ key, at: v.at, bytes: v.bytes, why: v.why }));
}

// a person who has been told, and has decided, may release a key. the set
// aside copy stays where it is: releasing is a decision to move on, not a
// decision to destroy.
export function releaseUnreadable(key) { return sealed.delete(key); }

function seal(key, raw, why) {
  sealed.set(key, { at: new Date().toISOString(), bytes: raw.length, why });
  // keep the original where a person or a support session can still reach
  // it, and never over a copy already set aside by an earlier load
  try {
    const keep = `${key}.unreadable`;
    if (localStorage.getItem(keep) === null) localStorage.setItem(keep, raw);
  } catch { /* no room to set it aside; the original is still untouched */ }
}

// Bytes that will not parse, and bytes that parse into the wrong thing.
//
// Only the first was caught before. `{}` stored under the tags key is
// perfectly good JSON, so it sailed through and the next line to touch it
// threw: the app stopped where it stood, on every load, with no explanation.
// And a collection holding one record the schema rejects was worse than a
// crash, because it did not crash: the readable records became the whole
// collection, and the healing write below saved that shorter list over the
// longer one. A record was destroyed by being read.
//
// So shape is checked here too, and `want` says what the key is meant to be.
// Anything that disagrees is sealed whole, exactly like unparseable bytes.
function read(key, fallback, want = null) {
  let raw = null;
  try { raw = localStorage.getItem(key); } catch { return fallback; }
  if (raw === null || raw === undefined || raw === '') return fallback;
  let value;
  try { value = JSON.parse(raw); }
  catch { seal(key, raw, 'these bytes are not readable'); return fallback; }
  if (want === 'array' && !Array.isArray(value)) {
    seal(key, raw, 'this should be a list of records and is not');
    return fallback;
  }
  if (want === 'object' && (value === null || typeof value !== 'object' || Array.isArray(value))) {
    seal(key, raw, 'this should be a set of settings and is not');
    return fallback;
  }
  return value;
}

// A collection is all of its records or none of them.
//
// `fn` is the reader that decides what a record is. If it turns any of them
// down, the key is sealed rather than quietly loaded short: a person's atlas
// may not shrink because one line of it confused this build, and nothing may
// be written back over the longer original.
function readAll(key, kind, fn) {
  // Guarded the way read() guards the same access two dozen lines up. Where
  // storage is refused, getItem throws SecurityError, and load() is reached
  // through an await in init(), so the throw arrives as an unhandled rejection:
  // init() is called bare at js/app.js:6992, nothing catches it, there is no
  // unhandledrejection handler, and everything after store.load() never runs.
  // Not an empty atlas: an inert page, with no marks, no field, no listener and
  // no key binding, and nothing in the console to say why.
  //
  // Returning [] is what this function already produces on that path anyway:
  // read() returns its own [] fallback, fn([]) is [], and the short-read check
  // does not fire. The key is still read twice on a healthy device, once here
  // for the sealing evidence and once inside read(); that is deliberate, since
  // read() is the only thing allowed to decide what the bytes mean.
  let raw = null;
  try { raw = localStorage.getItem(key); } catch { return []; }
  const given = read(key, [], 'array');
  if (sealed.has(key)) return [];
  const kept = fn(given);
  if (kept.length < given.length && raw) {
    seal(key, raw, `${given.length - kept.length} of ${given.length} ${kind} could not be read`);
    return [];
  }
  return kept;
}

// a refused write must be heard: the app sets onWriteFailed to say so out loud
export let onWriteFailed = null;
export function setWriteFailedHandler(fn) { onWriteFailed = fn; }

function write(key, value) {
  if (sealed.has(key)) {
    // the damaged bytes stay. this is a refusal, not a failure, and it is
    // reported through the same channel so the app already knows how to speak
    onWriteFailed?.(key, new Error('this key could not be read, and will not be written over'));
    return false;
  }
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.warn('Storage write failed', e);
    onWriteFailed?.(key, e);
    return false;
  }
}

const TAG_DELETE_KEYS = [K_TAGS, K_PLACES, K_ROUTES, K_BOOKS];

function recoverTagDelete() {
  let raw;
  try { raw = localStorage.getItem(K_TAG_DELETE); }
  catch { return false; }
  if (!raw) return true;
  let journal;
  try { journal = JSON.parse(raw); } catch { return false; }
  if (journal?.v !== 1 || !journal.before || typeof journal.before !== 'object') return false;
  for (const key of TAG_DELETE_KEYS) {
    const value = journal.before[key];
    if (value !== null && typeof value !== 'string') return false;
  }
  try {
    for (const key of TAG_DELETE_KEYS) {
      const value = journal.before[key];
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    }
    localStorage.removeItem(K_TAG_DELETE);
    return true;
  } catch { return false; }
}

function beginTagDelete() {
  // A previous interrupted deletion owns the journal. Restore it before a new
  // one is allowed to start, so one recovery record can never cover two acts.
  if (!recoverTagDelete()) return false;
  const before = {};
  try {
    for (const key of TAG_DELETE_KEYS) before[key] = localStorage.getItem(key);
    localStorage.setItem(K_TAG_DELETE, JSON.stringify({ v: 1, before }));
    return true;
  } catch { return false; }
}

function finishTagDelete() {
  try { localStorage.removeItem(K_TAG_DELETE); return true; }
  catch { return false; }
}

function eraseJournal() {
  let raw;
  try { raw = localStorage.getItem(K_ERASE); }
  catch { return null; }
  if (!raw) return null;
  let journal;
  try { journal = JSON.parse(raw); } catch { return null; }
  if (journal?.v !== 1 || !['prepared', 'committed'].includes(journal.state)
    || !journal.before || typeof journal.before !== 'object' || Array.isArray(journal.before)) return null;
  for (const [key, value] of Object.entries(journal.before)) {
    if (!key.startsWith('resonate.') || key === K_ERASE
      || (value !== null && typeof value !== 'string')) return null;
  }
  return journal;
}

function beginErase(context) {
  try {
    if (localStorage.getItem(K_ERASE) !== null) return false;
    const keys = Object.keys(localStorage)
      .filter(k => k.startsWith('resonate.') && k !== K_ERASE);
    if (!keys.includes(K_SETTINGS)) keys.push(K_SETTINGS);
    const before = {};
    for (const key of keys) before[key] = localStorage.getItem(key);
    localStorage.setItem(K_ERASE, JSON.stringify({ v: 1, state: 'prepared', before, context: context ?? null }));
    return true;
  } catch { return false; }
}

function restoreErase() {
  const journal = eraseJournal();
  if (!journal || journal.state !== 'prepared') return false;
  try {
    for (const [key, value] of Object.entries(journal.before)) {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    }
    return true;
  } catch { return false; }
}

function markEraseCommitted() {
  const journal = eraseJournal();
  if (!journal || journal.state !== 'prepared') return false;
  try {
    localStorage.setItem(K_ERASE, JSON.stringify({ ...journal, state: 'committed' }));
    return true;
  } catch { return false; }
}

function finishErase() {
  try {
    localStorage.removeItem(K_ERASE);
    return localStorage.getItem(K_ERASE) === null;
  } catch { return false; }
}

// ---------- a record still carrying somebody's photograph ----------
//
// Photographs left the records, and a place in memory has no photos field at
// all. But whenever IndexedDB refused a blob, and Safari refused every one of
// them for a whole release, the older build kept the picture inline in the
// record itself, and on those devices the field is still there in the stored
// bytes. Every write of the places key by this build is therefore a write that
// would take those pictures out of the only place they are.
//
// photos.js lifts them into the database at boot, ahead of the load, and that
// is the fix. This is what stands where the lift could not happen: a browser
// that refuses its own database still has an atlas, and a person on one of
// those is owed their pictures for exactly as long as anybody else is.
//
// Read once, on load, and it is one string scan of a key already in hand on a
// device that never kept a photograph, which is nearly every device. Where it
// is false, and it is almost always false, nothing below costs anything.
let carrying = false;

// The places on their way to disk, with whatever pictures the stored record is
// still carrying put back into them.
//
// The list handed to write() is copies: nothing in memory is given a photos
// field, so no export, link, folio or snapshot learns about one. A place a
// person has deleted takes its inline pictures with it, which is the same thing
// deleting a place has always done, and is the person's own act.
function carryPictures(places) {
  const held = inlinePicturesByPlace();
  if (!held.size) {
    // the last of them has been lifted, or let go. this stops asking.
    carrying = false;
    return places;
  }
  // The same name on both sides. Matching on p.id alone dropped the pictures of
  // any record too old to have been given one, on exactly the devices where the
  // database had refused and the carry was the only thing protecting them.
  return places.map((p) => {
    const key = carryKeys(p).find(k => held.has(k));
    return key ? { ...p, photos: held.get(key) } : p;
  });
}

// a place arriving from a link or a file is a stranger.
// schema.js decides what a place is; this keeps the old name for callers.
export function sanePlace(p) {
  return normPlace({ lat: 0, lng: 0, ...p }) || normPlace({ lat: 0, lng: 0 });
}

export function newPlace(partial = {}) {
  const now = new Date().toISOString();
  const out = {
    id: uid(),
    name: 'Untitled place',
    lat: 0,
    lng: 0,
    address: '',
    city: '',
    country: '',
    countryCode: '',
    tags: [],
    status: 'wishlist', // 'visited' | 'wishlist'
    private: false,     // true: it never leaves this device
    rating: 0,          // read from old links, never written
    note: '',
    url: '',
    ...partial,
    // The key this atlas is organised by is settled here, where the place is
    // made, and nowhere else. oneSpelling says why, at length.
    city: oneSpelling(partial.city),
    country: oneSpelling(partial.country),
    // a caller passing id: undefined must still get a real, unique id
    ...(partial.id ? {} : { id: uid() }),
    // A link carries no diary of when, so a place arriving from one has empty
    // dates. It was entered into THIS atlas now, which is the honest answer,
    // and an empty date must never survive into the record.
    createdAt: partial.createdAt || now,
    updatedAt: partial.updatedAt || now,
  };
  // hearts ride the spread when present; an empty list is not a shape a
  // record may wear, or a place with no hearts would be two shapes (the
  // folio's offeredAt taught this lesson the day compare learned to look)
  if (!(Array.isArray(out.thanks) && out.thanks.length)) delete out.thanks;
  return out;
}

// A book is the first record here that may answer to no place at all.
//
// Everything else in this atlas is somewhere: a place is a point, a way is a
// line, and both are drawn on a field. A book was read on a train, or it was
// the reason for a journey, or it is simply worth handing to somebody. Tying
// it to a place is allowed and is often the whole point -- the novel that is
// about the town you are standing in -- but requiring it would be a lie about
// what a recommendation is, and the app would start asking where somebody read
// something in order to let them say it was good.
//
// So `placeId` may be empty, and an empty one is not a record missing a field.
// It is a book that answers to no place, which is most books.
//
// `year` is a string. A book is from 1978, or from n.d., or from 'first
// published 1929, this translation 2003', and a number can hold exactly one of
// those three.
//
// The two status words are the same two every other record uses, because the
// filters, the carriers and the comparison all read them and none of them
// should have to learn a third vocabulary. What changes is the word a person
// sees: a place has been visited, a book has been read.
export function newBook(partial = {}) {
  const now = new Date().toISOString();
  const out = {
    id: uid(),
    kind: 'book',
    title: 'Untitled book',
    author: '',
    year: '',
    placeId: '',        // '' is a book that answers to no place
    tags: [],
    status: 'wishlist', // 'visited' (read) | 'wishlist' (want to read)
    private: false,     // true: it never leaves this device
    note: '',
    url: '',
    ...partial,
    ...(partial.id ? {} : { id: uid() }),
    createdAt: partial.createdAt || now,
    updatedAt: partial.updatedAt || now,
  };
  if (!(Array.isArray(out.thanks) && out.thanks.length)) delete out.thanks;
  return out;
}

// A way is stored with the shape it was given.
//
// This used to run simplify() over every path that passed through, which
// looked harmless and was not: simplify is not idempotent on a path carrying
// elevation, so a way lost a few percent of itself every time it came home
// from an archive, and again the next time, and again. A record that changes
// by being read is not a record.
//
// Thinning belongs where a shape is first captured (the gpx importer does it
// before it calls here) and where a shape has to fit in a link (packRoutes
// does it on the way out). Never in between.
export function newRoute(partial = {}) {
  const now = new Date().toISOString();
  const path = Array.isArray(partial.path) ? partial.path : [];
  const m = measure(path);
  return {
    id: uid(),
    kind: 'route',
    name: 'Untitled way',
    path,
    city: '', country: '',
    tags: [],
    status: 'wishlist',
    rating: 0,
    note: '', url: '',
    km: m.km, ascent: m.ascent, descent: m.descent,
    high: m.high, low: m.low, hours: m.hours, loop: m.loop,
    walkedAt: '',
    private: false,
    trimEnds: false,
    ...partial,
    path,
    // a way is filed under a city like everything else, so it is spelled the
    // same way everything else is
    city: oneSpelling(partial.city),
    country: oneSpelling(partial.country),
    ...(partial.id ? {} : { id: uid() }),
    // a way from a link carries no dates either: it entered here, now
    createdAt: partial.createdAt || now,
    updatedAt: partial.updatedAt || now,
  };
}

// a folio on the shelf: a titled slice, kept as references so it stays
// current as the atlas improves. it copies nothing until it is handed over.
export function newFolio(partial = {}) {
  const now = new Date().toISOString();
  return {
    id: uid(),
    title: 'Untitled folio',
    dedication: '',
    placeIds: [],
    routeIds: [],
    bookIds: [],
    createdAt: now,
    updatedAt: now,
    // emitted empty rather than omitted, because the gate's normFolioRef
    // writes it empty: a folio made this session and the same folio after a
    // reload must be one shape, or the restore preview reports the reload as
    // an edit. that exact disagreement sat here unseen until the comparison
    // learned to look at folios.
    offeredAt: '',
    ...partial,
    ...(partial.id ? {} : { id: uid() }),
  };
}

export function newTag(partial = {}) {
  const t = {
    id: uid(),
    name: 'Tag',
    emoji: '',
    color: TAG_STATIONS[4].hex,
    ...partial,
  };
  if (!Number.isFinite(t.hue)) t.hue = nearestStation(hexToHue(t.color)).hue;
  return t;
}

// What may be handed to someone else.
//
// Two words hold a record back. `private` is the person's own instruction and
// always has been. `sample` is the demonstration atlas, and it used to hold
// nothing back at all: eighteen places nobody had been to travelled in every
// link, file, folio and printed sheet as the sender's own, and the disclosure
// builder does not carry the flag, so the recipient had no way to tell. A
// loan is not a recommendation. It stays here until it is edited or adopted,
// which is what clears the flag.
//
// A person's own device and their own backup still hold everything: losing a
// record there in the name of tidiness would be the worse mistake.
// The one word that keeps a record home is the person's own: private. The
// sample used to stand here too, held back as "not yours yet", and the owner
// retired that rule: the sample is real places from real people, and it
// travels, composes and publishes like anything else. The mark itself stays,
// for the chip and for the word in the `you` room that clears the demonstration.
export const mayLeave = r => !r.private;

// ---------- hiding the ends of a way ----------
//
// A quarter of a kilometre from each end, which is enough to lose a door.
//
// This used to give up when a path held fewer than eight points and hand the
// way over whole. A straight thirteen kilometre walk simplifies to two points,
// so the one case where a person most wants their door hidden was the case
// where both ends went out untouched, under a sentence promising otherwise.
// Point count says nothing about ground. Distance is the only measure here,
// and a new end is interpolated inside the segment that crosses the mark, so
// two points are enough to trim.
//
// It fails closed. A way too short to lose both ends is not handed over half
// redacted and not handed over whole: trimWay returns null and the surface
// says why.
const TRIM_KM = 0.25;
const R_KM = 6371, RAD = Math.PI / 180;

function step(a, b) {
  const dLat = (b.lat - a.lat) * RAD, dLng = (b.lng - a.lng) * RAD;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.sqrt(s));
}

// the point f of the way along a segment, elevation carried with it.
// the longitudes are brought within half a turn of each other first, or a
// segment stepping over the antimeridian would interpolate the long way round
// and put the new end in the middle of the Pacific.
function between(a, b, f) {
  let dLng = b.lng - a.lng;
  if (dLng > 180) dLng -= 360;
  if (dLng < -180) dLng += 360;
  let lng = a.lng + dLng * f;
  if (lng > 180) lng -= 360;
  if (lng < -180) lng += 360;
  const pt = { lat: a.lat + (b.lat - a.lat) * f, lng };
  if (Number.isFinite(a.ele) && Number.isFinite(b.ele)) pt.ele = a.ele + (b.ele - a.ele) * f;
  else if (Number.isFinite(a.ele)) pt.ele = a.ele;
  return pt;
}

// Walk in from the start until you are TRIM_KM from the door, and return the
// path from exactly there.
//
// Two measures have to agree here, and only one of them is the point. Walking
// TRIM_KM of recorded line says nothing about how far you have got: a track
// that circles the block, or wanders the garden, or simply jitters while the
// receiver settles, can spend a quarter kilometre of line and still be
// standing at the front door. So the line is walked, and the new head is
// pushed on until it is also TRIM_KM away from where the track began. What is
// being hidden is a place, not a length.
function fromHead(path, km) {
  const origin = path[0];
  let run = 0;
  for (let i = 1; i < path.length; i++) {
    const d = step(path[i - 1], path[i]);
    if (run + d >= km) {
      const f = d > 0 ? (km - run) / d : 1;
      const head = between(path[i - 1], path[i], f);
      // far enough along the line; now far enough from the door as well
      if (step(origin, head) >= km) return [head, ...path.slice(i)];
      for (let j = i; j < path.length; j++) {
        if (step(origin, path[j]) >= km) return path.slice(j);
      }
      return null; // the whole track stays within the stretch to hide
    }
    run += d;
  }
  return null; // the whole way is shorter than the stretch to hide
}

const reversed = a => [...a].reverse();

export function trimWay(r) {
  if (!r?.trimEnds || !Array.isArray(r.path) || r.path.length < 2) return r;
  const head = fromHead(r.path, TRIM_KM);
  if (!head || head.length < 2) return null;
  const both = fromHead(reversed(head), TRIM_KM);
  if (!both || both.length < 2) return null;
  const path = reversed(both);
  // the shape handed over is shorter than the one walked, so the numbers
  // beside it are the shorter shape's. a distance that describes a stretch
  // the recipient was not given is a quiet way of giving it to them.
  const m = measure(path);
  return {
    ...r, path,
    km: m.km, ascent: m.ascent, descent: m.descent,
    high: m.high, low: m.low, hours: m.hours, loop: m.loop,
  };
}

// `bylineAsked` is deliberately not in PORTABLE_SETTINGS: a declined question is
// this device's answer to it, not something a handed-over file should carry.
const DEFAULT_SETTINGS = { theme: 'auto', hue: 300, lastView: null, seeded: false, authorName: '', bylineAsked: false, agentAccess: false, clubKey: '', clubUrl: '', clubSeq: 0, clubSealedAt: '' };

export const store = {
  places: [],
  routes: [],
  books: [],
  folios: [],
  tags: [],
  correspondents: [],
  // the identity and the pairings. never in a file, only ever in the vault.
  letters: { v: 1, jwk: null, pub: '', route: '', pairs: [] },
  // the message ids already dealt with, so a letter thrown away does not come
  // back the next time somebody looks in the box
  post: { v: 1, done: [] },
  settings: { ...DEFAULT_SETTINGS },
  // set by the last reading of a person's own archive: everything in the file
  // that could not be kept exactly, named. empty after any other kind of merge
  lastLost: [],

  load() {
    // A tag deletion interrupted between any two record writes is rolled back
    // before those records can be observed as one atlas.
    recoverTagDelete();
    // asked before a single record is read, because every answer below is
    // about to become a candidate for being written back down
    carrying = inlinePicturesHeld();
    // records adopted before this carry an empty date, which read back as
    // "Invalid Date": give them the day they are first seen, once
    const sane = (v) => !!v && !Number.isNaN(new Date(v).getTime());
    const dated = (r) => (sane(r.createdAt) ? r
      : { ...r, createdAt: sane(r.updatedAt) ? r.updatedAt : new Date().toISOString() });
    this.places = readAll(K_PLACES, 'places', a => readLocal(a, 'places')).map(dated);
    this.routes = readAll(K_ROUTES, 'paths', a => readLocal(a, 'routes')).map(dated);
    this.books = readAll(K_BOOKS, 'books', a => readLocal(a, 'books')).map(dated);
    this.folios = readAll(K_FOLIOS, 'folios', a => readLocal(a, 'folios'));
    this.tags = readAll(K_TAGS, 'tags', a => readLocal(a, 'tags'));
    this.correspondents = readAll(K_CORR, 'voices', a => readLocal(a, 'correspondents'));
    // read through the same gate the vault's copy goes through, because a
    // stored key of the wrong shape must be refused here rather than inside
    // importKey, where the sentence would be the browser's and not this app's
    const rawLetters = read(K_LETTERS, null, 'object');
    const letters = normLetters(rawLetters);
    if (rawLetters && !letters && !sealed.has(K_LETTERS)) {
      // Valid JSON can still be a damaged identity. Preserve the exact bytes
      // and seal the key just as readAll does for one rejected atlas record;
      // otherwise the next route, pairing or identity write replaces the only
      // recoverable copy with the empty fallback below.
      let raw = '';
      try { raw = localStorage.getItem(K_LETTERS) || ''; } catch { /* read already answered */ }
      if (raw) seal(K_LETTERS, raw, 'the letters identity or one of its pairings could not be read');
    }
    this.letters = letters || { v: 1, jwk: null, pub: '', route: '', pairs: [] };
    this.post = normPost(read(K_POST, null, 'object')) || { v: 1, done: [] };
    this.settings = { ...DEFAULT_SETTINGS, ...read(K_SETTINGS, {}, 'object') };
    // whatever was healed above is written down, so it heals only once
    if (this.places.some(p => p.createdAt) || this.routes.some(r => r.createdAt)) {
      const needsWrite = read(K_PLACES, [], 'array').some(p => !sane(p.createdAt))
        || read(K_ROUTES, [], 'array').some(r => !sane(r.createdAt));
      // write() refuses a sealed key on its own, but not asking is clearer
      if (needsWrite && !sealed.has(K_PLACES) && !sealed.has(K_ROUTES)) {
        // The healing write is the first thing in the whole app that can reach
        // the places key, and on a device where the lift could not happen it
        // would once have gone out over a photograph before anybody had been
        // told there was one. It used to be held back for that reason.
        //
        // It is not held any more, because it no longer needs to be. savePlaces
        // carries every stored photos field through, matched by carryKey, which
        // names a record by its id or, for a record from far enough back to
        // have none, by its name and its point. The hold existed only to cover
        // records the matching could not reach, and there are none.
        //
        // Removing it costs nothing and buys back the thing it was paid for: a
        // record whose dates are both unreadable is dated once, here, instead
        // of being given today afresh on every visit and moving through the
        // accession order while a person watches.
        this.savePlaces();
        this.saveRoutes();
      }
    }
    // migrate hex-era tags onto the hue wheel
    let migrated = false;
    this.tags.forEach(t => {
      if (!Number.isFinite(t.hue)) { t.hue = nearestStation(hexToHue(t.color)).hue; migrated = true; }
    });
    if (migrated) this.saveTags();
  },

  savePlaces() { return write(K_PLACES, carrying ? carryPictures(this.places) : this.places); },
  saveTags() { return write(K_TAGS, this.tags); },
  saveSettings() { return write(K_SETTINGS, this.settings); },
  saveCorrespondents() { return write(K_CORR, this.correspondents); },
  saveRoutes() { return write(K_ROUTES, this.routes); },
  saveBooks() { return write(K_BOOKS, this.books); },
  saveFolios() { return write(K_FOLIOS, this.folios); },

  folioById(id) { return this.folios.find(f => f.id === id); },

  addFolio(folio) {
    this.folios.unshift(folio);
    if (!this.saveFolios()) { this.folios.shift(); return null; }
    return folio;
  },

  updateFolio(id, patch) {
    const f = this.folioById(id);
    if (!f) return null;
    const before = { ...f };
    Object.assign(f, patch, { updatedAt: new Date().toISOString() });
    if (!this.saveFolios()) { Object.assign(f, before); return null; }
    return f;
  },

  removeFolio(id) {
    const before = this.folios;
    this.folios = this.folios.filter(f => f.id !== id);
    if (!this.saveFolios()) this.folios = before;
  },

  // a folio materializes at the moment it is needed: missing places have
  // been removed from the atlas and silently fall out of the slice
  resolveFolio(id) {
    const f = this.folioById(id);
    if (!f) return null;
    return {
      ...f,
      places: f.placeIds.map(pid => this.placeById(pid)).filter(Boolean),
      routes: f.routeIds.map(rid => this.routeById(rid)).filter(Boolean),
      books: (f.bookIds || []).map(bid => this.bookById(bid)).filter(Boolean),
    };
  },

  routeById(id) { return this.routes.find(r => r.id === id); },

  addRoute(route) {
    this.routes.unshift(route);
    if (!this.saveRoutes()) { this.routes.shift(); return null; }
    return route;
  },

  updateRoute(id, patch) {
    const r = this.routeById(id);
    if (!r) return null;
    const before = { ...r };
    Object.assign(r, patch, { updatedAt: new Date().toISOString() });
    if (!this.saveRoutes()) { Object.assign(r, before); return null; }
    return r;
  },

  removeRoute(id) {
    const before = this.routes;
    this.routes = this.routes.filter(r => r.id !== id);
    if (!this.saveRoutes()) this.routes = before;
  },

  // ---------- books: the records that may answer to no place ----------

  bookById(id) { return this.books.find(b => b.id === id); },

  // Every book that names this place. A place being erased must not leave
  // books pointing at nothing, and a plate showing a place wants to say what
  // was read there.
  booksForPlace(id) { return id ? this.books.filter(b => b.placeId === id) : []; },

  addBook(book) {
    this.books.unshift(book);
    if (!this.saveBooks()) { this.books.shift(); return null; }
    return book;
  },

  updateBook(id, patch) {
    const b = this.bookById(id);
    if (!b) return null;
    const before = { ...b };
    Object.assign(b, patch, { updatedAt: new Date().toISOString() });
    if (!this.saveBooks()) { Object.assign(b, before); return null; }
    return b;
  },

  removeBook(id) {
    const before = this.books;
    this.books = this.books.filter(b => b.id !== id);
    if (!this.saveBooks()) this.books = before;
  },

  // ---------- correspondents: kept atlases from people whose taste you've measured ----------

  addCorrespondent({ name, tags, places, hue, sample }) {
    const c = {
      id: uid(),
      name: name || 'Unnamed correspondent',
      hue: Number.isFinite(hue) ? hue : TAG_STATIONS[(this.correspondents.length + 2) % TAG_STATIONS.length].hue,
      visible: true,
      sample: sample === true,
      addedAt: new Date().toISOString(),
      tags: (tags || []).map(t => newTag(t)),
      places: (places || [])
        .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng))
        .map(p => newPlace({ ...p })),
    };
    this.correspondents.push(c);
    if (!this.saveCorrespondents()) { this.correspondents.pop(); return null; }
    return c;
  },

  updateCorrespondent(id, patch) {
    const c = this.correspondents.find(x => x.id === id);
    if (!c) return null;
    const before = { ...c };
    Object.assign(c, patch);
    if (!this.saveCorrespondents()) { Object.assign(c, before); return null; }
    return c;
  },

  // Refusal is answered the way every other write here answers it. This one
  // rolled back and then said nothing, so the caller announced a removal that
  // had not happened and redrew the row that was still there.
  removeCorrespondent(id) {
    const before = this.correspondents;
    this.correspondents = this.correspondents.filter(c => c.id !== id);
    if (!this.saveCorrespondents()) { this.correspondents = before; return null; }
    return true;
  },

  // Putting one back exactly as it stood, id included. `addCorrespondent`
  // mints a fresh id, and the id is load-bearing: the signature angle a voice
  // wears on the field is drawn from it, so a voice that came back under a new
  // id would come back wearing somebody else's mark.
  restoreCorrespondent(c) {
    if (!c || !c.id || this.correspondents.some(x => x.id === c.id)) return null;
    this.correspondents.push({ ...c });
    if (!this.saveCorrespondents()) { this.correspondents.pop(); return null; }
    return true;
  },

  // ---------- letters: the identity, the address, and who may be written to ----------
  //
  // Held apart from everything above, in its own key, for one reason: none of
  // it may ever reach a file. exportJSON names its fields one at a time, so
  // this is excluded by not being named there rather than by being filtered
  // out somewhere, which is the difference between a rule and a habit.
  //
  // What it holds: this membership's private key, its public half and its box
  // address, and one record per person an introduction has passed between.
  // The private key is the severe one. Identity is the membership, so a copy
  // of it is not a disclosure but an impersonation, and the only place it
  // travels is the vault, sealed under a phrase nobody but its owner knows.

  saveLetters() { return write(K_LETTERS, this.letters); },

  // The keypair, once. A membership has one, and a second device restoring
  // from the vault gets this one rather than minting its own: two keys under
  // one membership is two identities, and the friend who verified a mark with
  // one of them has verified nothing about the other.
  setIdentity({ jwk, pub }) {
    const before = this.letters;
    this.letters = { ...this.letters, jwk, pub };
    if (!this.saveLetters()) { this.letters = before; return null; }
    return this.letters;
  },

  // The address the club derived from the membership key and handed back. It
  // is cached so an introduction can be written without asking again, and it
  // is not a secret: it is what other people post to.
  noteRoute(route) {
    if (this.letters.route === route) return this.letters;
    const before = this.letters;
    this.letters = { ...this.letters, route };
    if (!this.saveLetters()) { this.letters = before; return null; }
    return this.letters;
  },

  pairById(id) { return this.letters.pairs.find(p => p.id === id); },
  // by their key, because a person is their key here and never their name
  pairByPub(pub) { return pub ? this.letters.pairs.find(p => p.pub === pub) : undefined; },

  addPair(pair) {
    const before = this.letters;
    // `v: 0` and not the current version: a pairing is born unverified, and the
    // field records which arithmetic somebody read a mark under, so writing
    // today's number here would say a call happened that has not happened yet.
    const p = { id: uid(), name: '', pub: '', cap: '', capId: '', state: 'introduced',
      mark: '', v: 0, at: new Date().toISOString(), cid: '', ...pair };
    this.letters = { ...this.letters, pairs: [...this.letters.pairs, p] };
    if (!this.saveLetters()) { this.letters = before; return null; }
    return p;
  },

  updatePair(id, patch) {
    const at = this.letters.pairs.findIndex(p => p.id === id);
    if (at < 0) return null;
    const before = this.letters;
    const next = { ...this.letters.pairs[at], ...patch };
    const pairs = [...this.letters.pairs];
    pairs[at] = next;
    this.letters = { ...this.letters, pairs };
    if (!this.saveLetters()) { this.letters = before; return null; }
    return next;
  },

  // Forgetting a pairing on this device is not withdrawing the introduction:
  // the capability minted for them is still live at the club until it is
  // revoked there, and the caller does that first. Named here so the next
  // reader of this function is not left to assume otherwise.
  removePair(id) {
    const before = this.letters;
    this.letters = { ...this.letters, pairs: this.letters.pairs.filter(p => p.id !== id) };
    if (!this.saveLetters()) { this.letters = before; return null; }
    return true;
  },

  // ---------- the post: what has already been dealt with ----------
  //
  // One question and one answer: has this device finished with this letter?
  //
  // It is needed because the club frees a message id when the letter under it
  // is deleted, so the same letter can be posted again afterwards. Only a
  // verified correspondent can post at all, so this is not a defence against a
  // stranger; it is what stops a letter somebody threw away from arriving again
  // next week, which on a surface that says `Ada sent you a place` would read as
  // Ada sending it twice.
  //
  // Bounded, and the bound is stated rather than hidden. Ids are dropped oldest
  // first past POST_KEPT, so a letter deleted long enough ago and posted again
  // would be shown once more as new. That is the honest cost of not keeping a
  // list that grows for as long as a membership lasts, and it is a duplicate
  // rather than a loss.
  savePost() { return write(K_POST, this.post); },

  finishedWith(id) { return this.post.done.includes(id); },

  // Refusal is loud on purpose. The caller deletes the club's copy immediately
  // after this, so a false here means the one record that the letter was dealt
  // with is about to have no home at all, and the caller must not delete.
  finishWith(id) {
    if (!isMsgId(id)) return false;
    if (this.post.done.includes(id)) return true;
    const before = this.post;
    const done = [...this.post.done, id];
    this.post = { ...this.post, done: done.slice(Math.max(0, done.length - POST_KEPT)) };
    if (!this.savePost()) { this.post = before; return false; }
    return true;
  },

  tagById(id) { return this.tags.find(t => t.id === id); },
  placeById(id) { return this.places.find(p => p.id === id); },

  // a mutation that cannot be written is not a mutation: roll it back so the
  // screen never shows a place the device refused to keep
  addPlace(place) {
    this.places.unshift(place);
    if (!this.savePlaces()) { this.places.shift(); return null; }
    return place;
  },

  updatePlace(id, patch) {
    const p = this.placeById(id);
    if (!p) return null;
    const before = { ...p };
    Object.assign(p, patch, { updatedAt: new Date().toISOString() });
    if (!this.savePlaces()) { Object.assign(p, before); return null; }
    return p;
  },

  removePlace(id) {
    const before = this.places;
    this.places = this.places.filter(p => p.id !== id);
    if (!this.savePlaces()) { this.places = before; return; }
    // a book read at a place outlives the place. deleting the cafe does not
    // delete the novel, so the book keeps its title and loses its attachment,
    // and the archive never carries a pointer to nothing.
    const pointed = this.books.filter(b => b.placeId === id);
    if (pointed.length) {
      pointed.forEach(b => { b.placeId = ''; b.updatedAt = new Date().toISOString(); });
      this.saveBooks();
    }
  },

  addTag(tag) {
    this.tags.push(tag);
    if (!this.saveTags()) { this.tags.pop(); return null; }
    return tag;
  },

  updateTag(id, patch) {
    const t = this.tagById(id);
    if (!t) return null;
    const before = { ...t };
    Object.assign(t, patch);
    if (!this.saveTags()) { Object.assign(t, before); return null; }
    return t;
  },

  // A tag is worn by every kind that can carry one, so taking it off has to
  // reach every kind that wears it. This stripped places and left the id
  // sitting on paths and books: the path kept a pointer to a word that no
  // longer exists, lost its colour, and fell out of the tag filters with
  // nothing said. The sentence over it exists to announce a consequence, so
  // the consequence has to be the whole of it.
  removeTag(id) {
    const before = {
      tags: this.tags, places: this.places, routes: this.routes, books: this.books,
    };
    if (!beginTagDelete()) {
      onWriteFailed?.(K_TAG_DELETE, new Error('the tag deletion could not be journalled'));
      return null;
    }
    const off = list => list.map(rec => (rec.tags || []).includes(id)
      ? { ...rec, tags: rec.tags.filter(tid => tid !== id) }
      : rec);
    this.tags = this.tags.filter(t => t.id !== id);
    this.places = off(this.places);
    this.routes = off(this.routes);
    this.books = off(this.books);

    const ok = this.saveTags() && this.savePlaces() && this.saveRoutes() && this.saveBooks();
    if (ok && finishTagDelete()) return true;

    // A deletion spans four localStorage keys. Put both memory and every key
    // already written back before reporting failure, so a one-key refusal
    // cannot leave orphaned tag ids after reload.
    this.tags = before.tags;
    this.places = before.places;
    this.routes = before.routes;
    this.books = before.books;
    // Replay exact pre-transaction bytes. If storage refuses again the journal
    // remains, and the next load retries this before reading any of the four
    // collections.
    recoverTagDelete();
    return null;
  },

  // What rides a tag, counted by kind. It counted places alone, so a word
  // gathering six places and six books was reported as six, and the question
  // before a removal named six of the twelve records it was about to reach.
  // `total` is what a row shows and the parts are what the question says, and
  // both come from here so neither can drift from the other again.
  tagCensus(id) {
    const on = (list) => list.reduce((n, r) => n + (r.tags.includes(id) ? 1 : 0), 0);
    const places = on(this.places), paths = on(this.routes), books = on(this.books);
    return { places, paths, books, total: places + paths + books };
  },

  // erase means erase: every resonate key leaves the device. `defer` keeps the
  // exact pre-erase bytes journalled while the caller clears the two IndexedDB
  // stores; without it this remains a complete localStorage transaction for
  // the few direct callers and tests that own no other store.
  clearAll({ defer = false, context = null } = {}) {
    const { clubKey, clubUrl, clubSeq, clubSealedAt } = this.settings;
    const settings = { ...DEFAULT_SETTINGS, seeded: true, erasedAt: new Date().toISOString(),
      clubKey, clubUrl, clubSeq, clubSealedAt };
    if (!beginErase(context)) return false;
    const journal = eraseJournal();
    if (!journal) return false;

    try {
      for (const key of Object.keys(journal.before)) {
        localStorage.removeItem(key);
        if (localStorage.getItem(key) !== null) throw new Error('storage refused an erase');
      }
      const left = Object.keys(localStorage)
        .filter(key => key.startsWith('resonate.') && key !== K_ERASE);
      if (left.length) throw new Error('new local state appeared during the erase');
      const rawSettings = JSON.stringify(settings);
      localStorage.setItem(K_SETTINGS, rawSettings);
      if (localStorage.getItem(K_SETTINGS) !== rawSettings) throw new Error('storage refused the erased marker');
    } catch {
      if (restoreErase()) finishErase();
      return false;
    }

    this.places = [];
    this.routes = [];
    this.books = [];
    this.folios = [];
    this.tags = [];
    this.correspondents = [];
    // the identity and the local box ledger go with everything else. an
    // erased device is not a device with an unmentioned private key or inbox.
    this.letters = { v: 1, jwk: null, pub: '', route: '', pairs: [] };
    this.post = { v: 1, done: [] };
    this.lastLost = [];
    this.settings = settings;

    if (defer) return true;
    if (!markEraseCommitted()) {
      if (restoreErase()) { this.load(); finishErase(); }
      return false;
    }
    const finished = finishErase();
    if (finished) sealed.clear();
    return finished;
  },

  pendingClearAll() {
    const journal = eraseJournal();
    return journal ? { state: journal.state, context: journal.context ?? null } : null;
  },

  rollbackClearAll({ reload = true } = {}) {
    if (!restoreErase()) return false;
    if (reload) this.load();
    return true;
  },

  commitClearAll() { return markEraseCommitted(); },

  finishClearAll() {
    const finished = finishErase();
    if (finished) sealed.clear();
    return finished;
  },

  // Read a person's own archive and refuse it if anything at all was lost in
  // the reading. Returns { value, lost: [...], setAside: [...] }; `lost` is
  // the whole list, so a caller can name the record and the field rather than
  // say "some".
  //
  // `setAside` is the other channel, and it is not a loss: a file written
  // before photographs left a record still carries them, and this build keeps
  // none of them. Nothing is destroyed by that reading, because the file is
  // untouched, so it must not stop the restore. It must still be said, which
  // is why it comes out of here rather than being dropped on the floor.
  readOwn(raw) {
    const read = readArchive(raw);
    if (!read) return { value: null, lost: [], setAside: [] };
    return { value: read.value, lost: losses(read), setAside: setAside(read) };
  },

  // merge imported data, deduping by id; imported fields that reach markup are normalized
  // `own` marks a person's own archive coming home: read through the door
  // that shortens nothing. Returns null when the archive lost something in
  // the reading or the device refused the write, a count otherwise.
  merge(raw, { own = false } = {}) {
    const read = own ? this.readOwn(raw) : null;
    // everything the file carried that could not be kept exactly. an archive
    // that lost anything is not merged at all: the caller is handed the list
    // and the person is told what and where.
    this.lastLost = own ? (read?.lost ?? []) : [];
    if (own && this.lastLost.length) return null;
    const data = own ? read?.value : normImport(raw);
    if (!data) return 0;
    // held so the whole import can be undone if any part of it is refused
    const before = {
      places: [...this.places], tags: [...this.tags],
      routes: [...this.routes], folios: [...this.folios],
      books: [...this.books], correspondents: [...this.correspondents],
      settings: { ...this.settings },
    };
    // This describes the atlas before the arriving records are appended. The
    // old check ran after that append, so the first imported place made an
    // actually empty atlas look dressed and its portable look was skipped.
    const undressed = !this.settings.chosen && !this.places.length;
    const tagIds = new Set(this.tags.map(t => t.id));
    const placeIds = new Set(this.places.map(p => p.id));
    let added = 0;
    // same name, same tag: never two Restaurants with different ids
    const byName = new Map(this.tags.map(t => [t.name.trim().toLowerCase(), t.id]));
    const remap = new Map();
    data.tags.forEach(t => {
      if (tagIds.has(t.id)) return;
      const existing = byName.get(t.name.trim().toLowerCase());
      if (existing) { remap.set(t.id, existing); return; }
      added++;
      this.tags.push(newTag(t));
      tagIds.add(t.id);
      byName.set(t.name.trim().toLowerCase(), t.id);
    });
    const repoint = (ids) => ids.map(id => remap.get(id) || id);
    data.places.forEach(p => {
      if (!placeIds.has(p.id)) {
        this.places.push(newPlace({ ...p, tags: repoint(p.tags) }));
        placeIds.add(p.id);
        added++;
      }
    });
    const routeIds = new Set(this.routes.map(r => r.id));
    data.routes.forEach(r => {
      if (!routeIds.has(r.id)) {
        this.routes.push(newRoute({ ...r, tags: repoint(r.tags) }));
        routeIds.add(r.id);
        added++;
      }
    });
    const folioIds = new Set(this.folios.map(f => f.id));
    data.folios.forEach(f => {
      if (!folioIds.has(f.id)) {
        this.folios.push(newFolio(f));
        folioIds.add(f.id);
        added++;
      }
    });
    const bookIds = new Set(this.books.map(b => b.id));
    (data.books || []).forEach(b => {
      if (!bookIds.has(b.id)) {
        this.books.push(newBook({ ...b, tags: repoint(b.tags || []) }));
        bookIds.add(b.id);
        added++;
      }
    });
    // an export carries the whole atlas back, correspondents and signature included
    const corrIds = new Set(this.correspondents.map(c => c.id));
    data.correspondents.forEach(c => {
      if (!corrIds.has(c.id)) {
        this.correspondents.push({
          ...c,
          hue: Number.isFinite(c.hue) ? c.hue : TAG_STATIONS[(this.correspondents.length + 2) % TAG_STATIONS.length].hue,
          tags: c.tags.map(t => newTag(t)),
        });
        corrIds.add(c.id);
        added++;
      }
    });
    // a merge adds; it does not repaint an atlas that already has a look.
    // only what this device has not decided for itself is taken.
    if (!this.settings.authorName && data.settings.authorName) {
      this.settings.authorName = data.settings.authorName;
    }
    // the look is a decision this device made and a merge is not the place to
    // overturn it. only an atlas that has never been dressed takes the file's
    // colour; restore, which is the operation that means "be this file", sets
    // the whole of it.
    if (undressed) {
      if (data.settings.theme) this.settings.theme = data.settings.theme;
      if (Number.isFinite(Number(data.settings.hue))) this.settings.hue = Number(data.settings.hue);
      if (Number.isFinite(Number(data.settings.split))) this.settings.split = Number(data.settings.split);
    }
    // an import is one act: if any part of it cannot be written, none of it
    // is kept, and the caller is told nothing came in
    const ok = this.savePlaces() && this.saveTags() && this.saveRoutes()
      && this.saveFolios() && this.saveBooks() && this.saveCorrespondents()
      && this.saveSettings();
    if (!ok) {
      this.places = before.places;
      this.tags = before.tags;
      this.routes = before.routes;
      this.folios = before.folios;
      this.books = before.books;
      this.correspondents = before.correspondents;
      this.settings = before.settings;
      this.savePlaces(); this.saveTags(); this.saveRoutes(); this.saveFolios();
      this.saveBooks(); this.saveCorrespondents(); this.saveSettings();
      return null; // refused is not the same as nothing new
    }
    return added;
  },

  // ---------- restore ----------
  //
  // Merge and restore are not the same operation, and pretending they were is
  // why "import backup" could not bring back an older note, a damaged place,
  // an earlier name, or an earlier shape of a way. A merge adds what is
  // missing and touches nothing that already exists. A restore says: this
  // file is the atlas now.
  //
  // Restore replaces. It refuses an archive that lost anything in the reading,
  // it refuses to write half of one, and it puts everything back exactly as it
  // was if any part of the write is refused. What it cannot do is undo itself
  // afterwards: the caller takes a snapshot first, and the surface says so.
  //
  // Returns { ok, lost, was, now } — `was` and `now` are counts, so a person
  // can be shown what this will cost before they agree to it.
  restore(raw) {
    const read = this.readOwn(raw);
    this.lastLost = read.lost;
    if (!read.value) return { ok: false, lost: read.lost, reason: 'unreadable' };
    if (read.lost.length) return { ok: false, lost: read.lost, reason: 'lossy' };
    const d = read.value;

    const before = {
      places: [...this.places], tags: [...this.tags], routes: [...this.routes],
      folios: [...this.folios], books: [...this.books],
      correspondents: [...this.correspondents],
      settings: { ...this.settings },
    };
    const was = {
      places: before.places.length, routes: before.routes.length,
      tags: before.tags.length, folios: before.folios.length,
      books: before.books.length,
      correspondents: before.correspondents.length,
    };

    this.places = d.places.map(p => newPlace({ ...p }));
    this.routes = d.routes.map(r => newRoute({ ...r }));
    this.tags = d.tags.map(t => newTag(t));
    this.folios = d.folios.map(f => newFolio(f));
    this.books = (d.books || []).map(b => newBook({ ...b }));
    this.correspondents = d.correspondents.map(c => ({
      ...c, tags: (c.tags || []).map(t => newTag(t)),
    }));
    // the club key is this device's own credential and belongs to the device,
    // not to the file; the rest of the look and the byline come from the file
    const { clubKey, clubUrl, clubSeq, clubSealedAt } = this.settings;
    this.settings = {
      ...DEFAULT_SETTINGS, ...d.settings,
      seeded: true, chosen: true,
      clubKey, clubUrl, clubSeq, clubSealedAt,
    };

    const ok = this.savePlaces() && this.saveTags() && this.saveRoutes()
      && this.saveFolios() && this.saveBooks() && this.saveCorrespondents() && this.saveSettings();
    if (!ok) {
      this.places = before.places;
      this.tags = before.tags;
      this.routes = before.routes;
      this.folios = before.folios;
      this.books = before.books;
      this.correspondents = before.correspondents;
      this.settings = before.settings;
      this.savePlaces(); this.saveTags(); this.saveRoutes();
      this.saveFolios(); this.saveBooks(); this.saveCorrespondents(); this.saveSettings();
      return { ok: false, lost: [], reason: 'refused', was, now: was };
    }
    return {
      ok: true, lost: [], was,
      now: {
        places: this.places.length, routes: this.routes.length,
        tags: this.tags.length, folios: this.folios.length,
        books: this.books.length,
        correspondents: this.correspondents.length,
      },
    };
  },

  // What a merge would change, without changing anything. A person deciding
  // between adding and replacing deserves to see the difference first.
  // What a restore or a merge would do, said before either is pressed.
  //
  // Three defects stood here at once, and each let the panel misdescribe a
  // destructive operation. Equality was JSON.stringify, so key insertion
  // order counted as difference and a rebuilt record could differ from
  // itself; that bit twice. A path was compared by geometry alone, so a way
  // renamed, re-noted, or newly marked never-to-leave read as identical.
  // And "only here" pooled every id into one untyped set, so a place and a
  // tag sharing a raw id could mask one another.
  //
  // Now: every kind restore replaces is compared, both sides are prepared by
  // the same builders restore itself uses, equality is canonical (order
  // cannot count), and identity is typed. The panel's numbers are held to
  // the operations by two invariant tests: fresh is what merge adds, and
  // changed plus onlyHere is what a replace actually touches.
  compare(raw) {
    const read = this.readOwn(raw);
    if (!read.value) return null;
    const d = read.value;

    // a seeded record stops being seeded the moment it is adopted or edited,
    // and the file it came from never carried the mark at all. counting that
    // as a difference would tell a person their atlas had changed when only
    // the mark had.
    const carrier = (r) => { const { sample, ...rest } = r; return rest; };

    const kind = (mineList, theirsList, prepare) => {
      const mine = new Map(mineList.map(r => [r.id, r]));
      const theirs = new Map(theirsList.map(r => [r.id, r]));
      const out = { fresh: [], changed: [], identical: [], onlyHere: [] };
      for (const [id, r] of theirs) {
        const held = mine.get(id);
        if (!held) out.fresh.push(id);
        else if (semanticallyEqual(carrier(prepare({ ...r, id })), carrier(prepare({ ...held })))) out.identical.push(id);
        else out.changed.push(id);
      }
      for (const id of mine.keys()) if (!theirs.has(id)) out.onlyHere.push(id);
      return out;
    };

    // each kind prepared exactly as restore prepares it, on both sides: a
    // normalized incoming record must never stand against an unnormalized
    // held one, or the panel reports the normalizer's tidying as a change
    const byKind = {
      places: kind(this.places, d.places, p => newPlace({ ...p })),
      paths: kind(this.routes, d.routes, r => newRoute({ ...r })),
      tags: kind(this.tags, d.tags, t => newTag(t)),
      folios: kind(this.folios, d.folios, f => newFolio(f)),
      books: kind(this.books, d.books || [], b => newBook({ ...b })),
      voices: kind(this.correspondents, d.correspondents,
        c => ({ ...c, tags: (c.tags || []).map(t => newTag(t)) })),
    };

    // merge does not add a tag whose name is already held under another id;
    // it repoints the records that used it. counting one as fresh would make
    // the panel promise an addition merge will not perform.
    const heldTagNames = new Set(this.tags.map(t => t.name.trim().toLowerCase()));
    const theirTags = new Map(d.tags.map(t => [t.id, t]));
    byKind.tags.fresh = byKind.tags.fresh.filter(id => {
      const t = theirTags.get(id);
      return !heldTagNames.has(t.name.trim().toLowerCase());
    });

    // the settings a restore would carry across, diffed as restored: a file
    // that says nothing about the theme still sets the default theme. the
    // held side is read through the same defaults load() spreads, so a
    // sparse settings object cannot invent a difference.
    const eff = { ...DEFAULT_SETTINGS, ...d.settings };
    const heldEff = { ...DEFAULT_SETTINGS, ...this.settings };
    const settings = {
      changed: PORTABLE_SETTINGS.filter(k =>
        !semanticallyEqual(eff[k] ?? null, heldEff[k] ?? null)),
    };

    const sum = (field) => Object.values(byKind).reduce((n, k) => n + k[field].length, 0);
    return {
      fresh: sum('fresh'), differ: sum('changed'), identical: sum('identical'),
      onlyHere: sum('onlyHere'),
      byKind, settings,
      lost: read.lost, setAside: read.setAside,
    };
  },

  // what may be handed to someone else: the atlas without the private layer.
  // a file offered in place of a link is the same disclosure, or the panel
  // that describes one is describing the other.
  // the first and last stretch of a way is where a person lives: when asked,
  // the shape handed over begins and ends a quarter kilometre in
  trimWay(r) { return trimWay(r); },

  // What a stranger may be given, in a file.
  //
  // This used to spread whole records and hand over every tag in the
  // atlas, while the link beside it was an explicit field list. Same panel,
  // same promise, two different disclosures: the file quietly added the dates
  // every record was made and touched, tags the person had never used, and
  // any field a later release happened to add. It is the same object as the
  // link now. Only the carrier differs.
  outward() {
    const places = this.places.filter(mayLeave);
    // a way whose ends cannot be hidden is not handed over at all
    const routes = this.routes.filter(mayLeave).map(trimWay).filter(Boolean);
    const books = this.books.filter(mayLeave);
    const used = new Set([...places, ...routes, ...books].flatMap(x => x.tags || []));
    const tags = this.tags.filter(t => used.has(t.id));
    return buildPayload('atlas', { places, routes, books, tags, author: this.settings.authorName || '' });
  },

  // ---------- two files, one disclosure ----------
  //
  // A person hands a friend a file. A person hands an assistant a file. The
  // atlas inside them is the same atlas, built by the one function above from
  // the same records under the same rules, and that is the promise worth
  // keeping: an assistant is given what a friend is given and not one field
  // more.
  //
  // It was written down as the stronger-sounding claim that the two files are
  // byte for byte the same, and that was never true: the assistant copy names
  // the terms it was handed over under and the friend's copy has no terms to
  // name. Byte equality is also the wrong invariant to promise, because it
  // fails the moment either file gains a line about itself, and then the
  // document is wrong rather than the code.
  //
  // So the disclosure is nested here instead of spread. An assistant-only
  // field can never drift into the shape a handover has, the two files can be
  // compared where they should be equal, and the file says which of the kinds
  // it is in a word rather than leaving a reader to infer it from shape.
  // The handover names its kind from inside the disclosure, where `kind` has
  // always lived and where the payload gate reads it. A second `kind` written
  // above the spread would be overwritten by the disclosure's own and is the
  // sort of line that reads true and is not.
  humanHandoverJSON() {
    return JSON.stringify({
      app: 'resonate',
      exportedAt: new Date().toISOString(),
      ...this.outward(),
    }, null, 2);
  },

  assistantCopyJSON() {
    return JSON.stringify({
      app: 'resonate',
      kind: 'assistant_copy',
      exportedAt: new Date().toISOString(),
      // What this document is held to, in one address a machine can follow and
      // a person can read. It is hardcoded rather than read off location,
      // because this module is imported by node with a localStorage shim and
      // no origin at all, and because the documents already name the site.
      terms: ASSISTANT_TERMS,
      disclosure: this.outward(),
    }, null, 2);
  },

  // the records alone, for a snapshot: this is the whole atlas now
  recordsJSON() {
    return JSON.stringify({
      app: 'resonate', version: ARCHIVE_VERSION, at: new Date().toISOString(),
      tags: this.tags, places: this.places, routes: this.routes,
      folios: this.folios, books: this.books, correspondents: this.correspondents,
    });
  },

  // everything, for yourself: voices and settings included
  //
  // This used to be handed two things and is handed neither now: a function
  // that read pictures back out of their own store on the way out, and a way
  // for the export path to mark a file that had gone short of one. Nothing but
  // a picture could make a file short, and a record names none. So there is
  // nothing left to fetch, which is why this no longer waits. Everything it
  // writes is already in memory.
  exportJSON() {
    return JSON.stringify({
      app: 'resonate',
      version: ARCHIVE_VERSION,
      exportedAt: new Date().toISOString(),
      tags: this.tags,
      places: this.places,
      routes: this.routes,
      folios: this.folios,
      books: this.books,
      correspondents: this.correspondents,
      // the club key is a bearer credential for the vault itself: it never
      // rides in a file that leaves this device
      settings: { ...this.settings, clubKey: '' },
    }, null, 2);
  },

  // An atlas must be able to leave for anywhere, in formats nobody owns.
  // Each of these carries what may travel: never a place or a way marked as
  // never leaving, and never the ends of a way whose ends are trimmed.

  // kml, for google earth and everything that reads it
  exportKML() {
    const esc = t => String(t ?? '').replace(/[<>&'"]/g, c => (
      { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
    const marks = this.places.filter(mayLeave).map(p => `    <Placemark>
      <name>${esc(p.name)}</name>
      <description>${esc([p.note, [p.address, p.city, p.country].filter(Boolean).join(', ')].filter(Boolean).join('\n\n'))}</description>
      <Point><coordinates>${p.lng},${p.lat},0</coordinates></Point>
    </Placemark>`).join('\n');
    const lines = this.routes.filter(mayLeave).map(trimWay).filter(Boolean).map(r => `    <Placemark>
      <name>${esc(r.name)}</name>
      <LineString><tessellate>1</tessellate><coordinates>${r.path.map(pt => `${pt.lng},${pt.lat},${pt.ele ?? 0}`).join(' ')}</coordinates></LineString>
    </Placemark>`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Resonate</name>
${[marks, lines].filter(Boolean).join('\n')}
  </Document>
</kml>`;
  },

  // csv, for a spreadsheet and for anything at all
  exportCSV() {
    const cell = v => {
      const t = String(v ?? '');
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const head = ['name', 'latitude', 'longitude', 'address', 'city', 'country', 'tags', 'been', 'note', 'link'];
    const rows = this.places.filter(mayLeave).map(p => [
      p.name, p.lat, p.lng, p.address, p.city, p.country,
      p.tags.map(id => this.tagById(id)?.name).filter(Boolean).join('; '),
      p.status === 'visited' ? 'yes' : 'no',
      p.note, p.url,
    ].map(cell).join(','));
    return [head.join(','), ...rows].join('\n');
  },

  // markdown, so an atlas outlives every program that can read the rest
  //
  // The heading is the key the whole atlas is organised by, out of find.js, so
  // a city in this document is the city the composer, the index, the command
  // line and the printed sheet all name. It was computed here instead, as
  // `p.city || p.country`, and a second key gives a second answer: it dropped
  // the country, so the Springfield in the United States and the Springfield
  // in Australia were written out under one heading as though a person kept
  // six places in a single city. That is exactly the confusion cityLabel
  // carries the country to prevent.
  exportMarkdown() {
    const byCity = new Map();
    this.places.filter(mayLeave).forEach(p => {
      const key = cityLabel(p);
      if (!byCity.has(key)) byCity.set(key, []);
      byCity.get(key).push(p);
    });
    const out = ['# An atlas', '', `${this.places.filter(mayLeave).length} places, kept in a browser and written out on ${new Date().toISOString().slice(0, 10)}.`, ''];
    // alphabetical, because a document is read from front to back rather than
    // chosen from, and the placeless last, where every other surface in this
    // app gathers them.
    [...byCity.keys()].sort((a, b) => {
      if ((a === PLACELESS) !== (b === PLACELESS)) return a === PLACELESS ? 1 : -1;
      return a.localeCompare(b);
    }).forEach(city => {
      out.push(`## ${city}`, '');
      byCity.get(city).sort((a, b) => a.name.localeCompare(b.name)).forEach(p => {
        out.push(`### ${p.name}`);
        const facts = [
          [p.address, p.country].filter(Boolean).join(', '),
          p.status === 'visited' ? 'been' : 'want to go',
          p.tags.map(id => this.tagById(id)?.name).filter(Boolean).join(', '),
          `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`,
        ].filter(Boolean);
        out.push('', facts.join(' · '), '');
        if (p.note) out.push(p.note, '');
        if (p.url) out.push(`<${p.url}>`, '');
        if (p.provenance) {
          const road = [...(p.provenance.chain || []).map(h => h.name), p.provenance.name].filter(Boolean);
          out.push(`_after ${road.reverse().join(', who had it from ')}_`, '');
        }
      });
    });
    const ways = this.routes.filter(mayLeave).map(trimWay).filter(Boolean);
    if (ways.length) {
      out.push('## Ways', '');
      ways.forEach(r => {
        out.push(`### ${r.name}`, '');
        out.push([r.km ? `${r.km.toFixed(1)} km` : '', r.ascent ? `${r.ascent} m up` : '', r.loop ? 'a loop' : ''].filter(Boolean).join(' · '), '');
        if (r.note) out.push(r.note, '');
      });
    }
    return out.join('\n');
  },

  exportGeoJSON() {
    return JSON.stringify({
      type: 'FeatureCollection',
      features: this.places.filter(mayLeave).map(p => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        properties: {
          name: p.name,
          address: p.address,
          city: p.city,
          country: p.country,
          tags: p.tags.map(id => this.tagById(id)?.name).filter(Boolean),
          status: p.status,
          visited: p.status === 'visited',
          note: p.note,
          url: p.url,
        },
      })),
    }, null, 2);
  },
};

// ---------- the starting vocabulary ----------
//
// An atlas with no tags cannot file anything, so even an empty start is
// given these. They are ordinary tags: rename them, recolour them, remove them.

export function baseTags() {
  // eight tags onto the eight stations of the wheel, one each, stated
  // rather than derived: two tags that land on the same hue would ink the
  // world identically and stop telling you anything
  const at = (i, name, emoji) =>
    newTag({ name, emoji, hue: TAG_STATIONS[i].hue, color: TAG_STATIONS[i].hex });
  return {
    food: at(0, 'Restaurants', '🍽️'),
    cafe: at(1, 'Cafés', '☕'),
    // ground that is protected, and asks something of you in return
    reserve: at(2, 'Reserves', '🌿'),
    nature: at(3, 'Nature', '⛰️'),
    culture: at(4, 'Culture', '🖼️'),
    // a hut is what turns a long day into two: a roof, a meal, a bunk high up
    hut: at(5, 'Huts', '🛖'),
    bar: at(6, 'Bars', '🍸'),
    shop: at(7, 'Shops', '🧺'),
  };
}

// ---------- the atlas this app arrives with ----------
//
// Real places, kept by people who travel. They behave like any other record
// here and they travel like any other record, which the owner settled when the
// word for them was retired. What they may not do is speak in the first person.
//
// They used to. Every one of them said `visited`, which in this app means the
// person holding the atlas went; several carried hearts from Marta, Léa,
// Tomas, Nina and Sofia, which in this app means somebody thanked that person
// for sending them there. Open the full atlas, type a byline, hand it over,
// and eighteen visits nobody made travelled under a real name, carrying
// gratitude nobody sent. Sealing that into a paid backup would have preserved
// it perfectly rather than corrected it.
//
// So: nothing here claims a visit. Everything arrives as a place worth going
// to, which is what it is. The hearts are gone, because a heart is a real
// arrival from a real person and none of these arrived. And where one of the
// voices below actually holds the same place, the record says so and carries
// their id, so the plate names the road and a thanks can travel back along it.
// The voices keep their own `visited`, because those are their claims about
// their own lives and they are the only claims here anybody made.
//
// The moment a person edits one it becomes theirs, `sample` clears, and every
// word in it is their own. That is the only door between the two states.

export function demoData() {
  const t = baseTags();
  const day = 86400000;
  const ago = n => new Date(Date.now() - n * day).toISOString();
  const P = (partial, daysAgo) => newPlace({ ...partial, createdAt: ago(daysAgo), updatedAt: ago(daysAgo) });

  const places = [
    P({ name: 'Fondation Beyeler', lat: 47.58487, lng: 7.65098, city: 'Riehen', country: 'Switzerland', countryCode: 'ch',
        address: 'Baselstrasse 101, 4125 Riehen', tags: [t.culture.id], status: 'wishlist',
        note: 'Monet water lilies in front of the pond window. Go on a weekday morning and have the Rothko room to yourself.' }, 4),
    P({ name: 'Kunstmuseum Basel', lat: 47.55437, lng: 7.59417, city: 'Basel', country: 'Switzerland', countryCode: 'ch',
        address: 'St. Alban-Graben 16, 4051 Basel', tags: [t.culture.id], status: 'wishlist',
        note: 'The Holbein rooms. Quiet on Friday evenings.' }, 21),
    P({ name: 'Rheinbad Breite', lat: 47.55330, lng: 7.60530, city: 'Basel', country: 'Switzerland', countryCode: 'ch',
        address: 'St. Alban-Rheinweg 195, 4052 Basel', tags: [t.nature.id], status: 'wishlist',
        note: 'Drop in here, float past the Münster, out at Dreirosen. The whole city swims home in summer.',
        provenance: { name: 'Tomas', adoptedAt: ago(9), chain: [], srcId: 'tomas_rheinbad' } }, 9),
    P({ name: 'Markthalle Basel', lat: 47.54790, lng: 7.58750, city: 'Basel', country: 'Switzerland', countryCode: 'ch',
        address: 'Steinentorberg 20, 4051 Basel', tags: [t.food.id], status: 'wishlist',
        note: 'Lunch under the dome. The momo stand first, always.',
        provenance: { name: 'Tomas', adoptedAt: ago(60), chain: [], srcId: 'tomas_markthalle' } }, 60),
    P({ name: 'Shakespeare and Company', lat: 48.85258, lng: 2.34710, city: 'Paris', country: 'France', countryCode: 'fr',
        address: '37 Rue de la Bûcherie, 75005 Paris', tags: [t.shop.id, t.culture.id], status: 'wishlist',
        note: 'Upstairs, the reading nook facing Notre-Dame. They stamp the books at the till.' }, 130),
    P({ name: 'Septime', lat: 48.85310, lng: 2.38390, city: 'Paris', country: 'France', countryCode: 'fr',
        address: '80 Rue de Charonne, 75011 Paris', tags: [t.food.id], status: 'wishlist',
        note: 'Book three weeks ahead, lunch is the way in.',
        provenance: { name: 'Marta', adoptedAt: ago(130), chain: [], srcId: 'mp_septime' } }, 130),
    P({ name: 'Noma', lat: 55.68286, lng: 12.61033, city: 'Copenhagen', country: 'Denmark', countryCode: 'dk',
        address: 'Refshalevej 96, 1432 København', tags: [t.food.id], status: 'wishlist',
        note: 'Vegetable season, if it ever works out.',
        provenance: { name: 'Clara', adoptedAt: ago(200), chain: [], srcId: 'clara_noma' } }, 200),
    P({ name: 'La Colombe d’Or', lat: 43.69690, lng: 7.12190, city: 'Saint-Paul-de-Vence', country: 'France', countryCode: 'fr',
        address: 'Place du Général de Gaulle, 06570 Saint-Paul-de-Vence', tags: [t.food.id, t.culture.id], status: 'wishlist',
        note: 'Légers and Picassos on the terrace walls. Lunch under the fig tree.',
        provenance: { name: 'Camille', adoptedAt: ago(88), chain: [], srcId: 'camille_colombe' } }, 88),
    P({ name: 'Meguro River cherry blossoms', lat: 35.64430, lng: 139.69830, city: 'Tokyo', country: 'Japan', countryCode: 'jp',
        address: 'Nakameguro, Meguro City, Tokyo', tags: [t.nature.id], status: 'wishlist',
        note: 'Late March, dusk, lanterns on. Walk from Nakameguro station south.',
        provenance: { name: 'Kenji', adoptedAt: ago(300), chain: [], srcId: 'kenji_meguro' } }, 300),
    P({ name: 'Onibus Coffee Nakameguro', lat: 35.64440, lng: 139.69940, city: 'Tokyo', country: 'Japan', countryCode: 'jp',
        address: '2-14-1 Kamimeguro, Meguro City, Tokyo', tags: [t.cafe.id], status: 'wishlist',
        note: 'The little house by the tracks. Upstairs window seat.',
        provenance: { name: 'Kenji', adoptedAt: ago(290), chain: [{ name: 'Yuki', at: ago(340) }], srcId: 'kenji_onibus' } }, 300),
    P({ name: 'Bethesda Terrace', lat: 40.77400, lng: -73.97080, city: 'New York', country: 'United States', countryCode: 'us',
        address: 'Central Park, New York, NY', tags: [t.nature.id], status: 'wishlist',
        note: 'The tiled arcade underneath, when a cellist is playing.',
        provenance: { name: 'Sam', adoptedAt: ago(400), chain: [], srcId: 'sam_bethesda' } }, 400),
    P({ name: 'Café Sabarsky', lat: 40.78110, lng: -73.96010, city: 'New York', country: 'United States', countryCode: 'us',
        address: '1048 5th Ave, New York, NY', tags: [t.cafe.id], status: 'wishlist',
        note: 'Viennese breakfast before the Klimts upstairs.',
        provenance: { name: 'Sam', adoptedAt: ago(390), chain: [], srcId: 'sam_sabarsky' } }, 400),
    P({ name: 'Vernazza', lat: 44.13500, lng: 9.68400, city: 'Vernazza', country: 'Italy', countryCode: 'it',
        address: 'Cinque Terre, Liguria', tags: [t.nature.id], status: 'wishlist',
        note: 'Hike in from Monterosso, swim off the harbour rocks, then anchovies and white wine.' }, 500),
    P({ name: 'Bar Basso', lat: 45.47850, lng: 9.22270, city: 'Milan', country: 'Italy', countryCode: 'it',
        address: 'Via Plinio 39, 20133 Milano', tags: [t.bar.id], status: 'wishlist',
        note: 'The negroni sbagliato was invented here. Giant glasses.',
        provenance: { name: 'Marco', adoptedAt: ago(45), chain: [], srcId: 'marco_basso' } }, 45),

    // paris, thickened: enough of one city that composing a folio from it
    // feels like the real act
    P({ name: 'Chez Georges', lat: 48.86657, lng: 2.34156, city: 'Paris', country: 'France', countryCode: 'fr',
        address: '1 Rue du Mail, 75002 Paris', tags: [t.food.id], status: 'wishlist',
        note: 'Steak frites, wine by the carafe, a dining room that has not moved in decades. Lunch.',
        provenance: { name: 'L\u00e9a', adoptedAt: ago(34), chain: [], srcId: 'lea_georges' } }, 34),
    P({ name: 'Harry\u2019s New York Bar', lat: 48.86970, lng: 2.33250, city: 'Paris', country: 'France', countryCode: 'fr',
        address: '5 Rue Daunou, 75002 Paris', tags: [t.bar.id], status: 'wishlist',
        note: 'The Boulevardier was first mixed here. Order the hot dog, nobody warns you about the hot dog.' }, 34),
    P({ name: 'March\u00e9 des Enfants Rouges', lat: 48.86285, lng: 2.36174, city: 'Paris', country: 'France', countryCode: 'fr',
        address: '39 Rue de Bretagne, 75003 Paris', tags: [t.food.id], status: 'wishlist',
        note: 'The oldest covered market in the city. Eat at the counters and take the queue that moves slowest.',
        provenance: { name: 'L\u00e9a', adoptedAt: ago(76), chain: [], srcId: 'lea_enfants' } }, 76),
    P({ name: 'Ogata', lat: 48.86190, lng: 2.36440, city: 'Paris', country: 'France', countryCode: 'fr',
        address: '16 Rue Debelleyme, 75003 Paris', tags: [t.cafe.id, t.culture.id], status: 'wishlist',
        note: 'Tea house, restaurant and gallery carved into one Marais mansion. Reserve, then slow down.',
        provenance: { name: 'Marta', adoptedAt: ago(30), chain: [], srcId: 'mp_ogata' } }, 30),
    P({ name: 'Le Grand V\u00e9four', lat: 48.86640, lng: 2.33770, city: 'Paris', country: 'France', countryCode: 'fr',
        address: '17 Rue de Beaujolais, 75001 Paris', tags: [t.food.id, t.culture.id], status: 'wishlist',
        note: 'Eighteenth-century rooms on the Palais-Royal garden. The once-a-trip splurge.' }, 90),
    P({ name: 'Librairie Galignani', lat: 48.86540, lng: 2.32870, city: 'Paris', country: 'France', countryCode: 'fr',
        address: '224 Rue de Rivoli, 75001 Paris', tags: [t.shop.id], status: 'wishlist',
        note: 'Under the Rivoli arcades since 1801. Stock up before the Tuileries.' }, 76),

    // london, new ground: a second thick city for asks and folios
    P({ name: 'St. John Bread and Wine', lat: 51.51970, lng: -0.07450, city: 'London', country: 'United Kingdom', countryCode: 'gb',
        address: '94-96 Commercial St, London E1 6LZ', tags: [t.food.id], status: 'wishlist',
        note: 'Nose-to-tail without ceremony, across from Spitalfields. Open Sunday nights, which matters here.',
        provenance: { name: 'Ruth', adoptedAt: ago(52), chain: [], srcId: 'ruth_stjohn' } }, 52),
    P({ name: 'Gymkhana', lat: 51.50900, lng: -0.14190, city: 'London', country: 'United Kingdom', countryCode: 'gb',
        address: '42 Albemarle St, London W1S 4JH', tags: [t.food.id], status: 'wishlist',
        note: 'Refined Indian in clubby Mayfair rooms, open seven days. Book lunch weeks out.' }, 52),
    P({ name: 'J. Sheekey', lat: 51.51120, lng: -0.12790, city: 'London', country: 'United Kingdom', countryCode: 'gb',
        address: '28-32 St Martin\u2019s Ct, London WC2N 4AL', tags: [t.food.id], status: 'wishlist',
        note: 'Fish and martinis in a theatreland alley since 1896. Sunday dinner when everything else is shut.' }, 140),
    P({ name: 'Rochelle Canteen', lat: 51.52660, lng: -0.07330, city: 'London', country: 'United Kingdom', countryCode: 'gb',
        address: '16 Playground Gardens, London E2 7FA', tags: [t.food.id], status: 'wishlist',
        note: 'Lunch in a converted bike shed behind a school wall on Arnold Circus. Ring the buzzer.',
        provenance: { name: 'Nina', adoptedAt: ago(18), chain: [], srcId: 'bp_rochelle' } }, 18),
    P({ name: 'Dukes Bar', lat: 51.50510, lng: -0.13990, city: 'London', country: 'United Kingdom', countryCode: 'gb',
        address: '35 St James\u2019s Pl, London SW1A 1NY', tags: [t.bar.id], status: 'wishlist',
        note: 'Tableside martinis, no reservations. Two is the house limit and they mean it.' }, 140),
    P({ name: 'Paul Rothe & Son', lat: 51.51770, lng: -0.14990, city: 'London', country: 'United Kingdom', countryCode: 'gb',
        address: '35 Marylebone Ln, London W1U 2NN', tags: [t.cafe.id], status: 'wishlist',
        note: 'Sandwiches from the same family since 1900, walls lined with every condiment there is. Take a stool.' }, 52),
    P({ name: 'Portobello Road Market', lat: 51.51730, lng: -0.20590, city: 'London', country: 'United Kingdom', countryCode: 'gb',
        address: 'Portobello Rd, London W11', tags: [t.shop.id], status: 'wishlist',
        note: 'Friday for the serious dealers, Saturday for everything else. Silver at the Notting Hill end.',
        provenance: { name: 'Ruth', adoptedAt: ago(8), chain: [], srcId: 'ruth_portobello' } }, 8),
  ];

  places.push(
    P({ name: 'Cabane de Moiry', lat: 46.10750, lng: 7.57470, city: 'Grimentz', country: 'Switzerland', countryCode: 'ch',
        tags: [t.hut.id, t.nature.id], status: 'wishlist',
        note: 'On the rock above the glacier, 2825 m. Book the half board and the dormitory; the last stretch is a ladder in places. Wardened from June.' }, 9),
    P({ name: 'Berggasthaus Aescher', lat: 47.28360, lng: 9.41810, city: 'Appenzell', country: 'Switzerland', countryCode: 'ch',
        tags: [t.hut.id, t.food.id], status: 'wishlist',
        note: 'Built against the cliff under the Ebenalp. Walk in, do not take the cable car down at the last minute.' }, 15),
    P({ name: 'Schweizerischer Nationalpark', lat: 46.65800, lng: 10.17500, city: 'Zernez', country: 'Switzerland', countryCode: 'ch',
        tags: [t.reserve.id, t.nature.id], status: 'wishlist',
        note: 'The strictest reserve in the Alps: stay on the marked paths, no fires, no dogs, nothing picked or taken. Ibex and bearded vulture. Val Trupchun in the rut, late September.' }, 12),
    P({ name: 'Camargue', lat: 43.50000, lng: 4.45000, city: 'Arles', country: 'France', countryCode: 'fr',
        tags: [t.reserve.id, t.nature.id], status: 'wishlist',
        note: 'Salt, horses, flamingoes. The reserve proper is the Étang de Vaccarès; keep to the dykes and go at first light.' }, 26),
  );

  // a sample way: up to a col and back down, so the ground can be read at once
  const path = [];
  for (let i = 0; i <= 240; i++) {
    const u = i / 240;
    const ele = u < 0.52
      ? 1690 + (2790 - 1690) * Math.pow(u / 0.52, 1.2)
      : 2790 - (2790 - 1780) * Math.pow((u - 0.52) / 0.48, 0.95);
    path.push({
      lat: 46.0894 + u * 0.0380 + Math.sin(u * 19) * 0.0016,
      lng: 7.5566 + u * 0.0455 + Math.cos(u * 14) * 0.0019,
      ele,
    });
  }
  const routes = [newRoute({
    name: 'Col de Sorebois to the Moiry hut',
    path,
    city: 'Val d’Anniviers', country: 'Switzerland',
    tags: [t.hut.id, t.nature.id],
    status: 'wishlist',
    createdAt: ago(9), updatedAt: ago(9),
    note: 'The high traverse under the Dent Blanche. Snow lies on the col into July; ask the warden before you commit.',
  })];

  // Two voices, so the trust network is standing when the sample opens:
  // people whose slices overlap this atlas enough for resonance to have
  // grounds, and differ enough to leave a case for you. Their place ids are
  // fixed literals because two sample places carry provenance pointing back
  // at them (srcId), which is what makes "send thanks to Marta" stand on a
  // sample plate: the whole loop, demonstrable before a single friend is met.
  // ---------- the people of the sample ----------
  //
  // Sixteen voices, so the trust network is a lived thing when the sample
  // opens: overlaps graded from kin to strangers, roads crossing the atlas
  // (several places arrived "after" one of them, srcId pointing at their
  // copy), and hearts already settled on the plates. Everything below is a
  // real count over real records; the demonstration earns its sentences the
  // way an atlas would.
  const TAGWORD = { food: 'Restaurants', cafe: 'Caf\u00e9s', culture: 'Culture', nature: 'Nature', bar: 'Bars', shop: 'Shops' };
  const TAGSTATION = { food: 0, cafe: 1, culture: 4, nature: 3, bar: 6, shop: 7 };
  const bySrc = new Map(places.map(pl => [pl.name, pl]));
  // a copy of a place this atlas holds, under the voice's own id and words
  const held = (id, name, tagIds, note = '', status = 'visited') => {
    const src = bySrc.get(name);
    return newPlace({
      id, name: src.name, lat: src.lat, lng: src.lng, city: src.city,
      country: src.country, countryCode: src.countryCode,
      tags: tagIds, status, note,
    });
  };
  // ground of their own, that this atlas does not hold
  const theirs = (id, name, lat, lng, city, country, countryCode, tagIds, note = '') =>
    newPlace({ id, name, lat, lng, city, country, countryCode, tags: tagIds, status: 'visited', note });

  const voice = (name, station, kinds, mk) => {
    const slug = name.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '');
    const vt = Object.fromEntries(kinds.map(k => [k,
      newTag({ id: `${slug}_${k}`, name: TAGWORD[k], hue: TAG_STATIONS[TAGSTATION[k]].hue, color: TAG_STATIONS[TAGSTATION[k]].hex })]));
    const tid = Object.fromEntries(kinds.map(k => [k, vt[k].id]));
    return { name, hue: TAG_STATIONS[station].hue, tags: Object.values(vt), places: mk(tid) };
  };

  const correspondents = [
    voice('Marta', 7, ['food', 'culture'], (t2) => [
      held('mp_ogata', 'Ogata', [t2.food, t2.culture], 'Reserve the tea room, then the counter.'),
      held('mp_septime', 'Septime', [t2.food], 'Everyone says lunch is the way in.', 'wishlist'),
      theirs('mp_verlet', 'Caf\u00e9 Verlet', 48.86440, 2.33440, 'Paris', 'France', 'fr', [t2.food], 'Coffee before the Louvre, beans to carry home.'),
      theirs('mp_rubis', 'Le Rubis', 48.86660, 2.32930, 'Paris', 'France', 'fr', [t2.food], 'A zinc bar and a short lunch. Stand if you have to.'),
    ]),
    voice('Nina', 5, ['food'], (t2) => [
      held('bp_rochelle', 'Rochelle Canteen', [t2.food], 'The buzzer in the wall. Go before it fills.'),
      held('bp_stjohn', 'St. John Bread and Wine', [t2.food]),
      theirs('bp_kiln', 'Kiln', 51.51160, -0.13380, 'London', 'United Kingdom', 'gb', [t2.food], 'Counter seats over the fire. British produce, Thai grammar.'),
      theirs('bp_bazaar', 'Peckham Bazaar', 51.47060, -0.06810, 'London', 'United Kingdom', 'gb', [t2.food], 'Grilled things from the eastern Mediterranean, open Sunday nights.'),
    ]),
    voice('L\u00e9a', 0, ['food'], (t2) => [
      held('lea_georges', 'Chez Georges', [t2.food], 'The specials, always.'),
      held('lea_septime', 'Septime', [t2.food]),
      held('lea_enfants', 'March\u00e9 des Enfants Rouges', [t2.food]),
      theirs('lea_baratin', 'Le Baratin', 48.87180, 2.38860, 'Paris', 'France', 'fr', [t2.food], 'Belleville. No menu you can predict, and better for it.'),
    ]),
    voice('Tomas', 3, ['nature', 'food'], (t2) => [
      held('tomas_rheinbad', 'Rheinbad Breite', [t2.nature], 'Float, do not swim. The river does the work.'),
      held('tomas_markthalle', 'Markthalle Basel', [t2.food]),
      theirs('tomas_wenkenpark', 'Wenkenpark', 47.57580, 7.65290, 'Riehen', 'Switzerland', 'ch', [t2.nature], 'The long meadow above the villa. Empty on weekday evenings.'),
    ]),
    voice('Sofia', 1, ['food', 'cafe'], (t2) => [
      theirs('sofia_ramiro', 'Cervejaria Ramiro', 38.72360, -9.13560, 'Lisboa', 'Portugal', 'pt', [t2.food], 'Prawns, then the steak sandwich to finish. Everyone is right about this place.'),
      theirs('sofia_brasileira', 'A Brasileira', 38.71070, -9.14210, 'Lisboa', 'Portugal', 'pt', [t2.cafe], 'Tourists out front, regulars at the bar. Stand at the bar.'),
      theirs('sofia_gambrinus', 'Gambrinus', 38.71540, -9.13890, 'Lisboa', 'Portugal', 'pt', [t2.food], 'Croquettes and a cold beer at the counter, in a wood-panelled room that never changed.'),
    ]),
    voice('Kenji', 2, ['cafe', 'nature'], (t2) => [
      held('kenji_onibus', 'Onibus Coffee Nakameguro', [t2.cafe], 'Before ten, upstairs.'),
      held('kenji_meguro', 'Meguro River cherry blossoms', [t2.nature], '', 'wishlist'),
      theirs('kenji_kagari', 'Kagari', 35.67150, 139.76380, 'Tokyo', 'Japan', 'jp', [t2.cafe], 'Tori paitan ramen. The queue moves faster than it looks.'),
    ]),
    voice('Ines', 6, ['bar', 'food'], (t2) => [
      theirs('ines_laduquesita', 'La Duquesita', 40.42430, -3.69700, 'Madrid', 'Spain', 'es', [t2.food], 'Pastries under a ceiling worth the trip alone.'),
      theirs('ines_bodega', 'Bodega de la Ardosa', 40.42540, -3.70110, 'Madrid', 'Spain', 'es', [t2.bar], 'Vermouth on tap, tortilla at the barrel.'),
      theirs('ines_sobrino', 'Sobrino de Bot\u00edn', 40.41230, -3.70810, 'Madrid', 'Spain', 'es', [t2.food], 'The oldest restaurant in the world, and the cochinillo earns it.'),
    ]),
    voice('Piet', 4, ['culture', 'cafe'], (t2) => [
      theirs('piet_rijks', 'Rijksmuseum', 52.36000, 4.88540, 'Amsterdam', 'Netherlands', 'nl', [t2.culture], 'The library gallery, most people walk past the door.'),
      theirs('piet_winkel', 'Winkel 43', 52.37940, 4.88640, 'Amsterdam', 'Netherlands', 'nl', [t2.cafe], 'The appeltaart. Saturday market mornings are chaos, go Tuesday.'),
    ]),
    voice('Clara', 0, ['food'], (t2) => [
      held('clara_noma', 'Noma', [t2.food], 'Vegetable season. Book the day bookings open.'),
      theirs('clara_barr', 'Barr', 55.67980, 12.58480, 'Copenhagen', 'Denmark', 'dk', [t2.food], 'Schnitzel and beer where Noma used to stand. The comfortable sibling.'),
      theirs('clara_juno', 'Juno the Bakery', 55.70110, 12.57090, 'Copenhagen', 'Denmark', 'dk', [t2.food], 'Cardamom buns. Before nine or not at all.'),
    ]),
    voice('Marco', 6, ['bar', 'food'], (t2) => [
      held('marco_basso', 'Bar Basso', [t2.bar], 'Ask for Maurizio\u2019s table if it is quiet.'),
      theirs('marco_latteria', 'Latteria San Marco', 45.47180, 9.18190, 'Milan', 'Italy', 'it', [t2.food], 'Eight tables, no reservations, the riso al salto. Arrive at noon.'),
      theirs('marco_roscioli', 'Roscioli', 41.89430, 12.47420, 'Rome', 'Italy', 'it', [t2.food], 'Carbonara at the deli counter with the burrata case at your elbow.'),
    ]),
    voice('Yuki', 1, ['cafe', 'culture'], (t2) => [
      held('yuki_onibus', 'Onibus Coffee Nakameguro', [t2.cafe]),
      theirs('yuki_teamlab', 'teamLab Planets', 35.64920, 139.78940, 'Tokyo', 'Japan', 'jp', [t2.culture], 'Barefoot through the water rooms. Book the first slot.'),
      theirs('yuki_daitokuji', 'Daitoku-ji', 35.04380, 135.74590, 'Kyoto', 'Japan', 'jp', [t2.culture], 'The moss subtemples. Most gates shut at four.'),
    ]),
    voice('Oskar', 4, ['cafe', 'culture'], (t2) => [
      theirs('oskar_hawelka', 'Caf\u00e9 Hawelka', 48.20860, 16.36980, 'Vienna', 'Austria', 'at', [t2.cafe], 'Buchteln after ten at night, under the posters.'),
      theirs('oskar_leopold', 'Leopold Museum', 48.20330, 16.35880, 'Vienna', 'Austria', 'at', [t2.culture], 'The Schiele floor, first thing.'),
    ]),
    voice('Camille', 3, ['food', 'nature'], (t2) => [
      held('camille_colombe', 'La Colombe d\u2019Or', [t2.food], 'Lunch under the fig tree, then the Calder by the pool.'),
      theirs('camille_chezfonfon', 'Chez Fonfon', 43.28970, 5.34920, 'Marseille', 'France', 'fr', [t2.food], 'Bouillabaisse in the Vallon des Auffes. Order it the day before.'),
      theirs('camille_calanque', 'Calanque de Sormiou', 43.20880, 5.41740, 'Marseille', 'France', 'fr', [t2.nature], 'Walk in from the col; the road is closed in summer, which is the point.'),
    ]),
    voice('Ruth', 5, ['food', 'shop'], (t2) => [
      held('ruth_stjohn', 'St. John Bread and Wine', [t2.food], 'Sunday supper. The welsh rarebit, whatever else.'),
      held('ruth_portobello', 'Portobello Road Market', [t2.shop]),
      theirs('ruth_valvona', 'Valvona & Crolla', 55.95900, -3.18320, 'Edinburgh', 'United Kingdom', 'gb', [t2.shop], 'An Italian grocer since 1934. The back caf\u00e9 does a proper lunch.'),
    ]),
    voice('Elif', 2, ['food', 'cafe'], (t2) => [
      theirs('elif_ciya', '\u00c7iya Sofras\u0131', 40.99070, 29.02500, 'Istanbul', 'T\u00fcrkiye', 'tr', [t2.food], 'Cross to Kad\u0131k\u00f6y for it. Point at everything.'),
      theirs('elif_mandabatmaz', 'Mandabatmaz', 41.03170, 28.97590, 'Istanbul', 'T\u00fcrkiye', 'tr', [t2.cafe], 'The thickest coffee in the city, on stools in an alley.'),
      theirs('elif_karakoy', 'Karak\u00f6y G\u00fcll\u00fco\u011flu', 41.02250, 28.97810, 'Istanbul', 'T\u00fcrkiye', 'tr', [t2.cafe], 'Baklava with clotted cream, standing up, twice.'),
    ]),
    voice('Sam', 7, ['cafe', 'culture'], (t2) => [
      held('sam_sabarsky', 'Caf\u00e9 Sabarsky', [t2.cafe], 'Viennese breakfast before the Klimts upstairs.'),
      held('sam_bethesda', 'Bethesda Terrace', [t2.culture]),
      theirs('sam_strand', 'The Strand', 40.73330, -73.99090, 'New York', 'United States', 'us', [t2.culture], 'Eighteen miles of books. The rare room upstairs asks for an appointment.'),
    ]),
  ];

  // ---------- the books ----------
  //
  // The list that proves the record type is real. Most of them answer to no
  // place, because most books do not: a book is read on a train, or handed
  // over in a kitchen, and asking where somebody read something before letting
  // them say it was good would be a strange thing for an atlas to ask.
  //
  // The six that do answer to a place answer to it for a reason a person can
  // check: Fergus Henderson cooks at St. John, Harry MacElhone ran the bar he
  // wrote the book behind, Redzepi's book is Noma's. A tie invented for the
  // sake of a demonstration would be the same lie as a visit nobody made.
  //
  // Nothing here is marked read, for exactly the reason nothing above is
  // marked visited. These are books worth reading, which is what they are.
  const byName = new Map(places.map(pl => [pl.name, pl.id]));
  // `at` is a place NAME here rather than an id, because the ids are minted a
  // few lines above and nothing outside this function can spell them
  const B = ({ at, ...partial }, daysAgo) => newBook({
    ...partial,
    placeId: at ? (byName.get(at) || '') : '',
    createdAt: ago(daysAgo), updatedAt: ago(daysAgo),
  });
  const books = [
    // tied to a place, and the tie is checkable
    B({ title: 'A Moveable Feast', author: 'Ernest Hemingway', year: '1964',
        at: 'Shakespeare and Company', tags: [t.culture.id],
        note: 'Paris between the wars, and the bookshop whose name this one carries. Read the first chapter in the reading room upstairs.' }, 130),
    B({ title: 'The Complete Nose to Tail', author: 'Fergus Henderson', year: '2012',
        at: 'St. John Bread and Wine', tags: [t.food.id],
        note: 'The kitchen that wrote it is the one you are standing in. The roast bone marrow and parsley salad is on page one for a reason.',
        provenance: { name: 'Ruth', adoptedAt: ago(52), chain: [], srcId: 'ruth_stjohn' } }, 52),
    B({ title: 'Noma: Time and Place in Nordic Cuisine', author: 'Ren\u00e9 Redzepi', year: '2010',
        at: 'Noma', tags: [t.food.id],
        note: 'Not a book to cook from. A book about deciding that where you are is enough.',
        provenance: { name: 'Clara', adoptedAt: ago(200), chain: [], srcId: 'clara_noma' } }, 200),
    B({ title: 'Harry\u2019s ABC of Mixing Cocktails', author: 'Harry MacElhone', year: '1919',
        at: 'Harry\u2019s New York Bar', tags: [t.bar.id],
        note: 'Written by the man whose name is over the door. Still the shortest argument for ordering something simple.' }, 34),
    B({ title: 'The World Atlas of Coffee', author: 'James Hoffmann', year: '2014',
        at: 'Onibus Coffee Nakameguro', tags: [t.cafe.id],
        note: 'Where every bean comes from, drawn. It makes the upstairs window seat take twice as long.',
        provenance: { name: 'Kenji', adoptedAt: ago(290), chain: [], srcId: 'kenji_onibus' } }, 290),
    B({ title: 'Ways of Seeing', author: 'John Berger', year: '1972',
        at: 'Kunstmuseum Basel', tags: [t.culture.id],
        note: 'Four essays that change what a room of paintings is doing to you. Read it on the tram there, not after.' }, 21),

    // no place, which is where most books live
    B({ title: 'Invisible Cities', author: 'Italo Calvino', year: '1972', tags: [t.culture.id],
        note: 'Marco Polo describes fifty-five cities to Kublai Khan and every one of them is Venice. The book this atlas keeps arguing with.' }, 12),
    B({ title: 'The Songlines', author: 'Bruce Chatwin', year: '1987', tags: [t.nature.id],
        note: 'A country sung into existence, and walked to stay real. On why people who stay still get restless.' }, 40),
    B({ title: 'The Old Ways', author: 'Robert Macfarlane', year: '2012', tags: [t.nature.id],
        note: 'Paths as the oldest thing we have made and the least noticed. Read a chapter the night before a long walk.' }, 65),
    B({ title: 'A Time of Gifts', author: 'Patrick Leigh Fermor', year: '1977', tags: [t.culture.id],
        note: 'Eighteen years old, walking from the Hook of Holland to Constantinople, writing it down forty years later from memory.' }, 96),
    B({ title: 'The Rings of Saturn', author: 'W. G. Sebald', year: '1995', tags: [t.nature.id],
        note: 'A walk along the Suffolk coast that keeps falling through into everywhere else. Slow on purpose.' }, 120),
    B({ title: 'The Way of the World', author: 'Nicolas Bouvier', year: '1963', tags: [t.culture.id],
        note: 'Geneva to the Khyber Pass in a Fiat Topolino, two friends, no hurry. The book to hand somebody who says they have no time.' }, 150),
    B({ title: 'Istanbul: Memories and the City', author: 'Orhan Pamuk', year: '2003', tags: [t.culture.id],
        note: 'One word, h\u00fcz\u00fcn, and a whole city underneath it. Read it before you go, then again after.',
        provenance: { name: 'Elif', adoptedAt: ago(70), chain: [], srcId: 'elif_ciya' } }, 70),
    B({ title: 'Danube', author: 'Claudio Magris', year: '1986', tags: [t.nature.id],
        note: 'A river followed from a disputed spring to the sea, and the argument about Europe that runs alongside it.' }, 180),
  ];

  return { tags: Object.values(t), places, routes, books, correspondents };
}
