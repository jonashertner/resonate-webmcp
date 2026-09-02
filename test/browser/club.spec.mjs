// club.spec.mjs — the paid tier, driven in a real browser for the first time.
//
// The club has fifty-odd node tests and, until this file, not one that ever
// pressed a button. Everything a member actually does happens in a page: the
// join is begun and paid for and comes home as a key, a phrase is typed into a
// field, Argon2id runs at 64 MiB in three different engines, and a backup comes
// home into a store that has just been emptied. None of that is reachable from
// node.
//
// It runs against club/mock.mjs on 5179, which speaks the same protocol as the
// worker: the payment desk makes its own sessions, a pretended checkout page
// marks one paid and sends the browser home, and the vault is kept in the same
// two parts, pointers and immutable ciphertext. It also has two levers the real
// club does not have, for the failures a browser cannot cause by itself:
// `POST /lapse` ends a membership, and `POST /die?at=…` stops the next seal at
// a named moment.
import { test, expect, request as playwrightRequest } from '@playwright/test';
import { orNotYet } from './navsafe.mjs';
import { front } from './frames.mjs';

// Forty-five seconds is the suite's cap, and this file spends its whole life
// writing budgets it is not allowed to spend.
//
// Fifteen tests in here name sixty thousand milliseconds on a single wait,
// because a seal is Argon2id at 64 MiB over three passes and whoever wrote
// them meant it: a backup may honestly take a minute. The config caps a test at
// forty-five seconds. So not one of those fifteen budgets was ever reachable. A
// wait that ran long died at the ceiling with `Test timeout of 45000ms
// exceeded`, and the sentence written beside it further down, `the answer was
// lost and so was the seal`, could never print. Three CI runs have died that
// way on two different tests, and not once was the suite able to say what
// broke.
//
// The cap is not being raised to cover a hang. On the run that failed on 22
// August the same test had passed on firefox in 11.2 seconds a few minutes
// earlier, and the heaviest test in the file, the sealed folio on webkit,
// passed at 40.7 with four seconds to spare. The tail here is twenty-eight to
// forty-one seconds against a forty-five second ceiling, and which test lands
// closest to it depends on nothing more than what else the runner is doing that
// morning.
//
// `test.slow()` has been the answer so far, added to whichever test failed
// last. It reads as a fix and behaves as a lottery, and the numbers say so: the
// seven tests carrying it mostly declare twenty or thirty seconds, while the
// fifteen that declare sixty are the ones still running against forty-five. A
// mark that lands on the victim rather than on the cost will keep finding a new
// victim. Ninety seconds grants every budget written below, whichever test is
// unlucky. The slow marks stay where they are: they say which tests are twice
// the size of their neighbours, which is a different fact and still a true one.
test.describe.configure({ timeout: 90_000 });

const MOCK = 'http://localhost:5179';
const OFF = ['**://*.cartocdn.com/**', '**://*.openstreetmap.org/**', '**://tile.**',
  '**://photon.komoot.io/**'];

// The club this suite may never reach.
//
// It was written while CLUB_URL was still empty, against the day it would not
// be. That day is 17 August 2026: `clubBase()` falls back to the shipped
// address whenever a page's settings have no clubUrl of their own, the policy
// names it, and every fixture in this file that forgets to set one would be
// pointed at a club real people pay for. This is now load-bearing rather than
// precautionary, and it is why it was written before it was needed.
async function onlyTheMock(page) {
  await page.addInitScript(() => {
    const real = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const href = typeof input === 'string' ? input : input?.url;
      let u = null;
      try { u = new URL(href, location.href); } catch { /* not a url we can read */ }
      if (u && /^https?:/.test(u.protocol) && u.host !== 'localhost:5179' && u.host !== location.host) {
        return Promise.reject(new TypeError(`this suite may not reach ${u.host}`));
      }
      return real(input, init);
    };
  });
}

async function open(page, { url = '/', places = 2, club = MOCK, who = 'ada' } = {}) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const pattern of OFF) await page.route(pattern, r => r.abort());
  await onlyTheMock(page);
  // Seed once, not on every navigation.
  //
  // An init script runs again on every reload, and these tests reload on
  // purpose: a club key written by the door, or an atlas emptied to prove a
  // backup comes home, would be wiped by the seeding and the test would be
  // measuring the fixture. So it seeds an empty browser and then keeps quiet.
  await page.addInitScript(({ n: count, mock, who }) => {
    if (localStorage.getItem('resonate.settings.v1')) return;
    const now = new Date().toISOString();
    localStorage.setItem('resonate.places.v1', JSON.stringify(
      Array.from({ length: count }, (_, i) => ({
        id: 'p' + i, name: 'Place ' + i, lat: 46 + i * 0.01, lng: 8 + i * 0.01,
        city: 'Basel', country: 'Switzerland', tags: [], status: 'wishlist',
        note: '', createdAt: now, updatedAt: now,
      }))));
    localStorage.setItem('resonate.tags.v1', '[]');
    localStorage.setItem('resonate.settings.v1', JSON.stringify({
      theme: 'auto', chosen: true, seeded: true, introSeen: true,
      authorName: who, hue: 300, clubUrl: mock,
    }));
  }, { n: places, mock: club, who });
  await front(page);
  await page.goto(url);
  await expect(page.locator('#intro')).toBeHidden({ timeout: 15000 });
  await expect(page.locator('body')).toHaveAttribute('data-entry', /board|field|letter|threshold/, { timeout: 15000 });
}

const keyOf = (page) => page.evaluate(() =>
  JSON.parse(localStorage.getItem('resonate.settings.v1') || '{}').clubKey || '');

// The same read, for the polls that run while the browser is still moving.
// A key is what they wait for, so a lost read answers '' and the poll simply
// asks again; a poll waiting for '' must keep using `keyOf` and does. The
// reasoning, and the CI failure that bought it, are in navsafe.mjs.
const keyWhenReadable = (page) => orNotYet(keyOf(page), '');

async function openTheClubRoom(page) {
  await front(page);
  // the door leaves the room open behind it, and the command line does not
  // answer while a surface is up: a helper that pressed slash anyway would
  // hang on the very path that works
  if (await page.locator('#clubOverlay').isVisible()) return;
  if (!(await page.locator('#indexOverlay').isHidden())) await page.locator('#indexClose').click();
  await page.keyboard.press('/');
  await page.locator('#paletteInput').fill('>club');
  await expect(page.locator('.cmd-row').first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('#clubOverlay')).toBeVisible();
}

const joinsOf = (page) => page.evaluate(() =>
  JSON.parse(localStorage.getItem('resonate.club.join.v1') || '[]'));

// Forget the key without racing the app for it.
//
// Deleting clubKey from localStorage while the page is still running is a
// read-modify-write against a live store. The app holds settings in memory and
// `saveSettings()` writes the whole object, so any save landing after the
// delete puts the key straight back; and `joinWith` returns the moment its poll
// sees the key written at js/app.js:6300, while the lines after it are still
// running. Lose that race and js/app.js:6296 sees a key, never asks the door,
// and opens the room in silence: no toast, and a test waiting for one waits
// twenty seconds for nothing. Firefox lost it under full-suite load while
// passing alone, which is the shape of every load-dependent ordering bug.
//
// An init script instead runs at the boot of the next navigation, where the
// previous page's store no longer exists and there is nothing left to overwrite
// it. The strip is one-shot so that a later reload in the same page still
// behaves like an ordinary returning device.
async function forgetKeyOnNextLoad(page) {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('spec.forgotKey')) return;
    sessionStorage.setItem('spec.forgotKey', '1');
    const raw = localStorage.getItem('resonate.settings.v1');
    if (!raw) return;
    const s = JSON.parse(raw);
    delete s.clubKey;
    localStorage.setItem('resonate.settings.v1', JSON.stringify(s));
  });
}

// The whole join, pressed rather than pretended.
//
// This used to walk in from an address bar carrying a session id somebody had
// invented, which tested the second half of a flow whose first half did not
// exist. Now the button asks the club for a session, the club makes one and
// writes this device's commitment onto it, a pretended checkout page marks it
// paid and sends the browser home, and the door hands over a key. The page is
// expected to be open already.
async function joinWith(page) {
  await front(page);
  await openTheClubRoom(page);
  await page.locator('#clubJoin').click();
  await expect(page.locator('#clubOverlay')).toBeVisible({ timeout: 30000 });
  // the value the poll accepted is the value returned: reading a second time
  // is a second chance to lose the same race, for nothing
  let key = '';
  await expect.poll(async () => (key = await keyWhenReadable(page)), { timeout: 30000 }).toMatch(/^tc_/);
  return key;
}

// A reload waits for the same word the boot writes when it stops deciding.
// Waiting only for the film to end leaves the board still rising, and a press
// aimed at the corner closes it instead of opening it: the flake class the
// atlas suite already learned the hard way.
async function revisit(page) {
  await front(page);
  await page.reload();
  await expect(page.locator('#intro')).toBeHidden({ timeout: 15000 });
  await expect(page.locator('body')).toHaveAttribute('data-entry', /board|field|letter/, { timeout: 15000 });
}

const PHRASE = 'seven brown horses at the gate';

async function sealIt(page, phrase = PHRASE) {
  await front(page);
  // The room paints before the club has said what it is holding, and the seal
  // is dead until it has. So the settled room is waited for rather than raced.
  //
  // This helper used to read the second field's visibility while the answer
  // was still in the air, and on two runs in seventy-five the answer landed in
  // between: the field it had just been told was visible was taken away, and
  // the fill waited out the whole test for an element that was never coming
  // back. Both failures were the same picture, and neither was about sealing.
  await expect(page.locator('#clubSync')).toBeEnabled({ timeout: 30000 });
  await page.locator('#clubPhrase').fill(phrase);
  // Before the first backup exists the room asks for the phrase twice: nobody
  // stores it, so a typo in the seal that fixes it is not a wrong password but
  // a backup that opens for a string its owner never knew they typed. Once a
  // backup exists the second field is taken away, and this fills what is there.
  if (await page.locator('#clubPhrase2Row').isVisible()) {
    await page.locator('#clubPhrase2').fill(phrase);
  }
  await page.locator('#clubSync').click();
}

// ---------- the door ----------

test('the whole join, pressed: a session is made, paid, and becomes a key here',
  async ({ page }) => {
    await open(page);
    const key = await joinWith(page);
    expect(key).toMatch(/^tc_[0-9abcdefghjkmnpqrstvwxyz]{20,27}$/);
    await expect(page.locator('#clubBody')).toContainText(key);
    // the session is gone from the address: a checkout id in a history entry is
    // a credential lying about in a place people paste from
    await expect(page).toHaveURL(/localhost:5178\/$/);
    // and the secret that opened it was minted before the payment, written
    // down beside the session it began, and never sent
    const [join] = await joinsOf(page);
    expect(join.secret).toMatch(/^[0-9a-f]{32}$/);
    expect(join.session).toMatch(/^cs_mock/);
  });

test('the key comes back to the device that paid, and to nobody else', async ({ page, browser }) => {
  await open(page);
  const key = await joinWith(page);
  const [{ session }] = await joinsOf(page);

  // the answer was lost, and the same device asks again with the same secret
  await forgetKeyOnNextLoad(page);
  await page.goto(`/?club=${session}`);
  await expect.poll(() => keyWhenReadable(page), { timeout: 20000 }).toBe(key);

  // Another member, with a membership of their own and secrets of their own,
  // holding this session id. It is in a browser history, a receipt, a support
  // thread; it is not a credential, and the commitment is why.
  const other = await browser.newContext();
  const theirs = await other.newPage();
  await open(theirs);
  await joinWith(theirs);
  await forgetKeyOnNextLoad(theirs);
  await theirs.goto(`/?club=${session}`);
  // the key really is gone before the toast is judged. if the strip ever loses
  // its race again the failure lands here, naming the key it found, instead of
  // twenty seconds later on an empty toast that reads like the club said
  // nothing when in truth it was never asked
  await expect.poll(() => keyOf(theirs), { timeout: 20000 }).toBe('');
  await expect(theirs.locator('#toast')).toContainText('another device', { timeout: 20000 });
  expect(await keyOf(theirs)).toBe('');
  await other.close();
});

test('a device that began no membership does not trouble the club about one', async ({ page }) => {
  await open(page, { url: '/?club=cs_mockneverbegunhere' });
  await expect(page.locator('#toast')).toContainText('did not begin', { timeout: 20000 });
  expect(await keyOf(page)).toBe('');
  await expect(page).toHaveURL(/localhost:5178\/$/);
});

test('a payment abandoned leaves the room open and nothing else', async ({ page }) => {
  await open(page);
  await openTheClubRoom(page);

  // The session is begun without pressing the button, because the button
  // navigates to a checkout page that always pays: a test that pressed it and
  // then raced to the cancel url would be measuring which of the two won, and
  // under load it is the payment. This is exactly what an abandoned checkout
  // leaves behind: a secret, a session, and no money.
  await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const { makeClient } = await import(`/js/club.js${v}`);
    await makeClient('http://localhost:5179', () => '').checkout();
  });
  expect((await joinsOf(page)).length).toBeGreaterThan(0);

  // the cancel url, which is where Stripe sends a member who changes their mind
  await page.goto('/?club=none');
  await expect(page.locator('#clubOverlay')).toBeVisible({ timeout: 20000 });
  expect(await keyOf(page)).toBe('');
  await expect(page).toHaveURL(/localhost:5178\/$/);
  await expect(page.locator('#clubJoin')).toBeVisible();
});

