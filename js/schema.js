// schema.js — one gate for everything that arrives from outside.
//
// A share link and an imported file are the same kind of stranger. They pass through here or they do not pass. Nothing
// downstream may assume a field exists, has a type, or has a sane size:
// this is the only place that decides.

import { decodePath } from './route.js?v=rf157';

// The form a file is written in, and there are two of them.
//
// An archive and a handover are separate protocols that happen to share a
// shape. An archive is a person's own record coming back to this app: a full
// export, a snapshot, the plaintext the club seals, and whatever restore and
// merge are given. A handover is what leaves for somebody else: an atlas link,
// a folio link, an ask, and a handover file. What an archive must promise is
// that this build can read it without losing what it does not know about, and
// the gate below enforces exactly that. A handover promises the same thing to
// its recipient, and until this release nothing read its number at all: it was
// written into every link and never once checked on the way in.
//
// Until now one constant stood for both, which meant neither could move on its
// own. The day an archive starts carrying a field this build has no place for,
// its number has to move, and with one constant that move would have restamped
// every link and every handover file in the world with a form they do not have,
// for a change that has nothing to do with them. The reverse is worse: a
// handover that changed shape would have made this build refuse its own
// backups. So there are two numbers, and a call site has to say which protocol
// it is writing. That is the whole of the change.

// The archive: the file that comes home.
//
// It moves when a build stops keeping something an older build kept. The move
// from 4 to 5 was such a moment: a place no longer carries photographs.
//
// That move was not bookkeeping. The gate below reads this number in one
// direction only, accepting anything from 1 up to it, so at 4 a file written
// here would open in silence on a device still running the old code: a second
// device, another browser, or this one behind a service worker that has not
// caught up. That build would restore places naming no picture and then let
// its own sweep delete every blob nothing pointed at any more. At 5 it refuses
// the file instead, out loud, in the sentence it already has below. A file
// from before still opens here, photographs and all, which is the direction
// that matters.
//
// It moved to 6 when a place learned to carry thanks: the hearts friends
// send back for a recommendation, and the srcId on provenance that lets a
// heart find the record it is for. A version-5 build reading a version-6
// archive would drop every heart in silence and restore an atlas that has
// forgotten who came back to say so. It refuses instead, out loud, in the
// sentence below.
//
// It moved to 7 when a book became a record. A book is the first thing in
// this atlas that may answer to no place, so it could not be folded into
// places and had to arrive as a collection of its own. A version-6 build
// reading a version-7 archive would restore an atlas with every book missing
// and say nothing, which is the exact failure the number exists to prevent.
// It refuses instead, out loud, in the sentence below.
export const ARCHIVE_VERSION = 7;

// The handover: the link, the fragment, the file that goes to somebody else.
//
// It is 5 because 5 is what handovers have carried since the numbers were one,
// and it is not free to be tidied down to 1: every link already sent says 5,
// and a recipient's build may one day read it and would be right to trust what
// it says. It moves when the shape of a handover changes, and for nothing else
// that happens to an archive.
//
// It is read in one direction, like the archive number: anything from 1 up to
// it is accepted and anything above it is refused whole. The refusal is the
// point. A build that accepts a handover numbered higher than it understands
// is promising a recipient an atlas it has only partly read.
//
// It moved to 6 when the protocol gained a kind: a thanks, the small payload
// a recipient sends back for one place. A shape change moves the number, and
// a build that does not know the kind refuses the link rather than reading
// it as an empty atlas.
//
// It moved to 7 for an introduction, which is the same argument again: a build
// that has never heard of direct exchange must refuse an introduction rather
// than open it as an atlas with no places in it.
//
// It moved to 8 when an atlas and a folio learned to carry books. This is the
// first move where the kind itself did not change name, and the stamping rule
// below (BOOKS_RIDE_AT) is what keeps the move honest: a handover carrying no
// books still declares the shape it has always had, so every build already
// shipped goes on opening it, and only a handover actually carrying a shelf
// announces the number that makes an older build refuse it whole. The
// alternative was an older build opening the link, keeping the places and
// dropping every book without a word, which is the exact silence this number
// exists to prevent.
export const SHARE_VERSION = 8;

// What each kind declares when this build writes one.
//
// The two numbers are different questions and were one constant until an
// introduction needed them apart. SHARE_VERSION is the highest number this
// build can READ. This table is what each kind SAYS, and saying a number is a
// promise to whoever is on the other side: a build that knows this number can
// read this object.
//
// An atlas has not changed since 6. If every link written today said 7 because
// the app had learned a new kind, every build shipped since 6 would refuse an
// atlas it understands perfectly, and would be right to: the number told it to.
// A version is a claim about a shape, so it moves for the shape it describes
// and for nothing that merely happened nearby.
//
// An introduction is new at 7, says 7, and is refused by a build that reads to
// 6 — which is the whole of the mechanism working, in the one direction that
// matters. Nothing else in the protocol moved, so nothing else moves.
export const KIND_VERSION = Object.freeze({
  atlas: 6, folio: 6, ask: 6, thanks: 6, intro: 7,
});

// The version an atlas or a folio declares when books ride it, and only then.
//
// KIND_VERSION above is a claim about a kind's usual shape, and neither kind's
// usual shape moved: an atlas of places is the same object it was at 6. What
// changed is that either may now carry a shelf, and a shelf is invisible to
// every reader shipped before this number existed - their gate has no books
// field, so the places would arrive and the books would vanish in silence.
//
// So the number is conditional, decided by the payload's own contents at the
// moment it is built. Carrying books: declare 8, and a build that reads to 7
// refuses the whole handover out loud, which is the truth ("this was written
// by a newer resonate"). Carrying none: declare the kind's own number, and
// nothing anybody has installed refuses a link it understands perfectly.
export const BOOKS_RIDE_AT = 8;

// What an assistant is handed, and what it hands back. Two protocols, because
// a task and its result are not one document and will not change on one day.
//
// Nothing reads either of these yet. Declaring them now is not speculation, it
// is the point of the split: the export beside them already writes a handover,
// the release after this one writes a task and reads a result, and the only
// thing that stops a future author reaching for whichever version constant is
// nearest to hand is a constant that already carries the right name. A call
// site cannot name its protocol until the name exists.
//
// These two are read differently from the two above, and the difference is
// decided here rather than by whoever writes the first reader. An archive and
// a handover accept a range, because both have a past: files and links written
// by older builds are out there and must keep opening. A task and a result
// have no past at all. Nothing has ever written one. So each accepts its own
// number exactly, and refuses every other number in both directions.
//
// A version this build has not met is refused rather than normalized, because
// normalizing means acting on the part that was understood and discarding the
// rest in silence, and a task is an instruction. Half an instruction carried
// out is worse than none. A version below is refused too: there is no older
// one, so a document claiming to be older is claiming something untrue about
// where it came from.
export const ASSISTANT_TASK_VERSION = 1;
export const ASSISTANT_RESULT_VERSION = 1;
export const assistantTaskVersionOK = (v) => v === ASSISTANT_TASK_VERSION;
export const assistantResultVersionOK = (v) => v === ASSISTANT_RESULT_VERSION;

