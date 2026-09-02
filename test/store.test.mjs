// store.test.mjs — what the device promises about keeping and handing over.
//
// These run against the real store with a stand-in for browser storage, so a
// refused write can be produced on demand: a browser that has run out of room
// is not a hypothesis, and a refusal has to roll back whole.

import { test } from 'node:test';
import assert from 'node:assert/strict';

class FakeStorage {
  constructor() {
    this.map = new Map(); this.refuse = false;
    this.sets = 0; this.refuseAfter = null; this.refuseKey = null; this.refuseKeyOnce = false;
    this.removes = 0; this.refuseRemoveAfter = null;
  }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) {
    this.sets += 1;
    const keyed = this.refuseKey === k;
    if (keyed && this.refuseKeyOnce) this.refuseKey = null;
    if (this.refuse || keyed || (this.refuseAfter !== null && this.sets > this.refuseAfter)) {
      const e = new Error('quota');
      e.name = 'QuotaExceededError';
      throw e;
    }
    this.map.set(k, String(v));
  }
  removeItem(k) {
    this.removes += 1;
    if (this.refuseRemoveAfter !== null && this.removes > this.refuseRemoveAfter) {
      const e = new Error('remove refused');
      e.name = 'SecurityError';
      throw e;
    }
    this.map.delete(k);
  }
  key(i) { return [...this.map.keys()][i]; }
  get length() { return this.map.size; }
}

const storage = new FakeStorage();
globalThis.localStorage = new Proxy(storage, {
  ownKeys: (t) => [...t.map.keys()],
  getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
  get: (t, p) => (typeof t[p] === 'function' ? t[p].bind(t) : t[p]),
});

const { store, newPlace, newTag, newRoute, newFolio, newBook, demoData,
  trimWay, unreadableKeys, releaseUnreadable, setWriteFailedHandler, unwrapFile } = await import('../js/store.js?v=test');
// the same measure the store uses, so a trimmed way can be checked against
// the ground it actually covers rather than against a number copied from it
const { measure } = await import('../js/route.js?v=test');
// the handover gate itself, so a copy made for an assistant can be checked
// against the door every link goes through rather than against a shape
const { normPayload, KIND_VERSION } = await import('../js/schema.js?v=test');
// the whole modules, for the link-diet fixtures that need both sides of a trip
const shareMod = await import('../js/share.js?v=test');
const schemaMod = await import('../js/schema.js?v=test');

function fresh() {
  storage.map.clear();
  storage.refuse = false;
  storage.sets = 0; storage.refuseAfter = null; storage.refuseKey = null; storage.refuseKeyOnce = false;
  storage.removes = 0; storage.refuseRemoveAfter = null;
  store.places = []; store.routes = []; store.folios = []; store.tags = []; store.correspondents = [];
  store.books = [];
  store.letters = { v: 1, jwk: null, pub: '', route: '', pairs: [] };
  store.settings = { theme: 'auto', lastView: null, seeded: false, authorName: '' };
}

const aPlace = (n = 'A place') => newPlace({ name: n, lat: 46, lng: 8 });

// ---------- a refused write changes nothing ----------

test('a place the device refuses is not kept, in memory or on disk', () => {
  fresh();
  storage.refuse = true;
  const made = store.addPlace(aPlace());
  assert.equal(made, null, 'the caller is told plainly');
  assert.equal(store.places.length, 0, 'nothing is left in memory to render');
});

test('erasing the atlas does not burn the membership key', () => {
  fresh();
  store.settings.clubKey = 'tc_testkey0000000000000';
  store.settings.clubSeq = 4;
  store.saveSettings();
  store.clearAll();
  assert.equal(store.settings.clubKey, 'tc_testkey0000000000000', 'the key survives an erase');
  assert.equal(store.settings.clubSeq, 4, 'and so does what was sealed under it');
  assert.equal(store.places.length, 0, 'while the atlas itself is gone');
});

test('the full export never carries the club key', () => {
  fresh();
  store.settings.clubKey = 'tc_testkey0000000000000';
  store.saveSettings();
  const out = JSON.parse(store.exportJSON());
  assert.equal(out.settings.clubKey, '', 'a bearer credential rides in no file');
});

test('a refused merge says null, never a quiet zero', () => {
  fresh();
  storage.refuse = true;
  const got = store.merge({
    version: 3,
    places: [{ id: 'mp1', name: 'Cafe', lat: 47.5, lng: 7.6, tags: [], voices: [] }],
    tags: [], settings: {},
  });
  assert.equal(got, null, 'refusal is distinguishable from nothing new');
  assert.equal(store.places.length, 0, 'and the rollback held');
});

test('a tag, a way and a voice all refuse the same way', () => {
  fresh();
  storage.refuse = true;
  assert.equal(store.addTag(newTag({ name: 'Huts' })), null);
  assert.equal(store.tags.length, 0);
  assert.equal(store.addRoute(newRoute({ path: [{ lat: 46, lng: 8 }, { lat: 46.1, lng: 8.1 }] })), null);
  assert.equal(store.routes.length, 0);
  assert.equal(store.addCorrespondent({ name: 'Marta', tags: [], places: [] }), null);
  assert.equal(store.correspondents.length, 0);
});

test('an edit the device refuses leaves the record as it was', () => {
  fresh();
  const p = store.addPlace(aPlace('Enoteca'));
  assert.ok(p);
  storage.refuse = true;
  const out = store.updatePlace(p.id, { name: 'Renamed', rating: 5 });
  assert.equal(out, null);
  assert.equal(store.placeById(p.id).name, 'Enoteca', 'the old name is restored');
  assert.equal(store.placeById(p.id).rating, 0);
});

test('a removal the device refuses puts the record back', () => {
  fresh();
  const p = store.addPlace(aPlace('Kept'));
  storage.refuse = true;
  store.removePlace(p.id);
  assert.equal(store.places.length, 1, 'it is still here, because it was never really gone');
  assert.equal(store.places[0].name, 'Kept');
});

test('an import is one act: refused in part, kept in none', () => {
  fresh();
  store.addPlace(aPlace('Mine'));
  const before = store.places.length;
  storage.refuse = true;
  const added = store.merge({
    places: [{ id: 'i1', name: 'Theirs', lat: 45, lng: 9 }, { id: 'i2', name: 'Also theirs', lat: 44, lng: 9 }],
    tags: [{ id: 't1', name: 'Wine' }],
  });
  assert.equal(added, null, 'an import that could not be written says so, distinctly from nothing new');
  assert.equal(store.places.length, before, 'and left the atlas exactly as it was');
  assert.equal(store.tags.length, 0);
});

test('a tag deletion interrupted after some writes is recovered whole on reload', () => {
  fresh();
  const tag = store.addTag(newTag({ id: 't-journal', name: 'Journalled' }));
  store.addPlace(newPlace({ id: 'p-journal', name: 'Place', lat: 46, lng: 8, tags: [tag.id] }));
  store.addRoute(newRoute({ id: 'r-journal', name: 'Path', tags: [tag.id],
    path: [{ lat: 46, lng: 8 }, { lat: 46.01, lng: 8.01 }] }));
  store.addBook(newBook({ id: 'b-journal', title: 'Book', tags: [tag.id] }));

  storage.sets = 0;
  storage.refuseAfter = 2; // journal + tags land; the places write and rollback refuse
  assert.equal(store.removeTag(tag.id), null);
  assert.equal(store.tags.some(t => t.id === tag.id), true, 'memory rolled back immediately');
  assert.ok(localStorage.getItem('resonate.tag-delete.v1'), 'the recovery record survived the refusal');

  storage.refuseAfter = null;
  store.load();
  assert.equal(localStorage.getItem('resonate.tag-delete.v1'), null, 'recovery completed before load');
  assert.equal(store.tags.some(t => t.id === tag.id), true);
  assert.equal(store.placeById('p-journal').tags.includes(tag.id), true);
  assert.equal(store.routes.find(r => r.id === 'r-journal').tags.includes(tag.id), true);
  assert.equal(store.bookById('b-journal').tags.includes(tag.id), true);
});

test('a settings refusal rolls back every part of a merge', () => {
  fresh();
  store.settings.theme = 'auto';
  store.saveSettings();
  storage.refuseKey = 'resonate.settings.v1';
  storage.refuseKeyOnce = true;
  const added = store.merge({ app: 'resonate', version: 4, tags: [],
    places: [{ id: 'merge-settings', name: 'Arriving', lat: 46, lng: 8, tags: [] }],
    settings: { theme: 'dark', hue: 74 } }, { own: true });
  assert.equal(added, null);
  assert.equal(store.placeById('merge-settings'), undefined, 'the record did not outlive settings');
  assert.equal(store.settings.theme, 'auto', 'memory took its old look back');
  assert.deepEqual(JSON.parse(localStorage.getItem('resonate.places.v1')), []);
  assert.equal(JSON.parse(localStorage.getItem('resonate.settings.v1')).theme, 'auto');
});

// ---------- a record no longer carries a photograph ----------
//
// These used to prove the opposite: that a photo id survived a reload like
// any other string. The promise has changed and the tests change with it, or
// they would go on passing while proving a thing the app no longer does.

test('a photograph written into a record does not survive a reload', () => {
  fresh();
  const p = store.addPlace(aPlace('With pictures'));
  store.updatePlace(p.id, { photos: ['ph_msj14t2y11u6v', 'data:image/png;base64,iVBORw0KGgo='] });
  // what a reload does
  store.load();
  const back = store.placeById(p.id);
  assert.equal('photos' in back, false, 'the field is not kept, and not kept empty either');
  assert.equal(JSON.stringify(back).includes('data:image/'), false);
});

test('an atlas coming home carrying photographs comes home, and says how many', () => {
  fresh();
  const file = {
    app: 'resonate', version: 4, tags: [], routes: [], folios: [], correspondents: [],
    places: [{ id: 'ip1', name: 'Theirs', lat: 45, lng: 9, tags: [],
      photos: ['ph_abc123', 'data:image/png;base64,iVBORw0KGgo='] }],
    settings: {},
  };
  const read = store.readOwn(file);
  assert.deepEqual(read.lost, [], 'a file that still has its pictures is not a lossy file');
  assert.equal(read.setAside.length, 1, 'and the place that carried them is named');
  assert.equal(read.setAside[0].given, 2);

  const added = store.merge(file, { own: true });
  assert.equal(added, 1, 'the atlas came home');
  assert.equal('photos' in store.placeById('ip1'), false, 'and kept no picture');
  assert.deepEqual(store.lastLost, [], 'a set-aside field is never a loss');
});

test('what a person is shown before a restore counts the photographs too', () => {
  fresh();
  store.addPlace(newPlace({ id: 'p1', name: 'Held', lat: 46, lng: 8 }));
  const seen = store.compare({
    app: 'resonate', version: 4, tags: [], routes: [], folios: [], correspondents: [],
    places: [{ id: 'p1', name: 'Held', lat: 46, lng: 8, tags: [], photos: ['ph_abc123'] }],
  });
  assert.equal(seen.setAside.length, 1,
    'the panel read before either word is pressed is where this has to be said');
  assert.equal(seen.setAside[0].given, 1);
});

// ---------- the words a place is held in ----------

test('an atlas from the age of stars keeps its places and drops the score', () => {
  fresh();
  localStorage.setItem('resonate.places.v1', JSON.stringify([
    { id: 'w5', name: 'Loved', lat: 46, lng: 8, tags: [], status: 'visited', rating: 5 },
    { id: 'w0', name: 'Wanted', lat: 46, lng: 8, tags: [], status: 'wishlist', rating: 0 },
  ]));
  store.load();
  assert.equal(store.places.length, 2, 'nothing is lost to the change');
  assert.equal(store.placeById('w5').status, 'visited', 'having been is the fact that survives');
  assert.equal(store.placeById('w0').status, 'wishlist');
  assert.equal('word' in store.placeById('w5'), false, 'and no verdict is stored beside it');
});

test('a verdict a hostile link invents is not kept', () => {
  fresh();
  const added = store.merge({
    app: 'resonate', version: 4,
    places: [{ id: 'h1', name: 'Theirs', lat: 45, lng: 9, tags: [], word: 'essential', relation: 'regular' }],
    tags: [], settings: {},
  });
  assert.equal(added, 1);
  const p = store.placeById('h1');
  assert.equal('word' in p, false);
  assert.equal('relation' in p, false);
});

// ---------- two exports, two promises ----------

test('the file offered in place of a link carries no photograph, no voice, no setting', () => {
  fresh();
  store.addTag(newTag({ name: 'Culture' }));
  store.addPlace(newPlace({
    name: 'Fondation Beyeler', lat: 47.58, lng: 7.65,
    photos: ['data:image/png;base64,iVBORw0KGgo='],
    note: 'the pond window',
  }));
  store.addCorrespondent({ name: 'Marta', tags: [], places: [] });
  store.settings.authorName = 'Jonas';

  const share = JSON.parse(store.humanHandoverJSON());
  // the file said kind 'share', which nothing read and which the payload gate
  // treated as an atlas anyway. it says what it is now.
  assert.equal(share.kind, 'atlas');
  assert.equal(share.places.length, 1);
  assert.equal(share.places[0].name, 'Fondation Beyeler');
  assert.equal(share.places[0].note, 'the pond window', 'the recommendation itself still travels');
  assert.equal('photos' in share.places[0], false, 'no photograph leaves the device');
  assert.ok(!JSON.stringify(share).includes('data:image/'));
  assert.equal(share.correspondents, undefined, 'no voice is handed on');
  assert.equal(share.settings, undefined, 'and no signature or setting');
});

