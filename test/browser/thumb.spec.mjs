// thumb.spec.mjs — what a thumb can press, measured rather than assumed.
//
// This file exists because css/style.css had claimed since rf97 that a pointer
// target is owed twenty-four pixels, nothing checked it, and every control on
// a phone stood between twenty-six and forty-one. The claim was true about the
// two rules that carried the comment and false about the rest of the app, and
// no suite anywhere had ever been red about it.
//
// Twenty-four is the pointer's number. A thumb's is forty-four, which is what
// both phone platforms ask for, and rf129 lays a forty-six band over every
// control under `(pointer: coarse)` — forty-six rather than forty-four because
// the reading below is taken by asking the page what is under a point, and a
// point on the exact edge of a band is answered differently by all three
// engines. A band laid over a control does not show up in
// `getBoundingClientRect`, and a rect that another surface covers is not
// reachable at all, so nothing here measures a rectangle. It asks the page
// what is under a point, and walks outward from the middle of each control
// until the page stops answering with that control. That is the only number a
// thumb cares about.
//
// The tier is keyed on the pointer and not on the width, so this file emulates
// touch rather than a narrow screen, and asserts that the emulation took: a
// context where `(pointer: coarse)` does not match would pass every assertion
// below while measuring the mouse layout, which is the exact vacuity this
// project keeps writing tests to avoid. `hasTouch: true` alone was measured to
// give coarse in all three engines; `isMobile` is not supported in Firefox.
//
// It grew once, and the reason is worth keeping. The first version walked the
// field, the board, a plate, the command line and nine posters, and passed on
// all three engines while the folio composer, the report a stranger arrives at,
// and the two words under a voice were all still standing at sixteen to
// forty-two pixels. A gate that measures the surfaces somebody thought of says
// nothing whatever about the ones they did not. What found them was a throwaway
// sweep that opened every room, scrolled each to its end and measured at every
// rest, at eight widths in three engines; what it found stands below as
// ordinary tests, and what it taught is that the thing a person presses is
// often two screens below the one a test opens.

import { test, expect } from '@playwright/test';

const OFF = ['**://*.cartocdn.com/**', '**://*.openstreetmap.org/**', '**://tile.**',
  '**://photon.komoot.io/**'];

// a thumb, and a phone's glass. the height is a tall phone's, so a board has
// rows below the fold to measure and the fold itself is not the finding.
test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

// The house numbers. Forty-four down the screen, because that is the axis a
// list stacks on and the one a thumb misses on; twenty-four across, because a
// word two characters wide is legitimately narrow and the standard's smaller
// tier is the honest floor there.
const TALL = 44, WIDE = 24;