// What a person's own record may hold: everything it holds.
//
// The previous build wrote generous numbers here and called them safe because
// nobody would meet them. Someone met them. Two hundred tags on a place came
// home as two hundred, and the two hundred and first was gone without a word.
// A limit chosen so that loss is rare is still a limit that loses.
//
// There is no length at which a person's own note stops being theirs. What
// bounds an archive is the total number of records it may carry, checked
// before anything is written, and the witness below, which makes any
// shortening visible instead of silent. Nothing here is ever quietly cut.
const ALL = Infinity;
export const OWN = {
  note: ALL, name: ALL, url: ALL, id: ALL,
  tagsPerPlace: ALL, routePoints: ALL,
  address: ALL, city: ALL, country: ALL,
  author: ALL, title: ALL, dedication: ALL, year: ALL,
  placeIds: ALL, routeIds: ALL, bookIds: ALL, tags: ALL, places: ALL, chain: ALL,
  // the hearts a person's friends sent back. every one of them is theirs,
  // and this key existing here is also the switch that reads them at all:
  // the stranger's table below has no thanks key, so a stranger's file
  // cannot plant gratitude that was never given. see normPlace.
  thanks: ALL,
};

// What a stranger may hand this device. Every one of these is a real bound,
// and a stranger's payload is clipped to them in silence, which is correct:
// a hostile link may not spend a person's browser to make a point.
export const LIMITS = {
  folios: 120,
  routes: 200,
  books: 500,
  routePoints: 3000,
  places: 500,
  tags: 64,
  correspondents: 64,
  tagsPerPlace: 24,
  name: 140,
  note: 4000,
  url: 500,
  title: 80,
  dedication: 140,
  author: 60,
  // Two numbers for one field, and they are different on purpose. `asking` is
  // the longest question this build writes and the number a field asking for
  // one must carry; `question` is the longest it will read from a build that
  // is not this one, and it is looser because refusing somebody else's longer
  // question outright would be refusing a letter over a bound they had no way
  // to know. The door that asks used neither and took the input's own default
  // of two hundred, so a person typing past eighty was typing into a field
  // that had already stopped listening and said nothing about it.
  asking: 80,
  question: 120,
  // a book is from 1978, or from n.d., or from 'first published 1929, this
  // translation 2003'. a number holds exactly one of those three, so it is a
  // string, and a string needs a bound.
  year: 60,
  // named here rather than written into the normalizers, so that an own
  // archive is never held to a stranger's measure by an oversight
  id: 64,
  address: 200,
  city: 120,
  country: 120,
  chain: 5,
  placeIds: 500,
  routeIds: 200,
  bookIds: 500,
};

// An atlas holds the places that matter to you. Keeping one IS the
// recommendation, so nothing here asks for a verdict beside it: only whether
// you have been, which is a fact, and the note, where a sentence says what a
// label never could. The old five-star number is still read from links sealed
// before this, and is never written again.

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v, n) => String(v ?? '').slice(0, n);

// The two shapes a photograph ever had in a record: kept inline as a data
// url, or an id into the database on the device that took it. This is the
// same pair the reader before it accepted, and it is here because the number
// beside it is read out to a person. A file carrying `photos: ['x']` is
// carrying no photograph, and counting the string as one tells somebody they
// are about to leave a picture behind that never existed. A count that
// overstates is the same defect as one that understates.
const isPicture = s => typeof s === 'string'
  && (s.startsWith('data:image/') || /^ph_[a-z0-9]{1,40}$/.test(s));

// ---------- the witness ----------
//
// A cap that shortens without saying so is exactly how an archive comes home
// smaller than it left. Every bounded field passes through here. A stranger's
// payload carries no witness and is clipped quietly, which is the point of a
// cap. A person's own archive always carries one, and any entry in it stops
// the restore before a single record is written.
//
// With OWN every cap is Infinity, so on an own archive the witness stays
// empty by construction. That is the assertion, not the hope: if a bound ever
// creeps back into this file, the witness fires and the restore refuses
// rather than quietly keeping the shorter copy.

// a string, cut only if it must be, and never in silence
function cutStr(w, kind, id, field, v, cap) {
  const s = String(v ?? '');
  if (s.length <= cap) return s;
  w?.push({ kind, id, field, given: s.length, kept: cap,
    reason: `${field} is ${s.length} characters and this build holds ${cap}` });
  return s.slice(0, cap);
}

// a list, likewise
function cutArr(w, kind, id, field, arr, cap) {
  if (!Array.isArray(arr)) return [];
  if (arr.length <= cap) return arr;
  w?.push({ kind, id, field, given: arr.length, kept: cap,
    reason: `${arr.length} ${field} and this build holds ${cap}` });
  return arr.slice(0, cap);
}

// the tail of a list, for a road that keeps its most recent hops
function cutTail(w, kind, id, field, arr, cap) {
  if (!Array.isArray(arr)) return [];
  if (arr.length <= cap) return arr;
  w?.push({ kind, id, field, given: arr.length, kept: cap,
    reason: `${arr.length} ${field} and this build holds ${cap}` });
  return arr.slice(-cap);
}

// keys that would poison an object literal on assignment
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

function safeKeys(o) {
  const out = {};
  for (const k of Object.keys(o)) {
    if (FORBIDDEN.has(k)) continue;
    out[k] = o[k];
  }
  return out;
}

// an id is identity, so shortening one does not shorten a record: it makes it
// a different record. the witness hears about this one too.
function id(v, fallback, w, kind, cap = LIMITS.id) {
  const s = cutStr(w, kind, String(v ?? '') || fallback, 'id', v, cap).trim();
  return s && !FORBIDDEN.has(s) ? s : fallback;
}