test('the backup kept for yourself carries everything there is', () => {
  fresh();
  store.addPlace(newPlace({ id: 'private-place', name: 'A place', lat: 46, lng: 8,
    note: 'the pond window', private: true }));
  store.addRoute(newRoute({ id: 'private-path', name: 'A path', private: true,
    path: [{ lat: 46, lng: 8 }, { lat: 46.1, lng: 8.1 }] }));
  store.addBook(newBook({ id: 'private-book', title: 'A book', private: true }));
  store.addCorrespondent({ name: 'Marta', tags: [], places: [] });
  store.settings.authorName = 'Jonas';

  const backup = JSON.parse(store.exportJSON());
  assert.equal(backup.places[0].note, 'the pond window', 'a backup is the whole atlas');
  assert.equal(backup.places[0].private, true, 'the private backup dropped an excluded place');
  assert.equal(backup.routes[0].private, true, 'the private backup dropped an excluded path');
  assert.equal(backup.books[0].private, true, 'the private backup dropped an excluded book');
  assert.equal(backup.correspondents.length, 1);
  assert.equal(backup.settings.authorName, 'Jonas');
  // and it is the whole atlas because there is nothing else left to carry
  assert.equal('photos' in backup.places[0], false, 'no record names a picture any more');
});

test('a place excluded from sharing is in no file a stranger is given', () => {
  fresh();
  store.addPlace(newPlace({ name: 'Public', lat: 46, lng: 8 }));
  const home = store.addPlace(newPlace({ name: 'Home', lat: 47, lng: 8 }));
  store.updatePlace(home.id, { private: true });

  const share = JSON.parse(store.humanHandoverJSON());
  assert.equal(share.places.length, 1, 'only the one that may travel');
  assert.equal(share.places[0].name, 'Public');
  assert.ok(!JSON.stringify(share).includes('Home'), 'not by name, not by coordinate');
});

test('a way handed over carries no record of when it was walked', () => {
  fresh();
  const r = store.addRoute(newRoute({ name: 'The ridge', path: [{ lat: 46, lng: 8 }, { lat: 46.1, lng: 8.1 }] }));
  store.updateRoute(r.id, { status: 'walked', walkedAt: '2026-08-01T09:00:00Z' });
  const share = JSON.parse(store.humanHandoverJSON());
  assert.equal('walkedAt' in share.routes[0], false, 'a routine is not a recommendation');
});

// ---------- erase means erase ----------

test('an erased atlas does not grow a sample back', () => {
  fresh();
  const demo = demoData();
  demo.tags.forEach(t => store.addTag(t));
  demo.places.forEach(p => store.addPlace({ ...p, sample: true }));
  assert.ok(store.places.length > 5);

  store.clearAll();
  assert.equal(store.places.length, 0);
  assert.equal(store.tags.length, 0);
  assert.equal(store.settings.seeded, true, 'the browser is marked as used, not as new');
  assert.ok(store.settings.erasedAt, 'and remembers when it was emptied');

  // what a reload would do
  store.load();
  assert.equal(store.places.length, 0, 'still empty after coming back');
  assert.equal(store.settings.seeded, true);
});

test('an erase refused after one removal restores every exact local byte', () => {
  fresh();
  store.addTag(newTag({ name: 'Kept word' }));
  store.addPlace(aPlace('Kept place'));
  store.settings.authorName = 'Ada';
  store.saveSettings();
  localStorage.setItem('resonate.inbox.v1', '[{"url":"https://example.test/kept"}]');
  const before = new Map(storage.map);

  storage.refuseRemoveAfter = 1;
  assert.equal(store.clearAll(), false, 'a partial local removal was called an erase');
  for (const [key, value] of before) {
    assert.equal(localStorage.getItem(key), value, `${key} was not restored exactly`);
  }
  assert.equal(store.places[0].name, 'Kept place', 'memory was emptied after disk refused');
  assert.equal(store.tags[0].name, 'Kept word');
  assert.equal(store.pendingClearAll()?.state, 'prepared', 'the recovery journal vanished while removal still refused');

  storage.refuseRemoveAfter = null;
  assert.equal(store.rollbackClearAll({ reload: false }), true);
  assert.equal(store.finishClearAll(), true);
  assert.equal(store.pendingClearAll(), null);
  assert.deepEqual(new Map(storage.map), before, 'recovery changed bytes that preceded the erase');
});

// ---------- the vocabulary ----------

test('every tag inks the world differently', () => {
  fresh();
  const { tags } = demoData();
  const hues = tags.map(t => t.hue);
  assert.equal(new Set(hues).size, hues.length, `two tags share a hue: ${hues.join(', ')}`);
  const names = tags.map(t => t.name);
  assert.ok(names.includes('Huts'));
  assert.ok(names.includes('Reserves'));
});

test('a way is kept with its measure and comes back whole', () => {
  fresh();
  const { routes } = demoData();
  assert.ok(routes.length, 'the sample shows a walk, not only points');
  const r = store.addRoute({ ...routes[0], sample: true });
  assert.ok(r.km > 0 && r.ascent > 0 && r.high > r.low);
  store.load();
  const back = store.routes[0];
  assert.equal(back.name, routes[0].name);
  assert.ok(back.path.length >= 2);
  assert.equal(Math.round(back.ascent), Math.round(r.ascent));
});

// ---------- the shelf: folios kept for yourself ----------

test('a kept folio shares nothing: it holds references, not copies', () => {
  fresh();
  const a = store.addPlace(newPlace({ name: 'Markthalle', lat: 47.5479, lng: 7.5875, note: 'the momo stand' }));
  const b = store.addPlace(newPlace({ name: 'Rheinbad', lat: 47.5533, lng: 7.6053 }));
  const f = store.addFolio(newFolio({ title: 'Basel, the good part', placeIds: [a.id, b.id] }));
  assert.ok(f);
  const raw = localStorage.getItem('resonate.folios.v1');
  assert.ok(!raw.includes('47.54'), 'no coordinate is copied into the shelf');
  assert.ok(!raw.includes('momo'), 'and no note either');
});

test('a folio follows the atlas as it improves', () => {
  fresh();
  const a = store.addPlace(newPlace({ name: 'Markthalle', lat: 47.5479, lng: 7.5875 }));
  const f = store.addFolio(newFolio({ title: 'Basel', placeIds: [a.id] }));
  store.updatePlace(a.id, { name: 'Markthalle (the momo stand)', rating: 5 });
  const resolved = store.resolveFolio(f.id);
  assert.equal(resolved.places[0].name, 'Markthalle (the momo stand)');
  assert.equal(resolved.places[0].rating, 5, 'the folio was never a snapshot');
});

test('a place removed from the atlas falls quietly out of its folios', () => {
  fresh();
  const a = store.addPlace(newPlace({ name: 'Gone', lat: 46, lng: 8 }));
  const b = store.addPlace(newPlace({ name: 'Stays', lat: 46.1, lng: 8.1 }));
  const f = store.addFolio(newFolio({ title: 'Two', placeIds: [a.id, b.id] }));
  store.removePlace(a.id);
  const resolved = store.resolveFolio(f.id);
  assert.equal(resolved.places.length, 1);
  assert.equal(resolved.places[0].name, 'Stays');
});

test('taking a folio off the shelf leaves every place in the atlas', () => {
  fresh();
  const a = store.addPlace(newPlace({ name: 'Kept', lat: 46, lng: 8 }));
  const f = store.addFolio(newFolio({ title: 'A folio', placeIds: [a.id] }));
  store.removeFolio(f.id);
  assert.equal(store.folios.length, 0);
  assert.equal(store.places.length, 1, 'the shelf held references, so removing it removed nothing');
});

test('a folio the device refuses is not on the shelf', () => {
  fresh();
  storage.refuse = true;
  assert.equal(store.addFolio(newFolio({ title: 'Nope' })), null);
  assert.equal(store.folios.length, 0);
});

test('the shelf comes home in a backup and not in a share', () => {
  fresh();
  const a = store.addPlace(newPlace({ name: 'A', lat: 46, lng: 8 }));
  store.addFolio(newFolio({ title: 'Mine', placeIds: [a.id] }));
  assert.equal(JSON.parse(store.exportJSON()).folios.length, 1);
  assert.equal(JSON.parse(store.humanHandoverJSON()).folios, undefined,
    'a folio is a private arrangement; what you hand over is its contents');
});

// ---------- imports do not double the vocabulary ----------

test('an import with the same tags under different ids keeps one of each', () => {
  fresh();
  const mine = store.addTag(newTag({ name: 'Restaurants' }));
  store.addPlace(newPlace({ name: 'Mine', lat: 46, lng: 8, tags: [mine.id] }));

  const added = store.merge({
    tags: [{ id: 'their-tag', name: 'restaurants' }, { id: 'their-new', name: 'Vinyl' }],
    places: [{ id: 'their-place', name: 'Theirs', lat: 45, lng: 9, tags: ['their-tag', 'their-new'] }],
  });
  // one place and one genuinely new tag: an import reports everything it
  // brought, never only the places, or it can say nothing came in while
  // storage changed underneath
  assert.equal(added, 2);
  assert.equal(store.tags.filter(t => t.name.toLowerCase() === 'restaurants').length, 1,
    'same name is the same tag');
  const theirs = store.placeById('their-place');
  assert.ok(theirs.tags.includes(mine.id), 'the imported place points at the kept tag');
  assert.ok(store.tags.some(t => t.name === 'Vinyl'), 'a genuinely new tag still arrives');
});


// ---------- an atlas can leave for anywhere ----------

test('every open format carries the places, and never a private one', () => {
  fresh();
  store.addTag(newTag({ name: 'Culture' }));
  const t = store.tags[0].id;
  store.addPlace(newPlace({ name: 'Fondation Beyeler', lat: 47.58, lng: 7.65, city: 'Riehen',
    country: 'Switzerland', tags: [t], status: 'visited', note: 'the pond window' }));
  const home = store.addPlace(newPlace({ name: 'My Own Door', lat: 47.55, lng: 7.59, city: 'Basel' }));
  store.updatePlace(home.id, { private: true });

  for (const [what, text] of [
    ['geojson', store.exportGeoJSON()],
    ['kml', store.exportKML()],
    ['csv', store.exportCSV()],
    ['markdown', store.exportMarkdown()],
  ]) {
    assert.ok(text.includes('Fondation Beyeler'), `${what} carries the place`);
    assert.ok(!text.includes('My Own Door'), `${what} leaves the private one behind`);
    assert.ok(!text.includes('47.55'), `${what} does not leak its coordinate either`);
  }
});

// ---------- one city, one key ----------

test('a city written two ways is one city, settled where the record is made', () => {
  fresh();
  store.addPlace(newPlace({ name: 'One', lat: 46, lng: 8, city: ' Basel ', country: 'Switzerland' }));
  store.addPlace(newPlace({ name: 'Two', lat: 46.1, lng: 8.1, city: 'Basel', country: ' Switzerland' }));
  store.addRoute(newRoute({ name: 'A walk', city: 'Basel ', country: 'Switzerland ' }));
  for (const r of [...store.places, ...store.routes]) {
    assert.equal(r.city, 'Basel', 'a spelling reached the store unsettled');
    assert.equal(r.country, 'Switzerland');
  }
  // and the surfaces that group by it see one city rather than three
  assert.equal(new Set(store.places.map(p => `${p.city}, ${p.country}`)).size, 1);
});

