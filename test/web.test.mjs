// The browser app has one installation contract and one public artifact.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { PAGES } from '../js/marks.js';
import { makeAgentTools } from '../js/agent.js';
import { PUBLIC_FILES, PUBLIC_MODULES, PUBLIC_TREES } from '../tools/stage-web.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const manifest = JSON.parse(read('manifest.webmanifest'));

function pngSize(path) {
  const png = readFileSync(join(root, path));
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${path} is not png`);
  assert.equal(png[25], 2, `${path} carries an alpha channel instead of an opaque RGB icon`);
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

test('the manifest identifies one installable app at the canonical root', () => {
  assert.equal(manifest.id, '/');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.orientation, 'any');
  assert.ok(manifest.name && manifest.short_name && manifest.description);
});

test('the manifest carries chromium icons and a mask-safe icon', () => {
  const icons = new Map(manifest.icons.map((icon) => [`${icon.sizes}:${icon.purpose}`, icon]));
  for (const [key, path, size] of [
    ['192x192:any', 'icons/icon-192.png', 192],
    ['512x512:any', 'icons/icon-512.png', 512],
    ['512x512:maskable', 'icons/icon-maskable-512.png', 512],
  ]) {
    assert.equal(icons.get(key)?.src, path, `the manifest has no ${key} icon`);
    assert.deepEqual(pngSize(path), [size, size]);
  }
});

test('apple receives an opaque touch icon and the page names this release', () => {
  const page = read('index.html');
  assert.match(page, /rel="apple-touch-icon" href="icons\/apple-touch-icon\.png" sizes="180x180"/);
  assert.deepEqual(pngSize('icons/apple-touch-icon.png'), [180, 180]);

  const release = /<meta name="resonate-release" content="([^"]+)">/.exec(page)?.[1];
  assert.match(release || '', /^rf\d+$/);
  assert.equal(/const V = 'v=([^']+)'/.exec(read('sw.js'))?.[1], release,
    'the page and offline shell name different releases');
  assert.match(page, new RegExp(`js/app\\.js\\?v=${release}`));
});

test('browser chrome and installed surfaces belong to the interface palette', () => {
  const page = read('index.html');
  const app = read('js/app.js');
  const icon = read('icons/icon.svg');
  const maskable = read('icons/icon-maskable.svg');
  const day = '#F7F3EE', night = '#110D18', mark = '#EFA831';

  assert.match(page, new RegExp(`theme-color" content="${day}"[^>]+light`));
  assert.match(page, new RegExp(`theme-color" content="${night}"[^>]+dark`));
  assert.match(app, new RegExp(`resolved === 'dark' \\? '${night}' : '${day}'`),
    'changing the in-app theme leaves the browser bar in another palette');
  assert.equal(manifest.background_color, day);
  assert.equal(manifest.theme_color, night);
  for (const [name, svg] of [['favicon', icon], ['maskable icon', maskable]]) {
    assert.match(svg, new RegExp(`fill="${night}"`), `${name} kept the old field`);
    assert.match(svg, new RegExp(`stroke="${mark}"`), `${name} kept the old mark`);
  }
});

test('both map themes use the issued CARTO basemap credential', () => {
  const source = read('js/map.js');
  const key = /const CARTO_KEY = '([^']+)'/.exec(source)?.[1] || '';
  assert.match(key, /^cb1_[a-z0-9_]{20,}$/,
    'the map has no issued CARTO basemap credential');
  assert.doesNotMatch(key, /placeholder|your|example/i);

  const templates = [...source.matchAll(/https:\/\/\{s\}\.basemaps\.cartocdn\.com\/([^`]+)`/g)]
    .map((match) => match[1]);
  assert.equal(templates.length, 2, 'day and night do not each name a tile source');
  assert.ok(templates.some((url) => url.startsWith('light_all/')), 'day lost its CARTO drawing');
  assert.ok(templates.some((url) => url.startsWith('dark_all/')), 'night lost its CARTO drawing');
  for (const template of templates) {
    assert.match(template, /\.png\?key=\$\{CARTO_KEY\}$/,
      'a theme can still request anonymous, watermarked tiles');
  }
});

test('support is readable online and remains in the offline shell', () => {
  assert.equal(PAGES.support, 'SUPPORT.md');
  assert.match(read('sw.js'), /'\.\/SUPPORT\.md'/);
  assert.match(read('js/app.js'), /read\.html\?d=support/);
});

test('service-worker upgrades delete only Resonate shell caches', () => {
  const shell = read('sw.js');
  assert.match(shell, /const CACHE_PREFIX = 'resonate-shell-'/);
  assert.match(shell, /k\.startsWith\(CACHE_PREFIX\) && k !== CACHE/,
    'activation can delete caches owned by another app on this origin');
});