export function normPlace(raw, i = 0, caps = LIMITS, w = null) {
  if (!isObj(raw)) return null;
  const p = safeKeys(raw);
  const lat = Number(p.lat);
  const lng = Number(p.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const pid = String(p.id ?? '') || `p${i}`;

  // A photograph is no longer part of a record. A file, a link or a snapshot
  // written before this arrives still carrying them, and the field is set
  // aside: never kept, and never dropped in silence.
  //
  // This is not a loss the way a shortened note is a loss. Nothing is
  // destroyed by reading: the file on the disk is untouched and still holds
  // every picture in it. So it rides the witness on a channel of its own,
  // marked, and losses() below leaves it out, because a restore that refused
  // every archive ever written would punish a person for a decision this app
  // made. It is told, and then the atlas comes home.
  //
  // A stranger's payload carries no witness and is stripped without a word,
  // which is the rule this file has always followed.
  const setAsidePhotos = Array.isArray(p.photos)
    ? p.photos.filter(isPicture).length
    : 0;
  if (setAsidePhotos) {
    w?.push({ kind: 'place', id: pid, field: 'photos', setAside: true,
      given: setAsidePhotos, kept: 0,
      reason: `${setAsidePhotos} photograph${setAsidePhotos === 1 ? '' : 's'} this version does not keep. the file you are holding still has them` });
  }

  const out = {
    id: id(p.id, `p${i}`, w, 'place', caps.id ?? LIMITS.id),
    name: cutStr(w, 'place', pid, 'name', p.name, caps.name) || 'Untitled place',
    lat,
    lng,
    address: cutStr(w, 'place', pid, 'address', p.address, caps.address ?? LIMITS.address),
    city: cutStr(w, 'place', pid, 'city', p.city, caps.city ?? LIMITS.city),
    country: cutStr(w, 'place', pid, 'country', p.country, caps.country ?? LIMITS.country),
    countryCode: str(p.countryCode, 8),
    tags: cutArr(w, 'place', pid, 'tags',
      Array.isArray(p.tags) ? p.tags.filter(t => typeof t === 'string' && !FORBIDDEN.has(t)) : [],
      caps.tagsPerPlace),
    status: p.status === 'visited' ? 'visited' : 'wishlist',
    // a place marked this way is kept out of every link, folio and publish
    private: p.private === true,
    // the number survives only so links and files from before the words still
    // open; nothing writes it, and no surface shows it
    rating: Math.max(0, Math.min(5, Math.floor(Number(p.rating) || 0))),
    note: cutStr(w, 'place', pid, 'note', p.note, caps.note),
    url: /^https?:\/\//i.test(String(p.url ?? '')) ? cutStr(w, 'place', pid, 'url', p.url, caps.url) : '',
    createdAt: str(p.createdAt, 40),
    updatedAt: str(p.updatedAt, 40),
    // What this mark is, exactly, because it has been read three ways.
    //
    // It is not ownership: a person who opened a full atlas chose these
    // records, and from that moment they are in that person's atlas, counted
    // and travelling like anything else. It is not provenance either: what a
    // record came by is `provenance`, which names a person and travels. And it
    // is not permission: `mayLeave` reads one word and that word is `private`.
    //
    // It means untouched-starter, and it has one job: a single word under
    // yours can send back everything nobody has written in. Editing clears it,
    // which ends that record's eligibility for the bulk undo and says nothing
    // at all about who wrote the note inside. Local only; it never travels.
    sample: p.sample === true,
  };

  // The hearts friends sent back for this place. Read only when the caps
  // table has a thanks key, which is the own door and nobody else's: a
  // stranger's payload claiming hearts would be manufacturing the very
  // evidence this field exists to witness, and it is dropped without a word,
  // the way a stranger's photographs are. Absent when empty, so a place with
  // no hearts is one shape everywhere.
  if (caps.thanks !== undefined && Array.isArray(p.thanks)) {
    const given = p.thanks.filter(isObj)
      .map(h => ({ from: str(h.from, LIMITS.author), when: str(h.when, 40) }))
      .filter(h => h.when);
    if (given.length) out.thanks = given;
  }

  // a link carries the road as `prov`: the names it passed through, in order
  if (!isObj(p.provenance) && Array.isArray(p.prov) && p.prov.length) {
    const road = p.prov.filter(isObj).map(h => ({ name: str(h.name, LIMITS.author), at: str(h.at, 40) })).filter(h => h.name);
    if (road.length) {
      const last = road[road.length - 1];
      const before = road.slice(0, -1);
      const cap = caps.chain ?? LIMITS.chain;
      out.provenance = {
        chain: cutTail(w, 'place', pid, 'earlier bylines', before, Math.max(0, cap - 1)),
        name: last.name, sig: 0, adoptedAt: last.at,
      };
    }
  }

  // provenance reaches an attribute in the marker: rebuilt, never carried.
  // the chain is who it passed through before, oldest first, five at most:
  // Ana handed it to Mira who handed it to you, and all three are kept.
  if (isObj(p.provenance)) {
    out.provenance = {
      chain: cutTail(w, 'place', pid, 'earlier bylines',
        Array.isArray(p.provenance.chain)
          ? p.provenance.chain
            .filter(isObj)
            .map(h => ({ name: cutStr(w, 'place', pid, 'a byline', h.name, caps.author ?? LIMITS.author), at: str(h.at, 40) }))
            .filter(h => h.name)
          : [],
        caps.chain ?? LIMITS.chain),
      name: cutStr(w, 'place', pid, 'byline', p.provenance.name, caps.author ?? LIMITS.author),
      sig: Number(p.provenance.sig) || 0,
      adoptedAt: str(p.provenance.adoptedAt, 40),
    };
    // the id this record wore in the sender's atlas, kept at adoption so a
    // thanks can name the exact record it is for. local metadata like the
    // rest of provenance: buildDisclosure never emits it, so it cannot leak
    // by construction. absent when empty, one shape everywhere.
    const src = str(p.provenance.srcId, LIMITS.name);
    if (src) out.provenance.srcId = src;
  }
  return out;
}

// a route arrives either as a list of points or as an encoded line; both are
// bounded here, because a line is the one thing in this app that can be long
export function normRoute(raw, i = 0, decode = null, caps = LIMITS, w = null) {
  if (!isObj(raw)) return null;
  const r = safeKeys(raw);
  const rid = String(r.id ?? '') || `r${i}`;

  let path = [];
  if (Array.isArray(r.path)) {
    path = r.path;
  } else if (typeof r.p === 'string' && decode) {
    path = decode(r.p);
  }
  path = cutArr(w, 'path', rid, 'points', Array.isArray(path) ? path : [], caps.routePoints)
    .map(pt => {
      if (!isObj(pt)) return null;
      const lat = Number(pt.lat), lng = Number(pt.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
      // a point with no elevation reading is written by the gpx importer as
      // ele: null, and Number(null) is 0, so every unmeasured point used to
      // come back from a reload as a measured sea level reading. a record
      // that changes by being read is not a record.
      const out = { lat, lng };
      if (pt.ele !== null && pt.ele !== undefined && pt.ele !== '') {
        const ele = Number(pt.ele);
        if (Number.isFinite(ele) && Math.abs(ele) <= 9000) out.ele = ele;
      }
      return out;
    })
    .filter(Boolean);
  if (path.length < 2) return null;

  // the same rule for a way's measurements: null means unknown, and unknown
  // must not become zero on the way through
  const nn = (v, lim) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(-lim, Math.min(lim, n)) : null;
  };

  const out = {
    id: id(r.id, `r${i}`, w, 'path', caps.id ?? LIMITS.id),
    kind: 'route',
    name: cutStr(w, 'path', rid, 'name', r.name, caps.name) || 'Untitled way',
    path,
    city: cutStr(w, 'path', rid, 'city', r.city, caps.city ?? LIMITS.city),
    country: cutStr(w, 'path', rid, 'country', r.country, caps.country ?? LIMITS.country),
    tags: cutArr(w, 'path', rid, 'tags',
      Array.isArray(r.tags) ? r.tags.filter(t => typeof t === 'string' && !FORBIDDEN.has(t)) : [],
      caps.tagsPerPlace),
    status: r.status === 'walked' ? 'walked' : 'wishlist',
    // a track shows a routine, a door, an hour: it needs the same word a
    // place has, and one more for the ends that give a home away
    private: r.private === true,
    trimEnds: r.trimEnds === true,
    rating: Math.max(0, Math.min(5, Math.floor(Number(r.rating) || 0))),
    note: cutStr(w, 'path', rid, 'note', r.note, caps.note),
    url: /^https?:\/\//i.test(String(r.url ?? '')) ? cutStr(w, 'path', rid, 'url', r.url, caps.url) : '',
    km: nn(r.km, 100000),
    ascent: nn(r.ascent, 30000),
    descent: nn(r.descent, 30000),
    high: nn(r.high, 9000),
    low: nn(r.low, 9000),
    hours: nn(r.hours, 400),
    loop: r.loop === true,
    createdAt: str(r.createdAt, 40),
    updatedAt: str(r.updatedAt, 40),
    walkedAt: str(r.walkedAt, 40),
    sample: r.sample === true,
  };
  if (isObj(r.provenance)) {
    out.provenance = {
      chain: cutTail(w, 'path', rid, 'earlier bylines',
        Array.isArray(r.provenance.chain)
          ? r.provenance.chain
            .filter(isObj)
            .map(h => ({ name: cutStr(w, 'path', rid, 'a byline', h.name, caps.author ?? LIMITS.author), at: str(h.at, 40) }))
            .filter(h => h.name)
          : [],
        caps.chain ?? LIMITS.chain),
      name: cutStr(w, 'path', rid, 'byline', r.provenance.name, caps.author ?? LIMITS.author),
      sig: Number(r.provenance.sig) || 0,
      adoptedAt: str(r.provenance.adoptedAt, 40),
    };
  }
  return out;
}

export function normRoutes(arr, decode = null) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (let i = 0; i < arr.length && out.length < LIMITS.routes; i++) {
    const v = normRoute(arr[i], i, decode);
    if (v) out.push(v);
  }
  return out;
}

const HEX = /^#[0-9a-fA-F]{3,8}$/;