// Measured in the page, at the moment of the ask. The walk is two pixels a
// step out to sixty, which is more than either number needs and cheap enough
// to run over every control on a surface.
const REACH = ({ skip, census, tall: TALL, wide: WIDE }) => {
  const W = innerWidth, H = innerHeight;
  const name = (el) => {
    if (el.id) return '#' + el.id;
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    return el.tagName.toLowerCase() + (cls ? '.' + cls : '');
  };
  const small = [], skipped = [];
  const seen = Object.fromEntries(census.map((c) => [c, 0]));
  let counted = 0;
  for (const el of document.querySelectorAll('a,button,input,select,textarea,summary,[role="button"]')) {
    if (skip.some((s) => el.matches(s) || el.closest(s))) {
      if (el.getBoundingClientRect().width > 0) skipped.push(name(el) + ' "' + (el.textContent || '').trim().slice(0, 12) + '"');
      continue;
    }
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || +st.opacity === 0 || st.pointerEvents === 'none') continue;
    // an inline link inside a sentence is text, and a sentence is not a row of
    // controls: growing it would move the words around it
    if (st.display === 'inline') continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    // only a control standing wholly on screen. half of one scrolled under the
    // lip of its own sheet measures small and is not
    if (r.top < 0 || r.bottom > H || r.left < 0 || r.right > W) continue;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    // the control, or something inside it. NOT an ancestor: a point on the row
    // a button sits in does not press the button, and counting it inflated
    // every reading here by the size of the nearest container — a poster's
    // close word read ninety-eight tall on a forty-one pixel word, and the
    // whole surface passed while nothing about it had changed.
    const mine = (p) => p && (p === el || el.contains(p));
    // a control the page does not answer with at its own middle is covered by
    // something, which is a different defect and has its own tests
    if (!mine(document.elementFromPoint(cx, cy))) continue;
    // a walk that runs off the glass has not measured the control, it has
    // measured the scroll position: a row half a band from the top of the
    // screen reads short and is one flick from reading right. So the edge is
    // reported and the reading it truncates is dropped, rather than counted
    // as a defect or, worse, silently counted as a pass.
    //
    // A sticky or fixed neighbour is the same case wearing different clothes,
    // and it took a sweep of eight widths to notice: a poster's own head and a
    // report's `close` stand over their scrollers, so a row that has scrolled
    // half under one reads short while nothing about the row is wrong. Blocked
    // by chrome is blocked by an edge.
    let edge = false;
    const walk = (dx, dy) => {
      let n = 0;
      for (; n < 30; n++) {
        const x = cx + dx * (n + 1) * 2, y = cy + dy * (n + 1) * 2;
        if (x < 0 || y < 0 || x > W - 1 || y > H - 1) { edge = true; break; }
        const p = document.elementFromPoint(x, y);
        if (!mine(p)) {
          // and not the control's own container: every room in this app is a
          // fixed sheet, so `the walk left the control` and `the walk hit the
          // chrome` would otherwise be the same reading, and the whole file
          // would measure nothing while passing.
          if (p && !p.contains(el) && /sticky|fixed/.test(getComputedStyle(p).position)) edge = true;
          break;
        }
      }
      return n * 2;
    };
    const tall = walk(0, -1) + walk(0, 1) + 2, wide = walk(-1, 0) + walk(1, 0) + 2;
    if (edge) continue;
    counted++;
    for (const c of census) if (el.matches(c)) seen[c]++;
    if (tall < TALL || wide < WIDE)
      small.push(`${name(el)} ${wide}x${tall} "${(el.textContent || el.placeholder || '').trim().slice(0, 24).replace(/\s+/g, ' ')}"`);
  }
  return { counted, seen, small, skipped, coarse: matchMedia('(pointer: coarse)').matches };
};

// The two exceptions, named here so they are decisions and not oversights.
//
// The two licence marks in the field's south-west corner are the attribution
// the tiles are served under: `© OSM · CARTO`, set in eight-and-a-half point,
// standing on the map. They already carry `padding: 7px 4px` with a negative
// margin, which is the same trick the tier uses and was written for the same
// reason. Taking them to forty-four would lay a band across the corner a thumb
// rests in to pan, and a person opens this app to move a map roughly ten
// thousand times for every time they read a licence.
//
// A mark on the map is the second, and it is excused from the *walk* rather
// than from the size. Two places a street apart put two marks on top of each
// other at any zoom that shows them both, so the clear space around a mark is
// a fact about the world and not about this stylesheet: no padding anywhere
// changes it. What can be held is the mark's own size, and the test below
// holds it at forty-four by the rectangle, which is the honest measure for a
// control that is allowed to have neighbours.
//
// Both exceptions are held to their own size: the field test pins the corner
// at exactly two licence links, so a third control cannot be parked there to
// escape the rule, and the marks are measured rather than merely skipped.
//
// The third and fourth are a name said inside a sentence and the word that
// follows it: `after Clara`, `a folio from bruno`, and `send thanks` at the end
// of that line. The standard exempts a target inside a line of text, and this
// file already exempts an inline link for the same reason two rules up. These
// two are buttons rather than links, which is the only difference, and the
// measurement that settled it is written at the foot of css/style.css: padding
// on them bought nothing a thumb could press, because an inline-block's padding
// overflows its line box and the paragraph beneath paints over it, and a band
// on them would hang across whatever shares the line.
const SKIP = ['.fm-sw a', '.leaflet-marker-icon', '.name-door', '.prov-do'];

