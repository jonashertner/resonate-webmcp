// map-label-layout.spec.mjs — names belong to the field, never to its furniture.
//
// A permanent place name may stand beside a mark, but it may not run off the
// glass or print through the five fixed words around the map. This fixture
// leaves one mark just beyond the lower-left edge, where the old right-hand
// tooltip began at x = -1 and crossed the attribution. Five other names have
// safe permanent positions (two only after turning away from the command), so
// making every permanent label disappear cannot satisfy the contract.

import { test, expect } from '@playwright/test';

const OFF = [
  '**://*.cartocdn.com/**',
  '**://*.openstreetmap.org/**',
  '**://tile.**',
  '**://photon.komoot.io/**',
];

const ZOOM = 13;
const WORLD = 256 * (2 ** ZOOM);
const EDGE = { lat: 47.55, lng: 7.59 };
const VIEWPORTS = [
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
];

function project({ lat, lng }) {
  const sin = Math.sin(lat * Math.PI / 180);
  return {
    x: (lng + 180) / 360 * WORLD,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * WORLD,
  };
}

function unproject({ x, y }) {
  const n = Math.PI - (2 * Math.PI * y / WORLD);
  return {
    lat: Math.atan(Math.sinh(n)) * 180 / Math.PI,
    lng: x / WORLD * 360 - 180,
  };
}

function fromEdge(dx, dy) {
  const p = project(EDGE);
  return unproject({ x: p.x + dx, y: p.y + dy });
}

const POINTS = [
  ['edge', 'Lower edge sentinel', 0, 0],
  ['north', 'North reading room', 300, -240],
  ['middle', 'Middle garden', 610, -430],
  ['east', 'Eastern archive', 900, -180],
  // These two stand on the command line at one viewport each. There is room
  // on their other side, so suppressing them would be a poorer answer than
  // turning the type away from the furniture.
  ['command-west', 'Command west room', 321, 0],
  ['command-east', 'Command east room', 621, 0],
].map(([id, name, dx, dy]) => ({ id, name, ...fromEdge(dx, dy) }));

function centerFor({ width, height }) {
  const edge = project(EDGE);
  // Keep the edge marker twenty-one pixels beyond the left side and twenty-
  // eight above the bottom. The other three points retain the pixel removes
  // declared above at either viewport because the zoom remains the same.
  const target = { x: -21, y: height - 28 };
  return unproject({
    x: edge.x + width / 2 - target.x,
    y: edge.y + height / 2 - target.y,
  });
}

async function openField(page, viewport) {
  await page.setViewportSize(viewport);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const pattern of OFF) await page.route(pattern, route => route.abort());
  await page.addInitScript((points) => {
    const now = new Date().toISOString();
    const places = points.map(point => ({
      ...point,
      city: 'Basel', country: 'Switzerland', tags: ['t1'], status: 'wishlist',
      note: '', createdAt: now, updatedAt: now,
    }));
    localStorage.setItem('resonate.places.v1', JSON.stringify(places));
    localStorage.setItem('resonate.tags.v1', JSON.stringify([
      { id: 't1', name: 'Culture', hue: 155, color: '#4a7' },
    ]));
    localStorage.setItem('resonate.settings.v1', JSON.stringify({
      theme: 'light', chosen: true, seeded: true, introSeen: true,
      authorName: 'ada', hue: 300,
    }));
  }, POINTS);

  await page.goto('/');
  await expect(page.locator('#threshold')).toBeHidden();
  await expect(page.locator('#intro')).toBeHidden({ timeout: 15000 });
  await expect(page.locator('body')).toHaveAttribute('data-entry', /board|field/, { timeout: 15000 });
  if (await page.locator('#indexOverlay').isVisible()) {
    await page.locator('#indexClose').click();
    await expect(page.locator('#indexOverlay')).toBeHidden();
  }
  // fitAll may still be completing the boot's first framing after the board
  // has yielded. Move only after Leaflet has finished that one flight.
  await expect(page.locator('#map')).not.toHaveClass(/leaflet-zoom-anim/);

  const center = centerFor(viewport);
  await page.evaluate(async ({ lat, lng, zoom }) => {
    // app.js and map.js share one release query. Import that exact module
    // instance rather than creating an uninitialised query-less copy.
    const release = new URL(document.querySelector('script[type="module"]').src).search;
    const mapView = await import(`/js/map.js${release}`);
    mapView.setView({ lat, lng, zoom });
  }, { ...center, zoom: ZOOM });
  await expect.poll(() => page.evaluate(async () => {
    const release = new URL(document.querySelector('script[type="module"]').src).search;
    return (await import(`/js/map.js${release}`)).getZoom();
  })).toBe(ZOOM);
  await expect.poll(() => page.evaluate(() => {
    const edge = document.querySelector('[aria-label^="Lower edge sentinel"]')?.getBoundingClientRect();
    const north = document.querySelector('[aria-label^="North reading room"]')?.getBoundingClientRect();
    return edge && north ? Math.round(north.left - edge.left) : 0;
  })).toBe(300);
}

