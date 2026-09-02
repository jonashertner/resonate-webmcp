// structural-design.spec.mjs — the product promise, held to the interface.
//
// These are structural contracts rather than screenshots. Resonate may keep
// changing its composition, typography and motion; the person using it must
// still be told about all three kinds of thing, be able to add and find each
// one without knowing a command dialect, and never mistake an example atlas
// for their own.

import { test, expect } from '@playwright/test';

const OFF = [
  '**://*.cartocdn.com/**',
  '**://*.openstreetmap.org/**',
  '**://tile.**',
  '**://photon.komoot.io/**',
];

const API_HOSTS = ['photon.komoot.io', 'nominatim.openstreetmap.org'];

async function cutTheWorld(page) {
  for (const pattern of OFF) await page.route(pattern, route => route.abort());
  // page.route does not see every service-worker fetch in every engine. Keep
  // local-search claims local by cutting the two API hosts inside the page as
  // well, using the same boundary as the larger atlas suite.
  await page.addInitScript((hosts) => {
    const real = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const href = typeof input === 'string' ? input : input?.url;
      let url = null;
      try { url = new URL(href, location.href); } catch { /* not a URL */ }
      if (url && hosts.includes(url.host)) {
        return Promise.reject(new TypeError('the world is cut in this test'));
      }
      return real(input, init);
    };
  }, API_HOSTS);
}

async function firstVisit(page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await cutTheWorld(page);
  await page.goto('/');
  const threshold = page.getByRole('dialog').filter({
    has: page.getByRole('button', { name: /(?:start with an empty atlas|keep your first thing|start with one place)/i }),
  });
  await expect(threshold).toBeVisible({ timeout: 5000 });
  return threshold;
}

async function seedReturningAtlas(page, { watchIntro = false } = {}) {
  await cutTheWorld(page);
  await page.addInitScript(({ observeIntro }) => {
    const now = new Date().toISOString();
    localStorage.setItem('resonate.places.v1', JSON.stringify([{
      id: 'p-home', name: 'The Reading Room', lat: 46.5, lng: 8.5,
      city: 'Basel', country: 'Switzerland', tags: ['t-culture'],
      status: 'visited', note: '', createdAt: now, updatedAt: now,
    }]));
    localStorage.setItem('resonate.routes.v1', JSON.stringify([{
      id: 'r-home', name: 'The River Path',
      path: [{ lat: 46.5, lng: 8.5 }, { lat: 46.51, lng: 8.51 }],
      tags: ['t-culture'], status: 'walked', createdAt: now, updatedAt: now,
    }]));
    localStorage.setItem('resonate.books.v1', JSON.stringify([{
      id: 'b-home', title: 'Invisible Cities', author: 'Italo Calvino',
      tags: ['t-culture'], status: 'visited', createdAt: now, updatedAt: now,
    }]));
    localStorage.setItem('resonate.tags.v1', JSON.stringify([{
      id: 't-culture', name: 'Culture', hue: 155, color: '#4a7',
    }]));
    localStorage.setItem('resonate.settings.v1', JSON.stringify({
      theme: 'auto', chosen: true, seeded: true, introSeen: true,
      authorName: 'ada', hue: 300,
    }));

    if (!observeIntro) return;
    window.__resonateIntroRaised = false;
    const see = () => {
      const intro = document.querySelector('#intro');
      if (intro && !intro.hidden) window.__resonateIntroRaised = true;
    };
    new MutationObserver(see).observe(document, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: ['hidden'],
    });
    document.addEventListener('DOMContentLoaded', see, { once: true });
  }, { observeIntro: watchIntro });
}

async function openSearch(page) {
  // Navigation can finish while the async store boot is still deciding which
  // returning surface to raise. Wait for that decision before touching it:
  // on a loaded Firefox runner an eager Escape could otherwise arrive before
  // the app had installed its controls, leaving the atlas over the search
  // door. This helper is about search, so close that surface through its own
  // word rather than coupling every search contract to Escape timing.
  await expect(page.locator('body')).toHaveAttribute(
    'data-entry', /^(?:board|field|letter|threshold)$/, { timeout: 15000 },
  );
  const atlas = page.locator('#indexOverlay');
  if (await atlas.isVisible()) {
    await atlas.locator('#indexClose').click();
    await expect(atlas).toBeHidden();
  }
  const searchDoor = page.getByRole('button', { name: /search/i }).first();
  await expect(searchDoor).toBeVisible();
  await searchDoor.click();
  const search = page.getByRole('searchbox');
  await expect(search).toBeVisible();
  return search;
}