// what each surface must actually have offered, so a surface that renders
// nothing cannot pass by having nothing to fail
const CENSUS = ['button.ix', '.ix-g', '.index-line button', '.index-go button',
  '.cmd-row', '.plate-words button', '.poster-x', '.word-btn',
  '.settings-door', '.set-disclosure > summary',
  '.fol-row', '.fb-all', '.fol-say', '.fol-acts .word-btn',
  '.rp-do .adopt', '.rp-foot .word-btn', '.corr-summary', '.corr-ctl .word-btn'];

// What every reading above cannot see: a row that has not wrapped yet.
//
// REACH measures what is on the screen, so a row of three words that fits on
// one line at this width, on this machine, in this font, reads perfectly and
// says nothing at all about the same row on a narrower glass or a wider face.
// That is not a hypothetical. `.rp-do`, the three words under every place a
// folio brings, was given a band each and no row gap, on the strength of a
// sweep of eight widths in three engines that never once found it wrapped.
// The sweep ran on a Mac. On the Linux that runs this suite the same three
// words break at three hundred and twenty, two bands ten pixels apart cut
// each other to twenty-six, and the reading came back `a.adopt.quiet 82x26`.
// Everything here was green for as long as nobody ran it anywhere else.
//
// So this asks the geometry instead of the layout: for every wrapping flex row
// holding two or more pressable things, the distance between one line and the
// next is the row gap plus the tallest thing on a line, and if that is under
// forty-four then two bands overlap the moment it wraps. It is the same
// question at every width, wrapped or not, on any machine.
const STACKS = ({ tall: TALL }) => {
  const CTRL = 'a,button,input,select,textarea,[role="button"]';
  const thin = [];
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    if (cs.display !== 'flex' || cs.flexWrap !== 'wrap') continue;
    const kids = [...el.children].filter((k) => {
      const b = k.getBoundingClientRect();
      return b.height > 0 && (k.matches(CTRL) || k.querySelector(CTRL));
    });
    if (kids.length < 2) continue;
    const gap = parseFloat(cs.rowGap) || 0;
    const high = Math.max(...kids.map((k) => k.getBoundingClientRect().height));
    const apart = Math.round(gap + high);
    if (apart >= TALL) continue;
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    thin.push(`${el.id ? '#' + el.id : el.tagName.toLowerCase()}${cls ? '.' + cls : ''} `
      + `${apart} apart (${Math.round(gap)} gap + ${Math.round(high)} tall)`);
  }
  return thin;
};

async function measure(page, where) {
  const r = await page.evaluate(REACH, { skip: SKIP, census: CENSUS, tall: TALL, wide: WIDE });
  expect(r.coarse, 'the touch emulation did not take, so nothing below was measured on a thumb').toBe(true);
  expect(r.counted, `${where} offered nothing to press, so this measured nothing`).toBeGreaterThan(0);
  expect(r.small, `${where}: a thumb is owed ${TALL} down and ${WIDE} across`).toEqual([]);
  const thin = await page.evaluate(STACKS, { tall: TALL });
  expect(thin, `${where}: a row that wraps would put two bands closer than ${TALL} apart`).toEqual([]);
  return r;
}

async function open(page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const pattern of OFF) await page.route(pattern, (r) => r.abort());
  await page.addInitScript(() => {
    const now = new Date().toISOString();
    localStorage.setItem('resonate.tags.v1', JSON.stringify([
      { id: 't1', name: 'Nature', hue: 155, color: '#4a7' },
      { id: 't2', name: 'Cafés', hue: 40, color: '#a74' },
    ]));
    localStorage.setItem('resonate.places.v1', JSON.stringify(
      Array.from({ length: 8 }, (_, i) => ({
        id: 'p' + i, name: 'Place ' + i, lat: 46 + i * 0.01, lng: 8 + i * 0.01,
        city: 'Basel', country: 'Switzerland', tags: i % 2 ? ['t1'] : ['t1', 't2'],
        status: i % 3 ? 'visited' : 'want', note: 'a note', createdAt: now, updatedAt: now,
      }))));
    // two voices, one of them off the field, so the room has both of the words
    // it can offer and the pair of them is what makes it wrap on a small phone
    localStorage.setItem('resonate.correspondents.v1', JSON.stringify([
      { id: 'c1', name: 'marta', addedAt: now, places: [], tags: [], visible: true },
      { id: 'c2', name: 'bruno', addedAt: now, places: [], tags: [], visible: false },
    ]));
    localStorage.setItem('resonate.settings.v1', JSON.stringify({
      theme: 'auto', chosen: true, seeded: true, introSeen: true, authorName: 'ada', hue: 300,
    }));
  });
  await page.goto('/');
  await expect(page.locator('#threshold')).toBeHidden();
  await expect(page.locator('#intro')).toBeHidden({ timeout: 15000 });
  await expect(page.locator('body')).toHaveAttribute('data-entry', /board|field/, { timeout: 15000 });
}

