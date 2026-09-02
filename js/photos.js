// photos.js — the snapshots, and the way out for pictures kept before.
//
// Records stay in localStorage, where every mutator is synchronous and a
// refused write rolls back whole. This database holds the two things too
// large or too incidental for that key: the three snapshots of the records,
// taken quietly against a browser that evicts storage, and whatever
// photographs a build before this one kept here.
//
// Nothing in this build writes a photograph. The pictures that are here are
// somebody's, they were kept under a promise this app has since withdrawn,
// and everything below them exists so that person can be told how many there
// are, be handed every one back, and be the only one who ever deletes them.
//
// Nothing here throws at the caller. A browser that refuses IndexedDB (a
// private window, an old engine, a wedged database) gets null, and null is
// never quietly read as nought: a store that would not answer is not a store
// that is empty, and the difference is the difference between saying nothing
// is there and saying we could not look.

const DB = 'resonate';
const VERSION = 1;
const PHOTOS = 'photos';
const SNAPS = 'snapshots';
// A reserved snapshot key holds a reversible clear while localStorage and the
// share inbox finish their halves of one erase. It is never exposed as a user
// snapshot and is removed only after all three stores have committed.
const ERASE_JOURNAL = '\u0000resonate-erase';

let dbp = null;

// The open connection is cached, and a refusal is not.
//
// This used to cache whichever promise it made, including one that resolved
// null. One wedged open, one moment of pressure, one other tab holding the
// database while it upgraded, and every later caller for the life of the page
// was handed that same null without the browser ever being asked again. The
// snapshots stopped being taken and nothing said so, and reloading was the
// only cure for a condition that had usually cleared by itself a second later.
// So the three failing paths clear the cache before they answer: the next
// caller asks the browser, rather than asking this variable.
//
// The synchronous throw has to be handled after the assignment rather than
// inside it. That branch runs while `new Promise` is still on the stack, so a
// `dbp = null` there would be overwritten by the assignment it was meant to
// prevent.
function open() {
  if (dbp) return dbp;
  let refusedAtOnce = false;
  const p = new Promise((resolve) => {
    let req;
    try { req = indexedDB.open(DB, VERSION); }
    catch { refusedAtOnce = true; return resolve(null); }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PHOTOS)) db.createObjectStore(PHOTOS);
      if (!db.objectStoreNames.contains(SNAPS)) db.createObjectStore(SNAPS);
    };
    req.onsuccess = () => {
      const db = req.result;
      // an idle tab holding this open is what blocks somebody else's upgrade.
      // it lets go, and forgets the handle, so the next call opens afresh.
      db.onversionchange = () => { try { db.close(); } catch { /* fine */ } dbp = null; };
      resolve(db);
    };
    req.onerror = () => { dbp = null; resolve(null); };
    req.onblocked = () => { dbp = null; resolve(null); };
  });
  dbp = refusedAtOnce ? null : p;
  return p;
}

// In IndexedDB a request that succeeds has been staged, not written. A write
// therefore answers on the transaction's commit, never before: the caller may
// destroy the only other copy of a picture on the strength of this promise.
function act(store, mode, fn) {
  return open().then(db => {
    if (!db) return null;
    return new Promise((resolve) => {
      let tx;
      try { tx = db.transaction(store, mode); }
      catch { return resolve(null); }
      let value;
      let failed = false;
      const req = fn(tx.objectStore(store));
      if (req) {
        req.onsuccess = () => { value = req.result; };
        req.onerror = () => { failed = true; };
      }
      tx.onabort = () => resolve(null);
      tx.onerror = () => resolve(null);
      tx.oncomplete = () => resolve(failed ? null : (req ? value : true));
    });
  });
}

// ---------- a picture this device already holds ----------
//
// Nothing in the app writes a photograph any more. put() and blobFromDataURL
// are not a way back into keeping pictures: they are how a picture kept inline
// by an older build is moved somewhere a write cannot destroy it, which is what
// liftInlinePictures does below, and how the tests build a device that looks
// like one from before the removal so the count, the rescue page and the
// deletion can be driven against real bytes. A way out nobody has driven end to
// end is a way out on trust.