function typedResult(page, type, title) {
  const a = `${title}.*${type}`;
  const b = `${type}.*${title}`;
  return page.getByRole('button', { name: new RegExp(`(?:${a}|${b})`, 'i') });
}

async function collectionLeadLayout(page) {
  return page.locator('#reportOverlay').evaluate((root) => {
    root.scrollTop = 0;
    const lead = root.querySelector('.rp-lead');
    const first = root.querySelector('.rp-case .rp-pick');
    const records = [...root.querySelectorAll('.rp-case .rp-pick')];
    const footer = root.querySelector('.rp-folio-foot');
    const actions = [...root.querySelectorAll('.rp-lead-actions .word-btn')]
      .map(button => button.getBoundingClientRect());
    const box = root.getBoundingClientRect();
    const viewportTop = Math.max(0, box.top);
    const viewportBottom = Math.min(innerHeight, box.bottom);
    return {
      actions: actions.length,
      actionsAboveRecords: !!lead && !!first
        && lead.getBoundingClientRect().bottom <= first.getBoundingClientRect().top + 1,
      actionsInFirstView: actions.every(r => r.top >= viewportTop - 1 && r.bottom <= viewportBottom + 1),
      footerAfterRecords: !!footer && !!records.length
        && !!(records.at(-1).compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING),
    };
  });
}

test('the first promise leads with trusted recommendations and names every record kind', async ({ page }) => {
  const threshold = await firstVisit(page);
  const promise = threshold.getByRole('heading', { level: 1 });
  await expect(promise).toContainText(/assistant.*recommendations.*people.*trust/i);
  await expect(threshold).toContainText(/private atlas.*places.*paths.*books/i);
});

test('an empty start offers a visible door for every kind', async ({ page }) => {
  const threshold = await firstVisit(page);
  await threshold.getByRole('button', {
    name: /(?:start with an empty atlas|keep your first thing|start with one place)/i,
  }).click();

  // Singular, literal labels are deliberate: these are capture choices, not
  // filters or destinations elsewhere in the atlas.
  await expect(page.getByRole('button', { name: 'Place', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Path', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Book', exact: true })).toBeVisible();
});

test('the atlas navigation gives each kind an address', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seedReturningAtlas(page);
  await page.goto('/');

  // A segmented filter is one grouped choice, not four page navigations. Its
  // accessible name is the stable boundary; typography may keep it looking
  // like the rest of the atlas rather than like conventional tabs.
  const atlas = page.getByRole('group', { name: /atlas/i });
  await expect(atlas).toBeVisible({ timeout: 5000 });
  for (const name of ['All', 'Places', 'Paths', 'Books']) {
    // Counts may ride in the accessible name after the label.
    await expect(atlas.getByRole('button', {
      name: new RegExp(`^${name}\\b`, 'i'),
    })).toBeVisible();
  }
});