// ---------- what reaches the club ----------

test('the wire carries no place name: what leaves this device is sealed', async ({ page, playwright }) => {
  await open(page, { places: 3 });
  const key = await joinWith(page);
  await openTheClubRoom(page);
  await sealIt(page);
  await expect(page.locator('#toast')).toContainText('backed up', { timeout: 60000 });

  // read the bytes from the test process rather than from the page. page.route
  // does not see a fetch made under a service worker in webkit, and this app
  // registers one on every visit, so an assertion made in the browser would
  // quietly stop holding on one engine of three.
  const api = await playwrightRequest.newContext();
  const got = await api.get(`${MOCK}/vault`, { headers: { authorization: `Bearer ${key}` } });
  expect(got.status()).toBe(200);
  const buf = Buffer.from(await got.body());
  expect(buf.subarray(0, 5).toString('latin1')).toBe('rsnt2');
  expect(buf.includes(Buffer.from('Place 0')), 'a place name went out in the clear').toBe(false);
  expect(buf.includes(Buffer.from('Basel')), 'a city went out in the clear').toBe(false);
  expect(buf.includes(Buffer.from(PHRASE)), 'the phrase itself went out').toBe(false);
  await api.dispose();
});

test('a card is not offered to a desk that disagrees about what it charges', async ({ page }) => {
  // The one thing in this club that can cost somebody money they were told
  // they would not spend.
  //
  // `TESTING` in js/club.js is a claim the app makes about a machine it never
  // asked. It tells a person, in the moment before they type a card, that no
  // money changes hands, and that sentence is true only if the Stripe secret
  // set on the worker by hand is a test key. One of those facts is in git,
  // read by this suite and by the smoke walk; the other is in
  // `wrangler secret put`, where none of the three can see it.
  //
  // And the check that already exists protects the configuration rather than
  // the customer. `admits` refuses a test session against a live desk, so the
  // person who obeys the app and types a test card is turned away and knows
  // something is wrong. The person who types a real card produces a live
  // session, which passes every check there is, and is charged for a year.
  const api = await playwrightRequest.newContext();
  await api.post(`${MOCK}/desk?live=1`);
  try {
    await open(page);
    await openTheClubRoom(page);
    await expect(page.locator('#clubDesk'),
      'the room did not say the desk contradicts it').toContainText('taking real money');
    await expect(page.locator('#clubJoinSec'),
      'a card was asked for by a desk that says it charges, under a build that says it does not')
      .toHaveCount(0);
    await expect(page.locator('#clubBody'),
      'the promise was made anyway, over a desk that had just denied it')
      .not.toContainText('No money changes hands');
    // The price goes with the word. A sum standing beside a desk that may not
    // be charging it is the same untruth one sentence smaller.
    await expect(page.locator('#clubBody')).not.toContainText('a year.');
    // What stays is the road that asks nobody for a card: a key you already
    // hold costs nothing to paste.
    await expect(page.locator('#clubKeyIn'),
      'a member holding a key was locked out of their own room by a deploy mistake')
      .toBeVisible();

    // And the same room, with the desk telling the truth, offers the card. Both
    // halves are needed: a test that only watched the door shut would pass over
    // a room that never opened it.
    await api.post(`${MOCK}/desk?live=0`);
    await page.keyboard.press('Escape');
    await expect(page.locator('#clubOverlay')).toBeHidden();
    await openTheClubRoom(page);
    await expect(page.locator('#clubJoin')).toBeEnabled();
    await expect(page.locator('#clubDesk')).toContainText('No money changes hands');
  } finally {
    await api.post(`${MOCK}/desk?live=0`);
    await api.dispose();
  }
});

test('a desk that will not say what it is gets no card either', async ({ page }) => {
  // Silence is not agreement, and this is the case that decides it. An address
  // that answers nothing to this question is an older worker, or the wrong
  // worker, or one that is down, and none of the three is a machine to hand a
  // card to. The app is pointed here at something that is not a club at all,
  // which is what a stale deploy looks like from the browser.
  await open(page, { club: 'http://localhost:5178' });
  await openTheClubRoom(page);
  await expect(page.locator('#clubDesk')).toContainText('Payment status unavailable');
  await expect(page.locator('#clubDesk')).toContainText('will not ask for a card until the club confirms');
  await expect(page.locator('#clubJoinSec'),
    'a card was offered to an address that never said whether it charges').toHaveCount(0);
  await expect(page.locator('#clubBody')).not.toContainText('No money changes hands');
});

// ---------- the room does not act on a guess ----------
//
// Whether this is the first backup is a question the club answers, and the
// room is painted before the answer arrives. It used to paint a guess taken
// from the sequence number this device happens to carry, and to let that guess
// decide whether the phrase had to be read twice.
//
// The guess is wrong in both directions and one of them is severe. A device
// carrying a sequence of three, opening after ANOTHER device burned both
// backups, believes it has sealed before: the second field is painted away and
// the first backup of a fresh vault is sealed under a phrase read once. A typo
// there is a backup that nobody, including us, can ever open, and nothing on
// the surface would have said so.
//
// The club is asked to answer slowly here, because the gap is a few
// milliseconds on an idle machine and a test that waits for a coincidence is
// not a test.

async function slowClub(ms) {
  const api = await playwrightRequest.newContext();
  await api.post(`${MOCK}/slow?ms=${ms}`);
  await api.dispose();
}

test('the seal is dead until the club has said what it is holding', async ({ page }) => {
  await open(page, { places: 2 });
  await joinWith(page);
  try {
    await slowClub(2500);
    await revisit(page);
    await openTheClubRoom(page);
    // painted, and refusing to be pressed: the room does not yet know what
    // this button means
    await expect(page.locator('#clubSync'),
      'the seal could be pressed before the club had answered').toBeDisabled();
    const muted = await page.locator('#clubSync').evaluate((el) => {
      const s = getComputedStyle(el);
      return { color: s.color, border: s.borderBottomColor, cursor: s.cursor };
    });
    expect(muted.cursor, 'a disabled action still wore an actionable pointer').toBe('not-allowed');
    await expect(page.locator('#clubPhrase2Row'),
      'the second field was painted from a guess').toBeHidden();
    // and the answer, when it comes, is what opens it
    await expect(page.locator('#clubSync')).toBeEnabled({ timeout: 30000 });
    const ready = await page.locator('#clubSync').evaluate((el) => {
      const s = getComputedStyle(el);
      return { color: s.color, border: s.borderBottomColor };
    });
    expect(muted.color, 'disabled and ready actions use the same ink').not.toBe(ready.color);
    expect(muted.border, 'disabled and ready actions use the same underline').not.toBe(ready.border);
    await expect(page.locator('#clubPhrase2Row'),
      'the club holds nothing, so the phrase must be read twice').toBeVisible();
  } finally {
    await slowClub(0);
  }
});

test('a seal pressed on a wrong count waits to be told, and is not a first seal read once',
  async ({ page, playwright }) => {
    // The severe direction, and the reason the room has two guards rather than
    // one. This device has sealed, so it carries a sequence. The backups are
    // then burned from elsewhere, which is a thing the room offers and another
    // device does not hear about. What the club now holds is nothing, so the
    // next seal here is a first seal, and a first seal is the one that must be
    // read twice: nobody stores the phrase, and a typo in it is not a wrong
    // password but a backup that opens for a string its owner never knew they
    // typed.
    //
    // The button is dead until the answer lands, which stops a hand. This
    // presses past it on purpose, the way any later caller of the same
    // function would, to state the other guard: what decides how many phrases
    // to demand is the club's answer and never the device's count.
    await open(page, { places: 2 });
    const key = await joinWith(page);
    await openTheClubRoom(page);
    await sealIt(page);
    await expect(page.locator('#toast')).toContainText('backed up', { timeout: 60000 });
    expect(await page.evaluate(() =>
      Number(JSON.parse(localStorage.getItem('resonate.settings.v1')).clubSeq)))
      .toBeGreaterThan(0);

    const api = await playwright.request.newContext();
    await api.delete(`${MOCK}/vault`, { headers: { authorization: `Bearer ${key}` } });

    try {
      await slowClub(2500);
      await revisit(page);
      await openTheClubRoom(page);
      await expect(page.locator('#clubSync'),
        'a device with a sequence offered its seal before the club had answered')
        .toBeDisabled();

      // pressed inside the window, with one phrase typed and nothing in the
      // field the room has not yet admitted it needs
      await page.locator('#clubPhrase').fill(PHRASE);
      await page.evaluate(() => { document.querySelector('#clubSync').disabled = false; });
      await page.locator('#clubSync').click();

      await expect(page.locator('#toast'),
        'the first backup of a fresh vault was sealed under a phrase read once')
        .toContainText('the two phrases do not match', { timeout: 30000 });
      await expect(page.locator('#clubPhrase2Row'),
        'the room never admitted the phrase had to be read twice').toBeVisible();

      // and the club is still holding nothing, which is the whole claim
      const got = await api.get(`${MOCK}/vault`, { headers: { authorization: `Bearer ${key}` } });
      expect(got.status(), 'something was sealed while the room was still guessing').toBe(404);
    } finally {
      await slowClub(0);
      await api.dispose();
    }
  });

// ---------- the identity, which is the one thing that may only travel sealed ----------

// A private key, a box address and one correspondent, written the way the app
// writes them. It goes in through localStorage rather than through a surface
// because there is no surface yet: this gate builds the road and the next one
// puts a door on it, and the claim being made here is about the envelope.
const SENTINEL = {
  v: 1,
  jwk: { kty: 'EC', crv: 'P-256',
    x: 'SentinelPublicXhalf00000000000000000000000000',
    y: 'SentinelPublicYhalf00000000000000000000000000',
    d: 'SentinelPrivateHalf00000000000000000000000000' },
  pub: 'B' + 'A'.repeat(86),
  route: '9c7k2m4n6p8q0r2s4t6v8w0x2y',
  pairs: [{
    id: 'k1', name: 'Sentinel Correspondent', pub: 'B' + 'C'.repeat(86),
    cap: 'a1b3c5d7e9f0g2h4j5k6m7n8p9.00001111222233334444555566',
    // twenty characters and `v: 2`, which is a mark read aloud under the
    // arithmetic this build computes. PAIRING_VERSION is not imported here on
    // purpose: a fixture that moves with the constant it is testing against
    // stops being able to say the constant moved.
    capId: 'cap00001', state: 'verified', mark: '9c7k 2m4n 6p8q 0r2s 4t6v',
    v: 2, at: '2026-08-16', cid: '',
  }],
};

// The same device, one build ago: a mark read aloud when eight characters were
// the whole of it, and no field on the row saying which arithmetic that was.
// The absence is the fixture. Every pairing verified before the mark was
// widened looks exactly like this.
const READ_AT_FORTY_BITS = {
  ...SENTINEL,
  pairs: [{ ...SENTINEL.pairs[0], mark: '9c7k 2m4n', v: undefined }],
};

const lettersOf = (page) => page.evaluate(() =>
  JSON.parse(localStorage.getItem('resonate.letters.v1') || 'null'));

test('an identity comes home from the club, and from nowhere else', async ({ page }) => {
  // The severe restore. Identity is the membership rather than the device, so
  // a person who loses their phone has to be able to become the same person on
  // the next one: their friends verified a mark against this key, and a device
  // that minted a fresh one would be a stranger wearing a familiar name.
  //
  // The price is that a private key travels, and the whole of the mitigation
  // is that it travels only inside something sealed under a phrase nobody
  // stores. So this test makes both halves of that claim.
  await open(page, { places: 2 });
  await joinWith(page);
  await page.evaluate((l) => localStorage.setItem('resonate.letters.v1', JSON.stringify(l)), SENTINEL);
  await revisit(page);
  await openTheClubRoom(page);
  await sealIt(page);
  await expect(page.locator('#toast')).toContainText('backed up', { timeout: 60000 });

  // the browser is emptied the way a wiped phone empties it, and the key and
  // the phrase are the only things carried across. the identity is not: that
  // is the point of the test.
  const key = await keyOf(page);
  await page.evaluate((k) => {
    localStorage.removeItem('resonate.places.v1');
    localStorage.removeItem('resonate.letters.v1');
    const s = JSON.parse(localStorage.getItem('resonate.settings.v1'));
    s.clubKey = k;
    s.clubSeq = 0;
    localStorage.setItem('resonate.settings.v1', JSON.stringify(s));
  }, key);
  await revisit(page);
  expect(await lettersOf(page), 'the device was not actually emptied').toBe(null);

  await openTheClubRoom(page);
  await sealIt(page);
  await expect(page.locator('#toast')).toContainText('write to your correspondents again',
    { timeout: 60000 });

  const back = await lettersOf(page);
  expect(back.jwk.d, 'the private key did not come home, so this is a new person')
    .toBe(SENTINEL.jwk.d);
  expect(back.pub).toBe(SENTINEL.pub);
  expect(back.pairs.length).toBe(1);
  expect(back.pairs[0].state, 'a mark somebody read aloud came back downgraded').toBe('verified');
  expect(back.pairs[0].cap).toBe(SENTINEL.pairs[0].cap);
});