test('the markdown headings are the key the rest of the app is organised by', () => {
  fresh();
  // two cities of one name, which the export merged into a single heading by
  // computing its own key and dropping the country
  store.addPlace(newPlace({ name: 'A Diner', lat: 39.8, lng: -89.6,
    city: 'Springfield', country: 'United States' }));
  store.addPlace(newPlace({ name: 'A Pier', lat: -37.5, lng: 143.5,
    city: 'Springfield', country: 'Australia' }));
  store.addPlace(newPlace({ name: 'A Spring', lat: 64.1, lng: -21.9 }));
  const md = store.exportMarkdown();
  assert.ok(md.includes('## Springfield, Australia'), 'the country is not in the heading');
  assert.ok(md.includes('## Springfield, United States'));
  assert.ok(!/^## Springfield$/m.test(md), 'two cities were written out as one');
  // the placeless wait at the end, under the words every other surface uses
  assert.ok(md.includes('## off the map'));
  assert.ok(md.indexOf('## off the map') > md.indexOf('## Springfield, United States'),
    'the placeless were sorted into the middle of the document');
});

test('the open formats survive a hostile name', () => {
  fresh();
  store.addPlace(newPlace({ name: 'Bar <script>alert(1)</script> & "co"', lat: 46, lng: 8, note: 'a, comma\nand a line' }));
  const kml = store.exportKML();
  assert.ok(!kml.includes('<script>'), 'kml escapes its markup');
  assert.ok(kml.includes('&lt;script&gt;'));
  const csv = store.exportCSV();
  const lines = csv.split('\n');
  assert.equal(lines[0].split(',')[0], 'name');
  assert.ok(csv.includes('""co""'), 'csv doubles its quotes');
});


// ---------- a date is a date, or it is nothing ----------

test('a record arriving without dates is dated when it arrives', () => {
  fresh();
  // exactly what a place from a share link looks like: the diary was stripped
  const fromLink = store.addPlace(newPlace({
    id: undefined, name: 'From a link', lat: 46, lng: 8, createdAt: '', updatedAt: '',
  }));
  assert.ok(fromLink.createdAt, 'it entered this atlas at a real moment');
  assert.ok(!Number.isNaN(new Date(fromLink.createdAt).getTime()), fromLink.createdAt);

  const way = store.addRoute(newRoute({
    name: 'A way from a link', path: [{ lat: 46, lng: 8 }, { lat: 46.1, lng: 8.1 }], createdAt: '',
  }));
  assert.ok(!Number.isNaN(new Date(way.createdAt).getTime()), way.createdAt);
});

test('a record that carries its own dates keeps them', () => {
  fresh();
  const p = store.addPlace(newPlace({ name: 'Old', lat: 46, lng: 8, createdAt: '2024-05-12T09:00:00Z' }));
  assert.equal(p.createdAt, '2024-05-12T09:00:00Z', 'a real date is never overwritten');
});

test('a date that is not one is healed on the way in', () => {
  fresh();
  localStorage.setItem('resonate.places.v1', JSON.stringify([
    { id: 'd1', name: 'Empty', lat: 46, lng: 8, tags: [], createdAt: '' },
    { id: 'd2', name: 'Nonsense', lat: 46, lng: 8, tags: [], createdAt: 'not a date at all' },
    { id: 'd3', name: 'Fine', lat: 46, lng: 8, tags: [], createdAt: '2024-05-12T09:00:00Z' },
  ]));
  store.load();
  const ok = v => !Number.isNaN(new Date(v).getTime());
  assert.ok(ok(store.placeById('d1').createdAt), 'an empty date becomes a real one');
  assert.ok(ok(store.placeById('d2').createdAt), 'and so does a nonsense one');
  assert.equal(store.placeById('d3').createdAt, '2024-05-12T09:00:00Z', 'a real one is left alone');
});

// ---------- a record still carrying somebody's photograph ----------
//
// Whenever IndexedDB refused a blob, and Safari refused every one of them for
// a whole release, the app kept the picture inline in the record itself. This
// build's records carry no photos field at all, so every write of this key is
// a write that would take those pictures out of the only place they are.
//
// The pictures are lifted into the database at boot, ahead of the load, and
// these two are what stands where that lift could not happen: a browser that
// refuses its own database still has an atlas, and a person on one of those is
// owed their pictures for exactly as long as anybody else is.

const A_PICTURE = 'data:image/png;base64,iVBORw0KGgo=';

test('an undated record is not healed over the picture it is carrying', () => {
  fresh();
  localStorage.setItem('resonate.places.v1', JSON.stringify([
    { id: 'd1', name: 'The bench', lat: 46.2, lng: 8.2, tags: [], createdAt: '', photos: [A_PICTURE] },
  ]));
  store.load();
  const ok = v => !Number.isNaN(new Date(v).getTime());
  assert.ok(ok(store.placeById('d1').createdAt), 'the date is healed on screen either way');
  assert.match(localStorage.getItem('resonate.places.v1'), /data:image\//,
    'the healing write went out over the picture during init, before anybody was told it was there');
});

test('a date is written down again as soon as the pictures are somewhere else', () => {
  fresh();
  localStorage.setItem('resonate.places.v1', JSON.stringify([
    { id: 'd1', name: 'The bench', lat: 46.2, lng: 8.2, tags: [], createdAt: '', photos: ['ph_kept'] },
  ]));
  store.load();
  const back = JSON.parse(localStorage.getItem('resonate.places.v1'));
  assert.ok(back[0].createdAt, 'an id is not a picture: nothing is held back for it');
});

test('an ordinary edit does not take a picture the database would not accept', () => {
  fresh();
  const now = new Date().toISOString();
  localStorage.setItem('resonate.places.v1', JSON.stringify([
    { id: 'd1', name: 'The bench', lat: 46.2, lng: 8.2, tags: [], createdAt: now, updatedAt: now,
      photos: [A_PICTURE, 'ph_kept'] },
  ]));
  store.load();
  assert.ok(store.addPlace(aPlace('somewhere new')), 'the edit itself is ordinary and goes through');
  const back = JSON.parse(localStorage.getItem('resonate.places.v1'));
  const bench = back.find(p => p.id === 'd1');
  assert.deepEqual(bench.photos, [A_PICTURE, 'ph_kept'],
    'one place added, and two photographs destroyed with no word said about either');
  assert.equal('photos' in back.find(p => p.name === 'somewhere new'), false,
    'and a place that never had one is not given the field');
});

// Two ways the carrying was asking the wrong question, both of which cost a
// photograph its place and one of which cost the photograph itself.

test('a picture already lifted keeps the place it was taken', () => {
  // The carry used to ask whether a record still held a picture INLINE. The
  // moment the lift succeeded the answer was no, the carry stopped, and the
  // next ordinary write erased the ids the lift had just written. The bytes
  // were safe in the database and the only thing Resonate had ever added to
  // them, which place they were taken at, was gone without a word.
  fresh();
  const now = new Date().toISOString();
  localStorage.setItem('resonate.places.v1', JSON.stringify([
    { id: 'd1', name: 'The bench', lat: 46.2, lng: 8.2, tags: [], createdAt: now, updatedAt: now,
      photos: ['ph_lifted'] },
  ]));
  store.load();
  assert.ok(store.addPlace(aPlace('somewhere new')), 'the edit goes through');
  const back = JSON.parse(localStorage.getItem('resonate.places.v1'));
  assert.deepEqual(back.find(p => p.id === 'd1').photos, ['ph_lifted'],
    'the lifted picture lost the place it belonged to on the first ordinary edit');
});

test('a record too old to have an id keeps its pictures too', () => {
  // The carry matched a stored record to a place in memory by id alone, so a
  // record from before ids matched nothing and was handed back without its
  // field. That is exactly the device the carry exists for: one where the
  // database refused and the record is the only place the picture is.
  fresh();
  const now = new Date().toISOString();
  localStorage.setItem('resonate.places.v1', JSON.stringify([
    { name: 'The old bench', lat: 46.2, lng: 8.2, tags: [], createdAt: now, updatedAt: now,
      photos: [A_PICTURE] },
  ]));
  store.load();
  assert.ok(store.addPlace(aPlace('somewhere new')), 'the edit goes through');
  const back = JSON.parse(localStorage.getItem('resonate.places.v1'));
  const bench = back.find(p => p.name === 'The old bench');
  assert.ok(bench, 'the old record is still there');
  assert.deepEqual(bench.photos, [A_PICTURE],
    'a record with no id of its own had its photograph destroyed by an ordinary edit');
});

test('the pictures leaving takes the carrying with them', () => {
  fresh();
  const now = new Date().toISOString();
  localStorage.setItem('resonate.places.v1', JSON.stringify([
    { id: 'd1', name: 'The bench', lat: 46.2, lng: 8.2, tags: [], createdAt: now, updatedAt: now,
      photos: [A_PICTURE] },
  ]));
  store.load();
  // what releasePhotographs does to this key when a person says the word
  localStorage.setItem('resonate.places.v1', JSON.stringify([
    { id: 'd1', name: 'The bench', lat: 46.2, lng: 8.2, tags: [], createdAt: now, updatedAt: now },
  ]));
  store.updatePlace('d1', { name: 'The bench, renamed' });
  const back = JSON.parse(localStorage.getItem('resonate.places.v1'));
  assert.equal('photos' in back[0], false, 'a picture a person deleted does not come back on the next write');
  assert.equal(back[0].name, 'The bench, renamed');
});


// ---------- the three doors ----------

test('a private archive comes home whole, or not at all', () => {
  fresh();
  const places = Array.from({ length: 501 }, (_, i) => ({
    id: 'p' + i, name: 'Place ' + i, lat: 46, lng: 8, tags: [],
    note: i === 0 ? 'n'.repeat(4001) : '',
  }));
  const got = store.merge({ app: 'resonate', version: 4, places, tags: [] }, { own: true });
  assert.equal(got, 501, 'every place, including the five hundred and first');
  assert.equal(store.places.length, 501);
  assert.equal(store.placeById('p0').note.length, 4001, 'and a long memory is not shortened');
});

test('a stranger is still held to the hard caps', () => {
  fresh();
  const places = Array.from({ length: 501 }, (_, i) => ({
    id: 's' + i, name: 'S' + i, lat: 46, lng: 8, tags: [], note: 'n'.repeat(4001),
  }));
  store.merge({ app: 'resonate', version: 4, places, tags: [] });
  assert.equal(store.places.length, 500, 'a hostile payload may not spend this device');
  assert.equal(store.placeById('s0').note.length, 4000);
});

test('an archive with a record that cannot be read is refused whole', () => {
  fresh();
  const places = [
    { id: 'g1', name: 'Good', lat: 46, lng: 8, tags: [] },
    { id: 'b1', name: 'No coordinates', tags: [] },
    { id: 'b2', name: 'Off the globe', lat: 999, lng: 8, tags: [] },
    { id: 'g2', name: 'Also good', lat: 47, lng: 9, tags: [] },
  ];
  const got = store.merge({ app: 'resonate', version: 4, places, tags: [] }, { own: true });
  assert.equal(got, null, 'two thirds of an archive is not an archive');
  assert.equal(store.places.length, 0, 'and not one record of it was written');
  assert.deepEqual(store.lastLost.map(l => l.id), ['b1', 'b2'],
    'every loss is named, so a person is told which record and not merely how many');
  assert.deepEqual(store.lastLost.map(l => l.kind), ['place', 'place']);
  assert.ok(store.lastLost.every(l => l.reason), 'and each one says why');
});

test('a stranger’s payload leaves no loss list behind that belonged to an archive', () => {
  fresh();
  const refused = store.merge({ app: 'resonate', version: 4, places: [{ id: 'x', name: 'X', tags: [] }], tags: [] }, { own: true });
  assert.equal(refused, null);
  assert.equal(store.lastLost.length, 1);
  const added = store.merge({ app: 'resonate', version: 4, places: [{ id: 'y', name: 'Y', lat: 1, lng: 2, tags: [] }], tags: [] });
  assert.equal(added, 1, 'the stranger still gets in, clipped and in silence');
  assert.deepEqual(store.lastLost, [], 'a stranger’s payload never speaks for an archive');
});

test('a load never shrinks the atlas it reads', () => {
  fresh();
  const many = Array.from({ length: 700 }, (_, i) => ({
    id: 'L' + i, name: 'L' + i, lat: 46, lng: 8, tags: [], createdAt: '2026-01-01T00:00:00Z',
  }));
  localStorage.setItem('resonate.places.v1', JSON.stringify(many));
  store.load();
  assert.equal(store.places.length, 700, 'an atlas that loads smaller than it saved is a leak');
});


// ---------- the loss table ----------
//
// Every row here is a field that used to come home shorter than it left,
// under numbers chosen so that loss would be rare rather than impossible.
// Rare is not the standard. One file carries all five so that a build which
// fixes the top level and forgets a depth cannot pass.

const theLossTable = () => ({
  app: 'resonate', app: 'resonate',
  version: 4,
  places: [{
    id: 'big', name: 'Everything at once', lat: 46, lng: 8, tags: [],
    note: 'n'.repeat(200001),
  },
  // the folio below names these, and an archive whose folio points at places
  // it does not carry is refused now, so the fixture carries them
  ...Array.from({ length: 501 }, (_, i) => ({ id: 'fp' + i, name: 'F' + i, lat: 46, lng: 8, tags: [] }))],
  routes: [{
    id: 'way', name: 'The long one', tags: [],
    path: Array.from({ length: 1475 }, (_, i) => ({
      lat: 46 + i * 0.0001, lng: 8 + i * 0.0001, ele: 1000 + (i % 60),
    })),
  }],
  folios: [{
    id: 'fol', title: 'A wide folio', routeIds: [],
    placeIds: Array.from({ length: 501 }, (_, i) => 'fp' + i),
  }],
  correspondents: [{
    id: 'voice', name: 'Mira', tags: [],
    places: Array.from({ length: 501 }, (_, i) => ({ id: 'vp' + i, name: 'V' + i, lat: 46, lng: 8, tags: [] })),
  }],
  tags: [],
  settings: {},
});

test('a person’s own archive comes home to the last character, reference and point', () => {
  fresh();
  const file = theLossTable();
  const added = store.merge(file, { own: true });
  // a place, a way, a folio, a voice, and the 501 places the folio names,
  // which the fixture carries because an archive whose folio points at
  // records it does not contain is refused
  assert.equal(added, 505, 'everything in the file came in');
  assert.deepEqual(store.lastLost, [], 'and nothing at all was shortened on the way in');

  const p = store.placeById('big');
  assert.equal(p.note.length, 200001, 'there is no length at which a note stops being a person’s own');
  assert.equal(store.folios[0].placeIds.length, 501, 'a dropped reference is a place that left a collection');
  assert.equal(store.correspondents[0].places.length, 501, 'a voice is kept as it was handed over');
  assert.equal(store.routes[0].path.length, 1475);
  assert.deepEqual(store.routes[0].path, file.routes[0].path, 'and the way keeps its exact shape');
});

test('a stranger handing over that same file is clipped at every one of those depths', () => {
  fresh();
  const file = theLossTable();
  // a route long enough to meet the stranger’s bound, which 1475 points is not
  file.routes[0].path = Array.from({ length: 3001 }, (_, i) => ({ lat: 46 + i * 0.00001, lng: 8 }));
  const added = store.merge(file);
  // the stranger's door caps places at 500, so the fixture's 502 arrive as
  // 500, plus the way, the folio and the voice
  assert.equal(added, 503);
  assert.deepEqual(store.lastLost, [], 'a stranger is clipped in silence, which is what a cap is for');
  assert.equal(store.placeById('big').note.length, 4000);
  assert.equal(store.folios[0].placeIds.length, 500);
  assert.equal(store.correspondents[0].places.length, 500);
  assert.equal(store.routes[0].path.length, 3000, 'a hostile link may not spend this device');
});


// ---------- a way is stored with the shape it was given ----------

test('a way comes home the same shape however many times it comes home', () => {
  fresh();
  // a jittery recorded track: exactly the shape simplify() thins hardest, so
  // if anything on this road still thins, this is where it shows
  const path = Array.from({ length: 501 }, (_, i) => ({
    lat: 46 + i * 0.0002, lng: 8 + (i % 2 ? 0.000004 : -0.000004), ele: 1000 + i,
  }));

  let r = newRoute({ path });
  for (let pass = 0; pass < 3; pass++) r = newRoute({ ...r });
  assert.deepEqual(r.path, path, 'a record that changes by being read is not a record');

  store.addRoute(newRoute({ id: 'w1', path }));
  store.load();
  assert.deepEqual(store.routeById('w1').path, path, 'and a reload is a reading like any other');
});


// ---------- hiding the ends of a way ----------

// a straight line due north of a given length, in the two points a recorded
// straight walk actually reduces to
const KM_PER_DEG = 6371 * Math.PI / 180;
const straight = (km) => [{ lat: 46, lng: 8 }, { lat: 46 + km / KM_PER_DEG, lng: 8 }];

test('a straight thirteen kilometre way is trimmed at both ends, on two points', () => {
  fresh();
  const path = straight(13);
  const out = trimWay({ ...newRoute({ name: 'The long straight', path }), trimEnds: true });
  assert.ok(out, 'a way this long is not too short to lose its ends');
  assert.equal(out.path.length, 2, 'point count was never the question; ground is');
  const head = measure([path[0], out.path[0]]).km;
  const tail = measure([path[1], out.path[1]]).km;
  assert.ok(Math.abs(head - 0.25) < 0.001, `the start moved ${head} km, which is not a quarter`);
  assert.ok(Math.abs(tail - 0.25) < 0.001, `the end moved ${tail} km, which is not a quarter`);
});

test('a way too short to lose both ends is refused rather than half hidden', () => {
  fresh();
  assert.equal(trimWay({ ...newRoute({ path: straight(0.4) }), trimEnds: true }), null,
    'a quarter off each end of four hundred metres leaves a door still on the map');
  assert.equal(trimWay({ ...newRoute({ path: straight(0.2) }), trimEnds: true }), null);
  const open = newRoute({ path: straight(0.4) });
  assert.equal(trimWay(open), open, 'while a way never asked to hide its ends is handed over as it is');
});

test('a way whose ends cannot be hidden is handed to a stranger not at all', () => {
  fresh();
  const r = store.addRoute(newRoute({ name: 'Round the block', path: straight(0.4) }));
  store.updateRoute(r.id, { trimEnds: true });
  assert.deepEqual(JSON.parse(store.humanHandoverJSON()).routes, [], 'half a redaction is no redaction');
});

test('a trimmed way carries the trimmed shape’s measurements, not the walk’s', () => {
  fresh();
  const path = [];
  for (let i = 0; i <= 400; i++) {
    const u = i / 400;
    path.push({
      lat: 46 + u * 0.09, lng: 8 + u * 0.02,
      ele: u < 0.5 ? 1000 + u * 2000 : 2000 - (u - 0.5) * 1600,
    });
  }
  const walked = newRoute({ name: 'Up and over', path });
  const out = trimWay({ ...walked, trimEnds: true });
  assert.ok(out);
  const m = measure(out.path);
  assert.equal(out.km, m.km,
    'a distance describing ground the recipient never got is that ground, given away');
  assert.equal(out.ascent, m.ascent);
  assert.equal(out.descent, m.descent);
  assert.equal(out.high, m.high);
  assert.equal(out.low, m.low);
  assert.equal(out.hours, m.hours);
  assert.equal(out.loop, m.loop);
  assert.ok(out.km < walked.km - 0.49, `half a kilometre was hidden but ${out.km} is not less than ${walked.km}`);
});


// ---------- restore says: this file is the atlas now ----------

test('a restore replaces the atlas rather than adding to it', () => {
  fresh();
  store.addPlace(newPlace({ id: 'old1', name: 'Old one', lat: 46, lng: 8 }));
  store.addPlace(newPlace({ id: 'old2', name: 'Old two', lat: 47, lng: 9 }));
  store.settings.clubKey = 'tc_testkey0000000000000';

  const out = store.restore({
    app: 'resonate', version: 4,
    places: [{ id: 'new1', name: 'New one', lat: 45, lng: 7, tags: [] }],
    tags: [], settings: { theme: 'dark', hue: 120, authorName: 'Mira' },
  });

  assert.equal(out.ok, true);
  assert.deepEqual(out.lost, []);
  assert.equal(out.was.places, 2, 'a person is shown what this costs before they agree to it');
  assert.equal(out.now.places, 1);
  assert.deepEqual(store.places.map(p => p.id), ['new1'], 'a restore that adds is a merge wearing its name');
  assert.equal(store.settings.theme, 'dark', 'and the atlas comes back in its own colour');
  assert.equal(store.settings.hue, 120);
  assert.equal(store.settings.authorName, 'Mira');
  assert.equal(store.settings.clubKey, 'tc_testkey0000000000000', 'while the device keeps its own credential');
});

test('a restore the device refuses puts every record back', () => {
  fresh();
  store.addPlace(newPlace({ id: 'keep', name: 'Keep', lat: 46, lng: 8 }));
  store.addTag(newTag({ id: 'kt', name: 'Huts' }));
  const shape = () => JSON.stringify({ places: store.places, tags: store.tags, settings: store.settings });
  const before = shape();

  storage.refuse = true;
  const out = store.restore({ app: 'resonate', version: 4, places: [{ id: 'nope', name: 'Nope', lat: 45, lng: 7, tags: [] }], tags: [] });
  storage.refuse = false;

  assert.equal(out.ok, false);
  assert.equal(out.reason, 'refused');
  assert.deepEqual(out.now, out.was, 'nothing moved, so the counts did not move either');
  assert.equal(shape(), before, 'a restore is one act: refused in part, kept in none');
});

test('a restore refuses an archive that lost anything in the reading', () => {
  fresh();
  store.addPlace(newPlace({ id: 'keep', name: 'Keep', lat: 46, lng: 8 }));
  const out = store.restore({
    app: 'resonate', version: 4, tags: [],
    places: [
      { id: 'good', name: 'Good', lat: 45, lng: 7, tags: [] },
      { id: 'bad', name: 'No coordinates', tags: [] },
    ],
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'lossy');
  assert.deepEqual(out.lost.map(l => l.id), ['bad'], 'and names the record rather than a number');
  assert.deepEqual(store.places.map(p => p.id), ['keep'], 'the atlas is exactly as it was');
  assert.equal(store.restore('not a file at all').reason, 'unreadable',
    'a file that is not an archive is told apart from an archive that lost something');
});

test('comparing a file with the atlas changes neither', () => {
  fresh();
  store.addPlace(newPlace({ id: 'a', name: 'A', lat: 46, lng: 8 }));
  store.addPlace(newPlace({ id: 'b', name: 'B', lat: 47, lng: 9 }));
  store.addPlace(newPlace({ id: 'c', name: 'C', lat: 48, lng: 10 }));
  store.addRoute(newRoute({ id: 'w', path: [{ lat: 46, lng: 8 }, { lat: 46.1, lng: 8.1 }] }));

  const file = JSON.parse(store.recordsJSON());
  const held = file.places.find(p => p.id === 'a');
  file.places = [
    held,
    { ...file.places.find(p => p.id === 'b'), note: 'a sentence it did not have' },
    { ...held, id: 'n1', name: 'Newcomer' },
  ];

  const shape = () => JSON.stringify({ places: store.places, routes: store.routes });
  const before = shape();
  const onDisk = localStorage.getItem('resonate.places.v1');

  const seen = store.compare(file);
  // the totals the panel prints, and beneath them the typed report the
  // sentences are built from: every kind a restore replaces, by id
  assert.deepEqual(seen, {
    fresh: 1, differ: 1, identical: 2, onlyHere: 1,
    byKind: {
      places: { fresh: ['n1'], changed: ['b'], identical: ['a'], onlyHere: ['c'] },
      paths: { fresh: [], changed: [], identical: ['w'], onlyHere: [] },
      tags: { fresh: [], changed: [], identical: [], onlyHere: [] },
      folios: { fresh: [], changed: [], identical: [], onlyHere: [] },
      books: { fresh: [], changed: [], identical: [], onlyHere: [] },
      voices: { fresh: [], changed: [], identical: [], onlyHere: [] },
    },
    settings: { changed: [] },
    lost: [], setAside: [],
  });
  assert.equal(shape(), before, 'a comparison that changes what it compares is not a comparison');
  assert.equal(localStorage.getItem('resonate.places.v1'), onDisk, 'and nothing was written on the way past');
});


// ---------- a key that will not parse ----------
//
// The seal lives in module state rather than in storage, so every test here
// releases what it sealed. A seal left behind would silently refuse every
// write in the tests that follow.

test('a corrupt key is set aside, and no later edit can write over it', () => {
  fresh();
  const damaged = '[{"id":"p1","name":"Half a pl';
  localStorage.setItem('resonate.places.v1', damaged);
  store.load();

  assert.equal(store.places.length, 0, 'nothing readable came out of it');
  const sealed = unreadableKeys();
  assert.deepEqual(sealed.map(s => s.key), ['resonate.places.v1'], 'the app is told which key, by name');
  assert.equal(sealed[0].bytes, damaged.length, 'and how much of it is still there');
  assert.ok(sealed[0].at, 'and when it was found');
  assert.equal(localStorage.getItem('resonate.places.v1.unreadable'), damaged,
    'a copy is set aside under a name that says what it is');

  // the keystroke that used to be fatal
  assert.equal(store.addPlace(aPlace('The next keystroke')), null, 'the write is refused, not attempted');
  assert.equal(store.places.length, 0, 'and the refusal rolls back like any other');
  assert.equal(localStorage.getItem('resonate.places.v1'), damaged,
    'one corrupt byte must not become a blank life');

  // and every other road into that key is refused the same way
  assert.equal(store.merge({ app: 'resonate', version: 4, tags: [], places: [{ id: 'm1', name: 'M', lat: 46, lng: 8 }] }), null);
  assert.equal(store.restore({ app: 'resonate', version: 4, tags: [], places: [{ id: 'r1', name: 'R', lat: 46, lng: 8 }] }).ok, false);
  assert.equal(localStorage.getItem('resonate.places.v1'), damaged, 'still exactly as it was found');

  releaseUnreadable('resonate.places.v1');
});

test('the copy set aside on the first load is not replaced on the second', () => {
  fresh();
  localStorage.setItem('resonate.places.v1', 'the damage as first found');
  store.load();
  localStorage.setItem('resonate.places.v1', 'something later, and worse');
  store.load();
  assert.equal(localStorage.getItem('resonate.places.v1.unreadable'), 'the damage as first found',
    'the earliest copy is the one worth keeping');
  releaseUnreadable('resonate.places.v1');
});

test('releasing a sealed key lets the atlas be written again, and keeps the copy', () => {
  fresh();
  const damaged = '{ not json at all';
  localStorage.setItem('resonate.places.v1', damaged);
  store.load();
  assert.equal(store.addPlace(aPlace('Refused')), null);

  assert.equal(releaseUnreadable('resonate.places.v1'), true, 'a person who has been told may decide');
  assert.deepEqual(unreadableKeys(), [], 'and the seal is gone');

  assert.ok(store.addPlace(aPlace('Kept')), 'the key takes a write again');
  assert.ok(localStorage.getItem('resonate.places.v1').includes('Kept'));
  assert.equal(localStorage.getItem('resonate.places.v1.unreadable'), damaged,
    'releasing is a decision to move on, not a decision to destroy');
});

test('a write refused because a key is sealed is announced, not swallowed', () => {
  fresh();
  localStorage.setItem('resonate.tags.v1', 'not json');
  store.load();

  const heard = [];
  setWriteFailedHandler((key, err) => heard.push([key, err.message]));
  assert.equal(store.addTag(newTag({ name: 'Huts' })), null);
  setWriteFailedHandler(null);

  assert.equal(heard.length, 1, 'a refusal nobody hears is the silence this was built against');
  assert.equal(heard[0][0], 'resonate.tags.v1');
  assert.match(heard[0][1], /will not be written over/);

  releaseUnreadable('resonate.tags.v1');
  assert.deepEqual(unreadableKeys(), [], 'nothing is left sealed for the next test');
});

// ---------- what the adversarial pass over rf67 turned up ----------

test('a way that spends its first quarter kilometre near the door still loses the door', () => {
  fresh();
  // a track that circles the block before setting off: 300 m of line covered,
  // 40 m of ground gained. measuring the line alone hands over the doorstep.
  const door = { lat: 46, lng: 8 };
  const ring = [];
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    ring.push({ lat: 46 + Math.sin(a) * 0.0004, lng: 8 + Math.cos(a) * 0.0004 });
  }
  const away = Array.from({ length: 40 }, (_, i) => ({ lat: 46 + 0.0004 + i * 0.0006, lng: 8 }));
  const back = Array.from({ length: 40 }, (_, i) => ({ lat: 46 + 0.0004 + (39 - i) * 0.0006, lng: 8.004 }));
  const r = newRoute({ name: 'from my door', path: [door, ...ring, ...away, ...back], trimEnds: true });
  const out = trimWay(r);
  assert.ok(out, 'the way is long enough to trim');
  const km = (a, b) => {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  };
  assert.ok(km(door, out.path[0]) >= 0.2499,
    `the new start is ${(km(door, out.path[0]) * 1000).toFixed(0)} m from the door, and a quarter kilometre was promised`);
  assert.ok(km(r.path[r.path.length - 1], out.path[out.path.length - 1]) >= 0.2499,
    'and the same at the far end');
});

test('a segment stepping over the antimeridian is trimmed along the way it was walked', () => {
  fresh();
  // a walk from 179.9E to 179.9W: eight kilometres of ground, not forty thousand
  const path = [];
  for (let i = 0; i <= 40; i++) path.push({ lat: 0, lng: 179.8 + i * 0.01 > 180 ? 179.8 + i * 0.01 - 360 : 179.8 + i * 0.01 });
  const out = trimWay(newRoute({ name: 'the date line', path, trimEnds: true }));
  assert.ok(out, 'it is long enough to trim');
  for (const pt of out.path) {
    assert.ok(Math.abs(pt.lng) > 179, `a trimmed point landed at ${pt.lng}, which is halfway across the pacific`);
  }
});

test('a merge does not repaint an atlas that already has a look', () => {
  fresh();
  store.settings.chosen = true;
  store.settings.hue = 300;
  store.settings.theme = 'dark';
  store.addPlace(aPlace('Mine'));
  store.merge({ app: 'resonate', version: 4, tags: [], places: [{ id: 'x', name: 'Theirs', lat: 1, lng: 2, tags: [] }],
    settings: { hue: 74, theme: 'light', authorName: 'someone else' } }, { own: true });
  assert.equal(store.settings.hue, 300, 'a file brought in beside your atlas does not choose its colour');
  assert.equal(store.settings.theme, 'dark');
});

test('the first imported place brings its look into an empty atlas', () => {
  fresh();
  const added = store.merge({ app: 'resonate', version: 4, tags: [],
    places: [{ id: 'first-look', name: 'First', lat: 46, lng: 8, tags: [] }],
    settings: { theme: 'dark', hue: 74, split: 23 } }, { own: true });
  assert.equal(added, 1);
  assert.equal(store.settings.theme, 'dark');
  assert.equal(store.settings.hue, 74);
  assert.equal(store.settings.split, 23);
  assert.equal(JSON.parse(localStorage.getItem('resonate.settings.v1')).theme, 'dark',
    'the imported look was not merely changed in memory');
});

test('a restore is the operation that does set the whole look', () => {
  fresh();
  store.settings.chosen = true;
  store.settings.hue = 300;
  const r = store.restore({ app: 'resonate', version: 4, tags: [], routes: [],
    places: [{ id: 'x', name: 'Theirs', lat: 1, lng: 2, tags: [] }],
    settings: { hue: 74, theme: 'light', authorName: 'ada' } });
  assert.equal(r.ok, true);
  assert.equal(store.settings.hue, 74, 'being the file means being its colour too');
  assert.equal(store.settings.authorName, 'ada');
});

test('comparing counts the folios and voices a replace would also destroy', () => {
  fresh();
  store.addPlace(newPlace({ id: 'p1', name: 'Held', lat: 46, lng: 8 }));
  store.addFolio(newFolio({ id: 'f1', title: 'Mine alone', placeIds: ['p1'] }));
  store.addCorrespondent({ id: 'c1', name: 'Marta', tags: [], places: [] });
  const seen = store.compare({ app: 'resonate', version: 4, tags: [], routes: [], folios: [], correspondents: [],
    places: [{ id: 'p1', name: 'Held', lat: 46, lng: 8, tags: [] }] });
  assert.ok(seen.onlyHere >= 2,
    `the folio and the voice a replace would take are not counted: onlyHere is ${seen.onlyHere}`);
});

// compare() asks whether a place has changed by holding the record this
// device kept against newPlace(the record the file carried), and it asks with
// JSON.stringify, which is sensitive to the order the keys were written in.
// So the reader and the record maker have to agree on the order, not only on
// the fields. A field that one of them emits and the other does not, added or
// taken away, makes every place in a person's own backup read as changed, in
// the one dialog that offers to make this atlas the file.
test('a file this atlas wrote disagrees with it about nothing', () => {
  fresh();
  store.addPlace(newPlace({ id: 'r1', name: 'Held', lat: 46, lng: 8, city: 'Basel', note: 'the pond window' }));
  store.addPlace(newPlace({ id: 'r2', name: 'Second', lat: 47, lng: 9 }));
  store.load();
  const seen = store.compare(JSON.parse(store.exportJSON()));
  assert.equal(seen.differ, 0, 'a place is not changed by being written out and read back');
  assert.equal(seen.identical, 2, 'and both of them are recognised');
  // and the mechanism itself, so a failure above says which of the two moved
  assert.deepEqual(
    Object.keys(newPlace({ ...store.places[0] })), Object.keys(store.places[0]),
    'the reader and newPlace name the same keys in the same order');
});

// A file written before photographs left a record is the same atlas as the
// one on this device. Reporting every such place as changed would tell a
// person their backup disagrees with them on everything, in the one dialog
// that offers to replace everything.
test('a place is the same place whether or not the file still carries pictures', () => {
  fresh();
  store.addPlace(newPlace({ id: 'ph1', name: 'With a picture', lat: 46, lng: 8 }));
  store.load();
  // the same record as an older build wrote it, with the picture inlined
  const asFile = { ...store.placeById('ph1'), photos: ['data:image/png;base64,iVBORw0KGgo='] };
  const seen = store.compare({ app: 'resonate', version: 4, tags: [], routes: [], places: [asFile] });
  assert.equal(seen.differ, 0, 'a field this version does not keep is not a change');
  assert.equal(seen.identical, 1);
  assert.equal(seen.setAside.length, 1, 'and it is still counted, and still said');
});

// ---------- valid json of the wrong shape is corruption too ----------

test('a collection stored as the wrong kind of thing is sealed, not crashed into', () => {
  fresh();
  // perfectly good json, and not a list of records. this used to sail through
  // read() and throw on the next line that touched it, on every load
  localStorage.setItem('resonate.tags.v1', '{}');
  store.load();
  assert.deepEqual(store.tags, [], 'nothing half formed is left where the app will use it');
  const sealed = unreadableKeys().map(k => k.key);
  assert.ok(sealed.includes('resonate.tags.v1'), `the key was not sealed: ${sealed.join(', ')}`);
  assert.equal(localStorage.getItem('resonate.tags.v1'), '{}', 'and the bytes are exactly where they were');
  releaseUnreadable('resonate.tags.v1');
});

test('one record the reader turns down holds back the whole collection', () => {
  fresh();
  // two places, one without coordinates. the reader keeps one; keeping one and
  // then healing dates over the top used to write the shorter list back and
  // destroy the other
  const both = JSON.stringify([
    { id: 'ok', name: 'Kept', lat: 46, lng: 8, tags: [] },
    { id: 'bad', name: 'No coordinates', tags: [] },
  ]);
  localStorage.setItem('resonate.places.v1', both);
  store.load();
  assert.equal(store.places.length, 0, 'a collection is all of its records or none');
  assert.equal(localStorage.getItem('resonate.places.v1'), both, 'and the original is byte for byte where it was');
  const why = unreadableKeys().find(k => k.key === 'resonate.places.v1')?.why || '';
  assert.match(why, /1 of 2/, `the person is told how much: ${why}`);
  releaseUnreadable('resonate.places.v1');
});

test('settings stored as a list do not become the settings', () => {
  fresh();
  localStorage.setItem('resonate.settings.v1', '["not", "settings"]');
  store.load();
  assert.equal(store.settings.theme, 'auto', 'the defaults stand');
  assert.ok(unreadableKeys().some(k => k.key === 'resonate.settings.v1'));
  releaseUnreadable('resonate.settings.v1');
});

test('a collection that reads whole is loaded whole, and still heals its dates', () => {
  fresh();
  localStorage.setItem('resonate.places.v1', JSON.stringify([
    { id: 'd1', name: 'One', lat: 46, lng: 8, tags: [], createdAt: '' },
    { id: 'd2', name: 'Two', lat: 47, lng: 9, tags: [], createdAt: '2024-05-12T09:00:00Z' },
  ]));
  store.load();
  assert.equal(store.places.length, 2, 'nothing is sealed when nothing is wrong');
  assert.deepEqual(unreadableKeys(), []);
  assert.ok(store.placeById('d1').createdAt, 'and the empty date was still healed');
});

// ---------- the sample is real, and travels ----------
//
// The rule used to be the opposite: a sample was "on loan, not yours yet"
// and left through no door. The owner retired that rule on 2026-08-11: the
// sample is real places from real people, and it travels, composes and
// publishes like any record. Only the person's own word, private, keeps a
// record home. The mark itself survives, for the chip and the clearing word.

test('a sample record travels through every door, like the real place it is', () => {
  fresh();
  store.addPlace(newPlace({ id: 'mine', name: 'My Own Place', lat: 46, lng: 8 }));
  store.addPlace(newPlace({ id: 'lent', name: 'A Demonstration', lat: 47, lng: 9, sample: true }));
  store.addPlace(newPlace({ id: 'kept', name: 'My Own Door', lat: 48, lng: 10, private: true }));
  store.addRoute(newRoute({ id: 'lentway', name: 'A Demonstration Path', sample: true,
    path: Array.from({ length: 20 }, (_, i) => ({ lat: 46 + i * 0.01, lng: 8 })) }));

  const outward = {
    handover: store.humanHandoverJSON(), assistant: store.assistantCopyJSON(),
    kml: store.exportKML(), csv: store.exportCSV(),
    md: store.exportMarkdown(), geo: store.exportGeoJSON(),
  };
  for (const [door, text] of Object.entries(outward)) {
    assert.ok(text.includes('A Demonstration'),
      `${door} still holds the sample back as a loan`);
    assert.ok(text.includes('My Own Place'), `${door} carried nothing, so it proved nothing`);
    // and the one word that does keep a record home still keeps it home
    assert.equal(text.includes('My Own Door'), false,
      `${door} let a private place out while the sample rule was being retired`);
  }

  // the mark survives where it should: the device, the backup, the snapshot
  const full = JSON.parse(store.exportJSON());
  assert.equal(full.places.length, 3);
  assert.ok(JSON.parse(store.recordsJSON()).places.some(p => p.sample), 'the mark is still local truth');
  // but the mark itself never rides outward: a recipient is handed places,
  // not this app's bookkeeping about a demonstration
  assert.equal(/"sample"/.test(outward.handover), false, 'the mark leaked into a handover');
});

// ---------- what arrives with the app never testifies ----------
//
// The gate the paid tier waits behind. These records travel, which the owner
// settled: they are real places from real people. What they may not do is
// claim, under a person's byline, that the person went somewhere or that
// somebody thanked them. `status: 'visited'` is a first-person claim in this
// app, and a heart is a real arrival from a real person.
//
// The whole seeded atlas goes through every door and every door is read. Not a
// sample of it, and not a fixture that resembles it: the thing itself, so that
// a record added to the seed years from now is examined the day it is added.
test('the whole seeded atlas travels without testifying for anybody', () => {
  fresh();
  const demo = demoData();
  demo.tags.forEach(t => store.addTag(t));
  demo.places.forEach(pl => store.addPlace(newPlace({ ...pl, sample: true })));
  (demo.routes || []).forEach(r => store.addRoute(newRoute({ ...r, sample: true })));
  store.settings.authorName = 'ada';

  assert.ok(store.places.length >= 25, 'the seeded atlas did not load, so this test proves nothing');

  const outward = {
    handover: store.humanHandoverJSON(), assistant: store.assistantCopyJSON(),
    kml: store.exportKML(), csv: store.exportCSV(),
    md: store.exportMarkdown(), geo: store.exportGeoJSON(),
    link: JSON.stringify(shareMod.buildPayload('atlas', {
      places: store.places, routes: store.routes, tags: store.tags,
      author: store.settings.authorName,
    }, { forLink: true })),
  };

  for (const [door, text] of Object.entries(outward)) {
    assert.ok(text.includes('Fondation Beyeler'),
      `${door} carried nothing of the seeded atlas, so it proved nothing`);
  }
  // the doors that carry a byline carry this one, which is what makes a false
  // claim a claim about a person rather than a loose fact
  // markdown titles itself "An atlas" and names nobody, which is its own
  // business; these three are the doors that carry the name
  for (const door of ['handover', 'assistant', 'link']) {
    assert.ok(outward[door].includes('ada'),
      `${door} carried no byline, so this test is not about testimony at all`);
  }

  // nothing in any carrier says the person holding this atlas has been anywhere
  for (const [door, text] of Object.entries(outward)) {
    assert.equal(/"status":\s*"visited"/.test(text), false,
      `${door} hands over a visit nobody made`);
    assert.equal(/thank/i.test(text), false, `${door} carries gratitude nobody sent`);
  }

  // the csv answers the question in a column of its own, and every row says no.
  // read as fields rather than split on commas: an address is quoted and holds
  // one, and a naive split would read the wrong column and pass without looking.
  const fields = (line) => {
    const out = []; let cur = ''; let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quoted) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') quoted = false;
        else cur += c;
      } else if (c === '"') quoted = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out;
  };
  const lines = outward.csv.split('\n').filter(Boolean);
  const been = fields(lines[0]).indexOf('been');
  assert.ok(been > 0, 'the csv no longer has a column for the visit, so this proves nothing');
  const answers = lines.slice(1).map(l => fields(l)[been]);
  assert.equal(answers.length, store.places.length, 'the csv lost a row, or the reader did');
  assert.ok(answers.every(a => a === 'no'),
    `the csv hands over ${answers.filter(a => a !== 'no').length} visits nobody made`);

  // and the road survives the journey, so the far side reads a gift and not a
  // boast: sixteen of these came from somebody, by name
  const carried = JSON.parse(outward.handover);
  const roads = carried.places.filter(pl => pl.prov && pl.prov.length);
  assert.ok(roads.length >= 9, `only ${roads.length} roads reached the recipient`);
  assert.ok(roads.some(pl => pl.prov[pl.prov.length - 1].name === 'Tomas'),
    'the name at the end of a road did not travel');
  const link = JSON.parse(outward.link);
  assert.equal(link.places.filter(pl => pl.prov && pl.prov.length).length, roads.length,
    'a link and a file disagree about how many roads there are');
});

