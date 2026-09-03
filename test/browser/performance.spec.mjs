// performance.spec.mjs — the fast path stays the fast path.
//
// These are structural interaction contracts rather than volatile wall-clock
// benchmarks. They hold the work that caused the measured delay: a phone must
// not composite the live map beneath a room, hidden atlas work waits for the
// next opening, and closing one place must not rebuild every marker.

import { test, expect } from '@playwright/test';

test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

async function ready(page) {
  for (const pattern of [
    '**://*.cartocdn.com/**',
    '**://*.openstreetmap.org/**',
    '**://tile.**',
    '**://photon.komoot.io/**',
  ]) await page.route(pattern, route => route.abort());

  await page.addInitScript(() => {
    const now = new Date().toISOString();
    localStorage.setItem('resonate.places.v1', JSON.stringify([
      {
        id: 'p-alpha', name: 'Alpha Room', lat: 46.52, lng: 7.58,
        city: 'Basel', country: 'Switzerland', tags: [], status: 'visited',
        note: '', createdAt: now, updatedAt: now,
      },
      {
        id: 'p-beta', name: 'Beta Room', lat: 35.68, lng: 139.76,
        city: 'Tokyo', country: 'Japan', tags: [], status: 'wishlist',
        note: '', createdAt: now, updatedAt: now,
      },
    ]));
    for (const key of ['resonate.routes.v1', 'resonate.books.v1', 'resonate.tags.v1']) {
      localStorage.setItem(key, '[]');
    }
    localStorage.setItem('resonate.settings.v1', JSON.stringify({
      theme: 'auto', chosen: true, seeded: true, introSeen: true,
      indexSeen: true, authorName: 'ada', hue: 300,
    }));
  });

  await page.goto('/');
  await expect(page.locator('#intro')).toBeHidden({ timeout: 15000 });
  await expect(page.locator('#fmIndex')).toBeVisible();
  // A returning atlas may choose the board as its first room. Each test begins
  // on the field so the opening it observes is the gesture under test. Wait
  // for the app's own settled-entry signal before asking which room won: the
  // field chrome can paint a frame before a slower browser raises the board.
  await expect(page.locator('body')).toHaveAttribute('data-entry', /board|field/, {
    timeout: 15000,
  });
  if (await page.locator('#indexOverlay').isVisible()) {
    await page.locator('#indexClose').click();
    await expect(page.locator('#indexOverlay')).toBeHidden();
  }
}

test('a mobile atlas rests promptly and reopens on the current store', async ({ page }) => {
  await ready(page);
  await page.locator('#fmIndex').click();
  const board = page.locator('#indexOverlay');
  await expect(board).toBeVisible();

  const surface = await board.evaluate((el) => {
    const style = getComputedStyle(el);
    const motion = el.getAnimations({ subtree: true }).map((animation) => {
      const timing = animation.effect?.getComputedTiming?.() || {};
      return Number(timing.delay || 0) + Number(timing.duration || 0);
    });
    return {
      backdrop: style.backdropFilter || style.webkitBackdropFilter,
      longest: Math.max(0, ...motion.filter(Number.isFinite)),
    };
  });
  expect(surface.backdrop).toBe('none');
  expect(surface.longest, 'a repeated surface keeps moving after half a second')
    .toBeLessThanOrEqual(500);

  await expect(board).not.toHaveClass(/\bopening\b/, { timeout: 1200 });
  await page.locator('#indexClose').click();
  // Writes can arrive from an assistant or another module while the board is
  // closed. They owe no hidden DOM work, but the next opening must be exact.
  await page.evaluate(async () => {
    const v = new URL(document.querySelector('script[type=module]').src).search;
    const { store, newRoute } = await import(`/js/store.js${v}`);
    store.load();
    store.addRoute(newRoute({
      id: 'r-latest', name: 'Latest Path', status: 'walked',
      path: [{ lat: 46.5, lng: 8.5 }, { lat: 46.51, lng: 8.51 }],
    }));
  });
  await page.locator('#fmIndex').click();
  await expect(board).toBeVisible();
  await expect(page.locator('#listView [data-rid="r-latest"]')).toBeVisible();
});