test('a mark read under an older arithmetic is not offered as one that was read', async ({ page }) => {
  // The mark went from forty bits to ninety-six, and the reason it could is
  // that an old reading stops counting. Nobody's telephone call gets longer
  // retroactively: eight characters read aloud in a build where eight
  // characters were the whole mark are worth forty bits forever.
  //
  // So this is the pairing every verified member is holding on the morning of
  // that change, and what the room owes them is the words again.
  await open(page, { places: 2 });
  await page.evaluate((l) => localStorage.setItem('resonate.letters.v1', JSON.stringify(l)),
    READ_AT_FORTY_BITS);
  await revisit(page);
  await openLetters(page);

  const said = page.locator('.pair-said');
  await expect(said, 'a mark of a retired arithmetic was still being called verified')
    .toContainText('verification needed');
  await expect(said, 'the room offered eight characters of a hash it no longer computes')
    .not.toContainText('9c7k 2m4n');
  await expect(page.locator('[data-mark]'),
    'the pairing was sent back for the words with no way to say them').toBeVisible();
  await expect(page.locator('[data-ask]'),
    'a pairing that has not read this mark was still offered a way to send').toHaveCount(0);

  // and it is `returned` rather than `repair`: nothing moved underneath, and
  // dressing this app's own maintenance as a possible impersonation would
  // spend the loudest sentence it owns on itself
  const held = await lettersOf(page);
  expect(held.pairs[0].state).toBe('returned');
  expect(held.pairs[0].mark, 'a retired mark was left on the row to be read aloud').toBe('');
});

test('what the club is holding never says any of it in the clear', async ({ page }) => {
  // The other half. The bytes are read out of the club by the test process,
  // not by the page, because a service worker fetch is invisible to page.route
  // in webkit and a check that cannot see the wire proves nothing.
  await open(page, { places: 2 });
  const key = await joinWith(page);
  await page.evaluate((l) => localStorage.setItem('resonate.letters.v1', JSON.stringify(l)), SENTINEL);
  await revisit(page);
  await openTheClubRoom(page);
  await sealIt(page);
  await expect(page.locator('#toast')).toContainText('backed up', { timeout: 60000 });

  const api = await playwrightRequest.newContext();
  const got = await api.get(`${MOCK}/vault`, { headers: { authorization: `Bearer ${key}` } });
  const held = Buffer.from(await got.body());
  await api.dispose();
  expect(held.length).toBeGreaterThan(100);
  for (const secret of ['SentinelPrivateHalf', 'Sentinel Correspondent',
    '00001111222233334444555566', SENTINEL.pub]) {
    expect(held.includes(Buffer.from(secret)),
      `the club is holding ${secret} in the clear`).toBe(false);
  }
});

test('two identities under one membership is not a thing the app picks between', async ({ page }) => {
  // A device that minted its own key before it ever read the vault, and a
  // vault that holds another. One of the two is not the person their friends
  // verified, and there is nothing here that could tell which. Choosing
  // silently would be choosing who somebody is.
  await open(page, { places: 2 });
  await joinWith(page);
  await page.evaluate((l) => localStorage.setItem('resonate.letters.v1', JSON.stringify(l)), SENTINEL);
  await revisit(page);
  await openTheClubRoom(page);
  await sealIt(page);
  await expect(page.locator('#toast')).toContainText('backed up', { timeout: 60000 });

  const key = await keyOf(page);
  const other = {
    ...SENTINEL,
    jwk: { ...SENTINEL.jwk, d: 'AnotherPrivateHalf000000000000000000000000000' },
    pub: 'B' + 'D'.repeat(86),
    pairs: [],
  };
  await page.evaluate(({ k, l }) => {
    localStorage.setItem('resonate.letters.v1', JSON.stringify(l));
    const s = JSON.parse(localStorage.getItem('resonate.settings.v1'));
    s.clubKey = k;
    s.clubSeq = 0;
    localStorage.setItem('resonate.settings.v1', JSON.stringify(s));
  }, { k: key, l: other });
  await revisit(page);
  await openTheClubRoom(page);
  await sealIt(page);

  // the last thing said, not the first: a clash announced before the seal is a
  // clash replaced by "backed up" on whichever engine finishes Argon2id first
  await expect(page.locator('#toast'),
    'one identity quietly replaced the other').toContainText('different identities',
    { timeout: 60000 });
  await expect(page.locator('#toast')).toContainText('backed up');
  const after = await lettersOf(page);
  expect(after.jwk.d, 'the vault overwrote the identity this device was already using')
    .toBe(other.jwk.d);
  expect(after.pairs.length, 'a stranger’s correspondents were merged in').toBe(0);

  // And the other half of that sentence, which is the half a seal could quietly
  // make false. "Neither was changed" has to be true of the vault as well as of
  // this device, and the very next thing this device did was write a new
  // envelope. So the envelope goes back carrying what it was read with, and the
  // proof is a restore: what comes home is the identity the backup held, not
  // the one this device was using when it wrote it.
  await page.evaluate((k) => {
    localStorage.removeItem('resonate.letters.v1');
    const s = JSON.parse(localStorage.getItem('resonate.settings.v1'));
    s.clubKey = k;
    s.clubSeq = 0;
    localStorage.setItem('resonate.settings.v1', JSON.stringify(s));
  }, key);
  await revisit(page);
  await openTheClubRoom(page);
  await sealIt(page);
  await expect(page.locator('#toast')).toContainText('write to your correspondents again',
    { timeout: 60000 });
  const kept = await lettersOf(page);
  expect(kept.jwk.d, 'the clashing device sealed itself over the backup it refused to choose against')
    .toBe(SENTINEL.jwk.d);
  expect(kept.pairs.length, 'the backup’s correspondents were sealed away').toBe(1);
});

test('a device that cannot write does not save over a backup that can', async ({ page }) => {
  // The atlas half of the seal has always refused to write an envelope from a
  // copy it could not read whole, and says so at js/app.js. This is the same
  // refusal on the slice where the argument is sharpest.
  //
  // A store that cannot read a key seals it and refuses every write to it, so
  // the merge that brings the vault's identity home succeeds in memory and is
  // then rolled straight back. That answer used to be spelled `none`, which is
  // also the answer a backup holding nothing new gives, and the two are
  // opposite facts: one says this device is already whole, the other says it
  // has just failed to keep the only copy of something. The seal three lines
  // later read them as the same and wrote the poorer slice over the richer one.
  //
  // For places that would be a merge lost, and a file away from coming back.
  // Here there is no file. exportJSON does not name this slice, the envelope
  // before it is one save from being gone, and what would be written over is a
  // private key and the pairings two people read aloud to each other.
  await open(page, { places: 2 });
  await joinWith(page);
  await page.evaluate((l) => localStorage.setItem('resonate.letters.v1', JSON.stringify(l)), SENTINEL);
  await revisit(page);
  await openTheClubRoom(page);
  await sealIt(page);
  await expect(page.locator('#toast')).toContainText('backed up', { timeout: 60000 });

  // Now damage this device's own copy, so the store seals the key on the next
  // boot and will not write to it, and send the device back to the vault as one
  // that holds nothing. This is the shape of a browser that half survived
  // something, not of a wiped phone: every other key still writes.
  const key = await keyOf(page);
  await page.evaluate((k) => {
    localStorage.setItem('resonate.letters.v1', '{not json');
    const s = JSON.parse(localStorage.getItem('resonate.settings.v1'));
    s.clubKey = k;
    s.clubSeq = 0;
    localStorage.setItem('resonate.settings.v1', JSON.stringify(s));
  }, key);
  await revisit(page);
  // the boot says what will not read, and names it in words rather than in a
  // storage key; the person leaves it and goes to back up, which is the whole
  // of this test
  await expect(page.locator('#askWhat')).toContainText('your letters', { timeout: 15000 });
  await page.locator('#askNo').click();

  await openTheClubRoom(page);
  await sealIt(page);
  await expect(page.locator('#toast'),
    'a device that could not keep the backup wrote a new one over it anyway')
    .toContainText('left unchanged', { timeout: 60000 });
  await expect(page.locator('#toast')).not.toContainText('backed up');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('resonate.settings.v1')).clubSeq),
    'the refused device advanced the vault').toBe(0);

  // And the proof that it is still there: repair the device and let it restore.
  // Asserting only the refusal would leave the claim half made, because a seal
  // that silently did nothing at all would pass it too.
  await page.evaluate((k) => {
    localStorage.removeItem('resonate.letters.v1');
    const s = JSON.parse(localStorage.getItem('resonate.settings.v1'));
    s.clubKey = k;
    s.clubSeq = 0;
    localStorage.setItem('resonate.settings.v1', JSON.stringify(s));
  }, key);
  await revisit(page);
  await openTheClubRoom(page);
  await sealIt(page);
  await expect(page.locator('#toast')).toContainText('write to your correspondents again',
    { timeout: 60000 });
  const kept = await lettersOf(page);
  expect(kept.jwk.d, 'the identity did not survive a device that could not write')
    .toBe(SENTINEL.jwk.d);
  expect(kept.pairs.length, 'the pairings did not survive a device that could not write')
    .toBe(1);
});

test('an unreadable letters slice is not an absent one the next seal may replace', async ({ page }) => {
  await open(page, { places: 2 });
  const key = await joinWith(page);
  await openTheClubRoom(page);
  await sealIt(page);
  await expect(page.locator('#toast')).toContainText('backed up', { timeout: 60000 });

  const beforeSeq = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('resonate.settings.v1')).clubSeq);
  const beforeLetters = await lettersOf(page);

  // The envelope and atlas remain valid and decryptable. Only the present
  // letters slice is a shape this build must refuse rather than call absent.
  await page.evaluate(async ({ phrase }) => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const { makeClient, seal, unseal } = await import(`/js/club.js${v}`);
    const settings = JSON.parse(localStorage.getItem('resonate.settings.v1'));
    const client = makeClient('http://localhost:5179', () => settings.clubKey);
    const got = await client.getVault();
    const wrapper = JSON.parse(await unseal(got.bytes, phrase, { bind: settings.clubKey }));
    wrapper.seq = Number(wrapper.seq) + 1;
    wrapper.letters = {
      v: 1, jwk: { kty: 'RSA', n: 'not-an-ec-key', d: 'private' },
      pub: '', route: '', pairs: [],
    };
    const bytes = await seal(JSON.stringify(wrapper), phrase, { bind: settings.clubKey });
    await client.putVault(bytes, got.rev);
  }, { phrase: PHRASE });

  const api = await playwrightRequest.newContext();
  const before = Buffer.from(await (await api.get(`${MOCK}/vault`,
    { headers: { authorization: `Bearer ${key}` } })).body());

  await sealIt(page);
  await expect(page.locator('#toast'),
    'a present unreadable identity was overwritten as though it were absent')
    .toContainText('correspondent data could not be read', { timeout: 60000 });
  await expect(page.locator('#toast')).toContainText('nothing changed or was written');
  await expect(page.locator('#toast')).not.toContainText('backed up');
  expect(await page.evaluate(() =>
    JSON.parse(localStorage.getItem('resonate.settings.v1')).clubSeq)).toBe(beforeSeq);
  expect(await lettersOf(page), 'the unreadable remote slice changed the local identity')
    .toEqual(beforeLetters);

  const after = Buffer.from(await (await api.get(`${MOCK}/vault`,
    { headers: { authorization: `Bearer ${key}` } })).body());
  expect(after.equals(before), 'the refused wrapper was not left byte-for-byte untouched').toBe(true);
  await api.dispose();
});

test('a backup comes home to a device that has lost everything', async ({ page }) => {
  await open(page, { places: 3 });
  await joinWith(page);
  await openTheClubRoom(page);
  await sealIt(page);
  await expect(page.locator('#toast')).toContainText('backed up', { timeout: 60000 });

  // the browser is emptied, the way a wiped phone empties it, and the key and
  // the phrase are the only things carried across
  const key = await keyOf(page);
  await page.evaluate((k) => {
    localStorage.removeItem('resonate.places.v1');
    const s = JSON.parse(localStorage.getItem('resonate.settings.v1'));
    s.clubKey = k;
    s.clubSeq = 0;
    localStorage.setItem('resonate.settings.v1', JSON.stringify(s));
  }, key);
  await revisit(page);
  await openTheClubRoom(page);
  await sealIt(page);
  await expect(page.locator('#toast')).toContainText(/came home/, { timeout: 60000 });
  expect(await page.evaluate(() =>
    JSON.parse(localStorage.getItem('resonate.places.v1') || '[]').length)).toBe(3);
});

test('a phrase that is not the phrase opens nothing, and the bytes do not move',
  async ({ page, playwright }) => {
    await open(page, { places: 2 });
    const key = await joinWith(page);
    await openTheClubRoom(page);
    await sealIt(page);
    await expect(page.locator('#toast')).toContainText('backed up', { timeout: 60000 });

    const api = await playwrightRequest.newContext();
    const before = Buffer.from(await (await api.get(`${MOCK}/vault`,
      { headers: { authorization: `Bearer ${key}` } })).body());

    await revisit(page);
    await openTheClubRoom(page);
    await sealIt(page, 'nine grey horses at the gate');
    await expect(page.locator('#toast')).toContainText(/does not unlock/, { timeout: 60000 });

    const after = Buffer.from(await (await api.get(`${MOCK}/vault`,
      { headers: { authorization: `Bearer ${key}` } })).body());
    expect(after.equals(before), 'a refused phrase rewrote the vault').toBe(true);
    await api.dispose();
  });