// ---------- an assistant is given what a friend is given ----------
//
// The contract used to promise this as byte equality, and that was never true:
// the assistant's copy names the terms it was handed over under and a friend's
// copy has no terms to name. Byte equality is the wrong promise anyway. It
// breaks the moment either file gains a line about itself, and then the
// document is wrong rather than the code.
//
// What is actually promised, and what these hold, is that the atlas inside the
// two files is one atlas: the same records, the same fields, filtered by the
// same rules. Everything the assistant's copy adds is about the copy.

const sentinelAtlas = () => {
  fresh();
  store.settings.authorName = 'Ada';
  const t = store.addTag(newTag({ id: 't1', name: 'Culture' }));
  store.addPlace(newPlace({ id: 'p1', name: 'Known Sentinel Place', lat: 47.5, lng: 7.6,
    city: 'Basel', country: 'Switzerland', tags: [t.id], status: 'visited',
    note: 'before ten', url: 'https://example.test' }));
  store.addPlace(newPlace({ id: 'p2', name: 'Kept Sentinel Home', lat: 47.6, lng: 7.7, private: true }));
  store.addRoute(newRoute({ id: 'w1', name: 'Sentinel Ridge',
    path: Array.from({ length: 30 }, (_, i) => ({ lat: 46 + i * 0.01, lng: 8, ele: 300 + i })) }));
};