// A phone is most often held to do something, not to watch the door open. The
// cinematic arrival remains on a roomy pointer-first glass, while a touch-first
// visit lands directly on the useful choice. This is both the fastest possible
// phone path and one fewer small control to find before the app can be used.
test('a touch-first visit reaches a useful choice without an intro toll', async ({ page }) => {
  for (const pattern of OFF) await page.route(pattern, (r) => r.abort());
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => {
    localStorage.setItem('resonate.places.v1', '[]');
    localStorage.setItem('resonate.settings.v1', JSON.stringify({
      theme: 'auto', chosen: false, seeded: false, introSeen: false, authorName: '', hue: 300,
    }));
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#intro')).toBeHidden();
  await expect(page.locator('#threshold')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('#thEmpty')).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-entry', 'threshold');
  await expect(page.locator('body')).not.toHaveClass(/\bhero\b/);
  expect(await page.locator('#introCanvas').evaluate((canvas) => `${canvas.width}x${canvas.height}`),
    'the skipped phone intro still spent work sizing its canvas').toBe('300x150');
});

async function board(page) {
  if (await page.locator('#indexOverlay').isHidden()) await page.locator('#fmIndex').click();
  await expect(page.locator('#indexOverlay')).toBeVisible();
  // and wait for the rows to arrive, not merely for the board to. Every row
  // rises from nothing when the board opens (`.index.opening .ix`, css/style.css:845,
  // and a 120ms stand-in under reduced motion at :1404), so for the first tenth
  // of a second a row is a full-size rectangle at zero opacity — which this file
  // correctly declines to measure, and which therefore reads as a board with no
  // places on it. That is what the tablet tests were failing on: the geometry had
  // landed, the ink had not. Visible-to-Playwright is not the same question.
  await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('button.ix')]
    .slice(0, 4).every((el) => getComputedStyle(el).opacity === '1')),
  { message: 'the board\'s rows never finished arriving' }).toBe(true);
}

// Bring the list under the head of the board, and prove it landed before
// anything is measured. `scrollIntoViewIfNeeded` puts a row just barely on the
// glass, and this file deliberately measures nothing that stands within half a
// band of an edge — so a row scrolled to the very top counts as zero rows, and
// the board reads empty. It did exactly that once in a full suite run and
// never once when the file ran alone, which is the shape of a race rather than
// of a defect.
async function intoView(loc, what) {
  await expect(loc).toBeAttached();
  await loc.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await expect.poll(() => loc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.top > 46 && r.bottom < innerHeight - 46;
  }), { message: `${what} never came to rest clear of both edges` }).toBe(true);
}

async function rowsInView(page, n = 3) {
  await intoView(page.locator('button.ix').nth(n), 'the list');
}

// A verb typed into the command line, which is how every room in this app is
// reached by someone who knows it.
async function verb(page, word) {
  await page.keyboard.press('Escape');
  await page.locator('#fmCommand').click();
  await page.locator('#paletteInput').fill('>' + word);
  await expect(page.locator('.cmd-row').first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('.cmd').first()).toBeHidden();
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

// A folio somebody sent, opened. It is the one surface a person meets before
// they have an atlas of their own, and the only way to reach it is to arrive
// at its link, which is why this walks the payload builder rather than a room.
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
  await expect(page.locator('#reportOverlay')).toBeVisible({ timeout: 20000 });
}