test('the offline-shell install waits until the first page has loaded', () => {
  const app = read('js/app.js');
  const deferred = app.indexOf("addEventListener('load', registerOfflineShell, { once: true })");
  const registration = app.indexOf("navigator.serviceWorker.register('sw.js')");
  assert.ok(registration >= 0 && deferred > registration,
    'the offline cache can start competing with first-load map tiles');
  assert.match(app.slice(registration, deferred), /requestIdleCallback\(go, \{ timeout: 2000 \}\)/,
    'the offline install takes the first post-load interaction slot');
});

test('only exact current shell assets skip the service-worker network path', async () => {
  const source = read('sw.js');
  const version = /const V = '([^']+)'/.exec(source)?.[1];
  assert.ok(version, 'the worker version could not be read');

  const base = 'https://resonate.select/';
  const handlers = new Map();
  const stored = new Map();
  const fetched = [];
  const failing = new Set();
  const keyOf = (request) => new URL(
    typeof request === 'string' ? request : request.url,
    base,
  ).href;
  const cache = {
    match: async (request) => stored.get(keyOf(request)),
    put: async (request, response) => stored.set(keyOf(request), response),
    add: async () => {},
  };
  const caches = {
    open: async () => cache,
    keys: async () => [],
    delete: async () => true,
  };
  const self = {
    location: new URL('sw.js', base),
    addEventListener: (type, handler) => handlers.set(type, handler),
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };
  const fetch = async (request, init) => {
    const url = keyOf(request);
    fetched.push({ url, cache: init?.cache || 'default' });
    if (failing.has(url)) throw new TypeError('offline');
    const response = new Response(`network:${url}`);
    // A browser same-origin fetch is `basic`; Node's constructed Response is
    // `default`, so make the harness model the response the worker receives.
    Object.defineProperty(response, 'type', { value: 'basic' });
    return response;
  };
  runInNewContext(source, { self, caches, fetch, URL, Response });
  const handle = handlers.get('fetch');
  assert.ok(handle, 'the worker registered no fetch handler');

  const request = async (url, mode = 'same-origin') => {
    const waits = [];
    let answer;
    handle({
      request: { method: 'GET', mode, url },
      respondWith: (value) => { answer = Promise.resolve(value); },
      waitUntil: (value) => waits.push(Promise.resolve(value)),
    });
    assert.ok(answer, `the worker did not claim ${url}`);
    const response = await answer;
    await Promise.all(waits);
    return response.text();
  };

  const current = new URL(`css/style.css?${version}`, base).href;
  const stale = new URL('css/style.css?v=rf147', base).href;
  const unknown = new URL('future-local-endpoint.json', base).href;
  stored.set(current, new Response('cached:current'));
  stored.set(stale, new Response('cached:stale'));
  stored.set(unknown, new Response('cached:unknown'));
  stored.set(base, new Response('cached:navigation'));
  const reader = new URL('read.html', base).href;
  const privacy = new URL('read.html?d=privacy', base).href;
  stored.set(reader, new Response('cached:reader'));

  assert.equal(await request(current), 'cached:current');
  assert.deepEqual(fetched, [], 'a current release asset still revalidated over the wire');

  assert.equal(await request(stale), `network:${stale}`,
    'another release query was exchanged for a cached current file');
  assert.equal(await request(unknown), `network:${unknown}`,
    'an address outside the shell became cache first');
  assert.equal(await request(base, 'navigate'), `network:${base}`,
    'a navigation that is also in SHELL became cache first');
  failing.add(privacy);
  assert.equal(await request(privacy, 'navigate'), 'cached:reader',
    'an offline document route was exchanged for the atlas shell');
  assert.deepEqual(fetched, [
    { url: stale, cache: 'no-cache' },
    { url: unknown, cache: 'no-cache' },
    { url: base, cache: 'no-cache' },
    { url: privacy, cache: 'no-cache' },
  ]);
  assert.equal(await stored.get(stale).text(), `network:${stale}`,
    'the worker can end before a network-first response reaches its exact cache key');
});

test('deselecting a filtered-out place clears the map selection', () => {
  const source = read('js/map.js');
  const start = source.indexOf('export function refreshMarkerIcon');
  const end = source.indexOf('\n}', start);
  const body = source.slice(start, end);
  const clear = body.indexOf('selectedIdRef = null');
  const lookup = body.indexOf('markersById.get(place.id)');
  assert.ok(clear >= 0 && lookup > clear,
    'a place removed by the active filter can leave a stale selected marker');
});

