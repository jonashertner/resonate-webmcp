// photos.test.mjs — the snapshots, and the way out for the pictures.
//
// This file used to be about photographs moving out of the records. They have
// since left the app entirely, and two subjects are left. The snapshots share
// one database with the pictures, so an erase and a deletion each have to
// reach exactly the store they name and no other. And a device that kept
// photographs before this build is owed a count, every picture back as a file
// it can open anywhere, and a deletion nobody but that person can start.
//
// The tests that still put() and get() a picture are not nostalgia: a device
// from before is holding both shapes the store has ever written, and the way
// out has to read both or it hands somebody a file short of their own
// pictures.
//
// A stand-in IndexedDB, in the spirit of the FakeStorage beside it: it can be
// made to refuse, and to refuse at the moment a write already looks like it
// landed, so a promise made on the strength of a staged write is not
// hypothetical.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// A transaction here behaves like a real one: the request settles first, and
// the transaction commits after. `abortAtCommit` models the case that matters
// most, a write that looks fine and then fails to land.
class FakeReq {
  constructor(tx) {
    this.onsuccess = null; this.onerror = null; this.result = undefined; this.tx = tx;
    tx.pending += 1;
  }
  settle(result, failed = false) {
    this.result = result;
    queueMicrotask(() => {
      if (failed) this.onerror?.(); else this.onsuccess?.();
      this.tx.pending -= 1;
      this.tx.finish();
    });
  }
}

class FakeStore {
  constructor(map, db, tx) { this.map = map; this.db = db; this.tx = tx; }
  // `refuseAfter` is the half-done case, and it needs its own switch: a
  // database that refuses from the first word proves nothing about a lift
  // that is interrupted between two pictures, which is the case where a
  // picture can end up in neither place or in both.
  put(v, k) {
    const r = new FakeReq(this.tx);
    this.db.puts += 1;
    if (this.db.refuse || (this.db.refuseAfter !== null && this.db.puts > this.db.refuseAfter)) {
      r.settle(undefined, true);
      return r;
    }
    this.map.set(k, v);
    r.settle(k);
    return r;
  }
  get(k) { const r = new FakeReq(this.tx); r.settle(this.map.get(k)); return r; }
  delete(k) { const r = new FakeReq(this.tx); this.map.delete(k); r.settle(true); return r; }
  clear() {
    const r = new FakeReq(this.tx);
    this.map.clear();
    r.settle(true);
    return r;
  }
  getAllKeys() { const r = new FakeReq(this.tx); r.settle([...this.map.keys()]); return r; }
  getAll() { const r = new FakeReq(this.tx); r.settle([...this.map.values()]); return r; }
}

class FakeDB {
  constructor() {
    this.stores = { photos: new Map(), snapshots: new Map() };
    this.refuse = false; this.abortAtCommit = false;
    this.puts = 0; this.refuseAfter = null;
    this.objectStoreNames = { contains: () => true };
  }
  transaction(name) {
    const names = Array.isArray(name) ? name : [name];
    const working = Object.fromEntries(names.map(which => [which, new Map(this.stores[which])]));
    const tx = {
      oncomplete: null, onabort: null, onerror: null, db: this,
      pending: 0, stopped: false, aborted: false,
      abort() { this.aborted = true; this.finish(); },
      finish: () => {
        queueMicrotask(() => {
          if (tx.stopped || tx.pending) return;
          tx.stopped = true;
          if (tx.aborted || this.abortAtCommit) return tx.onabort?.();
          for (const which of names) this.stores[which] = working[which];
          tx.oncomplete?.();
        });
      },
    };
    tx.objectStore = (which = names[0]) => new FakeStore(working[which], this, tx);
    return tx;
  }
}