test('the atlas inside the assistant copy is the atlas inside the handover', () => {
  sentinelAtlas();
  const friend = JSON.parse(store.humanHandoverJSON());
  const assistant = JSON.parse(store.assistantCopyJSON());

  // it ran, and it carried something: an equality between two empty objects is
  // the shape of proof this repository has already been fooled by once
  assert.equal(friend.places.length, 1);
  assert.equal(friend.routes.length, 1);
  assert.equal(friend.places[0].name, 'Known Sentinel Place');

  const { app: _a, exportedAt: _e, ...disclosure } = friend;
  assert.deepEqual(assistant.disclosure, disclosure,
    'the two files disagree about the atlas inside them');

  // and what the assistant's copy adds is about the copy, never about a record
  assert.deepEqual(Object.keys(assistant).sort(),
    ['app', 'disclosure', 'exportedAt', 'kind', 'terms']);
  assert.equal(assistant.kind, 'assistant_copy',
    'a reader must not have to infer which of the kinds this file is');
  assert.equal(assistant.disclosure.kind, 'atlas', 'and the atlas inside is still an atlas');
});

test('the wrapper opens by name, and what is inside is a handover a gate accepts', () => {
  sentinelAtlas();
  const parsed = JSON.parse(store.assistantCopyJSON());
  const inside = unwrapFile(parsed);

  // the disclosure is a handover payload and passes the gate every link
  // passes, so the copy carries an atlas rather than a shape resembling one
  const read = normPayload(inside);
  assert.ok(read, 'the atlas inside the copy did not pass the handover gate');
  assert.equal(read.kind, 'atlas');
  // the number an atlas declares, which is not the highest number this build
  // can read: those parted company when the protocol gained an introduction
  assert.equal(read.v, KIND_VERSION.atlas);
  assert.equal(read.places[0].name, 'Known Sentinel Place');
  assert.equal(read.routes.length, 1, 'and the path inside it survived the gate');

  // by name, not by shape: nothing else is unpacked, and a named wrapper with
  // nothing inside is left exactly as it came for the gates to refuse
  assert.equal(unwrapFile({ kind: 'atlas', places: [] }).kind, 'atlas');
  assert.equal(unwrapFile({ kind: 'assistant_copy' }).kind, 'assistant_copy');
  assert.equal(unwrapFile(null), null);
});