export function normTag(raw, i = 0, caps = LIMITS, w = null) {
  if (!isObj(raw)) return null;
  const t = safeKeys(raw);
  const tid = String(t.id ?? '') || `t${i}`;
  const name = cutStr(w, 'tag', tid, 'name', t.name, caps === LIMITS ? 60 : (caps.name ?? 60)).trim();
  if (!name) return null;
  const hue = Number(t.hue);
  return {
    id: id(t.id, `t${i}`, w, 'tag', caps.id ?? LIMITS.id),
    name,
    emoji: str(t.emoji, 8),
    color: HEX.test(String(t.color ?? '')) ? String(t.color) : '',
    hue: Number.isFinite(hue) ? ((hue % 360) + 360) % 360 : NaN,
  };
}

function normList(arr, fn, cap) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (let i = 0; i < arr.length && out.length < cap; i++) {
    const v = fn(arr[i], i);
    if (v) out.push(v);
  }
  return out;
}

export function normPlaces(arr) { return normList(arr, normPlace, LIMITS.places); }
export function normTags(arr) { return normList(arr, normTag, LIMITS.tags); }

export function normCorrespondent(raw, i = 0, caps = LIMITS, w = null) {
  if (!isObj(raw)) return null;
  const c = safeKeys(raw);
  const cid = String(c.id ?? '') || `c${i}`;
  const hue = Number(c.hue);
  // A voice holds someone else's atlas as it was handed over, and that
  // includes their tags: not as a thing anyone looks at, but so that adopting
  // one of their places can turn their tag ids back into the words they used.
  // Without them an adopted place arrives filed under numbers. On this device
  // it is the person's own record of that gift, and it is kept whole
  const keep = (arr, fn, field, cap, decode) => {
    const src = cutArr(w, 'voice', cid, field, Array.isArray(arr) ? arr : [], cap);
    const out = [];
    for (let n = 0; n < src.length; n++) {
      const v = decode ? fn(src[n], n, decode, caps, w) : fn(src[n], n, caps, w);
      if (v) out.push(v);
    }
    return out;
  };
  return {
    id: id(c.id, `c${i}`, w, 'voice', caps.id ?? LIMITS.id),
    name: cutStr(w, 'voice', cid, 'name', c.name, caps.author ?? LIMITS.author) || 'Unnamed correspondent',
    hue: Number.isFinite(hue) ? ((hue % 360) + 360) % 360 : NaN,
    visible: c.visible !== false,
    // a seeded voice wears the word the seeded places wear, and for the same
    // reason: the sample is cleared as one act, and a voice the demo brought
    // must go with it rather than linger as somebody nobody ever met
    sample: c.sample === true,
    addedAt: str(c.addedAt, 40),
    tags: keep(c.tags, normTag, 'tags', caps.tags ?? LIMITS.tags),
    places: keep(c.places, normPlace, 'places', caps.places ?? LIMITS.places),
  };
}

// What travels in a person's own archive, named exactly.
//
// The file says it carries your settings, so it has to carry them. This used
// to keep the byline and the theme and drop the rest, which meant a restored
// atlas came back in someone else's colour. Anything not named here is device
// state or a credential, and is left behind on purpose: the club key is a
// bearer token, and where the map was last looking is not a memory.
export function normSettings(raw, caps = LIMITS, w = null) {
  if (!isObj(raw)) return {};
  const s = safeKeys(raw);
  const out = {};
  if (typeof s.authorName === 'string') {
    out.authorName = cutStr(w, 'settings', 'settings', 'byline', s.authorName, caps.author ?? LIMITS.author);
  }
  if (s.theme === 'light' || s.theme === 'dark' || s.theme === 'auto') out.theme = s.theme;
  // the colour the whole atlas is drawn in, and the angle between its two
  // halves: as much a part of how an atlas looks as anything in it
  const hue = Number(s.hue);
  if (Number.isFinite(hue)) out.hue = ((hue % 360) + 360) % 360;
  const split = Number(s.split);
  if (Number.isFinite(split)) out.split = Math.max(-180, Math.min(180, split));
  if (typeof s.words === 'boolean') out.words = s.words;
  if (typeof s.introSeen === 'boolean') out.introSeen = s.introSeen;
  if (typeof s.lastExportAt === 'string') out.lastExportAt = str(s.lastExportAt, 40);
  if (typeof s.erasedAt === 'string') out.erasedAt = str(s.erasedAt, 40);
  return out;
}

// the fields above, so a caller can say what a file will and will not carry
// without reading this function
export const PORTABLE_SETTINGS = ['authorName', 'theme', 'hue', 'split', 'words', 'introSeen', 'lastExportAt', 'erasedAt'];

// ---------- the payloads ----------
//
// Each kind states its own shape. A payload that does not satisfy its kind is
// rejected here and never reaches a renderer.

// The five, and there is no sixth. js/share.js builds exactly these, and
// js/letters.js seals four of them; a test binds all three lists: a kind one
// of them knows and another does not is either a letter that arrives and
// cannot be opened, or a link that opens onto nothing.
//
// An introduction is the one that is built and read here and never sealed, and
// that asymmetry is the protocol rather than an oversight. A letter is sealed
// to a public key and opened in mode `auth`, which needs the sender's static
// public key at the far end; on a first contact the far end does not have it.
// So an introduction can only travel by the road that needs no prior secret,
// which is a link, in both directions, and the box never carries a stranger.
const PAYLOAD_KINDS = new Set(['atlas', 'folio', 'ask', 'thanks', 'intro']);

// A public key on the wire: base64url of the sixty-five raw bytes of an
// uncompressed P-256 point. The leading 0x04 that says "uncompressed" is the
// leading B here, so a key that is some other kind of point is refused by its
// shape, before anything tries to import it and fails in a language nobody
// wants to read. Eighty-seven characters, which is what sixty-five bytes are.
const PUB_TEXT = /^B[A-Za-z0-9_-]{86}$/;

// A posting capability: the recipient's route and the secret that says this
// poster was invited, joined by the one dot either of them may contain. Both
// halves are twenty-six characters of the club's alphabet, which is what the
// club mints and what it will accept back.
const CAP_TEXT = /^[0-9abcdefghjkmnpqrstvwxyz]{26}\.[0-9abcdefghjkmnpqrstvwxyz]{26}$/;

// And the handle on one of them: eight characters of the same alphabet, which
// is the club's isCapId and is checked here for the reason written at `id`
// above. Shortening this does not shorten a record, it names a different one,
// and the club answers a name it does not know with a refusal.
const CAP_ID = /^[0-9abcdefghjkmnpqrstvwxyz]{8}$/;