async function field(page) {
  if (await page.locator('#indexOverlay').isVisible()) {
    await page.locator('#indexClose').click();
    await expect(page.locator('#indexOverlay')).toBeHidden();
  }
}

// no fixture at all: the threshold is what a first visit lands on, and it is
// the one screen in the app a person meets before they have chosen anything.
// Both a phone and a tablet, because its four doors are set in a clamp that
// grows with the width and its row gap is not.
for (const [w, h] of [[390, 844], [820, 1180]]) {
  test(`the first screen anybody sees gives a thumb its four doors at ${w}`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true });
    const page = await ctx.newPage();
    try {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      for (const pattern of OFF) await page.route(pattern, (r) => r.abort());
      await page.goto('/');
      await expect(page.locator('#threshold')).toBeVisible();
      const r = await measure(page, `the threshold at ${w}`);
      // four doors and the how word: a run that measured one of them has not
      // measured this screen
      expect(r.counted, 'the threshold offered fewer doors than it has').toBeGreaterThanOrEqual(4);
    } finally {
      await ctx.close();
    }
  });
}

test('the field gives a thumb every word in its chrome', async ({ page }) => {
  await open(page);
  await field(page);
  const r = await measure(page, 'the field');
  // and the exception stays two licence marks, exactly. anything else parked
  // under .fm-sw would leave the rule by the same door
  expect(r.skipped.filter((s) => s.startsWith('a ')), 'the corner the rule excuses is no longer two licence marks')
    .toEqual(['a "OSM"', 'a "CARTO"']);
});

// At 280px the command and the licence line still share the field's bottom
// edge. Both were individually large enough for a thumb while CARTO's
// invisible padding lay over the command's lower-left corner, so measuring
// either target alone could not see the defect. Their hit rectangles must be
// disjoint, and the command must own a point just inside that corner.
test('field attribution and search keep separate hitboxes at 280px', async ({ page }) => {
  await page.setViewportSize({ width: 280, height: 653 });
  await open(page);
  await field(page);

  const seen = await page.evaluate(() => {
    const command = document.querySelector('#fmCommand');
    const rect = command.getBoundingClientRect();
    const attributions = [...document.querySelectorAll('.fm-sw a')].map((link) => {
      const r = link.getBoundingClientRect();
      return {
        word: link.textContent.trim(),
        left: r.left, right: r.right, top: r.top, bottom: r.bottom,
        overlapWidth: Math.max(0, Math.min(rect.right, r.right) - Math.max(rect.left, r.left)),
        overlapHeight: Math.max(0, Math.min(rect.bottom, r.bottom) - Math.max(rect.top, r.top)),
      };
    });
    const owner = document.elementFromPoint(rect.left + 1, rect.bottom - 4);
    return {
      coarse: matchMedia('(pointer: coarse)').matches,
      command: {
        left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
        width: rect.width, height: rect.height,
      },
      attributions,
      cornerBelongsToCommand: owner === command || command.contains(owner),
    };
  });

  expect(seen.coarse, 'the 280px page was not using the thumb layout').toBe(true);
  expect(seen.command.width, 'search became narrower while moving clear of the attribution')
    .toBeGreaterThanOrEqual(WIDE);
  expect(seen.command.height, 'search became shorter while moving clear of the attribution')
    .toBeGreaterThanOrEqual(TALL);
  expect(seen.attributions.filter((a) => a.overlapWidth > 0 && a.overlapHeight > 0),
    `an attribution still crosses search: ${JSON.stringify(seen)}`).toEqual([]);
  expect(seen.cornerBelongsToCommand,
    `the command's lower-left corner belongs to something else: ${JSON.stringify(seen)}`).toBe(true);
});