test('closing one place keeps every other map marker alive', async ({ page }) => {
  await ready(page);
  // Select on the field itself: an index row deliberately flies to its place,
  // and an unrelated off-screen marker leaving the viewport during that flight
  // says nothing about whether closing the plate rebuilt it.
  await page.locator('.leaflet-marker-icon[aria-label^="Alpha Room"]').click();
  await expect(page.locator('#plate')).toBeVisible();

  const other = await page.locator('.leaflet-marker-icon[aria-label^="Beta Room"]').elementHandle();
  expect(other, 'the second marker never reached the field').toBeTruthy();
  await page.locator('#pClose').click();
  await expect(page.locator('#plate')).toBeHidden();
  expect(await page.evaluate((marker) => marker === document.querySelector('.leaflet-marker-icon[aria-label^="Beta Room"]'), other),
    'closing one place rebuilt unrelated markers').toBe(true);
});

test('a low-zoom pan does not rebuild stable tooltip registrations', async ({ page }) => {
  await ready(page);
  const churn = await page.evaluate(async () => {
    const release = new URL(document.querySelector('script[type="module"]').src).search;
    const mapView = await import(`/js/map.js${release}`);
    const field = mapView.getMap();
    const settle = async (center) => {
      const moved = new Promise(resolve => field.once('moveend', resolve));
      field.setView(center, 4, { animate: false });
      await moved;
    };

    await settle([46.52, 7.58]);
    const proto = L.Marker.prototype;
    const originalBind = proto.bindTooltip;
    const originalUnbind = proto.unbindTooltip;
    let binds = 0;
    let unbinds = 0;
    proto.bindTooltip = function countedBind(...args) {
      binds += 1;
      return originalBind.apply(this, args);
    };
    proto.unbindTooltip = function countedUnbind(...args) {
      unbinds += 1;
      return originalUnbind.apply(this, args);
    };
    try {
      await settle([47.10, 8.20]);
      return { binds, unbinds };
    } finally {
      proto.bindTooltip = originalBind;
      proto.unbindTooltip = originalUnbind;
    }
  });
  expect(churn, 'a low-zoom pan rebuilt marker tooltips').toEqual({ binds: 0, unbinds: 0 });
});

test('landscape phones and tablets keep full-screen rooms compositor-light', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await ready(page);
  await page.locator('#fmIndex').click();
  const board = page.locator('#indexOverlay');
  await expect(board).toBeVisible();
  expect(await board.evaluate((el) => {
    const style = getComputedStyle(el);
    return style.backdropFilter || style.webkitBackdropFilter;
  })).toBe('none');

  await page.locator('[data-go="you"]').click();
  const room = page.locator('#settingsOverlay');
  await expect(room).toBeVisible();
  const state = await room.evaluate((el) => {
    const style = getComputedStyle(el);
    const layoutMotion = el.getAnimations({ subtree: true })
      .map(animation => animation.animationName)
      .filter(name => name === 'poster-yield' || name === 'head-tighten');
    const bodyMotion = el.querySelector('.poster-body').getAnimations()
      .map(animation => animation.animationName);
    return {
      backdrop: style.backdropFilter || style.webkitBackdropFilter,
      layoutMotion,
      bodyMotion,
    };
  });
  expect(state.backdrop).toBe('none');
  expect(state.layoutMotion).toEqual([]);
  expect(state.bodyMotion, 'the useful room content waits behind a staggered reveal').toEqual([]);
});

test('a reduced-motion tablet has no scroll-driven title layout', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page);
  await page.locator('#fmIndex').click();
  await page.locator('[data-go="you"]').click();
  const room = page.locator('#settingsOverlay');
  await expect(room).toBeVisible();
  expect(await room.evaluate((el) => el.getAnimations({ subtree: true })
    .map(animation => animation.animationName)
    .filter(name => name === 'poster-yield' || name === 'head-tighten'))).toEqual([]);
});