export function normPayload(raw) {
  if (!isObj(raw)) return null;
  const p = safeKeys(raw);
  // An allowlist, and a missing kind is an atlas.
  //
  // The two halves of that sentence are different facts. A payload with no
  // kind at all is a link written before the protocol had kinds, and those
  // links are still out there and are complete atlases; reading them as
  // atlases is right and always will be.
  //
  // A payload that names a kind this build has no reader for is a different
  // thing, and it used to fall through to 'atlas' as well. So a handover
  // saying `kind: 'invoice'` was read as an atlas, its own word discarded
  // without a sentence, and whatever places it carried were offered to a
  // person as though the sender had meant to hand over an atlas. The rule is
  // the one this file argues for at line 86: a payload that does not satisfy
  // its kind is refused, and naming a kind nobody here can read is exactly
  // that. It is refused here rather than being quietly renamed.
  const kind = p.kind === undefined || p.kind === null ? 'atlas' : p.kind;
  if (!PAYLOAD_KINDS.has(kind)) return null;

  // The number a handover carries, and the first thing read.
  //
  // It used to be read, coerced and handed straight back, which left the
  // constant above a label rather than a gate. A version-6 handover would have
  // been accepted by this build, which knows five: the normalizers below would
  // have dropped whatever it carried that they have no field for, one quiet
  // field at a time, and passed on the remainder as though it were the whole
  // thing. That is exactly the failure the archive gate exists to prevent, and
  // it was sitting unguarded on the other side of the app.
  //
  // A missing number is version 1 and always will be. Links written before
  // there were numbers are still out there, and they are complete handovers
  // rather than truncated ones.
  //
  // A number that is present must be a whole one this build knows. The string
  // "5" is refused rather than read as five, deliberately: a handover is
  // written by this app, this app writes a number, and a payload that says its
  // version in some other type is not one whose shape may be assumed from it.
  const given = p.v === undefined ? 1 : p.v;
  if (typeof given !== 'number' || !Number.isInteger(given)
    || given < 1 || given > SHARE_VERSION) return null;

  if (kind === 'ask') {
    const q = str(p.q, LIMITS.question).trim();
    if (!q) return null;
    return { v: given, kind, from: str(p.from, LIMITS.author), q };
  }

  // An introduction: a public key and an address, and a name for the person
  // reading it to recognise. Nothing else, ever. It carries no place, so an
  // introduction that arrives from somebody unexpected costs its recipient
  // nothing but a sentence.
  //
  // Both halves are required and both are checked by shape. An introduction
  // missing either one is not a partial introduction, it is a thing somebody
  // could store beside a name and later believe they had paired with; and a
  // key or an address of the wrong shape is refused here rather than deep
  // inside a crypto call, because the sentence a person gets back should be
  // "that is not an introduction" and not the browser's word for it.
  //
  // `from` is what the sender calls themselves, and it authorises nothing.
  // It is a label the recipient may keep or replace, and js/pairing.js says
  // the rest: a matching name never permits an exchange, only a mark read
  // aloud does.
  // Read whole, never clipped, which is the rule this file argues for at the
  // top and the one place it would have been quietly broken. `str` truncates
  // to a limit, and truncating a key is how a key one character too long
  // becomes a key of exactly the right shape: the test that caught it was
  // handed eighty-eight characters and got back a valid introduction to
  // somebody who does not exist. A length here is not a limit to trim to. It
  // is part of what the thing is.
  if (kind === 'intro') {
    const pub = typeof p.pub === 'string' ? p.pub : '';
    const cap = typeof p.cap === 'string' ? p.cap : '';
    if (!PUB_TEXT.test(pub) || !CAP_TEXT.test(cap)) return null;
    return { v: given, kind, from: str(p.from, LIMITS.author), pub, cap };
  }

  // A thanks: one heart, for one place, carried back. It names the place by
  // the sender's own id when the road preserved it, and by name and point
  // always, so a heart can still land when an id was lost along the way.
  // `when` is required because it is the whole of the replay defence: the
  // same link opened twice is one thanks, not two, and a payload that will
  // not say when it was made is one this build will not count.
  if (kind === 'thanks') {
    const name = str(p.name, LIMITS.name).trim();
    const when = str(p.when, 40).trim();
    if (!name || !when) return null;
    const lat = Number(p.at?.lat);
    const lng = Number(p.at?.lng);
    const placed = Number.isFinite(lat) && Number.isFinite(lng)
      && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
    return {
      v: given, kind,
      from: str(p.from, LIMITS.author),
      pid: str(p.pid, LIMITS.name),
      name,
      at: placed ? { lat, lng } : null,
      when,
    };
  }

  const places = normPlaces(p.places);
  const routes = normRoutes(p.routes, decodePath);
  // a shelf handed over alone is still a handover: an atlas of books and no
  // places is what a reading friend actually keeps
  const books = normBooks(p.books);
  if (!places.length && !routes.length && !books.length) return null;
  const base = {
    v: given,
    kind,
    author: str(p.author, LIMITS.author),
    tags: normTags(p.tags),
    places,
    routes,
    books,
  };
  if (kind === 'folio') {
    const title = str(p.title, LIMITS.title).trim();
    if (!title) return null;
    return { ...base, title, dedication: str(p.dedication, LIMITS.dedication) };
  }
  return base;
}

// a kept folio is a named slice of the atlas: references, never copies
export function normFolioRef(raw, i = 0, caps = LIMITS, w = null) {
  if (!isObj(raw)) return null;
  const f = safeKeys(raw);
  const fid = String(f.id ?? '') || `f${i}`;
  const title = cutStr(w, 'folio', fid, 'title', f.title, caps.title ?? LIMITS.title).trim();
  if (!title) return null;
  // a folio is a list of references, and a reference that is dropped is a
  // place that quietly left the collection it belonged to
  const ids = (arr, field, cap) => cutArr(w, 'folio', fid, field,
    Array.isArray(arr) ? arr.filter(x => typeof x === 'string' && !FORBIDDEN.has(x)) : [], cap);
  return {
    id: id(f.id, `f${i}`, w, 'folio', caps.id ?? LIMITS.id),
    title,
    dedication: cutStr(w, 'folio', fid, 'dedication', f.dedication, caps.dedication ?? LIMITS.dedication),
    placeIds: ids(f.placeIds, 'places', caps.placeIds ?? LIMITS.placeIds),
    routeIds: ids(f.routeIds, 'ways', caps.routeIds ?? LIMITS.routeIds),
    bookIds: ids(f.bookIds, 'books', caps.bookIds ?? LIMITS.bookIds),
    createdAt: str(f.createdAt, 40),
    updatedAt: str(f.updatedAt, 40),
    // when this folio was offered to the newsstand, so the shelf can say so
    offeredAt: str(f.offeredAt, 40),
  };
}

export function normFolioRefs(arr) {
  return normList(arr, normFolioRef, LIMITS.folios);
}