// ---------- the failures the design says are survivable ----------

test('a seal that dies after the upload leaves the vault whole, whichever way it fell',
  async ({ page, playwright }) => {
    await open(page, { places: 2 });
    const key = await joinWith(page);
    await openTheClubRoom(page);
    await sealIt(page);
    await expect(page.locator('#toast')).toContainText('backed up', { timeout: 60000 });

    const api = await playwrightRequest.newContext();
    const head = await api.get(`${MOCK}/vault`, { headers: { authorization: `Bearer ${key}` } });
    const rev = head.headers().etag;
    const before = Buffer.from(await head.body());

    // the next seal writes its bytes and stops before the pointer moves
    await api.post(`${MOCK}/die?at=upload&reset=1`, { headers: { authorization: `Bearer ${key}` } });
    await revisit(page);
    await openTheClubRoom(page);
    await sealIt(page);
    // wait for the attempt to be over before saying nothing moved: a negative
    // asserted while the work is still running is not an assertion
    await expect(page.locator('#toast')).toContainText(/./, { timeout: 60000 });
    await expect(page.locator('#toast'), 'a seal that never committed reported success')
      .not.toContainText('everything is backed up');

    // What is true here depends on something outside this app's hands: a
    // browser may retry a put whose connection died before any answer arrived,
    // and a retry that commits is a seal that happened. So the claim is not
    // "nothing moved". It is that the vault is whole either way: whichever
    // envelope it holds is a complete one, the slot before it is a complete
    // one, and no state exists in between.
    const attempts = (await (await api.get(`${MOCK}/die`)).json()).seals;
    const after = await api.get(`${MOCK}/vault`, { headers: { authorization: `Bearer ${key}` } });
    const now = Buffer.from(await after.body());
    expect(now.subarray(0, 5).toString('latin1'), `after ${attempts} attempts the vault is not an envelope`)
      .toBe('rsnt2');
    if (after.headers().etag === rev) {
      expect(now.equals(before), 'the revision stood still and the bytes changed').toBe(true);
    } else {
      // the transport retried and that attempt committed: then the envelope
      // before it must be the one this test started from, whole
      const prev = await api.get(`${MOCK}/vault?prev=1`, { headers: { authorization: `Bearer ${key}` } });
      expect(prev.status()).toBe(200);
      expect(Buffer.from(await prev.body()).equals(before),
        'a rotation happened and the slot before it is not what was there').toBe(true);
    }
    await api.dispose();
  });

test('a seal whose answer is lost has committed, and the next read says so',
  async ({ page, playwright }) => {
    await open(page, { places: 2 });
    const key = await joinWith(page);
    await openTheClubRoom(page);
    await sealIt(page);
    await expect(page.locator('#toast')).toContainText('backed up', { timeout: 60000 });

    const api = await playwrightRequest.newContext();
    const first = await api.get(`${MOCK}/vault`, { headers: { authorization: `Bearer ${key}` } });
    const rev = first.headers().etag;

    // the rotation lands and the answer never arrives
    await api.post(`${MOCK}/die?at=commit`, { headers: { authorization: `Bearer ${key}` } });
    await page.evaluate(async () => {
      const v = new URL(document.querySelector('script[type=module]').src).search;
      const { store } = await import(`/js/store.js${v}`);
      store.load();
      store.addPlace({ id: 'late', name: 'Added Late', lat: 45, lng: 7, tags: [], status: 'wishlist',
        note: '', city: '', country: '', countryCode: '', address: '', url: '', rating: 0,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    });
    await revisit(page);
    await openTheClubRoom(page);
    await sealIt(page);

    // The seal did land, and the claim is stated as a wait rather than as a
    // snapshot: sealing runs Argon2id at 64 MiB and a reading taken the
    // instant the button is pressed measures nothing at all.
    await expect.poll(
      async () => (await api.get(`${MOCK}/vault`, { headers: { authorization: `Bearer ${key}` } })).headers().etag,
      { timeout: 60000, message: 'the answer was lost and so was the seal' },
    ).not.toBe(rev);
    // and the device was not told it succeeded, because nothing told it
    await expect(page.locator('#toast')).not.toContainText('everything is backed up');
    // and the previous envelope is the one from before it, still readable
    const before = await api.get(`${MOCK}/vault?prev=1`, { headers: { authorization: `Bearer ${key}` } });
    expect(before.status()).toBe(200);
    await api.dispose();
  });

// ---------- standing, and the end ----------

test('a membership that has ended still reads, and no longer saves', async ({ page, playwright }) => {
  await open(page, { places: 2 });
  const key = await joinWith(page);
  await openTheClubRoom(page);
  await sealIt(page);
  await expect(page.locator('#toast')).toContainText('backed up', { timeout: 60000 });

  const api = await playwrightRequest.newContext();
  await api.post(`${MOCK}/lapse`, { headers: { authorization: `Bearer ${key}` } });
  await revisit(page);
  await openTheClubRoom(page);
  await expect(page.locator('#clubBody')).toContainText(/ended/);
  // what is theirs is still readable, and only sealing anew is refused
  expect((await api.get(`${MOCK}/vault`, { headers: { authorization: `Bearer ${key}` } })).status()).toBe(200);
  await sealIt(page);
  await expect(page.locator('#toast')).toContainText(/membership has ended/, { timeout: 60000 });
  await api.dispose();
});

test('leaving goes where a subscription can actually be ended', async ({ page }) => {
  // The two words beside it delete backups and forget a key, and neither stops
  // the money. Only Stripe can, so this asks the club for a portal session and
  // goes there. The mock's portal is a door that sends the browser straight
  // back, which is what a member who changes their mind would see.
  await open(page);
  await joinWith(page);
  await openTheClubRoom(page);
  await page.locator('#clubEnd').click();
  await expect(page.locator('#clubOverlay')).toBeVisible({ timeout: 20000 });
  await expect(page).toHaveURL(/localhost:5178\/$/);
  // and coming back from it changes nothing about the membership
  await expect.poll(() => keyWhenReadable(page), { timeout: 20000 }).toMatch(/^tc_/);
  await expect(page.locator('#clubStanding')).toContainText(/^a member\b/);
});

test('the burn takes both backups and starts the count over', async ({ page, playwright }) => {
  await open(page, { places: 2 });
  const key = await joinWith(page);
  await openTheClubRoom(page);
  await sealIt(page);
  await expect(page.locator('#toast')).toContainText('backed up', { timeout: 60000 });

  const seq = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('resonate.settings.v1')).clubSeq);
  // Intercept at the app's fetch boundary rather than Playwright's network
  // route. A page route cannot see requests claimed by a service worker, and
  // WebKit can install this app's worker before this point in the test.
  await page.evaluate((vault) => {
    const real = window.fetch;
    let pending = true;
    window.fetch = (input, init) => {
      const href = typeof input === 'string' ? input : input?.url;
      const method = String(init?.method || input?.method || 'GET').toUpperCase();
      if (pending && method === 'DELETE' && new URL(href, location.href).href === vault) {
        pending = false;
        return Promise.resolve(new Response(JSON.stringify({ gone: false, pending: true }), {
          status: 202,
          headers: { 'content-type': 'application/json' },
        }));
      }
      return real(input, init);
    };
  }, `${MOCK}/vault`);
  await page.locator('#clubBurn').click();
  await expect(page.locator('#askBox')).toBeVisible();
  await page.locator('#askGo').click();
  await expect(page.locator('#toast')).toContainText('still deleting', { timeout: 30000 });
  await expect(page.locator('#clubBurn')).toHaveText('check deletion again');
  expect(await page.evaluate(() =>
    JSON.parse(localStorage.getItem('resonate.settings.v1')).clubSeq),
  'a pending physical deletion reset the local backup history').toBe(seq);

  const api = await playwrightRequest.newContext();
  expect((await api.get(`${MOCK}/vault`, { headers: { authorization: `Bearer ${key}` } })).status(),
    'the pending response was achieved by deleting the fixture rather than holding it').toBe(200);

  await page.locator('#clubBurn').click();
  await expect(page.locator('#askBox')).toBeVisible();
  await page.locator('#askGo').click();
  await expect(page.locator('#toast')).toContainText(/gone/, { timeout: 30000 });

  expect((await api.get(`${MOCK}/vault`, { headers: { authorization: `Bearer ${key}` } })).status()).toBe(404);
  expect((await api.get(`${MOCK}/vault?prev=1`, { headers: { authorization: `Bearer ${key}` } })).status()).toBe(404);
  await api.dispose();

  // and the count starts over, so the next seal is a first seal
  expect(await page.evaluate(() =>
    JSON.parse(localStorage.getItem('resonate.settings.v1')).clubSeq)).toBe(0);
});

// ---------- the door, pressed twice ----------

// `become a member` mints a fresh secret on every press. That is right: a
// second try must not write over the attempt still in flight. But a fresh
// secret is a fresh commitment, a fresh idempotency key at /checkout, and so a
// subscription Stripe has no way of knowing is the same person. Pressed twice,
// paid twice, and the panel said nothing about it at all. Three of these were
// left on a device by three presses during one walk through the join flow.
test('a payment already begun is offered back before a second one is begun', async ({ page }) => {
  await open(page);
  await openTheClubRoom(page);

  // an abandoned checkout, made the way the suite already makes one: a secret,
  // a session and an address, and no money
  await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const { makeClient } = await import(`/js/club.js${v}`);
    await makeClient('http://localhost:5179', () => '').checkout();
  });
  const [begun] = await joinsOf(page);
  expect(begun.session).toMatch(/^cs_mock/);
  // the address is kept, and it is the whole of what makes this finishable
  expect(begun.url, 'the checkout address was not written down beside the session').toBeTruthy();

  await page.goto('/?club=none');
  await expect(page.locator('#clubOverlay')).toBeVisible({ timeout: 20000 });

  // the room says so, before it offers to start another one
  await expect(page.locator('#clubBody')).toContainText('a payment you began');
  await expect(page.locator('#clubResume')).toBeVisible();

  // and pressing `become a member` cannot quietly buy a second membership
  await page.locator('#clubJoin').click();
  await expect(page.locator('#askBox')).toBeVisible();
  await expect(page.locator('#askWhat')).toContainText('second subscription');
  const before = (await joinsOf(page)).length;
  await page.locator('#askNo').click();
  expect(await joinsOf(page), 'a refused warning still minted a secret').toHaveLength(before);
});

// The ordinary shape of a lost membership is not an abandoned card. It is a
// card that went through and a page that never came home: a shut tab, a dead
// battery, a bank's own screen that ate the return. The door answers that for
// nothing, so it is asked before anybody is sent back to pay again.
test('a payment that landed while the page did not is finished, not repeated', async ({ page }) => {
  await open(page);
  await openTheClubRoom(page);

  // begun, and paid at the desk, with this page never told about either
  const session = await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const { makeClient } = await import(`/js/club.js${v}`);
    const got = await makeClient('http://localhost:5179', () => '').checkout();
    // the pretended checkout page marks the session paid and then redirects
    // home. fetched rather than navigated to, it is a card that went through
    // for a browser that never came back, which is the case being tested.
    await fetch(got.url).catch(() => {});
    return got.session;
  });
  expect(session).toMatch(/^cs_mock/);

  await page.goto('/?club=none');
  await expect(page.locator('#clubResume')).toBeVisible({ timeout: 20000 });
  await page.locator('#clubResume').click();

  // no second checkout, no second charge: the key this device already paid for
  let key = '';
  await expect.poll(async () => (key = await keyWhenReadable(page)), { timeout: 30000 }).toMatch(/^tc_/);
  expect(await joinsOf(page), 'the spent attempts are still being held').toHaveLength(0);
});

// ---------- the two secrets a member cannot be handed twice ----------

test('the key can be copied, because writing it down is the instruction', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await open(page);
  const key = await joinWith(page);
  await expect(page.locator('#clubKeyCopy')).toBeVisible();
  await page.locator('#clubKeyCopy').click();
  await expect(page.locator('#toast')).toContainText('copied');
  const held = await page.evaluate(() => navigator.clipboard.readText().catch(() => null));
  // one engine of the three will not read the board back even when it wrote it.
  // the toast is the claim everywhere; the bytes are checked where they can be.
  test.skip(held === null, 'this engine does not hand the clipboard back');
  expect(held).toBe(key);
});

// The phrase is invented by the person and stored by nobody, so the first seal
// is the one moment a typo in it is permanent: it seals against the typo, and
// every later attempt uses the phrase they meant. After a backup exists a wrong
// phrase simply fails to open it and says so, so the second field goes away.
test('the phrase is read back before the seal that fixes it, and only then', async ({ page }) => {
  await open(page);
  await joinWith(page);

  await expect(page.locator('#clubPhrase2Row')).toBeVisible();
  await page.locator('#clubPhrase').fill(PHRASE);
  await page.locator('#clubPhrase2').fill(PHRASE.replace('seven', 'sevn'));
  await page.locator('#clubSync').click();
  await expect(page.locator('#toast')).toContainText('do not match');
  // and nothing was sealed against the typo
  expect(await page.evaluate(() => Number(JSON.parse(localStorage.getItem('resonate.settings.v1') || '{}').clubSeq) || 0)).toBe(0);

  await page.locator('#clubPhrase2').fill(PHRASE);
  await page.locator('#clubSync').click();
  await expect(page.locator('#clubMeta')).toContainText('last saved', { timeout: 30000 });

  // sealed once, the question is answerable by the club and the field goes
  await revisit(page);
  await openTheClubRoom(page);
  await expect(page.locator('#clubPhrase2Row')).toBeHidden();
});