const db = new FakeDB();
globalThis.indexedDB = {
  open() {
    const r = { onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null, result: db };
    queueMicrotask(() => r.onsuccess?.());
    return r;
  },
};
// The records, as the browser holds them. Photographs are in two places on a
// device from before, and the second one is here: whenever IndexedDB refused a
// blob the app kept the picture inline in the record itself. Nothing under
// test can find those without reading this key raw.
globalThis.localStorage = {
  map: new Map(),
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; },
  setItem(k, v) {
    if (this.full) throw new Error('QuotaExceededError');
    this.map.set(k, String(v));
  },
  removeItem(k) { this.map.delete(k); },
  full: false,
};
const PLACES = 'resonate.places.v1';
const setPlaces = (list) => localStorage.setItem(PLACES, JSON.stringify(list));
const getPlaces = () => JSON.parse(localStorage.getItem(PLACES) || '[]');
// A stand-in that lies is worse than no stand-in. This one used to drop the
// options bag and have no arrayBuffer(), so the store's own "keep it as bytes
// and a type" path could not run here at all and the test agreed with itself
// about nothing. It carries what a Blob carries.
globalThis.Blob = class Blob {
  constructor(parts, opts = {}) {
    this.parts = parts;
    this.type = opts.type || '';
    const first = parts[0];
    this.size = first?.byteLength ?? first?.length ?? 0;
  }
  async arrayBuffer() {
    const first = this.parts[0];
    if (first?.byteLength !== undefined && !first.buffer) return first;
    return first?.buffer ?? new Uint8Array(0).buffer;
  }
};
// A stand-in that lies is worse than no stand-in, and this one did.
// Buffer.from(s, 'base64') quietly discards whatever it does not recognise,
// while the browser's atob throws on it. The lift is handed whatever a record
// on somebody's device is carrying, and under the lenient stand-in a damaged
// picture decoded to nonsense here and threw out of init() in a real browser,
// which is an atlas that does not open. So this refuses what a browser
// refuses: whitespace is dropped, padding is allowed, and anything else
// outside the alphabet is an error.
globalThis.atob = (b64) => {
  const s = String(b64).replace(/[\t\n\f\r ]/g, '');
  if (s.length % 4 === 1 || /[^A-Za-z0-9+/]/.test(s.replace(/={1,2}$/, ''))) {
    throw new Error('InvalidCharacterError');
  }
  return Buffer.from(s, 'base64').toString('binary');
};
// the rescue reads a picture back out as a data url, which is a FileReader in
// the browser and nothing at all here. it takes both shapes the store hands
// back: the bytes written now, and the blob written before them.
globalThis.FileReader = class FileReader {
  readAsDataURL(blob) {
    const first = blob.parts?.[0];
    const bytes = first instanceof Uint8Array ? first : new Uint8Array(first ?? 0);
    this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(bytes).toString('base64')}`;
    queueMicrotask(() => this.onload?.());
  }
};

const photos = await import('../js/photos.js?v=test');

test('a data url becomes bytes, and a bad one becomes nothing', () => {
  const blob = photos.blobFromDataURL('data:image/png;base64,iVBORw0KGgo=');
  assert.ok(blob, 'a real data url yields a blob');
  assert.equal(photos.blobFromDataURL('not a data url'), null);
  assert.equal(photos.blobFromDataURL('data:image/png,notbase64'), null, 'only base64 payloads');
  // atob throws on a character that is not base64, and this is handed whatever
  // a record on somebody's device happens to be carrying. Uncaught, from where
  // the lift is awaited, that comes out of init() and the app does not boot at
  // all: an atlas nobody can open, over one damaged picture.
  assert.equal(photos.blobFromDataURL('data:image/png;base64,!!!! not base64 !!!!'), null,
    'bytes that will not decode threw at the caller instead of answering nothing');
  assert.equal(photos.blobFromDataURL(null), null, 'and nothing at all is nothing, not a crash');
});

test('a kept picture answers to its id, and only its id', async () => {
  db.refuse = false;
  const id = await photos.put(photos.blobFromDataURL('data:image/png;base64,iVBORw0KGgo='));
  assert.match(id, /^ph_[a-z0-9]+$/, id);
  const back = await photos.get(id);
  assert.ok(back, 'it comes back');
  // it is kept as bytes and a type, because safari refuses a blob in
  // indexeddb, and it comes back as a blob either way
  assert.ok(back instanceof Blob, 'a caller is handed a picture, not the shape it was stored in');
  assert.equal(back.type, 'image/png', 'and it remembers what kind of picture it is');
  assert.equal(await photos.get('ph_nothing'), null);
});

test('a browser that refuses answers null, never a broken id', async () => {
  db.refuse = true;
  const id = await photos.put(photos.blobFromDataURL('data:image/png;base64,iVBORw0KGgo='));
  assert.equal(id, null, 'null, never a broken id');
  db.refuse = false;
});

test('the snapshot ring keeps exactly three', async () => {
  db.refuse = false;
  db.stores.snapshots.clear();
  for (const at of ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05']) {
    db.stores.snapshots.set(at, { at, json: '{}' });
  }
  const dropped = await photos.snapshotPrune(3);
  assert.equal(dropped, 2);
  const keys = (await photos.snapshotKeys()).sort();
  assert.deepEqual(keys, ['2026-08-03', '2026-08-04', '2026-08-05'], 'the oldest go first');
});

test('erasing reaches the pictures and the snapshots', async () => {
  db.refuse = false;
  await photos.put(photos.blobFromDataURL('data:image/png;base64,iVBORw0KGgo='));
  await photos.snapshotPut('{}');
  assert.equal(await photos.clear(), true);
  assert.equal(db.stores.photos.size, 0);
  assert.equal(db.stores.snapshots.size, 0);
});

test('an erase that does not commit reports failure and preserves both stores', async () => {
  db.stores.photos.set('held', { buf: new Uint8Array([1]).buffer, type: 'image/png' });
  db.stores.snapshots.set('2026-08-25', { at: '2026-08-25', json: '{}' });
  db.abortAtCommit = true;
  assert.equal(await photos.clear(), false, 'the UI may not announce an erase');
  db.abortAtCommit = false;
  assert.equal(db.stores.photos.has('held'), true, 'the photograph transaction rolled back');
  assert.equal(db.stores.snapshots.has('2026-08-25'), true, 'and so did its snapshot half');
  db.stores.photos.clear();
  db.stores.snapshots.clear();
});

test('a staged erase can put photographs and snapshots back exactly', async () => {
  db.stores.photos.clear();
  db.stores.snapshots.clear();
  const picture = { buf: new Uint8Array([1, 2, 3]).buffer, type: 'image/png' };
  const snapshot = { at: '2026-08-25', json: '{"places":[1]}' };
  db.stores.photos.set('held', picture);
  db.stores.snapshots.set('2026-08-25', snapshot);

  assert.equal(await photos.stageClear(), true);
  assert.equal(db.stores.photos.size, 0, 'the primary photograph store was staged empty');
  assert.deepEqual(await photos.snapshotKeys(), [], 'the recovery record was exposed as a snapshot');
  assert.equal(await photos.rollbackClear(), true);
  assert.deepEqual(db.stores.photos.get('held'), picture);
  assert.deepEqual(db.stores.snapshots.get('2026-08-25'), snapshot);
});

test('a staged erase is irreversible only after its caller commits it', async () => {
  db.stores.photos.clear();
  db.stores.snapshots.clear();
  db.stores.photos.set('held', { buf: new Uint8Array([9]).buffer, type: 'image/png' });
  db.stores.snapshots.set('2026-08-25', { at: '2026-08-25', json: '{}' });

  assert.equal(await photos.stageClear(), true);
  assert.equal(await photos.commitClear(), true);
  assert.equal(db.stores.photos.size, 0);
  assert.equal(db.stores.snapshots.size, 0, 'the temporary recovery copy survived commit');
});

test('a staged erase whose transaction aborts leaves both primary stores whole', async () => {
  db.stores.photos.clear();
  db.stores.snapshots.clear();
  db.stores.photos.set('held', { buf: new Uint8Array([4]).buffer, type: 'image/png' });
  db.stores.snapshots.set('2026-08-25', { at: '2026-08-25', json: '{}' });
  db.abortAtCommit = true;
  assert.equal(await photos.stageClear(), false);
  db.abortAtCommit = false;
  assert.equal(db.stores.photos.has('held'), true);
  assert.equal(db.stores.snapshots.has('2026-08-25'), true);
  db.stores.photos.clear();
  db.stores.snapshots.clear();
});


test('a write that stages and then fails to commit is reported as a failure', async () => {
  db.refuse = false;
  db.abortAtCommit = true;
  const id = await photos.put(photos.blobFromDataURL('data:image/png;base64,iVBORw0KGgo='));
  db.abortAtCommit = false;
  assert.equal(id, null, 'a staged write is not a kept write: the caller must not destroy its copy');
  assert.equal(db.stores.photos.size, 0, 'and nothing landed');
});

test('a picture is kept as bytes and a type, because safari refuses a blob', async () => {
  db.refuse = false;
  const id = await photos.put(photos.blobFromDataURL('data:image/jpeg;base64,/9j/4AAQ'));
  // what actually went into the store: not a Blob, which webkit aborts on
  const held = db.stores.photos.get(id);
  assert.equal(held instanceof Blob, false, 'a blob in indexeddb is what safari refuses');
  assert.ok(held.buf, 'the bytes are there');
  assert.equal(held.type, 'image/jpeg', 'and so is what kind of picture they are');
  const back = await photos.get(id);
  assert.equal(back.type, 'image/jpeg', 'and a caller still gets a picture back');
});

test('a picture kept in the older shape still comes home', async () => {
  db.refuse = false;
  // what releases before this wrote: the blob itself
  const older = photos.blobFromDataURL('data:image/png;base64,iVBORw0KGgo=');
  db.stores.photos.set('ph_older', older);
  const back = await photos.get('ph_older');
  assert.ok(back, 'nobody has to migrate their pictures for this');
  assert.equal(back.type, 'image/png');
});

// ---------- the way out ----------
//
// Photographs are leaving. A device that kept some is owed a count, every
// picture back, and a deletion that only it can start.

test('the count is what the store holds, and nought when it holds nothing', async () => {
  db.refuse = false;
  db.stores.photos.clear();
  localStorage.map.clear();
  assert.equal(await photos.photographCount(), 0, 'a device that never kept one is asked nothing');
  await photos.put(photos.blobFromDataURL('data:image/png;base64,iVBORw0KGgo='));
  await photos.put(photos.blobFromDataURL('data:image/jpeg;base64,/9j/4AAQ'));
  assert.equal(await photos.photographCount(), 2);
});

test('every photograph comes back as a data url, and the unreadable are counted', async () => {
  db.refuse = false;
  db.stores.photos.clear();
  localStorage.map.clear();
  await photos.put(photos.blobFromDataURL('data:image/png;base64,iVBORw0KGgo='));
  // a record the store cannot make a picture of: neither a blob nor bytes
  db.stores.photos.set('ph_wrecked', { nothing: true });

  const { pictures, unread } = await photos.everyPhotograph();
  assert.equal(pictures.length, 1, 'what could be read is handed over');
  assert.match(pictures[0].id, /^ph_[a-z0-9]+$/, 'each one carries its id');
  assert.match(pictures[0].dataURL, /^data:image\/png;base64,/, 'and the picture itself');
  assert.equal(unread, 1, 'and the one that could not be read is counted, never passed over');
});

// ---------- the pictures that were never in the database ----------
//
// Whenever IndexedDB refused a blob, and Safari refused every one of them for
// a whole release, the app kept the picture inline in the record as a data
// url. Those pictures are in localStorage and nowhere else, no surface has
// shown them since photographs left the records, and the first ordinary write
// after this build takes them out of that key for good. A farewell that read
// only the database would have offered a file that did not have them in it and
// then watched them go without a word.

test('a picture kept inline in a record is counted, not overlooked', async () => {
  db.refuse = false;
  db.stores.photos.clear();
  setPlaces([
    { id: 'p1', name: 'The bench', lat: 46.2, lng: 8.2, photos: ['data:image/png;base64,iVBORw0KGgo='] },
    { id: 'p2', name: 'No picture here', lat: 47, lng: 9 },
  ]);
  assert.equal(await photos.photographCount(), 1,
    'a picture the database never held is still a picture this device is holding');

  await photos.put(photos.blobFromDataURL('data:image/jpeg;base64,/9j/4AAQ'));
  assert.equal(await photos.photographCount(), 2, 'and both places are counted, not one');
});

test('an inline picture is handed back, under the place it belonged to', async () => {
  db.refuse = false;
  db.stores.photos.clear();
  setPlaces([{ id: 'p1', name: 'The bench', lat: 46.2, lng: 8.2, photos: ['data:image/png;base64,iVBORw0KGgo='] }]);

  const { pictures, unread } = await photos.everyPhotograph();
  assert.equal(unread, 0, 'a data url cannot fail to be read back');
  assert.equal(pictures.length, 1);
  assert.equal(pictures[0].dataURL, 'data:image/png;base64,iVBORw0KGgo=');
  assert.equal(pictures[0].place.name, 'The bench', 'and it says which place it was');
  assert.equal(pictures[0].place.lat, 46.2);
});

// The caption on a rescue page is the place, and the place is only knowable
// from the raw records: by the time the app has loaded them the field is gone.
test('a picture in the database is handed back under its place too', async () => {
  db.refuse = false;
  db.stores.photos.clear();
  const id = await photos.put(photos.blobFromDataURL('data:image/png;base64,iVBORw0KGgo='));
  setPlaces([{ id: 'p1', name: 'The spring', lat: 45.5, lng: 7.75, photos: [id] }]);

  const { pictures } = await photos.everyPhotograph();
  assert.equal(pictures.length, 1);
  assert.equal(pictures[0].place.name, 'The spring', 'the id is looked up, never printed');
  assert.equal(pictures[0].place.lng, 7.75);
});

test('a picture whose place says nothing is handed back with nothing said', async () => {
  db.refuse = false;
  db.stores.photos.clear();
  await photos.put(photos.blobFromDataURL('data:image/png;base64,iVBORw0KGgo='));
  setPlaces([]);
  const { pictures } = await photos.everyPhotograph();
  assert.equal(pictures[0].place, null, 'null, so the page can say nothing rather than an id');
});

// ---------- lifting them out of the records, once, before anything writes ----------
//
// Reading is not keeping. A picture kept inline lives in the one key the store
// rewrites whole on every edit, and this build's records carry no photos field
// at all, so the very first write after the update destroys it: at boot, in the
// healing write that gives an undated record a date, and after that on any
// ordinary edit. The farewell can read those pictures and still never get the
// chance to offer them.
//
// So they are moved into the object store, which no write of that key can
// reach, before the store has read anything. A picture is swapped for its id
// only after the transaction that holds the bytes has committed, and a lift
// that stops halfway leaves a picture in one place or the other, never in
// neither.

const A_PICTURE = 'data:image/png;base64,iVBORw0KGgo=';
const ANOTHER_PICTURE = 'data:image/jpeg;base64,/9j/4AAQ';

function clean() {
  db.refuse = false;
  db.abortAtCommit = false;
  db.puts = 0;
  db.refuseAfter = null;
  db.stores.photos.clear();
  localStorage.map.clear();
  localStorage.full = false;
}

test('a device that never kept a picture is not asked to open a database', async () => {
  clean();
  setPlaces([{ id: 'p1', name: 'No picture here', lat: 47, lng: 9 }]);
  const before = localStorage.getItem(PLACES);
  let asked = 0;
  const real = globalThis.indexedDB;
  globalThis.indexedDB = { open(...a) { asked += 1; return real.open(...a); } };
  const cold = await import('../js/photos.js?v=lift-cold');
  const moved = await cold.liftInlinePictures();
  globalThis.indexedDB = real;

  assert.equal(moved, 0);
  assert.equal(asked, 0, 'a device that never held a photograph paid for one that did');
  assert.equal(localStorage.getItem(PLACES), before, 'and its records were not rewritten');
});

test('the pictures kept inline are moved into the store, and the records keep the ids', async () => {
  clean();
  setPlaces([
    { id: 'p1', name: 'The bench', lat: 46.2, lng: 8.2, photos: [A_PICTURE, 'ph_kept'] },
    { id: 'p2', name: 'Another', lat: 47, lng: 9, photos: [ANOTHER_PICTURE] },
  ]);
  assert.equal(await photos.photographCount(), 2, 'two, before anything is moved');

  assert.equal(await photos.liftInlinePictures(), 2);
  assert.equal(db.stores.photos.size, 2, 'the bytes are where no write of that key can reach them');

  const back = getPlaces();
  assert.match(back[0].photos[0], /^ph_[a-z0-9]+$/, 'the picture became an id');
  assert.equal(back[0].photos[1], 'ph_kept', 'and an id already there was not touched');
  assert.match(back[1].photos[0], /^ph_[a-z0-9]+$/);
  assert.equal(localStorage.getItem(PLACES).includes('data:image/'), false, 'nothing is left inline');
  assert.equal(await photos.photographCount(), 2, 'two after, never four');

  // and what the farewell hands back is unchanged: the same bytes, still
  // saying which place they belonged to
  const { pictures, unread } = await photos.everyPhotograph();
  assert.equal(unread, 0);
  assert.deepEqual(pictures.map(p => p.dataURL).sort(), [ANOTHER_PICTURE, A_PICTURE].sort());
  assert.equal(pictures.find(p => p.dataURL === A_PICTURE).place.name, 'The bench',
    'a picture that lost the place it belonged to is a picture nobody can place');
});

test('a database that refuses leaves every picture exactly where it is', async () => {
  clean();
  db.refuse = true;
  setPlaces([{ id: 'p1', name: 'The bench', lat: 46.2, lng: 8.2, photos: [A_PICTURE] }]);

  assert.equal(await photos.liftInlinePictures(), 0);
  db.refuse = false;
  assert.deepEqual(getPlaces()[0].photos, [A_PICTURE],
    'a picture swapped for an id the store never kept is a picture destroyed');
  assert.equal(await photos.photographCount(), 1);
});

test('a write that stages and then fails to commit moves nothing', async () => {
  clean();
  db.abortAtCommit = true;
  setPlaces([{ id: 'p1', name: 'The bench', lat: 46.2, lng: 8.2, photos: [A_PICTURE] }]);

  assert.equal(await photos.liftInlinePictures(), 0);
  db.abortAtCommit = false;
  assert.deepEqual(getPlaces()[0].photos, [A_PICTURE],
    'the id was written down on the strength of a write that never landed');
  assert.equal(await photos.photographCount(), 1);
});

test('a lift interrupted halfway leaves the rest where they are', async () => {
  clean();
  db.refuseAfter = 1;
  setPlaces([
    { id: 'p1', name: 'The bench', lat: 46.2, lng: 8.2, photos: [A_PICTURE] },
    { id: 'p2', name: 'Another', lat: 47, lng: 9, photos: [ANOTHER_PICTURE] },
  ]);

  assert.equal(await photos.liftInlinePictures(), 1);
  db.refuseAfter = null;
  const back = getPlaces();
  assert.match(back[0].photos[0], /^ph_[a-z0-9]+$/, 'the one that landed is an id now');
  assert.equal(back[1].photos[0], ANOTHER_PICTURE, 'and the one that did not is exactly where it was');
  assert.equal(await photos.photographCount(), 2, 'two, in one place or the other, never in neither');
});

test('a record that cannot be rewritten gets its picture back rather than a twin', async () => {
  clean();
  setPlaces([{ id: 'p1', name: 'The bench', lat: 46.2, lng: 8.2, photos: [A_PICTURE] }]);
  // the small store has no room for the shorter record
  localStorage.full = true;
  const moved = await photos.liftInlinePictures();
  localStorage.full = false;

  assert.equal(moved, 0);
  assert.deepEqual(getPlaces()[0].photos, [A_PICTURE], 'the picture is still where its owner last had it');
  assert.equal(db.stores.photos.size, 0, 'and the copy nothing points at was taken back out');
  assert.equal(await photos.photographCount(), 1, 'one picture, counted once');
});

test('bytes that will not decode are stepped over, never lost and never looped on', async () => {
  clean();
  const DAMAGED = 'data:image/png;base64,!!!! not base64 !!!!';
  setPlaces([{ id: 'p1', name: 'The bench', lat: 46.2, lng: 8.2,
    photos: ['data:image/png,notbase64', DAMAGED, A_PICTURE] }]);

  // it returns at all, which is the first thing: a lift that threw would come
  // out of init() and the app would not boot, and a lift that found the same
  // undecodable picture for ever would hang there
  assert.equal(await photos.liftInlinePictures(), 1);
  const back = getPlaces();
  assert.equal(back[0].photos[0], 'data:image/png,notbase64', 'what cannot be read is left exactly as it is');
  assert.equal(back[0].photos[1], DAMAGED, 'and so is what will not decode');
  assert.match(back[0].photos[2], /^ph_[a-z0-9]+$/, 'and the good picture beside them still moved');
});

test('records that will not parse are lifted from not at all', async () => {
  clean();
  localStorage.map.set(PLACES, '{ not json');
  assert.equal(await photos.liftInlinePictures(), 0);
  assert.equal(localStorage.getItem(PLACES), '{ not json', 'damaged bytes are not guessed at, or written over');
});

test('records that will not parse are read as nothing, and never written over', async () => {
  db.refuse = false;
  db.stores.photos.clear();
  localStorage.map.set(PLACES, '{ not json');
  assert.equal(await photos.photographCount(), 0, 'damaged bytes are not guessed at');
  await photos.releasePhotographs();
  assert.equal(localStorage.getItem(PLACES), '{ not json', 'and they are still exactly where they were');
});

test('letting the pictures go empties them and leaves the snapshots alone', async () => {
  db.refuse = false;
  db.stores.photos.clear();
  db.stores.snapshots.clear();
  localStorage.map.clear();
  await photos.put(photos.blobFromDataURL('data:image/png;base64,iVBORw0KGgo='));
  await photos.snapshotPut('{"places":[]}');

  assert.equal(await photos.releasePhotographs(), 'gone');
  assert.equal(db.stores.photos.size, 0, 'the bytes a person asked to be rid of');
  assert.equal(db.stores.snapshots.size, 1, 'and nothing else in the database it shares');
  assert.equal(await photos.photographCount(), 0);
});

test('letting them go reaches the pictures kept inline as well', async () => {
  db.refuse = false;
  db.stores.photos.clear();
  setPlaces([
    { id: 'p1', name: 'The bench', lat: 46.2, lng: 8.2, photos: ['data:image/png;base64,iVBORw0KGgo=', 'ph_kept'] },
    { id: 'p2', name: 'Another', lat: 47, lng: 9, photos: ['data:image/jpeg;base64,/9j/4AAQ'] },
  ]);

  assert.equal(await photos.releasePhotographs(), 'gone');
  assert.equal(await photos.photographCount(), 0, 'nothing is left to be gone');
  const back = getPlaces();
  assert.deepEqual(back[0].photos, ['ph_kept'],
    'the inline picture went and the id beside it was not touched');
  assert.equal('photos' in back[1], false, 'a field with nothing left in it is not left behind empty');
});

test('half a deletion is called half a deletion', async () => {
  db.refuse = false;
  db.stores.photos.clear();
  await photos.put(photos.blobFromDataURL('data:image/png;base64,iVBORw0KGgo='));
  setPlaces([{ id: 'p1', name: 'The bench', lat: 46.2, lng: 8.2, photos: ['data:image/png;base64,iVBORw0KGgo='] }]);

  // the small store has no room for the one write that takes the inline
  // picture out of it, and the database has none of that trouble
  localStorage.full = true;
  const said = await photos.releasePhotographs();
  localStorage.full = false;
  assert.equal(said, 'partly', 'a person told "gone" would stop looking for what is still here');
  assert.equal(await photos.photographCount(), 1);
});

test('a browser that refuses says so, and nothing is reported as deleted', async () => {
  db.stores.photos.clear();
  localStorage.map.clear();
  await photos.put(photos.blobFromDataURL('data:image/png;base64,iVBORw0KGgo='));
  db.abortAtCommit = true;
  const said = await photos.releasePhotographs();
  db.abortAtCommit = false;
  assert.equal(said, 'refused', 'a transaction that does not commit is not a deletion');
});

// ---------- a refusal is not an answer ----------

test('a database that will not answer is null, and an empty one is a list', async () => {
  db.refuse = false;
  db.stores.snapshots.clear();
  assert.deepEqual(await photos.snapshotKeys(), [],
    'nothing kept yet is an empty list, which a caller can count');
  db.abortAtCommit = true;
  assert.equal(await photos.snapshotKeys(), null,
    'and a database that would not answer is null, never an empty list');
  db.abortAtCommit = false;
});

// The open connection is worth caching. A refusal is not, and caching one used
// to end the snapshots for the whole life of the page: one wedged open, one
// blocked upgrade, and every later caller was handed the same stale null
// without the browser ever being asked again. A fresh query string gives a
// fresh module, which is the only way to watch the very first open.
test('a refusal is not remembered for the life of the page', async () => {
  const real = globalThis.indexedDB;
  let asked = 0;
  globalThis.indexedDB = {
    open() {
      asked += 1;
      const r = { onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null, result: db };
      queueMicrotask(() => { if (asked === 1) r.onerror?.(); else r.onsuccess?.(); });
      return r;
    },
  };
  const fresh = await import('../js/photos.js?v=refused-once');
  assert.equal(await fresh.snapshotKeys(), null, 'the first ask is refused and says so');
  const second = await fresh.snapshotKeys();
  assert.ok(Array.isArray(second), 'the second caller reaches the browser, not the cached refusal');
  assert.equal(asked, 2, 'and the browser was actually asked a second time');
  globalThis.indexedDB = real;
});

test('an upgrade blocked by another tab is not remembered either', async () => {
  const real = globalThis.indexedDB;
  let asked = 0;
  globalThis.indexedDB = {
    open() {
      asked += 1;
      const r = { onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null, result: db };
      queueMicrotask(() => { if (asked === 1) r.onblocked?.(); else r.onsuccess?.(); });
      return r;
    },
  };
  const fresh = await import('../js/photos.js?v=blocked-once');
  assert.equal(await fresh.snapshotKeys(), null, 'blocked is not an answer about what is held');
  assert.ok(Array.isArray(await fresh.snapshotKeys()),
    'and it clears when the other tab closes, so it must not be cached');
  globalThis.indexedDB = real;
});