// ---------- books ----------
//
// The first record here that may answer to no place at all.
//
// Every other record in this atlas is somewhere: a place is a point, a way is
// a line. A book was read on a train, or it was the reason for a journey, or
// it is simply worth handing to somebody. Tying it to a place is allowed and
// is often the whole point (the novel that is about the town you are standing
// in), but requiring it would be a lie about what a recommendation is, and
// the app would start asking where somebody read something in order to let
// them say it was good.
//
// So an empty `placeId` is not a record missing a field. It is a book that
// answers to no place, which is most books. A `placeId` naming a place this
// atlas does not hold is left exactly as it is: a book must not lose the
// place it belongs to because the place arrived in a later file.
//
// The two status words are the same two every other record uses, so the
// filters and the comparison do not have to learn a third vocabulary. Only
// the word a person sees changes: a place has been visited, a book has been
// read.
export function normBook(raw, i = 0, caps = LIMITS, w = null) {
  if (!isObj(raw)) return null;
  const b = safeKeys(raw);
  const bid = String(b.id ?? '') || `b${i}`;
  // a book with no title is not a book, the way a place with no coordinates
  // is not a place: there is nothing left to name it by
  const title = cutStr(w, 'book', bid, 'title', b.title, caps.name).trim();
  if (!title) return null;
  const out = {
    id: id(b.id, `b${i}`, w, 'book', caps.id ?? LIMITS.id),
    title,
    author: cutStr(w, 'book', bid, 'author', b.author, caps.author ?? LIMITS.author),
    year: cutStr(w, 'book', bid, 'year', b.year, caps.year ?? LIMITS.year),
    placeId: typeof b.placeId === 'string' && !FORBIDDEN.has(b.placeId)
      ? str(b.placeId, caps.id ?? LIMITS.id) : '',
    tags: cutArr(w, 'book', bid, 'tags',
      Array.isArray(b.tags) ? b.tags.filter(t => typeof t === 'string' && !FORBIDDEN.has(t)) : [],
      caps.tagsPerPlace),
    status: b.status === 'visited' ? 'visited' : 'wishlist',
    private: b.private === true,
    note: cutStr(w, 'book', bid, 'note', b.note, caps.note),
    url: /^https?:\/\//i.test(String(b.url ?? '')) ? cutStr(w, 'book', bid, 'url', b.url, caps.url) : '',
    createdAt: str(b.createdAt, 40),
    updatedAt: str(b.updatedAt, 40),
    sample: b.sample === true,
  };
  // a link carries the road as `prov`: the names it passed through, in order,
  // read exactly as a place reads its own
  if (!isObj(b.provenance) && Array.isArray(b.prov) && b.prov.length) {
    const road = b.prov.filter(isObj).map(h => ({ name: str(h.name, LIMITS.author), at: str(h.at, 40) })).filter(h => h.name);
    if (road.length) {
      const last = road[road.length - 1];
      const before = road.slice(0, -1);
      const cap = caps.chain ?? LIMITS.chain;
      out.provenance = {
        chain: cutTail(w, 'book', bid, 'earlier bylines', before, Math.max(0, cap - 1)),
        name: last.name, sig: 0, adoptedAt: last.at,
      };
    }
  }

  // whose recommendation this was, read exactly as a place reads it
  if (isObj(b.provenance)) {
    out.provenance = {
      chain: cutTail(w, 'book', bid, 'earlier bylines',
        Array.isArray(b.provenance.chain)
          ? b.provenance.chain
            .filter(isObj)
            .map(h => ({ name: cutStr(w, 'book', bid, 'a byline', h.name, caps.author ?? LIMITS.author), at: str(h.at, 40) }))
            .filter(h => h.name)
          : [],
        caps.chain ?? LIMITS.chain),
      name: cutStr(w, 'book', bid, 'byline', b.provenance.name, caps.author ?? LIMITS.author),
      sig: Number(b.provenance.sig) || 0,
      adoptedAt: str(b.provenance.adoptedAt, 40),
    };
    const src = str(b.provenance.srcId, LIMITS.name);
    if (src) out.provenance.srcId = src;
  }
  return out;
}

export function normBooks(arr) { return normList(arr, normBook, LIMITS.books); }

// ---------- the letters slice ----------
//
// What a member needs in order to write to somebody and be written to: their
// own private key, their own box address, and one record per person they have
// exchanged introductions with. It is the only thing in this file that is
// never part of an archive, and that is a decision rather than an omission.
//
// A private key in a plain file is a private key in a downloads folder, in a
// backup service and in whatever else copies files, and it is not merely a
// disclosure: identity is the membership, so somebody holding it can write
// letters that open as yours. So this travels in the sealed vault and nowhere
// else, exportJSON does not list it, and a test holds that.
//
// It is still normalised, because what comes back out of the vault has been
// through a network and a decryption and may be from a build that is not this
// one. A key of the wrong curve is refused here rather than inside importKey,
// where the sentence a person gets back would be the browser's.
const CURVE = { kty: 'EC', crv: 'P-256' };
const B64U = /^[A-Za-z0-9_-]+$/;
const PAIR_STATES = new Set(['introduced', 'returned', 'verified', 'withdrawn', 'repair']);

function normJwk(raw) {
  if (!isObj(raw)) return null;
  const j = safeKeys(raw);
  if (j.kty !== CURVE.kty || j.crv !== CURVE.crv) return null;
  // x, y and d, and no other field travels. A JWK carries `ext` and `key_ops`
  // and whatever else a build put there, and none of it describes the key: it
  // describes what one browser was once willing to do with it.
  const parts = [j.x, j.y, j.d].map(v => (typeof v === 'string' ? v : ''));
  if (parts.some(v => !v || v.length > 100 || !B64U.test(v))) return null;
  return { ...CURVE, x: parts[0], y: parts[1], d: parts[2] };
}

function normPair(raw, i = 0) {
  if (!isObj(raw)) return null;
  const p = safeKeys(raw);
  const pub = typeof p.pub === 'string' ? p.pub : '';
  const cap = typeof p.cap === 'string' ? p.cap : '';
  // A pairing with neither half is not a pairing. One half is allowed and is
  // the ordinary state of having introduced yourself and heard nothing back.
  if (pub && !PUB_TEXT.test(pub)) return null;
  if (cap && !CAP_TEXT.test(cap)) return null;
  const state = PAIR_STATES.has(p.state) ? p.state : 'repair';
  return {
    id: str(p.id, LIMITS.id) || `k${i}`,
    // your word for them. it is not their name and it authorises nothing
    name: str(p.name, LIMITS.author),
    pub,
    cap,
    // The id of the capability you minted for them, which is what withdrawing
    // needs. It is not a secret and never was: the secret went to them.
    //
    // Refused rather than clipped, and refused without taking the pairing down
    // with it, which is the one place in this function those two come apart.
    // `pub` and `cap` are the correspondent: a pairing that cannot say who they
    // are is not a pairing, so a bad one drops the row. This is a handle on my
    // own box, and a pairing missing it is still a whole person, still holding
    // the mark two people read to each other. So the field goes and the row
    // stays, and the surface already knows what an absent one means: it offers
    // `send them mine` again, and the address that comes back is one the club
    // will actually answer to. Keeping eight characters of a twenty-character
    // string would instead leave a row that says they can write to you, over an
    // address that does not exist, with no word on it that could fix that.
    //
    // The type is asked before the shape, as it is for `pub` and `cap` above,
    // because a regular expression answers about a number by turning it into a
    // string first: 12345678 is eight characters of this alphabet and would
    // survive as the number it arrived as, into a field every reader here has
    // been promised is text.
    capId: typeof p.capId === 'string' && CAP_ID.test(p.capId) ? p.capId : '',
    state,
    // The PAIRING_VERSION the mark was read aloud under. Zero means before this
    // field existed, which is older than any version there has been, which is
    // the truth about such a pairing rather than a default standing in for it.
    //
    // Kept rather than clamped when it is a number this build has never
    // written: maySend asks for equality with its own version and refuses on
    // its own, so there is nothing to gain by flattening it, and flattening
    // would quietly rewrite what a later build wrote down.
    v: Number.isInteger(p.v) && p.v >= 0 ? p.v : 0,
    // Twenty characters and the four spaces between them, which is what markOf
    // writes. It is a width and not a shape on purpose: a clipped mark is not
    // refused, it is written down short, and a short mark never equals the one
    // computed next time, so the pairing quietly stops being verifiable at all.
    // js/pairing.js widened the mark from forty bits to ninety-six and this
    // number is the other half of that change.
    mark: str(p.mark, 24),
    at: str(p.at, 40),
    // the voice this person's atlas became, when one has arrived
    cid: str(p.cid, LIMITS.id),
  };
}