test('exploring the example does not silently make it personal', async ({ page }) => {
  const threshold = await firstVisit(page);
  await threshold.getByRole('button', {
    name: /(?:explore|preview|try).*(?:ready-made|example).*atlas/i,
  }).click();

  const counts = await page.evaluate(() => {
    const count = key => {
      try { return JSON.parse(localStorage.getItem(key) || '[]').length; }
      catch { return -1; }
    };
    return {
      places: count('resonate.places.v1'),
      paths: count('resonate.routes.v1'),
      books: count('resonate.books.v1'),
      contacts: count('resonate.correspondents.v1'),
    };
  });
  expect(counts, 'opening a preview wrote starter records into the personal atlas')
    .toEqual({ places: 0, paths: 0, books: 0, contacts: 0 });

  // A preview can become personal, but only behind a second, explicit act.
  await expect(page.getByRole('button', { name: 'Use as my atlas', exact: true }))
    .toBeVisible();

  // The map is another view of the same sandbox, not a semantic reset. Coming
  // back through the visible letter must still require the explicit adoption.
  await page.getByRole('button', { name: /explore on map/i }).click();
  await page.getByRole('button', { name: /the letter/i }).click();
  await expect(page.getByRole('dialog', { name: 'Example atlas', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use as my atlas', exact: true }))
    .toBeVisible();
});

test('collection reports lead with safe choices on a 390 by 844 phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const threshold = await firstVisit(page);
  await threshold.getByRole('button', {
    name: /(?:explore|preview|try).*(?:ready-made|example).*atlas/i,
  }).click();

  const report = page.getByRole('dialog', { name: 'Example atlas', exact: true });
  await expect(report).toBeVisible();
  await expect(report.locator('.rp-safety')).toHaveText('Nothing will be added until you choose.');
  for (const name of ['Explore on map', 'Use as my atlas', 'Start empty']) {
    await expect(report.getByRole('button', { name, exact: true })).toBeVisible();
  }
  expect(await collectionLeadLayout(page), 'the example made its inventory precede the decision')
    .toEqual({ actions: 3, actionsAboveRecords: true, actionsInFirstView: true, footerAfterRecords: true });

  const totals = await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const { demoData } = await import(`/js/store.js${v}`);
    const demo = demoData();
    return { places: demo.places.length, paths: demo.routes.length, books: demo.books.length };
  });
  expect(totals.places).toBeGreaterThan(3);
  expect(totals.books).toBeGreaterThan(3);
  for (const name of ['Places', 'Paths', 'Books']) {
    await expect(report.getByRole('heading', { level: 2, name, exact: true })).toBeVisible();
  }
  await expect(report.locator('[data-report-kind="places"] > [data-report-place]')).toHaveCount(3);
  await expect(report.locator('[data-report-kind="paths"] > [data-report-path]')).toHaveCount(totals.paths);
  await expect(report.locator('[data-report-kind="books"] > [data-report-book]')).toHaveCount(3);
  await expect(report.locator('[data-thank]'), 'the app offered to thank itself for its own example')
    .toHaveCount(0);

  const morePlaces = report.locator('details[data-report-more="places"]');
  await morePlaces.getByText(`View all ${totals.places} places`, { exact: true }).click();
  await expect(morePlaces).toHaveAttribute('open', '');
  await expect(morePlaces.locator('[data-report-place]')).toHaveCount(totals.places - 3);
  await expect(morePlaces.locator('[data-report-place]').last()).toBeVisible();

  const moreBooks = report.locator('details[data-report-more="books"]');
  await moreBooks.getByText(`View all ${totals.books} books`, { exact: true }).click();
  await expect(moreBooks).toHaveAttribute('open', '');
  await expect(moreBooks.locator('[data-report-book]')).toHaveCount(totals.books - 3);
  await expect(moreBooks.locator('[data-report-book]').last()).toBeVisible();
  await expect(report.locator('[data-thank]')).toHaveCount(0);

  // Starting empty is one of the lead decisions, not merely a way to dismiss
  // the example. It opens the first capture choice and keeps every sample out.
  await report.getByRole('button', { name: 'Start empty', exact: true }).click();
  await expect(page.locator('#paletteOverlay')).toBeVisible();
  expect(await page.evaluate(() => ({
    places: JSON.parse(localStorage.getItem('resonate.places.v1') || '[]').length,
    paths: JSON.parse(localStorage.getItem('resonate.routes.v1') || '[]').length,
    books: JSON.parse(localStorage.getItem('resonate.books.v1') || '[]').length,
  }))).toEqual({ places: 0, paths: 0, books: 0 });

  const incoming = await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const { demoData } = await import(`/js/store.js${v}`);
    const { makeFolioUrl } = await import(`/js/share.js${v}`);
    const demo = demoData();
    return makeFolioUrl({
      title: 'A small collection', dedication: 'Preview first', author: 'Marta',
      tags: demo.tags, places: demo.places.slice(0, 5), routes: demo.routes.slice(0, 1),
      books: demo.books.slice(0, 5),
    });
  });
  await page.goto('about:blank');
  await page.goto(incoming);

  const received = page.getByRole('dialog', { name: 'Shared collection', exact: true });
  await expect(received).toBeVisible({ timeout: 20000 });
  await expect(received.locator('.rp-safety'))
    .toHaveText('Nothing has been added. Preview it, or save only what you want.');
  await expect(received.getByRole('button', { name: 'Preview on map', exact: true })).toBeVisible();
  await expect(received.getByRole('button', { name: 'Save all 11', exact: true })).toBeVisible();
  await expect(received.locator('[data-report-kind="places"] > [data-report-place]')).toHaveCount(5);
  await expect(received.locator('[data-report-kind="paths"] > [data-report-path]')).toHaveCount(1);
  await expect(received.locator('[data-report-kind="books"] > [data-report-book]')).toHaveCount(5);
  await expect(received.locator('.rp-more')).toHaveCount(0);
  await expect(received.locator('[data-thank]')).toHaveCount(5);
  expect(await collectionLeadLayout(page), 'the received collection hid its preview and save choices')
    .toEqual({ actions: 3, actionsAboveRecords: true, actionsInFirstView: true, footerAfterRecords: true });

  const duplicateIds = await received.evaluate(root => {
    const seen = new Set();
    return [...root.querySelectorAll('[id]')].map(node => node.id)
      .filter(id => seen.has(id) || !seen.add(id));
  });
  expect(duplicateIds, 'a collection rendered the same action more than once').toEqual([]);

  await received.locator('[data-adopt="0"]').click();
  await expect.poll(() => page.evaluate(() =>
    JSON.parse(localStorage.getItem('resonate.places.v1') || '[]').length))
    .toBe(1);
  await expect(received.locator('[data-adopt]')).toHaveCount(4);
});