// A returning device enters on the board, so the board is often already up and
// a press on `#fmIndex` would be swallowed by the overlay it was meant to open.
async function openTheBoard(page) {
  await front(page);
  if (await page.locator('#indexOverlay').isHidden()) await page.locator('#fmIndex').click();
  await expect(page.locator('#indexOverlay')).toBeVisible();
}

// A word stood on the index board itself from 16 to 19 August 2026, because
// `the travellers club` was fourth in the settings room, behind the byline and
// the data and the census, and nothing on the board said the club existed at
// all. The word went when the board went to three, and what it was buying is
// what these two tests now measure directly: not the number of presses, but
// whether a person who opens the room is looking at the club.
async function openTheClubFromTheRoom(page) {
  await front(page);
  await openTheBoard(page);
  await page.locator('[data-go="you"]').click();
  await expect(page.locator('#settingsOverlay')).toBeVisible();
  await page.locator('#clubWord').click();
  await expect(page.locator('#clubOverlay')).toBeVisible();
}

test('the club is reachable from the board, without a scroll on the way', async ({ page }) => {
  await open(page);
  await openTheBoard(page);
  await page.locator('[data-go="you"]').click();
  await expect(page.locator('#settingsOverlay')).toBeVisible();

  // The whole price of taking the word off the board, and the only part of it a
  // test can hold: the club stands inside the first screenful of the room it
  // moved into.
  //
  // The fold is the viewport, and the scroller is #settingsOverlay. Written
  // first against #settingsBody it was vacuous: that element does not scroll,
  // its scrollTop is always 0, and its box runs the full height of its content,
  // so `the word is above the bottom of the body` was true of the last section
  // in the room as readily as the first. Checked in a browser: overlay
  // scrollHeight 1511 against clientHeight 860, body 1271 against 1266.
  const reach = await page.evaluate(() => {
    const w = document.querySelector('#clubWord');
    const room = document.querySelector('#settingsOverlay');
    return { bottom: w.getBoundingClientRect().bottom, fold: innerHeight, scrolled: room.scrollTop };
  });
  expect(reach.scrolled, 'the room was already scrolled when it opened').toBe(0);
  expect(reach.bottom,
    `the travellers club ends ${Math.round(reach.bottom)}px down a ${reach.fold}px screen, `
    + 'which is below the fold of the room it was moved into')
    .toBeLessThanOrEqual(reach.fold);

  await page.locator('#clubWord').click();
  await expect(page.locator('#clubOverlay')).toBeVisible();
  // the word has to arrive at the room, not merely at a surface: the club is
  // the one place here that asks to be paid for.
  await expect(page.locator('#clubOverlay .poster-word')).toHaveText('club');
});

// `a device with no club to reach is not offered the word` stood here until
// the switch of 17 August 2026, and it said in its own body what to do on this
// day: the shipped address is filled, `clubBase()` falls back to it whatever a
// device's settings hold, and a browser with no club can no longer be built.
// It was deleted rather than weakened, because a test that can only be kept
// green by pretending its fixture still exists is worse than the gap.
//
// What it guarded is not gone. test/docs.test.mjs binds `CLUB_URL` to the
// policy that has to name it and to the price that has to be quoted beside it,
// in both directions.

test('the word in the you room leads to a door that is actually open', async ({ page }) => {
  // The other half of the retired test, and the one that means something now:
  // the room behind the word offers a way in rather than an apology. It runs
  // against the mock, so what is asserted is the room's own copy and not the
  // deployed club.
  await open(page);
  await openTheClubFromTheRoom(page);
  const body = page.locator('#clubBody');
  await expect(body).toContainText('CHF 48');
  await expect(body, 'the open door still apologises for being shut')
    .not.toContainText('door is not open yet');
  await expect(page.locator('#clubJoin')).toBeVisible();
  // and the sandbox is said above the word, not in a document nobody opens
  await expect(body).toContainText('No money changes hands');
});

test('a key with a letter the club never mints is refused here, not at the door', async ({ page }) => {
  await open(page);
  await openTheClubRoom(page);
  // i, l, o and u are absent from crockford base32 exactly so that a key read
  // off a screen cannot be typed back wrong. this field used to take all
  // twenty-six and let the club say no from a long way away.
  //
  // The room no longer names those four letters back: that sentence was the
  // clearest line in the club to whoever chose the format and the most
  // confusing one in it to everybody else. What is asserted here is the rule,
  // which has not moved, and not the lecture, which has gone.
  for (const bad of ['tc_iiiiiiiiiiiiiiiiiiiii', 'tc_lllllllllllllllllllll',
                     'tc_ooooooooooooooooooooo', 'tc_uuuuuuuuuuuuuuuuuuuuu']) {
    await page.locator('#clubKeyIn').fill(bad);
    await page.locator('#clubKeyKeep').click();
    await expect(page.locator('#toast')).toContainText('key does not match the club format');
    await expect(page.locator('#toast')).toContainText('paste the full key beginning tc_');
    expect(await keyOf(page)).toBe('');
  }
});

// ---------- letters: the identity, and the introduction ----------
//
// Everything above is one member alone with their own backup. This is the part
// where two of them can reach each other, and it starts with a fact that has no
// surface: a membership has one identity, minted on the first seal and written
// into that same envelope. Not on boot, not when the club room opens. Two keys
// under one membership is two people, and the friend who read a mark aloud
// against one of them has verified nothing about the other.

async function openLetters(page) {
  await front(page);
  if (await page.locator('#contactsOverlay').isVisible()) return;
  if (!(await page.locator('#indexOverlay').isHidden())) await page.locator('#indexClose').click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('/');
  await page.locator('#paletteInput').fill('>letters');
  await expect(page.locator('.cmd-row').first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('#contactsOverlay')).toBeVisible();
}

// The other road into the same room, and the one a person actually walks: the
// word on the index board. It stands for every device now, so pressing it
// asserts nothing about a membership; what it does assert is that somebody who
// wanted people gets the room without typing anything.
async function openLettersFromTheBoard(page) {
  await front(page);
  if (await page.locator('#contactsOverlay').isVisible()) return;
  await page.keyboard.press('Escape');
  if (await page.locator('#indexOverlay').isHidden()) await page.locator('#fmIndex').click();
  await expect(page.locator('#indexOverlay')).toBeVisible();
  await page.locator('[data-go="contacts"]').click();
  await expect(page.locator('#contactsOverlay')).toBeVisible();
}

// Walking into the room, rather than finding it already open.
//
// Both helpers above return at the door when the room is up, which is right for
// getting somewhere and wrong for testing an arrival: nothing pushes a letter
// onto a screen, and this app runs no timer against the club on purpose, so a
// room that is already open is a room that has not asked. The two tests below
// used to call openLetters here and passed anyway, because the boot look four
// seconds in happened to land after the send on this machine. On a slower one
// it landed before, and both went red about a claim they had never tested.
//
// `road` is which way in, because there are two and they must both ask.
async function walkIntoLetters(page, road = openLettersFromTheBoard) {
  await front(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('#contactsOverlay')).toBeHidden();
  await road(page);
}

// The link a hand-over would have carried, caught where the share sheet is.
// Desktop engines disagree about whether navigator.share exists at all, so it
// is installed rather than hoped for, exactly as the atlas suite does it.
async function catchLink(page) {
  await page.evaluate(() => {
    window.__link = '';
    navigator.share = (d) => { window.__link = d.url; return Promise.resolve(); };
  });
}
// Polled, because every act that hands one over is asynchronous: a name is
// asked for, a capability is minted at the club, the row is written down, and
// the mark is recomputed before the sheet is ever offered. A single read after
// the click is a read of whatever had happened by then.
async function caughtLink(page) {
  let url = '';
  await expect
    .poll(async () => (url = await page.evaluate(() => window.__link || '')), { timeout: 20000 })
    .toContain('#m=');
  return url;
}

// A text dialog, answered. The app asks for a name and for a pasted link with
// the same box, so this is the one helper for both.
async function answerWith(page, text) {
  await front(page);
  const input = page.locator('#askInput');
  await expect(input).toBeVisible({ timeout: 15000 });
  await input.fill(text);
  await page.locator('#askGo').click();
}

async function joinAndSeal(page, who = 'ada', { places = 2 } = {}) {
  await open(page, { places, who });
  await joinWith(page);
  await openTheClubRoom(page);
  await sealIt(page);
  await expect(page.locator('#toast')).toContainText('backed up', { timeout: 60000 });
}

test('a membership becomes a person on its first backup, and only once', async ({ page }) => {
  await open(page, { places: 2 });
  await joinWith(page);
  expect(await lettersOf(page), 'a device had an identity before it had a backup').toBe(null);

  await openTheClubRoom(page);
  await sealIt(page);
  await expect(page.locator('#toast')).toContainText('can be written to now', { timeout: 60000 });
  const first = await lettersOf(page);
  expect(first.jwk.crv, 'the identity is not a key of this suite').toBe('P-256');
  expect(first.jwk.d, 'the private half was never written down').toBeTruthy();
  expect(first.pub, 'the public half is not the shape every gate here reads')
    .toMatch(/^B[A-Za-z0-9_-]{86}$/);

  // and the second seal mints nothing. A key minted twice is a person who has
  // been two people, and their correspondents verified only one of them.
  await sealIt(page);
  await expect(page.locator('#toast')).toContainText('backed up', { timeout: 60000 });
  const second = await lettersOf(page);
  expect(second.jwk.d, 'a second backup minted a second identity').toBe(first.jwk.d);
  expect(second.pub).toBe(first.pub);
  await expect(page.locator('#toast')).not.toContainText('can be written to now');
});