test('a mark on the map is forty-four across and forty-four down', async ({ page }) => {
  await open(page);
  await field(page);
  const marks = await page.evaluate(() => [...document.querySelectorAll('.mark-icon')]
    .map((el) => { const r = el.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
  // the fixture stands eight places on the field, so a run that finds none has
  // measured nothing and must say so rather than pass
  expect(marks.length, 'the field carried no marks to measure').toBeGreaterThan(0);
  for (const [w, h] of marks) {
    expect(w, 'a mark is narrower than a thumb').toBeGreaterThanOrEqual(TALL);
    expect(h, 'a mark is shorter than a thumb').toBeGreaterThanOrEqual(TALL);
  }
});

test('the board gives a thumb its rows, its chips and its words', async ({ page }) => {
  await open(page);
  await board(page);
  // A board is two screens, not one: the three doors and the filter words at
  // its head, then the list. Both are measured, because only what stands
  // wholly on the glass is measured at all — a first pass alone counted three
  // rows on one engine and none on another, and would have been reporting how
  // tall a typeface renders rather than how big a target is.
  const head = (await measure(page, 'the head of the board')).seen;
  expect(head['.index-go button'], 'the board measured none of its three doors').toBeGreaterThanOrEqual(3);
  expect(head['.index-line button'], 'the board measured none of its filter words').toBeGreaterThanOrEqual(4);

  await rowsInView(page);
  const list = (await measure(page, 'the list on the board')).seen;
  expect(list['button.ix'], 'the board measured no place rows').toBeGreaterThanOrEqual(3);
  expect(list['.ix-g'], 'the board measured no chips under its rows').toBeGreaterThanOrEqual(4);
});

test('a place plate gives a thumb its two words and its tags', async ({ page }) => {
  await open(page);
  await board(page);
  await page.locator('button.ix').first().click();
  await expect(page.locator('#plate')).toBeVisible();
  const { seen } = await measure(page, 'a place plate');
  expect(seen['.plate-words button'], 'the plate measured neither been nor want to go').toBeGreaterThanOrEqual(2);
});

test('the command line gives a thumb its rows', async ({ page }) => {
  await open(page);
  await field(page);
  await page.locator('#fmCommand').click();
  await page.locator('#paletteInput').fill('a');
  await expect(page.locator('.cmd-row').first()).toBeVisible();
  const { seen } = await measure(page, 'the command line');
  expect(seen['.cmd-row'], 'the command line measured none of its rows').toBeGreaterThanOrEqual(3);
});

test('every poster gives a thumb its close word', async ({ page }) => {
  await open(page);
  await field(page);
  // the posters a person reaches by name, each opened from the command line
  for (const word of ['census', 'tags', 'yours', 'club', 'voices', 'how', 'letters', 'keys', 'folio']) {
    await verb(page, word);
    const { seen } = await measure(page, 'the ' + word + ' poster');
    expect(seen['.poster-x'], `the ${word} poster measured no close word`).toBe(1);
    if (word === 'yours') {
      expect(seen['.settings-door'], 'settings measured neither of its primary doors')
        .toBeGreaterThanOrEqual(2);
      expect(seen['.set-disclosure > summary'], 'settings measured no disclosure summary')
        .toBeGreaterThanOrEqual(1);
    }
  }
});

// The three rooms the first pass of this file never opened, and the reason it
// grew: a gate that measures the surfaces it happens to walk says nothing about
// the ones it does not, and every defect below was standing in plain sight
// while eleven tests passed. The composer is the longest list of presses in the
// app, the report is the first thing a stranger ever sees of it, and the voices
// room is where two words wrap into each other on a small phone.

test('the folio composer gives a thumb every row it asks about', async ({ page }) => {
  await open(page);
  await field(page);
  await verb(page, 'folio');
  await page.locator('#folNew').click();
  await expect(page.locator('.fol-row').first()).toBeVisible();
  const rows = (await measure(page, 'the folio composer')).seen;
  expect(rows['.fol-row'], 'the composer measured none of its rows').toBeGreaterThanOrEqual(3);

  // Primary save and share actions are now held above the long selection list.
  // The first city heading consequently sits below the initial glass instead
  // of competing with the decisions that finish the list, so measure it where
  // it actually stands rather than making viewport order an accessibility rule.
  await intoView(page.locator('.fb-all').first(), 'the composer’s first city heading');
  const bands = (await measure(page, 'a city heading in the folio composer')).seen;
  expect(bands['.fb-all'], 'the composer measured no city heading').toBeGreaterThanOrEqual(1);

  // the sentence under a place, which only exists once the place is in: it is
  // a second control standing directly under the first, and a fresh composer
  // has nothing in it, so a run that never presses a row never sees it
  await page.locator('.fol-row').first().click();
  await expect(page.locator('.fol-say').first()).toBeVisible();
  const said = (await measure(page, 'a place that is in the folio')).seen;
  expect(said['.fol-say'], 'the composer measured no line to say something on').toBeGreaterThanOrEqual(1);

  // and the doors at the end of it, which on a phone are two screens down
  await intoView(page.locator('#folKeep'), 'the composer’s doors');
  const acts = (await measure(page, 'the foot of the folio composer')).seen;
  expect(acts['.fol-acts .word-btn'], 'the composer measured none of its doors').toBeGreaterThanOrEqual(2);
});

test('a folio that arrives gives a thumb the words under a place', async ({ page }) => {
  await open(page);
  await field(page);
  await aFolioArrives(page);
  await intoView(page.locator('.rp-do').first(), 'the words under a place');
  const picks = (await measure(page, 'a folio somebody sent')).seen;
  expect(picks['.rp-do .adopt'], 'the report measured none of the words under a place').toBeGreaterThanOrEqual(2);

  await intoView(page.locator('#rpGeo'), 'the report’s advanced doors');
  const foot = (await measure(page, 'the foot of a report')).seen;
  expect(foot['.rp-foot .word-btn'], 'the report measured none of its doors').toBeGreaterThanOrEqual(2);
});

test('the contacts room gives a thumb its overview and actions', async ({ page }) => {
  await open(page);
  await field(page);
  await verb(page, 'voices');
  const overview = (await measure(page, 'the contacts overview')).seen;
  expect(overview['.corr-summary'], 'the contacts room measured no disclosure row').toBeGreaterThanOrEqual(1);
  await page.locator('.corr-row > summary').first().click();
  await intoView(page.locator('.corr-ctl').first(), 'the words under a contact');
  const { seen } = await measure(page, 'the voices room');
  expect(seen['.corr-ctl .word-btn'], 'the contacts room measured none of its actions').toBeGreaterThanOrEqual(1);
});

// Three hundred and twenty, which is the narrowest glass anybody still carries
// and the width where every row that can wrap does. It earns its place because
// two rules exist for it alone: the three words under a place in a report break
// onto two lines here and nowhere else, and so do the two words under a voice.
// Both read right at three hundred and ninety, which is why a gate that stopped
// at one phone width held neither of them.
test('a phone 320 wide is where the words wrap first', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 320, height: 568 }, hasTouch: true });
  const page = await ctx.newPage();
  try {
    await open(page);
    await field(page);
    await verb(page, 'voices');
    const overview = (await measure(page, 'the contacts overview at 320')).seen;
    expect(overview['.corr-summary'], 'the contacts room at 320 measured no disclosure row')
      .toBeGreaterThanOrEqual(1);
    await page.locator('.corr-row > summary').first().click();
    await intoView(page.locator('.corr-ctl').first(), 'the words under a voice');
    const voices = (await measure(page, 'the voices room at 320')).seen;
    expect(voices['.corr-ctl .word-btn'], 'the contacts room at 320 measured no action')
      .toBeGreaterThanOrEqual(1);

    await aFolioArrives(page);
    await intoView(page.locator('.rp-do').first(), 'the words under a place at 320');
    const picks = (await measure(page, 'a folio somebody sent, at 320')).seen;
    expect(picks['.rp-do .adopt'], 'the report at 320 measured none of the words under a place')
      .toBeGreaterThanOrEqual(2);
  } finally {
    await ctx.close();
  }
});

