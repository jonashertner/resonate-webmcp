// shell.spec.mjs — the promise in the first line of sw.js, measured.
//
// "the shell, kept so the atlas opens without a network." Nothing checked it,
// and the list was a module short: js/store.js imports js/canonical.js, and
// canonical.js was never precached. The suite stayed green because a page that
// is already controlled caches the missing module at runtime, which hides the
// gap until the next deploy: the cache is keyed on the version and activate
// deletes every other one, so every release starts from the list alone and puts
// each user one online load away from an app that will not open on a train.
//
// The honest test would cut the network and reload. It cannot be written here.
// `context.setOffline(true)` cuts the page and leaves the service worker
// online, so the reload is served from a live server and proves nothing;
// `context.route` does not reach the worker's own fetches either; and WebKit's
// driver fails inside reload once a context with a worker is offline. All three
// were tried, and a test that passes because the network never went away is
// worse than no test.
//
// So the question is asked the other way round, which needs no offline at all:
// take the URLs the boot really fetched, and ask the cache the worker leaves
// behind whether it can answer each one. Reading the resource timeline rather
// than parsing imports is the point: it sees the stylesheet, the two typefaces,
// leaflet, markercluster, lz-string and argon2, none of which any import
// statement mentions.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sw = readFileSync(join(root, 'sw.js'), 'utf8');
const V = /const V = '([^']+)'/.exec(sw)?.[1];
// the entries only, not the prose between them: a comment carrying an
// apostrophe would otherwise arrive as a file the worker promises to hold
const SHELL = [...(/const SHELL = \[([\s\S]*?)\n\];/.exec(sw)?.[1] || '')
  .matchAll(/^\s*[`'](\.\/[^`']*)[`'],/gm)].map((m) => m[1].replace('${V}', V));

test('the install contract and every raster icon are served', async ({ request }) => {
  const response = await request.get('/manifest.webmanifest');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('application/manifest+json');
  const manifest = await response.json();
  expect(manifest.id).toBe('/');
  for (const icon of manifest.icons.filter((item) => item.type === 'image/png')) {
    const image = await request.get(`/${icon.src}`);
    expect(image.status(), `${icon.src} is not served`).toBe(200);
    expect(image.headers()['content-type']).toContain('image/png');
  }
});

test('the worker holds everything the first paint asks for', async ({ page }) => {
  expect(V, 'the version is not where it was in sw.js').toBeTruthy();
  expect(SHELL.length, 'the shell list is not where it was in sw.js').toBeGreaterThan(10);

  // stillness, as everywhere else in this suite. the evening is drawn by code
  // that is already on this list, so there is no asset for it to be missing
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    localStorage.setItem('resonate.places.v1', '[]');
    localStorage.setItem('resonate.tags.v1', '[]');
    localStorage.setItem('resonate.settings.v1', JSON.stringify({
      theme: 'auto', chosen: true, seeded: true, introSeen: true,
      authorName: 'ada', hue: 300,
    }));
  });
  await page.goto('/');
  await expect(page.locator('#intro')).toBeHidden({ timeout: 15000 });
  await expect(page.locator('body')).toHaveAttribute('data-entry', /board|field|letter|threshold/, { timeout: 15000 });

  const controlling = async () => page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false;
    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((r) => setTimeout(() => r(null), 10000)),
    ]);
    return !!(reg && reg.active && navigator.serviceWorker.controller);
  });
  if (!(await controlling())) {
    // The page is usable and the worker can control it at DOMContentLoaded.
    // Firefox on a small hosted runner can keep the later `load` event open
    // while the worker settles, which made this cache assertion time out on an
    // event it does not rely on.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#intro')).toBeHidden({ timeout: 15000 });
    await expect(page.locator('body')).toHaveAttribute('data-entry', /board|field|letter|threshold/, { timeout: 15000 });
  }
  expect(await controlling(), 'no service worker took control of the page').toBe(true);

  // Back to the state a deploy leaves behind: what the install handler put
  // there, and nothing that using the app added afterwards. Without this the
  // cache answers out of what it happened to accumulate, which is exactly the
  // accident that kept the missing module invisible.
  const swept = await page.evaluate(async (keep) => {
    const wanted = new Set(keep.map((u) => new URL(u, location.href).href));
    let left = 0;
    for (const name of await caches.keys()) {
      const c = await caches.open(name);
      for (const req of await c.keys()) {
        if (wanted.has(req.url)) left += 1;
        else await c.delete(req);
      }
    }
    return left;
  }, SHELL);
  expect(swept, 'the install handler cached nothing this test can read').toBeGreaterThan(10);

  // what the boot actually asked the network for, from this origin and under
  // this app's own path: the browser's account of it, not a list of ours
  const asked = await page.evaluate(() => {
    const scope = new URL('./', location.href).pathname;
    // The worker's own script is the one file that must NOT be in the shell.
    // It is fetched by the registration machinery rather than by the page, and
    // serving it from the cache is how an app loses the ability to replace
    // itself. WebKit reports it in the timeline and the other two do not, so it
    // is removed by asking the browser which script is in charge rather than by
    // spelling the name here, which would go stale if it were ever renamed.
    const worker = navigator.serviceWorker.controller?.scriptURL;
    return [...new Set(performance.getEntriesByType('resource')
      .map((e) => e.name)
      .filter((n) => {
        const u = new URL(n);
        return u.origin === location.origin && u.pathname.startsWith(scope) && n !== worker;
      }))];
  });
  expect(asked.length, 'the resource timeline was empty, so this measures nothing').toBeGreaterThan(15);

  const unanswered = await page.evaluate(async (urls) => {
    const out = [];
    for (const u of urls) if (!(await caches.match(u, { ignoreSearch: true }))) out.push(new URL(u).pathname);
    return out;
  }, asked);

  expect(unanswered, 'the first paint asks for these and the worker never cached them').toEqual([]);
});

test('low-data mobile connections request standard tiles and ordinary ones keep retina', async ({ browser }) => {
  const tileUrls = async (connection) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    const urls = [];
    await page.route('**://*.basemaps.cartocdn.com/**', (route) => {
      urls.push(route.request().url());
      return route.abort();
    });
    await page.addInitScript((signal) => {
      // The Network Information API exists on only some of the engines this
      // suite drives. Put the same read-only signal in each one before map.js
      // reads it, so this proves the URL rather than browser availability.
      Object.defineProperty(navigator, 'connection', {
        configurable: true,
        value: signal,
      });
      localStorage.setItem('resonate.places.v1', '[]');
      localStorage.setItem('resonate.tags.v1', '[]');
      localStorage.setItem('resonate.settings.v1', JSON.stringify({
        theme: 'auto', chosen: true, seeded: true, introSeen: true,
        authorName: 'ada', hue: 300,
      }));
    }, connection);
    try {
      await page.goto('/');
      await expect.poll(() => urls.length, {
        message: 'the map asked for no CARTO tiles',
      }).toBeGreaterThan(0);
      return urls;
    } finally {
      await context.close();
    }
  };

  const lowData = await tileUrls({ saveData: true, effectiveType: '4g' });
  expect(lowData.every((url) => !/@2x\.png/.test(url)),
    `Save-Data still requested retina tiles: ${lowData.join(', ')}`).toBe(true);

  const ordinary = await tileUrls({ saveData: false, effectiveType: '4g' });
  expect(ordinary.some((url) => /@2x\.png/.test(url)),
    `a high-density ordinary connection lost retina tiles: ${ordinary.join(', ')}`).toBe(true);
});