async function layout(page) {
  return page.evaluate(() => {
    const visible = (el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return !el.hidden && style.display !== 'none' && style.visibility !== 'hidden'
        && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
    };
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return {
        name: el.textContent.trim(),
        left: r.left, right: r.right, top: r.top, bottom: r.bottom,
      };
    };
    const labels = [...document.querySelectorAll('.map-label')].filter(visible).map(box);
    const chrome = [...document.querySelectorAll('.fm')].filter(visible).map(box);
    const intersects = (a, b) => a.right > b.left && a.left < b.right
      && a.bottom > b.top && a.top < b.bottom;
    const outside = labels.filter(label => label.left < -0.5 || label.top < -0.5
      || label.right > innerWidth + 0.5 || label.bottom > innerHeight + 0.5);
    const collisions = labels.flatMap(label => chrome
      .filter(item => intersects(label, item))
      .map(item => `${label.name} / ${item.name}`));
    return { names: labels.map(label => label.name), outside, collisions };
  });
}

for (const viewport of VIEWPORTS) {
  test(`permanent map labels keep the field safe at ${viewport.width}x${viewport.height}`,
    async ({ page }) => {
      await openField(page, viewport);

      await expect.poll(async () => (await layout(page)).names).toEqual(expect.arrayContaining([
        'North reading room', 'Middle garden', 'Eastern archive',
        'Command west room', 'Command east room',
      ]));
      const seen = await layout(page);
      expect(seen.names.length, `all useful labels were suppressed: ${JSON.stringify(seen)}`)
        .toBeGreaterThanOrEqual(5);
      expect(seen.outside, `a permanent label left the viewport: ${JSON.stringify(seen)}`)
        .toEqual([]);
      expect(seen.collisions, `a permanent label crossed fixed field chrome: ${JSON.stringify(seen)}`)
        .toEqual([]);
    });
}

test('moving the field withdraws old label positions until the new plan is ready', async ({ page }) => {
  await openField(page, VIEWPORTS[0]);
  const field = page.locator('#map');
  await expect(field).not.toHaveClass(/map-labels-moving/);
  await expect.poll(async () => (await layout(page)).names.length).toBeGreaterThanOrEqual(5);

  const glass = await field.boundingBox();
  expect(glass).toBeTruthy();
  await page.mouse.move(glass.x + glass.width * 0.48, glass.y + glass.height * 0.42);
  await page.mouse.down();
  await page.mouse.move(glass.x + glass.width * 0.62, glass.y + glass.height * 0.42, { steps: 4 });

  await expect(field).toHaveClass(/map-labels-moving/);
  const during = await page.locator('.map-label').evaluateAll(labels => labels.map(label => (
    Number(getComputedStyle(label).opacity)
  )));
  expect(during.length, 'the drag had no old permanent arrangement to conceal').toBeGreaterThan(0);
  expect(during, 'an old label position remained painted during the drag')
    .toEqual(during.map(() => 0));

  await page.mouse.up();
  await expect(field).not.toHaveClass(/map-labels-moving/);
  const returned = await page.locator('.map-label').evaluateAll(labels => labels.map(label => (
    Number(getComputedStyle(label).opacity)
  )));
  expect(returned.some(opacity => opacity > 0), 'the new arrangement never returned').toBe(true);

  await expect.poll(async () => (await layout(page)).names.length).toBeGreaterThan(0);
  const settled = await layout(page);
  expect(settled.outside, `a newly planned label left the viewport: ${JSON.stringify(settled)}`)
    .toEqual([]);
  expect(settled.collisions, `a newly planned label crossed fixed field chrome: ${JSON.stringify(settled)}`)
    .toEqual([]);
});