// A tablet is a thumb on a wide screen, and it is the case a width query gets
// exactly backwards: at 820 and at 1280 the app is in its two-column dress,
// the coordinates in the south-east corner are no longer hidden, and the
// pointer is still a finger. Both widths, because 820 and 1280 sit on opposite
// sides of every breakpoint this stylesheet has above 761.
for (const [w, h] of [[820, 1180], [1280, 800]]) {
  test(`a tablet ${w} wide is a thumb too`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true });
    const page = await ctx.newPage();
    try {
      await open(page);
      await field(page);
      const chrome = await measure(page, `the field at ${w}`);
      // the corner this width uncovers and a phone never shows
      expect(chrome.counted, `the field at ${w} measured nothing`).toBeGreaterThan(2);

      await board(page);
      await rowsInView(page);
      const list = (await measure(page, `the board at ${w}`)).seen;
      expect(list['button.ix'], `the board at ${w} measured no place rows`).toBeGreaterThanOrEqual(3);

      await page.locator('button.ix').first().click();
      await expect(page.locator('#plate')).toBeVisible();
      await measure(page, `a place plate at ${w}`);

      await page.keyboard.press('Escape');
      for (const word of ['yours', 'voices', 'tags']) {
        await verb(page, word);
        const seen = (await measure(page, `the ${word} poster at ${w}`)).seen;
        expect(seen['.poster-x'], `the ${word} poster at ${w} measured no close word`).toBe(1);
      }

      // The two rooms that fail here and nowhere else. A word-button on a
      // tablet does not carry the padding a phone gives it, so it stands
      // twenty-one pixels tall, and the fourteen-pixel row gap under
      // `.fol-acts` and `.rp-foot` then put two bands eleven pixels into each
      // other. Both read right on a phone the whole time.
      await verb(page, 'folio');
      await page.locator('#folNew').click();
      await expect(page.locator('.fol-row').first()).toBeVisible();
      await intoView(page.locator('#folKeep'), `the composer’s doors at ${w}`);
      const acts = (await measure(page, `the foot of the composer at ${w}`)).seen;
      expect(acts['.fol-acts .word-btn'], `the composer at ${w} measured none of its doors`).toBeGreaterThanOrEqual(2);

      await aFolioArrives(page);
      const picks = (await measure(page, `a folio somebody sent, at ${w}`)).seen;
      expect(picks['.rp-do .adopt'], `the report at ${w} measured none of the words under a place`).toBeGreaterThanOrEqual(2);
      await intoView(page.locator('#rpGeo'), `the report’s advanced doors at ${w}`);
      const foot = (await measure(page, `the foot of a report at ${w}`)).seen;
      expect(foot['.rp-foot .word-btn'], `the report at ${w} measured none of its doors`).toBeGreaterThanOrEqual(2);
    } finally {
      await ctx.close();
    }
  });
}