export function normLetters(raw) {
  if (!isObj(raw)) return null;
  const l = safeKeys(raw);
  // One shape and no past. Nothing has ever written another, so a number this
  // build does not know is a thing to refuse rather than a thing to migrate.
  if (l.v !== 1) return null;
  const pub = typeof l.pub === 'string' ? l.pub : '';
  const route = typeof l.route === 'string' ? l.route : '';
  const jwk = normJwk(l.jwk);
  // This slice holds the private identity and the handles that close posting
  // capabilities. It is therefore all-or-nothing, like every record key read
  // by store.readAll: repairing a malformed field into an empty one would make
  // the next ordinary save overwrite the only bytes that might be recoverable.
  // `null` is the one valid no-identity value; anything else that is not the
  // exact key shape refuses the whole slice.
  if (l.jwk !== null && !jwk) return null;
  if (typeof l.pub !== 'string' || (pub && !PUB_TEXT.test(pub))) return null;
  if (typeof l.route !== 'string'
    || (route && !/^[0-9abcdefghjkmnpqrstvwxyz]{26}$/.test(route))) return null;
  if (!Array.isArray(l.pairs)) return null;
  const pairs = [];
  // Pairings are private membership state, not the bounded correspondents
  // collection carried in a stranger's atlas. Reusing that 64-row disclosure
  // cap here silently discarded every later pairing on reload, including the
  // capability id needed to withdraw it at the club.
  const src = l.pairs;
  const seen = new Set();
  for (let i = 0; i < src.length; i++) {
    const p = normPair(src[i], i);
    // two records under one id is two people one of whom cannot be reached
    if (!p || seen.has(p.id)) return null;
    seen.add(p.id);
    pairs.push(p);
  }
  return {
    v: 1,
    jwk,
    pub,
    route,
    pairs,
  };
}

// A message id as js/letters.js writes one and club/src/validate.js reads one:
// sixteen bytes in lower-case hex. Three implementations of one rule now, and a
// test holds all three against the same corpus, because a device that thinks an
// id is well formed while the club does not is a device posting letters that
// are refused for a reason nobody can see.
export const MSG_ID = /^[0-9a-f]{32}$/;
export const isMsgId = v => typeof v === 'string' && MSG_ID.test(v);

// how many finished-with ids the device keeps. see the store, where the cost of
// the bound is written down beside the reason for it
export const POST_KEPT = 200;

// The ledger of letters already dealt with. Nothing here is a secret and
// nothing here is a record: it is a list of ids, and the only two questions it
// can answer are whether this device has seen one and how many it remembers.
//
// Refused whole rather than repaired, like every other slice read from storage.
// A ledger that arrived as something else is not a ledger with some bad rows in
// it; it is a file somebody or something has written over, and the empty answer
// that follows costs a person at worst one letter shown twice.
export function normPost(raw) {
  if (!isObj(raw)) return null;
  const p = safeKeys(raw);
  if (p.v !== 1) return null;
  const src = Array.isArray(p.done) ? p.done : [];
  const seen = new Set();
  for (const id of src) if (isMsgId(id)) seen.add(id);
  // oldest first is the order the store drops from, so the tail is what a
  // truncated list keeps: the ids most recently finished with
  const done = [...seen].slice(Math.max(0, seen.size - POST_KEPT));
  return { v: 1, done };
}

// an exported file, on its way back in
// Three doors, not one.
//
// A share link is a stranger: it is capped hard, because a hostile payload
// must not be able to spend this device. A private archive is the person's
// own memory coming home: nothing in it is shortened, and if anything in it
// cannot be kept exactly, the whole restore stops before a single record is
// written. They used to be the same function, so restoring a backup of 501
// places gave back 500 and called it success. Then the generous numbers did
// the same thing one level down, at the 3001st point of a way. A limit chosen
// so that loss is rare is still a limit that loses; this door has none.

// how many of each kind a stranger may hand over at once
const SHARE_CAPS = {
  places: LIMITS.places, routes: LIMITS.routes, books: LIMITS.books,
  folios: LIMITS.folios, tags: LIMITS.tags, correspondents: LIMITS.correspondents,
};
// a person's own archive: as many as it carries
const ARCHIVE_CAPS = {
  places: ALL, routes: ALL, folios: ALL, tags: ALL, correspondents: ALL, books: ALL,
};

function gather(arr, fn, cap, decode, caps, w) {
  if (!Array.isArray(arr)) return { kept: [], given: 0, rejected: [], cut: 0 };
  const kept = [];
  const rejected = [];
  for (let i = 0; i < arr.length && kept.length < cap; i++) {
    const v = decode ? fn(arr[i], i, decode, caps, w) : fn(arr[i], i, caps, w);
    if (v) kept.push(v);
    else rejected.push({ at: i, id: String(arr[i]?.id ?? '') || null });
  }
  return { kept, given: arr.length, rejected, cut: Math.max(0, arr.length - cap) };
}

const KINDS = { tags: 'tag', places: 'place', routes: 'path', folios: 'folio', correspondents: 'voice', books: 'book' };

// { value, cut, rejected, clipped }
//
// cut      — whole collections truncated at the top level
// rejected — records that could not be read at all, named
// clipped  — fields that had to be shortened, named, and beside them the
//            fields this version has no place for at all, each marked
//            `setAside` and separated again by losses() and setAside() below
//
// For an own archive all three are empty of losses or the restore does not
// happen. A set-aside field is the one thing that may sit in `clipped` and
// still let the atlas through, because nothing of it was destroyed here.
function readAtlas(raw, caps, fieldCaps = LIMITS, witness = null) {
  if (!isObj(raw)) return null;
  const d = safeKeys(raw);
  const w = witness;
  const parts = {
    tags: gather(d.tags, normTag, caps.tags, null, fieldCaps, w),
    places: gather(d.places, normPlace, caps.places, null, fieldCaps, w),
    routes: gather(d.routes, normRoute, caps.routes, decodePath, fieldCaps, w),
    folios: gather(d.folios, normFolioRef, caps.folios, null, fieldCaps, w),
    correspondents: gather(d.correspondents, normCorrespondent, caps.correspondents, null, fieldCaps, w),
    books: gather(d.books, normBook, caps.books ?? 0, null, fieldCaps, w),
  };
  const cut = Object.entries(parts).filter(([, p]) => p.cut > 0)
    .map(([k, p]) => ({ of: k, given: p.given, kept: p.kept.length }));
  const rejected = Object.entries(parts).flatMap(([k, p]) => p.rejected.map(r => ({
    kind: KINDS[k] || k, id: r.id, at: r.at, field: null,
    reason: 'this record could not be read: it is missing something it cannot be without, or it is not the shape a record has',
  })));
  return {
    value: {
      tags: parts.tags.kept, places: parts.places.kept, routes: parts.routes.kept,
      folios: parts.folios.kept, correspondents: parts.correspondents.kept,
      books: parts.books.kept,
      settings: normSettings(d.settings, fieldCaps, w),
    },
    cut, rejected, clipped: w || [],
  };
}

// a stranger's payload: capped hard, silence is fine
export function normImport(raw) {
  const r = readAtlas(raw, SHARE_CAPS);
  return r ? r.value : null;
}

