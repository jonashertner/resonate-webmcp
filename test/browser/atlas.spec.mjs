// atlas.spec.mjs — the app, driven in a real browser.
//
// Every test here exists because something got through the node tests. A
// control a keyboard could not reach shipped. A word pushed off a narrow
// screen shipped. A shared place travelled to the host. None of those are
// visible to a parser.

import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';

// no test here may depend on a stranger's server being up, or on how fast it
// answers. tiles and the geocoder are cut, which is also the state a person on
// a train is in
const OFF = ['**://*.cartocdn.com/**', '**://*.openstreetmap.org/**', '**://tile.**',
  '**://photon.komoot.io/**'];

// The two hosts this app talks to are cut inside the page as well, and that is
// not belt and braces: `page.route` does not see a fetch made by a page under a
// service worker in webkit, and this app registers one on every visit. So the
// list above has been cutting tiles and letting nominatim through on one engine
// of the three for as long as it has existed, which means a third of the suite
// has been quietly asking a stranger's server real questions.
//
// Cutting it here instead answers on every engine, and it is also what makes a
// canned answer possible: `window.__canned[host]` is read at the moment of the
// call, so a test can set it after the page has loaded. Nothing else is
// touched: every other request, the app's own included, goes where it went.
const API_HOSTS = ['photon.komoot.io', 'nominatim.openstreetmap.org'];

async function cutTheWorld(page) {
  await page.addInitScript((hosts) => {
    const real = window.fetch.bind(window);
    window.__asked = [];
    window.__canned = {};
    window.fetch = (input, init) => {
      const href = typeof input === 'string' ? input : input?.url;
      let u = null;
      try { u = new URL(href, location.href); } catch { /* not a url we can read */ }
      if (!u || !hosts.includes(u.host)) return real(input, init);
      window.__asked.push(u.href);
      const canned = window.__canned[u.host];
      if (canned === undefined) return Promise.reject(new TypeError('the world is cut in these tests'));
      return Promise.resolve(new Response(canned, {
        status: 200, headers: { 'content-type': 'application/json' },
      }));
    };
  }, API_HOSTS);
}

// arrive with an atlas already standing, past the film and the first-run door.
//
// `atlas` hands over the records themselves instead of the generated three.
// It has to go in here, through the init script, rather than through the store
// afterwards: a test that opens a link navigates and reloads, the init script
// runs again on every one of those loads, and anything written to the store in
// between is wiped by it on the way back.
// `voices` plants correspondents beside the atlas. They are a separate key and
// a separate layer on the field, and the two only meet at an address both hold.
async function open(page, {
  places = 3, atlas = null, voices = null, tags: givenTags = null,
  books = 0, ways = 0, folios = 0,
} = {}) {
  // The film opens every visit now, and asking for stillness is the one thing
  // that stops it. These tests are about what comes after it, so they ask.
  // It is done here rather than in the config because `use: { reducedMotion }`
  // does not reach the page fixture's context in this version: a page opened
  // under it still reports matches=false, while emulateMedia and an explicit
  // newContext both work. Worth knowing before trusting that setting again.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const pattern of OFF) await page.route(pattern, r => r.abort());
  await cutTheWorld(page);
  await page.addInitScript(({ n, given, kept, suppliedTags, nBooks, nWays, nFolios }) => {
    const now = new Date().toISOString();
    const tags = suppliedTags || [{ id: 't1', name: 'Nature', hue: 155, color: '#4a7' }];
    if (kept) localStorage.setItem('resonate.correspondents.v1', JSON.stringify(kept));
    const places = given || Array.from({ length: n }, (_, i) => ({
      id: 'p' + i, name: 'Place ' + i, lat: 46 + i * 0.01, lng: 8 + i * 0.01,
      city: 'Basel', country: 'Switzerland', tags: ['t1'], status: 'visited',
      note: '', createdAt: now, updatedAt: now,
    }));
    localStorage.setItem('resonate.places.v1', JSON.stringify(places));
    localStorage.setItem('resonate.tags.v1', JSON.stringify(tags));
    // books and paths only ever asked for by count, because the one surface
    // that asks for them here is the tally, which says how many there are
    if (nBooks) localStorage.setItem('resonate.books.v1', JSON.stringify(
      Array.from({ length: nBooks }, (_, i) => ({
        id: 'b' + i, title: 'Book ' + i, author: 'A Writer',
        createdAt: now, updatedAt: now,
      }))));
    if (nWays) localStorage.setItem('resonate.routes.v1', JSON.stringify(
      Array.from({ length: nWays }, (_, i) => ({
        id: 'r' + i, name: 'A walk ' + i,
        path: [{ lat: 46, lng: 8 }, { lat: 46.01, lng: 8.01 }],
        createdAt: now, updatedAt: now,
      }))));
    // and folios, likewise only ever asked for by count
    if (nFolios) localStorage.setItem('resonate.folios.v1', JSON.stringify(
      Array.from({ length: nFolios }, (_, i) => ({
        id: 'f' + i, kind: 'letter', title: 'A folio ' + i, places: [],
        createdAt: now, updatedAt: now,
      }))));
    localStorage.setItem('resonate.settings.v1', JSON.stringify({
      theme: 'auto', chosen: true, seeded: true, introSeen: true,
      authorName: 'ada', hue: 300,
    }));
  }, {
    n: places, given: atlas, kept: voices, suppliedTags: givenTags,
    nBooks: books, nWays: ways, nFolios: folios,
  });
  await page.goto('/');
  await expect(page.locator('#threshold')).toBeHidden();
  // the film keeps enter, escape and space while it runs, as it should. a
  // person waits for it; so does this
  await expect(page.locator('#intro')).toBeHidden({ timeout: 15000 });
  // a returning visit opens on the index now. these tests were written from
  // the field, so the fixture closes the board and starts where they start;
  // the entry itself has a test of its own.
  //
  // The wait is on the boot's own word for where the visit came to rest, not
  // on a guess about how long a database takes to open. Closing a board that
  // had not finished rising left it up behind the test, and the next press
  // aimed at the index corner closed it instead of opening it: three engines,
  // a dozen tests, and every one of them only on a loaded machine.
  await expect(page.locator('body')).toHaveAttribute('data-entry', /board|field/, { timeout: 15000 });
  if (await page.locator('#indexOverlay').isVisible()) {
    await page.locator('#indexClose').click();
    await expect(page.locator('#indexOverlay')).toBeHidden();
  }
}

// is a worker active and holding this page? a share target that the worker
// does not control is served by the host instead, which is the whole failure.
// the first load can finish before the worker claims it, so the page is loaded
// again once and asked a second time. nothing here waits forever: a missing
// worker answers false rather than hanging the run out to its timeout
// Every press of the index corner in this file means one thing: have the
// board open. It is not the same as "press the corner once", because the
// corner is a door that swings both ways and the boot can open it first,
// and a test that presses it then is the person who closes a door they
// meant to walk through. So the intent is written down instead.
//
// One press, and then the assertion. This was briefly a retry loop, which
// made every one of these sites read "the board can be made to open within
// twenty seconds of repeated pressing": a corner that swallowed its first
// press passed the whole suite. The race it was written for is answered by
// the two things beside it, the boot's own data-entry word in open() and the
// guard below, and neither of those hides a defect.
async function showIndex(page) {
  if (await page.locator('#indexOverlay').isHidden()) await page.locator('#fmIndex').click();
  await expect(page.locator('#indexOverlay')).toBeVisible();
}

async function claimed(page) {
  const ask = () => page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false;
    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise(r => setTimeout(() => r(null), 10000)),
    ]);
    return !!(reg && reg.active && navigator.serviceWorker.controller);
  });
  if (await ask()) return true;
  await page.reload();
  await expect(page.locator('#intro')).toBeHidden({ timeout: 15000 });
  return ask();
}


// arrive(page, url): open a payload link the way a recipient does, as a fresh
// document. A goto that changes only the fragment is a same-document
// navigation, so every arrival here used to be goto-then-reload, the reload
// being what forced the boot that reads the link. That pair lost a release to
// firefox: playwright resolves a same-document goto on the content process's
// word, the parent process absorbs the new session-history entry a beat
// later, and a reload issued inside that beat is executed by the parent
// against the entry it still holds, which is the bare address the previous
// boot wrote after consuming its own link. On a loaded CI runner the beat is
// hundreds of milliseconds wide; on this machine it does not exist. The hop
// through about:blank makes the goto cross-document, so the one and only
// boot happens with the payload standing in the URL, and there is nothing
// left for a reload to race. What each arrival proves is still its caller's
// own claim; this only carries the visitor to the door.
async function arrive(page, url) {
  await page.goto('about:blank');
  await page.goto(url);
}

test('a place can be marked and kept with a keyboard alone', async ({ page }) => {
  await open(page);
  // no pointer is used past this line
  await page.keyboard.press('/');
  await page.locator('#paletteInput').fill('>mark');
  await expect(page.locator('.cmd-row').first()).toBeVisible();
  await page.keyboard.press('Enter');

  const form = page.locator('#addConfirm');
  await expect(form).toBeVisible();
  await expect(page.locator('#addConfirmInput')).toBeFocused();

  await page.keyboard.type('a bench with a view');
  await page.keyboard.press('Enter');

  await expect(form).toBeHidden();
  const kept = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('resonate.places.v1')).some(p => p.name === 'a bench with a view'));
  expect(kept).toBe(true);
});

test('the mark can be abandoned, and keeps nothing', async ({ page }) => {
  await open(page);
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('resonate.places.v1')).length);

  await page.keyboard.press('/');
  await page.locator('#paletteInput').fill('>mark');
  await expect(page.locator('.cmd-row').first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('#addConfirm')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#addConfirm')).toBeHidden();

  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('resonate.places.v1')).length);
  expect(after).toBe(before);
});

test('a nameless mark is never kept under a name nobody chose', async ({ page }) => {
  await open(page);
  await page.keyboard.press('/');
  await page.locator('#paletteInput').fill('>mark');
  await expect(page.locator('.cmd-row').first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('#addConfirmInput')).toBeFocused();

  // a name written and then taken back is still no name
  await page.locator('#addConfirmInput').fill('a thought');
  await page.locator('#addConfirmInput').fill('');
  await page.locator('#addConfirmGo').click();
  await expect(page.locator('#addConfirm')).toBeVisible();
  await expect(page.locator('#addConfirmStatus')).toContainText('give it a name');
});

// a test stood here that wrote a share straight into the inbox and then
// reloaded. it proved that a secret already on the device stays there, which
// was never the doubt. it could not have caught a worker that let the post
// through to the host, nor one that answered and then dropped the item on the
// floor. so the form a phone posts is posted here, by the browser, to the
// worker, and every claim below is about that one post.
//
// the app forbids form-action, and rightly: nothing in the app submits a form.
// a share sheet's post is not the app's form though. it is the browser's, made
// before any page of ours exists, and no page policy has a say in it. this one
// test stands where the share sheet stands, outside that rule.
test.describe('a place shared in from the phone', () => {
  test.use({ bypassCSP: true });

  test('is answered by the worker, kept on the device, and never put on the wire', async ({ page, request }) => {
    const secret = 'Kronenhalle-Ramistrasse-Zurich';
    const share = {
      title: secret,
      text: `a table by the window at ${secret}`,
      url: `https://www.google.com/maps/place/${secret}/@47.3686,8.5451,17z/data=!3d47.3686!4d8.5451`,
    };
    const outbound = [];
    // every attempt is recorded, including the ones the route table then cuts:
    // an address that was built is already a leak, whether or not it connected
    page.on('request', r => outbound.push(r.url()));

    // the host has no such door: asked directly, it says so. whatever answers
    // the post below is therefore not the host, and the app the browser lands
    // on is not what the host would have given back
    const knock = await request.post('/share-target', { multipart: { title: 'knock' } });
    expect(knock.status(), 'the host answered at the share target').toBe(404);

    await open(page);
    expect(await claimed(page), 'no service worker took control of the page').toBe(true);

    // the app lifts the share out of the inbox about a second after it opens,
    // so both the inbox and the address the browser landed on are read at
    // document start, before the app has had the chance to touch either
    await page.addInitScript(() => {
      window.__landed = location.href;
      window.__inbox = new Promise((resolve) => {
        let req;
        try { req = indexedDB.open('resonate-share', 1); } catch { return resolve([]); }
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('shared')) db.createObjectStore('shared', { autoIncrement: true });
        };
        req.onsuccess = () => {
          try {
            const tx = req.result.transaction('shared', 'readonly');
            const all = tx.objectStore('shared').getAll();
            tx.oncomplete = () => resolve(all.result || []);
            tx.onabort = tx.onerror = () => resolve([]);
          } catch { resolve([]); }
        };
        req.onerror = () => resolve([]);
      });
    });

    // the share sheet's own request: a multipart post at the address the
    // manifest names, carrying the three fields it names
    await page.evaluate((fields) => {
      const f = document.createElement('form');
      f.method = 'POST';
      f.action = 'share-target';
      f.enctype = 'multipart/form-data';
      for (const [name, value] of Object.entries(fields)) {
        const i = document.createElement('input');
        i.type = 'hidden'; i.name = name; i.value = value;
        f.appendChild(i);
      }
      document.body.appendChild(f);
      // submitted on the next turn, so this call returns before the page goes
      setTimeout(() => f.submit(), 0);
    }, share);

    // the place is offered, by name. the address it opened with carried
    // nothing to build this from, so it came off this device or not at all
    await expect(page.locator('#plate .plate-name')).toHaveText(secret);

    const landed = await page.evaluate(() => window.__landed);
    // one digit for whether anything is waiting, and not a word of the place
    expect(landed, 'the redirect carried something of the share').toBe(`${new URL(landed).origin}/?shared=1`);

    // and the item is really there, whole, not merely acknowledged
    const inbox = await page.evaluate(() => window.__inbox);
    expect(inbox, 'the worker answered but kept nothing').toHaveLength(1);
    expect(inbox[0]).toMatchObject({ ...share, shortened: false });

    // a fetch the worker makes on its own behalf is the one shape the browser
    // will not report to a test. the two claims above stand in for it: the
    // answer was the worker's, and the place is here rather than anywhere else
    const leaked = outbound.filter(u => u.includes('Kronenhalle'));
    expect(leaked, `the shared place appeared in: ${leaked.join(', ')}`).toHaveLength(0);
  });
});


test('a private archive comes home whole', async ({ page }) => {
  await open(page, { places: 1 });
  const restored = await page.evaluate(async () => {
    const { store } = await import('/js/store.js');
    store.load();
    const many = Array.from({ length: 501 }, (_, i) => ({
      id: 'big' + i, name: 'Big ' + i, lat: 46, lng: 8, tags: [],
    }));
    store.merge({ app: 'resonate', version: 4, places: many, tags: [] }, { own: true });
    return store.places.length;
  });
  expect(restored).toBeGreaterThanOrEqual(502);
});

test('a place marked as never leaving is in no file a stranger is given', async ({ page }) => {
  await open(page);
  const out = await page.evaluate(async () => {
    const { store } = await import('/js/store.js');
    store.load();
    store.updatePlace(store.places[0].id, { name: 'Known Sentinel Place' });
    store.addPlace({ ...store.places[0], id: 'secret', name: 'My Own Door' });
    store.updatePlace('secret', { private: true });
    return {
      handover: store.humanHandoverJSON(), assistant: store.assistantCopyJSON(),
      geo: store.exportGeoJSON(), kml: store.exportKML(),
      csv: store.exportCSV(), md: store.exportMarkdown(),
    };
  });
  for (const [format, text] of Object.entries(out)) {
    expect(text.includes('My Own Door'), `${format} carried the private place`).toBe(false);
    // the sibling test below has carried this guard since the day a format
    // that exported nothing at all would have satisfied the line above it.
    // this one did not, and an empty export is exactly what a refactor of the
    // export names would have produced
    expect(text.includes('Known Sentinel Place'),
      `${format} carried nothing at all, so it proved nothing`).toBe(true);
  }
});

// the same word, on the other kind of record. it shipped honoured on places
// and ignored on ways in two of the five formats, which is the worst version
// of a promise: kept where it is looked for and broken where it is not
test('a path marked as never leaving is in no file a stranger is given', async ({ page }) => {
  await open(page);
  const found = await page.evaluate(async () => {
    const { store, newRoute } = await import('/js/store.js');
    store.load();
    const path = Array.from({ length: 12 }, (_, i) => ({ lat: 46 + i * 0.002, lng: 8 + i * 0.002 }));
    store.addRoute(newRoute({ id: 'w1', name: 'The Way Home', path, private: true }));
    store.addRoute(newRoute({ id: 'w2', name: 'A Way To Offer', path }));
    const out = {
      handover: store.humanHandoverJSON(), assistant: store.assistantCopyJSON(), kml: store.exportKML(),
      md: store.exportMarkdown(), geo: store.exportGeoJSON(), csv: store.exportCSV(),
    };
    return Object.fromEntries(Object.entries(out).map(([k, t]) =>
      [k, { secret: t.includes('The Way Home'), offered: t.includes('A Way To Offer') }]));
  });
  for (const [format, saw] of Object.entries(found)) {
    expect(saw.secret, `${format} carried the private way`).toBe(false);
  }
  // and the ones that carry ways at all still carry the offered one, or the
  // test would pass by exporting nothing
  expect(found.handover.offered).toBe(true);
  expect(found.assistant.offered).toBe(true);
  expect(found.kml.offered).toBe(true);
  expect(found.md.offered).toBe(true);
});

test('every surface can be left by keyboard', async ({ page }) => {
  await open(page);
  // the three words the board settled on; a fourth here means the nav grew
  for (const go of ['folio', 'contacts', 'you']) {
    await showIndex(page);
    await page.locator(`[data-go="${go}"]`).click();
    const poster = page.locator('.poster:not([hidden])');
    await expect(poster).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(poster).toBeHidden();
    // the index stands beneath, which is the point: reading one thing does
    // not cost you the others
    await expect(page.locator('#indexOverlay')).toBeVisible();
  }

  // And the three rooms that opened off the board until 2026-08-19 and open off
  // `you` now. This walk used to be the board's own words, so `club` and `how`
  // were covered by standing on it and stopped being covered the day they came
  // off; they did not stop being surfaces. A room two deep is the one a person
  // is likeliest to be stuck in, because the escape has two jobs there: leave
  // this room, and leave the one it was opened from, in that order.
  await showIndex(page);
  await expect(page.locator('#sortWord')).toHaveAttribute(
    'aria-label', 'Arrange: newest. Press to cycle.');
  await page.locator('[data-go="you"]').click();
  const release = await page.locator('meta[name="resonate-release"]').getAttribute('content');
  await expect(page.locator('#settingsBody')).toContainText(`release ${release}`);
  await page.locator('#deviceSettings > summary').click();
  await expect(page.locator('#installWord')).toBeVisible();
  await expect(page.locator('#deviceState')).not.toBeEmpty();
  for (const [word, room] of [
    ['#clubWord', '#clubOverlay'],
    ['#censusWord', '#statsOverlay'],
    ['#howWord', '#howOverlay'],
  ]) {
    await page.locator(word).click();
    await expect(page.locator(room)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator(room)).toBeHidden();
    await expect(page.locator('#settingsOverlay'),
      `leaving ${room} took the room it was opened from with it`).toBeVisible();
  }
  await page.keyboard.press('Escape');
  await expect(page.locator('#settingsOverlay')).toBeHidden();
  await expect(page.locator('#indexOverlay')).toBeVisible();
});

// A jpeg holding nothing but an Exif segment with a GPS fix in it: 46°30′N,
// 8°15′E. Written out byte by byte because the whole point of the test is what
// the app reads out of the bytes a camera writes, and a canvas writes none of
// them. Big endian, one IFD, one GPS IFD, six rationals.
function jpegWithFix() {
  const out = [];
  const u16 = n => out.push((n >> 8) & 0xff, n & 0xff);
  const u32 = n => out.push((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
  const rational = (num, den) => { u32(num); u32(den); };

  u16(0xFFD8);                              // start of image
  u16(0xFFE1); u16(136);                    // one APP1 segment, and its length
  out.push(0x45, 0x78, 0x69, 0x66, 0, 0);   // "Exif", then the tiff header

  u16(0x4D4D); u16(42); u32(8);             // big endian, and IFD0 eight bytes in
  u16(1);                                   // IFD0: one entry
  u16(0x8825); u16(4); u32(1); u32(26);     // which points at the GPS IFD
  u32(0);                                   // and no IFD after it

  u16(4);                                   // the GPS IFD: four entries
  u16(1); u16(2); u32(2); out.push(0x4E, 0, 0, 0);  // north
  u16(2); u16(5); u32(3); u32(80);                  // latitude, in three parts
  u16(3); u16(2); u32(2); out.push(0x45, 0, 0, 0);  // east
  u16(4); u16(5); u32(3); u32(104);                 // longitude, in three parts
  u32(0);

  rational(46, 1); rational(30, 1); rational(0, 1);
  rational(8, 1); rational(15, 1); rational(0, 1);
  return Buffer.from(out);
}

// The one thing a photograph is still good for here, and the whole of what
// Resonate now wants from one. A picture knows where it was taken and a person
// often does not, so the fix is read out of the file and the file is let go in
// the same breath.
//
// Only a browser can prove the second half of that. "Kept nowhere" means the
// record does not carry the picture and the photograph store is still empty
// afterwards, and there is no photograph store outside a browser.
test('a photograph hands over where it was taken, and is kept nowhere', async ({ page }) => {
  await open(page);

  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('/');
  await page.locator('#paletteInput').fill('>photo');
  await expect(page.locator('.cmd-row').first()).toBeVisible();
  await page.keyboard.press('Enter');
  await (await chooser).setFiles({
    name: 'a-morning.jpg', mimeType: 'image/jpeg', buffer: jpegWithFix(),
  });

  await expect(page.locator('#toast')).toContainText('kept by its own fix', { timeout: 10000 });

  // openstreetmap is cut in these tests, which is the state a person on a train
  // is in. The keep never waits for a name, so the place stands under its own
  // coordinates until the world answers, and here the world never does.
  const kept = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('resonate.places.v1')).find(p => Math.abs(p.lat - 46.5) < 1e-9));
  expect(kept, 'the photograph knew where it was and no place was made').toBeTruthy();
  expect(kept.lng).toBeCloseTo(8.25, 9);
  expect(kept.name, 'the place is named after a thing that is not there').toBe('46°30′N · 8°15′E');
  expect(JSON.stringify(kept).includes('data:image/'), 'the picture went into the record').toBe(false);

  const held = await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const photos = await import(`/js/photos.js${v}`);
    return photos.photographCount();
  });
  expect(held, 'the picture was kept after all').toBe(0);

  // the plate opened on it, and has nowhere left to put a picture
  await expect(page.locator('#plate')).toBeVisible();
  await expect(page.locator('#pPhotos')).toHaveCount(0);
  await expect(page.locator('#pAddPhoto')).toHaveCount(0);
});

// The same rescue, reached the way the documents describe it. The how page
// says to drop one on the field, the readme says the same, and the field
// itself says "drop the photo. the field will place it". The picker above
// exercises addFromPhoto; this exercises the gesture that promise names, and
// the handler behind it, which looks for a gpx before it looks for an image
// and is the only thing holding that order down.
//
// The drop is dispatched rather than dragged, because a drag from outside the
// browser is not a thing a page can be made to perform. All the handler reads
// is dataTransfer.files, so that is what it is handed, on an event all three
// engines deliver. The dragenter before it is not decoration: the field's
// announcement is put up by one handler and taken down by the other, and a
// field left saying it is ready to take a drop it has already taken is the
// failure this shape catches.
test('a photograph dropped on the field places it, and the picture is kept nowhere', async ({ page }) => {
  await open(page);

  const announced = await page.evaluate((bytes) => {
    window.dispatchEvent(new Event('dragenter', { bubbles: true, cancelable: true }));
    const said = document.body.classList.contains('dropping');
    const file = new File([new Uint8Array(bytes)], 'a-morning.jpg', { type: 'image/jpeg' });
    const ev = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', { value: { files: [file] } });
    window.dispatchEvent(ev);
    return said;
  }, [...jpegWithFix()]);
  expect(announced, 'the field never said it was ready to take the drop').toBe(true);

  await expect(page.locator('#toast')).toContainText('kept by its own fix', { timeout: 10000 });
  await expect(page.locator('body')).not.toHaveClass(/dropping/);

  const kept = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('resonate.places.v1')).find(p => Math.abs(p.lat - 46.5) < 1e-9));
  expect(kept, 'the drop was taken and no place was made').toBeTruthy();
  expect(kept.lng).toBeCloseTo(8.25, 9);
  expect('photos' in kept, 'the record grew a field for a thing nothing holds').toBe(false);
  expect(JSON.stringify(kept).includes('data:image/'), 'the picture went into the record').toBe(false);

  const held = await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const photos = await import(`/js/photos.js${v}`);
    return photos.photographCount();
  });
  expect(held, 'the picture was kept after all').toBe(0);
});

// The app's own print word is the exit that used to carry photographs, and the
// sheet it builds is the last place any code could still reach for one. The
// spare sheet a browser prints unasked skips that whole branch, so it is this
// path or nothing: a call to a function that has been deleted parses cleanly
// and passes every node test.
test('the print word asks once, and sets a page with no figure on it', async ({ page }) => {
  await open(page);

  const out = await page.evaluate(async () => {
    // print() is stubbed so nothing opens a dialog, and so the page can be
    // read at the moment it would have been printed
    let built = null;
    const real = window.print;
    window.print = () => { built = document.querySelector('#sheet').innerHTML; };

    document.querySelector('#fmCommand').click();
    const input = document.querySelector('#paletteInput');
    input.value = '>print';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 300));
    document.querySelector('.cmd-row')?.click();

    await new Promise(r => setTimeout(r, 500));
    const asked = document.querySelector('#askWhat')?.textContent || '';
    const word = document.querySelector('#askGo')?.textContent || '';
    const third = document.querySelector('#askAlso')?.hidden === false;
    document.querySelector('#askGo')?.click();

    await new Promise(r => setTimeout(r, 800));
    window.print = real;
    return { asked, word, third, built };
  });

  expect(out.asked, 'the sheet reached the dialog without saying what it carries')
    .toMatch(/This sheet carries/);
  expect(out.asked, 'the question still offers a thing this app does not keep')
    .not.toMatch(/photograph/i);
  expect(out.word).toBe('print it');
  expect(out.third, 'a third word for a question with two answers').toBe(false);
  expect(out.built, 'print was never reached').toBeTruthy();
  expect(out.built, 'the page was set with no entries on it').toContain('sh-entry');
  expect(out.built.includes('sh-fig'), 'a figure was set on the page').toBe(false);
});

// The evening opens once, and a device that has asked for less movement does
// not get it even then. Returning work goes directly to the atlas.
//
// Four tests stood here and three of them were about a film: a frozen first
// frame, a fade outlasting the last one, and a `has-video` swap that only two
// engines of three could ever reach. Playwright's chromium carries no h264
// decoder, so one of the three announced in its own message that it was
// skipping on two engines of three, every night. None of those failures is
// reachable now: the evening is drawn, so there is no first frame to freeze
// and no last frame to run out from under the fade.
//
// What replaces them is the claim those three were circling and none of them
// made: that what a person sees is moving. It is read off the canvas itself,
// which is the only place the answer actually is, and it is made on every
// engine.
test.describe('the evening', () => {
  const seed = async (page) => {
    await page.addInitScript(() => {
      const now = new Date().toISOString();
      localStorage.setItem('resonate.places.v1', JSON.stringify([{
        id: 'p0', name: 'Place 0', lat: 46, lng: 8, tags: [], status: 'visited',
        note: '', createdAt: now, updatedAt: now,
      }]));
      // a person who has been here before: this used to be what skipped it
      localStorage.setItem('resonate.settings.v1', JSON.stringify({
        chosen: true, seeded: true, introSeen: true, authorName: 'ada',
      }));
    });
  };

  // The evening is watched from inside the page, from before it starts, and
  // the one claim still asked of counted frames is stillness: a person who
  // asked for less movement gets no frame with paint on it. That count cannot
  // be starved into a lie, because a runner too slow to grant frames draws
  // nothing either, and zero agrees with zero.
  //
  // Every movement claim used to live here too, and each retelling of this
  // instrument was the same lesson at a smaller scale. It first read the
  // canvas over the wire, twice, and measured its own latency. Rewritten onto
  // the page's own frames, it rescaled four million pixels inside the loop it
  // was measuring. Rewritten again onto eight scanlines, cheap enough to be
  // honest, its new counter came back from CI with the whole truth: webkit on
  // a loaded runner granted the entire 0.95-second evening two animation
  // frames, one of them with paint. No instrument, however cheap, counts to
  // two on a machine that granted one. A frame rate is the runner's to give;
  // that the drawing is a function of time is ours to promise, and the
  // movement claims are asked of exactly that, under the driven clock below.
  const watchTheEvening = async (page) => {
    await page.addInitScript(() => {
      const st = window.__evening = { seen: 0, w: 0, h: 0 };
      let frames = 0;
      const tick = () => {
        if (++frames > 600) return;
        const c = document.querySelector('#introCanvas');
        if (c) {
          st.w = c.width; st.h = c.height;
          // 300x150 is a canvas nobody has sized. And a sized canvas is not
          // yet a painted one: `fit` clears the bitmap, so one transparent
          // pixel of ground says no frame has landed, opaquely painted ground
          // says one has.
          if ((c.width !== 300 || c.height !== 150)
            && c.getContext('2d').getImageData(0, 0, 1, 1).data[3] !== 0) st.seen++;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  };

  // The clock the movement test drives. Installed before boot: rAF callbacks
  // queue instead of firing, performance.now is pinned to the same origin the
  // fed instants use, and __tick(ms) plays the queue at a chosen moment, so a
  // frame happens exactly when the test says one does and the runner's own
  // pace stops being part of the claim. Timers of 300ms and over are dropped,
  // which takes the cutoff (950ms on a brief visit), the fade cleanup (600ms)
  // and the font cap (400ms) out of the way of the ticks; everything the boot
  // wants under 300ms still runs.
  const drivenEvening = async (page) => {
    await page.addInitScript(() => {
      const BASE = 5000;
      // cancelAnimationFrame keeps its real meaning over the queue. As a
      // no-op, an evening that cancelled its own draw loop at the dissolve
      // still ticked here, and the planted version of exactly that defect
      // passed: the stub was quietly deciding the claim. Dropped timers
      // return 0, never a counterfeit id a native clearTimeout could kill.
      const queue = [];
      let rafId = 0;
      performance.now = () => BASE;
      window.requestAnimationFrame = (cb) => { queue.push({ id: ++rafId, cb }); return rafId; };
      window.cancelAnimationFrame = (id) => {
        const i = queue.findIndex(q => q.id === id);
        if (i >= 0) queue.splice(i, 1);
      };
      const real = window.setTimeout.bind(window);
      window.setTimeout = (fn, d, ...a) => (d >= 300 ? 0 : real(fn, d, ...a));
      window.__tick = (ms) => {
        for (const q of queue.splice(0, queue.length)) q.cb(BASE + ms);
      };
    });
  };

  test('a device asking for less movement gets none of it, and draws none of it', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await seed(page);
    await watchTheEvening(page);
    // The scene begins before the window load event. Waiting for every asset
    // can outlast the whole brief scene on a starved runner, so observe it as
    // soon as the document and its blocking styles/scripts are ready.
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#intro')).toBeHidden();
    // Not merely hidden. The canvas is sized by the first line of the scene
    // and by nothing else, so a canvas still at its default 300x150 is proof
    // that no frame was ever asked for, rather than proof that the overlay
    // was put away afterwards.
    await page.waitForTimeout(1200);
    const still = await page.evaluate(() => ({
      ...window.__evening, shown: !document.querySelector('#intro').hidden,
    }));
    expect(still.shown, 'the evening opened for someone who asked for stillness').toBe(false);
    expect(`${still.w}x${still.h}`,
      'the scene sized its canvas for a person who asked for stillness').toBe('300x150');
    expect(still.seen,
      'a frame was drawn for a person who asked for stillness').toBe(0);
  });

  // What real time is still asked for, and the whole of it: a first encounter
  // gets the evening, it goes by itself, and a reload does not replay it. Nothing here counts
  // frames. The sized canvas proves the scene started; whether it moved is the
  // driven test below, where the clock is this suite's own.
  test('a first encounter gets it', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await seed(page);
    await page.addInitScript(() => {
      const s = JSON.parse(localStorage.getItem('resonate.settings.v1') || '{}');
      s.introSeen = false;
      localStorage.setItem('resonate.settings.v1', JSON.stringify(s));
    });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#intro')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#intro')).toBeHidden({ timeout: 15000 });
    const size = await page.evaluate(() => {
      const c = document.querySelector('#introCanvas');
      return `${c.width}x${c.height}`;
    });
    expect(size,
      'the canvas was never sized, so nothing was ever drawn on it').not.toBe('300x150');
  });

  // The evening, at instants this test chooses. t0 is pinned, every frame is
  // played by hand, and the eight-scanline signature is read in the same
  // breath as the tick that drew it, so there is nothing here a slow machine
  // can starve: the claim is that the drawing is a different picture at
  // different moments of its own score, which is what "it moves" has meant
  // all along. 60, 380 and 700 milliseconds are early, middle and late in the
  // 950ms a returning visit gets; the press then opens the dissolve, and two
  // instants inside it must still differ, because the fade opening over
  // something still moving is the one thing the film this scene replaced
  // could never do.
  test('driven by its own clock, the evening is a different picture at every instant', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await seed(page);
    await page.addInitScript(() => {
      const s = JSON.parse(localStorage.getItem('resonate.settings.v1') || '{}');
      s.introSeen = false;
      localStorage.setItem('resonate.settings.v1', JSON.stringify(s));
    });
    await drivenEvening(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#intro')).toBeVisible({ timeout: 5000 });
    const at = (ms) => page.evaluate((w) => {
      window.__tick(w);
      const c = document.querySelector('#introCanvas');
      const cx = c.getContext('2d');
      let a = 1, b = 0, painted = 0;
      for (let k = 1; k <= 8; k++) {
        const row = cx.getImageData(0, Math.floor(c.height * k / 9), c.width, 1).data;
        painted = Math.max(painted, row[3]);
        for (let i = 0; i < row.length; i += 4) { a = (a + row[i]) % 65521; b = (b + a) % 65521; }
      }
      const el = document.querySelector('#intro');
      return { sig: b * 65536 + a, painted,
               dissolving: !el.hidden && el.classList.contains('dissolve') };
    }, ms);
    const one = await at(60), two = await at(380), three = await at(700);
    expect(one.painted, 'the first instant drew nothing at all').toBeGreaterThan(0);
    expect(new Set([one.sig, two.sig, three.sig]).size,
      'two instants of the evening were the same picture').toBe(3);
    await page.evaluate(() => document.querySelector('#intro').click());
    const four = await at(720), five = await at(900);
    expect(four.dissolving, 'the press did not open the dissolve').toBe(true);
    expect(five.sig, 'the dissolve went out over a still picture').not.toBe(four.sig);
  });

  // The fade used to be a constant and the hold used to have a floor, and the
  // two together outlasted the film at every length it was ever cut to. What
  // that looked like was the last frame standing still at falling opacity for
  // the better part of a second. A drawn evening has no last frame, and the
  // promise that the dissolve opens over something still moving is now made
  // under the driven clock above, where no runner can starve it.
  //
  // What real time still owes is the dissolve itself: an evening that ends by
  // its own cutoff must pass through it rather than jump to hidden. Polled
  // from the test process at a fixed beat, because a poll over the protocol
  // needs no page frames, and the window is wide in the favourable direction:
  // the fade is 1.4 seconds on a first visit, and the timer that would close
  // it lives on the same starved main thread the poll does not.
  test('the evening ends through its dissolve, not past it', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await seed(page);
    // A first visit rather than a returning one, so the fade is the full 1.4
    // seconds rather than 0.6.
    await page.addInitScript(() => {
      const s = JSON.parse(localStorage.getItem('resonate.settings.v1') || '{}');
      s.introSeen = false;
      localStorage.setItem('resonate.settings.v1', JSON.stringify(s));
    });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#intro')).toBeVisible({ timeout: 5000 });
    await expect.poll(() => page.evaluate(() => {
      const el = document.querySelector('#intro');
      return !el.hidden && el.classList.contains('dissolve');
    }), { message: 'the evening ended without its dissolve',
          intervals: [120], timeout: 10000 }).toBe(true);
    await expect(page.locator('#intro')).toBeHidden({ timeout: 15000 });
  });

  // The name used to fade out with the canvas, on the claim that it was landing
  // exactly where the field's own wordmark stands, so the letters would appear
  // to change colour rather than to vanish. A first visit does not arrive at
  // the field. It arrives at the threshold, whose heading is set left at the
  // top of the page with four doors down the side of it, and RESONATE at a
  // hundred and thirty two points spent the better part of a second fading out
  // across the middle of all of them. At the field it did not line up either:
  // the field's mark is a box holding the word, a tally and a hint, so centring
  // that box puts the word about a third of a cap height higher.
  //
  // This used to sample computed opacity on the page's own frames, which put a
  // runner's frame rate inside the claim. animationend is the engine's own
  // word for the withdrawal having finished, and it arrives however few frames
  // the runner grants. The margin runs the right way: the name leaves in four
  // tenths of the fade and the overlay is put away by a main-thread timer at
  // the whole of it, so a starved machine delays the hiding more than the
  // leaving. Which rules make it leave is evening.test.mjs's question; this is
  // only whether, on a real screen, it was gone while the evening still stood.
  //
  // The withdrawal is asked for by its keyframes name because the mechanism is
  // part of the claim. It was a transition first, and the first run of this
  // very listener showed webkit fading the name while chromium and firefox cut
  // it in one frame: an engine will not start a transition on a property a
  // filling animation owns. As mark-out, all three engines fade it, and all
  // three say so with the same event.
  test('the name is gone before the room underneath can be read', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.addInitScript(() => {
      const st = window.__mark = { left: false, introUpWhenLeft: false };
      document.addEventListener('animationend', (e) => {
        if (e.animationName !== 'mark-out') return;
        const el = document.querySelector('#intro');
        st.left = true;
        st.introUpWhenLeft = !!el && !el.hidden && el.classList.contains('dissolve');
      }, true);
    });
    await page.goto('/', { waitUntil: 'domcontentloaded' }); // first visit, full fade
    await expect(page.locator('#intro')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#threshold')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#intro')).toBeHidden({ timeout: 15000 });
    const m = await page.evaluate(() => window.__mark);
    expect(m.left,
      'the name never finished leaving: mark-out never ran to its end').toBe(true);
    expect(m.introUpWhenLeft,
      'the name was still on the screen when the dissolve put the evening away').toBe(true);
  });
});

// ---------- what only a browser can be asked ----------

// A brand new visitor whose device asks for less movement used to meet an
// empty field with a wordmark on it and no way in. runIntro calls back
// synchronously when it decides not to play, and the threshold opener was
// still an empty function at that moment: nothing threw, nothing opened, and
// because `chosen` never became true it happened again on every visit. The
// suite could not see it because every reduced-motion test seeded an atlas.
test('a first visit under reduced motion still opens the door', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const pattern of OFF) await page.route(pattern, r => r.abort());
  await page.goto('/');            // nothing seeded: this is someone's first minute
  await expect(page.locator('#threshold')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('#thFull')).toBeVisible();
  await expect(page.locator('#thEmpty')).toBeVisible();
});

// A first visit used to spend the left third of a desk on everything it had to
// say and leave the rest entirely blank. The readable measure was right; the
// composition was not. On a desk, words and decisions now have separate
// addresses. On a smaller glass they return to the one-column conversation a
// thumb can follow.
test('the wide threshold gives its decisions a second field', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const pattern of OFF) await page.route(pattern, r => r.abort());
  await page.goto('/');
  await expect(page.locator('#threshold')).toBeVisible({ timeout: 5000 });

  const measure = () => page.evaluate(() => {
    const box = sel => {
      const r = document.querySelector(sel).getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    };
    return { width: innerWidth, words: box('#thWhat'), choices: box('.th-go') };
  });
  const desk = await measure();
  expect(desk.words.left, 'the opening abandoned its title leaf').toBeLessThan(desk.width * 0.15);
  expect(desk.choices.left, 'the decisions never reached the second field')
    .toBeGreaterThan(desk.width * 0.5);
  expect(desk.choices.left, 'the decision column collided with the opening words')
    .toBeGreaterThan(desk.words.right);

  await page.setViewportSize({ width: 1000, height: 900 });
  const tablet = await measure();
  expect(Math.abs(tablet.choices.left - tablet.words.left),
    'the tablet kept the split desktop composition').toBeLessThan(2);
});

// A member's phone goes into a lake. They buy another, open resonate, and meet
// a screen asking how they would like to start, which is a question they
// answered a year ago on the phone in the lake. The atlas they pay to have kept
// is behind that screen and two rooms deeper, and until 2026-08-19 nothing on
// the screen said so: they had to pretend to begin in order to come back.
//
// There is no login here to test, because there is no account. What a member
// holds is a key and a phrase, so the whole of `logged in` is one field, and
// the word has to arrive at that field rather than merely at the room holding
// it. Arriving at the room and leaving them to find it is the same walk with
// one press taken off.
test('a member on a new device is one press from the field their key goes in', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const pattern of OFF) await page.route(pattern, r => r.abort());
  await page.goto('/');            // nothing seeded: a new phone, an old membership
  await expect(page.locator('#threshold')).toBeVisible({ timeout: 5000 });
  await page.locator('#thMember').click();

  await expect(page.locator('#threshold')).toBeHidden();
  await expect(page.locator('#clubOverlay')).toBeVisible();
  await expect(page.locator('#clubKeyIn'),
    'the door arrived at the room and left the person to find the field').toBeFocused();

  // and the atlas behind it is a working one: a restore that never arrives
  // still has to leave somewhere to keep places
  const tags = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('resonate.tags.v1') || '[]').length);
  expect(tags, 'the vocabulary did not come through the door').toBeGreaterThan(0);
});

test('a first visit that can see the film opens the same door after it', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  for (const pattern of OFF) await page.route(pattern, r => r.abort());
  await page.goto('/');
  await expect(page.locator('#threshold')).toBeVisible({ timeout: 15000 });
});

// A test stood here asking that a device wanting less movement never fetched
// assets/intro.mp4. The parser used to fetch it before any script had read the
// motion preference, and taking the source away afterwards cancelled nothing.
// The file is gone and so is every other byte the evening ever needed, so the
// claim has no subject: there is nothing on the network to not ask for. What
// survives of it is in `the evening` above, where a device asking for less
// movement is shown to have paid no frames either.

// The how page says the newsstand list is fetched only when the stand is
// opened. Boot used to fetch it anyway, so every cold load of a private atlas
// reached a github address before the person had asked for anything public.
test('a private atlas reaches no commons until something public is asked for', async ({ page }) => {
  const reached = [];
  page.on('request', r => { if (r.url().includes('resonate-commons')) reached.push(r.url()); });
  await open(page);
  await page.waitForTimeout(2000);
  expect(reached, `the commons was contacted unasked: ${reached.join(', ')}`).toHaveLength(0);
});

// A person arriving on a link came for the sender. The film was playing over
// the top of the folio they had been handed.
//
// The device that would be shown a film has to be the device that arrives, and
// for a long time it was not: this asked for no-preference on its first line
// and then called `open`, whose own first line asks for stillness. Under
// stillness there is never a film, so the assertion could not fail however
// broken the app was. The stillness stays for the scaffolding, because it is
// only here to build a link, and is handed back before the arrival that this
// test is actually about.
test('an arriving folio is not covered by the evening', async ({ page }) => {
  await open(page);
  const url = await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const { store } = await import(`/js/store.js${v}`);
    const { makeShareUrl } = await import(`/js/share.js${v}`);
    store.load();
    return makeShareUrl([], store.places.slice(0, 2), 'ada', []);
  });
  // Whether the overlay is up is the wrong question, and asking it is how this
  // test stayed green through anything: the film ends by itself, so a check
  // that polls until the overlay is down is satisfied seven seconds later by
  // an app that laid the whole evening over the sender. What has to be true is
  // that it was never raised at all, so the visit is watched from before its
  // first script runs and asked afterwards.
  await page.addInitScript(() => {
    window.__filmShown = false;
    new MutationObserver(() => {
      const el = document.getElementById('intro');
      if (el && !el.hidden) window.__filmShown = true;
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden'] });
  });
  // a hash-only navigation does not run boot again, and boot is what reads
  // the link. this is the arrival a recipient actually makes, and it is made
  // by a device that is perfectly willing to be shown a film.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await arrive(page, url);
  // the sender's folio is what this visit is for, and it is not behind a film
  // Twenty, not eight, for the reason given in full at the folio helper: eight
  // is tighter than this suite's own default of ten and says nothing about why,
  // and the claim is that the link opens the report rather than that a loaded
  // runner boots an app and parses a payload inside eight seconds. That fix
  // landed on 17 August 2026 on the one site that had failed, and these three
  // were the same shape and were not swept. Two days later the first of them
  // went red in firefox on CI, which is what a fix applied only where it hurt
  // buys you.
  await expect(page.locator('#reportOverlay')).toBeVisible({ timeout: 20000 });
  expect(await page.evaluate(() => window.__filmShown),
    'the film was laid over the sender').toBe(false);
});

// The browser's own Print command cannot be asked anything, so it gets the
// spare sheet. The first version of that sheet stripped a place's note and its
// coordinates, and left every path untouched: distance, climb, hours, the
// note, and the ground drawn as a section. A walk from a door is a routine,
// and its shape is the most personal line in an atlas. The earlier check used
// only places, which is exactly why it missed this.
test('the sheet a browser prints unasked carries names and cities, nothing else', async ({ page }) => {
  await open(page);
  const sheet = await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const { store, newPlace, newRoute } = await import(`/js/store.js${v}`);
    store.load();
    const line = Array.from({ length: 30 }, (_, i) => ({ lat: 46 + i * 0.004, lng: 8, ele: 900 + i }));

    store.addPlace(newPlace({ id: 'shown', name: 'A Public Place', city: 'Basel', lat: 47, lng: 7,
      note: 'PLACENOTE', tags: [] }));
    store.addPlace(newPlace({ id: 'hidden', name: 'My Own Front Door', lat: 47.1, lng: 7.1, private: true }));
    store.addPlace(newPlace({ id: 'lent', name: 'A Loaned Place', lat: 47.2, lng: 7.2, sample: true }));
    store.addRoute(newRoute({ id: 'w1', name: 'A Public Path', city: 'Basel', path: line,
      note: 'PATHNOTE', km: 13.4, ascent: 812, hours: 4.2 }));
    store.addRoute(newRoute({ id: 'w2', name: 'The Way Home', path: line, private: true }));
    store.addRoute(newRoute({ id: 'w3', name: 'A Loaned Path', path: line, sample: true }));

    document.querySelector('#sheet').innerHTML = '';
    window.dispatchEvent(new Event('beforeprint'));
    await new Promise(r => setTimeout(r, 300));
    const html = document.querySelector('#sheet').innerHTML;
    document.querySelector('#sheet').innerHTML = '';
    return html;
  });

  // what a person marked as staying, stays
  for (const secret of ['My Own Front Door', 'The Way Home']) {
    expect(sheet.includes(secret), `${secret} was printed unasked`).toBe(false);
  }
  // the sample is real and prints with everything else
  for (const real of ['A Loaned Place', 'A Loaned Path']) {
    expect(sheet.includes(real), `${real} was still held off the spare sheet`).toBe(true);
  }
  // what travels, travels: a name and a city
  expect(sheet).toContain('A Public Place');
  expect(sheet).toContain('A Public Path');
  expect(sheet).toContain('Basel');
  // and nothing beyond that
  for (const [what, needle] of [['a note', 'PLACENOTE'], ['a path note', 'PATHNOTE'],
    ['a distance', '13.4'], ['a climb', '812'], ['coordinates', 'sh-coords'],
    ['an elevation profile', 'sh-profile']]) {
    expect(sheet.includes(needle), `${what} reached a sheet nobody reviewed`).toBe(false);
  }
});

// ---------- the documents, set as pages ----------

test('a document is set in the app type, and names the tab itself', async ({ page }) => {
  // The specification used to be linked as a file. A browser handed most
  // people a download or a wall of unset text, so the sentence "none of this
  // asks to be believed" ended at a link nobody pressed.
  const failed = [];
  page.on('requestfailed', (r) => failed.push(r.url()));
  await page.goto('/read.html?d=spec');

  await expect(page.locator('.read-body h1')).toBeVisible();
  await expect(page).toHaveTitle(/· Resonate$/);

  // the byte tables a specification lives by must survive as code, unreflowed
  const pres = page.locator('.read-body pre');
  expect(await pres.count()).toBeGreaterThan(0);
  await expect(pres.first()).toContainText('rsnt2');

  // a storage shape quoted in prose is four characters, not an unclosed tag.
  // the shapes moved when the vault moved off KV; these are the ones there are
  // now, and both carry the angle brackets that are the whole hazard.
  const html = await page.locator('.read-body').innerHTML();
  expect(html).toContain('<code>member:&lt;key&gt;</code>');
  expect(html).toContain('&lt;forty-eight lowercase hex characters&gt;');
  expect(/<key>/.test(html), 'a quoted shape became a tag').toBe(false);

  // and the page reads on a phone without the reader chasing it sideways
  await page.setViewportSize({ width: 375, height: 812 });
  const sideways = await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(sideways, 'the page scrolls sideways on a narrow screen').toBe(false);

  expect(failed, 'a document page asked for something it could not get').toEqual([]);
});

test('an address that names no document asks for nothing at all', async ({ page }) => {
  // The name in the address bar is never a path. Without the own-property
  // guard, ?d=constructor would have sent the page fetching the string
  // "function Object() { [native code] }".
  for (const slug of ['../SECURITY.md', 'constructor', '__proto__', 'toString', '']) {
    const asked = [];
    page.on('request', (r) => asked.push(r.url()));
    await page.goto(`/read.html?d=${encodeURIComponent(slug)}`);
    await expect(page.locator('.read-body')).toContainText('Nothing here');
    // the page's own address carries the slug, so ask the path and not the url:
    // read.html?d=..%2FSECURITY.md ends in .md and is simply the navigation
    const reached = asked.filter((u) => {
      try { return new URL(u).pathname.endsWith('.md'); } catch { return false; }
    });
    expect(reached, `${slug || '(empty)'} reached for a file`).toEqual([]);
    page.removeAllListeners('request');
  }
});

// An address this site once answered to, kept answering. Every assistant copy
// written before the document was renamed carries the old address inside it as
// the terms it was handed over under, and those files are somewhere this app
// cannot reach. The rename turned all of them into "Nothing here", which is a
// contract naming its own explanation and pointing at nothing.
test('the address a file left carrying still opens the contract it names', async ({ page }) => {
  await page.goto('/read.html?d=agents');
  await expect(page.locator('.read-body h1')).toHaveText('An atlas, read by a machine');

  // and it leaves under the name the document is called now, so nothing that
  // is written down from here carries the old word forward a second time
  expect(new URL(page.url()).search).toBe('?d=assistant');

  const wasAliased = await page.locator('.read-body').innerHTML();
  await page.goto('/read.html?d=assistant');
  expect(await page.locator('.read-body').innerHTML(),
    'the old word set a different page').toBe(wasAliased);

  // the alias is one word and not an open door: everything else is still refused
  await page.goto('/read.html?d=agent');
  await expect(page.locator('.read-body')).toContainText('Nothing here');
});

// The documents point at one another as well, and the link COMMONS.md carried
// was "[/METHOD.md]" at the raw markdown: a filename for a label and a download
// at the end of it, which is the whole of what this page exists to prevent. The
// reader rewrites a link to a document it sets, so the markdown stays right in
// a checkout and right here.
test('a document pointing at a document opens the reader, never the file', async ({ page }) => {
  await page.goto('/read.html?d=assistant');
  await expect(page.locator('.read-body h1')).toBeVisible();

  const hrefs = await page.locator('.read-body a').evaluateAll(
    (as) => as.map((a) => a.getAttribute('href') || ''));
  expect(hrefs.filter((h) => /\.md(\?|#|$)/i.test(h)),
    'a document handed the reader a raw file').toEqual([]);

  const toMethod = page.locator('.read-body a[href="read.html?d=method"]');
  await expect(toMethod, 'the contract stopped pointing at the method').toHaveCount(1);
  await toMethod.click();
  await expect(page.locator('.read-body h1')).toHaveText('How two atlases are compared');
});

test('every document the how page points at is one that opens', async ({ page }) => {
  await open(page);
  await openYours(page);
  await page.locator('#howWord').click();
  const hrefs = await page.locator('.how-body a[href^="read.html"]').evaluateAll(
    (as) => as.map(a => a.getAttribute('href')));
  expect(hrefs.length, 'the how page points at no documents').toBeGreaterThan(2);
  for (const href of hrefs) {
    await page.goto('/' + href);
    // the refusal is a heading, and the assertion has to say so: SPEC.md's own
    // first paragraph begins "Nothing here is custom cryptography"
    const heading = page.locator('.read-body h1');
    await expect(heading, `${href} opened onto nothing`).toBeVisible();
    expect(await heading.textContent(), `${href} names no document`).not.toBe('Nothing here');
  }
});

// A device that kept photographs before Resonate stopped keeping them is told
// once, handed every picture back in a file it can open anywhere, and left
// still holding the originals. The update itself destroys nothing.
//
// This is a browser test and not a node one for the reason the whole removal
// turns on: nothing under test/ imports js/app.js, so a call to a function
// that does not exist parses cleanly, passes `npm test`, and fails only here.
test('a device still holding photographs is told once, and handed them back', async ({ page }) => {
  await open(page);

  // a real picture, put where a device from before would be holding one
  await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const photos = await import(`/js/photos.js${v}`);
    const c = document.createElement('canvas');
    c.width = 120; c.height = 90;
    const g = c.getContext('2d');
    g.fillStyle = '#8a5226'; g.fillRect(0, 0, 120, 90);
    await photos.put(photos.blobFromDataURL(c.toDataURL('image/jpeg', 0.8)));
  });

  // the notice is raised from the deferred boot block, so it is the next
  // visit that carries it
  await page.reload();
  await expect(page.locator('#intro')).toBeHidden({ timeout: 15000 });
  const box = page.locator('#askBox');
  await expect(box).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#askWhat')).toContainText('leaving Resonate');
  await expect(page.locator('#askWhat'), 'a count where a word would do').toContainText('one photograph');
  await expect(page.locator('#askGo')).toHaveText('take my photographs');
  await expect(page.locator('#askAlso')).toHaveText('let them go');
  // escape answers the way this word does, so this word must be the one that
  // costs nothing. the word that deletes is never the way out.
  await expect(page.locator('#askNo')).toHaveText('leave them here');

  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#askGo').click(),
  ]);
  expect(file.suggestedFilename()).toMatch(/^resonate-photographs-\d{4}-\d{2}-\d{2}\.html$/);
  const written = await readFile(await file.path(), 'utf8');
  expect(written, 'the page does not carry the picture').toContain('<img src="data:image/jpeg;base64,');
  expect(written, 'the page would have to fetch something to be whole').not.toMatch(/src="(?!data:)/);

  // and the picture is still here: taking a copy is not a deletion
  const left = await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const photos = await import(`/js/photos.js${v}`);
    return photos.photographCount();
  });
  expect(left, 'the pictures were destroyed by being handed over').toBe(1);

  // said once, and the marker is a key of its own, so a restore cannot undo it
  await page.reload();
  await expect(page.locator('#intro')).toBeHidden({ timeout: 15000 });
  await page.waitForTimeout(4500);
  await expect(box, 'the notice came back after it had been given').toBeHidden();
});

// The word that deletes, driven against a real IndexedDB, because the stand-in
// in the node tests cannot prove the thing that matters here: the photographs
// and the snapshots live in one database, and letting the pictures go must
// reach exactly one of the two stores. A person who erased their photographs
// and lost their snapshots with them would not find that out until the day
// they needed one.
test('letting the photographs go takes the pictures and never the snapshots', async ({ page }) => {
  await open(page);

  await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const photos = await import(`/js/photos.js${v}`);
    const c = document.createElement('canvas');
    c.width = 120; c.height = 90;
    c.getContext('2d').fillRect(0, 0, 120, 90);
    await photos.put(photos.blobFromDataURL(c.toDataURL('image/jpeg', 0.8)));
    await photos.snapshotPut('{"places":[]}');
  });

  await page.reload();
  await expect(page.locator('#intro')).toBeHidden({ timeout: 15000 });
  await expect(page.locator('#askBox')).toBeVisible({ timeout: 15000 });

  await page.locator('#askAlso').click();
  // nothing is deleted on one word alone
  await expect(page.locator('#askWhat')).toContainText('Delete one photograph from this device?');
  await expect(page.locator('#askGo')).toHaveText('delete it');
  await expect(page.locator('#askNo')).toHaveText('stop');
  await page.locator('#askGo').click();
  await expect(page.locator('#toast')).toContainText('gone from this device');

  const after = await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const photos = await import(`/js/photos.js${v}`);
    return {
      pictures: await photos.photographCount(),
      snapshots: ((await photos.snapshotKeys()) || []).length,
    };
  });
  expect(after.pictures, 'the pictures a person asked to be rid of').toBe(0);
  expect(after.snapshots, 'the snapshots share the database and were taken with them').toBeGreaterThan(0);
});

// a picture, put where a device from before would be holding one
async function seedPicture(page, { w = 60, h = 40 } = {}) {
  return page.evaluate(async ({ w, h }) => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const photos = await import(`/js/photos.js${v}`);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = '#8a5226'; g.fillRect(0, 0, w, h);
    return photos.put(photos.blobFromDataURL(c.toDataURL('image/jpeg', 0.8)));
  }, { w, h });
}

async function openYours(page, detail = '') {
  await showIndex(page);
  await page.locator('[data-go="you"]').click();
  await expect(page.locator('#settingsOverlay')).toBeVisible();
  if (detail) {
    const disclosure = page.locator(detail);
    if (await disclosure.getAttribute('open') === null) {
      await disclosure.locator('summary').click();
    }
    await expect(disclosure).toHaveAttribute('open', '');
  }
}

async function bootIntoTheNotice(page) {
  await page.reload();
  await expect(page.locator('#intro')).toBeHidden({ timeout: 15000 });
  await expect(page.locator('#askBox')).toBeVisible({ timeout: 15000 });
}

// This is deliberately the real deferred migration notice rather than long
// stand-in prose placed in the dialog. Its four paragraphs were taller than a
// short phone and flex-end centred the overflow above the glass, where neither
// a swipe nor a keyboard could recover it. The first word must exist at the
// top of the scroll range and the three decisions at its bottom, in both a
// narrow portrait and the short landscape a folded or rotated phone presents.
test('the photograph migration notice stays whole on short mobile glass', async ({ page }) => {
  const notice = 'Your photographs are leaving Resonate. This device is holding one photograph. A phone already keeps a photo library, and a second one inside a browser is the part most likely to go when the browser tidies up.\n\n'
    + 'Nothing has been deleted. What is here stays here until you say otherwise, and this offer stays in your room for as long as anything is here.\n\n'
    + 'A page can be written now holding every picture on this device. It opens in any browser, on any computer, with nothing installed, and every picture can be saved out of it. Keep it somewhere that is not this browser.\n\n'
    + 'Dropping a photograph on the map still makes a place. The app reads the location saved in the file and keeps nothing of the picture itself.';

  await page.setViewportSize({ width: 320, height: 568 });
  await open(page);
  await seedPicture(page);

  for (const [width, height] of [[320, 568], [653, 280]]) {
    await page.setViewportSize({ width, height });
    // Boot at this exact shape. Resizing an already open dialog proves its
    // reflow, but not where a browser will scroll when the initially focused
    // answer begins below the fold.
    await bootIntoTheNotice(page);
    expect(await page.locator('#askWhat').textContent(),
      'the migration notice changed, so this no longer exercises its exact long copy').toBe(notice);
    const reach = await page.locator('#askBox').evaluate(async (box) => {
      const question = box.querySelector('#askWhat');
      const actions = box.querySelector('.word-row');
      const openingFirst = question.getBoundingClientRect();
      const opening = {
        scrollTop: box.scrollTop,
        firstTop: openingFirst.top,
        focused: document.activeElement.id,
      };
      box.scrollTop = 0;
      await new Promise(requestAnimationFrame);
      const frame = box.getBoundingClientRect();
      const first = question.getBoundingClientRect();
      const atTop = {
        scrollTop: box.scrollTop,
        firstTop: first.top,
        frameTop: frame.top,
        firstLeft: first.left,
        firstRight: first.right,
        frameLeft: frame.left,
        frameRight: frame.right,
      };
      box.scrollTop = box.scrollHeight;
      await new Promise(requestAnimationFrame);
      const last = actions.getBoundingClientRect();
      return {
        opening,
        atTop,
        scrollTop: box.scrollTop,
        scrollHeight: box.scrollHeight,
        clientHeight: box.clientHeight,
        lastTop: last.top,
        lastBottom: last.bottom,
        frameTop: frame.top,
        frameBottom: frame.bottom,
        lastLeft: last.left,
        lastRight: last.right,
        frameLeft: frame.left,
        frameRight: frame.right,
      };
    });

    expect(reach.opening.scrollTop, `${width}x${height}: the notice opened after its first line`).toBe(0);
    expect(reach.opening.firstTop, `${width}x${height}: focus scrolled the opening above the glass`)
      .toBeGreaterThanOrEqual(reach.frameTop - 1);
    expect(reach.opening.focused, `${width}x${height}: focus began on an off-screen answer`)
      .toBe(height === 280 ? 'askBox' : 'askGo');
    expect(reach.atTop.scrollTop, `${width}x${height}: the notice did not begin at its first line`).toBe(0);
    expect(reach.atTop.firstTop, `${width}x${height}: the first paragraph begins above the glass`)
      .toBeGreaterThanOrEqual(reach.atTop.frameTop - 1);
    expect(reach.atTop.firstLeft, `${width}x${height}: the first paragraph runs off the left edge`)
      .toBeGreaterThanOrEqual(reach.atTop.frameLeft - 1);
    expect(reach.atTop.firstRight, `${width}x${height}: the first paragraph runs off the right edge`)
      .toBeLessThanOrEqual(reach.atTop.frameRight + 1);
    expect(reach.scrollTop, `${width}x${height}: the long notice has no usable scroll range`)
      .toBeGreaterThan(0);
    expect(reach.lastTop, `${width}x${height}: the choices scroll above the glass`)
      .toBeGreaterThanOrEqual(reach.frameTop - 1);
    expect(reach.lastBottom, `${width}x${height}: the choices cannot be reached at the bottom`)
      .toBeLessThanOrEqual(reach.frameBottom + 1);
    expect(reach.lastLeft, `${width}x${height}: the choices run off the left edge`)
      .toBeGreaterThanOrEqual(reach.frameLeft - 1);
    expect(reach.lastRight, `${width}x${height}: the choices run off the right edge`)
      .toBeLessThanOrEqual(reach.frameRight + 1);
  }

  await page.locator('#askNo').click();
  await expect(page.locator('#askBox')).toBeHidden();
});

// A name may legally fill all 140 characters without carrying a space. When
// the question became vertically scrollable, CSS made its other axis `auto`
// too; one such name turned this dialog into an eleven-hundred-pixel sideways
// page. Drive the real destructive question so both the schema limit and its
// safe default are exercised, then require one vertical reading surface.
test('a schema-limit name cannot widen a short mobile question', async ({ page }) => {
  const name = 'x'.repeat(140);
  const now = new Date().toISOString();
  await page.setViewportSize({ width: 280, height: 653 });
  await open(page, {
    places: 0,
    atlas: [{
      id: 'long-name', name, lat: 47, lng: 8, city: '', country: '', tags: [],
      status: 'visited', note: '', createdAt: now, updatedAt: now,
    }],
  });
  await showIndex(page);
  await page.locator('[data-id="long-name"]').click();
  await expect(page.locator('#plate')).toBeVisible();
  await page.setViewportSize({ width: 280, height: 200 });
  await page.locator('#pDelete').click();
  await expect(page.locator('#askBox')).toBeVisible();
  await expect(page.locator('#askWhat')).toContainText(name);

  const seen = await page.locator('#askBox').evaluate(async (box) => {
    const question = box.querySelector('#askWhat');
    const actions = box.querySelector('.word-row');
    const frame = box.getBoundingClientRect();
    const first = question.getBoundingClientRect();
    const opening = { scrollTop: box.scrollTop, firstTop: first.top, focused: document.activeElement.id };
    box.scrollTop = box.scrollHeight;
    await new Promise(requestAnimationFrame);
    const last = actions.getBoundingClientRect();
    return {
      opening,
      sideways: box.scrollWidth - box.clientWidth,
      pageSideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      lastBottom: last.bottom,
      frameBottom: frame.bottom,
      reached: box.scrollTop + box.clientHeight >= box.scrollHeight - 1,
    };
  });
  expect(seen.opening.scrollTop, 'the long question opened after its first word').toBe(0);
  expect(seen.opening.firstTop, 'the long question opened above the glass').toBeGreaterThanOrEqual(-1);
  expect(seen.opening.focused, 'the safe answer took focus below the fold').toBe('askBox');
  expect(seen.sideways, 'the long question created a sideways dialog').toBeLessThanOrEqual(1);
  expect(seen.pageSideways, 'the long question widened the page').toBeLessThanOrEqual(1);
  expect(seen.reached, 'the safe answer cannot be reached vertically').toBe(true);
  expect(seen.lastBottom, 'the safe answer stays below the glass')
    .toBeLessThanOrEqual(seen.frameBottom + 1);

  // The question itself holds focus while its answers are below the fold.
  // WebKit used to send forward Tab from that tabindex=-1 root to BODY and
  // leave the modal altogether. The intended first stop is the safe answer,
  // and both directions must remain a closed loop.
  await page.locator('#askBox').evaluate((box) => { box.scrollTop = 0; box.focus(); });
  await page.keyboard.press('Tab');
  await expect(page.locator('#askNo')).toBeFocused();
  const focused = await page.locator('#askNo').evaluate((button) => {
    const r = button.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, height: innerHeight };
  });
  expect(focused.top, 'Tab focused the safe answer above the glass').toBeGreaterThanOrEqual(-1);
  expect(focused.bottom, 'Tab focused the safe answer below the glass').toBeLessThanOrEqual(focused.height + 1);
  await page.keyboard.press('Tab');
  await expect(page.locator('#askGo')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#askNo')).toBeFocused();

  await page.locator('#askNo').click();
  await expect(page.locator('#askBox')).toBeHidden();
});

// Escape resolves an ask the way its plainest word does, and the plainest word
// here used to record the telling. The boot gate is "unless already told", so
// one keypress on the way past a dialog retired, permanently and in silence,
// the only route those photographs had out of this browser. A notice that can
// be dismissed by reflex must cost nothing, and must not be the only door.
test('waving the notice away costs nothing, and yours keeps the door', async ({ page }) => {
  await open(page);
  await seedPicture(page);
  await bootIntoTheNotice(page);

  await page.keyboard.press('Escape');
  await expect(page.locator('#askBox')).toBeHidden();
  const told = await page.evaluate(() => localStorage.getItem('resonate.photographs.told.v1'));
  expect(told, 'a keypress spent the one offer the photographs had').toBeNull();

  // and it comes back, because nothing about the situation was settled
  await bootIntoTheNotice(page);
  await page.locator('#askNo').click();
  await expect(page.locator('#askBox')).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('resonate.photographs.told.v1')),
    'the dismissing word spent the offer').toBeNull();

  // the notice is a courtesy. this is the door.
  await openYours(page);
  const word = page.locator('#photoWay');
  await expect(word, 'nothing in the you room reaches the photographs still on this device').toBeVisible();
  await expect(word).toHaveText('the photograph still here');
  await word.click();
  await expect(page.locator('#askWhat')).toContainText('leaving Resonate');
  await expect(page.locator('#askGo')).toHaveText('take my photographs');
  await page.locator('#askAlso').click();
  await expect(page.locator('#askWhat')).toContainText('Delete one photograph from this device?');
  await page.locator('#askGo').click();
  await expect(page.locator('#toast')).toContainText('gone from this device');
  await expect(word, 'the photograph door outlived the photograph').toBeHidden();
  await expect(page.locator('#deviceSummary')).not.toContainText('photo');
});

// The door is only there while something is behind it.
test('a device holding no photographs is offered no way back to them', async ({ page }) => {
  await open(page);
  await openYours(page);
  await expect(page.locator('#setKept')).not.toHaveText('counting…');
  await expect(page.locator('#photoWay'), 'a door onto nothing').toBeHidden();
});

test('a browser without offline support is not left preparing forever', async ({ page }) => {
  await page.addInitScript(() => {
    try { delete Navigator.prototype.serviceWorker; } catch { /* already absent */ }
  });
  await open(page);
  await openYours(page);
  await expect(page.locator('#deviceSummary')).toHaveText('online only');
  await page.locator('#deviceSettings > summary').click();
  await expect(page.locator('#deviceState')).toContainText('offline copy unavailable');
});

// ---------- the pictures that were never in the database ----------
//
// Whenever IndexedDB refused a blob the app kept the picture inline in the
// record, as a data url in the small store. Nothing emits that field any more,
// so the first ordinary write after this build takes every one of them out of
// localStorage for good. A farewell that reads only the database does not know
// they exist, offers a file that does not have them in it, and then watches
// them go without a word.
// a real picture, small enough to be written down here: a one pixel png
const A_PICTURE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// The seeding in open() runs on every navigation, so a record edited by hand
// after it is gone again on the next reload. This registers itself as a later
// init script, which runs after that one and therefore has the last word.
async function seedRecord(page, patch) {
  await page.addInitScript((p) => {
    const places = JSON.parse(localStorage.getItem('resonate.places.v1') || '[]');
    if (!places.length) return;
    Object.assign(places[0], p);
    localStorage.setItem('resonate.places.v1', JSON.stringify(places));
  }, patch);
}

test('a picture kept inline in a record is counted and handed back', async ({ page }) => {
  await open(page);

  // a picture in the record itself, exactly as the fallback wrote it
  await seedRecord(page, {
    name: 'The bench', lat: 46.20411, lng: 8.20255, photos: [A_PICTURE],
  });

  await bootIntoTheNotice(page);
  await expect(page.locator('#askWhat'), 'the database was asked and the records were not')
    .toContainText('one photograph');

  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#askGo').click(),
  ]);
  const written = await readFile(await file.path(), 'utf8');
  expect(written, 'a picture only the records knew about was left out of the page')
    .toContain(A_PICTURE);

  // and the caption is the place, never the app's own bookkeeping
  expect(written, 'the picture is captioned with nothing a person can use')
    .toContain('<figcaption>The bench  ·  46.20411, 8.20255</figcaption>');
});

// A picture in the database belongs to a place too, and which place is knowable
// only from the raw records: by the time the app has loaded them the field has
// been stripped. An id under a photograph explains nothing and outlives the
// thing that could have explained it.
test('a rescued picture is captioned by its place, or by nothing at all', async ({ page }) => {
  await open(page);
  const id = await seedPicture(page);
  await seedRecord(page, {
    name: 'The spring above the road', lat: 45.5, lng: 7.75, photos: [id],
  });

  await bootIntoTheNotice(page);
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#askGo').click(),
  ]);
  const written = await readFile(await file.path(), 'utf8');
  expect(written).toContain('<figcaption>The spring above the road  ·  45.50000, 7.75000</figcaption>');
  expect(written, 'the id is looked up, never printed').not.toContain(id);
});

// A picture nothing points at any more is still that person's picture. It is
// handed over with nothing said underneath it, because an unexplained id is
// worse than a blank: it looks like information and is not.
test('a picture no record explains is handed over with nothing claimed', async ({ page }) => {
  await open(page);
  const id = await seedPicture(page);

  await bootIntoTheNotice(page);
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#askGo').click(),
  ]);
  const written = await readFile(await file.path(), 'utf8');
  expect(written, 'the picture was left out for want of a caption').toContain('<img src="data:image/jpeg;base64,');
  expect(written, 'an internal id was printed under somebody\'s photograph').not.toContain(id);
  expect(written).not.toContain('<figcaption>');
});

// ---------- reading them is not keeping them ----------
//
// The farewell reads the inline pictures straight out of the raw key. Reading
// is not keeping, and the records are rewritten whole on every edit by a build
// whose places carry no photos field at all, so those pictures were destroyed
// twice over: at boot, by the write that heals an undated record's date, before
// the farewell had counted anything; and after the farewell, by the next
// ordinary edit, minutes after a dialog promised in writing that nothing had
// been deleted and that the offer would stand in the you room for as long as
// anything was here.
//
// They are lifted into the database at boot now, before the store reads a
// thing. These two drive the exact sequences that destroyed them.

// a second real picture, so a record can be seen carrying more than one: a 1x1 gif
const A_SECOND_PICTURE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

test('a picture in an undated record outlives the boot that heals the date', async ({ page }) => {
  await open(page);
  // a record adopted before dates were kept, still carrying a picture inline:
  // the exact shape whose healing write took the picture with it
  await seedRecord(page, {
    name: 'The bench', lat: 46.20411, lng: 8.20255,
    createdAt: '', updatedAt: '', photos: [A_PICTURE],
  });

  await bootIntoTheNotice(page);
  await expect(page.locator('#askWhat'), 'the picture was gone before anything could count it')
    .toContainText('one photograph');

  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#askGo').click(),
  ]);
  const written = await readFile(await file.path(), 'utf8');
  expect(written, 'the boot destroyed it and nobody was ever told it had been there')
    .toContain(A_PICTURE);

  // and the date was healed all the same, once there was somewhere safe for
  // the picture to be
  const dated = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('resonate.places.v1'))[0].createdAt);
  expect(dated, 'the healing was held back for ever rather than for one boot').toBeTruthy();
});

test('a picture kept inline outlives the next place a person marks', async ({ page }) => {
  await open(page);
  await seedRecord(page, {
    name: 'The bench', lat: 46.20411, lng: 8.20255,
    photos: [A_PICTURE, A_SECOND_PICTURE],
  });

  await bootIntoTheNotice(page);
  await expect(page.locator('#askWhat')).toContainText('2 photographs');
  await page.locator('#askNo').click();
  await expect(page.locator('#askBox')).toBeHidden();

  // one ordinary edit, through the app's own keyboard route
  await page.keyboard.press('/');
  await page.locator('#paletteInput').fill('>mark');
  await expect(page.locator('.cmd-row').first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('#addConfirm')).toBeVisible();
  // Put the name in the field, rather than at the page and hoping.
  //
  // proposeAdd unhides the form, draws the preview pin, flies the field to the
  // point, and only then takes the cursor. Keystrokes aimed at the page raced
  // all of that: they passed on every fast machine and failed on webkit in CI
  // three times over, first as a value lost by the end of the test and then,
  // once the assertion moved to the moment of typing, as keys that never
  // arrived at all. Waiting for the cursor did not help, because the cursor can
  // be taken back between the wait and the keystroke.
  //
  // What is under test here is the reach of one Escape, not the typing. fill
  // puts the name in the field in one act and still fires an input event, which
  // is the event this app listens for to mark a field as typed into, so the
  // geocoder's answer is refused afterwards exactly as it would be for a
  // person. The claim is unweakened and the race is gone.
  // Met a fourth time: on a loaded CI runner, webkit's fill reported success
  // while the field stayed empty, with the map still flying to the mark. The
  // one writer that empties this field is proposeAdd's own reset, which has
  // already run by the time the form is visible; what remains is the driver,
  // not the app. So the act is retried, bounded, until the field holds the
  // name. The claims these tests make come after this line, when the name
  // must still be standing.
  await expect(async () => {
    await page.locator('#addConfirmInput').fill('a bench with a view');
    await expect(page.locator('#addConfirmInput'),
      'the name did not reach the field at all')
      .toHaveValue('a bench with a view', { timeout: 2000 });
  }).toPass({ timeout: 35000 });
  await page.keyboard.press('Enter');
  await expect(page.locator('#addConfirm')).toBeHidden();

  // the promise the dialog made, kept: the door is still in the you room, and it
  // still says two
  await openYours(page);
  await expect(page.locator('#photoWay'), 'the door vanished with the pictures behind it')
    .toHaveText('the 2 photographs still here');
  await page.locator('#photoWay').click();
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#askGo').click(),
  ]);
  const written = await readFile(await file.path(), 'utf8');
  expect(written).toContain(A_PICTURE);
  expect(written).toContain(A_SECOND_PICTURE);
});

// ---------- a notice that waits has to look again before it speaks ----------
//
// The boot notice waits for the floor. It used to ignore a place being named,
// which is not a dialog and holds no surface, so it took the floor from a
// half written name; and the one Escape that dismissed it threw that place
// away too, because the ask's handler stopped the browser's default and not
// the keypress. And what it eventually said was decided before the wait: a
// person who settled the whole matter through the door in the you room while it
// waited was asked again, about photographs they had just deleted, and then
// told the browser would not read them back.

test('the notice waits for a place that is being named', async ({ page }) => {
  await open(page);
  await seedPicture(page);
  await page.reload();
  await expect(page.locator('#intro')).toBeHidden({ timeout: 15000 });

  // a mark, begun before the notice is due
  await page.keyboard.press('/');
  await page.locator('#paletteInput').fill('>mark');
  await expect(page.locator('.cmd-row').first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('#addConfirm')).toBeVisible();
  // Put the name in the field, rather than at the page and hoping.
  //
  // proposeAdd unhides the form, draws the preview pin, flies the field to the
  // point, and only then takes the cursor. Keystrokes aimed at the page raced
  // all of that: they passed on every fast machine and failed on webkit in CI
  // three times over, first as a value lost by the end of the test and then,
  // once the assertion moved to the moment of typing, as keys that never
  // arrived at all. Waiting for the cursor did not help, because the cursor can
  // be taken back between the wait and the keystroke.
  //
  // What is under test here is the reach of one Escape, not the typing. fill
  // puts the name in the field in one act and still fires an input event, which
  // is the event this app listens for to mark a field as typed into, so the
  // geocoder's answer is refused afterwards exactly as it would be for a
  // person. The claim is unweakened and the race is gone.
  // Met a fourth time: on a loaded CI runner, webkit's fill reported success
  // while the field stayed empty, with the map still flying to the mark. The
  // one writer that empties this field is proposeAdd's own reset, which has
  // already run by the time the form is visible; what remains is the driver,
  // not the app. So the act is retried, bounded, until the field holds the
  // name. The claims these tests make come after this line, when the name
  // must still be standing.
  await expect(async () => {
    await page.locator('#addConfirmInput').fill('a bench with a view');
    await expect(page.locator('#addConfirmInput'),
      'the name did not reach the field at all')
      .toHaveValue('a bench with a view', { timeout: 2000 });
  }).toPass({ timeout: 35000 });
  await expect(page.locator('#askBox'), 'the notice was already up before the mark began')
    .toBeHidden();

  await page.waitForTimeout(4000);
  await expect(page.locator('#askBox'), 'the notice took the floor from a place being named')
    .toBeHidden();
  await expect(page.locator('#addConfirmInput')).toHaveValue('a bench with a view');

  // the place is kept, and only then is the floor free
  await page.keyboard.press('Enter');
  await expect(page.locator('#addConfirm')).toBeHidden();
  await expect(page.locator('#askBox'), 'and then it never came at all').toBeVisible({ timeout: 15000 });
});

test('a notice that waited asks again what is here before it speaks', async ({ page }) => {
  await open(page);
  await seedPicture(page);
  await page.reload();
  await expect(page.locator('#intro')).toBeHidden({ timeout: 15000 });

  await page.keyboard.press('/');
  await page.locator('#paletteInput').fill('>mark');
  await expect(page.locator('.cmd-row').first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('#addConfirm')).toBeVisible();
  await expect(page.locator('#askBox')).toBeHidden();

  // while it waits, the whole matter is settled elsewhere: the pictures go and
  // the telling is written down, exactly as the door in the you room does it
  await page.waitForTimeout(3200);
  await expect(page.locator('#askBox'), 'the notice never waited, so it never had a stale answer to give')
    .toBeHidden();
  await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const photos = await import(`/js/photos.js${v}`);
    await photos.releasePhotographs();
    localStorage.setItem('resonate.photographs.told.v1', new Date().toISOString());
  });

  await page.keyboard.press('Escape');
  await expect(page.locator('#addConfirm')).toBeHidden();
  await page.waitForTimeout(3000);
  await expect(page.locator('#askBox'),
    'the notice came back for photographs the person had already deleted, and would have blamed the browser for them')
    .toBeHidden();
});

test('one Escape answers the dialog in front and does not reach past it', async ({ page }) => {
  await open(page);
  await seedPicture(page);
  await bootIntoTheNotice(page);
  await page.locator('#askNo').click();
  await expect(page.locator('#askBox')).toBeHidden();

  // a place being named, and the door in the you room opened over it
  await page.keyboard.press('/');
  await page.locator('#paletteInput').fill('>mark');
  await expect(page.locator('.cmd-row').first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('#addConfirm')).toBeVisible();
  // Put the name in the field, rather than at the page and hoping.
  //
  // proposeAdd unhides the form, draws the preview pin, flies the field to the
  // point, and only then takes the cursor. Keystrokes aimed at the page raced
  // all of that: they passed on every fast machine and failed on webkit in CI
  // three times over, first as a value lost by the end of the test and then,
  // once the assertion moved to the moment of typing, as keys that never
  // arrived at all. Waiting for the cursor did not help, because the cursor can
  // be taken back between the wait and the keystroke.
  //
  // What is under test here is the reach of one Escape, not the typing. fill
  // puts the name in the field in one act and still fires an input event, which
  // is the event this app listens for to mark a field as typed into, so the
  // geocoder's answer is refused afterwards exactly as it would be for a
  // person. The claim is unweakened and the race is gone.
  // Met a fourth time: on a loaded CI runner, webkit's fill reported success
  // while the field stayed empty, with the map still flying to the mark. The
  // one writer that empties this field is proposeAdd's own reset, which has
  // already run by the time the form is visible; what remains is the driver,
  // not the app. So the act is retried, bounded, until the field holds the
  // name. The claims these tests make come after this line, when the name
  // must still be standing.
  await expect(async () => {
    await page.locator('#addConfirmInput').fill('a bench with a view');
    await expect(page.locator('#addConfirmInput'),
      'the name did not reach the field at all')
      .toHaveValue('a bench with a view', { timeout: 2000 });
  }).toPass({ timeout: 35000 });

  await openYours(page);
  await page.locator('#photoWay').click();
  await expect(page.locator('#askBox')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.locator('#askBox')).toBeHidden();
  await expect(page.locator('#addConfirm'),
    'the escape that waved the dialog away threw the place being named away with it')
    .toBeVisible();
  await expect(page.locator('#addConfirmInput')).toHaveValue('a bench with a view');
});

// The page used to be one string with every photograph inline. A string has a
// ceiling in every engine, so the largest libraries, which are the ones this
// owes a way out to, could not be written at all: the export threw and handed
// over nothing. Numbered pages, and every page saying how many there are,
// because a page that does not say so is a page somebody stops collecting.
test('a library too large for one page is written as numbered pages', async ({ page }) => {
  test.slow();
  await open(page);

  // two pictures either side of the budget, made as bytes rather than as
  // photographs: what is under test is the arithmetic, not the encoder
  await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const photos = await import(`/js/photos.js${v}`);
    for (let i = 0; i < 2; i++) {
      await photos.put(new Blob([new Uint8Array(5_000_000)], { type: 'image/jpeg' }));
    }
  });

  const written = [];
  page.on('download', d => written.push(d));
  await bootIntoTheNotice(page);
  await page.locator('#askGo').click();
  await expect(page.locator('#toast')).toContainText('across those 2 pages', { timeout: 30000 });

  // The toast is the app saying it has written two pages. It is not the two
  // files arriving: a download reaches the test as an event over the protocol,
  // and on a loaded container the second one can land after the sentence that
  // announced it. This read `expect(written.length).toBe(2)` on the line under
  // the toast, which is a question asked of an array still being filled, and it
  // held until a webkit runner was slow enough to answer it honestly. Expected
  // 2, received 1, with the toast already agreeing there were two. So the count
  // is polled rather than snatched, and a library that really does write one
  // file still fails here, one timeout later.
  await expect.poll(() => written.length,
    { message: 'one file, and a library that could not be written at all', timeout: 15000 })
    .toBe(2);
  const names = written.map(d => d.suggestedFilename()).sort();
  expect(names[0]).toMatch(/^resonate-photographs-\d{4}-\d{2}-\d{2}-1-of-2\.html$/);
  expect(names[1]).toMatch(/^resonate-photographs-\d{4}-\d{2}-\d{2}-2-of-2\.html$/);

  for (const d of written) {
    const page1 = await readFile(await d.path(), 'utf8');
    expect(page1, 'a page that does not say how many there are').toContain('2 pages');
    expect((page1.match(/<img src="data:/g) || []).length).toBe(1);
  }
});

// ---------- what an erase actually reaches ----------
//
// An erase empties the photographs store, and on a device from before that
// store is not empty. Neither confirmation named them, so the one word in the
// app that destroys somebody's pictures was the one word that did not mention
// them.
test('erasing says it takes the photographs, and only when it would', async ({ page }) => {
  await open(page);
  await seedPicture(page);
  await page.reload();
  await expect(page.locator('#intro')).toBeHidden({ timeout: 15000 });
  // the notice stands over the field first; it is not what this test is about
  await expect(page.locator('#askBox')).toBeVisible({ timeout: 15000 });
  await page.locator('#askNo').click();

  await openYours(page, '#resetSettings');
  await page.locator('#eraseAll').click();
  // the first question counts what it takes, rather than naming two of seven
  await expect(page.locator('#askWhat')).toContainText('Erase this atlas?');
  await expect(page.locator('#askWhat'), 'the word that destroys them does not count them')
    .toContainText(/It takes \d+ place/);
  await page.locator('#askGo').click();
  await expect(page.locator('#askWhat'), 'the word that destroys them does not name them')
    .toContainText('still holding one photograph');
  await expect(page.locator('#askWhat')).toContainText('an erase takes it too');
  await page.locator('#askNo').click();

  // and on a device with nothing to lose the sentence is not there at all
  await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const photos = await import(`/js/photos.js${v}`);
    await photos.releasePhotographs();
  });
  await page.locator('#eraseAll').click();
  await page.locator('#askGo').click();
  await expect(page.locator('#askWhat')).toContainText('Gone means gone here.');
  await expect(page.locator('#askWhat'), 'photographs named on a device that has none')
    .not.toContainText('photograph');
  // and a device that never joined is not consoled about a key it never had
  await expect(page.locator('#askWhat'), 'a club key promised to somebody who has none')
    .not.toContainText('club');
  await page.locator('#askNo').click();
});

test('an inbox open blocked during erase leaves every store untouched', async ({ page }) => {
  await open(page);
  const beforePlaces = await page.evaluate(() => localStorage.getItem('resonate.places.v1'));
  await page.evaluate(async () => {
    const share = await new Promise((resolve, reject) => {
      const req = indexedDB.open('resonate-share', 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains('shared')) {
          req.result.createObjectStore('shared', { autoIncrement: true });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise((resolve, reject) => {
      const tx = share.transaction('shared', 'readwrite');
      tx.objectStore('shared').add({ title: '', text: '', url: '%', shortened: false });
      tx.oncomplete = resolve;
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
    share.close();

    const v = new URL(document.querySelector('script[type=module]').src).search;
    const photos = await import(`/js/photos.js${v}`);
    await photos.snapshotPut('{"places":[{"name":"still here"}]}');

    const real = indexedDB.open.bind(indexedDB);
    window.__restoreIDBOpen = () => Object.defineProperty(indexedDB, 'open', {
      configurable: true, value: real,
    });
    Object.defineProperty(indexedDB, 'open', {
      configurable: true,
      value(name, ...args) {
        if (name !== 'resonate-share') return real(name, ...args);
        const req = {};
        queueMicrotask(() => req.onblocked?.(new Event('blocked')));
        return req;
      },
    });
  });

  await openYours(page, '#resetSettings');
  await page.locator('#eraseAll').click();
  await page.locator('#askGo').click();
  await expect(page.locator('#askWhat')).toContainText('Gone means gone here.');
  await page.locator('#askGo').click();
  await expect(page.locator('#toast')).toContainText('could not read its share inbox', { timeout: 20000 });
  await expect(page.locator('#toast')).not.toContainText('has been erased');
  expect(await page.evaluate(() => localStorage.getItem('resonate.places.v1')),
    'the atlas was touched after the inbox blocked').toBe(beforePlaces);

  const held = await page.evaluate(async () => {
    window.__restoreIDBOpen();
    const inbox = await new Promise((resolve, reject) => {
      const req = indexedDB.open('resonate-share', 1);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('shared', 'readonly');
        const all = tx.objectStore('shared').getAll();
        tx.oncomplete = () => { db.close(); resolve(all.result || []); };
        tx.onabort = tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const photos = await import(`/js/photos.js${v}`);
    return { inbox, snapshots: await photos.snapshotKeys() };
  });
  expect(held.inbox).toHaveLength(1);
  expect(held.snapshots.length, 'snapshots were cleared after the inbox refused').toBeGreaterThan(0);
});

test('a complete erase commits the atlas, snapshots and share inbox together', async ({ page }) => {
  await open(page);
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('resonate-share', 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains('shared')) {
          req.result.createObjectStore('shared', { autoIncrement: true });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('shared', 'readwrite');
      tx.objectStore('shared').add({ title: '', text: '', url: '%', shortened: false });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const photos = await import(`/js/photos.js${v}`);
    await photos.snapshotPut('{"places":[{"name":"erase me"}]}');
  });

  await openYours(page, '#resetSettings');
  await page.locator('#eraseAll').click();
  await page.locator('#askGo').click();
  await expect(page.locator('#askWhat')).toContainText('Gone means gone here.');
  await page.locator('#askGo').click();
  await expect(page.locator('#toast')).toContainText('your atlas has been erased', { timeout: 20000 });

  const after = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('resonate-share', 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const inbox = await new Promise((resolve, reject) => {
      const tx = db.transaction('shared', 'readonly');
      const all = tx.objectStore('shared').getAll();
      tx.oncomplete = () => { db.close(); resolve(all.result || []); };
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const photos = await import(`/js/photos.js${v}`);
    return {
      places: localStorage.getItem('resonate.places.v1'),
      journal: localStorage.getItem('resonate.erase.v1'),
      inbox,
      snapshots: await photos.snapshotKeys(),
    };
  });
  expect(after.places).toBeNull();
  expect(after.journal, 'the recovery copy survived a successful erase').toBeNull();
  expect(after.inbox).toEqual([]);
  expect(after.snapshots).toEqual([]);
});

// ---------- saying where the pictures are, rather than assuming ----------
//
// A snapshot taken before photographs left a record names them by id. Where
// those pictures are now is a question with two answers: this device may have
// let them go an hour ago. A panel that says they are still here sends
// somebody looking for something that is not there.
test('a snapshot naming photographs does not claim they are still on this device', async ({ page }) => {
  await open(page);
  await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const photos = await import(`/js/photos.js${v}`);
    await photos.snapshotPut(JSON.stringify({
      app: 'resonate', version: 4, at: new Date().toISOString(),
      tags: [], routes: [], folios: [], correspondents: [],
      places: [{
        id: 'before1', name: 'A place from before', lat: 46.9, lng: 8.9, tags: [],
        photos: ['ph_abc123', 'ph_def456'],
      }],
    }));
  });

  await openYours(page, '#deviceSettings');
  await page.locator('#snapRestore').click();
  await expect(page.locator('#askInput')).toBeVisible();
  await page.locator('#askGo').click();

  const said = page.locator('#askWhat');
  await expect(said).toContainText('2 photographs this version does not keep');
  await expect(said, 'this device has none, and was told to go and look for them')
    .toContainText('not on this device any more');
});

// ---------- a file written before photographs left a record ----------
//
// Every archive a person has ever exported carries photographs on every place
// that had one. Refusing them would be the destructive answer, not the careful
// one: nothing is destroyed by reading a file, because the file is still on
// the disk with every picture in it. So the atlas comes home and the person is
// told what it carried, in the panel they read before either word is pressed.
//
// This can only be proved here. No node test imports js/app.js, so a sentence
// that never renders passes every one of them.
test('a backup from before comes home, and the panel names the photographs it carried', async ({ page }) => {
  await open(page);

  const file = JSON.stringify({
    app: 'resonate', version: 4, exportedAt: new Date().toISOString(),
    tags: [], routes: [], folios: [], correspondents: [], settings: {},
    places: [{
      id: 'old1', name: 'A place from before', lat: 46.2, lng: 8.2, tags: [],
      photos: ['data:image/png;base64,iVBORw0KGgo=', 'ph_abc123'],
    }],
  });

  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('/');
  await page.locator('#paletteInput').fill('>import');
  await expect(page.locator('.cmd-row').first()).toBeVisible();
  await page.keyboard.press('Enter');
  await (await chooser).setFiles({
    name: 'resonate-atlas.json', mimeType: 'application/json', buffer: Buffer.from(file),
  });

  // the sentence, before either word is pressed, and never a refusal
  const said = page.locator('#askWhat');
  await expect(said).toBeVisible({ timeout: 10000 });
  await expect(said, 'the panel counted the photographs the file carried')
    .toContainText('2 photographs this version does not keep. your backup file still has them');
  await expect(said, 'a file carrying photographs was refused instead of read')
    .not.toContainText('did not come home');
  await expect(page.locator('#askGo')).toHaveText('bring in what is missing');

  await page.locator('#askGo').click();
  await expect(page.locator('#toast'), 'the atlas was refused instead of read')
    .toContainText('1 record came in', { timeout: 10000 });

  const kept = await page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem('resonate.places.v1')).find(x => x.id === 'old1');
    return { there: !!p, field: p ? 'photos' in p : null, raw: JSON.stringify(p || {}) };
  });
  expect(kept.there, 'the place did not come home').toBe(true);
  expect(kept.field, 'a picture was kept, or the field was kept empty').toBe(false);
  expect(kept.raw.includes('data:image/'), 'a picture reached the device').toBe(false);

  // and the other word, which is the one that replaces everything. it reads
  // the archive a second time through the same door, so it fails in exactly
  // the way the merge above does when the file's marks are not carried over
  // the drawer is still open behind the panel that just closed, so the door
  // is pressed where it stands rather than asked for again
  await expect(page.locator('#impJson')).toBeVisible();
  const again = page.waitForEvent('filechooser');
  await page.locator('#impJson').click();
  await (await again).setFiles({
    name: 'resonate-atlas.json', mimeType: 'application/json', buffer: Buffer.from(file),
  });
  await expect(said).toBeVisible({ timeout: 10000 });
  await page.locator('#askAlso').click();
  await expect(page.locator('#askGo')).toHaveText('replace this atlas');
  await page.locator('#askGo').click();
  await expect(page.locator('#toast'), 'a replace was refused instead of carried out')
    .toContainText('this atlas now matches the backup file', { timeout: 10000 });

  const only = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('resonate.places.v1')).map(p => p.id));
  expect(only, 'the file is the atlas now, and nothing else is').toEqual(['old1']);
});

// ---------- the composer shows the house, and the doors decide ----------
//
// A folio is a shelf in your own house. The composer used to filter its pool by
// what may leave, and the cost was silent: a person who took the app's own
// first suggestion, an atlas of loans, pressed "compose a new folio" and was
// handed a page with eighteen places behind it and no rows on it, and no
// sentence saying why. Meanwhile "file into a folio" on the plate filtered
// nothing at all, so the same record was filable from one surface and invisible
// on the other.
//
// None of this is visible to a parser. No node test imports js/app.js.

// everything the app hands out passes through one of these, so both are caught
// at the source rather than guessed at from a rendered surface
async function watchTheDoors(page) {
  await page.addInitScript(() => {
    window.__shared = [];
    window.__copied = [];
    window.__printed = 0;
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: (d) => { window.__shared.push(d); return Promise.resolve(); },
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (t) => { window.__copied.push(String(t)); return Promise.resolve(); } },
    });
    window.print = () => { window.__printed += 1; };
    window.open = () => null;
  });
}

// three places of the person's own, one they marked never to leave, and one
// still from the sample atlas, and not yet the person's own
async function atlasWithHeldBack(page) {
  await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const { store, newPlace } = await import(`/js/store.js${v}`);
    store.load();
    store.addPlace(newPlace({ id: 'secret', name: 'My Own Front Door', lat: 47.11, lng: 7.11,
      city: 'Basel', tags: [], private: true }));
    store.addPlace(newPlace({ id: 'lent', name: 'A Loaned Place', lat: 47.22, lng: 7.22,
      city: 'Basel', tags: [], sample: true }));
  });
}

async function openTheComposer(page) {
  await page.keyboard.press('/');
  await page.locator('#paletteInput').fill('>folio');
  await expect(page.locator('.cmd-row').first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('#folioOverlay')).toBeVisible();
  await page.locator('#folNew').click();
  await expect(page.locator('#folTitle')).toBeVisible();
  await expect(page.locator('#folioOverlay'),
    'the composer repaint left keyboard focus behind on a button that no longer exists').toBeFocused();
}

// everything in, under a title, and kept on the shelf
async function encloseEverything(page, title) {
  await page.locator('#folTitle').fill(title);
  await page.locator('#folAll').click();
  await page.locator('#folKeep').click();
  await expect(page.locator('#toast')).toContainText('collection saved', { timeout: 10000 });
}

test('an atlas of loans opens a composer with every place in it', async ({ page }) => {
  await open(page, { places: 0 });
  await page.keyboard.press('/');
  await page.locator('#paletteInput').fill('>full');
  await expect(page.locator('.cmd-row').first()).toBeVisible();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Use as my atlas', exact: true }).click();

  const held = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('resonate.places.v1')).length);
  expect(held, 'the sample atlas never arrived').toBeGreaterThan(10);

  await openTheComposer(page);
  expect(await page.locator('.fol-row[data-fid]').count(),
    'the composer showed nothing, on an atlas holding everything').toBe(held);
  // and no row wears a label: the sample is real, and the word is retired
  // from every reading surface
  await expect(page.locator('.fol-row[data-fid]').first()).not.toContainText('sample');
});

test('a folio row keeps keyboard focus when its decision repaints the composer', async ({ page }) => {
  await open(page, { places: 3 });
  await openTheComposer(page);
  const row = page.locator('.fol-row[data-fid="p0"]');
  await row.focus();
  await page.keyboard.press('Enter');
  await expect(row).toHaveAttribute('aria-pressed', 'true');
  await expect(row, 'the repainted decision threw focus out of the list').toBeFocused();
});

// ---------- the atlas the app itself suggests first ----------
//
// Every place in it is a sample, and the journey this feature exists for runs
// straight into that: open the sample, press a city, hand the folio to a
// friend. It ended in four words with nothing in them, "everything enclosed
// stays behind", with no reason and nothing to do next. A person on their
// first afternoon has no way to know that a sample is not their own recommendation, or
// that editing one is what makes it theirs.
test('the folio door opens for a sample atlas, because the sample is real', async ({ page }) => {
  await watchTheDoors(page);
  await open(page, { places: 0 });
  await page.keyboard.press('/');
  await page.locator('#paletteInput').fill('>full');
  await expect(page.locator('.cmd-row').first()).toBeVisible();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Use as my atlas', exact: true }).click();

  // a city pressed on the empty bar: the folio arrives titled and full
  await page.keyboard.press('/');
  const city = page.locator('#paletteResults .cmd-row').filter({ hasText: '\u21b5 make a collection' }).first();
  await expect(city).toBeVisible();
  await city.click();
  await expect(page.locator('#folTitle')).not.toHaveValue('');
  await page.locator('#folCopy').click();

  // the link door reviews what it carries, the way the sheet door beside it
  // always has, before a byline is asked for and before anything leaves
  await expect(page.locator('#askWhat')).toContainText('This link carries');
  await page.locator('#askGo').click();

  // the door asks for a byline, then hands over: sample places are real
  // places from real people since 2026-08-11, and they travel
  const nameUp = page.locator('#nameAsk');
  if (await nameUp.isVisible()) {
    await page.locator('#nameAskLater').click();
  }
  await expect.poll(async () => page.evaluate(() => window.__shared.length),
    { message: 'no link went out for a sample folio' }).toBeGreaterThan(0);
});

test('the atlas door opens for a sample atlas, and reads its true counts', async ({ page }) => {
  await watchTheDoors(page);
  await open(page, { places: 0 });
  await page.keyboard.press('/');
  await page.locator('#paletteInput').fill('>full');
  await expect(page.locator('.cmd-row').first()).toBeVisible();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Use as my atlas', exact: true }).click();

  await page.keyboard.press('/');
  await page.locator('#paletteInput').fill('>share');
  await expect(page.locator('.cmd-row').first()).toBeVisible();
  await page.keyboard.press('Enter');
  const nameUp = page.locator('#nameAsk');
  if (await nameUp.isVisible()) await page.locator('#nameAskLater').click();

  // the review panel stands, and counts the sample as the real atlas it is
  await expect(page.locator('#shareOverlay')).toBeVisible();
  await expect(page.locator('#shareBody')).toContainText('places');
  await expect(page.locator('#shareBody'), 'the panel still calls the sample a loan')
    .not.toContainText('sample atlas');
});

// The panel counted both words and reported both as the first one, so an atlas
// holding a loan told a person who had marked nothing that they had marked it.
test('the atlas panel holds back only what the person marked, and says so', async ({ page }) => {
  await open(page, { places: 3 });
  await atlasWithHeldBack(page);
  await page.keyboard.press('/');
  await page.locator('#paletteInput').fill('>share');
  await expect(page.locator('.cmd-row').first()).toBeVisible();
  await page.keyboard.press('Enter');

  const panel = page.locator('#shareBody');
  await expect(panel).toBeVisible();
  // one word can hold a record back now: the person's own. the sample is a
  // real place from a real person and travels with everything else.
  await expect(panel).toContainText('1 record excluded from sharing');
  await expect(panel).toContainText('Included in private backups');
  await expect(panel, 'the sample was still treated as a loan')
    .not.toContainText('sample atlas');
});

test('record plates state the sharing boundary and private backups keep excluded items', async ({ page }) => {
  await open(page, {
    atlas: [
      { id: 'private-place', name: 'Private Place', lat: 47, lng: 8, tags: [],
        status: 'visited', private: true,
        provenance: { name: 'Mira', srcId: 'mira-place', adoptedAt: new Date().toISOString() } },
      { id: 'public-place', name: 'Public Place', lat: 47.1, lng: 8.1, tags: [],
        status: 'visited' },
    ],
    books: 1,
  });
  await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const { store, newRoute } = await import(`/js/store.js${v}`);
    store.load();
    store.updateBook('b0', { private: true });
    store.addRoute(newRoute({ id: 'trimmed-path', name: 'Trimmed Path', trimEnds: true,
      path: [{ lat: 46, lng: 8 }, { lat: 46.1, lng: 8.1 }] }));
  });

  await showIndex(page);
  await page.locator('.ix[data-id="private-place"]').click();
  await expect(page.locator('.held-back')).toHaveText('Excluded from sharing');
  await expect(page.locator('#pPlacePrivate')).toHaveText('Include in sharing');
  await expect(page.locator('#pHand')).toHaveCount(0);
  await expect(page.locator('#pThank')).toHaveCount(0);
  await page.locator('#pPlacePrivate').click();
  await expect(page.locator('#toast')).toHaveText('Included in sharing.');
  await expect(page.locator('#pPlacePrivate')).toHaveText('Exclude from sharing');
  await expect(page.locator('#pHand')).toBeVisible();
  await expect(page.locator('#pThank')).toBeVisible();
  await page.locator('#pPlacePrivate').click();
  await expect(page.locator('#toast')).toHaveText(
    'Excluded from links, shared files, direct messages, print, and assistant access. Included in private backups.',
  );
  await expect(page.locator('#pHand')).toHaveCount(0);
  await expect(page.locator('#pThank')).toHaveCount(0);
  await page.locator('#pClose').click();

  await showIndex(page);
  await page.locator('.ix[data-rid="trimmed-path"]').click();
  await expect(page.locator('.held-back')).toHaveText('Start and end hidden when shared');
  await expect(page.locator('#pRouteTrim')).toHaveText('Share full path');
  await page.locator('#pRouteTrim').click();
  await expect(page.locator('#pRouteTrim')).toHaveText('Hide first and last 250 m when sharing');
  await page.locator('#pRoutePrivate').click();
  await expect(page.locator('.held-back')).toHaveText('Excluded from sharing');
  await expect(page.locator('#toast')).toHaveText(
    'Excluded from links, shared files, direct messages, print, and assistant access. Included in private backups.',
  );
  await page.locator('#pClose').click();

  await showIndex(page);
  await page.locator('.ix[data-bid="b0"]').click();
  await expect(page.locator('.held-back')).toHaveText('Excluded from sharing');
  await expect(page.locator('#pBookPrivate')).toHaveText('Include in sharing');
  await page.locator('#pClose').click();

  await openYours(page);
  await expect(page.locator('#expJson')).toHaveText('download backup file');
  await expect(page.locator('#impJson')).toHaveText('restore backup file');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#expJson').click(),
  ]);
  expect(download.suggestedFilename()).toBe('resonate-private-backup.json');
  const backup = JSON.parse(await readFile(await download.path(), 'utf8'));
  expect(backup.places.find(p => p.id === 'private-place')?.private).toBe(true);
  expect(backup.routes.find(r => r.id === 'trimmed-path')?.private).toBe(true);
  expect(backup.books.find(b => b.id === 'b0')?.private).toBe(true);
});

test('an atlas with every item excluded gives the exact sharing remedy', async ({ page }) => {
  await open(page, {
    atlas: [{ id: 'private-place', name: 'Private Place', lat: 47, lng: 8,
      tags: [], status: 'visited', private: true }],
  });
  await page.keyboard.press('/');
  await page.locator('#paletteInput').fill('>share');
  await expect(page.locator('.cmd-row').first()).toBeVisible();
  await page.keyboard.press('Enter');

  await expect(page.locator('#shareOverlay')).toBeHidden();
  await expect(page.locator('#toast')).toHaveText(
    'All items are excluded from sharing. Open an item and choose Include in sharing.',
  );
});

test('a place excluded from sharing is filed, kept, and travels in no link', async ({ page }) => {
  await watchTheDoors(page);
  await open(page, { places: 3 });
  await atlasWithHeldBack(page);
  await openTheComposer(page);

  // it is in the house, so it is on the shelf
  await expect(page.locator('.fol-row[data-fid="secret"]'),
    'a place of the person\'s own had no row in their own composer').toBeVisible();
  await encloseEverything(page, 'Basel, everything');

  const filed = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('resonate.folios.v1'))[0].placeIds);
  expect(filed, 'a place that never leaves could not be filed and kept').toContain('secret');
  expect(filed).toContain('lent');

  // the door speaks before anything moves: one word can hold a record back
  await page.locator('#folCopy').click();
  const said = page.locator('#askWhat');
  await expect(said).toBeVisible();
  await expect(said).toContainText('excluded from sharing');
  await expect(said).toContainText('Included in private backups');
  await expect(said, 'the sample was still named as a reason to stay')
    .not.toContainText('sample');
  await page.locator('#askGo').click();

  // and then the second question, about what the link itself carries
  await expect(said).toContainText('This link carries');
  await page.locator('#askGo').click();

  const payload = await page.evaluate(() => {
    const url = (window.__shared[0] || {}).url || '';
    const hash = new URL(url).hash;
    return JSON.parse(window.LZString.decompressFromEncodedURIComponent(hash.slice(3)));
  });
  const names = payload.places.map(p => p.name);
  expect(names, 'a place marked never to leave went out on a link').not.toContain('My Own Front Door');
  // the sample is real and travels under the byline like everything else
  expect(names, 'a sample place was still held back').toContain('A Loaned Place');
  expect(names).toContain('Place 0');
  expect(names).toContain('Place 1');
  expect(names).toContain('Place 2');
});

test('a place that never leaves is not typeset on the sheet', async ({ page }) => {
  await watchTheDoors(page);
  await open(page, { places: 3 });
  await atlasWithHeldBack(page);
  await openTheComposer(page);
  await encloseEverything(page, 'Basel, everything');

  await page.locator('#folPrint').click();
  const said = page.locator('#askWhat');
  await expect(said).toBeVisible();
  await expect(said).toContainText('excluded from sharing');
  await page.locator('#askGo').click();
  // and then the sheet's own sentence, which was always there
  await expect(said).toContainText('cannot recall it');
  await page.locator('#askGo').click();

  const sheet = await page.evaluate(() => document.querySelector('#sheet').innerHTML);
  expect(sheet.includes('My Own Front Door'), 'a place that never leaves was typeset').toBe(false);
  expect(sheet.includes('A Loaned Place'), 'the sample was still held off the sheet').toBe(true);
  expect(sheet).toContain('Place 0');
  expect(sheet).toContain('Place 2');
});


// The old filter left the id in the selection while the row was gone, so the
// counter read more enclosed than there were rows to see, and that count was
// written straight back to the shelf.
test('a folio counts what it shows, and shows what it counts', async ({ page }) => {
  await open(page, { places: 3 });
  await atlasWithHeldBack(page);
  await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const { store, newFolio } = await import(`/js/store.js${v}`);
    store.load();
    store.addFolio(newFolio({ id: 'f1', title: 'Basel, everything', placeIds: ['p0', 'secret', 'lent'] }));
  });

  await page.keyboard.press('/');
  await page.locator('#paletteInput').fill('>folio');
  await expect(page.locator('.cmd-row').first()).toBeVisible();
  await page.keyboard.press('Enter');
  await page.locator('.fol-shelf-row').first().click();
  await expect(page.locator('#folTitle')).toBeVisible();

  const rowsIn = await page.locator('.fol-row[aria-pressed="true"]').count();
  const counted = Number((await page.locator('.fol-count').textContent()).trim().split(/\s+/)[0]);
  expect(rowsIn, 'the count and the rows disagreed').toBe(counted);
  expect(counted).toBe(3);
  // and the count line names what will never travel. it used to say those
  // records stay "behind at the door", under a button reading "keep this
  // folio", and keeping takes every one of them through no door at all.
  // one word can hold a record back now, and the line says it by that word.
  await expect(page.locator('.fol-count')).toContainText('1 excluded from sharing');
});

// ---------- the city is something you can hold ----------
//
// Every place has always known its city, and the printed sheet has always been
// divided by it. Nothing else was: the composer listed every record flat, the
// empty command bar offered the six places saved earliest, and the index knew
// how to sort by city but not how to hand one over. None of that is visible to
// a parser either, which is why these are here and not in test/find.test.mjs.

// Four cities, unevenly held, so that an ordering by count is provable and no
// two counts are equal. They are written oldest first in the order Porto,
// Berlin, Basel, Lisboa, so that anything still answering by the date a place
// was saved comes back in exactly the wrong order and says so.
const CITIES = (() => {
  const now = new Date().toISOString();
  const held = [['Porto', 'Portugal', 1], ['Berlin', 'Germany', 2],
    ['Basel', 'Switzerland', 4], ['Lisboa', 'Portugal', 5]];
  let n = 0;
  const out = [];
  for (const [city, country, k] of held) {
    for (let i = 0; i < k; i++) {
      n += 1;
      out.push({
        id: `c${n}`, name: `${city} spot ${i}`, lat: 40 + n * 0.05, lng: 8 + n * 0.05,
        city, country, tags: [], status: i % 2 ? 'wishlist' : 'visited',
        note: '', createdAt: now, updatedAt: now,
      });
    }
  }
  out.push({
    id: 'nowhere', name: 'A Place With No City', lat: 44, lng: 9, tags: [],
    status: 'visited', note: '', createdAt: now, updatedAt: now,
  });
  return out;
})();

const openCities = (page) => open(page, { atlas: CITIES });
const cmdRows = (page) => page.locator('#paletteResults .cmd-row');

test('an empty command bar offers the cities you keep, most held first', async ({ page }) => {
  await openCities(page);
  await page.keyboard.press('/');
  await expect(cmdRows(page).first()).toBeVisible();

  // the six places saved earliest are gone from this surface entirely
  const names = await cmdRows(page).locator('.row-name').allTextContents();
  expect(names, 'the empty bar still answered with places')
    .toEqual(['Lisboa, Portugal', 'Basel, Switzerland', 'Berlin, Germany', 'Porto, Portugal']);
  // a place with no city is not a city, and a folio cannot be titled with it
  expect(names.join(' ')).not.toContain('off the map');
  // and the row says what it is and what pressing it makes, in the column
  // where every other row says it. it said "compose", with nothing after it,
  // which names neither.
  await expect(cmdRows(page).first().locator('.row-sub')).toContainText('make a collection');
  await expect(cmdRows(page).first().locator('.row-sub')).toContainText('5 places');

  // One sentence orients the surface; the two direct ways to add a place are
  // controls rather than a second paragraph repeating the purpose.
  await expect(page.locator('.cmd-teach')).toHaveCount(1);
  await expect(page.locator('.cmd-teach')).toContainText('Search your atlas or add something');
  await expect(page.locator('#capHere')).toContainText('use my location');
  await expect(page.locator('#capPhoto')).toContainText('choose a photo');

  // and on a phone the city is not eaten by the column beside it. Both parts
  // flow inside one label box now, so measure that box rather than the inline
  // spans inside it: Firefox correctly gives inline spans no clientWidth.
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(cmdRows(page).first()).toBeVisible();
  // measured in the type it is set in: a width read while the fallback font is
  // still standing in is a width nobody will ever see
  await page.evaluate(() => document.fonts.ready);
  const clipped = await page.locator('#paletteResults .row-name.city').evaluateAll(
    ns => ns.filter(n => {
      const s = getComputedStyle(n);
      const r = n.getBoundingClientRect();
      const row = n.closest('.cmd-row').getBoundingClientRect();
      return s.textOverflow === 'ellipsis'
        || ((s.overflowX === 'hidden' || s.overflowX === 'clip')
          && n.scrollWidth > n.clientWidth + 1)
        || r.left < row.left - 1 || r.right > row.right + 1;
    }).map(n => n.textContent));
  expect(clipped, `a city was cut off on a phone: ${clipped.join(', ')}`).toEqual([]);
});

test('a city pressed on the empty bar is a folio already titled and already full', async ({ page }) => {
  await watchTheDoors(page);
  await openCities(page);
  await page.keyboard.press('/');
  await expect(cmdRows(page).first()).toBeVisible();

  // nothing is chosen until somebody chooses. an untyped bar offers the cities
  // a person keeps places in, and nobody asked for the top one: enter here used
  // to hand over a folio titled with a city they had not named.
  await page.keyboard.press('Enter');
  await expect(page.locator('#folioOverlay')).toBeHidden();
  await expect(page.locator('#paletteOverlay')).toBeVisible();

  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');

  // the title is filled in, because it was known
  await expect(page.locator('#folTitle')).toHaveValue('Lisboa, Portugal');
  // the attention is on the one thing that could not be known
  expect(await page.evaluate(() => document.activeElement.id),
    'the composer asked for something it already knew').toBe('folDed');
  // the whole atlas is the pool, and the city pressed is the part enclosed
  await expect(page.locator('.fol-count')).toContainText('5 selected · 13 visible');
  const inRows = await page.locator('.fol-row[aria-pressed="true"] .nm').allTextContents();
  expect(inRows.every(n => n.startsWith('Lisboa')), `something else was enclosed: ${inRows}`).toBe(true);
  expect(inRows).toHaveLength(5);

  // and it travels as itself, once the door has said what it is carrying
  await page.locator('#folCopy').click();
  await page.locator('#askGo').click();
  const payload = await page.evaluate(() => {
    const url = (window.__shared[0] || {}).url || '';
    return JSON.parse(window.LZString.decompressFromEncodedURIComponent(new URL(url).hash.slice(3)));
  });
  expect(payload.title).toBe('Lisboa, Portugal');
  expect(payload.places.map(p => p.city)).toEqual(['Lisboa', 'Lisboa', 'Lisboa', 'Lisboa', 'Lisboa']);
});

test('the composer is divided by city, and a city goes in or out on one press', async ({ page }) => {
  await openCities(page);
  await openTheComposer(page);

  // the same key the printed sheet is divided by, and the same words for the
  // records that have no city at all
  const bands = await page.locator('.fol-band .fb-city').allTextContents();
  expect(bands).toEqual(['lisboa, portugal', 'basel, switzerland', 'berlin, germany',
    'porto, portugal', 'off the map']);

  // a new folio encloses nothing, so the word offers to take a city in, and
  // one press is the whole of the four rows it stands over
  const basel = page.locator('.fol-band', { hasText: 'basel' }).locator('.fb-all');
  await expect(basel).toHaveText('add all');
  await basel.click();
  await expect(page.locator('.fol-count')).toContainText('4 selected · 13 visible');
  await expect(basel).toHaveText('remove all');
  const inside = await page.locator('.fol-row[aria-pressed="true"] .nm').allTextContents();
  expect(inside.every(n => n.startsWith('Basel')), `a press reached past its own city: ${inside}`).toBe(true);
  expect(inside).toHaveLength(4);

  // and the same word gives them all back
  await basel.click();
  await expect(page.locator('.fol-count')).toContainText('0 selected · 13 visible');
});

// ---------- a title names; Find items finds ----------
//
// One field doing both jobs made naming a collection a hidden command. The
// separate search uses the library's shared semantics, while selected records
// remain selected even when the current query hides their rows.

const bandsShown = (page) => page.locator('.fol-band .fb-city').allTextContents();

test('title and Find items each do one job, and filtering preserves selection', async ({ page }) => {
  await openCities(page);
  await openTheComposer(page);

  // The page opens for browsing, without summoning a phone keyboard.
  expect(await page.locator('.fol-row[data-fid]').count()).toBe(13);
  expect(await page.evaluate(() => document.activeElement.id),
    'the composer opened a keyboard nobody asked for').not.toBe('folFindItems');

  const asItWas = await bandsShown(page);
  await page.locator('#folTitle').fill('A weekend for Ana');
  expect(await page.locator('.fol-row[data-fid]').count(),
    'typing a title filtered the list').toBe(13);
  expect(await bandsShown(page), 'typing a title reordered the list').toEqual(asItWas);
  await expect(page.locator('#folCityIn')).toHaveCount(0);

  await page.locator('#folFindItems').fill('Porto');
  await expect(page.locator('.fol-row[data-fid]')).toHaveCount(1);
  await expect(page.locator('.fol-row[data-fid] .nm')).toHaveText('Porto spot 0');
  await expect(page.locator('.fol-count')).toContainText('0 selected · 1 visible');
  await page.locator('.fol-row[data-fid]').click();
  await expect(page.locator('.fol-count')).toContainText('1 selected · 1 visible');

  // A second query changes only what is visible. The Porto choice remains in
  // the count and returns still selected when the query is cleared.
  await page.locator('#folFindItems').fill('Basel');
  await expect(page.locator('.fol-row[data-fid]')).toHaveCount(4);
  await expect(page.locator('.fol-count')).toContainText('1 selected · 4 visible');
  await expect(page.locator('#folAll')).toHaveText('select visible');
  await page.locator('#folFindItems').fill('');
  await expect(page.locator('.fol-row[data-fid]')).toHaveCount(13);
  await expect(page.locator('.fol-row[data-fid="c1"]')).toHaveAttribute('aria-pressed', 'true');

  // The title alone is saved as the title.
  await page.locator('#folKeep').click();
  await expect(page.locator('#toast')).toContainText('collection saved', { timeout: 10000 });
  const shelved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('resonate.folios.v1'))[0]);
  expect(shelved.title).toBe('A weekend for Ana');
  expect(shelved.placeIds).toHaveLength(1);
});

test('Find items searches places, paths, books and tags, with an explicit empty result', async ({ page }) => {
  await open(page, { places: 3, ways: 1, books: 1 });
  await openTheComposer(page);
  await page.locator('#folTitle').fill('Library sampler');

  await page.locator('#folFindItems').fill('Nature');
  await expect(page.locator('.fol-row[data-fid]')).toHaveCount(3);
  await expect(page.locator('.fol-row[data-wid]')).toHaveCount(0);
  await expect(page.locator('.fol-row[data-bkid]')).toHaveCount(0);

  await page.locator('#folFindItems').fill('A Writer');
  await expect(page.locator('.fol-row[data-bkid]')).toHaveCount(1);
  await expect(page.locator('.fol-row[data-fid], .fol-row[data-wid]')).toHaveCount(0);

  await page.locator('#folFindItems').fill('A walk');
  await expect(page.locator('.fol-row[data-wid]')).toHaveCount(1);
  await expect(page.locator('.fol-row[data-fid], .fol-row[data-bkid]')).toHaveCount(0);

  await page.locator('#folFindItems').fill('nothing in this atlas');
  await expect(page.locator('.fol-count')).toContainText('0 selected · 0 visible');
  await expect(page.locator('.fol-no-results')).toContainText(
    'No items match “nothing in this atlas”.',
  );
  await expect(page.locator('#folClearFind')).toHaveText('clear search');
  await expect(page.locator('#folAll')).toHaveCount(0);
  await page.locator('#folClearFind').click();
  await expect(page.locator('#folFindItems')).toBeFocused();
  await expect(page.locator('.fol-count')).toContainText('0 selected · 5 visible');
  await expect(page.locator('.fol-no-results')).toHaveCount(0);
  await expect(page.locator('#folTitle')).toHaveValue('Library sampler');
});

// A folio kept last winter must be retitleable and searchable without its
// membership shifting under the hands doing it.
test('a kept collection can be retitled and searched without losing hidden selections',
  async ({ page }) => {
    await openCities(page);
    await page.evaluate(async () => {
      const v = new URL(document.querySelector('script[type=module]').src).search;
      const { store, newFolio } = await import(`/js/store.js${v}`);
      store.load();
      store.addFolio(newFolio({ id: 'f1', title: 'A Winter Folio', placeIds: ['c1', 'c5', 'c8'] }));
    });
    await page.keyboard.press('/');
    await page.locator('#paletteInput').fill('>folio');
    await expect(page.locator('.cmd-row').first()).toBeVisible();
    await page.keyboard.press('Enter');
    await page.locator('.fol-shelf-row').first().click();
    await expect(page.locator('#folTitle')).toBeVisible();

    // a folio opened from the shelf is read, not composed: it lists what it
    // encloses and nothing else, and the house is one word away
    expect(await page.locator('.fol-row[data-fid]').count()).toBe(3);
    await expect(page.locator('.fol-count')).toContainText('3 selected');
    await expect(page.locator('.fol-count')).not.toContainText('of 13');
    await expect(page.locator('#folNone')).toHaveCount(0);
    await page.locator('#folWiden').click();

    // and widened, it is the composer again: every row on the page, the three
    // still in, and the title carried across rather than lost
    expect(await page.locator('.fol-row[data-fid]').count()).toBe(13);
    await expect(page.locator('.fol-count')).toContainText('3 selected · 13 visible');
    await expect(page.locator('#folTitle')).toHaveValue('A Winter Folio');

    await page.locator('#folFindItems').fill('Basel');
    await expect(page.locator('.fol-row[data-fid]')).toHaveCount(4);
    await expect(page.locator('.fol-count')).toContainText('3 selected · 4 visible');

    // Retitling changes neither the query nor the three selected ids.
    for (const title of ['B', 'Ba', 'Bas', 'Basel', 'Basel, in the rain']) {
      await page.locator('#folTitle').fill(title);
      await expect(page.locator('.fol-count'),
        `"${title}" moved a place in or out of a kept folio`).toContainText('3 selected · 4 visible');
    }
    expect(await page.locator('.fol-row[data-fid] .nm').allTextContents())
      .toEqual(['Basel spot 0', 'Basel spot 1', 'Basel spot 2', 'Basel spot 3']);
    await page.locator('#folFindItems').fill('');
    expect(await page.locator('.fol-row[data-fid]').count()).toBe(13);
    expect(await page.locator('.fol-row[aria-pressed="true"]').count()).toBe(3);

    // and what is kept is what was held, under the new title
    await page.locator('#folKeep').click();
    await expect(page.locator('#toast')).toContainText('changes saved', { timeout: 10000 });
    const shelved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('resonate.folios.v1'))[0]);
    expect(shelved.title).toBe('Basel, in the rain');
    expect(shelved.placeIds.slice().sort(),
      'a folio lost places to a title nobody meant as a filter').toEqual(['c1', 'c5', 'c8']);
  });

// A city named in Find items can be taken in one explicit press. The title is
// deliberately irrelevant to this offer.
test('the city a Find-items query names is offered in one press', async ({ page }) => {
  await openCities(page);
  await openTheComposer(page);

  // A title is only a title.
  await page.locator('#folTitle').fill('Basel with Ana');
  await expect(page.locator('#folCityIn')).toHaveCount(0);

  await page.locator('#folFindItems').fill('Basel');
  const said = page.locator('#folCityIn');
  await expect(said).toBeVisible();
  await expect(said.locator('.fo-city')).toHaveText('basel, switzerland');
  await expect(said.locator('.fo-word')).toContainText('4 places');
  await expect(said.locator('.fo-word')).toContainText('add all');
  await expect(page.locator('.fol-row[data-fid]')).toHaveCount(4);
  await expect(page.locator('.fol-count')).toContainText('0 selected · 4 visible');
  // and on a phone neither half of the line is cut. the name column yields and
  // the word holds its ground, exactly as in the command line's city row.
  await page.setViewportSize({ width: 375, height: 812 });
  await page.evaluate(() => document.fonts.ready);
  const cut = await page.locator('#folCityIn .fo-word').evaluateAll(
    ns => ns.filter(n => n.scrollWidth > n.clientWidth + 1).map(n => n.textContent));
  expect(cut, `the offer was cut off on a phone: ${cut.join(', ')}`).toEqual([]);

  await said.click();
  await expect(page.locator('.fol-count')).toContainText('4 selected · 4 visible');
  const inside = await page.locator('.fol-row[aria-pressed="true"] .nm').allTextContents();
  expect(inside.every(n => n.startsWith('Basel')), `the press reached past its city: ${inside}`).toBe(true);
  // a city already whole has nothing left to offer, and a word that does
  // nothing when pressed is worse than no word at all
  await expect(page.locator('#folCityIn'),
    'a city already entirely enclosed was offered again').toHaveCount(0);
  // A query with no answer says so; the four hidden selections remain intact.
  await page.locator('#folFindItems').fill('three for Ana');
  await expect(page.locator('#folCityIn')).toHaveCount(0);
  await expect(page.locator('.fol-row[data-fid]')).toHaveCount(0);
  await expect(page.locator('.fol-count')).toContainText('4 selected · 0 visible');
  await expect(page.locator('.fol-no-results')).toBeVisible();
});

// Two cities, one at a time, and a folio of both at the end. The journey that
// would quietly lose half a folio if typing a title were ever allowed to touch
// what is enclosed.
test('a folio can find and collect two cities without turning its title into a command', async ({ page }) => {
  await watchTheDoors(page);
  await openCities(page);
  await openTheComposer(page);

  await page.locator('#folTitle').fill('Basel and Berlin');
  await page.locator('#folFindItems').fill('Basel');
  await page.locator('#folCityIn').click();
  await expect(page.locator('.fol-count')).toContainText('4 selected · 4 visible');

  // Now find the other city. The first city's rows leave the view, but its
  // four selections remain in the collection.
  await page.locator('#folFindItems').fill('Berlin');
  expect(await page.locator('.fol-row[data-fid]').count()).toBe(2);
  await expect(page.locator('.fol-count'),
    'the folio lost what the query stopped showing').toContainText('4 selected · 2 visible');
  await page.locator('#folCityIn').click();
  await expect(page.locator('.fol-count')).toContainText('6 selected · 2 visible');

  // Clear Find items and both cities return selected, then both travel.
  await page.locator('#folFindItems').fill('');
  await expect(page.locator('.fol-count')).toContainText('6 selected · 13 visible');
  await page.locator('#folCopy').click();
  await page.locator('#askGo').click();
  const payload = await page.evaluate(() => {
    const url = (window.__shared[0] || {}).url || '';
    return JSON.parse(window.LZString.decompressFromEncodedURIComponent(new URL(url).hash.slice(3)));
  });
  const cities = payload.places.map(p => p.city).sort();
  expect(cities, 'half the folio stayed behind when the title moved on')
    .toEqual(['Basel', 'Basel', 'Basel', 'Basel', 'Berlin', 'Berlin']);
});

// the answer-with-three bar is raised by leaving a folio somebody sent, which
// is the exchange it exists for: they gave you a titled few, you give back.
// it stops at the report, because whether the bar is raised at all is itself
// something worth asking about.
async function aFolioArrives(page) {
  const url = await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const { store } = await import(`/js/store.js${v}`);
    const { makeFolioUrl } = await import(`/js/share.js${v}`);
    store.load();
    return makeFolioUrl({
      title: 'Two of mine', dedication: 'for you', author: 'bruno',
      tags: [], places: store.places.slice(0, 2),
    });
  });
  await arrive(page, url);
  // Twenty seconds, and it used to be eight, which was tighter than this
  // suite's own default of ten and said nothing about why. On 17 August 2026 it
  // ran out in firefox on CI, once, on a revision that had passed the same test
  // half an hour earlier and differed from it by a markdown file. The claim
  // here is that a folio link opens the report, not that a loaded runner boots
  // an app and parses a payload inside eight seconds.
  //
  // If it goes again, the suspect is the reload rather than the budget: it
  // lands while the service worker is still installing under a fresh version
  // marker, and that is the one moment in a visit when the shell can be served
  // by a worker that is not finished.
  await expect(page.locator('#reportOverlay')).toBeVisible({ timeout: 20000 });
  await page.locator('#rpLeave').click();
}

async function raiseTheAsk(page) {
  await aFolioArrives(page);
  await expect(page.locator('#answerBar')).toBeVisible();
  await page.locator('#answerGo').click();
  await expect(page.locator('#folTitle')).toHaveValue('three for bruno');
}

// The ask is bounded at three on purpose, and a single press that quietly
// enclosed nine would break the only promise that surface makes.
test('the surface that promises three has no word that takes a whole city', async ({ page }) => {
  await openCities(page);
  await raiseTheAsk(page);

  // the page is still divided, so a person can find the city they want
  expect(await page.locator('.fol-band').count()).toBeGreaterThan(1);
  // but there is no word on any of those bands
  expect(await page.locator('.fol-band .fb-all').count(),
    'a single press could have enclosed a whole city under a cap of three').toBe(0);
});

test('typing a city offers the city, and enter still flies to a place', async ({ page }) => {
  await openCities(page);
  await page.keyboard.press('/');
  await page.locator('#paletteInput').fill('lisboa');
  await expect(cmdRows(page).first()).toBeVisible();

  // the city is offered under its own name, with no verb in front of it
  const city = cmdRows(page).filter({ hasText: '↵ make a collection' });
  await expect(city.locator('.row-name')).toHaveText('Lisboa, Portugal');
  // and it stands above the person's own places: the first row, the one enter
  // takes, is still a place, exactly as it was before any of this existed
  await expect(cmdRows(page).first().locator('.row-name')).toHaveText(/^Lisboa spot/);
  await page.keyboard.press('Enter');
  await expect(page.locator('#plate')).toBeVisible();
  await expect(page.locator('#plate .plate-name')).toHaveText(/Lisboa spot/);

  // pressing the city itself is the other road
  await page.keyboard.press('Escape');
  await page.keyboard.press('/');
  await page.locator('#paletteInput').fill('lisboa');
  await cmdRows(page).filter({ hasText: '↵ make a collection' }).click();
  await expect(page.locator('#folTitle')).toHaveValue('Lisboa, Portugal');
});

// ---------- the city you press is the city you see ----------
//
// An atlas the size a real one reaches. Five cities, forty two places, held
// unevenly so that pressing the fourth most held is a press the ranking would
// have put well below the fold.
const MANY = (() => {
  const now = new Date().toISOString();
  const held = [['Lisboa', 'Portugal', 12], ['Basel', 'Switzerland', 9],
    ['Berlin', 'Germany', 8], ['Porto', 'Portugal', 7], ['Kyoto', 'Japan', 6]];
  let n = 0;
  const out = [];
  for (const [city, country, k] of held) {
    for (let i = 0; i < k; i++) {
      n += 1;
      out.push({
        id: `m${n}`, name: `${city} spot ${i}`, lat: 40 + n * 0.05, lng: 8 + n * 0.05,
        city, country, tags: [], status: 'visited', note: '',
        createdAt: now, updatedAt: now,
      });
    }
  }
  return out;
})();

// The headline gesture of the whole feature. It opened a composer whose pool
// is the whole atlas, which is right, ordered for browsing, which left the
// city just pressed somewhere under the fold: on a phone, not one row of it
// was on the screen, and the press read as though it had been ignored.
test('the city you press is the first band, and its rows are on the screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await open(page, { atlas: MANY });
  await page.keyboard.press('/');
  await expect(cmdRows(page).first()).toBeVisible();

  // Porto is fourth by how much it is held, so the ranking would bury it
  await cmdRows(page).filter({ hasText: 'Porto,' }).click();
  await expect(page.locator('#folTitle')).toHaveValue('Porto, Portugal');
  await expect(page.locator('.fol-band .fb-city').first(),
    'the composer opened on somebody else\'s city').toHaveText('porto, portugal');

  const first = page.locator('.fol-row[data-fid]').first();
  await expect(first.locator('.nm')).toHaveText(/^Porto spot/);
  await expect(first, 'the press landed on a screen with no row of that city on it')
    .toBeInViewport();
  // and the whole atlas is still the pool, so a guess can still be corrected
  await expect(page.locator('.fol-count')).toContainText('7 selected · 42 visible');
  expect(await page.locator('.fol-band').count(), 'the other cities were taken away').toBe(5);
});

// Every place captured with no signal has no city, and a bar whose one answer
// is a city had nothing whatever to say to that atlas.
const NO_CITY = (() => {
  const day = (n) => new Date(Date.UTC(2026, 0, n)).toISOString();
  return [
    { id: 'n1', name: 'The Oldest', lat: 46.1, lng: 8.1, createdAt: day(1), updatedAt: day(1) },
    { id: 'n2', name: 'The Middle', lat: 46.2, lng: 8.2, createdAt: day(2), updatedAt: day(2) },
    { id: 'n3', name: 'The Newest', lat: 46.3, lng: 8.3, createdAt: day(3), updatedAt: day(3) },
  ].map(p => ({ ...p, tags: [], status: 'visited', note: '' }));
})();

test('an atlas whose places have no city still opens onto something true', async ({ page }) => {
  await open(page, { atlas: NO_CITY });
  await page.keyboard.press('/');
  await expect(cmdRows(page).first(), 'the bar opened onto a blank').toBeVisible();

  // the places themselves, most recently touched nearest the hand
  const names = await cmdRows(page).locator('.row-name').allTextContents();
  expect(names).toEqual(['The Newest', 'The Middle', 'The Oldest']);
  // and the one concise line that teaches the bar is still above them
  await expect(page.locator('.cmd-teach')).toHaveCount(1);
  // a row does what a row of that kind has always done
  await cmdRows(page).first().click();
  await expect(page.locator('#plate .plate-name')).toHaveText('The Newest');
});

// Twenty four cities, one place each, so the list runs past the box.
const MANY_CITIES = (() => {
  const now = new Date().toISOString();
  return Array.from({ length: 24 }, (_, i) => ({
    id: `q${i}`, name: `Spot ${i}`, lat: 40 + i * 0.1, lng: 8 + i * 0.1,
    city: `City ${String.fromCharCode(65 + i)}`, country: 'Nowhere',
    tags: [], status: 'visited', note: '', createdAt: now, updatedAt: now,
  }));
})();

test('every city is offered, and arrowing to one brings the box with it', async ({ page }) => {
  await open(page, { atlas: MANY_CITIES });
  await page.keyboard.press('/');
  await expect(cmdRows(page).first()).toBeVisible();
  expect(await cmdRows(page).count(),
    'the list was cut, and nothing on the screen said so').toBe(24);

  // the box genuinely scrolls, or the rest of this proves nothing
  const overflows = await page.locator('#paletteResults').evaluate(el => el.scrollHeight > el.clientHeight + 1);
  expect(overflows, 'the box held every row, so nothing could walk out of it').toBe(true);

  // Twenty-four presses and not twenty-three: the untyped bar lights no row,
  // so the first press chooses the first row. Results read top to bottom, and
  // the down arrow follows that same direction.
  for (let i = 0; i < 24; i++) await page.keyboard.press('ArrowDown');
  const lit = page.locator('#paletteResults .cmd-row.hl');
  await expect(lit.locator('.row-name')).toHaveText('City X, Nowhere');
  await expect(page.locator('#paletteStatus'),
    'the keyboard choice was visible but not named to a reader')
    .toContainText('City X, Nowhere');
  await expect(page.locator('#paletteStatus')).toContainText('Result 24 of 24');
  await expect(page.locator('#paletteInput')).not.toHaveAttribute('aria-activedescendant');
  const inside = await lit.evaluate((el) => {
    const box = el.closest('.cmd-results').getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return r.top >= box.top - 1 && r.bottom <= box.bottom + 1;
  });
  expect(inside, 'the highlight walked out of the box, and enter would act on a row nobody can see')
    .toBe(true);

  // and enter acts on the row that is lit
  await page.keyboard.press('Enter');
  await expect(page.locator('#folTitle')).toHaveValue('City X, Nowhere');
});

test('a typed word says how many cities it did not show', async ({ page }) => {
  await open(page, { atlas: MANY_CITIES });
  await page.keyboard.press('/');
  await page.locator('#paletteInput').fill('city');
  await expect(cmdRows(page).first()).toBeVisible();
  // three cities are the offer, and the places are the answer, so the rest
  // are said in a line rather than left as a silence
  expect(await page.locator('#paletteResults .cmd-row .row-name.city').count()).toBe(3);
  await expect(page.locator('.cmd-hint')).toContainText('21 more cities');
});

// Two cities of the same name in two countries, long enough that the row must
// use a second line to keep both parts of the label.
//
// The label grew on 19 Aug 2026. The command row used to hold the name and the
// mono hint on one line, so the name was squeezed against a hint that cannot
// shrink, and 'Sankt Johann im Pongau' was already too long for what was left.
// The row wraps now and the name gets the whole width, which is the point of
// that change and also the end of this fixture as it stood. The rule under
// test did not move until folded-phone support did: now neither half yields.
const TWINS = (() => {
  const now = new Date().toISOString();
  const out = [];
  for (const country of ['Austria', 'Germany']) {
    for (let i = 0; i < 5; i++) {
      out.push({
        id: `${country}${i}`, name: `${country} spot ${i}`,
        lat: 47 + i * 0.01, lng: 13 + i * 0.01,
        city: 'Sankt Johann im Pongau im Salzburger Land', country,
        tags: [], status: 'visited', note: '', createdAt: now, updatedAt: now,
      });
    }
  }
  return out;
})();

test('a city row keeps both its city and its country whole', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await open(page, { atlas: TWINS });
  await page.keyboard.press('/');
  await expect(cmdRows(page).first()).toBeVisible();
  // a width read while the fallback font is still standing in is a width
  // nobody will ever see, and this test is entirely about widths
  await page.evaluate(() => document.fonts.ready);

  // It genuinely wraps, or a no-clipping assertion could pass without ever
  // exercising the narrow state it is meant to protect.
  const lines = await page.locator('#paletteResults .row-name.city').first().evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return new Set([...range.getClientRects()].map(r => Math.round(r.top))).size;
  });
  expect(lines, 'the fixture fit on one line, so it proved nothing about wrapping')
    .toBeGreaterThan(1);

  const towns = await page.locator('#paletteResults .ct-town').allTextContents();
  expect(towns).toEqual([
    'Sankt Johann im Pongau im Salzburger Land',
    'Sankt Johann im Pongau im Salzburger Land',
  ]);
  const lands = await page.locator('#paletteResults .ct-land').allTextContents();
  expect(lands).toEqual([', Austria', ', Germany']);
  const clipped = await page.locator('#paletteResults .row-name.city').evaluateAll(
    ns => ns.filter(n => {
      const s = getComputedStyle(n);
      return s.textOverflow === 'ellipsis'
        || ((s.overflowX === 'hidden' || s.overflowX === 'clip')
          && n.scrollWidth > n.clientWidth + 1);
    }).map(n => n.textContent));
  expect(clipped, `a city or country was cut: ${clipped.join(', ')}`).toEqual([]);
});

// A place that knows its country and not its city waits under the country
// alone, and the row that protects the country by cutting it off the front of
// the label had nothing left in front of the comma: it read ", Iceland".
test('a city row that is only a country is written as one', async ({ page }) => {
  const now = new Date().toISOString();
  await open(page, {
    atlas: [
      { id: 'i1', name: 'A Hut', lat: 64, lng: -21, country: 'Iceland' },
      { id: 'i2', name: 'A Pool', lat: 65, lng: -20, country: 'Iceland' },
      { id: 'i3', name: 'A Bar', lat: 38, lng: -9, city: 'Lisboa', country: 'Portugal' },
    ].map(p => ({ ...p, tags: [], status: 'visited', note: '', createdAt: now, updatedAt: now })),
  });
  await page.keyboard.press('/');
  await expect(cmdRows(page).first()).toBeVisible();

  const names = await cmdRows(page).locator('.row-name').allTextContents();
  expect(names, 'a label was written with nothing in front of its comma')
    .toEqual(['Iceland', 'Lisboa, Portugal']);
  // and only the label with two parts in it is drawn in two parts
  expect(await page.locator('#paletteResults .ct-land').count()).toBe(1);
});

// My Lisbon places tagged food that I still want to go to. Three thoughts the
// app could hold one at a time and had no way of joining.
test('a band in the index composes a folio from the arrangement showing', async ({ page }) => {
  await openCities(page);
  await showIndex(page);
  // the arrangement is one cycling word now: newest, a-z, nearest, by city
  await expect(page.locator('#sortWord')).toHaveText('newest');
  await page.locator('#sortWord').click();
  await page.locator('#sortWord').click();
  await page.locator('#sortWord').click();
  await expect(page.locator('#sortWord')).toHaveText('by city');
  await expect(page.locator('.ix-band').first()).toBeVisible();

  // one band per city, and the placeless get a heading and no word: a folio
  // needs a title and off the map is not a city anybody asked for
  const bands = await page.locator('.ix-band').allTextContents();
  expect(bands.some(b => b.includes('off the map')), 'the placeless lost their heading').toBe(true);
  expect(await page.locator('.ix-band', { hasText: 'off the map' }).locator('.ix-fol').count()).toBe(0);

  // now narrow it, and press the word on the city that is left
  await page.locator('[data-status="wishlist"]').click();
  await page.locator('.ix-band', { hasText: 'lisboa' }).locator('.ix-fol').click();

  await expect(page.locator('#folTitle')).toHaveValue('Lisboa, Portugal');
  const rows = await page.locator('.fol-row[data-fid] .nm').allTextContents();
  expect(rows, 'the composer gave back the rows the filter had just taken away')
    .toEqual(['Lisboa spot 1', 'Lisboa spot 3']);
  await expect(page.locator('.fol-count')).toContainText('2 selected · 2 visible');
});

// The ask matcher substring-matched any word of any length, so "do" answered
// for LonDON, "in" for BerlIN, and the report printed the total at the person
// as a count of what their atlas held.
test('an ask is answered by words, not by letters found inside city names', async ({ page }) => {
  await openCities(page);
  const url = await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const { makeAskUrl } = await import(`/js/share.js${v}`);
    // the old matcher read this as six runs of letters. "in" was one of them,
    // and it is inside BerlIN, so the answer to a question about Lisboa was
    // two places in Germany, counted out loud as though the atlas had answered
    return makeAskUrl({ from: 'bruno', q: 'where do we eat in Lisboa?' });
  });
  await arrive(page, url);
  // Twenty, not eight, for the reason given in full at the folio helper: eight
  // is tighter than this suite's own default of ten and says nothing about why,
  // and the claim is that the link opens the report rather than that a loaded
  // runner boots an app and parses a payload inside eight seconds. That fix
  // landed on 17 August 2026 on the one site that had failed, and these three
  // were the same shape and were not swept. Two days later the first of them
  // went red in firefox on CI, which is what a fix applied only where it hurt
  // buys you.
  await expect(page.locator('#reportOverlay')).toBeVisible({ timeout: 20000 });

  await expect(page.locator('.rp-evidence')).toContainText('5');
  await page.locator('#askCompose').click();
  const rows = await page.locator('.fol-row[data-fid] .nm').allTextContents();
  expect(rows, 'the ask answered with places it had only found letters inside')
    .toEqual(['Lisboa spot 0', 'Lisboa spot 1', 'Lisboa spot 2', 'Lisboa spot 3', 'Lisboa spot 4']);
});

// A word matches on its own edges, which is right, and it left the singular
// and the plural as two different words. "a good bar" answered nothing in an
// atlas that holds Wine Bars, and an ask nothing answers prints a report with
// no way to reply on it at all: the whole exchange stops on one letter.
const BARS = (() => {
  const now = new Date().toISOString();
  return [
    ['Wine Bars', 'Lisboa'], ['The Tapas Bars', 'Lisboa'], ['A Bakery', 'Lisboa'],
  ].map(([name, city], i) => ({
    id: `b${i}`, name, lat: 38 + i * 0.01, lng: -9 + i * 0.01, city, country: 'Portugal',
    tags: [], status: 'visited', note: '', createdAt: now, updatedAt: now,
  }));
})();

test('an ask in the singular is answered by an atlas kept in the plural', async ({ page }) => {
  await open(page, { atlas: BARS });
  const url = await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const { makeAskUrl } = await import(`/js/share.js${v}`);
    // no city in the question: the plural is the whole of what is being asked
    return makeAskUrl({ from: 'bruno', q: 'a good bar?' });
  });
  await arrive(page, url);
  // Twenty, not eight, for the reason given in full at the folio helper: eight
  // is tighter than this suite's own default of ten and says nothing about why,
  // and the claim is that the link opens the report rather than that a loaded
  // runner boots an app and parses a payload inside eight seconds. That fix
  // landed on 17 August 2026 on the one site that had failed, and these three
  // were the same shape and were not swept. Two days later the first of them
  // went red in firefox on CI, which is what a fix applied only where it hurt
  // buys you.
  await expect(page.locator('#reportOverlay')).toBeVisible({ timeout: 20000 });

  await expect(page.locator('.rp-evidence')).toContainText('2');
  await expect(page.locator('#askCompose'),
    'an ask nothing answers is a report with no way to reply on it').toBeVisible();
  await page.locator('#askCompose').click();
  const rows = await page.locator('.fol-row[data-fid] .nm').allTextContents();
  expect(rows, 'a letter at the end of a word decided who could be answered')
    .toEqual(['Wine Bars', 'The Tapas Bars']);
});

// ---------- three doors, and one guard read at each of them ----------
//
// The guard that stops a private record, a loan, or a way whose ends cannot be
// hidden from travelling used to stand in one place and was moved to the three
// surfaces that go outside: the link, the sheet, the newsstand. Every test
// below is a place where those three had drifted apart from each other, or
// from the line the composer prints above them. None of it is visible to a
// parser: no node test imports js/app.js.

// a straight line due north of a given length, in the two points a recorded
// straight walk actually reduces to
const KM_PER_DEG = 6371 * Math.PI / 180;
const straight = (km, lat = 46) => [{ lat, lng: 8 }, { lat: lat + km / KM_PER_DEG, lng: 8 }];

// ways laid into the atlas the page is already holding. they go in through the
// store rather than through the init script because the init script seeds
// places, tags and settings only, which is also why they survive a navigation
async function layWays(page, given) {
  await page.evaluate(async (ways) => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const { store, newRoute } = await import(`/js/store.js${v}`);
    store.load();
    for (const w of ways) store.addRoute(newRoute(w));
  }, given);
}

async function openTheWay(page, id) {
  await showIndex(page);
  await page.locator(`.ix[data-rid="${id}"]`).click();
  await expect(page.locator('#plate')).toBeVisible();
}

// The link door mapped every enclosed way through the guard and said which
// ones it refused. The sheet took the selection straight, so a path marked to
// hide where it starts and ends was typeset with the measurements of its whole
// line, which describe ground the reader was never given, and a path the link
// refuses outright was printed with no word said. The same button says "save
// as pdf".
test('the sheet hides the ends the link hides, and typesets no path the link refuses', async ({ page }) => {
  await watchTheDoors(page);
  await open(page, { places: 1 });
  await layWays(page, [
    { id: 'long', name: 'The Long Straight', path: straight(6), trimEnds: true },
    { id: 'short', name: 'Round The Block', path: straight(0.4), trimEnds: true },
  ]);
  await openTheComposer(page);
  // enclosed first and titled after, because the title narrows the list now:
  // no path in this atlas says Basel, so "Basel, on foot" hides both of them.
  // What was enclosed before a word was typed is still enclosed, which is the
  // rule this ordering also happens to prove.
  await page.locator('#folAll').click();
  await page.locator('#folTitle').fill('Basel, on foot');

  await page.locator('#folPrint').click();
  const said = page.locator('#askWhat');
  await expect(said).toBeVisible();
  await expect(said, 'the sheet said nothing about the path it cannot hide')
    .toContainText('too short to hide its start and end safely');
  await page.locator('#askGo').click();
  // and then the sheet's own sentence, which was always there
  await expect(said).toContainText('cannot recall it');
  await page.locator('#askGo').click();

  const sheet = await page.evaluate(() => document.querySelector('#sheet').innerHTML);
  expect(sheet.includes('Round The Block'), 'a path the link refuses outright was typeset').toBe(false);
  expect(sheet).toContain('The Long Straight');
  expect(sheet.includes('6.0 km'),
    'the whole line was measured on a sheet promising to hide its ends').toBe(false);
  expect(sheet).toContain('5.5 km');
});

// The fourth outward door, and the one that used to open without a word. It
// shipped as a press that put the whole outward atlas into a portable file and
// showed nothing at all, under a label naming a reader who is not a person.
//
// This is a browser test for the reason the whole file is: nothing under test/
// imports js/app.js, so a review panel that throws on the first press parses
// cleanly and passes `npm test`. It asserts three separate things, because
// three separate things were wrong: that the press reviews rather than writes,
// that the review counts the bytes actually leaving rather than a description
// of them, and that the file arrives only after a second press.
test('the file for an assistant is reviewed before it is written, and counts what leaves', async ({ page }) => {
  await open(page, { places: 3 });
  await layWays(page, [
    { id: 'w1', name: 'The Long Straight', path: straight(6), trimEnds: true },
    { id: 'w2', name: 'Round The Block', path: straight(0.4), trimEnds: true },
  ]);
  // one place held back by the word a person writes themselves, so the review
  // has something true to say about what is missing
  await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const { store } = await import(`/js/store.js${v}`);
    store.load();
    store.updatePlace('p2', { private: true });
  });

  // nothing may be written before the review is read
  const written = [];
  page.on('download', d => written.push(d.suggestedFilename()));

  await openYours(page);
  // the assistant's door lives behind "other forms" since the reduction
  await page.locator('#moreForms').click();
  await page.locator('#expAgent').click();
  await expect(page.locator('#agentOverlay')).toBeVisible();
  expect(written, 'the press wrote a file before showing anything').toEqual([]);

  const said = page.locator('#agentBody');
  // the counts are the file's own: 2 places of 3, and 1 way of 2
  await expect(said).toContainText('2 places');
  await expect(said).toContainText('1 path');
  await expect(said).toContainText('sharing name ada');
  // what is held back, in the app's two existing sentences
  await expect(said, 'the review never said the marked place stays behind')
    .toContainText('1 record excluded from sharing.');
  await expect(said).toContainText('Included in private backups.');
  await expect(said, 'the review lost a path to geometry and said nothing')
    .toContainText('too short to hide its start and end safely');
  // and what the file cannot do about itself
  await expect(said).toContainText('can copy it and keep it');
  await expect(said).toContainText('not a restriction');
  await expect(said).toContainText('cannot be recalled');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#agGo').click(),
  ]);
  expect(download.suggestedFilename()).toBe('resonate-for-an-assistant.json');

  // the bytes that arrived are the bytes the review counted
  const path = await download.path();
  const bytes = await readFile(path, 'utf8');
  const file = JSON.parse(bytes);
  const atlas = file.disclosure;
  expect(atlas.places.length).toBe(2);
  expect(atlas.routes.length).toBe(1);
  expect(atlas.places.some(p => p.id === 'p2'), 'a place marked never to leave was written').toBe(false);
  expect(atlas.routes[0].name).toBe('The Long Straight');
  expect(file.terms).toBe('https://resonate.select/read.html?d=assistant');
  expect(file.kind, 'the file leaves a reader to infer which kind it is').toBe('assistant_copy');
});

test('browser-agent review hands a first visitor to atlas setup without granting access', async ({ page }) => {
  for (const pattern of OFF) await page.route(pattern, r => r.abort());
  await cutTheWorld(page);
  await page.addInitScript(() => {
    window.__agentTools = new Map();
    const context = {
      async registerTool(tool, { signal } = {}) {
        window.__agentTools.set(tool.name, tool);
        signal?.addEventListener('abort', () => {
          if (window.__agentTools.get(tool.name) === tool) window.__agentTools.delete(tool.name);
        }, { once: true });
      },
    };
    Object.defineProperty(Document.prototype, 'modelContext', {
      configurable: true, get: () => context,
    });
  });
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => [...window.__agentTools.keys()]))
    .toEqual(['review_assistant_access']);
  await expect(page.locator('#intro')).toBeVisible();
  await expect(page.locator('#threshold')).toBeHidden();

  // Invoke at the earliest real registration point, while the animated intro
  // still covers setup. The tool may end that decorative cover, but it must
  // neither remember it as watched nor choose an atlas or permission.
  const handoff = await page.evaluate(async () => {
    const result = await window.__agentTools.get('review_assistant_access').execute({});
    const settings = JSON.parse(localStorage.getItem('resonate.settings.v1') || '{}');
    return {
      result,
      names: [...window.__agentTools.keys()],
      chosen: settings.chosen === true,
      allowed: settings.agentAccess === true,
      introSeen: settings.introSeen === true,
      thresholdFocused: document.activeElement === document.querySelector('#threshold'),
    };
  });

  expect(handoff.result.ok).toBe(true);
  expect(handoff.result.summary).toMatch(/owner must finish atlas setup/i);
  expect(handoff.result.data).toEqual({
    opened: false,
    setupRequired: true,
    access: 'off',
    dataExposed: false,
    requiresHumanAction: true,
    nextAction: 'The owner finishes the on-screen atlas setup. Then call review_assistant_access again.',
    availableAfterApproval: [
      'atlas_overview', 'search_atlas', 'show_atlas_item', 'prepare_place', 'prepare_list',
    ],
  });
  expect(handoff.result.visibleChange).toBe(true);
  expect(handoff.result.saved).toBe(false);
  expect(handoff.result.shared).toBe(false);
  expect(handoff.names).toEqual(['review_assistant_access']);
  expect(handoff.chosen, 'the assistant chose how the atlas starts').toBe(false);
  expect(handoff.allowed, 'the setup handoff granted assistant access').toBe(false);
  expect(handoff.introSeen, 'an assistant silently spent the first-run introduction').toBe(false);
  expect(handoff.thresholdFocused).toBe(true);
  await expect(page.locator('#agentAccessOverlay')).toBeHidden();
  await expect(page.locator('#thEmpty')).toBeVisible();
  await expect(page.locator('#thFull')).toBeVisible();
});

test('browser-agent data tools are opt-in while one zero-data review door stays discoverable', async ({ page }) => {
  // A small implementation of the proposed browser interface. The production
  // browser does not need to support WebMCP for us to prove Resonate's side of
  // the consent, registration, execution, and revocation contract.
  await page.addInitScript(() => {
    window.__agentTools = new Map();
    const context = {
      async registerTool(tool, { signal } = {}) {
        window.__agentTools.set(tool.name, tool);
        signal?.addEventListener('abort', () => {
          if (window.__agentTools.get(tool.name) === tool) window.__agentTools.delete(tool.name);
        }, { once: true });
      },
    };
    Object.defineProperty(Document.prototype, 'modelContext', {
      configurable: true, get: () => context,
    });
  });
  await open(page, { places: 3 });
  await expect.poll(() => page.evaluate(() => [...window.__agentTools.keys()]))
    .toEqual(['review_assistant_access']);

  // One place is locally marked never to leave before permission is granted.
  await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const { store } = await import(`/js/store.js${v}`);
    store.load();
    store.updatePlace('p2', { private: true });
    // These belong to the owner's ordinary workbench, not to the outward
    // disclosure. Opening p0 through a tool must not incidentally paint them.
    const p0 = store.placeById('p0');
    p0.note = 'A note the assistant may read.';
    p0.provenance = {
      name: 'Marta', adoptedAt: '2026-08-02T00:00:00.000Z',
      chain: [{ name: 'Léa', at: '2026-07-01T00:00:00.000Z' }], srcId: 'marta-p0',
    };
    p0.thanks = [{ from: 'Local gratitude sender', when: '2026-08-01T00:00:00.000Z' }];
    p0.createdAt = '1999-01-02T00:00:00.000Z';
    store.savePlaces();
    store.settings.authorName = 'Private Settings Sentinel';
    store.saveSettings();
  });

  // The board is the ordinary returning-home state. Discovering the review
  // tool there must open its zero-data review above it, not reject the first
  // useful WebMCP action or materialize the owner's full Settings page.
  await page.locator('#fmIndex').click();
  await expect(page.locator('#indexOverlay')).toBeVisible();

  const beforeReview = await page.evaluate(async () => {
    const tool = window.__agentTools.get('review_assistant_access');
    const refused = await tool.execute({ query: 'Place' });
    const result = await tool.execute({});
    return {
      names: [...window.__agentTools.keys()],
      schema: tool.inputSchema,
      description: tool.description,
      refused,
      result,
      allowed: JSON.parse(localStorage.getItem('resonate.settings.v1') || '{}').agentAccess === true,
    };
  });
  expect(beforeReview.names).toEqual(['review_assistant_access']);
  expect(beforeReview.schema).toEqual({ type: 'object', properties: {}, additionalProperties: false });
  expect(beforeReview.description).toMatch(/never grants access or exposes atlas data/i);
  expect(beforeReview.refused.error.code).toBe('invalid_input');
  expect(beforeReview.result.data).toEqual({
    opened: true,
    access: 'off',
    dataExposed: false,
    requiresHumanAction: true,
    availableAfterApproval: [
      'atlas_overview', 'search_atlas', 'show_atlas_item', 'prepare_place', 'prepare_list',
    ],
  });
  expect(beforeReview.result.visibleChange).toBe(true);
  expect(beforeReview.result.saved).toBe(false);
  expect(beforeReview.result.shared).toBe(false);
  expect(beforeReview.allowed, 'the review door granted access without the person').toBe(false);
  await expect(page.locator('#agentAccessOverlay')).toBeVisible();
  await expect(page.locator('#settingsOverlay')).toBeHidden();
  const reviewText = await page.locator('#agentAccessOverlay').innerText();
  for (const privateText of ['Private Settings Sentinel', 'Local gratitude sender', 'Place 0', 'Place 1', 'Place 2']) {
    expect(reviewText, `the pre-consent surface exposed ${privateText}`).not.toContain(privateText);
  }
  expect(await page.evaluate(() => document.activeElement === document.querySelector('#agentAccessOverlay')))
    .toBe(true);
  await expect(page.locator('#agentReviewCopy')).toHaveText(
    'Allowing access lets Resonate’s browser tools search records included in sharing and read exact locations, addresses, notes, links, tags, and recommendation names and dates. They can open items and prepare places or collections. They cannot read excluded records or your People list, and cannot save, delete, share, or mark visits. Access stays on in this browser until you stop it. Your assistant provider may process returned data under its own terms.',
  );
  const toggle = page.locator('#agentReviewToggle');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(toggle).toHaveText('Allow access');
  await expect(page.locator('#agentAccessOverlay a[href="read.html?d=assistant"]'))
    .toHaveText('Read data contract');
  // The tool can open asynchronously while a key is already on its way up.
  // Enter at the dialog root must not turn that carried key into consent.
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('resonate.settings.v1') || '{}').agentAccess))
    .not.toBe(true);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle).toHaveText('Stop access');
  await expect(page.locator('#agentReviewState')).toContainText('on in this browser');
  await expect.poll(() => page.evaluate(() => [...window.__agentTools.keys()].sort())).toEqual([
    'atlas_overview', 'prepare_list', 'prepare_place', 'search_atlas', 'show_atlas_item',
  ]);

  // Leave the access review before asking an agent to put another review on
  // the glass. A tool invoked while a dialog is open is refused, not hidden
  // underneath it.
  const held = await page.evaluate(() => window.__agentTools.get('prepare_place')
    .execute({ name: 'Hidden', lat: 46, lng: 8 }));
  expect(held.ok).toBe(false);
  expect(held.error.code).toBe('review_in_progress');
  expect(held.error.retryable).toBe(true);
  expect(held.summary).toContain('Finish or close');
  await page.keyboard.press('Escape');
  await expect(page.locator('#agentAccessOverlay')).toBeHidden();
  if (await page.locator('#indexOverlay').isVisible()) await page.locator('#indexClose').click();

  const search = await page.evaluate(() => window.__agentTools.get('search_atlas').execute({ query: 'Place' }));
  expect(search.data.results.map(r => r.id)).toEqual(['p0', 'p1']);
  expect(search.data.results[0].provenance.map(step => step.name)).toEqual(['Léa', 'Marta']);
  expect(JSON.stringify(search)).not.toContain('p2');
  const afterMarta = await page.evaluate(() => window.__agentTools.get('search_atlas')
    .execute({ recommended_by: 'Marta', kind: 'place' }));
  expect(afterMarta.data.results.map(r => r.id)).toEqual(['p0']);
  const overview = await page.evaluate(() => window.__agentTools.get('atlas_overview').execute({}));
  expect(overview.data.recommendationSources).toContainEqual({ name: 'Marta', count: 1 });

  await page.evaluate(() => window.__agentTools.get('show_atlas_item').execute({ id: 'p0', kind: 'place' }));
  await expect(page.locator('#plate')).toHaveAttribute('aria-label', 'Assistant place');
  await expect(page.locator('#plate')).toContainText('assistant view · read only');
  await expect(page.locator('#plate')).toContainText('A note the assistant may read.');
  await expect(page.locator('#plate')).toContainText('recommended by');
  await expect(page.locator('#plate')).toContainText('Léa → Marta');
  await expect(page.locator('#plate')).not.toContainText('entered');
  await expect(page.locator('#plate .plate-thanks')).toHaveCount(0);
  await expect(page.locator('#plate [contenteditable], #plate input, #plate textarea')).toHaveCount(0);
  await page.locator('#aaiClose').click();

  const beforeLists = await page.evaluate(() => JSON.parse(localStorage.getItem('resonate.folios.v1') || '[]').length);
  await page.evaluate(() => window.__agentTools.get('prepare_list').execute({
    title: 'A quiet afternoon', note: 'Read this first', item_ids: ['p0', 'p1', 'p2'],
  }));
  await expect(page.locator('#folioOverlay')).toBeVisible();
  await expect(page.locator('#folTitle')).toHaveValue('A quiet afternoon');
  await expect(page.locator('.fol-row[aria-pressed="true"]')).toHaveCount(2);
  await expect(page.locator('.fol-row[data-fid="p2"]'), 'a private row was visible in the agent draft').toHaveCount(0);
  await expect(page.locator('.fol-row[data-fid]'), 'the agent draft widened itself to the whole atlas').toHaveCount(2);
  await page.locator('#folioOverlay .poster-x').click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('resonate.folios.v1') || '[]').length),
    'closing an untouched agent draft saved it').toBe(beforeLists);

  const beforePlaces = await page.evaluate(() => JSON.parse(localStorage.getItem('resonate.places.v1')).length);
  const result = await page.evaluate(() => window.__agentTools.get('prepare_place').execute({
    name: 'Agent Sentinel', lat: 46.95, lng: 7.44, city: 'Bern', country: 'Switzerland',
    note: 'Check the garden.', tags: ['Garden'], url: 'https://example.com/garden',
  }));
  expect(result.summary).toContain('Nothing was saved');
  await expect(page.locator('#plate')).toHaveAttribute('aria-label', 'Assistant place proposal');
  await expect(page.locator('#plate')).toContainText('assistant proposal · not yet yours');
  await expect(page.locator('#apKeep')).toHaveText('Add to my atlas');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('resonate.places.v1')).length),
    'opening the proposal saved a place').toBe(beforePlaces);
  await page.locator('#apKeep').click();
  await expect(page.locator('#toast')).toHaveText('Added as Want to go.');
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('resonate.places.v1'))
    .find(p => p.name === 'Agent Sentinel'));
  expect(kept.status).toBe('wishlist');
  expect(kept.private).toBe(false);
  expect(kept.rating).toBe(0);
  expect(kept.note).toBe('Check the garden.');

  await openYours(page, '#assistantSettings');
  await page.locator('#agentAccessToggle').click();
  await expect(page.locator('#agentAccessState')).toContainText('off · no atlas data');
  await expect(page.locator('#agentAccessToggle')).toHaveText('Allow access');
  await expect.poll(() => page.evaluate(() => [...window.__agentTools.keys()]))
    .toEqual(['review_assistant_access']);
});

test('remembered assistant access cannot hold boot open past a cross-tab revocation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const pattern of OFF) await page.route(pattern, route => route.abort());
  await cutTheWorld(page);
  await page.addInitScript(() => {
    const now = new Date().toISOString();
    localStorage.setItem('resonate.places.v1', JSON.stringify([{
      id: 'p0', name: 'Boot Sentinel', lat: 46, lng: 8, city: 'Basel',
      country: 'Switzerland', tags: [], status: 'visited', note: '',
      createdAt: now, updatedAt: now,
    }]));
    localStorage.setItem('resonate.tags.v1', '[]');
    localStorage.setItem('resonate.settings.v1', JSON.stringify({
      theme: 'auto', chosen: true, seeded: true, introSeen: true,
      authorName: 'ada', hue: 300, agentAccess: true,
    }));

    const life = window.__agentBoot = { tools: new Map(), waiting: 0 };
    const context = {
      async registerTool(tool, { signal } = {}) {
        if (tool.name === 'review_assistant_access') {
          life.tools.set(tool.name, tool);
          signal?.addEventListener('abort', () => {
            if (life.tools.get(tool.name) === tool) life.tools.delete(tool.name);
          }, { once: true });
          return;
        }
        life.waiting += 1;
        await new Promise(resolve => {
          const release = () => { life.waiting -= 1; resolve(); };
          signal?.addEventListener('abort', release, { once: true });
        });
        if (!signal?.aborted) life.tools.set(tool.name, tool);
      },
    };
    Object.defineProperty(Document.prototype, 'modelContext', {
      configurable: true, get: () => context,
    });
  });

  await page.goto('/');
  await expect.poll(() => page.evaluate(() => window.__agentBoot.waiting), { timeout: 2000 }).toBe(1);

  const revokedInsideEvent = await page.evaluate(() => {
    const key = 'resonate.settings.v1';
    const oldValue = localStorage.getItem(key);
    const settings = JSON.parse(oldValue || '{}');
    settings.agentAccess = false;
    const newValue = JSON.stringify(settings);
    localStorage.setItem(key, newValue);
    dispatchEvent(new StorageEvent('storage', { key, oldValue, newValue, url: location.href }));
    return {
      waiting: window.__agentBoot.waiting,
      tools: window.__agentBoot.tools.size,
      names: [...window.__agentBoot.tools.keys()],
    };
  });
  expect(revokedInsideEvent).toEqual({
    waiting: 0,
    tools: 1,
    names: ['review_assistant_access'],
  });
  await page.waitForTimeout(50);
  expect(await page.evaluate(() => ({
    waiting: window.__agentBoot.waiting,
    tools: window.__agentBoot.tools.size,
    names: [...window.__agentBoot.tools.keys()],
  }))).toEqual({ waiting: 0, tools: 1, names: ['review_assistant_access'] });
});

test('browser-agent lifecycle keeps one stable registration and revocation wins every race', async ({ page }) => {
  await page.addInitScript(() => {
    const life = window.__agentLifecycle = {
      tools: new Map(), registrations: 0, aborts: 0, hold: false, waiting: 0,
    };
    const makeContext = () => ({
      async registerTool(tool, { signal } = {}) {
        life.registrations += 1;
        if (life.hold && tool.name !== 'review_assistant_access') {
          life.waiting += 1;
          await new Promise(resolve => {
            const release = () => { life.waiting -= 1; resolve(); };
            signal?.addEventListener('abort', release, { once: true });
          });
        }
        if (signal?.aborted) return;
        life.tools.set(tool.name, tool);
        signal?.addEventListener('abort', () => {
          // A late abort from an old runtime may never remove the replacement
          // tool with the same name.
          if (life.tools.get(tool.name) !== tool) return;
          life.tools.delete(tool.name);
          life.aborts += 1;
        }, { once: true });
      },
    });
    window.__replaceAgentRuntime = () => { window.__agentContext = makeContext(); };
    window.__replaceAgentRuntime();
    Object.defineProperty(Document.prototype, 'modelContext', {
      configurable: true, get: () => window.__agentContext,
    });
  });

  await open(page, { places: 2 });
  await expect.poll(() => page.evaluate(() => [...window.__agentLifecycle.tools.keys()]))
    .toEqual(['review_assistant_access']);
  const off = await page.evaluate(() => ({
    tools: window.__agentLifecycle.tools.size,
    registrations: window.__agentLifecycle.registrations,
    aborts: window.__agentLifecycle.aborts,
  }));
  expect(off).toEqual({ tools: 1, registrations: 1, aborts: 0 });
  await openYours(page, '#assistantSettings');
  await page.locator('#agentAccessToggle').click();
  await expect(page.locator('#agentAccessState')).toContainText('on in this browser');
  const first = await page.evaluate(() => ({
    tools: window.__agentLifecycle.tools.size,
    registrations: window.__agentLifecycle.registrations,
    aborts: window.__agentLifecycle.aborts,
  }));
  expect(first.tools).toBe(5);
  expect(first.registrations).toBe(off.registrations + 5);
  expect(first.aborts).toBe(off.aborts + 1);

  // A disclosure change is readable immediately but registration-stable. In
  // particular, a record made private in another tab may not remain visible
  // to one tool call while the map repaint waits on its debounce.
  const afterPrivacyChange = await page.evaluate(async () => {
    const key = 'resonate.places.v1';
    const oldValue = localStorage.getItem(key);
    const rows = JSON.parse(oldValue || '[]');
    rows[0].note = 'written in the other tab';
    rows[1].private = true;
    const newValue = JSON.stringify(rows);
    localStorage.setItem(key, newValue);
    dispatchEvent(new StorageEvent('storage', { key, oldValue, newValue, url: location.href }));
    const found = await window.__agentLifecycle.tools.get('search_atlas').execute({ query: 'Place' });
    return {
      ids: found.data.results.map(row => row.id),
      registrations: window.__agentLifecycle.registrations,
      aborts: window.__agentLifecycle.aborts,
    };
  });
  expect(afterPrivacyChange).toEqual({
    ids: ['p0'], registrations: first.registrations, aborts: first.aborts,
  });
  await page.waitForTimeout(350);
  // Unrelated settings still refresh the other tab's data without becoming a
  // registration event.
  await page.evaluate(() => {
    const key = 'resonate.settings.v1';
    const oldValue = localStorage.getItem(key);
    const settings = JSON.parse(oldValue || '{}');
    settings.theme = settings.theme === 'dark' ? 'light' : 'dark';
    const newValue = JSON.stringify(settings);
    localStorage.setItem(key, newValue);
    dispatchEvent(new StorageEvent('storage', { key, oldValue, newValue, url: location.href }));
  });
  await page.waitForTimeout(350);
  expect(await page.evaluate(() => ({
    tools: window.__agentLifecycle.tools.size,
    registrations: window.__agentLifecycle.registrations,
    aborts: window.__agentLifecycle.aborts,
  }))).toEqual(first);

  // A BFCache document can receive a queued tool call the moment it becomes
  // active again. End the old session on pagehide, then create exactly one new
  // set after unchanged consent has been read on pageshow.
  await page.evaluate(() => {
    dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await expect.poll(() => page.evaluate(() => window.__agentLifecycle.tools.size)).toBe(first.tools);
  await expect.poll(() => page.evaluate(() => window.__agentLifecycle.registrations))
    .toBe(first.registrations + 5);
  await expect.poll(() => page.evaluate(() => window.__agentLifecycle.aborts))
    .toBe(first.aborts + 5);
  const afterBFCache = await page.evaluate(() => ({
    registrations: window.__agentLifecycle.registrations,
    aborts: window.__agentLifecycle.aborts,
  }));

  // A tab can revoke consent while this document is suspended, before its
  // queued storage event is delivered. pageshow must read that durable choice
  // before considering a data-tool reconnect; only the zero-data review door
  // may return.
  await page.evaluate(() => {
    dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    const key = 'resonate.settings.v1';
    const settings = JSON.parse(localStorage.getItem(key) || '{}');
    settings.agentAccess = false;
    localStorage.setItem(key, JSON.stringify(settings));
    dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await expect(page.locator('#agentAccessState')).toContainText('off · no atlas data');
  await expect.poll(() => page.evaluate(() => [...window.__agentLifecycle.tools.keys()]))
    .toEqual(['review_assistant_access']);
  await expect.poll(() => page.evaluate(() => window.__agentLifecycle.registrations))
    .toBe(afterBFCache.registrations + 1);
  await expect.poll(() => page.evaluate(() => window.__agentLifecycle.aborts))
    .toBe(afterBFCache.aborts + 5);
  const afterSuspendedRevoke = await page.evaluate(() => ({
    registrations: window.__agentLifecycle.registrations,
    aborts: window.__agentLifecycle.aborts,
  }));

  await page.evaluate(() => {
    // Source-tab order matters: the privacy write lands first, then consent.
    // The grant must load both before it exposes its first tool set.
    const placeKey = 'resonate.places.v1';
    const oldPlaces = localStorage.getItem(placeKey);
    const places = JSON.parse(oldPlaces || '[]');
    places[0].private = true;
    const newPlaces = JSON.stringify(places);
    localStorage.setItem(placeKey, newPlaces);
    dispatchEvent(new StorageEvent('storage', {
      key: placeKey, oldValue: oldPlaces, newValue: newPlaces, url: location.href,
    }));

    const key = 'resonate.settings.v1';
    const oldValue = localStorage.getItem(key);
    const settings = JSON.parse(oldValue || '{}');
    settings.agentAccess = true;
    const newValue = JSON.stringify(settings);
    localStorage.setItem(key, newValue);
    dispatchEvent(new StorageEvent('storage', { key, oldValue, newValue, url: location.href }));
  });
  await expect(page.locator('#agentAccessState')).toContainText('on in this browser');
  await expect.poll(() => page.evaluate(() => window.__agentLifecycle.registrations))
    .toBe(afterSuspendedRevoke.registrations + 5);
  await expect.poll(() => page.evaluate(() => window.__agentLifecycle.aborts))
    .toBe(afterSuspendedRevoke.aborts + 1);
  const afterGrant = await page.evaluate(() => ({
    registrations: window.__agentLifecycle.registrations,
    aborts: window.__agentLifecycle.aborts,
  }));
  const firstReadAfterGrant = await page.evaluate(() => window.__agentLifecycle.tools
    .get('search_atlas').execute({ query: 'Place' }));
  expect(firstReadAfterGrant.data.results).toEqual([]);

  // A genuinely replaced runtime is different: one abort and one complete,
  // fresh registration, with no overlap between the two tool sets.
  await page.evaluate(() => {
    window.__replaceAgentRuntime();
    dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await expect.poll(() => page.evaluate(() => window.__agentLifecycle.tools.size)).toBe(first.tools);
  await expect.poll(() => page.evaluate(() => window.__agentLifecycle.registrations))
    .toBe(afterGrant.registrations + 5);
  await expect.poll(() => page.evaluate(() => window.__agentLifecycle.aborts))
    .toBe(afterGrant.aborts + 5);
  const afterRuntimeReplacement = await page.evaluate(() => ({
    registrations: window.__agentLifecycle.registrations,
    aborts: window.__agentLifecycle.aborts,
  }));

  // Cross-tab revocation is immediate, and a later cross-tab grant reconnects
  // once against the current runtime.
  const revokedInEvent = await page.evaluate(() => {
    const key = 'resonate.settings.v1';
    const oldValue = localStorage.getItem(key);
    const settings = JSON.parse(oldValue || '{}');
    settings.agentAccess = false;
    const newValue = JSON.stringify(settings);
    localStorage.setItem(key, newValue);
    dispatchEvent(new StorageEvent('storage', { key, oldValue, newValue, url: location.href }));
    // Read before the 250ms atlas refresh can run. Revocation belongs to the
    // storage event itself, not to that later repaint.
    return {
      tools: window.__agentLifecycle.tools.size,
      names: [...window.__agentLifecycle.tools.keys()],
      state: document.querySelector('#agentAccessState').textContent,
    };
  });
  expect(revokedInEvent).toEqual({
    tools: 1,
    names: ['review_assistant_access'],
    state: 'off · no atlas data is exposed as tools',
  });
  await expect(page.locator('#agentAccessState')).toContainText('off · no atlas data');
  await expect.poll(() => page.evaluate(() => [...window.__agentLifecycle.tools.keys()]))
    .toEqual(['review_assistant_access']);
  await expect.poll(() => page.evaluate(() => window.__agentLifecycle.registrations))
    .toBe(afterRuntimeReplacement.registrations + 1);
  await expect.poll(() => page.evaluate(() => window.__agentLifecycle.aborts))
    .toBe(afterRuntimeReplacement.aborts + 5);
  const afterRevocation = await page.evaluate(() => ({
    registrations: window.__agentLifecycle.registrations,
    aborts: window.__agentLifecycle.aborts,
  }));

  await page.evaluate(() => {
    const key = 'resonate.settings.v1';
    const oldValue = localStorage.getItem(key);
    const settings = JSON.parse(oldValue || '{}');
    settings.agentAccess = true;
    const newValue = JSON.stringify(settings);
    localStorage.setItem(key, newValue);
    dispatchEvent(new StorageEvent('storage', { key, oldValue, newValue, url: location.href }));
  });
  await expect(page.locator('#agentAccessState')).toContainText('on in this browser');
  await expect.poll(() => page.evaluate(() => window.__agentLifecycle.registrations))
    .toBe(afterRevocation.registrations + 5);
  await expect.poll(() => page.evaluate(() => window.__agentLifecycle.aborts))
    .toBe(afterRevocation.aborts + 1);

  // Finally, suspend the replacement registration in its first await and
  // revoke consent underneath it. The old promise may settle, but it may not
  // restore active UI state or tools after the newer off state has won.
  await page.evaluate(() => {
    window.__agentLifecycle.hold = true;
    window.__replaceAgentRuntime();
    dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await expect.poll(() => page.evaluate(() => window.__agentLifecycle.waiting)).toBe(1);
  await expect(page.locator('#agentAccessState')).toContainText('connecting');
  await expect(page.locator('#agentAccessToggle')).toBeEnabled();
  await expect(page.locator('#agentAccessToggle')).toHaveText('Stop access');
  await page.locator('#agentAccessToggle').click();
  await expect(page.locator('#agentAccessState')).toContainText('off · no atlas data');
  await expect(page.locator('#agentAccessToggle')).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => page.evaluate(() => window.__agentLifecycle.waiting)).toBe(0);
  await page.waitForTimeout(50);
  expect(await page.evaluate(() => ({
    tools: window.__agentLifecycle.tools.size,
    names: [...window.__agentLifecycle.tools.keys()],
    state: document.querySelector('#agentAccessState').textContent,
  }))).toEqual({
    tools: 1,
    names: ['review_assistant_access'],
    state: 'off · no atlas data is exposed as tools',
  });

  // The review door is a live registration too: BFCache suspension removes it
  // and restoration recreates only that door while access remains off.
  const suspendedOff = await page.evaluate(() => {
    dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    return [...window.__agentLifecycle.tools.keys()];
  });
  expect(suspendedOff).toEqual([]);
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect.poll(() => page.evaluate(() => [...window.__agentLifecycle.tools.keys()]))
    .toEqual(['review_assistant_access']);
});

// ---------- the assistant copy, adversarially ----------
//
// The review above proves the panel counts the file rather than a description
// of it. These prove the harder thing: that every sentence it prints is true
// of these particular bytes, including the sentences that used to print
// whatever the atlas held.

// one atlas holding every case at once, so a rule that fires on the wrong
// record has somewhere to be wrong
async function mixedAtlas(page) {
  await open(page, {
    places: 0,
    atlas: [
      { id: 'pub', name: 'Open Sentinel Place', lat: 47.5, lng: 7.58, city: 'Basel',
        country: 'Switzerland', address: 'Steinenberg 7', tags: ['t1'], status: 'visited',
        note: 'before ten', url: 'https://example.test',
        provenance: { name: 'Marta', adoptedAt: '2026-01-01T00:00:00.000Z', chain: [] } },
      { id: 'priv', name: 'Kept Sentinel Home', lat: 47.6, lng: 7.6, city: 'Basel',
        country: 'Switzerland', tags: [], status: 'visited', private: true },
      { id: 'lent', name: 'Sample Sentinel Place', lat: 47.7, lng: 7.7, city: 'Basel',
        country: 'Switzerland', tags: [], status: 'wishlist', sample: true },
      { id: 'nowhere', name: 'Placeless Sentinel', lat: 12.3, lng: 45.6, tags: [], status: 'wishlist' },
    ],
  });
  await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const { store, newTag } = await import(`/js/store.js${v}`);
    store.load();
    // a tag nothing is filed under, which must not travel
    store.addTag(newTag({ id: 'tUnused', name: 'Unused Sentinel Tag' }));
  });
  await layWays(page, [
    { id: 'wOpen', name: 'Open Sentinel Way', path: straight(6) },
    { id: 'wPriv', name: 'Kept Sentinel Way', path: straight(6, 48), private: true },
    { id: 'wTrim', name: 'Trimmed Sentinel Way', path: straight(6, 49), trimEnds: true },
    { id: 'wShort', name: 'Short Sentinel Way', path: straight(0.4, 50), trimEnds: true },
  ]);
}

const reviewAssistantFile = async (page) => {
  await openYours(page);
  // the assistant's door lives behind "other forms" since the reduction
  await page.locator('#moreForms').click();
  await page.locator('#expAgent').click();
  await expect(page.locator('#agentOverlay')).toBeVisible();
  return page.locator('#agentBody');
};

test('the assistant copy carries only what may leave, and says so of these bytes', async ({ page }) => {
  await mixedAtlas(page);
  const said = await reviewAssistantFile(page);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#agGo').click(),
  ]);
  const bytes = await readFile(await download.path(), 'utf8');

  // it executed and it carried something. an emptiness that satisfies every
  // absence below is the exact shape of proof this repository has been fooled
  // by before, so it is refused first
  expect(bytes.length).toBeGreaterThan(100);
  expect(() => JSON.parse(bytes)).not.toThrow();
  expect(bytes).toContain('Open Sentinel Place');

  const atlas = JSON.parse(bytes).disclosure;
  const names = [...atlas.places, ...atlas.routes].map(r => r.name);
  expect(names).toContain('Open Sentinel Place');
  expect(names).toContain('Open Sentinel Way');
  expect(names).toContain('Trimmed Sentinel Way');
  expect(names, 'a place marked never to leave travelled').not.toContain('Kept Sentinel Home');
  expect(names, 'a path marked never to leave travelled').not.toContain('Kept Sentinel Way');
  // the sample is a real place from a real person, and travels
  expect(names, 'the sample was still held back as a loan').toContain('Sample Sentinel Place');
  expect(names, 'a path too short to hide its ends travelled whole').not.toContain('Short Sentinel Way');
  // the one with no city is in the file like any other record
  expect(names, 'a place with no city was quietly dropped').toContain('Placeless Sentinel');

  expect(atlas.tags.map(t => t.name), 'a tag nothing is filed under travelled')
    .not.toContain('Unused Sentinel Tag');

  // the counts on the card are counts of exactly these bytes
  await expect(said).toContainText(`${atlas.places.length} places`);
  await expect(said).toContainText(`${atlas.routes.length} paths`);
  await expect(said).toContainText('1 note');
  await expect(said).toContainText('1 link');
  await expect(said).toContainText('1 sharing name on records you received');

  // and the three reasons a record stayed behind are named as three reasons
  await expect(said, 'the held-back count drifted from the one word that holds')
    .toContainText('2 records excluded from sharing');
  await expect(said).toContainText('Included in private backups');
  await expect(said, 'the review lost a path to geometry and said nothing')
    .toContainText('too short to hide its start and end safely');
  await expect(said).toContainText('Short Sentinel Way');
});

// The card printed "addresses, cities, countries, been or want to go" whatever
// the file held. A person who keeps only walks was told their addresses were
// going, and they had none.
test('a copy holding only paths claims nothing about addresses or cities', async ({ page }) => {
  await open(page, { places: 0, atlas: [] });
  await layWays(page, [{ id: 'w1', name: 'Only Sentinel Way', path: straight(6) }]);
  const said = await reviewAssistantFile(page);

  await expect(said, 'the card proved nothing, because nothing was in it').toContainText('1 path');
  const text = await said.innerText();
  expect(text, 'a file with no place claimed it carried addresses').not.toContain('addresses');
  expect(text, 'a file with no place claimed it carried cities').not.toContain('cities');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#agGo').click(),
  ]);
  const atlas = JSON.parse(await readFile(await download.path(), 'utf8')).disclosure;
  expect(atlas.places).toEqual([]);
  expect(atlas.routes[0].name).toBe('Only Sentinel Way');
  expect(Array.isArray(atlas.routes[0].path), 'the walk left as a coarse line, not as points').toBe(true);
});

// A record with nothing optional on it must generate no claim that the
// optional things travel.
test('a bare record makes the card claim no note, no link and no byline', async ({ page }) => {
  await open(page, {
    places: 0,
    atlas: [{ id: 'bare', name: 'Bare Sentinel Place', lat: 47, lng: 8, tags: [], status: '' }],
  });
  const said = await reviewAssistantFile(page);
  const text = await said.innerText();

  expect(text, 'the card proved nothing').toContain('1 place');
  expect(text, 'a record with no note was said to carry one').not.toContain('note');
  expect(text, 'a record with no saved link was said to carry one').not.toContain('link you saved');
  expect(text, 'a record that reached nobody was given a road').not.toContain('sharing name on records');
  expect(text, 'a place with no city was counted as a city').not.toContain('cities');
  expect(text, 'a place with no address was said to carry one').not.toContain('addresses');

  // and one claim that is unconditional because the record is: a place is
  // 'visited' or 'wishlist' and never neither, so a file holding any record at
  // all does carry been or want to go. the card is right to say it every time,
  // and this is here so the next reader does not "fix" it into a condition
  expect(text).toContain('been or want to go');
});

// Every record is private, from the sample, or a path that cannot be redacted.
// The card used to print "nothing. no place or path here may leave." above a
// button that wrote an empty atlas to a file.
test('a copy with nothing to carry offers no word to press', async ({ page }) => {
  await open(page, {
    places: 0,
    atlas: [
      { id: 'priv', name: 'Kept Sentinel Home', lat: 47, lng: 8, tags: [], private: true },
      { id: 'priv2', name: 'Second Sentinel Home', lat: 47.1, lng: 8.1, tags: [], private: true },
    ],
  });
  await layWays(page, [{ id: 'wShort', name: 'Short Sentinel Way', path: straight(0.4), trimEnds: true }]);
  const said = await reviewAssistantFile(page);

  await expect(page.locator('#agGo'), 'a word that writes an empty atlas is still offered')
    .toHaveCount(0);
  // and the reasons are named rather than left to be guessed at
  await expect(said).toContainText('2 records excluded from sharing');
  await expect(said).toContainText('too short to hide its start and end safely');
  // no promise about a file that is not going to exist
  await expect(said).not.toContainText('cannot be recalled');
});

// A review is consent for the state that was shown, not for an older captured
// file and not for a newer atlas. If the atlas changes while the panel stands,
// the first press refreshes the review and no bytes leave.
test('an assistant copy is reviewed again when the atlas changes before download', async ({ page }) => {
  await open(page, {
    places: 0,
    atlas: [{ id: 'one', name: 'Reviewed Sentinel Place', lat: 47, lng: 8, tags: [], status: 'visited' }],
  });
  const said = await reviewAssistantFile(page);
  await expect(said).toContainText('1 place');

  await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const { store, newPlace } = await import(`/js/store.js${v}`);
    store.load();
    store.addPlace(newPlace({ id: 'late', name: 'Late Sentinel Place', lat: 46, lng: 7 }));
  });

  let downloaded = false;
  page.on('download', () => { downloaded = true; });
  await page.locator('#agGo').click();

  await expect(page.locator('#agentOverlay')).toBeVisible();
  await expect(page.locator('#agentBody')).toContainText('2 places');
  await expect(page.locator('#toast')).toHaveText('Your atlas changed. Review the updated copy.');
  await page.waitForTimeout(250);
  expect(downloaded, 'a file left without review of the new atlas').toBe(false);
});



// The refusal names the word on the record that held everything back, and
// there is a case where no word did: a path that asked to hide its ends and is
// too short to lose them. That is the geometry, not a loan and not a mark, and
// the door has to say so rather than reaching for the nearest sentence.
test('a path too short to hide its ends is refused for its own reason', async ({ page }) => {
  await watchTheDoors(page);
  await open(page, { places: 2 });
  await layWays(page, [{ id: 'w1', name: 'Round The Block', path: straight(0.4), trimEnds: true }]);
  await openTheComposer(page);
  await page.locator('#folTitle').fill('a short walk');
  await page.locator('#folNone').click();
  await page.locator('.fol-row[data-wid="w1"]').click();

  await page.locator('#folCopy').click();
  const said = page.locator('#toast');
  await expect(said).toContainText('too short to hide its start and end safely');
  await expect(said, 'the geometry was reported as a word somebody wrote')
    .not.toContainText('sample');
  await expect(said).not.toContainText('never to leave');
  expect(await page.evaluate(() => window.__shared.length), 'a link went out').toBe(0);
});

// The cap bounded the places and nothing else. Way rows were not counted, not
// capped, and out on the link all the same, so "3 of 3 chosen" could hand over
// six records under a title promising three.
test('the surface that promises three counts the paths, and stops at three', async ({ page }) => {
  await watchTheDoors(page);
  await openCities(page);
  await layWays(page, [
    { id: 'w1', name: 'The Long Way', path: straight(6) },
    { id: 'w2', name: 'The Other Way', path: straight(5) },
  ]);
  await raiseTheAsk(page);

  await page.locator('.fol-row[data-fid]').nth(0).click();
  await page.locator('.fol-row[data-fid]').nth(1).click();
  await page.locator('.fol-row[data-wid="w1"]').click();
  await expect(page.locator('.fol-count'), 'a path was enclosed and not counted')
    .toContainText('3 of 3 selected');

  // and the fourth is refused, whichever kind of record it is
  await page.locator('.fol-row[data-wid="w2"]').click();
  await expect(page.locator('#toast')).toContainText('you can send three items');
  await expect(page.locator('.fol-row[data-wid="w2"]')).toHaveAttribute('aria-pressed', 'false');

  await page.locator('#folCopy').click();
  await page.locator('#askGo').click();
  const payload = await page.evaluate(() => {
    const url = (window.__shared[0] || {}).url || '';
    return JSON.parse(window.LZString.decompressFromEncodedURIComponent(new URL(url).hash.slice(3)));
  });
  expect(payload.places.length + (payload.routes || []).length,
    'a folio promising three handed over more').toBe(3);
});

// three of the person's own, one marked never to leave, and one still a sample.
// written through the init script because raising the ask navigates, and every
// navigation seeds the places again.
const THREE = (() => {
  const now = new Date().toISOString();
  const mk = (id, name, extra = {}) => ({
    id, name, lat: 47, lng: 7, city: 'Basel', country: 'Switzerland',
    tags: [], status: 'visited', note: '', createdAt: now, updatedAt: now, ...extra,
  });
  return [
    mk('p0', 'Place 0'), mk('p1', 'Place 1'), mk('p2', 'Place 2'),
    mk('secret', 'My Own Front Door', { private: true }),
    mk('lent', 'A Loaned Place', { sample: true }),
  ];
})();

// Since the pool stopped filtering, this surface listed records that can never
// leave. Choosing one spent one of the three and delivered nothing, so a folio
// titled "three for bruno" arrived holding two.
test('the surface that promises three offers only what can be handed over', async ({ page }) => {
  await watchTheDoors(page);
  await open(page, { atlas: THREE });
  await raiseTheAsk(page);

  const rows = await page.locator('.fol-row[data-fid] .nm').allTextContents();
  // the sample answers with everything else now; only the person's own word
  // keeps a row off the offer
  expect(rows, 'a row that can never leave would spend one of the three and deliver nothing')
    .toEqual(['Place 0', 'Place 1', 'Place 2', 'A Loaned Place']);

  await page.locator('.fol-row[data-fid]').nth(0).click();
  await page.locator('.fol-row[data-fid]').nth(1).click();
  await page.locator('.fol-row[data-fid]').nth(2).click();
  await page.locator('#folCopy').click();
  await page.locator('#askGo').click();
  const names = await page.evaluate(() => {
    const url = (window.__shared[0] || {}).url || '';
    const p = JSON.parse(window.LZString.decompressFromEncodedURIComponent(new URL(url).hash.slice(3)));
    return p.places.map(x => x.name);
  });
  expect(names, 'three were chosen and fewer arrived').toEqual(['Place 0', 'Place 1', 'Place 2']);
});

// An atlas of loans is what the app's own first suggestion leaves a person
// holding. The offer stands once per correspondent, and it was raised there
// and spent before the person could find out that nothing could go back.
test('the answer is not offered by an atlas that can hand over nothing', async ({ page }) => {
  // every record marked never to leave: the one word that still holds
  await open(page, { atlas: THREE.map(p => ({ ...p, private: true, sample: false })) });
  await aFolioArrives(page);
  await expect(page.locator('#answerBar'),
    'the one offer per correspondent was spent where nothing could answer').toBeHidden();
  // and the report gave way to the atlas instead, which is what the bar was
  // standing in front of
  await expect(page.locator('#toast')).toContainText('your atlas');
});

// A band in the index is documented as handing over exactly what is on the
// screen, filters and all. It did that for the places and then laid every path
// in the atlas underneath them.
test('a band in the index composes with that city\'s paths, and no others', async ({ page }) => {
  await openCities(page);
  await layWays(page, [
    { id: 'wl', name: 'The Lisboa Way', path: straight(6), city: 'Lisboa', country: 'Portugal' },
    { id: 'wb', name: 'The Basel Way', path: straight(5), city: 'Basel', country: 'Switzerland' },
  ]);
  await showIndex(page);
  // the arrangement is one cycling word now: newest, a-z, nearest, by city
  await expect(page.locator('#sortWord')).toHaveText('newest');
  await page.locator('#sortWord').click();
  await page.locator('#sortWord').click();
  await page.locator('#sortWord').click();
  await expect(page.locator('#sortWord')).toHaveText('by city');
  await expect(page.locator('.ix-band').first()).toBeVisible();
  await page.locator('.ix-band', { hasText: 'lisboa' }).locator('.ix-fol').click();

  await expect(page.locator('#folTitle')).toHaveValue('Lisboa, Portugal');
  const ways = await page.locator('.fol-row[data-wid] .nm').allTextContents();
  expect(ways, 'a folio for Lisbon was offered a walk in Basel').toEqual(['The Lisboa Way']);
  await expect(page.locator('.fol-count')).toContainText('5 selected · 6 visible');
});

// A gpx is a file, and every other file door in this app reads the two words
// on a record before it writes. This one wrote whatever was on the plate.
test('the plate writes no gpx that a link would not carry', async ({ page }) => {
  await open(page, { places: 1 });
  await layWays(page, [
    { id: 'own', name: 'My Own Way', path: straight(6), private: true },
    { id: 'hid', name: 'The Hidden Ends', path: straight(6), trimEnds: true },
  ]);
  const written = [];
  page.on('download', d => written.push(d));

  await openTheWay(page, 'own');
  await page.locator('#pRouteGpx').click();
  await expect(page.locator('#toast')).toContainText('Excluded from sharing');
  expect(written.length, 'a path marked never to leave was written to a file').toBe(0);
  await page.locator('#pClose').click();

  await openTheWay(page, 'hid');
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#pRouteGpx').click(),
  ]);
  const gpx = await readFile(await file.path(), 'utf8');
  const lats = [...gpx.matchAll(/lat="([\d.]+)"/g)].map(m => Number(m[1]));
  expect(lats, 'the trimmed line is two points').toHaveLength(2);
  // a quarter kilometre in from each end: 46.000000 and 46.053960 are the door
  // and the far end of the walk, and neither belongs in this file
  expect(lats[0], 'the file began at the door the plate promises to hide').toBeGreaterThan(46.002);
  expect(lats[1], 'the file ran to the end the plate promises to hide').toBeLessThan(46.0518);
});

// ---------- and one the gate itself found ----------
//
// This was not on the list. It was found by a suite that failed once in five
// runs on webkit and passed on the other four, which is the worst thing a gate
// can do, and the cause was in the app rather than in the test: the focus was
// being left inside a surface after that surface was hidden, so the next
// keystroke was read as typing into a field nobody could see.
//
// The plate proves it without a race, because a plate hands the focus back to
// nobody by design: what it holds when it closes, it keeps.
test('a surface that closes does not keep the focus, or the keystroke after it', async ({ page }) => {
  await open(page, { places: 1 });
  await layWays(page, [{ id: 'w1', name: 'The Long Way', path: straight(6) }]);
  await openTheWay(page, 'w1');
  await page.locator('#pRouteNote').fill('where it starts, and when');
  await expect(page.locator('#pRouteNote')).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(page.locator('#plate')).toBeHidden();
  const stranded = await page.evaluate(() =>
    document.querySelector('#plate').contains(document.activeElement));
  expect(stranded, 'the focus was left in a field inside a hidden surface').toBe(false);

  // which is the whole of why it matters: the command line is not opened by a
  // page that thinks the person is still typing
  await page.keyboard.press('/');
  await expect(page.locator('#paletteInput'),
    'the command line swallowed the press that opens it').toBeVisible();
});

// ---------- a word under a name gathers its own kind ----------

test('pressing a city, a country or a tag brings its places to the top', async ({ page }) => {
  // The same act as a city typed into a folio's title, and the same rule: what
  // was pressed comes first and nothing leaves the page, because the answer to
  // "show me Basel" is Basel first, not Basel alone.
  await openCities(page);
  await showIndex(page);
  await expect(page.locator('#listView .ix[data-id]').first()).toBeVisible();

  const names = () => page.locator('#listView .ix-name').allTextContents();
  const held = await page.locator('#listView .ix[data-id]').count();
  expect(held).toBe(13);
  const before = await names();
  expect(before[0].startsWith('Porto'), 'this proves nothing if Porto is already first').toBe(false);

  // a city, pressed on a row well down the list
  await page.locator('.ix-g[data-gk="city"][data-gv="Porto"]').first().click();
  expect((await names())[0]).toBe('Porto spot 0');
  expect(await page.locator('#listView .ix[data-id]').count(),
    'gathering took rows off the page').toBe(held);
  await expect(page.locator('.ix-gathered')).toContainText('porto first');

  // a country gathers a country, and both Portuguese cities answer it
  await page.locator('.ix-g[data-gk="country"][data-gv="Portugal"]').first().click();
  const byLand = await names();
  expect(byLand.slice(0, 6).every(n => n.startsWith('Porto') || n.startsWith('Lisboa')),
    `the country gathered something else: ${byLand.slice(0, 6)}`).toBe(true);
  expect(await page.locator('#listView .ix[data-id]').count()).toBe(held);

  // pressing the one already gathered lets go, and the order comes back
  await page.locator('.ix-g[data-gk="country"][data-gv="Portugal"]').first().click();
  expect(await names()).toEqual(before);
  await expect(page.locator('.ix-gathered')).toHaveCount(0);
});

test('a word under a name is a control a keyboard can reach', async ({ page }) => {
  // It was a span inside the button that opens the place. A click handler there
  // is unreachable by keyboard, and a button inside a button is not agreed upon
  // by any two engines, so the metadata left the button and became its own row
  // of controls.
  await openCities(page);
  await showIndex(page);
  await expect(page.locator('#listView .ix[data-id]').first()).toBeVisible();

  const nested = await page.locator('#listView .ix button').count();
  expect(nested, 'a button was put inside a button').toBe(0);

  const word = page.locator('.ix-g').first();
  await expect(word).toHaveAttribute('aria-pressed', 'false');
  await word.focus();
  await expect(word).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.ix-gathered')).toBeVisible();

  // and it says which way it is pressed, for anything that cannot see the line
  await expect(page.locator('.ix-g[aria-pressed="true"]').first()).toBeVisible();
});

test('the words under a name wrap rather than running off a phone', async ({ page }) => {
  // the line holds a city, a country, every tag and what was said about the
  // place. it used to hold a locale and one tag, and it did not wrap.
  await page.setViewportSize({ width: 375, height: 812 });
  await openCities(page);
  await showIndex(page);
  await expect(page.locator('#listView .ix[data-id]').first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);

  const over = await page.locator('.ix-meta').evaluateAll(
    ns => ns.map(n => n.scrollWidth - n.clientWidth).filter(d => d > 1));
  expect(over, `the words ran off the side of a phone by ${over.join(', ')} pixels`).toEqual([]);
  const sideways = await page.evaluate(() => {
    const l = document.querySelector('#listView');
    return l.scrollWidth > l.clientWidth + 1;
  });
  expect(sideways, 'the index scrolls sideways').toBe(false);
});

// ---------- what you would say about it, said where you are deciding ----------

test('a place that is in shows its reason, and the reason can be rewritten there', async ({ page }) => {
  // The note is the only thing in a folio that is not a fact. It is the reason
  // the place is in it, and a line written for oneself two years ago is not the
  // line a person would say to Ada now. Sending them to the plate to fix it
  // would cost them the composition they are in the middle of.
  await open(page, { places: 3 });
  await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const { store } = await import(`/js/store.js${v}`);
    store.load();
    store.updatePlace('p0', { note: 'a line I wrote for myself' });
  });
  await showIndex(page);
  await page.locator('[data-go="folio"]').click();
  await page.locator('#folNew').click();
  await expect(page.locator('.fol-row[data-fid]').first()).toBeVisible();

  // nothing is in, so nothing is asked about
  expect(await page.locator('.fol-say').count(),
    'a word under every place is noise; the question is only about the ones going').toBe(0);

  await page.locator('.fol-row[data-fid="p0"]').click();
  const said = page.locator('.fol-item', { has: page.locator('[data-fid="p0"]') }).locator('.fol-say');
  await expect(said).toContainText('a line I wrote for myself');

  await said.click();
  const field = page.locator('.fol-saying[data-saying="p0"]');
  await expect(field).toBeVisible();
  await expect(field).toHaveAttribute('aria-label', 'Edit the atlas note for Place 0');
  await expect(field).toHaveAttribute('aria-describedby', 'folNoteHelp');
  await expect(page.locator('#folNoteHelp')).toHaveText(
    'This is the place’s atlas note. Changes appear everywhere you use it.',
  );
  await field.fill('go before ten, the room is still quiet');
  await field.blur();

  await expect(page.locator('.fol-item', { has: page.locator('[data-fid="p0"]') })
    .locator('.fol-say')).toContainText('go before ten');
  const kept = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('resonate.places.v1')).find(p => p.id === 'p0').note);
  expect(kept).toBe('go before ten, the room is still quiet');
});

test('saying what you would say about a sample makes it yours, and lets it travel', async ({ page }) => {
  // editing is what makes a sample your own, everywhere else in the app. it is
  // the same word here, and it is what turns a folio that can hand over nothing
  // into one that can.
  await open(page, { places: 2 });
  await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const { store } = await import(`/js/store.js${v}`);
    store.load();
    store.updatePlace('p0', { sample: true });
  });
  await showIndex(page);
  await page.locator('[data-go="folio"]').click();
  await page.locator('#folNew').click();
  await page.locator('.fol-row[data-fid="p0"]').click();
  // no label stands on the row: the sample is real and unmarked on every surface
  await expect(page.locator('.fol-row[data-fid="p0"] .sub')).not.toContainText('sample');

  await page.locator('.fol-item', { has: page.locator('[data-fid="p0"]') }).locator('.fol-say').click();
  const field = page.locator('.fol-saying[data-saying="p0"]');
  await field.fill('mine now, and worth the walk');
  await field.blur();

  await expect(page.locator('.fol-row[data-fid="p0"] .sub'),
    'a place that was edited is still called a sample').toHaveText('');
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('resonate.places.v1')).find(p => p.id === 'p0'));
  expect(stored.sample).toBe(false);
  expect(stored.note).toBe('mine now, and worth the walk');
});

// ---------- the words under a name sit on one line ----------

test('a padded word and a plain word in the same row share a baseline', async ({ page }) => {
  // rf95 gave .ix-g four pixels of vertical padding to reach the twenty-four a
  // pointer target is owed, and .ix-meta had no align-items, so it defaulted to
  // stretch: the buttons set the line height, and the plain words beside them,
  // "want to go" and the byline, rendered their text at the top of the taller
  // box. They sat four pixels high for a release, and looking at the screen did
  // not catch it.
  //
  // Border boxes cannot test this. A padded button's box legitimately starts
  // above a plain span's even when their text aligns perfectly, so the
  // assertion is over a Range across the text nodes themselves.
  await open(page, { places: 2 });
  await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const { store } = await import(`/js/store.js${v}`);
    store.load();
    store.updatePlace('p0', { status: 'wishlist' });
  });
  await showIndex(page);
  await expect(page.locator('#listView .ix[data-id]').first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);

  const drift = await page.evaluate(() => {
    const bottomOfText = (el) => {
      const r = document.createRange();
      r.selectNodeContents(el);
      return r.getBoundingClientRect().bottom;
    };
    const row = [...document.querySelectorAll('.ix-meta')].find(m =>
      m.querySelector('.ix-g') && [...m.children].some(c => !c.classList.contains('ix-g')));
    if (!row) return null;
    const padded = row.querySelector('.ix-g');
    const plain = [...row.children].find(c => !c.classList.contains('ix-g'));
    return Math.abs(bottomOfText(padded) - bottomOfText(plain));
  });

  expect(drift, 'no row held both a padded word and a plain one').not.toBeNull();
  expect(drift, `the words sit ${drift} pixels apart`).toBeLessThan(1.5);
});

// ---------- the file this app offers has a reader ----------
//
// "Hand over the whole atlas" writes a link. When the link is too long the
// panel says to send the file instead. That file was written by
// humanHandoverJSON and read by nothing: the one file input in the app asked
// every arriving file whether it was a private archive, and told a friend's
// atlas it was not a resonate export. The way around a long link ended at a
// door that refused it.
//
// A handover must never merge on arrival. It opens as a visit, exactly as the
// same atlas would if it had come as a link, and nothing is written until the
// person takes a record.

const A_HANDOVER = JSON.stringify({
  app: 'resonate', exportedAt: '2026-08-10T00:00:00.000Z',
  v: 5, kind: 'atlas', author: 'marta',
  tags: [{ id: 'tf', name: 'Food', emoji: '', color: '#a53' }],
  places: [
    { id: 'm1', name: 'Handed Sentinel Place', lat: 38.71, lng: -9.14, city: 'Lisboa',
      country: 'Portugal', tags: ['tf'], status: 'visited', note: 'the counter at the back' },
    { id: 'm2', name: 'Second Handed Sentinel', lat: 38.72, lng: -9.15, city: 'Lisboa',
      country: 'Portugal', tags: ['tf'], status: 'visited' },
  ],
  routes: [],
}, null, 2);

async function bringFileIn(page, text, name = 'handed.json') {
  await openYours(page);
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('#impJson').click(),
  ]);
  await chooser.setFiles({ name, mimeType: 'application/json', buffer: Buffer.from(text) });
}

const heldNow = (page) => page.evaluate(async () => {
  const v = new URL(document.querySelector('script[type=module]').src).search;
  const { store } = await import(`/js/store.js${v}`);
  store.load();
  return { places: store.places.length, routes: store.routes.length,
    names: store.places.map(p => p.name) };
});

test('a handover file opens as a visit, and writes nothing by opening', async ({ page }) => {
  await open(page, { places: 2 });
  const before = await heldNow(page);
  expect(before.places, 'the fixture held nothing, so nothing could be proved').toBe(2);

  await bringFileIn(page, A_HANDOVER);

  // it is read, and it is somebody's
  const report = page.locator('#reportOverlay');
  await expect(report).toBeVisible();
  await expect(report.locator('.rp-name')).toHaveText('marta');
  await expect(report).toContainText('Handed Sentinel Place');

  // and the atlas underneath is untouched: a stranger's file may replace
  // nothing, and opening one is not a decision
  const after = await heldNow(page);
  expect(after.places, 'opening a handover wrote records').toBe(before.places);
  expect(after.names, 'a handed place arrived without being taken')
    .not.toContain('Handed Sentinel Place');
});

test('a record from a handover file arrives only when it is taken', async ({ page }) => {
  await open(page, { places: 2 });
  await bringFileIn(page, A_HANDOVER);
  await expect(page.locator('#reportOverlay')).toBeVisible();

  await page.locator('#reportOverlay [data-adopt="0"]').first().click();
  await expect.poll(async () => (await heldNow(page)).places).toBe(3);
  const after = await heldNow(page);
  expect(after.names).toContain('Handed Sentinel Place');
  expect(after.names, 'taking one took the other as well').not.toContain('Second Handed Sentinel');
});

test('a copy made for an assistant is explained, not read as a poor backup', async ({ page }) => {
  await open(page, { places: 2 });
  const copy = JSON.stringify({
    app: 'resonate', kind: 'assistant_copy', exportedAt: '2026-08-10T00:00:00.000Z',
    terms: 'https://resonate.select/read.html?d=assistant',
    disclosure: JSON.parse(A_HANDOVER),
  }, null, 2);

  await bringFileIn(page, copy, 'for-an-assistant.json');
  const said = page.locator('#askWhat');
  await expect(said).toContainText('copy made for an assistant to read');
  await expect(said, 'it was offered as something to restore from').toContainText('It is not a backup');
  await expect(said, 'the person is not told what restoring from it would cost them')
    .toContainText('leave you with less than you have');

  const after = await heldNow(page);
  expect(after.places, 'an assistant copy wrote records by arriving').toBe(2);

  // and the atlas inside is openable, because it is an ordinary handover and
  // refusing to read an atlas this app can read would be unhelpful about its
  // own format
  await page.locator('#askGo').click();
  await expect(page.locator('#reportOverlay')).toBeVisible();
  await expect(page.locator('#reportOverlay .rp-name')).toHaveText('marta');
  expect((await heldNow(page)).places, 'opening what was inside wrote records').toBe(2);
});

test('a file answering to two descriptions at once is refused at the door', async ({ page }) => {
  await open(page, { places: 2 });
  // an archive number and a handover kind on one file: routing it by whichever
  // branch runs first is how a stranger's atlas reaches "make this atlas the file"
  const polyglot = JSON.stringify({
    ...JSON.parse(A_HANDOVER), version: 5, folios: [], correspondents: [], settings: {},
  }, null, 2);

  await bringFileIn(page, polyglot, 'both.json');
  await expect(page.locator('body')).toContainText('answers to two descriptions');
  await expect(page.locator('#reportOverlay'), 'an ambiguous file opened as a visit anyway').toBeHidden();
  expect((await heldNow(page)).places).toBe(2);
});

// ---------- the button budget, on the surfaces node cannot see ----------
//
// The static shell is counted in the words suite. These count the surfaces
// that exist only once rendered, at rest: before any unfold is pressed. The
// numbers are law the way the em-dash is; raising one is a deliberate act
// here, not a side effect of shipping a feature.

test('the surface does not grow back: yours and hand over, at rest', async ({ page }) => {
  await open(page, { places: 3 });

  await openYours(page);
  const yoursAtRest = await page.locator('#settingsBody button:visible').count();
  expect(yoursAtRest, `yours holds ${yoursAtRest} words at rest; the budget is 12`)
    .toBeLessThanOrEqual(12);
  // and the fold works: the six other forms exist one press away, not fewer
  await page.locator('#moreForms').click();
  await expect(page.locator('#formRow')).toBeVisible();
  const unfolded = await page.locator('#formRow button:visible').count();
  expect(unfolded, 'a format left the app instead of leaving the room').toBe(6);

  await page.locator('#settingsOverlay .poster-x').click();
  await page.locator('#indexClose').click();
  await page.keyboard.press('/');
  await page.locator('#paletteInput').fill('>share');
  await expect(page.locator('.cmd-row').first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('#shareOverlay')).toBeVisible();
  const shareAtRest = await page.locator('#shareBody button:visible').count();
  expect(shareAtRest, `hand over holds ${shareAtRest} words at rest; the budget is 3`)
    .toBeLessThanOrEqual(3);
  await expect(page.locator('.share-choice')).toHaveCount(2);
  await expect(page.locator('#shWholeRow')).toBeHidden();
  await expect(page.locator('#shFolio')).toContainText('Creating it shares nothing');
  // the whole atlas unfolds to its two carriers
  await page.locator('#shWhole').click();
  await expect(page.locator('#shGo')).toBeVisible();
  await expect(page.locator('#shFile')).toBeVisible();
});

test('settings keeps essentials visible and detail calm on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, { places: 7, books: 3, ways: 1, folios: 2 });
  await openYours(page);

  for (const selector of ['#authorName', '#expJson', '#impJson', '#clubWord', '#censusWord']) {
    await expect(page.locator(selector), `${selector} disappeared from settings at rest`).toBeVisible();
  }
  for (const selector of ['#assistantSettings', '#deviceSettings', '#resetSettings']) {
    const disclosure = page.locator(selector);
    await expect(disclosure.locator('summary')).toBeVisible();
    await expect(disclosure, `${selector} opened without being asked`).not.toHaveAttribute('open', '');
  }
  for (const selector of ['#agentAccessToggle', '#snapRestore', '#eraseAll']) {
    await expect(page.locator(selector), `${selector} escaped its disclosure`).toBeHidden();
  }

  const headings = page.locator('#settingsBody h2');
  await expect(headings).toHaveCount(5);
  await expect(headings).toHaveText([
    'sharing name',
    'backup and recovery',
    /assistant access/i,
    /this device/i,
    /reset this atlas/i,
  ]);

  const fit = await page.evaluate(() => {
    const room = document.querySelector('#settingsOverlay');
    const visible = [...room.querySelectorAll('*')].filter((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    });
    const outside = visible.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.left < -0.5 || r.right > innerWidth + 0.5;
    }).map(el => `${el.tagName.toLowerCase()}#${el.id || ''}.${String(el.className || '').split(/\s+/)[0]}`);
    const text = visible.filter(el => el.matches(
      '.settings-door-title,.settings-door-note,.settings-door-action,'
      + '.set-summary-title,.set-summary-note,.set-summary-state'));
    return {
      outside,
      horizontal: room.scrollWidth - room.clientWidth,
      screens: room.scrollHeight / innerHeight,
      clippedText: text.filter(el => el.scrollWidth > el.clientWidth + 1)
        .map(el => el.textContent.trim()),
    };
  });
  expect(fit.outside, `settings put content beyond the phone: ${fit.outside.join(', ')}`).toEqual([]);
  expect(fit.horizontal, 'settings gained a horizontal scroll').toBeLessThanOrEqual(1);
  expect(fit.clippedText, `settings clipped ${fit.clippedText.join(', ')}`).toEqual([]);
  expect(fit.screens, `settings at rest grew to ${fit.screens.toFixed(2)} phone screens`)
    .toBeLessThanOrEqual(1.5);
});

// ---------- capture: the gestures that need no typing ----------
//
// Three ways in, each one press deep: press the map (tested above), stand
// here, and from a photograph. The photograph door existed for a release and
// was reachable only by typing >photo, which on the phone that holds the
// photographs is a door with no handle.

test('stand here keeps the ground under your feet, and the fix outlives the network', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 47.3769, longitude: 8.5417 });
  await open(page, { places: 2 });

  await page.keyboard.press('/');
  await expect(page.locator('#capHere')).toBeVisible();
  await page.locator('#capHere').click();

  // the record is down under its own coordinates before any network answers;
  // the geocoder is blocked in these tests, so the DMS name simply stands,
  // which is exactly what offline capture promises
  await expect(page.locator('#toast')).toContainText('kept where you stand');
  const kept = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('resonate.places.v1')).find(p => Math.abs(p.lat - 47.3769) < 1e-4));
  expect(kept, 'the press kept nothing').toBeTruthy();
  expect(kept.lng).toBeCloseTo(8.5417, 4);
  expect(kept.status, 'standing somewhere is having been there').toBe('visited');
  expect(kept.name, 'an offline capture still has its coordinates for a name').toMatch(/°/);

  // and the plate is open for the person to name it themselves
  await expect(page.locator('#plate')).toBeVisible();
});

test('the empty bar offers the two capture words, and the photograph word opens the chooser', async ({ page }) => {
  await open(page, { places: 2 });
  await page.keyboard.press('/');
  await expect(page.locator('#capHere')).toBeVisible();
  await expect(page.locator('#capPhoto')).toBeVisible();

  // the chooser opening IS the assertion: waitForEvent times out otherwise.
  // it is the same input the >photo verb uses: one door, two handles.
  await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('#capPhoto').click(),
  ]);
  await expect(page.locator('#paletteOverlay'), 'the palette stayed over the field').toBeHidden();
});

test('a refused fix changes nothing and says so', async ({ page, context }) => {
  await context.grantPermissions([]);
  await open(page, { places: 2 });
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('resonate.places.v1')).length);
  await page.keyboard.press('/');
  await page.locator('#capHere').click();
  await expect(page.locator('#toast')).toContainText('would not say where you are');
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('resonate.places.v1')).length);
  expect(after, 'a refusal wrote a record anyway').toBe(before);
});

// ---------- the restore preview speaks by kind ----------
//
// "4 records it has, differently" cannot tell a person whether a note changed
// or a folio lost half its places. The comparison sees every kind now, and
// the panel says which: a changed path and a changed folio are named as what
// they are, and a byline the restore would overwrite gets a sentence, because
// it is the quietest replacement of all.
test('the panel before a restore names kinds, and the byline it would change', async ({ page }) => {
  await open(page, { places: 2 });
  await layWays(page, [{ id: 'w1', name: 'The Named Way', path: straight(6) }]);

  const file = await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const { store } = await import(`/js/store.js${v}`);
    store.load();
    const f = JSON.parse(store.exportJSON());
    f.places.push({ ...f.places[0], id: 'pNew', name: 'A New Place' });
    f.routes[0] = { ...f.routes[0], name: 'The Renamed Way' };
    f.settings = { ...f.settings, authorName: 'grace' };
    return JSON.stringify(f, null, 2);
  });

  await openYours(page);
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('#impJson').click(),
  ]);
  await chooser.setFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(file) });

  const said = page.locator('#askWhat');
  await expect(said).toContainText('1 new place');
  await expect(said, 'a renamed path was not named as a changed path').toContainText('1 changed path');
  await expect(said, 'the sharing name the restore would set went unsaid').toContainText('sharing name differs');
  await expect(said).not.toContainText('records this atlas does not have');
  await page.locator('#askNo').click();
});

// ---------- the loop, closed: a heart travels back ----------
//
// A friend was handed places, went, and came back to say one of them was
// worth the going. These drive the whole circle in one browser: the folio is
// composed, received, thanked from, and the thanks is opened where it was
// sent from, so the heart lands on the very record that earned it.

test('a heart pressed in a received folio lands on the sender’s own record', async ({ page }) => {
  await open(page, { places: 3 });

  // the folio, as the sender's atlas would hand it over
  const folioUrl = await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const { store } = await import(`/js/store.js${v}`);
    const { makeFolioUrl } = await import(`/js/share.js${v}`);
    store.load();
    return makeFolioUrl({ title: 'Basel', dedication: 'for you', author: 'ada',
      tags: [], places: store.places, routes: [] });
  });

  // the recipient opens it and presses the heart beside the second place
  await arrive(page, folioUrl);
  await expect(page.locator('#reportOverlay')).toBeVisible();
  await page.evaluate(() => {
    navigator.share = (data) => { window.__thanksUrl = data.url; return Promise.resolve(); };
  });
  await page.locator('[data-thank="1"]').click();
  const thanksUrl = await page.evaluate(() => window.__thanksUrl);
  expect(thanksUrl, 'pressing the heart composed no link').toBeTruthy();
  expect(thanksUrl).toContain('#m=');

  // the sender opens the thanks. same storage, same atlas: the pid names
  // their own record directly.
  await arrive(page, thanksUrl);
  // A whole boot stands between the press and these words: a navigation, a
  // reload, the modules, the gate. Twenty seconds was enough on every machine
  // but a loaded runner, where this failed once in firefox and nowhere else.
  await expect(page.locator('#toast')).toContainText('a heart from ada, for Place 1', { timeout: 35000 });
  const kept = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('resonate.places.v1')).find(p => p.id === 'p1'));
  expect(kept.thanks, 'the heart was announced and not kept').toHaveLength(1);
  expect(kept.thanks[0].from).toBe('ada');

  // the plate is standing on the place, and names the thanker
  await expect(page.locator('#plate')).toBeVisible();
  await expect(page.locator('.plate-thanks')).toContainText('thanked by ada');

  // the same link a second time is one thanks, not two. open()'s init
  // script re-seeds storage on every navigation, so the written state is
  // pinned as a later init script first, or the replay would be tested
  // against a boot that never heard the first heart.
  const mutated = await page.evaluate(() => localStorage.getItem('resonate.places.v1'));
  await page.addInitScript((state) => localStorage.setItem('resonate.places.v1', state), mutated);
  await arrive(page, thanksUrl);
  await expect(page.locator('#toast')).toContainText('already on the record', { timeout: 35000 });
  const still = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('resonate.places.v1')).find(p => p.id === 'p1'));
  expect(still.thanks, 'a replayed link doubled the count').toHaveLength(1);
});

test('a heart for a place this atlas does not hold says so and writes nothing', async ({ page }) => {
  await open(page, { places: 2 });
  const thanksUrl = await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const { makeThanksUrl } = await import(`/js/share.js${v}`);
    return makeThanksUrl({ from: 'bruno', pid: 'no_such', name: 'Nowhere Bar',
      at: { lat: 12, lng: 34 }, when: '2026-08-11T00:00:00.000Z' });
  });
  await arrive(page, thanksUrl);
  await expect(page.locator('#toast')).toContainText('no place here answers to it', { timeout: 35000 });
  // the live store, not storage: the fixture re-seeds storage each boot, so
  // the honest question is what the running app is holding after the refusal
  const held = await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const { store } = await import(`/js/store.js${v}`);
    return { n: store.places.length, thanked: store.places.filter(p => p.thanks).length };
  });
  expect(held.thanked, 'a heart with no home landed somewhere anyway').toBe(0);
  expect(held.n, 'the refusal changed the atlas').toBe(2);
});

test('the moment respects stillness, and the record does not depend on it', async ({ page }) => {
  await open(page, { places: 2 });
  const thanksUrl = await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const { makeThanksUrl } = await import(`/js/share.js${v}`);
    return makeThanksUrl({ from: 'marta', pid: 'p0', name: 'Place 0',
      at: null, when: '2026-08-11T05:00:00.000Z' });
  });

  // reduced motion, which open() has asked for: the record without the moment
  await arrive(page, thanksUrl);
  await expect(page.locator('#toast')).toContainText('a heart from marta', { timeout: 35000 });
  expect(await page.locator('.heart-bloom').count(),
    'a device that asked for stillness was animated at anyway').toBe(0);

  // the same arrival with motion allowed: the moment happens
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const second = await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const { makeThanksUrl } = await import(`/js/share.js${v}`);
    return makeThanksUrl({ from: 'marta', pid: 'p0', name: 'Place 0',
      at: null, when: '2026-08-11T06:00:00.000Z' });
  });
  await arrive(page, second);
  await expect(page.locator('#toast')).toContainText('a heart from marta', { timeout: 35000 });
  // the moment: rings from the place, the heart drawn and filled, and the name
  // of whoever sent it. it stands on the field and it leaves on its own.
  const bloom = page.locator('.heart-bloom');
  await expect(bloom).toBeVisible({ timeout: 5000 });
  // and it happens where it can be seen: a thanks clears its own hash on the
  // way in, and the film used to read that cleared hash as an ordinary visit
  // and play the whole evening over the moment the person came for
  await expect(page.locator('#intro'), 'the moment played behind the film').toBeHidden();
  await expect(bloom.locator('.hb-who')).toHaveText('marta');
  expect(await bloom.locator('.hb-ring').count(), 'the rings did not open').toBe(4);
  await expect(bloom, 'the moment stayed on the field').toBeHidden({ timeout: 8000 });
});

test('hearts are reflected where choosing happens: index, plate, composer', async ({ page }) => {
  const now = new Date().toISOString();
  await open(page, {
    places: 0,
    atlas: [0, 1, 2].map(i => ({
      id: 'p' + i, name: 'Place ' + i, lat: 46 + i * 0.01, lng: 8 + i * 0.01,
      city: 'Basel', country: 'Switzerland', tags: [], status: 'visited',
      note: '', createdAt: now, updatedAt: now,
      ...(i === 1 ? { thanks: [
        { from: 'marta', when: 'T1' }, { from: 'bruno', when: 'T2' }, { from: 'bruno', when: 'T3' },
      ] } : {}),
    })),
  });

  // the index wears the true count
  await showIndex(page);
  const row = page.locator('.ix-row', { hasText: 'Place 1' });
  await expect(row.locator('.ix-thanks')).toContainText('3');

  // and the count is a door: pressing it names who came back, and when
  await expect(row.locator('.ix-roll')).toBeHidden();
  await row.locator('.ix-thanks').click();
  await expect(row.locator('.ix-roll')).toBeVisible();
  await expect(row.locator('.ix-roll')).toContainText('marta');
  await expect(row.locator('.ix-roll')).toContainText('bruno');
  expect(await row.locator('.ix-roll-one').count(),
    'three hearts were rolled up into fewer names').toBe(3);
  await row.locator('.ix-thanks').click();
  await expect(row.locator('.ix-roll'), 'the door only opens').toBeHidden();

  // the plate names the thankers, twice counted honestly
  await page.locator('.ix', { hasText: 'Place 1' }).click();
  await expect(page.locator('.plate-thanks'))
    .toContainText('thanked by marta, and twice by bruno');
  // and it opens onto the same roll
  await page.locator('#pThanks').click();
  await expect(page.locator('#pRoll')).toBeVisible();
  await expect(page.locator('#pRoll')).toContainText('bruno');

  // the composer stands the thanked place first in its city
  await page.keyboard.press('Escape');
  await showIndex(page);
  await page.locator('[data-go="folio"]').click();
  await page.locator('#folNew').click();
  const rows = await page.locator('.fol-row[data-fid] .nm').allTextContents();
  expect(rows[0], 'the place friends came back for is not standing first').toBe('Place 1');
  await expect(page.locator('.fol-row[data-fid]', { hasText: 'Place 1' }).locator('.sub'))
    .toContainText('\u2665 3');
});

// ---------- the coordinates corner is the way to where you stand ----------
test('pressing the coordinates flies the field to where you stand, and nearest means you', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 47.3769, longitude: 8.5417 });
  await open(page, { places: 3 });

  await page.locator('#coordsReadout').click();
  await expect(page.locator('#toast')).toContainText('where you stand');
  const center = await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const { getCenter } = await import(`/js/map.js${v}`);
    return getCenter();
  });
  expect(center.lat).toBeCloseTo(47.3769, 1);
  expect(center.lng).toBeCloseTo(8.5417, 1);

  // and nothing was captured: this is looking, not keeping
  const n = await page.evaluate(() => JSON.parse(localStorage.getItem('resonate.places.v1')).length);
  expect(n, 'flying to a fix quietly kept a place').toBe(3);

  // the fix is remembered, so the sort word can mean nearest you
  await showIndex(page);
  await page.locator('#sortWord').click();
  await page.locator('#sortWord').click();
  await expect(page.locator('#sortWord')).toHaveText('nearest you');
});

// The same claim on the device the claim is actually about.
//
// The test above passes at 1280 and passed at 1280 for every release in which
// a phone could not do this at all. `.fm-se` began as a readout of twenty
// characters of mono, which has no business on a phone, so a media query hid
// it; later the readout became the one control that flies the field to you,
// and the rule went on hiding it. The dot was still drawn, because `drawHere`
// runs whatever `fly` says, so a person who granted the permission was given a
// mark somewhere off the edge of a field they had no way of moving.
//
// Plant `.fm-se { display: none; }` back into the 760px block and this fails
// on its first line, which is what the release that shipped it would have got.
test('a phone can be taken to where it is standing, and the door is a thumb wide', async ({ page, context }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 47.3769, longitude: 8.5417 });
  await open(page, { places: 3 });

  const door = page.locator('#coordsReadout');
  await expect(door, 'the only way to where you stand is hidden on a phone').toBeVisible();

  // A thumb needs forty four, which is the number the question mark in the
  // other corner is already given and the number this one was not.
  const box = await door.boundingBox();
  expect(box.width, 'the door is narrower than a thumb').toBeGreaterThanOrEqual(44);
  expect(box.height, 'the door is shorter than a thumb').toBeGreaterThanOrEqual(44);

  // and it stands clear of everything else on the field at this width, which
  // is why it is not in the bottom row: at 360 that row has forty nine pixels
  // between the command word and the question mark, five short of a thumb.
  for (const other of ['#fmIndex', '#fmCommand', '#fmHelp']) {
    const b = await page.locator(other).boundingBox();
    const apart = box.x >= b.x + b.width || b.x >= box.x + box.width
      || box.y >= b.y + b.height || b.y >= box.y + box.height;
    expect(apart, `the door overlaps ${other}`).toBe(true);
  }

  // the coordinates themselves are not on a phone: this corner is a door here
  // and a door only
  await expect(page.locator('#coordsReadout .fm-dms')).toBeHidden();

  await door.click();
  await expect(page.locator('#toast')).toContainText('where you stand');

  // the field went there, which is the whole of what was missing
  const center = await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const { getCenter } = await import(`/js/map.js${v}`);
    return getCenter();
  });
  expect(center.lat, 'the field did not move to the fix').toBeCloseTo(47.3769, 1);
  expect(center.lng).toBeCloseTo(8.5417, 1);

  // and the mark is on it, drawn as itself and not as a place: a place is a
  // ring around a dot, and this is a dot inside its own accuracy
  await expect(page.locator('.here-dot')).toBeVisible();
  await expect(page.locator('#coordsReadout .fm-here-dot')).toBeVisible();
});

// ---------- the entry board ----------
//
// A returning visit opens on the index: the places are what a person comes
// back to do something with. The field stands one press beneath. First
// visits keep the threshold, and an arrival holding a link is taken to the
// thing it holds.
test('a returning visit opens on the index, and the field stands beneath it', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const pattern of OFF) await page.route(pattern, r => r.abort());
  await page.addInitScript(() => {
    const now = new Date().toISOString();
    localStorage.setItem('resonate.places.v1', JSON.stringify([
      { id: 'p0', name: 'Held Place', lat: 46, lng: 8, city: 'Basel', country: 'Switzerland',
        tags: [], status: 'visited', createdAt: now, updatedAt: now }]));
    localStorage.setItem('resonate.settings.v1', JSON.stringify({
      theme: 'auto', chosen: true, seeded: true, introSeen: true, authorName: 'ada', hue: 300 }));
  });
  await page.goto('/');
  await expect(page.locator('#intro')).toBeHidden({ timeout: 15000 });
  await expect(page.locator('#indexOverlay')).toBeVisible();
  await expect(page.locator('#ixN')).toHaveText('1');
  // and the boot says where it came to rest, in one word
  await expect(page.locator('body')).toHaveAttribute('data-entry', 'board');
  // and it is a door, not a wall
  await page.keyboard.press('Escape');
  await expect(page.locator('#indexOverlay')).toBeHidden();
});

test('an arrival holding a folio goes to the letter, not the board', async ({ page }) => {
  await open(page, { places: 2 });
  const url = await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const { store } = await import(`/js/store.js${v}`);
    const { makeFolioUrl } = await import(`/js/share.js${v}`);
    store.load();
    return makeFolioUrl({ title: 'Basel', author: 'ada', tags: [], places: store.places, routes: [] });
  });
  await arrive(page, url);
  // the arrival is a full boot, and a loaded runner takes its time over one:
  // the suite's own gate for that is the intro, so wait at the same door
  // every other arrival waits at before asking after the letter
  await expect(page.locator('#intro')).toBeHidden({ timeout: 15000 });
  await expect(page.locator('#reportOverlay')).toBeVisible({ timeout: 35000 });
  await expect(page.locator('body')).toHaveAttribute('data-entry', 'letter');
  await expect(page.locator('#indexOverlay'), 'the board rose over a letter').toBeHidden();
});

test('a first visit still meets the threshold, not the board', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const pattern of OFF) await page.route(pattern, r => r.abort());
  await page.goto('/');
  await expect(page.locator('#intro')).toBeHidden({ timeout: 15000 });
  await expect(page.locator('#threshold')).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-entry', 'threshold');
  await expect(page.locator('#indexOverlay')).toBeHidden();

  // and the first door says what it does before it is pressed. opening a full
  // atlas is the one explicit act that makes those records the person's own:
  // they are counted in a comparison and they travel under a byline. the
  // numbers are read from the atlas the app would actually open, never typed
  // onto the page, so a record added to the seed changes the sentence.
  const said = await page.locator('#thFullWhat').textContent();
  const seed = await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const { demoData } = await import(`/js/store.js${v}`);
    const d = demoData();
    return { places: d.places.length, roads: d.places.filter(p => p.provenance).length };
  });
  expect(seed.places).toBeGreaterThan(20);
  expect(said, 'the door does not say how many places it opens').toContain(`${seed.places} real places`);
  expect(said).toContain('example people');
  expect(said).toContain('Opening it adds nothing');
  expect(said).toContain('Use as my atlas');
  // the page itself types no count: a number in the markup is a number that
  // stops being true the day the seed changes
  const markup = await page.locator('#thFullWhat').getAttribute('data-typed');
  expect(markup).toBeNull();

  // The explanation is available before the decision, but the first visit
  // carries only the decision until somebody asks for the detail.
  await expect(page.locator('#thFullWhat')).toBeHidden();
  await page.locator('.th-full summary').click();
  await expect(page.locator('#thFullWhat')).toBeVisible();

  // Starting empty is a request to write the first place. It lands in that
  // field directly instead of leaving two competing instructions on the map.
  await page.locator('#thEmpty').click();
  await expect(page.locator('#threshold')).toBeHidden();
  await expect(page.locator('#paletteOverlay')).toBeVisible();
  await expect(page.locator('#paletteInput')).toBeFocused();
});

// A byline says who handed an atlas over. It has never said who wrote every
// sentence inside it, and on a starter atlas most of the notes are words the
// sender did not write. The one surface where a person puts their name to
// something says so, with the true count.
test('the door counts the notes the sender did not write', async ({ page }) => {
  await open(page, { places: 0 });
  await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const { store, newPlace } = await import(`/js/store.js${v}`);
    store.load();
    store.addPlace(newPlace({ id: 's1', name: 'Came With It', lat: 46, lng: 8,
      note: 'prose nobody here wrote', sample: true }));
    store.addPlace(newPlace({ id: 's2', name: 'Also Came With It', lat: 46.1, lng: 8.1,
      note: 'more of the same', sample: true }));
    store.addPlace(newPlace({ id: 'm1', name: 'Mine', lat: 47, lng: 9, note: 'my own words' }));
  });
  await page.keyboard.press('/');
  await page.locator('#paletteInput').fill('>share');
  await expect(page.locator('.cmd-row').first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('#shareOverlay')).toBeVisible();

  const said = page.locator('#shareBody');
  await expect(said).toContainText('3 notes, in full');
  await expect(said, 'the review does not count unchanged starter text')
    .toContainText('2 notes are unchanged starter text');
  await expect(said).toContainText("Your sharing name identifies the sender, not each note's writer");

  // and with nothing untouched, the line is not there at all: a sentence about
  // a thing that is not happening is noise
  await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const { store } = await import(`/js/store.js${v}`);
    store.updatePlace('s1', { sample: false });
    store.updatePlace('s2', { sample: false });
  });
  await page.locator('#shareBody [data-close], #shareOverlay .poster-x').first().click();
  await page.keyboard.press('/');
  await page.locator('#paletteInput').fill('>share');
  await expect(page.locator('.cmd-row').first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('#shareBody')).toContainText('3 notes, in full');
  await expect(page.locator('#shareBody')).not.toContainText('came with the full atlas');
});

// ---------- the walkthrough's findings, pinned ----------

// A composition a person has touched is work. Leaving must be a conscious
// choice, but merely looking must remain one effortless Escape.
test('a dirty new collection offers save, discard and keep editing on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.__nativeConfirms = 0;
    window.confirm = () => { window.__nativeConfirms += 1; return false; };
  });
  await open(page, { places: 3 });
  await showIndex(page);
  await page.locator('[data-go="folio"]').click();
  await page.locator('#folNew').click();
  await page.locator('#folTitle').fill('Basel, half written');
  await page.locator('.fol-row[data-fid]').first().click();

  // Escape asks without changing or saving anything. Escape on that question
  // means the safe answer: keep editing.
  await page.keyboard.press('Escape');
  await expect(page.locator('#askBox')).toBeVisible();
  await expect(page.locator('#askBox')).toHaveAttribute('role', 'alertdialog');
  await expect(page.locator('#askWhat')).toHaveText('Save this collection as a draft before leaving?');
  await expect(page.locator('#askGo')).toHaveText('save draft');
  await expect(page.locator('#askAlso')).toHaveText('discard');
  await expect(page.locator('#askNo')).toHaveText('keep editing');
  await page.keyboard.press('Escape');
  await expect(page.locator('#askBox')).toBeHidden();
  await expect(page.locator('#folioOverlay')).toBeVisible();
  await expect(page.locator('#folTitle')).toHaveValue('Basel, half written');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('resonate.folios.v1') || '[]').length))
    .toBe(0);

  // The poster Close uses the same decision. Discard is explicit and leaves
  // no draft behind.
  await page.locator('#folioOverlay .poster-x').click();
  await expect(page.locator('#askBox')).toBeVisible();
  await page.locator('#askAlso').click();
  await expect(page.locator('#folioOverlay')).toBeHidden();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('resonate.folios.v1') || '[]').length))
    .toBe(0);

  // A second draft can intentionally be saved from the same Close decision.
  await showIndex(page);
  await page.locator('[data-go="folio"]').click();
  await page.locator('#folNew').click();
  await page.locator('#folTitle').fill('Basel, kept as a draft');
  await page.locator('.fol-row[data-fid]').nth(1).click();
  await page.locator('#folioOverlay .poster-x').click();
  await page.locator('#askGo').click();
  await expect(page.locator('#folioOverlay')).toBeHidden();
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('resonate.folios.v1'))[0]);
  expect(kept.title).toBe('Basel, kept as a draft');
  expect(kept.placeIds).toHaveLength(1);

  // Opening a fresh composer and touching nothing closes directly.
  await showIndex(page);
  await page.locator('[data-go="folio"]').click();
  await page.locator('#folNew').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#folioOverlay')).toBeHidden();
  await expect(page.locator('#askBox')).toBeHidden();
  expect(await page.evaluate(() => window.__nativeConfirms)).toBe(0);
});

test('a dirty saved collection offers save changes and keeps edits when asked', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.__nativeConfirms = 0;
    window.confirm = () => { window.__nativeConfirms += 1; return false; };
  });
  await open(page, { places: 3 });
  await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const { store, newFolio } = await import(`/js/store.js${v}`);
    store.load();
    store.addFolio(newFolio({ title: 'One quiet hour', placeIds: ['p0'] }));
  });
  await showIndex(page);
  await page.locator('[data-go="folio"]').click();
  await page.locator('.fol-shelf-row').first().click();
  await page.locator('#folTitle').fill('Two quiet hours');

  await page.locator('#folioOverlay .poster-x').click();
  await expect(page.locator('#askWhat')).toHaveText('Save changes to “One quiet hour” before leaving?');
  await expect(page.locator('#askGo')).toHaveText('save changes');
  await page.locator('#askNo').click();
  await expect(page.locator('#folioOverlay')).toBeVisible();
  await expect(page.locator('#folTitle')).toHaveValue('Two quiet hours');

  await page.locator('#folioOverlay .poster-x').click();
  await page.locator('#askGo').click();
  await expect(page.locator('#folioOverlay')).toBeHidden();
  const title = await page.evaluate(() => JSON.parse(localStorage.getItem('resonate.folios.v1'))[0].title);
  expect(title).toBe('Two quiet hours');

  // Reopening the saved state is clean, so Escape adds no extra step.
  await showIndex(page);
  await page.locator('[data-go="folio"]').click();
  await page.locator('.fol-shelf-row').first().click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#folioOverlay')).toBeHidden();
  await expect(page.locator('#askBox')).toBeHidden();
  expect(await page.evaluate(() => window.__nativeConfirms)).toBe(0);
});

// A voice names the places it shares with you, without being asked, and a
// place leads home. The count stayed on the label: it is a real number, and
// the places standing under it are the same places it counts.
test('a voice names its places without a press, city and all', async ({ page }) => {
  const now = new Date().toISOString();
  await open(page, {
    places: 0,
    atlas: [
      { id: 'w1', name: 'Wish Place', lat: 46, lng: 8, city: 'Basel', country: 'Switzerland',
        tags: [], status: 'wishlist', createdAt: now, updatedAt: now },
      { id: 'v1', name: 'Been Place', lat: 47, lng: 9, city: 'Basel', country: 'Switzerland',
        tags: [], status: 'visited', createdAt: now, updatedAt: now },
    ],
  });
  await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const { store } = await import(`/js/store.js${v}`);
    store.load();
    store.addCorrespondent({ name: 'Mira', tags: [], places: [
      { id: 'm1', name: 'Wish Place', lat: 46, lng: 8, city: 'Basel', status: 'visited', tags: [] },
      { id: 'm2', name: 'Been Place', lat: 47, lng: 9, city: 'Basel', status: 'visited', tags: [] },
    ] });
  });
  await showIndex(page);
  await page.locator('[data-go="contacts"]').click();

  const row = page.locator('.corr-row', { hasText: 'Mira' });
  // nothing is pressed before this line: the places are simply there
  await expect(row.locator('.cp-bucket', { hasText: 'you both went' }))
    .toContainText('1 you both went');
  await expect(row.locator('.cp-bucket', { hasText: 'you both went' })).toContainText('Been Place');
  await expect(row.locator('.cp-bucket', { hasText: 'Mira went, you want to go' }))
    .toContainText('Wish Place');
  // and the city stands after the name, because two people can both keep a
  // place of the same name and mean two different evenings
  await expect(row.locator('.cp-place', { hasText: 'Wish Place' })).toHaveText('Wish Place, Basel');

  await row.locator('.cp-place', { hasText: 'Wish Place' }).click();
  await expect(page.locator('#plate')).toBeVisible();
  await expect(page.locator('.plate-name')).toHaveText('Wish Place');
});


test('a poster keeps its close word on the narrowest screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await open(page);
  await page.keyboard.press('/');
  await page.locator('#paletteInput').fill('>census');
  await expect(page.locator('.cmd-row').first()).toBeVisible();
  await page.keyboard.press('Enter');
  const word = page.locator('#statsOverlay .poster-word');
  const close = page.locator('#statsOverlay .poster-x');
  await expect(word).toBeVisible();
  const [w, c, vw] = await Promise.all([
    word.boundingBox(), close.boundingBox(), page.evaluate(() => innerWidth),
  ]);
  expect(c.x + c.width).toBeLessThanOrEqual(vw);
  expect(w.x + w.width).toBeLessThanOrEqual(c.x);
});


// ---------- a folio, once kept, shows itself ----------
//
// The owner's report: "when i compose a folio and save it, only those places
// saved in that folio must appear in that list, not all the rest also." What
// happened was that keeping dropped a person back into the composer, whose
// pool is deliberately the whole house, so a folio of three was handed back as
// three ticks on a page of thirteen rows under the line "3 of 13 enclosed".
// The work was safe on the shelf and the surface read as loss.
test('a folio, once kept, lists itself and nothing else, and the house is one word away',
  async ({ page }) => {
    await openCities(page);
    await page.keyboard.press('/');
    await page.locator('#paletteInput').fill('>folio');
    await expect(page.locator('.cmd-row').first()).toBeVisible();
    await page.keyboard.press('Enter');
    await page.locator('#folNew').click();
    await expect(page.locator('#folTitle')).toBeVisible();

    // compose from the whole house, which is what composing is for
    expect(await page.locator('.fol-row[data-fid]').count()).toBe(13);
    for (const name of ['Basel spot 0', 'Basel spot 1']) {
      await page.locator('.fol-row', { hasText: name }).click();
    }
    await page.locator('#folTitle').fill('Two for the rain');
    await page.locator('#folKeep').click();
    await expect(page.locator('#toast')).toContainText('collection saved', { timeout: 10000 });

    // and what comes back is the folio: two rows, both in, counted as two
    await expect(page.locator('.fol-count')).toContainText('2 selected');
    await expect(page.locator('.fol-count')).not.toContainText('of 13');
    expect(await page.locator('.fol-row[data-fid]').count()).toBe(2);
    expect(await page.locator('.fol-row[aria-pressed="true"]').count()).toBe(2);

    // the word that empties a folio in one press is not on this page
    await expect(page.locator('#folNone')).toHaveCount(0);

    // and the atlas is still there, one press behind it
    await page.locator('#folWiden').click();
    expect(await page.locator('.fol-row[data-fid]').count()).toBe(13);
    await expect(page.locator('.fol-count')).toContainText('2 selected · 13 visible');
    await expect(page.locator('#folTitle')).toHaveValue('Two for the rain');
  });

// ---------- a name is a door ----------
//
// The owner's second report: "when i click on a name, it should lead me to the
// voices view and to that name specifically." A name was printed on six
// surfaces and pressable on none of them.
test('a name printed on a place leads to the voice it names', async ({ page }) => {
  const now = new Date().toISOString();
  await open(page, {
    places: 0,
    atlas: [
      { id: 'a1', name: 'Adopted Place', lat: 46, lng: 8, city: 'Basel', country: 'Switzerland',
        tags: [], status: 'visited', createdAt: now, updatedAt: now,
        provenance: { name: 'Mira', adoptedAt: now } },
    ],
  });
  await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const { store } = await import(`/js/store.js${v}`);
    store.load();
    store.addCorrespondent({ name: 'Mira', tags: [], places: [
      { id: 'm1', name: 'Somewhere Else', lat: 47, lng: 9, city: 'Basel', status: 'visited', tags: [] },
    ] });
  });
  await page.reload();
  await expect(page.locator('#intro')).toBeHidden({ timeout: 15000 });

  // from the plate
  await showIndex(page);
  await page.locator('.ix').first().click();
  await expect(page.locator('#plate')).toBeVisible();
  await page.locator('#plate .name-door').click();
  await expect(page.locator('#contactsOverlay')).toBeVisible();
  const row = page.locator('.corr-row', { hasText: 'Mira' });
  await expect(row).toHaveClass(/sought/);
});

// The place a name led to has to be the person, so the row says places and
// nothing that could be read as loudness. `audible` meant two unrelated things
// four lines apart: a band of the kinship lexicon, and a voice whose places
// are drawn on the field.
test('a voice says how many places it holds, and the field word is an act', async ({ page }) => {
  await open(page, { places: 0 });
  await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const { store } = await import(`/js/store.js${v}`);
    store.load();
    store.addCorrespondent({ name: 'Mira', tags: [], places: [
      { id: 'm1', name: 'One', lat: 47, lng: 9, city: 'Basel', status: 'visited', tags: [] },
    ] });
  });
  await showIndex(page);
  await page.locator('[data-go="contacts"]').click();
  const row = page.locator('.corr-row', { hasText: 'Mira' });
  await expect(row.locator('.corr-meta')).toContainText('1 shared place');
  await expect(row.locator('.corr-meta')).not.toContainText('1 shared places');
  for (const word of ['audible', 'muted', 'faint']) {
    await expect(row.locator('.corr-meta')).not.toContainText(word);
    await expect(row.locator('.corr-ctl')).not.toContainText(word);
  }
  // one act, not two ways to make a person disappear: the row offers removing
  // the voice, and nothing else
  await expect(row.locator('.corr-ctl button')).toHaveCount(1);
  await expect(row.locator('[data-vis]')).toHaveCount(0);
});

test('many contacts open as a calm overview and reveal one at a time', async ({ page }) => {
  const now = new Date().toISOString();
  const contact = (id, name, lat) => ({
    id, name, hue: 40, visible: true, addedAt: now, tags: [],
    places: [{ id: `${id}-p`, name: `${name} place`, lat, lng: 9,
      city: 'Basel', country: 'Switzerland', tags: [], status: 'visited' }],
  });
  await open(page, { places: 0, voices: [
    contact('mira', 'Mira', 47), contact('ada', 'Ada', 47.1), contact('leo', 'Leo', 47.2),
  ] });
  await showIndex(page);
  await page.locator('[data-go="contacts"]').click();

  await expect(page.locator('.corr-row')).toHaveCount(3);
  await expect(page.locator('.corr-row[open]')).toHaveCount(0);
  await page.locator('.corr-summary').first().click();
  await expect(page.locator('.corr-row[open]')).toHaveCount(1);
  await expect(page.locator('.corr-row[open] .corr-detail')).toBeVisible();
  await page.locator('.corr-summary').nth(1).click();
  await expect(page.locator('.corr-row[open]')).toHaveCount(1);
  await expect(page.locator('.corr-row').first()).not.toHaveAttribute('open', '');
});

// Removing a voice deleted every place of theirs with no way back, under a
// word that named something mutual. Place removal has had an undo for
// releases; this is the same one.
test('removing a contact says what goes, and can be taken back', async ({ page }) => {
  await open(page, { places: 0 });
  await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const { store } = await import(`/js/store.js${v}`);
    store.load();
    store.addCorrespondent({ name: 'Mira', tags: [], places: [
      { id: 'm1', name: 'One', lat: 47, lng: 9, city: 'Basel', status: 'visited', tags: [] },
      { id: 'm2', name: 'Two', lat: 47.1, lng: 9.1, city: 'Basel', status: 'visited', tags: [] },
    ] });
  });
  await showIndex(page);
  await page.locator('[data-go="contacts"]').click();
  const row = page.locator('.corr-row', { hasText: 'Mira' });
  await expect(row.locator('[data-part]')).toHaveText('remove person');
  await row.locator('[data-part]').click();

  // the sentence counts what leaves and names what stays
  await expect(page.locator('#askBox')).toBeVisible();
  await expect(page.locator('.ask-what')).toContainText('2 shared places will leave your map');
  await expect(page.locator('.ask-what')).toContainText('Places you saved stay in your atlas');
  await page.locator('#askGo').click();

  await expect(page.locator('.corr-row', { hasText: 'Mira' })).toHaveCount(0);
  await expect(page.locator('#toast')).toContainText('no longer in People');
  const undo = page.locator('#toast .toast-act');
  await undo.hover();
  await page.waitForTimeout(9200);
  await expect(undo, 'the undo vanished while the pointer was on it').toBeVisible();
  await undo.click();
  await expect(page.locator('.corr-row', { hasText: 'Mira' })).toHaveCount(1);
  // and back with the id it wore, which is what its mark on the field is drawn from
  const ids = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('resonate.correspondents.v1')).map(c => c.places.length));
  expect(ids).toEqual([2]);
});

test('a new atlas can replace the places of a contact with the same name', async ({ page }) => {
  const now = new Date().toISOString();
  const oldPlace = {
    id: 'old-mira', name: 'The old place', lat: 47, lng: 9,
    city: 'Basel', country: 'Switzerland', tags: [], status: 'visited',
    createdAt: now, updatedAt: now,
  };
  await open(page, {
    places: 0,
    voices: [{ id: 'mira', name: 'Mira', hue: 40, visible: true, addedAt: now, tags: [], places: [oldPlace] }],
  });
  const url = await page.evaluate(async (at) => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const { makeShareUrl } = await import(`/js/share.js${v}`);
    return makeShareUrl([], [{
      id: 'new-mira', name: 'The new place', lat: 48, lng: 10,
      city: 'Zürich', country: 'Switzerland', tags: [], status: 'wishlist',
      createdAt: at, updatedAt: at,
    }], 'Mira', []);
  }, now);

  await arrive(page, url);
  await expect(page.locator('#reportOverlay')).toBeVisible({ timeout: 20000 });
  await page.locator('#rpKeep').click();
  await expect(page.locator('#askInput')).toBeVisible();
  await page.locator('#askGo').click();
  await expect(page.locator('#askWhat')).toContainText('already in People');
  await expect(page.locator('#askBox')).toHaveAttribute('role', 'alertdialog');
  await expect(page.locator('#askNo')).toBeFocused();
  await page.locator('#askGo').click();

  const held = await page.evaluate(() => JSON.parse(localStorage.getItem('resonate.correspondents.v1')));
  expect(held).toHaveLength(1);
  expect(held[0].places.map(p => p.name)).toEqual(['The new place']);
  await expect(page.locator('#toast')).toContainText('now has 1 shared place');
});

// ---------- thanks, findable ----------
//
// The owner asked how to thank someone. The word existed, third from last in a
// row of six at the foot of a scrolling plate. It stands on the line that
// names the sender now, where the question is actually asked.
test('the line that names who a place came from is the way to thank them', async ({ page }) => {
  const now = new Date().toISOString();
  await open(page, {
    places: 0,
    atlas: [
      { id: 'a1', name: 'Adopted Place', lat: 46, lng: 8, city: 'Basel', country: 'Switzerland',
        tags: [], status: 'visited', createdAt: now, updatedAt: now,
        provenance: { name: 'Mira', srcId: 'x1', adoptedAt: now } },
    ],
  });
  await showIndex(page);
  await page.locator('.ix').first().click();
  await expect(page.locator('#plate')).toBeVisible();
  await expect(page.locator('.plate-prov')).toContainText('after Mira');
  await expect(page.locator('#pThank')).toHaveText('send thanks');
  // and it is on the provenance line, not down in the act row
  expect(await page.locator('.plate-acts #pThank').count()).toBe(0);
});

// ---------- the sheet counts its own pages ----------
//
// "the folio when generated as pdf must have page numbers." No browser
// implements the CSS that would do it, so the app packs the pages itself and
// numbers what it made: a number that is true by construction.
test('a printed sheet carries a page number that is true', async ({ page }) => {
  await openCities(page);
  await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const { store } = await import(`/js/store.js${v}`);
    store.load();
    // long notes, so the sheet is certainly longer than one page
    const long = 'A note about this place, written at length. '.repeat(24);
    for (const p of store.places) store.updatePlace(p.id, { note: long });
    // the system dialog is the one thing a test cannot stand in front of
    window.__printed = 0;
    window.print = () => { window.__printed += 1; };
  });
  await page.keyboard.press('/');
  await page.locator('#paletteInput').fill('>print');
  await expect(page.locator('.cmd-row').first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('#askBox')).toBeVisible();
  await page.locator('#askGo').click();
  await expect.poll(() => page.evaluate(() => window.__printed)).toBe(1);

  const read = await page.evaluate(() => ({
    pages: document.querySelectorAll('#sheet .sh-page').length,
    said: [...document.querySelectorAll('#sheet .sh-page > .sh-foot .sh-of')].map(f => f.textContent),
    entries: document.querySelectorAll('#sheet .sh-entry').length,
    loose: document.querySelectorAll('#sheet > .sh-entry').length,
  }));
  expect(read.pages).toBeGreaterThan(1);
  // every block is on a page, and every page says which one it is
  expect(read.loose).toBe(0);
  expect(read.entries).toBe(13);
  expect(read.said.length).toBe(read.pages);
  expect(read.said[0]).toBe(`1 of ${read.pages}`);
  expect(read.said[read.pages - 1]).toBe(`${read.pages} of ${read.pages}`);
});


// ---------- recognition, while you are still typing ----------
//
// Finding a place was two deliberate acts: type the whole name, then press a
// row that says ask openstreetmap, then wait. Photon answers a prefix, so the
// rows arrive as the word does. Nominatim's own policy forbids autocomplete,
// which is why this comes through a second door and why the deliberate row
// stays underneath it.
async function withPhoton(page, { rows = null, fail = false } = {}) {
  if (fail) return;
  await page.evaluate((body) => { window.__canned['photon.komoot.io'] = body; }, JSON.stringify({
    features: rows || [
      { geometry: { coordinates: [-9.13563, 38.72136] },
        properties: { name: 'Cervejaria Ramiro', city: 'Lisboa', country: 'Portugal',
          countrycode: 'PT', street: 'Avenida Almirante Reis', osm_value: 'restaurant' } },
      { geometry: { coordinates: [-9.1, 38.7] },
        properties: { name: 'Cervejaria Trindade', city: 'Lisboa', country: 'Portugal', countrycode: 'PT' } },
    ],
  }));
}

const askedOf = (page, host) => page.evaluate((h) =>
  window.__asked.filter(u => new URL(u).host === h), host);

test('a place is offered while the word is still being typed', async ({ page }) => {
  const now = new Date().toISOString();
  // an atlas with a place in it, so the field is looking at somewhere and the
  // question can be biased by where that is
  await open(page, {
    places: 0,
    atlas: [{ id: 'k1', name: 'Somewhere in Lisboa', lat: 38.7, lng: -9.14, city: 'Lisboa',
      country: 'Portugal', tags: [], status: 'visited', note: '', createdAt: now, updatedAt: now }],
  });
  await withPhoton(page);
  await page.keyboard.press('/');
  await page.locator('#paletteInput').pressSequentially('Cerveja', { delay: 40 });

  // the suggestion arrives on its own, with no second press
  const row = page.locator('.cmd-row', { hasText: 'Cervejaria Ramiro' });
  await expect(row).toBeVisible({ timeout: 10000 });
  await expect(row).toContainText('Avenida Almirante Reis, Lisboa, Portugal');
  await expect(page.locator('.cmd-section')).toHaveText(['new places']);

  // the deliberate search is still there underneath, because a prefix and an
  // address are not the same question
  await expect(page.locator('.cmd-row', { hasText: 'ask openstreetmap' })).toBeVisible();

  // it asked for the word that was typed, biased by where the field is looking,
  // and it carried nothing else: not the byline, not the atlas, not a place
  const asked = (await askedOf(page, 'photon.komoot.io')).map(u => new URL(u));
  expect(asked.length).toBeGreaterThan(0);
  const last = asked[asked.length - 1];
  expect(last.searchParams.get('q')).toBe('Cerveja');
  expect(last.searchParams.get('lat')).not.toBeNull();
  expect([...last.searchParams.keys()].sort()).toEqual(['lang', 'lat', 'limit', 'lon', 'q']);
  // and it waited for a pause rather than firing per keystroke
  expect(asked.length).toBeLessThan(4);

  // and pressing it proposes the place rather than writing one
  await row.click();
  await expect(page.locator('#plate')).toHaveAttribute('aria-label', 'Place suggestion');
  await expect(page.locator('.plate-eyebrow')).toContainText('not yet yours');
  await expect(page.locator('.plate-name')).toHaveText('Cervejaria Ramiro');
  await expect(page.locator('#ppKeep')).toHaveText('Add to my atlas');
  // proposed, not kept: nothing is written until the word on that plate is pressed
  expect(await page.evaluate(() =>
    JSON.parse(localStorage.getItem('resonate.places.v1') || '[]').map(p => p.name)))
    .toEqual(['Somewhere in Lisboa']);
  await page.locator('#ppKeep').click();
  await expect(page.locator('#toast')).toHaveText('Added as Want to go.');
  expect(await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('resonate.places.v1') || '[]')
      .find(place => place.name === 'Cervejaria Ramiro');
    return saved?.status;
  })).toBe('wishlist');
});

test('a typeahead that fails says nothing, and the rows you own stay', async ({ page }) => {
  const now = new Date().toISOString();
  await open(page, {
    places: 0,
    atlas: [{ id: 'k1', name: 'Cervejaria of my own', lat: 38.7, lng: -9.1, city: 'Lisboa',
      country: 'Portugal', tags: [], status: 'visited', note: '', createdAt: now, updatedAt: now }],
  });
  await withPhoton(page, { fail: true });
  await page.keyboard.press('/');
  await page.locator('#paletteInput').pressSequentially('Cerveja', { delay: 40 });
  await expect(page.locator('.cmd-row', { hasText: 'Cervejaria of my own' })).toBeVisible();
  await expect(page.locator('.cmd-hint')).toHaveCount(0);
  await expect(page.locator('.cmd-row', { hasText: 'ask openstreetmap' })).toBeVisible();
  await expect(page.locator('.cmd-section')).toHaveText(['your atlas', 'new places']);
});

// A place you keep under your own name for it is still that place. The world
// knows Cervejaria Ramiro; you filed it as "the prawn place"; three letters of
// the real name should find what you have rather than offer to keep it twice.
test('a suggestion you already keep comes back as your own record', async ({ page }) => {
  const now = new Date().toISOString();
  await open(page, {
    places: 0,
    atlas: [{ id: 'k1', name: 'the prawn place', lat: 38.72136, lng: -9.13563, city: 'Lisboa',
      country: 'Portugal', tags: [], status: 'visited', note: '', createdAt: now, updatedAt: now }],
  });
  await withPhoton(page);
  await page.keyboard.press('/');
  await page.locator('#paletteInput').pressSequentially('Cerveja', { delay: 40 });
  // the one the world knows and you do not is offered
  await expect(page.locator('.cmd-row', { hasText: 'Cervejaria Trindade' })).toBeVisible({ timeout: 10000 });
  // and the one at the point you already hold comes up as yours, once, under
  // the name you gave it, never as something to add again
  await expect(page.locator('.cmd-row', { hasText: 'the prawn place' })).toHaveCount(1);
  await expect(page.locator('.cmd-row', { hasText: 'Cervejaria Ramiro' })).toHaveCount(0);
  await page.locator('.cmd-row', { hasText: 'the prawn place' }).click();
  await expect(page.locator('.plate-name')).toHaveText('the prawn place');
});

// The board's own close word has never been measured, while the poster's has.
// It sits in a notch beside the tools line, and any future lengthening of it
// would run over the words there without a single test failing.
test('the board keeps its close word clear of the tools on the narrowest screen',
  async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await open(page);
    await showIndex(page);
    const close = page.locator('#indexClose');
    await expect(close).toBeVisible();
    const [c, sort, vw] = await Promise.all([
      close.boundingBox(),
      page.locator('#sortWord').boundingBox(),
      page.evaluate(() => innerWidth),
    ]);
    expect(c.x + c.width).toBeLessThanOrEqual(vw);
    expect(c.x).toBeGreaterThanOrEqual(0);
    // the notch is above the tools line, not across it
    expect(c.y + c.height).toBeLessThanOrEqual(sort.y + 1);
  });

// Both ways onward out of `yours` opened underneath it.
//
// Every poster carries the same z-index, so between two open posters the
// painting order is the DOM order, and the DOM order is the order they happen
// to be written in index.html: statsOverlay, then clubOverlay, then
// settingsOverlay. `the whole story` and `the travellers club` were the only
// two exits `yours` had, and both of their rooms are written above it in that
// file.
// So both of them opened rendered, focused, holding the keyboard, and behind a
// sheet at 92 percent opacity with a 20px blur, and pressing either one changed
// nothing on the screen at all.
//
// The travellers club is the only discoverable door to the paid tier. Nothing
// in the suite could see this: every test that opens a poster opens it from the
// field, where there is no second poster to lose it behind, and each of these
// rooms is correct on its own. The defect is only in the pair.
//
// The oracle is elementFromPoint rather than a visibility assertion, because
// the club overlay passed every visibility assertion there is while it was
// invisible: not hidden, non-zero box, opacity 1, inside the viewport. What was
// false was the only thing that matters, which is whether a person looking at
// that pixel is looking at it.
test.describe('a room opened over another room', () => {
  for (const [word, room, heading] of [
    ['#clubWord', '#clubOverlay', 'club'],
    ['#censusWord', '#statsOverlay', 'at a glance'],
    // The third exit, added on 2026-08-19 when `how` came off the front board
    // and into the foot of this room.
    //
    // Said plainly, because it was checked: this row is belt over braces. It
    // stays green when the lift at js/app.js is deleted, which is the defect
    // that turns the other two red, because howOverlay is written *below*
    // settingsOverlay in index.html and so paints in front on DOM order alone.
    // It was only made to fail by removing the lift and moving the section
    // above settingsOverlay together. It is kept as the record that this room's
    // position in that file is load-bearing, and not as a second proof of the
    // lift, which the two rows above it already give.
    ['#howWord', '#howOverlay', 'how'],
  ]) {
    test(`${word} opens in front of the poster it was pressed on`, async ({ page }) => {
      await open(page);
      await openYours(page);
      await page.locator(word).click();
      await expect(page.locator(room)).toBeVisible();

      // what a person's eye, and their next press, actually land on
      const seen = await page.evaluate(() => {
        const el = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
        return el?.closest('section')?.id ?? null;
      });
      expect(seen, 'the room opened behind the poster it was opened from').toBe(room.slice(1));

      // and the word at the top of it is the room's own word
      await expect(page.locator(`${room} .poster-word`)).toHaveText(heading);

      // the report is not on this stack and has to stay over it: the poster
      // band now climbs one step per surface, and 60 was inside that climb.
      const [top, report] = await page.evaluate((id) => [
        Number(getComputedStyle(document.querySelector(id)).zIndex),
        Number(getComputedStyle(document.querySelector('#reportOverlay')).zIndex),
      ], room);
      expect(report).toBeGreaterThan(top);
    });
  }
});

test('only the front room is exposed as modal, and the room beneath returns', async ({ page }) => {
  await open(page);
  await openYours(page);

  const layers = () => page.evaluate(() => ['indexOverlay', 'settingsOverlay', 'clubOverlay'].map(id => {
    const el = document.getElementById(id);
    return {
      id, hidden: el.hidden, inert: el.inert,
      ariaHidden: el.getAttribute('aria-hidden'),
      ariaModal: el.getAttribute('aria-modal'),
    };
  }));

  expect(await layers()).toEqual([
    { id: 'indexOverlay', hidden: false, inert: true, ariaHidden: 'true', ariaModal: null },
    { id: 'settingsOverlay', hidden: false, inert: false, ariaHidden: null, ariaModal: 'true' },
    { id: 'clubOverlay', hidden: true, inert: false, ariaHidden: null, ariaModal: null },
  ]);

  await page.locator('#clubWord').click();
  await expect(page.locator('#clubOverlay')).toBeVisible();
  expect(await layers()).toEqual([
    { id: 'indexOverlay', hidden: false, inert: true, ariaHidden: 'true', ariaModal: null },
    { id: 'settingsOverlay', hidden: false, inert: true, ariaHidden: 'true', ariaModal: null },
    { id: 'clubOverlay', hidden: false, inert: false, ariaHidden: null, ariaModal: 'true' },
  ]);

  await page.locator('#clubOverlay .poster-x').click();
  await expect(page.locator('#clubOverlay')).toBeHidden();
  await expect(page.locator('#settingsOverlay')).toHaveAttribute('aria-modal', 'true');
  await expect(page.locator('#settingsOverlay')).not.toHaveAttribute('inert', '');
  await expect(page.locator('#settingsOverlay')).not.toHaveAttribute('aria-hidden', 'true');
});

// A link pasted rather than tapped.
//
// Half the apps a link arrives in will not make it tappable, and voices has
// always offered a field to paste one into. That field is the app's one text
// dialog, which carries maxlength="200" in the markup because it is also where
// a tag is renamed, and a browser truncates a paste at that attribute without
// a word. So an atlas link of four thousand characters became its first two
// hundred, and the person was told it was not a link. The door existed and
// could not be walked through.
test('an atlas link pasted into voices arrives, however long it is', async ({ page }) => {
  const now = new Date().toISOString();
  await open(page, { places: 0 });
  // a link long enough that the old bound is the thing being tested, made by
  // this app's own builder so it is exactly what a person would be handed
  const url = await page.evaluate(async (at) => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const { makeShareUrl } = await import(`/js/share.js${v}`);
    const places = Array.from({ length: 24 }, (_, i) => ({
      id: `far${i}`, name: `A Place With A Long Enough Name ${i}`, lat: 45 + i * 0.03, lng: 7 + i * 0.03,
      city: 'Genoa', country: 'Italy', tags: [], status: 'visited', rating: 4,
      note: 'a note carried along so the link is the length a real one is',
      createdAt: at, updatedAt: at,
    }));
    return makeShareUrl([], places, 'Mira', []);
  }, now);
  expect(url.length, 'the fixture link is short enough to fit the old bound').toBeGreaterThan(1000);

  await page.keyboard.press('/');
  await page.locator('#paletteInput').fill('>voices');
  await expect(page.locator('.cmd-row').first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('#contactsOverlay')).toBeVisible();
  await page.locator('#ceImport').click();
  const input = page.locator('#askInput');
  await expect(input).toBeVisible();
  await input.fill(url);
  expect(await input.inputValue(), 'the field cut the link short').toBe(url);
  await page.locator('#askGo').click();

  // the report is what a tapped link opens, and it is what a pasted one opens
  await expect(page.locator('#reportOverlay')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('#reportOverlay')).toContainText('Mira');
});

// The line under a place's name said the town twice.
//
// `[address, city, country].slice(0, 2)` reads well until you notice that a
// geocoder's address line usually ends in the town it is in, so the busiest
// line in the app rendered `Baselstrasse 101, 4125 Riehen · Riehen` and spent
// its second slot repeating the first. The country, which is the fact the
// reader did not already have, never got in.
//
// Bound in both directions, because dropping the town whenever a country
// exists would pass the first half of this and be a different bug.
test('the line under a place names the town once', async ({ page }) => {
  const now = new Date().toISOString();
  await open(page, {
    places: 0,
    atlas: [
      { id: 'said', name: 'Said Twice', lat: 47.58, lng: 7.65,
        address: 'Baselstrasse 101, 4125 Riehen', city: 'Riehen', country: 'Switzerland',
        tags: [], status: 'visited', note: '', createdAt: now, updatedAt: now },
      { id: 'unsaid', name: 'Said Once', lat: 44.13, lng: 9.68,
        address: 'Cinque Terre, Liguria', city: 'Vernazza', country: 'Italy',
        tags: [], status: 'visited', note: '', createdAt: now, updatedAt: now },
    ],
  });

  await showIndex(page);
  await page.locator('.ix', { hasText: 'Said Twice' }).click();
  await expect(page.locator('#plate .plate-sub'),
    'the address already ended in the town, and the town came again')
    .toHaveText('Baselstrasse 101, 4125 Riehen · Switzerland');

  await page.keyboard.press('Escape');
  await showIndex(page);
  await page.locator('.ix', { hasText: 'Said Once' }).click();
  await expect(page.locator('#plate .plate-sub'),
    'the address never named the town, and the town was dropped anyway')
    .toHaveText('Cinque Terre, Liguria · Vernazza');
});

// ---------- where you stand ----------
//
// The atlas has always been able to ask the device where it is. What it did
// with the answer was draw a six-pixel hollow ring in ink, on a field where a
// place is a hollow ring in its tag's colour, and standing in Basel put that
// ring a finger's width from Markthalle Basel with nothing on the screen
// saying which was which.
//
// These four are about the answer being used honestly rather than merely
// received.

// Basel, and the accuracy a phone actually reports between buildings. The old
// dot threw the second number away and drew the same six pixels for a fix good
// to a metre and a fix good to three kilometres.
const STANDING = { latitude: 47.5596, longitude: 7.5886, accuracy: 140 };

async function standAt(page, where = STANDING) {
  await page.context().grantPermissions(['geolocation']);
  await page.context().setGeolocation(where);
}

// two places at known removes from that corner of Basel, and one far enough
// away that no rounding can reorder it
const AROUND = (() => {
  const now = new Date().toISOString();
  const at = (id, name, lat, lng) => ({
    id, name, lat, lng, city: 'Basel', country: 'Switzerland',
    tags: [], status: 'visited', note: '', createdAt: now, updatedAt: now,
  });
  return [
    at('near', 'The Near One', 47.5560, 7.5900),
    at('middle', 'The Middle One', 47.5480, 7.5850),
    at('far', 'The Far One', 47.3769, 8.5417),
  ];
})();

// A place is an outline somebody drew: a point, and the same size at every
// zoom. You are neither. The disc is the device's own accuracy in metres, put
// on the map at ground scale, which is why this test zooms: a circle drawn in
// metres doubles across a zoom level and a mark drawn in pixels does not.
//
// Both directions. The first half would pass on any large circle; the second
// half is what fails if somebody quietly swaps it for a fixed-pixel halo,
// which is the exact shortcut this replaced.
test('where you stand is drawn in metres, and a place is not', async ({ page }) => {
  await standAt(page);
  await open(page, { places: 0, atlas: AROUND });

  await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const m = await import(`/js/map.js${v}`);
    m.getMap().setView([47.5596, 7.5886], 15);
  });
  await showIndex(page);
  // round to nearest, which is the press that asks
  for (let i = 0; i < 4; i++) {
    if ((await page.locator('#sortWord').textContent()).startsWith('nearest')) break;
    await page.locator('#sortWord').click();
  }
  await expect(page.locator('#sortWord')).toHaveText('nearest you', { timeout: 15000 });

  const sizes = async () => page.evaluate(() => {
    const w = (s) => {
      const el = document.querySelector(s);
      return el ? el.getBoundingClientRect().width : 0;
    };
    return { disc: w('.here-disc'), dot: w('.here-dot'), mark: w('.mark') };
  });

  const at15 = await sizes();
  expect(at15.disc, 'the accuracy the device gave was never drawn').toBeGreaterThan(20);
  expect(at15.dot, 'you were not drawn at all').toBeGreaterThan(0);

  // Not setZoom-and-wait. A fixed wait after an animated zoom measures whatever
  // the engine happens to have painted by then, and on a loaded CI runner that
  // was the old size: the ratio came back as exactly 1, which reads as `the
  // disc is decoration` when what actually happened is that nothing had been
  // redrawn yet. The zoom is taken without animation and awaited on its own
  // event, and the measurement is then polled rather than sampled once, so the
  // assertion is about the disc and not about the machine.
  await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const m = await import(`/js/map.js${v}`);
    const map = m.getMap();
    await new Promise((done) => {
      map.once('zoomend', () => requestAnimationFrame(() => requestAnimationFrame(done)));
      map.setZoom(16, { animate: false });
    });
  });

  // one zoom level is one doubling of ground scale. a little slack for how
  // three engines round a sub-pixel path, and none at all for the claim.
  await expect.poll(async () => (await sizes()).disc / at15.disc, {
    message: 'the disc did not grow with the ground, so it is not the accuracy: it is decoration',
    timeout: 10000,
  }).toBeGreaterThan(1.8);
  const at16 = await sizes();
  expect(at16.dot,
    'the dot grew with the ground, so it is a circle on the earth rather than a mark on the screen')
    .toBeCloseTo(at15.dot, 0);
});

// The defect this was written for: the list was sorted from one point and
// numbered from another. `filteredPlaces` measured from `state.here || centre`
// and the row itself measured from the centre alone, so a held fix put the
// atlas in one order and labelled it with a different one. Panning the field
// with the board open re-renders the rows, which is when the two come apart on
// the screen: a row reading 0.4 km sitting under a row reading 2.1 km, and
// neither figure wrong on its own.
//
// So this reads the numbers off the screen and asks only that they ascend.
// Nothing about the arithmetic is assumed, which is why it cannot pass by
// having the same bug on both sides.
test('the order of the nearest and the numbers on it are measured from one place',
  async ({ page }) => {
    await standAt(page);
    await open(page, { places: 0, atlas: AROUND });
    await showIndex(page);
    for (let i = 0; i < 4; i++) {
      if ((await page.locator('#sortWord').textContent()).startsWith('nearest')) break;
      await page.locator('#sortWord').click();
    }
    await expect(page.locator('#sortWord')).toHaveText('nearest you', { timeout: 15000 });

    const km = async () => page.evaluate(() => [...document.querySelectorAll('.ix-row')].map((r) => {
      const said = r.querySelector('.ix-datum')?.textContent?.trim() || '';
      const n = parseFloat(said);
      return said.endsWith('m') && !said.endsWith('km') ? n / 1000 : n;
    }));

    const first = await km();
    expect(first.length, 'no rows to read').toBe(3);
    expect(first, 'the list did not ascend before the field was even touched')
      .toEqual([...first].sort((a, b) => a - b));

    // the field drifts to another country, which is what a person panning does
    await page.evaluate(async () => {
      const v = new URL(document.querySelector('script[type=module]').src).search;
      const m = await import(`/js/map.js${v}`);
      m.getMap().setView([41.9, 12.5], 5);
    });
    await page.waitForTimeout(900); // the view change is debounced before it re-renders

    const after = await km();
    expect(after, 'the rows kept their order from you and took their numbers from the map')
      .toEqual([...after].sort((a, b) => a - b));
    expect(after, 'the numbers moved with the field, so they were never measured from you')
      .toEqual(first);
  });

// A phone is the device this is for, and on a phone there was one road to ask.
// `findMe` answered to `near` typed into the command palette, and the corner
// that flies you to yourself was `display: none` under 761px, so the only road
// anybody could find was a control whose own label already said what it
// measured from. The corner is a door at this width now, which makes the word
// the second road rather than the only one; it stays the one a person arrives
// at by reading rather than by being told.
//
// What keeps the two apart is what keeps this honest. The word arranges the
// list from where you are and leaves the field exactly where it was; the
// corner is the one that flies. Asking where you are is not the same act as
// going there, and a word that moved the map under an open board would be
// answering a question nobody asked. `askWhereYouAre` is called with
// `fly: false` from the sort word for precisely that reason, and this is the
// assertion that notices if it stops being.
test('a phone can ask where it is, from the word that already promised it',
  async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await standAt(page);
    await open(page, { places: 0, atlas: AROUND });

    const centre = () => page.evaluate(async () => {
      const v = new URL(document.querySelector('script[type=module]').src).search;
      const { getCenter } = await import(`/js/map.js${v}`);
      return getCenter();
    });

    await expect(page.locator('#coordsReadout'),
      'the corner that flies you to yourself is hidden on the one device carried to places')
      .toBeVisible();

    await showIndex(page);
    const before = await centre();
    for (let i = 0; i < 4; i++) {
      if ((await page.locator('#sortWord').textContent()).startsWith('nearest')) break;
      await page.locator('#sortWord').click();
    }
    await expect(page.locator('#sortWord'),
      'the word landed on nearest and measured from the middle of the field without asking')
      .toHaveText('nearest you', { timeout: 15000 });
    await expect(page.locator('.here-dot'), 'nothing was drawn where the device said you were')
      .toHaveCount(1);

    const after = await centre();
    expect(after.lat, 'the word flew the field, which is the corner\'s job and not the word\'s')
      .toBeCloseTo(before.lat, 4);
    expect(after.lng).toBeCloseTo(before.lng, 4);
  });

// A fix is a claim about now. Held long enough it becomes a claim about a town
// you have left, and a number is believed in a way a blank is not.
//
// The clock is moved rather than the person, and the watch is stopped first,
// because that is the real road: the screen goes away, the watch stops with
// it, and time starts counting against a fix nobody is being told about any
// more. A watch still running is not evidence of age at all, since
// `watchPosition` reports movement and silence from it means you have not
// moved. Everything that spoke from the fix then has to stop speaking: the
// word falls back, and the plate stops naming a distance from a place you are
// no longer standing in.
test('a fix that has gone stale stops being quoted', async ({ page }) => {
  // The plate is proved open before it is read, and it is read through
  // `:not([hidden])`.
  //
  // `closeSurface` hides a surface and never empties it, so a closed plate
  // goes on holding the last one's markup, and `#plate .plate-far` counts
  // that markup as readily as a live plate's. Every round below presses a row
  // and then counts, so a press that did nothing at all was answered by the
  // round before it. Two rounds expect the same number and agreed with their
  // own leftovers; the third expects the other number and read the leftover as
  // the staleness rule being broken. That is what went red on one engine on a
  // loaded runner, and the rule it accused was working perfectly: the board in
  // the failure snapshot was measured from the middle of the field, which is
  // what the app falls back to precisely when it has dropped the fix.
  const openThePlate = async () => {
    await page.locator('.ix', { hasText: 'The Near One' }).click();
    await expect(page.locator('#plate'), 'the row was pressed and no plate came up')
      .toBeVisible({ timeout: 5000 });
  };
  const farOnThePlate = () => page.locator('#plate:not([hidden]) .plate-far');

  await standAt(page);
  await open(page, { places: 0, atlas: AROUND });
  await showIndex(page);
  for (let i = 0; i < 4; i++) {
    if ((await page.locator('#sortWord').textContent()).startsWith('nearest')) break;
    await page.locator('#sortWord').click();
  }
  await expect(page.locator('#sortWord')).toHaveText('nearest you', { timeout: 15000 });

  await openThePlate();
  await expect(farOnThePlate(), 'the plate never said how far you were')
    .toHaveCount(1);
  await page.keyboard.press('Escape');

  // First, six minutes of standing perfectly still with the watch running.
  // Nothing has been reported because nothing has happened, and that is the
  // device agreeing with the dot rather than the dot going out of date. A
  // clock read here instead would take the atlas away from whoever is standing
  // in front of the place they were reading about.
  // The plate is what both halves are read off, and it is read off the plate
  // because the plate is built again on every press. The arrangement word is
  // not: it is painted when something happens to it, so opening the board and
  // finding it still saying `nearest you` proves only that nobody repainted
  // it. That assertion passed with the rule it was written to test deleted,
  // which is the whole reason this file plants defects before it trusts a
  // green line.
  // The skew is a variable rather than a constant because the watch is still
  // running here, and a running watch writes Date.now() into state.here.at
  // every time the device reports. On a slow runner a report landed between
  // this stub and the stop below, which stamped the fix six minutes into the
  // future and made it fresh again for another five: the plate went on quoting
  // a distance and the test read that as the staleness rule being broken. The
  // clock is wound on a second time after the watch is stopped, where nothing
  // can refresh the fix behind it, so the second half is about the rule.
  await page.evaluate(() => {
    const real = Date.now;
    window.__skew = 6 * 60 * 1000;
    Date.now = () => real() + window.__skew;
  });
  await showIndex(page);
  await openThePlate();
  await expect(farOnThePlate(),
    'standing still for six minutes was read as not knowing where you are')
    .toHaveCount(1);
  await page.keyboard.press('Escape');

  // and now the screen goes away, which is what actually stops the watch. From
  // here the clock is the only thing left to go on.
  await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const m = await import(`/js/map.js${v}`);
    m.stopWatchingHere();
  });
  // and only now, with nothing left that can stamp the fix, does the clock move
  await page.evaluate(() => { window.__skew += 6 * 60 * 1000; });

  await showIndex(page);
  await openThePlate();
  await expect(farOnThePlate(),
    'the plate still names a distance from where you stopped standing')
    .toHaveCount(0);

  // and the word falls back with it, once anything asks it to speak again
  await page.keyboard.press('Escape');
  await showIndex(page);
  await page.locator('#sortWord').click(); // to city, which repaints the word
  await expect(page.locator('#sortWord'),
    'the word still promises you, from a fix taken in another town')
    .not.toHaveText('nearest you');
});

// Two defects that arrived with the watch and were caught reading the diff
// rather than reading the screen. Both are about a fix that keeps talking.

// The field is taken to you once, on the press that asked.
//
// Leaflet's `setView` is honoured on every update a watch delivers, so the
// first version of this flew the field to you, let you pan two streets over to
// look at something, and then snatched the field back on the next tick of a
// GPS nobody had asked to keep talking. Again a few seconds later. There is no
// gesture that means stop, so the only way out is to close the app.
test('the field is flown to you once, and then it is yours', async ({ page }) => {
  await standAt(page);
  await open(page, { places: 0, atlas: AROUND });

  await page.locator('#coordsReadout').click();
  await expect(page.locator('.here-dot')).toHaveCount(1, { timeout: 15000 });
  await page.waitForTimeout(600);

  // panned somewhere deliberately, the way a person reads the ground around a
  // place rather than the ground under their feet
  await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const m = await import(`/js/map.js${v}`);
    m.getMap().setView([47.3769, 8.5417], 12);
  });
  await page.waitForTimeout(500);

  // the device speaks again, unbidden, as a watch does
  await page.context().setGeolocation({ latitude: 47.5601, longitude: 7.5891, accuracy: 90 });
  await page.waitForTimeout(1500);

  const at = await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const m = await import(`/js/map.js${v}`);
    return m.getCenter();
  });
  expect(at.lat, 'the field flew back to you and took the view off whoever was reading it')
    .toBeCloseTo(47.3769, 1);
  expect(at.lng, 'the field flew back to you and took the view off whoever was reading it')
    .toBeCloseTo(8.5417, 1);
});

// A fix already held is an answer, not a reason to go quiet.
//
// The watch refuses a second subscription, correctly, and the callback that
// hands the fix onward only fires when a new one arrives. Together those two
// ate the caller: press the arrangement word to start the watch, then type
// `near`, and the board never opened, because the thing being waited for had
// already happened.
test('asking again with a fix already held answers from the fix', async ({ page }) => {
  await standAt(page);
  await open(page, { places: 0, atlas: AROUND });

  await showIndex(page);
  for (let i = 0; i < 4; i++) {
    if ((await page.locator('#sortWord').textContent()).startsWith('nearest')) break;
    await page.locator('#sortWord').click();
  }
  await expect(page.locator('#sortWord')).toHaveText('nearest you', { timeout: 15000 });

  // away from the board, and then the other road to the same thing
  await page.locator('#indexClose').click();
  await expect(page.locator('#indexOverlay')).toBeHidden();
  await page.keyboard.press('/');
  await page.locator('#paletteInput').fill('>near');
  await expect(page.locator('.cmd-row').first()).toBeVisible();
  await page.keyboard.press('Enter');

  await expect(page.locator('#indexOverlay'),
    'the fix was held, so nothing new arrived, so nothing at all happened')
    .toBeVisible({ timeout: 15000 });
  await expect(page.locator('#sortWord')).toHaveText('nearest you');
});

// A press that began on a row outlives the row.
//
// The rows carried a listener each, and the list is written again whenever
// anything underneath it changes: a fix arriving, or the map settling three
// hundred milliseconds after a fly. A press that began before one of those
// rewrites and ended after it was delivered to a node that had already been
// thrown away, so nothing happened at all. On a phone a tap that does nothing
// cannot be told from a tap the screen never felt, so the second one is harder
// and the third is a complaint.
//
// This is the shape that took a CI run red while accusing an entirely
// different rule of being broken: the press did nothing, the plate that was
// already there stayed there, and the count read the plate before it.
test('a press that began on a row survives the row being written again', async ({ page }) => {
  await standAt(page);
  await open(page, { places: 0, atlas: AROUND });
  await showIndex(page);
  // the arrangement that makes a settling map rewrite the list at all
  for (let i = 0; i < 4; i++) {
    if ((await page.locator('#sortWord').textContent()).startsWith('nearest')) break;
    await page.locator('#sortWord').click();
  }
  await expect(page.locator('#sortWord')).toHaveText('nearest you', { timeout: 15000 });

  const box = await page.locator('.ix', { hasText: 'The Near One' }).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();

  // and the map settles under the finger, which is the road that rewrites them
  await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const m = await import(`/js/map.js${v}`);
    m.getMap().panBy([60, 0], { animate: false });
  });
  await page.waitForTimeout(450);   // longer than the 300ms the rewrite waits
  await page.mouse.up();

  await expect(page.locator('#plate'),
    'the row was written again mid press, and the press was lost with it')
    .toBeVisible({ timeout: 5000 });
});

// ---------- a ring that is pressed comes apart ----------
//
// Reported from the field: places gathered into a circle, and pressing the
// circle went to one place instead of separating them.
//
// The cause was two settings that only bite together. markercluster's own
// click handler is the only thing that ever spiders a ring open, and the app
// switches it off so its fly can carry the overlay's padding. The fly was then
// capped at zoom 16, where a ring still gathers anything within about seventy
// five metres. Three doors on one street therefore flew, landed, and left the
// same ring sitting on top of them: the app looked like it had chosen one.
//
// Three marks a metre apart cannot be separated at any zoom this app allows,
// so this is the case that must spider. A ring still standing with three in it
// after the press is the defect, exactly as it was seen.
test('a ring pressed over places a metre apart comes apart', async ({ page }) => {
  const now = new Date().toISOString();
  const at = (id, name, lat, lng) => ({
    id, name, lat, lng, city: 'Basel', country: 'Switzerland',
    tags: [], status: 'visited', note: '', createdAt: now, updatedAt: now,
  });
  await open(page, { atlas: [
    at('d1', 'The First Door', 47.556000, 7.590000),
    at('d2', 'The Second Door', 47.556009, 7.590013),
    at('d3', 'The Third Door', 47.556018, 7.590026),
  ] });

  const ring = page.locator('.station-icon');
  await expect(ring).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.station-n')).toHaveText('3');
  await expect(ring).toHaveAttribute('aria-label', '3 places here, together');

  await ring.click();

  // three marks a finger can reach, each its own. spidered or separated, the
  // test does not care which; it cares that the ring did not survive the press
  await expect(page.locator('.mark-icon'),
    'the ring was pressed and the places are still hidden inside it')
    .toHaveCount(3, { timeout: 10000 });
  // and they stand apart. The ring itself stays, dimmed, at the centre of the
  // fan, which is what a spidered ring looks like; what must not survive is
  // three marks on one point.
  //
  // Polled rather than read once, because coming apart is a movement and this
  // is a claim about where it ends. markercluster places all three marks on the
  // cluster's own point and then transitions them out to their legs, so a read
  // taken before that transition has started sees three marks at one address
  // and reports the exact defect this test exists to catch. It passed on every
  // engine on a laptop and failed on all three in CI, which is the signature of
  // a race and not of a defect: the runner had not painted the first frame of
  // the fan by the time the count of three was satisfied.
  //
  // What is waited for matters. The press is not repeated, and nothing here
  // reaches for the ring a second time: if the ring never comes apart the marks
  // never separate, and this times out red exactly as it did before. The only
  // thing given time is the movement the app itself asks for.
  await expect.poll(async () => page.evaluate(() => {
    const at = [...document.querySelectorAll('.mark-icon')].map(el => {
      const r = el.getBoundingClientRect();
      return [Math.round(r.x), Math.round(r.y)];
    });
    return new Set(at.map(p => p.join(','))).size;
  }), {
    message: 'the marks came out of the ring on top of one another',
    timeout: 10000,
  }).toBe(3);

  // and each of them opens its own plate, which is the thing that could not be
  // done before: pressing the ring reached exactly one place.
  //
  // The ring is pressed again before each name, because choosing one of the
  // fanned marks selects it, and selecting redraws every mark on the field,
  // which gathers the ring back up. That is the field answering the choice
  // rather than a defect: one place is now open, and reaching a second is one
  // press of the same ring.
  for (const name of ['The First Door', 'The Second Door', 'The Third Door']) {
    if (await page.locator(`.mark-icon[title^="${name}"]`).count() === 0) {
      await page.locator('.station-icon').click();
      await expect(page.locator('.mark-icon')).toHaveCount(3, { timeout: 10000 });
    }
    await page.locator(`.mark-icon[title^="${name}"]`).click();
    await expect(page.locator('#plate')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#plate .plate-name')).toHaveText(name);
    await page.locator('#pClose').click();
    await expect(page.locator('#plate')).toBeHidden();
  }
});

test('decorative path ends are not unnamed map controls', async ({ page }) => {
  await open(page, { places: 3, ways: 1 });
  const ends = page.locator('.way-cap-icon');
  await expect(ends).toHaveCount(2);
  for (let i = 0; i < 2; i += 1) {
    await expect(ends.nth(i)).toHaveAttribute('role', 'presentation');
    await expect(ends.nth(i)).toHaveAttribute('aria-hidden', 'true');
    await expect(ends.nth(i)).not.toHaveAttribute('tabindex', /.+/);
  }
});

// ---------- and nothing stands on a ring ----------
//
// Reported from the field a second time, in the same words: pressing a circle
// with a number in it went straight to one place instead of separating them.
//
// The rule above was not the defect. A ring standing on its own still comes
// apart, and the walk that proves it is the test before this one. What was
// standing on the ring was somebody else's mark.
//
// Voices are drawn outside the ring group on purpose, so they never gather:
// the floor that hides them below zoom five exists because a contact's places
// land inside a few pixels at world zoom, and gathering them into rings of
// their own would put a second kind of circle on the field. But it means a
// voice's mark is a single mark at full size next to a ring, and Leaflet
// stacks one pane by latitude and then by the order layers were added, with
// the voices layer added after the ring group. A held place is by definition
// at an address you already carry, so it lands exactly on the ring your own
// places were gathered into, and it takes the press: the field does not move,
// and a plate opens for one place. That is the report, word for word.
test('a mark of somebody else does not take the press meant for a ring', async ({ page }) => {
  const now = new Date().toISOString();
  const at = (id, name, lat, lng) => ({
    id, name, lat, lng, city: 'Basel', country: 'Switzerland',
    tags: [], status: 'visited', note: '', createdAt: now, updatedAt: now,
  });
  await open(page, {
    atlas: [
      at('d1', 'The First Door', 47.556000, 7.590000),
      at('d2', 'The Second Door', 47.556009, 7.590013),
      at('d3', 'The Third Door', 47.556018, 7.590026),
    ],
    // Marta's own place, twenty metres down the same street.
    //
    // The distance is the test. Leaflet ranks one pane by how far south a
    // thing sits, so a mark at exactly the ring's own point ties with it and
    // loses on document order, and a fixture built that way passes while the
    // field is broken: that was the first draft of this test. Twenty metres is
    // three pixels at the zoom the field opens on here, which is enough to
    // outrank the ring and far inside the twenty two pixel circle a mark
    // answers to. So her mark is over the ring's centre and above it, which is
    // the arrangement that was reported.
    voices: [{
      id: 'c1', name: 'Marta', hue: 40, visible: true, addedAt: now, tags: [],
      places: [at('mp1', 'Her Own Door', 47.556009 - 20 / 111320, 7.590013)],
    }],
  });

  const ring = page.locator('.station-icon');
  await expect(ring).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.station-n')).toHaveText('3');
  // her mark is on the field, which is the whole premise of this test: under
  // the floor there is nothing there to cover anything
  await expect(page.locator('.mark.corr'),
    'no voice is drawn, so this proves nothing about a ring being covered')
    .toHaveCount(1);

  // Pressed as a point on the field, not as a named element. `ring.click()`
  // refuses to press something another element is standing over and retries
  // until it times out, which is a true report and the wrong one: a finger
  // does not retry, it lands on whatever is on top. This presses the ring's
  // own centre once and asks what happened.
  const box = await ring.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  // your three, out of the ring and each its own. Counted through `.mark` so a
  // voice cannot answer for one: both wear `mark-icon`, which is why the count
  // in the test above cannot be reused here.
  await expect(page.locator('.mark-icon .mark:not(.corr)'),
    'the ring was pressed and your places are still gathered inside it')
    .toHaveCount(3, { timeout: 10000 });
  await expect(page.locator('#plate'),
    'the press reached a mark instead of the ring, and a plate opened over it')
    .toBeHidden();
});

// And at one address, the mark that answers is yours.
//
// The same stacking decided this one, and decided it by accident: two marks on
// one point have the same latitude, so the order the layers were added is the
// whole of the rule, and voices are added last. Pressing your own record of a
// place opened somebody else's reading of it. Their reading is not lost by
// this: it is in voices, filed under the person, which is where a person goes
// looking for what somebody else said.
test('at one address your own mark is the one that answers', async ({ page }) => {
  const now = new Date().toISOString();
  const at = (id, name, lat, lng) => ({
    id, name, lat, lng, city: 'Basel', country: 'Switzerland',
    tags: [], status: 'visited', note: '', createdAt: now, updatedAt: now,
  });
  await open(page, {
    atlas: [at('d1', 'The Door I Wrote Down', 47.556000, 7.590000)],
    voices: [{
      id: 'c1', name: 'Marta', hue: 40, visible: true, addedAt: now, tags: [],
      // one address, two names, so the plate says which mark took the press
      places: [at('mp1', 'The Door Marta Wrote Down', 47.556000, 7.590000)],
    }],
  });

  const mine = page.locator('.mark-icon:has(.mark:not(.corr))');
  await expect(mine).toHaveCount(1, { timeout: 15000 });
  await expect(page.locator('.mark.corr')).toHaveCount(1);

  // pressed as a finger presses it: a point on the field, not a named element
  const box = await mine.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  await expect(page.locator('#plate')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('#plate .plate-name'),
    'a voice took the press at an address of your own')
    .toHaveText('The Door I Wrote Down');
});

// ---------- books: a record that may answer to no place ----------

test('the sample arrives with a shelf, and a book with no place is on it', async ({ page }) => {
  // Through the app's own front door rather than planted into storage: the
  // claim is about what a person meets when they take the full atlas, so the
  // full atlas is taken the way a person takes it.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const pattern of OFF) await page.route(pattern, r => r.abort());
  await cutTheWorld(page);
  await page.goto('/');
  await expect(page.locator('#threshold')).toBeVisible({ timeout: 15000 });
  // the door counts what is coming, books included
  await expect(page.locator('#thFullWhat')).toContainText(/\d+ books/);
  await page.locator('#thFull').click();
  await expect(page.locator('#threshold')).toBeHidden();
  await expect(page.locator('#reportOverlay')).toBeVisible();
  await page.getByRole('button', { name: 'Use as my atlas', exact: true }).click();
  await showIndex(page);

  const band = page.locator('.ix-band', { hasText: 'books' });
  await expect(band).toBeVisible({ timeout: 10000 });

  // a book that answers to no place: it is on the shelf, and no place is named
  // beside it
  const free = page.locator('.ix-row.book', { hasText: 'Invisible Cities' });
  await expect(free).toBeVisible();
  await expect(free.locator('.ix-at')).toHaveCount(0);

  // a book that answers to one: the place is named and pressing it flies there
  const tied = page.locator('.ix-row.book', { hasText: 'A Moveable Feast' });
  await expect(tied.locator('.ix-at')).toHaveText('Shakespeare and Company');
  await tied.locator('.ix-at').click();
  await expect(page.locator('#plate')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('#plate .plate-name')).toHaveText('Shakespeare and Company');
  // and the plate says what was read there
  await expect(page.locator('#plate .shelf-t')).toHaveText('A Moveable Feast');
});

// ---------- books travel: the folio carries a shelf, and adoption re-ties ----------
//
// The tie is the part that cannot travel literally. A link names a book's
// place by the id it wore in the sender's atlas; the recipient's copy of that
// place wears a fresh id and remembers the old one only as provenance.srcId,
// local bookkeeping that never leaves. So take-all adopts the places first
// and the books after, and the claim worth a browser is the whole loop: the
// tie re-lands on the adopted copy, and a book that came free stays free.

test('a folio hands over its shelf, and the tie re-lands on the adopted place', async ({ page }) => {
  await open(page);
  const url = await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const { newPlace, newBook } = await import(`/js/store.js${v}`);
    const { makeFolioUrl } = await import(`/js/share.js${v}`);
    const at = newPlace({ id: 'sender_place_1', name: 'Shakespeare and Company',
      city: 'Paris', lat: 48.85259, lng: 2.34710, tags: [] });
    const tied = newBook({ id: 'sender_book_1', title: 'A Moveable Feast',
      author: 'Ernest Hemingway', year: '1964', placeId: at.id, note: 'the caf\u00e9 pages first' });
    const free = newBook({ id: 'sender_book_2', title: 'Invisible Cities',
      author: 'Italo Calvino', year: '1972' });
    return makeFolioUrl({ title: 'Paris, read first', dedication: 'for the trip',
      author: 'ada', tags: [], places: [at], routes: [], books: [tied, free] });
  });
  await arrive(page, url);
  await expect(page.locator('#reportOverlay')).toBeVisible({ timeout: 20000 });

  // the report says the shelf out loud, and a book stands as a row of the case
  await expect(page.locator('#reportOverlay')).toContainText('2 books');
  await expect(page.locator('.rp-pick', { hasText: 'A Moveable Feast' })).toContainText('Ernest Hemingway, 1964');

  // take all three, and the toast counts each kind by name
  await expect(page.locator('#rpTakeAll')).toContainText('Save all 3');
  await page.locator('#rpTakeAll').click();
  await expect(page.locator('#toast')).toContainText('1 place and 2 books saved to your atlas, after ada', { timeout: 10000 });

  const got = await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const { store } = await import(`/js/store.js${v}`);
    const tied = store.books.find(b => b.title === 'A Moveable Feast');
    const free = store.books.find(b => b.title === 'Invisible Cities');
    const home = store.places.find(pl => pl.provenance?.srcId === 'sender_place_1');
    return {
      tie: tied?.placeId, homeId: home?.id,
      freeTie: free?.placeId,
      byline: tied?.provenance?.name, srcId: tied?.provenance?.srcId,
      status: tied?.status,
    };
  });
  expect(got.homeId, 'the place never arrived').toBeTruthy();
  expect(got.tie, 'the tie did not re-land on the adopted copy').toBe(got.homeId);
  expect(got.freeTie, 'a book that came free grew a tie').toBe('');
  expect(got.byline, 'the road did not arrive with the book').toBe('ada');
  expect(got.srcId, 'the id the book wore in the sender\u2019s atlas was not remembered').toBe('sender_book_1');
  expect(got.status, 'only you can say you have read it').toBe('wishlist');
});

// the composer's side of the same journey: the shelf is a band of its own,
// out until pressed in like a path, and the kept folio holds the reference
test('the composer offers the shelf under its own word, and the folio keeps it', async ({ page }) => {
  await open(page);
  await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const { store, newBook } = await import(`/js/store.js${v}`);
    store.load();
    store.addBook(newBook({ id: 'shelf_b1', title: 'Invisible Cities', author: 'Italo Calvino' }));
  });
  await openTheComposer(page);
  await expect(page.locator('.fol-band .fb-city', { hasText: 'books' })).toBeVisible();
  const row = page.locator('.fol-row[data-bkid="shelf_b1"]');
  await expect(row).toHaveAttribute('aria-pressed', 'false');
  await expect(row).toContainText('Italo Calvino');
  await row.click();
  await expect(page.locator('.fol-row[data-bkid="shelf_b1"]')).toHaveAttribute('aria-pressed', 'true');

  await page.locator('#folTitle').fill('Read first');
  await page.locator('#folKeep').click();
  await expect(page.locator('#toast')).toContainText('collection saved', { timeout: 10000 });
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('resonate.folios.v1'))[0]);
  expect(kept.bookIds, 'the kept folio lost its shelf').toEqual(['shelf_b1']);

  // and the shelf row says the book out loud
  await page.locator('#folBack').click();
  await expect(page.locator('.fol-shelf-row .fs-meta').first()).toContainText('1 book');
});

// A count belongs beside what it counts, and twice already the words after the
// numeral have failed to stay there. The byline went from this line in the
// first fix, because at this letterspacing it wrapped and orphaned the name on
// a narrow screen; the ways came back inline in the second, whose own comment
// in the stylesheet says they must not read "as a heading for the list below
// rather than as part of the count above". Both fixes were right and both were
// checked on a desk. Measured at 390: the tally broke after `14`, and `books`
// began at x 18, which is not merely the left margin but the exact left edge of
// the numeral, so it sat under the 3 of 31 with its own number stranded on the
// line above. A number severed from its noun, and the noun promoted to nav.
//
// The claim is therefore geometric rather than about wrapping, because wrapping
// is not the fault and forbidding it would only move the fault to an overflow.
// The words may take as many lines as they need; not one of those lines may
// begin left of the number it is counting for, and the words as a whole must
// stand on the number's own line rather than beneath it.
//
// Both halves, because the first half alone is a check that passes while the
// thing it is named for is broken. Asked only where the lines began, this test
// went green over a build that had moved the entire tally below the numeral -
// further from the count than the wrap it replaced - because the words still
// began to the right of x. Beside is a claim about two axes and was written as
// a claim about one.
test('the tally stays beside the number it counts, at every width', async ({ page }) => {
  await open(page, { places: 31, books: 14, ways: 1 });
  await showIndex(page);

  for (const [w, h] of [[1512, 982], [768, 1024], [430, 932], [390, 844], [360, 780]]) {
    await page.setViewportSize({ width: w, height: h });
    const seen = await page.evaluate(() => {
      const n = document.getElementById('ixN').getBoundingClientRect();
      const ways = document.getElementById('ixWays');
      const box = document.querySelector('.ix-said').getBoundingClientRect();
      return {
        left: n.left, right: n.right, top: n.top, bottom: n.bottom,
        said: ways.textContent, box,
        lines: [...ways.getClientRects()].map(r => Math.round(r.left)),
      };
    });
    // the assertion below is only worth anything if there is a tally to read,
    // and a helper that quietly seeded nothing would make it pass forever
    expect(seen.said, `at ${w} the tally counted no paths and no books`)
      .toContain('book');
    expect(seen.lines.length, `at ${w} the tally drew no line to measure`)
      .toBeGreaterThan(0);
    for (const line of seen.lines) {
      expect(line, `at ${w} a line of the tally began left of the numeral it counts for`)
        .toBeGreaterThanOrEqual(Math.round(seen.right));
    }
    // and it shares the numeral's line: the two boxes overlap on the axis that
    // says beside rather than below
    expect(seen.box.top, `at ${w} the tally dropped below the numeral instead of standing beside it`)
      .toBeLessThan(seen.bottom);
    expect(seen.box.bottom, `at ${w} the tally stood clear above the numeral`)
      .toBeGreaterThan(seen.top);
  }
});

// The same fault as the tally's, found twice more by sweeping for it rather
// than by looking: a line that ends on a number whose noun went to the next
// line, or on the separator that was meant to introduce what follows. At 1512
// the census opened `31 places across 7 countries. 0` and continued `been, 31
// still to go.`; at 360 the you room's line ended one on `16` and began the
// next on `contacts`. Neither is a wrapping bug - both lines are supposed to
// wrap - and neither shows on a desk at the width it was written at.
//
// So this is written as a sweep over the lines rather than as three assertions
// about three of them. The count lines are the app's only real numbers and it
// keeps adding them; a rule that has to be remembered at each new one is a rule
// that will be missed at the fourth.
async function lineEnds(page, sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    const node = el && el.firstChild;
    if (!node || node.nodeType !== 3) return null;
    const t = node.nodeValue;
    const r = document.createRange();
    const ends = new Map();
    for (let i = 0; i < t.length; i++) {
      if (/\s/.test(t[i])) continue;
      r.setStart(node, i); r.setEnd(node, i + 1);
      const b = r.getBoundingClientRect();
      if (!b.width && !b.height) continue;
      const key = Math.round(b.top);
      const cur = ends.get(key);
      if (!cur || b.right > cur.right) ends.set(key, { right: b.right, ch: t[i], i });
    }
    const rows = [...ends.entries()].sort((a, b) => a[0] - b[0]);
    return {
      text: t,
      // every line but the last, and whether it was left holding something
      stranded: rows.slice(0, -1).map(([, e]) => {
        const rest = t.slice(e.i + 1);
        if (/[·|]/.test(e.ch)) return `separator "${e.ch}"`;
        if (/\d/.test(e.ch) && /^\s+[A-Za-z]/.test(rest)) return `count ending "${e.ch}"`;
        return null;
      }).filter(Boolean),
      lines: rows.length,
    };
  }, sel);
}

// An atlas wide enough to make every count in the app say something: seven
// countries so the census opens on a number it has to wrap, and a city per
// place so the you room's line runs the full seven counts. Half of it still to
// go, because the census opening counts been and still separately and a line
// only breaks where there is something on both sides of the break.
function aWideAtlas() {
  const now = new Date().toISOString();
  const where = [
    ['Basel', 'Switzerland'], ['Lisbon', 'Portugal'], ['Trieste', 'Italy'],
    ['Ghent', 'Belgium'], ['Aarhus', 'Denmark'], ['Vilnius', 'Lithuania'],
    ['Porto', 'Portugal'],
  ];
  return Array.from({ length: 31 }, (_, i) => {
    const [city, country] = where[i % where.length];
    return {
      id: 'p' + i, name: 'Place ' + i, lat: 46 + i * 0.01, lng: 8 + i * 0.01,
      city, country, tags: ['t1'], status: i % 2 ? 'visited' : 'wish',
      note: '', createdAt: now, updatedAt: now,
    };
  });
}

// Large screens buy structure, not unrelated pairings. The poster itself puts
// Settings on the second half of a desk; the choices inside remain one reading
// sequence on every glass. A second grid here once stretched short sections to
// the height of whatever happened to sit beside them.
test('settings uses the second half of a desk and one reading sequence within it',
  async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await open(page, { atlas: aWideAtlas(), books: 14, ways: 3, folios: 5 });
    await showIndex(page);
    await page.locator('[data-go="you"]').click();
    await expect(page.locator('#settingsOverlay')).toBeVisible();

    const measure = () => page.evaluate(() => {
      const box = sel => {
        const r = document.querySelector(sel).getBoundingClientRect();
        return { left: r.left, right: r.right, width: r.width };
      };
      const sectionLefts = [...document.querySelectorAll('#settingsBody > .set-sec')]
        .map(el => Math.round(el.getBoundingClientRect().left));
      return {
        viewport: innerWidth,
        title: box('#settingsOverlay .poster-word'),
        body: box('#settingsBody'),
        columns: new Set(sectionLefts).size,
      };
    });

    const desk = await measure();
    expect(desk.title.left, 'the title did not keep its left leaf').toBeLessThan(desk.viewport * 0.15);
    expect(desk.body.left, 'the room remained a narrow phone column on a desk')
      .toBeGreaterThan(desk.viewport * 0.4);
    expect(desk.body.right, 'the room left the useful right side empty')
      .toBeGreaterThan(desk.viewport * 0.75);
    expect(desk.columns, 'settings split one reading sequence into unrelated columns').toBe(1);

    await page.setViewportSize({ width: 1000, height: 900 });
    const tablet = await measure();
    expect(tablet.body.left, 'the tablet did not return to its reading edge')
      .toBeLessThan(tablet.viewport * 0.15);
    expect(tablet.columns, 'the tablet split one settings sequence into columns').toBe(1);

    await page.setViewportSize({ width: 390, height: 844 });
    const phone = await measure();
    expect(phone.body.left, 'the phone did not keep its reading edge')
      .toBeLessThan(phone.viewport * 0.15);
    expect(phone.columns, 'the phone split its settings sequence').toBe(1);

    await page.setViewportSize({ width: 320, height: 568 });
    const narrow = await measure();
    expect(narrow.body.left, 'the narrow phone lost its reading edge')
      .toBeLessThan(narrow.viewport * 0.15);
    expect(narrow.body.right, 'the narrow phone pushed settings beyond its glass')
      .toBeLessThanOrEqual(narrow.viewport);
    expect(narrow.columns, 'the narrow phone split its settings sequence').toBe(1);
  });

// An empty atlas has two things to say: what the field is, and how to begin.
// On a desk those sentences can face one another. On a smaller screen they
// remain one reading sequence, so no responsive gain costs mobile clarity.
test('a wide empty atlas pairs its law with its next move', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await open(page, { places: 0 });
  await showIndex(page);

  const measure = () => page.evaluate(() => {
    const box = sel => {
      const r = document.querySelector(sel).getBoundingClientRect();
      return { left: r.left, right: r.right, width: r.width };
    };
    return {
      viewport: innerWidth,
      room: box('#listView > .ix-empty'),
      law: box('#listView .ix-empty-law'),
      move: box('#listView .ix-empty p'),
    };
  });

  const desk = await measure();
  expect(desk.room.width, 'the empty state still occupied only a sliver of the desk')
    .toBeGreaterThan(desk.viewport * 0.75);
  expect(desk.move.left, 'the next move did not receive its own desktop field')
    .toBeGreaterThan(desk.law.right);

  await page.setViewportSize({ width: 1000, height: 900 });
  const tablet = await measure();
  expect(Math.abs(tablet.move.left - tablet.law.left),
    'the empty state did not return to one reading edge').toBeLessThan(2);
});

// A bottom sheet is map context plus the thing somebody asked to read. Keeping
// the same 70/30 split on a short phone spent almost two hundred of its 568
// pixels on the map after a place had already been opened, then handed the
// actual place 375 pixels and made its notes a second journey. Height, not
// width, is the constraint here: the compact sheet rises to one corner-mark
// band from the top, while a tall phone keeps more of the field in view.
test('a short phone gives an opened place the height it needs', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await open(page, { places: 1 });
  await showIndex(page);
  await page.locator('#listView .ix').first().click();
  await expect(page.locator('#plate')).toBeVisible();

  const seen = await page.locator('#plate').evaluate(el => {
    const r = el.getBoundingClientRect();
    const close = el.querySelector('.plate-eyebrow button').getBoundingClientRect();
    return {
      top: r.top, bottom: r.bottom, height: r.height,
      viewport: { width: innerWidth, height: innerHeight },
      sideways: el.scrollWidth - el.clientWidth,
      close: { top: close.top, right: close.right, bottom: close.bottom },
    };
  });
  expect(seen.top, 'the compact sheet erased every trace of the field').toBeGreaterThanOrEqual(56);
  expect(seen.top, 'the compact sheet still spent too much height on map context').toBeLessThanOrEqual(72);
  expect(seen.height, 'the opened place received less than seven eighths of a short phone')
    .toBeGreaterThan(seen.viewport.height * 0.87);
  expect(Math.abs(seen.bottom - seen.viewport.height), 'the sheet floated clear of the bottom edge')
    .toBeLessThan(1);
  expect(seen.sideways, 'the taller sheet introduced sideways travel').toBeLessThanOrEqual(1);
  expect(seen.close.top, 'the close word rose above the visible sheet').toBeGreaterThan(seen.top);
  expect(seen.close.right, 'the close word ran off the narrow glass').toBeLessThanOrEqual(seen.viewport.width);
  expect(seen.close.bottom, 'the close word fell below the first visible frame').toBeLessThan(seen.viewport.height);
});

test('a counted line never ends on the number or the mark that needed the next word',
  async ({ page }) => {
    await open(page, {
      atlas: aWideAtlas(), books: 14, ways: 3, folios: 5,
      voices: [
        { id: 'c1', name: 'Marta', createdAt: '2024-01-01T00:00:00.000Z' },
        { id: 'c2', name: 'Kenji', createdAt: '2024-01-01T00:00:00.000Z' },
      ],
    });

    const go = async (verb, ready) => {
      await page.keyboard.press('Escape');
      await page.keyboard.press('/');
      await page.locator('#paletteInput').fill(verb);
      await expect(page.locator('.cmd-row').first()).toBeVisible();
      await page.keyboard.press('Enter');
      await expect(page.locator(ready)).toBeVisible();
    };

    let wrapped = 0;
    for (const [w, h] of [[360, 780], [390, 844], [1512, 982]]) {
      await page.setViewportSize({ width: w, height: h });

      await go('>you', '#censusLine');
      const you = await lineEnds(page, '#censusLine');
      expect(you, `at ${w} the you room counted nothing`).not.toBeNull();
      expect(you.text, `at ${w} the census line was still counting`).toContain('place');
      expect(you.stranded, `at ${w} the you room's census line left something behind`)
        .toEqual([]);

      await go('>census', '.stat-opening');
      const stat = await lineEnds(page, '.stat-opening');
      expect(stat, `at ${w} the census said nothing`).not.toBeNull();
      expect(stat.stranded, `at ${w} the census opening left something behind`)
        .toEqual([]);

      wrapped += (you.lines > 1 ? 1 : 0) + (stat.lines > 1 ? 1 : 0);
    }

    // and the sweep is only worth anything if these lines wrapped somewhere: a
    // line that fits has no ending to strand, and six of them fitting would be
    // a test that passes by never asking. It is a floor rather than a rule per
    // width, because the desk is entitled to hold either of them on one line.
    expect(wrapped, 'not one counted line wrapped, so this test asked nothing of any of them')
      .toBeGreaterThanOrEqual(2);
  });

// A list of equal things has one left edge, and the common ground did not.
// Measured at 390 with eight shared places: the run began at x134 beside its
// label and every line after the first at x20, which is the bucket's own edge
// and therefore the label's. So eight names that are the same kind of thing had
// two different margins, and the heading stood level with the list it heads.
// At 1512 it did the same at five and three, so this was never a phone fault.
//
// The claim is one edge for the run, at every width, whatever the label does:
// beside the run on a desk, above it on a phone. Not one edge for the bucket,
// which is what the broken build already had.
test('the places under a label keep one left edge', async ({ page }) => {
  const now = new Date().toISOString();
  // eight, because the fault only shows once the run wraps, and one shared
  // place would have made this green over the build it was written against
  const NAMES = [
    ['Septime', 'Paris'], ['Bar Basso', 'Milan'], ['Cafe Central', 'Vienna'],
    ['Nowhere', 'Lisbon'], ['The Long Room', 'Dublin'], ['Sankt Johann', 'Basel'],
    ['Kadeau', 'Copenhagen'], ['Ganbara', 'San Sebastian'],
  ];
  const mine = NAMES.map(([name, city], i) => ({
    id: 'p' + i, name, lat: 46 + i * 0.5, lng: 8 + i * 0.5, city,
    country: 'Somewhere', tags: [], status: 'visited', createdAt: now, updatedAt: now,
  }));
  await open(page, { places: 0, atlas: mine });
  await page.evaluate(async (theirs) => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const { store } = await import(`/js/store.js${v}`);
    store.load();
    store.addCorrespondent({ name: 'Marta', tags: [], places: theirs });
  }, mine.map(p => ({ ...p, id: 'm' + p.id })));
  await showIndex(page);
  await page.locator('[data-go="contacts"]').click();
  await expect(page.locator('.cp-bucket').first()).toBeVisible();

  for (const w of [1512, 1024, 430, 390, 360]) {
    await page.setViewportSize({ width: w, height: 900 });
    const seen = await page.evaluate(() => {
      const run = document.querySelector('.cp-run');
      const lines = new Map();
      for (const p of run.querySelectorAll('.cp-place')) {
        const b = p.getBoundingClientRect();
        const key = Math.round(b.top);
        if (!lines.has(key) || b.left < lines.get(key)) lines.set(key, b.left);
      }
      const label = document.querySelector('.cp-label').getBoundingClientRect();
      const rows = [...lines.entries()].sort((a, b) => a[0] - b[0]);
      return {
        starts: rows.map(([, l]) => Math.round(l)),
        firstTop: rows.length ? rows[0][0] : 0,
        n: run.querySelectorAll('.cp-place').length,
        label: { left: Math.round(label.left), bottom: Math.round(label.bottom) },
      };
    });
    expect(seen.n, `at ${w} the common ground held no places to line up`).toBe(8);
    expect(seen.starts.length, `at ${w} the run did not wrap, so nothing was asked of it`)
      .toBeGreaterThan(1);
    expect(new Set(seen.starts).size,
      `at ${w} the run had ${new Set(seen.starts).size} left edges: ${seen.starts.join(', ')}`)
      .toBe(1);
    // and the label governs the run rather than standing in it: either to its
    // left on the same line, or above it. What it may not do is share the run's
    // own left edge on the run's own first line, which is what reads as a
    // fifth item rather than as the heading of four.
    // and the label governs the run rather than standing in it - but which way
    // it governs is the design and not a detail, so it is named per width
    // rather than allowed either way. Allowed either way, this test passed over
    // a build with the run's basis removed, where the run dropped below the
    // label on a desk and kept one edge while doing it, and over a build with
    // the phone's stacking removed, where the run kept one edge in a 226 pixel
    // gutter and gave a phone eight single-name lines instead of four of two.
    // One edge is true of all three builds. It is not what makes this one right.
    const beside = seen.label.left < seen.starts[0] && seen.label.bottom > seen.firstTop;
    const above = seen.label.bottom <= seen.firstTop && seen.label.left <= seen.starts[0];
    const where = `label left ${seen.label.left} bottom ${seen.label.bottom}, `
      + `run left ${seen.starts[0]} top ${seen.firstTop}`;
    if (w > 760) {
      // a desk has the width for both on one line, and spending a whole line on
      // a four word label is what the room did before the count moved onto it
      expect(beside, `at ${w} the label did not stand beside its run: ${where}`).toBe(true);
    } else {
      // a phone does not: beside the label the run is left 226 of 360, which is
      // one place name per line, so the label steps up and the run takes the width
      expect(above, `at ${w} the label did not stand above its run: ${where}`).toBe(true);
      expect(seen.starts[0], `at ${w} the run did not take the width the label gave it`)
        .toBeLessThanOrEqual(seen.label.left);
    }
  }
});

// A phone has no hover, so whatever tells a pressable word from a plain one has
// to be true of the word standing still. This file used to say that in a comment
// and settle it with a rule under every pressable word; the rule was then taken
// away as clutter, and the comment stayed, and for two commits the index meta
// line held four gathering words and the words `want to go` at the same size,
// the same tracking, the same case and the same ink, with nothing between them
// but a press. The mark is ink now, which is what `.ix` and `.ix-thanks` in this
// same row already used, and this is the test the comment never had.
//
// Written as a signature rather than as "the colour differs", because the claim
// is that they are tellable apart at rest and not that they are tellable apart
// by any one mechanism: ink, a standing rule, size, tracking or case all count,
// and a word added to this line later may reach for a different one.
function restSignature(el) {
  const cs = getComputedStyle(el);
  const rule = cs.borderBottomStyle === 'none' || cs.borderBottomWidth === '0px'
    ? 'no rule'
    : `${cs.borderBottomWidth} ${cs.borderBottomColor}`;
  // a rule the same colour as nothing is no rule
  const painted = /rgba\(0, 0, 0, 0\)|transparent/.test(rule) ? 'no rule' : rule;
  return [cs.color, painted, cs.fontSize, cs.letterSpacing, cs.textTransform,
    cs.fontVariationSettings].join(' | ');
}

test('a word you can press does not look like a word you cannot, standing still',
  async ({ page }) => {
    const now = new Date().toISOString();
    // wished, so `want to go` - the one plain fact this line can hold - stands
    // beside the city, the country and two tags, all four of them pressable
    await open(page, {
      places: 0,
      atlas: [{
        id: 'p0', name: 'Cafe Central', lat: 48.21, lng: 16.36, city: 'Vienna',
        country: 'Austria', tags: ['t1', 't2'], status: 'wishlist',
        note: '', createdAt: now, updatedAt: now,
      }],
    });
    await page.evaluate(async () => {
      const v = new URL(document.querySelector('script[type=module]').src).search;
      const { store } = await import(`/js/store.js${v}`);
      store.load();
      if (!store.tags.find(t => t.id === 't2')) {
        localStorage.setItem('resonate.tags.v1', JSON.stringify([
          { id: 't1', name: 'Nature', hue: 155, color: '#4a7' },
          { id: 't2', name: 'Coffee', hue: 30, color: '#a74' },
        ]));
      }
    });
    await page.reload();
    await expect(page.locator('#intro')).toBeHidden({ timeout: 15000 });
    await showIndex(page);

    for (const w of [1512, 390]) {
      await page.setViewportSize({ width: w, height: 900 });
      const seen = await page.evaluate((sigSrc) => {
        const restSignature = eval(`(${sigSrc})`);
        const meta = document.querySelector('.ix-meta');
        const doors = [], facts = [];
        for (const el of meta.children) {
          const it = { txt: el.textContent.trim(), sig: restSignature(el) };
          (el.tagName === 'BUTTON' ? doors : facts).push(it);
        }
        return { doors, facts };
      }, restSignature.toString());

      // the line must actually hold both kinds, or there is nothing to tell apart
      expect(seen.doors.length, `at ${w} the meta line held no pressable words`)
        .toBeGreaterThanOrEqual(3);
      expect(seen.facts.length, `at ${w} the meta line held no plain words`)
        .toBeGreaterThanOrEqual(1);

      for (const door of seen.doors) {
        for (const fact of seen.facts) {
          expect(door.sig,
            `at ${w} "${door.txt}" opens something and "${fact.txt}" does not, and `
            + `standing still they are the same word: ${door.sig}`)
            .not.toBe(fact.sig);
        }
      }
    }
  });

// The same claim in the room that had eight of them: a place in the common
// ground is a door, its label is a fact, and the eight doors no longer wear
// eight standing rules to say so.
test('a place in the common ground is told from its label without a rule',
  async ({ page }) => {
    const now = new Date().toISOString();
    const mine = [
      { id: 'p0', name: 'Septime', lat: 48.85, lng: 2.38, city: 'Paris',
        country: 'France', tags: [], status: 'visited', createdAt: now, updatedAt: now },
      { id: 'p1', name: 'Bar Basso', lat: 45.48, lng: 9.21, city: 'Milan',
        country: 'Italy', tags: [], status: 'visited', createdAt: now, updatedAt: now },
    ];
    await open(page, { places: 0, atlas: mine });
    await page.evaluate(async (theirs) => {
      const v = new URL(document.querySelector('script[type=module]').src).search;
      const { store } = await import(`/js/store.js${v}`);
      store.load();
      store.addCorrespondent({ name: 'Marta', tags: [], places: theirs });
    }, mine.map(p => ({ ...p, id: 'm' + p.id })));
    await showIndex(page);
    await page.locator('[data-go="contacts"]').click();
    await expect(page.locator('.cp-place').first()).toBeVisible();

    const seen = await page.evaluate((sigSrc) => {
      const restSignature = eval(`(${sigSrc})`);
      const place = document.querySelector('.cp-place');
      const cs = getComputedStyle(place);
      return {
        place: restSignature(place),
        label: restSignature(document.querySelector('.cp-label')),
        city: getComputedStyle(place.querySelector('.cp-city')).color,
        placeColor: cs.color,
        rule: cs.borderBottomStyle === 'none' ? 'none'
          : `${cs.borderBottomWidth} ${cs.borderBottomColor}`,
      };
    }, restSignature.toString());

    expect(seen.place, 'a place and its label read the same standing still')
      .not.toBe(seen.label);
    // and the mark is ink rather than a line, which is the whole change: eight
    // of these stand in a block and eight standing rules read as ruled paper
    expect(seen.rule, 'the place wore a standing rule again')
      .toMatch(/rgba\(0, 0, 0, 0\)|transparent|none/);
    // the name is the door, the city only tells two Septimes apart
    expect(seen.city, 'the city was as dark as the name it qualifies')
      .not.toBe(seen.placeColor);
  });

// A row that holds a thing and the control that acts on it holds them together.
// space-between sent each pair to opposite ends of a 760 pixel room: the byline
// field stood 195 pixels clear of the sentence explaining it. Right-aligned
// controls are a pattern about a column, and there was never a column here -
// these rows sit in four different sections and two of them hold one child.
test('the sharing name stays beside the words that explain it',
  async ({ page }) => {
    await open(page);
    await page.keyboard.press('/');
    await page.locator('#paletteInput').fill('>you');
    await expect(page.locator('.cmd-row').first()).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.locator('.set-name-row')).toBeVisible();

    for (const w of [1512, 1024]) {
      await page.setViewportSize({ width: w, height: 950 });
      const rows = await page.evaluate(() =>
        [...document.querySelectorAll('.set-name-row')].map(row => {
          const kids = [...row.children].map(c => {
            const b = c.getBoundingClientRect();
            return { l: b.left, r: b.right, t: Math.round(b.top),
              what: (c.className || c.tagName).toString().slice(0, 20) };
          });
          const pairs = [];
          for (let i = 1; i < kids.length; i++) {
            // only children actually sharing a line: a wrapped row is not a
            // row held apart, it is a row that ran out of width
            if (Math.abs(kids[i].t - kids[i - 1].t) < 24)
              pairs.push({ gap: Math.round(kids[i].l - kids[i - 1].r),
                what: `${kids[i - 1].what} -> ${kids[i].what}` });
          }
          return pairs;
        }).flat());
      expect(rows.length, `at ${w} no settings row held a pair to measure`)
        .toBeGreaterThan(0);
      for (const p of rows) {
        // the row's own gap is 20; anything far past it is the room, not the gap
        expect(p.gap, `at ${w} ${p.what} stood ${p.gap} apart in one row`)
          .toBeLessThanOrEqual(40);
      }
    }
  });

// A measure belongs to the type it measures. 34ch was declared on the box and
// inherited by a display line clamped between 28 and 54, so `ch` resolved
// against the parent's fifteen pixels and handed the law a 310 pixel column at
// every width. It also silently killed the measure below it: `.ce-how` asks for
// 46ch, which is 451 pixels at its own size, and rendered at 310 at every width
// this was ever looked at - a declared rule that could never once apply.
test('a measure declared on an element is the measure that element gets',
  async ({ page }) => {
    await open(page, { places: 1 });
    await page.keyboard.press('/');
    await page.locator('#paletteInput').fill('>voices');
    await expect(page.locator('.cmd-row').first()).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.locator('.ce-law').first()).toBeVisible();

    for (const w of [1512, 1024]) {
      await page.setViewportSize({ width: w, height: 950 });
      const seen = await page.evaluate(() => {
        const how = document.querySelector('.corr-empty .ce-how');
        // 46ch measured in the element's own type, which is what 46ch means
        const probe = document.createElement('span');
        probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font:'
          + getComputedStyle(how).font;
        probe.textContent = '0'.repeat(46);
        how.appendChild(probe);
        const own = probe.getBoundingClientRect().width;
        probe.remove();
        // The room is measured outside the box under suspicion, and that is the
        // whole difference. Asked what `.ce-how` was owed with `.corr-empty` as
        // the room, this test excused the exact bug it was written for: the
        // parent's 310 cap became the answer, min(451, 310) came to 310, and
        // 310 is what it got. An element cannot be the authority on how much
        // room it was entitled to when it is the thing taking the room away.
        return { actual: how.getBoundingClientRect().width, own,
          room: how.closest('.corr-empty').parentElement.getBoundingClientRect().width };
      });
      // it gets its own measure, or the room, whichever is smaller - never a
      // number computed from somebody else's type
      const owed = Math.min(seen.own, seen.room);
      expect(Math.abs(seen.actual - owed),
        `at ${w} .ce-how asked for 46ch (${Math.round(seen.own)}px) with `
        + `${Math.round(seen.room)}px of room and got ${Math.round(seen.actual)}px`)
        .toBeLessThan(4);
    }

    // and the law, which is the largest type in the app and the shortest
    // sentence in it, never ends a line on a word the next line completes
    const GOVERNING = new Set(['a', 'an', 'the', 'not', 'no', 'and', 'or', 'is',
      'to', 'of', 'in', 'on', 'at', 'it', 'this', 'your', 'you']);
    for (const w of [1512, 1024, 390, 360]) {
      await page.setViewportSize({ width: w, height: 950 });
      const hang = await page.evaluate(() => {
        const law = document.querySelector('.ce-law');
        const node = law.firstChild;
        const t = node.nodeValue, range = document.createRange();
        const ends = new Map();
        for (let i = 0; i < t.length; i++) {
          if (/\s/.test(t[i])) continue;
          range.setStart(node, i); range.setEnd(node, i + 1);
          const b = range.getBoundingClientRect();
          if (!b.width && !b.height) continue;
          const k = Math.round(b.top);
          const cur = ends.get(k);
          if (!cur || b.right > cur.r) ends.set(k, { r: b.right, i });
        }
        const rows = [...ends.entries()].sort((a, b) => a[0] - b[0]);
        return { lines: rows.length, last: rows.slice(0, -1).map(([, e]) =>
          t.slice(0, e.i + 1).trim().split(/[\s ]+/).pop().replace(/[^A-Za-z]/g, '')) };
      });
      for (const word of hang.last) {
        expect(GOVERNING.has(word.toLowerCase()),
          `at ${w} a line of the law ended on "${word}", which the next line completes`)
          .toBe(false);
      }
    }
  });

// Width is allowed to buy more lines, never fewer words. The ordinary sample
// only happens to fit at 320px, so it cannot guard the folded 280px glass or
// content near the schema limits. These names are deliberately long in every
// place the interface used to carry an ellipsis: the board, command results,
// selected tags, Contacts, and list city bands.
test('meaningful content wraps whole on the narrowest supported glass', async ({ page }) => {
  const now = new Date().toISOString();
  const placeName = 'The International Museum of Handwritten Maps and Travelling Memory';
  const city = 'Saint-Remy-en-Bouzemont-Saint-Genest-et-Isson';
  const country = 'United Kingdom of Great Britain and Northern Ireland';
  const contactName = 'Alexandria Catherine Montgomery-Wetherby of the Northern Isles';
  const tags = [
    { id: 't1', name: 'Architectural history and monumental conservation', hue: 155, color: '#4a7' },
    { id: 't2', name: 'Small rituals worth crossing a city for', hue: 32, color: '#a74' },
  ];
  const record = (id, name, lat) => ({
    id, name, lat, lng: 8, city, country, tags: ['t1', 't2'], status: 'visited',
    note: '', createdAt: now, updatedAt: now,
  });
  await page.setViewportSize({ width: 280, height: 653 });
  await open(page, {
    places: 0,
    atlas: [record('long', placeName, 46), record('other', 'A second place', 46.1)],
    tags,
    voices: [{
      id: 'voice', name: contactName, hue: 40, visible: true, addedAt: now, tags: [],
      places: [record('voice-place', 'A shared place', 47)],
    }],
  });

  const whole = async (selector, what) => {
    const readings = await page.locator(selector).evaluateAll((nodes) => nodes.map((el) => {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const root = el.closest('.index,.cmd,.plate,.poster,.report')?.getBoundingClientRect();
      return {
        text: (el.textContent || '').trim(),
        ellipsis: s.textOverflow === 'ellipsis',
        clipped: (s.overflowX === 'hidden' || s.overflowX === 'clip')
          && el.scrollWidth > el.clientWidth + 1,
        outside: root ? r.left < root.left - 1 || r.right > root.right + 1 : false,
      };
    }));
    expect(readings.length, `${what} had nothing to measure`).toBeGreaterThan(0);
    for (const seen of readings) {
      expect(seen.ellipsis, `${what} traded "${seen.text}" for an ellipsis`).toBe(false);
      expect(seen.clipped, `${what} hid part of "${seen.text}"`).toBe(false);
      expect(seen.outside, `${what} put "${seen.text}" beyond its surface`).toBe(false);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth
      - document.documentElement.clientWidth), `${what} widened the page`).toBeLessThanOrEqual(1);
  };
  const lines = (target) => (typeof target === 'string' ? page.locator(target) : target)
    .first().evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return new Set([...range.getClientRects()].map(r => Math.round(r.top))).size;
  });
  const verb = async (word, ready) => {
    if (await page.locator('#indexOverlay').isVisible()) await page.locator('#indexClose').click();
    await page.keyboard.press('/');
    await page.locator('#paletteInput').fill(`>${word}`);
    await expect(page.locator('.cmd-row').first()).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.locator(ready)).toBeVisible();
  };

  await showIndex(page);
  const named = page.locator('#listView .ix', { hasText: placeName });
  await expect(named).toBeVisible();
  await whole('#listView .ix-name', 'a place name on the board');
  expect(await lines(named.locator('.ix-name')), 'the long place name never exercised wrapping')
    .toBeGreaterThan(1);

  await page.locator('#sortWord').click();
  await page.locator('#sortWord').click();
  await page.locator('#sortWord').click();
  await expect(page.locator('.ix-band > span', { hasText: city.toLowerCase() })).toBeVisible();
  await whole('.ix-band > span', 'a city heading on the board');
  expect(await lines(page.locator('.ix-band > span', { hasText: city.toLowerCase() })),
    'the long board city never exercised wrapping').toBeGreaterThan(1);

  await named.click();
  await expect(page.locator('#plate')).toBeVisible();
  await whole('.plate-tag-current', 'the selected tags on a place');
  expect(await lines('.plate-tag-current'), 'the long selected tags never exercised wrapping')
    .toBeGreaterThan(1);
  await page.keyboard.press('Escape');

  if (await page.locator('#indexOverlay').isVisible()) await page.locator('#indexClose').click();
  await page.keyboard.press('/');
  await page.locator('#paletteInput').fill(city.slice(0, 14));
  await expect(page.locator('.cmd-row .row-name.city')).toBeVisible();
  await whole('.cmd-row .row-name', 'a command result');
  expect(await lines('.cmd-row .row-name.city'), 'the long city result never exercised wrapping')
    .toBeGreaterThan(1);
  await page.keyboard.press('Escape');

  await verb('contacts', '#contactsOverlay');
  await whole('.corr-summary-name', 'a contact name');
  expect(await lines('.corr-summary-name'), 'the long contact name never exercised wrapping')
    .toBeGreaterThan(1);
  await page.locator('#contactsOverlay .poster-x').click();

  await verb('folio', '#folioOverlay');
  await page.locator('#folNew').click();
  await expect(page.locator('.fol-band .fb-city', { hasText: city })).toBeVisible();
  await whole('.fol-band .fb-city', 'a city heading in a list');
  expect(await lines('.fol-band .fb-city'), 'the long list city never exercised wrapping')
    .toBeGreaterThan(1);
  await whole('.fol-row .nm', 'a place name in a list');
  await whole('.fol-row .sub', 'a place location in a list');

  const report = await page.evaluate(async (payload) => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const { makeFolioUrl } = await import(`/js/share.js${v}`);
    return makeFolioUrl(payload);
  }, {
    title: `${placeName}: ${city}`,
    dedication: 'Every word of this deliberately long note must remain readable on a folded screen.',
    author: contactName,
    tags,
    places: [record('sent', placeName, 45.8)],
  });
  await arrive(page, report);
  await expect(page.locator('#reportOverlay')).toBeVisible({ timeout: 20000 });
  for (const [w, h] of [[280, 653], [653, 280]]) {
    await page.setViewportSize({ width: w, height: h });
    await whole('.rp-name', `a list title on arrival at ${w}x${h}`);
    await whole('.rp-eyebrow', `the sender on arrival at ${w}x${h}`);
    await whole('.rp-pick .nm', `a place name on arrival at ${w}x${h}`);
    await whole('.rp-pick .why', `a place location on arrival at ${w}x${h}`);
    const reached = await page.locator('#reportOverlay').evaluate((root) => {
      root.scrollTop = 0;
      const close = root.querySelector('.rp-x').getBoundingClientRect();
      root.scrollTop = root.scrollHeight;
      const last = root.querySelector('.rp-folio-foot').getBoundingClientRect();
      const box = root.getBoundingClientRect();
      return {
        closeTop: close.top, top: box.top, lastBottom: last.bottom, bottom: box.bottom,
        reached: root.scrollTop + root.clientHeight >= root.scrollHeight - 1,
        sideways: root.scrollWidth - root.clientWidth,
      };
    });
    expect(reached.closeTop, `arrival close began above ${w}x${h}`)
      .toBeGreaterThanOrEqual(reached.top - 1);
    expect(reached.reached, `arrival would not scroll to its end at ${w}x${h}`).toBe(true);
    expect(reached.lastBottom, `arrival's final actions stayed below ${w}x${h}`)
      .toBeLessThanOrEqual(reached.bottom + 1);
    expect(reached.sideways, `arrival travelled sideways at ${w}x${h}`)
      .toBeLessThanOrEqual(1);
  }
  await page.setViewportSize({ width: 280, height: 653 });
  expect(await lines('.rp-name'), 'the long arrival title never exercised wrapping')
    .toBeGreaterThan(1);
});

// A short screen owes the same promise on the other axis. Full-screen rooms
// scroll to their last real word, while their heading and close control stay
// reachable. The threshold matters most: it is the only room shown before a
// person can reach Settings or the command line to recover from anything.
test('the first screen remains wholly reachable on short and folded displays', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const pattern of OFF) await page.route(pattern, r => r.abort());
  await cutTheWorld(page);
  await page.setViewportSize({ width: 653, height: 280 });
  await page.goto('/');
  await expect(page.locator('#intro')).toBeHidden({ timeout: 15000 });
  await expect(page.locator('#threshold')).toBeVisible();

  for (const [w, h] of [[653, 280], [280, 653]]) {
    await page.setViewportSize({ width: w, height: h });
    const seen = await page.locator('#threshold').evaluate((root) => {
      root.scrollTop = 0;
      const first = root.querySelector('#thWhat').getBoundingClientRect();
      root.scrollTop = root.scrollHeight;
      const last = root.querySelector('#thHow').getBoundingClientRect();
      const box = root.getBoundingClientRect();
      return {
        firstTop: first.top, lastBottom: last.bottom,
        top: box.top, bottom: box.bottom,
        sideways: root.scrollWidth - root.clientWidth,
        reached: root.scrollTop + root.clientHeight >= root.scrollHeight - 1,
      };
    });
    expect(seen.firstTop, `the opening sentence began above ${w}x${h}`)
      .toBeGreaterThanOrEqual(seen.top - 1);
    expect(seen.reached, `the threshold would not scroll to its end at ${w}x${h}`).toBe(true);
    expect(seen.lastBottom, `the final threshold action stayed below ${w}x${h}`)
      .toBeLessThanOrEqual(seen.bottom + 1);
    expect(seen.sideways, `the threshold travelled sideways at ${w}x${h}`)
      .toBeLessThanOrEqual(1);
  }
});

// A poster is the app's page model: nine different rooms paint into it, and a
// tenth reviewed assistant copy opens from Settings. Checking only Settings
// proves the frame and says nothing about the content each painter puts in it.
// Walk every room in both hostile proportions and require one simple contract:
// the way in and out begin on the glass, the final real element can be scrolled
// onto it, and no authored text creates a second, sideways page.
test('every room remains wholly reachable on short and folded displays', async ({ page }) => {
  await open(page, { books: 2, ways: 2, folios: 2 });

  const rooms = [
    ['census', '#statsOverlay'],
    ['club', '#clubOverlay'],
    ['you', '#settingsOverlay'],
    ['tags', '#tagsOverlay'],
    ['contacts', '#contactsOverlay'],
    ['keys', '#keysOverlay'],
    ['how', '#howOverlay'],
    ['folio', '#folioOverlay'],
    ['share', '#shareOverlay'],
  ];
  const openVerb = async (word, root) => {
    await page.keyboard.press('/');
    await page.locator('#paletteInput').fill(`>${word}`);
    await expect(page.locator('.cmd-row').first()).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.locator(root)).toBeVisible();
  };
  const reachable = async (root, name, w, h) => {
    const seen = await page.locator(root).evaluate((surface) => {
      surface.scrollTop = 0;
      const box = surface.getBoundingClientRect();
      const head = surface.querySelector('.poster-word').getBoundingClientRect();
      const close = surface.querySelector('.poster-x').getBoundingClientRect();
      const authored = [...surface.querySelectorAll(
        'button,a,input,textarea,summary,p,li,h2,h3,.sec-head,.tally,.agent-state,.fs-meta')]
        .filter((el) => {
          const r = el.getBoundingClientRect(), s = getComputedStyle(el);
          const shut = el.closest('details:not([open])');
          if (shut && !el.closest('summary')) return false;
          return r.width > 0 && r.height > 0 && s.visibility !== 'hidden'
            && s.display !== 'none' && !el.closest('.sr-only');
        });
      const last = authored.reduce((far, el) => {
        const end = el.getBoundingClientRect().bottom + surface.scrollTop;
        return !far || end > far.end ? { el, end } : far;
      }, null);
      const clipped = [...surface.querySelectorAll('*')].filter((el) => {
        if (el.closest('.sr-only') || !(el.textContent || '').trim()) return false;
        const shut = el.closest('details:not([open])');
        if (shut && !el.closest('summary')) return false;
        const r = el.getBoundingClientRect(), s = getComputedStyle(el);
        if (!r.width || !r.height || s.display === 'none' || s.visibility === 'hidden') return false;
        return (s.overflowX === 'hidden' || s.overflowX === 'clip')
          && el.scrollWidth > el.clientWidth + 1;
      }).map((el) => (el.textContent || '').trim().slice(0, 80));
      surface.scrollTop = surface.scrollHeight;
      const final = last?.el.getBoundingClientRect();
      return {
        headTop: head.top, headLeft: head.left,
        closeTop: close.top, closeRight: close.right,
        top: box.top, left: box.left, right: box.right, bottom: box.bottom,
        last: (last?.el.textContent || '').trim().slice(0, 80),
        lastBottom: final?.bottom,
        reached: surface.scrollTop + surface.clientHeight >= surface.scrollHeight - 1,
        sideways: surface.scrollWidth - surface.clientWidth,
        pageSideways: document.documentElement.scrollWidth
          - document.documentElement.clientWidth,
        clipped,
      };
    });
    expect(seen.headTop, `${name} began above ${w}x${h}`).toBeGreaterThanOrEqual(seen.top - 1);
    expect(seen.headLeft, `${name}'s heading began beyond ${w}x${h}`).toBeGreaterThanOrEqual(seen.left - 1);
    expect(seen.closeTop, `${name}'s close began above ${w}x${h}`).toBeGreaterThanOrEqual(seen.top - 1);
    expect(seen.closeRight, `${name}'s close ended beyond ${w}x${h}`).toBeLessThanOrEqual(seen.right + 1);
    expect(seen.reached, `${name} would not scroll to its end at ${w}x${h}`).toBe(true);
    expect(seen.lastBottom, `${name}'s last element "${seen.last}" stayed below ${w}x${h}`)
      .toBeLessThanOrEqual(seen.bottom + 1);
    expect(seen.sideways, `${name} travelled sideways at ${w}x${h}`).toBeLessThanOrEqual(1);
    expect(seen.pageSideways, `${name} widened the document at ${w}x${h}`).toBeLessThanOrEqual(1);
    expect(seen.clipped, `${name} clipped: ${seen.clipped.join(' | ')}`).toEqual([]);
  };

  for (const [w, h] of [[653, 280], [280, 653]]) {
    await page.setViewportSize({ width: w, height: h });
    for (const [word, root] of rooms) {
      await openVerb(word, root);
      await reachable(root, word, w, h);
      await page.locator(`${root} .poster-x`).click();
      await expect(page.locator(root)).toBeHidden();
    }

    // This room has no command of its own: the reviewed-copy word in Settings
    // is its only person-facing door, so reach it by that same road.
    await openVerb('you', '#settingsOverlay');
    await page.locator('#assistantSettings > summary').click();
    await page.locator('#agentCopyFallback').click();
    await expect(page.locator('#agentOverlay')).toBeVisible();
    await reachable('#agentOverlay', 'assistant copy', w, h);
    await page.locator('#agentOverlay .poster-x').click();
    await page.locator('#settingsOverlay .poster-x').click();
  }
});

// These are not separate static artefacts in practice: every policy and data
// contract linked from the app is set through one responsive reader. Exercise
// the actual documents, including the long byte layouts in the specification.
// Those layouts keep an explicit inner scroller; the page itself never grows a
// hidden horizontal continuation and its final imprint remains reachable.
test('every published reading stays whole on short and folded displays', async ({ page }) => {
  const documents = ['spec', 'threats', 'method', 'security', 'assistant', 'terms', 'privacy', 'support'];
  for (const name of documents) {
    await page.goto(`/read.html?d=${name}`);
    await expect(page.locator('#readBody')).not.toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('#readBody h1')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);

    for (const [w, h] of [[653, 280], [280, 653]]) {
      await page.setViewportSize({ width: w, height: h });
      const seen = await page.evaluate(() => {
        const surface = document.body;
        surface.scrollTop = 0;
        const first = document.querySelector('.read-back').getBoundingClientRect();
        const clipped = [...document.querySelectorAll('.read-body *,.read-foot')]
          .filter((el) => !el.closest('pre') && (el.textContent || '').trim())
          .filter((el) => {
            const r = el.getBoundingClientRect(), s = getComputedStyle(el);
            return r.width && r.height && s.display !== 'none' && s.visibility !== 'hidden'
              && (s.overflowX === 'hidden' || s.overflowX === 'clip')
              && el.scrollWidth > el.clientWidth + 1;
          }).map((el) => (el.textContent || '').trim().slice(0, 80));
        const code = [...document.querySelectorAll('.read-body pre')].map((pre) => {
          pre.scrollLeft = pre.scrollWidth;
          return {
            overflow: getComputedStyle(pre).overflowX,
            reached: pre.scrollLeft + pre.clientWidth >= pre.scrollWidth - 1,
          };
        });
        surface.scrollTop = surface.scrollHeight;
        const foot = document.querySelector('.read-foot').getBoundingClientRect();
        return {
          firstTop: first.top,
          firstWidth: first.width,
          firstHeight: first.height,
          footBottom: foot.bottom,
          reached: surface.scrollTop + surface.clientHeight >= surface.scrollHeight - 1,
          sideways: surface.scrollWidth - surface.clientWidth,
          rootSideways: document.documentElement.scrollWidth
            - document.documentElement.clientWidth,
          clipped, code,
        };
      });
      expect(seen.firstTop, `${name} began above ${w}x${h}`).toBeGreaterThanOrEqual(-1);
      expect(seen.firstWidth, `${name}'s back control is too narrow to tap`).toBeGreaterThanOrEqual(44);
      expect(seen.firstHeight, `${name}'s back control is too short to tap`).toBeGreaterThanOrEqual(44);
      expect(seen.reached, `${name} would not scroll to its end at ${w}x${h}`).toBe(true);
      expect(seen.footBottom, `${name}'s footer stayed below ${w}x${h}`).toBeLessThanOrEqual(h + 1);
      expect(seen.sideways, `${name} travelled sideways at ${w}x${h}`).toBeLessThanOrEqual(1);
      expect(seen.rootSideways, `${name} widened the document at ${w}x${h}`).toBeLessThanOrEqual(1);
      expect(seen.clipped, `${name} clipped: ${seen.clipped.join(' | ')}`).toEqual([]);
      for (const pre of seen.code) {
        expect(pre.overflow, `${name} hid a byte layout without a scroller`).toBe('auto');
        expect(pre.reached, `${name} could not scroll a byte layout to its end`).toBe(true);
      }
    }
  }
});