test('collection reports use wide screens for comparison and decision, not empty margins', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  const threshold = await firstVisit(page);
  await threshold.getByRole('button', {
    name: /(?:explore|preview|try).*(?:ready-made|example).*atlas/i,
  }).click();

  const layout = await page.locator('#reportOverlay').evaluate((root) => {
    const facts = [...root.querySelectorAll('.rp-folio-head .rp-evidence li')]
      .map(item => item.getBoundingClientRect());
    const lead = root.querySelector('.rp-lead').getBoundingClientRect();
    const safety = root.querySelector('.rp-safety').getBoundingClientRect();
    const actions = root.querySelector('.rp-lead-actions').getBoundingClientRect();
    const first = root.querySelector('.rp-pick').getBoundingClientRect();
    return {
      factColumns: new Set(facts.map(rect => Math.round(rect.left))).size,
      leadWidth: lead.width,
      actionsFollowSafety: actions.left >= safety.right - 1,
      firstRecordInView: first.top < innerHeight,
      sideways: root.scrollWidth - root.clientWidth,
    };
  });
  expect(layout.factColumns, 'summary facts remained a narrow vertical list').toBe(4);
  expect(layout.leadWidth, 'the decision band did not use the available width').toBeGreaterThan(900);
  expect(layout.actionsFollowSafety, 'actions did not share the decision band with its safety promise').toBe(true);
  expect(layout.firstRecordInView, 'wide-screen composition still hid every record below the fold').toBe(true);
  expect(layout.sideways, 'wide-screen composition introduced horizontal scrolling').toBeLessThanOrEqual(1);
});

test('the Collections example door previews before it writes', async ({ page }) => {
  const threshold = await firstVisit(page);
  await threshold.getByRole('button', {
    name: /(?:start with an empty atlas|keep your first thing|start with one place)/i,
  }).click();
  await page.getByRole('button', { name: 'close', exact: true }).click();
  await page.getByRole('button', { name: /open your atlas/i }).click();
  await page.getByRole('button', { name: /^collections\b/i }).click();
  await page.getByRole('button', { name: 'create a collection', exact: true }).click();
  await page.getByRole('button', { name: /example atlas/i }).click();

  await expect(page.getByRole('dialog', { name: 'Example atlas', exact: true })).toBeVisible();
  const count = key => page.evaluate(k => JSON.parse(localStorage.getItem(k) || '[]').length, key);
  await expect.poll(() => count('resonate.places.v1')).toBe(0);
  await expect.poll(() => count('resonate.routes.v1')).toBe(0);
  await expect.poll(() => count('resonate.books.v1')).toBe(0);
});