// A person's own archive coming home. Nothing is shortened. Whatever could
// not be kept exactly is named, and the caller refuses on any of it.
//
// Before any of that, the file has to say what it is. This used to accept any
// object at all: a json file from another program restored as an empty atlas,
// a file written by a NEWER Resonate had its unknown fields quietly dropped
// and could then be exported back in this build's poorer shape, two records
// sharing an id both landed and only one of them could ever be edited again,
// and a folio could point at places the file did not contain. None of it was
// reported, because the witness only ever hears about a KNOWN field being
// shortened. A reader that cannot recognise a loss cannot promise there was
// none.
//
// A field this version has no place for is the same problem read from the
// other end: it is known, it is not kept, and it is named on its own channel
// rather than absorbed.
export function readArchive(raw) {
  const r = readAtlas(raw, ARCHIVE_CAPS, OWN, []);
  if (!r) return null;
  const refused = [];
  const d = isObj(raw) ? safeKeys(raw) : {};

  // What it is, said outright rather than only when it happens to be said
  // wrong. The first version of this check refused a file that named another
  // program and let a file that named nothing straight through, which is the
  // wrong way round: an archive nobody can identify is exactly the one to be
  // careful with. Everything this app has ever written carries both marks.
  const v = Number(d.version);
  const named = d.app === 'resonate';
  const dated = Number.isInteger(v) && v >= 1 && v <= ARCHIVE_VERSION;
  if (!named || !dated) {
    refused.push({ kind: 'file', id: null, field: 'identity',
      reason: !named && d.app !== undefined
        ? `this file says it was written by ${String(d.app).slice(0, 40)}, not by resonate`
        : Number.isFinite(v) && v > ARCHIVE_VERSION
          ? `this file was written by a newer resonate (its form is ${v}, this one reads ${ARCHIVE_VERSION}). opening it here would quietly drop what this build does not know about`
          : 'this file does not say that it is a resonate archive, or does not say which form it is in' });
  }

  // two records with one name between them: only the first can ever be
  // edited again, and removing it removes them both
  const twice = (list, kind) => {
    const seen = new Set();
    for (const rec of list) {
      if (seen.has(rec.id)) {
        refused.push({ kind, id: rec.id, field: 'id',
          reason: 'two records in this file share one id, and only one of them could ever be reached again' });
        return;
      }
      seen.add(rec.id);
    }
  };
  twice(r.value.places, 'place');
  twice(r.value.routes, 'path');
  twice(r.value.folios, 'folio');
  twice(r.value.tags, 'tag');
  twice(r.value.correspondents, 'voice');
  twice(r.value.books, 'book');

  // a folio that names something the file does not carry
  const held = new Set([
    ...r.value.places.map(p => p.id),
    ...r.value.routes.map(x => x.id),
    ...r.value.books.map(b => b.id),
  ]);
  for (const f of r.value.folios) {
    const missing = [...f.placeIds, ...f.routeIds, ...(f.bookIds || [])].filter(id => !held.has(id));
    if (missing.length) {
      refused.push({ kind: 'folio', id: f.id, field: 'contents',
        reason: `this folio names ${missing.length} record${missing.length === 1 ? '' : 's'} the file does not contain` });
    }
  }

  // A book naming a place this file does not carry is deliberately NOT
  // refused, and the difference from the folio above is the whole argument. A
  // folio IS its list: name three places it does not carry and three quarters
  // of it is gone. A book is its title, its author and its note, and the place
  // is an attachment. A stale attachment has destroyed nothing, so refusing
  // the archive over it would cost a person every book they own to punish one
  // dangling pointer. `removePlace` clears the pointer at the source, so the
  // app does not write one; a file that has one anyway comes home whole.

  // A record using a tag the file does not define keeps the id and loses the
  // word: the colour, the name and the meaning all go, and the record comes
  // back filed under nothing anyone can read. That is a loss like any other,
  // so it is named like one.
  const known = new Set(r.value.tags.map(t => t.id));
  for (const rec of [...r.value.places, ...r.value.routes, ...r.value.books]) {
    const missing = (rec.tags || []).filter(id => !known.has(id));
    if (missing.length) {
      refused.push({ kind: r.value.places.includes(rec) ? 'place' : r.value.books.includes(rec) ? 'book' : 'path', id: rec.id, field: 'tags',
        reason: `this record uses ${missing.length} tag${missing.length === 1 ? '' : 's'} the file does not define` });
    }
  }

  // a voice carries its own small atlas, and it is held to the same rules
  for (const c of r.value.correspondents) {
    twice(c.tags, `a tag kept under ${c.name || c.id}`);
    twice(c.places, `a place kept under ${c.name || c.id}`);
    const theirs = new Set(c.tags.map(t => t.id));
    for (const pl of c.places) {
      const missing = (pl.tags || []).filter(id => !theirs.has(id));
      if (missing.length) {
        refused.push({ kind: 'place', id: pl.id, field: 'tags',
          reason: `a place kept under ${c.name || c.id} uses ${missing.length} tag${missing.length === 1 ? '' : 's'} their part of this file does not define` });
      }
    }
  }

  return { ...r, refused };
}

// everything an own archive lost, in one list a person can be shown. Empty is
// the only acceptable answer for a restore.
export function losses(read) {
  if (!read) return [];
  const out = [];
  for (const c of read.cut || []) {
    out.push({ kind: c.of, id: null, field: null,
      reason: `${c.given} ${c.of} in the file and only ${c.kept} could be held` });
  }
  for (const r of read.rejected || []) out.push(r);
  for (const c of read.clipped || []) {
    // a field this version has no place for is told, not lost: the file is
    // untouched and still holds every one of them, so it must not stop the
    // atlas coming home. setAside() below is where it is heard instead.
    if (c.setAside) continue;
    out.push({ kind: c.kind, id: c.id, field: c.field, reason: c.reason });
  }
  for (const x of read.refused || []) out.push(x);
  return out;
}

// What the file carried that this version has no place for. Not a loss: the
// file is untouched and still holds every one of them. The person is told
// before the restore, and the restore still happens.
export function setAside(read) {
  return (read?.clipped || []).filter(c => c.setAside);
}

// what this device already holds: never capped, or an atlas would shrink
// every time it was loaded
export function readLocal(arr, kind) {
  const fn = { places: normPlace, routes: normRoute, tags: normTag,
    folios: normFolioRef, correspondents: normCorrespondent, books: normBook }[kind];
  const r = gather(arr, fn, ALL, kind === 'routes' ? decodePath : null, OWN, null);
  return r.kept;
}

// The newsstand's gate went with the newsstand (closed 2026-08-11). It read a
// row of a public index written by a machine: a file name, a byline, a count.
// Nothing fetches that index now, so the gate guarded a door that is bricked
// up, and a gate nobody walks through is a gate nobody maintains.

// ---------- what kind of file is this ----------
//
// Resonate writes several kinds of JSON and, until now, read one. The file
// input asked every arriving file whether it was a private archive, and told
// anything that was not "that file isn't a resonate export" - including the
// file this app itself offers when a link is too long to send.
//
// Two shapes have to be kept apart here, and the difference is not cosmetic.
// A private archive is a person's own atlas coming home, and it may replace
// everything they hold. A handover is somebody else's material arriving, and
// it may replace nothing at all: it is read, weighed, and taken from a record
// at a time. Unwrapping one into the other's door would put a stranger's file
// in front of the word "make this atlas the file".
//
// So the kind is decided once, at the top, before any reader runs. Every
// branch is evaluated rather than the first match returned, because a file
// that answers to two descriptions is not a file whose meaning is decided by
// the order these ifs happen to be written in. It is refused.
//
// `assistant_result` will be a sixth answer here when a result has a
// normalizer to pass. It is not listed while nothing can produce one: a branch
// that admits a shape no gate can check is a hole, not a preparation.
export function classifyFile(raw) {
  if (!isObj(raw) || Array.isArray(raw)) return { kind: 'unknown', value: null };
  const p = safeKeys(raw);
  // every file this app writes says whose it is, and it is the one field that
  // is checked before anything is interpreted
  if (p.app !== 'resonate') return { kind: 'unknown', value: null };

  const found = [];
  if (Number.isInteger(p.version)) found.push({ kind: 'private_archive', value: raw });
  if (p.kind === 'atlas' || p.kind === 'folio' || p.kind === 'ask') {
    const payload = normPayload(raw);
    if (payload) found.push({ kind: 'human_handover', value: payload });
  }
  if (p.kind === 'assistant_copy' && isObj(p.disclosure)) {
    const payload = normPayload(p.disclosure);
    if (payload) found.push({ kind: 'assistant_copy', value: payload });
  }

  if (found.length > 1) return { kind: 'ambiguous', value: null };
  // a resonate file whose shape no reader here answers to. said apart from
  // "unknown" because the two deserve different sentences: one is somebody
  // else's file, and this one is ours and cannot be read, which is a thing a
  // person may reasonably want to hear said plainly.
  if (!found.length) return { kind: 'unreadable', value: null };
  return found[0];
}