// ---------- a file has to say what it is ----------

test('a file that is not a resonate archive is refused, not read as an empty one', () => {
  fresh();
  const r = store.restore({ app: 'some-other-program', version: 4, places: [], tags: [] });
  assert.equal(r.ok, false);
  assert.match(r.lost.map(l => l.reason).join(' '), /not by resonate/);
});

test('a file from a newer resonate is refused rather than quietly narrowed', () => {
  fresh();
  // it carries fields this build cannot see. reading it here would drop them
  // and then write the shorter thing back as though it were the whole atlas
  const r = store.restore({
    app: 'resonate', version: 99, tags: [], routes: [],
    places: [{ id: 'p1', name: 'From the future', lat: 46, lng: 8, tags: [], mood: 'quiet' }],
  });
  assert.equal(r.ok, false);
  assert.match(r.lost.map(l => l.reason).join(' '), /newer resonate/);
});

test('two records sharing one id are refused, because only one could be reached', () => {
  fresh();
  const twice = { id: 'dup', name: 'Twice', lat: 46, lng: 8, tags: [] };
  const r = store.restore({ app: 'resonate', version: 4, tags: [], routes: [], places: [twice, { ...twice }] });
  assert.equal(r.ok, false);
  assert.match(r.lost.map(l => l.reason).join(' '), /share one id/);
});

test('a folio naming records the file does not carry is refused', () => {
  fresh();
  const r = store.restore({
    app: 'resonate', version: 4, tags: [], routes: [],
    places: [{ id: 'p1', name: 'Here', lat: 46, lng: 8, tags: [] }],
    folios: [{ id: 'f1', title: 'Points at nothing', placeIds: ['p1', 'gone'], routeIds: [] }],
  });
  assert.equal(r.ok, false);
  assert.match(r.lost.map(l => l.reason).join(' '), /does not contain/);
});

test('a file this build wrote is still read without complaint', () => {
  fresh();
  store.addPlace(newPlace({ id: 'p1', name: 'Mine', lat: 46, lng: 8 }));
  store.addFolio(newFolio({ id: 'f1', title: 'A folio', placeIds: ['p1'] }));
  const file = JSON.parse(store.exportJSON());
  fresh();
  const r = store.restore(file);
  assert.equal(r.ok, true, `a round trip must not trip its own gate: ${JSON.stringify(r.lost)}`);
  assert.equal(store.places.length, 1);
  assert.equal(store.folios.length, 1);
});

// ---------- the comparison sees every kind, completely ----------
//
// Three defects stood in compare() at once. A path was compared by geometry
// alone, so a way renamed, re-noted, or newly marked never-to-leave read as
// identical: the preview said "already the same" about records a restore
// would overwrite. Equality was JSON.stringify, so key order counted. And
// "only here" pooled every id into one untyped set, so a place and a tag
// sharing a raw id masked one another.

const wholeAtlas = () => {
  fresh();
  store.settings.authorName = 'Ada';
  store.settings.theme = 'dark';
  store.saveSettings();
  const t = store.addTag(newTag({ id: 'tg', name: 'Culture', hue: 155 }));
  store.addPlace(newPlace({ id: 'pl', name: 'Known Sentinel Place', lat: 46, lng: 8, tags: [t.id] }));
  store.addRoute(newRoute({ id: 'wy', name: 'Sentinel Ridge', note: 'the long way',
    path: [{ lat: 46, lng: 8 }, { lat: 46.1, lng: 8.1 }] }));
  store.addFolio(newFolio({ id: 'fo', title: 'Basel', dedication: 'for you', placeIds: ['pl'] }));
  store.addCorrespondent({ id: 'vo', name: 'Marta', tags: [], places: [] });
  return JSON.parse(store.exportJSON());
};

test('a path that changed anything but its geometry is no longer called identical', () => {
  const file = wholeAtlas();

  // the file's way, renamed and re-noted and newly marked, same geometry
  file.routes[0] = { ...file.routes[0], name: 'Renamed Ridge' };
  let seen = store.compare(file);
  assert.deepEqual(seen.byKind.paths.changed, ['wy'], 'a renamed path read as identical');

  file.routes[0] = { ...file.routes[0], name: 'Sentinel Ridge', note: 'rewritten' };
  seen = store.compare(file);
  assert.deepEqual(seen.byKind.paths.changed, ['wy'], 'a re-noted path read as identical');

  file.routes[0] = { ...file.routes[0], note: 'the long way', private: true };
  seen = store.compare(file);
  assert.deepEqual(seen.byKind.paths.changed, ['wy'], 'a newly private path read as identical');
});

test('a record with reordered keys is the same record', () => {
  const file = wholeAtlas();
  const p = file.places[0];
  file.places[0] = Object.fromEntries(Object.entries(p).reverse());
  const w = file.routes[0];
  file.routes[0] = Object.fromEntries(Object.entries(w).reverse());
  const seen = store.compare(file);
  assert.deepEqual(seen.byKind.places.identical, ['pl'], 'key order was read as a change');
  assert.deepEqual(seen.byKind.paths.identical, ['wy']);
  assert.equal(seen.differ, 0);
});

test('a changed tag, folio and voice each reach the preview', () => {
  const file = wholeAtlas();
  file.tags[0] = { ...file.tags[0], name: 'Kultur' };
  file.folios[0] = { ...file.folios[0], dedication: 'for bruno' };
  file.correspondents[0] = { ...file.correspondents[0], name: 'Marta B' };
  const seen = store.compare(file);
  assert.deepEqual(seen.byKind.tags.changed, ['tg'], 'a renamed tag was invisible');
  assert.deepEqual(seen.byKind.folios.changed, ['fo'], 'an edited folio was invisible');
  // a voice's id is minted by the store, so it is read back rather than assumed
  assert.deepEqual(seen.byKind.voices.changed, [store.correspondents[0].id],
    'a changed voice was invisible');
  assert.equal(seen.differ, 3);
});

test('folio membership is part of the folio', () => {
  const file = wholeAtlas();
  file.places.push({ ...file.places[0], id: 'pl2', name: 'Second Sentinel' });
  file.folios[0] = { ...file.folios[0], placeIds: ['pl', 'pl2'] };
  const seen = store.compare(file);
  assert.deepEqual(seen.byKind.folios.changed, ['fo'], 'changed membership read as the same folio');
});

test('a changed byline and theme are named before a restore, and unchanged ones are not', () => {
  const file = wholeAtlas();
  file.settings.authorName = 'Grace';
  file.settings.theme = 'light';
  const seen = store.compare(file);
  assert.deepEqual(seen.settings.changed.sort(), ['authorName', 'theme'],
    'a restore would change the byline and the look and the preview said nothing');

  const same = store.compare(wholeAtlas());
  assert.deepEqual(same.settings.changed, [], 'identical settings were reported as differing');
});

test('a place and a tag sharing one raw id cannot mask each other', () => {
  const file = wholeAtlas();
  // the file carries a tag whose id collides with a held place's id, and
  // holds no record of the place's kind at all
  file.tags.push({ id: 'pl', name: 'Impostor', hue: 12 });
  file.places = [];
  const seen = store.compare(file);
  assert.ok(seen.byKind.places.onlyHere.includes('pl'),
    'the held place vanished from onlyHere because a tag wore its id');
  assert.ok(seen.byKind.tags.fresh.includes('pl'), 'and the tag is still fresh in its own kind');
});

// ---------- the two invariants: the preview is held to the operations ----------

test('fresh is exactly what merge adds', () => {
  const file = wholeAtlas();
  // one new record of every kind, plus the one trap: a tag with an unknown id
  // and a held name, which merge repoints and does not add
  file.places.push({ ...file.places[0], id: 'pNew', name: 'New Place' });
  file.routes.push({ ...file.routes[0], id: 'wNew', name: 'New Way' });
  file.tags.push({ id: 'tNew', name: 'Food', hue: 42 });
  file.tags.push({ id: 'tSameName', name: 'culture', hue: 95 }); // held name, other id
  file.folios.push({ ...file.folios[0], id: 'fNew', title: 'Lisboa' });
  file.correspondents.push({ id: 'vNew', name: 'Bruno', tags: [], places: [] });

  const seen = store.compare(file);
  const before = {
    places: store.places.length, routes: store.routes.length, tags: store.tags.length,
    folios: store.folios.length, voices: store.correspondents.length,
  };
  const added = store.merge(file, { own: true });
  const gained = (store.places.length - before.places) + (store.routes.length - before.routes)
    + (store.tags.length - before.tags) + (store.folios.length - before.folios)
    + (store.correspondents.length - before.voices);
  assert.equal(added, gained, 'merge misreported its own count');
  assert.equal(seen.fresh, added,
    `the preview promised ${seen.fresh} additions and merge performed ${added}`);
  assert.equal(store.tags.some(t => t.id === 'tSameName'), false,
    'the same-name tag was added instead of repointed, so the trap is gone from the fixture');
});