test('the post section is not offered to a device that has no identity, and not withheld from a member', async ({ page }) => {
  // The club in one rule. The device is free and this is not, so a person who
  // has never joined is not shown a door they cannot open, and a member who has
  // not backed up yet has nothing to be introduced with.
  //
  // What that rule attaches to changed on 2026-08-19 and this test changed with
  // it, deliberately, so the record of the switch is here rather than in a
  // deletion. The rule used to hide a word on the board, `letters`, which meant
  // the one surface that says what direct exchange is was invisible to everyone
  // who had not already bought it: the wrong way round for the thing the club
  // exists to sell. Contacts is unconditional, because it is a room of people
  // before it is a room of post, and the rule now hides the post section inside
  // it rather than the way in.
  const wordOnTheBoard = async () => {
    await page.keyboard.press('Escape');
    if (await page.locator('#indexOverlay').isHidden()) await page.locator('#fmIndex').click();
    await expect(page.locator('#indexOverlay')).toBeVisible();
    const there = await page.locator('[data-go="contacts"]').isVisible();
    await page.locator('#indexClose').click();
    return there;
  };

  await open(page, { places: 2 });
  expect(await wordOnTheBoard(), 'the way in to a room of people was conditional').toBe(true);
  // Pressed, rather than typed: pressing is what somebody does who wanted
  // people, and they are shown people and no machinery at all.
  await openLettersFromTheBoard(page);
  await expect(page.locator('#cbStart'),
    'a device that cannot write to anybody was shown the way to try').toHaveCount(0);
  await expect(page.locator('#lettersBody'),
    'a room opened for people answered with an offer').toBeEmpty();
  // and paints nothing, which is not the same as owing nothing. The section
  // below is spaced off the section above it, and a margin owed to an empty div
  // would push the people down the page for the one reader who is only ever
  // shown people: an indent under the heading, standing in for a thing they
  // were deliberately not told about.
  //
  // Asked of the rule and not of the geometry, which is the third try and the
  // two failures are the reason. An empty div self-collapses, so its margin
  // becomes the parent's own and moves the whole body down: inside the body the
  // people still sit at zero, so the first version asked the wrong pair and was
  // told nothing was wrong, and dropping the guard to check it passed anyway.
  // Measured from the heading instead, the collapse merges with a margin already
  // there and the whole fault is seven pixels wide, which is a threshold that
  // would go red on a font metric. What the guard actually claims is that an
  // empty section owes no space, and that is exact.
  expect(await page.evaluate(() =>
    getComputedStyle(document.querySelector('#lettersBody')).marginBottom),
  'a section painting nothing was still owed the space between two sections')
    .toBe('0px');
  await page.keyboard.press('Escape');

  // Typed, and that is a different question, so it gets a different answer. A
  // verb that refuses to exist teaches a person they typed the wrong thing; a
  // room that says what it needs teaches them what this is. Nobody who pressed
  // `contacts` asked what a letter is, and this person did.
  await openLetters(page);
  await expect(page.locator('#cbStart')).toHaveCount(0);
  await expect(page.locator('#lettersBody')).toContainText('Join to share directly');
  await page.keyboard.press('Escape');

  await joinWith(page);
  await openLettersFromTheBoard(page);
  await expect(page.locator('#cbStart'), 'a paid member with no backup was offered letters')
    .toHaveCount(0);
  // Not offered is not the same as not spoken to, and for a year this room made
  // them one thing. The rule above is about a stranger: do not sell the club to
  // somebody standing in a room of people. It was being applied to a member, who
  // is not a stranger and is not being sold anything, and it handed them the room
  // voices used to be. They pressed contacts holding a paid membership and read
  // `copy my atlas link`, `open one sent to me`, and nothing whatever about the
  // thing they had bought, in the one room that thing lives in.
  //
  // So the section paints for them, in the state it already had a sentence for:
  // it names the backup, which is the one requirement left, and it carries the
  // word that performs it. What stays absent is the act. A member with no
  // identity still cannot be introduced to anybody, and the room still does not
  // pretend they can.
  await expect(page.locator('#lettersBody'),
    'a member who had paid pressed the room and was told nothing about what they paid for')
    .toContainText('Back up once');
  await expect(page.locator('#lettersBody #lbClub'),
    'the room named the missing backup and offered no way to make one').toBeVisible();
  // Two sections, and they have to read as two. Nothing was holding them apart:
  // `.corr-box` carried `margin-top: 0` written when letters sat underneath
  // voices and needed its inherited gap cancelled, and after the rooms merged it
  // sat on top of them with no bottom rule and no bottom space, so one section's
  // last word touched the next section's law. It was only ever met by somebody
  // who had already bought the thing, which is why it stood.
  expect(await page.evaluate(() => Math.round(
    document.querySelector('#corrBody').getBoundingClientRect().top
    - document.querySelector('#lettersBody').getBoundingClientRect().bottom)),
  'the two sections of this room are welded together').toBeGreaterThan(24);
  await page.keyboard.press('Escape');

  // And the typed road again, because the answer it gave a minute ago has since
  // become the wrong one. This person has a membership. Telling them letters
  // need one names the single fact they are already certain of and says nothing
  // about the one thing they have not done, so the backup is left to be
  // guessed at by somebody who has just paid to be told.
  await openLetters(page);
  await expect(page.locator('#lettersBody'),
    'a member who paid was asked for the membership they are holding')
    .not.toContainText('Join to share directly');
  await expect(page.locator('#lettersBody'),
    'the room knew what was missing and did not name it').toContainText('Back up once');
  // And it says it in one line, which is not a preference. The law is set at
  // 54px on the desk against a 24ch measure, so it holds about twenty-six
  // characters, and a sentence that runs over breaks at display size in a
  // place chosen by arithmetic: the first draft of this one broke after `your
  // first` and left the adjective on one line and its noun on the next. The
  // other law in this room fits on one line at every width and always has.
  for (const w of [360, 1512]) {
    await page.setViewportSize({ width: w, height: 800 });
    const lines = await page.evaluate(() => {
      const el = document.querySelector('#lettersBody .ce-law');
      const node = el.firstChild; const t = node.nodeValue;
      const r = document.createRange(); const tops = new Set();
      for (let i = 0; i < t.length; i++) {
        if (/\s/.test(t[i])) continue;
        r.setStart(node, i); r.setEnd(node, i + 1);
        tops.add(Math.round(r.getBoundingClientRect().top));
      }
      return tops.size;
    });
    expect(lines, `the law wrapped at ${w}, so a word is standing away from the one it governs`).toBe(1);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.keyboard.press('Escape');

  await openTheClubRoom(page);
  await sealIt(page);
  await expect(page.locator('#toast')).toContainText('backed up', { timeout: 60000 });
  await page.keyboard.press('Escape');
  await openLettersFromTheBoard(page);
  await expect(page.locator('#cbStart'),
    'the post did not arrive with the identity that earns it').toBeVisible();

  // One room, two sections, and they do not bleed. What is waiting stands above
  // the people, because it is the only thing here somebody else did and the
  // only thing that will not wait, and the people are not interleaved with it.
  await page.keyboard.press('Escape');
  if (!(await page.locator('#indexOverlay').isHidden())) await page.locator('#indexClose').click();
  await expect(page.locator('#contactsOverlay')).toBeHidden();
  await page.keyboard.press('/');
  await page.locator('#paletteInput').fill('>voices');
  await expect(page.locator('.cmd-row').first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('#contactsOverlay')).toBeVisible();
  await expect(page.locator('#corrBody #cbStart'),
    'the post section is riding inside the list of people').toHaveCount(0);
  await expect(page.locator('#lettersBody #cbStart'),
    'the post section is not where the room says it is').toHaveCount(1);
});

test('the room behind letters sends a person to a door that opens', async ({ page }) => {
  // This test used to assert the opposite, and the file it is in is the record
  // of the switch: while the door was shut it held that `join, back up once,
  // and this room opens` must not be printed, because an instruction that
  // cannot be followed is worse than silence. The door is open, so the same
  // claim faces the other way. Both halves are the one rule: this room says
  // what is true of the club today and never what is true of the next release.
  //
  // The word is not on the board for a device with no identity, so the room is
  // reached the one way that still reaches it: typed. A verb that answers is
  // the whole reason this copy has to be true, because typing is how somebody
  // arrives at a room nothing offered them.
  await open(page, { places: 2 });
  // Two places is enough to be met by the board, and the command line does not
  // answer while a surface is up, so the board is put away before it is asked.
  if (!(await page.locator('#indexOverlay').isHidden())) await page.locator('#indexClose').click();
  await expect(page.locator('#indexOverlay')).toBeHidden();
  await page.keyboard.press('/');
  await page.locator('#paletteInput').fill('>letters');
  await expect(page.locator('.cmd-row').first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('#contactsOverlay')).toBeVisible();

  const body = page.locator('#lettersBody');
  await expect(body).toContainText('Join to share directly');
  await expect(body, 'the room still apologises for a door that opens')
    .not.toContainText('not open yet');
  await expect(body).toContainText('Then back up once');
  // and the word is a door rather than a description of one
  await expect(page.locator('#lbClub')).toBeVisible();
  await page.locator('#lbClub').click();
  await expect(page.locator('#clubOverlay')).toBeVisible();
});

test('an introduction is handed over, opened, and the two marks agree',
  async ({ page, browser }) => {
    // Two devices, and so two Argon2id derivations at 64 MiB before this test
    // has asserted anything. In the CI container, software-rendered, the
    // longest of these ran 41.1 seconds against a 45 second budget on the run
    // where it passed: ninety-one per cent of its allowance, with the next
    // slowest test in the file at 29. It did not fail on an assertion, it ran
    // out of clock, and the call log then names whichever click was in flight,
    // which is why the same test appeared to fail in four different places.
    // These tests are twice the size of their neighbours and are told so here
    // rather than being left to brush the ceiling and be called flaky.
    test.slow();
    // The whole of the first contact, in two browsers that share nothing but a
    // club. Neither of them can send anything at the end of it: the mark has
    // been read aloud and matched, which is what a person does, and this is the
    // test that the two screens show the same two words.
    await joinAndSeal(page, 'ada');
    const second = await browser.newContext();
    const other = await second.newPage();
    await joinAndSeal(other, 'bruno');

    // ada goes first: a capability minted for one person, and a link
    await page.keyboard.press('Escape');
    await openLetters(page);
    await catchLink(page);
    await page.locator('#cbStart').click();
    await answerWith(page, 'Bruno');
    await expect(page.locator('.pair-row')).toHaveCount(1);
    await expect(page.locator('.pair-said')).toContainText('waiting for reply');
    const fromAda = await caughtLink(page);
    expect(fromAda, 'nothing was handed over').toContain('#m=');

    // bruno opens it. he holds her card and she cannot yet write to him.
    await other.keyboard.press('Escape');
    await openLetters(other);
    await other.locator('#cbOpen').click();
    await answerWith(other, fromAda);
    await expect(other.locator('#toast')).toContainText('reply to their invitation', { timeout: 20000 });
    await expect(other.locator('.pair-row')).toHaveCount(1);
    await expect(other.locator('.pair-name')).toContainText('ada');
    await expect(other.locator('.pair-said')).toContainText('invitation received');

    // and sends his own back
    await catchLink(other);
    await other.locator('[data-mint]').click();
    const fromBruno = await caughtLink(other);
    expect(fromBruno).toContain('#m=');
    expect(fromBruno, 'two people handed over the same card').not.toBe(fromAda);

    // ada opens it onto the row she was waiting on, and now both hold both
    await front(page);
    await page.locator('[data-open]').click();
    await answerWith(page, fromBruno);
    await expect(page.locator('#toast')).toContainText('compare your codes to connect', { timeout: 20000 });

    const markOn = async (p) => {
      await front(p);
      await p.locator('[data-mark]').click();
      const said = await p.locator('#askSaid').textContent();
      // five groups, anchored to all five. Read as two, this went on passing
      // after the mark was widened by comparing the first eight characters of
      // twenty and calling it agreement.
      const four = '[0-9abcdefghjkmnpqrstvwxyz]{4}';
      const m = said.match(new RegExp(`${four} ${four} ${four} ${four} ${four}`));
      await p.locator('#askNo').click();
      return m ? m[0] : '';
    };
    const hers = await markOn(page);
    const his = await markOn(other);
    expect(hers, 'no mark was computed on the side that went first').toBeTruthy();
    expect(his, 'no mark was computed on the side that answered').toBeTruthy();
    expect(hers, 'the two screens show different words for the same pairing').toBe(his);

    // and a key outranks a row: opening the same card a second time, from the
    // general door rather than from the row it belongs to, lands on the row
    // that already holds that key. two rows under one key is one correspondent
    // who cannot tell which of them is them.
    await front(page);
    await page.locator('#cbOpen').click();
    await answerWith(page, fromBruno);
    await expect(page.locator('.pair-row'), 'one person became two rows').toHaveCount(1);

    // neither is verified until somebody says so out loud, and a matching name
    // has never been what says it
    for (const p of [page, other]) {
      await front(p);
      const held = await lettersOf(p);
      expect(held.pairs[0].state, 'a pairing verified itself').toBe('returned');
      await p.locator('[data-mark]').click();
      // in its own element, in the mono face, and not inside the question.
      // It used to be two newlines and eight spaces inside the prose, which
      // `white-space: normal` collapsed into the sentence around it.
      await expect(p.locator('#askSaid')).toContainText(hers);
      await expect(p.locator('#askWhat'),
        'the mark is back inside the paragraph, where it wraps like prose')
        .not.toContainText(hers);
      await p.locator('#askGo').click();
      await expect(p.locator('#toast')).toContainText('is connected', { timeout: 20000 });
      expect((await lettersOf(p)).pairs[0].state).toBe('verified');
    }

    // An invitation already accepted is idempotent, and says so. It must not
    // send a connected person back to a verification action that no longer
    // appears on their row.
    await front(page);
    await page.locator('#cbOpen').click();
    await answerWith(page, fromBruno);
    await expect(page.locator('#toast')).toContainText('already connected');
    await second.close();
  });

test('a mark binds the address, so a swapped one is never quietly adopted',
  async ({ page, browser }) => {
    test.slow();
    // The attack the mark exists for. Somebody who can put a different card in
    // front of a person who has already verified one must not be able to have
    // it accepted in silence. It is not accepted at all: the row says what
    // happened, keeps what it had, and the only way on is to start again.
    await joinAndSeal(page, 'ada');
    const second = await browser.newContext();
    const other = await second.newPage();
    await joinAndSeal(other, 'bruno');

    await page.keyboard.press('Escape');
    await openLetters(page);
    await catchLink(page);
    await page.locator('#cbStart').click();
    await answerWith(page, 'Bruno');
    const fromAda = await caughtLink(page);

    await other.keyboard.press('Escape');
    await openLetters(other);
    await other.locator('#cbOpen').click();
    await answerWith(other, fromAda);
    await catchLink(other);
    await other.locator('[data-mint]').click();
    const fromBruno = await caughtLink(other);

    await front(page);
    await page.locator('[data-open]').click();
    await answerWith(page, fromBruno);
    await expect(page.locator('#toast')).toContainText('compare your codes to connect', { timeout: 20000 });
    const before = (await lettersOf(page)).pairs[0];

    // A second introduction arrives carrying bruno's key and somebody else's
    // box. This is the whole reason the mark binds the address as well as the
    // key: if it bound only the keys, two people could read the same two words
    // aloud, agree, and be posting into a third party's letterbox from then on.
    // Composed by hand because no honest surface can make one.
    const ELSEWHERE = 'zzzzzzzzzzzzzzzzzzzzzzzzzz';
    const moved = await other.evaluate(async (route) => {
      const v = new URL(document.querySelector('script[type="module"]').src).search;
      const { store } = await import(`/js/store.js${v}`);
      const { makeIntroUrl } = await import(`/js/share.js${v}`);
      store.load();
      return makeIntroUrl({ from: 'bruno', pub: store.letters.pub, cap: `${route}.${route}` });
    }, ELSEWHERE);
    expect(moved).not.toBe(fromBruno);

    await front(page);
    await page.locator('#cbOpen').click();
    await answerWith(page, moved);
    await expect(page.locator('#toast'),
      'a moved address was adopted without a word').toContainText('different connection details',
      { timeout: 20000 });
    await expect(page.locator('#toast')).toContainText('nothing changed');
    const after = (await lettersOf(page)).pairs[0];
    expect(after.cap, 'the new address was taken').toBe(before.cap);
    expect(after.pub).toBe(before.pub);
    expect(after.state, 'the row did not say it needs repairing').toBe('repair');
    await expect(page.locator('.pair-said')).toContainText('reply doesn’t match');
    // and nothing on a row in repair offers a way on but starting again
    await expect(page.locator('[data-mark]')).toHaveCount(0);
    await expect(page.locator('[data-mint]')).toHaveCount(0);
    await second.close();
  });

test('withdrawing takes back the address and nothing else', async ({ page }) => {
  await joinAndSeal(page, 'ada');
  await page.keyboard.press('Escape');
  await openLetters(page);
  await catchLink(page);
  await page.locator('#cbStart').click();
  await answerWith(page, 'Bruno');
  await expect(page.locator('.pair-row')).toHaveCount(1);
  const capId = (await lettersOf(page)).pairs[0].capId;
  expect(capId, 'no capability was minted for them').toMatch(/^[0-9abcdefghjkmnpqrstvwxyz]{8}$/);

  const key = await keyOf(page);
  const api = await playwrightRequest.newContext();
  const boxBefore = await (await api.get(`${MOCK}/letters`,
    { headers: { authorization: `Bearer ${key}` } })).json();
  expect(boxBefore.caps, 'the club never took the capability').toContain(capId);

  // Let the safe tombstone write, then refuse the local deletion after the
  // club has revoked the capability. The row must stay visibly unfinished,
  // and a retry must accept the club's already-absent answer.
  await page.evaluate(() => {
    const real = Storage.prototype.setItem;
    let letterWrites = 0;
    window.__restoreSetItem = () => { Storage.prototype.setItem = real; };
    Storage.prototype.setItem = function (key, value) {
      if (key === 'resonate.letters.v1' && ++letterWrites === 2) {
        throw new DOMException('full', 'QuotaExceededError');
      }
      return real.call(this, key, value);
    };
  });
  await page.locator('[data-drop]').click();
  await page.locator('#askGo').click();
  await expect(page.locator('#toast')).toContainText('refused to remove', { timeout: 20000 });
  await expect(page.locator('.pair-row')).toHaveCount(1);
  await expect(page.locator('.pair-said')).toHaveText('removal unfinished');
  await expect(page.locator('[data-drop]')).toHaveText('finish removal');

  const boxAfterFirst = await (await api.get(`${MOCK}/letters`,
    { headers: { authorization: `Bearer ${key}` } })).json();
  expect(boxAfterFirst.caps, 'the first removal did not revoke the address').not.toContain(capId);

  await page.evaluate(() => window.__restoreSetItem());
  await page.locator('[data-drop]').click();
  await expect(page.locator('#toast')).toContainText('setup with Bruno removed', { timeout: 20000 });
  await expect(page.locator('.pair-row')).toHaveCount(0);

  const boxAfter = await (await api.get(`${MOCK}/letters`,
    { headers: { authorization: `Bearer ${key}` } })).json();
  await api.dispose();
  expect(boxAfter.caps, 'the address still works at the club').not.toContain(capId);
});

test('cancelling the phone share sheet leaves no dead-end invitation or reply',
  async ({ page, request }) => {
    test.slow();
    await joinAndSeal(page, 'ada');
    await page.keyboard.press('Escape');
    await openLetters(page);
    await page.evaluate(() => {
      navigator.share = () => Promise.reject(new DOMException('cancelled', 'AbortError'));
    });

    await page.locator('#cbStart').click();
    await answerWith(page, 'Bruno');
    await expect(page.locator('#toast')).toContainText('invitation cancelled', { timeout: 20000 });
    await expect(page.locator('.pair-row')).toHaveCount(0);

    const incoming = await page.evaluate(async (pair) => {
      const v = new URL(document.querySelector('script[type=module]').src).search;
      const { makeIntroUrl } = await import(`/js/share.js${v}`);
      return makeIntroUrl({ from: 'bruno', pub: pair.pub, cap: pair.cap });
    }, SENTINEL.pairs[0]);
    await page.locator('#cbOpen').click();
    await answerWith(page, incoming);
    await expect(page.locator('.pair-said')).toHaveText('invitation received');

    await page.locator('[data-mint]').click();
    await expect(page.locator('#toast')).toContainText('reply cancelled', { timeout: 20000 });
    const pair = (await lettersOf(page)).pairs[0];
    expect(pair.capId, 'a cancelled reply left an unshareable capability behind').toBe('');
    await expect(page.locator('.pair-said')).toHaveText('invitation received');
    await expect(page.locator('[data-mint]')).toHaveText('reply to invitation');

    const key = await keyOf(page);
    const box = await (await request.get(`${MOCK}/letters`,
      { headers: { authorization: `Bearer ${key}` } })).json();
    expect(box.caps, 'a cancelled native share leaked a live capability').toEqual([]);
  });

// The whole ceremony, so that the tests about what happens afterwards can be
// about that and not about this. It is the same walk the introduction test
// makes one line at a time; that one stays written out, because it is the test
// OF the ceremony and a test that calls a helper to do the thing it is testing
// proves the helper.
async function pairUp(page, other, theirName = 'Bruno') {
  await front(page);
  await page.keyboard.press('Escape');
  await openLetters(page);
  await catchLink(page);
  await page.locator('#cbStart').click();
  await answerWith(page, theirName);
  const fromMe = await caughtLink(page);

  await front(other);
  await other.keyboard.press('Escape');
  await openLetters(other);
  await other.locator('#cbOpen').click();
  await answerWith(other, fromMe);
  await expect(other.locator('.pair-row')).toHaveCount(1, { timeout: 20000 });
  await catchLink(other);
  await other.locator('[data-mint]').click();
  const fromThem = await caughtLink(other);

  await front(page);
  await page.locator('[data-open]').click();
  await answerWith(page, fromThem);
  await expect(page.locator('#toast')).toContainText('compare your codes to connect', { timeout: 20000 });

  for (const p of [page, other]) {
    await front(p);
    await p.locator('[data-mark]').click();
    await p.locator('#askGo').click();
    await expect(p.locator('#toast')).toContainText('is connected', { timeout: 20000 });
  }
}

// Open the plate on a seeded place by name, from the command line.
async function openPlate(page, name) {
  await front(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('#contactsOverlay')).toBeHidden();
  if (!(await page.locator('#indexOverlay').isHidden())) await page.locator('#indexClose').click();
  await page.keyboard.press('/');
  await page.locator('#paletteInput').fill(name);
  await expect(page.locator('.cmd-row').first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('#plate')).toBeVisible();
  await expect(page.locator('#plate .plate-name')).toHaveText(name);
}

test('a place goes from one atlas to another, sealed, and the club carries no name',
  async ({ page, browser, request }) => {
    test.slow();
    // The gesture this whole protocol exists for, end to end, in two browsers
    // that share nothing but a club: one press on a plate, and the place is in
    // somebody else's atlas.
    //
    // The club is asked, in the middle, what it is holding. It is holding bytes
    // and it is the same bytes on both sides of the sentence: no place name, no
    // byline, no note.
    await joinAndSeal(page, 'ada');
    const second = await browser.newContext();
    const other = await second.newPage();
    // an empty atlas on his side, so that what lands there landed by letter and
    // not by having been seeded into both browsers by the same fixture
    await joinAndSeal(other, 'bruno', { places: 0 });
    await pairUp(page, other);

    // Hold the first authenticated decrypt open. The pairing will be withdrawn
    // only after HPKE has begun, which is the consent race this test owns: a
    // check immediately before `await openLetter` is already stale when that
    // promise comes back.
    await other.evaluate(() => {
      const real = SubtleCrypto.prototype.decrypt;
      let release;
      window.__letterDecryptWaiting = false;
      window.__releaseLetterDecrypt = () => release?.();
      SubtleCrypto.prototype.decrypt = async function (...args) {
        if (!window.__letterDecryptWaiting) {
          window.__letterDecryptWaiting = true;
          await new Promise(resolve => { release = resolve; });
        }
        return real.apply(this, args);
      };
    });

    await openPlate(page, 'Place 1');
    // and the word does not offer a person until there is a person to offer
    await expect(page.locator('#pHandRow')).toBeHidden();
    await page.locator('#pHand').click();
    await expect(page.locator('#pHandRow [data-to]')).toHaveText('Bruno');
    await page.locator('#pHandRow [data-to]').click();
    await expect(page.locator('#toast')).toContainText('sent to Bruno', { timeout: 30000 });
    // the plate closes behind a letter that went, so the next press cannot be
    // the same place sent twice by somebody who did not see the toast
    await expect(page.locator('#plate')).toBeHidden();

    // what the club is holding, read with bruno's own key and nothing else
    const hisKey = await keyOf(other);
    const box = await (await request.get(`${MOCK}/letters`,
      { headers: { authorization: `Bearer ${hisKey}` } })).json();
    expect(box.letters, 'nothing reached the box').toHaveLength(1);
    const raw = await request.get(`${MOCK}/letters/${box.letters[0].id}`,
      { headers: { authorization: `Bearer ${hisKey}` } });
    const wire = await raw.body();
    expect(wire.length, 'the letter is empty').toBeGreaterThan(100);
    for (const said of ['Place 1', 'Basel', 'ada']) {
      expect(wire.includes(Buffer.from(said)), `the wire carries ${said} in the clear`).toBe(false);
    }
    // and it is a letter this app wrote, which is the only thing readable on it
    expect(wire.subarray(0, 5).toString()).toBe('rsntl');

    // Bruno starts opening while still verified. Once decrypt is waiting, put
    // the live pairing back before the mark and only then let plaintext return.
    const walking = walkIntoLetters(other);
    await expect.poll(() => other.evaluate(() => window.__letterDecryptWaiting),
      { timeout: 30000 }).toBe(true);
    await other.evaluate(async () => {
      const v = new URL(document.querySelector('script[type=module]').src).search;
      const { store } = await import(`/js/store.js${v}`);
      store.updatePair(store.letters.pairs[0].id, { state: 'returned' });
      window.__releaseLetterDecrypt();
    });
    await walking;
    await expect(other.locator('[data-post]')).toHaveCount(1, { timeout: 30000 });
    await expect(other.locator('[data-post] .pair-name')).toHaveText('a letter that will not open');
    await expect(other.locator('[data-post] .pair-said')).toContainText('sender is no longer connected');
    await expect(other.locator('[data-post] [data-read]')).toHaveCount(0);

    // Once the mark is actually read, a fresh look at the same club copy can
    // open it. Reload clears only this visit's refused row; it does not touch
    // the durable letter.
    await other.locator('[data-pid] [data-mark]').click();
    await other.locator('#askGo').click();
    await expect(other.locator('#toast')).toContainText('is connected', { timeout: 20000 });
    await other.reload();
    await walkIntoLetters(other);
    await expect(other.locator('[data-post]')).toHaveCount(1, { timeout: 30000 });
    await expect(other.locator('[data-post] .pair-name')).toHaveText('ada sent you a place');
    await other.locator('[data-post] [data-read]').click();
    await expect(other.locator('#reportOverlay')).toBeVisible();
    await expect(other.locator('#reportOverlay')).toContainText('Place 1');

    // and keeps it, which is the only thing that writes
    const before = await other.evaluate(() => JSON.parse(localStorage.getItem('resonate.places.v1')).length);
    await other.locator('#reportOverlay [data-adopt="0"]').click();
    await expect.poll(async () => other.evaluate(
      () => JSON.parse(localStorage.getItem('resonate.places.v1')).length), { timeout: 20000 })
      .toBe(before + 1);
    const kept = await other.evaluate(() => JSON.parse(localStorage.getItem('resonate.places.v1')));
    expect(kept.some(p => p.name === 'Place 1'), 'the place did not land').toBe(true);

    await second.close();
  });

test('a letter thrown away is written down before the club is told to forget it',
  async ({ page, browser, request }) => {
    test.slow();
    // The order is the test. The ledger is a local write and a local write can
    // be refused; the club's copy is the only other record that the letter ever
    // existed. So the ledger goes first, and a refusal leaves the letter in the
    // box to be met again rather than deleted with nothing remembering it.
    await joinAndSeal(page, 'ada');
    const second = await browser.newContext();
    const other = await second.newPage();
    await joinAndSeal(other, 'bruno');
    await pairUp(page, other);

    await openPlate(page, 'Place 1');
    await page.locator('#pHand').click();
    await page.locator('#pHandRow [data-to]').click();
    await expect(page.locator('#toast')).toContainText('sent to Bruno', { timeout: 30000 });

    // in by the command line this time, which is the other road and asks the
    // same question
    await walkIntoLetters(other, openLetters);
    await expect(other.locator('[data-post]')).toHaveCount(1, { timeout: 30000 });

    // the ledger refuses, and nothing is deleted
    await other.evaluate(() => localStorage.setItem('resonate.post.v1', '{not json'));
    await other.reload();
    await expect(other.locator('#askWhat')).toContainText('which letters you have finished with',
      { timeout: 20000 });
    await front(other);
    await other.locator('#askNo').click();
    await openLetters(other);
    await expect(other.locator('[data-post]')).toHaveCount(1, { timeout: 30000 });
    await other.locator('[data-post] [data-toss]').click();
    await expect(other.locator('#toast')).toContainText('refused to write it down', { timeout: 20000 });

    const hisKey = await keyOf(other);
    const still = await (await request.get(`${MOCK}/letters`,
      { headers: { authorization: `Bearer ${hisKey}` } })).json();
    expect(still.letters, 'the club was told to forget a letter nothing remembers')
      .toHaveLength(1);

    // a device that can write does both, in that order, and the letter does not
    // come back the next time the box is asked
    await other.evaluate(() => localStorage.removeItem('resonate.post.v1'));
    await other.reload();
    await openLetters(other);
    await expect(other.locator('[data-post]')).toHaveCount(1, { timeout: 30000 });
    const id = await other.locator('[data-post]').getAttribute('data-post');
    await other.locator('[data-post] [data-toss]').click();
    await expect(other.locator('[data-post]')).toHaveCount(0);
    await expect.poll(async () => {
      const b = await (await request.get(`${MOCK}/letters`,
        { headers: { authorization: `Bearer ${hisKey}` } })).json();
      return b.letters.length;
    }, { timeout: 20000 }).toBe(0);
    expect(await other.evaluate(() => JSON.parse(localStorage.getItem('resonate.post.v1')).done))
      .toContain(id);

    await second.close();
  });

test('the room asks the club on the way in, by both roads',
  async ({ page, browser, request }) => {
    test.slow();
    // The claim the two tests above lean on, and never tested: opening the room
    // is what asks. They waited for a letter to appear, which any look would
    // satisfy, and the look that satisfied it was the one four seconds after
    // boot. On a machine slow enough for that look to land before the letter,
    // both went red, and the room a person walks into was a room that had asked
    // nobody anything.
    //
    // So this counts the asking rather than waiting for the letter. The mock
    // keeps a tally per box, the boot look is spent first and then bracketed,
    // and each road in must cost exactly one look.
    await joinAndSeal(page, 'ada');
    const second = await browser.newContext();
    const other = await second.newPage();
    await joinAndSeal(other, 'bruno', { places: 0 });
    await pairUp(page, other);

    const hisKey = await keyOf(other);
    const looks = async () => (await (await request.get(`${MOCK}/looks`,
      { headers: { authorization: `Bearer ${hisKey}` } })).json()).looks;

    // the boot look, spent on purpose before anything is sent: it fires once
    // per visit and nothing here may be explained by it
    const before = await looks();
    await other.reload();
    await expect.poll(looks, { timeout: 30000 }).toBeGreaterThan(before);

    await openPlate(page, 'Place 1');
    await page.locator('#pHand').click();
    await page.locator('#pHandRow [data-to]').click();
    await expect(page.locator('#toast')).toContainText('sent to Bruno', { timeout: 30000 });

    // the board word. The count is read first and the row second, so a room
    // that fills from somewhere else fails on the asking rather than passing on
    // the arrival.
    const board = await looks();
    await walkIntoLetters(other);
    await expect.poll(looks, { timeout: 15000,
      message: 'the board opened a room that asked nobody anything' }).toBe(board + 1);
    await expect(other.locator('[data-post]')).toHaveCount(1, { timeout: 30000 });
    expect(await looks(), 'one way in cost more than one look').toBe(board + 1);

    // and the command line, which is the same verb by the other door. The
    // letter is already in hand, so a second look must not file it twice.
    const line = await looks();
    await walkIntoLetters(other, openLetters);
    await expect.poll(looks, { timeout: 15000,
      message: 'the command line opened a room that asked nobody anything' }).toBe(line + 1);
    await expect(other.locator('[data-post]')).toHaveCount(1);
    expect(await looks(), 'one way in cost more than one look').toBe(line + 1);

    await second.close();
  });

test('no row in letters or in voices offers more than three words', async ({ page }) => {
  // Unpinned rows breed. Two words used to stand on a voice where one was an
  // act somebody wanted, and the pairing rows below them can reach three in
  // four different states. A row that offers four ways to act is a row nobody
  // reads, so the bound is a test rather than a habit, and it covers both kinds
  // of row because they sit in one body and are read as one list.
  await open(page, { places: 2 });
  await page.evaluate((l) => {
    localStorage.setItem('resonate.letters.v1', JSON.stringify(l));
  }, {
    ...SENTINEL,
    pairs: [
      SENTINEL.pairs[0],
      { ...SENTINEL.pairs[0], id: 'k2', name: 'Waiting', pub: '', cap: '', state: 'introduced', mark: '' },
      { ...SENTINEL.pairs[0], id: 'k3', name: 'Unanswered', capId: '', state: 'returned', mark: '' },
      { ...SENTINEL.pairs[0], id: 'k4', name: 'Unverified', state: 'returned' },
      { ...SENTINEL.pairs[0], id: 'k5', name: 'Moved', state: 'repair' },
      { ...SENTINEL.pairs[0], id: 'k6', name: 'Removed', state: 'withdrawn' },
      { ...SENTINEL.pairs[0], id: 'k7', name: 'Incomplete', pub: '', cap: '', state: 'verified' },
    ],
  });
  await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const { store } = await import(`/js/store.js${v}`);
    store.load();
    store.addCorrespondent({ name: 'Mira', tags: [], places: [
      { id: 'm1', name: 'Somewhere Else', lat: 47, lng: 9, city: 'Basel', status: 'visited', tags: [] },
    ] });
    store.updateCorrespondent(store.correspondents[0].id, { visible: false });
  });
  await revisit(page);
  const widest = (sel) => page.evaluate((s) => {
    const rows = [...document.querySelectorAll(s)];
    return rows.length ? Math.max(...rows.map(c => c.querySelectorAll('button').length)) : -1;
  }, sel);

  await openLetters(page);
  await expect(page.locator('#lettersBody .pair-row')).toHaveCount(7);
  expect(await widest('#lettersBody .corr-ctl'),
    'a row in letters grew a fourth word').toBeLessThanOrEqual(3);
  const removed = page.locator('#lettersBody .pair-row[data-pid="k6"]');
  await expect(removed.locator('.pair-said')).toHaveText('removal unfinished');
  await expect(removed.locator('[data-mark], [data-mint], [data-open], [data-ask]'),
    'a removed connection was offered a way back into sending').toHaveCount(0);
  await expect(removed.locator('[data-drop]')).toHaveText('finish removal');
  const incomplete = page.locator('#lettersBody .pair-row[data-pid="k7"]');
  await expect(incomplete.locator('.pair-said')).toHaveText('connection incomplete');
  await expect(incomplete.locator('[data-ask]'),
    'an incomplete restored row was called connected and offered sending').toHaveCount(0);

  // The two lists are two rooms now, so the bound is asserted in both. It used
  // to be one query over one body, which was right while they shared one, and
  // would have gone on passing over whichever of them survived the split.
  await page.keyboard.press('Escape');
  await page.keyboard.press('/');
  await page.locator('#paletteInput').fill('>voices');
  await expect(page.locator('.cmd-row').first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('#contactsOverlay')).toBeVisible();
  await expect(page.locator('#corrBody .corr-row')).toHaveCount(1);
  await expect(page.locator('#corrBody .pair-row'),
    'the letters rows are still riding underneath voices').toHaveCount(0);
  expect(await widest('#corrBody .corr-ctl'),
    'a row in voices grew a fourth word').toBeLessThanOrEqual(3);
});