test('a book-only backup returns to the mixed atlas and says what came home', async ({ page }) => {
  const threshold = await firstVisit(page);
  await threshold.getByRole('button', { name: /restore from a backup file/i }).click();
  const now = new Date().toISOString();
  const archive = {
    app: 'resonate', version: 7, exportedAt: now,
    tags: [], places: [], routes: [], folios: [], correspondents: [], settings: {},
    books: [{
      id: 'b-restored', title: 'A Sand County Almanac', author: 'Aldo Leopold',
      year: '1949', tags: [], status: 'wishlist', note: '', url: '',
      createdAt: now, updatedAt: now,
    }],
  };
  await page.locator('#importFile').setInputFiles({
    name: 'resonate-atlas.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(archive)),
  });

  await expect(page.getByRole('dialog', { name: 'Your atlas', exact: true })).toBeVisible();
  await expect(page.locator('#ixWays')).toContainText('1 book');
  await expect(page.locator('#toast')).toContainText('1 book is home');
});

test('global search finds an adopted example path and book', async ({ page }) => {
  const threshold = await firstVisit(page);
  await threshold.getByRole('button', {
    name: /(?:explore|preview|try).*(?:ready-made|example).*atlas/i,
  }).click();
  const adopt = page.getByRole('button', { name: 'Use as my atlas', exact: true });
  await expect(adopt).toBeVisible();
  await adopt.click();

  await expect.poll(() => page.evaluate(() => ({
    hasPath: JSON.parse(localStorage.getItem('resonate.routes.v1') || '[]').length > 0,
    hasBook: JSON.parse(localStorage.getItem('resonate.books.v1') || '[]').length > 0,
  })), { message: 'the explicit adoption did not make the example available' })
    .toEqual({ hasPath: true, hasBook: true });

  const search = await openSearch(page);
  await search.fill('Moiry');
  await expect(typedResult(page, 'path', 'Col de Sorebois to the Moiry hut')).toBeVisible();

  await search.fill('Invisible Cities');
  await expect(typedResult(page, 'book', 'Invisible Cities')).toBeVisible();
});

test('a returning reload does not replay the intro', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await seedReturningAtlas(page, { watchIntro: true });
  await page.goto('/');
  await page.waitForFunction(() => !!document.body.dataset.entry, null, { timeout: 15000 });

  // A reload is a new document, so the init script installs a fresh observer
  // before the app starts again. The flag remembers even a one-frame replay.
  await page.reload();
  await page.waitForFunction(() => !!document.body.dataset.entry, null, { timeout: 15000 });
  const replayed = await page.evaluate(() => window.__resonateIntroRaised);
  expect(replayed, 'the branded intro rose over a returning atlas').toBe(false);
});

test('the visible command list contains canonical words, not legacy aliases', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seedReturningAtlas(page);
  await page.goto('/');
  const search = await openSearch(page);
  await search.fill('>');

  for (const canonical of ['settings', 'collections', 'people', 'book', 'path']) {
    await expect(page.getByRole('button', {
      name: new RegExp(`^>\\s*${canonical}\\b`, 'i'),
    })).toBeVisible();
  }

  const legacy = [
    'you', 'yours', 'kept', 'contacts', 'voices', 'list', 'lists',
    'folio', 'folios', 'census', 'full', 'fill',
  ];
  const exposed = [];
  for (const alias of legacy) {
    const row = page.getByRole('button', {
      name: new RegExp(`^>\\s*${alias}\\b`, 'i'),
    });
    if (await row.count()) exposed.push(alias);
  }
  expect(exposed, 'legacy aliases were presented as separate commands').toEqual([]);
});