let seq = 0;
function mintId() {
  seq += 1;
  return `ph_${Date.now().toString(36)}${seq.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

// A data url becomes a blob without a network round trip, and a bad one
// becomes nothing.
//
// atob throws on a character that is not base64, and this is now handed
// whatever a record on somebody's device happens to be carrying rather than
// something a test wrote. Uncaught, from where the lift is awaited, that
// exception would come out of init() and stop the app booting at all: an
// atlas nobody can open, over one damaged picture. What cannot be decoded is
// left exactly where it is and stepped over.
export function blobFromDataURL(uri) {
  if (typeof uri !== 'string') return null;
  const comma = uri.indexOf(',');
  if (comma < 0) return null;
  const head = uri.slice(0, comma);
  const type = (/data:([^;]+)/.exec(head) || [])[1] || 'image/jpeg';
  if (!/;base64$/.test(head)) return null;
  try {
    const bin = atob(uri.slice(comma + 1));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return new Blob([out], { type });
  } catch { return null; }
}

function dataURLFromBlob(blob) {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => resolve(null);
    r.readAsDataURL(blob);
  });
}

// A picture is kept as bytes and a type, never as a Blob.
//
// Safari refuses a Blob in IndexedDB: the transaction aborted with an
// UnknownError, put() answered null, and the build that kept photographs fell
// back to holding the picture inline in the record instead. That is why a
// device from before can be holding pictures in two places at once, and why
// the way out reads both. An ArrayBuffer stores everywhere and has none of
// that history, so the last build to write one wrote it this way.
//
// Both shapes are still on devices: a plain Blob from the earlier releases,
// bytes and a type from the last. get() takes either, so nobody's pictures
// need migrating in order to be handed back.
export async function put(blob) {
  const id = mintId();
  let value = blob;
  try { value = { type: blob.type || 'image/jpeg', buf: await blob.arrayBuffer() }; }
  catch { /* a browser with no arrayBuffer() keeps the older shape */ }
  const ok = await act(PHOTOS, 'readwrite', s => s.put(value, id));
  return ok === null ? null : id;
}

export async function get(id) {
  const held = await act(PHOTOS, 'readonly', s => s.get(id));
  if (!held) return null;
  // the shape written before this release, and the shape written now
  if (held instanceof Blob) return held;
  if (held.buf) return new Blob([held.buf], { type: held.type || 'image/jpeg' });
  return null;
}
function keys() { return act(PHOTOS, 'readonly', s => s.getAllKeys()); }
function forget(id) { return act(PHOTOS, 'readwrite', s => s.delete(id)); }

// ---------- the way out: reading the pictures back, and letting them go ----------
//
// Photographs are leaving Resonate, and a device that kept some before that is
// still holding them. These exist so a person can be told, handed every
// picture back, and then be the one who decides.
//
// There are two places a photograph can be, and for a long time only one of
// them was looked in.
//
// The database is the ordinary one. But whenever IndexedDB refused a blob, and
// Safari refused every one of them for a whole release, the app fell back to
// keeping the picture inline in the record itself, as a data url in the small
// store. Those pictures are in `resonate.places.v1` and nowhere else. Nothing
// in the new build emits that field, so any write of that key takes every one
// of them out of localStorage for good. A farewell that read only the database
// would not have known they were ever there, would have offered a file that
// did not have them in it, and would have watched them go without a word. That
// is the exact thing the house forbids.
//
// So the records are read raw, straight out of localStorage, before the
// loader has been anywhere near them: by the time places reach memory the
// field has already been stripped, and asking the store what it holds would
// answer honestly about the wrong thing.
//
// Reading them raw is what lets this count them. It is not what keeps them:
// the write that destroys them arrives whether or not anybody has read them,
// and at boot it arrives first. liftInlinePictures below is the part that
// keeps them, and everything here reads both places because a picture may not
// have been lifted yet, or may be on a device where it never can be.
//
// On a device that never kept a picture the store is there and empty, because
// open() creates both stores whatever the device has done before. Nothing is
// in it, no record carries the field, and photographCount() is nought, so a
// fresh install never sees any of this.

const PLACES_KEY = 'resonate.places.v1';

// The places exactly as the browser holds them, or null: no key, a key that
// will not parse, a browser that will not answer. A key that will not parse
// is damaged rather than empty, and nothing here writes over it or pretends
// to have read it, which is why the answer is not an empty list.
function rawPlaces() {
  let raw = null;
  try { raw = localStorage.getItem(PLACES_KEY); } catch { return null; }
  if (!raw) return null;
  let list = null;
  try { list = JSON.parse(raw); } catch { return null; }
  return Array.isArray(list) ? list : null;
}

// what a place says about itself on a rescue page: enough to know which one it
// was, and never an id, which tells a person nothing they can use
function placeMark(p) {
  const name = typeof p?.name === 'string' ? p.name.trim() : '';
  const lat = Number(p?.lat);
  const lng = Number(p?.lng);
  const here = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  return name || here ? { name, ...(here || {}) } : null;
}

// Both halves of one read: the pictures kept inline, and the place each
// database id belongs to. Read together because it is one parse of one key,
// and because a caption and a count must not disagree about what is here.
function readTheRecords() {
  const inline = [];
  const byId = new Map();
  for (const p of rawPlaces() || []) {
    if (!Array.isArray(p?.photos)) continue;
    const mark = placeMark(p);
    for (const s of p.photos) {
      if (typeof s !== 'string') continue;
      if (s.startsWith('data:image/')) inline.push({ id: null, dataURL: s, place: mark });
      else if (!byId.has(s)) byId.set(s, mark);
    }
  }
  return { inline, byId };
}

export async function photographCount() {
  return ((await keys()) || []).length + readTheRecords().inline.length;
}

// ---------- lifting the inline pictures out of the records, once ----------
//
// Reading them is not keeping them, and everything above only reads.
//
// A picture kept inline lives in the one key the store rewrites whole on every
// edit, and this build's records carry no photos field at all. So the first
// write of that key after the update destroys it, and there are two writes
// waiting: the one inside store.load() that gives an undated record a date,
// which happens during init before anything has counted a photograph, and then
// every ordinary edit after it. A person on a device holding an undated record
// would never have seen the notice, never seen the door, and never been told
// the pictures had been there at all. A person on a dated one would have been
// promised in writing that nothing had been deleted, and then lost them to the
// next place they marked.
//
// So they move. The database is not reached by any write of that key, and
// everyPhotograph already reads it, so a picture that lands here is a picture
// only releasePhotographs can destroy, which is the word the person presses.
//
// This has to run before the store loads, and the ordering is the whole point:
// app.js awaits it as the first thing init() does, ahead of store.load(). The
// two rules that make an interruption harmless are that a picture is swapped
// for its id only after the transaction holding the bytes has committed, and
// that a swap that cannot be written takes the copy back out. A lift that stops
// halfway leaves every picture in one place or the other, never in neither.
//
// The removal took migratePhotos out with the rest of the photograph machinery,
// and migratePhotos was precisely what used to make an inline picture safe.
// This is that guarantee put back, for pictures nobody is keeping any more.

const isInline = s => typeof s === 'string' && s.startsWith('data:image/');

// The nth picture still kept inline, counted across the records in the order
// they are written down, or null when there is no nth one. Read fresh on every
// call, because every swap rewrites that key underneath this.
function inlineAt(n) {
  const list = rawPlaces();
  if (!list) return null;
  let seen = 0;
  for (let i = 0; i < list.length; i++) {
    const photos = list[i]?.photos;
    if (!Array.isArray(photos)) continue;
    for (let k = 0; k < photos.length; k++) {
      if (!isInline(photos[k])) continue;
      if (seen === n) return { i, k, uri: photos[k] };
      seen += 1;
    }
  }
  return null;
}

// The id takes the picture's place in the records, and not one moment sooner.
//
// Nothing is awaited between the read and the write, for the same reason
// releaseInline does it that way: the store owns this key and writes it whole,
// so a gap here is a gap in which somebody's note could be written and then
// thrown away by us. The picture is checked to be still exactly where it was
// before anything is changed, so a record that moved under us is left alone
// rather than half rewritten.
function swapIn(at, id) {
  const list = rawPlaces();
  const photos = list?.[at.i]?.photos;
  if (!Array.isArray(photos) || photos[at.k] !== at.uri) return false;
  photos[at.k] = id;
  try { localStorage.setItem(PLACES_KEY, JSON.stringify(list)); } catch { return false; }
  return true;
}

// Is any record still carrying a picture inline?
//
// This is asked on every boot by a device that has almost certainly never kept
// a photograph, so it must cost that device nothing: one string scan of one
// key, no parse, no database, no write. A note that happens to contain those
// characters is settled by the reader, which looks only where a picture can be.
export function inlinePicturesHeld() {
  let raw = null;
  try { raw = localStorage.getItem(PLACES_KEY); } catch { return false; }
  // The question is whether a record still carries the field at all, and not
  // whether it still carries a picture inline. Asking the narrower question
  // was a defect that cost the answer: the moment the lift succeeded, no
  // record held an inline picture any longer, so the carry stopped, and the
  // next ordinary write erased the very ids the lift had just put there. The
  // bytes were safe in the database and the place they were taken was gone.
  //
  // Nothing written by this build emits a photos field, so a device that never
  // kept one never gets past this line.
  if (typeof raw !== 'string' || !raw.includes('"photos"')) return false;
  return inlinePicturesByPlace().size > 0;
}

// What a record is called while its pictures are being carried.
//
// Its id, where it has one. A record too old to have been given one can still
// be recognised by its name and its point, which is what it was recognised by
// before ids existed. Matching nothing is the safe answer and leaves the
// record alone: a picture merged onto a neighbour would be worse than a
// picture left where it is.
export function carryKeys(p) {
  const keys = [];
  if (typeof p?.id === 'string' && p.id) keys.push(`id:${p.id}`);
  keys.push(`at:${typeof p?.name === 'string' ? p.name : ''}|${p?.lat}|${p?.lng}`);
  return keys;
}

// A stored record is filed under its first name only. Trying every name on the
// way in would let a record that has an id be found by its point as well, and
// two records standing at one point under one name would then trade
// photographs. Coming out, both names are tried, because a record too old to
// have an id is given one on the way into memory: the id it is holding now was
// minted a moment ago and matches nothing that was ever written down.
export const filedUnder = (p) => carryKeys(p)[0];

// Every record still carrying pictures, by the name the carry knows it under,
// field whole.
//
// The store puts these back on the way to disk while any are left, which is
// what stops an ordinary edit from being the thing that destroys them on a
// device where the database refused to take them. It is the field whole, ids
// and all, so a picture that did land in the database does not lose the place
// it belonged to either. A record with no id of its own cannot be matched to
// anything in memory and is not offered: on such a device the lift is the only
// protection those pictures have.
export function inlinePicturesByPlace() {
  const held = new Map();
  for (const p of rawPlaces() || []) {
    if (!Array.isArray(p.photos) || !p.photos.length) continue;
    held.set(filedUnder(p), p.photos.slice());
  }
  return held;
}

// How many pictures were moved. Nought is the ordinary answer, and on the
// overwhelming majority of devices it is reached without opening anything.
export async function liftInlinePictures() {
  if (!inlinePicturesHeld()) return 0;
  let moved = 0;
  // pictures whose bytes will not decode. They are stepped over rather than
  // dropped, and counted here so the walk moves past them instead of finding
  // the same one for ever.
  let passed = 0;
  for (;;) {
    const at = inlineAt(passed);
    if (!at) return moved;
    const blob = blobFromDataURL(at.uri);
    if (!blob) { passed += 1; continue; }
    const id = await put(blob);
    // the database will not take them. they stay exactly where they are, and
    // store.load() is told to hold its healing write rather than go out over
    // them.
    if (id === null) return moved;
    if (!swapIn(at, id)) {
      // the small store would not take the shorter record, so the picture is
      // still inline, which is where it was. The copy nothing can point at is
      // taken back out rather than left to be counted twice.
      await forget(id);
      return moved;
    }
    moved += 1;
  }
}

// { pictures: [{ id, dataURL, place }], unread }. A picture this device cannot
// read back is counted, never passed over in silence: a file offered in place
// of somebody's photographs must not look complete when it is not.
//
// A picture kept inline is already a data url and cannot fail to be read, so
// it is never in the unread count. `place` is what the records still say the
// picture belonged to, or null where they no longer say anything.
export async function everyPhotograph() {
  const { inline, byId } = readTheRecords();
  const pictures = [];
  let unread = 0;
  for (const id of (await keys()) || []) {
    const blob = await get(id);
    const uri = blob ? await dataURLFromBlob(blob) : null;
    if (uri) pictures.push({ id, dataURL: uri, place: byId.get(id) || null });
    else unread += 1;
  }
  return { pictures: pictures.concat(inline), unread };
}

// The pictures kept inline, taken out of the records, in one synchronous pass.
//
// Nothing is awaited between the read and the write, deliberately: the store
// owns this key and writes it whole on every edit, so a gap here is a gap in
// which somebody's note could be written and then thrown away by us. Returns
// how many were removed, and nought if the bytes would not parse or would not
// write, which are both cases where the person still has their pictures and
// must not be told otherwise.
function releaseInline() {
  const list = rawPlaces();
  if (!list) return 0;
  let dropped = 0;
  for (const p of list) {
    if (!p || !Array.isArray(p.photos)) continue;
    const kept = p.photos.filter(s => !(typeof s === 'string' && s.startsWith('data:image/')));
    dropped += p.photos.length - kept.length;
    if (kept.length) p.photos = kept;
    else delete p.photos;
  }
  if (!dropped) return 0;
  try { localStorage.setItem(PLACES_KEY, JSON.stringify(list)); } catch { return 0; }
  return dropped;
}

// The bytes go, and only a person can start this.
//
// The store is emptied; the store itself stays where it is. Dropping an object
// store can happen nowhere but inside a versionchange transaction, which means
// opening this database at a higher number, and this database is shared with
// the snapshots. That upgrade has three ways to go wrong and every one of them
// is silent: an unguarded delete on a device with no photographs store aborts
// the transaction and takes the snapshots store down with it, a second tab
// still holding the old connection blocks it and answers nothing, and once one
// device has gone to version two every later open at version one is refused
// outright, which would end the snapshots on that device for good. An empty
// store costs a person nothing and risks none of that. The bytes are what was
// asked for, and the bytes are what goes.
//
// Three answers, because there are three things that can happen. The pictures
// are in two places and either place can refuse on its own: a database that
// will not commit, or a small store that has no room for the one write that
// takes the inline pictures out of it. So the count is taken before and after
// and the answer is the difference, rather than the word of whichever half
// happened to be watched. 'gone' means nothing is left. 'partly' means some
// went and some are still here, which a person has to be told plainly or they
// will believe the first thing and act on it.
export async function releasePhotographs() {
  const before = await photographCount();
  await act(PHOTOS, 'readwrite', s => s.clear());
  releaseInline();
  const after = await photographCount();

  if (after >= before) return 'refused';
  return after ? 'partly' : 'gone';
}

// ---------- snapshots: the records, quietly, three deep ----------

export function snapshotPut(json) {
  return act(SNAPS, 'readwrite', s => s.put({ at: new Date().toISOString(), json }, new Date().toISOString()));
}
export async function snapshotKeys() {
  const held = await act(SNAPS, 'readonly', s => s.getAllKeys());
  return held === null ? null : held.filter(k => k !== ERASE_JOURNAL);
}
export function snapshotGet(key) { return act(SNAPS, 'readonly', s => s.get(key)); }

export async function snapshotPrune(keep = 3) {
  const keys = (await snapshotKeys()) || [];
  const doomed = keys.sort().slice(0, Math.max(0, keys.length - keep));
  for (const k of doomed) await act(SNAPS, 'readwrite', s => s.delete(k));
  return doomed.length;
}

// ---------- everything gone ----------

// Stage a reversible database clear. Reading the old entries, clearing both
// stores and writing their exact structured-clone values under the reserved
// key are one IndexedDB transaction: either the journal and the empty stores
// commit together, or neither changes at all.
export async function stageClear() {
  const db = await open();
  if (!db) return false;
  return new Promise((resolve) => {
    let tx;
    try { tx = db.transaction([PHOTOS, SNAPS], 'readwrite'); }
    catch { return resolve(false); }
    let staged = false;
    let failed = false;
    try {
      const photos = tx.objectStore(PHOTOS);
      const snapshots = tx.objectStore(SNAPS);
      const reqs = [photos.getAllKeys(), photos.getAll(), snapshots.getAllKeys(), snapshots.getAll()];
      let waiting = reqs.length;
      const refuse = () => {
        failed = true;
        try { tx.abort(); } catch { /* the transaction is already refusing */ }
      };
      for (const req of reqs) {
        req.onerror = refuse;
        req.onsuccess = () => {
          waiting -= 1;
          if (waiting) return;
          try {
            const [photoKeys, photoValues, snapshotKeys, snapshotValues] = reqs.map(r => r.result || []);
            if (snapshotKeys.includes(ERASE_JOURNAL)) return refuse();
            photos.clear();
            snapshots.clear();
            snapshots.put({
              v: 1,
              photos: photoKeys.map((key, i) => [key, photoValues[i]]),
              snapshots: snapshotKeys.map((key, i) => [key, snapshotValues[i]]),
            }, ERASE_JOURNAL);
            staged = true;
          } catch { refuse(); }
        };
      }
    } catch {
      failed = true;
      try { tx.abort(); } catch { /* already inactive */ }
    }
    tx.oncomplete = () => resolve(staged && !failed);
    tx.onabort = tx.onerror = () => resolve(false);
  });
}

// Restore a staged clear, or answer true when there is no staged clear. The
// restore itself is one transaction, so a retry after a refusal sees the same
// journal and can try again without a second loss.
export async function rollbackClear() {
  const db = await open();
  if (!db) return false;
  return new Promise((resolve) => {
    let tx;
    try { tx = db.transaction([PHOTOS, SNAPS], 'readwrite'); }
    catch { return resolve(false); }
    let valid = true;
    try {
      const photos = tx.objectStore(PHOTOS);
      const snapshots = tx.objectStore(SNAPS);
      const req = snapshots.get(ERASE_JOURNAL);
      req.onerror = () => { valid = false; try { tx.abort(); } catch { /* already refusing */ } };
      req.onsuccess = () => {
        const held = req.result;
        if (held === undefined) return;
        if (held?.v !== 1 || !Array.isArray(held.photos) || !Array.isArray(held.snapshots)) {
          valid = false;
          try { tx.abort(); } catch { /* already refusing */ }
          return;
        }
        try {
          photos.clear();
          snapshots.clear();
          for (const [key, value] of held.photos) photos.put(value, key);
          for (const [key, value] of held.snapshots) snapshots.put(value, key);
        } catch {
          valid = false;
          try { tx.abort(); } catch { /* already refusing */ }
        }
      };
    } catch {
      valid = false;
      try { tx.abort(); } catch { /* already inactive */ }
    }
    tx.oncomplete = () => resolve(valid);
    tx.onabort = tx.onerror = () => resolve(false);
  });
}

export async function commitClear() {
  return (await act(SNAPS, 'readwrite', s => s.delete(ERASE_JOURNAL))) !== null;
}

// Nothing hands out an object url any more, so nothing has to be revoked
// here: the only surface that ever made one was a place's own page, and it
// stopped showing pictures when they left the records. A cache kept for a
// caller that no longer exists is a copy of somebody's photograph held alive
// by nobody, which is the opposite of what this file is now for.
export async function clear() {
  const db = await open();
  if (!db) return false;
  return new Promise((resolve) => {
    let tx;
    try {
      // Both stores are one erase. A commit refusal therefore leaves both as
      // they were, instead of clearing photographs and then silently failing
      // to clear the snapshots (or the other way around).
      tx = db.transaction([PHOTOS, SNAPS], 'readwrite');
      tx.objectStore(PHOTOS).clear();
      tx.objectStore(SNAPS).clear();
    } catch { return resolve(false); }
    tx.oncomplete = () => resolve(true);
    tx.onabort = tx.onerror = () => resolve(false);
  });
}

// ---------- how much room is left ----------

export async function estimate() {
  try {
    const e = await navigator.storage?.estimate?.();
    if (!e) return null;
    return { used: e.usage ?? null, quota: e.quota ?? null };
  } catch { return null; }
}

export async function persisted() {
  try { return await navigator.storage?.persisted?.() ?? null; }
  catch { return null; }
}