// ---------- the other three kinds ----------
//
// The protocol has carried four kinds since it was written and the app could
// send one of them. A place went by letter; a folio, a question and a heart
// went by link and by link alone, which meant the three gestures that need a
// person at the other end were the three that needed a clipboard.
//
// The composer is where a folio is handed over, the correspondent's own row is
// where a question is asked, and the heart beside a place is where a folio is
// thanked for. Each of those is the surface where `who` has already been
// answered, or where the row of people can stand under the word without a new
// room being built for it.

// everything this atlas holds, under a title, in the composer
async function composeFolio(page, title) {
  await front(page);
  await page.keyboard.press('/');
  await page.locator('#paletteInput').fill('>folio');
  await expect(page.locator('.cmd-row').first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('#folioOverlay')).toBeVisible();
  await page.locator('#folNew').click();
  await expect(page.locator('#folTitle')).toBeVisible();
  await page.locator('#folTitle').fill(title);
  await page.locator('#folAll').click();
}

test('a folio travels sealed, arrives named as a folio, and the heart goes back the way it came',
  async ({ page, browser }) => {
    test.slow();
    // The loop this app is for, closed in one test: three places composed and
    // handed to one person, opened by them, and one of them thanked for. Both
    // halves travel sealed and neither touches a clipboard.
    await joinAndSeal(page, 'ada', { places: 3 });
    const second = await browser.newContext();
    const other = await second.newPage();
    await joinAndSeal(other, 'bruno', { places: 0 });
    await pairUp(page, other);

    await page.keyboard.press('Escape');
    await composeFolio(page, 'Three for Bruno');
    // the word stops naming one road once there are two of them
    await expect(page.locator('#folCopy'),
      'the composer still offers a link and nothing else').toHaveText('share collection');
    await page.locator('#folCopy').click();
    await expect(page.locator('#folHandRow [data-to]')).toHaveText('Bruno');
    await page.locator('#folHandRow [data-to]').click();

    // and the sentence at the door says what a letter is, which is the one
    // thing a link's sentence cannot say: this reaches one person and no other
    await expect(page.locator('#askWhat')).toContainText('This letter carries');
    await expect(page.locator('#askWhat'),
      'the door promised a letter and never said whose').toContainText('sealed to Bruno');
    await page.locator('#askGo').click();
    await expect(page.locator('#toast')).toContainText('sent to Bruno', { timeout: 30000 });
    // Sending leaves the editable composition open by design. This journey is
    // finished with it, so answer the unsaved-work guard explicitly instead
    // of teaching the navigation helper to discard a person's draft.
    await page.locator('#folioOverlay .poster-x').click();
    await expect(page.locator('#askWhat')).toHaveText('Save this collection as a draft before leaving?');
    await page.locator('#askAlso').click();
    await expect(page.locator('#folioOverlay')).toBeHidden();

    // three places is a folio. one place is a place, which the test above this
    // one holds, and the two sentences are the same function answering twice.
    await walkIntoLetters(other);
    await expect(other.locator('[data-post]')).toHaveCount(1, { timeout: 30000 });
    await expect(other.locator('[data-post] .pair-name')).toHaveText('ada sent you a collection');
    await other.locator('[data-post] [data-read]').click();
    await expect(other.locator('#reportOverlay')).toBeVisible();
    await expect(other.locator('#reportOverlay')).toContainText('Place 1');

    // the heart. It goes back to the key that sealed the folio, so nothing is
    // copied and no sheet is raised: a share caught here would mean the heart
    // had quietly fallen back to the road that needs a clipboard.
    await catchLink(other);
    await other.locator('[data-thank]').first().click();
    await expect(other.locator('#toast')).toContainText('thanks sent to ada', { timeout: 30000 });
    expect(await other.evaluate(() => window.__link || ''),
      'the heart made a link instead of going back the way the folio came').toBe('');

    await walkIntoLetters(page);
    await expect(page.locator('[data-post]')).toHaveCount(1, { timeout: 30000 });
    await expect(page.locator('[data-post] .pair-name')).toHaveText('Bruno thanked you');

    // and a plate that carries both words carries one row between them. The
    // two rows are the same three names in the same type, under two words that
    // mean different things, and open together they said nothing about which
    // word either copy was answering.
    await front(other);
    await other.locator('#reportOverlay [data-adopt="0"]').click();
    // the report stands over the letters room, so one Escape answers the
    // report and the room is still there behind it
    await other.keyboard.press('Escape');
    await expect(other.locator('#reportOverlay')).toBeHidden();
    await other.keyboard.press('Escape');
    await expect(other.locator('#contactsOverlay')).toBeHidden();
    await openPlate(other, 'Place 0');
    await expect(other.locator('#pThank'), 'the adopted place forgot who it came from')
      .toBeVisible();
    await other.locator('#pThank').click();
    await expect(other.locator('#pThankRow [data-to]')).toHaveCount(1);
    await other.locator('#pHand').click();
    await expect(other.locator('#pHandRow [data-to]')).toHaveCount(1);
    await expect(other.locator('.road-row:not([hidden])'),
      'two rows of the same three names stood open on one plate').toHaveCount(1);

    await second.close();
  });