test('everything the preview calls changed or only-here is exactly what a replace touches', () => {
  const file = wholeAtlas();
  file.places[0] = { ...file.places[0], note: 'rewritten before restore' };
  file.routes = []; // the held way becomes only-here
  const seen = store.compare(file);
  assert.deepEqual(seen.byKind.places.changed, ['pl']);
  assert.deepEqual(seen.byKind.paths.onlyHere, ['wy']);

  const heldBefore = JSON.stringify(store.places.find(p => p.id === 'pl'));
  const r = store.restore(file);
  assert.equal(r.ok, true);
  assert.notEqual(JSON.stringify(store.places.find(p => p.id === 'pl')), heldBefore,
    'a record the preview called changed survived the replace unchanged');
  assert.equal(store.routes.length, 0,
    'a record the preview called only-here survived the replace');
});

// ---------- hearts: kept at home, never handed out ----------
//
// thanks is witness, not payload: the record of friends who came back to say
// a place was worth the going. It rides archives and snapshots because those
// come home; it enters no link, no file for a stranger, and no export for
// other software, because a heart handed onward would be this app
// manufacturing social proof out of somebody else's gratitude.

const thankedAtlas = () => {
  fresh();
  store.settings.authorName = 'Ada';
  store.addPlace(newPlace({ id: 'pl', name: 'Thanked Sentinel Place', lat: 46, lng: 8,
    thanks: [{ from: 'Marta Thanker', when: '2026-08-11T00:00:00.000Z' },
             { from: 'Bruno', when: '2026-08-11T01:00:00.000Z' },
             { from: 'Bruno', when: '2026-08-11T02:00:00.000Z' }] }));
};

test('a heart is in nothing a stranger or another program is handed', () => {
  thankedAtlas();
  const outward = {
    handover: store.humanHandoverJSON(), assistant: store.assistantCopyJSON(),
    kml: store.exportKML(), csv: store.exportCSV(),
    md: store.exportMarkdown(), geo: store.exportGeoJSON(),
  };
  for (const [door, text] of Object.entries(outward)) {
    assert.ok(text.includes('Thanked Sentinel Place'), `${door} carried nothing, so it proved nothing`);
    assert.equal(text.includes('Marta Thanker'), false, `${door} handed a thanker's name out`);
    assert.equal(/"thanks"/.test(text), false, `${door} carried the thanks field`);
  }
});

test('hearts come home in an archive and a snapshot, exactly as given', () => {
  thankedAtlas();
  const back = JSON.parse(store.exportJSON());
  assert.equal(back.places[0].thanks.length, 3, 'the backup dropped hearts');
  const snap = JSON.parse(store.recordsJSON());
  assert.equal(snap.places[0].thanks.length, 3, 'the snapshot dropped hearts');

  // and the file this atlas wrote still disagrees with it about nothing:
  // hearts do not trip the comparison against your own backup
  const seen = store.compare(back);
  assert.deepEqual(seen.byKind.places.identical, ['pl']);
  assert.equal(seen.differ, 0);
});

test('the id a place wore in the sender’s atlas stays out of every disclosure', () => {
  fresh();
  store.addPlace(newPlace({ id: 'ad', name: 'Adopted Sentinel', lat: 46, lng: 8,
    provenance: { name: 'Marta', adoptedAt: 'T', chain: [], srcId: 'their_secret_id_9' } }));
  // a book adopted from the same hand carries the same local bookkeeping, and
  // it is held to the same silence
  store.addBook(newBook({ id: 'adb', title: 'Adopted Shelf Sentinel',
    provenance: { name: 'Marta', adoptedAt: 'T', chain: [], srcId: 'their_secret_book_id_9' } }));
  const outward = [store.humanHandoverJSON(), store.assistantCopyJSON(),
    store.exportGeoJSON(), store.exportCSV(), store.exportMarkdown(), store.exportKML()];
  for (const text of outward) {
    assert.equal(text.includes('their_secret_id_9'), false,
      'the id a record wore in another atlas leaked outward');
    assert.equal(text.includes('their_secret_book_id_9'), false,
      'the id a book wore in another atlas leaked outward');
  }
  // while the archive keeps it, because a thanks composed after a restore
  // must still know where to send
  assert.equal(JSON.parse(store.exportJSON()).places[0].provenance.srcId, 'their_secret_id_9');
  assert.equal(JSON.parse(store.exportJSON()).books[0].provenance.srcId, 'their_secret_book_id_9');
});

// ---------- books leave the house the way everything leaves ----------

test('the handover carries the shelf, minus what may not leave, tags counted', () => {
  fresh();
  const t = store.addTag(newTag({ id: 't_bookonly', name: 'Reading', hue: 155 }));
  store.addBook(newBook({ id: 'b_goes', title: 'The Travelling Book', tags: [t.id] }));
  store.addBook(newBook({ id: 'b_stays', title: 'The Private Book', private: true }));
  const out = JSON.parse(store.humanHandoverJSON());
  assert.equal(out.books.length, 1, 'the shelf did not ride the handover');
  assert.equal(out.books[0].title, 'The Travelling Book');
  assert.equal(out.v, 8, 'a handover carrying books must announce the number');
  assert.ok(!store.humanHandoverJSON().includes('The Private Book'),
    'a book marked never to leave left');
  assert.ok(out.tags.some(x => x.name === 'Reading'),
    'a tag used only on a book is a used tag, and its meaning must travel');
  // and with the shelf empty of travellers, the number sits back down where
  // every shipped build reads it
  store.removeBook('b_goes');
  assert.equal(JSON.parse(store.humanHandoverJSON()).v, 6);
});

test('a folio holds books the way it holds places: by reference, resolved late', () => {
  fresh();
  const b = store.addBook(newBook({ title: 'Enclosed' }));
  const f = store.addFolio(newFolio({ title: 'F', bookIds: [b.id] }));
  assert.deepEqual(newFolio({}).bookIds, [],
    'emitted empty rather than omitted, or the restore preview reports a reload as an edit');
  assert.equal(store.resolveFolio(f.id).books[0].title, 'Enclosed');
  // a removed book falls out of the slice silently, like a removed place
  store.removeBook(b.id);
  assert.deepEqual(store.resolveFolio(f.id).books, []);
});

// ---------- the link diet: shorter, and not one meaning lighter ----------
//
// Three levers, each honest: a missing field and an empty one arrive as the
// same value from the gate; a coordinate in a link is rounded to about a
// metre, said on the surface; a tag id is a payload-internal reference and
// travels as t0. Place ids are never remapped: they are the thanks rail.

test('a link payload carries no empties, metre coordinates, and short tag ids', () => {
  fresh();
  const t = store.addTag(newTag({ id: 't_averylongrandomid', name: 'Culture', hue: 155 }));
  store.addPlace(newPlace({ id: 'p_keepthisid', name: 'Diet Sentinel', lat: 47.123456789, lng: 8.987654321,
    city: 'Basel', country: 'Switzerland', tags: [t.id], status: 'visited' }));
  const buildLink = (o) => shareMod.buildPayload('atlas', o, { forLink: o.forLink === true });

  const link = buildLink({ places: store.places, routes: [], tags: store.tags,
    author: 'ada', forLink: true });
  const p = link.places[0];
  assert.equal(p.lat, 47.12346, 'a link coordinate kept more than the metre');
  assert.equal(p.lng, 8.98765);
  assert.equal('note' in p, false, 'an empty note travelled as bytes');
  assert.equal('rating' in p, false, 'a zero rating travelled as bytes');
  assert.equal('address' in p, false);
  assert.equal(p.id, 'p_keepthisid', 'the thanks rail was remapped away');
  assert.deepEqual(p.tags, ['t0'], 'the tag reference did not shrink');
  assert.equal(link.tags[0].id, 't0');
  assert.equal(link.tags[0].name, 'Culture', 'the name is the meaning and must survive');

  // and the file keeps everything exact: the diet is the link's alone
  const file = buildLink({ places: store.places, routes: [], tags: store.tags, author: 'ada' });
  assert.equal(file.places[0].lat, 47.123456789);
  assert.equal(file.places[0].note, '');
  assert.deepEqual(file.places[0].tags, ['t_averylongrandomid']);
});

test('a place on the equator does not lose its latitude to the diet', () => {
  fresh();
  store.addPlace(newPlace({ id: 'eq', name: 'Equator Sentinel', lat: 0, lng: 32.58, status: 'visited' }));
  const buildLink = (o) => shareMod.buildPayload('atlas', o, { forLink: o.forLink === true });
  const link = buildLink({ places: store.places, routes: [], tags: [], author: '', forLink: true });
  assert.equal(link.places[0].lat, 0, 'zero latitude was stripped as an empty');
  // and the gate accepts what the diet emits, whole
  const read = schemaMod.normPayload(link);
  assert.ok(read, 'the gate refused the dieted payload');
  assert.equal(read.places[0].lat, 0);
});

test('the dieted payload means what the full one means, at the gate', () => {
  fresh();
  const t = store.addTag(newTag({ id: 'tx', name: 'Food', hue: 42 }));
  store.addPlace(newPlace({ id: 'p1', name: 'Round Trip Sentinel', lat: 46.5, lng: 8.25,
    city: 'Basel', country: 'Switzerland', tags: [t.id], status: 'visited', note: 'go early' }));
  const buildLink = (o) => shareMod.buildPayload('atlas', o, { forLink: o.forLink === true });
  const read = schemaMod.normPayload(
    buildLink({ places: store.places, routes: [], tags: store.tags, author: 'ada', forLink: true }));
  assert.ok(read);
  const p = read.places[0];
  assert.equal(p.name, 'Round Trip Sentinel');
  assert.equal(p.note, 'go early', 'the note is meaning and must survive the diet');
  assert.equal(p.status, 'visited');
  assert.equal(p.rating, 0, 'a stripped zero arrives as the same zero');
  // the reference resolves inside the payload: the tag the place names is
  // the tag the payload carries
  assert.ok(read.tags.some(tag => tag.id === p.tags[0]),
    'a place points at a tag reference the link does not carry');
  assert.equal(read.tags.find(tag => tag.id === p.tags[0]).name, 'Food');
});

// ---------- the sample knows its own people ----------
//
// The demo seeds two voices so the trust network is standing when the sample
// opens, and two sample places carry provenance pointing back at their copies
// (srcId), which is what makes "send thanks to Marta" stand on a sample
// plate. These pin the wiring: a srcId that resolves to nobody would be a
// thanks addressed to a record that does not exist.

test('every sample provenance points at a record its voice actually holds', () => {
  fresh();
  const demo = demoData();
  // the floor is fifteen, set deliberately: the network is only legible as
  // an experience when there are enough people for verdicts to spread from
  // kin to strangers
  assert.ok(demo.correspondents.length >= 15,
    `the sample holds ${demo.correspondents.length} voices; the network needs at least 15`);
  const dupNames = demo.correspondents.map(c => c.name);
  assert.equal(new Set(dupNames).size, dupNames.length, 'two sample voices share a name');
  // ---------- nothing that arrives with the app speaks in the first person ----------
  //
  // Both of these were the other way round once. Hearts were seeded onto four
  // sample places so the accumulation could be felt on the first afternoon,
  // and every sample place said `visited`. Both are claims about the person
  // holding the atlas: `visited` says they went, and a heart says somebody
  // thanked them for sending it. Neither had happened. Under a byline they
  // travelled as testimony, and a paid backup would have sealed them.
  //
  // What is left is what is true: a place worth going to, and a road saying
  // who it came from. The voices below keep their own `visited`, because that
  // is their claim about their own life.
  for (const pl of demo.places) {
    assert.ok(!pl.thanks || pl.thanks.length === 0,
      `${pl.name} arrives already thanked, by somebody who never sent it`);
    assert.notEqual(pl.status, 'visited',
      `${pl.name} arrives claiming a visit nobody made`);
  }
  for (const r of demo.routes || []) {
    assert.notEqual(r.status, 'visited', `${r.name} arrives claiming a walk nobody took`);
  }
  // and at least one voice does say `visited`, or this test is passing over
  // an atlas where nobody has ever been anywhere
  assert.ok(demo.correspondents.some(c => c.places.some(vp => vp.status === 'visited')),
    'not one voice stands behind a place, so the reset above proves nothing');
  assert.ok(demo.places.filter(x => x.provenance).length >= 5,
    'too few roads for the sharing to be felt');
  const byName = new Map(demo.correspondents.map(c => [c.name, c]));
  const carried = demo.places.filter(p => p.provenance);
  assert.ok(carried.length >= 2, 'no sample place carries a road, so the thanks word stands nowhere');
  for (const p of carried) {
    const voice = byName.get(p.provenance.name);
    assert.ok(voice, `${p.name} is after ${p.provenance.name}, who is not among the sample voices`);
    assert.ok(voice.places.some(vp => vp.id === p.provenance.srcId),
      `${p.name} points at ${p.provenance.srcId}, which ${p.provenance.name} does not hold`);
    const theirs = voice.places.find(vp => vp.id === p.provenance.srcId);
    assert.equal(theirs.name, p.name, 'the copy and the original disagree about the name');
  }
  // and every voice's places reference only tags that voice carries
  for (const c of demo.correspondents) {
    const held = new Set(c.tags.map(t => t.id));
    for (const vp of c.places) {
      for (const tid of vp.tags) {
        assert.ok(held.has(tid), `${c.name}'s ${vp.name} is filed under ${tid}, a word ${c.name} does not carry`);
      }
    }
  }
});