test('map density drops only for explicit low-data connections', async () => {
  const previousMatchMedia = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: false });
  try {
    const { cartoTileTemplate, useStandardTileDensity } = await import('../js/map.js');
    for (const connection of [
      { saveData: true, effectiveType: '4g' },
      { saveData: false, effectiveType: '2g' },
      { saveData: false, effectiveType: 'slow-2g' },
      { saveData: false, effectiveType: 'SLOW-2G' },
      { saveData: false, effectiveType: '3g' },
    ]) {
      assert.equal(useStandardTileDensity(connection), true);
      assert.doesNotMatch(cartoTileTemplate('light', connection), /\{r\}/,
        'a low-data connection can still ask Leaflet for @2x tiles');
    }

    for (const connection of [null, {}, { saveData: false, effectiveType: '4g' }]) {
      assert.equal(useStandardTileDensity(connection), false);
      assert.match(cartoTileTemplate('dark', connection), /\{r\}/,
        'an ordinary connection lost retina tiles');
    }
  } finally {
    if (previousMatchMedia === undefined) delete globalThis.matchMedia;
    else globalThis.matchMedia = previousMatchMedia;
  }
});

test('destructive browser paths wait for their durable stores', () => {
  const app = read('js/app.js');
  const erase = app.indexOf('const shared = await sharedForErase()');
  const atlas = app.indexOf('store.clearAll({ defer: true', erase);
  const inbox = app.indexOf('if (!await wipeShareDB())', atlas);
  const photos = app.indexOf('if (!await photoStore.stageClear())', inbox);
  const committed = app.indexOf('store.commitClearAll()', photos);
  const recoveryGone = app.indexOf('photoStore.commitClear()', committed);
  const journalGone = app.indexOf('store.finishClearAll()', recoveryGone);
  const success = app.indexOf("toast('your atlas has been erased')", erase);
  assert.ok(erase >= 0 && erase < atlas && atlas < inbox && inbox < photos
    && photos < committed && committed < recoveryGone && recoveryGone < journalGone
    && journalGone < success,
  'the cross-store erase can announce success before every staged store commits');
  assert.match(app.slice(erase, success), /rollbackPreparedErase\(shared\)/,
    'a refused durable store has no route back to the staged atlas');

  const inspect = app.indexOf('const found = inspectShared(first.item)');
  const forget = app.indexOf('forgetShared(first.key)', inspect);
  assert.ok(inspect >= 0 && inspect < forget,
    'a shared record is forgotten before its Google URL is parsed');
});

test('assistants find one public orientation and the same five tools the app exposes', () => {
  const page = read('index.html');
  const guide = read('llms.txt');
  const shell = read('sw.js');
  assert.match(page, /rel="alternate" type="text\/markdown" href="llms\.txt"/);
  assert.ok(PUBLIC_FILES.includes('llms.txt') && PUBLIC_MODULES.includes('agent.js'));
  assert.match(shell, /'\.\/llms\.txt'/);
  assert.match(shell, /`\.\/js\/agent\.js\?\$\{V\}`/);
  for (const tool of makeAgentTools({ disclosure: () => ({}) })) {
    assert.match(guide, new RegExp(`\\b${tool.name}\\b`), `${tool.name} is absent from llms.txt`);
  }
  assert.match(guide, /no headless or server-side write endpoint/i);
});

test('the public allowlist leaves every release machine outside', () => {
  for (const privateName of [
    '.github', 'club', 'dist-native', 'ios', 'node_modules', 'package.json',
    'playwright.config.mjs', 'test', 'tools', 'WEB-RELEASE.md',
  ]) {
    assert.ok(!PUBLIC_FILES.includes(privateName) && !PUBLIC_TREES.includes(privateName),
      `${privateName} is public`);
  }
  assert.ok(!PUBLIC_MODULES.includes('native-entry.js'), 'the future native bridge is public');
  for (const publicName of ['index.html', 'manifest.webmanifest', 'SUPPORT.md', 'sw.js']) {
    assert.ok(PUBLIC_FILES.includes(publicName), `${publicName} is not public`);
    assert.ok(existsSync(join(root, publicName)), `${publicName} does not exist`);
  }
});

test('the production workflow stages the same allowlist before deploy and smoke', () => {
  const flow = read('.github/workflows/pages.yml');
  assert.equal((flow.match(/node tools\/stage-web\.mjs/g) || []).length, 2,
    'deploy and smoke do not both stage the public payload');
  assert.doesNotMatch(flow, /rsync\s/);
  assert.match(flow, /find _site -type f -print0 \| sort -z/,
    'smoke does not derive its byte comparisons from the staged payload');
});