test('a question goes to one person, from the row that is already theirs',
  async ({ page, browser }) => {
    test.slow();
    await joinAndSeal(page, 'ada', { places: 1 });
    const second = await browser.newContext();
    const other = await second.newPage();
    await joinAndSeal(other, 'bruno', { places: 0 });
    await pairUp(page, other);

    await page.keyboard.press('Escape');
    await openLetters(page);
    await expect(page.locator('.pair-row [data-ask]'),
      'a verified correspondent is offered no way to be asked anything').toHaveCount(1);
    await page.locator('.pair-row [data-ask]').click();

    // the field stops where the payload stops. It carried the input's own
    // default of two hundred while buildPayload cut at eighty, so past the
    // eightieth character a person was typing into a box that had already
    // stopped listening and said nothing about it.
    await expect(page.locator('#askInput')).toBeVisible({ timeout: 15000 });
    expect(await page.locator('#askInput').getAttribute('maxlength'),
      'the field takes more than the letter will carry').toBe('80');

    await answerWith(page, 'wine bars in lisbon');
    await expect(page.locator('#toast')).toContainText('request sent to Bruno', { timeout: 30000 });

    await walkIntoLetters(other);
    await expect(other.locator('[data-post]')).toHaveCount(1, { timeout: 30000 });
    await expect(other.locator('[data-post] .pair-name')).toHaveText('ada asked you for a place');
    await other.locator('[data-post] [data-read]').click();
    await expect(other.locator('#reportOverlay')).toContainText('wine bars in lisbon');
    // and the foot of it does not send its reader after a link they were never
    // given: the question is in their box until they throw it away
    await expect(other.locator('#reportOverlay')).not.toContainText('This link is the only copy');

    await second.close();
  });