test('a sample voice wears the word, keeps it through a reload, and leaves with the sample', () => {
  fresh();
  const c = store.addCorrespondent({ name: 'Demo Voice', tags: [], places: [], sample: true });
  assert.equal(c.sample, true);
  store.load();
  assert.equal(store.correspondents.find(x => x.name === 'Demo Voice').sample, true,
    'the word washed off in the reload');
  const real = store.addCorrespondent({ name: 'Real Voice', tags: [], places: [] });
  assert.equal(real.sample, false, 'a real correspondent was marked as a demonstration');
});

// ---------- the identity, and every door it must not reach ----------
//
// The private key here is not a disclosure risk in the ordinary sense. Identity
// is the membership, so somebody holding it does not read what a person wrote:
// they write as that person, to that person's friends, in letters that open
// correctly. It travels in the sealed vault and nowhere else, and "nowhere
// else" is a claim about every door in this file rather than about the one
// door somebody remembered.

const A_KEY = { kty: 'EC', crv: 'P-256',
  x: 'Sentinel_x_0000000000000000000000000000000000000',
  y: 'Sentinel_y_0000000000000000000000000000000000000',
  d: 'SentinelPrivateHalf_0000000000000000000000000000' };

function pairedAtlas() {
  fresh();
  store.addPlace(newPlace({ id: 'pl', name: 'Paired Sentinel Place', lat: 46, lng: 8 }));
  store.setIdentity({ jwk: A_KEY, pub: 'B' + 'A'.repeat(86) });
  store.noteRoute('9c7k2m4n6p8q0r2s4t6v8w0x2y');
  store.addPair({
    id: 'k1', name: 'Sentinel Correspondent', pub: 'B' + 'C'.repeat(86),
    cap: 'a1b3c5d7e9f0g2h4j5k6m7n8p9.00001111222233334444555566',
    capId: 'cap00001', state: 'verified', mark: '9c7k 2m4n',
  });
}

test('the private key is in no file, no copy and no export this app can write', () => {
  pairedAtlas();
  const outward = {
    archive: store.exportJSON(), handover: store.humanHandoverJSON(),
    assistant: store.assistantCopyJSON(), snapshot: store.recordsJSON(),
    kml: store.exportKML(), csv: store.exportCSV(),
    md: store.exportMarkdown(), geo: store.exportGeoJSON(),
  };
  for (const [door, text] of Object.entries(outward)) {
    assert.ok(text.includes('Paired Sentinel Place'),
      `${door} carried nothing, so it proved nothing`);
    assert.equal(text.includes(A_KEY.d), false, `${door} handed out the private key`);
    assert.equal(text.includes('SentinelPrivateHalf'), false, `${door} handed out the private key`);
    // and the rest of the slice with it: a posting capability is a bearer
    // secret that lets its holder fill a friend's box
    assert.equal(text.includes('00001111222233334444555566'), false,
      `${door} handed out a posting capability`);
    assert.equal(text.includes('Sentinel Correspondent'), false,
      `${door} handed out who this person writes to`);
    assert.equal(/"letters"/.test(text), false, `${door} carried the letters slice`);
  }
});

test('an erased device keeps no identity, and says nothing about one', () => {
  pairedAtlas();
  store.clearAll();
  assert.equal(store.letters.jwk, null);
  assert.deepEqual(store.letters.pairs, []);
  assert.equal(store.letters.route, '');
  assert.equal(JSON.stringify([...storage.map.values()]).includes('SentinelPrivateHalf'), false,
    'the key survived an erase somewhere on disk');
});

test('a pairing is kept, changed and forgotten, and a refused write changes none of it', () => {
  pairedAtlas();
  assert.equal(store.pairById('k1').state, 'verified');
  assert.equal(store.pairByPub('B' + 'C'.repeat(86)).id, 'k1');

  storage.refuse = true;
  assert.equal(store.updatePair('k1', { state: 'withdrawn' }), null);
  assert.equal(store.pairById('k1').state, 'verified', 'a refused write moved the state anyway');
  assert.equal(store.addPair({ id: 'k2', name: 'Second' }), null);
  assert.equal(store.letters.pairs.length, 1, 'a refused write added a pairing anyway');
  assert.equal(store.removePair('k1'), null);
  assert.equal(store.letters.pairs.length, 1, 'a refused write removed a pairing anyway');
  assert.equal(store.setIdentity({ jwk: null, pub: '' }), null);
  assert.equal(store.letters.jwk.d, A_KEY.d, 'a refused write erased the identity anyway');

  storage.refuse = false;
  assert.equal(store.updatePair('k1', { state: 'withdrawn' }).state, 'withdrawn');
  assert.equal(store.removePair('k1'), true);
  assert.equal(store.letters.pairs.length, 0);
});

test('more than sixty-four pairings survive the trip through disk', () => {
  fresh();
  const cap = 'a1b3c5d7e9f0g2h4j5k6m7n8p9.00001111222233334444555566';
  for (let i = 0; i < 65; i++) {
    const pub = 'B' + i.toString(36).padStart(86, 'A');
    assert.ok(store.addPair({ id: `pair-${i}`, name: `Person ${i}`, pub, cap,
      capId: `cap${String(i).padStart(5, '0')}`, state: 'verified', v: 2,
      mark: '0000 1111 2222 3333 4444' }));
  }
  store.load();
  assert.equal(store.letters.pairs.length, 65, 'the sixty-fifth pairing was silently truncated');
  assert.equal(store.pairById('pair-64').name, 'Person 64');
});

test('what comes back off the disk is read through the gate, not trusted', () => {
  fresh();
  // a key of another curve, which is the shape a build from somewhere else
  // would write, and the one importKey would refuse in its own words
  const damaged = JSON.stringify({
    v: 1, jwk: { kty: 'RSA', n: 'x', d: 'y' }, pub: 'B' + 'A'.repeat(86),
    route: '9c7k2m4n6p8q0r2s4t6v8w0x2y', pairs: [],
  });
  storage.map.set('resonate.letters.v1', damaged);
  store.load();
  assert.equal(store.letters.jwk, null, 'a key of the wrong curve was kept');
  assert.ok(unreadableKeys().some(k => k.key === 'resonate.letters.v1'),
    'the malformed identity was treated as an ordinary empty one');
  assert.equal(localStorage.getItem('resonate.letters.v1.unreadable'), damaged,
    'the exact recoverable bytes were not quarantined');
  assert.equal(store.setIdentity({ jwk: A_KEY, pub: 'B' + 'A'.repeat(86) }), null,
    'an ordinary identity write went out over the malformed slice');
  assert.equal(localStorage.getItem('resonate.letters.v1'), damaged);
  releaseUnreadable('resonate.letters.v1');

  // and a slice numbered something nothing has ever written
  storage.map.set('resonate.letters.v1', JSON.stringify({ v: 2, jwk: A_KEY, pairs: [] }));
  store.load();
  assert.equal(store.letters.jwk, null);
  assert.deepEqual(store.letters.pairs, []);
  releaseUnreadable('resonate.letters.v1');
});

// ---------- books: the records that may answer to no place ----------
//
// Every test here was watched fail first with the thing it names taken out.

test('a book with no place comes home from an archive whole', () => {
  fresh();
  store.addBook(newBook({
    id: 'b1', title: 'Invisible Cities', author: 'Italo Calvino', year: '1972',
    note: 'Fifty-five cities and every one of them is Venice.',
  }));
  const file = JSON.parse(store.exportJSON());
  fresh();
  const out = store.restore(file);
  assert.equal(out.ok, true, out.reason || '');
  assert.equal(store.books.length, 1);
  const b = store.bookById('b1');
  assert.equal(b.title, 'Invisible Cities');
  assert.equal(b.author, 'Italo Calvino');
  assert.equal(b.year, '1972');
  assert.equal(b.placeId, '', 'a book with no place must not acquire one on the way home');
  assert.equal(b.note, 'Fifty-five cities and every one of them is Venice.');
  assert.equal(out.was.books, 0);
  assert.equal(out.now.books, 1, 'a restore that does not count books cannot report what it did');
});

test('a book tied to a place keeps the tie, and an untied one is not a defect', () => {
  fresh();
  store.addPlace(newPlace({ id: 'p1', name: 'St. John Bread and Wine', lat: 51.5197, lng: -0.0745 }));
  store.addBook(newBook({ id: 'b1', title: 'Nose to Tail', placeId: 'p1' }));
  store.addBook(newBook({ id: 'b2', title: 'The Songlines' }));
  const file = JSON.parse(store.exportJSON());
  fresh();
  assert.equal(store.restore(file).ok, true);
  assert.equal(store.bookById('b1').placeId, 'p1');
  assert.equal(store.bookById('b2').placeId, '');
  assert.deepEqual(store.booksForPlace('p1').map(b => b.id), ['b1']);
  assert.deepEqual(store.booksForPlace('p2'), []);
  assert.deepEqual(store.booksForPlace(''), [], 'an empty id is not a place, and must match no book');
});

test('deleting a place keeps the book and drops the pointer', () => {
  fresh();
  store.addPlace(newPlace({ id: 'p1', name: 'A cafe', lat: 46, lng: 8 }));
  store.addBook(newBook({ id: 'b1', title: 'The World Atlas of Coffee', placeId: 'p1' }));
  store.removePlace('p1');
  assert.equal(store.books.length, 1, 'deleting the cafe must not delete the book');
  assert.equal(store.bookById('b1').placeId, '', 'a pointer to nothing is not a tie');
  // and the archive it writes is one it can read back
  const file = JSON.parse(store.exportJSON());
  fresh();
  assert.equal(store.restore(file).ok, true, 'the app must not write an archive it refuses');
});

test('a merge adds a book it has not seen and never a second copy', () => {
  fresh();
  store.addBook(newBook({ id: 'b1', title: 'Danube' }));
  const file = JSON.parse(store.exportJSON());
  assert.equal(store.merge(file, { own: true }), 0, 'a book already held is not new');
  fresh();
  assert.equal(store.merge(file, { own: true }), 1);
  assert.equal(store.books.length, 1);
  assert.equal(store.merge(file, { own: true }), 0);
  assert.equal(store.books.length, 1);
});

test('a refused write undoes the whole of a merge, books included', () => {
  fresh();
  store.addBook(newBook({ id: 'b0', title: 'Held already' }));
  const before = JSON.stringify(store.books);
  const other = ({
    app: 'resonate', version: 7,
    tags: [], places: [], routes: [], folios: [], correspondents: [],
    books: [{ id: 'b1', title: 'Arriving' }],
    settings: {},
  });
  storage.refuse = true;
  assert.equal(store.merge(other, { own: true }), null);
  storage.refuse = false;
  assert.equal(JSON.stringify(store.books), before, 'a refused merge left a book behind');
});

test('a book untitled is not a book, and the archive says so rather than losing it', () => {
  fresh();
  const file = ({
    app: 'resonate', version: 7,
    tags: [], places: [], routes: [], folios: [], correspondents: [],
    books: [{ id: 'b1', title: '   ' }],
    settings: {},
  });
  const out = store.restore(file);
  assert.equal(out.ok, false);
  assert.ok(out.lost.some(l => l.kind === 'book'), `a rejected book must be named: ${JSON.stringify(out.lost)}`);
});

test('the sample arrives with books, tied and untied, and none of them claims a reading', () => {
  const d = demoData();
  assert.ok(d.books.length >= 10, `a list of books is a list: ${d.books.length}`);
  const held = new Set(d.places.map(p => p.id));
  const tied = d.books.filter(b => b.placeId);
  assert.ok(tied.length >= 3, 'a book layer that is never tied to a place has not shown the tie works');
  assert.ok(d.books.length - tied.length >= 3, 'a book layer that is always tied has not shown a book may have no place');
  for (const b of tied) {
    assert.ok(held.has(b.placeId), `${b.title} names a place the sample does not carry`);
  }
  for (const b of d.books) {
    assert.equal(b.status, 'wishlist', `${b.title} claims a reading nobody did`);
    assert.ok(b.title.trim(), 'a book with no title');
    assert.ok(b.author.trim(), `${b.title} has no author`);
  }
});

test('every kind the comparison reports has a word in the restore panel', async () => {
  // compare() grew a kind and the panel's vocabulary did not, so a file
  // carrying two new books would have offered "2 new undefineds". The table
  // lives in a function and cannot be imported, so it is read where it is
  // written; what is bound is that it names every key compare() can emit.
  fresh();
  const seen = store.compare({
    app: 'resonate', version: 7,
    tags: [], places: [], routes: [], folios: [], correspondents: [], books: [],
    settings: {},
  });
  const src = await (await import('node:fs/promises')).readFile(
    new URL('../js/app.js', import.meta.url), 'utf8');
  const m = src.match(/const kindWord = \{([^}]*)\}/);
  assert.ok(m, 'the restore panel no longer has a kindWord table; rebind this test to its successor');
  const named = new Set([...m[1].matchAll(/(\w+):/g)].map(x => x[1]));
  for (const kind of Object.keys(seen.byKind)) {
    assert.ok(named.has(kind), `the comparison reports ${kind} and the panel has no word for it`);
  }
});