// And the other direction, which is what stops the tier from being written as
// a phone-width rule by the next person to touch it: a mouse keeps the density
// it had. Without this, `@media (max-width: 760px)` would pass every test above
// and quietly cost a laptop a third of its board.
//
// It is measured with the same walk and not with a rectangle. A first attempt
// here read `getBoundingClientRect().height` on a board row and asserted it
// stayed under forty-four, which was true either way: the whole point of a
// band is that it does not change the rectangle. So the test passed with the
// tier written as a width query, which is precisely the mistake it exists to
// catch. Rewriting the tier as `max-width: 760px` now fails it.
test('a mouse is not given a thumb\'s room', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: false });
  const page = await ctx.newPage();
  try {
    await open(page);
    await board(page);
    const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
    expect(coarse, 'a context without touch reported a coarse pointer').toBe(false);
    await rowsInView(page);
    const r = await page.evaluate(REACH, { skip: SKIP, census: CENSUS, tall: TALL, wide: WIDE });
    expect(r.coarse, 'a context without touch matched the coarse tier').toBe(false);
    expect(r.seen['button.ix'], 'the mouse board measured no place rows').toBeGreaterThanOrEqual(3);
    // the rows are the reading: a board row is thirty-five pixels tall to a
    // mouse and forty-six to a thumb, and this is the only test in the file
    // that wants the smaller number
    const rows = r.small.filter((line) => line.startsWith('button.ix '));
    expect(rows.length, 'a mouse was handed the thumb tier: the board rows measured forty-four')
      .toBeGreaterThanOrEqual(3);
  } finally {
    await ctx.close();
  }
});
